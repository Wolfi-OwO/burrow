import { useQuery } from '@tanstack/react-query';
import { FileText, Folder, Share2 } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { EditShareDialog, ShareRow } from '../components/ShareDialog.tsx';
import { Spinner } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import type { Share } from '../lib/types.ts';

/** Links I made, grouped by what they point at, and what others shared with me. */
export function SharesPage(): ReactNode {
    const [editing, setEditing] = useState<Share | null>(null);
    const mine = useQuery({
        queryKey: ['shares'],
        queryFn: () => api<{ shares: Share[] }>('GET', '/api/shares'),
    });
    const withMe = useQuery({
        queryKey: ['shared-with-me'],
        queryFn: () => api<{ shares: Share[] }>('GET', '/api/shared-with-me'),
    });
    const groups = new Map<string, Share[]>();
    for (const s of mine.data?.shares ?? []) {
        const key = `${s.kind}:${String(s.targetId)}`;
        groups.set(key, [...(groups.get(key) ?? []), s]);
    }
    return (
        <>
            <header className="page-head">
                <div>
                    <h1>Shared</h1>
                    <p>Links you made, and what other people shared with you.</p>
                </div>
            </header>

            <section aria-labelledby="by-me">
                <h2 id="by-me" className="section-h">
                    Shared by me
                </h2>
                {mine.isLoading ? <Spinner /> : null}
                {mine.data && mine.data.shares.length === 0 ? (
                    <div className="empty">
                        <Share2 size={26} aria-hidden="true" />
                        <h2>Nothing shared yet</h2>
                        <p>Open a file or hover a category and choose Share to make a link.</p>
                    </div>
                ) : null}
                {[...groups.values()].map((list) => (
                    <div
                        className="share-group"
                        key={`${list[0]?.kind ?? ''}${String(list[0]?.targetId ?? '')}`}
                    >
                        <h3>
                            {list[0]?.kind === 'file' ? (
                                <FileText size={16} />
                            ) : (
                                <Folder size={16} />
                            )}
                            {list[0]?.name}
                        </h3>
                        <ul className="share-list">
                            {list.map((s) => (
                                <ShareRow key={s.id} share={s} onEdit={() => setEditing(s)} />
                            ))}
                        </ul>
                    </div>
                ))}
            </section>

            <section aria-labelledby="with-me" style={{ marginTop: 36 }}>
                <h2 id="with-me" className="section-h">
                    Shared with me
                </h2>
                {withMe.data && withMe.data.shares.length === 0 ? (
                    <p className="muted">Nobody has shared anything with you yet.</p>
                ) : null}
                <ul className="share-list">
                    {withMe.data?.shares.map((s) => (
                        <li key={s.id} className="share-row">
                            <span className="share-icon" aria-hidden="true">
                                {s.kind === 'file' ? <FileText size={16} /> : <Folder size={16} />}
                            </span>
                            <span className="grow">
                                <strong>{s.name}</strong>
                                <span className="muted small">from {s.owner}</span>
                            </span>
                            <Link className="btn sm" to={`/s/${s.token}`}>
                                Open
                            </Link>
                        </li>
                    ))}
                </ul>
            </section>
            {editing ? <EditShareDialog share={editing} onClose={() => setEditing(null)} /> : null}
        </>
    );
}
