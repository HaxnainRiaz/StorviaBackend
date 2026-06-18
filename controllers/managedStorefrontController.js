const ManagedStorefront = require('../models/ManagedStorefront');
const StorefrontVersion = require('../models/StorefrontVersion');
const DesignImport = require('../models/DesignImport');
const Store = require('../models/Store');
const StorefrontAsset = require('../models/StorefrontAsset');
const { createLog } = require('./auditController');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const {
    buildRouteMap,
    resolveHrefTarget,
    applyRouteMapToSchema,
    normalizeImportedHref,
    basename: routeBasename,
} = require('../utils/storefrontRouteMap');
const { extractColorsFromSchema, flattenEditableFields } = require('../utils/colorExtraction');

/**
 * Controller to handle all post-import managed customizations
 */
class ManagedStorefrontController {
    /**
     * Get active managed storefront (draft & published schemas)
     */
    async getStorefront(req, res) {
        try {
            const storefront = await ManagedStorefront.findOneAndUpdate(
                { storeId: req.storeId },
                { $setOnInsert: { storeId: req.storeId } },
                { upsert: true, new: true }
            );
            res.status(200).json({ success: true, data: storefront });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * Get draft schema preview (for live editor)
     */
    async getPreview(req, res) {
        try {
            const storefront = await ManagedStorefront.findOne({ storeId: req.storeId });
            if (!storefront || !storefront.draftSchema) {
                return res.status(404).json({ success: false, message: 'No draft schema found' });
            }
            res.status(200).json({ success: true, data: storefront.draftSchema });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * Get all pages from draft schema
     */
    async getPages(req, res) {
        try {
            const storefront = await ManagedStorefront.findOne({ storeId: req.storeId });
            if (!storefront || !storefront.draftSchema?.pages?.length) {
                return res.status(200).json({ success: true, data: [] });
            }
            const pages = storefront.draftSchema.pages.map(p => ({
                pageId: p.id,
                title: p.title || p.id,
                slug: p.slug || ''
            }));
            res.status(200).json({ success: true, data: pages });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * Visual editor schema — pages, editable fields, colors, route map
     */
    async getEditorSchema(req, res) {
        try {
            const storefront = await ManagedStorefront.findOne({ storeId: req.storeId });
            const store = await Store.findById(req.storeId).select('storeSlug name');
            if (!storefront?.draftSchema?.pages?.length) {
                return res.status(200).json({
                    success: true,
                    data: {
                        pages: [],
                        currentPageId: 'home',
                        editableFields: [],
                        colorTokens: [],
                        routeMap: [],
                        assets: [],
                        draftStatus: { hasDraft: false },
                    },
                });
            }
            const schema = JSON.parse(JSON.stringify(storefront.draftSchema));
            applyRouteMapToSchema(schema, store?.storeSlug || '');
            const pageId = req.query.pageId || 'home';
            const currentPage = schema.pages.find((p) => p.id === pageId) || schema.pages[0];
            res.status(200).json({
                success: true,
                data: {
                    pages: schema.pages.map((p) => ({
                        id: p.id,
                        title: p.title || p.id,
                        slug: p.slug || '',
                        fileName: p.fileName,
                        storivaRoute: p.storivaRoute || '',
                        type: p.type,
                    })),
                    currentPageId: currentPage?.id || 'home',
                    currentPage,
                    scopedCss: schema.scopedCss || schema.globalStyles?.rawCss || '',
                    globalStyles: schema.globalStyles || {},
                    editableFields: flattenEditableFields(schema),
                    colorTokens: extractColorsFromSchema(schema),
                    routeMap: schema.routeMap || [],
                    assets: schema.assets || [],
                    storeSlug: store?.storeSlug || '',
                    draftStatus: {
                        hasDraft: true,
                        lastSavedAt: storefront.updatedAt,
                        version: storefront.version,
                        status: storefront.status,
                    },
                },
            });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    async updateEditableField(req, res) {
        try {
            const { fieldId } = req.params;
            const { draftValue, pageId, sectionId, fieldKey } = req.body;
            const storefront = await ManagedStorefront.findOne({ storeId: req.storeId });
            if (!storefront?.draftSchema) {
                return res.status(404).json({ success: false, message: 'No draft schema found' });
            }
            const schema = storefront.draftSchema;
            let page = null;
            let section = null;
            let field = null;

            if (pageId && sectionId && fieldKey) {
                page = schema.pages.find((p) => p.id === pageId);
                section = page?.sections?.find((s) => s.id === sectionId);
                field = section?.editableFields?.find((f) => f.key === fieldKey);
            } else if (fieldId) {
                const parts = String(fieldId).split('__');
                if (parts.length >= 3) {
                    const [pId, sId, ...keyParts] = parts;
                    const fKey = keyParts.join('__');
                    page = schema.pages.find((p) => p.id === pId);
                    section = page?.sections?.find((s) => s.id === sId);
                    field = section?.editableFields?.find((f) => f.key === fKey);
                }
            }

            if (!field) {
                return res.status(404).json({ success: false, message: 'Editable field not found' });
            }
            field.value = typeof draftValue === 'string' ? draftValue.trim() : draftValue;
            section.editedContent = section.editedContent || {};
            section.editedContent[field.key] = field.value;
            storefront.markModified('draftSchema');
            await storefront.save();
            res.status(200).json({ success: true, data: { fieldId, draftValue: field.value } });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * Get all detected pages and their inter-page links from the draft schema
     */
    async getLinks(req, res) {
        try {
            const storefront = await ManagedStorefront.findOne({ storeId: req.storeId });
            if (!storefront || !storefront.draftSchema) {
                return res.status(200).json({ success: true, data: { pages: [], links: [], uniqueRoutes: [], stats: {} } });
            }
            const store = await Store.findById(req.storeId).select('storeSlug');
            const schema = storefront.draftSchema;
            applyRouteMapToSchema(schema, store?.storeSlug || '');
            storefront.markModified('draftSchema');
            await storefront.save();

            const pages = (schema.pages || []).map(p => ({
                id: p.id,
                slug: p.slug || '',
                fileName: p.fileName || (p.id === 'home' ? 'index.html' : p.id + '.html'),
                title: p.title || p.id,
                type: p.type || 'imported',
                storivaRoute: p.storivaRoute || ''
            }));
            const links = (schema.pageLinks || []).map(l => ({
                fromPage: l.fromPage,
                toPage: l.toPage,
                label: l.label || l.toPage,
                originalHref: l.originalHref,
                storivaMapped: l.storivaMapped || false,
                storivaRoute: l.storivaRoute || ''
            }));
            const uniqueRoutes = (schema.routeMap || [])
                .filter(r => r.id && String(r.id).startsWith('link_'))
                .map(r => ({
                    originalHref: r.originalHref,
                    normalizedPath: r.normalizedPath,
                    storivaRoute: r.storivaRoute || '',
                    label: r.label || r.originalHref,
                    usedOnPages: r.usedOnPages || 1,
                    status: r.status || (r.storviaRoute ? 'active' : 'unmapped'),
                }));
            const mappedLinks = links.filter(l => l.storivaRoute).length;
            res.status(200).json({
                success: true,
                data: {
                    pages,
                    links,
                    uniqueRoutes,
                    stats: {
                        pageCount: pages.length,
                        totalLinks: links.length,
                        mappedLinks,
                        uniqueDestinations: uniqueRoutes.length,
                    },
                },
            });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * Save seller-defined route mappings for pages and links
     */
    async updateLinks(req, res) {
        try {
            const { pageMappings = [], linkMappings = [], routeMappings = [] } = req.body;
            const storefront = await ManagedStorefront.findOne({ storeId: req.storeId });
            if (!storefront || !storefront.draftSchema) {
                return res.status(404).json({ success: false, message: 'No draft schema found' });
            }
            const schema = storefront.draftSchema;

            const applyRouteToHref = (href, route) => {
                const normalized = normalizeImportedHref(href);
                const base = routeBasename(normalized).toLowerCase();
                for (const page of schema.pages || []) {
                    const file = page.fileName || (page.id === 'home' ? 'index.html' : `${page.id}.html`);
                    const pageBase = routeBasename(file).toLowerCase();
                    if (page.id === base.replace(/\.html$/, '') || pageBase === base || file === normalized) {
                        page.storivaRoute = route;
                    }
                }
                for (const link of schema.pageLinks || []) {
                    const linkHref = normalizeImportedHref(link.originalHref || link.toPage);
                    const linkBase = routeBasename(linkHref).toLowerCase();
                    if (linkHref === normalized || linkBase === base) {
                        link.storviaRoute = route;
                        link.storviaMapped = Boolean(route);
                    }
                }
            };

            for (const pm of pageMappings) {
                const page = (schema.pages || []).find(p => p.id === pm.pageId);
                if (page) applyRouteToHref(page.fileName || page.id, pm.storivaRoute);
            }
            for (const rm of routeMappings) {
                if (rm.originalHref) applyRouteToHref(rm.originalHref, rm.storivaRoute);
            }
            for (const lm of linkMappings) {
                applyRouteToHref(lm.toPage || lm.originalHref, lm.storivaRoute);
            }

            const store = await Store.findById(req.storeId).select('storeSlug');
            applyRouteMapToSchema(schema, store?.storeSlug || '');
            storefront.markModified('draftSchema');
            await storefront.save();
            res.status(200).json({ success: true, message: 'Route mappings saved.' });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    async getRouteMap(req, res) {
        try {
            const storefront = await ManagedStorefront.findOne({ storeId: req.storeId });
            if (!storefront?.draftSchema) {
                return res.status(200).json({ success: true, data: [] });
            }
            const routeMap = buildRouteMap(storefront.draftSchema);
            storefront.markModified('draftSchema');
            await storefront.save();
            res.status(200).json({ success: true, data: routeMap });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    async autoGenerateRouteMap(req, res) {
        try {
            const storefront = await ManagedStorefront.findOne({ storeId: req.storeId });
            if (!storefront?.draftSchema) {
                return res.status(404).json({ success: false, message: 'No draft schema found' });
            }
            const store = await Store.findById(req.storeId).select('storeSlug');
            applyRouteMapToSchema(storefront.draftSchema, store?.storeSlug || '');
            storefront.markModified('draftSchema');
            await storefront.save();
            res.status(200).json({ success: true, data: storefront.draftSchema.routeMap || [] });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    async validateRouteMap(req, res) {
        try {
            const storefront = await ManagedStorefront.findOne({ storeId: req.storeId });
            if (!storefront?.draftSchema) {
                return res.status(200).json({ success: true, data: { warnings: [] } });
            }
            const routeMap = buildRouteMap(storefront.draftSchema);
            const warnings = routeMap
                .filter(r => r.status !== 'active')
                .map(r => ({
                    originalHref: r.originalHref,
                    normalizedPath: r.normalizedPath,
                    status: r.status,
                    targetType: r.targetType,
                }));
            res.status(200).json({ success: true, data: { warnings, total: routeMap.length } });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    async updateRouteMapItem(req, res) {
        try {
            const { id } = req.params;
            const { storivaRoute = '' } = req.body;
            const storefront = await ManagedStorefront.findOne({ storeId: req.storeId });
            if (!storefront?.draftSchema) {
                return res.status(404).json({ success: false, message: 'No draft schema found' });
            }
            const schema = storefront.draftSchema;
            buildRouteMap(schema);
            const routeMap = schema.routeMap || [];
            const item = routeMap.find(r => String(r.id) === String(id));
            if (!item) {
                return res.status(404).json({ success: false, message: 'Route mapping item not found' });
            }
            item.storviaRoute = storivaRoute;
            item.status = storivaRoute ? 'active' : 'unmapped';

            (schema.pageLinks || []).forEach(link => {
                if ((link.originalHref || link.toPage) === item.originalHref) {
                    link.storivaRoute = storivaRoute;
                    link.storivaMapped = Boolean(storivaRoute);
                }
            });
            applyRouteMapToSchema(schema);
            storefront.markModified('draftSchema');
            await storefront.save();
            res.status(200).json({ success: true, data: item });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * Get sections with text nodes for a specific page
     */
    async getSections(req, res) {
        try {
            const { pageId } = req.params;
            const storefront = await ManagedStorefront.findOne({ storeId: req.storeId });
            if (!storefront || !storefront.draftSchema?.pages?.length) {
                return res.status(200).json({ success: true, data: [] });
            }
            const page = storefront.draftSchema.pages.find(p => p.id === pageId);
            if (!page) return res.status(200).json({ success: true, data: [] });

            const sections = page.sections.map(s => ({
                sectionId: s.id,
                label: s.label || s.tagName || s.id,
                textNodes: s.textNodes || [],
                editedContent: s.editedContent || {}
            }));
            res.status(200).json({ success: true, data: sections });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * Update text content in a single section
     */
    async updateSection(req, res) {
        try {
            const { pageId = 'home', sectionId, editedContent = {} } = req.body;
            const storefront = await ManagedStorefront.findOne({ storeId: req.storeId });
            if (!storefront) {
                return res.status(404).json({ success: false, message: 'Storefront not found' });
            }
            const schema = storefront.draftSchema;
            const page = schema.pages.find(p => p.id === pageId);
            if (!page) return res.status(400).json({ success: false, message: `Page '${pageId}' not found` });
            const section = page.sections.find(s => s.id === sectionId);
            if (!section) return res.status(400).json({ success: false, message: `Section '${sectionId}' not found` });

            section.editedContent = { ...(section.editedContent || {}), ...editedContent };
            storefront.draftSchema = schema;
            storefront.markModified('draftSchema');
            await storefront.save();
            res.status(200).json({ success: true, data: storefront.draftSchema });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * Update editable text fields (legacy compat)
     */
    async updateContent(req, res) {
        try {
            const { pageId = 'home', sectionId, fieldKey, value } = req.body;
            const storefront = await ManagedStorefront.findOne({ storeId: req.storeId });
            if (!storefront) {
                return res.status(404).json({ success: false, message: 'Storefront design not found' });
            }
            const schema = storefront.draftSchema;
            const page = schema.pages.find(p => p.id === pageId);
            if (!page) return res.status(400).json({ success: false, message: `Page '${pageId}' not found` });
            const section = page.sections.find(s => s.id === sectionId);
            if (!section) return res.status(400).json({ success: false, message: `Section '${sectionId}' not found` });
            const field = (section.editableFields || []).find(f => f.key === fieldKey);
            if (!field) return res.status(400).json({ success: false, message: `Field '${fieldKey}' not found` });
            field.value = String(value).trim();
            section.editedContent = section.editedContent || {};
            section.editedContent[fieldKey] = field.value;
            storefront.draftSchema = schema;
            storefront.markModified('draftSchema');
            await storefront.save();
            res.status(200).json({ success: true, data: storefront });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * Get all images from the schema
     */
    async getImages(req, res) {
        try {
            const storefront = await ManagedStorefront.findOne({ storeId: req.storeId });
            if (!storefront || !storefront.draftSchema?.pages?.length) {
                return res.status(200).json({ success: true, data: [] });
            }
            const schema = storefront.draftSchema;
            const images = [];
            const seen = new Set();

            const pushImage = (entry) => {
                const key = entry.imageId || entry.originalUrl;
                if (!key || seen.has(key)) return;
                seen.add(key);
                images.push(entry);
            };

            for (const page of schema.pages) {
                for (const section of page.sections || []) {
                    for (const img of (section.imageFields || [])) {
                        pushImage({
                            imageId: img.imageId,
                            sectionId: section.id,
                            pageId: page.id,
                            pageTitle: page.title || page.id,
                            sectionLabel: section.label || section.id,
                            originalUrl: img.replacedUrl || img.originalUrl,
                            replacedUrl: img.replacedUrl || null,
                            alt: img.alt || '',
                            originalName: img.originalName || img.alt || img.imageId,
                            isLibraryAsset: false,
                        });
                    }
                    for (const field of (section.editableFields || [])) {
                        if (field.type !== 'image') continue;
                        pushImage({
                            imageId: field.key,
                            sectionId: section.id,
                            pageId: page.id,
                            pageTitle: page.title || page.id,
                            sectionLabel: section.label || section.id,
                            originalUrl: field.value,
                            replacedUrl: field.replacedUrl || null,
                            alt: field.alt || '',
                            originalName: field.label || field.key,
                            isLibraryAsset: false,
                        });
                    }
                }
            }

            for (const asset of (schema.assets || [])) {
                if (asset.assetType && asset.assetType !== 'image') continue;
                if (!asset.safeUrl) continue;
                pushImage({
                    imageId: `asset_${asset.hash || asset.id}`,
                    sectionId: '',
                    pageId: '_assets',
                    pageTitle: 'Design Assets',
                    sectionLabel: asset.originalName,
                    originalUrl: asset.safeUrl,
                    replacedUrl: null,
                    alt: asset.originalName,
                    originalName: asset.originalName,
                    isLibraryAsset: true,
                });
            }

            res.status(200).json({ success: true, data: images });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * Replace a single image (accepts multipart/form-data with 'image' field or imageURL from body)
     */
    async replaceImage(req, res) {
        try {
            const { imageId, pageId = 'home', sectionId } = req.body;
            const storefront = await ManagedStorefront.findOne({ storeId: req.storeId });
            if (!storefront) return res.status(404).json({ success: false, message: 'Storefront not found' });

            // Handle file upload to local disk or resolve URL from body
            let newUrl = req.body.imageUrl || null;
            if (req.file) {
                const store = await Store.findById(req.storeId).select('storeSlug');
                const assetKey = store?.storeSlug || req.storeId.toString();
                // Save to imports directory and register as asset
                const importId = storefront.designImportId?.toString() || 'replacements';
                const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
                const hash = crypto.createHash('md5').update(req.file.buffer).digest('hex');
                const saveDir = path.join(__dirname, '../imports', req.storeId.toString(), importId);
                if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });
                const fileName = `${hash}${ext}`;
                const filePath = path.join(saveDir, fileName);
                fs.writeFileSync(filePath, req.file.buffer);
                newUrl = `/api/storefront/${assetKey}/assets/${hash}${ext}`;

                // Register in StorefrontAsset
                await StorefrontAsset.findOneAndUpdate(
                    { storeId: req.storeId, hash },
                    {
                        designImportId: storefront.designImportId,
                        originalName: fileName,
                        assetType: 'image',
                        safeUrl: newUrl,
                        size: req.file.size,
                        mimeType: req.file.mimetype,
                        hash
                    },
                    { upsert: true }
                );
            }

            if (!newUrl) return res.status(400).json({ success: false, message: 'No image provided' });

            // Update schema
            const schema = storefront.draftSchema;
            let updated = false;
            for (const page of schema.pages) {
                for (const section of page.sections) {
                    for (const img of (section.imageFields || [])) {
                        if (img.imageId === imageId) {
                            img.replacedUrl = newUrl;
                            // Also update the section HTML's img src
                            if (section.html) {
                                section.html = section.html.replace(
                                    new RegExp(`(src=[\"'])${img.originalUrl.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}([\"'])`, 'g'),
                                    `$1${newUrl}$2`
                                );
                            }
                            updated = true;
                        }
                    }
                    for (const field of (section.editableFields || [])) {
                        if (field.type === 'image' && field.key === imageId) {
                            field.value = newUrl;
                            updated = true;
                        }
                    }
                }
            }

            if (!updated) return res.status(404).json({ success: false, message: 'Image not found in schema' });
            storefront.draftSchema = schema;
            storefront.markModified('draftSchema');
            await storefront.save();
            res.status(200).json({ success: true, data: { url: newUrl } });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * Replace mapped images safely (legacy)
     */
    async updateImages(req, res) {
        try {
            const { pageId = 'home', sectionId, fieldKey, imageUrl } = req.body;
            const storefront = await ManagedStorefront.findOne({ storeId: req.storeId });
            if (!storefront) return res.status(404).json({ success: false, message: 'Storefront not found' });
            if (imageUrl && !imageUrl.startsWith('/') && !imageUrl.startsWith('http')) {
                return res.status(400).json({ success: false, message: 'Invalid asset URL format' });
            }
            const schema = storefront.draftSchema;
            const page = schema.pages.find(p => p.id === pageId);
            if (!page) return res.status(400).json({ success: false, message: `Page '${pageId}' not found` });
            const section = page.sections.find(s => s.id === sectionId);
            if (!section) return res.status(400).json({ success: false, message: `Section '${sectionId}' not found` });
            const field = section.editableFields.find(f => f.key === fieldKey);
            if (!field || field.type !== 'image') {
                return res.status(400).json({ success: false, message: `Image field '${fieldKey}' not found` });
            }
            field.value = imageUrl;
            storefront.draftSchema = schema;
            storefront.markModified('draftSchema');
            await storefront.save();
            res.status(200).json({ success: true, data: storefront });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * Get active colors
     */
    async getColors(req, res) {
        try {
            const storefront = await ManagedStorefront.findOne({ storeId: req.storeId });
            if (!storefront || !storefront.draftSchema?.globalStyles) {
                return res.status(200).json({ success: true, data: { colors: {}, cssVariables: {} } });
            }
            res.status(200).json({
                success: true,
                data: {
                    colors: storefront.draftSchema.globalStyles.colors || {},
                    cssVariables: storefront.draftSchema.globalStyles.cssVariables || {}
                }
            });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * Edit global color tokens
     */
    async updateColors(req, res) {
        try {
            const { primary, secondary, text, background, cssVariables = {} } = req.body;
            const storefront = await ManagedStorefront.findOne({ storeId: req.storeId });
            if (!storefront) {
                return res.status(404).json({ success: false, message: 'Storefront not found' });
            }
            const isHex = (val) => !val || /^#[0-9A-F]{6}$/i.test(val);
            if (!isHex(primary) || !isHex(secondary) || !isHex(text) || !isHex(background)) {
                return res.status(400).json({ success: false, message: 'Colors must be in hexadecimal format (e.g. #1E8AF7)' });
            }
            const schema = storefront.draftSchema;
            if (primary) schema.globalStyles.colors.primary = primary;
            if (secondary) schema.globalStyles.colors.secondary = secondary;
            if (text) schema.globalStyles.colors.text = text;
            if (background) schema.globalStyles.colors.background = background;
            if (cssVariables) schema.globalStyles.cssVariables = { ...schema.globalStyles.cssVariables, ...cssVariables };

            storefront.draftSchema = schema;
            storefront.markModified('draftSchema');
            await storefront.save();
            res.status(200).json({ success: true, data: storefront });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * Get active navigation
     */
    async getNavigation(req, res) {
        try {
            const storefront = await ManagedStorefront.findOne({ storeId: req.storeId });
            if (!storefront || !storefront.draftSchema?.navigation) {
                return res.status(200).json({ success: true, data: {} });
            }
            res.status(200).json({ success: true, data: storefront.draftSchema.navigation });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * Configure header/footer navigation items
     */
    async updateNavigation(req, res) {
        try {
            const { navigationMenu = {} } = req.body;
            const storefront = await ManagedStorefront.findOne({ storeId: req.storeId });
            if (!storefront) {
                return res.status(404).json({ success: false, message: 'Storefront not found' });
            }
            const schema = storefront.draftSchema;
            schema.navigation = navigationMenu;
            storefront.draftSchema = schema;
            storefront.markModified('draftSchema');
            await storefront.save();
            res.status(200).json({ success: true, data: storefront });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * Get product mappings
     */
    async getProductMapping(req, res) {
        try {
            const storefront = await ManagedStorefront.findOne({ storeId: req.storeId });
            if (!storefront || !storefront.draftSchema?.pages) {
                return res.status(200).json({ success: true, data: [] });
            }
            const mappings = [];
            for (const page of storefront.draftSchema.pages) {
                for (const section of page.sections) {
                    if (section.type === 'dynamic_product_grid' || section.tagName === 'product-grid' || (section.classVal && section.classVal.includes('product-grid'))) {
                        mappings.push({
                            pageId: page.id,
                            sectionId: section.id,
                            source: section.config?.source || 'newest',
                            limit: section.config?.limit || 8,
                            collectionId: section.config?.collectionId || null
                        });
                    }
                }
            }
            res.status(200).json({ success: true, data: mappings });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * Bind dynamic Product Grid sections to collections or custom product feeds
     */
    async updateProductMapping(req, res) {
        try {
            const { pageId = 'home', sectionId, source, limit = 8, collectionId = null } = req.body;
            const storefront = await ManagedStorefront.findOne({ storeId: req.storeId });
            if (!storefront) {
                return res.status(404).json({ success: false, message: 'Storefront design not found' });
            }
            const schema = storefront.draftSchema;
            const page = schema.pages.find(p => p.id === pageId);
            if (!page) return res.status(400).json({ success: false, message: 'Page not found' });
            const section = page.sections.find(s => s.id === sectionId);
            if (!section) return res.status(400).json({ success: false, message: 'Section not found' });

            section.type = 'dynamic_product_grid';
            section.source = 'storvia';
            section.config = {
                source: source || 'newest',
                limit: Number(limit) || 8,
                collectionId
            };
            storefront.draftSchema = schema;
            storefront.markModified('draftSchema');
            await storefront.save();
            res.status(200).json({ success: true, data: storefront });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * Get active SEO
     */
    async getSeo(req, res) {
        try {
            const { pageId = 'home' } = req.query;
            const storefront = await ManagedStorefront.findOne({ storeId: req.storeId });
            if (!storefront || !storefront.draftSchema?.pages) {
                return res.status(404).json({ success: false, message: 'Storefront not found' });
            }
            const page = storefront.draftSchema.pages.find(p => p.id === pageId);
            if (!page) return res.status(404).json({ success: false, message: `Page '${pageId}' not found` });
            res.status(200).json({ success: true, data: page.seo || {} });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * Manage store-level SEO metadata
     */
    async updateSeo(req, res) {
        try {
            const { pageId = 'home', title, description, image } = req.body;
            const storefront = await ManagedStorefront.findOne({ storeId: req.storeId });
            if (!storefront) {
                return res.status(404).json({ success: false, message: 'Storefront not found' });
            }
            const schema = storefront.draftSchema;
            const page = schema.pages.find(p => p.id === pageId);
            if (!page) return res.status(400).json({ success: false, message: 'Page not found' });
            page.seo = {
                title: title || page.seo.title,
                description: description || page.seo.description,
                image: image || page.seo.image,
                index: true
            };
            storefront.draftSchema = schema;
            storefront.markModified('draftSchema');
            await storefront.save();
            res.status(200).json({ success: true, data: storefront });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * Re-apply route map + asset URL normalization to draft/published schemas.
     * Use after routing fixes without re-uploading the design package.
     */
    async resyncSchema(req, res) {
        try {
            const storefront = await ManagedStorefront.findOne({ storeId: req.storeId });
            if (!storefront?.draftSchema) {
                return res.status(404).json({ success: false, message: 'No draft schema found' });
            }
            const store = await Store.findById(req.storeId);
            const slug = store?.storeSlug || '';
            storefront.draftSchema = applyRouteMapToSchema(storefront.draftSchema, slug);
            if (storefront.publishedSchema) {
                storefront.publishedSchema = applyRouteMapToSchema(
                    JSON.parse(JSON.stringify(storefront.draftSchema)),
                    slug
                );
            }
            storefront.markModified('draftSchema');
            storefront.markModified('publishedSchema');
            await storefront.save();
            res.status(200).json({
                success: true,
                message: 'Storefront schema resynced.',
                data: storefront,
            });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * Publish the active draft configuration to the live web storefront
     */
    async publishStorefront(req, res) {
        try {
            const storefront = await ManagedStorefront.findOne({ storeId: req.storeId });
            if (!storefront) {
                return res.status(404).json({ success: false, message: 'Storefront not found' });
            }
            const store = await Store.findById(req.storeId);
            storefront.draftSchema = applyRouteMapToSchema(storefront.draftSchema, store?.storeSlug || '');
            storefront.publishedSchema = applyRouteMapToSchema(
                JSON.parse(JSON.stringify(storefront.draftSchema || {})),
                store?.storeSlug || ''
            );
            storefront.status = 'published';
            storefront.version += 1;
            storefront.markModified('draftSchema');
            storefront.markModified('publishedSchema');
            await storefront.save();

            await StorefrontVersion.create({
                storeId: req.storeId,
                managedStorefrontId: storefront._id,
                snapshot: storefront.publishedSchema,
                versionNumber: storefront.version,
                createdBy: req.user._id,
                notes: req.body.notes || `Published edits version ${storefront.version}`
            });

            if (store) {
                store.status = 'published';
                store.setupStatus = 'completed';
                await store.save();
            }

            await createLog(req.user._id, 'storefront_publish', `Published custom edits v${storefront.version}`, {
                storeId: req.storeId,
                entity: 'managed_storefront',
                entityId: storefront._id,
                req
            });

            res.status(200).json({ success: true, data: storefront });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * Get version snapshots history log
     */
    async getVersions(req, res) {
        try {
            const versions = await StorefrontVersion.find({ storeId: req.storeId })
                .sort({ versionNumber: -1 })
                .populate('createdBy', 'name email');
            res.status(200).json({ success: true, data: versions });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * Restore design configuration to a historical version log rollback
     */
    async restoreVersion(req, res) {
        try {
            const version = await StorefrontVersion.findOne({ _id: req.params.id, storeId: req.storeId });
            if (!version) {
                return res.status(404).json({ success: false, message: 'Version snapshot not found' });
            }
            const storefront = await ManagedStorefront.findOne({ storeId: req.storeId });
            if (!storefront) {
                return res.status(404).json({ success: false, message: 'Storefront not found' });
            }
            storefront.draftSchema = version.snapshot;
            storefront.markModified('draftSchema');
            await storefront.save();

            await createLog(req.user._id, 'storefront_restore', `Restored design draft to version #${version.versionNumber}`, {
                storeId: req.storeId,
                entity: 'storefront_version',
                entityId: version._id,
                req
            });

            res.status(200).json({ success: true, data: storefront });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * Rollback to a historical version snapshot (alias for restoreVersion)
     */
    async rollbackVersion(req, res) {
        return this.restoreVersion(req, res);
    }
}

module.exports = new ManagedStorefrontController();
