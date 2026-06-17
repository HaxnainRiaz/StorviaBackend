const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const { resolveActiveStore, requireStorePermission, blockSellingIfStorePaused } = require('../middleware/storeMiddleware');
const storeCtrl = require('../controllers/storeController');
const productCtrl = require('../controllers/productController');
const categoryCtrl = require('../controllers/categoryController');
const couponCtrl = require('../controllers/couponController');
const orderCtrl = require('../controllers/orderController');
const reviewCtrl = require('../controllers/reviewController');
const supportCtrl = require('../controllers/supportTicketController');
const bannerCtrl = require('../controllers/bannerController');
const seoCtrl = require('../controllers/seoController');
const statsCtrl = require('../controllers/statsController');
const auditCtrl = require('../controllers/auditController');
const postexIntegrationCtrl = require('../controllers/postexIntegrationController');
const postexShippingCtrl = require('../controllers/postexShippingController');
const metaCtrl = require('../controllers/metaController');

const router = express.Router();

router.use(protect, resolveActiveStore);

router.get('/store/setup-status', storeCtrl.getSetupStatus);
router.patch('/store/setup-step', requireStorePermission('manage_settings'), storeCtrl.updateSetupStep);
router.post('/store/publish', requireStorePermission('publish_store'), storeCtrl.publishStore);
router.post('/store/pause', requireStorePermission('manage_settings'), storeCtrl.pauseStore);
router.post('/store/resume', requireStorePermission('manage_settings'), storeCtrl.resumeStore);

router.get('/storefront/overview', requireStorePermission('manage_storefront'), storeCtrl.getStorefrontOverview);
router.get('/storefront/theme', requireStorePermission('manage_storefront'), storeCtrl.getTheme);
router.patch('/storefront/theme', requireStorePermission('manage_storefront'), storeCtrl.updateTheme);
router.get('/storefront/sections', requireStorePermission('manage_storefront'), storeCtrl.getSections);
router.post('/storefront/sections', requireStorePermission('manage_storefront'), storeCtrl.createSection);
router.patch('/storefront/sections/reorder', requireStorePermission('manage_storefront'), storeCtrl.reorderSections);
router.patch('/storefront/sections/:id', requireStorePermission('manage_storefront'), storeCtrl.updateSection);
router.delete('/storefront/sections/:id', requireStorePermission('manage_storefront'), storeCtrl.deleteSection);
router.get('/storefront/navigation', requireStorePermission('manage_storefront'), storeCtrl.getNavigation);
router.patch('/storefront/navigation', requireStorePermission('manage_storefront'), storeCtrl.updateNavigation);
router.get('/storefront/pages', requireStorePermission('manage_storefront'), storeCtrl.getPages);
router.post('/storefront/pages', requireStorePermission('manage_storefront'), storeCtrl.createPage);
router.patch('/storefront/pages/:id', requireStorePermission('manage_storefront'), storeCtrl.updatePage);
router.delete('/storefront/pages/:id', requireStorePermission('manage_storefront'), storeCtrl.deletePage);
router.get('/storefront/preview', requireStorePermission('manage_storefront'), storeCtrl.previewStorefront);
router.post('/storefront/publish', requireStorePermission('publish_storefront'), storeCtrl.publishStorefront);
router.post('/storefront/revert/:versionId', requireStorePermission('publish_storefront'), storeCtrl.revertStorefront);

router.get('/products', requireStorePermission('view_products'), productCtrl.getProducts);
router.get('/products/:id', requireStorePermission('view_products'), productCtrl.getProduct);
router.post('/products', requireStorePermission('create_products'), blockSellingIfStorePaused, productCtrl.createProduct);
router.patch('/products/bulk', requireStorePermission('edit_products'), productCtrl.bulkUpdateProducts);
router.patch('/products/:id/status', requireStorePermission('edit_products'), productCtrl.updateProduct);
router.patch('/products/:id', requireStorePermission('edit_products'), productCtrl.updateProduct);
router.delete('/products/:id', requireStorePermission('delete_products'), productCtrl.deleteProduct);

