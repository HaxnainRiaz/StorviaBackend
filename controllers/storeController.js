const crypto = require('crypto');
const Store = require('../models/Store');
const StoreMember = require('../models/StoreMember');
const StoreSettings = require('../models/StoreSettings');
const StoreTheme = require('../models/StoreTheme');
const StoreSection = require('../models/StoreSection');
const StoreNavigation = require('../models/StoreNavigation');
const StorePage = require('../models/StorePage');
const StoreVersion = require('../models/StoreVersion');
const StoreDomain = require('../models/StoreDomain');
const Product = require('../models/Product');
const Collection = require('../models/Collection');
const Customer = require('../models/Customer');
const InventoryLog = require('../models/InventoryLog');
const Media = require('../models/Media');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { createLog } = require('./auditController');
const { getRolePermissions } = require('../constants/permissions');
const { slugify } = require('../utils/slug');
const { assertSafeStorefrontContent } = require('../utils/sanitize');
const socketUtil = require('../utils/socket');

const SETUP_STEPS = [
    'store_identity',
    'branding',
    'contact_details',
    'delivery_settings',
    'payment_settings',
    'theme_selection',
    'first_product',
    'preview_store',
    'design_source',
    'design_validation',
    'sandbox_preview',
    'design_mapping',
    'commerce_connection',
    'seo_and_tracking',
    'publish'
];

const STEP_ALIASES = {
    store_name: 'store_identity',
    store_url: 'store_identity',
    store_category: 'store_identity',
    logo: 'branding',
    brand_color: 'branding',
    theme: 'theme_selection',
    payment_method: 'payment_settings',
    preview: 'preview_store',
    final_preview: 'preview_store'
};

const normalizeSetupStep = (step) => STEP_ALIASES[step] || step;

const normalizeCompletedSteps = (steps = []) => {
    const normalized = steps.map(normalizeSetupStep);
    return [...new Set(normalized)];
};

const ensureInitialStorefront = async (store) => {
    const existingSections = await StoreSection.countDocuments({ storeId: store._id });
    if (!existingSections) {
        const sectionTypes = [
            'announcement_bar',
            'header',
            'hero_banner',
            'category_grid',
            'featured_products',
            'new_arrivals',
            'brand_story',
            'faq',
            'footer'
        ];
        await StoreSection.insertMany(sectionTypes.map((sectionType, index) => ({
            storeId: store._id,
            sectionType,
            sortOrder: index,
            title: sectionType.replace(/_/g, ' '),
            content: {
                headline: sectionType === 'hero_banner' ? (store.storeSlogan || `Welcome to ${store.storeName}`) : '',
                subheadline: sectionType === 'hero_banner' ? store.description : '',
                buttonText: sectionType === 'hero_banner' ? 'Shop Now' : '',
                buttonLink: sectionType === 'hero_banner' ? '/products' : ''
            }
        })));
    }

    const existingPages = await StorePage.countDocuments({ storeId: store._id });
    if (!existingPages) {
        const pages = [
            ['About Us', 'about-us', 'about_us', store.description || `${store.storeName} is powered by Storvia.`],
            ['Contact Us', 'contact-us', 'contact_us', `Email: ${store.businessEmail || ''}\nPhone: ${store.businessPhone || ''}`],
            ['Shipping Policy', 'shipping-policy', 'shipping_policy', 'Orders are delivered according to the store delivery settings.'],
            ['Return Policy', 'return-policy', 'return_policy', 'Please contact the store for return eligibility and support.'],
            ['Privacy Policy', 'privacy-policy', 'privacy_policy', 'Customer information is used only to process orders and support requests.'],
            ['Terms & Conditions', 'terms-and-conditions', 'terms_and_conditions', 'By placing an order, customers agree to the store policies.']
        ];
        await StorePage.insertMany(pages.map(([title, slug, templateType, content]) => ({
            storeId: store._id,
            title,
            slug,
            templateType,
            content,
            status: 'draft'
        })));
    }

    await StoreNavigation.findOneAndUpdate(
        { storeId: store._id, menuName: 'header' },
        {
            items: [
                { label: 'Home', url: '/' },
                { label: 'Products', url: '/products' },
                { label: 'Contact', url: '/contact' }
            ],
            status: 'draft'
        },
        { upsert: true, new: true }
    );

    await StoreNavigation.findOneAndUpdate(
        { storeId: store._id, menuName: 'footer' },
        {
            items: [
                { label: 'About Us', url: '/pages/about-us' },
                { label: 'Shipping Policy', url: '/pages/shipping-policy' },
                { label: 'Return Policy', url: '/pages/return-policy' },
                { label: 'Privacy Policy', url: '/pages/privacy-policy' }
            ],
            status: 'draft'
        },
        { upsert: true, new: true }
    );
};

