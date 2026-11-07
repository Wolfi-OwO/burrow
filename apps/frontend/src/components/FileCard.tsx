import { ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import { formatBytes } from '../lib/format.ts';
import type { FileItem } from '../lib/types.ts';
import { DRAG_FILE } from './Tree.tsx';
import { TypeIcon } from './TypeIcon.tsx';
import { ProtectedImage } from './ui.tsx';

/** One file as a raised card; draggable onto any category in the tree. */
export function FileCard({
    file,
    selected,
    onOpen,
    accession,
    lead = false,
}: {
    file: FileItem;
    selected: boolean;
    onOpen: () => void;
    /** Position in the current listing, shown as the specimen number. */
    accession: number;
    lead?: boolean;
}): ReactNode {
    const isImage = file.mime.startsWith('image/');
    return (
        <button
            className={`card ${selected ? 'sel' : ''} ${lead ? 'lead' : ''}`}
            onClick={onOpen}
            draggable
            onDragStart={(event) => event.dataTransfer.setData(DRAG_FILE, file.id)}
            aria-label={`${file.name}, ${formatBytes(file.size)}`}
        >
            <span className="acc" aria-hidden="true">
                №{String(accession).padStart(4, '0')}
            </span>
            <span className="thumb">
                {isImage ? (
                    <ProtectedImage path={`/api/files/${file.id}/thumbnail`} alt="" />
                ) : (
                    <TypeIcon name={file.name} mime={file.mime} />
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
