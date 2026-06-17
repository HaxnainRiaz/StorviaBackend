const express = require('express');
const { getCoupons, createCoupon, updateCoupon, deleteCoupon, validateCoupon } = require('../controllers/couponController');
const { protect, authorize } = require('../middleware/authMiddleware');
const { resolveActiveStore, requireStorePermission } = require('../middleware/storeMiddleware');

const router = express.Router();
const storefrontOnly = (req, res) => res.status(410).json({
    success: false,
    message: 'Coupon validation is store-scoped. Use /api/storefront/:storeSlug/coupons/validate.'
});

router.get('/validate/:code', storefrontOnly);
router.get('/', protect, resolveActiveStore, requireStorePermission('manage_coupons'), getCoupons);
router.post('/', protect, resolveActiveStore, requireStorePermission('manage_coupons'), createCoupon);
router.put('/:id', protect, resolveActiveStore, requireStorePermission('manage_coupons'), updateCoupon);
router.delete('/:id', protect, resolveActiveStore, requireStorePermission('manage_coupons'), deleteCoupon);

module.exports = router;
