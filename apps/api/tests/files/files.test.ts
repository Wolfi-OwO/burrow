import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';

import { api, closeServer, png, registerOwner, resetDatabase, upload } from '../helpers.ts';

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
