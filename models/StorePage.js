const mongoose = require('mongoose');

const storePageSchema = new mongoose.Schema({
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    title: { type: String, required: true },
    slug: { type: String, required: true, lowercase: true, trim: true },
    content: { type: String, default: '' },
    bannerImage: { type: String, default: '' },
    templateType: {
        type: String,
        enum: ['about_us', 'contact_us', 'shipping_policy', 'return_policy', 'privacy_policy', 'terms_and_conditions', 'faq', 'size_guide', 'warranty_policy', 'custom'],
        default: 'custom'
    },
    seoId: { type: mongoose.Schema.Types.ObjectId, ref: 'SEO' },
    status: { type: String, enum: ['draft', 'published'], default: 'draft', index: true }
}, { timestamps: true });

storePageSchema.index({ storeId: 1, slug: 1 }, { unique: true });

module.exports = mongoose.models.StorePage || mongoose.model('StorePage', storePageSchema);
