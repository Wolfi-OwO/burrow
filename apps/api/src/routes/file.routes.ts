import { Router } from 'express';

import { openStream } from '../lib/events.ts';
import * as file from '../handlers/file.handlers.ts';
import * as uploads from '../handlers/upload.handlers.ts';
import * as sorting from '../handlers/sorting.handlers.ts';
import { requireAuth } from '../middlewares/auth.ts';
import { uploadRateLimiter } from '../middlewares/rate-limit.ts';
import { uploadFile } from '../middlewares/upload.ts';
import { validateBody, validateIdParam, validateQuery } from '../middlewares/validate.ts';
import { uploadStartSchema } from '../schemas/upload.schemas.ts';
import {
    fileListQuerySchema,
    filePatchSchema,
    reviewResolveSchema,
    searchQuerySchema,
    unzipSchema,
} from '../schemas/file.schemas.ts';

export const fileRouter = Router();
fileRouter.use(requireAuth);

fileRouter.get('/events', (req, res) => openStream((req.user as { sub: string }).sub, req, res));
// Chunked upload for big files: announce, send pieces (any order, several at a time), finish.
fileRouter.post('/uploads', uploadRateLimiter, validateBody(uploadStartSchema), uploads.start);
fileRouter.get('/uploads/:id', uploads.status);
fileRouter.put('/uploads/:id/chunks/:index', uploads.piece);
fileRouter.post('/uploads/:id/complete', uploads.finish);

fileRouter.get('/files', validateQuery(fileListQuerySchema), file.list);
fileRouter.post('/files', uploadRateLimiter, ...uploadFile, file.upload);
fileRouter.get('/files/types', file.typeCounts);
fileRouter.post('/files/unzip', validateBody(unzipSchema), file.unzip);
fileRouter.get('/files/:id', validateIdParam(), file.get);
fileRouter.get('/files/:id/content', validateIdParam(), file.content);
fileRouter.get('/files/:id/thumbnail', validateIdParam(), file.thumbnail);
fileRouter.patch('/files/:id', validateIdParam(), validateBody(filePatchSchema), file.patch);
fileRouter.delete('/files/:id', validateIdParam(), file.remove);

fileRouter.get('/search', validateQuery(searchQuerySchema), file.search);

fileRouter.get('/review', sorting.reviewQueue);
fileRouter.post(
    '/review/:id',
    validateIdParam(),
    validateBody(reviewResolveSchema),
    sorting.reviewResolve,
);

fileRouter.get('/sorting/status', sorting.status);
fileRouter.post('/sorting/run', sorting.sortNow);
fileRouter.get('/sorting/unplaced', sorting.unplacedKinds);
fileRouter.post('/sorting/type-folders', sorting.createTypeFolders);
