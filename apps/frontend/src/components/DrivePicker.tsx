import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { api } from '../lib/api.ts';
import type { FileItem } from '../lib/types.ts';
import { Dialog, ProtectedImage, Spinner } from './ui.tsx';

/** A grid of the pictures already in the drive; clicking one chooses it. */
export function DrivePicker({
    onPick,
    onClose,
    busy = false,
}: {
    onPick: (fileId: string) => void;
    onClose: () => void;
    busy?: boolean;
}): ReactNode {
    const files = useQuery({
        queryKey: ['files', 'all'],
        queryFn: () => api<{ files: FileItem[] }>('GET', '/api/files?limit=200'),
    });
    const images = (files.data?.files ?? []).filter((f) => f.mime.startsWith('image/'));
    return (
        <Dialog title="Choose a picture from the drive" onClose={onClose}>
            {files.isLoading ? (
                <p className="muted">
                    <Spinner /> Loading pictures
                </p>
            ) : null}
            {files.data && images.length === 0 ? (
                <p className="muted">There are no pictures in the drive yet. Upload one first.</p>
            ) : null}
            <div className="picker-grid">
                {images.map((f) => (
                    <button
                        key={f.id}
                        type="button"
                        className="picker-item"
                        disabled={busy}
                        aria-label={`Use ${f.name}`}
                        title={f.name}
                        onClick={() => onPick(f.id)}
                    >
                        <ProtectedImage path={`/api/files/${f.id}/thumbnail`} alt="" />
                    </button>
                ))}
            </div>
        </Dialog>
    );
}
