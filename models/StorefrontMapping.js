const mongoose = require('mongoose');

const storefrontMappingSchema = new mongoose.Schema({
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    designImportId: { type: mongoose.Schema.Types.ObjectId, ref: 'DesignImport', required: true, index: true },
    sourceSelector: { type: String, required: true },
    sourceType: {
        type: String,
        enum: ['class', 'id', 'tag'],
        required: true
    },
    targetType: {
        type: String,
        enum: [
            'Header', 'Logo', 'Navigation', 'Hero', 'ProductGrid', 'FeaturedProducts',
            'CollectionLinks', 'CartButton', 'SearchButton', 'Footer', 'ContactSection',
            'PolicyLinks', 'SEOContent'
        ],
        required: true,
        index: true
    },
    targetConfig: { type: Object, default: {} },
    required: { type: Boolean, default: false },
    status: {
        type: String,
        enum: ['mapped', 'unmapped'],
        default: 'unmapped',
        index: true
    }
}, { timestamps: true });

module.exports = mongoose.models.StorefrontMapping || mongoose.model('StorefrontMapping', storefrontMappingSchema);
