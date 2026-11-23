import { useEffect } from 'react';
import { useLocation } from 'react-router';

const ORIGIN = 'https://burrow.woofi-developments.at';
// What an anonymous visitor can open (the same list as public/sitemap.xml). Everything else is the private drive,
// a share link or a sign-in step and says noindex itself: a robots.txt Disallow alone never removes a URL from
// the index, because the crawler cannot see a noindex on a page it may not fetch.
const PUBLIC = new Set(['/', '/demo', '/impressum', '/privacy', '/terms']);

/**
 * index.html is served for every path, so without this each route inherits the canonical of "/" and Google files
 * /impressum and the rest as "alternate page with proper canonical". Public pages get their own; the rest noindex.
 */
export function RouteSeo(): null {
    const { pathname } = useLocation();
    useEffect(() => {
        const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
        const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
        document.querySelector('meta[name="robots"][data-route-seo]')?.remove();
        if (PUBLIC.has(path)) {
            if (canonical) canonical.href = `${ORIGIN}${path}`;
            document
                .querySelector('meta[property="og:url"]')
                ?.setAttribute('content', `${ORIGIN}${path}`);
        } else {
            const meta = document.createElement('meta');
            meta.name = 'robots';
            meta.content = 'noindex, nofollow';
            meta.dataset.routeSeo = '';
            document.head.appendChild(meta);
        }
    }, [pathname]);
    return null;
}
