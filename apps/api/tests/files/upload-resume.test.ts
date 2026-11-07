import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, describe, it } from 'node:test';

import { config, validateConfig } from '../../src/config/index.ts';
import { api, base, closeServer, registerOwner, resetDatabase } from '../helpers.ts';

after(closeServer);

const PIECE = 1000;
let originalChunk = config.uploadChunkBytes;
beforeEach(async () => {
    originalChunk = config.uploadChunkBytes;
    config.uploadChunkBytes = PIECE;
    await resetDatabase();
});
afterEach(() => {
    config.uploadChunkBytes = originalChunk;
    config.uploadOrigin = '';
});

const piece = (token: string, id: string, index: number, bytes: number): Promise<Response> =>
    fetch(`${base}/api/uploads/${id}/chunks/${String(index)}`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
        body: new Uint8Array(bytes).fill(7),
    });

const start = (token: string, over: Record<string, unknown> = {}): ReturnType<typeof api> =>
    api('POST', '/api/uploads', {
        token,
        body: { name: 'big.bin', size: 3500, fingerprint: '3500:111', ...over },
    });

describe('resuming an interrupted upload', () => {
    it('returns the unfinished session and the pieces it already has, then completes with the rest', async () => {
        const owner = await registerOwner();
        const first = await start(owner.token);
        assert.equal(first.status, 201);
        assert.equal(first.json.chunks, 4);
        assert.deepEqual(first.json.received, []);
        assert.equal((await piece(owner.token, first.json.id, 0, PIECE)).status, 204);
        assert.equal((await piece(owner.token, first.json.id, 2, PIECE)).status, 204);

        const again = await start(owner.token);
        assert.equal(again.json.id, first.json.id, 'the same file continues the same session');
        assert.deepEqual(again.json.received, [0, 2]);

        assert.equal((await piece(owner.token, first.json.id, 1, PIECE)).status, 204);
        assert.equal((await piece(owner.token, first.json.id, 3, 500)).status, 204);
        const done = await api('POST', `/api/uploads/${String(first.json.id)}/complete`, {
            token: owner.token,
        });
        assert.equal(done.status, 201);
        assert.equal(done.json.file.size, 3500);
    });

    it('does not mix up different files, different folders or different accounts', async () => {
        const owner = await registerOwner();
        const folder = (
            await api('POST', '/api/categories', {
                token: owner.token,
                body: { name: 'F', parentId: null },
            })
        ).json.id as number;
        const a = await start(owner.token);
        await piece(owner.token, a.json.id, 0, PIECE);
        for (const over of [
            { fingerprint: '3500:222' },
            { name: 'other.bin' },
            { size: 3600 },
            { categoryId: folder },
        ]) {
            const other = await start(owner.token, over);
            assert.notEqual(other.json.id, a.json.id, JSON.stringify(over));
            assert.deepEqual(other.json.received, []);
        }
        // Without a fingerprint (an older page) nothing is matched either.
        const plain = await api('POST', '/api/uploads', {
            token: owner.token,
            body: { name: 'big.bin', size: 3500 },
        });
        assert.notEqual(plain.json.id, a.json.id);

        const second = await api('POST', '/api/auth/register', {
            body: { username: 'second', password: 'correct horse battery' },
        });
        assert.equal(second.status, 201);
        const theirs = await start(second.json.accessToken as string);
        assert.notEqual(theirs.json.id, a.json.id, 'another account never gets your session');
        assert.deepEqual(theirs.json.received, []);
    });
});

describe('the optional HTTP/1.1 upload origin', () => {
    it('is announced in /api/version only when configured', async () => {
        assert.equal((await api('GET', '/api/version')).json.uploadOrigin, undefined);
        config.uploadOrigin = 'https://up.example.org:8443';
        assert.equal(
            (await api('GET', '/api/version')).json.uploadOrigin,
            'https://up.example.org:8443',
        );
    });

    it('answers the preflight for a piece for an allowed origin only, and for no other route', async () => {
        const allowed = config.corsAllowedOrigins[0] as string;
        const preflight = (path: string, origin: string): Promise<Response> =>
            fetch(`${base}${path}`, {
                method: 'OPTIONS',
                headers: {
                    origin,
                    'access-control-request-method': 'PUT',
                    'access-control-request-headers': 'authorization,content-type',
                },
            });
        const id = '11111111-1111-1111-1111-111111111111';
        const ok = await preflight(`/api/uploads/${id}/chunks/3`, allowed);
        assert.equal(ok.status, 204);
        assert.equal(ok.headers.get('access-control-allow-origin'), allowed);
        assert.match(ok.headers.get('access-control-allow-headers') ?? '', /authorization/i);
        assert.equal(ok.headers.get('access-control-max-age'), '7200');

        const refused = await preflight(`/api/uploads/${id}/chunks/3`, 'https://evil.example');
        assert.equal(
            refused.headers.get('access-control-allow-origin'),
            null,
            'an unknown origin gets no permission',
        );

        const elsewhere = await preflight('/api/files', allowed);
        assert.notEqual(elsewhere.status, 204, 'only the piece route answers a preflight');
    });

    it('is refused at start-up when it is not a plain origin', () => {
        const check = (value: string): void => {
            config.uploadOrigin = value;
            validateConfig();
        };
        assert.doesNotThrow(() => check(''));
        assert.doesNotThrow(() => check('https://up.example.org:8443'));
        for (const bad of [
            'https://up.example.org/path',
            'ftp://up.example.org',
            'up.example.org',
            'https://',
        ]) {
            assert.throws(() => check(bad), /UPLOAD_ORIGIN/, bad);
        }
    });
});
