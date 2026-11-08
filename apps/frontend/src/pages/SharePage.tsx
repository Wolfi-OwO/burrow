import { useInfiniteQuery } from '@tanstack/react-query';
import { FileText, Folder } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';

import { previewable } from '../components/FilePreview.tsx';
import { Lightbox } from '../components/Lightbox.tsx';
import { Mark } from '../components/Masthead.tsx';
import { ProtectedImage, Spinner } from '../components/ui.tsx';
import { api, ApiError, fetchBlob } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { formatBytes } from '../lib/format.ts';
import type { FileItem, Share, SharedFolder } from '../lib/types.ts';

/** What a share link opens: no sidebar, no account needed for open links, one quiet page of files. */
export function SharePage(): ReactNode {
    const { token = '' } = useParams();
    const { user } = useAuth();
    const [params, setParams] = useSearchParams();
    const folder = /^\d{1,12}$/.test(params.get('f') ?? '') ? (params.get('f') as string) : null;
    const [open, setOpen] = useState<FileItem | null>(null);
    const pages = useInfiniteQuery({
        queryKey: ['share', token, user?.id ?? 'guest', folder ?? 'root'],
        retry: false,
        initialPageParam: 0,
        queryFn: ({ pageParam }) =>
            api<{
                share: Share;
                files: FileItem[];
                hasMore: boolean;
                folders: SharedFolder[];
                trail: SharedFolder[];
            }>(
                'GET',
                `/api/s/${token}?offset=${String(pageParam)}${folder ? `&folder=${folder}` : ''}`,
            ),
        getNextPageParam: (last, all) =>
            last.hasMore ? all.reduce((n, p) => n + p.files.length, 0) : undefined,
    });
    // The rest of the page reads one flat list, as it did before the link was paged.
    const page = {
        isLoading: pages.isLoading,
        error: pages.error,
        data: pages.data
            ? {
                  share: pages.data.pages[0]?.share as Share,
                  files: pages.data.pages.flatMap((p) => p.files),
                  folders: pages.data.pages[0]?.folders ?? [],
                  trail: pages.data.pages[0]?.trail ?? [],
              }
            : undefined,
    };
    const failure = page.error instanceof ApiError ? page.error : null;
    const images = (page.data?.files ?? []).filter((f) => previewable(f.name, f.mime));
    const at = open ? images.findIndex((f) => f.id === open.id) : -1;
    const prev = at > 0 ? images[at - 1] : undefined;
    const next = at >= 0 ? images[at + 1] : undefined;

    const download = async (file: FileItem): Promise<void> => {
        const url = URL.createObjectURL(
            await fetchBlob(`/api/s/${token}/files/${file.id}/content?download=1`),
        );
        Object.assign(document.createElement('a'), { href: url, download: file.name }).click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
    };

    return (
        <div className="share-page">
            <header className="share-top">
                <Link to="/" className="brand">
                    <Mark size={26} />
                    burrow
                </Link>
                {page.data ? (
                    <span className="muted small">
                        {page.data.share.name} · shared by {page.data.share.owner}
                    </span>
                ) : null}
            </header>
            <main className="share-main">
                {page.isLoading ? (
                    <p className="muted">
                        <Spinner /> Opening the link
                    </p>
                ) : null}
                {failure ? (
                    <div className="empty">
                        <h2>
                            {failure.status === 401
                                ? 'Sign in to open this link'
                                : failure.status === 403
                                  ? 'This link is not for you'
                                  : 'This link is not available'}
                        </h2>
                        <p>{failure.message}</p>
                        {failure.status === 401 ? (
                            <Link className="btn" to="/login">
                                Sign in
                            </Link>
                        ) : null}
                    </div>
                ) : null}
                {page.data ? (
                    <>
                        <h1>{page.data.share.name}</h1>
                        {page.data.trail.length > 1 ? (
                            <nav className="crumbs" aria-label="Where you are">
                                {page.data.trail.map((c, i) => (
                                    <span key={c.id}>
                                        {i > 0 ? ' / ' : ''}
                                        {i === (page.data?.trail.length ?? 0) - 1 ? (
                                            <b>{c.name}</b>
                                        ) : (
                                            <button
                                                type="button"
                                                className="linklike"
                                                onClick={() =>
                                                    setParams(i === 0 ? {} : { f: String(c.id) })
                                                }
                                            >
                                                {c.name}
                                            </button>
                                        )}
                                    </span>
                                ))}
                            </nav>
                        ) : null}
                        <p className="muted small" style={{ marginBottom: 20 }}>
                            {page.data.folders.length > 0
                                ? `${String(page.data.folders.length)} folder${page.data.folders.length === 1 ? '' : 's'} · `
                                : ''}
                            {page.data.files.length} file{page.data.files.length === 1 ? '' : 's'}
                        </p>
                        {page.data.folders.length > 0 ? (
                            <div className="grid" style={{ marginBottom: 20 }}>
                                {page.data.folders.map((f) => (
                                    <button
                                        key={f.id}
                                        className="card"
                                        onClick={() => setParams({ f: String(f.id) })}
                                    >
                                        <span className="thumb">
                                            <Folder size={34} aria-hidden="true" />
                                        </span>
                                        <span className="fname" title={f.name}>
                                            {f.name}
                                        </span>
                                        <span className="meta">
                                            {f.fileCount} file{f.fileCount === 1 ? '' : 's'}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        ) : null}
                        <div className="grid">
                            {page.data.files.map((file) => (
                                <button
                                    key={file.id}
                                    className="card"
                                    onClick={() => setOpen(file)}
                                >
                                    <span className="thumb">
                                        {file.mime.startsWith('image/') ? (
                                            <ProtectedImage
                                                path={`/api/s/${token}/files/${file.id}/thumbnail`}
                                                alt=""
                                            />
                                        ) : (
                                            <FileText size={34} aria-hidden="true" />
                                        )}
                                    </span>
                                    <span className="fname" title={file.name}>
                                        {file.name}
                                    </span>
                                    <span className="meta">{formatBytes(file.size)}</span>
                                </button>
                            ))}
                        </div>
                        {pages.hasNextPage ? (
                            <div
                                className="row"
                                style={{ justifyContent: 'center', margin: '20px 0' }}
                            >
                                <button
                                    className="btn"
                                    disabled={pages.isFetchingNextPage}
                                    onClick={() => void pages.fetchNextPage()}
                                >
                                    {pages.isFetchingNextPage ? <Spinner /> : null}Load more
                                </button>
                            </div>
                        ) : null}
                    </>
                ) : null}
            </main>
            {open ? (
                <Lightbox
                    name={open.name}
                    mime={open.mime}
                    size={open.size}
                    path={`/api/s/${token}/files/${open.id}/content`}
                    onClose={() => setOpen(null)}
                    onDownload={() => void download(open)}
                    onPrev={prev ? () => setOpen(prev) : undefined}
                    onNext={next ? () => setOpen(next) : undefined}
                />
            ) : null}
        </div>
    );
}
