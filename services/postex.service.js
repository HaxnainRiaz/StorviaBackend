/**
 * PostEx Service Layer — Multi-Tenant
 *
 * Every exported function accepts `ownerId` (the admin's _id).
 * The correct PostEx API token is fetched from the database for
 * that owner, decrypted, and attached to every outgoing request.
 *
 * The plain token is NEVER returned to the caller — only used
 * inside this module for HTTP headers.
 */

const axios = require('axios');
const PostExIntegration = require('../models/PostExIntegration');
const { decryptPostExToken } = require('../utils/crypto');

const BASE = 'https://api.postex.pk/services/integration/api/order';

// ── Token resolution ─────────────────────────────────────────────────────────

/**
 * Load the integration record and return decrypted token.
 * Throws a descriptive error if the admin hasn't connected PostEx.
 */
async function resolveToken(ownerId, storeId) {
    const query = storeId
        ? { storeId, isConnected: true }
        : { $or: [{ ownerId }, { storeId: ownerId }], isConnected: true };
    const integration = await PostExIntegration
        .findOne(query)
        .select('+apiTokenEncrypted');

    if (!integration || !integration.apiTokenEncrypted) {
        throw new Error('PostEx is not connected for this account. Please add your API token in PostEx Settings.');
    }

    const token = decryptPostExToken(integration.apiTokenEncrypted);
    if (!token) {
        throw new Error('Failed to decrypt PostEx API token. Please reconnect your account.');
    }

    return token;
}

function buildHeaders(token) {
    return {
        'token': token,
        'Content-Type': 'application/json'
    };
}

// ── Retry helper ─────────────────────────────────────────────────────────────

async function withRetry(fn, retries = 2, delayMs = 1000) {
    try {
        return await fn();
    } catch (err) {
        // Don't retry auth errors or client errors
        const status = err.response?.status;
        if (status === 401 || status === 403 || status === 400) throw err;
        if (retries > 0) {
            await new Promise(r => setTimeout(r, delayMs));
            return withRetry(fn, retries - 1, delayMs * 2);
        }
        throw err;
    }
}

// ── Normalise PostEx response ─────────────────────────────────────────────────

