const express = require('express');
const { getTickets, getMyTickets, updateTicket, createTicket, addReply, deleteTicket } = require('../controllers/supportTicketController');
const { protect, authorize, optional } = require('../middleware/authMiddleware');
const { resolveActiveStore, requireStorePermission } = require('../middleware/storeMiddleware');

const router = express.Router();
const storefrontOnly = (req, res) => res.status(410).json({
    success: false,
    message: 'Support tickets are store-scoped. Use /api/storefront/:storeSlug/support/tickets.'
});

router.route('/')
    .get(protect, resolveActiveStore, requireStorePermission('manage_support'), getTickets)
    .post(storefrontOnly);

router.get('/my-tickets', protect, resolveActiveStore, requireStorePermission('manage_support'), getMyTickets);

router.route('/:id')
    .put(protect, resolveActiveStore, requireStorePermission('manage_support'), updateTicket)
    .delete(protect, resolveActiveStore, requireStorePermission('manage_support'), deleteTicket);

router.post('/:id/reply', protect, resolveActiveStore, requireStorePermission('manage_support'), addReply);

module.exports = router;