router.get('/categories', requireStorePermission('view_products'), categoryCtrl.getCategories);
router.post('/categories', requireStorePermission('create_products'), categoryCtrl.createCategory);
router.patch('/categories/:id', requireStorePermission('edit_products'), categoryCtrl.updateCategory);
router.delete('/categories/:id', requireStorePermission('delete_products'), categoryCtrl.deleteCategory);
router.get('/collections', requireStorePermission('view_products'), storeCtrl.getCollections);
router.post('/collections', requireStorePermission('create_products'), storeCtrl.createCollection);
router.patch('/collections/:id', requireStorePermission('edit_products'), storeCtrl.updateCollection);
router.delete('/collections/:id', requireStorePermission('delete_products'), storeCtrl.deleteCollection);

router.get('/inventory', requireStorePermission('view_products'), storeCtrl.getInventory);
router.get('/inventory/low-stock', requireStorePermission('view_products'), storeCtrl.getLowStock);
router.get('/inventory/history/:productId', requireStorePermission('view_products'), storeCtrl.getInventoryHistory);
router.patch('/inventory/:productId', requireStorePermission('edit_products'), storeCtrl.updateInventory);

router.get('/orders', requireStorePermission('view_orders'), orderCtrl.getOrders);
router.get('/orders/:id', requireStorePermission('view_orders'), orderCtrl.getOrderById);
router.patch('/orders/:id/status', requireStorePermission('edit_orders'), orderCtrl.updateOrderStatus);
router.patch('/orders/:id/payment', requireStorePermission('mark_paid'), orderCtrl.updateOrderToPaid);
router.patch('/orders/:id', requireStorePermission('edit_orders'), orderCtrl.updateOrderDetails);
router.post('/orders/bulk-cancel', requireStorePermission('cancel_orders'), orderCtrl.bulkCancelOrders);
router.post('/orders/bulk-payment-status', requireStorePermission('mark_paid'), orderCtrl.bulkUpdatePaymentStatus);

router.get('/customers', requireStorePermission('view_orders'), storeCtrl.getCustomers);
router.get('/customers/:id', requireStorePermission('view_orders'), storeCtrl.getCustomer);
router.patch('/customers/:id/status', requireStorePermission('edit_orders'), storeCtrl.updateCustomer);
router.patch('/customers/:id', requireStorePermission('edit_orders'), storeCtrl.updateCustomer);
router.delete('/customers/:id', requireStorePermission('manage_settings'), storeCtrl.deleteCustomer);

router.get('/coupons', requireStorePermission('manage_coupons'), couponCtrl.getCoupons);
router.post('/coupons', requireStorePermission('manage_coupons'), couponCtrl.createCoupon);
router.patch('/coupons/:id', requireStorePermission('manage_coupons'), couponCtrl.updateCoupon);
router.delete('/coupons/:id', requireStorePermission('manage_coupons'), couponCtrl.deleteCoupon);

router.get('/shipping/settings', requireStorePermission('manage_settings'), storeCtrl.getShippingSettings);
router.patch('/shipping/settings', requireStorePermission('manage_settings'), storeCtrl.updateShippingSettings);
router.get('/payments/settings', requireStorePermission('manage_payments'), storeCtrl.getPaymentSettings);
router.patch('/payments/settings', requireStorePermission('manage_payments'), storeCtrl.updatePaymentSettings);

router.get('/reviews', requireStorePermission('manage_reviews'), reviewCtrl.getReviews);
router.patch('/reviews/:id/approve', requireStorePermission('manage_reviews'), (req, res, next) => { req.body.status = 'approved'; next(); }, reviewCtrl.updateReview);
router.patch('/reviews/:id/reject', requireStorePermission('manage_reviews'), (req, res, next) => { req.body.status = 'rejected'; next(); }, reviewCtrl.updateReview);
router.post('/reviews/:id/reply', requireStorePermission('manage_reviews'), reviewCtrl.updateReview);
router.delete('/reviews/:id', requireStorePermission('manage_reviews'), reviewCtrl.deleteReview);

