import { useQuery } from '@tanstack/react-query';
import { SearchX } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';

import { Spinner, ProtectedImage } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { formatBytes } from '../lib/format.ts';
import type { FileItem } from '../lib/types.ts';

/** Ranked results as a list, each with where it sits in the tree (FR-020 to FR-022). */
export function SearchPage(): ReactNode {
    const [params] = useSearchParams();
    const q = params.get('q') ?? '';
    const result = useQuery({
        queryKey: ['search', q],
        enabled: q.length > 0,
        queryFn: () =>
            api<{
                total: number;
                empty: boolean;
                files: (FileItem & { categoryId: number | null })[];
            }>('GET', `/api/search?q=${encodeURIComponent(q)}`),
    });
    const best = Math.max(...(result.data?.files.map((f) => f.rank ?? 0) ?? [0]), 0.0001);

    return (
        <>
            <header className="page-head">
                <div>
                    <h1>Search</h1>
                    <p>
                        {q ? (
                            <>
                                Results for <b>&ldquo;{q}&rdquo;</b>, best match first.
                            </>
                        ) : (
                            'Type a file name in the search box on the drive page.'
                        )}
                    </p>
                </div>
                <Link className="btn ghost" to="/">
                    Back to the drive
                </Link>
            </header>
            {result.isLoading ? (
                <p className="muted">
                    <Spinner /> Searching
                </p>
            ) : null}
            {result.data?.empty ? (
                <div className="empty">
                    <SearchX size={36} aria-hidden="true" />
                    <h2>Nothing matches &ldquo;{q}&rdquo;</h2>
                    <p>Search looks at file names, word by word. Try fewer or different words.</p>
                </div>
            ) : null}
            <ol className="review-list" style={{ listStyle: 'none', padding: 0 }}>
                {result.data?.files.map((file) => (
                    <li
                        key={file.id}
                        className="review-item"
                        style={{ gridTemplateColumns: '84px 1fr auto' }}
                    >
                        <span className="thumb" style={{ width: 84 }}>
                            {file.mime.startsWith('image/') ? (
                                <ProtectedImage path={`/api/files/${file.id}/thumbnail`} alt="" />
                            ) : null}
                        </span>
                        <span>
                            <strong>{file.name}</strong>
                            <span className="crumbs" style={{ display: 'flex' }}>
                                {file.categoryPath.length > 0 ? (
                                    file.categoryPath.map((p, i) => (
                                        <span key={i}>
                                            {i > 0 ? '/ ' : ''}
                                            {p}
                                        </span>
                                    ))
                                ) : (
                                    <span>Unsorted</span>
                                )}
                                <span>&middot; {formatBytes(file.size)}</span>
                            </span>
                        </span>
                        <span style={{ display: 'grid', gap: 8, justifyItems: 'end' }}>
                            <span className="meter" title="relevance" aria-label="relevance">
                                <i
                                    style={{
                                        width: `${String(Math.max(8, Math.round(((file.rank ?? 0) / best) * 100)))}%`,
                                    }}
                                />
                            </span>
                            <Link
                                className="btn sm ghost"
                                to={
                                    file.categoryId === null
                                        ? '/?c=unsorted'
                                        : `/?c=${String(file.categoryId)}`
                                }
                            >
                                Show in tree
                            </Link>
                        </span>
                    </li>
                ))}
            </ol>
        </>
    );
}
