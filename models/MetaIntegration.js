const mongoose = require('mongoose');

const metaIntegrationSchema = new mongoose.Schema({
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store' },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    connectionStatus: { 
        type: String, 
        enum: ['connected', 'disconnected', 'expired', 'error'],
        default: 'disconnected'
    },
    metaUserId: String,
    metaUserName: String,
    metaProfilePicture: String,
    
    // Asset IDs
    businessId: String,
    businessName: String,
    adAccountId: String,
    adAccountName: String,
    adAccountCurrency: String,
    pageId: String,
    pageName: String,
    pixelId: String,
    pixelName: String,
    datasetId: String,
    
    // Tokens (should be encrypted in production)
    accessTokenEncrypted: String,
    capiAccessTokenEncrypted: String,
    tokenExpiresAt: Date,
    grantedPermissions: [
        {
            permission: {
                type: String,
                required: true,
                trim: true
            },
            status: {
                type: String,
                enum: ['granted', 'declined', 'expired'],
                default: 'granted'
            }
        }
    ],
    
    // Settings
    dataSharingLevel: {
        type: String,
        enum: ['standard', 'enhanced', 'maximum'],
        default: 'standard'
    },
    isPixelEnabled: { type: Boolean, default: false },
    isCapiEnabled: { type: Boolean, default: false },
    automaticAdvancedMatching: { type: Boolean, default: true },
    deduplicationEnabled: { type: Boolean, default: true },
    enabledEvents: {
        type: [String],
        default: ['PageView', 'ViewContent', 'AddToCart', 'InitiateCheckout', 'Purchase']
    },
    
    // Progress Tracking & Diagnostics
    setupStep: { type: Number, default: 1 },
    setupCompleted: { type: Boolean, default: false },
    lastEventSentAt: Date,
    lastErrorMessage: String,
    
    // Advanced CAPI & Optimization Metrics
    testEventCode: { type: String, default: "" },
    lastTestAt: Date,
    lastSuccessfulCapiAt: Date,
    trackingHealthScore: { type: Number, default: 0 }
    
}, { timestamps: true });

metaIntegrationSchema.index({ storeId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.models.MetaIntegration || mongoose.model('MetaIntegration', metaIntegrationSchema);
