const StoreSettings = require('../models/StoreSettings');
const StoreTheme = require('../models/StoreTheme');
const StoreSection = require('../models/StoreSection');
const StoreNavigation = require('../models/StoreNavigation');
const StorePage = require('../models/StorePage');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Collection = require('../models/Collection');
const Coupon = require('../models/Coupon');
const Review = require('../models/Review');
const Order = require('../models/Order');
const Customer = require('../models/Customer');
const SupportTicket = require('../models/SupportTicket');
const MetaIntegration = require('../models/MetaIntegration');
const InventoryLog = require('../models/InventoryLog');
const StoreVersion = require('../models/StoreVersion');
const ManagedStorefront = require('../models/ManagedStorefront');
const { queueMetaEvent } = require('../services/metaQueueService');
const { createStoreNotification } = require('../services/storeNotificationService');


const publicProductProjection = 'title slug description images price salePrice stock category tags isFeatured isBestSeller isNewArrival productType rating totalReviews metaTitle metaDescription sku warranty returnEligible specifications faqs imageAltText';

const ensurePublishedStore = (req, res) => {
    if (req.publicStore.status !== 'published') {
        res.status(403).json({ success: false, message: 'Storefront is not currently accepting public checkout' });
        return false;
    }
    return true;
};

const getPublishedSnapshot = async (storeId) => {
    const version = await StoreVersion.findOne({ storeId, versionType: 'published' })
        .sort({ createdAt: -1 })
        .lean();
    return version?.snapshotJson || null;
};

exports.getStorefront = async (req, res) => {
    // Check if store has a published managed design (imported HTML/CSS)
    // If so, always serve the storefront data regardless of store.status
    let hasPublishedManagedDesign = false;
    if (req.publicStore.status !== 'published' && !req.storePreview) {
        try {
            const managed = await ManagedStorefront.findOne(
                { storeId: req.storeId, status: 'published' },
                { _id: 1 }
            ).lean();
            hasPublishedManagedDesign = !!managed;
        } catch (_) { /* non-fatal */ }

        if (!hasPublishedManagedDesign) {
            return res.status(404).json({ success: false, message: 'Storefront is not published' });
        }
    }
    const snapshot = req.storePreview ? null : await getPublishedSnapshot(req.storeId);
    const [settings, theme, sections, navigation] = snapshot
        ? [
            snapshot.settings,
            snapshot.theme,
            (snapshot.sections || []).filter(section => section.isEnabled !== false && section.visibility !== 'hidden'),
            (snapshot.navigation || []).filter(menu => menu.status === 'published')
        ]
        : await Promise.all([
            StoreSettings.findOne({ storeId: req.storeId }).lean(),
            StoreTheme.findOne({ storeId: req.storeId }).lean(),
            StoreSection.find({ storeId: req.storeId, isEnabled: true, visibility: 'public' }).sort({ sortOrder: 1 }).lean(),
            StoreNavigation.find({ storeId: req.storeId, status: 'published' }).lean()
        ]);

    // Cache storefront data for 60s (browser + CDN) — invalidated on republish
    if (!req.storePreview) {
        res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=30');
    }

    res.json({
        success: true,
        data: {
            store: req.publicStore,
            settings,
            theme,
            sections,
            navigation
        }
    });
};

exports.getTheme = async (req, res) => {
    const snapshot = await getPublishedSnapshot(req.storeId);
    if (snapshot?.theme) return res.json({ success: true, data: snapshot.theme });
    const theme = await StoreTheme.findOne({ storeId: req.storeId }).lean();
    res.json({ success: true, data: theme });
};

exports.getSections = async (req, res) => {
    const snapshot = await getPublishedSnapshot(req.storeId);
    if (snapshot?.sections) {
        return res.json({
            success: true,
            data: snapshot.sections.filter(section => section.isEnabled !== false && section.visibility !== 'hidden')
        });
    }
    const sections = await StoreSection.find({ storeId: req.storeId, isEnabled: true, visibility: 'public' }).sort({ sortOrder: 1 }).lean();
    res.json({ success: true, data: sections });
};

