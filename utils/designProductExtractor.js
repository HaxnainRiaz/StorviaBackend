const cheerio = require('cheerio');
const { shouldBindSectionAsProductGrid, inferProductSourceFromSection } = require('./commerceBindings');
const Product = require('../models/Product');
const { slugify } = require('./slug');

const CARD_SELECTORS = [
    '[class*="product-card"]',
    '[class*="product-item"]',
    '[class*="product_card"]',
    '[class*="product-grid"] > *',
    '[class*="products-grid"] > *',
    '[class*="shop-grid"] > *',
    '[data-product]',
    'article[class*="product"]',
    '.product',
];

const PRICE_PATTERN = /(?:rs\.?\s*|pkr\s*|₹\s*|\$\s*|price\s*:?\s*)([\d,]+(?:\.\d{1,2})?)/i;
const PLAIN_PRICE_PATTERN = /\b([\d]{2,}(?:,\d{3})*(?:\.\d{1,2})?)\b/;

function parsePrice(text = '') {
    const normalized = String(text).replace(/\s+/g, ' ');
    const match = normalized.match(PRICE_PATTERN) || normalized.match(PLAIN_PRICE_PATTERN);
    if (!match) return 0;
    return Number(String(match[1]).replace(/,/g, '')) || 0;
}

function uniqueSlug(base, used) {
    let slug = slugify(base) || 'product';
    let candidate = slug;
    let i = 2;
    while (used.has(candidate)) {
        candidate = `${slug}-${i}`;
        i += 1;
    }
    used.add(candidate);
    return candidate;
}

function findProductCardElements($, root) {
    for (const selector of CARD_SELECTORS) {
        const found = $(root).find(selector).toArray();
        if (found.length >= 1) return found;
    }

    const candidates = [];
    $(root).find('article, li, div').each((_, el) => {
        const $el = $(el);
        if (!$el.find('img').length) return;

        const text = $el.text();
        const hasPrice = PRICE_PATTERN.test(text) || PLAIN_PRICE_PATTERN.test(text);
        const hasTitle =
            $el.find('h1,h2,h3,h4,h5,h6,[class*="title"],[class*="name"]').length > 0 ||
            Boolean($el.find('img').attr('alt'));

        if (hasPrice && hasTitle && text.length < 500) {
            candidates.push(el);
        }
    });

    if (!candidates.length) return [];

    const leaf = candidates.filter((el) => {
        const $el = $(el);
        return !$el.find('article, li, div').toArray().some((child) => child !== el && candidates.includes(child));
    });

    return leaf.length ? leaf : candidates.slice(0, 12);
}

function extractCardData($, cardEl, rewriteUrl = (url) => url) {
    const $card = $(cardEl);

    const titleEl =
        $card.find('h1,h2,h3,h4,h5,h6,[class*="product-title"],[class*="product_name"],[class*="title"],[class*="name"]').first();
    const title =
        titleEl.text().trim() ||
        $card.find('img').attr('alt')?.trim() ||
        $card.attr('data-product-name') ||
        '';

    const priceEl = $card.find('[class*="price"],[class*="amount"],[data-price]').first();
    const priceText = priceEl.length ? priceEl.text() : $card.text();
    const price = parsePrice(priceText);

    const compareEl = $card.find('[class*="compare"],[class*="old-price"],[class*="was"],del,s').first();
    const comparePrice = compareEl.length ? parsePrice(compareEl.text()) : null;

    const imgEl = $card.find('img').first();
    const imageSrc = imgEl.attr('src') ? rewriteUrl(imgEl.attr('src')) : '';

    const description =
        $card.find('p,[class*="description"],[class*="excerpt"]').first().text().trim() ||
        `Imported from design: ${title}`;

  return {
        title: title || 'Imported product',
        description: description.slice(0, 2000),
        price: comparePrice && comparePrice > price ? comparePrice : price || 0,
        salePrice: comparePrice && comparePrice > price ? price : null,
        imageSrc,
        cardHtml: $.html(cardEl),
    };
}

