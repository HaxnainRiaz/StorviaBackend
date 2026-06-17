const express = require('express');
const router = express.Router();
const metaController = require('../controllers/metaController');
const { protect, authorize } = require('../middleware/authMiddleware');
const { resolveActiveStore, requireStorePermission } = require('../middleware/storeMiddleware');

// Public/Meta-facing routes (NO AUTH)
router.get('/oauth/callback', metaController.oauthCallback);

// Protected Admin routes
router.use(protect);
router.use(resolveActiveStore);
router.use(requireStorePermission('manage_meta'));

router.get('/status', metaController.getMetaStatus);
router.get('/permissions', metaController.getPermissions);
router.get('/oauth/start', metaController.startOAuth); // NEW: Explicit start route

router.post('/settings', metaController.saveMetaSettings);
router.post('/manual-pixel', metaController.saveManualPixel);
router.post('/capi-token', metaController.saveCapiToken);
router.get('/event-logs', metaController.getEventLogs);
router.post('/test-event', metaController.testEvent);
router.post('/disconnect', metaController.disconnectMeta);

// Asset Management
router.get('/businesses', metaController.getBusinesses);
router.get('/ad-accounts/:businessId', metaController.getAdAccounts);
router.get('/pixels', metaController.getPixels);
router.get('/pages', metaController.getPages);

// Step-by-step Setup
router.post('/select-business', metaController.selectBusiness);
router.post('/select-ad-account', metaController.selectAdAccount);
router.post('/select-pixel', metaController.selectPixel);
router.post('/select-page', metaController.selectPage);

// Queue Processing & Retrying
router.post('/process-pending', metaController.processPending);
router.post('/retry/:logId', metaController.retryLog);
router.post('/retry-all', metaController.retryAll);

module.exports = router;
