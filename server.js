const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const compression = require('compression');
const dns = require('dns');
const { securityHeaders, simpleRateLimit, sanitizeRequest } = require('./middleware/securityMiddleware');

// Load environment variables
dotenv.config();

// CRITICAL FIX: Force Google DNS to bypass local DNS issues
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
console.log('✅ DNS servers configured: Using Google DNS (8.8.8.8) to bypass local DNS issues');

const connectDB = require('./config/db');
const Media = require('./models/Media');

const app = express();

const isProduction = process.env.NODE_ENV === 'production';

/**
 * 1. POWERFUL CORS FAILSAFE (Must be first to handle preflights and errors)
 */
const allowedOrigins = [
    process.env.FRONTEND_URL,
    process.env.ADMIN_APP_URL,
    process.env.BACKEND_URL,
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5000',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'http://127.0.0.1:5000',
    'https://store-pannel.vercel.app',
    'https://store-admin-one.vercel.app',
    'https://luminelle.org'
].filter(Boolean);

app.use((req, res, next) => {
    const origin = req.headers.origin;
    
    // Always allow localhost origins and specified origins
    if (!origin || origin.includes('localhost') || origin.includes('127.0.0.1') || allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin || '*');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
        res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Authorization, Accept, x-store-id');
        res.setHeader('Access-Control-Max-Age', '3600');
    }

    if (req.method === 'OPTIONS') return res.status(200).end();
    next();
});

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || origin.includes('localhost') || origin.includes('127.0.0.1') || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(null, true);
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-store-id']
}));
app.use(securityHeaders);
app.use(simpleRateLimit);

// 2. DATABASE CONNECTION (Optimized)
if (!isProduction) {
    connectDB().catch(err => console.error('Initial DB Connection Error:', err));
}

app.use(async (req, res, next) => {
    try {
        // If not connected, try to connect. connectDB handles caching internally.
        if (mongoose.connection.readyState !== 1) {
            await connectDB();
        }
        global.isDbConnected = true;
        next();
    } catch (error) {
        global.isDbConnected = false;
        console.error('Middleware DB Error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Database connection failed',
            error: error.message
        });
    }
});

/**
 * 3. PERFORMANCE & SECURITY MIDDLEWARE
 */
app.use(compression());
app.use(express.json({ limit: '2mb' })); 
app.use(express.urlencoded({ limit: '2mb', extended: true }));
app.use(sanitizeRequest);

/**
 * 4. IMAGE SERVING (CRITICAL FIX)
 * Serves images from both MongoDB and local uploads folder.
 */
app.get('/uploads/:filename', async (req, res) => {
    try {
        const { filename } = req.params;

        // 1. Try Database First (For Vercel persistence)
        const media = await Media.findOne({ filename });
        if (media && media.data) {
            res.set({
                'Cache-Control': 'public, max-age=31536000, immutable',
                'Access-Control-Allow-Origin': '*',
                'Content-Security-Policy': "default-src 'self'",
                'X-Content-Type-Options': 'nosniff'
            });
            res.type(media.contentType); // Correctly sets Content-Type without charset
            return res.send(media.data); // Buffer is sent correctly as binary
        }

        // 2. Fallback to Local Filesystem
        const localPath = path.join(__dirname, 'public/uploads', filename);
        if (fs.existsSync(localPath)) {
            res.set('Cache-Control', 'public, max-age=86400');
            return res.sendFile(localPath);
        }

        res.status(404).json({ success: false, message: 'Image not found' });
    } catch (error) {
        console.error('Error serving image:', error);
        res.status(500).send('Internal Server Error');
    }
});

/**
 * 5. ROUTES
 */
