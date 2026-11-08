/**
 * The access token lives in memory only: a page script can never read it from storage, and a reload gets a
 * fresh one from the HttpOnly refresh cookie. A 401 triggers exactly one silent refresh and one retry.
 */
let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
let onSessionLost: () => void = () => undefined;

export function setAccessToken(token: string | null): void {
    accessToken = token;
}

/** Called when the session cannot be renewed, so the UI can drop back to the login page. */
export function setSessionLostHandler(handler: () => void): void {
    onSessionLost = handler;
}

/** The header that carries a trace id; the server logs it, sends it back and puts it in every error. */
export const TRACE_HEADER = 'X-Trace-Id';

/** @returns A new trace id: 12 hex characters, made here so it exists even when the server is never reached. */
export function newTraceId(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * What a person is told. A refusal (wrong input, not allowed, not found) is explained by the server's own words.
 * A failure that is not their doing (the server broke, or could not be reached) gets a plain sentence and the trace
 * id, which is what they quote to find out what happened.
 */
export function describeFailure(
    status: number,
    message: string,
    traceId: string | undefined,
): string {
    const reference = traceId ? ` Reference: ${traceId}` : '';
    if (status === 0)
        return `Could not reach the server. Check your connection and try again.${reference}`;
    // 507 is "your storage is full": a refusal with its own explanation, not a fault.
    if (status < 500 || status === 507) return message;
    // A server that says something useful (the assistant is not running) is believed; its generic sentence is not.
    const generic = /^(Internal Server Error|Request failed)/.test(message);
    return `${generic ? 'Something went wrong on our side. Please try again in a moment.' : message}${reference}`;
}

export class ApiError extends Error {
    readonly status: number;
    readonly issues: { path: string; message: string }[];
    /** The id of the request that failed, for support. */
    readonly traceId: string | undefined;
    constructor(
        status: number,
        message: string,
        issues: { path: string; message: string }[] = [],
        traceId?: string,
    ) {
        super(describeFailure(status, message, traceId));
        this.status = status;
        this.issues = issues;
        this.traceId = traceId;
    }
}

/** Trades the refresh cookie for a new access token. The X-Requested-With header is the CSRF check. */
export function refreshSession(): Promise<boolean> {
    refreshing ??= fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'X-Requested-With': 'burrow', [TRACE_HEADER]: newTraceId() },
    })
        .then(async (response) => {
            if (!response.ok) return false;
            accessToken = ((await response.json()) as { accessToken: string }).accessToken;
            return true;
        })
        .catch(() => false)
        .finally(() => {
            refreshing = null;
        });
    return refreshing;
}

async function send(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
    const traceId = newTraceId();
    headers.set(TRACE_HEADER, traceId);
    try {
        return await fetch(path, { ...init, headers });
    } catch (error) {
        // The browser could not get an answer at all (offline, the server restarting, a proxy that dropped it).
        // A cancelled request is not a failure to report.
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        throw new ApiError(0, 'Could not reach the server.', [], traceId);
    }
}

/** Sends a request, refreshing the session once on 401. */
export async function request(path: string, init: RequestInit = {}): Promise<Response> {
    let response = await send(path, init);
    if (response.status === 401 && path !== '/api/auth/login' && (await refreshSession())) {
        response = await send(path, init);
    }
    if (response.status === 401 && accessToken !== null) {
        accessToken = null;
        onSessionLost();
    }
    return response;
}

async function fail(response: Response): Promise<never> {
    let message = `Request failed (${String(response.status)})`;
    let issues: { path: string; message: string }[] = [];
    let traceId = response.headers.get(TRACE_HEADER) ?? undefined;
    try {
        const body = (await response.json()) as {
            message?: string;
            issues?: typeof issues;
            traceId?: string;
        };
        message = body.message ?? message;
        issues = body.issues ?? [];
        traceId ??= body.traceId;
    } catch {
        // not JSON (a proxy's own error page): the id the page made is still in the server's log if it got that far
    }
    throw new ApiError(response.status, message, issues, traceId);
}

