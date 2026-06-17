const SCRIPT_TAG_RE = /<\s*\/?\s*script\b[^>]*>/i;
const EVENT_HANDLER_RE = /\son[a-z]+\s*=/i;
const JS_URL_RE = /javascript\s*:/i;

const assertSafeStorefrontContent = (value) => {
    const raw = typeof value === 'string' ? value : JSON.stringify(value || {});
    if (SCRIPT_TAG_RE.test(raw) || EVENT_HANDLER_RE.test(raw) || JS_URL_RE.test(raw)) {
        const error = new Error('Unsafe storefront content is not allowed');
        error.status = 400;
        throw error;
    }
};

module.exports = { assertSafeStorefrontContent };
