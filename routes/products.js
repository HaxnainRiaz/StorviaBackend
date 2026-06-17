const express = require('express');
const {
    getProducts,
    getProduct,
    createProduct,
    updateProduct,
    deleteProduct
} = require('../controllers/productController');
const { protect, authorize } = require('../middleware/authMiddleware');
const { resolveActiveStore, requireStorePermission } = require('../middleware/storeMiddleware');

const router = express.Router();
const storefrontOnly = (req, res) => res.status(410).json({
    success: false,
    message: 'Public product access is store-scoped. Use /api/storefront/:storeSlug/products.'
});

router.route('/')
    .get(protect, resolveActiveStore, requireStorePermission('view_products'), getProducts)
    .post(protect, resolveActiveStore, requireStorePermission('create_products'), createProduct);

router.route('/:id')
    .get(protect, resolveActiveStore, requireStorePermission('view_products'), getProduct)
    .put(protect, resolveActiveStore, requireStorePermission('edit_products'), updateProduct)
    .delete(protect, resolveActiveStore, requireStorePermission('delete_products'), deleteProduct);

router.get('/public-disabled', storefrontOnly);

module.exports = router;
