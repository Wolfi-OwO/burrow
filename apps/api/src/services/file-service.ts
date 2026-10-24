import { rm } from 'node:fs/promises';

import sharp from 'sharp';

import { getPool } from '../database/connection.ts';
import { blobStore } from '../lib/blob-store.ts';
import { NotFoundError } from '../lib/errors.ts';
import { sha256File } from '../lib/hashing.ts';
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
            return { file, deduplicated: !fresh };
        } finally {
            await rm(stagedPath, { force: true });
        }
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
