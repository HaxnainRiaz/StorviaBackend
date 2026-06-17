const User = require('../models/User');
const Order = require('../models/Order');
const { createLog } = require('./auditController');

// @desc    Get all users (Admin Only)
// @route   GET /api/users
// @access  Private/Admin
exports.getUsers = async (req, res) => {
    try {
        const users = await User.find({ role: 'customer' }).sort('-createdAt');
        res.status(200).json({ success: true, data: users });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Get all staff (Admin Only)
// @route   GET /api/users/staff
// @access  Private/Admin
exports.getStaff = async (req, res) => {
    try {
        const staff = await User.find({ role: { $ne: 'customer' } }).sort('-createdAt');
        res.status(200).json({ success: true, data: staff });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Update user status / Ban user (Admin Only)
exports.updateUser = async (req, res) => {
    try {
        const user = await User.findByIdAndUpdate(req.params.id, req.body, {
            new: true,
            runValidators: true
        });

        if (req.body.status) {
            await createLog(req.user.id, 'User Status Update', `Updated user status to ${req.body.status}: ${user.email}`);
        }

        res.status(200).json({ success: true, data: user });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Update user profile
// @route   PUT /api/users/profile
// @access  Private
exports.updateProfile = async (req, res) => {
    try {
        const fieldsToUpdate = {
            name: req.body.name,
            avatar: req.body.avatar,
            phone: req.body.phone,
            gender: req.body.gender
        };

        const user = await User.findByIdAndUpdate(req.user.id, fieldsToUpdate, {
            new: true,
            runValidators: true
        });

        res.status(200).json({ success: true, data: user });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// --- CUSTOMER ACTIONS ---

// @desc    Add to wishlist
// @route   POST /api/users/wishlist/:productId
// @access  Private
exports.addToWishlist = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (user.wishlist.includes(req.params.productId)) {
            return res.status(400).json({ success: false, message: 'Already in wishlist' });
        }
        user.wishlist.push(req.params.productId);
        await user.save();
        res.status(200).json({ success: true, data: user.wishlist });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Remove from wishlist
// @route   DELETE /api/users/wishlist/:productId
// @access  Private
exports.removeFromWishlist = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        user.wishlist = user.wishlist.filter(id => id.toString() !== req.params.productId);
        await user.save();
        res.status(200).json({ success: true, data: user.wishlist });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Add address
// @route   POST /api/users/addresses
// @access  Private
exports.addAddress = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (req.body.isDefault) {
            user.addresses.forEach(addr => addr.isDefault = false);
        }
        user.addresses.push(req.body);
        await user.save();
        res.status(200).json({ success: true, data: user.addresses });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Delete address
// @route   DELETE /api/users/addresses/:addressId
// @access  Private
exports.deleteAddress = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        user.addresses = user.addresses.filter(addr => addr._id.toString() !== req.params.addressId);
        await user.save();
        res.status(200).json({ success: true, data: user.addresses });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Get my orders
// @route   GET /api/users/my-orders
// @access  Private
exports.getMyOrders = async (req, res) => {
    try {
        const orders = await Order.find({ user: req.user.id }).sort('-createdAt');
        res.status(200).json({ success: true, data: orders });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Delete user (Admin Only)
exports.deleteUser = async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const userEmail = user.email;
        await User.findByIdAndDelete(req.params.id);

        // Audit Log
        if (req.user) {
            await createLog(req.user.id, 'User Deletion', `Deleted user account: ${userEmail}`);
        }

        res.status(200).json({ success: true, data: {} });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};
