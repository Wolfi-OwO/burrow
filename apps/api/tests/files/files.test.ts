import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';

import {
    api,
    base,
    closeServer,
    png,
    registerOwner,
    resetDatabase,
    upload,
    zipOf,
} from '../helpers.ts';

describe('files', () => {
    beforeEach(resetDatabase);
    after(closeServer);

    it('uploads a file and reports the content as new (FR-016)', async () => {
        const { token } = await registerOwner();
        const reply = await upload(token, 'wolf.png', await png(1));
        assert.equal(reply.status, 201);
        assert.equal(reply.json.deduplicated, false);
        assert.equal(reply.json.file.name, 'wolf.png');
        assert.equal(reply.json.file.mime, 'image/png');
        assert.equal(reply.json.file.status, 'unsorted');
    });

    it('unpacks a .zip in the background, reporting progress on the event stream', async () => {
        const { token } = await registerOwner();
        const a = Buffer.from(await (await png(5)).arrayBuffer());
        const b = Buffer.from(await (await png(6)).arrayBuffer());
        const zip = zipOf([
            { name: 'trip/', data: Buffer.alloc(0) },
            { name: 'trip/a.png', data: a },
            { name: 'trip/deep/b.png', data: b },
            { name: 'trip/.hidden', data: a },
            { name: '__MACOSX/trip/._a.png', data: a },
        ]);
        const folder = (
            await api('POST', '/api/categories', { token, body: { name: 'Trips', parentId: null } })
        ).json.id as number;
        const stream = await fetch(`${base}/api/events`, {
            headers: { authorization: `Bearer ${token}` },
        });
        assert.ok(stream.headers.get('content-type')?.startsWith('text/event-stream'));
        const reader = (stream.body as ReadableStream<Uint8Array>).getReader();

        const form = new FormData();
        form.append('categoryId', String(folder));
        form.append('file', zip, 'photos.zip');
        const reply = await api('POST', '/api/files', { token, form });
        assert.equal(reply.status, 202);
        assert.ok(reply.json.job);

        let seen = '';
        const decoder = new TextDecoder();
        while (!seen.includes('event: upload.done')) {
            const chunk = await reader.read();
            if (chunk.done) break;
            seen += decoder.decode(chunk.value);
        }
        await reader.cancel();
        assert.ok(seen.includes('event: upload.progress'), 'progress arrives before the end');
        const done = /event: upload.done\ndata: (.*)\n/.exec(seen);
        const data = JSON.parse(done?.[1] ?? '{}') as { extracted: number; skipped: number };
        assert.equal(data.extracted, 2);
        assert.equal(data.skipped, 3);
        const listed = await api('GET', '/api/files?limit=50', { token });
        assert.deepEqual(listed.json.files.map((f: { name: string }) => f.name).sort(), [
            'a.png',
            'b.png',
        ]);
    });

    it('takes a big file in pieces, in any order and in parallel, and stores it whole', async () => {
        const { config } = await import('../../src/config/index.ts');
        const before = config.uploadChunkBytes;
        config.uploadChunkBytes = 16;
        try {
            const { token } = await registerOwner();
            const bytes = Buffer.from(await (await png(90)).arrayBuffer());
            const start = await api('POST', '/api/uploads', {
                token,
                body: { name: 'big.png', size: bytes.length, mime: 'image/png' },
            });
            assert.equal(start.status, 201);
            const { id, chunks, chunkBytes } = start.json as {
                id: string;
                chunks: number;
                chunkBytes: number;
            };
            assert.ok(chunks > 1, 'the test file spans several pieces');
            const send = (i: number): Promise<Response> =>
                fetch(`${base}/api/uploads/${id}/chunks/${String(i)}`, {
                    method: 'PUT',
                    headers: {
                        authorization: `Bearer ${token}`,
                        'content-type': 'application/octet-stream',
                    },
                    body: new Uint8Array(bytes.subarray(i * chunkBytes, (i + 1) * chunkBytes)),
                });
            const order = [...Array(chunks).keys()].reverse();
            // Not finished yet: refused, and the status says what is missing.
            assert.equal((await api('POST', `/api/uploads/${id}/complete`, { token })).status, 400);
            const replies = await Promise.all(order.map(send));
            assert.ok(replies.every((r) => r.status === 204));
            const status = await api('GET', `/api/uploads/${id}`, { token });
            assert.equal(status.json.received.length, chunks);
            const done = await api('POST', `/api/uploads/${id}/complete`, { token });
            assert.equal(done.status, 201);
            assert.equal(done.json.file.size, bytes.length);
            const served = await fetch(`${base}/api/files/${done.json.file.id as string}/content`, {
                headers: { authorization: `Bearer ${token}` },
            });
            assert.deepEqual(Buffer.from(await served.arrayBuffer()), bytes);
        } finally {
            config.uploadChunkBytes = before;
        }
    });

    it("refuses a piece of the wrong length and a stranger's upload", async () => {
        const { token } = await registerOwner();
        const start = await api('POST', '/api/uploads', {
            token,
            body: { name: 'x.bin', size: 50 },
        });
        const id = start.json.id as string;
        const short = await fetch(`${base}/api/uploads/${id}/chunks/0`, {
            method: 'PUT',
            headers: { authorization: `Bearer ${token}` },
            body: new Uint8Array(10),
        });
        assert.equal(short.status, 400);
        const { config } = await import('../../src/config/index.ts');
        config.registrationOpen = true;
        const other = await registerOwner('other');
        config.registrationOpen = false;
        assert.equal((await api('GET', `/api/uploads/${id}`, { token: other.token })).status, 403);
    });

    it('unpacks zips inside zips and keeps no archive behind', async () => {
        const { token } = await registerOwner();
        const a = Buffer.from(await (await png(11)).arrayBuffer());
        const b = Buffer.from(await (await png(12)).arrayBuffer());
        const inner = Buffer.from(await zipOf([{ name: 'deep/b.png', data: b }]).arrayBuffer());
        const outer = zipOf([
            { name: 'a.png', data: a },
            { name: 'more.zip', data: inner },
        ]);
        const stream = await fetch(`${base}/api/events`, {
            headers: { authorization: `Bearer ${token}` },
        });
        const reader = (stream.body as ReadableStream<Uint8Array>).getReader();
        assert.equal((await upload(token, 'outer.zip', outer)).status, 202);
        let seen = '';
        const decoder = new TextDecoder();
        while (!seen.includes('event: upload.done')) {
            const chunk = await reader.read();
            if (chunk.done) break;
            seen += decoder.decode(chunk.value);
        }
        await reader.cancel();
        const names = (await api('GET', '/api/files?limit=50', { token })).json.files.map(
            (f: { name: string }) => f.name,
        );
        assert.deepEqual(names.sort(), ['a.png', 'b.png']);
    });

    it('filters the drive by kind of file and counts each kind', async () => {
        const { token } = await registerOwner();
        await upload(token, 'p.png', await png(20));
        await upload(token, 'notes.txt', new Blob(['hello'], { type: 'text/plain' }));
        await upload(token, 'sheet.xlsx', new Blob(['x'], { type: 'application/octet-stream' }));
        await upload(token, 'main.py', new Blob(['print(1)'], { type: 'text/x-python' }));
        await upload(token, 'ride.gpx', new Blob(['<gpx/>'], { type: 'application/gpx+xml' }));
        await upload(token, 'weird.bin', new Blob(['x'], { type: 'application/octet-stream' }));
        const names = async (type: string): Promise<string[]> => {
            const reply = await api('GET', `/api/files?type=${type}&limit=50`, { token });
            return (reply.json.files as { name: string }[]).map((f) => f.name);
        };
        assert.deepEqual(await names('image'), ['p.png']);
        assert.deepEqual(await names('document'), ['notes.txt']);
        assert.deepEqual(await names('spreadsheet'), ['sheet.xlsx']);
        assert.deepEqual(await names('code'), ['main.py']);
        assert.deepEqual(await names('route'), ['ride.gpx']);
        assert.deepEqual(await names('other'), ['weird.bin']);
        const counts = (await api('GET', '/api/files/types', { token })).json.counts;
        assert.equal(counts.all, 6);
        assert.equal(counts.route, 1);
        assert.equal(counts.image, 1);
        assert.equal(counts.other, 1);
    });

    it('unzips a stored zip in place and removes the zip', async () => {
        const { token } = await registerOwner();
        const cat = (
            await api('POST', '/api/categories', { token, body: { name: 'Box', parentId: null } })
        ).json.id as number;
        const a = Buffer.from(await (await png(31)).arrayBuffer());
        const stored = (await upload(token, 'stored.zip.keep', zipOf([{ name: 'x.png', data: a }])))
            .json.file.id as string;
        // A real zip name is unpacked on upload, so store it under another name first, then rename it.
        await api('PATCH', `/api/files/${stored}`, {
            token,
            body: { name: 'stored.zip', categoryId: cat },
        });
        const stream = await fetch(`${base}/api/events`, {
            headers: { authorization: `Bearer ${token}` },
        });
        const reader = (stream.body as ReadableStream<Uint8Array>).getReader();
        const reply = await api('POST', '/api/files/unzip', { token, body: {} });
        assert.equal(reply.status, 202);
        assert.equal(reply.json.count, 1);
        let seen = '';
        const decoder = new TextDecoder();
        while (!seen.includes('event: upload.done')) {
            const chunk = await reader.read();
            if (chunk.done) break;
            seen += decoder.decode(chunk.value);
        }
        await reader.cancel();
        const files = (await api('GET', '/api/files?limit=50', { token })).json.files as {
            name: string;
            categoryId: number;
        }[];
        assert.deepEqual(
            files.map((f) => f.name),
            ['x.png'],
        );
        assert.equal(files[0]?.categoryId, cat, "the contents stay in the zip's folder");
        assert.equal(
            (await api('GET', `/api/files/${stored}`, { token })).status,
            404,
            'the zip is gone',
        );
    });

    it('stores byte-identical content once, under a new name, and says so (FR-016)', async () => {
        const { token } = await registerOwner();
        const content = await png(3);
        const first = await upload(token, 'one.png', content);
        const second = await upload(token, 'two.png', content);
        assert.equal(second.json.deduplicated, true);
        assert.notEqual(first.json.file.id, second.json.file.id);
        assert.equal(first.json.file.blobSha256, second.json.file.blobSha256);
        const { getPool } = await import('../../src/database/connection.ts');
        assert.equal((await getPool().query('SELECT count(*)::int AS n FROM blobs')).rows[0]?.n, 1);
    });

    it('lays the blob out as blobs/<aa>/<bb>/<sha> (ADR-0002)', async () => {
        const { token } = await registerOwner();
        const { file } = (await upload(token, 'a.png', await png(4))).json;
        const { localBlobPath, blobKey } = await import('../../src/lib/blob-store.ts');
        const sha = file.blobSha256 as string;
        assert.equal(blobKey(sha), `blobs/${sha.slice(0, 2)}/${sha.slice(2, 4)}/${sha}`);
        const { stat } = await import('node:fs/promises');
        assert.ok((await stat(localBlobPath(sha))).size > 0);
    });

    it('rejects an upload above the size cap with 413 before storing anything (FR-017)', async () => {
        const { token } = await registerOwner();
        const big = new Blob([new Uint8Array(2 * 1024 * 1024)], {
            type: 'application/octet-stream',
        });
        const reply = await upload(token, 'big.bin', big);
        assert.equal(reply.status, 413);
        const { getPool } = await import('../../src/database/connection.ts');
        assert.equal((await getPool().query('SELECT count(*)::int AS n FROM files')).rows[0]?.n, 0);
        assert.equal((await getPool().query('SELECT count(*)::int AS n FROM blobs')).rows[0]?.n, 0);
    });

    it('serves the content back byte for byte, with headers that stop the browser from running it', async () => {
        const { token } = await registerOwner();
        const content = await png(5);
        const { file } = (await upload(token, 'wolf.png', content)).json;
        const response = await fetch(
            `${(await import('../helpers.ts')).base}/api/files/${file.id as string}/content`,
            { headers: { authorization: `Bearer ${token}` } },
        );
        assert.equal(response.status, 200);
        assert.deepEqual(
            new Uint8Array(await response.arrayBuffer()),
            new Uint8Array(await content.arrayBuffer()),
        );
        assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
        assert.match(response.headers.get('content-security-policy') ?? '', /sandbox/);
    });

    it('renders a thumbnail for images and 404s for other files', async () => {
        const { token } = await registerOwner();
        const img = (await upload(token, 'a.png', await png(6))).json.file;
        const txt = (await upload(token, 'a.txt', new Blob(['hello'], { type: 'text/plain' }))).json
            .file;
        const { base } = await import('../helpers.ts');
        const thumb = await fetch(`${base}/api/files/${img.id as string}/thumbnail`, {
            headers: { authorization: `Bearer ${token}` },
        });
        assert.equal(thumb.status, 200);
        assert.equal(thumb.headers.get('content-type'), 'image/webp');
        assert.equal(
            (await api('GET', `/api/files/${txt.id as string}/thumbnail`, { token })).status,
            404,
        );
    });

    it("another user's file is a 404, never a 403 or a leak", async () => {
        const { token } = await registerOwner();
        const { file } = (await upload(token, 'secret.png', await png(7))).json;
        const { getPool } = await import('../../src/database/connection.ts');
        const { hashRefreshToken } = await import('../../src/repository/session.repository.ts');
        const user = await getPool().query(
            `INSERT INTO users (username, display_name) VALUES ('intruder', 'I') RETURNING id`,
        );
        const session = await getPool().query(
            `INSERT INTO sessions (user_id, refresh_hash, expires_at) VALUES ($1, $2, now() + interval '1 day') RETURNING id`,
            [user.rows[0]?.id, hashRefreshToken('x')],
        );
        const { signAccessToken } = await import('../../src/lib/jwt.ts');
        const intruder = signAccessToken({
            sub: user.rows[0]?.id as string,
            sid: session.rows[0]?.id as string,
            role: 'user',
        });
        assert.equal(
            (await api('GET', `/api/files/${file.id as string}`, { token: intruder })).status,
            404,
        );
        assert.equal(
            (await api('GET', `/api/files/${file.id as string}/content`, { token: intruder }))
                .status,
            404,
        );
        assert.equal(
            (await api('DELETE', `/api/files/${file.id as string}`, { token: intruder })).status,
            404,
        );
        assert.equal((await api('GET', '/api/files', { token: intruder })).json.files.length, 0);
    });

    it('searches by name ranked by relevance, with the tree position, and says so when nothing matches (FR-020 to FR-022)', async () => {
        const { token } = await registerOwner();
        const cat = (
            await api('POST', '/api/categories', {
                token,
                body: { name: 'Nature', parentId: null },
            })
        ).json.id as number;
        const a = (await upload(token, 'wolf wolf wolf in snow.png', await png(8))).json.file;
        await upload(token, 'one wolf.png', await png(9));
        await upload(token, 'unrelated.png', await png(10));
        await api('PATCH', `/api/files/${a.id as string}`, { token, body: { categoryId: cat } });

        const hit = await api('GET', '/api/search?q=wolf', { token });
        assert.equal(hit.json.total, 2);
        assert.equal(hit.json.empty, false);
        assert.equal(hit.json.files[0].id, a.id);
        assert.ok(hit.json.files[0].rank >= hit.json.files[1].rank);
        assert.deepEqual(hit.json.files[0].categoryPath, ['Nature']);

        const none = await api('GET', '/api/search?q=zebra', { token });
        assert.equal(none.json.empty, true);
        assert.equal(none.json.total, 0);
        assert.equal((await api('GET', '/api/search?q=%22unclosed%20-', { token })).status, 200);
    });

    it('deletes the blob only once the last file using it is gone', async () => {
        const { token } = await registerOwner();
        const content = await png(11);
        const one = (await upload(token, 'one.png', content)).json.file;
        const two = (await upload(token, 'two.png', content)).json.file;
        const { getPool } = await import('../../src/database/connection.ts');
        await api('DELETE', `/api/files/${one.id as string}`, { token });
        assert.equal((await getPool().query('SELECT count(*)::int AS n FROM blobs')).rows[0]?.n, 1);
        await api('DELETE', `/api/files/${two.id as string}`, { token });
        assert.equal((await getPool().query('SELECT count(*)::int AS n FROM blobs')).rows[0]?.n, 0);
    });

    it('keeps UTF-8 file names intact and strips path parts', async () => {
        const { token } = await registerOwner();
        const reply = await upload(token, '../../etc/Café-🐺.png', await png(12));
        assert.equal(reply.json.file.name, 'Café-🐺.png');
    });
});
