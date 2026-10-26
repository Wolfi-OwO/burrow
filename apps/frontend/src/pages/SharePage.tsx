import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';

import { Lightbox } from '../components/Lightbox.tsx';
import { Mark } from '../components/Shell.tsx';
import { ProtectedImage, Spinner } from '../components/ui.tsx';
import { api, ApiError, fetchBlob } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { formatBytes } from '../lib/format.ts';
import type { FileItem, Share } from '../lib/types.ts';

/** What a share link opens: no sidebar, no account needed for open links, one quiet page of files. */
export function SharePage(): ReactNode {
    const { token = '' } = useParams();
    const { user } = useAuth();
    const [open, setOpen] = useState<FileItem | null>(null);
    const page = useQuery({
        queryKey: ['share', token, user?.id ?? 'guest'],
        retry: false,
        queryFn: () => api<{ share: Share; files: FileItem[] }>('GET', `/api/s/${token}`),
    });
    const failure = page.error instanceof ApiError ? page.error : null;
    const images = (page.data?.files ?? []).filter((f) => f.mime.startsWith('image/'));
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
                        <p className="muted small" style={{ marginBottom: 20 }}>
                            {page.data.files.length} file{page.data.files.length === 1 ? '' : 's'}
                        </p>
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
                    </>
                ) : null}
            </main>
            {open ? (
                <Lightbox
                    name={open.name}
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
