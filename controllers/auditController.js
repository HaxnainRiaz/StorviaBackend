const AuditLog = require('../models/AuditLog');
require('../models/User'); // Ensure User model is registered for populate

// @desc    Get all audit logs
// @access  Private/Admin
exports.getAuditLogs = async (req, res) => {
    try {
        console.log('Fetching Audit Logs...');
        const filter = req.storeId ? { storeId: req.storeId } : {};
        const logs = await AuditLog.find(filter).populate('admin', 'name email').sort('-createdAt');
        console.log(`Found ${logs.length} logs.`);
        res.status(200).json({ success: true, count: logs.length, data: logs });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Create audit log (usually called internally)
exports.createLog = async (adminId, action, details, meta = {}) => {
    try {
        const log = await AuditLog.create({
            storeId: meta.storeId,
            admin: adminId,
            userId: adminId,
            action,
            details,
            entity: meta.entity || '',
            entityId: meta.entityId,
            ipAddress: meta.req?.ip || '',
            userAgent: meta.req?.headers?.['user-agent'] || ''
        });
        console.log(`[AUDIT] Action: ${action} | Details: ${details}`);
    } catch (err) {
        console.error('Audit Log Error:', err.message);
    }
};
