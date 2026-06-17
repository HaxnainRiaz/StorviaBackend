const express = require('express');
const { register, registerSeller, login, getMe, updateFcmToken } = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/register', register);
router.post('/register-seller', registerSeller);
router.post('/login', login);
router.get('/me', protect, getMe);
router.post('/fcm-token', protect, updateFcmToken);
router.post('/save-fcm-token', protect, updateFcmToken);
router.post('/logout', protect, (req, res) => res.status(200).json({ success: true, message: 'Logged out' }));

module.exports = router;