const getStoreSnapshot = async (storeId) => {
    const [store, settings, theme, sections, navigation, pages] = await Promise.all([
        Store.findById(storeId).lean(),
        StoreSettings.findOne({ storeId }).lean(),
        StoreTheme.findOne({ storeId }).lean(),
        StoreSection.find({ storeId }).sort({ sortOrder: 1 }).lean(),
        StoreNavigation.find({ storeId }).lean(),
        StorePage.find({ storeId }).lean()
    ]);

    return { store, settings, theme, sections, navigation, pages };
};

const emitStore = (storeId, event, payload) => {
    try {
        socketUtil.getIO().to(`store:${storeId}`).emit(event, payload);
    } catch (error) { }
};

const stripDocumentMeta = (doc) => {
    if (!doc) return doc;
    const plain = { ...doc };
    delete plain._id;
    delete plain.id;
    delete plain.__v;
    delete plain.createdAt;
    delete plain.updatedAt;
    return plain;
};

const restoreSnapshot = async (storeId, snapshot) => {
    if (!snapshot) return;

    if (snapshot.store) {
        const allowedStoreFields = [
            'storeName', 'description', 'businessType', 'storeCategory', 'logo', 'favicon',
            'businessEmail', 'businessPhone', 'whatsappNumber', 'businessAddress', 'socialLinks',
            'currency', 'timezone', 'language'
        ];
        const payload = {};
        allowedStoreFields.forEach(field => {
            if (snapshot.store[field] !== undefined) payload[field] = snapshot.store[field];
        });
        await Store.findByIdAndUpdate(storeId, payload, { runValidators: true });
    }

    if (snapshot.settings) {
        await StoreSettings.findOneAndUpdate(
            { storeId },
            { ...stripDocumentMeta(snapshot.settings), storeId },
            { upsert: true, runValidators: true }
        );
    }

    if (snapshot.theme) {
        await StoreTheme.findOneAndUpdate(
            { storeId },
            { ...stripDocumentMeta(snapshot.theme), storeId },
            { upsert: true, runValidators: true }
        );
    }

    await Promise.all([
        StoreSection.deleteMany({ storeId }),
        StoreNavigation.deleteMany({ storeId }),
        StorePage.deleteMany({ storeId })
    ]);

    if (Array.isArray(snapshot.sections) && snapshot.sections.length) {
        await StoreSection.insertMany(snapshot.sections.map(section => ({ ...stripDocumentMeta(section), storeId })));
    }
    if (Array.isArray(snapshot.navigation) && snapshot.navigation.length) {
        await StoreNavigation.insertMany(snapshot.navigation.map(menu => ({ ...stripDocumentMeta(menu), storeId })));
    }
    if (Array.isArray(snapshot.pages) && snapshot.pages.length) {
        await StorePage.insertMany(snapshot.pages.map(page => ({ ...stripDocumentMeta(page), storeId })));
    }
};

