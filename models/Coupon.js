const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema({
    storeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Store',
        required: false,
        index: true
    },
    code: {
        type: String,
        required: [true, 'Please add a coupon code'],
        uppercase: true,
        trim: true
    },
    discountType: {
        type: String,
        enum: ['percentage', 'fixed', 'free_shipping', 'bundle', 'buy_x_get_y', 'quantity_discount'],
        required: true
    },
    discountValue: {
        type: Number,
        required: function() { 
            return !['bundle', 'free_shipping', 'buy_x_get_y'].includes(this.discountType); 
        }
    },
    // For standard Bundles (Fixed set of products)
    bundleProducts: [{
        product: {
            type: mongoose.Schema.ObjectId,
            ref: 'Product'
        },
        quantity: {
            type: Number,
            default: 1
        }
    }],
    // For Buy X Get Y
    buyXGetY: {
        buyQty: Number,
        getQty: Number,
        discountType: {
            type: String,
            enum: ['free', 'percentage', 'fixed']
        },
        discountValue: Number,
        buyProducts: [{ type: mongoose.Schema.ObjectId, ref: 'Product' }],
        getProducts: [{ type: mongoose.Schema.ObjectId, ref: 'Product' }]
    },
    // For Quantity Discounts (e.g. Buy 3+ get 20% off)
    quantityDiscount: {
        minQty: Number,
        discountValue: Number,
        products: [{ type: mongoose.Schema.ObjectId, ref: 'Product' }]
    },
    minAmount: {
        type: Number,
        default: 0
    },
    maxDiscount: {
        type: Number,
        default: null
    },
    expiresAt: {
        type: Date,
        required: true
    },
    isActive: {
        type: Boolean,
        default: true
    },
    collectionRestrictions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Collection' }],
    usageLimit: { type: Number, default: null },
    usedCount: { type: Number, default: 0 },
    startsAt: { type: Date, default: Date.now }
}, { timestamps: true });

couponSchema.index({ storeId: 1, code: 1 }, { unique: true, partialFilterExpression: { storeId: { $exists: true } } });

module.exports = mongoose.models.Coupon || mongoose.model('Coupon', couponSchema);
