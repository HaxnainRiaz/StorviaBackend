const mongoose = require('mongoose');
const dns = require('dns');

// CRITICAL FIX: Force Google DNS to bypass local DNS issues
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

// Global cache to prevent multiple connections in serverless environment
let cached = global.mongoose;

if (!cached) {
    cached = global.mongoose = { conn: null, promise: null };
}

const connectDB = async (retryCount = 0, maxRetries = 3) => {
    const uri = process.env.MONGODB_URI || process.env.DATABASE_URL;

    if (!uri) {
        console.error('CRITICAL ERROR: MONGODB_URI is missing!');
        throw new Error('Please define the MONGODB_URI environment variable');
    }

    // Strict validation for DB name in URI to avoid data fragmentation
    const uriParts = uri.split('?')[0].split('/');
    const dbName = uriParts[uriParts.length - 1];

    if (!dbName || dbName.startsWith('?')) {
        console.error('CRITICAL ERROR: No database name found in MONGODB_URI!');
        console.error('Your URI should look like: mongodb+srv://user:pass@cluster.mongodb.net/DATABASE_NAME');
        throw new Error('MONGODB_URI must include an explicit database name to prevent data loss or fragmentation.');
    }

    if (cached.conn) {
        return cached.conn;
    }

    if (!cached.promise) {
        const isSrv = uri.startsWith('mongodb+srv://');
        const isLocal = uri.includes('localhost') || uri.includes('127.0.0.1');
        const hasTlsInUri = /[?&](tls|ssl)=/i.test(uri);
        const isAtlas = uri.includes('mongodb.net');
        const opts = {
            bufferCommands: false,
            serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000),
            socketTimeoutMS: Number(process.env.MONGO_SOCKET_TIMEOUT_MS || 30000),
            family: 4, // IPv4 only
            retryWrites: true,
            retryReads: true,
            maxPoolSize: 10,
            minPoolSize: 2,
            connectTimeoutMS: Number(process.env.MONGO_CONNECT_TIMEOUT_MS || 10000)
        };

        // Do not pass tls/ssl in both URI and options. The MongoDB driver rejects
        // mixed ssl/tls values, even when they represent the same idea.
        if (!hasTlsInUri && !isLocal && (isSrv || isAtlas)) {
            opts.tls = true;
        }

        if (isSrv && !isLocal) opts.authSource = 'admin';

        const maskedUri = uri.replace(/:([^@]+)@/, ':****@');
        console.log(`Initializing new MongoDB connection to: ${maskedUri}`);

        cached.promise = (async () => {
            try {
                const conn = await mongoose.connect(uri, opts);
                console.log(`✅ MongoDB Connected successfully: ${conn.connection.host}`);
                return conn;
            } catch (err) {
                console.error('❌ MongoDB Connection Error:', err.message);
                
                // Better diagnostics
                if (err.message.includes('EBADRESP') || err.message.includes('querySrv') || err.message.includes('getaddrinfo')) {
                    console.error(`
┌─────────────────────────────────────────────────────────┐
│ 🔴 DNS/Network Issue Detected - SOLUTION REQUIRED       │
├─────────────────────────────────────────────────────────┤
│ ACTION NEEDED:                                          │
│ 1. Go to: https://cloud.mongodb.com                     │
│ 2. Select your cluster → Network Access                 │
│ 3. Click "+ ADD IP ADDRESS"                             │
│ 4. Enter: 0.0.0.0/0 (or your specific IP)               │
│ 5. Click CONFIRM                                        │
│                                                         │
│ Then restart your server with: npm run dev              │
└─────────────────────────────────────────────────────────┘
                    `);
                } else if (err.message.includes('authentication failed')) {
                    console.error(`
┌─────────────────────────────────────────────────────────┐
│ 🔴 Authentication Failed                                │
├─────────────────────────────────────────────────────────┤
│ • Check username/password in .env                       │
│ • Verify credentials at MongoDB Atlas                   │
│ • Ensure special chars are URL-encoded                  │
└─────────────────────────────────────────────────────────┘
                    `);
                }
                
                throw err;
            }
        })();

        // Add Connection Event Listeners
        mongoose.connection.on('connected', () => {
            console.log('✅ [Mongoose] Connection established');
        });

        mongoose.connection.on('disconnected', () => {
            console.warn('⚠️ [Mongoose] Connection lost or disconnected');
        });

        mongoose.connection.on('reconnected', () => {
            console.log('🔄 [Mongoose] Reconnected to MongoDB');
        });

        mongoose.connection.on('error', (err) => {
            console.error('❌ [Mongoose] Connection Error:', err.message);
        });
    }

    try {
        cached.conn = await cached.promise;
    } catch (e) {
        cached.promise = null;
        cached.conn = null;
        if (retryCount < maxRetries) {
            const delayMs = Math.min(2000 * (retryCount + 1), 8000);
            console.warn(`[MongoDB] Retry ${retryCount + 1}/${maxRetries} in ${delayMs}ms...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
            return connectDB(retryCount + 1, maxRetries);
        }
        throw e;
    }

    return cached.conn;
};

module.exports = connectDB;
