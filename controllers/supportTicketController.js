const SupportTicket = require('../models/SupportTicket');
const { createLog } = require('./auditController');
const { sendPushNotification } = require('../utils/firebase');
const User = require('../models/User');
const socketUtil = require('../utils/socket');
const StoreMember = require('../models/StoreMember');
const { createStoreNotification } = require('../services/storeNotificationService');
const storeFilter = (req, extra = {}) => req.storeId ? { ...extra, storeId: req.storeId } : extra;
const findStoreStaff = async (storeId) => {
    if (!storeId) return [];
    const members = await StoreMember.find({ storeId, status: 'active' }).select('userId').lean();
    return User.find({ _id: { $in: members.map(member => member.userId) } });
};

// @desc    Get all support tickets
// @route   GET /api/support-tickets
// @access  Private/Admin
exports.getTickets = async (req, res) => {
    try {
        const tickets = await SupportTicket.find(storeFilter(req)).populate('user', 'name email').sort('-createdAt');
        res.status(200).json({ success: true, count: tickets.length, data: tickets });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Get user's own tickets
// @route   GET /api/support-tickets/my-tickets
// @access  Private
exports.getMyTickets = async (req, res) => {
    try {
        const tickets = await SupportTicket.find({ user: req.user.id, ...(req.storeId && { storeId: req.storeId }) }).sort('-createdAt');
        res.status(200).json({ success: true, data: tickets });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Update ticket status
// @route   PUT /api/support-tickets/:id
// @access  Private/Admin
exports.updateTicket = async (req, res) => {
    try {
        const ticket = await SupportTicket.findOneAndUpdate(storeFilter(req, { _id: req.params.id }), req.body, {
            new: true,
            runValidators: true
        });

        // Audit Log
        await createLog(req.user.id, 'support_update', `Ticket from ${ticket.email} set to ${ticket.status}`, { storeId: req.storeId, entity: 'support_ticket', entityId: ticket._id, req });

        // Emit Update
        try {
            const io = socketUtil.getIO();
            req.storeId ? io.to(`store:${req.storeId}`).emit('support:ticket:updated', ticket) : io.emit('support:ticket:update', ticket);
        } catch (e) { }

        res.status(200).json({ success: true, data: ticket });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Public submission
// @route   POST /api/support-tickets
// @access  Public
exports.createTicket = async (req, res) => {
    try {
        const ticketData = { ...req.body };
        if (req.user) {
            ticketData.user = req.user.id;
        }
        if (req.storeId) ticketData.storeId = req.storeId;
        const ticket = await SupportTicket.create(ticketData);

        // Emit New Ticket
        try {
            const populatedTicket = await SupportTicket.findById(ticket._id).populate('user', 'name email');
            const io = socketUtil.getIO();
            req.storeId ? io.to(`store:${req.storeId}`).emit('support:ticket:new', populatedTicket) : io.emit('support:ticket:new', populatedTicket);

            // Push Notification for Admins
            // Push Notification for Admins

            const admins = await findStoreStaff(req.storeId);
            const adminTokens = admins.flatMap(a => a.fcmTokens || []);

            if (adminTokens.length > 0) {
                sendPushNotification(adminTokens, {
                    title: '🎫 New Support Ticket',
                    body: `From: ${populatedTicket.email}`,
                    data: {
                        type: 'NEW_TICKET',
                        ticketId: populatedTicket._id.toString()
                    }
                });
            }
        } catch (e) { }

        res.status(201).json({ success: true, data: ticket });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Add reply to ticket
// @route   POST /api/support-tickets/:id/reply
// @access  Private (User or Admin)
exports.addReply = async (req, res) => {
    try {
        const ticket = await SupportTicket.findOne(storeFilter(req, { _id: req.params.id }));
        if (!ticket) {
            return res.status(404).json({ success: false, message: 'Ticket not found' });
        }

        // Check ownership if not admin
        const isStoreStaff = !!req.storeId && !!req.storeMember;
        if (!isStoreStaff && req.user.role !== 'admin' && ticket.user?.toString() !== req.user.id) {
            return res.status(401).json({ success: false, message: 'Not authorized' });
        }

        let sender = 'user';
        if (isStoreStaff) {
            sender = 'admin';
        } else if (req.user.role === 'admin' || req.user.role === 'user') {
            if (req.body.sender === 'admin') {
                sender = 'admin';
            } else if (ticket.user?.toString() === req.user.id) {
                sender = 'user';
            } else {
                sender = 'admin';
            }
        }

        const reply = {
            sender,
            message: req.body.message
        };

        ticket.replies.push(reply);

        // If admin replies, set status to in-progress if it was open
        if ((req.user.role === 'admin' || isStoreStaff) && ticket.status === 'open') {
            ticket.status = 'in-progress';
        }

        await ticket.save();

        if (req.user.role === 'admin' || isStoreStaff) {
            await createLog(req.user.id, 'support_reply', `Admin replied to ticket from ${ticket.email}`, { storeId: req.storeId, entity: 'support_ticket', entityId: ticket._id, req });
        }

        // Emit Message Update (so chat updates live)
        try {
            const updatedTicket = await SupportTicket.findOne(storeFilter(req, { _id: req.params.id })).populate('user', 'name email');
            const io = socketUtil.getIO();
            req.storeId ? io.to(`store:${req.storeId}`).emit('support:message:new', updatedTicket) : io.emit('support:message', updatedTicket);
            // Also emit generic update
            req.storeId ? io.to(`store:${req.storeId}`).emit('support:ticket:updated', updatedTicket) : io.emit('support:ticket:update', updatedTicket);

            // Push Notification for Admins if User replied
            if (req.user && req.user.role !== 'admin') {
                await createStoreNotification({
                    storeId: req.storeId,
                    type: 'ticket_reply',
                    title: 'New support ticket reply',
                    body: `User replied: ${reply.message.substring(0, 50)}${reply.message.length > 50 ? '...' : ''}`,
                    payload: { ticketId: updatedTicket._id.toString() },
                    permissions: ['manage_support']
                });
                const admins = await findStoreStaff(req.storeId);
                const adminTokens = admins.flatMap(a => a.fcmTokens || []);

                if (adminTokens.length > 0) {
                    sendPushNotification(adminTokens, {
                        title: '💬 New Message on Ticket',
                        body: `User replied: ${reply.message.substring(0, 50)}${reply.message.length > 50 ? '...' : ''}`,
                        data: {
                            type: 'TICKET_REPLY',
                            ticketId: updatedTicket._id.toString()
                        }
                    });
                }
            }
        } catch (e) { }

        res.status(200).json({ success: true, data: ticket });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Delete ticket
// @route   DELETE /api/support-tickets/:id
// @access  Private/Admin
exports.deleteTicket = async (req, res) => {
    try {
        await SupportTicket.findOneAndDelete(storeFilter(req, { _id: req.params.id }));
        res.status(200).json({ success: true, data: {} });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};
