const mongoose = require('mongoose');

const storefrontAssetSchema = new mongoose.Schema({
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    designImportId: { type: mongoose.Schema.Types.ObjectId, ref: 'DesignImport', index: true },
    originalName: { type: String, required: true },
    assetType: {
        type: String,
        enum: ['image', 'font', 'css', 'other'],
        required: true,
        index: true
    },
    safeUrl: { type: String, required: true },
    size: { type: Number, required: true },
    mimeType: { type: String },
    hash: { type: String, required: true },
    usage: { type: String, default: '' }
}, { timestamps: { createdAt: true, updatedAt: false } });

module.exports = mongoose.models.StorefrontAsset || mongoose.model('StorefrontAsset', storefrontAssetSchema);
