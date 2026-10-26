import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    ChevronDown,
    ChevronRight,
    FolderInput,
    Inbox,
    Pencil,
    Plus,
    RotateCcw,
    Share2,
    Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { DragEvent, ReactNode } from 'react';

import { api } from '../lib/api.ts';
import type { CategoryNode } from '../lib/types.ts';
import { ShareDialog } from './ShareDialog.tsx';
import { Dialog, PromptDialog, useToast } from './ui.tsx';

export const DRAG_FILE = 'application/x-burrow-file';
export const DRAG_CATEGORY = 'application/x-burrow-category';

interface Props {
    selected: number | 'unsorted' | null;
    onSelect: (value: number | 'unsorted' | null) => void;
}

type Modal =
    | { kind: 'create'; parent: CategoryNode | null }
    | { kind: 'rename'; node: CategoryNode }
    | { kind: 'delete'; node: CategoryNode }
    | { kind: 'share'; node: CategoryNode }
    | { kind: 'resort'; node: CategoryNode }
    | { kind: 'move'; node: CategoryNode };

/** The category tree, rendered straight from the server's path order (FR-013): a parent always precedes its children. */
export function Tree({ selected, onSelect }: Props): ReactNode {
    const client = useQueryClient();
    const toast = useToast();
    const tree = useQuery({
        queryKey: ['tree'],
        queryFn: () => api<{ categories: CategoryNode[] }>('GET', '/api/categories'),
    });
    const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
    const [over, setOver] = useState<number | 'unsorted' | null>(null);
    const [modal, setModal] = useState<Modal | null>(null);

    const nodes = tree.data?.categories ?? [];
    const hasChildren = useMemo(
        () => new Set(nodes.filter((n) => n.parentId !== null).map((n) => n.parentId)),
        [nodes],
    );
    // Hide the subtree of any collapsed node without rebuilding structure: skip rows whose path starts with a collapsed one.
    const visible = nodes.filter(
        (n) =>
            ![...collapsed].some((id) => {
                const hidden = nodes.find((c) => c.id === id);
                return hidden !== undefined && n.path.startsWith(`${hidden.path}.`);
            }),
    );

    const refresh = (): void => {
        void client.invalidateQueries({ queryKey: ['tree'] });
        void client.invalidateQueries({ queryKey: ['files'] });
        void client.invalidateQueries({ queryKey: ['review'] });
    };
    const fail = (error: Error): void => toast.say(error.message);

    const create = useMutation({
        mutationFn: (v: { name: string; parentId: number | null }) =>
            api('POST', '/api/categories', v),
        onSuccess: refresh,
        onError: fail,
    });
    const rename = useMutation({
        mutationFn: (v: { id: number; name: string }) =>
            api('PATCH', `/api/categories/${String(v.id)}`, { name: v.name }),
        onSuccess: refresh,
        onError: fail,
    });
    const resort = useMutation({
        mutationFn: (n: CategoryNode) =>
            api<{ queued: number }>('POST', '/api/sorting/resort', { categoryId: n.id }),
        onSuccess: (r) => {
            refresh();
            toast.say(
                `${String(r.queued)} file${r.queued === 1 ? '' : 's'} sent back. Open Unsorted and press Sort all now.`,
            );
        },
        onError: (e: Error) => toast.say(e.message),
    });
    const move = useMutation({
        mutationFn: (v: { id: number; parentId: number | null }) =>
            api('POST', `/api/categories/${String(v.id)}/move`, { parentId: v.parentId }),
        onSuccess: refresh,
        onError: fail,
    });
    const remove = useMutation({
        mutationFn: (v: { id: number; onNonEmpty: 'block' | 'moveUp' }) =>
            api('DELETE', `/api/categories/${String(v.id)}?onNonEmpty=${v.onNonEmpty}`),
        onSuccess: () => {
            refresh();
            setModal(null);
        },
        onError: fail,
    });
    const refile = useMutation({
        mutationFn: (v: { fileId: string; categoryId: number | null }) =>
            api('PATCH', `/api/files/${v.fileId}`, { categoryId: v.categoryId }),
        onSuccess: () => {
            refresh();
            toast.say('Filed.');
        },
        onError: fail,
    });

    const drop = (event: DragEvent, target: number | 'unsorted'): void => {
        event.preventDefault();
        setOver(null);
        const fileId = event.dataTransfer.getData(DRAG_FILE);
        const categoryId = event.dataTransfer.getData(DRAG_CATEGORY);
        if (fileId) refile.mutate({ fileId, categoryId: target === 'unsorted' ? null : target });
        else if (categoryId && target !== 'unsorted')
            move.mutate({ id: Number(categoryId), parentId: target });
    };
    const dropProps = (target: number | 'unsorted') => ({
        onDragOver: (event: DragEvent) => {
            event.preventDefault();
            setOver(target);
        },
        onDragLeave: () => setOver((current) => (current === target ? null : current)),
        onDrop: (event: DragEvent) => drop(event, target),
    });

    return (
        <>
            <div className="tree-actions">
                <button
                    className="btn sm"
                    onClick={() => setModal({ kind: 'create', parent: null })}
                >
                    <Plus size={15} /> New category
                </button>
            </div>
            <nav className="tree" aria-label="Categories">
                <button
                    className={`room ${selected === null ? 'active' : ''}`}
                    onClick={() => onSelect(null)}
                    aria-current={selected === null}
                >
                    <span className="name">Everything</span>
                </button>
                <button
                    className={`room ${selected === 'unsorted' ? 'active' : ''} ${over === 'unsorted' ? 'drop' : ''}`}
                    onClick={() => onSelect('unsorted')}
                    {...dropProps('unsorted')}
                >
                    <Inbox size={16} />
                    <span className="name">Unsorted</span>
                </button>
                {tree.isLoading ? (
                    <p className="muted small" style={{ padding: 10 }}>
                        Loading the tree...
                    </p>
                ) : null}
                {visible.map((node) => (
                    <div
                        key={node.id}
                        style={{ marginLeft: node.depth * 14 }}
                        className={node.depth > 0 ? 'tunnel' : undefined}
                    >
                        <div
                            className={`room ${selected === node.id ? 'active' : ''} ${over === node.id ? 'drop' : ''}`}
                            draggable
                            onDragStart={(event) =>
                                event.dataTransfer.setData(DRAG_CATEGORY, String(node.id))
                            }
                            {...dropProps(node.id)}
                            onClick={() => onSelect(node.id)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    onSelect(node.id);
                                }
                            }}
                            aria-current={selected === node.id}
                        >
                            {hasChildren.has(node.id) ? (
                                <span
                                    role="button"
                                    tabIndex={-1}
                                    aria-label={collapsed.has(node.id) ? 'Expand' : 'Collapse'}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        setCollapsed((s) => {
                                            const next = new Set(s);
                                            if (!next.delete(node.id)) next.add(node.id);
                                            return next;
                                        });
                                    }}
                                >
                                    {collapsed.has(node.id) ? (
                                        <ChevronRight size={15} />
                                    ) : (
                                        <ChevronDown size={15} />
                                    )}
                                </span>
                            ) : (
                                <span style={{ width: 15 }} />
                            )}
                            <span className="name">{node.name}</span>
                            <span className="acts" onClick={(event) => event.stopPropagation()}>
                                <button
                                    className="tool"
                                    aria-label={`Add a subcategory to ${node.name}`}
                                    onClick={() => setModal({ kind: 'create', parent: node })}
                                >
                                    <Plus size={14} />
                                </button>
                                <button
                                    className="tool"
                                    aria-label={`Rename ${node.name}`}
                                    onClick={() => setModal({ kind: 'rename', node })}
                                >
                                    <Pencil size={14} />
                                </button>
                                <button
                                    className="tool"
                                    aria-label={`Move ${node.name}`}
                                    onClick={() => setModal({ kind: 'move', node })}
                                >
                                    <FolderInput size={14} />
                                </button>
                                <button
                                    className="tool"
                                    aria-label={`Re-sort ${node.name}`}
                                    onClick={() => setModal({ kind: 'resort', node })}
                                >
                                    <RotateCcw size={14} />
                                </button>
                                <button
                                    className="tool"
                                    aria-label={`Share ${node.name}`}
                                    onClick={() => setModal({ kind: 'share', node })}
                                >
                                    <Share2 size={14} />
                                </button>
                                <button
                                    className="tool"
                                    aria-label={`Delete ${node.name}`}
                                    onClick={() => setModal({ kind: 'delete', node })}
                                >
                                    <Trash2 size={14} />
                                </button>
                            </span>
                            <span className="n">{node.fileCount || ''}</span>
                        </div>
                    </div>
                ))}
            </nav>

            {modal?.kind === 'resort' ? (
                <Dialog title={`Re-sort "${modal.node.name}"?`} onClose={() => setModal(null)}>
                    <p>
                        Every file in this folder and below it goes back to Unsorted and the sorter
                        decides again with your current folders. Pictures that fit nowhere stay in
                        Unsorted.
                    </p>
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <button className="btn ghost" onClick={() => setModal(null)}>
                            Cancel
                        </button>
                        <button
                            className="btn"
                            onClick={() => {
                                resort.mutate(modal.node);
                                setModal(null);
                            }}
                        >
                            Send back to the sorter
                        </button>
                    </div>
                </Dialog>
            ) : null}
            {modal?.kind === 'share' ? (
                <ShareDialog
                    target={{ kind: 'category', id: modal.node.id, name: modal.node.name }}
                    onClose={() => setModal(null)}
                />
            ) : null}
            {modal?.kind === 'create' ? (
                <PromptDialog
                    title={modal.parent ? `New category in "${modal.parent.name}"` : 'New category'}
                    label="Name"
                    confirm="Create"
                    onClose={() => setModal(null)}
                    onSubmit={(name) => {
                        create.mutate({ name, parentId: modal.parent?.id ?? null });
                        setModal(null);
                    }}
                />
            ) : null}
            {modal?.kind === 'rename' ? (
                <PromptDialog
                    title="Rename category"
                    label="Name"
                    initial={modal.node.name}
                    confirm="Rename"
                    onClose={() => setModal(null)}
                    onSubmit={(name) => {
                        rename.mutate({ id: modal.node.id, name });
                        setModal(null);
                    }}
                />
            ) : null}
            {modal?.kind === 'move' ? (
                <MoveDialog
                    node={modal.node}
                    nodes={nodes}
                    onClose={() => setModal(null)}
                    onMove={(parentId) => {
                        move.mutate({ id: modal.node.id, parentId });
                        setModal(null);
                    }}
                />
            ) : null}
            {modal?.kind === 'delete' ? (
                <Dialog title={`Delete "${modal.node.name}"?`} onClose={() => setModal(null)}>
                    <p className="muted">
                        {modal.node.fileCount > 0 || hasChildren.has(modal.node.id)
                            ? 'It is not empty. Its subcategories and files can move up one level, or you can cancel and empty it yourself.'
                            : 'It is empty.'}
                    </p>
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <button className="btn ghost" onClick={() => setModal(null)}>
                            Cancel
                        </button>
                        <button
                            className="btn danger"
                            onClick={() =>
                                remove.mutate({ id: modal.node.id, onNonEmpty: 'moveUp' })
                            }
                        >
                            {modal.node.fileCount > 0 || hasChildren.has(modal.node.id)
                                ? 'Delete and move contents up'
                                : 'Delete'}
                        </button>
                    </div>
                </Dialog>
            ) : null}
        </>
    );
}

