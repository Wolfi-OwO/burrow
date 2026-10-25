import { useQuery } from '@tanstack/react-query';
import { ThemeToggle } from './ThemeToggle.tsx';
import { ClipboardCheck, FolderTree, HardDrive, LogOut, UserRound } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { NavLink, Outlet, useNavigate, useSearchParams } from 'react-router';

import { api } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import type { FileItem } from '../lib/types.ts';
import { ProtectedImage } from './ui.tsx';
import { LegalLinks } from '../pages/LegalPage.tsx';
import { Tree } from './Tree.tsx';

/** The burrow's mouth: an arch over a dark tunnel. */
export function Mark({ size = 34 }: { size?: number }): ReactNode {
    return (
        <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
            <rect width="64" height="64" rx="18" fill="var(--accent)" />
            <ellipse cx="32" cy="38" rx="17" ry="13" fill="var(--text)" opacity="0.88" />
            <path
                d="M12 38c0-14 9-24 20-24s20 10 20 24"
                fill="none"
                stroke="var(--on-accent)"
                strokeWidth="4"
                strokeLinecap="round"
            />
        </svg>
    );
}

/** Left rail on every page: navigation, then the category tree that is the heart of the drive. */
export function Shell(): ReactNode {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const raw = params.get('c');
    const selected = raw === null ? null : raw === 'unsorted' ? 'unsorted' : Number(raw);
    const review = useQuery({
        queryKey: ['review'],
        queryFn: () => api<{ files: FileItem[] }>('GET', '/api/review'),
        refetchInterval: 60_000,
    });
    const waiting = review.data?.files.length ?? 0;
    // Only matters below 880px, where the tree sits behind a toggle instead of filling the first screen.
    const [treeOpen, setTreeOpen] = useState(false);

    return (
        <div className="shell">
            <aside className="rail">
                <NavLink to="/" className="brand">
                    <Mark />
                    burrow
                </NavLink>
                <nav className="nav" aria-label="Main">
                    <NavLink to="/" end>
                        <HardDrive size={18} />
                        Drive
                    </NavLink>
                    <NavLink to="/review">
                        <ClipboardCheck size={18} />
                        Review
                        {waiting > 0 ? (
                            <span className="count" aria-label={`${String(waiting)} waiting`}>
                                {waiting}
                            </span>
                        ) : null}
                    </NavLink>
                    <NavLink to="/profile">
                        <UserRound size={18} />
                        Profile
                    </NavLink>
                </nav>
                <button
                    className="btn ghost sm tree-toggle"
                    aria-expanded={treeOpen}
                    aria-controls="category-tree"
                    onClick={() => setTreeOpen((v) => !v)}
                >
                    <FolderTree size={15} />
                    Categories
                </button>
                <div id="category-tree" className={`tree-wrap ${treeOpen ? 'open' : ''}`}>
                    <Tree
                        selected={selected}
                        onSelect={(value) => {
                            setTreeOpen(false);
                            navigate(value === null ? '/' : `/?c=${String(value)}`);
                        }}
                    />
                </div>
                <LegalLinks />
                <div className="rail-foot">
                    <span className="avatar">
                        {user?.hasAvatar ? (
                            <ProtectedImage path={`/api/users/${user.id}/avatar`} alt="" />
                        ) : (
                            (user?.displayName[0] ?? '?').toUpperCase()
                        )}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                        <strong
                            style={{
                                display: 'block',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            {user?.displayName}
                        </strong>
                        <span className="muted small">@{user?.username}</span>
                    </span>
                    <ThemeToggle />
                    <button className="tool" aria-label="Sign out" onClick={() => void logout()}>
                        <LogOut size={17} />
                    </button>
                </div>
            </aside>
            <main className="main">
                <Outlet />
            </main>
        </div>
    );
}
