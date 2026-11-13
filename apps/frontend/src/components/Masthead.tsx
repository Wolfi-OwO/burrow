import {
    ChevronDown,
    ClipboardCheck,
    Copy,
    HardDrive,
    LogOut,
    Moon,
    Search,
    Share2,
    Sparkles,
    Sun,
    UploadCloud,
    UserRound,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router';

import { useAuth } from '../lib/auth.tsx';
import { useUploads } from '../lib/uploads.tsx';
import { ProtectedImage } from './ui.tsx';

const NAV = [
    { to: '/', label: 'Drive', icon: HardDrive },
    { to: '/review', label: 'Review', icon: ClipboardCheck },
    { to: '/assistant', label: 'Assistant', icon: Sparkles },
    { to: '/duplicates', label: 'Duplicates', icon: Copy },
    { to: '/shared', label: 'Shared', icon: Share2 },
] as const;

/** The mark: a burrow mouth, an arch over a dark tunnel. */
export function Mark({ size = 34 }: { size?: number }): ReactNode {
    return (
        <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
            <rect width="64" height="64" rx="6" fill="var(--accent)" />
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

function currentTheme(): 'light' | 'dark' {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/**
 * The top bar: where you are (tabs), where to go from anywhere (search and upload) and who you are (menu).
 * Search and upload live here because they are the two things people do from every page.
 */
export function Masthead({
    waiting,
    folder,
}: {
    waiting: number;
    /** The category open in the drive, so an upload from any page lands where the user is looking. */
    folder: number | undefined;
}): ReactNode {
    const navigate = useNavigate();
    const { upload } = useUploads();
    const picker = useRef<HTMLInputElement>(null);
    const search = useRef<HTMLInputElement>(null);
    const [searching, setSearching] = useState(false);

    // "/" and Cmd/Ctrl+K jump to search from anywhere, unless the user is already typing somewhere.
    useEffect(() => {
        const onKey = (event: KeyboardEvent): void => {
            const target = event.target as HTMLElement | null;
            const typing =
                target !== null &&
                (target.tagName === 'INPUT' ||
                    target.tagName === 'TEXTAREA' ||
                    target.tagName === 'SELECT' ||
                    target.isContentEditable);
            const chord = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
            if (chord || (event.key === '/' && !typing)) {
                event.preventDefault();
                setSearching(true);
                search.current?.focus();
                search.current?.select();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    const submit = (event: FormEvent<HTMLFormElement>): void => {
        event.preventDefault();
        const q = search.current?.value.trim() ?? '';
        // Searching from inside a folder looks in that folder and the ones below it; the results page can widen it.
        const folder =
            window.location.pathname === '/'
                ? new URLSearchParams(window.location.search).get('c')
                : null;
        if (q)
            navigate(
                `/search?q=${encodeURIComponent(q)}${folder && /^\d{1,12}$/.test(folder) ? `&c=${folder}` : ''}`,
            );
        setSearching(false);
        search.current?.blur();
    };

    return (
        <header className={`mast ${searching ? 'searching' : ''}`}>
            <Link to="/" className="brand" aria-label="burrow, home" title="burrow, home">
                <Mark size={30} />
                <span className="brand-name">burrow</span>
            </Link>

            <nav className="tabs" aria-label="Main">
                {NAV.map((item) => (
                    <NavLink key={item.to} to={item.to} end={item.to === '/'} title={item.label}>
                        <item.icon size={17} aria-hidden="true" />
                        <span className="tab-label">{item.label}</span>
                        {item.to === '/review' && waiting > 0 ? (
                            <span className="count" aria-label={`${String(waiting)} waiting`}>
                                {waiting}
                            </span>
                        ) : null}
                    </NavLink>
                ))}
            </nav>

            <form className="mast-search" role="search" onSubmit={submit}>
                <Search size={16} aria-hidden="true" />
                <input
                    ref={search}
                    type="search"
                    aria-label="Search your files"
                    title="Search your files"
                    placeholder="Search files"
                    onFocus={() => setSearching(true)}
                    onBlur={() => setSearching(false)}
                />
                <kbd aria-hidden="true">/</kbd>
            </form>
            <button
                type="button"
                className="tool mast-search-open"
                aria-label="Search your files"
                title="Search your files"
                onClick={() => {
                    setSearching(true);
                    window.setTimeout(() => search.current?.focus(), 0);
                }}
            >
                <Search size={18} />
            </button>

            <button
                type="button"
                className="btn sm mast-upload"
                onClick={() => picker.current?.click()}
            >
                <UploadCloud size={16} aria-hidden="true" />
                <span>Upload</span>
            </button>
            <input
                ref={picker}
                type="file"
                multiple
                hidden
                onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    event.target.value = '';
                    if (files.length > 0) void upload(files, folder);
                }}
            />

            <UserMenu />
        </header>
    );
}

/** The account menu: profile, the light/dark look, and signing out. */
function UserMenu(): ReactNode {
    const { user, logout } = useAuth();
    const [open, setOpen] = useState(false);
    const [theme, setTheme] = useState(currentTheme);
    const root = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onPointer = (event: PointerEvent): void => {
            if (!root.current?.contains(event.target as Node)) setOpen(false);
        };
        const onKey = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('pointerdown', onPointer);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('pointerdown', onPointer);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const flip = (): void => {
        const next = theme === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = next;
        try {
            localStorage.setItem('theme', next);
        } catch {
            // Storage blocked: the choice lasts until the page is closed.
        }
        setTheme(next);
    };

    return (
        <div className="usermenu" ref={root}>
            <button
                type="button"
                className="usermenu-trigger"
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label="Account menu"
                title="Account menu"
                onClick={() => setOpen((v) => !v)}
            >
                <span className="avatar">
                    {user?.hasAvatar ? (
                        <ProtectedImage path={`/api/users/${user.id}/avatar`} alt="" />
                    ) : (
                        (user?.displayName[0] ?? '?').toUpperCase()
                    )}
                </span>
                <ChevronDown size={14} aria-hidden="true" className="usermenu-chevron" />
            </button>
            {open ? (
                <div className="usermenu-pop" role="menu" aria-label="Account">
                    <div className="usermenu-who">
                        <strong>{user?.displayName}</strong>
                        <span className="muted small">@{user?.username}</span>
                    </div>
                    <Link role="menuitem" to="/profile" onClick={() => setOpen(false)}>
                        <UserRound size={16} aria-hidden="true" />
                        Profile
                    </Link>
                    <button role="menuitem" type="button" onClick={flip}>
                        {theme === 'dark' ? (
                            <Sun size={16} aria-hidden="true" />
                        ) : (
                            <Moon size={16} aria-hidden="true" />
                        )}
                        {theme === 'dark' ? 'Light look' : 'Dark look'}
                    </button>
                    <button
                        role="menuitem"
                        type="button"
                        onClick={() => {
                            setOpen(false);
                            void logout();
                        }}
                    >
                        <LogOut size={16} aria-hidden="true" />
                        Sign out
                    </button>
                </div>
            ) : null}
        </div>
    );
}
