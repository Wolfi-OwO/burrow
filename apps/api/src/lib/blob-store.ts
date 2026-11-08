import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, rename, rm, stat, utimes } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Readable } from 'node:stream';
import { PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import {
    DeleteObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

import { config } from '../config/index.ts';
import { blobCacheRepository } from '../repository/blob-cache.repository.ts';
import { logger } from './logger.ts';

/**
 * Content-addressed blob storage, laid out as `blobs/<aa>/<bb>/<sha256>` (ADR-0002).
 *
 * Two shapes, chosen by configuration:
 *  - Local only (no S3_*): the directory is the store of record and the nightly backup is the second copy.
 *  - With an S3-compatible store (S3_*): every blob is written there before an upload counts as stored, so the bucket
 *    is the store of record. With `BLOB_CACHE_GB` set the local directory is only a cache of the recently used blobs:
 *    cold ones are removed from the disk (after the bucket is confirmed to hold them) and fetched back on use. Without
 *    it the whole local copy is kept and the bucket is a second copy.
 */
const SHA256_HEX = /^[0-9a-f]{64}$/;

let s3: S3Client | undefined;

function remote(): { client: S3Client; bucket: string } | null {
    const { endpoint, bucket, accessKeyId, secretAccessKey, region } = config.storage.s3;
    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
    s3 ??= new S3Client({
        endpoint,
        region,
        credentials: { accessKeyId, secretAccessKey },
        // Path-style addressing works on every S3-compatible store, including a bare IP address in development.
        forcePathStyle: true,
        // The SDK's newer default adds checksum trailers that Backblaze B2 and MinIO reject or mishandle; send them
        // only where the API requires one.
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
        maxAttempts: 5,
    });
    return { client: s3, bucket };
}

/** True when an S3-compatible store is configured. */
export function hasRemoteStore(): boolean {
    return remote() !== null;
}

/** True when the local directory is a bounded cache in front of the S3 store. */
export function isCache(): boolean {
    return hasRemoteStore() && config.storage.cacheMaxBytes > 0;
}

/**
 * @param sha256 - A content hash.
 * @returns The object key, `blobs/<aa>/<bb>/<sha>`, used on both tiers.
 * @throws {Error} If the value is not 64 hex characters, which keeps a path traversal out of the cache.
 */
export function blobKey(sha256: string): string {
    if (!SHA256_HEX.test(sha256)) throw new Error('Invalid blob hash.');
    return `blobs/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`;
}

/** @returns Where the blob lives (or would live) in the local cache. */
export function localBlobPath(sha256: string): string {
    return join(config.storage.dir, blobKey(sha256));
}

async function existsLocal(sha256: string): Promise<boolean> {
    try {
        await stat(localBlobPath(sha256));
        return true;
    } catch {
        return false;
    }
}

async function existsRemote(sha256: string): Promise<boolean> {
    const r = remote();
    if (!r) return false;
    try {
        await r.client.send(new HeadObjectCommand({ Bucket: r.bucket, Key: blobKey(sha256) }));
        return true;
    } catch (error) {
        const name = (error as { name?: string }).name;
        if (name === 'NotFound' || name === 'NoSuchKey') return false;
        throw error;
    }
}

async function uploadRemote(sha256: string, path: string, mime: string): Promise<void> {
    const r = remote();
    if (!r) return;
    const { size } = await stat(path);
    // Upload splits big files into parts (each retried on its own) and sends a small one in a single request.
    await new Upload({
        client: r.client,
        params: {
            Bucket: r.bucket,
            Key: blobKey(sha256),
            Body: createReadStream(path),
            ContentType: mime,
        },
        partSize: Math.max(config.storage.s3.partBytes, Math.ceil(size / 9_000)),
        queueSize: 4,
        leavePartsOnError: false,
    }).done();
}

/** Remembers the use of a blob in the cache table, at most once in a while per blob: it is only an ordering. */
const TOUCH_EVERY_MS = 10 * 60_000;
const touched = new Map<string, number>();

function noteUse(sha256: string, size?: number): void {
    if (!isCache()) return;
    const now = Date.now();
    if (size === undefined && now - (touched.get(sha256) ?? 0) < TOUCH_EVERY_MS) return;
    touched.set(sha256, now);
    if (touched.size > 50_000) touched.clear();
    const done =
        size === undefined
            ? blobCacheRepository.touch(sha256)
            : blobCacheRepository.register(sha256, size);
    done.catch((error: unknown) => logger.warn({ err: error }, 'could not note a blob use'));
    // The file's own time follows, so a sweep after a restart without the table still has an order to go by.
    utimes(localBlobPath(sha256), new Date(), new Date()).catch(() => undefined);
}

/** Blobs being fetched into the cache right now, so a second request for one does not write the same file. */
const filling = new Map<string, Promise<void>>();

async function fetchRemote(sha256: string): Promise<{ body: Readable; size: number }> {
    const r = remote();
    if (!r) throw new Error('Blob not found.');
    try {
        const object = await r.client.send(
            new GetObjectCommand({ Bucket: r.bucket, Key: blobKey(sha256) }),
        );
        return { body: object.Body as Readable, size: Number(object.ContentLength ?? 0) };
    } catch (error) {
        const name = (error as { name?: string }).name;
        if (name === 'NoSuchKey' || name === 'NotFound') throw new Error('Blob not found.');
        throw error;
    }
}

/** Downloads a blob into the cache and returns when it is complete on disk. */
function fillCache(sha256: string): Promise<void> {
    const running = filling.get(sha256);
    if (running) return running;
    const job = (async () => {
        const { body } = await fetchRemote(sha256);
        const target = localBlobPath(sha256);
        await mkdir(dirname(target), { recursive: true });
        const part = `${target}.${String(process.pid)}.part`;
        try {
            await pipeline(body, createWriteStream(part));
            await rename(part, target);
        } catch (error) {
            await rm(part, { force: true });
            throw error;
        }
        noteUse(sha256, (await stat(target)).size);
    })().finally(() => filling.delete(sha256));
    filling.set(sha256, job);
    return job;
}

export const blobStore = {
    /**
     * Hash-before-write dedup (ADR-0002): stores the staged file under its hash unless that key already exists on a
     * tier. The staged file is always consumed. With an S3 store the upload only returns once the bucket holds the
     * blob, so a stored file is never only on the disk.
     *
     * @param sha256 - The staged file's content hash.
     * @param stagedPath - The staged file.
     * @param mime - Content type stored with the durable object.
     */
    async put(sha256: string, stagedPath: string, mime: string): Promise<void> {
        const target = localBlobPath(sha256);
        if (await existsLocal(sha256)) {
            await rm(stagedPath, { force: true });
        } else {
            await mkdir(dirname(target), { recursive: true });
            try {
                await rename(stagedPath, target);
            } catch {
                // The staging directory can sit on another filesystem than the cache.
                await copyFile(stagedPath, target);
                await rm(stagedPath, { force: true });
            }
        }

        if (remote() && !(await existsRemote(sha256))) await uploadRemote(sha256, target, mime);
        if (isCache()) {
            // Written down before put returns, not in the background: a later remove must not be undone by it.
            touched.set(sha256, Date.now());
            await blobCacheRepository
                .register(sha256, (await stat(target)).size)
                .catch((error: unknown) =>
                    logger.warn({ err: error }, 'could not note a stored blob'),
                );
        }
    },

    /**
     * Opens a blob for reading. A blob that is on the disk is read from there. One that is not is streamed from the
     * bucket straight to the reader, without waiting for the whole file, and written into the cache on the way.
     *
     * @returns A read stream of the bytes.
     * @throws {Error} When no tier has the blob.
     */
    async open(sha256: string): Promise<Readable> {
        if (await existsLocal(sha256)) {
            noteUse(sha256);
            return createReadStream(localBlobPath(sha256));
        }
        if (!remote()) throw new Error('Blob not found.');

        const { body, size } = await fetchRemote(sha256);
        // Someone else is already filling the cache with this blob: just stream, do not write the same file twice.
        if (filling.has(sha256)) return body;

        const out = new PassThrough();
        const target = localBlobPath(sha256);
        await mkdir(dirname(target), { recursive: true });
        const part = `${target}.${String(process.pid)}.part`;
        const file = createWriteStream(part);
        let settle: () => void = () => undefined;
        const job = new Promise<void>((resolve) => {
            settle = resolve;
        });
        filling.set(sha256, job);
        const abandon = (): void => {
            file.destroy();
            body.destroy();
            void rm(part, { force: true }).finally(() => {
                filling.delete(sha256);
                settle();
            });
        };
        file.on('finish', () => {
            rename(part, target)
                .then(() => noteUse(sha256, size))
                .catch(() => rm(part, { force: true }))
                .finally(() => {
                    filling.delete(sha256);
                    settle();
                });
        });
        file.on('error', abandon);
        body.on('error', (error) => {
            out.destroy(error);
            abandon();
        });
        // The reader going away part-way means the cache file would be incomplete: drop it.
        out.on('close', () => {
            if (!out.writableFinished) abandon();
        });
        body.pipe(out);
        body.pipe(file);
        return out;
    },

    /** @returns The local path of a blob after making sure it is cached (for tools that need a file, like sharp). */
    async ensureLocal(sha256: string): Promise<string> {
        if (await existsLocal(sha256)) {
            noteUse(sha256);
            return localBlobPath(sha256);
        }
        if (!remote()) throw new Error('Blob not found.');
        await fillCache(sha256);
        return localBlobPath(sha256);
    },

    /** Drops a blob from every tier once nothing references it. */
    async remove(sha256: string): Promise<void> {
        await rm(localBlobPath(sha256), { force: true });
        await blobCacheRepository.forget(sha256).catch(() => undefined);
        touched.delete(sha256);
        const r = remote();
        if (r) {
            await r.client
                .send(new DeleteObjectCommand({ Bucket: r.bucket, Key: blobKey(sha256) }))
                .catch((error: unknown) => {
                    logger.warn({ err: error }, 'could not delete blob from the object store');
                });
        }
    },

    /**
     * Frees local disk by removing the least recently used blobs, but only ones the bucket is confirmed to hold. Runs
     * when the cache is over its size, or the disk is nearly full.
     *
     * @param freeBytes - Free bytes on the disk now.
     * @param reserveBytes - The free space the disk must keep.
     * @returns How many bytes were freed.
     */
    async sweep(freeBytes: number, reserveBytes: number): Promise<number> {
        if (!isCache()) return 0;
        const limit = config.storage.cacheMaxBytes;
        const used = await blobCacheRepository.totalBytes();
        // Down to 90% of the limit, so the next upload does not start another sweep at once; and enough to leave the
        // disk its reserve plus a margin when the disk is what is short.
        const overCache = used > limit ? used - Math.floor(limit * 0.9) : 0;
        const diskShort = freeBytes < reserveBytes * 1.5 ? reserveBytes * 2 - freeBytes : 0;
        let toFree = Math.max(overCache, diskShort);
        let freed = 0;
        while (toFree > 0) {
            const batch = await blobCacheRepository.coldest(200);
            if (batch.length === 0) break;
            let progressed = false;
            for (const { sha256, size } of batch) {
                if (toFree <= 0) break;
                if (filling.has(sha256)) continue;
                // Never remove the only copy.
                if (!(await existsRemote(sha256).catch(() => false))) continue;
                await rm(localBlobPath(sha256), { force: true });
                await blobCacheRepository.forget(sha256);
                toFree -= size;
                freed += size;
                progressed = true;
            }
            if (!progressed) break;
        }
        if (freed > 0) logger.info({ freed }, 'blob cache swept');
        return freed;
    },

    /**
     * Copies blobs that were stored before the bucket was added into it, a few at a time, and registers them in the
     * cache table so they can be evicted later. Safe to run again: it only looks at blobs that were never registered.
     *
     * @returns How many blobs were handled.
     */
    async backfill(batchSize = 50): Promise<number> {
        if (!hasRemoteStore()) return 0;
        let handled = 0;
        for (;;) {
            const batch = await blobCacheRepository.unregistered(batchSize);
            if (batch.length === 0) break;
            for (const { sha256, size, mime } of batch) {
                try {
                    if (await existsLocal(sha256)) {
                        if (!(await existsRemote(sha256)))
                            await uploadRemote(sha256, localBlobPath(sha256), mime);
                        await blobCacheRepository.register(sha256, size);
                    } else if (await existsRemote(sha256)) {
                        // Already only in the bucket: nothing to cache, nothing to copy. Registered with size 0 so it
                        // is not looked at again; the first read fills the cache and corrects the size.
                        await blobCacheRepository.register(sha256, 0);
                    } else {
                        logger.error({ sha256 }, 'blob is in neither the disk nor the bucket');
                        await blobCacheRepository.register(sha256, 0);
                    }
                    handled += 1;
                } catch (error) {
                    logger.warn(
                        { err: error, sha256 },
                        'could not copy a blob to the object store',
                    );
                    return handled;
                }
            }
        }
        if (handled > 0) logger.info({ handled }, 'existing blobs copied to the object store');
        return handled;
    },
};
