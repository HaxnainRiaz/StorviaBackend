/**
 * Storvia managed storefront route normalization.
 * Maps imported HTML hrefs to safe Storvia public routes.
 */

const BLOCKED_EXTENSIONS = new Set([
    '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
    '.json', '.map', '.php', '.asp', '.aspx', '.exe', '.sh', '.bat'
]);

const PAGE_TYPE_PATTERNS = [
    { type: 'home', patterns: [/^(index|home)(\.html)?$/i, /^$/] },
    { type: 'about', patterns: [/^about(-us)?(\.html)?$/i] },
    { type: 'contact', patterns: [/^contact(-us)?(\.html)?$/i] },
    { type: 'cart', patterns: [/^cart(\.html)?$/i, /^\/cart$/i] },
    { type: 'checkout', patterns: [/^checkout(\.html)?$/i, /^\/checkout$/i] },
    { type: 'products', patterns: [/^(shop|products|store|collections?)(\.html)?$/i, /^\/products$/i, /^\/shop$/i] },
    { type: 'track_order', patterns: [/^(track-?order)(\.html)?$/i] },
    { type: 'faq', patterns: [/^(faq|faqs)(\.html)?$/i] },
    { type: 'wishlist', patterns: [/^wishlist(\.html)?$/i] },
    { type: 'account', patterns: [/^account(\.html)?$/i] },
    { type: 'thank_you', patterns: [/^(thank-?you)(\.html)?$/i] },
    { type: 'sitemap', patterns: [/^sitemap(\.html)?$/i] },
    { type: 'policy', patterns: [/^(privacy|terms|policy|refund|shipping|return)(-policy)?(\.html)?$/i] },
];

function basename(href) {
    if (!href) return '';
    const clean = String(href).split('?')[0].split('#')[0].replace(/\\/g, '/');
    const parts = clean.split('/').filter(Boolean);
    return parts[parts.length - 1] || '';
}

function normalizeImportedHref(href) {
    if (!href || typeof href !== 'string') return '';
    const trimmed = href.trim();
    if (!trimmed || trimmed === '#') return '';
    if (/^(javascript:|data:|file:|vbscript:)/i.test(trimmed)) return 'blocked:unsafe-protocol';
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('//')) {
        return trimmed;
    }
    let path = trimmed.split('?')[0].split('#')[0].replace(/\\/g, '/');
    path = path.replace(/^\.\//, '').replace(/^\/+/, '');
    return path || 'index.html';
}

function classifyPageType(fileName, title = '') {
    const base = basename(fileName).toLowerCase();
    const slug = base.replace(/\.html$/, '');
    const titleLower = String(title).toLowerCase();

    for (const { type, patterns } of PAGE_TYPE_PATTERNS) {
        if (patterns.some(p => p.test(base) || p.test(slug))) return type;
    }
    if (titleLower.includes('about')) return 'about';
    if (titleLower.includes('contact')) return 'contact';
    if (titleLower.includes('cart')) return 'cart';
    if (titleLower.includes('checkout')) return 'checkout';
    if (titleLower.includes('shop') && !titleLower.includes('workshop')) return 'products';
    if (titleLower.includes('privacy') || titleLower.includes('terms') || titleLower.includes('policy')) return 'policy';
    if (titleLower.includes('faq')) return 'faq';
    if (titleLower.includes('track') && titleLower.includes('order')) return 'track_order';
    return 'custom';
}

