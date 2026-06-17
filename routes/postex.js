const express = require('express');
const { protect, authorize } = require('../middleware/authMiddleware');
const { resolveActiveStore, requireStorePermission } = require('../middleware/storeMiddleware');
const integrationCtrl = require('../controllers/postexIntegrationController');
const shippingCtrl    = require('../controllers/postexShippingController');

const router = express.Router();
const admin  = [protect, resolveActiveStore, requireStorePermission('manage_delivery')];

// ── Integration (connect / status) ──────────────────────────────────────────
router.get   ('/status',       ...admin, integrationCtrl.getStatus);
router.post  ('/connect',      ...admin, integrationCtrl.connect);
router.delete('/disconnect',   ...admin, integrationCtrl.disconnect);
router.put   ('/defaults',     ...admin, integrationCtrl.saveDefaults);

// ── Reference data ────────────────────────────────────────────────────────────
router.get('/cities',           ...admin, shippingCtrl.getCities);
router.get('/pickup-addresses', ...admin, shippingCtrl.getPickupAddresses);
router.post('/pickup-addresses',...admin, shippingCtrl.createPickupAddress);
router.get('/order-types',      ...admin, shippingCtrl.getOrderTypes);

// ── Shipment CRUD ─────────────────────────────────────────────────────────────
router.post('/create-shipment', ...admin, shippingCtrl.createShipment);
router.get ('/shipments',       ...admin, shippingCtrl.getShipments);

// ── Tracking ──────────────────────────────────────────────────────────────────
router.get ('/track/:trackingNumber', ...admin, shippingCtrl.trackSingle);
router.post('/track-bulk',            ...admin, shippingCtrl.trackBulk);
router.post('/sync-tracking',         ...admin, shippingCtrl.syncTracking);

// ── Cancel ───────────────────────────────────────────────────────────────────
router.put('/cancel/:trackingNumber', ...admin, shippingCtrl.cancelShipment);

// ── Payment & documents ───────────────────────────────────────────────────────
router.get ('/payment-status/:trackingNumber', ...admin, shippingCtrl.getPaymentStatus);
router.post('/load-sheet',                     ...admin, shippingCtrl.generateLoadSheet);
router.get ('/invoice',                        ...admin, shippingCtrl.getInvoice);
router.get ('/all-orders',                     ...admin, shippingCtrl.getAllOrders);

// ── Misc ─────────────────────────────────────────────────────────────────────
router.put('/shipper-advice', ...admin, shippingCtrl.saveShipperAdvice);
router.get('/failed-logs',    ...admin, shippingCtrl.getFailedLogs);

module.exports = router;
