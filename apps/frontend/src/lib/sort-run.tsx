import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { useToast } from '../components/ui.tsx';
import { api } from './api.ts';
import { useServerEvents } from './events.tsx';
import { formatRemaining } from './format.ts';
import { forgetRate, remaining, trackRate } from './transfer-rate.ts';
import type { Rate } from './transfer-rate.ts';

interface Progress {
    done: number;
    total: number;
}

interface SortStatus {
    progress?: { running: boolean; done: number; total: number; startedAt?: string | null };
}

export interface SortRun {
    start: () => void;
    running: boolean;
    progress: Progress | null;
    /** What to show after the counts: "about 12 min left", or nothing yet. */
    timeLeft: (now: number) => string;
}

const Context = createContext<SortRun | null>(null);
const RATE_KEY = 'sort-run';

/**
 * "Sort all now" runs on the server without a time limit and survives a restart, so the button only starts it and
 * the progress comes back as events. The status endpoint tells a page that was opened mid-run (after the browser was
 * closed, say) that one is already going, with how far it got, so it picks the same bar up again. One provider serves
 * every page: the bar in the corner and the sorter panel always agree.
 */
export function SortRunProvider({ children }: { children: ReactNode }): ReactNode {
    const client = useQueryClient();
    const toast = useToast();
    const [progress, setProgress] = useState<Progress | null>(null);
    const [running, setRunning] = useState(false);
    const [rate, setRate] = useState<Rate | undefined>(undefined);
    const startedAt = useRef<number | null>(null);
    const status = useQuery({
        queryKey: ['sort-run'],
        queryFn: () => api<SortStatus>('GET', '/api/sorting/status'),
        staleTime: 0,
        // The event stream is the fast path; asking now and then covers a dropped connection.
        refetchInterval: running ? 5_000 : false,
    });

    const report = (done: number, total: number): void => {
        setProgress({ done, total });
        setRate(trackRate(RATE_KEY, done, total));
    };

    useEffect(() => {
        const p = status.data?.progress;
        if (!p) return;
        if (p.running) {
            setRunning(true);
            if (p.startedAt) startedAt.current = Date.parse(p.startedAt);
            report(p.done, p.total);
        } else if (running) {
            // It ended while no event reached this page.
            setRunning(false);
            forgetRate(RATE_KEY);
            for (const key of ['review', 'tree', 'files', 'sorting', 'ratings'])
                void client.invalidateQueries({ queryKey: [key] });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- reacts to the status only
    }, [status.data]);

    useServerEvents((event) => {
        if (event.type !== 'sorting.progress') return;
        const done = Number(event.data.done);
        const total = Number(event.data.total);
        if (event.data.finished === true) {
            setProgress({ done, total });
            setRunning(false);
            forgetRate(RATE_KEY);
            for (const key of ['review', 'tree', 'files', 'sorting', 'ratings'])
                void client.invalidateQueries({ queryKey: [key] });
            toast.say(`Sorted ${String(done)} file${done === 1 ? '' : 's'}.`);
        } else {
            setRunning(true);
            report(done, total);
        }
    });

    const start = (): void => {
        setRunning(true);
        startedAt.current = Date.now();
        api<{ started: boolean; total: number; reason?: string }>(
            'POST',
            '/api/sorting/run?async=1',
        )
            .then((r) => {
                if (!r.started) {
                    setRunning(r.reason === 'Already sorting.');
                    toast.say(r.reason ?? 'Nothing to sort.');
                } else {
                    report(0, r.total);
                }
            })
            .catch((e: unknown) => {
                setRunning(false);
                toast.say(e instanceof Error ? e.message : 'Could not start the sorter.');
            });
    };

    const value = useMemo<SortRun>(
        () => ({
            start,
            running,
            progress,
            timeLeft: (now) => {
                if (!progress || progress.done >= progress.total) return '';
                // Opened mid-run there is no window of samples yet: the average since the start is the best guess.
                const fallback: Rate | undefined =
                    startedAt.current !== null && progress.done > 0
                        ? {
                              sent: progress.done,
                              total: progress.total,
                              speed: progress.done / Math.max(1, (now - startedAt.current) / 1000),
                              at: now,
                          }
                        : undefined;
                const left = remaining(rate && rate.speed > 0 ? rate : fallback, now);
                if (left.kind === 'eta') return `about ${formatRemaining(left.seconds)} left`;
                return left.kind === 'stalled'
                    ? 'waiting for the sorter'
                    : 'working out the time left';
            },
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `start` only uses setters and the toast
        [running, progress, rate],
    );

    return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useSortRun(): SortRun {
    const value = useContext(Context);
    if (!value) throw new Error('useSortRun needs a SortRunProvider above it.');
    return value;
}
