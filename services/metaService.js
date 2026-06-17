const axios = require('axios');
const crypto = require('crypto');
const MetaIntegration = require('../models/MetaIntegration');
const MetaEventLog = require('../models/MetaEventLog');
const { decryptToken } = require('../utils/crypto');

const GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION || 'v18.0';
const GRAPH_API_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

/**
 * Normalizes and hashes user data for Meta CAPI
 */
const hashData = (data) => {
    if (!data) return undefined;
    const normalized = data.trim().toLowerCase();
    return crypto.createHash('sha256').update(normalized).digest('hex');
};

/**
 * Sends a Conversions API event to Meta
 */
exports.sendCapiEvent = async (config, { eventName, eventId, eventTime, eventSourceUrl, userData, customData, orderId }) => {
    const pixelId = config.pixelId;
    let accessToken = config.capiAccessTokenEncrypted || config.accessTokenEncrypted;

    if (!pixelId || !accessToken) {
        throw new Error('Meta Pixel ID or Access Token missing');
    }

    // Decrypt token if it's encrypted
    if (accessToken.includes(':')) {
        accessToken = decryptToken(accessToken);
    }

    const payload = {
        data: [{
            event_name: eventName,
            event_time: Math.floor((eventTime || Date.now()) / 1000),
            event_id: eventId,
            action_source: 'website',
            event_source_url: eventSourceUrl,
            user_data: {
                em: userData.email ? [hashData(userData.email)] : undefined,
                ph: userData.phone ? [hashData(userData.phone)] : undefined,
                client_ip_address: userData.clientIpAddress,
                client_user_agent: userData.clientUserAgent,
                fbp: userData.fbp,
                fbc: userData.fbc,
                external_id: userData.externalId ? [hashData(userData.externalId)] : undefined
            },
            custom_data: customData
        }]
    };

    // Remove undefined fields
    payload.data[0].user_data = Object.fromEntries(
        Object.entries(payload.data[0].user_data).filter(([_, v]) => v !== undefined)
    );

    try {
        const response = await axios.post(`${GRAPH_API_BASE_URL}/${pixelId}/events`, payload, {
            params: { access_token: accessToken }
        });

        // Log success
        await MetaEventLog.create({
            orderId,
            eventName,
            eventId,
            pixelId,
            source: 'server',
            status: 'success',
            requestPayloadSafe: { ...payload.data[0], user_data: { ...payload.data[0].user_data, em: userData.email ? '***' : undefined, ph: userData.phone ? '***' : undefined } },
            responsePayload: response.data
        });

        return response.data;
    } catch (error) {
        const errMsg = error.response?.data?.error?.message || error.message;
        
        // Log failure
        await MetaEventLog.create({
            orderId,
            eventName,
            eventId,
            pixelId,
            source: 'server',
            status: 'failed',
            requestPayloadSafe: { ...payload.data[0], user_data: { ...payload.data[0].user_data, em: userData.email ? '***' : undefined, ph: userData.phone ? '***' : undefined } },
            errorMessage: errMsg,
            responsePayload: error.response?.data
        });

        throw new Error(`Meta CAPI Error: ${errMsg}`);
    }
};

/**
 * Meta OAuth Flow
 */
exports.getOAuthUrl = (options = {}) => {
    const appId = process.env.META_APP_ID;
    // Strictly normalize: strip trailing slashes so redirect_uri matches exactly
    const redirectUri = (process.env.META_REDIRECT_URI || '').replace(/\/+$/, '');
    const scopes = process.env.META_OAUTH_SCOPES || 'public_profile';

    if (!appId || appId === '1234567890' || appId === 'undefined') {
        throw new Error('META_APP_ID is missing or invalid. Please use a real Meta App ID.');
    }

    if (!redirectUri || redirectUri === 'undefined') {
        throw new Error('META_REDIRECT_URI is missing or not configured. Please set META_REDIRECT_URI in your environment variables.');
    }

    const nonce = crypto.randomBytes(16).toString('hex');
    const state = options.storeId ? `${options.storeId}:${nonce}` : nonce;
    console.log('[Meta OAuth] Scopes requested:', scopes);
    console.log('[Meta OAuth] Redirect URI (normalized):', redirectUri);

    const params = new URLSearchParams({
        client_id: appId,
        redirect_uri: redirectUri,
        scope: scopes,
        response_type: 'code',
        state,
        display: 'popup',
        auth_type: 'rerequest'
    });

    return `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth?${params.toString()}`;
};

