const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
    storeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Store',
        required: false,
        index: true
    },
    title: {
        type: String,
        required: [true, 'Please add a category title'],
        trim: true
    },
    slug: {
        type: String,
        required: true,
        index: true
    },
    description: {
        type: String,
        default: ''
    },
    image: {
        type: String,
        default: 'https://placehold.co/800x400?text=Category+Image'
    }
}, { timestamps: true });

categorySchema.index({ storeId: 1, slug: 1 }, { unique: true, partialFilterExpression: { storeId: { $exists: true } } });

module.exports = mongoose.models.Category || mongoose.model('Category', categorySchema);
