const mongoose = require('mongoose');

const inventoryLogSchema = new mongoose.Schema({
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    previousStock: { type: Number, required: true },
    newStock: { type: Number, required: true },
    delta: { type: Number, required: true },
    reason: { type: String, default: 'manual_adjustment' },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

inventoryLogSchema.index({ storeId: 1, productId: 1, createdAt: -1 });

module.exports = mongoose.models.InventoryLog || mongoose.model('InventoryLog', inventoryLogSchema);
