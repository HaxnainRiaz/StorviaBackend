const mongoose = require('mongoose');

const colorSchema = new mongoose.Schema({
    primary: { type: String, default: '#000000' },
    secondary: { type: String, default: '#666666' },
    accent: { type: String, default: '#3B82F6' },
    textPrimary: { type: String, default: '#000000' },
    textSecondary: { type: String, default: '#666666' },
    background: { type: String, default: '#FFFFFF' },
    border: { type: String, default: '#E5E7EB' },
    success: { type: String, default: '#10B981' },
    warning: { type: String, default: '#F59E0B' },
    error: { type: String, default: '#EF4444' }
}, { _id: false });

const typographySchema = new mongoose.Schema({
    fontFamily: { type: String, default: 'Inter, sans-serif' },
    headingFont: { type: String, default: 'Inter, sans-serif' },
    baseSize: { type: Number, default: 16 },
    lineHeight: { type: Number, default: 1.5 },
    letterSpacing: { type: Number, default: 0 }
}, { _id: false });

const spacingSchema = new mongoose.Schema({
    unit: { type: Number, default: 8 },
    breakpoints: {
        mobile: { type: Number, default: 390 },
        tablet: { type: Number, default: 768 },
        desktop: { type: Number, default: 1280 }
    }
}, { _id: false });

const effectSchema = new mongoose.Schema({
    name: String,
    value: String
}, { _id: false });

const globalStylesSchema = new mongoose.Schema({
    colors: colorSchema,
    typography: typographySchema,
    spacing: spacingSchema,
    shadows: [effectSchema],
    borderRadius: [effectSchema]
}, { _id: false });

const pageSchema = new mongoose.Schema({
    _id: mongoose.Schema.Types.ObjectId,
    name: String,
    slug: String,
    layout: { type: String, enum: ['homepage', 'product', 'custom'], default: 'custom' },
    isPublished: { type: Boolean, default: false },
    publishedAt: Date,
    lastEditedAt: { type: Date, default: Date.now },
    editedBy: mongoose.Schema.Types.ObjectId
}, { _id: true });

const designSchema = new mongoose.Schema({
    storeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Store',
        required: true,
        index: true
    },
    name: {
        type: String,
        default: 'Default Design',
        trim: true
    },
    pages: [pageSchema],
    globalStyles: {
        type: globalStylesSchema,
        default: () => ({})
    },
    version: {
        type: Number,
        default: 1
    },
    isActive: {
        type: Boolean,
        default: true
    },
    createdAt: {
        type: Date,
        default: Date.now,
        index: true
    },
    updatedAt: {
        type: Date,
        default: Date.now,
        index: true
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
});

designSchema.pre('save', function (next) {
    this.updatedAt = Date.now();
    next();
});

module.exports = mongoose.model('StorefrontDesign', designSchema);
