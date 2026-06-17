const mongoose = require('mongoose');

const metaEventLogSchema = new mongoose.Schema({
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', index: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    eventName: { type: String, required: true },
    eventId: { type: String, required: true },
    pixelId: { type: String },
    source: { 
        type: String, 
        enum: ['browser', 'server'],
        required: true
    },
    status: { 
        type: String, 
        enum: ['queued', 'sent', 'failed', 'dead', 'skipped_duplicate', 'test_sent'],
        default: 'queued'
    },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 3 },
    nextRetryAt: { type: Date, default: Date.now },
    sentAt: { type: Date },
    responseTimeMs: { type: Number },
    requestPayloadSafe: Object, // Stores hashed user_data only, never plain text
    responsePayloadSafe: Object,
    errorMessage: String,
    testEventCodeUsed: String,
    hasFbp: { type: Boolean, default: false },
    hasFbc: { type: Boolean, default: false },
    hasEmailHash: { type: Boolean, default: false },
    hasPhoneHash: { type: Boolean, default: false },
    hasExternalId: { type: Boolean, default: false },
    deduplicationKey: { type: String }
}, { timestamps: true });

// Enforce unique eventName + eventId + source on the server to prevent duplicates
metaEventLogSchema.index(
    { eventName: 1, eventId: 1, source: 1 }, 
    { unique: true, partialFilterExpression: { source: 'server' } }
);

// Performance indexes for queue processing and admin log lookups
metaEventLogSchema.index({ status: 1, nextRetryAt: 1, createdAt: -1 });
metaEventLogSchema.index({ orderId: 1 });
metaEventLogSchema.index({ createdAt: -1 });
metaEventLogSchema.index({ storeId: 1, createdAt: -1 });

module.exports = mongoose.models.MetaEventLog || mongoose.model('MetaEventLog', metaEventLogSchema);
