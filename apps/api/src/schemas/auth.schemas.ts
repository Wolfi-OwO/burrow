import { z } from 'zod';

const username = z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[A-Za-z0-9._-]+$/, 'Use letters, digits, dots, dashes and underscores.');
/** Long over clever: a length floor, no composition rules. */
const password = z.string().min(12, 'Use at least 12 characters.').max(128);

export const registerSchema = z
    .object({
        username,
        password,
        displayName: z.string().trim().min(1).max(60).optional(),
    })
    .strict();
export const loginSchema = z
    .object({
        username: z.string().trim().min(1).max(64),
        password: z.string().min(1).max(128),
        /** Only on the one retry after a refusal that said legacyLogin: the password as typed. */
        legacyPassword: z.string().min(1).max(128).optional(),
    })
    .strict();
export const changePasswordSchema = z
    .object({
        currentPassword: z.string().max(128).optional(),
        currentLegacyPassword: z.string().max(128).optional(),
        newPassword: password,
    })
    .strict();

/** The answers come from the browser's WebAuthn API; the library checks their content, this only bounds them. */
const webauthnResponse = z.record(z.string(), z.unknown());
export const passkeyRegisterSchema = z
    .object({
        ceremonyId: z.uuid(),
        name: z.string().trim().max(60).default('Passkey'),
        response: webauthnResponse,
    })
    .strict();
export const passkeyLoginSchema = z
    .object({ ceremonyId: z.uuid(), response: webauthnResponse })
    .strict();
