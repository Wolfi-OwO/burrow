import { randomUUID } from 'node:crypto';
import { rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { Request, Response } from 'express';

import { blobStore } from '../lib/blob-store.ts';
import { publish } from '../lib/events.ts';
import { logger } from '../lib/logger.ts';
import { asyncHandler, BadRequestError, NotFoundError } from '../lib/errors.ts';
import { thumbnailPath } from '../lib/thumbnail.ts';
import { categoryRepository } from '../repository/category.repository.ts';
import type { FileListFilter } from '../repository/file.repository.ts';
import { fileRepository } from '../repository/file.repository.ts';
import { fileService } from '../services/file-service.ts';

const uid = (req: Request): string => (req.user as { sub: string }).sub;

export const list = asyncHandler(async (req, res) => {
    const q = req.query as unknown as {
        category?: number | 'unsorted';
        status?: FileListFilter['status'];
        type?: FileListFilter['type'];
        subtree: boolean;
        limit: number;
        offset: number;
    };
    const filter: FileListFilter = { subtree: q.subtree, limit: q.limit, offset: q.offset };
    if (q.category !== undefined) filter.category = q.category;
    if (q.status !== undefined) filter.status = q.status;
    if (q.type !== undefined) filter.type = q.type;
    res.json({ files: await fileService.list(uid(req), filter) });
});

/** FR-016/FR-017: one blob per content, an over-size upload never reaches the store. */
/**
 * Takes a staged file into the drive, however it arrived (one multipart request, or the last piece of a chunked
 * upload). A .zip is unpacked in the background (the request answers at once with a job id and the page follows the
 * progress on its event stream); anything else is stored now. Either way it goes into `categoryId` when given.
 */
export async function ingest(
    res: Response,
    userId: string,
    staged: { path: string; size: number; name: string; mime: string },
    categoryId: number | null,
): Promise<void> {
    if (categoryId !== null && !(await categoryRepository.findById(userId, categoryId))) {
        await rm(staged.path, { force: true });
        throw new NotFoundError('Category not found.');
    }
    if (/\.zip$/i.test(staged.name)) {
        const job = randomUUID();
        const name = staged.name;
        res.status(202).json({ job });
        publish(userId, { type: 'upload.progress', data: { job, name, seen: 0, total: 0 } });
        fileService
            .uploadArchive(
                userId,
                staged.path,
                (seen, total) =>
                    publish(userId, { type: 'upload.progress', data: { job, name, seen, total } }),
                categoryId,
            )
            .then(
                (archive) =>
                    publish(userId, {
                        type: 'upload.done',
                        data: { job, name, extracted: archive.extracted, skipped: archive.skipped },
                    }),
                (error: unknown) => {
                    logger.warn({ err: error }, 'zip upload failed');
                    publish(userId, { type: 'upload.failed', data: { job, name } });
                },
            );
        return;
    }
    const result = await fileService.upload(
        userId,
        staged.path,
        staged.size,
        staged.name,
        staged.mime,
    );
    if (categoryId !== null) {
        await fileRepository.setCategory(userId, result.file.id, categoryId);
        result.file.categoryId = categoryId;
        result.file.status = 'sorted';
    }
    res.status(201).json({ file: result.file, deduplicated: result.deduplicated });
}

/** The optional `categoryId` field of an upload: file it straight into the folder the upload was started from. */
export const folderOf = (raw: unknown): number | null =>
    typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : null;

/** FR-016/FR-017: one blob per content, an over-size upload never reaches the store. */
export const upload = asyncHandler(async (req, res) => {
    const staged = req.file;
    if (!staged) throw new BadRequestError('Send the file as the "file" field.');
    await ingest(
        res,
        uid(req),
        { path: staged.path, size: staged.size, name: staged.originalname, mime: staged.mimetype },
        folderOf((req.body as { categoryId?: string } | undefined)?.categoryId),
    );
});

export const get = asyncHandler(async (req, res) => {
    res.json(await fileService.get(uid(req), req.params.id as string));
});

/** Ownership is checked by the lookup itself: another user's id is a 404, not a 403. */
export const content = asyncHandler(async (req, res) => {
    const file = await fileService.get(uid(req), req.params.id as string);
    res.type(file.mime).set({
        'Content-Length': String(file.size),
        // Whatever the mime says, the browser must never run an upload as part of this origin.
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=3600',
    });
    (await blobStore.open(file.blobSha256)).pipe(res);
});

export const thumbnail = asyncHandler(async (req, res) => {
    const file = await fileService.get(uid(req), req.params.id as string);
    const path = await thumbnailPath(file.blobSha256);
    if (!path) throw new NotFoundError('No thumbnail for this file.');
    const { size } = await stat(path);
    res.type('image/webp').set({
        'Content-Length': String(size),
        'Cache-Control': 'private, max-age=86400',
    });
    // sendFile needs an absolute path; BLOB_DIR may be relative (./data).
    res.sendFile(resolve(path));
});

export const patch = asyncHandler(async (req, res) => {
    const { name, categoryId } = req.body as { name?: string; categoryId?: number | null };
    const id = req.params.id as string;
    if (name !== undefined) await fileService.rename(uid(req), id, name);
    if (categoryId !== undefined) await fileService.move(uid(req), id, categoryId);
    res.json(await fileService.get(uid(req), id));
});

export const remove = asyncHandler(async (req, res) => {
    await fileService.remove(uid(req), req.params.id as string);
    res.status(204).end();
});

export const search = asyncHandler(async (req, res) => {
    const { q, limit } = req.query as unknown as { q: string; limit: number };
    // FR-022: the empty state is explicit, not a silently empty list.
    const files = await fileService.search(uid(req), q, limit);
    res.json({ query: q, total: files.length, empty: files.length === 0, files });
});

export const typeCounts = asyncHandler(async (req, res) => {
    res.json({ counts: await fileRepository.typeCounts(uid(req)) });
});

/**
 * Unpacks .zip files that are already in the drive (one, a chosen few, or all of them): the contents are saved in
 * the same folder and each zip that unpacked is removed. Runs in the background and reports on the event stream.
 */
export const unzip = asyncHandler(async (req, res) => {
    const { ids } = req.body as { ids?: string[] };
    const user = uid(req);
    const zips = await fileRepository.zipFiles(user, ids ?? null);
    const job = randomUUID();
    res.status(202).json({ job, count: zips.length });
    if (zips.length === 0) return;
    const name =
        zips.length === 1 ? (zips[0]?.name ?? 'archive') : `${String(zips.length)} archives`;
    publish(user, { type: 'upload.progress', data: { job, name, seen: 0, total: zips.length } });
    fileService
        .unzipStored(user, zips, (seen) =>
            publish(user, {
                type: 'upload.progress',
                data: { job, name, seen, total: zips.length },
            }),
        )
        .then(
            (result) =>
                publish(user, {
                    type: 'upload.done',
                    data: { job, name, extracted: result.extracted, skipped: result.failed },
                }),
            (error: unknown) => {
                logger.warn({ err: error }, 'unzip failed');
                publish(user, { type: 'upload.failed', data: { job, name } });
            },
        );
});
