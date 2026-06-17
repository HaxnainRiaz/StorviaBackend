const express = require('express');
const multer = require('multer');
const path = require('path');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const Media = require('../models/Media');

const router = express.Router();

/**
 * 🚀 PERMANENT VERCEL FIX: DATABASE-INTEGRATED MEDIA STORAGE
 * 
 * To solve the 404 issue on Vercel:
 * 1. If Cloudinary is configured (Best), we use it.
 * 2. If NOT, we save the image directly in MongoDB. 
 *    This makes it persistent across all Vercel instances without needing external storage.
 */

// 1. Configure Cloudinary (Optional but recommended for large sites)
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const useCloudinary = process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY;
const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const allowedExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp']);

// 2. Configure Multer (Memory for DB fallback, Cloudinary for Pro)
const storage = useCloudinary
    ? new CloudinaryStorage({
        cloudinary: cloudinary,
        params: {
            folder: 'luminelle_blogs',
            allowed_formats: ['jpg', 'png', 'webp', 'jpeg'],
        },
    })
    : multer.memoryStorage(); // Store in memory temporarily before saving to DB

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase();
        if (!allowedMimeTypes.has(file.mimetype) || !allowedExtensions.has(ext)) {
            return cb(new Error('Only JPG, PNG, and WEBP images are allowed'));
        }
        cb(null, true);
    }
});

// @desc    Upload an image (to Cloudinary or MongoDB)
// @route   POST /api/upload
router.post('/', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        let imageUrl;
        let fileName;

        if (useCloudinary) {
            imageUrl = req.file.path || req.file.secure_url;
            fileName = req.file.filename || req.file.public_id;
        } else {
            // Fallback to MongoDB Storage for Vercel persistence
            fileName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(req.file.originalname || '.png')}`;

            const newMedia = await Media.create({
                storeId: req.storeId,
                filename: fileName,
                data: req.file.buffer,
                contentType: req.file.mimetype,
                size: req.file.size
            });

            // Returning a relative path is safer for database portability
            imageUrl = `/uploads/${fileName}`;
        }

        res.status(200).json({
            success: true,
            url: imageUrl,
            fileName: fileName
        });
    } catch (error) {
        console.error('Upload Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * @desc    Serve images from MongoDB
 * @route   GET /uploads/:filename
 * This handles images saved in the DB fallback
 */
router.get('/serve/:filename', async (req, res) => {
    try {
        const media = await Media.findOne({ filename: req.params.filename });

        if (!media) {
            return res.status(404).send('Not found');
        }

        res.set('Content-Type', media.contentType);
        res.set('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
        res.send(media.data);
    } catch (error) {
        res.status(500).send('Error serving image');
    }
});

module.exports = router;
