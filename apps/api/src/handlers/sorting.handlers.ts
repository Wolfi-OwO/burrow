import type { Request } from 'express';

import { config } from '../config/index.ts';
import { asyncHandler, NotFoundError } from '../lib/errors.ts';
import { visionClient } from '../lib/vision-client.ts';
import { categoryRepository } from '../repository/category.repository.ts';
import { fileRepository } from '../repository/file.repository.ts';
import { schedulerRepository } from '../repository/scheduler.repository.ts';
import { fileService } from '../services/file-service.ts';
import { intervalMs, runsPerDay, schedulerService } from '../services/scheduler-service.ts';

const uid = (req: Request): string => (req.user as { sub: string }).sub;

export const reviewQueue = asyncHandler(async (req, res) => {
    res.json({ files: await fileRepository.listReview(uid(req)) });
});

/**
 * FR-044: accept the suggestion, pick another category, or leave the file unsorted. In every case
 * `classified_at` stays set, so the item never returns to a scheduler run (FR-045).
 */
export const reviewResolve = asyncHandler(async (req, res) => {
    const { action, categoryId } = req.body as {
        action: 'accept' | 'move' | 'leave';
        categoryId?: number;
    };
    const user = uid(req);
    const file = await fileRepository.findById(user, req.params.id as string);
    if (file?.status !== 'review') throw new NotFoundError('That file is not waiting for review.');

    if (action === 'accept') {
        if (file.suggestedCategoryId === null)
            throw new NotFoundError('There is no suggestion to accept.');
        await fileService.move(user, file.id, file.suggestedCategoryId);
    } else if (action === 'move') {
        await fileService.move(user, file.id, categoryId as number);
    } else {
        await fileRepository.leaveUnsorted(user, file.id);
    }
    res.json(await fileService.get(user, file.id));
});

/** "Sort now": works through everything waiting in unsorted, regardless of the schedule. */
export const sortNow = asyncHandler(async (_req, res) => {
    const result = await schedulerService.sortAll();
    res.json({
        ran: result !== null,
        decided: result?.decided ?? 0,
        remaining: result?.remaining ?? 0,
    });
});

export const status = asyncHandler(async (req, res) => {
    const backlog = await fileRepository.backlogSize();
    res.json({
        backlog,
        categories: (await categoryRepository.listTree(uid(req))).length,
        runsPerDay: runsPerDay(backlog),
        intervalMinutes: Math.round(intervalMs(backlog) / 60_000),
        lastRunAt: await schedulerRepository.lastRunAt(),
        visionConfigured: Boolean(config.vision.url),
        visionHealthy: await visionClient.isHealthy(),
        autoFileThreshold: config.sorting.autoFileThreshold,
    });
});
