import { Router } from 'express';

import * as category from '../handlers/category.handlers.ts';
import { requireAuth } from '../middlewares/auth.ts';
import { validateBody, validateQuery } from '../middlewares/validate.ts';
import {
    categoryCreateSchema,
    categoryDeleteQuerySchema,
    categoryMoveSchema,
    categoryPatchSchema,
} from '../schemas/category.schemas.ts';
import { numericIdParamSchema } from '../schemas/params.schemas.ts';
import { NotFoundError } from '../lib/errors.ts';

export const categoryRouter = Router();
categoryRouter.use(requireAuth);

// A malformed id is a 404, same as a missing one (no probing of what exists).
categoryRouter.param('id', (req, _res, next) => {
    next(numericIdParamSchema.safeParse(req.params).success ? undefined : new NotFoundError());
});

categoryRouter.get('/', category.tree);
categoryRouter.post('/', validateBody(categoryCreateSchema), category.create);
categoryRouter.patch('/:id', validateBody(categoryPatchSchema), category.patch);
categoryRouter.post('/:id/move', validateBody(categoryMoveSchema), category.move);
categoryRouter.delete('/:id', validateQuery(categoryDeleteQuerySchema), category.remove);
