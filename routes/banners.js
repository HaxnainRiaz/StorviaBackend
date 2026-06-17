const express = require('express');
const { getBanners, createBanner, updateBanner, deleteBanner } = require('../controllers/bannerController');
const { protect, authorize } = require('../middleware/authMiddleware');
const { resolveActiveStore, requireStorePermission } = require('../middleware/storeMiddleware');

const router = express.Router();

router.route('/')
    .get(protect, resolveActiveStore, requireStorePermission('manage_storefront'), getBanners)
    .post(protect, resolveActiveStore, requireStorePermission('manage_storefront'), createBanner);

router.route('/:id')
    .put(protect, resolveActiveStore, requireStorePermission('manage_storefront'), updateBanner)
    .delete(protect, resolveActiveStore, requireStorePermission('manage_storefront'), deleteBanner);

module.exports = router;
