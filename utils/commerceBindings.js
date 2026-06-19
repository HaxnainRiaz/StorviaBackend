/**
 * Storefront commerce binding utilities — connect imported design selectors
 * to Storvia dynamic commerce section types.
 */

const TARGET_TO_COMPONENT = {
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
    PolicyLinks: 'dynamic_policies',
};

const TARGET_TO_BINDING_TYPE = {
    Header: 'header',
    Logo: 'logo',
    Navigation: 'navigation',
    Hero: 'hero',
    ProductGrid: 'product_grid',
    FeaturedProducts: 'product_grid',
    CollectionLinks: 'collection_grid',
    CartButton: 'cart_button',
    SearchButton: 'search_input',
    Footer: 'footer',
    ContactSection: 'contact_support_form',
    PolicyLinks: 'policy_links',
};

const BINDING_TYPE_TO_TARGET = Object.fromEntries(
    Object.entries(TARGET_TO_BINDING_TYPE).map(([k, v]) => [v, k])
);

const REQUIRED_BINDING_TYPES = ['product_grid', 'cart_button', 'checkout_button'];

function targetTypeToComponentType(targetType) {
    return TARGET_TO_COMPONENT[targetType] || 'static_or_mapped';
}

function targetTypeToBindingType(targetType) {
    return TARGET_TO_BINDING_TYPE[targetType] || null;
}

function sectionMatchesSelector(section, sourceSelector) {
    if (!sourceSelector || !section) return false;

    const sel = String(section.selector || '').trim();
    const label = String(section.label || '').trim();
    const classAttr = String(section.classVal || section.classAttr || '').trim();
    const idAttr = String(section.idAttr || '').trim();
    const src = String(sourceSelector).trim();

    if (sel === src) return true;

    const normClass = src.startsWith('.') ? src.slice(1) : src;
    const normId = src.startsWith('#') ? src.slice(1) : null;

    if (sel === `.${normClass}` || sel === `#${normClass}`) return true;
    if (label === normClass || label.split(/\s+/).includes(normClass)) return true;
    if (classAttr.split(/\s+/).some((c) => c === normClass)) return true;
    if (normId && (idAttr === normId || sel === `#${normId}`)) return true;

    if (src.startsWith('.') && classAttr.includes(normClass)) return true;

    return false;
}

