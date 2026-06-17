const mongoose = require('mongoose');

const editorSessionSchema = new mongoose.Schema({
    storeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Store',
        required: true,
        index: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    pageId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true
    },
    activeElementId: String,
    selectedElements: [String],
    viewport: {
        mode: {
            type: String,
            enum: ['desktop', 'tablet', 'mobile'],
            default: 'desktop'
        },
        width: {
            type: Number,
            default: 1280
        },
        zoom: {
            type: Number,
            default: 100
        }
    },
    cursorPosition: {
        x: Number,
        y: Number
    },
    isDirty: {
        type: Boolean,
        default: false
    },
    lastActivity: {
        type: Date,
        default: Date.now,
        index: true,
        expires: 3600 // Auto-delete after 1 hour of inactivity
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('EditorSession', editorSessionSchema);
