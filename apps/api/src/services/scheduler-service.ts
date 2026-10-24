import { config } from '../config/index.ts';
import { getPool } from '../database/connection.ts';
import { logger } from '../lib/logger.ts';
import { fileRepository } from '../repository/file.repository.ts';
import { sessionRepository } from '../repository/session.repository.ts';
import { schedulerRepository } from '../repository/scheduler.repository.ts';
import { classificationService } from './classification-service.ts';

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
    for (const file of await fileRepository.nextBacklog(config.sorting.batchSize)) {
        if (await classificationService.classify(file)) decided += 1;
    }
    return decided;
}

export const schedulerService = {
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