router.get('/support/tickets', requireStorePermission('manage_support'), supportCtrl.getTickets);
router.get('/support/tickets/:id', requireStorePermission('manage_support'), async (req, res) => {
    const SupportTicket = require('../models/SupportTicket');
    const ticket = await SupportTicket.findOne({ _id: req.params.id, storeId: req.storeId });
    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });
    res.json({ success: true, data: ticket });
});
router.patch('/support/tickets/:id/status', requireStorePermission('manage_support'), supportCtrl.updateTicket);
router.post('/support/tickets/:id/reply', requireStorePermission('manage_support'), supportCtrl.addReply);
router.delete('/support/tickets/:id', requireStorePermission('manage_support'), supportCtrl.deleteTicket);

router.get('/banners', requireStorePermission('manage_storefront'), bannerCtrl.getBanners);
router.post('/banners', requireStorePermission('manage_storefront'), bannerCtrl.createBanner);
router.patch('/banners/:id', requireStorePermission('manage_storefront'), bannerCtrl.updateBanner);
router.delete('/banners/:id', requireStorePermission('manage_storefront'), bannerCtrl.deleteBanner);

router.get('/seo/overview', requireStorePermission('manage_seo'), seoCtrl.getSEO);
router.get('/seo/audit', requireStorePermission('manage_seo'), seoCtrl.auditSEO);
router.get('/seo/preview/:entityType/:entityId', requireStorePermission('manage_seo'), seoCtrl.getSEO);
router.get('/seo/:entityType/:entityId', requireStorePermission('manage_seo'), (req, res, next) => { req.query.entityType = req.params.entityType; req.query.entityId = req.params.entityId; next(); }, seoCtrl.getSEO);
router.put('/seo/:entityType/:entityId', requireStorePermission('manage_seo'), (req, res, next) => { req.body.entityType = req.params.entityType; req.body.entityId = req.params.entityId; next(); }, seoCtrl.updateSEO);

router.get('/dashboard/stats', requireStorePermission('view_dashboard'), statsCtrl.getDashboardStats);
router.get('/analytics/revenue', requireStorePermission('view_analytics'), statsCtrl.getRevenueProgress);
router.get('/analytics/products', requireStorePermission('view_analytics'), storeCtrl.getInventory);
router.get('/analytics/customers', requireStorePermission('view_analytics'), storeCtrl.getCustomers);
router.get('/analytics/orders', requireStorePermission('view_analytics'), orderCtrl.getOrders);
router.get('/analytics/seo', requireStorePermission('view_analytics'), seoCtrl.auditSEO);
router.get('/analytics/meta', requireStorePermission('view_analytics'), metaCtrl.getMetaStatus);

router.get('/staff', requireStorePermission('manage_staff'), storeCtrl.listStaff);
router.post('/staff/invite', requireStorePermission('manage_staff'), storeCtrl.inviteStaff);
router.patch('/staff/:id', requireStorePermission('manage_staff'), storeCtrl.updateStaff);
router.patch('/staff/:id/permissions', requireStorePermission('manage_staff'), storeCtrl.updateStaffPermissions);
router.delete('/staff/:id', requireStorePermission('manage_staff'), storeCtrl.deleteStaff);

router.get('/media', requireStorePermission('manage_storefront'), storeCtrl.getMedia);
router.delete('/media/:id', requireStorePermission('manage_storefront'), storeCtrl.deleteMedia);

router.get('/notifications', storeCtrl.getNotifications);
router.get('/audit-logs', requireStorePermission('view_audit_logs'), auditCtrl.getAuditLogs);

