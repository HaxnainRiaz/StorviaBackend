const mongoose = require('mongoose');

const storeVersionSchema = new mongoose.Schema({
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    versionType: { type: String, enum: ['draft', 'published', 'backup'], required: true, index: true },
    snapshotJson: { type: Object, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: { createdAt: true, updatedAt: false } });

storeVersionSchema.index({ storeId: 1, createdAt: -1 });

module.exports = mongoose.models.StoreVersion || mongoose.model('StoreVersion', storeVersionSchema);