exports.exchangeCodeForToken = async (code) => {
    try {
        // Must match the redirect_uri used in getOAuthUrl exactly (no trailing slashes)
        const redirectUri = (process.env.META_REDIRECT_URI || '').replace(/\/+$/, '');

        const res = await axios.get(`${GRAPH_API_BASE_URL}/oauth/access_token`, {
            params: {
                client_id: process.env.META_APP_ID,
                client_secret: process.env.META_APP_SECRET,
                redirect_uri: redirectUri,
                code
            }
        });

        return {
            accessToken: res.data.access_token,
            expiresIn: res.data.expires_in
        };
    } catch (error) {
        throw new Error(`Meta OAuth Exchange failed: ${error.response?.data?.error?.message || error.message}`);
    }
};

exports.getMetaUser = async (accessToken) => {
    try {
        const res = await axios.get(`${GRAPH_API_BASE_URL}/me`, {
            params: {
                access_token: accessToken,
                fields: 'id,name,picture'
            }
        });
        return res.data;
    } catch (error) {
        throw new Error(`Meta User Validation failed: ${error.response?.data?.error?.message || error.message}`);
    }
};

/**
 * Fetches granted permissions for the connected user
 */
exports.getGrantedPermissions = async (accessToken) => {
    try {
        const res = await axios.get(`${GRAPH_API_BASE_URL}/me/permissions`, {
            params: { access_token: accessToken }
        });
        return res.data.data;
    } catch (error) {
        console.error('Failed to fetch Meta permissions:', error.message);
        return [];
    }
};

/**
 * Fetches Meta assets (Businesses, Ad Accounts, Pixels, Pages)
 */
exports.getBusinesses = async (accessToken) => {
    try {
        const res = await axios.get(`${GRAPH_API_BASE_URL}/me/businesses`, {
            params: { 
                access_token: accessToken, 
                fields: 'id,name,verification_status' 
            }
        });
        return res.data.data;
    } catch (error) {
        const err = new Error(`Failed to fetch Meta businesses: ${error.response?.data?.error?.message || error.message}`);
        err.permissionMissing = error.response?.data?.error?.code === 200 || error.response?.data?.error?.error_subcode === 1341018;
        throw err;
    }
};

exports.getAdAccounts = async (businessId, accessToken) => {
    try {
        console.log(`Fetching Ad Accounts for Business: ${businessId}`);
        
        // Fetch both owned and client ad accounts
        const [ownedRes, clientRes] = await Promise.all([
            axios.get(`${GRAPH_API_BASE_URL}/${businessId}/owned_ad_accounts`, {
                params: { 
                    access_token: accessToken, 
                    fields: 'id,account_id,name,currency,account_status' 
                }
            }).catch(e => ({ data: { data: [] }, error: e })),
            axios.get(`${GRAPH_API_BASE_URL}/${businessId}/client_ad_accounts`, {
                params: { 
                    access_token: accessToken, 
                    fields: 'id,account_id,name,currency,account_status' 
                }
            }).catch(e => ({ data: { data: [] }, error: e }))
        ]);

        const owned = (ownedRes.data?.data || []).map(a => ({ ...a, source: 'owned' }));
        const client = (clientRes.data?.data || []).map(a => ({ ...a, source: 'client' }));

        // Deduplicate and normalize
        const merged = [...owned, ...client];

        // FALLBACK: If no business-specific ad accounts found, try personal ones
        if (merged.length === 0) {
            console.log(`[Meta] No ad accounts for business ${businessId}. Trying personal fallback...`);
            try {
                const meRes = await axios.get(`${GRAPH_API_BASE_URL}/me/adaccounts`, {
                    params: { 
                        access_token: accessToken, 
                        fields: 'id,account_id,name,currency,account_status' 
                    }
                });
                const personal = (meRes.data?.data || []).map(a => ({ ...a, source: 'personal' }));
                merged.push(...personal);
            } catch (e) {
                console.warn(`[Meta] Personal fallback failed: ${e.message}`);
            }
        }

        const unique = Array.from(new Map(merged.map(item => [item.id, item])).values());

        return unique.map(acc => {
            const rawId = acc.account_id || acc.id.replace('act_', '');
            return {
                ...acc,
                account_id: rawId,
                actId: `act_${rawId}`,
                currency: acc.currency || 'USD'
            };
        });
    } catch (error) {
        const err = new Error(`Failed to fetch Ad Accounts: ${error.response?.data?.error?.message || error.message}`);
        err.permissionMissing = error.response?.data?.error?.code === 200;
        throw err;
    }
};