router.get('/postex/status', requireStorePermission('manage_delivery'), postexIntegrationCtrl.getStatus);
router.post('/postex/connect', requireStorePermission('manage_delivery'), postexIntegrationCtrl.connect);
router.delete('/postex/disconnect', requireStorePermission('manage_delivery'), postexIntegrationCtrl.disconnect);
router.put('/postex/defaults', requireStorePermission('manage_delivery'), postexIntegrationCtrl.saveDefaults);
router.get('/postex/cities', requireStorePermission('manage_delivery'), postexShippingCtrl.getCities);
router.get('/postex/pickup-addresses', requireStorePermission('manage_delivery'), postexShippingCtrl.getPickupAddresses);
router.post('/postex/pickup-addresses', requireStorePermission('manage_delivery'), postexShippingCtrl.createPickupAddress);
router.get('/postex/order-types', requireStorePermission('manage_delivery'), postexShippingCtrl.getOrderTypes);
router.post('/postex/create-shipment', requireStorePermission('manage_delivery'), postexShippingCtrl.createShipment);
router.get('/postex/shipments', requireStorePermission('manage_delivery'), postexShippingCtrl.getShipments);
router.get('/postex/track/:trackingNumber', requireStorePermission('manage_delivery'), postexShippingCtrl.trackSingle);
router.post('/postex/track-bulk', requireStorePermission('manage_delivery'), postexShippingCtrl.trackBulk);
router.post('/postex/sync-tracking', requireStorePermission('manage_delivery'), postexShippingCtrl.syncTracking);
router.put('/postex/cancel/:trackingNumber', requireStorePermission('manage_delivery'), postexShippingCtrl.cancelShipment);
router.get('/postex/payment-status/:trackingNumber', requireStorePermission('manage_delivery'), postexShippingCtrl.getPaymentStatus);
router.post('/postex/load-sheet', requireStorePermission('manage_delivery'), postexShippingCtrl.generateLoadSheet);
router.get('/postex/invoice', requireStorePermission('manage_delivery'), postexShippingCtrl.getInvoice);
router.get('/postex/all-orders', requireStorePermission('manage_delivery'), postexShippingCtrl.getAllOrders);
router.put('/postex/shipper-advice', requireStorePermission('manage_delivery'), postexShippingCtrl.saveShipperAdvice);
router.get('/postex/failed-logs', requireStorePermission('manage_delivery'), postexShippingCtrl.getFailedLogs);

router.get('/meta/status', requireStorePermission('manage_meta'), metaCtrl.getMetaStatus);
router.get('/meta/permissions', requireStorePermission('manage_meta'), metaCtrl.getPermissions);
router.get('/meta/oauth/start', requireStorePermission('manage_meta'), metaCtrl.startOAuth);
router.post('/meta/settings', requireStorePermission('manage_meta'), metaCtrl.saveMetaSettings);
router.post('/meta/manual-pixel', requireStorePermission('manage_meta'), metaCtrl.saveManualPixel);
router.post('/meta/capi-token', requireStorePermission('manage_meta'), metaCtrl.saveCapiToken);
router.get('/meta/event-logs', requireStorePermission('manage_meta'), metaCtrl.getEventLogs);
router.post('/meta/test-event', requireStorePermission('manage_meta'), metaCtrl.testEvent);
router.post('/meta/disconnect', requireStorePermission('manage_meta'), metaCtrl.disconnectMeta);
router.get('/meta/businesses', requireStorePermission('manage_meta'), metaCtrl.getBusinesses);
router.get('/meta/ad-accounts/:businessId', requireStorePermission('manage_meta'), metaCtrl.getAdAccounts);
router.get('/meta/pixels', requireStorePermission('manage_meta'), metaCtrl.getPixels);
router.get('/meta/pages', requireStorePermission('manage_meta'), metaCtrl.getPages);
router.post('/meta/select-business', requireStorePermission('manage_meta'), metaCtrl.selectBusiness);
router.post('/meta/select-ad-account', requireStorePermission('manage_meta'), metaCtrl.selectAdAccount);
router.post('/meta/select-pixel', requireStorePermission('manage_meta'), metaCtrl.selectPixel);
router.post('/meta/select-page', requireStorePermission('manage_meta'), metaCtrl.selectPage);
router.post('/meta/process-pending', requireStorePermission('manage_meta'), metaCtrl.processPending);
router.post('/meta/retry/:logId', requireStorePermission('manage_meta'), metaCtrl.retryLog);
router.post('/meta/retry-all', requireStorePermission('manage_meta'), metaCtrl.retryAll);

module.exports = router;
