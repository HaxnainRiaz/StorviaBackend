const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('./models/User');
const readline = require('readline');

// Determine environment
const envPath = process.argv.includes('--prod') ? '.env.production' : '.env';
dotenv.config({ path: envPath });

console.log(`Using environment: ${envPath}`);

// Setup Readline Interface for user input
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const askQuestion = (query) => {
    return new Promise(resolve => rl.question(query, resolve));
};

const createAdmin = async () => {
    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB.\n');

        console.log('--- Create or Update Admin Account ---');

        // Prompt for Admin Details
        const name = await askQuestion('Enter Admin Name (default: Admin User): ') || 'Admin User';

        let email = '';
        while (!email) {
            email = await askQuestion('Enter Admin Email (required): ');
            if (!email) console.log('Email is required.');
        }

        let password = '';
        while (!password) {
            password = await askQuestion('Enter Strong Password (required): ');
            if (!password) console.log('Password is required.');
            else if (password.length < 6) {
                console.log('Password must be at least 6 characters.');
                password = ''; // reset to force re-entry
            }
        }

        let phone = '';
        while (!phone) {
            phone = await askQuestion('Enter Admin Phone Number for WhatsApp Notifications (e.g., +1234567890): ');
            if (!phone) {
                console.log('Phone number is required for notifications.');
            } else if (!phone.startsWith('+') || phone.length < 10) {
                console.log('Invalid format. Phone number must start with "+" and be at least 10 digits (e.g., +1234567890).');
                phone = ''; // reset
            }
        }

        console.log(`\nProcessing Admin Account for: ${email}...`);

        // Check if user exists
        let admin = await User.findOne({ email: email });

        if (admin) {
            console.log('User already exists. Updating credentials and role...');
            admin.name = name;
            admin.password = password; // Will be hashed by pre-save hook
            admin.role = 'admin';
            admin.phone = phone;
            await admin.save();
            console.log('Admin account updated successfully!');
        } else {
            console.log('Creating new Admin account...');
            const newAdmin = await User.create({
                name: name,
                email: email,
                password: password, // Will be hashed by pre-save hook
                role: 'admin',
                phone: phone
            });
            console.log('New Admin created successfully!');
        }

        console.log(`\nOperation Complete.`);
        console.log(`Email: ${email}`);
        // Do not log the password for security

        rl.close();
        process.exit(0);

    } catch (err) {
        console.error('Error creating admin:', err);
        rl.close();
        process.exit(1);
    }
};

createAdmin();
