const express = require('express');
const router = express.Router();
const publicMetaController = require('../controllers/publicMetaController');
const { resolvePublicStore } = require('../middleware/storeMiddleware');

// Public route for webstore to fetch Pixel configuration
router.get('/config', publicMetaController.getMetaConfig);
router.get('/:storeSlug/config', resolvePublicStore, publicMetaController.getMetaConfig);

module.exports = router;