exports.getSetupStatus = async (req, res) => {
    const firstProductExists = await Product.exists({ storeId: req.storeId });
    if (firstProductExists && !req.store.setupCompletedSteps.includes('first_product')) {
        req.store.setupCompletedSteps.push('first_product');
        await req.store.save();
    }

    const normalized = normalizeCompletedSteps(req.store.setupCompletedSteps);
    if (normalized.length !== req.store.setupCompletedSteps.length || normalized.some(step => !req.store.setupCompletedSteps.includes(step))) {
        req.store.setupCompletedSteps = normalized;
        req.store.setupStatus = req.store.canPublish() ? 'completed' : 'in_progress';
        await req.store.save();
    }

    res.json({
        success: true,
        data: {
            store: req.store,
            setupSteps: SETUP_STEPS,
            completedSteps: req.store.setupCompletedSteps,
            canPublish: req.store.canPublish()
        }
    });
};

exports.updateSetupStep = async (req, res) => {
    const rawStep = req.body.stepKey || req.body.step;
    const step = normalizeSetupStep(rawStep);
    const { data = {} } = req.body;
    if (!SETUP_STEPS.includes(step)) {
        return res.status(400).json({
            success: false,
            message: `Invalid setup step: ${rawStep || 'missing'}`,
            validSteps: SETUP_STEPS
        });
    }

    if (data.storeSlug !== undefined) {
        const nextSlug = slugify(data.storeSlug);
        if (!nextSlug) {
            return res.status(400).json({ success: false, message: 'Store slug must contain letters or numbers' });
        }
        if (nextSlug !== req.store.storeSlug) {
            const [existingStore, existingDomain] = await Promise.all([
                Store.findOne({ _id: { $ne: req.storeId }, $or: [{ storeSlug: nextSlug }, { subdomain: nextSlug }] }),
                StoreDomain.findOne({ storeId: { $ne: req.storeId }, $or: [{ storeSlug: nextSlug }, { subdomain: nextSlug }] })
            ]);
            if (existingStore || existingDomain) {
                return res.status(409).json({ success: false, message: 'Store slug is already taken' });
            }
            req.store.storeSlug = nextSlug;
            req.store.subdomain = nextSlug;
            await StoreDomain.findOneAndUpdate(
                { storeId: req.storeId },
                { storeSlug: nextSlug, subdomain: nextSlug },
                { upsert: true, new: true }
            );
        }
    }

    const allowedStoreFields = ['storeName', 'description', 'businessType', 'storeCategory', 'logo', 'favicon', 'businessEmail', 'businessPhone', 'whatsappNumber', 'businessAddress', 'socialLinks'];
    allowedStoreFields.forEach(field => {
        if (data[field] !== undefined) req.store[field] = data[field];
    });

    req.store.setupCompletedSteps = normalizeCompletedSteps(req.store.setupCompletedSteps);
    if (!req.store.setupCompletedSteps.includes(step)) {
        req.store.setupCompletedSteps.push(step);
    }
    req.store.setupStatus = req.store.canPublish() ? 'completed' : 'in_progress';
    await req.store.save();

    await createLog(req.user.id, 'store_setup_update', `Completed setup step: ${step}`, {
        storeId: req.storeId,
        entity: 'store',
        entityId: req.storeId,
        req
    });

    res.json({ success: true, data: req.store });
};

exports.publishStore = async (req, res) => {
    req.store.setupCompletedSteps = normalizeCompletedSteps(req.store.setupCompletedSteps);
    if (!req.store.canPublish()) {
        const completed = new Set(req.store.setupCompletedSteps || []);
        const missing = [
            ['store_identity', 'Store Identity'],
            ['delivery_settings', 'Delivery Settings'],
            ['payment_settings', 'Payment Settings'],
            ['first_product', 'First Product']
        ].filter(([step]) => !completed.has(step)).map(([step]) => step);
        return res.status(422).json({
            success: false,
            message: 'Store cannot be published until required setup steps are complete',
            missingSteps: missing
        });
    }

    await ensureInitialStorefront(req.store);
    req.store.status = 'published';
    req.store.setupStatus = 'completed';
    if (!req.store.setupCompletedSteps.includes('publish')) req.store.setupCompletedSteps.push('publish');
    await req.store.save();

    await StoreNavigation.updateMany({ storeId: req.storeId }, { $set: { status: 'published' } });
    await StorePage.updateMany({ storeId: req.storeId, status: { $ne: 'draft' } }, { $set: { status: 'published' } });

    const snapshotJson = await getStoreSnapshot(req.storeId);
    await StoreVersion.create({
        storeId: req.storeId,
        versionType: 'published',
        snapshotJson,
        createdBy: req.user._id
    });

    emitStore(req.storeId, 'storefront:published', { storeId: req.storeId });
    await createLog(req.user.id, 'storefront_publish', 'Published storefront', {
        storeId: req.storeId,
        entity: 'store',
        entityId: req.storeId,
        req
    });

    res.json({ success: true, data: req.store });
};

