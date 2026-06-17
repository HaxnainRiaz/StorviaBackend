const express = require('express');
const multer = require('multer');
const { protect } = require('../middleware/authMiddleware');
const { resolveActiveStore, requireStorePermission } = require('../middleware/storeMiddleware');
const managedStorefrontCtrl = require('../controllers/managedStorefrontController');

const router = express.Router();

// Multer memory storage configuration for asset replacements
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Protect all managed storefront routes
router.use(protect, resolveActiveStore, requireStorePermission('manage_storefront'));

router.get('/', (req, res, next) => {
    managedStorefrontCtrl.getStorefront(req, res, next);
});

// GET endpoints for editor
router.get('/preview', (req, res, next) => {
    managedStorefrontCtrl.getPreview(req, res, next);
});

router.get('/pages', (req, res, next) => {
    managedStorefrontCtrl.getPages(req, res, next);
});

router.get('/links', (req, res, next) => {
    managedStorefrontCtrl.getLinks(req, res, next);
});

router.patch('/links', (req, res, next) => {
    managedStorefrontCtrl.updateLinks(req, res, next);
});

router.get('/route-map', (req, res, next) => {
    managedStorefrontCtrl.getRouteMap(req, res, next);
});

router.post('/route-map/auto-generate', (req, res, next) => {
    managedStorefrontCtrl.autoGenerateRouteMap(req, res, next);
});

router.post('/route-map/validate', (req, res, next) => {
    managedStorefrontCtrl.validateRouteMap(req, res, next);
});

router.patch('/route-map/:id', (req, res, next) => {
    managedStorefrontCtrl.updateRouteMapItem(req, res, next);
});

router.get('/sections/:pageId', (req, res, next) => {
    managedStorefrontCtrl.getSections(req, res, next);
});

router.get('/colors', (req, res, next) => {
    managedStorefrontCtrl.getColors(req, res, next);
});

router.get('/navigation', (req, res, next) => {
    managedStorefrontCtrl.getNavigation(req, res, next);
});

router.get('/product-mapping', (req, res, next) => {
    managedStorefrontCtrl.getProductMapping(req, res, next);
});

router.get('/seo', (req, res, next) => {
    managedStorefrontCtrl.getSeo(req, res, next);
});

router.get('/images', (req, res, next) => {
    managedStorefrontCtrl.getImages(req, res, next);
});

// PATCH/POST update endpoints
router.patch('/section', (req, res, next) => {
    managedStorefrontCtrl.updateSection(req, res, next);
});

router.patch('/content', (req, res, next) => {
    managedStorefrontCtrl.updateContent(req, res, next);
});

router.patch('/image', upload.single('image'), (req, res, next) => {
    managedStorefrontCtrl.replaceImage(req, res, next);
});

router.patch('/images', (req, res, next) => {
    managedStorefrontCtrl.updateImages(req, res, next);
});

router.patch('/colors', (req, res, next) => {
    managedStorefrontCtrl.updateColors(req, res, next);
});

router.patch('/navigation', (req, res, next) => {
    managedStorefrontCtrl.updateNavigation(req, res, next);
});

router.patch('/product-mapping', (req, res, next) => {
    managedStorefrontCtrl.updateProductMapping(req, res, next);
});

router.patch('/seo', (req, res, next) => {
    managedStorefrontCtrl.updateSeo(req, res, next);
});

router.post('/publish', (req, res, next) => {
    managedStorefrontCtrl.publishStorefront(req, res, next);
});

router.post('/resync-schema', (req, res, next) => {
    managedStorefrontCtrl.resyncSchema(req, res, next);
});

router.get('/versions', (req, res, next) => {
    managedStorefrontCtrl.getVersions(req, res, next);
});

router.post('/versions/:id/restore', (req, res, next) => {
    managedStorefrontCtrl.restoreVersion(req, res, next);
});

router.post('/rollback/:id', (req, res, next) => {
    managedStorefrontCtrl.rollbackVersion(req, res, next);
});

module.exports = router;
