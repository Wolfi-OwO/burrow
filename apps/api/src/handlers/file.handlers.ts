import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { Request } from 'express';

import { blobStore } from '../lib/blob-store.ts';
import { asyncHandler, BadRequestError, NotFoundError } from '../lib/errors.ts';
import { thumbnailPath } from '../lib/thumbnail.ts';
import type { FileListFilter } from '../repository/file.repository.ts';
import { fileService } from '../services/file-service.ts';

const uid = (req: Request): string => (req.user as { sub: string }).sub;

export const list = asyncHandler(async (req, res) => {
    const q = req.query as unknown as {
        category?: number | 'unsorted';
        status?: FileListFilter['status'];
        subtree: boolean;
        limit: number;
        offset: number;
    };
    const filter: FileListFilter = { subtree: q.subtree, limit: q.limit, offset: q.offset };
    if (q.category !== undefined) filter.category = q.category;
    if (q.status !== undefined) filter.status = q.status;
    res.json({ files: await fileService.list(uid(req), filter) });
});

/** FR-016/FR-017: one blob per content, an over-size upload never reaches the store. */
export const upload = asyncHandler(async (req, res) => {
    const staged = req.file;
    if (!staged) throw new BadRequestError('Send the file as the "file" field.');
    // A .zip is unpacked into its files. Office formats are zips too, so the extension decides, not the magic bytes.
    if (/\.zip$/i.test(staged.originalname)) {
        const archive = await fileService.uploadArchive(uid(req), staged.path);
        res.status(201).json({
            files: archive.files,
            extracted: archive.extracted,
            skipped: archive.skipped,
        });
        return;
    }
    const result = await fileService.upload(
        uid(req),
        staged.path,
        staged.size,
        staged.originalname,
        staged.mimetype,
    );
    res.status(201).json({ file: result.file, deduplicated: result.deduplicated });
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
