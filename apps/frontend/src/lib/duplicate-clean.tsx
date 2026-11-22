import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { useToast } from '../components/ui.tsx';
import { api } from './api.ts';
import { useServerEvents } from './events.tsx';

type Mode = 'exact' | 'similar';

interface CleanStatus {
    running: boolean;
    mode: Mode | null;
    total: number;
    done: number;
    removed: number;
}

export interface DuplicateClean {
    start: (mode: Mode) => void;
    running: boolean;
    progress: { done: number; total: number } | null;
}

const Context = createContext<DuplicateClean | null>(null);
const LISTS = ['duplicates', 'files', 'tree', 'review', 'sorting'];
/** While files are being removed the lists behind the bar are refreshed this often, not once per file. */
const REFRESH_MS = 2000;

/**
 * "Remove all duplicates" runs on the server and survives a restart, so the button only starts it. The status
 * endpoint tells a page opened mid-run (the browser was closed and opened again) that one is going and how far it got,
 * and the events keep every open page moving, so the bar on this page and in the corner always agree.
 */
export function DuplicateCleanProvider({ children }: { children: ReactNode }): ReactNode {
    const client = useQueryClient();
    const toast = useToast();
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
    const lastRefresh = useRef(0);
    const status = useQuery({
        queryKey: ['duplicate-clean'],
        queryFn: () => api<CleanStatus>('GET', '/api/duplicates/clean'),
        staleTime: 0,
        // The event stream is the fast path; asking now and then covers a dropped connection.
        refetchInterval: running ? 5_000 : false,
    });

    const refresh = (): void => {
        for (const key of LISTS) void client.invalidateQueries({ queryKey: [key] });
    };

    useEffect(() => {
        const s = status.data;
        if (!s) return;
        if (s.running) {
            setRunning(true);
            setProgress({ done: s.done, total: s.total });
        } else if (running) {
            // It ended while no event reached this page.
            setRunning(false);
            refresh();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- reacts to the status only
    }, [status.data]);

    useServerEvents((event) => {
        if (event.type !== 'duplicates.progress') return;
        const done = Number(event.data.done);
        const total = Number(event.data.total);
        const removed = Number(event.data.removed);
        if (event.data.finished === true) {
            setProgress({ done, total });
            setRunning(false);
            refresh();
            void client.invalidateQueries({ queryKey: ['duplicate-clean'] });
            toast.say(
                event.data.failed === true
                    ? 'Removing duplicates stopped with an error.'
                    : `Removed ${String(removed)} duplicate${removed === 1 ? '' : 's'}.`,
            );
            return;
        }
        setRunning(true);
        setProgress({ done, total });
        if (Date.now() - lastRefresh.current >= REFRESH_MS) {
            lastRefresh.current = Date.now();
            refresh();
        }
    });

    const value = useMemo<DuplicateClean>(
        () => ({
            running,
            progress,
            start: (mode) => {
                api<CleanStatus & { started: boolean; reason?: string }>(
                    'POST',
                    '/api/duplicates/clean',
                    { mode },
                )
                    .then((r) => {
                        if (r.started || r.reason === 'Already removing.') {
                            setRunning(true);
                            setProgress({ done: r.done, total: r.total });
                        } else {
                            toast.say(r.reason ?? 'Nothing to remove.');
                        }
                    })
                    .catch((e: unknown) =>
                        toast.say(e instanceof Error ? e.message : 'Could not start removing.'),
                    );
            },
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `start` only uses setters and the toast
        [running, progress],
    );

    return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useDuplicateClean(): DuplicateClean {
    const value = useContext(Context);
    if (!value) throw new Error('useDuplicateClean needs a DuplicateCleanProvider above it.');
    return value;
}
