const socketUtil = require('../utils/socket');
const Product = require('../models/Product');
const mongoose = require('mongoose');
const Category = require('../models/Category');
const { createLog } = require('./auditController');

const storeFilter = (req, extra = {}) => req.storeId ? { ...extra, storeId: req.storeId } : extra;
const mutableBulkFields = ['status', 'category', 'tags', 'price', 'salePrice', 'stock', 'isFeatured', 'isBestSeller', 'isNewArrival', 'productType'];

function syncProductTypeFlags(body) {
    if (body.productType) {
        body.isFeatured = body.productType === 'featured';
        body.isBestSeller = body.productType === 'best_seller';
        body.isNewArrival = body.productType === 'new_arrival';
        return body;
    }
    if (body.isFeatured) body.productType = 'featured';
    else if (body.isBestSeller) body.productType = 'best_seller';
    else if (body.isNewArrival) body.productType = 'new_arrival';
    else if (body.productType === undefined) body.productType = 'standard';
    return body;
}

function normalizeProductPayload(body) {
    if (body.isBestseller !== undefined) body.isBestSeller = body.isBestseller;

    syncProductTypeFlags(body);

    if (body.seo) {
        body.metaTitle = body.seo.metaTitle || '';
        body.metaDescription = body.seo.metaDescription || '';
        delete body.seo;
    }

    if (body.mainImage !== undefined || body.secondaryImages !== undefined) {
        const secondary = Array.isArray(body.secondaryImages) ? body.secondaryImages : [];
        const main = body.mainImage || '';
        body.images = [main, ...secondary].filter(Boolean);
        delete body.mainImage;
        delete body.secondaryImages;
    }

    if (body.category !== undefined && body.category !== null && !Array.isArray(body.category)) {
        body.category = body.category ? [body.category] : [];
    }

    if (body.visibilityStatus) {
        body.status = body.visibilityStatus === 'published' ? 'active' : 'inactive';
        delete body.visibilityStatus;
    }

    delete body.isBestseller;
    return body;
}

// ... (keep getProducts and getProduct same)

