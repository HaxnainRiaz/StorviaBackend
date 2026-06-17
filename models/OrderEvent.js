const mongoose = require('mongoose');

const orderEventSchema = new mongoose.Schema({
    orderId: {
        type: mongoose.Schema.ObjectId,
        ref: 'Order',
        required: true
    },
    eventType: {
        type: String,
        required: true,
        enum: [
            "ORDER_CREATED",
            "ORDER_UPDATED",
            "PAYMENT_STATUS_UPDATED",
            "ORDER_STATUS_UPDATED",
            "POSTEX_BOOKING_STARTED",
            "POSTEX_BOOKED",
            "POSTEX_BOOKING_FAILED",
            "POSTEX_TRACKING_UPDATED",
            "POSTEX_CANCELLED",
            "POSTEX_INVOICE_DOWNLOADED"
        ]
    },
    message: {
        type: String,
        required: true
    },
    metadata: {
        type: Object
    },
    createdBy: {
        type: mongoose.Schema.ObjectId,
        ref: 'User'
    }
}, { timestamps: true });

module.exports = mongoose.models.OrderEvent || mongoose.model('OrderEvent', orderEventSchema);