exports.pauseStore = async (req, res) => {
    req.store.status = 'paused';
    await req.store.save();
    res.json({ success: true, data: req.store });
};

exports.resumeStore = async (req, res) => {
    req.store.status = 'published';
    await req.store.save();
    res.json({ success: true, data: req.store });
};

exports.getStorefrontOverview = async (req, res) => {
    res.json({ success: true, data: await getStoreSnapshot(req.storeId) });
};

exports.getTheme = async (req, res) => {
    const theme = await StoreTheme.findOneAndUpdate({ storeId: req.storeId }, { $setOnInsert: { storeId: req.storeId } }, { upsert: true, new: true });
    res.json({ success: true, data: theme });
};

exports.updateTheme = async (req, res) => {
    const allowed = [
        'themePreset', 'primaryColor', 'secondaryColor', 'accentColor', 'buttonColor', 'buttonTextColor',
        'textColor', 'mutedTextColor', 'backgroundColor', 'surfaceColor', 'borderColor', 'saleColor',
        'successColor', 'warningColor', 'errorColor', 'fontStyle', 'headingFontStyle', 'baseFontSize',
        'headingScale', 'bodyLineHeight', 'headingLineHeight', 'letterSpacing', 'borderRadius',
        'cardStyle', 'buttonStyle', 'layoutDensity', 'maxContentWidth', 'pageWidthMode',
        'sectionSpacing', 'containerPadding', 'gridGap', 'globalRadius', 'buttonRadius',
        'cardRadius', 'imageRadius', 'inputRadius', 'badgeRadius', 'cardShadow', 'buttonShadow',
        'headerShadow', 'hoverEffect', 'animationLevel', 'customBrandingStatus'
    ];
    const payload = {};
    allowed.forEach(field => {
        if (req.body[field] !== undefined) payload[field] = req.body[field];
    });

    const theme = await StoreTheme.findOneAndUpdate({ storeId: req.storeId }, payload, { upsert: true, new: true, runValidators: true });
    await createLog(req.user.id, 'storefront_update', 'Updated storefront theme', { storeId: req.storeId, entity: 'theme', entityId: theme._id, req });
    res.json({ success: true, data: theme });
};

exports.getSections = async (req, res) => {
    const sections = await StoreSection.find({ storeId: req.storeId }).sort({ sortOrder: 1 });
    res.json({ success: true, data: sections });
};

exports.createSection = async (req, res) => {
    assertSafeStorefrontContent(req.body);
    const section = await StoreSection.create({ ...req.body, storeId: req.storeId });
    emitStore(req.storeId, 'storefront:section:updated', section);
    res.status(201).json({ success: true, data: section });
};

exports.updateSection = async (req, res) => {
    assertSafeStorefrontContent(req.body);
    const section = await StoreSection.findOneAndUpdate({ _id: req.params.id, storeId: req.storeId }, req.body, { new: true, runValidators: true });
    if (!section) return res.status(404).json({ success: false, message: 'Section not found' });
    emitStore(req.storeId, 'storefront:section:updated', section);
    res.json({ success: true, data: section });
};

exports.deleteSection = async (req, res) => {
    await StoreSection.findOneAndDelete({ _id: req.params.id, storeId: req.storeId });
    res.json({ success: true, data: {} });
};

