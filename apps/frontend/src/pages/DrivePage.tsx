import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Copy, Download, Search, Trash2, UploadCloud, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import { FileCard } from '../components/FileCard.tsx';
import { Spinner, ProtectedImage, useToast } from '../components/ui.tsx';
import { api, ApiError, fetchBlob, uploadForm } from '../lib/api.ts';
import { formatBytes } from '../lib/format.ts';
import type { CategoryNode, FileItem } from '../lib/types.ts';

interface UploadState {
    id: number;
    name: string;
    state: 'sending' | 'new' | 'duplicate' | 'failed';
    message?: string;
}

export function DrivePage(): ReactNode {
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const client = useQueryClient();
    const toast = useToast();
    const raw = params.get('c');
    const category = raw === null ? undefined : raw === 'unsorted' ? 'unsorted' : Number(raw);
    const [openId, setOpenId] = useState<string | null>(null);
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

    const upload = async (list: File[]): Promise<void> => {
        for (const file of list) {
            const id = Date.now() + Math.random();
            setUploads((u) => [{ id, name: file.name, state: 'sending' }, ...u]);
            try {
                const result = await uploadForm<{ file: FileItem; deduplicated: boolean }>(
                    'POST',
                    '/api/files',
                    file,
                );
                // Filed into the category being viewed, so "upload here" does what it says.
                if (typeof category === 'number')
                    await api('PATCH', `/api/files/${result.file.id}`, { categoryId: category });
                setUploads((u) =>
                    u.map((x) =>
                        x.id === id
                            ? { ...x, state: result.deduplicated ? 'duplicate' : 'new' }
                            : x,
                    ),
                );
            } catch (error) {
                const message =
                    error instanceof ApiError && error.status === 413
                        ? 'Too large'
                        : error instanceof Error
                          ? error.message
                          : 'Failed';
                setUploads((u) =>
                    u.map((x) => (x.id === id ? { ...x, state: 'failed', message } : x)),
                );
            }
        }
        void client.invalidateQueries({ queryKey: ['files'] });
        void client.invalidateQueries({ queryKey: ['tree'] });
        void client.invalidateQueries({ queryKey: ['sorting'] });
    };
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
                    or click to choose. The AI sorts the rest into your categories.
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
                    {uploads.slice(0, 6).map((u) => (
                        <div className="upload-row" key={u.id}>
                            {u.state === 'sending' ? (
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
                                {u.state === 'duplicate'
                                    ? 'already stored, kept once'
                                    : u.state === 'failed'
                                      ? (u.message ?? 'failed')
                                      : u.state === 'new'
                                        ? 'stored'
                                        : 'sending'}
                            </span>
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

            {open ? (
                <Details
                    file={open}
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
    categories,
    onClose,
    onGone,
}: {
    file: FileItem;
    categories: CategoryNode[];
    onClose: () => void;
    onGone: () => void;
}): ReactNode {
    const client = useQueryClient();
    const toast = useToast();
    const [name, setName] = useState(file.name);
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
                    <ProtectedImage path={`/api/files/${file.id}/content`} alt={file.name} />
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
                <button className="btn danger" onClick={() => remove.mutate()}>
                    <Trash2 size={16} />
                    Delete
                </button>
            </div>
        </aside>
    );
}
