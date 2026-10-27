import { CheckCircle2, Copy, X } from 'lucide-react';
import type { ReactNode } from 'react';

import { useUploads } from '../lib/uploads.tsx';
import { Spinner } from './ui.tsx';

/** What is being uploaded, on every page: a small panel in the corner that stays while you browse. */
export function UploadTray(): ReactNode {
    const { uploads, clearFinished } = useUploads();
    if (uploads.length === 0) return null;
    const running = uploads.filter((u) => u.state === 'sending' || u.state === 'unpacking').length;
    return (
        <aside className="upload-tray" aria-label="Uploads">
            <header>
                <strong>
                    {running > 0
                        ? `Uploading ${String(running)} file${running === 1 ? '' : 's'}`
                        : 'Uploads finished'}
                </strong>
                {running === 0 ? (
                    <button className="icon-btn" onClick={clearFinished} aria-label="Close">
                        <X size={16} />
                    </button>
                ) : null}
            </header>
            <div className="uploads" aria-live="polite">
                {uploads.slice(0, 8).map((u) => (
                    <div className="upload-row" key={u.id}>
                        {u.state === 'sending' || u.state === 'unpacking' ? (
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
                                ? `uploading ${String(Math.round((u.progress ?? 0) * 100))}%`
                                : u.state === 'unpacking'
                                  ? `unpacking, ${u.message ?? ''}`
                                  : u.state === 'duplicate'
                                    ? 'already stored, kept once'
                                    : u.state === 'failed'
                                      ? (u.message ?? 'failed')
                                      : (u.message ?? 'stored')}
                        </span>
                        {u.state === 'sending' || u.state === 'unpacking' ? (
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
