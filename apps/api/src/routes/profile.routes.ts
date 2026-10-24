import { Router } from 'express';

import * as oauth from '../handlers/oauth.handlers.ts';
import * as profile from '../handlers/profile.handlers.ts';
import { requireAuth } from '../middlewares/auth.ts';
import { uploadRateLimiter } from '../middlewares/rate-limit.ts';
import { uploadAvatar } from '../middlewares/upload.ts';
import { validateBody, validateIdParam } from '../middlewares/validate.ts';
import { profilePatchSchema } from '../schemas/profile.schemas.ts';

export const profileRouter = Router();
profileRouter.use(requireAuth);

profileRouter.get('/me', profile.getMe);
profileRouter.patch('/me', validateBody(profilePatchSchema), profile.patchMe);
profileRouter.put('/me/avatar', uploadRateLimiter, ...uploadAvatar, profile.putAvatar);
profileRouter.get('/me/identities', oauth.listIdentities);
profileRouter.post('/me/identities/:provider/link', oauth.linkStart);
profileRouter.delete('/me/identities/:provider', oauth.unlinkIdentity);

profileRouter.get('/users/:id', validateIdParam(), profile.getProfile);
profileRouter.get('/users/:id/avatar', validateIdParam(), profile.getAvatar);
