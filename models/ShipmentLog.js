const mongoose = require('mongoose');

const shipmentLogSchema = new mongoose.Schema({
    storeId: {
        type: mongoose.Schema.ObjectId,
        ref: 'Store',
        index: true
    },
    orderId: {
        type: mongoose.Schema.ObjectId,
        ref: 'Order',
        required: true
    },
    courier: {
        type: String,
        default: 'PostEx'
    },
    action: {
        type: String,
        required: true
    },
    endpoint: {
        type: String,
        required: true
    },
    requestPayload: {
        type: Object
    },
    responsePayload: {
        type: Object
    },
    statusCode: {
        type: Number
    },
    success: {
        type: Boolean,
        default: false
    },
    errorMessage: {
        type: String
    }
}, { timestamps: true });

module.exports = mongoose.models.ShipmentLog || mongoose.model('ShipmentLog', shipmentLogSchema);
