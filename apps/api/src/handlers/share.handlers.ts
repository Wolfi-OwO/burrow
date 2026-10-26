import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { Request } from 'express';

import { blobStore } from '../lib/blob-store.ts';
import { asyncHandler, NotFoundError } from '../lib/errors.ts';
import { thumbnailPath } from '../lib/thumbnail.ts';
import { shareService } from '../services/share-service.ts';

const uid = (req: Request): string => (req.user as { sub: string }).sub;
const viewer = (req: Request): string | null =>
    (req.user as { sub: string } | undefined)?.sub ?? null;

export const create = asyncHandler(async (req, res) => {
    res.status(201).json({
        share: await shareService.create(
            uid(req),
            req.body as Parameters<typeof shareService.create>[1],
        ),
    });
});

export const listMine = asyncHandler(async (req, res) => {
    res.json({ shares: await shareService.listMine(uid(req)) });
});

export const sharedWithMe = asyncHandler(async (req, res) => {
    res.json({ shares: await shareService.listSharedWithMe(uid(req)) });
});

export const update = asyncHandler(async (req, res) => {
    res.json({
        share: await shareService.update(
            uid(req),
            req.params.id as string,
            req.body as Parameters<typeof shareService.update>[2],
        ),
    });
});

export const remove = asyncHandler(async (req, res) => {
    await shareService.remove(uid(req), req.params.id as string);
    res.status(204).end();
});

export const searchUsers = asyncHandler(async (req, res) => {
    const { q } = req.query as unknown as { q: string };
    res.json({ users: await shareService.searchUsers(uid(req), q) });
});

/** The public page behind a link: what it points at and the files it covers. */
export const open = asyncHandler(async (req, res) => {
    const { share, files } = await shareService.open(req.params.token as string, viewer(req));
    res.set('Cache-Control', 'private, no-store');
    res.json({ share: shareService.view(share), files });
});

export const content = asyncHandler(async (req, res) => {
    const file = await shareService.content(
        req.params.token as string,
        viewer(req),
        req.params.fileId as string,
    );
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.type(file.mime).set({
        'Content-Length': String(file.size),
        'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        // Whatever the mime says, the browser must never run an upload as part of this origin.
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
    });
    (await blobStore.open(file.blobSha256)).pipe(res);
});

export const thumbnail = asyncHandler(async (req, res) => {
    const file = await shareService.content(
        req.params.token as string,
        viewer(req),
        req.params.fileId as string,
    );
    const path = await thumbnailPath(file.blobSha256);
    if (!path) throw new NotFoundError('No thumbnail for this file.');
    const { size } = await stat(path);
    res.type('image/webp').set({
        'Content-Length': String(size),
        'Cache-Control': 'private, no-store',
    });
    res.sendFile(resolve(path));
});
