import { rm, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

import type { Request } from 'express';
import sharp from 'sharp';

import { config } from '../config/index.ts';

import { toAccount, toPublicProfile } from '../lib/account-view.ts';
import { blobStore } from '../lib/blob-store.ts';
import { storageService } from '../services/storage-service.ts';
import { asyncHandler, BadRequestError, NotFoundError } from '../lib/errors.ts';
import { sha256File } from '../lib/hashing.ts';
import { clearRefreshCookie } from '../lib/refresh-cookie.ts';
import { blobRepository } from '../repository/blob.repository.ts';
import { fileRepository } from '../repository/file.repository.ts';
import { userRepository } from '../repository/user.repository.ts';
import { accountService } from '../services/account-service.ts';

const uid = (req: Request): string => (req.user as { sub: string }).sub;

export const getMe = asyncHandler(async (req, res) => {
    const user = await userRepository.findById(uid(req));
    if (!user) throw new NotFoundError();
    res.json(toAccount(user));
});

export const patchMe = asyncHandler(async (req, res) => {
    const patch = req.body as { displayName?: string; bio?: string; nsfwOptIn?: boolean };
    const user = await userRepository.updateProfile(uid(req), patch);
    if (!user) throw new NotFoundError();
    // Withdrawing the opt-in also forgets what the classifier already stored (Art 9 DSGVO).
    if (patch.nsfwOptIn === false) await fileRepository.clearNsfwScores(user.id);
    res.json(toAccount(user));
});

/**
 * FR-018: the avatar goes through the same blob store as every file, no second storage path. The picture is
 * re-encoded (not stored as sent): that strips metadata and guarantees a small, valid image.
 */
async function storeAvatar(
    userId: string,
    sourcePath: string,
): Promise<ReturnType<typeof toAccount>> {
    const source = resolve(sourcePath);
    if (!source.startsWith(resolve(config.storage.dir) + sep))
        throw new Error('Path is outside its folder.');
    const normalized = `${source}.webp`;
    try {
        try {
            await sharp(source, { failOn: 'error' })
                .rotate()
                .resize(512, 512, { fit: 'cover' })
                .webp({ quality: 85 })
                .toFile(normalized);
        } catch {
            throw new BadRequestError('That file is not a readable image.');
        }
        const sha256 = await sha256File(normalized);
        const { size } = await stat(normalized);
        await blobRepository.insertIfAbsent(sha256, size, 'image/webp');
        await blobStore.put(sha256, normalized, 'image/webp');
        const user = await userRepository.updateProfile(userId, { avatarSha256: sha256 });
        if (!user) throw new NotFoundError();
        return toAccount(user);
    } finally {
        await rm(normalized, { force: true });
    }
}

export const putAvatar = asyncHandler(async (req, res) => {
    const staged = req.file;
    if (!staged) throw new BadRequestError('Send the image as the "file" field.');
    const safe = resolve(staged.path);
    if (!safe.startsWith(resolve(config.storage.dir) + sep))
        throw new Error('Path is outside its folder.');
    try {
        res.json(await storeAvatar(uid(req), safe));
    } finally {
        await rm(safe, { force: true });
    }
});

/** Uses one of the user's own pictures from the drive as the avatar. */
export const avatarFromFile = asyncHandler(async (req, res) => {
    const { fileId } = req.body as { fileId: string };
    const file = await fileRepository.findById(uid(req), fileId);
    if (!file) throw new NotFoundError('File not found.');
    if (!file.mime.startsWith('image/')) throw new BadRequestError('That file is not an image.');
    res.json(await storeAvatar(uid(req), await blobStore.ensureLocal(file.blobSha256)));
});

export const getProfile = asyncHandler(async (req, res) => {
    const user = await userRepository.findById(req.params.id as string);
    if (!user) throw new NotFoundError('User not found.');
    res.json(toPublicProfile(user));
});

export const getAvatar = asyncHandler(async (req, res) => {
    const user = await userRepository.findById(req.params.id as string);
    if (!user?.avatarSha256) throw new NotFoundError('No avatar.');
    res.type('image/webp').set('Cache-Control', 'private, max-age=3600');
    (await blobStore.open(user.avatarSha256)).pipe(res);
});

/** Art 15 and 20 DSGVO: everything the account holds, as one zip the owner can keep. */
export const exportData = asyncHandler(async (req, res) => {
    const user = await userRepository.findById(uid(req));
    if (!user) throw new NotFoundError();
    const day = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
        'Content-Disposition',
        `attachment; filename="burrow-export-${user.username.replace(/[^A-Za-z0-9._-]+/g, '_')}-${day}.zip"`,
    );
    res.setHeader('Cache-Control', 'no-store');
    await accountService.exportTo(user.id, res);
});

/** Art 17 DSGVO: deletes the signed-in account with everything it owns. */
export const deleteMe = asyncHandler(async (req, res) => {
    const input = req.body as { username: string; password?: string };
    await accountService.deleteAccount(uid(req), input);
    clearRefreshCookie(res);
    res.status(204).end();
});

/** How much of the account's storage is used, for the profile page. */
export const getStorage = asyncHandler(async (req, res) => {
    res.json(await storageService.usage((req.user as { sub: string }).sub));
});
