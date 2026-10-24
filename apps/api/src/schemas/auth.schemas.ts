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
    .object({ username, password, displayName: z.string().trim().min(1).max(60).optional() })
    .strict();
export const loginSchema = z
    .object({ username: z.string().trim().min(1).max(64), password: z.string().min(1).max(128) })
    .strict();
export const changePasswordSchema = z
    .object({ currentPassword: z.string().max(128).optional(), newPassword: password })
    .strict();
