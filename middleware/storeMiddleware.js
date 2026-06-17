const jwt = require('jsonwebtoken');
const Store = require('../models/Store');
const StoreMember = require('../models/StoreMember');
const User = require('../models/User');
const { getRolePermissions } = require('../constants/permissions');

const mergePermissions = (role, permissions = []) => {
    return Array.from(new Set([...getRolePermissions(role), ...(permissions || [])]));
};

exports.resolveActiveStore = async (req, res, next) => {
    try {
        const requestedStoreId = req.headers['x-store-id'] || req.query.storeId;
        const memberQuery = {
            userId: req.user._id,
            status: 'active'
        };

        if (requestedStoreId) {
            memberQuery.storeId = requestedStoreId;
        }

        const membership = await StoreMember.findOne(memberQuery).sort({ createdAt: 1 });
        if (!membership) {
            return res.status(403).json({ success: false, message: 'No active store membership found' });
        }

        const store = await Store.findById(membership.storeId);
        if (!store) {
            return res.status(404).json({ success: false, message: 'Store not found' });
        }

        if (store.status === 'suspended') {
            return res.status(403).json({ success: false, message: 'This store has been suspended' });
        }

        req.store = store;
        req.storeId = store._id;
        req.storeMember = membership;
        req.storeRole = membership.role;
        req.storePermissions = mergePermissions(membership.role, membership.permissions);
        next();
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.requireStorePermission = (...permissions) => {
    return (req, res, next) => {
        if (!req.storeMember) {
            return res.status(403).json({ success: false, message: 'Store membership required' });
        }

        if (req.storeRole === 'owner') {
            return next();
        }

        const allowed = permissions.every(permission => req.storePermissions.includes(permission));
        if (!allowed) {
            return res.status(403).json({
                success: false,
                message: `Missing store permission: ${permissions.join(', ')}`
            });
        }

        next();
    };
};

exports.requireStoreRole = (...roles) => {
    return (req, res, next) => {
        if (!req.storeMember || !roles.includes(req.storeRole)) {
            return res.status(403).json({ success: false, message: 'Store role is not authorized' });
        }
        next();
    };
};

exports.blockSellingIfStorePaused = (req, res, next) => {
    if (req.store && ['paused', 'suspended'].includes(req.store.status)) {
        return res.status(403).json({ success: false, message: 'Store is not accepting selling operations' });
    }
    next();
};

exports.resolvePublicStore = async (req, res, next) => {
    try {
        const slug = req.params.storeSlug || req.query.storeSlug;
        const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(':')[0].toLowerCase();

        const candidates = [];
        if (slug) {
            candidates.push({ storeSlug: String(slug).toLowerCase() });
            candidates.push({ subdomain: String(slug).toLowerCase() });
        }
        if (host) {
            candidates.push({ customDomain: host });
            candidates.push({ subdomain: host.split('.')[0] });
        }

        let store = candidates.length
            ? await Store.findOne({ $or: candidates, status: 'published' })
            : null;

        if (!store && candidates.length && req.headers.authorization?.startsWith('Bearer ')) {
            try {
                const decoded = jwt.verify(req.headers.authorization.split(' ')[1], process.env.JWT_SECRET);
                const draftStore = await Store.findOne({ $or: candidates });
                if (draftStore) {
                    const membership = await StoreMember.findOne({
                        userId: decoded.id,
                        storeId: draftStore._id,
                        status: 'active'
                    });
                    if (membership) {
                        store = draftStore;
                        req.storePreview = true;
                    }
                }
            } catch (_) {
                // Invalid preview authentication falls through to the public 404.
            }
        }

        if (!store) {
            return res.status(404).json({ success: false, message: 'Storefront not found' });
        }

        req.publicStore = store;
        req.store = store;
        req.storeId = store._id;
        next();
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.optionalStorefrontUser = async (req, res, next) => {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) return next();

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = await User.findById(decoded.id);
    } catch (error) {
        req.user = null;
    }

    next();
};

exports.getStoreMembershipContext = async (userId, requestedStoreId) => {
    const query = { userId, status: 'active' };
    if (requestedStoreId) query.storeId = requestedStoreId;

    const membership = await StoreMember.findOne(query).sort({ createdAt: 1 });
    if (!membership) return null;

    const store = await Store.findById(membership.storeId);
    if (!store) return null;

    return {
        store,
        membership,
        role: membership.role,
        permissions: mergePermissions(membership.role, membership.permissions)
    };
};
