import { useSortRun } from '../lib/sort-run.ts';
import { useUploads } from '../lib/uploads.tsx';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    FileText,
    FolderOpen,
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
import { UnzipDialog } from '../components/UnzipDialog.tsx';
import { ShareDialog } from '../components/ShareDialog.tsx';
import { Spinner, ProtectedImage, useToast } from '../components/ui.tsx';
import { api, fetchBlob } from '../lib/api.ts';
import { formatBytes } from '../lib/format.ts';
import { FILE_KINDS } from '../lib/types.ts';
import type { CategoryNode, FileItem } from '../lib/types.ts';

export function DrivePage(): ReactNode {
    const [params, setParams] = useSearchParams();
    const navigate = useNavigate();
    const toast = useToast();
    const raw = params.get('c');
    const category = raw === null ? undefined : raw === 'unsorted' ? 'unsorted' : Number(raw);
    const kindParam = params.get('t');
    const kind = FILE_KINDS.some((k) => k.key === kindParam) ? kindParam : null;
    const [unzipping, setUnzipping] = useState<string[] | null>(null);
    const [openId, setOpenId] = useState<string | null>(null);
    const [viewId, setViewId] = useState<string | null>(null);
    const [over, setOver] = useState(false);
    const input = useRef<HTMLInputElement>(null);
    const [query, setQuery] = useState('');

    const tree = useQuery({
        queryKey: ['tree'],
        queryFn: () => api<{ categories: CategoryNode[] }>('GET', '/api/categories'),
    });
    const PAGE = 200;
    const filesQuery = useInfiniteQuery({
        queryKey: ['files', category ?? 'all', kind ?? 'any'],
        initialPageParam: 0,
        queryFn: ({ pageParam }) =>
            api<{ files: FileItem[] }>(
                'GET',
                `/api/files?limit=${String(PAGE)}&offset=${String(pageParam)}${category === undefined ? '' : `&category=${String(category)}&subtree=true`}${kind ? `&type=${kind}` : ''}`,
            ),
        getNextPageParam: (last, all) => (last.files.length < PAGE ? undefined : all.length * PAGE),
    });
    // The rest of the page reads one flat list, as it did before the list was paged.
    const files = {
        data: filesQuery.data
            ? { files: filesQuery.data.pages.flatMap((p) => p.files) }
            : undefined,
    };
    const counts = useQuery({
        queryKey: ['types'],
        queryFn: () => api<{ counts: Record<string, number> }>('GET', '/api/files/types'),
    });
    const pickKind = (key: string | null): void =>
        setParams(
            (p) => {
                const next = new URLSearchParams(p);
                if (key) next.set('t', key);
                else next.delete('t');
                return next;
            },
            { replace: true },
        );
    const zipsHere = (files.data?.files ?? []).filter((f) => /\.zip$/i.test(f.name));
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

    const { upload } = useUploads();
    const sortRun = useSortRun();
    const client = useQueryClient();
    const unplaced = useQuery({
        queryKey: ['sorting', 'unplaced'],
        queryFn: () =>
            api<{ total: number; kinds: { kind: string; name: string; count: number }[] }>(
                'GET',
                '/api/sorting/unplaced',
            ),
        enabled: category === 'unsorted',
    });
    const makeTypeFolders = useMutation({
        mutationFn: () => api<{ created: string[] }>('POST', '/api/sorting/type-folders'),
        onSuccess: (r) => {
            for (const key of ['tree', 'files', 'sorting', 'types'])
                void client.invalidateQueries({ queryKey: [key] });
            toast.say(
                r.created.length > 0
                    ? `Made ${r.created.join(', ')}; sorting them now.`
                    : 'Sorting them now.',
            );
        },
        onError: (e: Error) => toast.say(e.message),
    });
    const onDrop = (event: DragEvent): void => {
        event.preventDefault();
        setOver(false);
        if (event.dataTransfer.files.length > 0)
            void upload(
                [...event.dataTransfer.files],
                typeof category === 'number' ? category : undefined,
            );
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
                    <button className="btn" disabled={sortRun.running} onClick={sortRun.start}>
                        {sortRun.running ? <Spinner /> : <Play size={16} />}
                        {sortRun.running && sortRun.progress
                            ? `Sorting ${String(sortRun.progress.done)} / ${String(sortRun.progress.total)}`
                            : 'Sort all now'}
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

            <div className="kinds" role="group" aria-label="Show only">
                <button type="button" aria-pressed={kind === null} onClick={() => pickKind(null)}>
                    All
                    {counts.data ? <span className="n">{counts.data.counts.all}</span> : null}
                </button>
                {FILE_KINDS.filter(
                    (k) => (counts.data?.counts[k.key] ?? 0) > 0 || k.key === kind,
                ).map((k) => (
                    <button
                        key={k.key}
                        type="button"
                        aria-pressed={kind === k.key}
                        onClick={() => pickKind(k.key)}
                    >
                        {k.label}
                        <span className="n">{counts.data?.counts[k.key] ?? 0}</span>
                    </button>
                ))}
                {zipsHere.length > 0 ? (
                    <button
                        type="button"
                        className="kinds-action"
                        onClick={() => setUnzipping(zipsHere.map((z) => z.id))}
                    >
                        <FolderOpen size={14} />
                        Unzip{' '}
                        {zipsHere.length === 1
                            ? 'this archive'
                            : `all ${String(zipsHere.length)} archives`}
                    </button>
                ) : null}
            </div>
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
                    if (event.target.files)
                        void upload(
                            [...event.target.files],
                            typeof category === 'number' ? category : undefined,
                        );
                    event.target.value = '';
                }}
            />
            {category === 'unsorted' && unplaced.data && unplaced.data.total > 0 ? (
                <div className="notice" role="status">
                    <div>
                        <strong>
                            {unplaced.data.total} file{unplaced.data.total === 1 ? '' : 's'} have no
                            folder for their type.
                        </strong>
                        <span className="muted small">
                            {' '}
                            {unplaced.data.kinds
                                .map((k) => `${String(k.count)} for ${k.name}`)
                                .join(', ')}
                        </span>
                    </div>
                    <button
                        className="btn primary"
                        disabled={makeTypeFolders.isPending || sortRun.running}
                        onClick={() => makeTypeFolders.mutate()}
                    >
                        {makeTypeFolders.isPending ? <Spinner /> : <FolderOpen size={16} />}
                        Create the folders and sort
                    </button>
                </div>
            ) : null}
            {filesQuery.isLoading ? (
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
            {filesQuery.hasNextPage ? (
                <div className="row" style={{ justifyContent: 'center', margin: '20px 0' }}>
                    <button
                        className="btn"
                        disabled={filesQuery.isFetchingNextPage}
                        onClick={() => void filesQuery.fetchNextPage()}
                    >
                        {filesQuery.isFetchingNextPage ? <Spinner /> : null}Load more
                    </button>
                </div>
            ) : null}

            {unzipping ? <UnzipDialog ids={unzipping} onClose={() => setUnzipping(null)} /> : null}
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
                    onUnzip={() => setUnzipping([open.id])}
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
    onUnzip,
    categories,
    onClose,
    onGone,
}: {
    file: FileItem;
    onView: () => void;
    onUnzip: () => void;
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
                {/\.zip$/i.test(file.name) ? (
                    <button className="btn ghost" onClick={onUnzip}>
                        <FolderOpen size={16} />
                        Unzip
                    </button>
                ) : null}
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