/** JSON in, JSON out; non-2xx becomes an ApiError carrying the server's own message. */
export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
    const init: RequestInit = { method };
    if (body !== undefined) {
        init.headers = { 'Content-Type': 'application/json' };
        init.body = JSON.stringify(body);
    }
    const response = await request(path, init);
    if (!response.ok) return fail(response);
    return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

/** Multipart upload of one file under the `file` field. */
export async function uploadForm<T>(
    method: string,
    path: string,
    file: File | Blob,
    name?: string,
): Promise<T> {
    const form = new FormData();
    form.append('file', file, name ?? (file instanceof File ? file.name : 'file'));
    const response = await request(path, { method, body: form });
    if (!response.ok) return fail(response);
    return (await response.json()) as T;
}

/** Fetches a protected binary (thumbnail, original) as a blob; an <img> tag cannot send the bearer header. */
export async function fetchBlob(path: string): Promise<Blob> {
    const response = await request(path);
    if (!response.ok) return fail(response);
    return response.blob();
}

/** The current access token, for the one caller (the event stream) that cannot go through `request`. */
export function currentAccessToken(): string | null {
    return accessToken;
}

/**
 * Multipart upload with progress: `fetch` cannot report how many bytes have left, XMLHttpRequest can. Refreshes the
 * session once on a 401 like the other calls.
 *
 * @param onProgress - Fraction (0 to 1) of the body that has been sent.
 */
export function uploadWithProgress<T>(
    path: string,
    file: File,
    onProgress: (fraction: number) => void,
    fields: Record<string, string> = {},
): Promise<T> {
    const attempt = (retry: boolean): Promise<T> =>
        new Promise<T>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', path);
            if (accessToken) xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
            const traceId = newTraceId();
            xhr.setRequestHeader(TRACE_HEADER, traceId);
            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable) onProgress(event.loaded / event.total);
            };
            xhr.onerror = () => reject(new ApiError(0, 'Could not reach the server.', [], traceId));
            xhr.onload = () => {
                if (xhr.status === 401 && retry) {
                    void refreshSession().then((ok) =>
                        ok ? resolve(attempt(false)) : reject(new ApiError(401, 'Session ended.')),
                    );
                    return;
                }
                let body: { message?: string; issues?: { path: string; message: string }[] } = {};
                try {
                    body = JSON.parse(xhr.responseText) as typeof body;
                } catch {
                    // not JSON
                }
                if (xhr.status >= 200 && xhr.status < 300) resolve(body as T);
                else
                    reject(
                        new ApiError(
                            xhr.status,
                            body.message ?? `Request failed (${String(xhr.status)})`,
                            body.issues ?? [],
                            xhr.getResponseHeader(TRACE_HEADER) ?? traceId,
                        ),
                    );
            };
            const form = new FormData();
            // Text fields go first so the server has them when the file arrives.
            for (const [key, value] of Object.entries(fields)) form.append(key, value);
            form.append('file', file, file.name);
            xhr.send(form);
        });
    return attempt(true);
}

/** One raw PUT with progress, refreshing the session once on a 401. */
function putWithProgress(
    path: string,
    body: Blob,
    onProgress: (loaded: number) => void,
    retry = true,
): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', path);
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        if (accessToken) xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
        const traceId = newTraceId();
        xhr.setRequestHeader(TRACE_HEADER, traceId);
        xhr.upload.onprogress = (event) => onProgress(event.loaded);
        xhr.onerror = () => reject(new ApiError(0, 'Could not reach the server.', [], traceId));
        xhr.onload = () => {
            if (xhr.status === 401 && retry) {
                void refreshSession().then((ok) =>
                    ok
                        ? resolve(putWithProgress(path, body, onProgress, false))
                        : reject(new ApiError(401, 'Session ended.')),
                );
            } else if (xhr.status >= 200 && xhr.status < 300) resolve();
            else
                reject(
                    new ApiError(
                        xhr.status,
                        `Upload piece failed (${String(xhr.status)})`,
                        [],
                        xhr.getResponseHeader(TRACE_HEADER) ?? traceId,
                    ),
                );
        };
        xhr.send(body);
    });
}

