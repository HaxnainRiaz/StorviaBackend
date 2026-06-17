const mongoose = require('mongoose');
const crypto = require('crypto');

const ORDER_NUMBER_PREFIX = '#';
const ORDER_NUMBER_LENGTH = 6;

function createRandomOrderNumber() {
    return `${ORDER_NUMBER_PREFIX}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

async function generateUniqueOrderNumber(maxAttempts = 12) {
    // Use mongoose.model() to safely reference the compiled model at call-time.
    const OrderModel = mongoose.model('Order');
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const candidate = createRandomOrderNumber();
        // Check uniqueness proactively to avoid duplicate key retries in normal flow.
        const exists = await OrderModel.exists({ orderNumber: candidate });
        if (!exists) return candidate;
    }

    throw new Error('Failed to generate a unique random order number after max attempts');
}

const orderSchema = new mongoose.Schema({
    storeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Store',
        required: false,
        index: true
    },
    customer: {
        type: mongoose.Schema.ObjectId,
        ref: 'Customer'
    },
    user: {
        type: mongoose.Schema.ObjectId,
        ref: 'User',
        required: false
    },
    items: [
        {
            product: {
                type: mongoose.Schema.ObjectId,
                ref: 'Product',
                required: true
            },
            quantity: {
                type: Number,
                required: true,
                min: 1
            },
            price: {
                type: Number,
                required: true
            }
        }
    ],
    totalAmount: {
        type: Number,
        required: true
    },
    shippingFee: {
        type: Number,
        default: 0
    },
    paymentStatus: {
        type: String,
        enum: ['paid', 'pending', 'failed'],
        default: 'pending'
    },
    orderStatus: {
        type: String,
        enum: ['pending', 'processing', 'in progress', 'confirmed', 'shipped', 'delivered', 'cancelled', 'on hold', 'returned', 'unfulfilled'],
        default: 'pending'
    },
    shippingAddress: {
        fullName: String,
        phone: String,
        street: String,
        city: String,
        state: String,
        postalCode: String,
        country: String
    },
    coupon: {
        type: mongoose.Schema.ObjectId,
        ref: 'Coupon',
        default: null
    },
    customerName: {
        type: String,
        required: false
    },
    courier: {
        type: String,
        default: 'PostEx'
    },
    isPostExBooked: {
        type: Boolean,
        default: false
    },
    postex: {
        trackingNumber: String,
        orderStatus: String,
        transactionStatus: String,
        transactionStatusHistory: Array,
        orderDate: Date,
        lastTrackingSyncAt: Date,
        rawCreateResponse: Object,
        rawTrackingResponse: Object
    },
    deliveryStatus: {
        type: String,
        enum: [
            "Not Booked",
            "Booked",
            "Picked Up",
            "At PostEx Warehouse",
            "In Transit",
            "Out for Delivery",
            "Delivered",
            "Returned",
            "Returning",
            "Delivery Attempted",
            "Under Review",
            "Expired",
            "Unassigned",
            "Cancelled"
        ],
        default: "Not Booked"
    },
    orderNumber: {
        type: String,
        sparse: true,
        index: true
        // Note: immutable removed intentionally — the retry mechanism in saveOrderWithUniqueNumber
        // needs to reset orderNumber on duplicate-key collisions. API-level immutability is
        // enforced via IMMUTABLE_ORDER_FIELDS in the controller.
    },
    paymentMethod: {
        type: String,
        enum: ['COD', 'Card'],
        default: 'COD'
    },
    tags: [String],
    channel: {
        type: String,
        default: 'Online Store'
    },
    fulfillmentStatus: {
        type: String,
        enum: ['Unfulfilled', 'Fulfilled', 'Partially Fulfilled'],
        default: 'Unfulfilled'
    },
    transactionNotes: {
        type: String,
        default: ""
    },
    // Meta Tracking Fields
    metaEventId: { type: String },
    metaPurchasePixelSent: { type: Boolean, default: false },
    metaPurchaseCapiSent: { type: Boolean, default: false },
    fbp: { type: String },
    fbc: { type: String },
    clientIpAddress: { type: String },
    clientUserAgent: { type: String }
}, { timestamps: true });

// Auto-generate a unique random orderNumber before first save (or on retry after collision).
orderSchema.pre('save', async function (next) {
    if (!this.orderNumber) {
        try {
            this.orderNumber = await generateUniqueOrderNumber();
        } catch (error) {
            console.error('Order Number Generation Error:', error);
            return next(error);
        }
    }
    next();
});

orderSchema.index({ storeId: 1, orderNumber: 1 }, { unique: true, sparse: true });
orderSchema.index({ storeId: 1, createdAt: -1 });
orderSchema.index({ storeId: 1, orderStatus: 1 });

module.exports = mongoose.models.Order || mongoose.model('Order', orderSchema);