function extractProductsFromHtml(html, rewriteUrl = (url) => url) {
    if (!html) return { products: [], cardTemplate: '' };
    const $ = cheerio.load(html);
    const cards = findProductCardElements($, $.root());
    if (!cards.length) return { products: [], cardTemplate: '' };

    const products = cards.map((card) => extractCardData($, card, rewriteUrl));
    return {
        products,
        cardTemplate: products[0]?.cardHtml || '',
    };
}

async function upsertDesignProducts(storeId, designImportId, extractedProducts = []) {
    const usedSlugs = new Set();
    const existing = await Product.find({ storeId }).select('slug').lean();
    existing.forEach((p) => usedSlugs.add(p.slug));

    const saved = [];
    for (const item of extractedProducts) {
        if (!item.title) continue;

        const slug = uniqueSlug(item.title, usedSlugs);
        const tag = `design-import:${designImportId}`;

        const payload = {
            storeId,
            title: item.title,
            slug,
            description: item.description || `Imported from design: ${item.title}`,
            price: item.price > 0 ? item.price : 1,
            salePrice: item.salePrice,
            stock: 100,
            status: 'active',
            images: item.imageSrc ? [item.imageSrc] : ['https://placehold.co/600x600?text=Product'],
            tags: ['imported-design', tag],
            isFeatured: true,
        };

        const existingProduct = await Product.findOne({
            storeId,
            tags: tag,
            title: item.title,
        });

        const product = existingProduct
            ? await Product.findByIdAndUpdate(existingProduct._id, payload, { new: true })
            : await Product.create(payload);

        saved.push(product);
    }

    return saved;
}

/**
 * Scan schema sections, extract product cards, create catalog items, preserve templates.
 */
async function enrichSchemaWithDesignProducts(schema, storeId, designImportId, rewriteUrl = (url) => url) {
    const allExtracted = [];
    let cardTemplate = '';

    for (const page of schema.pages || []) {
        for (const section of page.sections || []) {
            const { products, cardTemplate: sectionTemplate } = extractProductsFromHtml(section.html, rewriteUrl);
            if (!products.length) continue;

            allExtracted.push(...products);
            if (!cardTemplate && sectionTemplate) cardTemplate = sectionTemplate;

            section.importedProductCount = products.length;
            section.cardTemplate = section.cardTemplate || sectionTemplate;
            section.originalHtml = section.originalHtml || section.html;
            section.extractedProducts = products.map((p) => ({
                title: p.title,
                price: p.price,
                salePrice: p.salePrice,
                imageSrc: p.imageSrc,
            }));
        }
    }

    const uniqueByTitle = [];
    const seen = new Set();
    for (const item of allExtracted) {
        const key = item.title.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        uniqueByTitle.push(item);
    }

    const savedProducts = await upsertDesignProducts(storeId, designImportId, uniqueByTitle);
    const productIds = savedProducts.map((p) => p._id.toString());

    schema.importedProducts = {
        designImportId: designImportId.toString(),
        count: savedProducts.length,
        productIds,
        cardTemplate,
    };

    for (const page of schema.pages || []) {
        for (const section of page.sections || []) {
            if (!section.cardTemplate && cardTemplate) {
                section.cardTemplate = cardTemplate;
            }
            if (!shouldBindSectionAsProductGrid(section, page)) continue;

            const sourceConfig = inferProductSourceFromSection(section, page);
            section.originalHtml = section.originalHtml || section.html;
            section.config = {
                ...(section.config || {}),
                source: section.config?.source || sourceConfig.source,
                limit: section.config?.limit || sourceConfig.limit,
                useDesignTemplate: true,
                cardTemplate: section.cardTemplate || cardTemplate,
            };
        }
    }

    return {
        schema,
        productCount: savedProducts.length,
        productIds,
        cardTemplate,
    };
}

module.exports = {
    parsePrice,
    extractProductsFromHtml,
    enrichSchemaWithDesignProducts,
    upsertDesignProducts,
};
