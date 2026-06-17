const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { spawn } = require('child_process');

const rootDir = path.join(__dirname, '..');
const config = {
    baseUrl: (process.env.TEST_BASE_URL || process.env.BASE_URL || 'http://localhost:5000').replace(/\/$/, ''),
    startServer: process.env.TEST_START_SERVER !== 'false',
    serverPort: process.env.PORT || '5000',
    adminToken: process.env.TEST_AUTH_TOKEN || process.env.AUTH_TOKEN || '',
    storeId: process.env.TEST_STORE_ID || process.env.STORE_ID || '',
    storeSlug: process.env.TEST_STORE_SLUG || process.env.STORE_SLUG || 'definitely-missing-store',
    latencyIterations: Number(process.env.TEST_LATENCY_ITERATIONS || 10),
    latencyBudgetMs: Number(process.env.TEST_LATENCY_BUDGET_MS || 750),
    loadEnabled: process.env.TEST_RUN_LOAD === 'true',
    loadDurationSeconds: Number(process.env.TEST_LOAD_DURATION || 10),
    loadConnections: Number(process.env.TEST_LOAD_CONNECTIONS || 10)
};

const results = [];
let serverProcess = null;

const color = {
    green: text => `\x1b[32m${text}\x1b[0m`,
    yellow: text => `\x1b[33m${text}\x1b[0m`,
    red: text => `\x1b[31m${text}\x1b[0m`,
    cyan: text => `\x1b[36m${text}\x1b[0m`
};

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const record = (name, status, details = '') => {
    results.push({ name, status, details });
    const marker = status === 'pass' ? color.green('PASS') : status === 'skip' ? color.yellow('SKIP') : color.red('FAIL');
    console.log(`${marker} ${name}${details ? ` - ${details}` : ''}`);
};

const assert = (condition, message) => {
    if (!condition) throw new Error(message);
};

const request = (method, urlPath, options = {}) => {
    const target = new URL(urlPath, config.baseUrl);
    const transport = target.protocol === 'https:' ? https : http;
    const body = options.body === undefined ? null : JSON.stringify(options.body);
    const headers = {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
        ...(options.headers || {})
    };

    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const req = transport.request(target, { method, headers, timeout: options.timeout || 15000 }, res => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const rawBody = Buffer.concat(chunks).toString('utf8');
                let json = null;
                try {
                    json = rawBody ? JSON.parse(rawBody) : null;
                } catch (error) {
                    json = null;
                }
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: rawBody,
                    json,
                    durationMs: Date.now() - startedAt
                });
            });
        });

        req.on('timeout', () => {
            req.destroy(new Error(`Request timed out: ${method} ${target.href}`));
        });
        req.on('error', error => {
            const detail = [
                error.code,
                error.message,
                `${method} ${target.href}`
            ].filter(Boolean).join(' - ');
            reject(new Error(detail || `Request failed: ${method} ${target.href}`));
        });
        if (body) req.write(body);
        req.end();
    });
};

const probeExistingServer = async () => {
    try {
        await request('GET', `/api/storefront/${config.storeSlug}`, { timeout: 3000 });
        return true;
    } catch (error) {
        return false;
    }
};

const startServerIfRequested = async () => {
    const reachable = await probeExistingServer();
    if (reachable) return;

    if (!config.startServer) {
        throw new Error(`Cannot reach backend at ${config.baseUrl}. Start the backend first or remove TEST_START_SERVER=false.`);
    }

    console.log(color.cyan(`Starting backend on port ${config.serverPort}...`));
    serverProcess = spawn('node', ['server.js'], {
        cwd: rootDir,
        env: { ...process.env, PORT: config.serverPort, ENABLE_TRACKING_WORKER: process.env.ENABLE_TRACKING_WORKER || 'false' },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
    });

    let output = '';
    serverProcess.stdout.on('data', chunk => { output += chunk.toString(); });
    serverProcess.stderr.on('data', chunk => { output += chunk.toString(); });

    for (let i = 0; i < 45; i += 1) {
        if (output.includes(`Server running on port ${config.serverPort}`)) {
            for (let j = 0; j < 10; j += 1) {
                if (output.includes('MongoDB Connected successfully') || output.includes('Initial DB Connection Error')) break;
                await wait(500);
            }
            return;
        }
        if (output.includes('EADDRINUSE')) {
            throw new Error(`Port ${config.serverPort} is already in use but ${config.baseUrl} did not respond like this backend. Check TEST_BASE_URL/PORT.`);
        }
        if (serverProcess.exitCode !== null) {
            throw new Error(`Server exited before startup:\n${output}`);
        }
        await wait(1000);
    }

    throw new Error(`Server did not start within 45s:\n${output}`);
};

