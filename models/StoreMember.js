const mongoose = require('mongoose');
const { STORE_ROLES } = require('../constants/permissions');

const storeMemberSchema = new mongoose.Schema({
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role: { type: String, enum: STORE_ROLES, required: true },
    permissions: { type: [String], default: [] },
    status: { type: String, enum: ['invited', 'active', 'disabled'], default: 'active', index: true },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    inviteToken: { type: String, select: false },
    joinedAt: { type: Date }
}, { timestamps: true });

storeMemberSchema.index({ storeId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.models.StoreMember || mongoose.model('StoreMember', storeMemberSchema);
