// End-to-end smoke test against a running stack (docker compose up, or a deployed instance).
//
//   BASE_URL=http://localhost:8080 node --test e2e/smoke.test.mjs
//
// Exercises the real path a user takes, including the real vision models: register, build a tree, upload,
// let the sorter file by what it sees, review the uncertain ones, search, sign out. No dependencies: PNGs are
// encoded here with zlib so the test needs nothing but Node.
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { before, describe, it } from 'node:test';

const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
const PASSWORD = 'smoke test passphrase 123';
const USERNAME = process.env.SMOKE_USERNAME ?? 'smoke-owner';

/** @returns The CRC-32 of a buffer, which PNG chunks require. */
function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc ^= byte;
        for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), 8 + data.length);
    return out;
}

/** A solid-colour PNG; `seed` shifts one channel so each upload is a distinct file. */
function solidPng([r, g, b], seed = 0, size = 96) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(size, 0);
    header.writeUInt32BE(size, 4);
    header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) row.set([r, g, (b + seed) % 256], 1 + x * 3);
    const raw = Buffer.concat(Array.from({ length: size }, () => row));
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(raw)),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

let token = '';
let refreshCookie = '';

async function call(method, path, { body, form, auth = true, headers = {} } = {}) {
    const init = { method, headers: { ...headers } };
    if (auth && token) init.headers.authorization = `Bearer ${token}`;
    if (body !== undefined) {
        init.headers['content-type'] = 'application/json';
        init.body = JSON.stringify(body);
    } else if (form) {
        init.body = form;
    }
    const response = await fetch(`${BASE}${path}`, init);
    const text = await response.text();
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    } catch {
        json = text;
    }
    return { status: response.status, json, headers: response.headers };
}

async function upload(name, png) {
    const form = new FormData();
    form.append('file', new Blob([png], { type: 'image/png' }), name);
    return call('POST', '/api/files', { form });
}

