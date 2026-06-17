const axios = require('axios');
const MetaIntegration = require('../models/MetaIntegration');
const MetaEventLog = require('../models/MetaEventLog');
const { decryptToken } = require('../utils/crypto');
const { hashField } = require('../utils/hash');

const GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION || 'v21.0';
const GRAPH_API_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

// Throttle: only log "no integration" warning once every 5 minutes to reduce terminal noise
let _lastNoIntegrationLogTime = 0;
const NO_INTEGRATION_LOG_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Normalizes, hashes and prepares user data for storage & Meta transmission.
 * Crucial: Only stores pre-hashed PII inside the DB.
 */
const prepareUserData = (rawUserData) => {
    if (!rawUserData) return {};

    const userData = {};

    // 1. Process standard fields (hashes only)
    if (rawUserData.email) {
        userData.em = [hashField(rawUserData.email, 'email')];
    } else if (rawUserData.em) {
        userData.em = Array.isArray(rawUserData.em) ? rawUserData.em : [rawUserData.em];
    }

    if (rawUserData.phone) {
        userData.ph = [hashField(rawUserData.phone, 'phone')];
    } else if (rawUserData.ph) {
        userData.ph = Array.isArray(rawUserData.ph) ? rawUserData.ph : [rawUserData.ph];
    }

    if (rawUserData.firstName) {
        userData.fn = [hashField(rawUserData.firstName, 'string')];
    } else if (rawUserData.first_name) {
        userData.fn = [hashField(rawUserData.first_name, 'string')];
    } else if (rawUserData.fn) {
        userData.fn = Array.isArray(rawUserData.fn) ? rawUserData.fn : [rawUserData.fn];
    }

    if (rawUserData.lastName) {
        userData.ln = [hashField(rawUserData.lastName, 'string')];
    } else if (rawUserData.last_name) {
        userData.ln = [hashField(rawUserData.last_name, 'string')];
    } else if (rawUserData.ln) {
        userData.ln = Array.isArray(rawUserData.ln) ? rawUserData.ln : [rawUserData.ln];
    }

    if (rawUserData.externalId) {
        userData.external_id = [hashField(rawUserData.externalId, 'raw')];
    } else if (rawUserData.external_id) {
        userData.external_id = Array.isArray(rawUserData.external_id) ? rawUserData.external_id : [rawUserData.external_id];
    }

    // 2. Client context fields (non-PII, pass directly)
    if (rawUserData.client_ip_address) userData.client_ip_address = rawUserData.client_ip_address;
    if (rawUserData.clientIpAddress) userData.client_ip_address = rawUserData.clientIpAddress;

    if (rawUserData.client_user_agent) userData.client_user_agent = rawUserData.client_user_agent;
    if (rawUserData.clientUserAgent) userData.client_user_agent = rawUserData.clientUserAgent;

    if (rawUserData.fbp) userData.fbp = rawUserData.fbp;
    if (rawUserData.fbc) userData.fbc = rawUserData.fbc;

    // Filter out undefined/null properties
    return Object.fromEntries(
        Object.entries(userData).filter(([_, v]) => v !== undefined && v !== null)
    );
};

/**
 * Pushes a tracking event into the DB-backed Conversions API queue
 */
const queueMetaEvent = async (eventDetails) => {
    const startTime = Date.now();
    try {
        const {
            eventName,
            eventId,
            storeId,
            orderId,
            eventTime = Math.floor(Date.now() / 1000),
            eventSourceUrl,
            userData: rawUserData = {},
            customData = {}
        } = eventDetails;

        if (!eventName || !eventId) {
            console.error('[Meta Queue] Missing required eventName or eventId');
            return { success: false, error: 'eventName and eventId are required' };
        }

        // 1. Fetch integration to see if Pixel/CAPI is enabled and get Pixel ID
        const integration = await MetaIntegration.findOne(storeId ? { storeId } : {});
        if (!integration) {
            return { success: false, error: 'Meta integration not configured' };
        }

        // 2. Prepare safe, pre-hashed payload
        const user_data = prepareUserData(rawUserData);

        const requestPayloadSafe = {
            event_name: eventName,
            event_time: eventTime,
            event_id: eventId,
            action_source: 'website',
            event_source_url: eventSourceUrl || process.env.WEBSTORE_URL || 'https://luminelle.org',
            user_data,
            custom_data: {
                ...customData,
                currency: customData.currency || 'PKR'
            }
        };

        // Determine indicators
        const hasFbp = !!user_data.fbp;
        const hasFbc = !!user_data.fbc;
        const hasEmailHash = !!(user_data.em && user_data.em.length > 0);
        const hasPhoneHash = !!(user_data.ph && user_data.ph.length > 0);
        const hasExternalId = !!(user_data.external_id && user_data.external_id.length > 0);
        const testEventCodeUsed = integration.testEventCode || '';

        // Deduplication key representation
        const deduplicationKey = `${eventName}:${eventId}`;

        // 3. Create or update queued Meta event log
        // Use findOneAndUpdate with upsert to prevent unique key violations from parallel client calls
        const log = await MetaEventLog.findOneAndUpdate(
            { eventName, eventId, source: 'server', ...(storeId && { storeId }) },
            {
                $setOnInsert: {
                    orderId: orderId || null,
                    storeId: storeId || integration.storeId || null,
                    pixelId: integration.pixelId || null,
                    attempts: 0,
                    maxAttempts: 3,
                    hasFbp,
                    hasFbc,
                    hasEmailHash,
                    hasPhoneHash,
                    hasExternalId,
                    deduplicationKey,
                    testEventCodeUsed
                },
                $set: {
                    status: 'queued',
                    nextRetryAt: new Date(),
                    requestPayloadSafe
                }
            },
            { upsert: true, new: true }
        );

        const duration = Date.now() - startTime;
        console.log(`[Meta Queue] Queued server event ${eventName} (ID: ${eventId}) in ${duration}ms`);
        return { success: true, logId: log._id, durationMs: duration };

    } catch (error) {
        console.error('[Meta Queue] Error in queueMetaEvent:', error.message);
        return { success: false, error: error.message };
    }
};

