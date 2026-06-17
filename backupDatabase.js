const mongoose = require('mongoose');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const Product = require('./models/Product');
const Category = require('./models/Category');
const Order = require('./models/Order');
const Review = require('./models/Review');
const Coupon = require('./models/Coupon');
const User = require('./models/User');
const auditLogger = require('./utils/auditLogger');

dotenv.config();

/**
 * 🛡️ DATABASE BACKUP UTILITY
 * 
 * Creates a JSON backup of all your database collections
 * Backups are stored in ./backups/ directory
 * 
 * Usage: node backupDatabase.js
 */

const backupDatabase = async () => {
    try {
        console.log('\n========================================');
        console.log('🛡️  DATABASE BACKUP UTILITY');
        console.log('========================================\n');

        // Connect to database
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        // Create backups directory if it doesn't exist
        const backupDir = path.join(__dirname, 'backups');
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir);
        }

        // Generate timestamp for backup filename
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFile = path.join(backupDir, `backup-${timestamp}.json`);

        console.log('📦 Fetching data from database...');

        // Fetch all data
        const backup = {
            timestamp: new Date().toISOString(),
            products: await Product.find().lean(),
            categories: await Category.find().lean(),
            orders: await Order.find().lean(),
            reviews: await Review.find().lean(),
            coupons: await Coupon.find().lean(),
            users: await User.find().select('-password').lean() // Exclude passwords
        };

        // Count records
        const counts = {
            products: backup.products.length,
            categories: backup.categories.length,
            orders: backup.orders.length,
            reviews: backup.reviews.length,
            coupons: backup.coupons.length,
            users: backup.users.length
        };

        console.log('📊 Backup Contents:');
        console.log(`   Products: ${counts.products}`);
        console.log(`   Categories: ${counts.categories}`);
        console.log(`   Orders: ${counts.orders}`);
        console.log(`   Reviews: ${counts.reviews}`);
        console.log(`   Coupons: ${counts.coupons}`);
        console.log(`   Users: ${counts.users}`);
        console.log('');

        // Write to file
        fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));

        const fileSize = (fs.statSync(backupFile).size / 1024).toFixed(2);

        // Log to audit trail
        auditLogger.logBackup(path.basename(backupFile), counts);

        console.log('✅ Backup created successfully!');
        console.log(`   File: ${backupFile}`);
        console.log(`   Size: ${fileSize} KB`);
        console.log('');
        console.log('💡 To restore this backup:');
        console.log(`   node restoreDatabase.js ${path.basename(backupFile)}`);
        console.log('');

        process.exit(0);
    } catch (err) {
        auditLogger.logError('DATABASE_BACKUP', err);
        console.error(`❌ Error: ${err.message}`);
        process.exit(1);
    }
};

// Execute
backupDatabase();
