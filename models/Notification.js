const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    type: {
        type: String,
        enum: ['new_order', 'low_stock', 'new_review', 'new_support_ticket', 'ticket_reply', 'payment_update', 'delivery_update', 'failed_shipment', 'meta_event_failure'],
        required: true
    },
    title: { type: String, required: true },
    body: { type: String, default: '' },
    payload: { type: Object, default: {} },
    readAt: Date
}, { timestamps: true });

notificationSchema.index({ storeId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, readAt: 1 });

module.exports = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);
