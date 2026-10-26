import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    CheckCircle2,
    Copy,
    FileText,
    Download,
    Maximize2,
    Play,
    Search,
    Share2,
    Trash2,
    UploadCloud,
    X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import { FileCard } from '../components/FileCard.tsx';
import { previewable } from '../components/FilePreview.tsx';
import { Lightbox } from '../components/Lightbox.tsx';
import { ShareDialog } from '../components/ShareDialog.tsx';
import { Spinner, ProtectedImage, useToast } from '../components/ui.tsx';
import { api, ApiError, fetchBlob, uploadWithProgress } from '../lib/api.ts';
import { useServerEvents } from '../lib/events.tsx';
import { formatBytes } from '../lib/format.ts';
import type { CategoryNode, FileItem } from '../lib/types.ts';

interface UploadState {
    id: number;
    name: string;
    state: 'sending' | 'unpacking' | 'new' | 'duplicate' | 'failed';
    message?: string;
    /** 0 to 1: how much of the upload has left, then how much of a zip has been unpacked. */
    progress?: number;
    /** Set for a zip the server is unpacking; its events carry the same id. */
    job?: string;
}

export function DrivePage(): ReactNode {
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const client = useQueryClient();
    const toast = useToast();
    const raw = params.get('c');
    const category = raw === null ? undefined : raw === 'unsorted' ? 'unsorted' : Number(raw);
    const [openId, setOpenId] = useState<string | null>(null);
    const [viewId, setViewId] = useState<string | null>(null);
    const [uploads, setUploads] = useState<UploadState[]>([]);
    const [over, setOver] = useState(false);
    const input = useRef<HTMLInputElement>(null);
    const [query, setQuery] = useState('');

    const tree = useQuery({
        queryKey: ['tree'],
        queryFn: () => api<{ categories: CategoryNode[] }>('GET', '/api/categories'),
    });
    const files = useQuery({
        queryKey: ['files', category ?? 'all'],
        queryFn: () =>
            api<{ files: FileItem[] }>(
                'GET',
                `/api/files?limit=200${category === undefined ? '' : `&category=${String(category)}&subtree=true`}`,
            ),
    });
    const current = tree.data?.categories.find((c) => c.id === category);
    const crumbs = useMemo(() => {
        if (category === undefined) return ['Everything'];
        if (category === 'unsorted') return ['Unsorted'];
        if (!current || !tree.data) return [];
        const parts = tree.data.categories.filter(
            (c) => current.path === c.path || current.path.startsWith(`${c.path}.`),
        );
        return parts.map((c) => c.name);
    }, [category, current, tree.data]);
    const open = files.data?.files.find((f) => f.id === openId) ?? null;
    const images = (files.data?.files ?? []).filter((f) => previewable(f.name, f.mime));
    const viewAt = images.findIndex((f) => f.id === viewId);
    const viewing = viewAt >= 0 ? (images[viewAt] as FileItem) : null;
    const downloadOriginal = async (file: FileItem): Promise<void> => {
        const url = URL.createObjectURL(await fetchBlob(`/api/files/${file.id}/content`));
        Object.assign(document.createElement('a'), { href: url, download: file.name }).click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
    };

    /** One file (or one zip) with a patient retry when the server says "slow down". */
    const sendOne = async (
        file: File,
        onProgress: (fraction: number) => void,
    ): Promise<{ file?: FileItem; duplicate: boolean; job?: string }> => {
        for (let attempt = 0; ; attempt++) {
            try {
                const result = await uploadWithProgress<{
                    file?: FileItem;
                    deduplicated?: boolean;
                    job?: string;
                }>(
                    '/api/files',
                    file,
                    onProgress,
                    typeof category === 'number' ? { categoryId: String(category) } : {},
                );
                return {
                    duplicate: result.deduplicated === true,
                    ...(result.file ? { file: result.file } : {}),
                    ...(result.job ? { job: result.job } : {}),
                };
            } catch (error) {
                if (error instanceof ApiError && error.status === 429 && attempt < 6) {
                    await new Promise((resolve) => setTimeout(resolve, 4000 * (attempt + 1)));
                    continue;
                }
                throw error;
            }
        }
    };
    // The server unpacks a zip in the background and reports as it goes.
    useServerEvents((event) => {
        const job = event.data.job;
        if (typeof job !== 'string') return;
        setUploads((u) =>
            u.map((x) => {
                if (x.job !== job) return x;
                if (event.type === 'upload.progress') {
                    const seen = Number(event.data.seen);
                    const total = Number(event.data.total);
                    return {
                        ...x,
                        state: 'unpacking',
                        progress: total > 0 ? seen / total : 0,
                        message:
                            total > 0 ? `${String(seen)} of ${String(total)} entries` : 'starting',
                    };
                }
                if (event.type === 'upload.done')
                    return {
                        ...x,
                        state: 'new',
                        progress: 1,
                        message: `${String(event.data.extracted)} files unpacked`,
                    };
                if (event.type === 'upload.failed')
                    return { ...x, state: 'failed', message: 'could not be unpacked' };
                return x;
            }),
        );
    });
    const upload = async (list: File[]): Promise<void> => {
        const rows = list.map((file) => ({ id: Date.now() + Math.random(), file }));
        setUploads((u) => [
            ...rows
                .map((r): UploadState => ({ id: r.id, name: r.file.name, state: 'sending' }))
                .reverse(),
            ...u,
        ]);
        const mark = (id: number, patch: Partial<UploadState>): void =>
            setUploads((u) => u.map((x) => (x.id === id ? { ...x, ...patch } : x)));
        let next = 0;
        // Three at a time: a folder of photos moves quickly without opening hundreds of connections at once.
        const worker = async (): Promise<void> => {
            while (next < rows.length) {
                const row = rows[next++];
                if (!row) return;
                try {
                    const result = await sendOne(row.file, (fraction) =>
                        mark(row.id, { progress: fraction }),
                    );
                    if (result.job) {
                        mark(row.id, {
                            state: 'unpacking',
                            job: result.job,
                            progress: 0,
                            message: 'starting',
                        });
                        continue;
                    }
                    // Filed into the category being viewed, so "upload here" does what it says.
                    if (typeof category === 'number' && result.file)
                        await api('PATCH', `/api/files/${result.file.id}`, {
                            categoryId: category,
                        });
                    mark(row.id, { state: result.duplicate ? 'duplicate' : 'new', progress: 1 });
                } catch (error) {
                    const message =
                        error instanceof ApiError && error.status === 413
                            ? 'Too large'
                            : error instanceof Error
                              ? error.message
                              : 'Failed';
                    mark(row.id, { state: 'failed', message });
                }
            }
        };
        await Promise.all([worker(), worker(), worker()]);
        void client.invalidateQueries({ queryKey: ['files'] });
        void client.invalidateQueries({ queryKey: ['tree'] });
        void client.invalidateQueries({ queryKey: ['sorting'] });
    };
    const sortNow = useMutation({
        mutationFn: () =>
            api<{ ran: boolean; decided: number; remaining: number }>('POST', '/api/sorting/run'),
        onSuccess: (r) => {
            for (const key of ['review', 'tree', 'files', 'sorting'])
                void client.invalidateQueries({ queryKey: [key] });
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
    const onDrop = (event: DragEvent): void => {
        event.preventDefault();
        setOver(false);
        if (event.dataTransfer.files.length > 0) void upload([...event.dataTransfer.files]);
    };

    return (
        <div
            onDragOver={(event) => {
                if (event.dataTransfer.types.includes('Files')) {
                    event.preventDefault();
                    setOver(true);
                }
            }}
            onDragLeave={(event) => {
                if (event.currentTarget === event.target) setOver(false);
            }}
            onDrop={onDrop}
        >
            <header className="page-head">
                <div>
                    <h1>{crumbs.at(-1) ?? 'Drive'}</h1>
                    <div className="crumbs" aria-label="Location">
                        {crumbs.slice(0, -1).map((name, i) => (
                            <span key={i}>{name} /</span>
                        ))}
                        <span>
                            {files.data
                                ? `${String(files.data.files.length)} file${files.data.files.length === 1 ? '' : 's'}`
                                : ''}
                        </span>
                    </div>
                </div>
                {category === 'unsorted' ? (
                    <button
                        className="btn"
                        disabled={sortNow.isPending}
                        onClick={() => sortNow.mutate()}
                    >
                        {sortNow.isPending ? <Spinner /> : <Play size={16} />}
                        Sort all now
                    </button>
                ) : null}
                <form
                    className="searchbar"
                    role="search"
                    onSubmit={(event) => {
                        event.preventDefault();
                        if (query.trim()) navigate(`/search?q=${encodeURIComponent(query.trim())}`);
                    }}
                >
                    <Search size={18} aria-hidden="true" />
                    <label className="sr" htmlFor="search">
                        Search files
                    </label>
                    <input
                        id="search"
                        className="input"
                        placeholder="Search by name"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                    />
                </form>
            </header>

            <button className={`hole ${over ? 'over' : ''}`} onClick={() => input.current?.click()}>
                <UploadCloud size={30} aria-hidden="true" />
                <strong>{over ? 'Let go to drop it in' : 'Drop files into the burrow'}</strong>
                <span>
                    {typeof category === 'number'
                        ? `They will be filed in "${crumbs.at(-1) ?? ''}". `
                        : ''}
                    or click to choose. Zip files are unpacked. The AI sorts the rest into your
                    categories.
                </span>
            </button>
            <input
                ref={input}
                type="file"
                multiple
                hidden
                onChange={(event) => {
                    if (event.target.files) void upload([...event.target.files]);
                    event.target.value = '';
                }}
            />
            {uploads.length > 0 ? (
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
            ) : null}

            {files.isLoading ? (
                <p className="muted" style={{ marginTop: 24 }}>
                    <Spinner /> Loading files
                </p>
            ) : null}
            {files.data && files.data.files.length === 0 ? (
                <div className="empty">
                    <h2>
                        {category === undefined ? 'The burrow is empty' : 'Nothing in here yet'}
                    </h2>
                    <p>
                        Drop a few photos above. Create categories on the left and the sorter will
                        start filing them for you.
                    </p>
                </div>
            ) : null}
            <div className="grid">
                {files.data?.files.map((file) => (
                    <FileCard
                        key={file.id}
                        file={file}
                        selected={file.id === openId}
                        onOpen={() => setOpenId(file.id)}
                    />
                ))}
            </div>

            {viewing ? (
                <Lightbox
                    name={viewing.name}
                    mime={viewing.mime}
                    size={viewing.size}
                    path={`/api/files/${viewing.id}/content`}
                    onClose={() => setViewId(null)}
                    onDownload={() => void downloadOriginal(viewing)}
                    onPrev={
                        viewAt > 0
                            ? () => setViewId((images[viewAt - 1] as FileItem).id)
                            : undefined
                    }
                    onNext={
                        viewAt < images.length - 1
                            ? () => setViewId((images[viewAt + 1] as FileItem).id)
                            : undefined
                    }
                />
            ) : null}
            {open ? (
                <Details
                    file={open}
                    onView={() => setViewId(open.id)}
                    categories={tree.data?.categories ?? []}
                    onClose={() => setOpenId(null)}
                    onGone={() => {
                        setOpenId(null);
                        toast.say('Deleted.');
                    }}
                />
            ) : null}
        </div>
    );
}

function Details({
    file,
    onView,
    categories,
    onClose,
    onGone,
}: {
    file: FileItem;
    onView: () => void;
    categories: CategoryNode[];
    onClose: () => void;
    onGone: () => void;
}): ReactNode {
    const client = useQueryClient();
    const toast = useToast();
    const [name, setName] = useState(file.name);
    const [sharing, setSharing] = useState(false);
    useEffect(() => setName(file.name), [file.name]);
    const done = (): void => {
        void client.invalidateQueries({ queryKey: ['files'] });
        void client.invalidateQueries({ queryKey: ['tree'] });
        void client.invalidateQueries({ queryKey: ['review'] });
    };
    const patch = useMutation({
        mutationFn: (body: { name?: string; categoryId?: number | null }) =>
            api('PATCH', `/api/files/${file.id}`, body),
        onSuccess: done,
        onError: (e: Error) => toast.say(e.message),
    });
    const remove = useMutation({
        mutationFn: () => api('DELETE', `/api/files/${file.id}`),
        onSuccess: () => {
            done();
            onGone();
        },
        onError: (e: Error) => toast.say(e.message),
    });
    const original = async (): Promise<void> => {
        const url = URL.createObjectURL(await fetchBlob(`/api/files/${file.id}/content`));
        const link = Object.assign(document.createElement('a'), { href: url, download: file.name });
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
    };
    return (
        <aside className="details" aria-label={`Details of ${file.name}`}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
                <h2>Details</h2>
                <button className="tool" aria-label="Close details" onClick={onClose}>
                    <X size={18} />
                </button>
            </div>
            <div className="preview">
                {file.mime.startsWith('image/') ? (
                    <button
                        type="button"
                        className="preview-open"
                        aria-label="Open full screen"
                        onClick={onView}
                    >
                        <ProtectedImage path={`/api/files/${file.id}/content`} alt={file.name} />
                        <span className="preview-hint">
                            <Maximize2 size={14} /> Full screen
                        </span>
                    </button>
                ) : previewable(file.name, file.mime) ? (
                    <button
                        type="button"
                        className="preview-open doc"
                        aria-label="Open preview"
                        onClick={onView}
                    >
                        <FileText size={40} aria-hidden="true" />
                        <span>Open preview</span>
                        <span className="muted small">{file.mime}</span>
                    </button>
                ) : (
                    <p className="muted">No preview for {file.mime}</p>
                )}
            </div>
            <form
                className="field"
                onSubmit={(event) => {
                    event.preventDefault();
                    if (name.trim() && name !== file.name) patch.mutate({ name: name.trim() });
                }}
            >
                <label htmlFor="file-name">Name</label>
                <input
                    id="file-name"
                    className="input"
                    value={name}
                    maxLength={255}
                    onChange={(event) => setName(event.target.value)}
                    onBlur={() =>
                        name.trim() && name !== file.name && patch.mutate({ name: name.trim() })
                    }
                />
            </form>
            <div className="field">
                <label htmlFor="file-cat">Category</label>
                <select
                    id="file-cat"
                    className="input"
                    value={file.categoryId ?? ''}
                    onChange={(event) =>
                        patch.mutate({
                            categoryId:
                                event.target.value === '' ? null : Number(event.target.value),
                        })
                    }
                >
                    <option value="">Unsorted</option>
                    {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                            {'  '.repeat(c.depth)}
                            {c.name}
                        </option>
                    ))}
                </select>
            </div>
            <dl className="kv">
                <dt>Location</dt>
                <dd>{file.categoryPath.length > 0 ? file.categoryPath.join(' / ') : 'Unsorted'}</dd>
                <dt>Type</dt>
                <dd>{file.mime}</dd>
                <dt>Size</dt>
                <dd>{formatBytes(file.size)}</dd>
                <dt>Added</dt>
                <dd>{new Date(file.createdAt).toLocaleString()}</dd>
                {file.takenAt ? (
                    <>
                        <dt>Taken</dt>
                        <dd>{new Date(file.takenAt).toLocaleString()}</dd>
                    </>
                ) : null}
                {file.place ? (
                    <>
                        <dt>Place</dt>
                        <dd>
                            {file.place}
                            {file.placeScore ? (
                                <span className="muted small">
                                    {' '}
                                    · {Math.round(file.placeScore * 100)}% sure
                                </span>
                            ) : null}
                        </dd>
                    </>
                ) : null}
                {file.latitude != null && file.longitude != null ? (
                    <>
                        <dt>GPS</dt>
                        <dd>
                            <a
                                href={`https://www.openstreetmap.org/?mlat=${String(file.latitude)}&mlon=${String(file.longitude)}#map=15/${String(file.latitude)}/${String(file.longitude)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                {file.latitude.toFixed(4)}, {file.longitude.toFixed(4)}
                            </a>
                        </dd>
                    </>
                ) : null}
                {file.confidence !== null ? (
                    <>
                        <dt>Sorter</dt>
                        <dd>{Math.round(file.confidence * 100)}% sure</dd>
                    </>
                ) : null}
            </dl>
            <div className="row">
                <button className="btn ghost" onClick={() => void original()}>
                    <Download size={16} />
                    Download
                </button>
                <button className="btn ghost" onClick={() => setSharing(true)}>
                    <Share2 size={16} />
                    Share
                </button>
                <button className="btn danger" onClick={() => remove.mutate()}>
                    <Trash2 size={16} />
                    Delete
                </button>
            </div>
            {sharing ? (
                <ShareDialog
                    target={{ kind: 'file', id: file.id, name: file.name }}
                    onClose={() => setSharing(false)}
                />
            ) : null}
        </aside>
    );
}
