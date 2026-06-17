const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { slugify } = require('../utils/slug');
const { assertSafeStorefrontContent } = require('../utils/sanitize');
const { getRolePermissions } = require('../constants/permissions');

const run = () => {
    assert.strictEqual(slugify('My Demo Store!'), 'my-demo-store');
    assert.strictEqual(slugify('  Beauty & Care  '), 'beauty-care');

    assert(getRolePermissions('owner').includes('manage_staff_permissions'));
    assert(getRolePermissions('viewer').includes('view_dashboard'));
    assert(!getRolePermissions('viewer').includes('delete_products'));

    assert.doesNotThrow(() => assertSafeStorefrontContent({ text: 'Safe content' }));
    assert.throws(() => assertSafeStorefrontContent('<script>alert(1)</script>'), /Unsafe storefront content/);
    assert.throws(() => assertSafeStorefrontContent('<img onerror="alert(1)">'), /Unsafe storefront content/);
    assert.throws(() => assertSafeStorefrontContent({ href: 'javascript:alert(1)' }), /Unsafe storefront content/);

    const root = path.join(__dirname, '..');
    const read = file => fs.readFileSync(path.join(root, file), 'utf8');

    assert(read('routes/products.js').includes('resolveActiveStore'), 'legacy products route must resolve active store');
    assert(!read('routes/products.js').includes('.get(getProducts)'), 'legacy products route must not expose public global listing');
    assert(read('routes/orders.js').includes('storefrontOnly'), 'legacy order checkout must be disabled');
    assert(read('routes/coupons.js').includes('storefrontOnly'), 'legacy coupon validation must be disabled');
    assert(read('routes/users.js').includes('storeScopedOnly'), 'legacy user admin APIs must not expose global users');
    assert(!read('routes/seller.js').includes('501'), 'seller routes must not leave explicit 501 placeholders');
    assert(read('middleware/storeMiddleware.js').includes("status: 'published'"), 'public storefront resolver must only expose published stores');
    assert(!read('controllers/publicMetaController.js').includes('MetaIntegration.findOne();'), 'public Meta config must not use global integration');
    assert(!read('services/metaCapiService.js').includes('MetaIntegration.findOne();'), 'Meta CAPI service must require store-scoped integration');
    assert(read('middleware/securityMiddleware.js').includes('simpleRateLimit'), 'basic rate limiting must be enabled');

    console.log('multi-tenant safety tests passed');
};

run();
