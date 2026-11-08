import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';

import { config } from '../../src/config/index.ts';
import { getPool } from '../../src/database/connection.ts';
import { blobStore, isCache, localBlobPath } from '../../src/lib/blob-store.ts';
import { blobCacheRepository } from '../../src/repository/blob-cache.repository.ts';
import { closeServer, resetDatabase } from '../helpers.ts';
import { FakeS3 } from './fake-s3.ts';

after(closeServer);

const s3 = new FakeS3();
before(async () => {
    const endpoint = await s3.start();
    Object.assign(config.storage.s3, {
        endpoint,
        bucket: 'burrow-test',
        accessKeyId: 'key',
        secretAccessKey: 'secret',
        region: 'us-east-1',
    });
});
after(() => s3.stop());

const realMax = config.storage.cacheMaxBytes;
const realPart = config.storage.s3.partBytes;
afterEach(() => {
    config.storage.cacheMaxBytes = realMax;
    config.storage.s3.partBytes = realPart;
    s3.delayGetMs = 0;
});
beforeEach(async () => {
    await resetDatabase();
    s3.objects.clear();
    s3.calls.length = 0;
    s3.gets = 0;
    // A cache with plenty of room: the blobs are tracked, nothing is evicted unless a test lowers the limit.
    config.storage.cacheMaxBytes = 100 * 1024 * 1024 * 1024;
});

const sha = (data: Buffer): string => createHash('sha256').update(data).digest('hex');

/** Stores one blob the way the upload path does: a row in `blobs`, then the staged file handed to the store. */
async function store(data: Buffer): Promise<string> {
    const hash = sha(data);
    await getPool().query(
        'INSERT INTO blobs (sha256, size, mime) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [hash, data.length, 'application/octet-stream'],
    );
    const staged = join(config.storage.dir, 'tmp', `staged-${hash.slice(0, 8)}`);
    await mkdir(dirname(staged), { recursive: true });
    await writeFile(staged, data);
    await blobStore.put(hash, staged, 'application/octet-stream');
    return hash;
}

const onDisk = (hash: string): Promise<boolean> =>
    stat(localBlobPath(hash)).then(
        () => true,
        () => false,
    );

async function read(hash: string): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of await blobStore.open(hash)) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
}

const bytes = (n: number, fill: number): Buffer => Buffer.alloc(n, fill);

describe('the object store as the store of record', () => {
    it('has the bucket hold a blob before an upload counts as stored, and notes it in the cache table', async () => {
        const data = bytes(1500, 1);
        const hash = await store(data);
        assert.deepEqual(
            s3.objects.get(`blobs/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}`),
            data,
        );
        assert.equal(await onDisk(hash), true);
        assert.equal(await blobCacheRepository.totalBytes(), 1500);
    });

    it('does not upload a blob the bucket already has', async () => {
        const data = bytes(900, 2);
        await store(data);
        const puts = s3.calls.filter((c) => c.startsWith('PUT')).length;
        await store(data);
        assert.equal(s3.calls.filter((c) => c.startsWith('PUT')).length, puts);
    });

    it('sends a big blob in parts and gets the same bytes back', async () => {
        config.storage.s3.partBytes = 5 * 1024 * 1024;
        const data = Buffer.alloc(11 * 1024 * 1024);
        for (let i = 0; i < data.length; i += 4099) data[i] = i % 251;
        const hash = await store(data);
        assert.ok(
            s3.calls.some((c) => c.includes('uploads')),
            'a multipart upload was started',
        );
        assert.ok(
            s3.calls.filter((c) => c.includes('partNumber')).length >= 3,
            'in at least three parts',
        );
        assert.equal(
            sha(s3.objects.get(`blobs/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}`) as Buffer),
            hash,
        );
    });

    it('fetches a blob that is not on the disk, streams it to the reader and keeps it in the cache', async () => {
        const data = bytes(50_000, 3);
        const hash = await store(data);
        const { rm } = await import('node:fs/promises');
        await rm(localBlobPath(hash));
        await blobCacheRepository.forget(hash);
        assert.equal(await onDisk(hash), false);

        assert.deepEqual(await read(hash), data);
        // The cache file appears once the stream has been read to the end.
        for (let i = 0; i < 40 && !(await onDisk(hash)); i++)
            await new Promise((r) => setTimeout(r, 25));
        assert.equal(await onDisk(hash), true);
        assert.equal(await blobCacheRepository.totalBytes(), 50_000);
        assert.deepEqual(await read(hash), data, 'the second read comes from the disk');
        assert.equal(s3.gets, 1);
    });

    it('leaves no half-written file when the reader goes away part-way', async () => {
        const data = bytes(2_000_000, 4);
        const hash = await store(data);
        const { rm } = await import('node:fs/promises');
        await rm(localBlobPath(hash));
        const stream = await blobStore.open(hash);
        await new Promise<void>((resolve) => stream.once('data', () => resolve()));
        stream.destroy();
        await new Promise((r) => setTimeout(r, 300));
        assert.equal(await onDisk(hash), false, 'an incomplete blob is never left in the cache');
        const leftovers = (await readdir(dirname(localBlobPath(hash)))).filter((f) =>
            f.endsWith('.part'),
        );
        assert.deepEqual(leftovers, []);
        // And the next reader is not stuck behind the one that left.
        assert.deepEqual(await read(hash), data);
    });

    it('gives every one of several simultaneous readers the whole blob and writes the cache file once', async () => {
        const data = bytes(300_000, 5);
        const hash = await store(data);
        const { rm } = await import('node:fs/promises');
        await rm(localBlobPath(hash));
        s3.delayGetMs = 50;
        const all = await Promise.all([read(hash), read(hash), read(hash)]);
        for (const got of all) assert.deepEqual(got, data);
        for (let i = 0; i < 40 && !(await onDisk(hash)); i++)
            await new Promise((r) => setTimeout(r, 25));
        assert.deepEqual(await readFileOf(hash), data);
    });

    it('downloads a blob once for several callers that need a file on disk', async () => {
        const data = bytes(80_000, 6);
        const hash = await store(data);
        const { rm } = await import('node:fs/promises');
        await rm(localBlobPath(hash));
        s3.delayGetMs = 50;
        const paths = await Promise.all([
            blobStore.ensureLocal(hash),
            blobStore.ensureLocal(hash),
            blobStore.ensureLocal(hash),
        ]);
        assert.equal(new Set(paths).size, 1);
        assert.equal(s3.gets, 1, 'one download for three callers');
        assert.deepEqual(await readFileOf(hash), data);
    });

    it('says a blob is missing when no tier has it', async () => {
        await assert.rejects(() => blobStore.open('a'.repeat(64)), /Blob not found/);
        await assert.rejects(() => blobStore.ensureLocal('b'.repeat(64)), /Blob not found/);
        await assert.rejects(() => blobStore.open('../../etc/passwd'), /Invalid blob hash/);
    });

    it('removes a blob from the disk, the bucket and the cache table', async () => {
        const hash = await store(bytes(700, 7));
        await blobStore.remove(hash);
        assert.equal(await onDisk(hash), false);
        assert.equal(s3.objects.size, 0);
        assert.equal(await blobCacheRepository.totalBytes(), 0);
    });
});

