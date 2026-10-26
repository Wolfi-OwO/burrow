import { z } from 'zod';

export const profilePatchSchema = z
    .object({
        displayName: z.string().trim().min(1).max(60).optional(),
        bio: z.string().trim().max(500).optional(),
    })
    .strict()
    .refine((v) => v.displayName !== undefined || v.bio !== undefined, 'Nothing to change.');

export const avatarFromFileSchema = z.object({ fileId: z.uuid() }).strict();
