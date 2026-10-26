import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, FileText, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { ProtectedImage, Spinner, useToast } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { formatBytes } from '../lib/format.ts';
import type { DuplicateGroup } from '../lib/types.ts';

type Mode = 'exact' | 'similar';

/** Copies of the same picture: byte-identical files, or the same picture saved again at another size or quality. */
export function DuplicatesPage(): ReactNode {
    const client = useQueryClient();
    const toast = useToast();
    const [mode, setMode] = useState<Mode>('exact');
    // The keeper the owner picked per group; groups left alone use the suggested one.
    const [keeper, setKeeper] = useState<Record<string, string>>({});
    const [confirmAll, setConfirmAll] = useState(false);
    const groups = useQuery({
        queryKey: ['duplicates', mode],
        queryFn: () => api<{ groups: DuplicateGroup[] }>('GET', `/api/duplicates?mode=${mode}`),
    });
    const refresh = (): void => {
        for (const key of ['duplicates', 'files', 'tree', 'review'])
            void client.invalidateQueries({ queryKey: [key] });
    };
    const resolve = useMutation({
        mutationFn: (g: DuplicateGroup) => {
            const keepId = keeper[g.id] ?? g.keepId;
            return api<{ removed: number }>('POST', '/api/duplicates/resolve', {
                keepId,
                removeIds: g.files.filter((f) => f.id !== keepId).map((f) => f.id),
            });
        },
        onSuccess: (r) => {
            refresh();
            toast.say(`Removed ${String(r.removed)} ${r.removed === 1 ? 'copy' : 'copies'}.`);
        },
        onError: (e: Error) => toast.say(e.message),
    });
    const clean = useMutation({
        mutationFn: () => api<{ removed: number }>('POST', '/api/duplicates/clean', { mode }),
        onSuccess: (r) => {
            setConfirmAll(false);
            refresh();
            toast.say(`Removed ${String(r.removed)} duplicate${r.removed === 1 ? '' : 's'}.`);
        },
        onError: (e: Error) => toast.say(e.message),
    });
    const list = groups.data?.groups ?? [];
    const extra = list.reduce((n, g) => n + g.files.length - 1, 0);

    return (
        <>
            <header className="page-head">
                <div>
                    <h1>Duplicates</h1>
                    <p>
                        Find copies of the same picture and keep one. The copy that is already
                        filed, and the biggest one, is kept by default.
                    </p>
                </div>
                {extra > 0 ? (
                    confirmAll ? (
                        <div className="row">
                            <span className="small">Delete {extra} files for good?</span>
                            <button
                                className="btn danger sm"
                                onClick={() => clean.mutate()}
                                disabled={clean.isPending}
                            >
                                {clean.isPending ? <Spinner /> : <Trash2 size={14} />}
                                Yes, remove them
                            </button>
                            <button className="btn ghost sm" onClick={() => setConfirmAll(false)}>
                                Cancel
                            </button>
                        </div>
                    ) : (
                        <button className="btn" onClick={() => setConfirmAll(true)}>
                            <Trash2 size={16} />
                            Remove{' '}
                            {extra === 1 ? 'the duplicate' : `all ${String(extra)} duplicates`}
                        </button>
                    )
                ) : null}
            </header>

            <div
                className="segmented"
                role="tablist"
                aria-label="Kind of duplicate"
                style={{ maxWidth: 420, marginBottom: 20 }}
            >
                <button
                    role="tab"
                    type="button"
                    aria-checked={mode === 'exact'}
                    aria-selected={mode === 'exact'}
                    onClick={() => setMode('exact')}
                >
                    Identical files
                </button>
                <button
                    role="tab"
                    type="button"
                    aria-checked={mode === 'similar'}
                    aria-selected={mode === 'similar'}
                    onClick={() => setMode('similar')}
                >
                    Same picture, other size
                </button>
            </div>
            {mode === 'similar' ? (
                <p className="muted small" style={{ marginBottom: 16 }}>
                    Compares what the sorter saw in each picture, so it only covers pictures it has
                    already looked at. Check each group before removing.
                </p>
            ) : null}

            {groups.isLoading ? (
                <p className="muted">
                    <Spinner /> Looking for copies
                </p>
            ) : null}
            {groups.data && list.length === 0 ? (
                <div className="empty">
                    <Copy size={26} aria-hidden="true" />
                    <h2>No duplicates</h2>
                    <p>Every picture in here is there once.</p>
                </div>
            ) : null}
            <div className="dup-list">
                {list.map((g) => {
                    const keepId = keeper[g.id] ?? g.keepId;
                    return (
                        <section
                            className="dup-group"
                            key={g.id}
                            aria-label={`${String(g.files.length)} copies`}
                        >
                            <div className="dup-files">
                                {g.files.map((f) => (
                                    <div
                                        key={f.id}
                                        className={`dup-file ${f.id === keepId ? 'keep' : ''}`}
                                    >
                                        <span className="thumb">
                                            {f.mime.startsWith('image/') ? (
                                                <ProtectedImage
                                                    path={`/api/files/${f.id}/thumbnail`}
                                                    alt=""
                                                />
                                            ) : (
                                                <FileText size={30} aria-hidden="true" />
                                            )}
                                        </span>
                                        <span className="fname" title={f.name}>
                                            {f.name}
                                        </span>
                                        <span className="meta muted small">
                                            {formatBytes(f.size)}
                                            {f.categoryPath.length > 0
                                                ? ` · ${f.categoryPath.join(' / ')}`
                                                : ' · Unsorted'}
                                        </span>
                                        {f.id === keepId ? (
                                            <span className="chip live">
                                                <Check size={12} /> Keeping
                                            </span>
                                        ) : (
                                            <button
                                                className="btn ghost sm"
                                                onClick={() =>
                                                    setKeeper((k) => ({ ...k, [g.id]: f.id }))
                                                }
                                            >
                                                Keep this one
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                            <div className="row">
                                <button
                                    className="btn sm"
                                    onClick={() => resolve.mutate(g)}
                                    disabled={resolve.isPending}
                                >
                                    <Trash2 size={14} />
                                    Remove the other {g.files.length - 1}
                                </button>
                            </div>
                        </section>
                    );
                })}
            </div>
        </>
    );
}
