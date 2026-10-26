import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { useToast } from '../components/ui.tsx';
import { api } from './api.ts';
import { useServerEvents } from './events.tsx';

interface Progress {
    done: number;
    total: number;
}

/**
 * "Sort all now" runs on the server without a time limit, so the button only starts it and the progress comes back
 * as events. The status endpoint tells a page that was opened mid-run that one is already going.
 */
export function useSortRun(): {
    start: () => void;
    running: boolean;
    progress: Progress | null;
} {
    const client = useQueryClient();
    const toast = useToast();
    const [progress, setProgress] = useState<Progress | null>(null);
    const [running, setRunning] = useState(false);
    const status = useQuery({
        queryKey: ['sort-run'],
        queryFn: () =>
            api<{ progress?: { running: boolean; done: number; total: number } }>(
                'GET',
                '/api/sorting/status',
            ),
        staleTime: 0,
    });

    useEffect(() => {
        const p = status.data?.progress;
        if (p?.running) {
            setRunning(true);
            setProgress({ done: p.done, total: p.total });
        }
    }, [status.data]);

    useServerEvents((event) => {
        if (event.type !== 'sorting.progress') return;
        const done = Number(event.data.done);
        const total = Number(event.data.total);
        setProgress({ done, total });
        if (event.data.finished === true) {
            setRunning(false);
            for (const key of ['review', 'tree', 'files', 'sorting', 'ratings'])
                void client.invalidateQueries({ queryKey: [key] });
            toast.say(`Sorted ${String(done)} file${done === 1 ? '' : 's'}.`);
        } else {
            setRunning(true);
        }
    });

    const start = (): void => {
        setRunning(true);
        api<{ started: boolean; total: number; reason?: string }>(
            'POST',
            '/api/sorting/run?async=1',
        )
            .then((r) => {
                if (!r.started) {
                    setRunning(r.reason === 'Already sorting.');
                    toast.say(r.reason ?? 'Nothing to sort.');
                } else {
                    setProgress({ done: 0, total: r.total });
                }
            })
            .catch((e: unknown) => {
                setRunning(false);
                toast.say(e instanceof Error ? e.message : 'Could not start the sorter.');
            });
    };
    return { start, running, progress };
}
