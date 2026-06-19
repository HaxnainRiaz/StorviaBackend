const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
    storeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Store',
        required: false,
        index: true
    },
    title: {
        type: String,
        required: [true, 'Please add a product title'],
        trim: true,
    },
    slug: {
        type: String,
        required: true,
        index: true
    },
    description: {
        type: String,
        required: [true, 'Please add a description'],
    },
    ingredients: {
        type: [String],
        default: []
    },
    usage: {
        type: String,
        default: ''
    },
    images: {
        type: [String],
        default: ['https://placehold.co/600x600?text=No+Photo'],
    },
    price: {
        type: Number,
        required: [true, 'Please add a price'],
    },
    salePrice: {
        type: Number,
        default: null
    },
    stock: {
        type: Number,
        required: [true, 'Please add stock count'],
        min: 0,
        default: 0,
    },
    category: [{
        type: mongoose.Schema.ObjectId,
        ref: 'Category',
        required: false
    }],
    tags: {
        type: [String],
        default: []
    },
    concerns: {
        type: [String],
        default: []
    },
    isFeatured: {
        type: Boolean,
        default: false,
    },
    isBestSeller: {
        type: Boolean,
        default: false
    },
    isNewArrival: {
        type: Boolean,
        default: false
    },
    productType: {
        type: String,
        enum: ['standard', 'featured', 'best_seller', 'new_arrival'],
        default: 'standard',
        index: true
    },
    status: {
        type: String,
        enum: ['draft', 'active', 'inactive', 'archived'],
        default: 'active'
    },
    rating: {
        type: Number,
        default: 0,
        min: 0,
        max: 5
    },
    totalReviews: {
        type: Number,
        default: 0
    },
    metaTitle: {
        type: String,
        default: ''
    },
    metaDescription: {
        type: String,
        default: ''
    },
    sku: { type: String, default: '' },
    barcode: { type: String, default: '' },
    variants: { type: [Object], default: [] },
    weight: { type: Number, default: null },
    dimensions: {
        length: Number,
        width: Number,
        height: Number,
        unit: { type: String, default: 'cm' }
    },
    warranty: { type: String, default: '' },
    returnEligible: { type: Boolean, default: true },
    specifications: { type: [Object], default: [] },
    faqs: { type: [Object], default: [] },
    relatedProducts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    mediaGallery: { type: [String], default: [] },
    imageAltText: { type: String, default: '' }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

productSchema.index({ storeId: 1, slug: 1 }, { unique: true, partialFilterExpression: { storeId: { $exists: true } } });
productSchema.index({ storeId: 1, status: 1 });
productSchema.index({ storeId: 1, createdAt: -1 });

// Computed: saleBadge
productSchema.virtual('saleBadge').get(function () {
    if (this.salePrice && this.salePrice < this.price) {
        const percent = Math.round(((this.price - this.salePrice) / this.price) * 100);
        return `${percent}% OFF`;
    }
    return null;
});

// Computed: availabilityLabel
productSchema.virtual('availabilityLabel').get(function () {
    if (this.stock <= 0) return 'Out of Stock';
    if (this.stock < 5) return `Only ${this.stock} Left`;
    if (this.totalReviews > 20 && this.rating >= 4) return 'Bestseller';
    return 'In Stock';
});

module.exports = mongoose.models.Product || mongoose.model('Product', productSchema);
