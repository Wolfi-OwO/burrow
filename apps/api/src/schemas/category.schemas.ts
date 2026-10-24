import { z } from 'zod';

const name = z.string().trim().min(1).max(120);

export const categoryCreateSchema = z
    .object({
        name,
        parentId: z.number().int().positive().nullable().default(null),
        publicPreview: z.boolean().default(false),
    })
    .strict();
export const categoryPatchSchema = z
    .object({ name: name.optional(), publicPreview: z.boolean().optional() })
    .strict()
    .refine((v) => v.name !== undefined || v.publicPreview !== undefined, 'Nothing to change.');
export const categoryMoveSchema = z
    .object({ parentId: z.number().int().positive().nullable() })
    .strict();
export const categoryDeleteQuerySchema = z.object({
    onNonEmpty: z.enum(['block', 'moveUp']).default('block'),
});
