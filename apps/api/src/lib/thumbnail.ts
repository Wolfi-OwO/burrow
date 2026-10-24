import { mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import sharp from 'sharp';

import { config } from '../config/index.ts';
import { blobStore } from './blob-store.ts';

const THUMB_SIZE = 320;

/**
 * Renders (once) and returns the path of a blob's thumbnail. Thumbnails are derived data: they live
 * only in the local cache, are never uploaded to B2, and can be deleted at any time.
 *
 * @param sha256 - The blob hash.
 * @returns The path of a WebP thumbnail, or null when the blob is not an image sharp can read.
 */
export async function thumbnailPath(sha256: string): Promise<string | null> {
    const target = join(config.storage.dir, 'thumbs', sha256.slice(0, 2), `${sha256}.webp`);
    try {
        await stat(target);
        return target;
    } catch {
        // not rendered yet
    }
    try {
        const source = await blobStore.ensureLocal(sha256);
        await mkdir(dirname(target), { recursive: true });
        await sharp(source, { failOn: 'none', limitInputPixels: 268_402_689 })
            .rotate()
            .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' })
            .webp({ quality: 72 })
            .toFile(target);
        return target;
    } catch {
        return null;
    }
}
