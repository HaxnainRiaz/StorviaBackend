const mongoose = require('mongoose');

const collectionSchema = new mongoose.Schema({
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, lowercase: true, trim: true },
    description: { type: String, default: '' },
    image: { type: String, default: '' },
    type: { type: String, enum: ['manual', 'automatic'], default: 'manual' },
    productIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    rules: { type: [Object], default: [] },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' }
}, { timestamps: true });

collectionSchema.index({ storeId: 1, slug: 1 }, { unique: true });

module.exports = mongoose.models.Collection || mongoose.model('Collection', collectionSchema);
