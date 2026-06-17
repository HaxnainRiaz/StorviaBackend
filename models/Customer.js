const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name: { type: String, default: '' },
    email: { type: String, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    status: { type: String, enum: ['active', 'banned'], default: 'active' },
    lastOrderAt: Date,
    totalOrders: { type: Number, default: 0 },
    totalSpent: { type: Number, default: 0 }
}, { timestamps: true });

customerSchema.index({ storeId: 1, phone: 1 });
customerSchema.index({ storeId: 1, email: 1 });

module.exports = mongoose.models.Customer || mongoose.model('Customer', customerSchema);
