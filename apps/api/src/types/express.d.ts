import type { AccessTokenPayload } from '../lib/jwt.ts';

// requireAuth (middlewares/auth.ts) attaches the verified claims. Optional on
// purpose: a handler mounted without requireAuth must typecheck as "user may be
// undefined" instead of silently assuming it is set.
declare global {
    namespace Express {
        interface Request {
            user?: AccessTokenPayload;
        }
    }
}

export {};
