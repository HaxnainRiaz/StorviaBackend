const mongoose = require('mongoose');

const bannerSchema = new mongoose.Schema({
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: false, index: true },
    title: { type: String, required: true },
    subtitle: { type: String, required: true },
    buttonText: { type: String, required: true },
    buttonLink: { type: String, required: true },
    image: { type: String, required: true },
    mobileImage: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    startsAt: { type: Date },
    endsAt: { type: Date }
}, { timestamps: true });

bannerSchema.index({ storeId: 1, isActive: 1 });

module.exports = mongoose.models.Banner || mongoose.model('Banner', bannerSchema);