/** Picks the new parent for a move; the node's own subtree is not offered (the server refuses it too). */
function MoveDialog(props: {
    node: CategoryNode;
    nodes: CategoryNode[];
    onClose: () => void;
    onMove: (parentId: number | null) => void;
}): ReactNode {
    const [target, setTarget] = useState<string>('');
    const options = props.nodes.filter(
        (n) => n.path !== props.node.path && !n.path.startsWith(`${props.node.path}.`),
    );
    const label = (n: CategoryNode): string => `${'  '.repeat(n.depth)}${n.name}`;
    return (
        <Dialog title={`Move "${props.node.name}"`} onClose={props.onClose}>
            <div className="field">
                <label htmlFor="move-target">
                    New parent (its subcategories and files come along)
                </label>
                <select
                    id="move-target"
                    className="input"
                    value={target}
                    onChange={(event) => setTarget(event.target.value)}
                >
                    <option value="">Top level</option>
                    {options.map((n) => (
                        <option key={n.id} value={n.id}>
                            {label(n)}
                        </option>
                    ))}
                </select>
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button className="btn ghost" onClick={props.onClose}>
                    Cancel
                </button>
                <button
                    className="btn"
                    onClick={() => props.onMove(target === '' ? null : Number(target))}
                >
                    Move
                </button>
            </div>
        </Dialog>
    );
}
