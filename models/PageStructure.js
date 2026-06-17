const mongoose = require('mongoose');

const styleSchema = new mongoose.Schema({
    fontSize: String,
    fontWeight: String,
    color: String,
    backgroundColor: String,
    padding: String,
    margin: String,
    width: String,
    height: String,
    opacity: Number,
    transform: String,
    borderRadius: String,
    shadow: String,
    textAlign: String,
    lineHeight: String,
    letterSpacing: String,
    display: String,
    flexDirection: String,
    justifyContent: String,
    alignItems: String,
    gap: String,
    border: String,
    cursor: String,
    zIndex: Number
}, { _id: false, strict: false });

const responsiveStyleSchema = new mongoose.Schema({
    tablet: styleSchema,
    mobile: styleSchema
}, { _id: false });

const elementSchema = new mongoose.Schema({
    _id: mongoose.Schema.Types.ObjectId,
    type: {
        type: String,
        enum: ['heading', 'paragraph', 'image', 'button', 'input', 'link', 'grid', 'flexbox', 'container', 'icon', 'video'],
        required: true
    },
    content: String,
    name: String,
    order: Number,
    styles: styleSchema,
    responsive: responsiveStyleSchema,
    properties: {
        href: String,
        src: String,
        alt: String,
        placeholder: String,
        linkTarget: String,
        assetId: mongoose.Schema.Types.ObjectId,
        disabled: Boolean,
        required: Boolean
    },
    children: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Element'
        }
    ],
    hidden: { type: Boolean, default: false }
}, { _id: true });

const sectionSchema = new mongoose.Schema({
    _id: mongoose.Schema.Types.ObjectId,
    type: {
        type: String,
        enum: ['hero', 'features', 'gallery', 'testimonials', 'footer', 'header', 'cta', 'custom'],
        default: 'custom'
    },
    name: String,
    order: Number,
    elements: [elementSchema],
    styles: styleSchema,
    responsive: responsiveStyleSchema
}, { _id: true });

const editHistorySchema = new mongoose.Schema({
    timestamp: { type: Date, default: Date.now },
    userId: mongoose.Schema.Types.ObjectId,
    action: {
        type: String,
        enum: ['create', 'update', 'delete', 'reorder', 'style', 'content']
    },
    elementId: String,
    sectionId: String,
    changes: mongoose.Schema.Types.Mixed
}, { _id: false });

const pageStructureSchema = new mongoose.Schema({
    designId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'StorefrontDesign',
        required: true,
        index: true
    },
    pageId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true
    },
    storeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Store',
        required: true,
        index: true
    },
    version: {
        type: Number,
        default: 1
    },
    snapshot: {
        sections: [sectionSchema]
    },
    editHistory: [editHistorySchema],
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
    lastEditedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
});

pageStructureSchema.pre('save', function (next) {
    this.updatedAt = Date.now();
    next();
});

module.exports = mongoose.model('PageStructure', pageStructureSchema);