describe('the local disk as a cache', () => {
    it('is a cache only when a limit is set', () => {
        config.storage.cacheMaxBytes = 0;
        assert.equal(isCache(), false);
        config.storage.cacheMaxBytes = 1000;
        assert.equal(isCache(), true);
    });

    it('removes the least recently used blobs once the cache is over its limit, and fetches them back on use', async () => {
        config.storage.cacheMaxBytes = 1000;
        const a = await store(bytes(400, 11));
        const b = await store(bytes(400, 12));
        const c = await store(bytes(400, 13));
        // a was used longest ago, then b, then c; reading a makes it the newest.
        await getPool().query(
            "UPDATE blob_cache SET last_access = now() - interval '3 hours' WHERE sha256 = $1",
            [a],
        );
        await getPool().query(
            "UPDATE blob_cache SET last_access = now() - interval '2 hours' WHERE sha256 = $1",
            [b],
        );
        await getPool().query(
            "UPDATE blob_cache SET last_access = now() - interval '1 hour' WHERE sha256 = $1",
            [c],
        );

        const freed = await blobStore.sweep(Number.MAX_SAFE_INTEGER, 0);
        assert.equal(freed, 400, 'down to 90% of the limit, which takes the oldest one');
        assert.equal(await onDisk(a), false);
        assert.equal(await onDisk(b), true);
        assert.equal(await onDisk(c), true);
        assert.equal(await blobCacheRepository.totalBytes(), 800);
        assert.deepEqual(
            await read(a),
            bytes(400, 11),
            'an evicted blob comes back from the bucket',
        );
    });

    it('does nothing while the cache is within its limit', async () => {
        config.storage.cacheMaxBytes = 10_000;
        await store(bytes(400, 14));
        assert.equal(await blobStore.sweep(Number.MAX_SAFE_INTEGER, 0), 0);
    });

    it('never removes the only copy of a blob', async () => {
        config.storage.cacheMaxBytes = 100;
        const only = await store(bytes(400, 15));
        s3.objects.clear();
        assert.equal(await blobStore.sweep(Number.MAX_SAFE_INTEGER, 0), 0);
        assert.equal(
            await onDisk(only),
            true,
            'the bucket does not hold it, so the disk copy stays',
        );
    });

    it('frees disk when the disk is nearly full even though the cache is under its limit', async () => {
        config.storage.cacheMaxBytes = 10 * 1024 * 1024;
        const a = await store(bytes(5_000, 16));
        await store(bytes(5_000, 17));
        const freed = await blobStore.sweep(1_000, 4_000);
        assert.ok(freed >= 5_000, 'at least one blob was dropped to give the disk room');
        assert.equal(await onDisk(a), false);
    });

    it('does nothing at all without a cache limit, so a local-only or second-copy setup keeps every blob', async () => {
        config.storage.cacheMaxBytes = 0;
        await store(bytes(400, 18));
        assert.equal(await blobStore.sweep(0, 1_000_000), 0);
    });
});

