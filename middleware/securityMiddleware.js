const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX || 600);
const buckets = new Map();

const blockedKeys = new Set(['$where', '$function', 'mapReduce']);

const isPlainObject = value => (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
);

const sanitizeValue = (value) => {
    if (Array.isArray(value)) return value.map(sanitizeValue);
    if (!isPlainObject(value)) return value;

    const clean = {};
    for (const [key, nested] of Object.entries(value)) {
        if (key.startsWith('$') || key.includes('.') || blockedKeys.has(key)) continue;
        clean[key] = sanitizeValue(nested);
    }
    return clean;
};

exports.securityHeaders = (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
};

exports.simpleRateLimit = (req, res, next) => {
    const key = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const now = Date.now();
    const bucket = buckets.get(key) || { resetAt: now + WINDOW_MS, count: 0 };

    if (bucket.resetAt <= now) {
        bucket.resetAt = now + WINDOW_MS;
        bucket.count = 0;
    }

    bucket.count += 1;
    buckets.set(key, bucket);

    res.setHeader('X-RateLimit-Limit', String(MAX_REQUESTS));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(MAX_REQUESTS - bucket.count, 0)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > MAX_REQUESTS) {
        return res.status(429).json({ success: false, message: 'Too many requests' });
    }

    next();
};

exports.sanitizeRequest = (req, res, next) => {
    if (req.body) req.body = sanitizeValue(req.body);
    if (req.query) req.query = sanitizeValue(req.query);
    if (req.params) req.params = sanitizeValue(req.params);
    next();
};
