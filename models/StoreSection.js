const mongoose = require('mongoose');

const storeSectionSchema = new mongoose.Schema({
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    sectionType: {
        type: String,
        enum: ['announcement_bar', 'header', 'hero_banner', 'category_grid', 'featured_products', 'new_arrivals', 'best_sellers', 'discount_products', 'collection_banner', 'testimonials', 'reviews', 'brand_story', 'faq', 'social_section', 'newsletter', 'footer'],
        required: true
    },
    title: { type: String, default: '' },
    content: { type: Object, default: {} },
    settings: { type: Object, default: {} },
    sortOrder: { type: Number, default: 0 },
    isEnabled: { type: Boolean, default: true },
    visibility: { type: String, enum: ['public', 'hidden'], default: 'public' }
}, { timestamps: true });

storeSectionSchema.index({ storeId: 1, sortOrder: 1 });

module.exports = mongoose.models.StoreSection || mongoose.model('StoreSection', storeSectionSchema);
