import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, FolderInput, Play, ShieldCheck, Undo2 } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { Spinner, ProtectedImage, useToast } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { ago } from '../lib/format.ts';
import type { CategoryNode, FileItem, SortingStatus } from '../lib/types.ts';

/** SFW / NSFW folders that hold pictures the NSFW classifier disagrees with, and a one-click fix. */
function RatingCheck(): ReactNode {
    const client = useQueryClient();
    const toast = useToast();
    const ratings = useQuery({
        queryKey: ['ratings'],
        queryFn: () => api<{ toExplicit: number; toSafe: number }>('GET', '/api/sorting/ratings'),
    });
    const fix = useMutation({
        mutationFn: () =>
            api<{ toExplicit: number; toSafe: number }>('POST', '/api/sorting/ratings'),
        onSuccess: (r) => {
            for (const key of ['ratings', 'tree', 'files', 'review'])
                void client.invalidateQueries({ queryKey: [key] });
            toast.say(`Moved ${String(r.toExplicit)} to NSFW and ${String(r.toSafe)} to SFW.`);
        },
        onError: (e: Error) => toast.say(e.message),
    });
    if (!ratings.data) return null;
    const total = ratings.data.toExplicit + ratings.data.toSafe;
    return (
        <div className="rating-check">
            <ShieldCheck size={18} aria-hidden="true" />
            <span className="grow">
                {total === 0
                    ? 'SFW and NSFW folders match what the classifier sees.'
                    : `${String(ratings.data.toExplicit)} in SFW look explicit and ${String(ratings.data.toSafe)} in NSFW look clean.`}
            </span>
            {total > 0 ? (
                <button className="btn sm" disabled={fix.isPending} onClick={() => fix.mutate()}>
                    {fix.isPending ? <Spinner /> : null}
                    Move {total} file{total === 1 ? '' : 's'}
                </button>
            ) : null}
        </div>
    );
}

