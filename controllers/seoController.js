const SEO = require('../models/SEO');
const Product = require('../models/Product');
const Category = require('../models/Category');
const StorePage = require('../models/StorePage');

exports.getSEO = async (req, res) => {
    try {
        const { entityType, entityId } = req.query;
        let query = {};
        if (req.storeId) query.storeId = req.storeId;
        if (entityType) query.entityType = entityType;
        if (entityId) query.entityId = entityId;

        const seo = await SEO.find(query);
        res.status(200).json({ success: true, data: seo });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.updateSEO = async (req, res) => {
    try {
        const { entityType, entityId, metaTitle, metaDescription } = req.body;

        let seo = await SEO.findOneAndUpdate(
            { entityType, entityId, ...(req.storeId && { storeId: req.storeId }) },
            { ...req.body, metaTitle, metaDescription, ...(req.storeId && { storeId: req.storeId }) },
            { new: true, upsert: true, runValidators: true }
        );

        res.status(200).json({ success: true, data: seo });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

const auditMeta = ({ entityType, entityId, slug, title, metaTitle, metaDescription, imageAltText }) => {
    const issues = [];
    if (!metaTitle) issues.push({ code: 'missing_meta_title', severity: 'high', message: 'Meta title is missing' });
    if (metaTitle && metaTitle.length < 20) issues.push({ code: 'short_meta_title', severity: 'medium', message: 'Meta title is shorter than 20 characters' });
    if (metaTitle && metaTitle.length > 70) issues.push({ code: 'long_meta_title', severity: 'medium', message: 'Meta title is longer than 70 characters' });
    if (!metaDescription) issues.push({ code: 'missing_meta_description', severity: 'high', message: 'Meta description is missing' });
    if (metaDescription && metaDescription.length < 50) issues.push({ code: 'short_meta_description', severity: 'medium', message: 'Meta description is shorter than 50 characters' });
    if (metaDescription && metaDescription.length > 170) issues.push({ code: 'long_meta_description', severity: 'medium', message: 'Meta description is longer than 170 characters' });
    if (!slug) issues.push({ code: 'missing_slug', severity: 'high', message: 'Slug is missing' });
    if (entityType === 'product' && !imageAltText) issues.push({ code: 'missing_image_alt', severity: 'low', message: 'Product image alt text is missing' });

    return {
        entityType,
        entityId,
        slug,
        title,
        score: Math.max(0, 100 - issues.reduce((total, issue) => total + (issue.severity === 'high' ? 25 : issue.severity === 'medium' ? 12 : 6), 0)),
        issues
    };
};

exports.auditSEO = async (req, res) => {
    try {
        if (!req.storeId) {
            return res.status(403).json({ success: false, message: 'Store context is required' });
        }

        const [products, categories, pages, seoRecords] = await Promise.all([
            Product.find({ storeId: req.storeId }).select('title slug metaTitle metaDescription imageAltText').lean(),
            Category.find({ storeId: req.storeId }).select('title slug metaTitle metaDescription').lean(),
            StorePage.find({ storeId: req.storeId }).select('title slug').lean(),
            SEO.find({ storeId: req.storeId }).lean()
        ]);

        const byEntity = new Map(seoRecords.map(record => [`${record.entityType}:${record.entityId}`, record]));
        const results = [
            ...products.map(product => auditMeta({
                entityType: 'product',
                entityId: product._id,
                slug: product.slug,
                title: product.title,
                metaTitle: product.metaTitle,
                metaDescription: product.metaDescription,
                imageAltText: product.imageAltText
            })),
            ...categories.map(category => {
                const seo = byEntity.get(`category:${category._id}`) || {};
                return auditMeta({
                    entityType: 'category',
                    entityId: category._id,
                    slug: category.slug,
                    title: category.title,
                    metaTitle: seo.metaTitle || category.metaTitle,
                    metaDescription: seo.metaDescription || category.metaDescription
                });
            }),
            ...pages.map(page => {
                const seo = byEntity.get(`page:${page._id}`) || {};
                return auditMeta({
                    entityType: 'page',
                    entityId: page._id,
                    slug: page.slug,
                    title: page.title,
                    metaTitle: seo.metaTitle,
                    metaDescription: seo.metaDescription
                });
            })
        ];

        res.json({
            success: true,
            data: results,
            summary: {
                total: results.length,
                withIssues: results.filter(item => item.issues.length).length,
                averageScore: results.length ? Math.round(results.reduce((sum, item) => sum + item.score, 0) / results.length) : 100
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};
