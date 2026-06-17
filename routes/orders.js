const express = require('express');
const orderController = require('../controllers/orderController');
const { protect, authorize, optional } = require('../middleware/authMiddleware');
const { resolveActiveStore, requireStorePermission } = require('../middleware/storeMiddleware');

const router = express.Router();
const storefrontOnly = (req, res) => res.status(410).json({
    success: false,
    message: 'Public checkout is store-scoped. Use /api/storefront/:storeSlug/orders.'
});

router.route('/')
    .post(storefrontOnly)
    .get(protect, resolveActiveStore, requireStorePermission('view_orders'), orderController.getOrders);

router.route('/myorders').get(protect, resolveActiveStore, requireStorePermission('view_orders'), orderController.getMyOrders);
router.route('/:id').get(protect, resolveActiveStore, requireStorePermission('view_orders'), orderController.getOrderById);
router.route('/:id/pay').put(protect, resolveActiveStore, requireStorePermission('mark_paid'), orderController.updateOrderToPaid);
router.route('/:id/status').put(protect, resolveActiveStore, requireStorePermission('edit_orders'), orderController.updateOrderStatus);

// Bulk actions
router.post('/bulk-cancel', protect, resolveActiveStore, requireStorePermission('cancel_orders'), orderController.bulkCancelOrders);
router.post('/bulk-update-payment', protect, resolveActiveStore, requireStorePermission('mark_paid'), orderController.bulkUpdatePaymentStatus);
router.patch('/:id', protect, resolveActiveStore, requireStorePermission('edit_orders'), orderController.updateOrderDetails);

module.exports = router;
