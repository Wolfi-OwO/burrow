import { randomBytes } from 'node:crypto';

import { getPool } from '../database/connection.ts';
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../lib/errors.ts';
import type { FileView } from '../models/file.model.ts';
import { categoryRepository } from '../repository/category.repository.ts';
import { fileRepository } from '../repository/file.repository.ts';
import type { Share, ShareAccess, ShareUser } from '../repository/share.repository.ts';
import { shareRepository } from '../repository/share.repository.ts';

const HOUR_MS = 3_600_000;
/** Most files one category link lists; a link is a viewing page, not a bulk export. */
const MAX_SHARED_FILES = 500;

const expiry = (hours: number | null): Date | null =>
    hours === null ? null : new Date(Date.now() + hours * HOUR_MS);

/** What the owner and the recipients see of a link. The token is part of it: the owner needs it to copy the link later. */
export interface ShareView {
    id: string;
    token: string;
    kind: 'file' | 'category';
    targetId: string | number;
    name: string;
    owner: string;
    access: ShareAccess;
    expiresAt: Date | null;
    revoked: boolean;
    expired: boolean;
    createdAt: Date;
    users: ShareUser[];
}

function view(share: Share): ShareView {
    return {
        id: share.id,
        token: share.token,
        kind: share.fileId ? 'file' : 'category',
        targetId: (share.fileId ?? share.categoryId) as string | number,
        name: share.targetName,
        owner: share.ownerName,
        access: share.access,
        expiresAt: share.expiresAt,
        revoked: share.revokedAt !== null,
        expired: share.expiresAt !== null && share.expiresAt.getTime() <= Date.now(),
        createdAt: share.createdAt,
        users: share.users,
    };
}

const alive = (share: Share): boolean =>
    share.revokedAt === null &&
    (share.expiresAt === null || share.expiresAt.getTime() > Date.now());

async function owned(ownerId: string, id: string): Promise<Share> {
    const share = await shareRepository.findById(id);
    if (share?.ownerId !== ownerId) throw new NotFoundError('Share not found.');
    return share;
}

/** What a viewer gets back for a link: the share itself and the files it covers. */
export interface SharedContent {
    share: ShareView;
    files: FileView[];
}

export const shareService = {
    async create(
        ownerId: string,
        input: {
            fileId?: string;
            categoryId?: number;
            access: ShareAccess;
            expiresInHours: number | null;
            userIds: string[];
        },
    ): Promise<ShareView> {
        if (input.fileId !== undefined && !(await fileRepository.findById(ownerId, input.fileId)))
            throw new NotFoundError('File not found.');
        if (
            input.categoryId !== undefined &&
            !(await categoryRepository.findById(ownerId, input.categoryId))
        )
            throw new NotFoundError('Category not found.');

        const id = await getPool().transaction(async (tx) => {
            const created = await shareRepository.create(
                {
                    ownerId,
                    // 32 random bytes: unguessable, URL-safe, and the only thing the public page needs.
                    token: randomBytes(32).toString('base64url'),
                    fileId: input.fileId ?? null,
                    categoryId: input.categoryId ?? null,
                    access: input.access,
                    expiresAt: expiry(input.expiresInHours),
                },
                tx,
            );
            await shareRepository.setUsers(created, input.userIds, tx);
            return created;
        });
        return view((await shareRepository.findById(id)) as Share);
    },

    async listMine(ownerId: string): Promise<ShareView[]> {
        return (await shareRepository.listByOwner(ownerId)).map(view);
    },

    async listSharedWithMe(userId: string): Promise<ShareView[]> {
        return (await shareRepository.listForUser(userId)).map(view);
    },

    async update(
        ownerId: string,
        id: string,
        patch: {
            access?: ShareAccess;
            expiresInHours?: number | null;
            userIds?: string[];
            revoked?: boolean;
        },
    ): Promise<ShareView> {
        await owned(ownerId, id);
        await getPool().transaction(async (tx) => {
            const changes: Parameters<typeof shareRepository.update>[1] = {};
            if (patch.access !== undefined) changes.access = patch.access;
            if (patch.expiresInHours !== undefined)
                changes.expiresAt = expiry(patch.expiresInHours);
            if (patch.revoked !== undefined) changes.revoked = patch.revoked;
            await shareRepository.update(id, changes, tx);
            if (patch.userIds !== undefined) await shareRepository.setUsers(id, patch.userIds, tx);
        });
        return view((await shareRepository.findById(id)) as Share);
    },

    async remove(ownerId: string, id: string): Promise<void> {
        await owned(ownerId, id);
        await shareRepository.remove(id);
    },

    searchUsers(userId: string, q: string): Promise<ShareUser[]> {
        return shareRepository.searchUsers(q, userId);
    },

    /**
     * Opens a link. A dead, expired or unknown link is one and the same 404, so probing tokens reveals nothing; a
     * user-restricted link asks anonymous visitors to sign in (401) and refuses signed-in strangers (403).
     */
    async open(
        token: string,
        viewerId: string | null,
    ): Promise<{ share: Share; files: FileView[] }> {
        const share = await shareRepository.findByToken(token);
        if (!share || !alive(share))
            throw new NotFoundError('This link does not exist or has expired.');
        if (share.access === 'users' && viewerId !== share.ownerId) {
            if (viewerId === null) throw new UnauthorizedError('Sign in to open this link.');
            if (!share.users.some((u) => u.id === viewerId))
                throw new ForbiddenError('This link was not shared with you.');
        }
        const files = share.fileId
            ? [await fileRepository.findById(share.ownerId, share.fileId)].filter(
                  (f): f is FileView => f !== null,
              )
            : await fileRepository.list(share.ownerId, {
                  category: share.categoryId as number,
                  subtree: true,
                  limit: MAX_SHARED_FILES,
                  offset: 0,
              });
        return { share, files };
    },

    async content(token: string, viewerId: string | null, fileId: string): Promise<FileView> {
        const { files } = await shareService.open(token, viewerId);
        const file = files.find((f) => f.id === fileId);
        if (!file) throw new NotFoundError('File not found.');
        return file;
    },

    view,
};
