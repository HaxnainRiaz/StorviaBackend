const mongoose = require('mongoose');

const managedStorefrontSchema = new mongoose.Schema({
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, unique: true, index: true },
    designImportId: { type: mongoose.Schema.Types.ObjectId, ref: 'DesignImport' },
    draftSchema: {
        type: Object,
        default: {
            pages: [],
            globalStyles: { colors: {}, fonts: {}, cssVariables: {} },
            assets: [],
            navigation: {},
            footer: {}
        }
    },
    publishedSchema: { type: Object, default: null },
    status: {
        type: String,
        enum: ['draft', 'published'],
        default: 'draft',
        index: true
    },
    version: { type: Number, default: 1 }
}, { timestamps: true });

module.exports = mongoose.models.ManagedStorefront || mongoose.model('ManagedStorefront', managedStorefrontSchema);
