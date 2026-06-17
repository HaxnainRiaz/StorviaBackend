const postexService = require('../services/postex.service');
const PostExIntegration = require('../models/PostExIntegration');
const PostExShipment = require('../models/PostExShipment');
const Order = require('../models/Order');
const OrderEvent = require('../models/OrderEvent');
const ShipmentLog = require('../models/ShipmentLog');

const POSTEX_TO_LOCAL_STATUS = {
    'Booked': 'Booked',
    'Picked By PostEx': 'Picked Up',
    'PostEx WareHouse': 'At PostEx Warehouse',
    'En-Route to PostEx warehouse': 'At PostEx Warehouse',
    'Out For Delivery': 'Out for Delivery',
    'Delivered': 'Delivered',
    'Returned': 'Returned',
    'Out For Return': 'Returning',
    'Attempted': 'Delivery Attempted',
    'Delivery Under Review': 'Under Review',
    'Cancelled': 'Cancelled'
};
const storeFilter = (req, extra = {}) => req.storeId ? { ...extra, storeId: req.storeId } : extra;
const postexScopeId = req => req.storeId || req.user._id;

// ── GET /api/postex/cities ───────────────────────────────────────────────────
exports.getCities = async (req, res) => {
    try {
        const cities = await postexService.getOperationalCities(postexScopeId(req));
        res.json({ success: true, data: cities });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ── GET /api/postex/pickup-addresses ────────────────────────────────────────
exports.getPickupAddresses = async (req, res) => {
    try {
        const data = await postexService.getPickupAddresses(postexScopeId(req));
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ── POST /api/postex/pickup-addresses ───────────────────────────────────────
exports.createPickupAddress = async (req, res) => {
    try {
        const data = await postexService.createPickupAddress(postexScopeId(req), req.body);
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, message: err.response?.data?.statusMessage || err.message });
    }
};

// ── GET /api/postex/order-types ─────────────────────────────────────────────
exports.getOrderTypes = async (req, res) => {
    try {
        const data = await postexService.getOrderTypes(postexScopeId(req));
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ── POST /api/postex/create-shipment ────────────────────────────────────────
exports.createShipment = async (req, res) => {
    try {
        const { orderId, orderType, pickupAddressCode, storeAddressCode, cityName,
                customerName, customerPhone, deliveryAddress, invoicePayment,
                invoiceDivision, items, orderDetail, transactionNotes, forceRebook } = req.body;

        if (!orderId) return res.status(400).json({ success: false, message: 'orderId is required.' });

        const order = await Order.findOne(storeFilter(req, { _id: orderId })).populate('items.product', 'title');
        if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });

        // Block duplicate unless admin explicitly requests rebooking
        if (order.isPostExBooked && !forceRebook) {
            return res.status(409).json({
                success: false,
                message: 'This order already has a PostEx shipment. Set forceRebook=true to create another.'
            });
        }

        if (['cancelled', 'returned'].includes(order.orderStatus)) {
            return res.status(422).json({ success: false, message: `Cannot ship a ${order.orderStatus} order.` });
        }

        // Load defaults from integration
        const integration = await PostExIntegration.findOne(req.storeId ? { storeId: req.storeId } : { ownerId: req.user._id });

        const resolvedCity    = cityName    || order.cityName || order.shippingAddress?.city || '';
        const resolvedName    = customerName  || order.customerName || order.shippingAddress?.fullName || '';
        const resolvedPhone   = (customerPhone || order.customerPhone || order.shippingAddress?.phone || '').replace(/[\s\-()]/g, '');
        const resolvedAddr    = deliveryAddress || order.deliveryAddress || [order.shippingAddress?.street, order.shippingAddress?.city].filter(Boolean).join(', ');
        const resolvedCOD     = invoicePayment !== undefined ? Number(invoicePayment) : (order.paymentStatus === 'paid' ? 0 : Number(order.totalAmount));
        const resolvedItems   = items || order.items.reduce((acc, i) => acc + i.quantity, 0);
        const resolvedDetail  = orderDetail  || order.items.map(i => `${i.product?.title || 'Item'} x${i.quantity}`).join(', ').substring(0, 500);
        const resolvedPickup  = pickupAddressCode || integration?.defaultPickupAddressCode;
        const resolvedStore   = storeAddressCode  || integration?.defaultStoreAddressCode;

        const missing = [];
        if (!resolvedCity)   missing.push('cityName');
        if (!resolvedName)   missing.push('customerName');
        if (!resolvedPhone)  missing.push('customerPhone');
        if (!resolvedAddr)   missing.push('deliveryAddress');
        if (!resolvedCOD && resolvedCOD !== 0) missing.push('invoicePayment');
        if (missing.length) return res.status(422).json({ success: false, message: `Missing fields: ${missing.join(', ')}` });

        const payload = {
            orderRefNumber: order.orderNumber || order._id.toString(),
            orderType: orderType || 'Normal',
            cityName: resolvedCity,
            customerName: resolvedName,
            customerPhone: resolvedPhone,
            deliveryAddress: resolvedAddr,
            invoicePayment: resolvedCOD,
            invoiceDivision: invoiceDivision || 1,
            items: resolvedItems,
            orderDetail: resolvedDetail,
            transactionNotes: transactionNotes || order.transactionNotes || '',
            ...(resolvedPickup && { pickupAddressCode: resolvedPickup }),
            ...(resolvedStore  && { storeAddressCode:  resolvedStore })
        };

        // Log request
        await ShipmentLog.create({ storeId: req.storeId, orderId: order._id, action: 'CREATE_ORDER', endpoint: '/v3/create-order', requestPayload: payload }).catch(() => {});

        const response = await postexService.createOrder(postexScopeId(req), payload);

        if (String(response.statusCode) !== '200') {
            const errMsg = response.statusMessage || 'PostEx rejected the booking';
            await ShipmentLog.create({ storeId: req.storeId, orderId: order._id, action: 'CREATE_ORDER_FAILED', endpoint: '/v3/create-order', responsePayload: response, errorMessage: errMsg, success: false }).catch(() => {});
            return res.status(422).json({ success: false, message: errMsg, raw: response });
        }

        const trackingNumber = response.dist?.trackingNumber;
        if (!trackingNumber) throw new Error('PostEx response did not contain a tracking number');

        // Save PostExShipment record
        const shipment = await PostExShipment.create({
            ...(req.storeId && { storeId: req.storeId }),
            ownerId: req.user._id,
            localOrderId: order._id,
            orderRefNumber: payload.orderRefNumber,
            postexTrackingNumber: trackingNumber,
            orderStatus: response.dist?.orderStatus || 'Booked',
            cityName: resolvedCity,
            customerName: resolvedName,
            customerPhone: resolvedPhone,
            deliveryAddress: resolvedAddr,
            invoicePayment: resolvedCOD,
            invoiceDivision: payload.invoiceDivision,
            items: resolvedItems,
            orderType: payload.orderType,
            orderDetail: resolvedDetail,
            pickupAddressCode: resolvedPickup,
            storeAddressCode: resolvedStore,
            rawCreateResponse: response
        });

        // Update order
        if (!order.postex) order.postex = {};
        order.postex.trackingNumber = trackingNumber;
        order.postex.orderStatus    = response.dist?.orderStatus || 'Booked';
        order.postex.orderDate      = new Date();
        order.postex.rawCreateResponse = response;
        order.deliveryStatus  = 'Booked';
        order.isPostExBooked  = true;
        order.orderStatus     = order.orderStatus === 'pending' ? 'processing' : order.orderStatus;
        await order.save();

        await ShipmentLog.create({ storeId: req.storeId, orderId: order._id, action: 'CREATE_ORDER', endpoint: '/v3/create-order', responsePayload: response, statusCode: 200, success: true }).catch(() => {});
        await OrderEvent.create({ orderId: order._id, eventType: 'POSTEX_BOOKED', message: `Booked on PostEx — Tracking: ${trackingNumber}`, createdBy: req.user._id }).catch(() => {});

        res.json({ success: true, message: `Shipment booked. Tracking: ${trackingNumber}`, data: { order, shipment } });

    } catch (err) {
        console.error('[PostEx] createShipment CRITICAL ERROR:', {
            message: err.message,
            responseData: err.response?.data
        });
        const status = err.response?.status || 500;
        const msg = err.response?.data?.statusMessage || err.message || 'Internal Server Error during shipment creation';
        res.status(status).json({ success: false, message: msg });
    }
};

// ── GET /api/postex/shipments ────────────────────────────────────────────────
exports.getShipments = async (req, res) => {
    try {
        const { status, city, from, to, trackingNumber, page = 1, limit = 50 } = req.query;
        const filter = req.storeId ? { storeId: req.storeId } : { ownerId: req.user._id };
        if (status) filter.orderStatus = status;
        if (city)   filter.cityName = new RegExp(city, 'i');
        if (trackingNumber) filter.postexTrackingNumber = new RegExp(trackingNumber, 'i');
        if (from || to) {
            filter.createdAt = {};
            if (from) filter.createdAt.$gte = new Date(from);
            if (to)   filter.createdAt.$lte = new Date(to);
        }
        const shipments = await PostExShipment.find(filter)
            .populate('localOrderId', 'orderNumber totalAmount orderStatus')
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(Number(limit));
        const total = await PostExShipment.countDocuments(filter);
        res.json({ success: true, data: shipments, total });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ── GET /api/postex/track/:trackingNumber ────────────────────────────────────
exports.trackSingle = async (req, res) => {
    try {
        const { trackingNumber } = req.params;
        const response = await postexService.trackOrder(postexScopeId(req), trackingNumber);

        // Update local shipment record
        const shipment = await PostExShipment.findOne(req.storeId ? { storeId: req.storeId, postexTrackingNumber: trackingNumber } : { ownerId: req.user._id, postexTrackingNumber: trackingNumber });
        if (shipment && response.dist) {
            const newStatus = POSTEX_TO_LOCAL_STATUS[response.dist.transactionStatus] || shipment.orderStatus;
            shipment.orderStatus = newStatus;
            shipment.transactionStatus = response.dist.transactionStatus;
            shipment.transactionStatusHistory = response.dist.transactionHistory || [];
            shipment.rawTrackingResponse = response;
            shipment.lastSyncedAt = new Date();
            await shipment.save();

            // Also update the linked order's deliveryStatus
            if (shipment.localOrderId) {
                await Order.findByIdAndUpdate(shipment.localOrderId, {
                    'postex.transactionStatus': response.dist.transactionStatus,
                    'postex.lastTrackingSyncAt': new Date(),
                    deliveryStatus: newStatus
                });
            }
        }

        res.json({ success: true, data: response, shipment });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ── POST /api/postex/track-bulk ──────────────────────────────────────────────
exports.trackBulk = async (req, res) => {
    try {
        const { trackingNumbers } = req.body;
        if (!Array.isArray(trackingNumbers) || trackingNumbers.length === 0) {
            return res.status(400).json({ success: false, message: 'trackingNumbers array is required.' });
        }
        const response = await postexService.trackBulkOrders(postexScopeId(req), trackingNumbers);
        res.json({ success: true, data: response });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ── PUT /api/postex/cancel/:trackingNumber ───────────────────────────────────
exports.cancelShipment = async (req, res) => {
    try {
        const { trackingNumber } = req.params;

        // Ownership check
        const shipment = await PostExShipment.findOne(req.storeId ? { storeId: req.storeId, postexTrackingNumber: trackingNumber } : { ownerId: req.user._id, postexTrackingNumber: trackingNumber });
        if (!shipment) return res.status(404).json({ success: false, message: 'Shipment not found.' });

        const response = await postexService.cancelOrder(postexScopeId(req), trackingNumber);

        shipment.orderStatus = 'Cancelled';
        shipment.isCancelled = true;
        await shipment.save();

        if (shipment.localOrderId) {
            await Order.findByIdAndUpdate(shipment.localOrderId, { deliveryStatus: 'Cancelled' });
            await OrderEvent.create({ orderId: shipment.localOrderId, eventType: 'POSTEX_CANCELLED', message: `PostEx shipment ${trackingNumber} cancelled.`, createdBy: req.user._id }).catch(() => {});
        }

        res.json({ success: true, message: 'Shipment cancelled.', data: response });
    } catch (err) {
        res.status(500).json({ success: false, message: err.response?.data?.statusMessage || err.message });
    }
};

// ── GET /api/postex/payment-status/:trackingNumber ───────────────────────────
exports.getPaymentStatus = async (req, res) => {
    try {
        const { trackingNumber } = req.params;

        // Ownership check
        const shipment = await PostExShipment.findOne(req.storeId ? { storeId: req.storeId, postexTrackingNumber: trackingNumber } : { ownerId: req.user._id, postexTrackingNumber: trackingNumber });
        if (!shipment) return res.status(404).json({ success: false, message: 'Shipment not found or does not belong to your account.' });

        const response = await postexService.getPaymentStatus(postexScopeId(req), trackingNumber);

        // Persist payment info
        if (response.dist) {
            shipment.paymentSettled = !!response.dist.settle;
            shipment.settlementDate = response.dist.settlementDate ? new Date(response.dist.settlementDate) : null;
            shipment.rawPaymentStatusResponse = response;
            await shipment.save();
        }

        res.json({ success: true, data: response, shipment });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ── POST /api/postex/load-sheet ──────────────────────────────────────────────
exports.generateLoadSheet = async (req, res) => {
    try {
        const { trackingNumbers, pickupAddress } = req.body;
        if (!Array.isArray(trackingNumbers) || trackingNumbers.length === 0) {
            return res.status(400).json({ success: false, message: 'trackingNumbers is required.' });
        }

        // Verify all tracking numbers belong to this owner
        const owned = await PostExShipment.find(req.storeId ? { storeId: req.storeId, postexTrackingNumber: { $in: trackingNumbers } } : { ownerId: req.user._id, postexTrackingNumber: { $in: trackingNumbers } });
        if (owned.length !== trackingNumbers.length) {
            return res.status(403).json({ success: false, message: 'Some tracking numbers do not belong to your account.' });
        }

        const pdfBuffer = await postexService.generateLoadSheet(postexScopeId(req), trackingNumbers, pickupAddress);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="load-sheet.pdf"');
        res.send(Buffer.from(pdfBuffer));
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ── GET /api/postex/invoice ──────────────────────────────────────────────────
exports.getInvoice = async (req, res) => {
    try {
        const trackingNumbers = String(req.query.trackingNumbers || '').split(',').filter(Boolean).slice(0, 10);
        if (trackingNumbers.length === 0) {
            return res.status(400).json({ success: false, message: 'trackingNumbers query param required (comma-separated, max 10).' });
        }

        // Ownership check
        const owned = await PostExShipment.find(req.storeId ? { storeId: req.storeId, postexTrackingNumber: { $in: trackingNumbers } } : { ownerId: req.user._id, postexTrackingNumber: { $in: trackingNumbers } });
        if (owned.length !== trackingNumbers.length) {
            return res.status(403).json({ success: false, message: 'Some tracking numbers do not belong to your account.' });
        }

        const response = await postexService.getAirwayBillUrl(postexScopeId(req), trackingNumbers);
        res.json({ success: true, data: response });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ── GET /api/postex/all-orders ───────────────────────────────────────────────
exports.getAllOrders = async (req, res) => {
    try {
        const { statusId, fromDate, toDate } = req.query;
        const response = await postexService.listOrders(postexScopeId(req), { statusId, fromDate, toDate });
        res.json({ success: true, data: response });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ── POST /api/postex/sync-tracking (bulk sync local active shipments) ─────────
exports.syncTracking = async (req, res) => {
    try {
        const activeShipments = await PostExShipment.find({
            ...(req.storeId ? { storeId: req.storeId } : { ownerId: req.user._id }),
            isCancelled: false,
            orderStatus: { $nin: ['Delivered', 'Returned', 'Cancelled'] }
        }).limit(50);

        if (!activeShipments.length) return res.json({ success: true, message: 'No active shipments to sync.', updatesCount: 0 });

        const trackingNumbers = activeShipments.map(s => s.postexTrackingNumber);
        const response = await postexService.trackBulkOrders(req.user._id, trackingNumbers);

        let updatesCount = 0;
        if (Array.isArray(response.dist)) {
            for (const item of response.dist) {
                const shipment = activeShipments.find(s => s.postexTrackingNumber === item.trackingNumber);
                if (!shipment) continue;
                const newStatus = POSTEX_TO_LOCAL_STATUS[item.transactionStatus] || shipment.orderStatus;
                if (newStatus !== shipment.orderStatus) {
                    shipment.orderStatus = newStatus;
                    shipment.transactionStatus = item.transactionStatus;
                    shipment.transactionStatusHistory = item.transactionHistory || [];
                    shipment.lastSyncedAt = new Date();
                    await shipment.save();
                    if (shipment.localOrderId) {
                        const orderUpdate = { deliveryStatus: newStatus, 'postex.transactionStatus': item.transactionStatus, 'postex.lastTrackingSyncAt': new Date() };
                        if (newStatus === 'Delivered') { orderUpdate.orderStatus = 'delivered'; orderUpdate.paymentStatus = 'paid'; }
                        if (newStatus === 'Returned')  { orderUpdate.orderStatus = 'returned'; }
                        await Order.findByIdAndUpdate(shipment.localOrderId, orderUpdate);
                    }
                    updatesCount++;
                }
            }
        }

        res.json({ success: true, updatesCount, message: `Sync complete. ${updatesCount} shipments updated.` });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ── GET /api/postex/failed-logs ──────────────────────────────────────────────
exports.getFailedLogs = async (req, res) => {
    try {
        const logs = await ShipmentLog.find({ success: false, ...(req.storeId && { storeId: req.storeId }) })
            .populate('orderId', 'orderNumber customerName totalAmount')
            .sort({ createdAt: -1 })
            .limit(100);
        res.json({ success: true, data: logs });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ── Shipper advice ────────────────────────────────────────────────────────────
exports.saveShipperAdvice = async (req, res) => {
    try {
        const { trackingNumber, statusId, remarks } = req.body;
        const response = await postexService.saveShipperAdvice(postexScopeId(req), trackingNumber, statusId, remarks);
        res.json({ success: true, data: response });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};