export function ReviewPage(): ReactNode {
    const client = useQueryClient();
    const toast = useToast();
    const review = useQuery({
        queryKey: ['review'],
        queryFn: () => api<{ files: FileItem[] }>('GET', '/api/review'),
    });
    const tree = useQuery({
        queryKey: ['tree'],
        queryFn: () => api<{ categories: CategoryNode[] }>('GET', '/api/categories'),
    });
    const status = useQuery({
        queryKey: ['sorting'],
        queryFn: () => api<SortingStatus>('GET', '/api/sorting/status'),
        refetchInterval: 30_000,
    });

    const refresh = (): void => {
        for (const key of ['review', 'tree', 'files', 'sorting'])
            void client.invalidateQueries({ queryKey: [key] });
    };
    const resolve = useMutation({
        mutationFn: (v: { id: string; action: 'accept' | 'move' | 'leave'; categoryId?: number }) =>
            api('POST', `/api/review/${v.id}`, {
                action: v.action,
                ...(v.categoryId ? { categoryId: v.categoryId } : {}),
            }),
        onSuccess: refresh,
        onError: (e: Error) => toast.say(e.message),
    });
    const sortNow = useMutation({
        mutationFn: () =>
            api<{ ran: boolean; decided: number; remaining: number }>('POST', '/api/sorting/run'),
        onSuccess: (r) => {
            refresh();
            toast.say(
                !r.ran
                    ? 'Another sorter is already running.'
                    : r.remaining > 0
                      ? `Sorted ${String(r.decided)}, ${String(r.remaining)} still waiting. Press again to continue.`
                      : `Sorted ${String(r.decided)} file${r.decided === 1 ? '' : 's'}.`,
            );
        },
        onError: (e: Error) => toast.say(e.message),
    });

    return (
        <>
            <header className="page-head">
                <div>
                    <h1>Review</h1>
                    <p>Files the sorter was not sure about. It never files these on its own.</p>
                </div>
            </header>

            <section className="panel" aria-labelledby="sorter-h" style={{ marginBottom: 24 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                    <h2 id="sorter-h">The sorter</h2>
                    <button
                        className="btn"
                        disabled={sortNow.isPending || !status.data?.visionHealthy}
                        onClick={() => sortNow.mutate()}
                    >
                        {sortNow.isPending ? <Spinner /> : <Play size={16} />}Sort now
                    </button>
                </div>
                {status.data ? (
                    <dl className="kv" style={{ gridTemplateColumns: '170px 1fr' }}>
                        <dt>Waiting to be sorted</dt>
                        <dd>
                            {status.data.backlog} file{status.data.backlog === 1 ? '' : 's'}
                        </dd>
                        <dt>Schedule</dt>
                        <dd>
                            {status.data.runsPerDay} runs a day, one every{' '}
                            {status.data.intervalMinutes} min while the backlog stays like this
                        </dd>
                        <dt>Last run</dt>
                        <dd>{ago(status.data.lastRunAt)}</dd>
                        <dt>Vision service</dt>
                        <dd>
                            {!status.data.visionConfigured ? (
                                <span className="chip warn">not configured</span>
                            ) : status.data.visionHealthy ? (
                                <span className="chip live">healthy</span>
                            ) : (
                                <span className="chip warn">not answering</span>
                            )}
                        </dd>
                        <dt>Files itself when</dt>
                        <dd>at least {Math.round(status.data.autoFileThreshold * 100)}% sure</dd>
                    </dl>
                ) : (
                    <Spinner />
                )}
                <RatingCheck />
                {status.data && status.data.categories === 0 ? (
                    <p className="muted">
                        Create a few categories first; the sorter files into the tree you build.
                    </p>
                ) : null}
            </section>

            {review.isLoading ? (
                <p className="muted">
                    <Spinner /> Loading
                </p>
            ) : null}
            {review.data?.files.length === 0 ? (
                <div className="empty">
                    <Check size={36} aria-hidden="true" />
                    <h2>Nothing to review</h2>
                    <p>Everything the sorter looked at was clear enough to file.</p>
                </div>
            ) : null}
            <div className="review-list">
                {review.data?.files.map((file) => (
                    <ReviewItem
                        key={file.id}
                        file={file}
                        categories={tree.data?.categories ?? []}
                        busy={resolve.isPending}
                        onResolve={(v) => resolve.mutate({ id: file.id, ...v })}
                    />
                ))}
            </div>
        </>
    );
}

function ReviewItem({
    file,
    categories,
    busy,
    onResolve,
}: {
    file: FileItem;
    categories: CategoryNode[];
    busy: boolean;
    onResolve: (v: { action: 'accept' | 'move' | 'leave'; categoryId?: number }) => void;
}): ReactNode {
    const [other, setOther] = useState('');
    return (
        <article className="review-item">
            <span className="thumb">
                {file.mime.startsWith('image/') ? (
                    <ProtectedImage path={`/api/files/${file.id}/thumbnail`} alt={file.name} />
                ) : null}
            </span>
            <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
                <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {file.name}
                </strong>
                <span className="muted small">
                    {file.suggestedName ? (
                        <>
                            Best guess: <b>{file.suggestedName}</b>
                        </>
                    ) : (
                        'No guess'
                    )}
                    {file.confidence !== null ? (
                        <> &middot; {Math.round(file.confidence * 100)}% sure</>
                    ) : null}
                </span>
                {file.confidence !== null ? (
                    <span className="meter" aria-hidden="true">
                        <i style={{ width: `${String(Math.round(file.confidence * 100))}%` }} />
                    </span>
                ) : null}
            </div>
            <div className="acts row" style={{ justifyContent: 'flex-end' }}>
                {file.suggestedCategoryId !== null ? (
                    <button
                        className="btn sm"
                        disabled={busy}
                        onClick={() => onResolve({ action: 'accept' })}
                    >
                        <Check size={15} />
                        Accept
                    </button>
                ) : null}
                <label className="sr" htmlFor={`pick-${file.id}`}>
                    Pick another category
                </label>
                <select
                    id={`pick-${file.id}`}
                    className="input"
                    style={{ width: 170, minHeight: 32 }}
                    value={other}
                    onChange={(event) => setOther(event.target.value)}
                >
                    <option value="">Another category...</option>
                    {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                            {'  '.repeat(c.depth)}
                            {c.name}
                        </option>
                    ))}
                </select>
                <button
                    className="btn sm ghost"
                    disabled={busy || other === ''}
                    onClick={() => onResolve({ action: 'move', categoryId: Number(other) })}
                >
                    <FolderInput size={15} />
                    File there
                </button>
                <button
                    className="btn sm ghost"
                    disabled={busy}
                    onClick={() => onResolve({ action: 'leave' })}
                >
                    <Undo2 size={15} />
                    Leave unsorted
                </button>
            </div>
        </article>
    );
}