exports.getNavigation = async (req, res) => {
    const snapshot = await getPublishedSnapshot(req.storeId);
    if (snapshot?.navigation) {
        return res.json({ success: true, data: snapshot.navigation.filter(menu => menu.status === 'published') });
    }
    const navigation = await StoreNavigation.find({ storeId: req.storeId, status: 'published' }).lean();
    res.json({ success: true, data: navigation });
};

exports.getProducts = async (req, res) => {
    const page = Number(req.query.page || 1);
    const limit = Math.min(Number(req.query.limit || 20), 100);
    const filter = { storeId: req.storeId, status: 'active' };
    if (req.query.category) filter.category = req.query.category;
    if (req.query.search) filter.title = new RegExp(req.query.search, 'i');

    const [products, total] = await Promise.all([
        Product.find(filter).select(publicProductProjection).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        Product.countDocuments(filter)
    ]);

    res.json({ success: true, data: products, pagination: { total, page, pages: Math.ceil(total / limit), limit } });
};

exports.getProduct = async (req, res) => {
    const product = await Product.findOne({ storeId: req.storeId, slug: req.params.productSlug, status: 'active' }).select(publicProductProjection).lean();
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
    res.json({ success: true, data: product });
};

exports.getCategories = async (req, res) => {
    const categories = await Category.find({ storeId: req.storeId }).sort({ title: 1 }).lean();
    res.json({ success: true, data: categories });
};

exports.getCollection = async (req, res) => {
    const collection = await Collection.findOne({ storeId: req.storeId, slug: req.params.collectionSlug, status: 'active' }).lean();
    if (!collection) return res.status(404).json({ success: false, message: 'Collection not found' });

    let filter = { storeId: req.storeId, status: 'active' };
    if (collection.type === 'manual') {
        filter._id = { $in: collection.productIds || [] };
    } else {
        for (const rule of collection.rules || []) {
            if (rule.field === 'category' && rule.operator === 'equals') filter.category = rule.value;
            if (rule.field === 'tag' && rule.operator === 'equals') filter.tags = rule.value;
            if (rule.field === 'price' && rule.operator === 'below') filter.price = { ...(filter.price || {}), $lt: Number(rule.value) };
            if (rule.field === 'price' && rule.operator === 'above') filter.price = { ...(filter.price || {}), $gt: Number(rule.value) };
            if (rule.field === 'stock' && rule.operator === 'available') filter.stock = { $gt: 0 };
            if (rule.field === 'featured' && rule.operator === 'true') filter.isFeatured = true;
            if (rule.field === 'bestseller' && rule.operator === 'true') filter.isBestSeller = true;
            if (rule.field === 'new_arrival' && rule.operator === 'true') filter.isNewArrival = true;
        }
    }

    const products = await Product.find(filter).select(publicProductProjection).limit(100).lean();
    res.json({ success: true, data: { collection, products } });
};

exports.getPage = async (req, res) => {
    const snapshot = await getPublishedSnapshot(req.storeId);
    if (snapshot?.pages) {
        const page = snapshot.pages.find(item => item.slug === req.params.pageSlug && item.status === 'published');
        if (!page) return res.status(404).json({ success: false, message: 'Page not found' });
        return res.json({ success: true, data: page });
    }
    const page = await StorePage.findOne({ storeId: req.storeId, slug: req.params.pageSlug, status: 'published' }).lean();
    if (!page) return res.status(404).json({ success: false, message: 'Page not found' });
    res.json({ success: true, data: page });
};

exports.validateCoupon = async (req, res) => {
    const { code, subtotal = 0 } = req.body;
    const coupon = await Coupon.findOne({
        storeId: req.storeId,
        code: String(code || '').toUpperCase(),
        isActive: true,
        startsAt: { $lte: new Date() },
        expiresAt: { $gt: new Date() }
    });

    if (!coupon || Number(subtotal) < coupon.minAmount) {
        return res.status(404).json({ success: false, message: 'Invalid coupon for this store' });
    }

    res.json({ success: true, data: coupon });
};

