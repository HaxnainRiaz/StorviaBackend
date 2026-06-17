const PostExIntegration = require('../models/PostExIntegration');
const { encryptPostExToken } = require('../utils/crypto');
const postexService = require('../services/postex.service');

// Helper: mask a token for safe display
function maskToken(token) {
    if (!token || token.length < 8) return '****';
    return token.substring(0, 6) + '...' + '****';
}

// GET /api/postex/status
exports.getStatus = async (req, res) => {
    try {
        const integration = await PostExIntegration.findOne(req.storeId ? { storeId: req.storeId } : { ownerId: req.user._id });
        if (!integration) {
            return res.json({ success: true, data: { isConnected: false, connectionStatus: 'disconnected' } });
        }
        res.json({
            success: true,
            data: {
                isConnected: integration.isConnected,
                connectionStatus: integration.connectionStatus,
                merchantName: integration.merchantName,
                apiTokenMasked: integration.apiTokenMasked,
                defaultPickupAddressCode: integration.defaultPickupAddressCode,
                defaultStoreAddressCode: integration.defaultStoreAddressCode,
                lastVerifiedAt: integration.lastVerifiedAt,
                lastErrorMessage: integration.lastErrorMessage,
                createdAt: integration.createdAt,
                updatedAt: integration.updatedAt
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// POST /api/postex/connect
exports.connect = async (req, res) => {
    try {
        const { apiToken } = req.body;
        if (!apiToken || apiToken.trim().length < 10) {
            return res.status(400).json({ success: false, message: 'A valid PostEx API token is required.' });
        }
        const plain = apiToken.trim();

        // Verify token with PostEx before saving
        let verifyResult;
        try {
            verifyResult = await postexService.verifyToken(plain);
        } catch (verifyErr) {
            const msg = verifyErr.response?.data?.statusMessage || verifyErr.message || 'Invalid PostEx token';
                let integration = await PostExIntegration.findOne(req.storeId ? { storeId: req.storeId } : { ownerId: req.user._id });
            if (integration) {
                integration.isConnected = false;
                integration.connectionStatus = 'invalid_token';
                integration.lastErrorMessage = msg;
                await integration.save();
            }
            return res.status(422).json({ success: false, message: `Token verification failed: ${msg}` });
        }

        // Token is valid — encrypt and save
        const encrypted = encryptPostExToken(plain);
        const masked = maskToken(plain);

        const integration = await PostExIntegration.findOneAndUpdate(
            req.storeId ? { storeId: req.storeId } : { ownerId: req.user._id },
            {
                ownerId: req.user._id,
                ...(req.storeId && { storeId: req.storeId }),
                isConnected: true,
                connectionStatus: 'connected',
                apiTokenEncrypted: encrypted,
                apiTokenMasked: masked,
                lastVerifiedAt: new Date(),
                lastErrorMessage: null
            },
            { upsert: true, new: true }
        );

        res.json({
            success: true,
            message: 'PostEx account connected successfully.',
            data: {
                isConnected: true,
                connectionStatus: 'connected',
                apiTokenMasked: masked,
                lastVerifiedAt: integration.lastVerifiedAt
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// DELETE /api/postex/disconnect
exports.disconnect = async (req, res) => {
    try {
        await PostExIntegration.findOneAndUpdate(
            req.storeId ? { storeId: req.storeId } : { ownerId: req.user._id },
            {
                isConnected: false,
                connectionStatus: 'disconnected',
                apiTokenEncrypted: null,
                apiTokenMasked: null,
                lastVerifiedAt: null
            }
        );
        res.json({ success: true, message: 'PostEx account disconnected.' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// PUT /api/postex/defaults
exports.saveDefaults = async (req, res) => {
    try {
        const { defaultPickupAddressCode, defaultStoreAddressCode } = req.body;
        const integration = await PostExIntegration.findOneAndUpdate(
            req.storeId ? { storeId: req.storeId } : { ownerId: req.user._id },
            { defaultPickupAddressCode, defaultStoreAddressCode },
            { new: true }
        );
        if (!integration) return res.status(404).json({ success: false, message: 'No PostEx integration found.' });
        res.json({ success: true, message: 'Default addresses saved.', data: { defaultPickupAddressCode, defaultStoreAddressCode } });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};
