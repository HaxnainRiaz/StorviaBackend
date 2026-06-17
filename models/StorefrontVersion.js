const mongoose = require('mongoose');

const storefrontVersionSchema = new mongoose.Schema({
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    managedStorefrontId: { type: mongoose.Schema.Types.ObjectId, ref: 'ManagedStorefront', required: true, index: true },
    snapshot: { type: Object, required: true },
    versionNumber: { type: Number, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    notes: { type: String, default: '' }
}, { timestamps: { createdAt: true, updatedAt: false } });

storefrontVersionSchema.index({ storeId: 1, versionNumber: -1 });

module.exports = mongoose.models.StorefrontVersion || mongoose.model('StorefrontVersion', storefrontVersionSchema);
