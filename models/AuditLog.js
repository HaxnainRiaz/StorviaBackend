const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
    storeId: {
        type: mongoose.Schema.ObjectId,
        ref: 'Store',
        index: true
    },
    admin: {
        type: mongoose.Schema.ObjectId,
        ref: 'User',
        required: true
    },
    userId: {
        type: mongoose.Schema.ObjectId,
        ref: 'User'
    },
    action: {
        type: String,
        required: true
    },
    details: {
        type: String,
        required: true
    },
    entity: { type: String, default: '' },
    entityId: { type: mongoose.Schema.ObjectId },
    ipAddress: { type: String, default: '' },
    userAgent: { type: String, default: '' }
}, { timestamps: true });

auditLogSchema.index({ storeId: 1, createdAt: -1 });

module.exports = mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);
