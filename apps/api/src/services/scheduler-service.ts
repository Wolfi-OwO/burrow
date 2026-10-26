import { publish } from '../lib/events.ts';
import { config } from '../config/index.ts';
import { getPool } from '../database/connection.ts';
import { logger } from '../lib/logger.ts';
import { fileRepository } from '../repository/file.repository.ts';
import { sessionRepository } from '../repository/session.repository.ts';
import { schedulerRepository } from '../repository/scheduler.repository.ts';
import { classificationService } from './classification-service.ts';
import { duplicateService } from './duplicate-service.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const TICK_MS = 60 * 1000;
/** Ended sessions are kept this long (for investigating a suspicious login), then deleted. */
export const SESSION_RETENTION_DAYS = 7;
const PURGE_EVERY_TICKS = 60;

/**
 * FR-040: runs per day grow linearly with the backlog, from the minimum (an idle drive) to the maximum
 * (a backlog of `backlogForMaxRuns` or more). Defaults give 10 to 30 runs a day.
 *
 * @param backlog - Files still waiting for a first classification.
 */
export function runsPerDay(backlog: number): number {
    const { minRunsPerDay, maxRunsPerDay, backlogForMaxRuns } = config.sorting;
    const share = Math.min(Math.max(backlog, 0) / backlogForMaxRuns, 1);
    return Math.round(minRunsPerDay + (maxRunsPerDay - minRunsPerDay) * share);
}

/** @returns The time between two runs for a backlog of this size. */
export function intervalMs(backlog: number): number {
    return DAY_MS / runsPerDay(backlog);
}

/**
 * Decides whether a run is due.
 *
 * @param lastRun - When the previous run started, or null if it never ran.
 * @param backlog - Files waiting.
 * @param now - The current time.
 */
export function isDue(lastRun: Date | null, backlog: number, now: Date): boolean {
    if (backlog === 0) return false;
    return lastRun === null || now.getTime() - lastRun.getTime() >= intervalMs(backlog);
}

/** Processes one bounded batch of the backlog. @returns How many files were decided. */
async function runBatch(): Promise<number> {
    let decided = 0;
    const perUser = new Map<string, number>();
    for (const file of await fileRepository.nextBacklog(config.sorting.batchSize)) {
        if (await classificationService.classify(file)) {
            decided += 1;
            perUser.set(file.userId, (perUser.get(file.userId) ?? 0) + 1);
        }
    }
    for (const userId of perUser.keys())
        await duplicateService.ratingFix(userId).catch(() => undefined);
    tell(perUser);
    return decided;
}

/** Once at start-up: pictures already filed on the wrong side of an SFW / NSFW pair are moved by their score. */
async function startupRatingPass(): Promise<void> {
    try {
        const { rows } = await getPool().query('SELECT DISTINCT user_id FROM files');
        for (const row of rows) {
            const moved = await duplicateService.ratingFix(row.user_id as string);
            if (moved.toExplicit + moved.toSafe > 0)
                logger.info({ moved }, 'rating pass moved files');
        }
    } catch (error) {
        logger.warn({ err: error }, 'rating pass failed');
    }
}

/** Lets each owner's open pages know how many of their files the sorter just decided. */
function tell(perUser: Map<string, number>): void {
    for (const [userId, decided] of perUser)
        publish(userId, { type: 'sorting.done', data: { decided } });
}

/** How long "Sort now" keeps working through the backlog before it hands the rest back to the schedule. */
const SORT_NOW_BUDGET_MS = 4 * 60_000;

/**
 * Works through the whole backlog batch after batch. A file that failed stays unclassified, so it is skipped for
 * the rest of this run instead of being fetched again forever.
 */
async function runUntilEmpty(): Promise<{ decided: number; remaining: number }> {
    const deadline = Date.now() + SORT_NOW_BUDGET_MS;
    const tried: string[] = [];
    const perUser = new Map<string, number>();
    let decided = 0;
    while (Date.now() < deadline) {
        const batch = await fileRepository.nextBacklog(config.sorting.batchSize, tried);
        if (batch.length === 0) break;
        for (const file of batch) {
            tried.push(file.id);
            if (await classificationService.classify(file)) {
                decided += 1;
                perUser.set(file.userId, (perUser.get(file.userId) ?? 0) + 1);
            }
        }
    }
    tell(perUser);
    return { decided, remaining: await fileRepository.backlogSize() };
}

/** The one "Sort now" that may run at a time: the page shows its progress and reloads can find it again. */
export interface SortJob {
    running: boolean;
    total: number;
    done: number;
}
let job: SortJob = { running: false, total: 0, done: 0 };
export const sortJob = (): SortJob => ({ ...job });

