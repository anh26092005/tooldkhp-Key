import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../functions/api/[[path]].js', import.meta.url), 'utf8');
const { onRequest } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

function gatewayRequest(payload) {
    const p = Buffer.from(JSON.stringify(payload)).toString('base64');
    return new Request('https://example.pages.dev/api/gateway', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ p })
    });
}

test('gateway forwards allowed request and preserves UTF-8 response', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
        assert.equal(url, 'https://portal.ut.edu.vn/api/v1/dkhp/test?id=1');
        assert.equal(options.headers.get('Authorization'), 'Bearer example');
        return new Response(JSON.stringify({ success: true, message: 'Đăng ký thành công' }), { status: 200 });
    };
    try {
        const request = gatewayRequest({ method: 'GET', endpoint: '/dkhp/test?id=1', token: 'example', key: 'VALID', studentId: 'S1' });
        const env = { DKHP_KEYS: { get: async key => key === 'VALID' ? JSON.stringify({ keyType: 'shared' }) : null } };
        const response = await onRequest({ request, params: { path: ['gateway'] }, env });
        const body = await response.json();
        assert.equal(JSON.parse(Buffer.from(body.r, 'base64').toString('utf8')).message, 'Đăng ký thành công');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('gateway rejects invalid paths and malformed bodies', async () => {
    const request = gatewayRequest({ method: 'GET', endpoint: '/user/login' });
    assert.equal((await onRequest({ request, params: { path: ['gateway'] }, env: {} })).status, 400);
    const malformed = new Request('https://example.pages.dev/api/gateway', { method: 'POST', body: '{}' });
    assert.equal((await onRequest({ request: malformed, params: { path: ['gateway'] }, env: {} })).status, 400);
    for (const endpoint of ['/dkhp/../user/login', '/dkhp/%2e%2e/user/login']) {
        const invalid = gatewayRequest({ method: 'GET', endpoint });
        assert.equal((await onRequest({ request: invalid, params: { path: ['gateway'] }, env: {} })).status, 400);
    }
});
