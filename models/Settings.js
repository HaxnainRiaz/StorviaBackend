const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
    shipping: {
        fee: { type: Number, default: 200 },
        freeShippingEnabled: { type: Boolean, default: false },
        freeShippingThreshold: { type: Number, default: 5000 },
        freeShippingQuantityThreshold: { type: Number, default: 0 },
        freeShippingMode: {
            type: String,
            enum: ['amount', 'quantity', 'either', 'both'],
            default: 'either'
        }
    }
}, { timestamps: true });

module.exports = mongoose.models.Settings || mongoose.model('Settings', settingsSchema);