/**
 * Works through the whole backlog in the background, no time limit, a few files at a time, telling each owner how it
 * goes. When it ends, every owner's SFW / NSFW folders are checked against the classifier's scores.
 */
async function runInBackground(): Promise<void> {
    const tried: string[] = [];
    const perUser = new Map<string, number>();
    let lastTold = 0;
    const work = async (): Promise<void> => {
        for (;;) {
            const [file] = await fileRepository.nextBacklog(1, tried);
            if (!file) return;
            tried.push(file.id);
            if (await classificationService.classify(file))
                perUser.set(file.userId, (perUser.get(file.userId) ?? 0) + 1);
            job.done += 1;
            if (Date.now() - lastTold > 1000) {
                lastTold = Date.now();
                for (const userId of new Set([...perUser.keys(), file.userId]))
                    publish(userId, {
                        type: 'sorting.progress',
                        data: { done: job.done, total: job.total },
                    });
            }
        }
    };
    try {
        await getPool().transaction(async (tx) => {
            if (!(await schedulerRepository.tryLock(tx))) return;
            await schedulerRepository.markRun(tx);
            await Promise.all(Array.from({ length: config.sorting.concurrency }, () => work()));
        });
        for (const userId of perUser.keys())
            await duplicateService.ratingFix(userId).catch(() => undefined);
        tell(perUser);
    } catch (error) {
        logger.error({ err: error }, 'sort now failed');
    } finally {
        for (const userId of perUser.keys())
            publish(userId, {
                type: 'sorting.progress',
                data: { done: job.done, total: job.total, finished: true },
            });
        job = { running: false, total: job.total, done: job.done };
    }
}

export const schedulerService = {
    /**
     * "Sort now" without waiting: starts the background run and answers at once. A run already going is joined, not
     * started twice.
     */
    async startSortAll(): Promise<{ started: boolean; total: number; reason?: string }> {
        if (!config.vision.url)
            return { started: false, total: 0, reason: 'The vision service is not set up.' };
        if (job.running) return { started: false, total: job.total, reason: 'Already sorting.' };
        const total = await fileRepository.backlogSize();
        if (total === 0) return { started: false, total: 0, reason: 'Nothing is waiting.' };
        job = { running: true, total, done: 0 };
        void runInBackground();
        return { started: true, total };
    },

    /**
     * "Sort now": classifies everything still waiting, not just one batch.
     *
     * @returns The counts, or null when another run holds the lock or no vision service is configured.
     */
    async sortAll(): Promise<{ decided: number; remaining: number } | null> {
        if (!config.vision.url) return null;
        if ((await fileRepository.backlogSize()) === 0) return { decided: 0, remaining: 0 };
        return getPool().transaction(async (tx) => {
            if (!(await schedulerRepository.tryLock(tx))) return null;
            await schedulerRepository.markRun(tx);
            return runUntilEmpty();
        });
    },

    /**
     * One scheduler step. The advisory lock makes this safe with more than one process (FR-042), and the
     * `classified_at` filter makes a second run skip everything the first one decided (FR-041).
     *
     * @param force - Skip the "is it due" check ("sort now").
     * @returns How many files were decided, or null when nothing ran.
     */
    async tick(force = false): Promise<number | null> {
        if (!config.vision.url) return null;
        const backlog = await fileRepository.backlogSize();
        if (!force && !isDue(await schedulerRepository.lastRunAt(), backlog, new Date()))
            return null;
        if (backlog === 0) return 0;

        return getPool().transaction(async (tx) => {
            if (!(await schedulerRepository.tryLock(tx))) return null;
            await schedulerRepository.markRun(tx);
            return runBatch();
        });
    },

    /** Starts the loop. @returns A function that stops it. */
    start(): () => void {
        if (!config.sorting.schedulerEnabled) {
            logger.info('scheduler disabled on this instance');
            return () => undefined;
        }
        void startupRatingPass();
        let ticks = 0;
        const timer = setInterval(() => {
            ticks += 1;
            if (ticks % PURGE_EVERY_TICKS === 0) {
                sessionRepository.purgeEnded(SESSION_RETENTION_DAYS).catch((error: unknown) => {
                    logger.error({ err: error }, 'session purge failed');
                });
            }
            schedulerService.tick().then(
                (n) => {
                    if (n !== null) logger.info({ decided: n }, 'scheduler run finished');
                },
                (error: unknown) => logger.error({ err: error }, 'scheduler run failed'),
            );
        }, TICK_MS);
        timer.unref();
        return () => clearInterval(timer);
    },
};
