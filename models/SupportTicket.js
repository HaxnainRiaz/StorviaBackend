const mongoose = require('mongoose');

const supportTicketSchema = new mongoose.Schema({
    storeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Store',
        required: false,
        index: true
    },
    name: {
        type: String,
        required: [true, 'Please add a name']
    },
    email: {
        type: String,
        required: [true, 'Please add an email'],
        match: [/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/, 'Please add a valid email'],
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    message: {
        type: String,
        required: [true, 'Please add a message']
    },
    status: {
        type: String,
        enum: ['open', 'in-progress', 'resolved'],
        default: 'open'
    },
    replies: [{
        sender: { type: String, enum: ['user', 'admin'], default: 'user' },
        message: { type: String, required: true },
        createdAt: { type: Date, default: Date.now }
    }]
}, { timestamps: true });

supportTicketSchema.index({ storeId: 1, status: 1 });

module.exports = mongoose.models.SupportTicket || mongoose.model('SupportTicket', supportTicketSchema);
