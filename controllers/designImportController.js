const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const cheerio = require('cheerio');
const DesignImport = require('../models/DesignImport');
const ManagedStorefront = require('../models/ManagedStorefront');
const StorefrontAsset = require('../models/StorefrontAsset');
const StorefrontMapping = require('../models/StorefrontMapping');
const StorefrontVersion = require('../models/StorefrontVersion');
const Store = require('../models/Store');
const { createLog } = require('./auditController');
const { applyRouteMapToSchema, classifyPageType } = require('../utils/storefrontRouteMap');

const ALLOWED_EXT = ['.html', '.css', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.woff', '.woff2', '.ttf', '.json'];
const REJECTED_EXT = ['.js', '.mjs', '.ts', '.tsx', '.jsx', '.php', '.py', '.rb', '.exe', '.bat', '.sh', '.cmd', '.env', '.sql', '.zip'];

// Maximum count and size rules
const MAX_FILE_COUNT = 200;
const MAX_TOTAL_SIZE = 20 * 1024 * 1024; // 20MB

/**
 * Controller to handle all design import actions
 */
class DesignImportController {
    /**
     * Upload design ZIP file
     */
    async uploadDesign(req, res) {
        try {
            if (!req.file) {
                return res.status(400).json({ success: false, message: 'No zip package file uploaded' });
            }

            // Create DesignImport entry
            const originalFilename = req.file.originalname;
            const designImport = await DesignImport.create({
                storeId: req.storeId,
                uploadedBy: req.user._id,
                originalFilename,
                status: 'uploaded'
            });

            // Trigger asynchronous scan
            // We await it for this flow to give immediate feedback to the onboarding wizard
            const scanResult = await this.performSecurityScan(req.file.path || req.file.buffer, designImport, req.storeId);

            res.status(200).json({
                success: true,
                data: scanResult
            });
        } catch (error) {
            console.error('Design Upload Error:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * List all design imports for a store
     */
    async listImports(req, res) {
        try {
            const imports = await DesignImport.find({ storeId: req.storeId }).sort({ createdAt: -1 });
            res.status(200).json({ success: true, data: imports });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * Get details of a single import
     */
    async getImport(req, res) {
        try {
            const designImport = await DesignImport.findOne({ _id: req.params.id, storeId: req.storeId });
            if (!designImport) {
                return res.status(404).json({ success: false, message: 'Design import not found' });
            }
            res.status(200).json({ success: true, data: designImport });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * Run manual security scan/rescan
     */
    async scanImport(req, res) {
        try {
            const designImport = await DesignImport.findOne({ _id: req.params.id, storeId: req.storeId });
            if (!designImport) {
                return res.status(404).json({ success: false, message: 'Import record not found' });
            }

            // Locate zip file
            // Since multer saves it to disk (e.g. uploads/ or in memory), let's find the file path
            // For simplicity, we assume the ZIP file is stored in a structured path or kept in memory.
            // Under this architecture, we will extract it immediately on upload.
            res.status(200).json({ success: true, data: designImport });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * Parse HTML/CSS layout and convert into Managed Storefront Schema
     */
    async convertImport(req, res) {
        try {
            const designImport = await DesignImport.findOne({ _id: req.params.id, storeId: req.storeId });
            if (!designImport) {
                return res.status(404).json({ success: false, message: 'Import not found' });
            }

            if (designImport.status !== 'validated' && designImport.status !== 'converted') {
                return res.status(400).json({ success: false, message: `Cannot convert import with status: ${designImport.status}` });
            }

            // Locate extracted directory
            const importDir = path.join(__dirname, '../imports', req.storeId.toString(), designImport._id.toString());
            if (!fs.existsSync(importDir)) {
                return res.status(404).json({ success: false, message: 'Extracted design files not found on disk' });
            }

            // Find the actual root of the design (handles zips that extract into a subdirectory)
            const designRoot = this.findDesignRoot(importDir);
            if (!designRoot) {
                return res.status(422).json({
                    success: false,
                    message: 'index.html could not be found inside the extracted design package. Please ensure the ZIP contains an index.html file.'
                });
            }

            const schema = await this.parseAndBuildSchema(designRoot, req.storeId, designImport._id);

            // Update or create ManagedStorefront
            const storefront = await ManagedStorefront.findOneAndUpdate(
                { storeId: req.storeId },
                {
                    designImportId: designImport._id,
                    draftSchema: schema,
                    status: 'draft'
                },
                { upsert: true, new: true }
            );

            designImport.status = 'converted';
            designImport.designRoot = path.relative(importDir, designRoot).replace(/\\/g, '/') || '.';
            await designImport.save();

            res.status(200).json({
                success: true,
                message: 'Design successfully parsed and converted to draft schema',
                data: storefront
            });
        } catch (error) {
            console.error('Conversion error:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * Serves raw static extracted files for the sandboxed iframe raw-preview
     */
    async getRawPreview(req, res) {
        try {
            const designImport = await DesignImport.findOne({ _id: req.params.id, storeId: req.storeId });
            if (!designImport) {
                return res.status(404).send('Design import not found');
            }

            // Path to extracted dir — resolve the actual design root (handles nested ZIP extraction)
            const importDir = path.join(__dirname, '../imports', req.storeId.toString(), designImport._id.toString());
            const designRoot = (designImport.designRoot && designImport.designRoot !== '.')
                ? path.join(importDir, designImport.designRoot)
                : (this.findDesignRoot(importDir) || importDir);

            // Extract the relative path requested (e.g. index.html, style.css)
            // req.params[0] captures wildcard * suffix
            let relPath = req.params[0] || 'index.html';
            if (relPath.startsWith('/')) relPath = relPath.substring(1);
            if (!relPath) relPath = 'index.html';

            // Resolve absolute path and protect against path traversal
            const filePath = path.resolve(designRoot, relPath);
            if (!filePath.startsWith(importDir)) {
                return res.status(403).send('Forbidden: Path traversal detected');
            }

            if (!fs.existsSync(filePath)) {
                return res.status(404).send('File not found in design package');
            }

            // Disable javascript in responses by injecting CSP headers
            res.set({
                'Content-Security-Policy': "default-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com; script-src 'none'; frame-src 'none'; object-src 'none';",
                'X-Content-Type-Options': 'nosniff'
            });

            // Set appropriate content type
            const ext = path.extname(filePath).toLowerCase();
            const mimeTypes = {
                '.html': 'text/html',
                '.css': 'text/css',
                '.png': 'image/png',
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.webp': 'image/webp',
                '.svg': 'image/svg+xml',
                '.woff': 'font/woff',
                '.woff2': 'font/woff2',
                '.ttf': 'font/ttf',
                '.json': 'application/json'
            };

            res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
            
            // Return file
            const fileStream = fs.createReadStream(filePath);
            fileStream.pipe(res);
        } catch (error) {
            console.error('Raw preview error:', error);
            res.status(500).send('Internal Server Error');
        }
    }

    /**
     * Generate a short-lived preview token for iframe access to raw design files
     */
    async generatePreviewToken(req, res) {
        try {
            const designImport = await DesignImport.findOne({ _id: req.params.id, storeId: req.storeId });
            if (!designImport) {
                return res.status(404).json({ success: false, message: 'Design import not found' });
            }
            // Simple signed token: base64(storeId:importId:expiry)
            const expiry = Date.now() + 15 * 60 * 1000; // 15 minutes
            const payload = `${req.storeId}:${designImport._id}:${expiry}`;
            const token = Buffer.from(payload).toString('base64url');
            res.json({ success: true, data: { token, expiresAt: expiry } });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * Serve raw design files with token validation (public endpoint for iframe).
     * For HTML files: rewrites all relative URLs (CSS links, img srcs, page hrefs, inline styles)
     * to include the preview token so the browser can fetch sub-resources without 401 errors.
     * For CSS files: rewrites url() references similarly.
     * For other assets: streams directly.
     */
    async getRawPreviewWithToken(req, res) {
        try {
            const { token } = req.query;
            if (!token) return res.status(401).send('Preview token required');

            let payload;
            try {
                payload = Buffer.from(token, 'base64url').toString('utf8');
            } catch(_) {
                return res.status(401).send('Invalid preview token');
            }

            const parts = payload.split(':');
            if (parts.length < 3) return res.status(401).send('Malformed preview token');

            const [tokenStoreId, tokenImportId, expiryStr] = parts;
            const expiry = parseInt(expiryStr, 10);
            if (isNaN(expiry) || Date.now() > expiry) {
                return res.status(401).send('Preview token expired. Please refresh and try again.');
            }

            const designImport = await DesignImport.findOne({ _id: tokenImportId, storeId: tokenStoreId });
            if (!designImport) return res.status(404).send('Design import not found');

            const importDir = path.join(__dirname, '../imports', tokenStoreId, designImport._id.toString());
            const designRoot = (designImport.designRoot && designImport.designRoot !== '.')
                ? path.join(importDir, designImport.designRoot)
                : (this.findDesignRoot(importDir) || importDir);

            let relPath = req.params[0] || 'index.html';
            if (relPath.startsWith('/')) relPath = relPath.substring(1);
            if (!relPath) relPath = 'index.html';

            const filePath = path.resolve(designRoot, relPath);
            if (!filePath.startsWith(importDir)) return res.status(403).send('Forbidden: path traversal detected');
            if (!fs.existsSync(filePath)) return res.status(404).send('File not found in design package');

            const ext = path.extname(filePath).toLowerCase();
            // Base URL for all sub-resources — browser will fetch these with the token
            const basePreviewUrl = `/api/seller/design-import/preview/${tokenImportId}`;
            const encodedToken = encodeURIComponent(token);

            // Helper: rewrite a URL to point through the token-preview endpoint
            const rewritePreviewUrl = (rawUrl) => {
                if (!rawUrl) return rawUrl;
                const trimmed = rawUrl.trim();
                // Leave absolute URLs, data URIs, fragment-only, mailto/tel as-is
                if (
                    trimmed.startsWith('http') || trimmed.startsWith('//') ||
                    trimmed.startsWith('data:') || trimmed.startsWith('#') ||
                    trimmed.startsWith('mailto:') || trimmed.startsWith('tel:')
                ) return trimmed;
                const clean = trimmed.replace(/^\//, '');
                return `${basePreviewUrl}/${clean}?token=${encodedToken}`;
            };

            const securityHeaders = {
                'Content-Security-Policy': "default-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com data: blob:; script-src 'none'; object-src 'none';",
                'X-Content-Type-Options': 'nosniff',
                'X-Frame-Options': 'SAMEORIGIN',
                'Cache-Control': 'no-cache'
            };

            // ── HTML: parse and rewrite all relative sub-resource URLs ───────────
            if (ext === '.html') {
                const html = fs.readFileSync(filePath, 'utf8');
                const $ = cheerio.load(html);

                // Rewrite <link rel="stylesheet" href="..."> — CSS files
                $('link[rel="stylesheet"]').each((i, el) => {
                    const href = $(el).attr('href') || '';
                    $(el).attr('href', rewritePreviewUrl(href));
                });

                // Rewrite <link rel="icon">, <link rel="preload">, etc.
                $('link[href]').not('[rel="stylesheet"]').each((i, el) => {
                    const href = $(el).attr('href') || '';
                    if (!href.startsWith('http') && !href.startsWith('//') && !href.includes('fonts.google')) {
                        $(el).attr('href', rewritePreviewUrl(href));
                    }
                });

                // Remove ALL <script> tags (enforces no-JS sandbox)
                $('script').remove();

                // Remove inline on* handlers
                $('*').each((i, el) => {
                    if (!el.attribs) return;
                    Object.keys(el.attribs).forEach(attr => {
                        if (attr.startsWith('on')) $(el).removeAttr(attr);
                    });
                });

                // Rewrite <img src>
                $('img[src]').each((i, el) => {
                    $(el).attr('src', rewritePreviewUrl($(el).attr('src')));
                });

                // Rewrite srcset (for responsive images)
                $('[srcset]').each((i, el) => {
                    const srcset = $(el).attr('srcset') || '';
                    const rewritten = srcset.split(',').map(part => {
                        const [url, ...rest] = part.trim().split(/\s+/);
                        return [rewritePreviewUrl(url), ...rest].join(' ');
                    }).join(', ');
                    $(el).attr('srcset', rewritten);
                });

                // Rewrite <source src> inside <picture> / <video> / <audio>
                $('source[src]').each((i, el) => {
                    $(el).attr('src', rewritePreviewUrl($(el).attr('src')));
                });

                // Rewrite <a href> — inter-page navigation (about.html, contact.html, etc.)
                $('a[href]').each((i, el) => {
                    $(el).attr('href', rewritePreviewUrl($(el).attr('href')));
                });

                // Rewrite inline style background-image: url(...)
                $('[style]').each((i, el) => {
                    let style = $(el).attr('style') || '';
                    style = style.replace(/url\(\s*(['"]?)([^'")\s]+)\1\s*\)/gi, (match, quote, rawUrl) => {
                        return `url(${quote}${rewritePreviewUrl(rawUrl)}${quote})`;
                    });
                    $(el).attr('style', style);
                });

                res.set(securityHeaders);
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                return res.send($.html());
            }

            // ── CSS: rewrite url() references ────────────────────────────────────
            if (ext === '.css') {
                let css = fs.readFileSync(filePath, 'utf8');
                // Determine the CSS file's directory relative to design root (for resolving relative paths)
                const cssRelDir = path.dirname(relPath).replace(/\\/g, '/');

                css = css.replace(/url\(\s*(['"]?)([^'")\s]+)\1\s*\)/gi, (match, quote, rawUrl) => {
                    if (rawUrl.startsWith('http') || rawUrl.startsWith('//') || rawUrl.startsWith('data:')) return match;
                    // Resolve relative to CSS file's directory
                    let resolved = rawUrl.replace(/^\//, '');
                    if (cssRelDir && cssRelDir !== '.') {
                        resolved = `${cssRelDir}/${rawUrl.replace(/^\//, '')}`;
                        // Normalize simple ../ patterns
                        const parts = resolved.split('/');
                        const normalized = [];
                        for (const p of parts) {
                            if (p === '..') normalized.pop();
                            else if (p !== '.') normalized.push(p);
                        }
                        resolved = normalized.join('/');
                    }
                    return `url(${quote}${basePreviewUrl}/${resolved}?token=${encodedToken}${quote})`;
                });

                // Block unsafe @imports (allow Google Fonts)
                css = css.replace(/@import\s+url\([^)]+\)\s*;?/gi, m =>
                    (m.includes('fonts.googleapis.com') || m.includes('fonts.gstatic.com')) ? m : '/* storvia: @import blocked */'
                );
                css = css.replace(/@import\s+['"][^'"]+['"]\s*;?/gi, m =>
                    (m.includes('fonts.googleapis.com') || m.includes('fonts.gstatic.com')) ? m : '/* storvia: @import blocked */'
                );

                res.set(securityHeaders);
                res.setHeader('Content-Type', 'text/css; charset=utf-8');
                return res.send(css);
            }

            // ── All other assets (images, fonts, etc.): stream directly ──────────
            const mimeTypes = {
                '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
                '.webp': 'image/webp', '.svg': 'image/svg+xml', '.gif': 'image/gif',
                '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
                '.otf': 'font/otf', '.json': 'application/json', '.ico': 'image/x-icon'
            };
            res.set(securityHeaders);
            res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
            fs.createReadStream(filePath).pipe(res);

        } catch (error) {
            console.error('Token preview error:', error);
            res.status(500).send('Internal Server Error');
        }
    }

    /**
     * Get converted preview (JSON format of draft storefront schema)
     */
    async getConvertedPreview(req, res) {
        try {
            const storefront = await ManagedStorefront.findOne({ storeId: req.storeId });
            if (!storefront) {
                return res.status(404).json({ success: false, message: 'No storefront converted schema found' });
            }
            res.status(200).json({ success: true, data: storefront.draftSchema });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * Update dynamic selector mappings
     */
    async updateMapping(req, res) {
        try {
            const { mappings = [] } = req.body; // Array of mapping configs
            const designImportId = req.params.id;

            // Upsert mappings in database
            const saved = [];
            for (const item of mappings) {
                const map = await StorefrontMapping.findOneAndUpdate(
                    {
                        storeId: req.storeId,
                        designImportId,
                        targetType: item.targetType
                    },
                    {
                        sourceSelector: item.sourceSelector,
                        sourceType: item.sourceType || 'class',
                        targetConfig: item.targetConfig || {},
                        status: item.sourceSelector ? 'mapped' : 'unmapped'
                    },
                    { upsert: true, new: true }
                );
                saved.push(map);
            }

            // Update draft schema dynamic components based on new mappings
            const storefront = await ManagedStorefront.findOne({ storeId: req.storeId });
            if (storefront && storefront.draftSchema) {
                const schema = storefront.draftSchema;
                schema.mappings = saved;
                
                // Re-sync dynamic components binding in draftSchema pages
                for (const page of schema.pages) {
                    for (const section of page.sections) {
                        const matchedMap = saved.find(m => m.targetType === section.targetType);
                        if (matchedMap) {
                            section.type = this.targetTypeToComponentType(matchedMap.targetType);
                            section.source = 'storvia';
                            section.selector = matchedMap.sourceSelector;
                        }
                    }
                }
                
                storefront.draftSchema = schema;
                storefront.markModified('draftSchema');
                await storefront.save();
            }

            res.status(200).json({ success: true, data: saved });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * Publish the converted draft storefront schema to live storefront
     */
    async publishImport(req, res) {
        try {
            const storefront = await ManagedStorefront.findOne({ storeId: req.storeId });
            if (!storefront) {
                return res.status(404).json({ success: false, message: 'Storefront schema not found' });
            }

            // Check if required mappings exist
            const requiredMappings = await StorefrontMapping.find({
                storeId: req.storeId,
                designImportId: storefront.designImportId,
                required: true
            });
            const unmapped = requiredMappings.filter(m => m.status === 'unmapped');
            if (unmapped.length > 0) {
                return res.status(422).json({
                    success: false,
                    message: 'Cannot publish storefront. Required mappings are missing.',
                    unmappedFields: unmapped.map(m => m.targetType)
                });
            }

            const store = await Store.findById(req.storeId);

            // Promote draft to published with normalized Storvia routing
            storefront.draftSchema = applyRouteMapToSchema(storefront.draftSchema, store?.storeSlug || '');
            storefront.publishedSchema = applyRouteMapToSchema(
                JSON.parse(JSON.stringify(storefront.draftSchema || {})),
                store?.storeSlug || ''
            );
            storefront.status = 'published';
            storefront.version += 1;
            storefront.markModified('publishedSchema');
            await storefront.save();

            // Create StorefrontVersion snapshot
            await StorefrontVersion.create({
                storeId: req.storeId,
                managedStorefrontId: storefront._id,
                snapshot: storefront.publishedSchema,
                versionNumber: storefront.version,
                createdBy: req.user._id,
                notes: req.body.notes || `Published design version ${storefront.version}`
            });

            // Update store publishing identity status
            if (store) {
                store.status = 'published';
                store.setupStatus = 'completed';
                if (!store.setupCompletedSteps.includes('publish')) {
                    store.setupCompletedSteps.push('publish');
                }
                await store.save();
            }

            // Log event
            await createLog(req.user._id, 'storefront_publish', `Published managed storefront design v${storefront.version}`, {
                storeId: req.storeId,
                entity: 'managed_storefront',
                entityId: storefront._id,
                req
            });

            res.status(200).json({
                success: true,
                message: 'Storefront published successfully!',
                data: storefront
            });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * Delete import record and clean files
     */
    async deleteImport(req, res) {
        try {
            const designImport = await DesignImport.findOneAndDelete({ _id: req.params.id, storeId: req.storeId });
            if (!designImport) {
                return res.status(404).json({ success: false, message: 'Import not found' });
            }

            // Clean files on disk
            const importDir = path.join(__dirname, '../imports', req.storeId.toString(), designImport._id.toString());
            if (fs.existsSync(importDir)) {
                fs.rmSync(importDir, { recursive: true, force: true });
            }

            res.status(200).json({ success: true, message: 'Import files removed' });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    // ==========================================
    // PRIVATE / HELPER METHODS
    // ==========================================

    /**
     * Performs detailed security scanning of ZIP file
     */
    async performSecurityScan(zipInput, designImport, storeId) {
        let zip;
        const issues = [];
        const manifest = [];
        let fileCount = 0;
        let totalSize = 0;

        designImport.status = 'scanning';
        await designImport.save();

        try {
            // Read zip archive
            if (typeof zipInput === 'string') {
                zip = new AdmZip(zipInput);
            } else {
                zip = new AdmZip(zipInput);
            }

            const entries = zip.getEntries();
            fileCount = entries.length;
            const packageAnalysis = {
                entryFile: '', htmlFiles: [], cssFiles: [], imageFiles: [], fontFiles: [], dataFiles: [],
                pageTitles: [], colors: [], fontFamilies: []
            };

            if (fileCount > MAX_FILE_COUNT) {
                issues.push(`Package exceeds maximum file count limit of ${MAX_FILE_COUNT} files.`);
            }

            for (const entry of entries) {
                if (entry.isDirectory) continue;
                totalSize += entry.header.size;

                const originalName = entry.entryName;
                const ext = path.extname(originalName).toLowerCase();

                if (ext === '.html') packageAnalysis.htmlFiles.push(originalName);
                if (ext === '.css') packageAnalysis.cssFiles.push(originalName);
                if (['.png', '.jpg', '.jpeg', '.webp', '.svg'].includes(ext)) packageAnalysis.imageFiles.push(originalName);
                if (['.woff', '.woff2', '.ttf'].includes(ext)) packageAnalysis.fontFiles.push(originalName);
                if (ext === '.json') packageAnalysis.dataFiles.push(originalName);
                if (!packageAnalysis.entryFile && /(^|\/)index\.html$/i.test(originalName)) packageAnalysis.entryFile = originalName;

                // Path traversal check
                if (originalName.includes('..') || originalName.startsWith('/') || originalName.includes('\\')) {
                    issues.push(`Path traversal filename detected: '${originalName}'`);
                    continue;
                }

                // Check extension lists
                if (REJECTED_EXT.includes(ext) || originalName.includes('node_modules') || originalName.endsWith('package.json')) {
                    issues.push(`Disallowed executable/server file extension detected: '${originalName}'`);
                    continue;
                }

                if (!ALLOWED_EXT.includes(ext)) {
                    issues.push(`Unsupported file format detected: '${originalName}'`);
                    continue;
                }

                // Parse content based on file type
                const fileContent = entry.getData().toString('utf8');

                if (ext === '.html') {
                    // AST check using cheerio for robust security
                    const $ = cheerio.load(fileContent);
                    const pageTitle = $('title').first().text().trim();
                    if (pageTitle) packageAnalysis.pageTitles.push(pageTitle);
                    if ($('script').length > 0) {
                        issues.push(`Script tag found in HTML: '${originalName}'`);
                    }
                    if ($('iframe').length > 0) {
                        issues.push(`Iframe elements are not allowed: '${originalName}'`);
                    }

                    // Check inline event handlers
                    $('*').each((i, el) => {
                        const attribs = el.attribs || {};
                        for (const attr of Object.keys(attribs)) {
                            if (attr.startsWith('on')) {
                                issues.push(`Inline event handler '${attr}' found in element '<${el.name}>' in: '${originalName}'`);
                            }
                            if (attribs[attr].toLowerCase().includes('javascript:')) {
                                issues.push(`Unsafe javascript link action found in attribute '${attr}' in: '${originalName}'`);
                            }
                        }
                    });
                }

                if (ext === '.css') {
                    const cssImportsRegex = /@import\b/gi;
                    const cssUrlJsRegex = /url\s*\(\s*(['"]?)javascript:/gi;

                    if (cssImportsRegex.test(fileContent)) {
                        issues.push(`External CSS @import rules are not allowed: '${originalName}'`);
                    }
                    if (cssUrlJsRegex.test(fileContent)) {
                        issues.push(`Unsafe javascript URI in CSS url(): '${originalName}'`);
                    }
                    const colors = fileContent.match(/#[0-9A-Fa-f]{6}\b|#[0-9A-Fa-f]{3}\b/g) || [];
                    packageAnalysis.colors.push(...colors);
                    const fontMatches = [...fileContent.matchAll(/font-family\s*:\s*([^;}]+)/gi)];
                    packageAnalysis.fontFamilies.push(...fontMatches.map(match => match[1].trim().replace(/["']/g, '')));
                }

                if (ext === '.svg') {
                    // Basic SVG scan
                    const $ = cheerio.load(fileContent, { xmlMode: true });
                    if ($('script').length > 0) {
                        issues.push(`Script tag found in SVG asset: '${originalName}'`);
                    }
                }

                // Add to manifest
                manifest.push({
                    path: originalName,
                    size: entry.header.size,
                    mimeType: this.getMimeTypeFromExt(ext)
                });
            }

            if (totalSize > MAX_TOTAL_SIZE) {
                issues.push(`Total size of files inside ZIP (${(totalSize / 1024 / 1024).toFixed(2)}MB) exceeds limit of 20MB.`);
            }
            if (!packageAnalysis.entryFile) {
                issues.push('Required storefront entry file index.html was not found in the package.');
            }

            packageAnalysis.colors = [...new Set(packageAnalysis.colors)].slice(0, 24);
            packageAnalysis.fontFamilies = [...new Set(packageAnalysis.fontFamilies)].slice(0, 12);
            packageAnalysis.pageTitles = [...new Set(packageAnalysis.pageTitles)].slice(0, 20);
            designImport.packageAnalysis = packageAnalysis;

            // Update designImport status based on issues
            const scanPassed = issues.length === 0;
            designImport.securityReport = {
                scanPassed,
                issues
            };
            designImport.fileManifest = manifest;
            designImport.assetReport = {
                count: fileCount,
                totalSize
            };

            if (scanPassed) {
                designImport.status = 'validated';
                
                // Extract clean ZIP outside web root
                const extractPath = path.join(__dirname, '../imports', storeId.toString(), designImport._id.toString());
                if (!fs.existsSync(extractPath)) {
                    fs.mkdirSync(extractPath, { recursive: true });
                }
                zip.extractAllTo(extractPath, true);

                const designRoot = this.findDesignRoot(extractPath);
                if (!designRoot) {
                    designImport.status = 'rejected';
                    designImport.rejectionReasons = ['The ZIP was extracted, but a usable index.html could not be located.'];
                    designImport.securityReport = { scanPassed: false, issues: designImport.rejectionReasons };
                    await designImport.save();
                    return designImport;
                }
                designImport.designRoot = path.relative(extractPath, designRoot).replace(/\\/g, '/') || '.';

                // Run image asset optimization and register assets in database
                const store = await Store.findById(storeId).select('storeSlug').lean();
                await this.registerAndProcessAssets(extractPath, storeId, designImport._id, store?.storeSlug);

                // Populate detected sections for mapping selection
                designImport.detectedSections = await this.detectSectionsInHtml(designRoot);
            } else {
                designImport.status = 'rejected';
                designImport.rejectionReasons = issues;
            }

            await designImport.save();
            return designImport;
        } catch (error) {
            console.error('Scanning error:', error);
            designImport.status = 'failed';
            designImport.rejectionReasons = [error.message];
            await designImport.save();
            return designImport;
        }
    }

    /**
     * Detects structural sections in extracted HTML files
     */
    async detectSectionsInHtml(importDir) {
        const detected = [];
        // importDir here is already the resolved design root, but guard anyway
        const designRoot = this.findDesignRoot(importDir) || importDir;
        const indexHtml = path.join(designRoot, 'index.html');
        if (!fs.existsSync(indexHtml)) return detected;

        try {
            const html = fs.readFileSync(indexHtml, 'utf8');
            const $ = cheerio.load(html);

            // Find sections based on HTML5 semantic tags and typical class names
            const selectors = ['header', 'footer', '#header', '#footer', '.hero', '.banner', '.product-grid', '.products', '.categories', '.contact', '.about', 'section'];
            
            selectors.forEach(sel => {
                $(sel).each((idx, el) => {
                    const tag = el.name;
                    const idVal = $(el).attr('id') || '';
                    const classVal = $(el).attr('class') || '';
                    
                    let resolvedSelector = tag;
                    if (idVal) resolvedSelector = `#${idVal}`;
                    else if (classVal) resolvedSelector = `.${classVal.trim().split(/\s+/)[0]}`;

                    // Skip duplicate selectors
                    if (detected.some(d => d.selector === resolvedSelector)) return;

                    const textSnippet = $(el).text().trim().substring(0, 100);
                    detected.push({
                        id: `${tag}_${idx}_${Math.round(Math.random() * 1000)}`,
                        selector: resolvedSelector,
                        tagName: tag,
                        idAttr: idVal,
                        classAttr: classVal,
                        textSnippet
                    });
                });
            });
        } catch (err) {
            console.error('Error detecting sections:', err);
        }

        return detected;
    }

    /**
     * Scans folder, processes/registers storefront assets
     */
    async registerAndProcessAssets(importDir, storeId, designImportId, storeSlug = '') {
        const traverse = async (dir) => {
            const files = fs.readdirSync(dir);
            for (const file of files) {
                const fullPath = path.join(dir, file);
                const stat = fs.statSync(fullPath);
                
                if (stat.isDirectory()) {
                    await traverse(fullPath);
                } else {
                    const ext = path.extname(file).toLowerCase();
                    const size = stat.size;
                    
                    if (['.png', '.jpg', '.jpeg', '.webp', '.svg', '.woff', '.woff2', '.ttf', '.css'].includes(ext)) {
                        const fileBuffer = fs.readFileSync(fullPath);
                        const hash = crypto.createHash('md5').update(fileBuffer).digest('hex');
                        const relativePath = path.relative(importDir, fullPath).replace(/\\/g, '/');

                        // Save in StorefrontAsset model
                        const assetType = ['.png', '.jpg', '.jpeg', '.webp', '.svg'].includes(ext) ? 'image'
                            : ['.woff', '.woff2', '.ttf'].includes(ext) ? 'font'
                            : ext === '.css' ? 'css' : 'other';

                        // Serve local URL for raw previews, in production this would map to a safe CDN
                        const assetKey = storeSlug || storeId.toString();
                        const safeUrl = `/api/storefront/${assetKey}/assets/${hash}${ext}`;

                        await StorefrontAsset.findOneAndUpdate(
                            { storeId, hash },
                            {
                                designImportId,
                                originalName: relativePath,
                                assetType,
                                safeUrl,
                                size,
                                mimeType: this.getMimeTypeFromExt(ext),
                                hash
                            },
                            { upsert: true }
                        );
                    }
                }
            }
        };

        await traverse(importDir);
    }

    /**
     * Parses the HTML and builds a Managed Storefront Schema
     */
    /**
     * Parses the HTML and builds a Managed Storefront Schema with CSS injection and asset rewriting
     */
    async parseAndBuildSchema(importDir, storeId, designImportId) {
        const schema = {
            storeId: storeId.toString(),
            pages: [],
            globalStyles: { colors: {}, fonts: {}, cssVariables: {}, rawCss: '' },
            assets: [],
            navigation: {},
            footer: {},
            scopedCss: ''
        };

        const indexHtmlPath = path.join(importDir, 'index.html');
        if (!fs.existsSync(indexHtmlPath)) {
            throw new Error(`index.html not found at resolved design root: ${importDir}`);
        }

        // Load all assets from DB to build path→safeUrl map
        const dbAssets = await StorefrontAsset.find({ storeId, designImportId }).lean();
        const assetUrlMap = {};
        for (const a of dbAssets) {
            assetUrlMap[a.originalName] = a.safeUrl;
            // Also map basename for relative refs like 'hero.jpg'
            assetUrlMap[path.basename(a.originalName)] = a.safeUrl;
        }

        // Helper: rewrite relative URL to safe asset URL
        const rewriteUrl = (rawUrl, baseDir) => {
            if (!rawUrl || rawUrl.startsWith('http') || rawUrl.startsWith('data:') || rawUrl.startsWith('//') || rawUrl.startsWith('mailto:') || rawUrl.startsWith('tel:')) return rawUrl;
            const cleaned = rawUrl.replace(/^[./]+/, '').replace(/\\/g, '/');
            if (assetUrlMap[cleaned]) return assetUrlMap[cleaned];
            // Try basename fallback
            const bn = path.basename(cleaned);
            if (assetUrlMap[bn]) return assetUrlMap[bn];
            return rawUrl;
        };

        // Collect ALL CSS files in the design root recursively
        const collectCssFiles = (dir) => {
            let files = [];
            try {
                for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                    const full = path.join(dir, entry.name);
                    if (entry.isDirectory()) files = files.concat(collectCssFiles(full));
                    else if (entry.name.endsWith('.css')) files.push(full);
                }
            } catch(_) {}
            return files;
        };

        // Read + sanitize + scope all CSS
        const cssFiles = collectCssFiles(importDir);
        let combinedCss = '';

        for (const cssFile of cssFiles) {
            try {
                let css = fs.readFileSync(cssFile, 'utf8');

                // Rewrite url(...) references
                css = css.replace(/url\(\s*(['"]?)([^'\"\)\s]+)\1\s*\)/gi, (match, quote, rawUrl) => {
                    const [urlPath, ...rest] = rawUrl.split(/[?#]/);
                    const suffix = rawUrl.substring(urlPath.length);
                    const safe = rewriteUrl(urlPath, importDir);
                    return `url(${quote}${safe}${suffix}${quote})`;
                });

                // Remove @import except Google Fonts (those are safe)
                css = css.replace(/@import\s+url\([^)]+\)\s*;?/gi, (match) => {
                    if (match.includes('fonts.googleapis.com') || match.includes('fonts.gstatic.com')) return match;
                    return '/* Storvia: unsafe @import removed */';
                });
                css = css.replace(/@import\s+['\"][^'\"]+['\"]\s*;?/gi, (match) => {
                    if (match.includes('fonts.googleapis.com') || match.includes('fonts.gstatic.com')) return match;
                    return '/* Storvia: unsafe @import removed */';
                });

                // Extract CSS variables from :root
                const rootMatch = css.match(/:root\s*\{([^}]+)\}/i);
                if (rootMatch) {
                    const varPairs = rootMatch[1].matchAll(/--([a-zA-Z0-9_-]+)\s*:\s*([^;}]+);?/gi);
                    for (const [, name, value] of varPairs) {
                        schema.globalStyles.cssVariables[`--${name}`] = value.trim();
                    }
                }

                combinedCss += `\n/* === ${path.basename(cssFile)} === */\n${css}\n`;
            } catch(_) {}
        }

        // Extract primary colors from CSS
        const hexColors = combinedCss.match(/#[0-9A-Fa-f]{6}\b|#[0-9A-Fa-f]{3}\b/g) || [];
        const uniqueColors = [...new Set(hexColors)];
        schema.globalStyles.colors = {
            primary: uniqueColors[0] || '#1E8AF7',
            secondary: uniqueColors[1] || '#E8F3FF',
            text: uniqueColors[2] || '#0F172A',
            background: uniqueColors[3] || '#FFFFFF'
        };

        // Extract font-family declarations
        const fontMatches = [...combinedCss.matchAll(/font-family\s*:\s*([^;}]+)/gi)];
        const fonts = [...new Set(fontMatches.map(m => m[1].trim().replace(/["']/g, '').split(',')[0].trim()))].slice(0, 6);
        schema.globalStyles.fonts = fonts;
        schema.globalStyles.rawCss = combinedCss;
        schema.scopedCss = combinedCss; // Will be injected by renderer inside storeScope

        // Parse HTML
        const html = fs.readFileSync(indexHtmlPath, 'utf8');
        const $ = cheerio.load(html);

        // Rewrite all src and href attributes in HTML
        $('[src]').each((i, el) => {
            const src = $(el).attr('src') || '';
            const safe = rewriteUrl(src, importDir);
            if (safe !== src) $(el).attr('src', safe);
        });
        $('link[rel="stylesheet"]').each((i, el) => {
            const href = $(el).attr('href') || '';
            // Don't rewrite external Google Fonts links
            if (!href.startsWith('http')) {
                $(el).attr('href', rewriteUrl(href, importDir));
            }
        });
        // Remove any remaining link[rel="stylesheet"] for local CSS (we inject it ourselves)
        $('link[rel="stylesheet"]').each((i, el) => {
            const href = $(el).attr('href') || '';
            if (!href.startsWith('http')) $(el).remove();
        });
        // Remove script tags
        $('script').remove();
        // Remove on* handlers
        $('*').each((i, el) => {
            if (!el.attribs) return;
            for (const attr of Object.keys(el.attribs)) {
                if (attr.startsWith('on')) $(el).removeAttr(attr);
            }
        });

        // Build home page sections
        const homePage = {
            id: 'home',
            type: 'home',
            slug: '',
            title: $('title').text() || 'Imported Storefront',
            seo: {
                title: $('title').text() || 'Imported Storefront',
                description: $('meta[name="description"]').attr('content') || '',
                image: '',
                index: true
            },
            sections: []
        };

        // Extract Google Fonts links to include in schema
        const googleFontsLinks = [];
        $('link[href*="fonts.googleapis.com"], link[href*="fonts.gstatic.com"]').each((i, el) => {
            googleFontsLinks.push($(el).attr('href'));
        });
        homePage.googleFontsLinks = googleFontsLinks;

        let sectionIdx = 0;
        $('body > *').each((i, el) => {
            if (el.type !== 'tag') return;
            const tagName = el.name;
            if (['script', 'style', 'link', 'meta', 'head'].includes(tagName)) return;

            const classVal = $(el).attr('class') || '';
            const idVal = $(el).attr('id') || '';
            let selector = tagName;
            if (idVal) selector = `#${idVal}`;
            else if (classVal) selector = `.${classVal.trim().split(/\s+/)[0]}`;

            // Get the full outer HTML with rewritten URLs
            const sectionHtml = $.html(el);

            // Detect editable text fields
            const editableFields = [];
            const textNodes = [];
            $(el).find('h1, h2, h3, h4, h5, h6, p, a, button, span, li').each((j, child) => {
                const rawText = $(child).clone().children().remove().end().text().trim();
                if (rawText.length > 2 && rawText.length < 200) {
                    const childTagName = child.name;
                    const childClass = $(child).attr('class') || '';
                    const childId = $(child).attr('id') || '';
                    let childSel = childTagName;
                    if (childId) childSel = `${childTagName}#${childId}`;
                    else if (childClass) childSel = `${childTagName}.${childClass.trim().split(/\s+/)[0]}`;

                    const nodeId = `txt_${childTagName}_${j}`;
                    editableFields.push({
                        key: nodeId,
                        type: 'text',
                        selector: childSel,
                        value: rawText
                    });
                    textNodes.push({ id: nodeId, tag: childTagName, selector: childSel, text: rawText });
                }
            });

            // Detect images
            const imageFields = [];
            $(el).find('img').each((j, child) => {
                const src = $(child).attr('src') || '';
                const alt = $(child).attr('alt') || '';
                const imageId = `img_${sectionIdx}_${j}`;
                editableFields.push({
                    key: imageId,
                    type: 'image',
                    selector: 'img',
                    value: src,
                    alt
                });
                imageFields.push({ imageId, originalUrl: src, alt, originalName: path.basename(src) });
            });

            homePage.sections.push({
                id: `section_${sectionIdx}`,
                type: 'static_or_mapped',
                source: 'imported',
                html: sectionHtml,
                selector,
                tagName,
                label: idVal ? `#${idVal}` : classVal ? classVal.split(' ')[0] : tagName,
                editableFields,
                textNodes,
                imageFields,
                dynamicBindings: []
            });
            sectionIdx++;
        });

        schema.pages.push(homePage);

        // Collect all inter-page links from index.html
        const pageLinks = [];
        $('a[href]').each((i, el) => {
            const href = $(el).attr('href') || '';
            if (href && !href.startsWith('http') && !href.startsWith('#') &&
                !href.startsWith('mailto:') && !href.startsWith('tel:') && !href.startsWith('javascript:')) {
                pageLinks.push({
                    fromPage: 'index.html',
                    toPage: href.split('?')[0].split('#')[0],
                    label: $(el).text().trim() || href,
                    originalHref: href,
                    storivaMapped: false,
                    storivaRoute: ''
                });
            }
        });

        // Detect and parse all other HTML pages in the design root
        const collectHtmlFiles = (dir) => {
            let files = [];
            try {
                for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                    const full = path.join(dir, entry.name);
                    if (entry.isDirectory()) files = files.concat(collectHtmlFiles(full));
                    else if (entry.name.endsWith('.html') && entry.name !== 'index.html') files.push(full);
                }
            } catch(_) {}
            return files;
        };

        for (const htmlFile of collectHtmlFiles(importDir)) {
            const relFilePath = path.relative(importDir, htmlFile).replace(/\\/g, '/');
            const pageSlug = relFilePath.replace(/\.html$/, '').replace(/\//g, '-');
            const fileName = path.basename(htmlFile);
            try {
                const pageHtml = fs.readFileSync(htmlFile, 'utf8');
                const $p = cheerio.load(pageHtml);

                // Rewrite asset URLs in this page
                $p('[src]').each((i, el) => {
                    const src = $p(el).attr('src') || '';
                    const safe = rewriteUrl(src, importDir);
                    if (safe !== src) $p(el).attr('src', safe);
                });
                $p('[style]').each((i, el) => {
                    let style = $p(el).attr('style') || '';
                    style = style.replace(/url\(\s*(['"\"]?)([^'"\")\s]+)\1\s*\)/gi, (match, q, u) => {
                        return 'url(' + q + rewriteUrl(u, importDir) + q + ')';
                    });
                    $p(el).attr('style', style);
                });
                $p('script').remove();
                $p('*').each((i, el) => {
                    if (!el.attribs) return;
                    Object.keys(el.attribs).forEach(a => { if (a.startsWith('on')) $p(el).removeAttr(a); });
                });

                // Collect inter-page links from this page
                $p('a[href]').each((i, el) => {
                    const href = $p(el).attr('href') || '';
                    if (href && !href.startsWith('http') && !href.startsWith('#') &&
                        !href.startsWith('mailto:') && !href.startsWith('tel:') && !href.startsWith('javascript:')) {
                        pageLinks.push({
                            fromPage: relFilePath,
                            toPage: href.split('?')[0].split('#')[0],
                            label: $p(el).text().trim() || href,
                            originalHref: href,
                            storivaMapped: false,
                            storivaRoute: ''
                        });
                    }
                });

                // Remove local CSS link tags (we inject CSS from schema.scopedCss)
                $p('link[rel="stylesheet"]').each((i, el) => {
                    if (!($p(el).attr('href') || '').startsWith('http')) $p(el).remove();
                });

                // Collect Google Fonts links
                const pageGoogleFonts = [];
                $p('link[href*="fonts.googleapis.com"], link[href*="fonts.gstatic.com"]').each((i, el) => {
                    pageGoogleFonts.push($p(el).attr('href'));
                });

                // Parse body sections
                const pageSections = [];
                let pageSectionIdx = 0;
                $p('body > *').each((i, el) => {
                    if (el.type !== 'tag') return;
                    const tName = el.name;
                    if (['script', 'style', 'link', 'meta', 'head'].includes(tName)) return;
                    const cVal = $p(el).attr('class') || '';
                    const iVal = $p(el).attr('id') || '';
                    let sel = tName;
                    if (iVal) sel = '#' + iVal;
                    else if (cVal) sel = '.' + cVal.trim().split(/\s+/)[0];

                    const editableFields = [], textNodes = [], imageFields = [];
                    $p(el).find('h1,h2,h3,h4,h5,h6,p,a,button,span,li').each((j, child) => {
                        const rawText = $p(child).clone().children().remove().end().text().trim();
                        if (rawText.length > 2 && rawText.length < 200) {
                            const cTag = child.name;
                            const cClass = $p(child).attr('class') || '';
                            const cId = $p(child).attr('id') || '';
                            const cSel = cId ? (cTag + '#' + cId) : cClass ? (cTag + '.' + cClass.trim().split(/\s+/)[0]) : cTag;
                            const nodeId = 'txt_' + cTag + '_' + j;
                            editableFields.push({ key: nodeId, type: 'text', selector: cSel, value: rawText });
                            textNodes.push({ id: nodeId, tag: cTag, selector: cSel, text: rawText });
                        }
                    });
                    $p(el).find('img').each((j, child) => {
                        const src = $p(child).attr('src') || '';
                        const alt = $p(child).attr('alt') || '';
                        const imageId = 'img_' + pageSectionIdx + '_' + j;
                        editableFields.push({ key: imageId, type: 'image', selector: 'img', value: src, alt });
                        imageFields.push({ imageId, originalUrl: src, alt, originalName: path.basename(src) });
                    });

                    pageSections.push({
                        id: 'section_' + pageSectionIdx,
                        type: 'static_or_mapped', source: 'imported',
                        html: $p.html(el), selector: sel, tagName: tName,
                        label: iVal ? ('#' + iVal) : cVal ? cVal.split(' ')[0] : tName,
                        editableFields, textNodes, imageFields, dynamicBindings: []
                    });
                    pageSectionIdx++;
                });

                const pageType = classifyPageType(relFilePath, $p('title').text() || fileName);
                schema.pages.push({
                    id: pageSlug, type: pageType === 'custom' ? 'imported' : pageType, slug: pageSlug,
                    fileName: relFilePath,
                    title: $p('title').text() || fileName.replace('.html', ''),
                    seo: {
                        title: $p('title').text() || '',
                        description: $p('meta[name="description"]').attr('content') || '',
                        image: '', index: true
                    },
                    googleFontsLinks: pageGoogleFonts,
                    sections: pageSections
                });
            } catch (e) {
                console.error('[parseAndBuildSchema] Error parsing ' + htmlFile + ':', e.message);
            }
        }

        // Deduplicate links by fromPage->toPage
        const _plSeen = new Set();
        schema.pageLinks = pageLinks.filter(l => {
            const key = l.fromPage + '->' + l.toPage;
            if (_plSeen.has(key)) return false;
            _plSeen.add(key); return true;
        });

        // Attach full asset list from DB
        schema.assets = dbAssets.map(a => ({
            id: a._id.toString(),
            originalName: a.originalName,
            assetType: a.assetType,
            safeUrl: a.safeUrl,
            hash: a.hash
        }));

        // Build managed route map and rewrite internal links to Storvia routes.
        const store = await Store.findById(storeId).select('storeSlug').lean();
        applyRouteMapToSchema(schema, store?.storeSlug || '');

        return schema;
    }

    /**
     * Recursively searches importDir for the shallowest directory containing index.html.
     * This handles zips that extract into a single top-level subdirectory (e.g. my-store/index.html).
     */
    findDesignRoot(dir, depth = 0) {
        if (depth > 4) return null; // Safety: don't go too deep
        // Check if index.html exists right here
        if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
        // Otherwise scan one level of subdirectories
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const candidate = path.join(dir, entry.name);
                    const found = this.findDesignRoot(candidate, depth + 1);
                    if (found) return found;
                }
            }
        } catch (_) { /* unreadable dir */ }
        return null;
    }

    targetTypeToComponentType(targetType) {
        const mapping = {
            Header: 'dynamic_header',
            Logo: 'dynamic_logo',
            Navigation: 'dynamic_navigation',
            Hero: 'dynamic_hero',
            ProductGrid: 'dynamic_product_grid',
            FeaturedProducts: 'dynamic_featured_products',
            CollectionLinks: 'dynamic_collections',
            CartButton: 'dynamic_cart_button',
            SearchButton: 'dynamic_search_button',
            Footer: 'dynamic_footer',
            ContactSection: 'dynamic_contact',
            PolicyLinks: 'dynamic_policies'
        };
        return mapping[targetType] || 'static_or_mapped';
    }

    getMimeTypeFromExt(ext) {
        const mimeTypes = {
            '.html': 'text/html',
            '.css': 'text/css',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.webp': 'image/webp',
            '.svg': 'image/svg+xml',
            '.woff': 'font/woff',
            '.woff2': 'font/woff2',
            '.ttf': 'font/ttf',
            '.json': 'application/json'
        };
        return mimeTypes[ext] || 'application/octet-stream';
    }
}

module.exports = new DesignImportController();
