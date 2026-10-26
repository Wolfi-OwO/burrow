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

export class ApiError extends Error {
    readonly status: number;
    readonly issues: { path: string; message: string }[];
    constructor(status: number, message: string, issues: { path: string; message: string }[] = []) {
        super(message);
        this.status = status;
        this.issues = issues;
    }
}

/** Trades the refresh cookie for a new access token. The X-Requested-With header is the CSRF check. */
export function refreshSession(): Promise<boolean> {
    refreshing ??= fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'X-Requested-With': 'burrow' },
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
    return fetch(path, { ...init, headers });
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
    try {
        const body = (await response.json()) as { message?: string; issues?: typeof issues };
        message = body.message ?? message;
        issues = body.issues ?? [];
    } catch {
        // not JSON
    }
    throw new ApiError(response.status, message, issues);
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
): Promise<T> {
    const attempt = (retry: boolean): Promise<T> =>
        new Promise<T>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', path);
            if (accessToken) xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable) onProgress(event.loaded / event.total);
            };
            xhr.onerror = () => reject(new Error('Could not reach the server.'));
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
                        ),
                    );
            };
            const form = new FormData();
            form.append('file', file, file.name);
            xhr.send(form);
        });
    return attempt(true);
}
