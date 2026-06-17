const axios = require('axios');
const crypto = require('crypto');
const MetaIntegration = require('../models/MetaIntegration');
const MetaEventLog = require('../models/MetaEventLog');
const { decryptToken } = require('../utils/crypto');

const GRAPH_API_VERSION = 'v18.0';
const GRAPH_API_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

/**
 * Normalizes and hashes user data for Meta CAPI (SHA-256)
 */
const hashData = (data) => {
    if (!data) return undefined;
    const normalized = String(data).trim().toLowerCase();
    return crypto.createHash('sha256').update(normalized).digest('hex');
};

/**
 * Normalizes and hashes phone number for Meta CAPI
 */
const hashPhone = (phone) => {
    if (!phone) return undefined;
    // Remove all non-numeric characters except maybe a leading plus if Meta allows it, 
    // but usually they want just numbers for normalization.
    const normalized = String(phone).replace(/[^\d]/g, '');
    return crypto.createHash('sha256').update(normalized).digest('hex');
};

/**
 * Sends a Conversions API event to Meta
 */
exports.sendMetaCapiEvent = async (eventName, eventData) => {
    try {
        const {
            eventId,
            eventTime = Math.floor(Date.now() / 1000),
            eventSourceUrl,
            userData = {},
            customData = {},
            orderId,
            storeId,
            testEventCode
        } = eventData;

        // 1. Get Meta Integration
        if (!storeId) {
            return { success: false, message: 'storeId is required for CAPI events' };
        }

        const integration = await MetaIntegration.findOne({ storeId });
        if (!integration || !integration.setupCompleted || !integration.isCapiEnabled || !integration.pixelId) {
            return { success: false, message: 'CAPI not configured or disabled' };
        }

        // 2. Decrypt Token
        let accessToken = integration.capiAccessTokenEncrypted || integration.accessTokenEncrypted;
        if (!accessToken) return { success: false, message: 'No access token found' };
        
        if (accessToken.includes(':')) {
            accessToken = decryptToken(accessToken);
        }

        // 3. Prepare Payload
        const payload = {
            data: [{
                event_name: eventName,
                event_time: eventTime,
                event_id: eventId,
                action_source: 'website',
                event_source_url: eventSourceUrl || process.env.WEBSTORE_URL || 'https://luminelle.org',
                user_data: {
                    em: userData.email ? [hashData(userData.email)] : undefined,
                    ph: userData.phone ? [hashPhone(userData.phone)] : undefined,
                    client_ip_address: userData.clientIpAddress,
                    client_user_agent: userData.clientUserAgent,
                    fbp: userData.fbp,
                    fbc: userData.fbc,
                    external_id: userData.externalId ? [hashData(userData.externalId)] : undefined
                },
                custom_data: {
                    ...customData,
                    currency: customData.currency || 'PKR'
                }
            }]
        };

        if (testEventCode) {
            payload.test_event_code = testEventCode;
        }

        // Remove undefined fields from user_data
        payload.data[0].user_data = Object.fromEntries(
            Object.entries(payload.data[0].user_data).filter(([_, v]) => v !== undefined)
        );

        // 4. Send to Meta
        const response = await axios.post(`${GRAPH_API_BASE_URL}/${integration.pixelId}/events`, payload, {
            params: { access_token: accessToken }
        });

        // 5. Log Success
        await MetaEventLog.create({
            storeId,
            orderId: orderId || null,
            eventName,
            eventId,
            pixelId: integration.pixelId,
            source: 'server',
            status: 'success',
            metaResponse: response.data,
            requestPayloadSafe: {
                ...payload.data[0],
                user_data: {
                    ...payload.data[0].user_data,
                    em: userData.email ? '***' : undefined,
                    ph: userData.phone ? '***' : undefined
                }
            }
        });

        return { success: true, metaResponse: response.data };

    } catch (error) {
        const errMsg = error.response?.data?.error?.message || error.message;
        console.error(`[Meta CAPI Error] ${eventName}:`, errMsg);

        // Log Failure
        try {
            const integration = eventData.storeId
                ? await MetaIntegration.findOne({ storeId: eventData.storeId })
                : null;
            await MetaEventLog.create({
                storeId: eventData.storeId || null,
                orderId: eventData.orderId || null,
                eventName,
                eventId: eventData.eventId,
                pixelId: integration?.pixelId || 'unknown',
                source: 'server',
                status: 'failed',
                errorMessage: errMsg,
                metaResponse: error.response?.data || null
            });
        } catch (logErr) {
            console.error('Failed to log Meta CAPI failure:', logErr.message);
        }

        return { success: false, message: errMsg };
    }
};