/**
 * Where upload pieces go. Browsers put every request to one origin on a single HTTP/2 or HTTP/3 connection, which on a
 * slow uplink carries only about half of what the line could (measured: 11 to 12 Mbit/s against 22 with HTTP/1.1,
 * which opens several connections). A server may therefore announce a second, HTTP/1.1-only origin for the pieces in
 * /api/version. It is used only when it answers a quick probe; otherwise, or when a piece cannot reach it, the pieces
 * go to the page's own origin as before.
 */
let uploadBase: Promise<string> | null = null;

function resolveUploadBase(): Promise<string> {
    uploadBase ??= (async () => {
        try {
            const info = (await (
                await fetch('/api/version', { headers: { [TRACE_HEADER]: newTraceId() } })
            ).json()) as { uploadOrigin?: string };
            const origin = info.uploadOrigin;
            if (!origin || origin === window.location.origin) return '';
            const probe = await fetch(`${origin}/livez`, {
                credentials: 'omit',
                signal: AbortSignal.timeout(4000),
            });
            return probe.ok ? origin : '';
        } catch {
            return '';
        }
    })();
    return uploadBase;
}

/** Files at least this large go up in pieces; smaller ones in one request. */
export const CHUNKED_FROM_BYTES = 48 * 1024 * 1024;
const PARALLEL_PIECES = 8;
const PIECE_TRIES = 4;

/**
 * Uploads a big file in pieces, several at a time, each retried on its own; a piece that cannot be sent after a few
 * tries ends the upload with an error, and the pieces that did arrive are kept on the server for a day. The progress
 * counts the bytes that have left, so the bar moves smoothly.
 *
 * @returns What a normal upload returns: the stored file, or a job id for a zip that is being unpacked.
 */
export async function uploadChunked<T>(
    file: File,
    onProgress: (fraction: number) => void,
    categoryId?: number,
): Promise<T> {
    // Asking again for the same file (same name, size and last-modified time) returns the unfinished session and the
    // pieces that already arrived, so an interrupted upload continues instead of starting from zero.
    const start = await api<{ id: string; chunkBytes: number; chunks: number; received: number[] }>(
        'POST',
        '/api/uploads',
        {
            name: file.name,
            size: file.size,
            fingerprint: `${String(file.size)}:${String(file.lastModified)}`,
            ...(file.type ? { mime: file.type } : {}),
            ...(categoryId === undefined ? {} : { categoryId }),
        },
    );
    const sent = new Array<number>(start.chunks).fill(0);
    const have = new Set(start.received);
    for (const index of have) {
        sent[index] = Math.min(start.chunkBytes, file.size - index * start.chunkBytes);
    }
    const report = (): void => onProgress(sent.reduce((a, b) => a + b, 0) / Math.max(file.size, 1));
    report();
    const queue = [...Array(start.chunks).keys()].filter((index) => !have.has(index));
    let base = await resolveUploadBase();

    const worker = async (): Promise<void> => {
        for (;;) {
            const index = queue.shift();
            if (index === undefined) return;
            const from = index * start.chunkBytes;
            const piece = file.slice(from, Math.min(from + start.chunkBytes, file.size));
            for (let attempt = 1; ; attempt++) {
                try {
                    await putWithProgress(
                        `${base}/api/uploads/${start.id}/chunks/${String(index)}`,
                        piece,
                        (loaded) => {
                            sent[index] = loaded;
                            report();
                        },
                    );
                    sent[index] = piece.size;
                    report();
                    break;
                } catch (error) {
                    sent[index] = 0;
                    // The fast origin could not be reached at all (a firewall, say): carry on through the page's own.
                    if (base !== '' && !(error instanceof ApiError)) {
                        base = '';
                        uploadBase = Promise.resolve('');
                        attempt = 0;
                        continue;
                    }
                    if (attempt >= PIECE_TRIES) throw error;
                    await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
                }
            }
        }
    };
    await Promise.all(Array.from({ length: PARALLEL_PIECES }, () => worker()));

    const response = await request(`/api/uploads/${start.id}/complete`, { method: 'POST' });
    if (!response.ok) return fail(response);
    return (await response.json()) as T;
}