/**
 * Background worker/batch processor for queued database records.
 * Incorporates: Serverless execution guard, Axios payloads, and Exponential backoff retry.
 */
const processPendingQueue = async (batchSize = 20, storeId = null) => {
    const queueStartTime = Date.now();
    const TIMEOUT_LIMIT_MS = 8000; // Early exit after 8 seconds to prevent serverless gateway timeouts

    const mongoose = require('mongoose');
    if (mongoose.connection.readyState !== 1) {
        console.warn('[Meta Queue Worker] DB unavailable. Meta Queue Worker paused.');
        return { processed: 0, status: 'db_unavailable' };
    }

    if (!storeId) {
        const integrations = await MetaIntegration.find({
            storeId: { $exists: true, $ne: null },
            pixelId: { $exists: true, $ne: '' },
            isCapiEnabled: true
        }).select('storeId').lean();

        let processed = 0;
        let success = 0;
        let failed = 0;
        for (const integration of integrations) {
            const result = await processPendingQueue(batchSize, integration.storeId);
            processed += result.processed || 0;
            success += result.success || 0;
            failed += result.failed || 0;
        }
        return { processed, success, failed, status: integrations.length ? 'completed' : 'no_integration' };
    }

    console.log(`[Meta Queue Worker] Starting pending queue processor. Batch size limit: ${batchSize}`);

    // 1. Fetch integration and check if connected
    const integration = await MetaIntegration.findOne(storeId ? { storeId } : {});
    if (!integration || !integration.pixelId) {
        const now = Date.now();
        if (now - _lastNoIntegrationLogTime >= NO_INTEGRATION_LOG_INTERVAL_MS) {
            console.warn('[Meta Queue Worker] No Meta Integration or Pixel ID found. Worker aborted. (This message is throttled to once per 5 min)');
            _lastNoIntegrationLogTime = now;
        }
        return { processed: 0, status: 'no_integration' };
    }

    if (!integration.isCapiEnabled) {
        console.warn('[Meta Queue Worker] Conversions API is disabled in settings. Worker skipped.');
        return { processed: 0, status: 'capi_disabled' };
    }

    // 2. Decrypt token
    let accessToken = integration.capiAccessTokenEncrypted || integration.accessTokenEncrypted;
    if (!accessToken) {
        console.error('[Meta Queue Worker] Meta API token missing. Connection status set to error.');
        integration.connectionStatus = 'error';
        integration.lastErrorMessage = 'Access token missing or cleared';
        await integration.save();
        return { processed: 0, status: 'token_error' };
    }

    if (accessToken.includes(':')) {
        try {
            accessToken = decryptToken(accessToken);
        } catch (decErr) {
            console.error('[Meta Queue Worker] Failed to decrypt access token:', decErr.message);
            integration.connectionStatus = 'error';
            integration.lastErrorMessage = `Token decryption failed: ${decErr.message}`;
            await integration.save();
            return { processed: 0, status: 'decryption_error' };
        }
    }

    // 3. Find pending events to process
    const pendingEvents = await MetaEventLog.find({
        source: 'server',
        ...(storeId && { storeId }),
        status: { $in: ['queued', 'failed'] },
        attempts: { $lt: 3 }, // Attempts less than maxAttempts (3)
        nextRetryAt: { $lte: new Date() }
    })
    .sort({ createdAt: -1 })
    .limit(batchSize);

    if (pendingEvents.length === 0) {
        console.log('[Meta Queue Worker] No pending events to process.');
        return { processed: 0, status: 'idle' };
    }

    console.log(`[Meta Queue Worker] Found ${pendingEvents.length} pending events to send to Meta.`);

    let processedCount = 0;
    let successCount = 0;
    let failedCount = 0;

    for (const eventLog of pendingEvents) {
        // Early serverless timeout escape check
        const elapsed = Date.now() - queueStartTime;
        if (elapsed > TIMEOUT_LIMIT_MS) {
            console.warn(`[Meta Queue Worker] Approaching 8s serverless limit (${elapsed}ms). Saving batch and exiting early.`);
            break;
        }

        const startItemTime = Date.now();
        eventLog.attempts += 1;

        try {
            // Build the payload Meta expects
            const capiPayload = {
                data: [eventLog.requestPayloadSafe]
            };

            // Inject test code if set in event or globally
            const testCode = eventLog.testEventCodeUsed || integration.testEventCode;
            if (testCode) {
                capiPayload.test_event_code = testCode;
            }

            // Fire API call
            const response = await axios.post(
                `${GRAPH_API_BASE_URL}/${integration.pixelId}/events`,
                capiPayload,
                {
                    params: { access_token: accessToken },
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 5000 // 5 seconds individual timeout
                }
            );

            const duration = Date.now() - startItemTime;

            // Success
            eventLog.status = testCode ? 'test_sent' : 'sent';
            eventLog.sentAt = new Date();
            eventLog.responseTimeMs = duration;
            eventLog.responsePayloadSafe = response.data;
            eventLog.errorMessage = null;

            successCount++;
            
            // Track health metrics
            integration.lastSuccessfulCapiAt = new Date();
            integration.lastEventSentAt = new Date();
            integration.lastErrorMessage = null;
            integration.connectionStatus = 'connected';

        } catch (error) {
            const duration = Date.now() - startItemTime;
            eventLog.responseTimeMs = duration;
            
            const errData = error.response?.data?.error;
            const errMsg = errData?.message || error.message;
            eventLog.errorMessage = errMsg;
            eventLog.responsePayloadSafe = error.response?.data || null;

            console.error(`[Meta Queue Worker] Event transmission failed for log ${eventLog._id}:`, errMsg);

            // Check if error is non-retryable (400 Client error in payload/invalid token/etc.)
            const isClientError = error.response?.status >= 400 && error.response?.status < 500;
            const isDeadToken = errData?.code === 190 || errData?.code === 102; // Invalid OAuth 2.0 access token

            if (isClientError && !isDeadToken) {
                // If it is a bad payload issue (e.g. invalid parameters), mark it dead immediately to avoid wasting resource retrying
                eventLog.status = 'dead';
                failedCount++;
            } else {
                // Retryable error (server down, timeout, network error, or invalid token which might get fixed)
                eventLog.status = 'failed';
                
                if (eventLog.attempts >= eventLog.maxAttempts) {
                    eventLog.status = 'dead';
                    failedCount++;
                } else {
                    // Exponential backoff: retry after 2 minutes, 4 minutes, etc.
                    const backoffMinutes = Math.pow(2, eventLog.attempts);
                    eventLog.nextRetryAt = new Date(Date.now() + backoffMinutes * 60 * 1000);
                }
            }

            integration.lastErrorMessage = errMsg;
            if (isDeadToken) {
                integration.connectionStatus = 'error';
            }
        }

        // Save log updates immediately
        await eventLog.save();
        processedCount++;
    }

    // Refresh integration metrics and health score
    try {
        // Simple health score formula: (successCount / processedCount) * 100
        const totalLogs = await MetaEventLog.countDocuments({ source: 'server', storeId });
        const failedLogs = await MetaEventLog.countDocuments({ source: 'server', storeId, status: 'dead' });
        
        let healthScore = 100;
        if (totalLogs > 0) {
            healthScore = Math.max(0, Math.round(((totalLogs - failedLogs) / totalLogs) * 100));
        }
        
        integration.trackingHealthScore = healthScore;
        await integration.save();
    } catch (saveErr) {
        console.error('[Meta Queue Worker] Failed to update health score:', saveErr.message);
    }

    console.log(`[Meta Queue Worker] Batch finished. Processed: ${processedCount}, Success: ${successCount}, Failures/Dead: ${failedCount} in ${Date.now() - queueStartTime}ms`);
    return {
        processed: processedCount,
        success: successCount,
        failed: failedCount,
        status: 'completed'
    };
};

module.exports = {
    queueMetaEvent,
    processPendingQueue
};
