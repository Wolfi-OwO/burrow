import type { Request, Response } from 'express';

/** What the server tells a signed-in user about, as it happens. */
export interface UserEvent {
    type: 'upload.progress' | 'upload.done' | 'upload.failed' | 'sorting.done';
    data: Record<string, unknown>;
}

const HEARTBEAT_MS = 25_000;
const streams = new Map<string, Set<Response>>();

/** Sends an event to every open page of one user (nothing happens when none is open). */
export function publish(userId: string, event: UserEvent): void {
    const line = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
    for (const res of streams.get(userId) ?? []) res.write(line);
}

/** Server-sent events for the signed-in user; the page keeps one open and shows what arrives. */
export function openStream(userId: string, req: Request, res: Response): void {
    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        // Tell a proxy in front (Caddy, nginx) not to hold the stream back.
        'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    const set = streams.get(userId) ?? new Set<Response>();
    set.add(res);
    streams.set(userId, set);
    const beat = setInterval(() => res.write(': keep-alive\n\n'), HEARTBEAT_MS);
    req.on('close', () => {
        clearInterval(beat);
        set.delete(res);
        if (set.size === 0) streams.delete(userId);
    });
}
