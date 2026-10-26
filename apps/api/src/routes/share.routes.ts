import { Router } from 'express';

import * as share from '../handlers/share.handlers.ts';
import { optionalAuth, requireAuth } from '../middlewares/auth.ts';
import { validateBody, validateIdParam, validateQuery } from '../middlewares/validate.ts';
import { shareCreateSchema, sharePatchSchema, userSearchSchema } from '../schemas/share.schemas.ts';

/** Managing links: signed-in owners only. */
export const shareRouter = Router();
shareRouter.post('/shares', requireAuth, validateBody(shareCreateSchema), share.create);
shareRouter.get('/shares', requireAuth, share.listMine);
shareRouter.patch(
    '/shares/:id',
    requireAuth,
    validateIdParam(),
    validateBody(sharePatchSchema),
    share.update,
);
shareRouter.delete('/shares/:id', requireAuth, validateIdParam(), share.remove);
shareRouter.get('/shared-with-me', requireAuth, share.sharedWithMe);
shareRouter.get('/users/search', requireAuth, validateQuery(userSearchSchema), share.searchUsers);

/** Opening a link: open to anyone holding it, with the access rule enforced inside the service. */
export const publicShareRouter = Router();
publicShareRouter.get('/s/:token', optionalAuth, share.open);
publicShareRouter.get('/s/:token/files/:fileId/content', optionalAuth, share.content);
publicShareRouter.get('/s/:token/files/:fileId/thumbnail', optionalAuth, share.thumbnail);
