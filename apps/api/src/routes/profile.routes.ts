import { Router } from 'express';

import * as oauth from '../handlers/oauth.handlers.ts';
import * as profile from '../handlers/profile.handlers.ts';
import { requireAuth } from '../middlewares/auth.ts';
import { exportRateLimiter, uploadRateLimiter } from '../middlewares/rate-limit.ts';
import { uploadAvatar } from '../middlewares/upload.ts';
import { validateBody, validateIdParam } from '../middlewares/validate.ts';
import {
    avatarFromFileSchema,
    deleteAccountSchema,
    profilePatchSchema,
} from '../schemas/profile.schemas.ts';

/**
 * Its own router, mounted ahead of every router that demands a session (several are mounted at /api and would answer
 * 401 first): a browser navigation cannot send the bearer header, the signed ticket in the link is the credential.
 */
export const exportDownloadRouter = Router();
exportDownloadRouter.get('/me/export/download', exportRateLimiter, profile.exportDownload);

export const profileRouter = Router();
profileRouter.use(requireAuth);

profileRouter.get('/me', profile.getMe);
profileRouter.patch('/me', validateBody(profilePatchSchema), profile.patchMe);
profileRouter.get('/me/storage', profile.getStorage);
profileRouter.get('/me/export', exportRateLimiter, profile.exportData);
profileRouter.post('/me/export/ticket', exportRateLimiter, profile.exportTicket);
profileRouter.delete('/me', validateBody(deleteAccountSchema), profile.deleteMe);
profileRouter.put('/me/avatar', uploadRateLimiter, ...uploadAvatar, profile.putAvatar);
profileRouter.post(
    '/me/avatar/from-file',
    validateBody(avatarFromFileSchema),
    profile.avatarFromFile,
);
profileRouter.get('/me/identities', oauth.listIdentities);
profileRouter.post('/me/identities/:provider/link', oauth.linkStart);
profileRouter.delete('/me/identities/:provider', oauth.unlinkIdentity);

profileRouter.get('/users/:id', validateIdParam(), profile.getProfile);
profileRouter.get('/users/:id/avatar', validateIdParam(), profile.getAvatar);
