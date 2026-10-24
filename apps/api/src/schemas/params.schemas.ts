import { z } from 'zod';

/** A `:id` route parameter that must be a UUID. */
export const idParamSchema = z.object({ id: z.uuid() });

/** A `:id` route parameter that must be a positive integer (category ids). */
export const numericIdParamSchema = z.object({ id: z.coerce.number().int().positive() });
