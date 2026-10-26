/**
 * The prototype has no server: every /api call is answered here from an in-memory copy of example data, so the
 * real screens and flows can be clicked through. Nothing persists across a reload, on purpose.
 */
import type {
    Account,
    CategoryNode,
    FileItem,
    SortingStatus,
} from '../apps/frontend/src/lib/types.ts';

const owner: Account = {
    id: 'u1',
    username: 'wolf',
    displayName: 'Wolf',
    bio: 'Digging rooms since 2026.',
    hasAvatar: false,
    hasPassword: true,
    role: 'admin',
};

let signedIn = false;
let nextCategory = 10;
let categories: CategoryNode[] = [
    {
        id: 1,
        parentId: null,
        name: 'Photos',
        path: '1',
        depth: 0,
        fileCount: 0,
        publicPreview: false,
    },
    {
        id: 2,
        parentId: 1,
        name: 'Holidays',
        path: '1.2',
        depth: 1,
        fileCount: 0,
        publicPreview: false,
    },
    {
        id: 3,
        parentId: 1,
        name: 'Mountains',
        path: '1.3',
        depth: 1,
        fileCount: 0,
        publicPreview: false,
    },
    {
        id: 4,
        parentId: null,
        name: 'Documents',
        path: '4',
        depth: 0,
        fileCount: 0,
        publicPreview: false,
    },
    {
        id: 5,
        parentId: null,
        name: 'Screenshots',
        path: '5',
        depth: 0,
        fileCount: 0,
        publicPreview: false,
    },
];

const names: [string, number | null, FileItem['status'], number | null][] = [
    ['lake-sunrise.jpg', 2, 'sorted', null],
    ['beach-day.jpg', 2, 'sorted', null],
    ['old-town.jpg', 2, 'sorted', null],
    ['snowy-peak.jpg', 3, 'sorted', null],
    ['ridge-walk.jpg', 3, 'sorted', null],
    ['tax-2025.pdf', 4, 'sorted', null],
    ['lease-agreement.pdf', 4, 'sorted', null],
    ['recipe-notes.txt', 4, 'sorted', null],
    ['settings-dialog.png', 5, 'sorted', null],
    ['error-trace.png', 5, 'sorted', null],
    ['IMG_4821.jpg', null, 'review', 3],
    ['IMG_4822.jpg', null, 'review', 2],
    ['scan-0042.pdf', null, 'review', 4],
    ['untitled-1.png', null, 'unsorted', null],
];
const hues = [24, 200, 140, 260, 340, 48, 180, 300, 20, 100, 220, 60, 160, 280];
let files: FileItem[] = names.map(([name, categoryId, status, suggested], i) => ({
    id: `f${String(i + 1)}`,
    name,
    mime: name.endsWith('.pdf')
        ? 'application/pdf'
        : name.endsWith('.txt')
          ? 'text/plain'
          : 'image/jpeg',
    size: 80_000 + i * 173_000,
    status,
    categoryId,
    categoryPath: [],
    suggestedCategoryId: suggested,
    confidence: suggested ? 0.62 + (i % 3) * 0.1 : null,
    nsfwScore: 0.01,
    createdAt: new Date(Date.now() - i * 86_400_000).toISOString(),
}));

function pathNames(id: number | null): string[] {
    const out: string[] = [];
    let node = categories.find((c) => c.id === id);
    while (node) {
        out.unshift(node.name);
        const parent = node.parentId;
        node = categories.find((c) => c.id === parent);
    }
    return out;
}

function view(): FileItem[] {
    return files.map((f) => ({
        ...f,
        categoryPath: pathNames(f.categoryId),
        suggestedName: f.suggestedCategoryId ? pathNames(f.suggestedCategoryId).join(' / ') : null,
    }));
}

function tree(): CategoryNode[] {
    return categories.map((c) => ({
        ...c,
        fileCount: files.filter(
            (f) => f.categoryId !== null && inside(f.categoryId, c.id) && f.status === 'sorted',
        ).length,
    }));
}

function inside(child: number, ancestor: number): boolean {
    let node = categories.find((c) => c.id === child);
    while (node) {
        if (node.id === ancestor) return true;
        const parent = node.parentId;
        node = categories.find((c) => c.id === parent);
    }
    return false;
}

function thumb(file: FileItem): Response {
    const hue = hues[Number(file.id.slice(1)) % hues.length] ?? 30;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${String(hue)} 55% 62%)"/><stop offset="1" stop-color="hsl(${String(hue + 40)} 50% 38%)"/></linearGradient></defs><rect width="320" height="240" fill="url(#g)"/><path d="M0 190 L90 110 L150 165 L210 95 L320 200 V240 H0Z" fill="#fff" opacity=".22"/><circle cx="250" cy="55" r="22" fill="#fff" opacity=".35"/></svg>`;
    return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml' } });
}

const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const status: SortingStatus = {
    backlog: 4,
    categories: 5,
    runsPerDay: 4,
    intervalMinutes: 360,
    lastRunAt: new Date(Date.now() - 3_600_000).toISOString(),
    visionConfigured: true,
    visionHealthy: true,
    autoFileThreshold: 0.8,
};