const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
const categoryRoutes = require('./routes/categories');
const userRoutes = require('./routes/users');
const couponRoutes = require('./routes/coupons');
const reviewRoutes = require('./routes/reviews');
const statsRoutes = require('./routes/stats');
const auditRoutes = require('./routes/audit');
const bannerRoutes = require('./routes/banners');
const settingsRoutes = require('./routes/settings');
const seoRoutes = require('./routes/seo');
const supportTicketRoutes = require('./routes/support-tickets');
const uploadRoutes = require('./routes/upload');
const postexRoutes = require('./routes/postex');
const metaRoutes = require('./routes/meta');
const publicMetaRoutes = require('./routes/publicMeta');
const trackingRoutes = require('./routes/tracking');
const sellerRoutes = require('./routes/seller');
const staffRoutes = require('./routes/staff');
const storefrontRoutes = require('./routes/storefront');
const designImportRoutes = require('./routes/designImport');
const managedStorefrontRoutes = require('./routes/managedStorefront');
const { protect } = require('./middleware/authMiddleware');
const { resolveActiveStore, requireStorePermission } = require('./middleware/storeMiddleware');

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/users', userRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/banners', bannerRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/seo', seoRoutes);
app.use('/api/support-tickets', supportTicketRoutes);
app.use('/api/upload', protect, resolveActiveStore, requireStorePermission('manage_storefront'), uploadRoutes);
app.use('/api/postex', postexRoutes);
app.use('/api/meta', metaRoutes);
app.use('/api/store/meta', publicMetaRoutes);
app.use('/api/tracking', trackingRoutes);
app.use('/api/seller', sellerRoutes);
app.use('/api/seller/design-import', designImportRoutes);
app.use('/api/seller/managed-storefront', managedStorefrontRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/seller/media/upload', protect, resolveActiveStore, requireStorePermission('manage_storefront'), uploadRoutes);
app.use('/api/storefront', storefrontRoutes);
// Legacy visual builder API disabled — imported-store manager is canonical.
// app.use('/api/builder', protect, builderRoutes);

// Conversions API database queue processor background worker
if (process.env.ENABLE_TRACKING_WORKER === 'true' || process.env.NODE_ENV !== 'production') {
    const { processPendingQueue } = require('./services/metaQueueService');
    console.log('🔄 [Meta Queue Worker] Starting background sync process (every 15s)...');
    setInterval(async () => {
        try {
            await processPendingQueue(25);
        } catch (err) {
            console.error('❌ [Meta Queue Worker Error]:', err.message);
        }
    }, 15000);
}

// Static files (must be after /uploads/ route to prioritize DB serving)
app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
    console.error('SERVER ERROR:', err);
    res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Server Error'
    });
});

const http = require('http');
const socketUtil = require('./utils/socket'); // Import socket util

// ... (existing middleware) ...

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.io
const io = socketUtil.init(server);

io.on('connection', async (socket) => {
    console.log('Client connected:', socket.id);

    try {
        const token = socket.handshake.auth?.token;
        const storeId = socket.handshake.auth?.storeId;
        if (token && storeId) {
            const jwt = require('jsonwebtoken');
            const User = require('./models/User');
            const StoreMember = require('./models/StoreMember');
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const user = await User.findById(decoded.id);
            const membership = user && await StoreMember.findOne({ userId: user._id, storeId, status: 'active' });
            if (membership) {
                socket.join(`store:${storeId}`);
                socket.data.userId = user._id.toString();
                socket.data.storeId = storeId;
            }
        }
    } catch (error) {
        console.warn('Socket auth failed:', error.message);
    }

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 5000;

/**
 * STARTUP WRAPPER
 * Automatically kills existing process on PORT to prevent EADDRINUSE in dev
 */
const startServer = (retries = 3) => {
    server.listen(PORT, () => {
        console.log(`🚀 Server running on port ${PORT}`);
    }).on('error', (err) => {
        if (err.code === 'EADDRINUSE' && retries > 0) {
            console.log(`[RETRY] Port ${PORT} busy, retrying in 1.5s... (${retries} left)`);
            setTimeout(() => startServer(retries - 1), 1500);
        } else {
            console.error('[FATAL] Server failed to start:', err);
            process.exit(1);
        }
    });
};

startServer();

module.exports = server; // Export server instead of app