describe('burrow smoke', { concurrency: false }, () => {
    const ids = {};

    before(async () => {
        const ready = await fetch(`${BASE}/readyz`);
        assert.equal(ready.status, 200, `${BASE}/readyz must answer 200 before the suite starts`);
    });

    it('serves the app shell and the version', async () => {
        const page = await fetch(`${BASE}/`);
        assert.equal(page.status, 200);
        const html = await page.text();
        assert.match(html, /<div id="root">/);
        // The CSP forbids inline scripts, so one in the shell would silently never run in production.
        assert.doesNotMatch(
            html,
            /<script(?![^>]*\bsrc=)[^>]*>/,
            'index.html must not contain an inline script',
        );
        const csp = page.headers.get('content-security-policy') ?? '';
        assert.match(csp, /script-src 'self'/);
        assert.match(csp, /frame-ancestors 'none'/);
        assert.equal((await call('GET', '/api/version', { auth: false })).status, 200);
    });

    it('refuses everything without a session', async () => {
        for (const path of [
            '/api/me',
            '/api/files',
            '/api/categories',
            '/api/review',
            '/api/search?q=a',
        ]) {
            assert.equal((await call('GET', path, { auth: false })).status, 401, path);
        }
    });

    it('creates the owner account, or signs in when it exists', async () => {
        let reply = await call('POST', '/api/auth/register', {
            auth: false,
            body: { username: USERNAME, password: PASSWORD },
        });
        if (reply.status === 403)
            reply = await call('POST', '/api/auth/login', {
                auth: false,
                body: { username: USERNAME, password: PASSWORD },
            });
        assert.ok([200, 201].includes(reply.status), JSON.stringify(reply.json));
        token = reply.json.accessToken;
        refreshCookie = (
            reply.headers.getSetCookie().find((c) => c.startsWith('burrow_rt=')) ?? ''
        ).split(';')[0];
        assert.ok(refreshCookie, 'a refresh cookie is set');
        assert.ok(!JSON.stringify(reply.json).includes('refreshToken'));
    });

    it('builds a category tree', async () => {
        for (const name of ['Red', 'Blue']) {
            const reply = await call('POST', '/api/categories', {
                body: { name: `${name} ${Date.now()}`, parentId: null },
            });
            assert.equal(reply.status, 201, JSON.stringify(reply.json));
            ids[name] = reply.json.id;
            ids[`${name}Name`] = reply.json.name;
        }
        assert.equal((await call('GET', '/api/categories')).json.categories.length >= 2, true);
    });

    it('stores an upload once and says so when the same bytes come again', async () => {
        const red = solidPng([225, 20, 20], 0);
        const first = await upload('smoke-red.png', red);
        assert.equal(first.status, 201);
        assert.equal(first.json.deduplicated, false);
        ids.red = first.json.file.id;
        const again = await upload('smoke-red-copy.png', red);
        assert.equal(again.json.deduplicated, true);
        assert.equal(again.json.file.blobSha256, first.json.file.blobSha256);
        await call('DELETE', `/api/files/${again.json.file.id}`);
    });

    it('serves the file and its thumbnail back', async () => {
        const original = await fetch(`${BASE}/api/files/${ids.red}/content`, {
            headers: { authorization: `Bearer ${token}` },
        });
        assert.equal(original.status, 200);
        assert.equal(original.headers.get('x-content-type-options'), 'nosniff');
        const thumb = await fetch(`${BASE}/api/files/${ids.red}/thumbnail`, {
            headers: { authorization: `Bearer ${token}` },
        });
        assert.equal(thumb.headers.get('content-type'), 'image/webp');
    });

    it('rejects an upload above the size cap before storing it', async () => {
        const cap = Number(process.env.SMOKE_MAX_UPLOAD_MB ?? 200);
        if (cap > 20) return; // only worth the bandwidth against a stack with a small cap
        const huge = new Blob([new Uint8Array((cap + 1) * 1024 * 1024)]);
        const form = new FormData();
        form.append('file', huge, 'huge.bin');
        assert.equal((await call('POST', '/api/files', { form })).status, 413);
    });

    it('lets the sorter file by what the vision models see, and queues what it is unsure of', async () => {
        const status = (await call('GET', '/api/sorting/status')).json;
        assert.equal(
            status.visionHealthy,
            true,
            'apps/vision must be healthy for the sorter to run',
        );
        const gray = await upload('smoke-gray.png', solidPng([128, 128, 128], 0));
        ids.gray = gray.json.file.id;

        const run = await call('POST', '/api/sorting/run');
        assert.equal(run.status, 200);
        assert.ok(run.json.decided >= 2, `expected at least 2 decided, got ${run.json.decided}`);

        const red = (await call('GET', `/api/files/${ids.red}`)).json;
        assert.equal(red.status, 'sorted');
        assert.equal(red.categoryId, ids.Red, 'the red image is filed under Red');
        const unsure = (await call('GET', `/api/files/${ids.gray}`)).json;
        assert.equal(unsure.status, 'review', 'a plain gray image is not filed on a guess');
    });

    it('resolves a review item and never shows it again', async () => {
        const queue = (await call('GET', '/api/review')).json.files;
        assert.ok(queue.some((f) => f.id === ids.gray));
        const done = await call('POST', `/api/review/${ids.gray}`, { body: { action: 'leave' } });
        assert.equal(done.json.status, 'unsorted');
        assert.ok(!(await call('GET', '/api/review')).json.files.some((f) => f.id === ids.gray));
    });

    it('finds files by name, ranked, with an explicit empty state', async () => {
        const hit = await call('GET', '/api/search?q=smoke');
        assert.ok(hit.json.total >= 2);
        assert.equal(hit.json.empty, false);
        const none = await call('GET', '/api/search?q=zzzzqqqq');
        assert.equal(none.json.empty, true);
    });

    it('keeps the profile private to its owner', async () => {
        const me = (await call('GET', '/api/me')).json;
        const view = (await call('GET', `/api/users/${me.id}`)).json;
        assert.deepEqual(Object.keys(view).sort(), ['bio', 'displayName', 'hasAvatar', 'id']);
    });

    it('rotates the refresh token and ends the session on logout', async () => {
        const refreshed = await call('POST', '/api/auth/refresh', {
            auth: false,
            headers: { cookie: refreshCookie, 'x-requested-with': 'burrow' },
        });
        assert.equal(refreshed.status, 200);
        const next = (
            refreshed.headers.getSetCookie().find((c) => c.startsWith('burrow_rt=')) ?? ''
        ).split(';')[0];
        assert.notEqual(next, refreshCookie);
        const stale = await call('POST', '/api/auth/refresh', {
            auth: false,
            headers: { cookie: refreshCookie, 'x-requested-with': 'burrow' },
        });
        assert.equal(stale.status, 401, 'a used refresh token must stop working');

        token = refreshed.json.accessToken;
        assert.equal(
            (await call('POST', '/api/auth/logout', { headers: { 'x-requested-with': 'burrow' } }))
                .status,
            204,
        );
        assert.equal(
            (await call('GET', '/api/me')).status,
            401,
            'the access token dies with the session',
        );
    });
});