exports.reorderSections = async (req, res) => {
    const { order = [] } = req.body;
    await Promise.all(order.map((id, index) => StoreSection.findOneAndUpdate({ _id: id, storeId: req.storeId }, { sortOrder: index })));
    res.json({ success: true });
};

exports.getNavigation = async (req, res) => {
    const navigation = await StoreNavigation.find({ storeId: req.storeId }).sort({ menuName: 1 });
    res.json({ success: true, data: navigation });
};

exports.updateNavigation = async (req, res) => {
    assertSafeStorefrontContent(req.body);
    const menus = Array.isArray(req.body.menus) ? req.body.menus : [req.body];
    const saved = [];

    for (const menu of menus) {
        const menuName = menu.menuName || 'header';
        const validateItems = (items = [], depth = 1) => {
            if (depth > 2) throw new Error('Navigation nesting depth cannot exceed 2');
            for (const item of items) {
                const url = String(item.url || item.href || '');
                if (/^\s*javascript:/i.test(url) || /<script/i.test(url)) {
                    throw new Error('Navigation links cannot contain scripts');
                }
                if (url && !url.startsWith('/') && !/^https?:\/\//i.test(url) && !url.startsWith('#')) {
                    throw new Error('Navigation links must be relative paths, anchors, or http(s) URLs');
                }
                validateItems(item.children || [], depth + 1);
            }
        };
        try {
            validateItems(menu.items || []);
        } catch (error) {
            return res.status(400).json({ success: false, message: error.message });
        }

        const nav = await StoreNavigation.findOneAndUpdate(
            { storeId: req.storeId, menuName },
            { items: menu.items || [], status: menu.status || 'draft' },
            { upsert: true, new: true }
        );
        saved.push(nav);
    }

    res.json({ success: true, data: saved });
};

exports.getPages = async (req, res) => {
    const pages = await StorePage.find({ storeId: req.storeId }).sort({ createdAt: -1 });
    res.json({ success: true, data: pages });
};

exports.createPage = async (req, res) => {
    assertSafeStorefrontContent(req.body.content || '');
    const page = await StorePage.create({
        ...req.body,
        storeId: req.storeId,
        slug: slugify(req.body.slug || req.body.title)
    });
    res.status(201).json({ success: true, data: page });
};

exports.updatePage = async (req, res) => {
    assertSafeStorefrontContent(req.body.content || '');
    if (req.body.slug) req.body.slug = slugify(req.body.slug);
    const page = await StorePage.findOneAndUpdate({ _id: req.params.id, storeId: req.storeId }, req.body, { new: true, runValidators: true });
    if (!page) return res.status(404).json({ success: false, message: 'Page not found' });
    res.json({ success: true, data: page });
};

exports.deletePage = async (req, res) => {
    await StorePage.findOneAndDelete({ _id: req.params.id, storeId: req.storeId });
    res.json({ success: true, data: {} });
};

exports.previewStorefront = async (req, res) => {
    res.json({ success: true, data: await getStoreSnapshot(req.storeId) });
};

exports.publishStorefront = exports.publishStore;

exports.revertStorefront = async (req, res) => {
    const version = await StoreVersion.findOne({ _id: req.params.versionId, storeId: req.storeId });
    if (!version) return res.status(404).json({ success: false, message: 'Version not found' });

    const backupSnapshot = await getStoreSnapshot(req.storeId);
    await restoreSnapshot(req.storeId, version.snapshotJson);
    await StoreVersion.create({
        storeId: req.storeId,
        versionType: 'backup',
        snapshotJson: backupSnapshot,
        createdBy: req.user._id
    });
    emitStore(req.storeId, 'storefront:reverted', { storeId: req.storeId, versionId: version._id });
    await createLog(req.user.id, 'storefront_revert', 'Reverted storefront version', {
        storeId: req.storeId,
        entity: 'store_version',
        entityId: version._id,
        req
    });

    res.json({ success: true, data: await getStoreSnapshot(req.storeId) });
};

