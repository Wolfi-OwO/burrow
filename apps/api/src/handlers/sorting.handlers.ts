import type { Request } from 'express';

import { config } from '../config/index.ts';
import { blobStore } from '../lib/blob-store.ts';
import { asyncHandler, ConflictError, NotFoundError } from '../lib/errors.ts';
import { typeOfFile } from '../lib/file-types.ts';
import type { FileType } from '../lib/file-types.ts';
import { sniffMime } from '../lib/sniff.ts';
import { folderForFile, KIND_FOLDER_NAME } from '../lib/type-folders.ts';
import { visionClient } from '../lib/vision-client.ts';
import { categoryRepository } from '../repository/category.repository.ts';
import { fileRepository } from '../repository/file.repository.ts';
import { schedulerRepository } from '../repository/scheduler.repository.ts';
import { categoryService } from '../services/category-service.ts';
import { fileService } from '../services/file-service.ts';
import {
    intervalMs,
    runsPerDay,
    schedulerService,
    sortJob,
} from '../services/scheduler-service.ts';

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
export const sortNow = asyncHandler(async (req, res) => {
    // The page asks for ?async=1: the sorter runs in the background and the page follows it on the event stream.
    if (req.query.async === '1') {
        res.status(202).json(await schedulerService.startSortAll());
        return;
    }
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
        running: sortJob().running,
        progress: sortJob(),
    });
});

/** What is stuck in Unsorted because no folder fits its type, grouped by the kind a new folder would be named after. */
async function unplaced(userId: string): Promise<Map<FileType, number>> {
    const categories = await categoryRepository.listAll(userId);
    const counts = new Map<FileType, number>();
    for (const file of await fileRepository.listUnfiledNonPictures(userId)) {
        let mime = file.mime;
        if (mime === 'application/octet-stream')
            mime =
                (await sniffMime(await blobStore.ensureLocal(file.blobSha256)).catch(() => null)) ??
                mime;
        if (folderForFile({ name: file.name, mime }, categories)) continue;
        const kind = typeOfFile(file.name, mime);
        counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    return counts;
}

export const unplacedKinds = asyncHandler(async (req, res) => {
    const counts = await unplaced(uid(req));
    res.json({
        total: [...counts.values()].reduce((a, b) => a + b, 0),
        kinds: [...counts].map(([kind, count]) => ({ kind, name: KIND_FOLDER_NAME[kind], count })),
    });
});

/** One folder per kind that has none, then the files are sent through the sorter again. */
export const createTypeFolders = asyncHandler(async (req, res) => {
    const userId = uid(req);
    const created: string[] = [];
    for (const kind of (await unplaced(userId)).keys()) {
        try {
            await categoryService.create(userId, null, KIND_FOLDER_NAME[kind]);
            created.push(KIND_FOLDER_NAME[kind]);
        } catch (error) {
            // a folder with that name already exists next to the others: the sorter will use it
            if (!(error instanceof ConflictError)) throw error;
        }
    }
    await fileRepository.requeueUnsorted();
    res.status(201).json({ created, sorting: await schedulerService.startSortAll() });
});
