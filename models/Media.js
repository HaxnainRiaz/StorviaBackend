const mongoose = require('mongoose');

const MediaSchema = new mongoose.Schema({
    storeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Store',
        index: true
    },
    filename: {
        type: String,
        required: true,
        unique: true
    },
    data: {
        type: Buffer,
        required: true
    },
    contentType: {
        type: String,
        required: true
    },
    size: {
        type: Number
    },
    uploadDate: {
        type: Date,
        default: Date.now
    },
    usedBy: { type: [Object], default: [] }
});

MediaSchema.index({ storeId: 1, uploadDate: -1 });

module.exports = mongoose.models.Media || mongoose.model('Media', MediaSchema);
