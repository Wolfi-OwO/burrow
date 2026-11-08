import { useQuery } from '@tanstack/react-query';
import { FolderTree } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';
import type { ReactNode } from 'react';
import { Outlet, useNavigate, useSearchParams } from 'react-router';

import { api } from '../lib/api.ts';
import { SortRunProvider } from '../lib/sort-run.tsx';
import type { FileItem } from '../lib/types.ts';
import { Masthead } from './Masthead.tsx';
import { SortBar } from './SortBar.tsx';
import { Tree } from './Tree.tsx';
import { UploadTray } from './UploadTray.tsx';

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
        <SortRunProvider>
            <div
                className="shell"
                style={{ '--rail-w': `${String(rail.width)}px` } as CSSProperties}
            >
                <Masthead
                    waiting={waiting}
                    folder={typeof selected === 'number' ? selected : undefined}
                />
                <aside className="rail">
                    <div
                        className="rail-resizer"
                        role="separator"
                        aria-orientation="vertical"
                        aria-label="Resize the index"
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
                    <p className="rail-title">Index</p>
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
                </aside>
                <main className="main">
                    <SortBar />
                    <Outlet />
                    <UploadTray />
                </main>
            </div>
        </SortRunProvider>
    );
}
