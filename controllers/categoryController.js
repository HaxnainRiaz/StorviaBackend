const Category = require('../models/Category');
const { createLog } = require('./auditController');
const socketUtil = require('../utils/socket');
const storeFilter = (req, extra = {}) => req.storeId ? { ...extra, storeId: req.storeId } : extra;

// @desc    Get all categories
// @route   GET /api/categories
// @access  Public
exports.getCategories = async (req, res) => {
    try {
        const categories = await Category.find(storeFilter(req));
        res.status(200).json({ success: true, data: categories });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Create category
// @route   POST /api/categories
// @access  Private/Admin
exports.createCategory = async (req, res) => {
    try {
        delete req.body.storeId;
        const category = await Category.create({ ...req.body, ...(req.storeId && { storeId: req.storeId }) });

        // Audit Log
        await createLog(req.user.id, 'category_create', `Created category: ${category.title}`, { storeId: req.storeId, entity: 'category', entityId: category._id, req });

        // Emit Socket Event
        try {
            const io = socketUtil.getIO();
            req.storeId ? io.to(`store:${req.storeId}`).emit('category:updated', category) : io.emit('category:update', category);
        } catch (e) { console.error('Socket Emit Error:', e); }

        res.status(201).json({ success: true, data: category });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Update category
// @route   PUT /api/categories/:id
// @access  Private/Admin
exports.updateCategory = async (req, res) => {
    try {
        delete req.body.storeId;
        const category = await Category.findOneAndUpdate(storeFilter(req, { _id: req.params.id }), req.body, {
            new: true,
            runValidators: true
        });

        // Audit Log
        await createLog(req.user.id, 'category_update', `Updated category: ${category.title}`, { storeId: req.storeId, entity: 'category', entityId: category._id, req });

        // Emit Socket Event
        try {
            const io = socketUtil.getIO();
            req.storeId ? io.to(`store:${req.storeId}`).emit('category:updated', category) : io.emit('category:update', category);
        } catch (e) { console.error('Socket Emit Error:', e); }

        res.status(200).json({ success: true, data: category });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Delete category
// @route   DELETE /api/categories/:id
// @access  Private/Admin
exports.deleteCategory = async (req, res) => {
    try {
        const category = await Category.findOne(storeFilter(req, { _id: req.params.id }));
        if (category) {
            const categoryTitle = category.title;
            await Category.findOneAndDelete(storeFilter(req, { _id: req.params.id }));

            // Audit Log
            await createLog(req.user.id, 'category_delete', `Deleted category: ${categoryTitle}`, { storeId: req.storeId, entity: 'category', entityId: req.params.id, req });

            // Emit Socket Event
            try {
                const io = socketUtil.getIO();
                req.storeId ? io.to(`store:${req.storeId}`).emit('category:updated', { id: req.params.id, delete: true }) : io.emit('category:update', { id: req.params.id, delete: true });
            } catch (e) { console.error('Socket Emit Error:', e); }
        }
        res.status(200).json({ success: true, data: {} });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};
