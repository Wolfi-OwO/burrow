import { z } from 'zod';

export const uploadStartSchema = z
    .object({
        name: z.string().trim().min(1).max(255),
        size: z.number().int().min(0),
        mime: z.string().max(200).optional(),
        categoryId: z.number().int().positive().optional(),
        fingerprint: z.string().max(200).optional(),
    })
    .strict();

export const importUrlSchema = z
    .object({
        url: z.string().trim().min(1).max(2000),
        categoryId: z.number().int().positive().optional(),
        /** Chosen by the page, so it can listen for the progress events before the first one is sent. */
        job: z.uuid().optional(),
    })
    .strict();

export const uploadPieceParams = z.object({
    id: z.uuid(),
    index: z.coerce.number().int().min(0),
});
