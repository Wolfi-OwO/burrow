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
    // subtree: the folder and every folder below it go; the files are lifted up and never deleted.
    onNonEmpty: z.enum(['block', 'moveUp', 'subtree']).default('block'),
});
export const categoryDeleteManySchema = z
    .object({ ids: z.array(z.number().int().positive()).min(1).max(500) })
    .strict();