function pageSlugFromFile(fileName) {
    const base = basename(fileName).replace(/\.html$/i, '');
    if (!base || base === 'index' || base === 'home') return '';
    return base.replace(/\//g, '-').toLowerCase();
}

function storviaRouteForPageType(pageType, pageSlug) {
    switch (pageType) {
        case 'home': return '';
        case 'about': return pageSlug ? `/pages/${pageSlug}` : '/pages/about';
        case 'contact': return '/contact';
        case 'cart': return '/cart';
        case 'checkout': return '/checkout';
        case 'products': return '/products';
        case 'track_order': return '/order-tracking';
        case 'faq': return pageSlug ? `/pages/${pageSlug}` : '/pages/faq';
        case 'wishlist': return pageSlug ? `/pages/${pageSlug}` : '/pages/wishlist';
        case 'account': return pageSlug ? `/pages/${pageSlug}` : '/pages/account';
        case 'thank_you': return pageSlug ? `/pages/${pageSlug}` : '/pages/thank-you';
        case 'sitemap': return pageSlug ? `/pages/${pageSlug}` : '/pages/sitemap';
        case 'policy': return pageSlug ? `/pages/${pageSlug}` : '/pages/policy';
        case 'custom': return pageSlug ? `/pages/${pageSlug}` : '';
        default: return pageSlug ? `/pages/${pageSlug}` : '';
    }
}

function targetTypeForPageType(pageType) {
    switch (pageType) {
        case 'home': return 'imported_page';
        case 'about':
        case 'contact':
        case 'policy':
        case 'custom': return 'imported_page';
        case 'cart': return 'storvia_cart';
        case 'checkout': return 'storvia_checkout';
        case 'products': return 'storvia_product_listing';
        default: return 'imported_page';
    }
}

function isBlockedPath(normalizedPath) {
    const ext = normalizedPath.includes('.')
        ? '.' + normalizedPath.split('.').pop().toLowerCase()
        : '';
    if (BLOCKED_EXTENSIONS.has(ext)) return true;
    if (/\.(css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot)$/i.test(normalizedPath)) return true;
    return false;
}

function resolveHrefTarget(href, pages = []) {
    const normalized = normalizeImportedHref(href);
    if (!normalized) return { targetType: 'blocked', status: 'blocked', normalizedPath: '', storviaRoute: '' };
    if (normalized.startsWith('blocked:')) {
        return { targetType: 'blocked', status: 'blocked', normalizedPath: normalized, storviaRoute: '' };
    }
    if (/^https?:\/\//i.test(normalized) || normalized.startsWith('//')) {
        return { targetType: 'external_safe_link', status: 'active', normalizedPath: normalized, storviaRoute: normalized };
    }
    if (isBlockedPath(normalized)) {
        return { targetType: 'blocked', status: 'blocked', normalizedPath: normalized, storviaRoute: '' };
    }

    const base = basename(normalized);
    const pageType = classifyPageType(base, base);
    const pageSlug = pageSlugFromFile(normalized);

    const matchedPage = pages.find(p =>
        p.fileName === normalized ||
        p.fileName === base ||
        p.slug === pageSlug ||
        p.id === pageSlug ||
        (pageType === 'home' && (p.id === 'home' || p.type === 'home'))
    );

    const resolvedType = matchedPage?.type && matchedPage.type !== 'imported'
        ? matchedPage.type
        : pageType;
    const resolvedSlug = matchedPage?.slug ?? pageSlug;
    const storviaRoute = matchedPage?.storviaRoute || storviaRouteForPageType(resolvedType, resolvedSlug);

    return {
        targetType: targetTypeForPageType(resolvedType),
        targetId: matchedPage?.id || resolvedSlug || 'home',
        targetSlug: resolvedSlug,
        normalizedPath: normalized,
        storviaRoute,
        status: storviaRoute ? 'active' : 'unmapped',
        pageType: resolvedType,
    };
}

function buildPageRouteLookup(pages = []) {
    const lookup = new Map();
    for (const page of pages) {
        const file = page.fileName || (page.id === 'home' ? 'index.html' : `${page.id}.html`);
        const base = basename(file);
        const slug = page.slug ?? pageSlugFromFile(file);
        const route = page.storviaRoute || '';
        [file, base, page.id, slug, `${slug}.html`].filter(Boolean).forEach((key) => {
            lookup.set(String(key).toLowerCase(), route);
        });
    }
    return lookup;
}

function buildRouteMap(schema) {
    const pages = schema?.pages || [];
    const routeMap = [];
    const seen = new Set();

    for (const page of pages) {
        const pageType = page.type && page.type !== 'imported' ? page.type : classifyPageType(page.fileName || page.id, page.title);
        const slug = page.slug ?? pageSlugFromFile(page.fileName || page.id);
        const storviaRoute = page.storviaRoute || storviaRouteForPageType(pageType, slug);
        const key = `page:${page.id}`;
        if (!seen.has(key)) {
            seen.add(key);
            routeMap.push({
                id: `page_${page.id}`,
                originalHref: page.fileName || `${page.id}.html`,
                normalizedPath: page.fileName || page.id,
                targetType: targetTypeForPageType(pageType),
                targetId: page.id,
                targetSlug: slug,
                storviaRoute,
                status: storviaRoute ? 'active' : 'unmapped',
            });
        }
        page.type = pageType;
        page.slug = slug;
        page.storviaRoute = storviaRoute;
    }

    const pageRouteLookup = buildPageRouteLookup(pages);

    for (const link of schema?.pageLinks || []) {
        const href = link.originalHref || link.toPage;
        const normalized = normalizeImportedHref(href);
        const base = basename(normalized).toLowerCase();
        const fromPageRoute = pageRouteLookup.get(base)
            || pageRouteLookup.get(normalized.toLowerCase());
        const resolved = resolveHrefTarget(href, pages);
        const storviaRoute = fromPageRoute || link.storviaRoute || resolved.storviaRoute || '';
        link.storviaRoute = storviaRoute;
        link.storviaMapped = Boolean(storviaRoute);
        link.targetType = resolved.targetType;

        const key = `target:${normalized}`;
        if (seen.has(key)) continue;
        seen.add(key);
        routeMap.push({
            id: `link_${seen.size}`,
            originalHref: href,
            normalizedPath: resolved.normalizedPath,
            targetType: resolved.targetType,
            targetId: resolved.targetId,
            targetSlug: resolved.targetSlug,
            storviaRoute,
            status: storviaRoute ? 'active' : resolved.status,
            label: link.label,
            usedOnPages: 1,
        });
    }

    // Count how many pages use each unique target
    const usage = {};
    for (const link of schema?.pageLinks || []) {
        const k = normalizeImportedHref(link.originalHref || link.toPage);
        usage[k] = (usage[k] || 0) + 1;
    }
    for (const entry of routeMap) {
        if (entry.id.startsWith('link_')) {
            entry.usedOnPages = usage[entry.normalizedPath] || usage[normalizeImportedHref(entry.originalHref)] || 1;
        }
    }

    schema.routeMap = routeMap;
    schema.uniqueRoutes = routeMap.filter((r) => r.id.startsWith('link_'));
    return routeMap;
}

function publicPathForRoute(storeSlug, storviaRoute) {
    if (!storeSlug) {
        if (!storviaRoute || storviaRoute === '/') return '/';
        return storviaRoute.startsWith('/') ? storviaRoute : `/${storviaRoute}`;
    }
    const base = `/store/${storeSlug}`;
    if (!storviaRoute || storviaRoute === '/') return base;
    return `${base}${storviaRoute.startsWith('/') ? storviaRoute : `/${storviaRoute}`}`;
}

function lookupRoute(routeMap, href) {
    const normalized = normalizeImportedHref(href);
    if (!normalized) return null;
    const base = basename(normalized);
    return (routeMap || []).find(r =>
        r.originalHref === href ||
        r.originalHref === normalized ||
        r.normalizedPath === normalized ||
        r.normalizedPath === base ||
        basename(r.originalHref) === base
    ) || null;
}

function rewriteHtmlLinks(html, routeMap, storeSlug) {
    if (!html || typeof html !== 'string') return html;
    return html.replace(/<a\s+([^>]*?)href\s*=\s*(['"])(.*?)\2([^>]*)>/gi, (match, before, quote, href, after) => {
        const normalized = normalizeImportedHref(href);
        if (!normalized) return match;
        if (/^(javascript:|data:|file:|vbscript:)/i.test(href)) {
            return `<a ${before}href="#" data-storvia-blocked="true"${after}>`;
        }
        if (/^https?:\/\//i.test(href) || href.startsWith('//')) {
            return `<a ${before}href="${href}" target="_blank" rel="noopener noreferrer"${after}>`;
        }
        if (isBlockedPath(normalized)) {
            return `<a ${before}href="#" data-storvia-blocked="true"${after}>`;
        }
        const route = lookupRoute(routeMap, href);
        const storviaRoute = route?.storviaRoute || resolveHrefTarget(href, []).storviaRoute;
        if (!storviaRoute) {
            return `<a ${before}href="#" data-storvia-unmapped="true" data-original-href="${href}"${after}>`;
        }
        const publicPath = publicPathForRoute(storeSlug, storviaRoute);
        return `<a ${before}href="${publicPath}" data-storvia-route="${storviaRoute}"${after}>`;
    });
}

function applyRouteMapToSchema(schema, storeSlug) {
    if (!schema) return schema;
    buildRouteMap(schema);
    if (storeSlug) rewriteAssetUrlsInSchema(schema, storeSlug);
    for (const page of schema.pages || []) {
        for (const section of page.sections || []) {
            if (section.html) {
                section.html = rewriteHtmlLinks(section.html, schema.routeMap, storeSlug || 'store');
            }
        }
    }
    return schema;
}

function rewriteStorefrontAssetUrls(content, storeSlug) {
    if (!content || !storeSlug) return content;
    return String(content).replace(
        /\/api\/storefront\/[a-f0-9]{24}\/assets\//gi,
        `/api/storefront/${storeSlug}/assets/`
    );
}

function rewriteAssetUrlsInSchema(schema, storeSlug) {
    if (!schema || !storeSlug) return schema;
    if (schema.scopedCss) schema.scopedCss = rewriteStorefrontAssetUrls(schema.scopedCss, storeSlug);
    if (schema.globalStyles?.rawCss) {
        schema.globalStyles.rawCss = rewriteStorefrontAssetUrls(schema.globalStyles.rawCss, storeSlug);
    }
    for (const page of schema.pages || []) {
        for (const section of page.sections || []) {
            if (section.html) section.html = rewriteStorefrontAssetUrls(section.html, storeSlug);
            for (const field of section.editableFields || []) {
                if (field.type === 'image' && field.value) {
                    field.value = rewriteStorefrontAssetUrls(field.value, storeSlug);
                }
            }
        }
    }
    for (const asset of schema.assets || []) {
        if (asset.safeUrl) asset.safeUrl = rewriteStorefrontAssetUrls(asset.safeUrl, storeSlug);
    }
    return schema;
}

module.exports = {
    normalizeImportedHref,
    basename,
    classifyPageType,
    pageSlugFromFile,
    storviaRouteForPageType,
    targetTypeForPageType,
    isBlockedPath,
    resolveHrefTarget,
    buildRouteMap,
    buildPageRouteLookup,
    publicPathForRoute,
    lookupRoute,
    rewriteHtmlLinks,
    rewriteStorefrontAssetUrls,
    rewriteAssetUrlsInSchema,
    applyRouteMapToSchema,
};
