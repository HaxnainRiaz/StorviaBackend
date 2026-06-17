const express = require('express');
const {
    getUsers,
    getStaff,
    updateUser,
    addToWishlist,
    removeFromWishlist,
    addAddress,
    deleteAddress,
    getMyOrders,
    updateProfile,
    deleteUser
} = require('../controllers/userController');
const { protect, authorize } = require('../middleware/authMiddleware');

const router = express.Router();
const storeScopedOnly = (req, res) => res.status(410).json({
    success: false,
    message: 'User/customer management is store-scoped. Use /api/seller/customers or /api/seller/staff.'
});

// Admin Routes
router.get('/', protect, storeScopedOnly);
router.get('/staff', protect, storeScopedOnly);
router.put('/:id', protect, storeScopedOnly);
router.delete('/:id', protect, storeScopedOnly);

// Customer Routes
router.get('/my-orders', protect, getMyOrders);
router.post('/wishlist/:productId', protect, addToWishlist);
router.delete('/wishlist/:productId', protect, removeFromWishlist);
router.post('/addresses', protect, addAddress);
router.delete('/addresses/:addressId', protect, deleteAddress);
router.put('/profile', protect, updateProfile);

module.exports = router;
