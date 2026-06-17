const express = require('express');
const { getSettings, updateSettings } = require('../controllers/settingsController');
const { protect, authorize } = require('../middleware/authMiddleware');
const { resolveActiveStore, requireStorePermission } = require('../middleware/storeMiddleware');

const router = express.Router();

router.route('/')
    .get(protect, resolveActiveStore, requireStorePermission('manage_settings'), getSettings)
    .put(protect, resolveActiveStore, requireStorePermission('manage_settings'), updateSettings);

module.exports = router;