exports.createOrder = async (req, res) => {
    if (!ensurePublishedStore(req, res)) return;

    const { items = [], shippingAddress, coupon: couponCode } = req.body;
    if (!items.length) return res.status(400).json({ success: false, message: 'No order items' });

    const productIds = items.map(item => item.product);
    const products = await Product.find({ _id: { $in: productIds }, storeId: req.storeId, status: 'active' });
    if (products.length !== productIds.length) {
        return res.status(400).json({ success: false, message: 'Cart contains products outside this store or unavailable products' });
    }

    let itemsTotal = 0;
    const calculatedItems = [];
    for (const item of items) {
        const product = products.find(p => p._id.toString() === String(item.product));
        if (!product || product.stock < item.quantity) {
            return res.status(400).json({ success: false, message: `Insufficient stock for ${product?.title || item.product}` });
        }
        const unitPrice = product.salePrice && product.salePrice < product.price ? product.salePrice : product.price;
        itemsTotal += unitPrice * item.quantity;
        calculatedItems.push({ product: product._id, quantity: item.quantity, price: unitPrice });
    }

    let discountAmount = 0;
    let validCouponId = null;
    let freeShippingCoupon = false;
    if (couponCode) {
        const coupon = await Coupon.findOne({
            storeId: req.storeId,
            code: String(couponCode).toUpperCase(),
            isActive: true,
            startsAt: { $lte: new Date() },
            expiresAt: { $gt: new Date() }
        });
        if (coupon && itemsTotal >= coupon.minAmount) {
            if (coupon.discountType === 'percentage') discountAmount = (itemsTotal * coupon.discountValue) / 100;
            else if (coupon.discountType === 'fixed') discountAmount = coupon.discountValue;
            else if (coupon.discountType === 'free_shipping') freeShippingCoupon = true;
            if (coupon.maxDiscount && discountAmount > coupon.maxDiscount) discountAmount = coupon.maxDiscount;
            validCouponId = coupon._id;
        }
    }

    const settings = await StoreSettings.findOne({ storeId: req.storeId });
    const shippingSettings = settings?.shippingSettings || {};
    let shipping = Number(shippingSettings.fee || 0);
    const totalQuantity = calculatedItems.reduce((sum, item) => sum + item.quantity, 0);
    if (shippingSettings.freeShippingEnabled || freeShippingCoupon) {
        const amountMet = Number(shippingSettings.freeShippingThreshold || 0) > 0 && itemsTotal >= Number(shippingSettings.freeShippingThreshold);
        const qtyMet = Number(shippingSettings.freeShippingQuantityThreshold || 0) > 0 && totalQuantity >= Number(shippingSettings.freeShippingQuantityThreshold);
        const mode = shippingSettings.freeShippingMode || 'either';
        if (freeShippingCoupon || (mode === 'amount' && amountMet) || (mode === 'quantity' && qtyMet) || (mode === 'both' && amountMet && qtyMet) || (mode === 'either' && (amountMet || qtyMet))) {
            shipping = 0;
        }
    }

    const finalTotal = Math.max(itemsTotal + shipping - discountAmount, 0);
    const customer = await Customer.findOneAndUpdate(
        {
            storeId: req.storeId,
            $or: [
                { phone: shippingAddress?.phone || '' },
                { email: shippingAddress?.email || '' }
            ]
        },
        {
            storeId: req.storeId,
            name: shippingAddress?.fullName || '',
            email: shippingAddress?.email || '',
            phone: shippingAddress?.phone || '',
            lastOrderAt: new Date(),
            $inc: { totalOrders: 1, totalSpent: finalTotal }
        },
        { upsert: true, new: true }
    );

    const order = await Order.create({
        storeId: req.storeId,
        customer: customer._id,
        user: req.user?._id || null,
        items: calculatedItems,
        shippingAddress,
        customerName: shippingAddress?.fullName,
        totalAmount: finalTotal,
        shippingFee: shipping,
        coupon: validCouponId,
        paymentStatus: 'pending',
        fbp: req.body.fbp,
        fbc: req.body.fbc,
        clientIpAddress: req.ip,
        clientUserAgent: req.headers['user-agent'],
        metaEventId: req.body.metaEventId
    });

    for (const item of calculatedItems) {
        const before = await Product.findOne({ _id: item.product, storeId: req.storeId }).select('stock title');
        const updated = await Product.findOneAndUpdate(
            { _id: item.product, storeId: req.storeId },
            { $inc: { stock: -item.quantity } },
            { new: true }
        );
        if (before && updated) {
            await InventoryLog.create({
                storeId: req.storeId,
                productId: item.product,
                previousStock: before.stock,
                newStock: updated.stock,
                delta: -item.quantity,
                reason: 'order_created',
                orderId: order._id
            });

            if (updated.stock < 10) {
                await createStoreNotification({
                    storeId: req.storeId,
                    type: 'low_stock',
                    title: 'Stock is low',
                    body: `${updated.title} is low on stock (${updated.stock} left)`,
                    payload: { productId: updated._id.toString() },
                    permissions: ['view_products', 'edit_products']
                });
            }
        }
    }

    try {
        require('../utils/socket').getIO().to(`store:${req.storeId}`).emit('order:new', order);
    } catch (error) { }

    await createStoreNotification({
        storeId: req.storeId,
        type: 'new_order',
        title: 'New order received',
        body: `Order #${order.orderNumber || order._id.toString().slice(-6)} for RS ${finalTotal.toFixed(2)} from ${shippingAddress?.fullName || 'customer'}`,
        payload: { orderId: order._id.toString() },
        permissions: ['view_orders']
    });

    await queueMetaEvent({
        storeId: req.storeId,
        eventName: 'Purchase',
        eventId: order.metaEventId || `purchase_${order._id}`,
        orderId: order._id,
        eventSourceUrl: req.body.eventSourceUrl,
        userData: {
            email: shippingAddress?.email,
            phone: shippingAddress?.phone,
            clientIpAddress: req.ip,
            clientUserAgent: req.headers['user-agent'],
            fbp: req.body.fbp,
            fbc: req.body.fbc,
            externalId: req.user?._id?.toString()
        },
        customData: {
            value: finalTotal,
            currency: 'PKR',
            content_ids: calculatedItems.map(item => item.product.toString()),
            content_type: 'product',
            num_items: totalQuantity,
            order_id: order.orderNumber || order._id.toString()
        }
    });

    res.status(201).json({ success: true, data: order, summary: { subtotal: itemsTotal, discount: discountAmount, shipping, total: finalTotal } });
};

