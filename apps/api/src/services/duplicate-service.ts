import { config } from '../config/index.ts';
import { publish } from '../lib/events.ts';
import { logger } from '../lib/logger.ts';
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

/** Tells the accounts that own the files just compared that their comparison moved on. */
function announceChecked(owners: string[]): void {
    for (const userId of owners) publish(userId, { type: 'duplicates.checked', data: {} });
}

/** Accounts with a cleanup loop running in this process, so one account never has two. */
const cleaning = new Set<string>();
const PERSIST_EVERY = 10;
const EVENT_EVERY_MS = 250;

export interface CleanStatus {
    running: boolean;
    mode: DuplicateMode | null;
    total: number;
    done: number;
    removed: number;
}

/**
 * Removes everything `groups` finds, copy by copy, writing the progress down and telling open pages as it goes. Safe to
 * start again after a restart: the groups are looked at again, so what is already gone is not counted twice.
 */
async function runClean(userId: string, mode: DuplicateMode, total: number): Promise<void> {
    if (cleaning.has(userId)) return;
    cleaning.add(userId);
    try {
        const before = await duplicateRepository.cleanRun(userId);
        const todo = (await duplicateService.groups(userId, mode)).flatMap((g) =>
            g.files.filter((f) => f.id !== g.keepId).map((f) => f.id),
        );
        // A resumed run has already removed part of the total; what is left to do is the rest.
        let done = Math.max(0, total - todo.length);
        let removed = before?.removed ?? 0;
        let lastEvent = 0;
        const say = (finished: boolean): void => {
            publish(userId, {
                type: 'duplicates.progress',
                data: { done, total, removed, mode, finished },
            });
            lastEvent = Date.now();
        };
        say(false);
        for (const id of todo) {
            try {
                await fileService.remove(userId, id);
                removed += 1;
            } catch {
                // Already gone or not theirs: nothing to remove.
            }
            done += 1;
            if (done % PERSIST_EVERY === 0)
                await duplicateRepository.progressClean(userId, done, removed);
            if (Date.now() - lastEvent >= EVENT_EVERY_MS) say(false);
        }
        await duplicateRepository.progressClean(userId, total, removed);
        await duplicateRepository.endClean(userId);
        done = total;
        say(true);
    } catch (error) {
        logger.error({ err: error, userId }, 'removing duplicates failed');
        await duplicateRepository.endClean(userId).catch(() => undefined);
        publish(userId, {
            type: 'duplicates.progress',
            data: { done: 0, total, removed: 0, mode, finished: true, failed: true },
        });
    } finally {
        cleaning.delete(userId);
    }
}

export const duplicateService = {
    /**
     * One background step of the "same picture, other size" search: compares the next few files that were never
     * compared and stores what they are nearly identical to. The page only reads the stored pairs.
     *
     * @returns How many files were compared (0 when nothing is waiting or another process holds the lock).
     */
    async checkBatch(limit = config.duplicateBatch): Promise<number> {
        return getPool()
            .transaction(async (tx) => {
                if (!(await duplicateRepository.tryLock(tx))) return 0;
                const ids = await duplicateRepository.pending(limit, tx);
                if (ids.length === 0) return 0;
                await duplicateRepository.compare(ids, config.duplicateMaxDistance, tx);
                return { count: ids.length, owners: await duplicateRepository.ownersOf(ids, tx) };
            })
            .then((result) => {
                // Open pages show how far the comparison is: tell them the moment a batch is stored.
                if (typeof result === 'number') return result;
                announceChecked(result.owners);
                return result.count;
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

    /**
     * "Remove all duplicates": in every group keep the best copy and delete the rest, in the background. The run is
     * written down, so it shows the same progress when the page is closed and opened again.
     */
    async startClean(
        userId: string,
        mode: DuplicateMode,
    ): Promise<CleanStatus & { started: boolean; reason?: string }> {
        const current = await duplicateService.cleanStatus(userId);
        if (current.running) return { ...current, started: false, reason: 'Already removing.' };
        const total = (await duplicateService.groups(userId, mode)).reduce(
            (sum, g) => sum + g.files.filter((f) => f.id !== g.keepId).length,
            0,
        );
        if (total === 0) return { ...current, started: false, reason: 'No duplicates to remove.' };
        await duplicateRepository.beginClean(userId, mode, total);
        void runClean(userId, mode, total);
        return { running: true, mode, total, done: 0, removed: 0, started: true };
    },

    /** The account's latest cleanup: going, or finished with what it removed. */
    async cleanStatus(userId: string): Promise<CleanStatus> {
        const run = await duplicateRepository.cleanRun(userId);
        return run
            ? {
                  running: run.active,
                  mode: run.mode,
                  total: run.total,
                  done: run.done,
                  removed: run.removed,
              }
            : { running: false, mode: null, total: 0, done: 0, removed: 0 };
    },

    /** After a restart: carries on with the cleanups that were going. */
    async resumeInterrupted(): Promise<number> {
        const runs = await duplicateRepository.activeCleans();
        for (const run of runs) void runClean(run.userId, run.mode, run.total);
        return runs.length;
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
        // The rating check moves files on its own: that is not the person choosing, so it teaches the sorter nothing.
        for (const m of found)
            await fileRepository.setCategory(userId, m.id, m.toCategoryId, undefined, {
                teach: false,
            });
        return {
            toExplicit: found.filter((m) => m.toExplicit).length,
            toSafe: found.filter((m) => !m.toExplicit).length,
        };
    },
};
