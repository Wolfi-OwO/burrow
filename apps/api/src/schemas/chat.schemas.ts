import { z } from 'zod';

export const chatSendSchema = z.object({ message: z.string().trim().min(1).max(1500) }).strict();
