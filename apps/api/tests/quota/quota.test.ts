import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, afterEach, beforeEach, describe, it } from 'node:test';

import { config } from '../../src/config/index.ts';
import { getPool } from '../../src/database/connection.ts';
import { fileService } from '../../src/services/file-service.ts';
import { api, closeServer, png, registerOwner, resetDatabase, upload, zipOf } from '../helpers.ts';

after(closeServer);

const realQuota = config.quota.userBytes;
const realReserve = config.quota.diskReserveBytes;
afterEach(() => {
    config.quota.userBytes = realQuota;
    config.quota.diskReserveBytes = realReserve;
});

const setQuota = (id: string, bytes: number | null): Promise<unknown> =>
    getPool().query('UPDATE users SET quota_bytes = $2 WHERE id = $1', [id, bytes]);

describe('storage quota', () => {
    beforeEach(async () => {
        await resetDatabase();
        // These tests are about accounts; the disk guard has its own test and must not depend on this machine.
        config.quota.diskReserveBytes = 0;
    });

    it('reports what an account has used and its limit', async () => {
        const { token, id } = await registerOwner();
        const file = await png(1);
        await upload(token, 'a.png', file);
        await setQuota(id, 1_000_000);
        const reply = await api('GET', '/api/me/storage', { token });
        assert.equal(reply.status, 200);
        assert.deepEqual(reply.json, { used: file.size, quota: 1_000_000 });
        assert.equal((await api('GET', '/api/me/storage')).status, 401);
    });

    it('uses the server default when the account has no limit of its own, and no limit when it is 0', async () => {
        const { token, id } = await registerOwner();
        config.quota.userBytes = 5_000;
        assert.equal((await api('GET', '/api/me/storage', { token })).json.quota, 5_000);
        await setQuota(id, 0);
        assert.equal(
            (await api('GET', '/api/me/storage', { token })).json.quota,
            null,
            '0 means unlimited',
        );
        await setQuota(id, null);
        config.quota.userBytes = 0;
        assert.equal(
            (await api('GET', '/api/me/storage', { token })).json.quota,
            null,
            'default 0 also',
        );
    });

    it('refuses an upload that would not fit, with a message that says so, and takes one that does', async () => {
        const { token, id } = await registerOwner();
        const first = await png(2);
        // The check counts the whole request (file plus multipart framing, a few hundred bytes), so it is a little strict.
        await setQuota(id, first.size + 1000);
        assert.equal((await upload(token, 'one.png', first)).status, 201);
        const refused = await upload(token, 'two.bin', new Blob([Buffer.alloc(2000, 7)]));
        assert.equal(refused.status, 507);
        assert.match(refused.json.message, /Your storage is full/);
        assert.equal(refused.json.traceId, refused.headers.get('x-trace-id'));
        assert.equal(
            ((await api('GET', '/api/files?limit=10', { token })).json.files as unknown[]).length,
            1,
        );
    });

    it('refuses the start of a big upload before a single piece is sent', async () => {
        const { token, id } = await registerOwner();
        await setQuota(id, 1_000);
        const reply = await api('POST', '/api/uploads', {
            token,
            body: { name: 'big.bin', size: 5_000, mime: 'application/octet-stream' },
        });
        assert.equal(reply.status, 507);
        const ok = await api('POST', '/api/uploads', {
            token,
            body: { name: 'small.bin', size: 900, mime: 'application/octet-stream' },
        });
        assert.equal(ok.status, 201);
    });

    it("keeps one account from using another one's room", async () => {
        const first = await registerOwner();
        const other = (
            await api('POST', '/api/auth/register', {
                body: { username: 'other', password: 'correct horse battery' },
            })
        ).json;
        await setQuota(first.id, 10);
        assert.equal((await upload(first.token, 'a.png', await png(4))).status, 507);
        assert.equal(
            (await upload(other.accessToken as string, 'a.png', await png(4))).status,
            201,
        );
    });

    it('refuses every write when the disk would be left with less than its reserve', async () => {
        const { token } = await registerOwner();
        config.quota.diskReserveBytes = Number.MAX_SAFE_INTEGER;
        const refused = await upload(token, 'a.png', await png(5));
        assert.equal(refused.status, 507);
        assert.match(refused.json.message, /out of storage/);
        assert.equal(
            (
                await api('POST', '/api/uploads', {
                    token,
                    body: { name: 'x.bin', size: 10, mime: 'a/b' },
                })
            ).status,
            507,
        );
    });

    it('stops unpacking a zip at what the account has room for, and keeps what fitted', async () => {
        const { token, id } = await registerOwner();
        await setQuota(id, 100);
        const entries = [1, 2, 3].map((n) => ({
            name: `f${String(n)}.txt`,
            data: Buffer.alloc(60, String(n)),
        }));
        // Staged uploads always sit under the storage folder; anything outside it is refused.
        await mkdir(join(config.storage.dir, 'tmp'), { recursive: true });
        const dir = await mkdtemp(join(config.storage.dir, 'tmp', 'quota-zip-'));
        const path = join(dir, 'a.zip');
        await writeFile(path, Buffer.from(await zipOf(entries).arrayBuffer()));
        const result = await fileService.uploadArchive(id, path);
        assert.equal(result.extracted, 1, 'the first 60 bytes fit, the second would not');
        const used = (await api('GET', '/api/me/storage', { token })).json.used as number;
        assert.ok(used <= 100, `used ${String(used)} stays within the limit`);
    });
});