// @desc    Get all products
// @route   GET /api/products
// @access  Public
exports.getProducts = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;

        const filter = storeFilter(req);
        const total = await Product.countDocuments(filter);
        const products = await Product.find(filter)
            .populate('category')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        res.status(200).json({
            success: true,
            total,
            data: products,
            pagination: {
                total,
                page,
                pages: Math.ceil(total / limit),
                limit
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Get single product
// @route   GET /api/products/:id
// @access  Public
exports.getProduct = async (req, res) => {
    try {
        const product = await Product.findOne(storeFilter(req, { _id: req.params.id }));
        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }
        res.status(200).json({ success: true, data: product });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Create product (Admin Only)
// @route   POST /api/products
// @access  Private/Admin
exports.createProduct = async (req, res) => {
    try {
        delete req.body.storeId;
        if (req.storeId) req.body.storeId = req.storeId;

        normalizeProductPayload(req.body);

        if (req.body.howToUse !== undefined) req.body.usage = req.body.howToUse;

        // Map Category String or Object to ID
        if (req.body.category) {
            const cats = Array.isArray(req.body.category) ? req.body.category : [req.body.category];
            const validIds = [];

            for (const c of cats) {
                if (mongoose.Types.ObjectId.isValid(c)) {
                    validIds.push(c);
                } else if (typeof c === 'string') {
                    const categoryDoc = await Category.findOne({
                        ...(req.storeId && { storeId: req.storeId }),
                        title: { $regex: new RegExp(`^${c}$`, 'i') }
                    });
                    if (categoryDoc) validIds.push(categoryDoc._id);
                }
            }
            req.body.category = validIds;
        }

        console.log('Product payload processed');

        let product = await Product.create(req.body);
        product = await product.populate('category');

        // Audit Log
        await createLog(req.user.id, 'product_create', `Created product: ${product.title} (${product.slug})`, { storeId: req.storeId, entity: 'product', entityId: product._id, req });

        // Emit Socket Event
        try {
            const io = socketUtil.getIO();
            req.storeId ? io.to(`store:${req.storeId}`).emit('product:created', product) : io.emit('product:create', product);
        } catch (e) { console.error('Socket Emit Error:', e); }

        res.status(201).json({ success: true, data: product });
    } catch (err) {
        console.error('Create Product Error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Update product (Admin Only)
// @route   PUT /api/products/:id
// @access  Private/Admin
exports.updateProduct = async (req, res) => {
    try {
        delete req.body.storeId;

        normalizeProductPayload(req.body);

        if (req.body.howToUse !== undefined) req.body.usage = req.body.howToUse;

        // Map Category String or Object to ID (Support Multiple)
        if (req.body.category) {
            const cats = Array.isArray(req.body.category) ? req.body.category : [req.body.category];
            const validIds = [];

            for (const c of cats) {
                if (mongoose.Types.ObjectId.isValid(c)) {
                    validIds.push(c);
                } else if (typeof c === 'string') {
                    const categoryDoc = await Category.findOne({
                        ...(req.storeId && { storeId: req.storeId }),
                        title: { $regex: new RegExp(`^${c}$`, 'i') }
                    });
                    if (categoryDoc) validIds.push(categoryDoc._id);
                }
            }
            req.body.category = validIds;
        }

        let product = await Product.findOne(storeFilter(req, { _id: req.params.id }));
        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        product = await Product.findOneAndUpdate(storeFilter(req, { _id: req.params.id }), req.body, {
            new: true,
            runValidators: true
        }).populate('category');

        // Audit Log
        await createLog(req.user.id, 'product_update', `Updated product: ${product.title}`, { storeId: req.storeId, entity: 'product', entityId: product._id, req });

        // Emit Socket Event
        try {
            const io = socketUtil.getIO();
            req.storeId ? io.to(`store:${req.storeId}`).emit('product:updated', product) : io.emit('product:update', product);
        } catch (e) { console.error('Socket Emit Error:', e); }

        res.status(200).json({ success: true, data: product });
    } catch (err) {
        console.error('Update Product Error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Delete product (Admin Only)
// @route   DELETE /api/products/:id
// @access  Private/Admin
exports.deleteProduct = async (req, res) => {
    try {
        const product = await Product.findOne(storeFilter(req, { _id: req.params.id }));
        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        const productTitle = product.title;
        await product.deleteOne();

        // Audit Log
        await createLog(req.user.id, 'product_delete', `Deleted product: ${productTitle}`, { storeId: req.storeId, entity: 'product', entityId: req.params.id, req });

        // Emit Socket Event
        try {
            const io = socketUtil.getIO();
            req.storeId ? io.to(`store:${req.storeId}`).emit('product:deleted', { id: req.params.id }) : io.emit('product:delete', { id: req.params.id });
        } catch (e) { console.error('Socket Emit Error:', e); }

        res.status(200).json({ success: true, data: {} });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.bulkUpdateProducts = async (req, res) => {
    try {
        if (!req.storeId) {
            return res.status(403).json({ success: false, message: 'Store context is required' });
        }

        const { productIds = [], updates = {} } = req.body;
        if (!Array.isArray(productIds) || productIds.length === 0) {
            return res.status(400).json({ success: false, message: 'productIds must be a non-empty array' });
        }

        const payload = {};
        mutableBulkFields.forEach(field => {
            if (updates[field] !== undefined) payload[field] = updates[field];
        });

        if (!Object.keys(payload).length) {
            return res.status(400).json({ success: false, message: 'No supported update fields provided' });
        }

        const result = await Product.updateMany(
            { _id: { $in: productIds }, storeId: req.storeId },
            { $set: payload },
            { runValidators: true }
        );

        await createLog(req.user.id, 'product_bulk_update', `Bulk updated ${result.modifiedCount || 0} products`, {
            storeId: req.storeId,
            entity: 'product',
            req
        });

        try {
            socketUtil.getIO().to(`store:${req.storeId}`).emit('product:bulk-updated', {
                ids: productIds,
                updates: payload
            });
        } catch (error) { }

        res.json({
            success: true,
            matchedCount: result.matchedCount || 0,
            modifiedCount: result.modifiedCount || 0
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};
