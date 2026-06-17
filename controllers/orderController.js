const socketUtil = require('../utils/socket');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Coupon = require('../models/Coupon');
const User = require('../models/User'); // Import User for admin lookup
const Settings = require('../models/Settings');
const { createLog } = require('./auditController');
const { sendPushNotification } = require('../utils/firebase');
const sendWhatsAppNotification = require('../utils/whatsapp');
const StoreSettings = require('../models/StoreSettings');
const Customer = require('../models/Customer');
const InventoryLog = require('../models/InventoryLog');
const StoreMember = require('../models/StoreMember');
const { createStoreNotification } = require('../services/storeNotificationService');

const storeFilter = (req, extra = {}) => req.storeId ? { ...extra, storeId: req.storeId } : extra;
const findStoreStaff = async (storeId) => {
    if (!storeId) return [];
    const members = await StoreMember.find({ storeId, status: 'active' }).select('userId').lean();
    return User.find({ _id: { $in: members.map(member => member.userId) } });
};

const saveOrderWithUniqueNumber = async (order, maxRetries = 3) => {
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        try {
            return await order.save();
        } catch (error) {
            const isDuplicateOrderNumber = error?.code === 11000 && error?.keyPattern?.orderNumber;
            if (!isDuplicateOrderNumber || attempt === maxRetries) {
                throw error;
            }
            // Reset so the pre-save hook regenerates a fresh random number on next attempt.
            console.warn(`[Order] Duplicate orderNumber collision on attempt ${attempt + 1}, retrying...`);
            order.orderNumber = undefined;
        }
    }
};


