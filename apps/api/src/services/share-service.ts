import { randomBytes } from 'node:crypto';

import { getPool } from '../database/connection.ts';
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../lib/errors.ts';
import type { FileView } from '../models/file.model.ts';
import type { CategoryNode } from '../models/category.model.ts';
import { categoryRepository } from '../repository/category.repository.ts';
import { fileRepository } from '../repository/file.repository.ts';
import type { Share, ShareAccess, ShareUser } from '../repository/share.repository.ts';
import { shareRepository } from '../repository/share.repository.ts';

const HOUR_MS = 3_600_000;
/** Files per page of a link; a link is a viewing page, so a big drive is read page by page. */
export const SHARED_PAGE = 200;

const expiry = (hours: number | null): Date | null =>
    hours === null ? null : new Date(Date.now() + hours * HOUR_MS);

/** A folder inside a shared folder, as the public page lists it. */
export interface SharedFolder {
    id: number;
    name: string;
    fileCount: number;
}

/** What the owner and the recipients see of a link. The token is part of it: the owner needs it to copy the link later. */
export interface ShareView {
    id: string;
    token: string;
    kind: 'file' | 'category' | 'drive';
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
        kind: share.wholeDrive ? 'drive' : share.fileId ? 'file' : 'category',
        targetId: share.wholeDrive
            ? 'drive'
            : ((share.fileId ?? share.categoryId) as string | number),
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
            drive?: true;
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
                    wholeDrive: input.drive === true,
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
        offset = 0,
        folderId?: number,
    ): Promise<{
        share: Share;
        files: FileView[];
        hasMore: boolean;
        folders: SharedFolder[];
        trail: SharedFolder[];
    }> {
        const share = await shareRepository.findByToken(token);
        if (!share || !alive(share))
            throw new NotFoundError('This link does not exist or has expired.');
        if (share.access === 'users' && viewerId !== share.ownerId) {
            if (viewerId === null) throw new UnauthorizedError('Sign in to open this link.');
            if (!share.users.some((u) => u.id === viewerId))
                throw new ForbiddenError('This link was not shared with you.');
        }
        if (share.fileId) {
            const file = await fileRepository.findById(share.ownerId, share.fileId);
            return { share, files: file ? [file] : [], hasMore: false, folders: [], trail: [] };
        }
        if (share.categoryId === null) {
            const files = await fileRepository.list(share.ownerId, {
                limit: SHARED_PAGE,
                offset,
            });
            return { share, files, hasMore: files.length === SHARED_PAGE, folders: [], trail: [] };
        }
        // A shared folder opens like the drive does: its own files, and every folder below it as a card that opens in
        // turn. Only folders inside the shared one can be asked for.
        const nodes = await categoryRepository.listTree(share.ownerId);
        const root = nodes.find((c) => c.id === share.categoryId);
        if (!root) throw new NotFoundError('This link does not exist or has expired.');
        const here =
            folderId === undefined
                ? root
                : nodes.find(
                      (c) =>
                          c.id === folderId &&
                          (c.id === root.id || c.path.startsWith(`${root.path}.`)),
                  );
        if (!here) throw new NotFoundError('That folder is not part of this link.');
        const pick = (c: CategoryNode): SharedFolder => ({
            id: c.id,
            name: c.name,
            fileCount: c.fileCount,
        });
        const files = await fileRepository.list(share.ownerId, {
            category: here.id,
            subtree: false,
            limit: SHARED_PAGE,
            offset,
        });
        return {
            share,
            files,
            hasMore: files.length === SHARED_PAGE,
            folders: nodes.filter((c) => c.parentId === here.id).map(pick),
            trail: nodes
                .filter((c) => here.path === c.path || here.path.startsWith(`${c.path}.`))
                .filter((c) => c.id === root.id || c.path.startsWith(`${root.path}.`))
                .map(pick),
        };
    },

    async content(token: string, viewerId: string | null, fileId: string): Promise<FileView> {
        const { share } = await shareService.open(token, viewerId);
        const inScope = share.fileId
            ? share.fileId === fileId
            : share.categoryId === null
              ? true
              : await fileRepository.isInSubtree(share.ownerId, fileId, share.categoryId);
        const file = inScope ? await fileRepository.findById(share.ownerId, fileId) : null;
        if (!file) throw new NotFoundError('File not found.');
        return file;
    },

    view,
};