const runStaticSecurityChecks = async () => {
    const read = file => fs.readFileSync(path.join(rootDir, file), 'utf8');
    const checks = [
        ['security middleware exists', () => read('middleware/securityMiddleware.js').includes('simpleRateLimit')],
        ['server applies security headers', () => read('server.js').includes('securityHeaders')],
        ['server applies NoSQL sanitization', () => read('server.js').includes('sanitizeRequest')],
        ['legacy public orders disabled', () => read('routes/orders.js').includes('storefrontOnly')],
        ['legacy public coupons disabled', () => read('routes/coupons.js').includes('storefrontOnly')],
        ['legacy public product listing protected', () => read('routes/products.js').includes('resolveActiveStore')],
        ['public Meta config is store scoped', () => !read('controllers/publicMetaController.js').includes('MetaIntegration.findOne();')],
        ['Meta CAPI requires store scoped integration', () => !read('services/metaCapiService.js').includes('MetaIntegration.findOne();')],
        ['upload validates file type', () => read('routes/upload.js').includes('allowedMimeTypes')]
    ];

    for (const [name, fn] of checks) {
        try {
            assert(fn(), 'static assertion failed');
            record(`static: ${name}`, 'pass');
        } catch (error) {
            record(`static: ${name}`, 'fail', error.message);
        }
    }
};

const runExecutionChecks = async () => {
    const probes = [
        ['GET missing storefront', 'GET', `/api/storefront/${config.storeSlug}`, [404]],
        ['GET legacy products needs auth/store', 'GET', '/api/products', [401, 403, 503]],
        ['POST legacy checkout disabled', 'POST', '/api/orders', [410]],
        ['GET legacy coupon validation disabled', 'GET', '/api/coupons/validate/ANYCODE', [410]],
        ['POST legacy tracking disabled', 'POST', '/api/tracking/meta/event', [410]]
    ];

    for (const [name, method, urlPath, expected] of probes) {
        try {
            const res = await request(method, urlPath, { body: method === 'POST' ? {} : undefined });
            assert(expected.includes(res.statusCode), `expected ${expected.join('/')} got ${res.statusCode}; body=${res.body.slice(0, 200)}`);
            record(`execution: ${name}`, 'pass', `${res.statusCode} in ${res.durationMs}ms`);
        } catch (error) {
            record(`execution: ${name}`, 'fail', error.message);
        }
    }
};

const runSecurityHeaderChecks = async () => {
    try {
        const res = await request('GET', `/api/storefront/${config.storeSlug}`);
        assert(res.headers['x-content-type-options'] === 'nosniff', `missing X-Content-Type-Options; headers=${JSON.stringify(res.headers)}`);
        assert(res.headers['x-frame-options'] === 'DENY', `missing X-Frame-Options; headers=${JSON.stringify(res.headers)}`);
        assert(res.headers['x-ratelimit-limit'], `missing rate limit headers; headers=${JSON.stringify(res.headers)}`);
        record('security: headers and rate-limit headers', 'pass');
    } catch (error) {
        record('security: headers and rate-limit headers', 'fail', error.message);
    }
};

const runValidationChecks = async () => {
    const payloads = [
        ['tracking missing required fields', 'POST', `/${encodeURIComponent('api')}/tracking/${config.storeSlug}/meta/event`, {}, [400, 404]],
        ['NoSQL query key does not crash', 'GET', `/api/storefront/${config.storeSlug}?$where=this.password`, null, [404]],
        ['oversized-looking invalid json shape handled', 'POST', `/api/storefront/${config.storeSlug}/orders`, { items: [], shippingAddress: { $where: 'bad' } }, [400, 404]]
    ];

    for (const [name, method, urlPath, body, expected] of payloads) {
        try {
            const res = await request(method, urlPath, { body: body === null ? undefined : body });
            assert(expected.includes(res.statusCode), `expected ${expected.join('/')} got ${res.statusCode}; body=${res.body.slice(0, 200)}`);
            record(`validation: ${name}`, 'pass', `${res.statusCode}`);
        } catch (error) {
            record(`validation: ${name}`, 'fail', error.message);
        }
    }
};

const percentile = (values, p) => {
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(index, 0)];
};

