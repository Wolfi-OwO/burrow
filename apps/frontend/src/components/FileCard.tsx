import { Check, ShieldAlert } from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';

import { formatBytes } from '../lib/format.ts';
import type { FileItem } from '../lib/types.ts';
import { DRAG_FILE, DRAG_FILES } from './Tree.tsx';
import { TypeIcon } from './TypeIcon.tsx';
import { ProtectedImage } from './ui.tsx';

/**
 * One file as a raised card. It opens on a click, is ticked with its corner box (or ctrl/shift-click), and is
 * draggable onto any folder in the tree: dragging a ticked card takes every ticked file with it, dragging an unticked
 * one takes only itself.
 */
export function FileCard({
    file,
    selected,
    checked,
    onOpen,
    onPick,
    dragIds,
    accession,
    lead = false,
}: {
    file: FileItem;
    /** Open in the details panel. */
    selected: boolean;
    /** Ticked for a bulk action. */
    checked: boolean;
    onOpen: (event: MouseEvent) => void;
    onPick: (event: MouseEvent) => void;
    /** The ids to carry when this card is dragged. */
    dragIds: () => string[];
    /** Position in the current listing, shown as the specimen number. */
    accession: number;
    lead?: boolean;
}): ReactNode {
    const isImage = file.mime.startsWith('image/');
    return (
        <div className={`card-slot${lead ? ' lead' : ''}${checked ? ' picked' : ''}`}>
            <button
                className={`card ${selected ? 'sel' : ''} ${lead ? 'lead' : ''}`}
                onClick={onOpen}
                draggable
                onDragStart={(event) => {
                    const ids = dragIds();
                    event.dataTransfer.setData(DRAG_FILES, JSON.stringify(ids));
                    event.dataTransfer.setData(DRAG_FILE, file.id);
                    event.dataTransfer.effectAllowed = 'move';
                    // A small tag says what is being carried; the browser's own ghost of one big card says nothing.
                    const tag = document.createElement('div');
                    tag.className = 'drag-tag';
                    tag.textContent =
                        ids.length === 1 ? file.name : `${String(ids.length)} pictures`;
                    document.body.appendChild(tag);
                    event.dataTransfer.setDragImage(tag, 14, 14);
                    setTimeout(() => tag.remove(), 0);
                }}
                aria-label={`${file.name}, ${formatBytes(file.size)}`}
                title={`${file.name}, ${formatBytes(file.size)}`}
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
            <button
                type="button"
                className="card-pick"
                role="checkbox"
                aria-checked={checked}
                aria-label={`Select ${file.name}`}
                title="Select (shift-click for a range)"
                draggable={false}
                onClick={(event) => {
                    event.stopPropagation();
                    onPick(event);
                }}
            >
                {checked ? <Check size={14} strokeWidth={3} /> : null}
            </button>
        </div>
    );
}