exports.trackOrder = async (req, res) => {
    const { orderNumber, phone, email } = req.query;
    const query = { storeId: req.storeId };
    if (orderNumber) query.orderNumber = orderNumber;
    if (phone) query['shippingAddress.phone'] = phone;
    if (email) query['shippingAddress.email'] = email;

    const order = await Order.findOne(query).select('orderNumber orderStatus deliveryStatus paymentStatus totalAmount createdAt postex');
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    res.json({ success: true, data: order });
};

exports.getCustomerOrders = async (req, res) => {
    const { phone, email } = req.query;
    const query = { storeId: req.storeId };
    if (phone) query['shippingAddress.phone'] = phone;
    if (email) query['shippingAddress.email'] = email;

    const orders = await Order.find(query).select('orderNumber orderStatus deliveryStatus paymentStatus totalAmount createdAt').sort({ createdAt: -1 });
    res.json({ success: true, data: orders });
};

exports.createSupportTicket = async (req, res) => {
    const ticket = await SupportTicket.create({ ...req.body, storeId: req.storeId, user: req.user?._id });
    try {
        require('../utils/socket').getIO().to(`store:${req.storeId}`).emit('support:ticket:new', ticket);
    } catch (error) { }
    await createStoreNotification({
        storeId: req.storeId,
        type: 'new_support_ticket',
        title: 'New support ticket',
        body: `From: ${ticket.email || ticket.name || 'customer'}`,
        payload: { ticketId: ticket._id.toString() },
        permissions: ['manage_support']
    });
    res.status(201).json({ success: true, data: ticket });
};

exports.getSupportTicket = async (req, res) => {
    const ticket = await SupportTicket.findOne({ _id: req.params.id, storeId: req.storeId });
    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });
    res.json({ success: true, data: ticket });
};

exports.addReview = async (req, res) => {
    const product = await Product.findOne({ _id: req.params.productId, storeId: req.storeId, status: 'active' });
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
    const review = await Review.create({ ...req.body, product: product._id, storeId: req.storeId, user: req.user?._id });
    await createStoreNotification({
        storeId: req.storeId,
        type: 'new_review',
        title: 'New product review',
        body: `${review.name || 'A customer'} left a ${review.rating}-star review for ${product.title}`,
        payload: { reviewId: review._id.toString(), productId: product._id.toString() },
        permissions: ['manage_reviews']
    });
    res.status(201).json({ success: true, data: review });
};

