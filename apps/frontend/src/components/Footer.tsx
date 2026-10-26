import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { LegalLinks } from '../pages/LegalPage.tsx';

interface BuildInfo {
    version: string;
}

/** Slim bar along the bottom of every page: copyright, the legal pages and the running build. */
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
            <span className="muted">© {new Date().getFullYear()} burrow</span>
            <LegalLinks />
            {build.data ? <span className="build-pill">{build.data.version}</span> : null}
        </footer>
    );
}
