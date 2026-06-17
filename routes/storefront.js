const express = require('express');
const path = require('path');
const fs = require('fs');
const { resolvePublicStore, optionalStorefrontUser } = require('../middleware/storeMiddleware');
const storefront = require('../controllers/storefrontController');
const ManagedStorefront = require('../models/ManagedStorefront');
const StorefrontAsset = require('../models/StorefrontAsset');
const { applyRouteMapToSchema } = require('../utils/storefrontRouteMap');

const router = express.Router();

router.use('/:storeSlug', resolvePublicStore);

router.get('/:storeSlug', storefront.getStorefront);
router.get('/:storeSlug/theme', storefront.getTheme);
router.get('/:storeSlug/sections', storefront.getSections);
router.get('/:storeSlug/navigation', storefront.getNavigation);
router.get('/:storeSlug/products', storefront.getProducts);
router.get('/:storeSlug/products/:productSlug', storefront.getProduct);
router.get('/:storeSlug/categories', storefront.getCategories);
router.get('/:storeSlug/collections/:collectionSlug', storefront.getCollection);
router.get('/:storeSlug/pages/:pageSlug', storefront.getPage);
router.post('/:storeSlug/orders', optionalStorefrontUser, storefront.createOrder);
router.get('/:storeSlug/order-tracking', storefront.trackOrder);
router.get('/:storeSlug/customer/orders', storefront.getCustomerOrders);
router.post('/:storeSlug/coupons/validate', storefront.validateCoupon);
router.get('/:storeSlug/banners', storefront.getBanners);
router.post('/:storeSlug/support/tickets', optionalStorefrontUser, storefront.createSupportTicket);
router.get('/:storeSlug/support/tickets/:id', storefront.getSupportTicket);
router.post('/:storeSlug/products/:productId/reviews', optionalStorefrontUser, storefront.addReview);
router.get('/:storeSlug/products/:productId/reviews', storefront.getProductReviews);
router.get('/:storeSlug/meta/pixel-config', storefront.getPixelConfig);
router.post('/:storeSlug/tracking/meta-event', optionalStorefrontUser, storefront.queueMetaEvent);
router.get('/:storeSlug/shipping/options', storefront.getShippingOptions);
router.get('/:storeSlug/payments/options', storefront.getPaymentOptions);
router.get('/:storeSlug/sitemap.xml', storefront.getSitemap);
router.get('/:storeSlug/robots.txt', storefront.getRobots);
router.get('/:storeSlug/seo/:entityType/:slug', storefront.getSeoPayload);
router.get('/:storeSlug/route-map', async (req, res) => {
    try {
        const managed = await ManagedStorefront.findOne({ storeId: req.storeId }).lean();
        const isPreview = req.storePreview || req.query.preview === 'true';
        const schema = isPreview ? managed?.draftSchema : managed?.publishedSchema;
        if (!schema) {
            return res.status(200).json({ success: true, data: [] });
        }
        const normalizedSchema = applyRouteMapToSchema(JSON.parse(JSON.stringify(schema)), req.store?.storeSlug || req.params.storeSlug);
        res.status(200).json({ success: true, data: normalizedSchema.routeMap || [] });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.get('/:storeSlug/page/:pageSlug', async (req, res) => {
    try {
        const managed = await ManagedStorefront.findOne({ storeId: req.storeId }).lean();
        const isPreview = req.storePreview || req.query.preview === 'true';
        const schema = isPreview ? managed?.draftSchema : managed?.publishedSchema;
        if (!schema?.pages?.length) {
            return res.status(404).json({ success: false, message: 'Page not found' });
        }
        const requested = String(req.params.pageSlug || '').toLowerCase();
        const page = schema.pages.find((p) =>
            String(p.slug || '').toLowerCase() === requested ||
            String(p.id || '').toLowerCase() === requested ||
            String(p.fileName || '').toLowerCase().replace(/\.html$/, '') === requested
        );
        if (!page) {
            return res.status(404).json({ success: false, message: 'Page not found' });
        }
        res.status(200).json({ success: true, data: page });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Managed Storefront Schema - served to public renderer
router.get('/:storeSlug/render-schema', async (req, res) => {
    try {
        const managed = await ManagedStorefront.findOne({ storeId: req.storeId }).lean();
        const isPreview = req.storePreview || req.query.preview === 'true';
        const schema = isPreview ? managed?.draftSchema : managed?.publishedSchema;
        if (!managed || !schema || (!isPreview && managed.status !== 'published')) {
            return res.json({ success: true, data: null, managed: false });
        }
        applyRouteMapToSchema(schema, req.store?.storeSlug || req.params.storeSlug);

        // ── Rebuild scopedCss on-the-fly if empty (for schemas built before the CSS fix) ──
        if (!schema.scopedCss || schema.scopedCss.trim() === '') {
            try {
                const cssAssets = await StorefrontAsset.find({
                    storeId: req.storeId,
                    assetType: 'css'
                }).lean();

                if (cssAssets.length > 0) {
                    // Build an asset URL map: originalName → safeUrl (the public-facing path)
                    const allAssets = await StorefrontAsset.find({ storeId: req.storeId }).lean();
                    const assetUrlMap = {};
                    for (const a of allAssets) {
                        assetUrlMap[a.originalName] = a.safeUrl;
                        const bn = path.basename(a.originalName);
                        if (!assetUrlMap[bn]) assetUrlMap[bn] = a.safeUrl;
                    }

                    // Read each CSS file from disk and rewrite url() references
                    let combinedCss = '';
                    for (const asset of cssAssets) {
                        const importId = asset.designImportId?.toString();
                        const storeId = req.storeId?.toString();
                        const cssPath = path.join(__dirname, '../imports', storeId, importId, asset.originalName);

                        if (fs.existsSync(cssPath)) {
                            let css = fs.readFileSync(cssPath, 'utf8');

                            // Rewrite url() references to safe asset URLs
                            css = css.replace(/url\(\s*(['"']?)([^'"')\s]+)\1\s*\)/gi, (match, quote, rawUrl) => {
                                if (rawUrl.startsWith('http') || rawUrl.startsWith('//') || rawUrl.startsWith('data:')) return match;
                                const bn = path.basename(rawUrl.replace(/^[./]+/, ''));
                                const safeUrl = assetUrlMap[rawUrl.replace(/^[./]+/, '')] || assetUrlMap[bn];
                                if (safeUrl) return `url(${quote}${safeUrl}${quote})`;
                                return match;
                            });

                            // Remove unsafe @imports (allow Google Fonts)
                            css = css.replace(/@import\s+url\([^)]+\)\s*;?/gi, m =>
                                (m.includes('fonts.googleapis.com') || m.includes('fonts.gstatic.com')) ? m : '/* blocked */'
                            );

                            combinedCss += `\n/* === ${path.basename(asset.originalName)} === */\n${css}\n`;
                        }
                    }

                    if (combinedCss) {
                        schema.scopedCss = combinedCss;
                        // Also patch the stored schema async (fire-and-forget) so next load is fast
                        const updateField = isPreview ? 'draftSchema.scopedCss' : 'publishedSchema.scopedCss';
                        ManagedStorefront.updateOne(
                            { storeId: req.storeId },
                            { $set: { [updateField]: combinedCss } }
                        ).catch(() => {});
                    }
                }
            } catch (cssErr) {
                console.error('[render-schema] CSS rebuild error:', cssErr.message);
            }
        }

        res.json({ success: true, data: schema, managed: true, preview: Boolean(isPreview), version: managed.version });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Serve storefront assets by hash (images, fonts, css) from disk
router.get('/:storeSlug/assets/:filename', async (req, res) => {
    try {
        const asset = await StorefrontAsset.findOne({ storeId: req.storeId, hash: req.params.filename.replace(/\.[^.]+$/, '') });
        if (!asset) return res.status(404).json({ success: false, message: 'Asset not found' });

        const importId = asset.designImportId?.toString();
        const storeId = req.storeId?.toString();
        const assetPath = path.join(__dirname, '../imports', storeId, importId, asset.originalName);

        if (!fs.existsSync(assetPath)) {
            return res.status(404).send('Asset file not found on disk');
        }

        res.set({
            'Cache-Control': 'public, max-age=86400',
            'Access-Control-Allow-Origin': '*',
            'X-Content-Type-Options': 'nosniff'
        });
        res.setHeader('Content-Type', asset.mimeType || 'application/octet-stream');
        fs.createReadStream(assetPath).pipe(res);
    } catch (error) {
        res.status(500).send('Internal Server Error');
    }
});

module.exports = router;
