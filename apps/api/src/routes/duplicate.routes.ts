import { Router } from 'express';

import * as duplicates from '../handlers/duplicate.handlers.ts';
import { requireAuth } from '../middlewares/auth.ts';
import { validateBody, validateQuery } from '../middlewares/validate.ts';
import {
    duplicateCleanSchema,
    duplicateListSchema,
    duplicateResolveSchema,
    resortSchema,
} from '../schemas/duplicate.schemas.ts';

export const duplicateRouter = Router();
duplicateRouter.use(requireAuth);

duplicateRouter.get('/duplicates', validateQuery(duplicateListSchema), duplicates.list);
duplicateRouter.post(
    '/duplicates/resolve',
    validateBody(duplicateResolveSchema),
    duplicates.resolve,
);
duplicateRouter.post('/duplicates/clean', validateBody(duplicateCleanSchema), duplicates.clean);

duplicateRouter.get('/sorting/ratings', duplicates.ratingPreview);
duplicateRouter.post('/sorting/ratings', duplicates.ratingFix);
duplicateRouter.post('/sorting/resort', validateBody(resortSchema), duplicates.resort);
duplicateRouter.post('/sorting/unsort-all', duplicates.unsortAll);
