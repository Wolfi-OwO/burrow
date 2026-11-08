import { useSortRun } from '../lib/sort-run.tsx';
import { useNow } from '../lib/use-now.ts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, FolderInput, Play, ShieldCheck, Undo2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';

import { UnsortAll } from '../components/UnsortAll.tsx';
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
    const sortRun = useSortRun();
    const now = useNow(sortRun.running);

    const files = useMemo(() => review.data?.files ?? [], [review.data]);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [anchor, setAnchor] = useState<string | null>(null);
    const [bulkTarget, setBulkTarget] = useState('');
    const [bulkBusy, setBulkBusy] = useState(false);
    // Files that were resolved elsewhere drop out of the selection by themselves.
    const chosen = files.filter((f) => selected.has(f.id));
    const guesses = useMemo(() => {
        const byId = new Map<number, { name: string; count: number }>();
        for (const f of files) {
            if (f.suggestedCategoryId === null) continue;
            const entry = byId.get(f.suggestedCategoryId) ?? {
                name: f.suggestedName ?? `Category ${String(f.suggestedCategoryId)}`,
                count: 0,
            };
            entry.count += 1;
            byId.set(f.suggestedCategoryId, entry);
        }
        return [...byId.entries()].sort((a, b) => b[1].count - a[1].count);
    }, [files]);

    /** Click selects one file, ctrl/cmd-click adds or removes it, shift-click takes everything from the last click. */
    const pick = (
        id: string,
        event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean },
    ): void => {
        const next = new Set(selected);
        const from = anchor === null ? -1 : files.findIndex((f) => f.id === anchor);
        const to = files.findIndex((f) => f.id === id);
        if (event.shiftKey && from !== -1 && to !== -1) {
            const [lo, hi] = from < to ? [from, to] : [to, from];
            for (const f of files.slice(lo, hi + 1)) next.add(f.id);
        } else {
            if (next.has(id)) next.delete(id);
            else next.add(id);
            setAnchor(id);
        }
        setSelected(next);
    };

    const bulk = async (action: 'accept' | 'move' | 'leave'): Promise<void> => {
        const targets =
            action === 'accept' ? chosen.filter((f) => f.suggestedCategoryId !== null) : chosen;
        if (targets.length === 0) return;
        setBulkBusy(true);
        let failed = 0;
        const queue = [...targets];
        // A few at a time: fast enough for hundreds of files without hammering the server.
        const worker = async (): Promise<void> => {
            for (let f = queue.shift(); f; f = queue.shift()) {
                try {
                    await api('POST', `/api/review/${f.id}`, {
                        action,
                        ...(action === 'move' ? { categoryId: Number(bulkTarget) } : {}),
                    });
                } catch {
                    failed += 1;
                }
            }
        };
        await Promise.all([worker(), worker(), worker(), worker()]);
        setBulkBusy(false);
        setSelected(new Set());
        setAnchor(null);
        refresh();
        const done = targets.length - failed;
        toast.say(
            failed === 0
                ? `Done for ${String(done)} file${done === 1 ? '' : 's'}.`
                : `${String(done)} done, ${String(failed)} failed.`,
        );
    };

    return (
        <>
            <header className="page-head">
                <div>
                    <p className="kicker">The review desk</p>
                    <h1>Review</h1>
                    <p>Files the sorter was not sure about. It never files these on its own.</p>
                </div>
            </header>

            <section className="panel" aria-labelledby="sorter-h" style={{ marginBottom: 24 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                    <h2 id="sorter-h">The sorter</h2>
                    <div className="row">
                        <UnsortAll />
                        <button
                            className="btn"
                            disabled={sortRun.running || !status.data?.visionHealthy}
                            onClick={sortRun.start}
                        >
                            {sortRun.running ? <Spinner /> : <Play size={16} />}Sort now
                        </button>
                    </div>
                </div>
                {sortRun.running && sortRun.progress ? (
                    <div className="sort-progress" role="status">
                        <progress
                            value={sortRun.progress.done}
                            max={Math.max(1, sortRun.progress.total)}
                        />
                        <span>
                            {sortRun.progress.done} of {sortRun.progress.total} sorted
                            {sortRun.timeLeft(now) === '' ? '' : ` · ${sortRun.timeLeft(now)}`}
                        </span>
                    </div>
                ) : null}
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
            {files.length > 0 ? (
                <div className="bulk-bar" role="toolbar" aria-label="Select several files">
                    <button
                        className="btn sm ghost"
                        onClick={() => {
                            setSelected(
                                chosen.length === files.length
                                    ? new Set()
                                    : new Set(files.map((f) => f.id)),
                            );
                            setAnchor(null);
                        }}
                    >
                        {chosen.length === files.length
                            ? 'Clear selection'
                            : `Select all ${String(files.length)}`}
                    </button>
                    {guesses.length > 0 ? (
                        <>
                            <label className="sr" htmlFor="pick-guess">
                                Select every file with the same best guess
                            </label>
                            <select
                                id="pick-guess"
                                className="input"
                                style={{ width: 210, minHeight: 32 }}
                                value=""
                                onChange={(event) => {
                                    const id = Number(event.target.value);
                                    setSelected(
                                        new Set([
                                            ...selected,
                                            ...files
                                                .filter((f) => f.suggestedCategoryId === id)
                                                .map((f) => f.id),
                                        ]),
                                    );
                                }}
                            >
                                <option value="">Select all guessed as...</option>
                                {guesses.map(([id, g]) => (
                                    <option key={id} value={id}>
                                        {g.name} ({g.count})
                                    </option>
                                ))}
                            </select>
                        </>
                    ) : null}
                    <span className="muted small grow" aria-live="polite">
                        {chosen.length === 0
                            ? 'Click a file to select it, shift-click to select a range, ctrl-click to add one.'
                            : `${String(chosen.length)} selected`}
                    </span>
                    {chosen.length > 0 ? (
                        <>
                            <button
                                className="btn sm"
                                disabled={
                                    bulkBusy || !chosen.some((f) => f.suggestedCategoryId !== null)
                                }
                                onClick={() => void bulk('accept')}
                            >
                                <Check size={15} />
                                Accept guesses
                            </button>
                            <label className="sr" htmlFor="bulk-target">
                                Category for the selected files
                            </label>
                            <select
                                id="bulk-target"
                                className="input"
                                style={{ width: 170, minHeight: 32 }}
                                value={bulkTarget}
                                onChange={(event) => setBulkTarget(event.target.value)}
                            >
                                <option value="">Another category...</option>
                                {(tree.data?.categories ?? []).map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {'  '.repeat(c.depth)}
                                        {c.name}
                                    </option>
                                ))}
                            </select>
                            <button
                                className="btn sm ghost"
                                disabled={bulkBusy || bulkTarget === ''}
                                onClick={() => void bulk('move')}
                            >
                                <FolderInput size={15} />
                                File there
                            </button>
                            <button
                                className="btn sm ghost"
                                disabled={bulkBusy}
                                onClick={() => void bulk('leave')}
                            >
                                <Undo2 size={15} />
                                Leave unsorted
                            </button>
                            {bulkBusy ? <Spinner /> : null}
                        </>
                    ) : null}
                </div>
            ) : null}
            <div className="review-list">
                {files.map((file) => (
                    <ReviewItem
                        key={file.id}
                        file={file}
                        selected={selected.has(file.id)}
                        onPick={(event) => pick(file.id, event)}
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
    selected,
    onPick,
    categories,
    busy,
    onResolve,
}: {
    file: FileItem;
    selected: boolean;
    onPick: (event: MouseEvent) => void;
    categories: CategoryNode[];
    busy: boolean;
    onResolve: (v: { action: 'accept' | 'move' | 'leave'; categoryId?: number }) => void;
}): ReactNode {
    const [other, setOther] = useState('');
    return (
        <article
            className={selected ? 'review-item selected' : 'review-item'}
            onMouseDown={(event) => {
                // No text selection when shift-clicking a range.
                if (event.shiftKey) event.preventDefault();
            }}
            onClick={(event) => {
                if ((event.target as HTMLElement).closest('button, select, a, label, input'))
                    return;
                onPick(event);
            }}
        >
            <input
                type="checkbox"
                className="pick-box"
                checked={selected}
                aria-label={`Select ${file.name}`}
                onChange={() => undefined}
                onClick={(event) => {
                    event.stopPropagation();
                    onPick(event);
                }}
            />
            <span className="thumb">
                {file.mime.startsWith('image/') ? (
                    <ProtectedImage path={`/api/files/${file.id}/thumbnail`} alt={file.name} />
                ) : null}
            </span>
            <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
                <strong className="fname-line" title={file.name}>
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
                </span>
                {file.confidence !== null ? (
                    <span className="meter" aria-hidden="true">
                        <i style={{ width: `${String(Math.round(file.confidence * 100))}%` }} />
                    </span>
                ) : null}
            </div>
            {file.confidence !== null ? (
                <span className="conf" title="How sure the sorter is">
                    {Math.round(file.confidence * 100)}
                    <small>% sure</small>
                </span>
            ) : null}
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