exports.getPixels = async (params) => {
    const { adAccountId, businessId, accessToken } = params;
    try {
        // Ensure act_ prefix
        const actId = adAccountId ? (adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`) : null;
        console.log(`[PIXEL_FETCH] Starting fetch for Act: ${actId} and Biz: ${businessId}`);

        let allPixels = [];
        const endpointErrors = [];

        // 1. Try Ad Account Pixels
        if (actId) {
            try {
                const res = await axios.get(`${GRAPH_API_BASE_URL}/${actId}/adspixels`, {
                    params: { 
                        access_token: accessToken, 
                        fields: 'id,name,creation_time,last_fired_time' 
                    }
                });
                const pxs = (res.data.data || []).map(p => ({ ...p, source: 'ad_account_pixels' }));
                allPixels = [...allPixels, ...pxs];
                console.log(`[PIXEL_FETCH] Found ${pxs.length} ad account pixels`);
            } catch (e) {
                console.warn(`[PIXEL_FETCH] Ad Account Endpoint Failed: ${e.message}`);
                endpointErrors.push({ endpoint: 'adspixels', error: e.response?.data?.error?.message || e.message });
            }
        }

        // 2. Try Business Owned Pixels
        if (businessId) {
            try {
                const res = await axios.get(`${GRAPH_API_BASE_URL}/${businessId}/owned_pixels`, {
                    params: { 
                        access_token: accessToken, 
                        fields: 'id,name,creation_time,last_fired_time' 
                    }
                });
                const pxs = (res.data.data || []).map(p => ({ ...p, source: 'business_owned_pixels' }));
                allPixels = [...allPixels, ...pxs];
                console.log(`[PIXEL_FETCH] Found ${pxs.length} business owned pixels`);
            } catch (e) {
                console.warn(`[PIXEL_FETCH] Business Owned Endpoint Failed: ${e.message}`);
                endpointErrors.push({ endpoint: 'owned_pixels', error: e.response?.data?.error?.message || e.message });
            }

            // 3. Try Business Client Pixels
            try {
                const res = await axios.get(`${GRAPH_API_BASE_URL}/${businessId}/client_pixels`, {
                    params: { 
                        access_token: accessToken, 
                        fields: 'id,name,creation_time,last_fired_time' 
                    }
                });
                const pxs = (res.data.data || []).map(p => ({ ...p, source: 'business_client_pixels' }));
                allPixels = [...allPixels, ...pxs];
                console.log(`[PIXEL_FETCH] Found ${pxs.length} business client pixels`);
            } catch (e) {
                console.warn(`[PIXEL_FETCH] Business Client Endpoint Failed: ${e.message}`);
                endpointErrors.push({ endpoint: 'client_pixels', error: e.response?.data?.error?.message || e.message });
            }
        }

        // Deduplicate
        const unique = Array.from(new Map(allPixels.map(item => [item.id, item])).values());

        return {
            pixels: unique,
            endpointErrors
        };
    } catch (error) {
        throw new Error(`Pixel Discovery Failed: ${error.message}`);
    }
};

exports.getPages = async (accessToken) => {
    try {
        const res = await axios.get(`${GRAPH_API_BASE_URL}/me/accounts`, {
            params: { 
                access_token: accessToken, 
                fields: 'id,name,picture' 
            }
        });
        return res.data.data;
    } catch (error) {
        const err = new Error(`Failed to fetch Pages: ${error.response?.data?.error?.message || error.message}`);
        err.permissionMissing = error.response?.data?.error?.code === 200;
        throw err;
    }
};
