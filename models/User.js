const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const addressSchema = new mongoose.Schema({
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    street: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    postalCode: { type: String, required: true },
    country: { type: String, required: true },
    isDefault: { type: Boolean, default: false }
});

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Please add a name'],
        trim: true
    },
    email: {
        type: String,
        required: [true, 'Please add an email'],
        unique: true,
        lowercase: true,
        match: [/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/, 'Please add a valid email'],
        index: true
    },
    password: {
        type: String,
        required: [true, 'Please add a password'],
        minlength: 6,
        select: false
    },
    role: {
        type: String,
        enum: ['customer', 'admin', 'user'],
        default: 'customer'
    },
    status: {
        type: String,
        enum: ['active', 'banned'],
        default: 'active'
    },
    points: {
        type: Number,
        default: 0
    },
    tier: {
        type: String,
        enum: ['Bronze', 'Silver', 'Gold', 'Platinum'],
        default: 'Bronze'
    },
    phone: String,
    gender: {
        type: String,
        enum: ['Male', 'Female', 'Other', 'Prefer not to say']
    },
    avatar: {
        type: String,
        default: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Lucky'
    },
    wishlist: [{
        type: mongoose.Schema.ObjectId,
        ref: 'Product'
    }],
    fcmTokens: [{ type: String }],
    addresses: [addressSchema]
}, { timestamps: true });

// Encrypt password using bcrypt
userSchema.pre('save', async function () {
    if (!this.isModified('password')) {
        return;
    }
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
});

// Match user entered password to hashed password in database
userSchema.methods.matchPassword = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
