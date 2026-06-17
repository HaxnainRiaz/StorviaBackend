const mongoose = require('mongoose');

const storeSchema = new mongoose.Schema({
    ownerUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    storeName: { type: String, required: true, trim: true },
    storeSlug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    subdomain: { type: String, required: true, unique: true, lowercase: true, trim: true },
    customDomain: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
    businessType: { type: String, default: '' },
    storeCategory: { type: String, default: '' },
    description: { type: String, default: '' },
    logo: { type: String, default: '' },
    favicon: { type: String, default: '' },
    status: {
        type: String,
        enum: ['draft', 'published', 'paused', 'suspended'],
        default: 'draft',
        index: true
    },
    setupStatus: {
        type: String,
        enum: ['not_started', 'in_progress', 'completed'],
        default: 'not_started'
    },
    setupCompletedSteps: {
        type: [String],
        default: []
    },
    currency: { type: String, default: 'PKR' },
    timezone: { type: String, default: 'Asia/Karachi' },
    language: { type: String, default: 'en' },
    businessEmail: { type: String, default: '' },
    businessPhone: { type: String, default: '' },
    whatsappNumber: { type: String, default: '' },
    businessAddress: {
        street: String,
        city: String,
        state: String,
        postalCode: String,
        country: String
    },
    socialLinks: {
        facebook: String,
        instagram: String,
        tiktok: String,
        youtube: String,
        website: String
    }
}, { timestamps: true });

storeSchema.methods.canPublish = function () {
    const completed = new Set(this.setupCompletedSteps || []);
    const has = (...aliases) => aliases.some(step => completed.has(step));
    const required = [
        ['store_identity', 'store_name', 'store_url'],
        ['delivery_settings'],
        ['payment_settings', 'payment_method'],
        ['first_product']
    ];
    return required.every(aliases => has(...aliases));
};

module.exports = mongoose.models.Store || mongoose.model('Store', storeSchema);
