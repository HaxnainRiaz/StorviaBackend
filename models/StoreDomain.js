const mongoose = require('mongoose');

const storeDomainSchema = new mongoose.Schema({
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, unique: true, index: true },
    storeSlug: { type: String, required: true, unique: true, lowercase: true },
    subdomain: { type: String, required: true, unique: true, lowercase: true },
    customDomain: { type: String, unique: true, sparse: true, lowercase: true },
    sslStatus: { type: String, enum: ['not_configured', 'pending', 'active', 'failed'], default: 'not_configured' },
    verificationStatus: { type: String, enum: ['not_configured', 'pending', 'verified', 'failed'], default: 'not_configured' },
    redirectRules: { type: [Object], default: [] }
}, { timestamps: true });

module.exports = mongoose.models.StoreDomain || mongoose.model('StoreDomain', storeDomainSchema);