describe('copying blobs that were stored before the bucket existed', () => {
    it('uploads them, registers them in the cache table, and leaves the second run nothing to do', async () => {
        const data = [bytes(300, 21), bytes(300, 22)];
        const hashes: string[] = [];
        for (const d of data) {
            const hash = sha(d);
            hashes.push(hash);
            await getPool().query('INSERT INTO blobs (sha256, size, mime) VALUES ($1, $2, $3)', [
                hash,
                d.length,
                'x/y',
            ]);
            await mkdir(dirname(localBlobPath(hash)), { recursive: true });
            await writeFile(localBlobPath(hash), d);
        }
        assert.equal(s3.objects.size, 0);
        assert.equal(await blobStore.backfill(1), 2);
        assert.equal(s3.objects.size, 2);
        assert.equal(await blobCacheRepository.totalBytes(), 600);
        assert.equal(await blobStore.backfill(), 0, 'nothing is left to copy');
    });
});

async function readFileOf(hash: string): Promise<Buffer> {
    const { readFile } = await import('node:fs/promises');
    return readFile(localBlobPath(hash));
}

describe('encrypting what goes into the bucket', () => {
    const key = Buffer.alloc(32, 7);
    const bucketObject = (hash: string): Buffer | undefined =>
        s3.objects.get(`blobs/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}`);
    let plainKey: Buffer | undefined;
    beforeEach(() => {
        plainKey = config.storage.encryptionKey;
        config.storage.encryptionKey = key;
    });
    afterEach(() => {
        config.storage.encryptionKey = plainKey;
    });

    it('stores nothing readable in the bucket and reads the file back unchanged', async () => {
        const secret = Buffer.from(
            'a private picture, definitely not for the provider '.repeat(100),
        );
        const hash = await store(secret);
        const stored = bucketObject(hash) as Buffer;
        assert.equal(stored.subarray(0, 8).toString(), 'BURROWv1');
        assert.ok(
            !stored.includes('private picture'),
            'the plain text is not in the stored object',
        );
        assert.equal(stored.length, secret.length + 8 + 12 + 16, 'magic, IV, ciphertext, tag');
        const { rm } = await import('node:fs/promises');
        await rm(localBlobPath(hash));
        assert.deepEqual(await read(hash), secret);
    });

    it('uses a new IV for every object, so the same bytes never look the same twice', async () => {
        const a = await store(bytes(500, 31));
        s3.objects.delete(`blobs/${a.slice(0, 2)}/${a.slice(2, 4)}/${a}`);
        const { rm } = await import('node:fs/promises');
        await rm(localBlobPath(a));
        const first = Buffer.from(bucketObject(a) ?? Buffer.alloc(0));
        const again = await store(bytes(500, 31));
        assert.equal(again, a);
        assert.notDeepEqual(bucketObject(a)?.subarray(8, 20), first.subarray(8, 20));
    });

    it('refuses an object that was changed in the bucket, and caches nothing of it', async () => {
        const hash = await store(bytes(40_000, 32));
        const stored = bucketObject(hash) as Buffer;
        stored[100] = (stored[100] ?? 0) ^ 0xff;
        const { rm } = await import('node:fs/promises');
        await rm(localBlobPath(hash));
        await assert.rejects(() => read(hash), /integrity/);
        await new Promise((r) => setTimeout(r, 200));
        assert.equal(await onDisk(hash), false);
    });

    it('refuses an object read with the wrong key', async () => {
        const hash = await store(bytes(5_000, 33));
        const { rm } = await import('node:fs/promises');
        await rm(localBlobPath(hash));
        config.storage.encryptionKey = Buffer.alloc(32, 9);
        await assert.rejects(() => read(hash), /integrity/);
    });

    it('still reads an object stored plain before encryption was switched on', async () => {
        config.storage.encryptionKey = undefined;
        const data = bytes(3_000, 34);
        const hash = await store(data);
        const { rm } = await import('node:fs/promises');
        await rm(localBlobPath(hash));
        config.storage.encryptionKey = key;
        assert.deepEqual(await read(hash), data);
    });

    it('encrypts a big blob in parts and reads it back', async () => {
        config.storage.s3.partBytes = 5 * 1024 * 1024;
        const data = Buffer.alloc(12 * 1024 * 1024);
        for (let i = 0; i < data.length; i += 4093) data[i] = i % 247;
        const hash = await store(data);
        assert.ok(
            s3.calls.some((c) => c.includes('uploads')),
            'sent in parts',
        );
        const { rm } = await import('node:fs/promises');
        await rm(localBlobPath(hash));
        const got = await read(hash);
        assert.equal(got.length, data.length);
        assert.equal(sha(got), hash);
    });

    it('rejects a key that is not 32 bytes', async () => {
        const { parseKey } = await import('../../src/lib/blob-crypto.ts');
        assert.throws(() => parseKey(Buffer.alloc(16).toString('base64')), /32 bytes/);
        assert.equal(parseKey(Buffer.alloc(32, 1).toString('base64')).length, 32);
    });
});
