import type { Request } from 'express';

import { asyncHandler } from '../lib/errors.ts';
import { logger } from '../lib/logger.ts';
import { publish } from '../lib/events.ts';
import { chatService } from '../services/chat-service.ts';

const uid = (req: Request): string => (req.user as { sub: string }).sub;

/** Accounts whose assistant is answering right now, so a page opened mid-answer knows to wait for it. */
const working = new Set<string>();

export const state = asyncHandler(async (req, res) => {
    res.json({
        ...(await chatService.status()),
        working: working.has(uid(req)),
        messages: await chatService.history(uid(req)),
    });
});

export const clear = asyncHandler(async (req, res) => {
    await chatService.clear(uid(req));
    res.status(204).end();
});

/**
 * The answer streams back as server-sent events on the POST itself, so it ends with the answer. It does not stop when
 * the page goes away: the answer is written down either way, and every open page is told when it is ready, so the
 * person can look at other pages meanwhile.
 */
export const send = asyncHandler(async (req, res) => {
    const { message } = req.body as { message: string };
    const stop = new AbortController();
    const userId = uid(req);
    working.add(userId);
    res.status(200).set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    const write = (event: string, data: unknown): void => {
        if (!res.writableEnded && !res.destroyed)
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    try {
        await chatService.turn(userId, message, stop.signal, (e) => write(e.type, e));
        publish(userId, { type: 'chat.answered', data: { failed: false } });
    } catch (error) {
        publish(userId, { type: 'chat.answered', data: { failed: true } });
        logger.warn({ err: error }, 'assistant turn failed');
        write('failed', {
            message:
                error instanceof Error && 'status' in error
                    ? error.message
                    : 'The assistant could not answer. Try again in a moment.',
        });
    } finally {
        working.delete(userId);
    }
    res.end();
});

/** The person's yes or no to an action that changes or removes something and was waiting for it. */
export const answerAction = asyncHandler(async (req, res) => {
    const { decision } = req.body as { decision: 'confirm' | 'decline' };
    res.json({
        action: await chatService.resolveAction(
            uid(req),
            Number(req.params.id),
            Number(req.params.index),
            decision,
        ),
    });
});
