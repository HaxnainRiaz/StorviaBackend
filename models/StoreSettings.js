const mongoose = require('mongoose');

const storeSettingsSchema = new mongoose.Schema({
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, unique: true, index: true },
    contactSettings: { type: Object, default: {} },
    checkoutSettings: { type: Object, default: { guestCheckoutEnabled: true } },
    paymentSettings: {
        type: Object,
        default: {
            codEnabled: true,
            bankTransferEnabled: false,
            jazzCashEnabled: false,
            easypaisaEnabled: false,
            cardEnabled: false,
            instructions: '',
            payoutAccount: {}
        }
    },
    shippingSettings: {
        fee: { type: Number, default: 200 },
        freeShippingEnabled: { type: Boolean, default: false },
        freeShippingThreshold: { type: Number, default: 5000 },
        freeShippingQuantityThreshold: { type: Number, default: 0 },
        freeShippingMode: { type: String, enum: ['amount', 'quantity', 'either', 'both'], default: 'either' },
        cityFees: { type: [Object], default: [] },
        allowedCities: { type: [String], default: [] },
        estimatedDeliveryDays: { type: String, default: '3-5' },
        returnPickupRules: { type: String, default: 'customer_pays' }
    },
    notificationSettings: { type: Object, default: {} },
    policySettings: { type: Object, default: {} },
    trustSettings: { type: Object, default: {} },
    taxSettings: { type: Object, default: {} },
    invoiceSettings: { type: Object, default: {} }
}, { timestamps: true });

module.exports = mongoose.models.StoreSettings || mongoose.model('StoreSettings', storeSettingsSchema);
