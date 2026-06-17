const express = require('express');
const { getSEO, updateSEO } = require('../controllers/seoController');
const { protect, authorize } = require('../middleware/authMiddleware');
const { resolveActiveStore, requireStorePermission } = require('../middleware/storeMiddleware');

const router = express.Router();

router.route('/')
    .get(protect, resolveActiveStore, requireStorePermission('manage_seo'), getSEO)
    .post(protect, resolveActiveStore, requireStorePermission('manage_seo'), updateSEO);

module.exports = router;
