const express = require('express');
const router = express.Router();
const { optional } = require('../middleware/authMiddleware');
const { queueMetaEvent } = require('../services/metaQueueService');
const { resolvePublicStore } = require('../middleware/storeMiddleware');

/**
 * @route   POST /api/tracking/meta/event
 * @desc    Receives a client-side Meta event tracking beacon, enriches it, and queues it for CAPI.
 * @access  Public (Optionally authenticated)
 */
const handleMetaEvent = async (req, res) => {
    try {
        const {
            eventName,
            eventId,
            eventSourceUrl,
            userData = {},
            customData = {},
            orderId
        } = req.body;

        if (!eventName || !eventId) {
            return res.status(400).json({
                success: false,
                message: 'eventName and eventId are required parameters'
            });
        }

        // 1. Gather client context
        const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
        const clientUserAgent = req.headers['user-agent'];

        // Clean client IP (remove ipv6 wrapper if needed or multiple proxy ips)
        let resolvedIp = clientIp;
        if (resolvedIp && resolvedIp.includes(',')) {
            resolvedIp = resolvedIp.split(',')[0].trim();
        }
        if (resolvedIp === '::1') {
            resolvedIp = '127.0.0.1';
        }

        // 2. Enrich using authenticated user details if logged in
        const enrichedUserData = {
            ...userData,
            clientIpAddress: resolvedIp,
            clientUserAgent
        };

        if (req.user) {
            if (!enrichedUserData.email && req.user.email) {
                enrichedUserData.email = req.user.email;
            }
            if (!enrichedUserData.phone && req.user.phone) {
                enrichedUserData.phone = req.user.phone;
            }
            if (!enrichedUserData.firstName && req.user.firstName) {
                enrichedUserData.firstName = req.user.firstName;
            }
            if (!enrichedUserData.lastName && req.user.lastName) {
                enrichedUserData.lastName = req.user.lastName;
            }
            // Always set external_id to the user's Mongo ID string
            if (!enrichedUserData.externalId && req.user._id) {
                enrichedUserData.externalId = String(req.user._id);
            }
        }

        // 3. Queue the event asynchronously
        const queueResult = await queueMetaEvent({
            storeId: req.storeId,
            eventName,
            eventId,
            orderId,
            eventSourceUrl: eventSourceUrl || req.headers.referer,
            userData: enrichedUserData,
            customData
        });

        if (!queueResult.success) {
            return res.status(500).json({
                success: false,
                message: queueResult.error || 'Failed to queue event'
            });
        }

        // Respond immediately with 202 Accepted (< 300ms SLA achieved)
        return res.status(202).json({
            success: true,
            message: 'Event queued successfully for server transmission',
            eventId
        });

    } catch (error) {
        console.error('[Tracking Endpoint Error]:', error.message);
        return res.status(500).json({
            success: false,
            message: error.message || 'Internal Server Error'
        });
    }
};

router.post('/meta/event', (req, res) => res.status(410).json({
    success: false,
    message: 'Tracking events are store-scoped. Use /api/tracking/:storeSlug/meta/event.'
}));
router.post('/:storeSlug/meta/event', resolvePublicStore, optional, handleMetaEvent);

module.exports = router;