const runLatencyChecks = async () => {
    const samples = [];
    for (let i = 0; i < config.latencyIterations; i += 1) {
        try {
            const res = await request('GET', `/api/storefront/${config.storeSlug}`);
            samples.push(res.durationMs);
        } catch (error) {
            record('latency: sample collection', 'fail', error.message || String(error));
            return;
        }
    }

    const p50 = percentile(samples, 50);
    const p95 = percentile(samples, 95);
    const avg = Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length);
    const details = `avg=${avg}ms p50=${p50}ms p95=${p95}ms samples=${samples.length}`;
    record('latency: public endpoint budget', p95 <= config.latencyBudgetMs ? 'pass' : 'fail', details);
};

const runAuthenticatedChecks = async () => {
    if (!config.adminToken || !config.storeId) {
        record('authenticated: seller/admin-panel probes', 'skip', 'set TEST_AUTH_TOKEN and TEST_STORE_ID to enable');
        return;
    }

    const headers = {
        Authorization: `Bearer ${config.adminToken}`,
        'x-store-id': config.storeId
    };
    const probes = [
        ['seller setup status', 'GET', '/api/seller/store/setup-status', undefined, [200, 403, 404]],
        ['seller products scoped list', 'GET', '/api/seller/products?limit=1', undefined, [200]],
        ['seller notifications scoped list', 'GET', '/api/seller/notifications', undefined, [200]],
        ['legacy products now scoped with auth', 'GET', '/api/products?limit=1', undefined, [200]],
        ['seller design import list', 'GET', '/api/seller/design-import', undefined, [200]],
        ['seller managed storefront configuration', 'GET', '/api/seller/managed-storefront', undefined, [200]],
        ['seller storefront version history', 'GET', '/api/seller/managed-storefront/versions', undefined, [200]],
        ['public managed storefront schema', 'GET', `/api/storefront/${config.storeSlug}/render-schema`, undefined, [200, 404]]
    ];

    for (const [name, method, urlPath, body, expected] of probes) {
        try {
            const res = await request(method, urlPath, { headers, body });
            assert(expected.includes(res.statusCode), `expected ${expected.join('/')} got ${res.statusCode}`);
            record(`authenticated: ${name}`, 'pass', `${res.statusCode} in ${res.durationMs}ms`);
        } catch (error) {
            record(`authenticated: ${name}`, 'fail', error.message);
        }
    }
};

const runLoadCheck = async () => {
    if (!config.loadEnabled) {
        record('speed/load: autocannon', 'skip', 'set TEST_RUN_LOAD=true to enable');
        return;
    }

    try {
        const autocannon = require('autocannon');
        const result = await autocannon({
            url: `${config.baseUrl}/api/storefront/${config.storeSlug}`,
            connections: config.loadConnections,
            duration: config.loadDurationSeconds,
            timeout: 10
        });
        const details = `req/s=${Math.round(result.requests.average)} p95=${result.latency.p95}ms errors=${result.errors} timeouts=${result.timeouts}`;
        assert(result.errors === 0, 'load test reported errors');
        record('speed/load: autocannon', result.latency.p95 <= config.latencyBudgetMs ? 'pass' : 'fail', details);
    } catch (error) {
        record('speed/load: autocannon', 'fail', error.message);
    }
};

const printSummaryAndExit = () => {
    const counts = results.reduce((acc, item) => {
        acc[item.status] = (acc[item.status] || 0) + 1;
        return acc;
    }, {});

    console.log('\n' + color.cyan('Full Backend Test Summary'));
    console.log(`Base URL: ${config.baseUrl}`);
    console.log(`Passed: ${counts.pass || 0}`);
    console.log(`Failed: ${counts.fail || 0}`);
    console.log(`Skipped: ${counts.skip || 0}`);

    const failures = results.filter(item => item.status === 'fail');
    if (failures.length) {
        console.log('\nFailures:');
        failures.forEach(item => console.log(`- ${item.name}: ${item.details}`));
    }

    process.exitCode = failures.length ? 1 : 0;
};

const cleanup = () => {
    if (serverProcess && serverProcess.exitCode === null) {
        serverProcess.kill();
    }
    if (serverProcess?.stdout) serverProcess.stdout.destroy();
    if (serverProcess?.stderr) serverProcess.stderr.destroy();
};

process.on('exit', cleanup);
process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
});

(async () => {
    try {
        await startServerIfRequested();
        console.log(color.cyan(`Testing backend at ${config.baseUrl}`));
        await runStaticSecurityChecks();
        await runExecutionChecks();
        await runSecurityHeaderChecks();
        await runValidationChecks();
        await runLatencyChecks();
        await runAuthenticatedChecks();
        await runLoadCheck();
    } catch (error) {
        record('suite startup/execution', 'fail', error.message);
    } finally {
        cleanup();
        printSummaryAndExit();
    }
})();
