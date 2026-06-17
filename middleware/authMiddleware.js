const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Protect routes
exports.protect = async (req, res, next) => {
    // Top-Level Check: Shield backend if DB is disconnected
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({ success: false, message: 'Database temporarily unavailable. Please try again shortly.' });
    }

    let token;

    if (
        req.headers.authorization &&
        req.headers.authorization.startsWith('Bearer')
    ) {
        // Set token from Bearer token in header
        token = req.headers.authorization.split(' ')[1];
    }

    // Make sure token exists
    if (!token) {
        return res.status(401).json({ success: false, message: 'No token provided' });
    }

    let decoded;
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
        console.error('Token Verification Error:', err.message);
        return res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }

    try {
        req.user = await User.findById(decoded.id).maxTimeMS(5000); // 5s timeout

        if (!req.user) {
            return res.status(401).json({ success: false, message: 'User not found with this token' });
        }

        if (req.user.status === 'banned') {
            return res.status(403).json({ success: false, message: 'Your account has been suspended. Please contact support.' });
        }

        next();
    } catch (err) {
        console.error('Database connection or lookup error during auth:', err.message);
        return res.status(503).json({ success: false, message: 'Database temporarily unavailable. Please try again shortly.' });
    }
};

// Optional authentication (for guest checkout)
exports.optional = async (req, res, next) => {
    let token;

    if (
        req.headers.authorization &&
        req.headers.authorization.startsWith('Bearer')
    ) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        return next();
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = await User.findById(decoded.id);
    } catch (err) {
        // Invalid token - proceed as guest
    }
    next();
};

// Grant access to specific roles
exports.authorize = (...roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: `User role ${req.user.role} is not authorized to access this route`
            });
        }
        next();
    };
};
