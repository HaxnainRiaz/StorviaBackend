const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

// Middleware to extract userId from protected requests
router.use((req, res, next) => {
    req.userId = req.user?._id;
    if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
});


// ============================================
// PAGES ENDPOINTS
// ============================================

// GET all pages for a design
router.get('/pages', async (req, res) => {
    try {
        const { storeId } = req.query;

        // Validate store ownership
        const store = await Store.findById(storeId);
        if (!store) return res.status(404).json({ error: 'Store not found' });
        if (store.ownerUserId.toString() !== req.userId.toString()) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const design = await StorefrontDesign.findOne({ storeId, isActive: true });
        if (!design) {
            return res.status(404).json({ error: 'Design not found' });
        }

        res.json(design.pages || []);
    } catch (error) {
        console.error('Error fetching pages:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET single page with structure
router.get('/pages/:pageId', async (req, res) => {
    try {
        const { pageId } = req.params;
        const { storeId } = req.query;

        // Validate store ownership
        const store = await Store.findById(storeId);
        if (!store) return res.status(404).json({ error: 'Store not found' });
        if (store.ownerUserId.toString() !== req.userId.toString()) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const pageStructure = await PageStructure.findOne({
            pageId: new mongoose.Types.ObjectId(pageId),
            storeId: new mongoose.Types.ObjectId(storeId)
        });

        if (!pageStructure) {
            return res.status(404).json({ error: 'Page structure not found' });
        }

        res.json({
            page: pageStructure,
            sections: pageStructure.snapshot?.sections || []
        });
    } catch (error) {
        console.error('Error fetching page:', error);
        res.status(500).json({ error: error.message });
    }
});

// CREATE new page
router.post('/pages', async (req, res) => {
    try {
        const { storeId, pageName, layout } = req.body;

        // Validate store ownership
        const store = await Store.findById(storeId);
        if (!store) return res.status(404).json({ error: 'Store not found' });
        if (store.ownerUserId.toString() !== req.userId.toString()) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        // Get or create design
        let design = await StorefrontDesign.findOne({ storeId, isActive: true });
        if (!design) {
            design = new StorefrontDesign({
                storeId,
                name: 'Default Design',
                createdBy: req.userId
            });
        }

        // Add page to design
        const newPage = {
            _id: new mongoose.Types.ObjectId(),
            name: pageName || 'Untitled Page',
            slug: pageName?.toLowerCase().replace(/\s+/g, '-') || 'untitled-page',
            layout: layout || 'custom',
            isPublished: false,
            editedBy: req.userId
        };

        design.pages.push(newPage);
        await design.save();

        // Create page structure
        const pageStructure = new PageStructure({
            designId: design._id,
            pageId: newPage._id,
            storeId,
            snapshot: { sections: [] },
            lastEditedBy: req.userId
        });

        await pageStructure.save();

        res.status(201).json({
            ...newPage,
            sections: []
        });
    } catch (error) {
        console.error('Error creating page:', error);
        res.status(500).json({ error: error.message });
    }
});

// UPDATE page
router.put('/pages/:pageId', async (req, res) => {
    try {
        const { pageId } = req.params;
        const { storeId, sections, globalStyles } = req.body;

        // Validate store ownership
        const store = await Store.findById(storeId);
        if (!store) return res.status(404).json({ error: 'Store not found' });
        if (store.ownerUserId.toString() !== req.userId.toString()) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const pageStructure = await PageStructure.findOneAndUpdate(
            {
                pageId: new mongoose.Types.ObjectId(pageId),
                storeId: new mongoose.Types.ObjectId(storeId)
            },
            {
                snapshot: { sections: sections || [] },
                lastEditedAt: new Date(),
                lastEditedBy: req.userId
            },
            { new: true }
        );

        if (!pageStructure) {
            return res.status(404).json({ error: 'Page not found' });
        }

        // Update global styles if provided
        if (globalStyles) {
            await StorefrontDesign.updateOne(
                { _id: pageStructure.designId },
                { globalStyles }
            );
        }

        res.json(pageStructure);
    } catch (error) {
        console.error('Error updating page:', error);
        res.status(500).json({ error: error.message });
    }
});

// DELETE page
router.delete('/pages/:pageId', async (req, res) => {
    try {
        const { pageId } = req.params;
        const { storeId } = req.query;

        // Validate store ownership
        const store = await Store.findById(storeId);
        if (!store) return res.status(404).json({ error: 'Store not found' });
        if (store.ownerUserId.toString() !== req.userId.toString()) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        // Remove page from design
        await StorefrontDesign.updateOne(
            { storeId },
            { $pull: { pages: { _id: new mongoose.Types.ObjectId(pageId) } } }
        );

        // Delete page structure
        await PageStructure.deleteOne({
            pageId: new mongoose.Types.ObjectId(pageId),
            storeId: new mongoose.Types.ObjectId(storeId)
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting page:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// ELEMENTS ENDPOINTS
// ============================================

// CREATE element
router.post('/pages/:pageId/elements', async (req, res) => {
    try {
        const { pageId } = req.params;
        const { storeId, sectionId, element } = req.body;

        // Validate store ownership
        const store = await Store.findById(storeId);
        if (!store) return res.status(404).json({ error: 'Store not found' });
        if (store.ownerUserId.toString() !== req.userId.toString()) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const pageStructure = await PageStructure.findOne({
            pageId: new mongoose.Types.ObjectId(pageId),
            storeId: new mongoose.Types.ObjectId(storeId)
        });

        if (!pageStructure) {
            return res.status(404).json({ error: 'Page not found' });
        }

        // Add element to section
        const sections = pageStructure.snapshot.sections;
        const section = sections.find(s => s._id.toString() === sectionId);

        if (!section) {
            return res.status(404).json({ error: 'Section not found' });
        }

        element._id = new mongoose.Types.ObjectId();
        section.elements = section.elements || [];
        section.elements.push(element);

        pageStructure.editHistory.push({
            action: 'create',
            elementId: element._id,
            sectionId,
            userId: req.userId,
            changes: element
        });

        await pageStructure.save();

        res.status(201).json(element);
    } catch (error) {
        console.error('Error creating element:', error);
        res.status(500).json({ error: error.message });
    }
});

// UPDATE element styles
router.patch('/pages/:pageId/elements/:elementId/styles', async (req, res) => {
    try {
        const { pageId, elementId } = req.params;
        const { storeId, styles } = req.body;

        // Validate store ownership
        const store = await Store.findById(storeId);
        if (!store) return res.status(404).json({ error: 'Store not found' });
        if (store.ownerUserId.toString() !== req.userId.toString()) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const pageStructure = await PageStructure.findOne({
            pageId: new mongoose.Types.ObjectId(pageId),
            storeId: new mongoose.Types.ObjectId(storeId)
        });

        if (!pageStructure) {
            return res.status(404).json({ error: 'Page not found' });
        }

        // Find and update element
        let found = false;
        pageStructure.snapshot.sections.forEach(section => {
            section.elements?.forEach(el => {
                if (el._id.toString() === elementId) {
                    el.styles = { ...el.styles, ...styles };
                    found = true;
                }
            });
        });

        if (!found) {
            return res.status(404).json({ error: 'Element not found' });
        }

        pageStructure.editHistory.push({
            action: 'style',
            elementId,
            userId: req.userId,
            changes: styles
        });

        await pageStructure.save();

        res.json({ success: true });
    } catch (error) {
        console.error('Error updating element styles:', error);
        res.status(500).json({ error: error.message });
    }
});

// UPDATE element content
router.patch('/pages/:pageId/elements/:elementId/content', async (req, res) => {
    try {
        const { pageId, elementId } = req.params;
        const { storeId, content, properties } = req.body;

        // Validate store ownership
        const store = await Store.findById(storeId);
        if (!store) return res.status(404).json({ error: 'Store not found' });
        if (store.ownerUserId.toString() !== req.userId.toString()) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const pageStructure = await PageStructure.findOne({
            pageId: new mongoose.Types.ObjectId(pageId),
            storeId: new mongoose.Types.ObjectId(storeId)
        });

        if (!pageStructure) {
            return res.status(404).json({ error: 'Page not found' });
        }

        // Find and update element
        let found = false;
        pageStructure.snapshot.sections.forEach(section => {
            section.elements?.forEach(el => {
                if (el._id.toString() === elementId) {
                    if (content) el.content = content;
                    if (properties) el.properties = { ...el.properties, ...properties };
                    found = true;
                }
            });
        });

        if (!found) {
            return res.status(404).json({ error: 'Element not found' });
        }

        pageStructure.editHistory.push({
            action: 'content',
            elementId,
            userId: req.userId,
            changes: { content, properties }
        });

        await pageStructure.save();

        res.json({ success: true });
    } catch (error) {
        console.error('Error updating element content:', error);
        res.status(500).json({ error: error.message });
    }
});

// DELETE element
router.delete('/pages/:pageId/elements/:elementId', async (req, res) => {
    try {
        const { pageId, elementId } = req.params;
        const { storeId } = req.query;

        // Validate store ownership
        const store = await Store.findById(storeId);
        if (!store) return res.status(404).json({ error: 'Store not found' });
        if (store.ownerUserId.toString() !== req.userId.toString()) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const pageStructure = await PageStructure.findOne({
            pageId: new mongoose.Types.ObjectId(pageId),
            storeId: new mongoose.Types.ObjectId(storeId)
        });

        if (!pageStructure) {
            return res.status(404).json({ error: 'Page not found' });
        }

        // Remove element from sections
        pageStructure.snapshot.sections.forEach(section => {
            section.elements = section.elements?.filter(el => el._id.toString() !== elementId) || [];
        });

        pageStructure.editHistory.push({
            action: 'delete',
            elementId,
            userId: req.userId
        });

        await pageStructure.save();

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting element:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// GLOBAL STYLES ENDPOINTS
// ============================================

// GET global styles
router.get('/global-styles', async (req, res) => {
    try {
        const { storeId } = req.query;

        // Validate store ownership
        const store = await Store.findById(storeId);
        if (!store) return res.status(404).json({ error: 'Store not found' });
        if (store.ownerUserId.toString() !== req.userId.toString()) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const design = await StorefrontDesign.findOne({ storeId, isActive: true });
        if (!design) {
            return res.status(404).json({ error: 'Design not found' });
        }

        res.json(design.globalStyles);
    } catch (error) {
        console.error('Error fetching global styles:', error);
        res.status(500).json({ error: error.message });
    }
});

// UPDATE global styles
router.put('/global-styles', async (req, res) => {
    try {
        const { storeId, globalStyles } = req.body;

        // Validate store ownership
        const store = await Store.findById(storeId);
        if (!store) return res.status(404).json({ error: 'Store not found' });
        if (store.ownerUserId.toString() !== req.userId.toString()) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const design = await StorefrontDesign.findOneAndUpdate(
            { storeId, isActive: true },
            { globalStyles },
            { new: true }
        );

        if (!design) {
            return res.status(404).json({ error: 'Design not found' });
        }

        res.json(design.globalStyles);
    } catch (error) {
        console.error('Error updating global styles:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// PUBLISH ENDPOINTS
// ============================================

// PUBLISH page
router.post('/pages/:pageId/publish', async (req, res) => {
    try {
        const { pageId } = req.params;
        const { storeId } = req.body;

        // Validate store ownership
        const store = await Store.findById(storeId);
        if (!store) return res.status(404).json({ error: 'Store not found' });
        if (store.ownerUserId.toString() !== req.userId.toString()) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const design = await StorefrontDesign.findOne({ storeId, isActive: true });
        if (!design) {
            return res.status(404).json({ error: 'Design not found' });
        }

        // Update page publish status
        const page = design.pages.find(p => p._id.toString() === pageId);
        if (!page) {
            return res.status(404).json({ error: 'Page not found' });
        }

        page.isPublished = true;
        page.publishedAt = new Date();

        await design.save();

        res.json({
            success: true,
            publishedAt: page.publishedAt
        });
    } catch (error) {
        console.error('Error publishing page:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// ASSETS ENDPOINTS
// ============================================

// GET assets
router.get('/assets', async (req, res) => {
    try {
        const { storeId, category } = req.query;

        // Validate store ownership
        const store = await Store.findById(storeId);
        if (!store) return res.status(404).json({ error: 'Store not found' });
        if (store.ownerUserId.toString() !== req.userId.toString()) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        let query = { storeId };
        if (category && category !== 'all') {
            query.category = category;
        }

        const assets = await require('../models/StorefrontAsset')
            .find(query)
            .sort({ createdAt: -1 });

        res.json(assets);
    } catch (error) {
        console.error('Error fetching assets:', error);
        res.status(500).json({ error: error.message });
    }
});

// DELETE asset
router.delete('/assets/:assetId', async (req, res) => {
    try {
        const { assetId } = req.params;
        const { storeId } = req.query;

        // Validate store ownership
        const store = await Store.findById(storeId);
        if (!store) return res.status(404).json({ error: 'Store not found' });
        if (store.ownerUserId.toString() !== req.userId.toString()) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        await require('../models/StorefrontAsset').deleteOne({
            _id: assetId,
            storeId
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting asset:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;

