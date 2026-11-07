import type { Request } from 'express';

import { asyncHandler } from '../lib/errors.ts';
import { importService } from '../services/import-service.ts';

const uid = (req: Request): string => (req.user as { sub: string }).sub;

/** Starts downloading a link into the drive; the answer is the job id and the page follows the event stream. */
export const importFromLink = asyncHandler(async (req, res) => {
    const { url, categoryId, job } = req.body as { url: string; categoryId?: number; job?: string };
    const started = await importService.start(uid(req), {
        url,
        categoryId: categoryId ?? null,
        ...(job ? { job } : {}),
    });
    res.status(202).json({ job: started.job });
});
