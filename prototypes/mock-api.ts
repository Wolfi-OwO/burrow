/**
 * The prototype has no server: every /api call is answered here from an in-memory copy of example data, so the
 * real screens and flows can be clicked through. Nothing persists across a reload, on purpose.
 */
import { sampleResponse } from './samples.ts';
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
let dupesGone = false;
let ratingsFixed = false;
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
    ['notes.txt', 4, 'sorted', null],
    ['report.pdf', 4, 'sorted', null],
    ['people.csv', 4, 'sorted', null],
    ['letter.docx', 4, 'sorted', null],
    ['budget.xlsx', 4, 'sorted', null],
    ['deck.pptx', 4, 'sorted', null],
    ['letter.doc', 4, 'sorted', null],
    ['budget.xls', 4, 'sorted', null],
    ['deck.ppt', 4, 'sorted', null],
    ['holiday-photos.zip', 2, 'sorted', null],
    ['old-documents.zip', 4, 'sorted', null],
];
const hues = [
    24, 200, 140, 260, 340, 48, 180, 300, 20, 100, 220, 60, 160, 280, 40, 80, 120, 160, 200, 240,
];
const placeOf: Record<number, string> = {
    0: 'Alpine lake',
    1: 'Beach',
    2: 'Old town',
    3: 'Matterhorn, Switzerland',
};
let files: FileItem[] = names.map(([name, categoryId, status, suggested], i) => ({
    place: placeOf[i] ?? null,
    placeScore: placeOf[i] ? 0.62 : null,
    latitude: i === 3 ? 45.9763 : null,
    longitude: i === 3 ? 7.6586 : null,
    id: `f${String(i + 1)}`,
    name,
    mime: name.endsWith('.pdf')
        ? 'application/pdf'
        : name.endsWith('.txt')
          ? 'text/plain'
          : /\.(csv|docx|xlsx|pptx|doc|xls|ppt)$/.test(name)
            ? 'application/octet-stream'
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

function fetchSample(name: string): Response {
    return sampleResponse(name) ?? new Response('', { status: 404 });
}

function thumb(file: FileItem): Response {
    const hue = hues[Number(file.id.slice(1)) % hues.length] ?? 30;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200" viewBox="0 0 320 240"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${String(hue)} 55% 62%)"/><stop offset="1" stop-color="hsl(${String(hue + 40)} 50% 38%)"/></linearGradient></defs><rect width="320" height="240" fill="url(#g)"/><path d="M0 190 L90 110 L150 165 L210 95 L320 200 V240 H0Z" fill="#fff" opacity=".22"/><circle cx="250" cy="55" r="22" fill="#fff" opacity=".35"/></svg>`;
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

interface MockShare {
    id: string;
    token: string;
    kind: 'file' | 'category';
    targetId: string | number;
    access: 'link' | 'users';
    expiresAt: string | null;
    revoked: boolean;
    userIds: string[];
}
const people = [
    { id: 'u2', username: 'mira', displayName: 'Mira Fuchs' },
    { id: 'u3', username: 'tobi', displayName: 'Tobias Wald' },
    { id: 'u4', username: 'lena', displayName: 'Lena Berger' },
];
let shares: MockShare[] = [
    {
        id: 's1',
        token: 'demo-token-holidays-0123456789abcdef',
        kind: 'category',
        targetId: 2,
        access: 'link',
        expiresAt: null,
        revoked: false,
        userIds: [],
    },
];
function shareView(s: MockShare): Record<string, unknown> {
    const name =
        s.kind === 'file'
            ? (files.find((f) => f.id === s.targetId)?.name ?? 'file')
            : (categories.find((c) => c.id === s.targetId)?.name ?? 'category');
    return {
        id: s.id,
        token: s.token,
        kind: s.kind,
        targetId: s.targetId,
        name,
        owner: owner.displayName,
        access: s.access,
        expiresAt: s.expiresAt,
        revoked: s.revoked,
        expired: s.expiresAt !== null && new Date(s.expiresAt).getTime() < Date.now(),
        createdAt: new Date().toISOString(),
        users: people.filter((p) => s.userIds.includes(p.id)),
    };
}

const KINDS: Record<string, RegExp> = {
    image: /\.(jpe?g|png|gif|webp)$/i,
    document: /\.(pdf|docx?|odt|txt|md)$/i,
    spreadsheet: /\.(xlsx?|ods|csv)$/i,
    presentation: /\.(pptx?|odp)$/i,
    archive: /\.(zip|7z|rar|tar|gz)$/i,
    code: /\.(json|xml|ya?ml|toml|js|ts|tsx|py|java|go|rs|sh|sql|css|html?)$/i,
    route: /\.(gpx|tcx|kml|geojson)$/i,
};
function kindOf(name: string): string {
    return Object.entries(KINDS).find(([, re]) => re.test(name))?.[0] ?? 'other';
}

function answer(
    method: string,
    url: URL,
    body: Record<string, unknown>,
): Response | Promise<Response> {
    const p = url.pathname;
    if (p === '/api/version') return json({ version: 'prototype' });
    if (p === '/api/auth/refresh') return signedIn ? json({ accessToken: 'demo' }) : json({}, 401);
    if (p === '/api/auth/providers') return json({ providers: ['github', 'microsoft', 'google'] });
    if (p === '/api/auth/login' || p === '/api/auth/register') {
        signedIn = true;
        return json({ accessToken: 'demo', user: owner });
    }
    if (p === '/api/auth/logout') {
        signedIn = false;
        return json({}, 204);
    }
    if (!signedIn && !p.startsWith('/api/s/')) return json({ message: 'Not signed in.' }, 401);
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
        const wantedType = url.searchParams.get('type');
        if (wantedType) list = list.filter((f) => kindOf(f.name) === wantedType);
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
        if (one[2] === 'content' && /\.(csv|txt|pdf|docx|xlsx|pptx|doc|xls|ppt)$/.test(file.name))
            return fetchSample(file.name);
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
    if (p === '/api/shares' && method === 'GET') return json({ shares: shares.map(shareView) });
    if (p === '/api/shares' && method === 'POST') {
        const hours = body.expiresInHours as number | null;
        const s: MockShare = {
            id: `s${String(shares.length + 1)}`,
            token: `demo-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`,
            kind: body.fileId ? 'file' : 'category',
            targetId: (body.fileId ?? body.categoryId) as string | number,
            access: body.access as 'link' | 'users',
            expiresAt: hours ? new Date(Date.now() + hours * 3_600_000).toISOString() : null,
            revoked: false,
            userIds: (body.userIds as string[] | undefined) ?? [],
        };
        shares.unshift(s);
        return json({ share: shareView(s) }, 201);
    }
    const sh = /^\/api\/shares\/(s\d+)$/.exec(p);
    if (sh) {
        const s = shares.find((x) => x.id === sh[1]);
        if (!s) return json({ message: 'Share not found.' }, 404);
        if (method === 'DELETE') {
            shares = shares.filter((x) => x !== s);
            return json({}, 204);
        }
        if (body.access) s.access = body.access as 'link' | 'users';
        if (body.userIds) s.userIds = body.userIds as string[];
        if (typeof body.revoked === 'boolean') s.revoked = body.revoked;
        if ('expiresInHours' in body) {
            const h = body.expiresInHours as number | null;
            s.expiresAt = h ? new Date(Date.now() + h * 3_600_000).toISOString() : null;
        }
        return json({ share: shareView(s) });
    }
    if (p === '/api/shared-with-me') return json({ shares: [] });
    if (p === '/api/users/search') {
        const q = (url.searchParams.get('q') ?? '').toLowerCase();
        return json({
            users: people.filter(
                (u) => u.displayName.toLowerCase().includes(q) || u.username.includes(q),
            ),
        });
    }
    const pub = /^\/api\/s\/([^/]+)(?:\/files\/(f\d+)\/(content|thumbnail))?$/.exec(p);
    if (pub) {
        const s = shares.find((x) => x.token === pub[1]);
        if (!s || s.revoked)
            return json({ message: 'This link does not exist or has expired.' }, 404);
        const covered = view().filter((f) =>
            s.kind === 'file'
                ? f.id === s.targetId
                : f.categoryId !== null && inside(f.categoryId, s.targetId as number),
        );
        if (pub[2]) {
            const file = covered.find((f) => f.id === pub[2]);
            return file ? thumb(file) : json({ message: 'File not found.' }, 404);
        }
        return json({ share: shareView(s), files: covered });
    }
    if (p === '/api/duplicates') {
        const mode = url.searchParams.get('mode');
        const pick = mode === 'similar' ? ['f1', 'f4', 'f9'] : ['f2', 'f11'];
        const group = view().filter((f) => pick.includes(f.id));
        return json({ groups: dupesGone ? [] : [{ id: pick[0], keepId: pick[0], files: group }] });
    }
    if (p === '/api/duplicates/resolve' || p === '/api/duplicates/clean') {
        dupesGone = true;
        return json({ removed: 2 });
    }
    if (p === '/api/sorting/ratings' && method === 'POST') ratingsFixed = true;
    if (p === '/api/sorting/ratings')
        return json(
            method === 'POST'
                ? { toExplicit: 3, toSafe: 0 }
                : { toExplicit: ratingsFixed ? 0 : 3, toSafe: 0 },
        );
    if (p === '/api/sorting/resort') return json({ queued: 4 });
    if (p === '/api/me/avatar/from-file') return json(Object.assign(owner, { hasAvatar: true }));
    if (p === '/api/sorting/unsort-all') {
        const queued = files.filter((f) => f.categoryId !== null || f.status !== 'unsorted').length;
        files = files.map((f) => ({
            ...f,
            categoryId: null,
            status: 'unsorted',
            suggestedCategoryId: null,
        }));
        return json({ queued });
    }
    if (p === '/api/files/types') {
        const counts: Record<string, number> = { all: files.length };
        for (const k of [...Object.keys(KINDS), 'other'])
            counts[k] = files.filter((f) => kindOf(f.name) === k).length;
        return json({ counts });
    }
    if (p === '/api/files/unzip') {
        const zips = files.filter(
            (f) =>
                /\.zip$/i.test(f.name) &&
                (!(body.ids as string[] | undefined) || (body.ids as string[]).includes(f.id)),
        );
        const job = `unzip-${String(Date.now())}`;
        let step = 0;
        pushEvent?.('upload.progress', {
            job,
            name: `${String(zips.length)} archives`,
            seen: 0,
            total: zips.length,
        });
        const tick = setInterval(() => {
            step += 1;
            pushEvent?.('upload.progress', {
                job,
                name: `${String(zips.length)} archives`,
                seen: step,
                total: zips.length,
            });
            if (step >= zips.length) {
                clearInterval(tick);
                const made = zips.length * 3;
                files = files.filter((f) => !zips.includes(f));
                for (let i = 0; i < made; i++)
                    files.unshift({
                        ...(files[0] as FileItem),
                        id: `u${String(Date.now())}${String(i)}`,
                        name: `unpacked-${String(i + 1)}.jpg`,
                        categoryId: zips[0]?.categoryId ?? null,
                    });
                pushEvent?.('upload.done', {
                    job,
                    name: `${String(zips.length)} archives`,
                    extracted: made,
                    skipped: 0,
                });
            }
        }, 500);
        return json({ job, count: zips.length }, 202);
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

/** The prototype's event stream: whatever the mock wants to tell the page is pushed through here. */
let pushEvent: ((type: string, data: Record<string, unknown>) => void) | null = null;

function fakeZip(name: string): string {
    const job = `job-${String(Date.now())}`;
    const total = 24;
    let seen = 0;
    const tick = setInterval(() => {
        seen += 3;
        pushEvent?.('upload.progress', { job, name, seen: Math.min(seen, total), total });
        if (seen >= total) {
            clearInterval(tick);
            pushEvent?.('upload.done', { job, name, extracted: 22, skipped: 2 });
        }
    }, 450);
    return job;
}

/** Stands in for XMLHttpRequest on /api paths, because the upload progress bar needs one. */
class MockXhr {
    status = 0;
    responseText = '';
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    upload: {
        onprogress:
            ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null;
    } = {
        onprogress: null,
    };
    private path = '';
    open(_method: string, path: string): void {
        this.path = path;
    }
    setRequestHeader(): void {
        // no auth in the prototype
    }
    send(form: FormData): void {
        const file = form.get('file') as File;
        let step = 0;
        const tick = setInterval(() => {
            step += 1;
            this.upload.onprogress?.({ lengthComputable: true, loaded: step, total: 5 });
            if (step < 5) return;
            clearInterval(tick);
            if (/\.zip$/i.test(file.name)) {
                this.status = 202;
                this.responseText = JSON.stringify({ job: fakeZip(file.name) });
            } else {
                void Promise.resolve(answer('POST', new URL(this.path, location.href), {})).then(
                    async (created) => {
                        this.status = created.status;
                        this.responseText = await created.text();
                        this.onload?.();
                    },
                );
                return;
            }
            this.onload?.();
        }, 120);
    }
}

export function installMockApi(): void {
    const RealXhr = window.XMLHttpRequest;
    window.XMLHttpRequest = new Proxy(RealXhr, {
        construct: () => new MockXhr() as unknown as XMLHttpRequest,
    }) as typeof XMLHttpRequest;
    const real = window.fetch.bind(window);
    window.fetch = async (input, init) => {
        const url = new URL(
            typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
            location.href,
        );
        if (!url.pathname.startsWith('/api/')) return real(input, init);
        if (url.pathname === '/api/events') {
            const encoder = new TextEncoder();
            const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                    pushEvent = (type, data) =>
                        controller.enqueue(
                            encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`),
                        );
                },
            });
            return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
        }
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
