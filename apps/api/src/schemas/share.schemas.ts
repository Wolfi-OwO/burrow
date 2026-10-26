import { z } from 'zod';

const access = z.enum(['link', 'users']);
/** Hours until the link stops working; null is a permanent link. */
const expiresInHours = z
    .number()
    .int()
    .min(1)
    .max(24 * 365)
    .nullable();

export const shareCreateSchema = z
    .object({
        fileId: z.uuid().optional(),
        categoryId: z.number().int().positive().optional(),
        access,
        expiresInHours: expiresInHours.default(null),
        userIds: z.array(z.uuid()).max(100).default([]),
    })
    .strict()
    .refine((v) => (v.fileId === undefined) !== (v.categoryId === undefined), {
        message: 'Share either a file or a category.',
    });

export const sharePatchSchema = z
    .object({
        access: access.optional(),
        expiresInHours: expiresInHours.optional(),
        userIds: z.array(z.uuid()).max(100).optional(),
        revoked: z.boolean().optional(),
    })
    .strict();

export const userSearchSchema = z.object({ q: z.string().trim().min(2).max(60) });

export const tokenParamSchema = z.object({ token: z.string().min(20).max(80) });
