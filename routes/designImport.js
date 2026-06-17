const express = require('express');
const multer = require('multer');
const { protect } = require('../middleware/authMiddleware');
const { resolveActiveStore, requireStorePermission } = require('../middleware/storeMiddleware');
const designImportCtrl = require('../controllers/designImportController');

const router = express.Router();

// Multer memory storage configuration for ZIP uploads
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: 20 * 1024 * 1024 } // 20MB limit
});

// ─── Public preview endpoint (token-based, no auth middleware needed) ─────────
// Must be BEFORE the protect middleware to allow iframe access
router.get('/preview/:id*', (req, res, next) => {
    designImportCtrl.getRawPreviewWithToken(req, res, next);
});

// Protect all design import routes
router.use(protect, resolveActiveStore, requireStorePermission('manage_storefront'));

// Design Import Actions
router.post('/upload', upload.single('designPackage'), (req, res, next) => {
    designImportCtrl.uploadDesign(req, res, next);
});

router.get('/', (req, res, next) => {
    designImportCtrl.listImports(req, res, next);
});

router.get('/:id', (req, res, next) => {
    designImportCtrl.getImport(req, res, next);
});

router.post('/:id/scan', (req, res, next) => {
    designImportCtrl.scanImport(req, res, next);
});

router.post('/:id/convert', (req, res, next) => {
    designImportCtrl.convertImport(req, res, next);
});

// Wildcard route to match raw preview paths relative to index.html
router.get('/:id/raw-preview*', (req, res, next) => {
    designImportCtrl.getRawPreview(req, res, next);
});

// Generate short-lived preview token for iframe use
router.get('/:id/preview-token', (req, res, next) => {
    designImportCtrl.generatePreviewToken(req, res, next);
});

router.get('/:id/converted-preview', (req, res, next) => {
    designImportCtrl.getConvertedPreview(req, res, next);
});

router.patch('/:id/mapping', (req, res, next) => {
    designImportCtrl.updateMapping(req, res, next);
});

router.post('/:id/publish', (req, res, next) => {
    designImportCtrl.publishImport(req, res, next);
});

router.delete('/:id', (req, res, next) => {
    designImportCtrl.deleteImport(req, res, next);
});

module.exports = router;
