const mongoose = require('mongoose');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const Product = require('./models/Product');
const Category = require('./models/Category');
const Order = require('./models/Order');
const Review = require('./models/Review');
const Coupon = require('./models/Coupon');
const auditLogger = require('./utils/auditLogger');

dotenv.config();

/**
 * 🔄 DATABASE RESTORE UTILITY
 * 
 * Restores data from a backup file
 * 
 * Usage: node restoreDatabase.js <backup-filename>
 * Example: node restoreDatabase.js backup-2026-01-06T18-30-00-000Z.json
 */

const restoreDatabase = async () => {
    try {
        const backupFilename = process.argv[2];

        if (!backupFilename) {
            console.log('\n❌ Error: Please provide a backup filename');
            console.log('Usage: node restoreDatabase.js <backup-filename>');
            console.log('\nAvailable backups:');

            const backupDir = path.join(__dirname, 'backups');
            if (fs.existsSync(backupDir)) {
                const files = fs.readdirSync(backupDir).filter(f => f.endsWith('.json'));
                files.forEach(f => console.log(`  - ${f}`));
            } else {
                console.log('  No backups found');
            }
            console.log('');
            process.exit(1);
        }

        console.log('\n========================================');
        console.log('🔄 DATABASE RESTORE UTILITY');
        console.log('========================================\n');

        // Read backup file
        const backupPath = path.join(__dirname, 'backups', backupFilename);
        if (!fs.existsSync(backupPath)) {
            console.log(`❌ Backup file not found: ${backupFilename}`);
            process.exit(1);
        }

        const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));

        console.log(`📁 Loading backup from: ${backupFilename}`);
        console.log(`📅 Backup created: ${backup.timestamp}`);
        console.log('');

        // Connect to database
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        console.log('⚠️  This will REPLACE existing data with backup data');
        console.log('📊 Backup contains:');
        console.log(`   Products: ${backup.products?.length || 0}`);
        console.log(`   Categories: ${backup.categories?.length || 0}`);
        console.log(`   Orders: ${backup.orders?.length || 0}`);
        console.log(`   Reviews: ${backup.reviews?.length || 0}`);
        console.log(`   Coupons: ${backup.coupons?.length || 0}`);
        console.log('');

        console.log('🔄 Restoring data...');

        // Clear existing data
        await Product.deleteMany();
        await Category.deleteMany();
        await Order.deleteMany();
        await Review.deleteMany();
        await Coupon.deleteMany();

        // Restore data
        if (backup.products?.length) await Product.insertMany(backup.products);
        if (backup.categories?.length) await Category.insertMany(backup.categories);
        if (backup.orders?.length) await Order.insertMany(backup.orders);
        if (backup.reviews?.length) await Review.insertMany(backup.reviews);
        if (backup.coupons?.length) await Coupon.insertMany(backup.coupons);

        // Log to audit trail
        const restoredCounts = {
            products: backup.products?.length || 0,
            categories: backup.categories?.length || 0,
            orders: backup.orders?.length || 0,
            reviews: backup.reviews?.length || 0,
            coupons: backup.coupons?.length || 0
        };
        auditLogger.logRestore(backupFilename, restoredCounts);

        console.log('✅ Database restored successfully!');
        console.log('');

        process.exit(0);
    } catch (err) {
        auditLogger.logError('DATABASE_RESTORE', err);
        console.error(`❌ Error: ${err.message}`);
        process.exit(1);
    }
};

// Execute
restoreDatabase();