function inferProductSourceFromSection(section, page = {}) {
    const haystack = [
        section.selector,
        section.label,
        section.classVal,
        section.classAttr,
        section.idAttr,
        section.html,
        page.slug,
        page.type,
        page.title,
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    const cardCount = section.importedProductCount || section.extractedProducts?.length || 0;
    const limit = Math.max(cardCount || 4, 4);

    if (/best[\s_-]?sell/.test(haystack)) {
        return { source: 'best_sellers', limit: Math.min(limit, 12) };
    }
    if (/new[\s_-]?arrival/.test(haystack)) {
        return { source: 'new_arrival', limit: Math.min(limit, 12) };
    }
    if (/featured/.test(haystack)) {
        return { source: 'featured_products', limit: Math.min(limit, 12) };
    }
    if (/discount|sale/.test(haystack)) {
        return { source: 'discounted_products', limit: Math.min(limit, 12) };
    }

    const isShopPage =
        page.type === 'products' ||
        ['shop', 'products', 'store'].includes(String(page.slug || '').toLowerCase());

    if (isShopPage) {
        return { source: 'newest_products', limit: Math.max(limit, 24) };
    }

    return { source: 'newest_products', limit: Math.min(limit, 8) };
}

/**
 * Only true product-grid zones become live commerce sections.
 * Hero banners and single-product promos stay as imported static HTML.
 */
function shouldBindSectionAsProductGrid(section, page = {}) {
    if (!section) return false;
    if (section.type === 'dynamic_product_grid' || section.type === 'dynamic_featured_products') {
        return true;
    }

    const cardCount = section.importedProductCount || section.extractedProducts?.length || 0;
    if (!cardCount) return false;

    const haystack = [
        section.selector,
        section.label,
        section.classVal,
        section.classAttr,
        section.html,
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    const isShopPage =
        page.type === 'products' ||
        ['shop', 'products', 'store'].includes(String(page.slug || '').toLowerCase());

    const hasGridClass = /product[\s_-]?grid|products[\s_-]?grid|shop[\s_-]?grid|product[\s_-]?list|catalog/.test(
        haystack
    );
    const hasCollectionClass = /featured|best[\s_-]?sell|new[\s_-]?arrival|collection/.test(haystack);

    if (isShopPage && cardCount >= 1) return true;
    if (hasGridClass && cardCount >= 1) return true;
    if (hasCollectionClass && cardCount >= 1) return true;
    if (cardCount >= 2) return true;

    return false;
}

function isProductGridSection(section) {
    if (!section) return false;
    if (section.type === 'dynamic_product_grid' || section.type === 'dynamic_featured_products') {
        return true;
    }
    const haystack = [
        section.selector,
        section.label,
        section.tagName,
        section.classVal,
        section.classAttr,
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    if (/product[\s_-]?grid|shop[\s_-]?grid|product[\s_-]?list|catalog|featured[\s_-]?product/.test(haystack)) {
        return true;
    }
    if (section.html && /product[\s_-]?grid|product[\s_-]?card|shop[\s_-]?grid|class="[^"]*product/i.test(section.html)) {
        return true;
    }
    return false;
}

function findProductGridSections(schema) {
    const found = [];
    for (const page of schema?.pages || []) {
        for (const section of page.sections || []) {
            if (isProductGridSection(section)) {
                found.push({ pageId: page.id, sectionId: section.id, section });
            }
        }
    }
    return found;
}

function findFirstProductGridSection(schema) {
    return findProductGridSections(schema)[0] || null;
}

/**
 * Apply StorefrontMapping records to draft/published schema sections.
 */
function applyMappingsToSchema(schema, mappings = []) {
    if (!schema?.pages) return schema;

    for (const page of schema.pages) {
        for (const section of page.sections || []) {
            const matched = mappings.find(
                (m) => m.sourceSelector && m.status !== 'unmapped' && sectionMatchesSelector(section, m.sourceSelector)
            );
            if (matched) {
                section.type = targetTypeToComponentType(matched.targetType);
                section.source = 'storvia';
                section.selector = matched.sourceSelector;
                section.bindingType = targetTypeToBindingType(matched.targetType);
                if (matched.targetConfig && Object.keys(matched.targetConfig).length) {
                    section.config = { ...(section.config || {}), ...matched.targetConfig };
                }
            }
        }
    }
    return schema;
}

/**
 * Auto-convert likely product grid sections to dynamic_product_grid.
 */
function autoBindProductGrids(schema, config = {}) {
    if (!schema?.pages) return schema;

    for (const page of schema.pages) {
        for (const section of page.sections || []) {
            if (section.type !== 'static_or_mapped') continue;
            if (!shouldBindSectionAsProductGrid(section, page)) continue;

            const sourceConfig = inferProductSourceFromSection(section, page);
            const cardTemplate =
                section.cardTemplate || schema?.importedProducts?.cardTemplate || config.cardTemplate || '';

            section.originalHtml = section.originalHtml || section.html;
            section.type = 'dynamic_product_grid';
            section.source = 'storvia';
            section.bindingType = 'product_grid';
            section.config = {
                source: config.source || sourceConfig.source,
                limit: config.limit || sourceConfig.limit,
                showPrice: config.showPrice !== false,
                showAddToCart: config.showAddToCart !== false,
                gridColumns: config.gridColumns || 4,
                useDesignTemplate: Boolean(cardTemplate),
                cardTemplate,
                ...(section.config || {}),
            };
        }
    }
    return schema;
}

/**
 * Build StorefrontCommerceBinding-shaped records from schema + mappings.
 */
function buildBindingsFromSchema(schema, storeId, managedStorefrontId) {
    const bindings = [];
    const mappings = schema?.mappings || [];

    for (const page of schema?.pages || []) {
        for (const section of page.sections || []) {
            const mapping = mappings.find(
                (m) => m.sourceSelector && sectionMatchesSelector(section, m.sourceSelector)
            );

            let bindingType = section.bindingType || null;
            if (!bindingType && mapping) {
                bindingType = targetTypeToBindingType(mapping.targetType);
            }
            if (!bindingType && section.type === 'dynamic_product_grid') bindingType = 'product_grid';
            if (!bindingType && section.type === 'dynamic_cart_button') bindingType = 'cart_button';
            if (!bindingType && section.type === 'dynamic_contact') bindingType = 'contact_support_form';

            if (!bindingType) continue;

            const isMapped =
                section.source === 'storvia' &&
                section.type !== 'static_or_mapped';

            bindings.push({
                storeId,
                managedStorefrontId,
                pageId: page.id,
                sourceSelector: section.selector || mapping?.sourceSelector || '',
                sourceLabel: section.label || section.selector || '',
                bindingType,
                config: section.config || mapping?.targetConfig || {},
                required: REQUIRED_BINDING_TYPES.includes(bindingType),
                status: isMapped ? 'mapped' : 'unmapped',
            });
        }
    }

    return bindings;
}

function validatePublishBindings(schema) {
    const issues = [];
    const grids = findProductGridSections(schema).filter((g) => g.section.type === 'dynamic_product_grid');
    const hasProductArea = grids.length > 0;

    const allSections = (schema?.pages || []).flatMap((p) => p.sections || []);
    const hasCartBinding = allSections.some((s) => s.type === 'dynamic_cart_button' || s.bindingType === 'cart_button');

    if (!hasProductArea) {
        const anyProductHtml = allSections.some((s) => isProductGridSection(s));
        if (anyProductHtml) {
            issues.push({ code: 'product_grid_unmapped', message: 'Product area detected but not bound to live products.' });
        }
    }

    if (!hasCartBinding) {
        issues.push({ code: 'cart_button_unmapped', message: 'Cart button is not mapped to Storvia cart.', severity: 'warning' });
    }

    return { valid: issues.filter((i) => i.severity !== 'warning').length === 0, issues };
}

module.exports = {
    TARGET_TO_COMPONENT,
    TARGET_TO_BINDING_TYPE,
    BINDING_TYPE_TO_TARGET,
    REQUIRED_BINDING_TYPES,
    targetTypeToComponentType,
    targetTypeToBindingType,
    sectionMatchesSelector,
    isProductGridSection,
    shouldBindSectionAsProductGrid,
    inferProductSourceFromSection,
    findProductGridSections,
    findFirstProductGridSection,
    applyMappingsToSchema,
    autoBindProductGrids,
    buildBindingsFromSchema,
    validatePublishBindings,
};
