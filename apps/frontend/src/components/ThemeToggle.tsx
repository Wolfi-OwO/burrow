import type { ReactNode } from 'react';
import { useState } from 'react';

function current(): 'light' | 'dark' {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/** Switches between the light and dark look and remembers the choice; theme.js applies it on the next load. */
export function ThemeToggle({ className = '' }: { className?: string }): ReactNode {
    const [theme, setTheme] = useState(current);
    const next = theme === 'dark' ? 'light' : 'dark';
    return (
        <button
            type="button"
            className={`theme-toggle ${className}`.trim()}
            aria-label={`Switch to ${next} mode`}
            data-tip={`Switch to ${next} mode`}
            onClick={() => {
                document.documentElement.dataset.theme = next;
                try {
                    localStorage.setItem('theme', next);
                } catch {
                    // Storage blocked: the choice lasts until the page is closed.
                }
                setTheme(next);
            }}
        >
            <svg
                className="moon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
            >
                <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
            </svg>
            <svg
                className="sun"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
            >
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
            </svg>
        </button>
    );
}
