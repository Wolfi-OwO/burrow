import { z } from 'zod';

export const uploadStartSchema = z
    .object({
        name: z.string().trim().min(1).max(255),
        size: z.number().int().min(0),
        mime: z.string().max(200).optional(),
        categoryId: z.number().int().positive().optional(),
    })
    .strict();

export const uploadPieceParams = z.object({
    id: z.uuid(),
    index: z.coerce.number().int().min(0),
});
