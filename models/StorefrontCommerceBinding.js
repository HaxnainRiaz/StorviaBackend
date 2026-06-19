const mongoose = require('mongoose');

const storefrontCommerceBindingSchema = new mongoose.Schema({
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    managedStorefrontId: { type: mongoose.Schema.Types.ObjectId, ref: 'ManagedStorefront', index: true },
    pageId: { type: String, default: 'home', index: true },
    sourceSelector: { type: String, default: '' },
    sourceLabel: { type: String, default: '' },
    bindingType: {
        type: String,
        enum: [
            'product_grid', 'product_card', 'product_detail', 'category_grid', 'collection_grid',
            'cart_button', 'add_to_cart_button', 'buy_now_button', 'checkout_button',
            'search_input', 'wishlist_button', 'review_section', 'review_form',
            'order_tracking_form', 'contact_support_form', 'coupon_input', 'newsletter_form',
            'header', 'footer', 'navigation', 'hero', 'logo', 'policy_links',
        ],
        required: true,
        index: true,
    },
    config: { type: Object, default: {} },
    required: { type: Boolean, default: false },
    status: {
        type: String,
        enum: ['mapped', 'unmapped', 'broken', 'disabled'],
        default: 'unmapped',
        index: true,
    },
}, { timestamps: true });

storefrontCommerceBindingSchema.index({ storeId: 1, pageId: 1, bindingType: 1 });

module.exports = mongoose.models.StorefrontCommerceBinding
    || mongoose.model('StorefrontCommerceBinding', storefrontCommerceBindingSchema);