function answer(method: string, url: URL, body: Record<string, unknown>): Response {
    const p = url.pathname;
    if (p === '/api/version') return json({ version: 'prototype' });
    if (p === '/api/auth/refresh') return signedIn ? json({ accessToken: 'demo' }) : json({}, 401);
    if (p === '/api/auth/providers')
        return json({ providers: ['github', 'microsoft', 'google'], setupRequired: false });
    if (p === '/api/auth/login' || p === '/api/auth/register') {
        signedIn = true;
        return json({ accessToken: 'demo', user: owner });
    }
    if (p === '/api/auth/logout') {
        signedIn = false;
        return json({}, 204);
    }
    if (!signedIn) return json({ message: 'Not signed in.' }, 401);
    if (p === '/api/me') return json(method === 'PATCH' ? Object.assign(owner, body) : owner);
    if (p === '/api/me/identities')
        return json({ identities: [{ provider: 'github', email: 'wolf@example.org' }] });
    if (p.startsWith('/api/me/identities/')) return json({ url: '#linked' });
    if (p === '/api/auth/password') return json({}, 204);
    if (p === '/api/categories' && method === 'GET') return json({ categories: tree() });
    if (p === '/api/categories' && method === 'POST') {
        const parentId = (body.parentId as number | null | undefined) ?? null;
        const id = nextCategory++;
        const parent = categories.find((c) => c.id === parentId);
        categories.push({
            id,
            parentId,
            name: String(body.name),
            path: parent ? `${parent.path}.${String(id)}` : String(id),
            depth: parent ? parent.depth + 1 : 0,
            fileCount: 0,
            publicPreview: false,
        });
        return json({ id }, 201);
    }
    const cat = /^\/api\/categories\/(\d+)(\/move)?$/.exec(p);
    if (cat) {
        const id = Number(cat[1]);
        if (method === 'DELETE') {
            categories = categories.filter((c) => c.id !== id);
            files = files.map((f) =>
                f.categoryId === id ? { ...f, categoryId: null, status: 'unsorted' } : f,
            );
            return json({}, 204);
        }
        const node = categories.find((c) => c.id === id);
        if (node && cat[2]) node.parentId = (body.parentId as number | null) ?? null;
        else if (node) Object.assign(node, body);
        return json({});
    }
    if (p === '/api/files' && method === 'GET') {
        const wanted = url.searchParams.get('category');
        let list = view();
        if (wanted === 'unsorted') list = list.filter((f) => f.categoryId === null);
        else if (wanted)
            list = list.filter(
                (f) => f.categoryId !== null && inside(f.categoryId, Number(wanted)),
            );
        return json({ files: list });
    }
    if (p === '/api/files' && method === 'POST') {
        const file: FileItem = {
            id: `f${String(files.length + 1)}`,
            name: 'new-upload.jpg',
            mime: 'image/jpeg',
            size: 420_000,
            status: 'unsorted',
            categoryId: null,
            categoryPath: [],
            suggestedCategoryId: null,
            confidence: null,
            nsfwScore: 0,
            createdAt: new Date().toISOString(),
        };
        files.unshift(file);
        return json({ file, deduplicated: false }, 201);
    }
    const one = /^\/api\/files\/(f\d+)(?:\/(content|thumbnail))?$/.exec(p);
    if (one) {
        const file = files.find((f) => f.id === one[1]);
        if (!file) return json({ message: 'Not found.' }, 404);
        if (one[2]) return thumb(file);
        if (method === 'DELETE') {
            files = files.filter((f) => f !== file);
            return json({}, 204);
        }
        if (method === 'PATCH') {
            if ('categoryId' in body) {
                file.categoryId = body.categoryId as number | null;
                file.status = file.categoryId === null ? 'unsorted' : 'sorted';
            }
            if (typeof body.name === 'string') file.name = body.name;
        }
        return json({ file });
    }
    if (p === '/api/review') return json({ files: view().filter((f) => f.status === 'review') });
    const review = /^\/api\/review\/(f\d+)$/.exec(p);
    if (review) {
        const file = files.find((f) => f.id === review[1]);
        if (file) {
            if (body.action === 'accept') file.categoryId = file.suggestedCategoryId;
            else if (body.action === 'move') file.categoryId = Number(body.categoryId);
            file.status = body.action === 'leave' ? 'unsorted' : 'sorted';
            if (body.action === 'leave') file.categoryId = null;
        }
        return json({});
    }
    if (p === '/api/sorting/status')
        return json({ ...status, backlog: files.filter((f) => f.status === 'review').length });
    if (p === '/api/sorting/run') return json({ ran: true, decided: 0 });
    if (p === '/api/search') {
        const q = (url.searchParams.get('q') ?? '').toLowerCase();
        const hits = view()
            .filter((f) => f.name.toLowerCase().includes(q))
            .map((f, i) => ({ ...f, rank: 1 - i * 0.1 }));
        return json({ total: hits.length, empty: hits.length === 0, files: hits });
    }
    return json({ message: 'Not part of the prototype.' }, 404);
}

export function installMockApi(): void {
    const real = window.fetch.bind(window);
    window.fetch = async (input, init) => {
        const url = new URL(
            typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
            location.href,
        );
        if (!url.pathname.startsWith('/api/')) return real(input, init);
        await new Promise((r) => setTimeout(r, 120));
        const method = (init?.method ?? 'GET').toUpperCase();
        let body: Record<string, unknown> = {};
        if (typeof init?.body === 'string') body = JSON.parse(init.body) as Record<string, unknown>;
        return answer(method, url, body);
    };
    // The provider buttons are plain links to the server's OAuth start; in the prototype they just sign in.
    document.addEventListener('click', (event) => {
        const link = (event.target as Element).closest('a[href^="/api/auth/"]');
        if (!link) return;
        event.preventDefault();
        signedIn = true;
        location.hash = '#/';
        location.reload();
    });
}
