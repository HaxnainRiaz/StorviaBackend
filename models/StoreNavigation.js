const mongoose = require('mongoose');

const storeNavigationSchema = new mongoose.Schema({
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    menuName: { type: String, enum: ['header', 'footer'], required: true },
    items: { type: [Object], default: [] },
    status: { type: String, enum: ['draft', 'published'], default: 'draft' }
}, { timestamps: true });

storeNavigationSchema.index({ storeId: 1, menuName: 1 }, { unique: true });

module.exports = mongoose.models.StoreNavigation || mongoose.model('StoreNavigation', storeNavigationSchema);
