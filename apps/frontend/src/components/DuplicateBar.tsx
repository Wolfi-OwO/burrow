import { Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router';

import { useDuplicateClean } from '../lib/duplicate-clean.tsx';

/** While duplicates are being removed, on every page: how far it is, and a way back to the Duplicates page. */
export function DuplicateBar(): ReactNode {
    const { running, progress } = useDuplicateClean();
    const here = useLocation().pathname === '/duplicates';
    if (!running || !progress) return null;
    const percent = progress.total > 0 ? Math.min(100, (progress.done / progress.total) * 100) : 0;
    return (
        <div className="sort-bar" role="status">
            <Trash2 size={14} aria-hidden="true" />
            <progress
                value={progress.done}
                max={Math.max(1, progress.total)}
                aria-label="Removing duplicates"
            />
            <span className="sort-bar-text">
                Removing duplicates {progress.done.toLocaleString()} of{' '}
                {progress.total.toLocaleString()} · {String(Math.floor(percent))}%
            </span>
            {here ? null : <Link to="/duplicates">Details</Link>}
        </div>
    );
}
