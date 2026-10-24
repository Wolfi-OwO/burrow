import { FileText, ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import { formatBytes } from '../lib/format.ts';
import type { FileItem } from '../lib/types.ts';
import { DRAG_FILE } from './Tree.tsx';
import { ProtectedImage } from './ui.tsx';

/** One file as a raised card; draggable onto any category in the tree. */
export function FileCard({
    file,
    selected,
    onOpen,
}: {
    file: FileItem;
    selected: boolean;
    onOpen: () => void;
}): ReactNode {
    const isImage = file.mime.startsWith('image/');
    return (
        <button
            className={`card ${selected ? 'sel' : ''}`}
            onClick={onOpen}
            draggable
            onDragStart={(event) => event.dataTransfer.setData(DRAG_FILE, file.id)}
            aria-label={`${file.name}, ${formatBytes(file.size)}`}
        >
            <span className="thumb">
                {isImage ? (
                    <ProtectedImage path={`/api/files/${file.id}/thumbnail`} alt="" />
                ) : (
                    <FileText size={34} aria-hidden="true" />
                )}
            </span>
            <span className="fname" title={file.name}>
                {file.name}
            </span>
            <span className="meta">
                <span>{formatBytes(file.size)}</span>
                {file.status === 'review' ? (
                    <span className="chip warn">
                        <ShieldAlert size={12} />
                        review
                    </span>
                ) : null}
            </span>
        </button>
    );
}
