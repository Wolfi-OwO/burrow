import { Router } from 'express';

import * as auth from '../handlers/auth.handlers.ts';
import * as oauth from '../handlers/oauth.handlers.ts';
import { requireAuth } from '../middlewares/auth.ts';
import { requireCsrfHeader } from '../middlewares/csrf.ts';
import { loginRateLimiter } from '../middlewares/rate-limit.ts';
import { validateBody } from '../middlewares/validate.ts';
import { changePasswordSchema, loginSchema, registerSchema } from '../schemas/auth.schemas.ts';

export const authRouter = Router();

authRouter.post('/register', loginRateLimiter, validateBody(registerSchema), auth.register);
authRouter.post('/login', loginRateLimiter, validateBody(loginSchema), auth.login);
authRouter.post('/refresh', requireCsrfHeader, auth.refresh);
authRouter.post('/logout', requireCsrfHeader, requireAuth, auth.logout);
authRouter.post('/password', requireAuth, validateBody(changePasswordSchema), auth.changePassword);

// Registered before `/:provider`, which would otherwise swallow it.
authRouter.get('/providers', auth.providers);
authRouter.get('/:provider', oauth.oauthStart);
authRouter.get('/:provider/callback', oauth.oauthCallback);
