import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    ChevronDown,
    ChevronRight,
    CheckSquare,
    FolderInput,
    Inbox,
    Pencil,
    Plus,
    RotateCcw,
    Share2,
    Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { DragEvent, MouseEvent, ReactNode } from 'react';

import { api } from '../lib/api.ts';
import type { CategoryNode } from '../lib/types.ts';
import { ShareDialog } from './ShareDialog.tsx';
import { Dialog, PromptDialog, useToast } from './ui.tsx';
import { categoryOption } from '../lib/format.ts';

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
    | { kind: 'deleteMany' }
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

    // Select mode: tick several folders (shift-click takes a range of the visible rows) and delete them together.
    const [selecting, setSelecting] = useState(false);
    const [picked, setPicked] = useState<Set<number>>(new Set());
    const [anchor, setAnchor] = useState<number | null>(null);
    /** The folders that go when `ids` are deleted: each with everything below it. */
    const impact = (
        ids: Iterable<number>,
    ): { tops: CategoryNode[]; folders: number; files: number } => {
        const wanted = new Set(ids);
        const chosen = nodes.filter((n) => wanted.has(n.id));
        const tops = chosen.filter(
            (n) => !chosen.some((o) => o.id !== n.id && n.path.startsWith(`${o.path}.`)),
        );
        const going = nodes.filter((n) =>
            tops.some((t) => n.id === t.id || n.path.startsWith(`${t.path}.`)),
        );
        return {
            tops,
            folders: going.length,
            files: going.reduce((sum, n) => sum + n.fileCount, 0),
        };
    };
    const pick = (node: CategoryNode, event: { shiftKey: boolean }): void => {
        const next = new Set(picked);
        const from = anchor === null ? -1 : visible.findIndex((n) => n.id === anchor);
        const to = visible.findIndex((n) => n.id === node.id);
        if (event.shiftKey && from !== -1 && to !== -1) {
            const [lo, hi] = from < to ? [from, to] : [to, from];
            for (const n of visible.slice(lo, hi + 1)) next.add(n.id);
        } else {
            if (next.has(node.id)) next.delete(node.id);
            else next.add(node.id);
            setAnchor(node.id);
        }
        setPicked(next);
    };
    const stopSelecting = (): void => {
        setSelecting(false);
        setPicked(new Set());
        setAnchor(null);
    };
    /** True for a row whose folder is not ticked itself but goes with a ticked folder above it. */
    const impliedByPick = (node: CategoryNode): boolean =>
        !picked.has(node.id) &&
        nodes.some((o) => picked.has(o.id) && node.path.startsWith(`${o.path}.`));

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
    const removed = (r: { categories: number; files: number }): void => {
        toast.say(
            `Deleted ${String(r.categories)} categor${r.categories === 1 ? 'y' : 'ies'}. ${
                r.files > 0
                    ? `${String(r.files)} file${r.files === 1 ? '' : 's'} moved up, none deleted.`
                    : 'No files were in them.'
            }`,
        );
    };
    const remove = useMutation({
        mutationFn: (node: CategoryNode) =>
            api<{ categories: number; files: number }>(
                'DELETE',
                `/api/categories/${String(node.id)}?onNonEmpty=subtree`,
            ),
        onSuccess: (r, node) => {
            refresh();
            setModal(null);
            removed(r);
            if (selected === node.id) onSelect(null);
        },
        onError: fail,
    });
    const removeMany = useMutation({
        mutationFn: (ids: number[]) =>
            api<{ categories: number; files: number }>('POST', '/api/categories/delete', { ids }),
        onSuccess: (r, ids) => {
            refresh();
            setModal(null);
            stopSelecting();
            removed(r);
            if (typeof selected === 'number' && impact(ids).tops.length > 0) {
                const gone = new Set(impact(ids).tops.map((t) => t.path));
                const current = nodes.find((n) => n.id === selected);
                if (
                    current &&
                    [...gone].some((p) => current.path === p || current.path.startsWith(`${p}.`))
                )
                    onSelect(null);
            }
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
                {nodes.length > 0 ? (
                    <button
                        className={`btn sm ghost${selecting ? ' on' : ''}`}
                        aria-pressed={selecting}
                        onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
                    >
                        <CheckSquare size={15} /> {selecting ? 'Done' : 'Select'}
                    </button>
                ) : null}
            </div>
            {selecting ? (
                <div className="tree-bulk" role="toolbar" aria-label="Selected categories">
                    <span className="small">
                        {picked.size === 0
                            ? 'Tick folders; shift-click takes a range.'
                            : `${String(picked.size)} selected`}
                    </span>
                    <button
                        className="btn sm ghost"
                        onClick={() =>
                            setPicked(
                                picked.size === visible.length
                                    ? new Set()
                                    : new Set(visible.map((n) => n.id)),
                            )
                        }
                    >
                        {picked.size === visible.length ? 'None' : 'All'}
                    </button>
                    <button
                        className="btn sm danger"
                        disabled={picked.size === 0}
                        onClick={() => setModal({ kind: 'deleteMany' })}
                    >
                        <Trash2 size={14} /> Delete
                    </button>
                </div>
            ) : null}
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
                            className={`room ${selected === node.id ? 'active' : ''} ${over === node.id ? 'drop' : ''}${picked.has(node.id) ? ' picked' : ''}${impliedByPick(node) ? ' implied' : ''}`}
                            draggable={!selecting}
                            onDragStart={(event) =>
                                event.dataTransfer.setData(DRAG_CATEGORY, String(node.id))
                            }
                            {...dropProps(node.id)}
                            onClick={(event: MouseEvent) =>
                                selecting ? pick(node, event) : onSelect(node.id)
                            }
                            onMouseDown={(event) => {
                                // No text selection while shift-clicking a range.
                                if (selecting && event.shiftKey) event.preventDefault();
                            }}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    if (selecting) pick(node, event);
                                    else onSelect(node.id);
                                }
                            }}
                            aria-current={selected === node.id}
                        >
                            {selecting ? (
                                <input
                                    type="checkbox"
                                    className="pick-box"
                                    checked={picked.has(node.id) || impliedByPick(node)}
                                    disabled={impliedByPick(node)}
                                    aria-label={`Select ${node.name}`}
                                    title={`Select ${node.name}`}
                                    onChange={() => undefined}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        pick(node, event);
                                    }}
                                />
                            ) : null}
                            {hasChildren.has(node.id) ? (
                                <span
                                    role="button"
                                    tabIndex={-1}
                                    aria-label={collapsed.has(node.id) ? 'Expand' : 'Collapse'}
                                    title={collapsed.has(node.id) ? 'Expand' : 'Collapse'}
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
                            {selecting ? null : (
                                <span className="acts" onClick={(event) => event.stopPropagation()}>
                                    <button
                                        className="tool"
                                        aria-label={`Add a subcategory to ${node.name}`}
                                        title={`Add a subcategory to ${node.name}`}
                                        onClick={() => setModal({ kind: 'create', parent: node })}
                                    >
                                        <Plus size={14} />
                                    </button>
                                    <button
                                        className="tool"
                                        aria-label={`Rename ${node.name}`}
                                        title={`Rename ${node.name}`}
                                        onClick={() => setModal({ kind: 'rename', node })}
                                    >
                                        <Pencil size={14} />
                                    </button>
                                    <button
                                        className="tool"
                                        aria-label={`Move ${node.name}`}
                                        title={`Move ${node.name}`}
                                        onClick={() => setModal({ kind: 'move', node })}
                                    >
                                        <FolderInput size={14} />
                                    </button>
                                    <button
                                        className="tool"
                                        aria-label={`Re-sort ${node.name}`}
                                        title={`Re-sort ${node.name}`}
                                        onClick={() => setModal({ kind: 'resort', node })}
                                    >
                                        <RotateCcw size={14} />
                                    </button>
                                    <button
                                        className="tool"
                                        aria-label={`Share ${node.name}`}
                                        title={`Share ${node.name}`}
                                        onClick={() => setModal({ kind: 'share', node })}
                                    >
                                        <Share2 size={14} />
                                    </button>
                                    <button
                                        className="tool"
                                        aria-label={`Delete ${node.name}`}
                                        title={`Delete ${node.name}`}
                                        onClick={() => setModal({ kind: 'delete', node })}
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </span>
                            )}
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
                <DeleteDialog
                    title={`Delete "${modal.node.name}"?`}
                    impact={impact([modal.node.id])}
                    parentName={nodes.find((n) => n.id === modal.node.parentId)?.name ?? null}
                    busy={remove.isPending}
                    confirmLabel={
                        impact([modal.node.id]).folders > 1 ? 'Delete with subcategories' : 'Delete'
                    }
                    onCancel={() => setModal(null)}
                    onConfirm={() => remove.mutate(modal.node)}
                />
            ) : null}
            {modal?.kind === 'deleteMany' ? (
                <DeleteDialog
                    title={`Delete ${String(picked.size)} categor${picked.size === 1 ? 'y' : 'ies'}?`}
                    impact={impact(picked)}
                    parentName={null}
                    busy={removeMany.isPending}
                    confirmLabel="Delete them"
                    onCancel={() => setModal(null)}
                    onConfirm={() => removeMany.mutate([...picked])}
                />
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
    const label = (n: CategoryNode): string => categoryOption(n.depth, n.name);
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

/** What deleting would take with it, said before it happens: folders, and where the files go (none is deleted). */
function DeleteDialog({
    title,
    impact,
    parentName,
    busy,
    confirmLabel,
    onCancel,
    onConfirm,
}: {
    title: string;
    impact: { tops: CategoryNode[]; folders: number; files: number };
    parentName: string | null;
    busy: boolean;
    confirmLabel: string;
    onCancel: () => void;
    onConfirm: () => void;
}): ReactNode {
    const below = impact.folders - impact.tops.length;
    const single = impact.tops.length === 1 ? impact.tops[0] : undefined;
    const destination = single
        ? single.parentId === null
            ? 'Unsorted'
            : `"${parentName ?? 'the folder above'}"`
        : 'the folder above each one, or Unsorted';
    return (
        <Dialog title={title} onClose={onCancel}>
            <p>
                {impact.folders === 1
                    ? 'This folder will be deleted.'
                    : `${String(impact.folders)} folders will be deleted${
                          below > 0
                              ? `: the ${String(impact.tops.length)} you chose and the ${String(below)} subcategor${below === 1 ? 'y' : 'ies'} inside ${impact.tops.length === 1 ? 'it' : 'them'}.`
                              : '.'
                      }`}
            </p>
            <p className="muted">
                {impact.files > 0
                    ? `The ${String(impact.files)} file${impact.files === 1 ? '' : 's'} in ${impact.folders === 1 ? 'it' : 'them'} ${impact.files === 1 ? 'is' : 'are'} not deleted: ${impact.files === 1 ? 'it moves' : 'they move'} to ${destination}.`
                    : 'There are no files in it.'}
            </p>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button className="btn ghost" onClick={onCancel}>
                    Cancel
                </button>
                <button className="btn danger" disabled={busy} onClick={onConfirm}>
                    {confirmLabel}
                </button>
            </div>
        </Dialog>
    );
}