exports.getProductReviews = async (req, res) => {
    const reviews = await Review.find({ product: req.params.productId, storeId: req.storeId, status: 'approved' }).sort({ createdAt: -1 });
    res.json({ success: true, data: reviews, count: reviews.length });
};

exports.getBanners = async (req, res) => {
    const now = new Date();
    const banners = await require('../models/Banner').find({
        storeId: req.storeId,
        isActive: true,
        $and: [
            { $or: [{ startsAt: null }, { startsAt: { $exists: false } }, { startsAt: { $lte: now } }] },
            { $or: [{ endsAt: null }, { endsAt: { $exists: false } }, { endsAt: { $gte: now } }] }
        ]
    }).sort({ createdAt: -1 });
    res.json({ success: true, data: banners });
};

exports.getPixelConfig = async (req, res) => {
    const integration = await MetaIntegration.findOne({ storeId: req.storeId });
    if (!integration || !integration.isPixelEnabled || !integration.pixelId) {
        return res.json({ success: true, enabled: false });
    }

    res.json({
        success: true,
        enabled: true,
        isPixelEnabled: integration.isPixelEnabled,
        pixelId: integration.pixelId,
        dataSharingLevel: integration.dataSharingLevel,
        enabledEvents: integration.enabledEvents,
        deduplicationEnabled: integration.deduplicationEnabled || false,
        hasCapiToken: !!integration.capiAccessTokenEncrypted
    });
};

exports.queueMetaEvent = async (req, res) => {
    const result = await queueMetaEvent({
        ...req.body,
        storeId: req.storeId,
        userData: {
            ...(req.body.userData || {}),
            clientIpAddress: req.ip,
            clientUserAgent: req.headers['user-agent']
        }
    });

    if (!result.success) return res.status(500).json({ success: false, message: result.error || 'Failed to queue event' });
    res.status(202).json({ success: true, eventId: req.body.eventId });
};

exports.getSitemap = async (req, res) => {
    const snapshot = await getPublishedSnapshot(req.storeId);
    const [products, pages] = await Promise.all([
        Product.find({ storeId: req.storeId, status: 'active' }).select('slug updatedAt').lean(),
        snapshot?.pages
            ? Promise.resolve(snapshot.pages.filter(page => page.status === 'published'))
            : StorePage.find({ storeId: req.storeId, status: 'published' }).select('slug updatedAt').lean()
    ]);
    const base = `https://${req.publicStore.customDomain || `${req.publicStore.subdomain}.storvia.com`}`;
    const urls = [
        `<url><loc>${base}/</loc></url>`,
        ...products.map(p => `<url><loc>${base}/products/${p.slug}</loc><lastmod>${p.updatedAt?.toISOString()}</lastmod></url>`),
        ...pages.map(p => `<url><loc>${base}/pages/${p.slug}</loc><lastmod>${p.updatedAt?.toISOString()}</lastmod></url>`)
    ];
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`);
};

exports.getRobots = async (req, res) => {
    const host = req.publicStore.customDomain || `${req.publicStore.subdomain}.storvia.com`;
    res.type('text/plain').send(`User-agent: *\nAllow: /\nSitemap: https://${host}/api/storefront/${req.publicStore.storeSlug}/sitemap.xml\n`);
};

exports.getSeoPayload = async (req, res) => {
    const SEO = require('../models/SEO');
    const seo = await SEO.findOne({ storeId: req.storeId, entityType: req.params.entityType, slug: req.params.slug });
    res.json({ success: true, data: seo });
};

exports.getShippingOptions = async (req, res) => {
    const settings = await StoreSettings.findOne({ storeId: req.storeId }).select('shippingSettings');
    res.json({ success: true, data: settings?.shippingSettings || {} });
};

exports.getPaymentOptions = async (req, res) => {
    const settings = await StoreSettings.findOne({ storeId: req.storeId }).select('paymentSettings');
    const options = { ...(settings?.paymentSettings || {}) };
    delete options.payoutAccount;
    res.json({ success: true, data: options });
};
