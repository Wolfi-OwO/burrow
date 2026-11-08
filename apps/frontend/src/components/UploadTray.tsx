import { CheckCircle2, Copy, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { formatRemaining, formatSpeed } from '../lib/format.ts';
import { remaining, remainingTogether } from '../lib/transfer-rate.ts';
import type { UploadState } from '../lib/uploads.tsx';
import { useUploads } from '../lib/uploads.tsx';
import { Spinner } from './ui.tsx';

const isRunning = (u: UploadState): boolean => u.state === 'sending' || u.state === 'unpacking';

/** Re-renders every second while something runs, so the remaining time counts down live between progress reports. */
function useNow(active: boolean): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!active) return;
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [active]);
    return now;
}

/** The text after the percentage: speed and time left, or why there is none yet. */
function pace(u: UploadState, now: number): string {
    const left = remaining(u.rate, now);
    if (left.kind === 'stalled') return 'waiting for the connection';
    if (left.kind === 'measuring') return u.state === 'unpacking' ? '' : 'measuring speed';
    const time = `${formatRemaining(left.seconds)} left`;
    // The speed of an unpacking zip is in entries a second, which says little; only a transfer shows it.
    return u.state === 'sending' ? `${formatSpeed(left.speed)} · ${time}` : time;
}

/** What is being uploaded, on every page: a small panel in the corner that stays while you browse. */
export function UploadTray(): ReactNode {
    const { uploads, clearFinished } = useUploads();
    const active = uploads.filter(isRunning);
    const now = useNow(active.length > 0);
    if (uploads.length === 0) return null;
    const total = remainingTogether(
        active.map((u) => u.rate),
        now,
    );
    return (
        <aside className="upload-tray" aria-label="Uploads">
            <header>
                <strong>
                    {active.length > 0
                        ? `${active.every((u) => u.server === true) ? 'Importing' : 'Uploading'} ${String(active.length)} file${active.length === 1 ? '' : 's'}${total.kind === 'eta' ? ` · ${formatRemaining(total.seconds)} left` : ''}`
                        : 'Uploads finished'}
                </strong>
                {active.length === 0 ? (
                    <button
                        className="icon-btn"
                        onClick={clearFinished}
                        aria-label="Close"
                        title="Close"
                    >
                        <X size={16} />
                    </button>
                ) : null}
            </header>
            <div className="uploads" aria-live="off">
                {uploads.slice(0, 8).map((u) => (
                    <div className="upload-row" key={u.id}>
                        {isRunning(u) ? (
                            <Spinner />
                        ) : u.state === 'failed' ? (
                            <X size={18} color="var(--danger)" />
                        ) : u.state === 'duplicate' ? (
                            <Copy size={18} />
                        ) : (
                            <CheckCircle2 size={18} color="var(--live)" />
                        )}
                        <span className="grow">{u.name}</span>
                        <span className="muted small">
                            {u.state === 'sending'
                                ? [
                                      `${u.server === true ? 'downloading' : 'uploading'} ${String(Math.round((u.progress ?? 0) * 100))}%`,
                                      pace(u, now),
                                  ]
                                      .filter(Boolean)
                                      .join(' · ')
                                : u.state === 'unpacking'
                                  ? [`unpacking, ${u.message ?? ''}`, pace(u, now)]
                                        .filter(Boolean)
                                        .join(' · ')
                                  : u.state === 'duplicate'
                                    ? 'already stored, kept once'
                                    : u.state === 'failed'
                                      ? (u.message ?? 'failed')
                                      : (u.message ?? 'stored')}
                        </span>
                        {isRunning(u) ? (
                            <div
                                className="bar"
                                role="progressbar"
                                aria-label={`${u.name} ${u.state === 'sending' ? 'upload' : 'unpacking'}`}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-valuenow={Math.round((u.progress ?? 0) * 100)}
                            >
                                <i
                                    style={{
                                        width: `${String(Math.round((u.progress ?? 0) * 100))}%`,
                                    }}
                                />
                            </div>
                        ) : null}
                    </div>
                ))}
            </div>
        </aside>
    );
}
