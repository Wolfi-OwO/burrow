import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { api, ApiError, CHUNKED_FROM_BYTES, uploadChunked, uploadWithProgress } from './api.ts';
import { useServerEvents } from './events.tsx';
import type { FileItem } from './types.ts';

export interface UploadState {
    id: number;
    name: string;
    state: 'sending' | 'unpacking' | 'new' | 'duplicate' | 'failed';
    message?: string;
    /** 0 to 1: how much of the upload has left, then how much of a zip has been unpacked. */
    progress?: number;
    /** Set for a zip the server is unpacking; its events carry the same id. */
    job?: string;
}

interface UploadsApi {
    uploads: UploadState[];
    upload: (list: File[], folder?: number) => Promise<void>;
    clearFinished: () => void;
}
const UploadsContext = createContext<UploadsApi>({
    uploads: [],
    upload: () => Promise.resolve(),
    clearFinished: () => undefined,
});
export const useUploads = (): UploadsApi => useContext(UploadsContext);

/**
 * Uploads live here, above the pages, so they keep running while you click through the site: leaving the Drive page
 * does not stop a 7 GB zip. Closing or reloading the tab does (the browser owns the file), which is warned about.
 */
export function UploadsProvider({ children }: { children: ReactNode }): ReactNode {
    const client = useQueryClient();
    const [uploads, setUploads] = useState<UploadState[]>([]);
    /** One file (or one zip) with a patient retry when the server says "slow down". */
    const sendOne = async (
        file: File,
        folder: number | undefined,
        onProgress: (fraction: number) => void,
    ): Promise<{ file?: FileItem; duplicate: boolean; job?: string }> => {
        for (let attempt = 0; ; attempt++) {
            try {
                type Reply = { file?: FileItem; deduplicated?: boolean; job?: string };
                const result =
                    file.size >= CHUNKED_FROM_BYTES
                        ? await uploadChunked<Reply>(file, onProgress, folder)
                        : await uploadWithProgress<Reply>(
                              '/api/files',
                              file,
                              onProgress,
                              folder === undefined ? {} : { categoryId: String(folder) },
                          );
                return {
                    duplicate: result.deduplicated === true,
                    ...(result.file ? { file: result.file } : {}),
                    ...(result.job ? { job: result.job } : {}),
                };
            } catch (error) {
                if (error instanceof ApiError && error.status === 429 && attempt < 6) {
                    await new Promise((resolve) => setTimeout(resolve, 4000 * (attempt + 1)));
                    continue;
                }
                throw error;
            }
        }
    };
    // The server unpacks a zip in the background and reports as it goes.
    useServerEvents((event) => {
        const job = event.data.job;
        if (typeof job !== 'string') return;
        setUploads((u) =>
            u.map((x) => {
                if (x.job !== job) return x;
                if (event.type === 'upload.progress') {
                    const seen = Number(event.data.seen);
                    const total = Number(event.data.total);
                    return {
                        ...x,
                        state: 'unpacking',
                        progress: total > 0 ? seen / total : 0,
                        message:
                            total > 0 ? `${String(seen)} of ${String(total)} entries` : 'starting',
                    };
                }
                if (event.type === 'upload.done')
                    return {
                        ...x,
                        state: 'new',
                        progress: 1,
                        message: `${String(event.data.extracted)} files unpacked`,
                    };
                if (event.type === 'upload.failed')
                    return { ...x, state: 'failed', message: 'could not be unpacked' };
                return x;
            }),
        );
    });
    const upload = async (list: File[], folder?: number): Promise<void> => {
        const rows = list.map((file) => ({ id: Date.now() + Math.random(), file }));
        setUploads((u) => [
            ...rows
                .map((r): UploadState => ({ id: r.id, name: r.file.name, state: 'sending' }))
                .reverse(),
            ...u,
        ]);
        const mark = (id: number, patch: Partial<UploadState>): void =>
            setUploads((u) => u.map((x) => (x.id === id ? { ...x, ...patch } : x)));
        let next = 0;
        // Three at a time: a folder of photos moves quickly without opening hundreds of connections at once.
        const worker = async (): Promise<void> => {
            while (next < rows.length) {
                const row = rows[next++];
                if (!row) return;
                try {
                    const result = await sendOne(row.file, folder, (fraction) =>
                        mark(row.id, { progress: fraction }),
                    );
                    if (result.job) {
                        mark(row.id, {
                            state: 'unpacking',
                            job: result.job,
                            progress: 0,
                            message: 'starting',
                        });
                        continue;
                    }
                    // Filed into the category being viewed, so "upload here" does what it says.
                    if (folder !== undefined && result.file)
                        await api('PATCH', `/api/files/${result.file.id}`, {
                            categoryId: folder,
                        });
                    mark(row.id, { state: result.duplicate ? 'duplicate' : 'new', progress: 1 });
                } catch (error) {
                    const message =
                        error instanceof ApiError && error.status === 413
                            ? 'Too large'
                            : error instanceof Error
                              ? error.message
                              : 'Failed';
                    mark(row.id, { state: 'failed', message });
                }
            }
        };
        await Promise.all([worker(), worker(), worker()]);
        void client.invalidateQueries({ queryKey: ['files'] });
        void client.invalidateQueries({ queryKey: ['tree'] });
        void client.invalidateQueries({ queryKey: ['sorting'] });
    };

    const busy = uploads.some((u) => u.state === 'sending');
    useEffect(() => {
        if (!busy) return;
        const warn = (event: BeforeUnloadEvent): void => event.preventDefault();
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [busy]);
    const clearFinished = (): void =>
        setUploads((u) => u.filter((x) => x.state === 'sending' || x.state === 'unpacking'));
    const value = useMemo(() => ({ uploads, upload, clearFinished }), [uploads]);
    return <UploadsContext.Provider value={value}>{children}</UploadsContext.Provider>;
}
