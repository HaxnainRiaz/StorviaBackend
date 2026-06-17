const mongoose = require('mongoose');

const seoSchema = new mongoose.Schema({
    storeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Store',
        required: false,
        index: true
    },
    entityType: {
        type: String,
        enum: ['store', 'product', 'category', 'collection', 'page', 'blog'],
        required: true
    },
    entityId: {
        type: mongoose.Schema.ObjectId,
        required: true,
        index: true
    },
    metaTitle: {
        type: String,
        required: true
    },
    metaDescription: {
        type: String,
        required: true
    },
    slug: { type: String, default: '' },
    imageAltText: { type: String, default: '' },
    noIndex: { type: Boolean, default: false },
    socialTitle: { type: String, default: '' },
    socialDescription: { type: String, default: '' },
    socialImage: { type: String, default: '' },
    keywordTarget: { type: String, default: '' },
    notes: { type: String, default: '' }
}, { timestamps: true });

seoSchema.index({ storeId: 1, entityType: 1, entityId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.models.SEO || mongoose.model('SEO', seoSchema);
