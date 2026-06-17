const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
    storeId: {
        type: mongoose.Schema.ObjectId,
        ref: 'Store',
        required: false,
        index: true
    },
    product: {
        type: mongoose.Schema.ObjectId,
        ref: 'Product',
        required: true
    },
    user: {
        type: mongoose.Schema.ObjectId,
        ref: 'User',
        required: false
    },
    name: {
        type: String,
        required: [true, 'Please add a name']
    },
    rating: {
        type: Number,
        required: [true, 'Please add a rating between 1 and 5'],
        min: 1,
        max: 5
    },
    comment: {
        type: String,
        required: false
    },
    title: {
        type: String,
        trim: true
    },
    resultsTime: {
        type: String,
        enum: ['1 week', '2 weeks', '3–4 weeks', 'More than a month']
    },
    skinType: {
        type: String,
        enum: ['Oily', 'Dry', 'Combination', 'Sensitive', 'Normal']
    },
    recommend: {
        type: String,
        enum: ['Yes', 'No']
    },
    adminReply: {
        type: String,
        default: ''
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
    },
    images: [String]
}, { timestamps: true });

// Indexing for performance
reviewSchema.index({ product: 1 });
reviewSchema.index({ storeId: 1, product: 1 });

// Static method to get avg rating and update product
reviewSchema.statics.getAverageRating = async function (productId) {
    try {
        const product = await mongoose.model('Product').findById(productId).select('storeId');
        const productMatch = product?.storeId ? { product: productId, storeId: product.storeId } : { product: productId };
        const scopedObj = await this.aggregate([
            { $match: productMatch },
            { $group: { _id: '$product', averageRating: { $avg: '$rating' }, reviewCount: { $sum: 1 } } }
        ]);
        const stats = scopedObj[0];

        if (stats) {
            await mongoose.model('Product').findByIdAndUpdate(productId, {
                rating: stats.averageRating,
                totalReviews: stats.reviewCount
            });
        } else {
            await mongoose.model('Product').findByIdAndUpdate(productId, {
                rating: 0,
                totalReviews: 0
            });
        }
    } catch (err) {
        console.error(err);
    }
};

// Call getAverageRating after save
reviewSchema.post('save', function () {
    this.constructor.getAverageRating(this.product);
});

// Call getAverageRating before remove
reviewSchema.pre('remove', function () {
    this.constructor.getAverageRating(this.product);
});

module.exports = mongoose.models.Review || mongoose.model('Review', reviewSchema);
