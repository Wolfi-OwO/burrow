import { config } from '../config/index.ts';
import type { FileView } from '../models/file.model.ts';
import { getPool } from '../database/connection.ts';
import { duplicateRepository } from '../repository/duplicate.repository.ts';
import { fileRepository } from '../repository/file.repository.ts';
import { fileService } from './file-service.ts';

export type DuplicateMode = 'exact' | 'similar';

export interface DuplicateGroup {
    /** Stable for the group's members, so the page can key on it. */
    id: string;
    /** The copy to keep: sorted first, then the biggest (best quality), then the oldest. */
    keepId: string;
    files: FileView[];
}

/** Connected groups of ids from pairs (a copy of a copy of a copy is one group, not three). */
function group(pairs: [string, string][]): string[][] {
    const parent = new Map<string, string>();
    const find = (x: string): string => {
        let root = x;
        while (parent.get(root) !== root && parent.has(root)) root = parent.get(root) as string;
        parent.set(x, root);
        return root;
    };
    for (const [a, b] of pairs) {
        if (!parent.has(a)) parent.set(a, a);
        if (!parent.has(b)) parent.set(b, b);
        parent.set(find(a), find(b));
    }
    const groups = new Map<string, string[]>();
    for (const id of parent.keys()) groups.set(find(id), [...(groups.get(find(id)) ?? []), id]);
    return [...groups.values()].filter((g) => g.length > 1);
}

/** The one to keep: already filed beats unfiled, bigger beats smaller, older beats newer. */
function pickKeeper(files: FileView[]): string {
    const ranked = [...files].sort(
        (a, b) =>
            Number(b.categoryId !== null) - Number(a.categoryId !== null) ||
            b.size - a.size ||
            a.createdAt.getTime() - b.createdAt.getTime(),
    );
    return (ranked[0] as FileView).id;
}

export const duplicateService = {
    /**
     * One background step of the "same picture, other size" search: compares the next few files that were never
     * compared and stores what they are nearly identical to. The page only reads the stored pairs.
     *
     * @returns How many files were compared (0 when nothing is waiting or another process holds the lock).
     */
    async checkBatch(limit = config.duplicateBatch): Promise<number> {
        return getPool().transaction(async (tx) => {
            if (!(await duplicateRepository.tryLock(tx))) return 0;
            const ids = await duplicateRepository.pending(limit, tx);
            if (ids.length === 0) return 0;
            await duplicateRepository.compare(ids, config.duplicateMaxDistance, tx);
            return ids.length;
        });
    },

    /** Works through everything waiting, batch after batch (after a sort run produced many new embeddings). */
    async checkAll(): Promise<number> {
        let total = 0;
        for (;;) {
            const n = await duplicateService.checkBatch();
            if (n === 0) return total;
            total += n;
        }
    },

    /** How far the comparison is for this user. */
    progress(userId: string): Promise<{ checked: number; pending: number }> {
        return duplicateRepository.progress(userId);
    },

    async groups(userId: string, mode: DuplicateMode): Promise<DuplicateGroup[]> {
        const idGroups =
            mode === 'exact'
                ? await fileRepository.exactDuplicateIds(userId)
                : group(await duplicateRepository.pairs(userId, config.duplicateMaxDistance));
        const files = await fileRepository.byIds(userId, idGroups.flat());
        const byId = new Map(files.map((f) => [f.id, f]));
        return idGroups
            .map((ids) => {
                const members = ids
                    .map((id) => byId.get(id))
                    .filter((f): f is FileView => f !== undefined);
                return {
                    id: [...ids].sort()[0] as string,
                    keepId: pickKeeper(members),
                    files: members,
                };
            })
            .filter((g) => g.files.length > 1)
            .sort((a, b) => b.files.length - a.files.length);
    },

    /** Deletes the chosen copies; a file the user does not own is skipped, and the keeper is never touched. */
    async remove(userId: string, keepId: string, removeIds: string[]): Promise<number> {
        let removed = 0;
        for (const id of removeIds) {
            if (id === keepId) continue;
            try {
                await fileService.remove(userId, id);
                removed += 1;
            } catch {
                // Already gone or not theirs: nothing to remove.
            }
        }
        return removed;
    },

    /** "Remove all duplicates": in every group keep the best copy and delete the rest. */
    async clean(userId: string, mode: DuplicateMode): Promise<number> {
        let removed = 0;
        for (const g of await duplicateService.groups(userId, mode)) {
            removed += await duplicateService.remove(
                userId,
                g.keepId,
                g.files.map((f) => f.id),
            );
        }
        return removed;
    },

    /** How many files the rating check would move. */
    async ratingPreview(userId: string): Promise<{ toExplicit: number; toSafe: number }> {
        const found = await fileRepository.ratingMisfiles(userId);
        return {
            toExplicit: found.filter((m) => m.toExplicit).length,
            toSafe: found.filter((m) => !m.toExplicit).length,
        };
    },

    /** Moves every file whose NSFW score contradicts its SFW / NSFW category into the sibling that fits. */
    async ratingFix(userId: string): Promise<{ toExplicit: number; toSafe: number }> {
        const found = await fileRepository.ratingMisfiles(userId);
        for (const m of found) await fileRepository.setCategory(userId, m.id, m.toCategoryId);
        return {
            toExplicit: found.filter((m) => m.toExplicit).length,
            toSafe: found.filter((m) => !m.toExplicit).length,
        };
    },
};
