import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import { useToast } from '../components/ui.tsx';
import { currentAccessToken, refreshSession } from './api.ts';
import { useAuth } from './auth.tsx';

export interface ServerEvent {
    type: string;
    data: Record<string, unknown>;
}
type Listener = (event: ServerEvent) => void;

const EventsContext = createContext<(listener: Listener) => () => void>(() => () => undefined);

/** Subscribes a component to what the server pushes (upload progress, sorting results) while it is mounted. */
export function useServerEvents(listener: Listener): void {
    const subscribe = useContext(EventsContext);
    const latest = useRef(listener);
    latest.current = listener;
    useEffect(() => subscribe((event) => latest.current(event)), [subscribe]);
}

/** Reads one `text/event-stream` body and hands each complete event to `onEvent`. */
async function readStream(body: ReadableStream<Uint8Array>, onEvent: Listener): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
        const chunk = await reader.read();
        if (chunk.done) return;
        buffer += decoder.decode(chunk.value, { stream: true });
        let end = buffer.indexOf('\n\n');
        while (end !== -1) {
            const block = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const type = /^event: (.+)$/m.exec(block)?.[1];
            const data = /^data: (.+)$/m.exec(block)?.[1];
            if (type && data) {
                try {
                    onEvent({ type, data: JSON.parse(data) as Record<string, unknown> });
                } catch {
                    // a malformed event is skipped, the stream goes on
                }
            }
            end = buffer.indexOf('\n\n');
        }
    }
}

/**
 * One event stream per signed-in page. EventSource cannot send the bearer header, so the stream is a fetch that is
 * reopened (after a refresh when the token ran out) whenever it ends. Results that matter wherever you are on the
 * site arrive as a toast; pages that show progress subscribe with `useServerEvents`.
 */
export function EventsProvider({ children }: { children: ReactNode }): ReactNode {
    const { user } = useAuth();
    const toast = useToast();
    const client = useQueryClient();
    const listeners = useRef(new Set<Listener>());
    const subscribe = useCallback((listener: Listener) => {
        listeners.current.add(listener);
        return () => {
            listeners.current.delete(listener);
        };
    }, []);

    useEffect(() => {
        if (!user) return;
        const stop = new AbortController();
        const onEvent: Listener = (event) => {
            for (const listener of listeners.current) listener(event);
            if (event.type === 'upload.done') {
                toast.say(
                    `${String(event.data.name)}: ${String(event.data.extracted)} files unpacked.`,
                );
                for (const key of ['files', 'tree', 'sorting'])
                    void client.invalidateQueries({ queryKey: [key] });
            } else if (event.type === 'upload.failed') {
                toast.say(`${String(event.data.name)} could not be unpacked.`);
            } else if (event.type === 'sorting.done') {
                const n = Number(event.data.decided);
                toast.say(`The sorter decided ${String(n)} file${n === 1 ? '' : 's'}.`);
                for (const key of ['files', 'tree', 'review', 'sorting'])
                    void client.invalidateQueries({ queryKey: [key] });
            }
        };
        void (async () => {
            while (!stop.signal.aborted) {
                try {
                    const response = await fetch('/api/events', {
                        headers: { Authorization: `Bearer ${currentAccessToken() ?? ''}` },
                        signal: stop.signal,
                    });
                    if (response.status === 401) await refreshSession();
                    else if (response.ok && response.body) await readStream(response.body, onEvent);
                } catch {
                    // dropped connection or aborted: fall through to the pause and try again
                }
                if (!stop.signal.aborted) await new Promise((resolve) => setTimeout(resolve, 3000));
            }
        })();
        return () => stop.abort();
    }, [user, toast, client]);

    return <EventsContext.Provider value={subscribe}>{children}</EventsContext.Provider>;
}
