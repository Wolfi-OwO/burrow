import { z } from 'zod';

export const profilePatchSchema = z
    .object({
        displayName: z.string().trim().min(1).max(60).optional(),
        bio: z.string().trim().max(500).optional(),
        nsfwOptIn: z.boolean().optional(),
    })
    .strict()
    .refine(
        (v) => v.displayName !== undefined || v.bio !== undefined || v.nsfwOptIn !== undefined,
        'Nothing to change.',
    );

export const avatarFromFileSchema = z.object({ fileId: z.uuid() }).strict();

/** Deleting an account is irreversible, so the request repeats the username; a password account also proves it. */
export const deleteAccountSchema = z
    .object({ username: z.string().min(1).max(100), password: z.string().max(200).optional() })
    .strict();