// @desc    Create new order
// @route   POST /api/orders
// @access  Private
exports.addOrderItems = async (req, res) => {
    try {
        const {
            items,
            shippingAddress,
            coupon: couponCode // Expecting coupon code from frontend
        } = req.body;

        if (!items || items.length === 0) {
            return res.status(400).json({ success: false, message: 'No order items' });
        }

        // 1. Fetch Products and Calculate Items Total & Stock Check
        let calculatedItems = [];
        let itemsTotal = 0;

        for (const item of items) {
            const product = await Product.findOne(storeFilter(req, { _id: item.product }));
            if (!product) {
                return res.status(404).json({ success: false, message: `Product not found: ${item.product}` });
            }

            if (product.stock < item.quantity) {
                return res.status(400).json({ success: false, message: `Insufficient stock for ${product.title}` });
            }

            // Determine price (use sale price if valid)
            const unitPrice = (product.salePrice && product.salePrice < product.price)
                ? product.salePrice
                : product.price;

            itemsTotal += unitPrice * item.quantity;

            calculatedItems.push({
                product: product._id,
                quantity: item.quantity,
                price: unitPrice
            });
        }

        // 2. Validate Coupon and Calculate Discount
        let discountAmount = 0;
        let validCouponId = null;
        let isFreeShippingCoupon = false;

        if (couponCode) {
            const coupon = await Coupon.findOne({ code: couponCode.toUpperCase() });

            if (coupon && coupon.isActive && new Date() < coupon.expiresAt) {
                // Check minimum amount
                if (itemsTotal >= coupon.minAmount) {
                    if (coupon.discountType === 'percentage') {
                        discountAmount = (itemsTotal * coupon.discountValue) / 100;
                        if (coupon.maxDiscount && discountAmount > coupon.maxDiscount) {
                            discountAmount = coupon.maxDiscount;
                        }
                    } else if (coupon.discountType === 'free_shipping') {
                        isFreeShippingCoupon = true;
                    } else { // fixed
                        discountAmount = coupon.discountValue;
                    }
                    validCouponId = coupon._id;
                }
            }
        }

        // 3. Calculate Shipping
        let shipping = 200; // Default
        let totalQuantity = calculatedItems.reduce((acc, item) => acc + item.quantity, 0);

        try {
            const settings = req.storeId ? await StoreSettings.findOne({ storeId: req.storeId }) : await Settings.findOne();
            const shippingSettings = req.storeId ? settings?.shippingSettings : settings?.shipping;
            if (shippingSettings) {
                shipping = shippingSettings.fee;
                if (shippingSettings.freeShippingEnabled) {
                    const amountThresholdMet = shippingSettings.freeShippingThreshold > 0 && itemsTotal >= shippingSettings.freeShippingThreshold;
                    const quantityThresholdMet = shippingSettings.freeShippingQuantityThreshold > 0 && totalQuantity >= shippingSettings.freeShippingQuantityThreshold;
                    const mode = shippingSettings.freeShippingMode || 'either';

                    let freeBySettings = false;
                    if (mode === 'amount') {
                        freeBySettings = amountThresholdMet;
                    } else if (mode === 'quantity') {
                        freeBySettings = quantityThresholdMet;
                    } else if (mode === 'both') {
                        freeBySettings = amountThresholdMet && quantityThresholdMet;
                    } else { // 'either'
                        freeBySettings = amountThresholdMet || quantityThresholdMet;
                    }

                    if (freeBySettings || isFreeShippingCoupon) {
                        shipping = 0;
                    }
                } else if (isFreeShippingCoupon) {
                    // Even if global free shipping is disabled, a coupon can enable it
                    shipping = 0;
                }
            } else if (isFreeShippingCoupon) {
                shipping = 0;
            }
        } catch (err) {
            console.error('Settings Fetch Error:', err);
        }

        const tax = 0;

        let finalTotal = itemsTotal + shipping - discountAmount;
        if (finalTotal < 0) finalTotal = 0;

        // 4. Create Order
        const customer = req.storeId ? await Customer.findOneAndUpdate(
            {
                storeId: req.storeId,
                $or: [
                    { phone: shippingAddress.phone || '' },
                    { email: shippingAddress.email || '' }
                ]
            },
            {
                storeId: req.storeId,
                name: shippingAddress.fullName,
                email: shippingAddress.email,
                phone: shippingAddress.phone,
                lastOrderAt: new Date(),
                $inc: { totalOrders: 1, totalSpent: finalTotal }
            },
            { upsert: true, new: true }
        ) : null;

        const order = new Order({
            ...(req.storeId && { storeId: req.storeId }),
            ...(customer && { customer: customer._id }),
            user: req.user ? req.user._id : null,
            items: calculatedItems,
            shippingAddress,
            customerName: shippingAddress.fullName,
            totalAmount: finalTotal, // Server calculated total
            shippingFee: shipping,
            coupon: validCouponId,
            paymentStatus: 'pending', // Will be updated by payment gateway in prod
            // Meta Tracking Fields
            fbp: req.body.fbp,
            fbc: req.body.fbc,
            clientIpAddress: req.ip,
            clientUserAgent: req.headers['user-agent'],
            metaEventId: req.body.metaEventId || `purchase_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
        });

        const createdOrder = await saveOrderWithUniqueNumber(order);
        console.log(`[Order Created] ID: ${createdOrder._id}, Number: ${createdOrder.orderNumber}`);

        // 5. Meta CAPI Tracking - Queue asynchronously in database
        (async () => {
            try {
                const { queueMetaEvent } = require('../services/metaQueueService');
                // Determine event_id for deduplication - use what was saved/passed
                const eventId = createdOrder.metaEventId || `purchase_${createdOrder._id}`;
                
                const eventDetails = {
                    eventName: 'Purchase',
                    eventId: eventId,
                    orderId: createdOrder._id,
                    eventSourceUrl: req.body.eventSourceUrl || `${process.env.WEBSTORE_URL || 'https://luminelle.org'}/checkout/success`,
                    userData: {
                        email: shippingAddress.email || (req.user ? req.user.email : undefined),
                        phone: shippingAddress.phone,
                        clientIpAddress: req.ip,
                        clientUserAgent: req.headers['user-agent'],
                        fbp: req.body.fbp,
                        fbc: req.body.fbc,
                        externalId: req.user ? req.user._id.toString() : undefined
                    },
                    customData: {
                        value: finalTotal,
                        currency: 'PKR',
                        content_ids: calculatedItems.map(i => i.product.toString()),
                        content_type: 'product',
                        num_items: totalQuantity,
                        order_id: createdOrder.orderNumber || createdOrder._id.toString()
                    }
                };

                const queueResult = await queueMetaEvent({ ...eventDetails, storeId: req.storeId });
                if (queueResult.success) {
                    // Mark as queued/sent on order
                    await Order.findByIdAndUpdate(createdOrder._id, { metaPurchaseCapiSent: true });
                }

            } catch (capiErr) {
                console.error('[Meta CAPI Queue Error during order]:', capiErr.message);
            }
        })();

        // 5. Audit Log (Only for logged in users)
        if (req.user) {
            await createLog(req.user.id, 'Order Creation', `Created order ${createdOrder._id} for amount $${finalTotal.toFixed(2)}`, {
                storeId: req.storeId,
                entity: 'order',
                entityId: createdOrder._id,
                req
            });
        }

        // 6. Decrease Stock
        for (const item of calculatedItems) {
            const before = await Product.findOne(storeFilter(req, { _id: item.product })).select('stock title');
            await Product.findOneAndUpdate(storeFilter(req, { _id: item.product }), {
                $inc: { stock: -item.quantity }
            });
            const afterStock = Math.max((before?.stock || 0) - item.quantity, 0);
            if (req.storeId && before) {
                await InventoryLog.create({
                    storeId: req.storeId,
                    productId: item.product,
                    previousStock: before.stock,
                    newStock: afterStock,
                    delta: -item.quantity,
                    reason: 'order_created',
                    orderId: createdOrder._id
                });
            }
            // Emit product update for stock change
            try {
                const updatedProduct = await Product.findOne(storeFilter(req, { _id: item.product }));
                const io = socketUtil.getIO();
                req.storeId ? io.to(`store:${req.storeId}`).emit('product:updated', updatedProduct) : io.emit('product:update', updatedProduct);

                // Critical Stock Notification
                if (updatedProduct.stock < 10) { // Using 10 as a threshold for "critical"
                    if (req.storeId) {
                        await createStoreNotification({
                            storeId: req.storeId,
                            type: 'low_stock',
                            title: 'Stock is low',
                            body: `${updatedProduct.title} is low on stock (${updatedProduct.stock} left)`,
                            payload: { productId: updatedProduct._id.toString() },
                            permissions: ['view_products', 'edit_products']
                        });
                    }
                    const admins = await findStoreStaff(req.storeId);
                    const adminTokens = admins.flatMap(a => a.fcmTokens || []);
                    if (adminTokens.length > 0) {
                        sendPushNotification(adminTokens, {
                            title: '⚠️ Stock Critical!',
                            body: `${updatedProduct.title} is low on stock (${updatedProduct.stock} left)`,
                            data: {
                                type: 'LOW_STOCK',
                                productId: updatedProduct._id.toString()
                            }
                        });
                    }
                }
            } catch (e) { }
        }

        // Emit New Order Event
        try {
            // Populate necessary fields for the dashboard
            const populatedOrder = await Order.findById(createdOrder._id).populate('user', 'name email');
            const io = socketUtil.getIO();
            req.storeId ? io.to(`store:${req.storeId}`).emit('order:new', populatedOrder) : io.emit('order:new', populatedOrder);
        } catch (e) { console.error('Socket Emit Error:', e); }

        res.status(201).json({
            success: true,
            data: createdOrder,
            summary: {
                subtotal: itemsTotal,
                discount: discountAmount,
                shipping,
                tax,
                total: finalTotal
            }
        });

        // 7. Notify Admins
        // ... (WhatsApp logic kept same)
        (async () => {
            // ... WhatsApp impl details ...
            try {
                if (req.storeId) {
                    await createStoreNotification({
                        storeId: req.storeId,
                        type: 'new_order',
                        title: 'New order received',
                        body: `Order #${createdOrder.orderNumber || createdOrder._id.toString().slice(-6)} for RS ${finalTotal.toFixed(2)} from ${shippingAddress.fullName}`,
                        payload: { orderId: createdOrder._id.toString() },
                        permissions: ['view_orders']
                    });
                }
                // Find all admins
                const admins = await findStoreStaff(req.storeId);
                const adminTokens = admins.flatMap(admin => admin.fcmTokens || []);

                if (adminTokens.length > 0) {
                    await sendPushNotification(adminTokens, {
                        title: 'New Order Received!',
                        body: `Order #${createdOrder._id.toString().slice(-6)} for RS ${finalTotal.toFixed(2)} from ${shippingAddress.fullName}`,
                        data: {
                            type: 'NEW_ORDER',
                            orderId: createdOrder._id.toString()
                        }
                    });
                }

                // WhatsApp for admins with phone number
                const adminsWithPhone = admins.filter(admin => admin.phone && admin.phone !== '');
                if (adminsWithPhone.length > 0) {
                    const message = `*New Order Received!*
ID: ${createdOrder._id}
Items: ${calculatedItems.length}
Total: $${finalTotal.toFixed(2)}
Customer: ${shippingAddress.fullName}
                    
Check Admin Panel for details.`;

                    for (const admin of adminsWithPhone) {
                        await sendWhatsAppNotification(admin.phone, message);
                    }
                }
            } catch (notifyErr) {
                console.error("Notification Error:", notifyErr.message);
            }
        })();

    } catch (err) {
        console.error("Order Create Error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Get order by ID
// @route   GET /api/orders/:id
// @access  Private
exports.getOrderById = async (req, res) => {
    try {
        const order = await Order.findOne(storeFilter(req, { _id: req.params.id }))
            .populate('user', 'name email')
            .populate('items.product', 'title images')
            .populate('coupon', 'code discountType discountValue');

        if (order) {
            // Ensure user can only see their own orders unless admin
            if (req.user.role !== 'admin') {
                if (!order.user || order.user._id.toString() !== req.user._id.toString()) {
                    return res.status(401).json({ success: false, message: 'Not authorized' });
                }
            }
            res.status(200).json({ success: true, data: order });
        } else {
            res.status(404).json({ success: false, message: 'Order not found' });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Update order payment status
// @route   PUT /api/orders/:id/pay
// @access  Private
exports.updateOrderToPaid = async (req, res) => {
    try {
        const order = await Order.findOne(storeFilter(req, { _id: req.params.id }));

        if (order) {
            order.paymentStatus = 'paid';
            order.paidAt = Date.now();

            const updatedOrder = await order.save();

            // Audit Log
            await createLog(req.user.id, 'Payment Update', `Order ${order._id} marked as PAID`);

            // Emit Socket Event
            try {
                const populatedOrder = await Order.findById(updatedOrder._id).populate('user', 'name email');
                const io = socketUtil.getIO();
                req.storeId ? io.to(`store:${req.storeId}`).emit('order:updated', populatedOrder) : io.emit('order:update', populatedOrder);
            } catch (e) { console.error('Socket Emit Error:', e); }

            res.status(200).json({ success: true, data: updatedOrder });
        } else {
            res.status(404).json({ success: false, message: 'Order not found' });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Get logged in user orders
// @route   GET /api/orders/myorders
// @access  Private
exports.getMyOrders = async (req, res) => {
    try {
        const orders = await Order.find({ user: req.user._id, ...(req.storeId && { storeId: req.storeId }) }).sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: orders });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Get logged in user orders
// @route   GET /api/orders/myorders
// @access  Private
// @desc    Update order status
// @route   PUT /api/orders/:id/status
// @access  Private/Admin
exports.updateOrderStatus = async (req, res) => {
    try {
        const order = await Order.findOne(storeFilter(req, { _id: req.params.id }));

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        const currentStatus = order.orderStatus;
        const newStatus = req.body.status;

        // Allow any status transition for admins unless already cancelled
        if (currentStatus === 'cancelled' && newStatus !== 'cancelled') {
            return res.status(400).json({ success: false, message: 'Cannot update status of a cancelled order' });
        }

        order.orderStatus = newStatus;

        // Auto-update deliveredAt
        if (newStatus === 'delivered' && !order.deliveredAt) {
            order.deliveredAt = Date.now();
            // Auto-mark as paid if delivered
            if (order.paymentStatus !== 'paid') {
                order.paymentStatus = 'paid';
                order.paidAt = Date.now();
            }
        }

        const updatedOrder = await order.save();

        // Audit Log
        await createLog(req.user.id, 'Order Status', `Order ${order._id} updated to ${newStatus}${newStatus === 'delivered' ? ' and marked as PAID' : ''}`);

        // Emit Socket Event
        try {
            const populatedOrder = await Order.findById(updatedOrder._id)
                .populate('user', 'name email')
                .populate('items.product', 'title images price');
            const io = socketUtil.getIO();
            req.storeId ? io.to(`store:${req.storeId}`).emit('order:updated', populatedOrder) : io.emit('order:update', populatedOrder);
            return res.status(200).json({ success: true, data: populatedOrder });
        } catch (e) { 
            console.error('Socket Emit Error:', e);
            return res.status(200).json({ success: true, data: updatedOrder });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Get all orders (Admin)
// @route   GET /api/orders
// @access  Private/Admin
exports.getOrders = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;

        const filter = storeFilter(req);
        const total = await Order.countDocuments(filter);
        const orders = await Order.find(filter)
            .populate('user', 'id name email')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        res.status(200).json({
            success: true,
            data: orders,
            pagination: {
                total,
                page,
                pages: Math.ceil(total / limit),
                limit
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};
exports.bulkCancelOrders = async (req, res) => {
    try {
        const { orderIds } = req.body;
        const result = await Order.updateMany(
            storeFilter(req, { _id: { $in: orderIds }, orderStatus: { $ne: 'cancelled' } }),
            { $set: { orderStatus: 'cancelled', deliveryStatus: 'Cancelled' } }
        );

        await createLog(req.user.id, 'Bulk Action', `Bulk cancelled ${result.nModified} orders`);

        res.status(200).json({ success: true, count: result.nModified });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.bulkUpdatePaymentStatus = async (req, res) => {
    try {
        const { orderIds, paymentStatus } = req.body;
        const result = await Order.updateMany(
            storeFilter(req, { _id: { $in: orderIds } }),
            { $set: { paymentStatus: paymentStatus, paidAt: paymentStatus === 'paid' ? Date.now() : null } }
        );

        await createLog(req.user.id, 'Bulk Action', `Bulk updated payment status to ${paymentStatus} for ${result.nModified} orders`);

        res.status(200).json({ success: true, count: result.nModified });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

const IMMUTABLE_ORDER_FIELDS = ['_id', 'id', 'orderNumber', 'orderId', 'createdAt', 'updatedAt', '__v'];

exports.updateOrderDetails = async (req, res) => {
    try {
        const { id } = req.params;
        
        // 1. Sanitize payload to prevent identity theft/modification
        const updatePayload = { ...req.body };
        IMMUTABLE_ORDER_FIELDS.forEach(field => delete updatePayload[field]);

        // 2. Handle nested shipping address updates if provided as flat fields
        const shippingUpdates = {};
        if (req.body.cityName) shippingUpdates['shippingAddress.city'] = req.body.cityName;
        if (req.body.customerPhone) shippingUpdates['shippingAddress.phone'] = req.body.customerPhone;
        if (req.body.deliveryAddress) shippingUpdates['shippingAddress.street'] = req.body.deliveryAddress;

        const finalUpdate = { ...updatePayload, ...shippingUpdates };

        // 3. If items are updated, recalculate the totalAmount for safety
        if (req.body.items && Array.isArray(req.body.items)) {
            let itemsTotal = 0;
            req.body.items.forEach(item => {
                itemsTotal += (item.price || 0) * (item.quantity || 0);
            });
            // Fetch current order to get existing shippingFee if not provided
            const currentOrder = await Order.findOne(storeFilter(req, { _id: id }));
            if (currentOrder) {
                const shipping = req.body.shippingFee !== undefined ? req.body.shippingFee : (currentOrder.shippingFee || 0);
                // We should also account for coupons here, but for simple admin edit, 
                // we'll just use the items sum + shipping if not explicitly sending a total
                if (!req.body.totalAmount) {
                    finalUpdate.totalAmount = itemsTotal + shipping;
                }
            }
        }

        // 4. Perform atomic update
        const updatedOrder = await Order.findOneAndUpdate(
            storeFilter(req, { _id: id }),
            { $set: finalUpdate },
            { new: true, runValidators: true, upsert: false }
        );

        if (!updatedOrder) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        // 4. Emit update event
        try {
            const populatedOrder = await Order.findById(updatedOrder._id)
                .populate('user', 'name email')
                .populate('items.product', 'title images price');
            const io = socketUtil.getIO();
            req.storeId ? io.to(`store:${req.storeId}`).emit('order:updated', populatedOrder) : io.emit('order:update', populatedOrder);
            return res.status(200).json({ success: true, data: populatedOrder });
        } catch (e) { 
            return res.status(200).json({ success: true, data: updatedOrder });
        }
    } catch (err) {
        console.error("Order Update Error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
};
