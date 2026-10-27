import { useQuery } from '@tanstack/react-query';
import { UploadTray } from './UploadTray.tsx';
import { ThemeToggle } from './ThemeToggle.tsx';
import {
    ClipboardCheck,
    Copy,
    FolderTree,
    HardDrive,
    LogOut,
    Share2,
    UserRound,
} from 'lucide-react';
import { useCallback, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';
import type { ReactNode } from 'react';
import { NavLink, Outlet, useNavigate, useSearchParams } from 'react-router';

import { api } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import type { FileItem } from '../lib/types.ts';
import { ProtectedImage } from './ui.tsx';
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

const RAIL_MIN = 200;
const RAIL_MAX = 560;
const RAIL_DEFAULT = 300;

function savedRailWidth(): number {
    try {
        const saved = Number(localStorage.getItem('railWidth'));
        return saved >= RAIL_MIN && saved <= RAIL_MAX ? saved : RAIL_DEFAULT;
    } catch {
        return RAIL_DEFAULT;
    }
}

/** The left rail's width, draggable by its edge (pointer or arrow keys), remembered between visits. */
function useRailWidth(): {
    width: number;
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
    reset: () => void;
} {
    const [width, setWidth] = useState(savedRailWidth);
    const apply = useCallback((next: number) => {
        const clamped = Math.min(RAIL_MAX, Math.max(RAIL_MIN, Math.round(next)));
        setWidth(clamped);
        try {
            localStorage.setItem('railWidth', String(clamped));
        } catch {
            // Storage blocked: the width lasts until the page is closed.
        }
    }, []);
    return {
        width,
        onPointerDown: (event) => event.currentTarget.setPointerCapture(event.pointerId),
        onPointerMove: (event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) apply(event.clientX);
        },
        onKeyDown: (event) => {
            if (event.key === 'ArrowLeft') apply(width - 16);
            else if (event.key === 'ArrowRight') apply(width + 16);
            else if (event.key === 'Home') apply(RAIL_DEFAULT);
            else return;
            event.preventDefault();
        },
        reset: () => apply(RAIL_DEFAULT),
    };
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

    const rail = useRailWidth();

    return (
        <div className="shell" style={{ '--rail-w': `${String(rail.width)}px` } as CSSProperties}>
            <aside className="rail">
                <div
                    className="rail-resizer"
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize the sidebar"
                    aria-valuemin={RAIL_MIN}
                    aria-valuemax={RAIL_MAX}
                    aria-valuenow={rail.width}
                    tabIndex={0}
                    onPointerDown={rail.onPointerDown}
                    onPointerMove={rail.onPointerMove}
                    onKeyDown={rail.onKeyDown}
                    onDoubleClick={rail.reset}
                    title="Drag to resize, double-click to reset"
                />
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
                    <NavLink to="/duplicates">
                        <Copy size={18} />
                        Duplicates
                    </NavLink>
                    <NavLink to="/shared">
                        <Share2 size={18} />
                        Shared
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
                <UploadTray />
            </main>
        </div>
    );
}
