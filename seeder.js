const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Product = require('./models/Product');
const Category = require('./models/Category');
const User = require('./models/User');

dotenv.config();

const categories = [
    { title: "Face", slug: "face", description: "Essential care for your face" },
    { title: "Eyes", slug: "eyes", description: "Dedicated care for the eye area" },
    { title: "Body", slug: "body", description: "Nourishing care for your body" },
    { title: "Serums", slug: "serums", description: "Potent formulations for targeted results" }
];

const productsData = [
    {
        title: "Radiant Glow Face Oil",
        slug: "radiant-glow-face-oil",
        price: 4500,
        description: "Restore your skin's natural radiance with our luxury facial oil.",
        images: ["https://images.unsplash.com/photo-1620916566398-39f1143ab7be?auto=format&fit=crop&q=80&w=800"],
        stock: 45,
        rating: 4.8,
        totalReviews: 124,
        isFeatured: true,
        ingredients: ["Jojoba Oil", "Rosehip Oil", "Vitamin E"],
        usage: "Apply 2-3 drops to clean, dry skin morning and night."
    },
    {
        title: "Peptide Firming Cream",
        slug: "peptide-firming-cream",
        price: 5200,
        salePrice: 4800,
        description: "Smooth and firm your skin with our peptide-rich cream.",
        images: ["https://images.unsplash.com/photo-1629198688000-71f23e745b6e?auto=format&fit=crop&q=80&w=800"],
        stock: 12,
        rating: 4.9,
        totalReviews: 89,
        isFeatured: true,
        ingredients: ["Peptides", "Hyaluronic Acid", "Shea Butter"],
        usage: "Massage into face and neck after serum."
    },
    {
        title: "Luminous Eye Serum",
        slug: "luminous-eye-serum",
        price: 3800,
        description: "Brighten your eyes instantly with our caffeine-infused serum.",
        images: ["https://images.unsplash.com/photo-1608248597279-f99d160bfbc8?auto=format&fit=crop&q=80&w=800"],
        stock: 5,
        rating: 4.7,
        totalReviews: 56,
        isFeatured: false,
        ingredients: ["Caffeine", "Green Tea Extract", "Vitamin C"],
        usage: "Gently pat around the eye area."
    }
];

const importData = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);

        // ⚠️ CRITICAL SAFETY CHECK - PREVENT DATA LOSS
        const existingProducts = await Product.countDocuments();
        const existingCategories = await Category.countDocuments();

        console.log('\n========================================');
        console.log('🔍 DATABASE STATUS CHECK');
        console.log('========================================');
        console.log(`Existing Products: ${existingProducts}`);
        console.log(`Existing Categories: ${existingCategories}`);
        console.log('========================================\n');

        if (existingProducts > 0 || existingCategories > 0) {
            console.log('⚠️  WARNING: Database contains existing data!');
            console.log('❌ SEEDER ABORTED - Data preservation mode active');
            console.log('');
            console.log('To seed a fresh database:');
            console.log('1. Backup your data first');
            console.log('2. Manually delete collections in MongoDB Atlas');
            console.log('3. Run this seeder again');
            console.log('');
            console.log('✅ Your existing data is SAFE and unchanged.');
            process.exit(0);
        }

        // Only seed if database is completely empty
        console.log('✅ Database is empty. Proceeding with initial seed...\n');

        const createdCategories = await Category.insertMany(categories);

        const faceCat = createdCategories.find(c => c.title === "Face");
        const eyeCat = createdCategories.find(c => c.title === "Eyes");
        const serumCat = createdCategories.find(c => c.title === "Serums");

        const products = productsData.map((p, index) => {
            if (index === 0) return { ...p, category: faceCat._id };
            if (index === 1) return { ...p, category: faceCat._id };
            if (index === 2) return { ...p, category: eyeCat._id };
            return p;
        });

        await Product.insertMany(products);

        console.log('✅ Database Seeded Successfully!');
        console.log(`   - ${createdCategories.length} categories created`);
        console.log(`   - ${products.length} products created`);
        process.exit(0);
    } catch (err) {
        console.error(`❌ Error: ${err.message}`);
        process.exit(1);
    }
};

importData();
