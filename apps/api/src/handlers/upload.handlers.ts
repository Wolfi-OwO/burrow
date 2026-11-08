import type { Request } from 'express';

import { storageService } from '../services/storage-service.ts';
import { chunkedUpload } from '../lib/chunked-upload.ts';
import { asyncHandler, NotFoundError } from '../lib/errors.ts';
import { categoryRepository } from '../repository/category.repository.ts';
import { folderOf, ingest } from './file.handlers.ts';

const uid = (req: Request): string => (req.user as { sub: string }).sub;

/** Announces a big file: the answer says how large each piece is and how many there will be. */
export const start = asyncHandler(async (req, res) => {
    const { name, size, mime, categoryId, fingerprint } = req.body as {
        name: string;
        size: number;
        mime?: string;
        categoryId?: number;
        fingerprint?: string;
    };
    if (categoryId !== undefined && !(await categoryRepository.findById(uid(req), categoryId)))
        throw new NotFoundError('Category not found.');
    // Refused now, before a single piece is sent, rather than after hours of upload.
    await storageService.assertRoom(uid(req), size);
    res.status(201).json(
        await chunkedUpload.start(uid(req), {
            name,
            size,
            mime: mime ?? 'application/octet-stream',
            categoryId: categoryId ?? null,
            ...(fingerprint ? { fingerprint } : {}),
        }),
    );
});

export const status = asyncHandler(async (req, res) => {
    res.json(await chunkedUpload.received(uid(req), req.params.id as string));
});

export const piece = asyncHandler(async (req, res) => {
    await chunkedUpload.write(uid(req), req.params.id as string, Number(req.params.index), req);
    res.status(204).end();
});

/** The last step: once every piece is in, the file is taken into the drive like any other upload. */
export const finish = asyncHandler(async (req, res) => {
    const id = req.params.id as string;
    const done = await chunkedUpload.finish(uid(req), id);
    try {
        await ingest(
            res,
            uid(req),
            { path: done.path, size: done.size, name: done.name, mime: done.mime },
            done.categoryId ?? folderOf(undefined),
        );
    } finally {
        // The file itself was moved or removed by ingest; what is left is the bookkeeping.
        await chunkedUpload.discard(id);
    }
});
