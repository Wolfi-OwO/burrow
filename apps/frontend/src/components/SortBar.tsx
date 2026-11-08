import { Play } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router';

import { useNow } from '../lib/use-now.ts';
import { useSortRun } from '../lib/sort-run.tsx';

/** While the sorter works, on every page: how far it is, and a way back to the Review page. Gone when it is done. */
export function SortBar(): ReactNode {
    const { running, progress, timeLeft } = useSortRun();
    const now = useNow(running);
    const here = useLocation().pathname === '/review';
    if (!running || !progress) return null;
    const percent = progress.total > 0 ? Math.min(100, (progress.done / progress.total) * 100) : 0;
    return (
        <div className="sort-bar">
            <Play size={14} aria-hidden="true" />
            <progress
                value={progress.done}
                max={Math.max(1, progress.total)}
                aria-label="Sorting progress"
            />
            <span className="sort-bar-text">
                Sorting {progress.done.toLocaleString()} of {progress.total.toLocaleString()} ·{' '}
                {String(Math.floor(percent))}%<span className="muted"> · {timeLeft(now)}</span>
            </span>
            {here ? null : <Link to="/review">Details</Link>}
        </div>
    );
}