exports.getCollections = async (req, res) => {
    const collections = await Collection.find({ storeId: req.storeId }).sort({ createdAt: -1 });
    res.json({ success: true, data: collections });
};

exports.createCollection = async (req, res) => {
    const collection = await Collection.create({ ...req.body, storeId: req.storeId, slug: slugify(req.body.slug || req.body.title) });
    res.status(201).json({ success: true, data: collection });
};

exports.updateCollection = async (req, res) => {
    if (req.body.slug) req.body.slug = slugify(req.body.slug);
    const collection = await Collection.findOneAndUpdate({ _id: req.params.id, storeId: req.storeId }, req.body, { new: true, runValidators: true });
    if (!collection) return res.status(404).json({ success: false, message: 'Collection not found' });
    res.json({ success: true, data: collection });
};

exports.deleteCollection = async (req, res) => {
    await Collection.findOneAndDelete({ _id: req.params.id, storeId: req.storeId });
    res.json({ success: true, data: {} });
};

exports.getInventory = async (req, res) => {
    const products = await Product.find({ storeId: req.storeId }).select('title slug stock status images price salePrice').sort({ stock: 1 }).lean();
    res.json({ success: true, data: products });
};

exports.updateInventory = async (req, res) => {
    const product = await Product.findOne({ _id: req.params.productId, storeId: req.storeId });
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    const previousStock = product.stock;
    product.stock = Number(req.body.stock);
    await product.save();

    await InventoryLog.create({
        storeId: req.storeId,
        productId: product._id,
        previousStock,
        newStock: product.stock,
        delta: product.stock - previousStock,
        reason: req.body.reason || 'manual_adjustment',
        changedBy: req.user._id
    });

    emitStore(req.storeId, 'product:updated', product);
    res.json({ success: true, data: product });
};

exports.getLowStock = async (req, res) => {
    const threshold = Number(req.query.threshold || 10);
    const products = await Product.find({ storeId: req.storeId, stock: { $lt: threshold } }).sort({ stock: 1 });
    res.json({ success: true, data: products });
};

exports.getInventoryHistory = async (req, res) => {
    const logs = await InventoryLog.find({ storeId: req.storeId, productId: req.params.productId }).sort({ createdAt: -1 }).limit(100);
    res.json({ success: true, data: logs });
};

exports.getCustomers = async (req, res) => {
    const customers = await Customer.find({ storeId: req.storeId }).sort({ createdAt: -1 });
    res.json({ success: true, data: customers });
};

exports.getCustomer = async (req, res) => {
    const customer = await Customer.findOne({ _id: req.params.id, storeId: req.storeId });
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });
    res.json({ success: true, data: customer });
};

exports.updateCustomer = async (req, res) => {
    const customer = await Customer.findOneAndUpdate({ _id: req.params.id, storeId: req.storeId }, req.body, { new: true, runValidators: true });
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });
    res.json({ success: true, data: customer });
};

exports.deleteCustomer = async (req, res) => {
    await Customer.findOneAndDelete({ _id: req.params.id, storeId: req.storeId });
    res.json({ success: true, data: {} });
};

exports.listStaff = async (req, res) => {
    const staff = await StoreMember.find({ storeId: req.storeId }).populate('userId', 'name email phone status').sort({ createdAt: -1 });
    res.json({ success: true, data: staff });
};

exports.inviteStaff = async (req, res) => {
    const { email, role = 'viewer', permissions } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email is required' });

    let user = await User.findOne({ email: String(email).toLowerCase() });
    if (!user) {
        user = await User.create({
            name: req.body.name || email.split('@')[0],
            email,
            password: crypto.randomBytes(12).toString('hex'),
            role: 'user'
        });
    }

    const member = await StoreMember.findOneAndUpdate(
        { storeId: req.storeId, userId: user._id },
        {
            role,
            permissions: permissions || getRolePermissions(role),
            status: 'invited',
            invitedBy: req.user._id,
            inviteToken: crypto.randomBytes(24).toString('hex')
        },
        { upsert: true, new: true }
    ).populate('userId', 'name email');

    await createLog(req.user.id, 'staff_invite', `Invited staff: ${email}`, { storeId: req.storeId, entity: 'store_member', entityId: member._id, req });
    res.status(201).json({ success: true, data: member });
};

