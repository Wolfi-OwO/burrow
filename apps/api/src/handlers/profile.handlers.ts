import { rm, stat } from 'node:fs/promises';

import type { Request } from 'express';
import sharp from 'sharp';

import { toAccount, toPublicProfile } from '../lib/account-view.ts';
import { blobStore } from '../lib/blob-store.ts';
import { asyncHandler, BadRequestError, NotFoundError } from '../lib/errors.ts';
import { sha256File } from '../lib/hashing.ts';
import { blobRepository } from '../repository/blob.repository.ts';
import { userRepository } from '../repository/user.repository.ts';

const uid = (req: Request): string => (req.user as { sub: string }).sub;

export const getMe = asyncHandler(async (req, res) => {
    const user = await userRepository.findById(uid(req));
    if (!user) throw new NotFoundError();
    res.json(toAccount(user));
});

export const patchMe = asyncHandler(async (req, res) => {
    const patch = req.body as { displayName?: string; bio?: string };
    const user = await userRepository.updateProfile(uid(req), patch);
    if (!user) throw new NotFoundError();
    res.json(toAccount(user));
});

/** FR-018: the avatar goes through the same blob store as every file, no second storage path. */
export const putAvatar = asyncHandler(async (req, res) => {
    const staged = req.file;
    if (!staged) throw new BadRequestError('Send the image as the "file" field.');
    try {
        // Re-encoded (not stored as sent): strips metadata and guarantees a small, valid image.
        const normalized = `${staged.path}.webp`;
        try {
            await sharp(staged.path, { failOn: 'error' })
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
        const user = await userRepository.updateProfile(uid(req), { avatarSha256: sha256 });
        if (!user) throw new NotFoundError();
        res.json(toAccount(user));
    } finally {
        await rm(staged.path, { force: true });
    }
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
