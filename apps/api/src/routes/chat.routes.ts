import { Router } from 'express';
import rateLimit from 'express-rate-limit';

import { config } from '../config/index.ts';
import * as chat from '../handlers/chat.handlers.ts';
import { requireAuth } from '../middlewares/auth.ts';
import { validateBody } from '../middlewares/validate.ts';
import { chatActionSchema, chatSendSchema } from '../schemas/chat.schemas.ts';

export const chatRouter = Router();
chatRouter.use(requireAuth);

// Each answer costs seconds of the server's CPU.
const chatRateLimiter = rateLimit({
    windowMs: 60_000,
    limit: () => config.llm.rateLimitMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many messages. Wait a minute.' },
});

chatRouter.get('/chat', chat.state);
chatRouter.post('/chat', chatRateLimiter, validateBody(chatSendSchema), chat.send);
chatRouter.delete('/chat', chat.clear);
chatRouter.post(
    '/chat/messages/:id(\\d+)/actions/:index(\\d+)',
    validateBody(chatActionSchema),
    chat.answerAction,
);
