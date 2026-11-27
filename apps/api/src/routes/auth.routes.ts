import { Router } from 'express';

import * as auth from '../handlers/auth.handlers.ts';
import * as oauth from '../handlers/oauth.handlers.ts';
import * as passkey from '../handlers/passkey.handlers.ts';
import { requireAuth } from '../middlewares/auth.ts';
import { requireCsrfHeader } from '../middlewares/csrf.ts';
import { loginRateLimiter } from '../middlewares/rate-limit.ts';
import { validateBody } from '../middlewares/validate.ts';
import {
    changePasswordSchema,
    loginSchema,
    passkeyLoginSchema,
    passkeyRegisterSchema,
    registerSchema,
} from '../schemas/auth.schemas.ts';

export const authRouter = Router();

authRouter.post('/register', loginRateLimiter, validateBody(registerSchema), auth.register);
authRouter.post('/login', loginRateLimiter, validateBody(loginSchema), auth.login);
authRouter.post('/refresh', requireCsrfHeader, auth.refresh);
authRouter.post('/logout', requireCsrfHeader, requireAuth, auth.logout);
authRouter.post('/password', requireAuth, validateBody(changePasswordSchema), auth.changePassword);

// Passkeys: registered before `/:provider` for the same reason as /providers below.
authRouter.get('/passkeys', requireAuth, passkey.list);
authRouter.delete('/passkeys/:id', requireAuth, passkey.remove);
authRouter.post('/passkeys/register/options', requireAuth, passkey.registrationOptions);
authRouter.post(
    '/passkeys/register',
    requireAuth,
    validateBody(passkeyRegisterSchema),
    passkey.finishRegistration,
);
authRouter.post('/passkey/options', loginRateLimiter, passkey.authenticationOptions);
authRouter.post(
    '/passkey/login',
    loginRateLimiter,
    validateBody(passkeyLoginSchema),
    passkey.finishAuthentication,
);

// Registered before `/:provider`, which would otherwise swallow it.
authRouter.get('/providers', auth.providers);
authRouter.get('/:provider', oauth.oauthStart);
authRouter.get('/:provider/callback', oauth.oauthCallback);
