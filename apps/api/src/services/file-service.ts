import { rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import sharp from 'sharp';

import { config } from '../config/index.ts';
import { getPool } from '../database/connection.ts';
import { blobStore } from '../lib/blob-store.ts';
import { NotFoundError } from '../lib/errors.ts';
import { readExif } from '../lib/exif.ts';
import { sha256File } from '../lib/hashing.ts';
import { extractZip } from '../lib/zip-extract.ts';
import type { FileRecord, FileView } from '../models/file.model.ts';
import { blobRepository } from '../repository/blob.repository.ts';
import { categoryRepository } from '../repository/category.repository.ts';
import type { FileListFilter } from '../repository/file.repository.ts';
import { fileRepository } from '../repository/file.repository.ts';

/** Result of an upload; `deduplicated` tells the caller the bytes already existed (FR-016). */
export interface UploadResult {
    file: FileRecord;
    deduplicated: boolean;
}

/**
 * @param raw - The name a browser sent; multer hands it over decoded as latin1.
 * @returns A display name without path parts, restored to UTF-8.
 */
export function cleanFileName(raw: string): string {
    const utf8 = Buffer.from(raw, 'latin1').toString('utf8');
    const base = (utf8.includes('\uFFFD') ? raw : utf8).split(/[\\/]/).pop() ?? '';
    const cleaned = base
        .replace(/\p{Cc}/gu, '')
        .trim()
        .slice(0, 255);
    return cleaned || 'unnamed';
}

/** Sniffs the real type from the bytes: an image sharp can decode wins over the client's claim. */
async function detectMime(path: string, claimed: string): Promise<string> {
    try {
        const { format } = await sharp(path, { failOn: 'none' }).metadata();
        if (format) return `image/${format}`;
    } catch {
        // not an image
    }
    return /^[\w.+-]+\/[\w.+-]+$/.test(claimed) ? claimed : 'application/octet-stream';
}

export interface ArchiveResult {
    files: FileRecord[];
    extracted: number;
    skipped: number;
}

/** How deep zips inside zips are followed. */
const MAX_ZIP_DEPTH = 3;

/**
 * Unpacks one archive into files, recursing into nested .zip entries. `budget` is shared, so the size cap covers the
 * whole tree: a zip of zips cannot unpack to more than one archive's allowance in total.
 */
async function unpack(
    userId: string,
    archive: string,
    stagingDir: string,
    categoryId: number | null,
    onProgress?: (seen: number, total: number) => void,
    depth = 0,
    budget = { used: 0 },
): Promise<ArchiveResult> {
    const files: FileRecord[] = [];
    let skipped = 0;
    const store = async (path: string, size: number, name: string): Promise<void> => {
        const { file } = await fileService.upload(userId, path, size, name, '');
        // Unpacked into the folder the upload was started from, like a single file would be.
        if (categoryId !== null) await fileRepository.setCategory(userId, file.id, categoryId);
        files.push(file);
    };
    const summary = await extractZip(
        archive,
        stagingDir,
        {
            maxEntries: config.zip.maxEntries,
            maxEntryBytes: config.maxFileBytes,
            maxTotalBytes: Math.max(config.zip.maxTotalBytes - budget.used, 0),
        },
        async (path, size, name) => {
            budget.used += size;
            if (depth < MAX_ZIP_DEPTH && /\.zip$/i.test(name)) {
                try {
                    const inner = await unpack(
                        userId,
                        path,
                        stagingDir,
                        categoryId,
                        undefined,
                        depth + 1,
                        budget,
                    );
                    files.push(...inner.files);
                    skipped += inner.skipped;
                    await rm(path, { force: true });
                    return;
                } catch {
                    // Not a readable zip after all: keep it as an ordinary file.
                }
            }
            await store(path, size, name);
        },
        depth === 0 ? onProgress : undefined,
    );
    return { files, extracted: files.length, skipped: summary.skipped + skipped };
}

export const fileService = {
    /**
     * Stores an uploaded file: hash it, skip the write when the bytes already exist, and always
     * create a metadata row (FR-016, ADR-0002).
     *
     * @param userId - The owner.
     * @param stagedPath - multer's staged copy; consumed here.
     * @param originalName - The browser-sent name.
     * @param claimedMime - The browser-sent content type.
     */
    async upload(
        userId: string,
        stagedPath: string,
        size: number,
        originalName: string,
        claimedMime: string,
    ): Promise<UploadResult> {
        try {
            const sha256 = await sha256File(stagedPath);
            const mime = await detectMime(stagedPath, claimedMime);
            const fresh = await blobRepository.insertIfAbsent(sha256, size, mime);
            await blobStore.put(sha256, stagedPath, mime);
            const file = await fileRepository.create({
                userId,
                blobSha256: sha256,
                name: cleanFileName(originalName),
                mime,
                size,
            });
            // Read before the staged file is removed. Photos from a phone carry where and when they were taken.
            const exif = mime.startsWith('image/') ? await readExif(stagedPath) : null;
            if (exif) {
                await fileRepository.setExif(file.id, exif);
                Object.assign(file, exif);
            }
            return { file, deduplicated: !fresh };
        } finally {
            await rm(stagedPath, { force: true });
        }
    },

    /**
     * A .zip is not stored itself: every file inside becomes its own file, exactly as if it had been uploaded one by
     * one (same dedupe, same classification queue). A zip inside a zip is unpacked too, down to a fixed depth.
     */
    async uploadArchive(
        userId: string,
        stagedPath: string,
        onProgress?: (seen: number, total: number) => void,
        categoryId: number | null = null,
    ): Promise<ArchiveResult> {
        try {
            return await unpack(userId, stagedPath, dirname(stagedPath), categoryId, onProgress);
        } finally {
            await rm(stagedPath, { force: true });
        }
    },

    /**
     * Unpacks zips that are already in the drive: contents saved in the zip's own folder, then the zip is removed.
     * A zip that cannot be read, or that held nothing, stays where it is.
     */
    async unzipStored(
        userId: string,
        zips: FileRecord[],
        onProgress?: (done: number) => void,
    ): Promise<{ extracted: number; failed: number }> {
        let extracted = 0;
        let failed = 0;
        let done = 0;
        for (const zip of zips) {
            try {
                const path = await blobStore.ensureLocal(zip.blobSha256);
                const result = await unpack(
                    userId,
                    path,
                    join(config.storage.dir, 'tmp'),
                    zip.categoryId,
                );
                if (result.extracted === 0) failed += 1;
                else {
                    extracted += result.extracted;
                    await fileService.remove(userId, zip.id);
                }
            } catch {
                failed += 1;
            }
            done += 1;
            onProgress?.(done);
        }
        return { extracted, failed };
    },

    list(userId: string, filter: FileListFilter): Promise<FileView[]> {
        return fileRepository.list(userId, filter);
    },

    async get(userId: string, id: string): Promise<FileView> {
        const file = await fileRepository.findById(userId, id);
        if (!file) throw new NotFoundError('File not found.');
        return file;
    },

    /** Files a file by hand under a category (or back to unsorted with null). */
    async move(userId: string, id: string, categoryId: number | null): Promise<FileView> {
        if (categoryId !== null && !(await categoryRepository.findById(userId, categoryId)))
            throw new NotFoundError('Category not found.');
        if (!(await fileRepository.setCategory(userId, id, categoryId)))
            throw new NotFoundError('File not found.');
        return this.get(userId, id);
    },

    async rename(userId: string, id: string, name: string): Promise<FileView> {
        if (!(await fileRepository.rename(userId, id, cleanFileName(name))))
            throw new NotFoundError('File not found.');
        return this.get(userId, id);
    },

    /** Deletes the metadata row and, once nothing else references the content, the blob itself. */
    async remove(userId: string, id: string): Promise<void> {
        const sha256 = await getPool().transaction(async (tx) => {
            const hash = await fileRepository.remove(userId, id, tx);
            if (!hash) throw new NotFoundError('File not found.');
            return (await fileRepository.blobReferences(hash, tx)) === 0 ? hash : null;
        });
        if (sha256) {
            await getPool().query('DELETE FROM blobs WHERE sha256 = $1', [sha256]);
            await blobStore.remove(sha256);
        }
    },

    search(userId: string, query: string, limit: number): Promise<FileView[]> {
        return fileRepository.search(userId, query, limit);
    },
};
