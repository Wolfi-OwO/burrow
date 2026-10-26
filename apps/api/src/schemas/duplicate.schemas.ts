import { z } from 'zod';

const mode = z.enum(['exact', 'similar']);

export const duplicateListSchema = z.object({ mode: mode.default('exact') });
export const duplicateCleanSchema = z.object({ mode }).strict();
export const duplicateResolveSchema = z
    .object({ keepId: z.uuid(), removeIds: z.array(z.uuid()).min(1).max(500) })
    .strict();
export const resortSchema = z.object({ categoryId: z.number().int().positive() }).strict();
