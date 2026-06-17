const User = require('../models/User');
const jwt = require('jsonwebtoken');
const Store = require('../models/Store');
const StoreMember = require('../models/StoreMember');
const StoreSettings = require('../models/StoreSettings');
const StoreTheme = require('../models/StoreTheme');
const StoreNavigation = require('../models/StoreNavigation');
const StoreDomain = require('../models/StoreDomain');
const { getRolePermissions } = require('../constants/permissions');
const { slugify } = require('../utils/slug');
const { getStoreMembershipContext } = require('../middleware/storeMiddleware');

// @desc    Register a new user (Role defaults to 'user')
// @route   POST /api/auth/register
// @access  Public
exports.register = async (req, res) => {
    try {
        const { name, email, password } = req.body;

        const userExists = await User.findOne({ email });
        if (userExists) {
            return res.status(400).json({ success: false, message: 'User already exists' });
        }

        const user = await User.create({
            name,
            email,
            password,
            role: 'customer'
        });

        sendTokenResponse(user, 201, res);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.registerSeller = async (req, res) => {
    try {
        const {
            name,
            email,
            password,
            storeName,
            storeSlug,
            businessType,
            storeCategory,
            businessPhone,
            whatsappNumber
        } = req.body;

        if (!name || !email || !password || !storeName) {
            return res.status(400).json({ success: false, message: 'Name, email, password, and storeName are required' });
        }

        const userExists = await User.findOne({ email: String(email).toLowerCase() });
        if (userExists) {
            return res.status(400).json({ success: false, message: 'User already exists' });
        }

        const baseSlug = slugify(storeSlug || storeName);
        if (!baseSlug) {
            return res.status(400).json({ success: false, message: 'A valid store slug is required' });
        }

        const existingStore = await Store.findOne({
            $or: [{ storeSlug: baseSlug }, { subdomain: baseSlug }]
        });
        if (existingStore) {
            return res.status(400).json({ success: false, message: 'Store slug or subdomain is already taken' });
        }

        const user = await User.create({
            name,
            email,
            password,
            role: 'user',
            phone: businessPhone
        });

        const store = await Store.create({
            ownerUserId: user._id,
            storeName,
            storeSlug: baseSlug,
            subdomain: baseSlug,
            businessType: businessType || '',
            storeCategory: storeCategory || '',
            businessEmail: email,
            businessPhone: businessPhone || '',
            whatsappNumber: whatsappNumber || '',
            setupStatus: 'in_progress',
            setupCompletedSteps: ['store_identity']
        });

        await StoreMember.create({
            storeId: store._id,
            userId: user._id,
            role: 'owner',
            permissions: getRolePermissions('owner'),
            status: 'active',
            joinedAt: new Date()
        });

        await Promise.all([
            StoreSettings.create({ storeId: store._id }),
            StoreTheme.create({ storeId: store._id }),
            StoreDomain.create({ storeId: store._id, storeSlug: store.storeSlug, subdomain: store.subdomain }),
            StoreNavigation.create({ storeId: store._id, menuName: 'header', items: [], status: 'draft' }),
            StoreNavigation.create({ storeId: store._id, menuName: 'footer', items: [], status: 'draft' })
        ]);

        sendTokenResponse(user, 201, res, {
            activeStore: store,
            role: 'owner',
            permissions: getRolePermissions('owner')
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Login user or admin
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res) => {
    try {
        let { email, password } = req.body;
        email = email ? email.toLowerCase() : email;
        console.log('Login attempt received');

        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Please provide email and password' });
        }

        const user = await User.findOne({ email }).select('+password');

        if (!user) {
            console.log('Login failed: User not found');
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        const isMatch = await user.matchPassword(password);
        if (!isMatch) {
            console.log('Login failed: Credentials mismatch');
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        if (user.status === 'banned') {
            console.log('Login failed: Account is banned');
            return res.status(403).json({ success: false, message: 'Your account has been suspended. Please contact support.' });
        }

        console.log(`Login successful (Role: ${user.role})`);
        sendTokenResponse(user, 200, res);
    } catch (err) {
        console.error('Login Error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Get current logged in user
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        const requestedStoreId = req.headers['x-store-id'] || req.query.storeId;
        const storeContext = await getStoreMembershipContext(req.user.id, requestedStoreId);

        res.status(200).json({
            success: true,
            data: {
                user,
                activeStore: storeContext?.store || null,
                role: storeContext?.role || user.role,
                permissions: storeContext?.permissions || [],
                setupStatus: storeContext?.store?.setupStatus || null
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Update FCM Token for push notifications
// @route   POST /api/auth/fcm-token
// @access  Private
exports.updateFcmToken = async (req, res) => {
    try {
        const { fcmToken } = req.body;

        if (!fcmToken) {
            return res.status(400).json({ success: false, message: 'FCM Token is required' });
        }

        const user = await User.findById(req.user.id);

        if (!user.fcmTokens.includes(fcmToken)) {
            user.fcmTokens.push(fcmToken);
            await user.save();
        }

        res.status(200).json({ success: true, message: 'FCM Token updated successfully' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// Helper to send token
const sendTokenResponse = (user, statusCode, res, extra = {}) => {
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
        expiresIn: '30d'
    });

    res.status(statusCode).json({
        success: true,
        token,
        user: {
            id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            status: user.status
        },
        ...extra
    });
};
