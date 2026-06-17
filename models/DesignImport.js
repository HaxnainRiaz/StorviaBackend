const mongoose = require('mongoose');

const fileManifestSchema = new mongoose.Schema({
    path: { type: String, required: true },
    size: { type: Number, required: true },
    mimeType: { type: String }
}, { _id: false });

const detectedSectionSchema = new mongoose.Schema({
    id: { type: String, required: true },
    selector: { type: String, required: true },
    tagName: { type: String },
    idAttr: { type: String },
    classAttr: { type: String },
    textSnippet: { type: String }
}, { _id: false });

const designImportSchema = new mongoose.Schema({
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    originalFilename: { type: String, required: true },
    status: {
        type: String,
        enum: ['uploaded', 'scanning', 'rejected', 'validated', 'converted', 'published', 'failed'],
        default: 'uploaded',
        index: true
    },
    rejectionReasons: { type: [String], default: [] },
    fileManifest: { type: [fileManifestSchema], default: [] },
    securityReport: {
        scanPassed: { type: Boolean, default: false },
        issues: { type: [String], default: [] }
    },
    assetReport: {
        count: { type: Number, default: 0 },
        totalSize: { type: Number, default: 0 }
    },
    packageAnalysis: {
        entryFile: { type: String, default: '' },
        htmlFiles: { type: [String], default: [] },
        cssFiles: { type: [String], default: [] },
        imageFiles: { type: [String], default: [] },
        fontFiles: { type: [String], default: [] },
        dataFiles: { type: [String], default: [] },
        pageTitles: { type: [String], default: [] },
        colors: { type: [String], default: [] },
        fontFamilies: { type: [String], default: [] }
    },
    detectedSections: { type: [detectedSectionSchema], default: [] },
    designRoot: { type: String, default: '.' }  // relative path from importDir to the folder containing index.html
}, { timestamps: true });

module.exports = mongoose.models.DesignImport || mongoose.model('DesignImport', designImportSchema);
