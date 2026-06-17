const mongoose = require('mongoose');

/**
 * PostExShipment
 * One record per PostEx shipment created from the admin panel.
 * Stores the full request/response lifecycle and tracking state.
 */
const postExShipmentSchema = new mongoose.Schema({
    storeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Store',
        index: true
    },
    // Owner isolation — each admin only sees their own shipments
    ownerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },

    // Link back to the local order
    localOrderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Order',
        required: true,
        index: true
    },

    // PostEx identifiers
    orderRefNumber: { type: String },
    postexTrackingNumber: { type: String, index: true },

    // Shipment status (from PostEx)
    orderStatus: { type: String, default: 'Pending' },
    transactionStatus: { type: String, default: null },
    transactionStatusHistory: { type: Array, default: [] },

    // Customer & delivery info (snapshot at booking time)
    cityName:        { type: String },
    customerName:    { type: String },
    customerPhone:   { type: String },
    deliveryAddress: { type: String },
    invoicePayment:  { type: Number },   // COD amount
    invoiceDivision: { type: Number, default: 1 },
    items:           { type: Number },
    orderType:       { type: String, default: 'Normal' },
    orderDetail:     { type: String },
    pickupAddressCode: { type: String },
    storeAddressCode:  { type: String },

    // Payment / COD settlement
    paymentSettled:         { type: Boolean, default: false },
    settlementDate:         { type: Date, default: null },
    upfrontPaymentDate:     { type: Date, default: null },
    reservePaymentDate:     { type: Date, default: null },
    cprNumbers:             { type: Array, default: [] },
    rawPaymentStatusResponse: { type: Object, default: null },

    // PostEx raw response (for debugging)
    rawCreateResponse:   { type: Object, default: null },
    rawTrackingResponse: { type: Object, default: null },

    // Sync metadata
    lastSyncedAt: { type: Date, default: null },
    isCancelled:  { type: Boolean, default: false },

}, { timestamps: true });

// Prevent duplicate shipments for same local order (can be overridden by admin)
postExShipmentSchema.index({ localOrderId: 1, isCancelled: 1 });
postExShipmentSchema.index({ storeId: 1, localOrderId: 1 });

module.exports = mongoose.models.PostExShipment
    || mongoose.model('PostExShipment', postExShipmentSchema);
