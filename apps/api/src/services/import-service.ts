import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

import { config } from '../config/index.ts';
import { AppError, BadRequestError, ForbiddenError, NotFoundError } from '../lib/errors.ts';
import { publish } from '../lib/events.ts';
import { logger } from '../lib/logger.ts';
import { checkTarget, downloadTo, LinkRefused, nameFromResponse } from '../lib/safe-fetch.ts';
import { categoryRepository } from '../repository/category.repository.ts';
import { fileRepository } from '../repository/file.repository.ts';
import { fileService } from './file-service.ts';

const staging = join(config.storage.dir, 'tmp', 'imports');
mkdirSync(staging, { recursive: true });

/** How many links each account has downloading right now. */
const running = new Map<string, number>();

/** What to call the row on the page until the server has said what the file is really called. */
function provisionalName(link: string): string {
    try {
        return nameFromResponse({}, new URL(link));
    } catch {
        return 'link';
    }
}

/** Downloads one link and takes the file into the drive exactly like an upload; reports on the account's event stream. */
async function run(
    userId: string,
    job: string,
    link: string,
    categoryId: number | null,
): Promise<void> {
    const destination = join(staging, job);
    let name = provisionalName(link);
    publish(userId, { type: 'import.progress', data: { job, name, seen: 0, total: 0 } });
    try {
        const got = await downloadTo(link, destination, {
            maxBytes: Math.min(config.importUrl.maxBytes, config.maxFileBytes),
            allowPrivate: config.importUrl.allowPrivate,
            onProgress: (seen, total) =>
                publish(userId, { type: 'import.progress', data: { job, name, seen, total } }),
        });
        name = got.name;
        if (/\.zip$/i.test(name)) {
            // A zip is unpacked like an uploaded one, and reports the same way.
            publish(userId, { type: 'upload.progress', data: { job, name, seen: 0, total: 0 } });
            const archive = await fileService.uploadArchive(
                userId,
                got.path,
                (seen, total) =>
                    publish(userId, { type: 'upload.progress', data: { job, name, seen, total } }),
                categoryId,
            );
            publish(userId, {
                type: 'upload.done',
                data: { job, name, extracted: archive.extracted, skipped: archive.skipped },
            });
            return;
        }
        const result = await fileService.upload(userId, got.path, got.size, name, got.mime);
        if (categoryId !== null)
            await fileRepository.setCategory(userId, result.file.id, categoryId);
        publish(userId, {
            type: 'import.done',
            data: { job, name, duplicate: result.deduplicated },
        });
    } catch (error) {
        await rm(destination, { force: true });
        if (!(error instanceof LinkRefused)) logger.warn({ err: error }, 'link import failed');
        publish(userId, {
            type: 'import.failed',
            data: {
                job,
                name,
                message:
                    error instanceof LinkRefused
                        ? error.message
                        : 'The file could not be imported.',
            },
        });
    }
}

export const importService = {
    /**
     * Checks the link at once (so an obviously bad one is answered in the request) and starts the download in the
     * background.
     *
     * @returns The job id that the progress events carry.
     */
    async start(
        userId: string,
        input: { url: string; categoryId: number | null; job?: string },
    ): Promise<{ job: string; done: Promise<void> }> {
        if (!config.importUrl.enabled)
            throw new ForbiddenError('Importing from a link is switched off on this server.');
        if ((running.get(userId) ?? 0) >= config.importUrl.maxPerUser)
            throw new AppError(
                429,
                `Only ${String(config.importUrl.maxPerUser)} links can be imported at a time; wait for one to finish.`,
            );
        if (
            input.categoryId !== null &&
            !(await categoryRepository.findById(userId, input.categoryId))
        )
            throw new NotFoundError('Category not found.');
        try {
            await checkTarget(input.url, config.importUrl.allowPrivate);
        } catch (error) {
            if (error instanceof LinkRefused) throw new BadRequestError(error.message);
            throw error;
        }
        const job = input.job ?? randomUUID();
        running.set(userId, (running.get(userId) ?? 0) + 1);
        const done = run(userId, job, input.url, input.categoryId).finally(() => {
            const left = (running.get(userId) ?? 1) - 1;
            if (left <= 0) running.delete(userId);
            else running.set(userId, left);
        });
        return { job, done };
    },
};
