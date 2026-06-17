const express = require('express');
const { getReviews, updateReview, deleteReview, addReview, getProductReviews } = require('../controllers/reviewController');
const { protect, authorize, optional } = require('../middleware/authMiddleware');
const { resolveActiveStore, requireStorePermission } = require('../middleware/storeMiddleware');

const router = express.Router();
const storefrontOnly = (req, res) => res.status(410).json({
    success: false,
    message: 'Public review access is store-scoped. Use /api/storefront/:storeSlug/products/:productId/reviews.'
});

router.route('/product/:productId').get(storefrontOnly);

router.route('/')
    .get(protect, resolveActiveStore, requireStorePermission('manage_reviews'), getReviews)
    .post(storefrontOnly);

router.route('/:id')
    .put(protect, resolveActiveStore, requireStorePermission('manage_reviews'), updateReview)
    .delete(protect, resolveActiveStore, requireStorePermission('manage_reviews'), deleteReview);

module.exports = router;