function normalise(response) {
    // PostEx wraps data in `dist` and uses `statusCode` (string) for success
    return response.data;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Verify a raw (plain-text) token by calling the merchant addresses endpoint.
 * This confirms the token is valid and has access to merchant data.
 * @param {string} plainToken - raw PostEx API token
 */
exports.verifyToken = async (plainToken) => {
    return withRetry(async () => {
        const res = await axios.get(
            `${BASE}/v1/get-merchant-address`,
            { headers: buildHeaders(plainToken), timeout: 10000 }
        );
        return normalise(res);
    });
};

exports.getOperationalCities = async (ownerId) => {
    const token = await resolveToken(ownerId);
    return withRetry(async () => {
        const res = await axios.get(
            `${BASE}/v2/get-operational-city`,
            { headers: buildHeaders(token), timeout: 10000 }
        );
        const data = normalise(res);
        // Return array of city names from dist
        return data?.dist?.map(d => ({
            name: d.operationalCityName,
            code: d.operationalCityCode ?? d.operationalCityName
        })) || [];
    });
};

exports.getPickupAddresses = async (ownerId) => {
    const token = await resolveToken(ownerId);
    return withRetry(async () => {
        const res = await axios.get(
            `${BASE}/v1/get-merchant-address`,
            { headers: buildHeaders(token), timeout: 10000 }
        );
        return normalise(res)?.dist || [];
    });
};

exports.createPickupAddress = async (ownerId, payload) => {
    const token = await resolveToken(ownerId);
    return withRetry(async () => {
        const res = await axios.post(
            `${BASE}/v1/create-merchant-address`,
            payload,
            { headers: buildHeaders(token), timeout: 10000 }
        );
        return normalise(res);
    });
};

exports.getOrderTypes = async (ownerId) => {
    const token = await resolveToken(ownerId);
    return withRetry(async () => {
        const res = await axios.get(
            `${BASE}/v1/get-order-type`,
            { headers: buildHeaders(token), timeout: 10000 }
        );
        return normalise(res)?.dist || [];
    });
};

exports.createOrder = async (ownerId, payload) => {
    const token = await resolveToken(ownerId);
    return withRetry(async () => {
        const res = await axios.post(
            `${BASE}/v3/create-order`,
            payload,
            { headers: buildHeaders(token), timeout: 15000 }
        );
        return normalise(res);
    });
};

exports.trackOrder = async (ownerId, trackingNumber) => {
    const token = await resolveToken(ownerId);
    return withRetry(async () => {
        const res = await axios.get(
            `${BASE}/v1/track-order/${trackingNumber}`,
            { headers: buildHeaders(token), timeout: 10000 }
        );
        return normalise(res);
    });
};

exports.trackBulkOrders = async (ownerId, trackingNumbers) => {
    const token = await resolveToken(ownerId);
    return withRetry(async () => {
        const res = await axios.post(
            `${BASE}/v1/track-bulk-order`,
            { trackingNumber: trackingNumbers },
            { headers: buildHeaders(token), timeout: 15000 }
        );
        return normalise(res);
    });
};

exports.cancelOrder = async (ownerId, trackingNumber) => {
    const token = await resolveToken(ownerId);
    return withRetry(async () => {
        const res = await axios.put(
            `${BASE}/v1/cancel-order`,
            { trackingNumber },
            { headers: buildHeaders(token), timeout: 10000 }
        );
        return normalise(res);
    });
};

exports.getAirwayBillUrl = async (ownerId, trackingNumbers) => {
    const token = await resolveToken(ownerId);
    return withRetry(async () => {
        const nums = trackingNumbers.slice(0, 10); // PostEx limit: 10
        const res = await axios.get(
            `${BASE}/v1/getinvoice?trackingNumbers=${nums.join(',')}`,
            { headers: buildHeaders(token), timeout: 15000 }
        );
        return normalise(res);
    });
};

exports.generateLoadSheet = async (ownerId, trackingNumbers, pickupAddress) => {
    const token = await resolveToken(ownerId);
    return withRetry(async () => {
        const res = await axios.post(
            `${BASE}/v2/generate-load-sheet`,
            { trackingNumbers, pickupAddress },
            { headers: buildHeaders(token), responseType: 'arraybuffer', timeout: 20000 }
        );
        return res.data; // binary PDF
    });
};

exports.saveShipperAdvice = async (ownerId, trackingNumber, statusId, remarks) => {
    const token = await resolveToken(ownerId);
    return withRetry(async () => {
        const res = await axios.put(
            `${BASE}/v2/save-shipper-advice`,
            { trackingNumber, statusId, remarks },
            { headers: buildHeaders(token), timeout: 10000 }
        );
        return normalise(res);
    });
};

exports.getShipperAdvice = async (ownerId, trackingNumber) => {
    const token = await resolveToken(ownerId);
    return withRetry(async () => {
        const res = await axios.get(
            `${BASE}/v1/get-shipper-advice/${trackingNumber}`,
            { headers: buildHeaders(token), timeout: 10000 }
        );
        return normalise(res);
    });
};

exports.getPaymentStatus = async (ownerId, trackingNumber) => {
    const token = await resolveToken(ownerId);
    return withRetry(async () => {
        const res = await axios.get(
            `${BASE}/v1/payment-status/${trackingNumber}`,
            { headers: buildHeaders(token), timeout: 10000 }
        );
        return normalise(res);
    });
};

exports.getOrderStatus = async (ownerId, trackingNumber) => {
    const token = await resolveToken(ownerId);
    return withRetry(async () => {
        const res = await axios.get(
            `${BASE}/v1/get-order-status/${trackingNumber}`,
            { headers: buildHeaders(token), timeout: 10000 }
        );
        return normalise(res);
    });
};

exports.listOrders = async (ownerId, { statusId = 0, fromDate, toDate } = {}) => {
    const token = await resolveToken(ownerId);
    return withRetry(async () => {
        const res = await axios.get(
            `${BASE}/v1/get-all-order`,
            {
                headers: buildHeaders(token),
                params: { orderStatusID: statusId, fromDate, toDate },
                timeout: 15000
            }
        );
        return normalise(res);
    });
};
