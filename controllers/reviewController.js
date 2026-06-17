const socketUtil = require('../utils/socket');
const Review = require('../models/Review');
const { createLog } = require('./auditController');
const { sendPushNotification } = require('../utils/firebase');
const User = require('../models/User');
const storeFilter = (req, extra = {}) => req.storeId ? { ...extra, storeId: req.storeId } : extra;

// ... (keep getReviews, updateReview, deleteReview, getProductReviews same)

// @desc    Get all reviews
// @route   GET /api/reviews
// @access  Private/Admin
exports.getReviews = async (req, res) => {
    try {
        const reviews = await Review.find(storeFilter(req))
            .populate('product', 'title')
            .populate('user', 'name email')
            .sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: reviews });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Update review (Admin reply)
// @route   PUT /api/reviews/:id
// @access  Private/Admin
exports.updateReview = async (req, res) => {
    try {
        const updateData = {};
        if (req.body.adminReply !== undefined) updateData.adminReply = req.body.adminReply;
        if (req.body.status !== undefined) updateData.status = req.body.status;

        const review = await Review.findOneAndUpdate(storeFilter(req, { _id: req.params.id }), updateData, { new: true }).populate('product', 'title');

        // Audit Log
        await createLog(req.user.id, 'review_moderation', `Moderated review ${review._id}`, { storeId: req.storeId, entity: 'review', entityId: review._id, req });

        // Emit Socket Event
        try {
            const io = socketUtil.getIO();
            req.storeId ? io.to(`store:${req.storeId}`).emit('review:updated', review) : io.emit('review:update', review);
        } catch (e) { console.error('Socket Emit Error:', e); }

        res.status(200).json({ success: true, data: review });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Delete review
// @route   DELETE /api/reviews/:id
// @access  Private/Admin
exports.deleteReview = async (req, res) => {
    try {
        const review = await Review.findOne(storeFilter(req, { _id: req.params.id }));
        if (review) {
            const productId = review.product;
            await Review.findOneAndDelete(storeFilter(req, { _id: req.params.id }));
            await Review.getAverageRating(productId);

            // Audit Log
            await createLog(req.user.id, 'review_moderation', `Deleted review ${req.params.id}`, { storeId: req.storeId, entity: 'review', entityId: req.params.id, req });
        }
        res.status(200).json({ success: true, data: {} });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Get reviews for a product
// @route   GET /api/reviews/product/:productId
// @access  Public
exports.getProductReviews = async (req, res) => {
    try {
        const reviews = await Review.find({ product: req.params.productId, status: 'approved', ...(req.storeId && { storeId: req.storeId }) });
        res.status(200).json({
            success: true,
            count: reviews.length,
            data: reviews
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: 'Server Error'
        });
    }
};

// @desc    Add review (Customer)
// @route   POST /api/reviews
// @access  Private
exports.addReview = async (req, res) => {
    try {
        if (req.user) {
            req.body.user = req.user.id;
            // Use user's name if they are logged in and name wasn't provided
            if (!req.body.name && req.user.name) {
                req.body.name = req.user.name;
            }
        }

        const review = await Review.create({ ...req.body, ...(req.storeId && { storeId: req.storeId }) });

        // Populate if needed for broadcasting
        const populatedReview = await Review.findById(review._id).populate('product', 'title');

        // Emit Socket Event
        try {
            const io = socketUtil.getIO();
            req.storeId ? io.to(`store:${req.storeId}`).emit('review:new', populatedReview) : io.emit('review:new', populatedReview);

            // Push Notification for Admins

            const admins = await User.find({ role: 'admin' });
            const adminTokens = admins.flatMap(a => a.fcmTokens || []);

            if (adminTokens.length > 0) {
                sendPushNotification(adminTokens, {
                    title: '⭐ New Product Review',
                    body: `${populatedReview.name} left a ${populatedReview.rating}-star review for ${populatedReview.product.title}`,
                    data: {
                        type: 'NEW_REVIEW',
                        reviewId: populatedReview._id.toString()
                    }
                });
            }
        } catch (e) { console.error('Notification Error:', e); }

        res.status(201).json({ success: true, data: review });
    } catch (err) {
        if (err.code === 11000) {
            return res.status(400).json({
                success: false,
                message: 'You have already submitted a review for this product.'
            });
        }
        res.status(500).json({ success: false, message: err.message });
    }
};
