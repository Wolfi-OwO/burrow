import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import {
    DeleteObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    PutObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';

import { config } from '../config/index.ts';
import { logger } from './logger.ts';

/**
 * Content-addressed blob storage, ADR-0002: Backblaze B2 is the store of record and the
 * local disk is a cache that mirrors the same key shape. With no B2 credentials (development,
 * tests) the local disk is the only tier.
 */
const SHA256_HEX = /^[0-9a-f]{64}$/;

let s3: S3Client | undefined;

function remote(): { client: S3Client; bucket: string } | null {
    const { endpoint, bucket, keyId, applicationKey, region } = config.storage.b2;
    if (!endpoint || !bucket || !keyId || !applicationKey) return null;
    s3 ??= new S3Client({
        endpoint,
        region,
        credentials: { accessKeyId: keyId, secretAccessKey: applicationKey },
    });
    return { client: s3, bucket };
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
    return join(config.storage.cacheDir, blobKey(sha256));
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
        if ((error as { name?: string }).name === 'NotFound') return false;
        throw error;
    }
}

export const blobStore = {
    /**
     * Hash-before-write dedup (ADR-0002): stores the staged file under its hash unless that
     * key already exists on a tier. The staged file is always consumed.
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

        const r = remote();
        if (r && !(await existsRemote(sha256))) {
            const { size } = await stat(target);
            await r.client.send(
                new PutObjectCommand({
                    Bucket: r.bucket,
                    Key: blobKey(sha256),
                    Body: createReadStream(target),
                    ContentLength: size,
                    ContentType: mime,
                }),
            );
        }
    },

    /**
     * Opens a blob for reading, refilling the cache from B2 on a miss.
     *
     * @returns A read stream of the bytes.
     * @throws {Error} When no tier has the blob.
     */
    async open(sha256: string): Promise<Readable> {
        if (!(await existsLocal(sha256))) {
            const r = remote();
            if (!r) throw new Error('Blob not found.');
            const object = await r.client.send(
                new GetObjectCommand({ Bucket: r.bucket, Key: blobKey(sha256) }),
            );
            const target = localBlobPath(sha256);
            await mkdir(dirname(target), { recursive: true });
            const part = `${target}.part`;
            await pipeline(object.Body as Readable, createWriteStream(part));
            await rename(part, target);
        }
        return createReadStream(localBlobPath(sha256));
    },

    /** @returns The local path of a blob after making sure it is cached (for tools that need a file, like sharp). */
    async ensureLocal(sha256: string): Promise<string> {
        (await this.open(sha256)).destroy();
        return localBlobPath(sha256);
    },

    /** Drops a blob from both tiers once nothing references it. */
    async remove(sha256: string): Promise<void> {
        await rm(localBlobPath(sha256), { force: true });
        const r = remote();
        if (r) {
            await r.client
                .send(new DeleteObjectCommand({ Bucket: r.bucket, Key: blobKey(sha256) }))
                .catch((error: unknown) => {
                    logger.warn({ err: error }, 'could not delete blob from B2');
                });
        }
    },
};
