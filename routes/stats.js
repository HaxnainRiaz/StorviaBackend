const express = require('express');
const { getDashboardStats, getRevenueProgress } = require('../controllers/statsController');
const { protect, authorize } = require('../middleware/authMiddleware');
const { resolveActiveStore, requireStorePermission } = require('../middleware/storeMiddleware');

const router = express.Router();

router.get('/dashboard', protect, resolveActiveStore, requireStorePermission('view_dashboard'), getDashboardStats);
router.get('/progress', protect, resolveActiveStore, requireStorePermission('view_analytics'), getRevenueProgress);

module.exports = router;
