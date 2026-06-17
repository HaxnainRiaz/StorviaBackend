# 🛡️ DATABASE MANAGEMENT GUIDE

## ⚠️ CRITICAL: Data Loss Prevention

Your database is now **PROTECTED** from accidental data loss. The seeder will **NEVER** delete existing data.

---

## 📋 Quick Commands

### Safe Operations (No Data Loss)
```bash
# Backup your database (ALWAYS do this first!)
npm run backup

# Add sample data (only if database is empty)
npm run seed

# Create admin user
npm run create-admin
```

### Dangerous Operations (Use with Caution)
```bash
# Reset entire database (DELETES ALL DATA)
npm run reset

# Restore from backup
npm run restore backup-2026-01-06T18-30-00-000Z.json
```

---

## 🔄 Common Workflows

### 1. **First Time Setup**
```bash
npm run seed              # Add sample products & categories
npm run create-admin      # Create admin account
```

### 2. **Before Making Changes**
```bash
npm run backup            # Create safety backup
# Make your changes...
```

### 3. **If Something Goes Wrong**
```bash
npm run restore <filename>  # Restore from backup
```

### 4. **Fresh Start (Nuclear Option)**
```bash
npm run backup            # Backup first!
npm run reset             # Delete everything
npm run seed              # Add fresh sample data
npm run create-admin      # Recreate admin
```

---

## 📁 Backup Files

Backups are stored in: `backend/backups/`

Each backup includes:
- ✅ All products
- ✅ All categories
- ✅ All orders
- ✅ All reviews
- ✅ All coupons
- ✅ All users (passwords excluded)

**Backup filename format:** `backup-YYYY-MM-DDTHH-MM-SS-MMMZ.json`

---

## 🚨 What Changed?

### OLD Behavior (DANGEROUS)
```javascript
// seeder.js would DELETE ALL DATA every time!
await Product.deleteMany();  ❌ DELETED YOUR PRODUCTS
await Category.deleteMany(); ❌ DELETED YOUR CATEGORIES
```

### NEW Behavior (SAFE)
```javascript
// seeder.js now CHECKS before doing anything
if (existingProducts > 0) {
    console.log('⚠️ Data exists - ABORTING');
    // YOUR DATA IS SAFE ✅
}
```

---

## 💡 Best Practices

1. **Backup Regularly**
   - Before deploying
   - Before testing new features
   - After adding important products

2. **Never Run Reset in Production**
   - Only use `npm run reset` in development
   - Always backup first

3. **Keep Backups Safe**
   - Don't commit backups to Git (they're in .gitignore)
   - Store important backups elsewhere

4. **Test Restore Process**
   - Verify backups work by testing restore
   - Do this in development first

---

## 🔍 Troubleshooting

### "Database contains existing data"
This is **GOOD**! It means your data is protected.
- If you want to add sample data, use `npm run reset` first
- If you want to keep your data, do nothing

### "Backup file not found"
Check the `backend/backups/` directory for available backups.

### "Connection timeout"
Check your MongoDB Atlas connection:
1. Verify MONGODB_URI in .env
2. Check Network Access (IP whitelist)
3. Ensure 0.0.0.0/0 is allowed

---

## 📞 Need Help?

If you encounter data loss:
1. **STOP** - Don't run any more commands
2. Check `backend/backups/` for recent backups
3. Use `npm run restore <filename>` to recover

---

---

## 🆔 Order ID Management

### Sequential ID Fix
If you notice order IDs appearing sequentially (e.g., #00001) instead of randomly, run the migration script:
```bash
# Randomizes existing sequential or missing order numbers
node migration_fix_order_ids.js
```

### Random ID Guarantee
The system now strictly enforces:
- **Randomness**: 3-byte hex suffix (#XXXXXX).
- **Immutability**: Once saved, the order number cannot be changed.
- **Uniqueness**: The system retries up to 12 times to avoid collisions.

---

**Remember: Your data is precious. Always backup before risky operations!** 🛡️
