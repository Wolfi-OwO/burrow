import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

interface BuildInfo {
    version: string;
    revision?: string;
    buildDate?: string;
    repositoryUrl?: string;
}

/** The status page lives on its own subdomain of the same registrable domain, like in the other apps. */
function siblingUrl(subdomain: string, path = ''): string {
    const { protocol, hostname, port } = window.location;
    const base = hostname.split('.').slice(-2).join('.');
    return `${protocol}//${subdomain}${base}${port ? `:${port}` : ''}${path}`;
}

function repoSlug(url?: string): string {
    return url?.replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '') ?? '';
}

function BuildChip({ info }: { info: BuildInfo }): ReactNode {
    const tooltip = [
        info.revision && `revision ${info.revision}`,
        info.buildDate && `built ${info.buildDate}`,
    ]
        .filter(Boolean)
        .join(' · ');
    const chip = (
        <span className="build-chip" title={tooltip || undefined}>
            <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
            >
                <path d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" />
            </svg>
            <span className="build-chip-name">{repoSlug(info.repositoryUrl) || 'local'}</span>
            <span className="build-chip-dot">·</span>
            <span>{info.version}</span>
        </span>
    );
    return info.repositoryUrl ? (
        <a
            className="build-chip-link"
            href={info.repositoryUrl}
            target="_blank"
            rel="noopener noreferrer"
        >
            {chip}
        </a>
    ) : (
        chip
    );
}

/** Same bottom bar as the other apps: copyright, build chip, then Status, Impressum, Privacy Policy and Contact. */
export function Footer(): ReactNode {
    const build = useQuery({
        queryKey: ['build'],
        queryFn: async (): Promise<BuildInfo> => {
            const response = await fetch('/api/version');
            if (!response.ok) throw new Error('no version');
            return (await response.json()) as BuildInfo;
        },
        staleTime: Infinity,
        retry: false,
    });
    return (
        <footer className="app-footer">
            <div className="app-footer-grid">
                <p className="footer-copy">
                    <span className="nowrap">
                        <span className="mono">© {new Date().getFullYear()}</span>{' '}
                        Woofi-Developments
                    </span>
                    <span className="nowrap footer-rights">All Rights Reserved.</span>
                </p>
                <div className="footer-build">
                    {build.data ? <BuildChip info={build.data} /> : null}
                </div>
                <ul className="footer-links" aria-label="Legal and contact">
                    <li>
                        <a href={siblingUrl('status.')} className="footer-link">
                            <span className="live-dot" />
                            Status
                        </a>
                    </li>
                    <li>
                        <Link to="/impressum" className="footer-link">
                            Impressum
                        </Link>
                    </li>
                    <li>
                        <Link to="/privacy" className="footer-link">
                            Privacy Policy
                        </Link>
                    </li>
                    <li>
                        <a href={siblingUrl('', '/contact')} className="footer-link">
                            Contact
                        </a>
                    </li>
                </ul>
            </div>
        </footer>
    );
}
