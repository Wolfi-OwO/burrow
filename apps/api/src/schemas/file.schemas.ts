import { z } from 'zod';

export const fileListQuerySchema = z.object({
    category: z.union([z.literal('unsorted'), z.coerce.number().int().positive()]).optional(),
    status: z.enum(['unsorted', 'sorted', 'review']).optional(),
    subtree: z
        .enum(['true', 'false'])
        .default('false')
        .transform((v) => v === 'true'),
    limit: z.coerce.number().int().min(1).max(200).default(60),
    offset: z.coerce.number().int().min(0).default(0),
});
export const filePatchSchema = z
    .object({
        name: z.string().trim().min(1).max(255).optional(),
        categoryId: z.number().int().positive().nullable().optional(),
    })
    .strict()
    .refine((v) => v.name !== undefined || v.categoryId !== undefined, 'Nothing to change.');
export const searchQuerySchema = z.object({
    q: z.string().trim().min(1).max(200),
    limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const reviewResolveSchema = z
    .object({
        action: z.enum(['accept', 'move', 'leave']),
        categoryId: z.number().int().positive().optional(),
    })
    .strict()
    .refine(
        (v) => v.action !== 'move' || v.categoryId !== undefined,
        'categoryId is required to move.',
    );
