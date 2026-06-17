const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Category = require('./models/Category');

dotenv.config();

const categories = [
    { title: "Face", slug: "face", description: "Advanced care for your complexion" },
    { title: "Eyes", slug: "eyes", description: "Targeted treatments for the delicate eye area" },
    { title: "Body", slug: "body", description: "Luxurious moisture for your entire silhouette" },
    { title: "Serums", slug: "serums", description: "High-potency elixirs for specific concerns" }
];

const seedCategories = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to DB...');

        // Safety check - don't delete if categories exist
        const existingCount = await Category.countDocuments();
        if (existingCount > 0) {
            console.log(`⚠️  ${existingCount} categories already exist. Skipping seed.`);
            console.log('✅ Your existing categories are safe.');
            process.exit(0);
        }

        const created = await Category.insertMany(categories);
        console.log(`✅ ${created.length} Categories seeded successfully!`);
        process.exit(0);
    } catch (err) {
        console.error('❌ Error:', err.message);
        process.exit(1);
    }
};

seedCategories();