exports.acceptInvite = async (req, res) => {
    const member = await StoreMember.findOne({ inviteToken: req.body.inviteToken }).select('+inviteToken');
    if (!member) return res.status(404).json({ success: false, message: 'Invite not found' });
    member.status = 'active';
    member.joinedAt = new Date();
    member.inviteToken = undefined;
    await member.save();
    res.json({ success: true, data: member });
};

exports.updateStaff = async (req, res) => {
    const member = await StoreMember.findOneAndUpdate({ _id: req.params.id, storeId: req.storeId }, req.body, { new: true, runValidators: true });
    if (!member) return res.status(404).json({ success: false, message: 'Staff member not found' });
    res.json({ success: true, data: member });
};

exports.updateStaffPermissions = async (req, res) => {
    const member = await StoreMember.findOneAndUpdate(
        { _id: req.params.id, storeId: req.storeId },
        { permissions: req.body.permissions || [] },
        { new: true, runValidators: true }
    );
    if (!member) return res.status(404).json({ success: false, message: 'Staff member not found' });
    await createLog(req.user.id, 'staff_permission_update', 'Updated staff permissions', { storeId: req.storeId, entity: 'store_member', entityId: member._id, req });
    res.json({ success: true, data: member });
};

exports.deleteStaff = async (req, res) => {
    await StoreMember.findOneAndDelete({ _id: req.params.id, storeId: req.storeId, role: { $ne: 'owner' } });
    res.json({ success: true, data: {} });
};

exports.getMedia = async (req, res) => {
    const media = await Media.find({ storeId: req.storeId }).select('-data').sort({ uploadDate: -1 });
    res.json({ success: true, data: media });
};

exports.deleteMedia = async (req, res) => {
    const media = await Media.findOne({ _id: req.params.id, storeId: req.storeId });
    if (!media) return res.status(404).json({ success: false, message: 'Media not found' });
    if (media.usedBy?.length && !req.query.force) {
        return res.status(409).json({ success: false, message: 'Media is currently in use' });
    }
    await media.deleteOne();
    res.json({ success: true, data: {} });
};

exports.getNotifications = async (req, res) => {
    const notifications = await Notification.find({ storeId: req.storeId }).sort({ createdAt: -1 }).limit(100);
    res.json({ success: true, data: notifications });
};

exports.getShippingSettings = async (req, res) => {
    const settings = await StoreSettings.findOneAndUpdate({ storeId: req.storeId }, { $setOnInsert: { storeId: req.storeId } }, { upsert: true, new: true });
    res.json({ success: true, data: settings.shippingSettings });
};

exports.updateShippingSettings = async (req, res) => {
    const settings = await StoreSettings.findOneAndUpdate(
        { storeId: req.storeId },
        { shippingSettings: req.body },
        { upsert: true, new: true, runValidators: true }
    );
    await createLog(req.user.id, 'shipping_update', 'Updated shipping settings', { storeId: req.storeId, entity: 'store_settings', entityId: settings._id, req });
    res.json({ success: true, data: settings.shippingSettings });
};

exports.getPaymentSettings = async (req, res) => {
    const settings = await StoreSettings.findOneAndUpdate({ storeId: req.storeId }, { $setOnInsert: { storeId: req.storeId } }, { upsert: true, new: true });
    res.json({ success: true, data: settings.paymentSettings });
};

exports.updatePaymentSettings = async (req, res) => {
    const settings = await StoreSettings.findOneAndUpdate(
        { storeId: req.storeId },
        { paymentSettings: req.body },
        { upsert: true, new: true }
    );
    await createLog(req.user.id, 'payment_settings_update', 'Updated payment settings', { storeId: req.storeId, entity: 'store_settings', entityId: settings._id, req });
    res.json({ success: true, data: settings.paymentSettings });
};
