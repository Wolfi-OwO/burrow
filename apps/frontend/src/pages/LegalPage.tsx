import { marked } from 'marked';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import impressum from '../../../../IMPRESSUM.md?raw';
import privacy from '../../../../PRIVACY.md?raw';
import terms from '../../../../TERMS_OF_USE.md?raw';
import { Mark } from '../components/Shell.tsx';

const DOCUMENTS = { impressum, privacy, terms } as const;
export type LegalDocument = keyof typeof DOCUMENTS;

/** The documents link to each other by file name; in the app those become routes. */
const ROUTES: Record<string, string> = {
    'IMPRESSUM.md': '/impressum',
    'PRIVACY.md': '/privacy',
    'TERMS_OF_USE.md': '/terms',
};
const REPOSITORY = 'https://github.com/Wolfi-OwO/burrow/blob/main/';

const renderer = new marked.Renderer();
renderer.link = ({ href, title, tokens }) => {
    const text = renderer.parser.parseInline(tokens);
    const file = href.split('#')[0] ?? '';
    const target = ROUTES[file] ?? (/^[\w./-]+\.md$/.test(file) ? `${REPOSITORY}${file}` : href);
    const external = /^https?:/.test(target);
    const rel = external ? ' rel="noopener noreferrer" target="_blank"' : '';
    return `<a href="${target}"${title ? ` title="${title}"` : ''}${rel}>${text}</a>`;
};

// The text is this repository's own static files, bundled at build time; it never contains user input.
const html: Record<LegalDocument, string> = {
    impressum: marked.parse(impressum, { async: false, renderer }),
    privacy: marked.parse(privacy, { async: false, renderer }),
    terms: marked.parse(terms, { async: false, renderer }),
};

/** A public page (no sign-in): the Impressum has to be directly reachable. */
export function LegalPage({ doc }: { doc: LegalDocument }): ReactNode {
    return (
        <div className="legal">
            <header className="row" style={{ justifyContent: 'space-between' }}>
                <Link to="/" className="brand">
                    <Mark />
                    burrow
                </Link>
                <nav className="legal-nav" aria-label="Legal">
                    <Link to="/impressum" aria-current={doc === 'impressum' ? 'page' : undefined}>
                        Impressum
                    </Link>
                    <Link to="/privacy" aria-current={doc === 'privacy' ? 'page' : undefined}>
                        Privacy
                    </Link>
                    <Link to="/terms" aria-current={doc === 'terms' ? 'page' : undefined}>
                        Terms
                    </Link>
                </nav>
            </header>
            <article className="prose" dangerouslySetInnerHTML={{ __html: html[doc] }} />
        </div>
    );
}

/** The three links shown under the login form and in the sidebar. */
export function LegalLinks(): ReactNode {
    return (
        <nav className="legal-links" aria-label="Legal">
            <Link to="/impressum">Impressum</Link>
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
        </nav>
    );
}
