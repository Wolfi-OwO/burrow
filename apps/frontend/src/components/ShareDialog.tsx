import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Link2, Trash2, UserRound, Users, X } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { api } from '../lib/api.ts';
import type { Share, ShareAccess, ShareUser } from '../lib/types.ts';
import { shareUrl } from '../lib/types.ts';
import { Dialog, useToast } from './ui.tsx';

export const EXPIRY_CHOICES: { label: string; hours: number | null }[] = [
    { label: 'Never expires', hours: null },
    { label: '1 hour', hours: 1 },
    { label: '1 day', hours: 24 },
    { label: '7 days', hours: 24 * 7 },
    { label: '30 days', hours: 24 * 30 },
];

/** "Never", "in 3 days" or "expired", for the list of links. */
export function expiryLabel(share: Share): string {
    if (share.revoked) return 'Revoked';
    if (share.expired) return 'Expired';
    if (!share.expiresAt) return 'Permanent';
    const hours = Math.round((new Date(share.expiresAt).getTime() - Date.now()) / 3_600_000);
    return hours < 48
        ? `Ends in ${String(Math.max(hours, 1))} h`
        : `Ends in ${String(Math.round(hours / 24))} days`;
}

export function CopyLink({ token }: { token: string }): ReactNode {
    const [done, setDone] = useState(false);
    const toast = useToast();
    return (
        <button
            type="button"
            className="btn ghost sm"
            onClick={() => {
                navigator.clipboard.writeText(shareUrl(token)).then(
                    () => {
                        setDone(true);
                        setTimeout(() => setDone(false), 1800);
                    },
                    () => toast.say(shareUrl(token)),
                );
            }}
        >
            {done ? <Check size={14} /> : <Copy size={14} />}
            {done ? 'Copied' : 'Copy link'}
        </button>
    );
}

/** Finds accounts by name as you type and keeps the chosen ones as removable chips. */
function PeoplePicker({
    chosen,
    onChange,
}: {
    chosen: ShareUser[];
    onChange: (users: ShareUser[]) => void;
}): ReactNode {
    const [q, setQ] = useState('');
    const found = useQuery({
        queryKey: ['user-search', q],
        enabled: q.trim().length >= 2,
        queryFn: () =>
            api<{ users: ShareUser[] }>(
                'GET',
                `/api/users/search?q=${encodeURIComponent(q.trim())}`,
            ),
    });
    const options = (found.data?.users ?? []).filter((u) => !chosen.some((c) => c.id === u.id));
    return (
        <div className="people">
            {chosen.length > 0 ? (
                <ul className="chips" aria-label="People with access">
                    {chosen.map((u) => (
                        <li key={u.id} className="chip">
                            <UserRound size={12} />
                            {u.displayName}
                            <button
                                type="button"
                                aria-label={`Remove ${u.displayName}`}
                                onClick={() => onChange(chosen.filter((c) => c.id !== u.id))}
                            >
                                <X size={12} />
                            </button>
                        </li>
                    ))}
                </ul>
            ) : null}
            <div className="field">
                <label htmlFor="people-q">Add people</label>
                <input
                    id="people-q"
                    className="input"
                    placeholder="Search by name or username"
                    value={q}
                    autoComplete="off"
                    onChange={(event) => setQ(event.target.value)}
                />
            </div>
            {q.trim().length >= 2 ? (
                <ul className="options" aria-label="Matching people">
                    {options.map((u) => (
                        <li key={u.id}>
                            <button
                                type="button"
                                onClick={() => {
                                    onChange([...chosen, u]);
                                    setQ('');
                                }}
                            >
                                <strong>{u.displayName}</strong>
                                <span className="muted small">@{u.username}</span>
                            </button>
                        </li>
                    ))}
                    {options.length === 0 && !found.isFetching ? (
                        <li className="muted small" style={{ padding: '8px 10px' }}>
                            Nobody found. They need an account on this burrow first.
                        </li>
                    ) : null}
                </ul>
            ) : null}
        </div>
    );
}

/** Access and expiry controls, shared by "new link" and "edit link". */
function ShareForm({
    initial,
    submitLabel,
    busy,
    onSubmit,
}: {
    initial?: Share;
    submitLabel: string;
    busy: boolean;
    onSubmit: (value: {
        access: ShareAccess;
        expiresInHours: number | null | undefined;
        users: ShareUser[];
    }) => void;
}): ReactNode {
    const [access, setAccess] = useState<ShareAccess>(initial?.access ?? 'link');
    const [hours, setHours] = useState<string>('never');
    const [users, setUsers] = useState<ShareUser[]>(initial?.users ?? []);
    return (
        <form
            className="share-form"
            onSubmit={(event) => {
                event.preventDefault();
                onSubmit({
                    access,
                    // When editing, leaving the expiry untouched keeps the current one.
                    expiresInHours:
                        hours === 'keep' ? undefined : hours === 'never' ? null : Number(hours),
                    users,
                });
            }}
        >
            <div className="segmented" role="radiogroup" aria-label="Who can open it">
                <button
                    type="button"
                    role="radio"
                    aria-checked={access === 'link'}
                    onClick={() => setAccess('link')}
                >
                    <Link2 size={15} />
                    Anyone with the link
                </button>
                <button
                    type="button"
                    role="radio"
                    aria-checked={access === 'users'}
                    onClick={() => setAccess('users')}
                >
                    <Users size={15} />
                    Specific people
                </button>
            </div>
            <p className="muted small">
                {access === 'link'
                    ? 'Anyone who has the link can look at it, no account needed.'
                    : 'Only the people you add can open it, and they have to sign in first.'}
            </p>
            {access === 'users' ? <PeoplePicker chosen={users} onChange={setUsers} /> : null}
            <div className="field">
                <label htmlFor="share-expiry">Link lifetime</label>
                <select
                    id="share-expiry"
                    className="input"
                    value={hours === 'never' && initial ? 'keep' : hours}
                    onChange={(event) => setHours(event.target.value)}
                >
                    {initial ? <option value="keep">{expiryLabel(initial)} (keep)</option> : null}
                    {EXPIRY_CHOICES.map((c) => (
                        <option key={c.label} value={c.hours === null ? 'never' : String(c.hours)}>
                            {c.label}
                        </option>
                    ))}
                </select>
            </div>
            <button
                className="btn"
                type="submit"
                disabled={busy || (access === 'users' && users.length === 0)}
            >
                {submitLabel}
            </button>
        </form>
    );
}

export function useShareMutations(): {
    refresh: () => void;
} {
    const client = useQueryClient();
    return {
        refresh: () => {
            void client.invalidateQueries({ queryKey: ['shares'] });
            void client.invalidateQueries({ queryKey: ['shared-with-me'] });
        },
    };
}

/** Change who can open an existing link, or when it ends. */
export function EditShareDialog({
    share,
    onClose,
}: {
    share: Share;
    onClose: () => void;
}): ReactNode {
    const toast = useToast();
    const { refresh } = useShareMutations();
    const save = useMutation({
        mutationFn: (v: {
            access: ShareAccess;
            expiresInHours: number | null | undefined;
            users: ShareUser[];
        }) =>
            api('PATCH', `/api/shares/${share.id}`, {
                access: v.access,
                userIds: v.users.map((u) => u.id),
                ...(v.expiresInHours === undefined ? {} : { expiresInHours: v.expiresInHours }),
            }),
        onSuccess: () => {
            refresh();
            toast.say('Link updated.');
            onClose();
        },
        onError: (e: Error) => toast.say(e.message),
    });
    return (
        <Dialog title={`Edit link to ${share.name}`} onClose={onClose}>
            <ShareForm
                initial={share}
                submitLabel="Save"
                busy={save.isPending}
                onSubmit={(v) => save.mutate(v)}
            />
        </Dialog>
    );
}

/** One row of a link: what it allows, how long it lives, copy, revoke and delete. */
export function ShareRow({ share, onEdit }: { share: Share; onEdit: () => void }): ReactNode {
    const toast = useToast();
    const { refresh } = useShareMutations();
    const revoke = useMutation({
        mutationFn: () => api('PATCH', `/api/shares/${share.id}`, { revoked: !share.revoked }),
        onSuccess: refresh,
        onError: (e: Error) => toast.say(e.message),
    });
    const remove = useMutation({
        mutationFn: () => api('DELETE', `/api/shares/${share.id}`),
        onSuccess: refresh,
        onError: (e: Error) => toast.say(e.message),
    });
    const dead = share.revoked || share.expired;
    return (
        <li className={`share-row ${dead ? 'dead' : ''}`}>
            <span className="share-icon" aria-hidden="true">
                {share.access === 'link' ? <Link2 size={16} /> : <Users size={16} />}
            </span>
            <span className="grow">
                <strong>
                    {share.access === 'link'
                        ? 'Anyone with the link'
                        : `${String(share.users.length)} ${share.users.length === 1 ? 'person' : 'people'}`}
                </strong>
                <span className="muted small">
                    {expiryLabel(share)}
                    {share.access === 'users' && share.users.length > 0
                        ? ` · ${share.users.map((u) => u.displayName).join(', ')}`
                        : ''}
                </span>
            </span>
            {dead ? null : <CopyLink token={share.token} />}
            <button type="button" className="btn ghost sm" onClick={onEdit}>
                Edit
            </button>
            <button type="button" className="btn ghost sm" onClick={() => revoke.mutate()}>
                {share.revoked ? 'Restore' : 'Revoke'}
            </button>
            <button
                type="button"
                className="tool"
                aria-label="Delete link"
                onClick={() => remove.mutate()}
            >
                <Trash2 size={15} />
            </button>
        </li>
    );
}

/** Create links to a file or a whole category, and manage the ones that already exist. */
export function ShareDialog({
    target,
    onClose,
}: {
    target:
        { kind: 'file'; id: string; name: string } | { kind: 'category'; id: number; name: string };
    onClose: () => void;
}): ReactNode {
    const toast = useToast();
    const { refresh } = useShareMutations();
    const [editing, setEditing] = useState<Share | null>(null);
    const [created, setCreated] = useState<Share | null>(null);
    const shares = useQuery({
        queryKey: ['shares'],
        queryFn: () => api<{ shares: Share[] }>('GET', '/api/shares'),
    });
    const mine = (shares.data?.shares ?? []).filter(
        (s) => s.kind === target.kind && s.targetId === target.id,
    );
    const create = useMutation({
        mutationFn: (v: {
            access: ShareAccess;
            expiresInHours: number | null | undefined;
            users: ShareUser[];
        }) =>
            api<{ share: Share }>('POST', '/api/shares', {
                ...(target.kind === 'file' ? { fileId: target.id } : { categoryId: target.id }),
                access: v.access,
                expiresInHours: v.expiresInHours ?? null,
                userIds: v.users.map((u) => u.id),
            }),
        onSuccess: (r) => {
            refresh();
            setCreated(r.share);
        },
        onError: (e: Error) => toast.say(e.message),
    });
    if (editing) return <EditShareDialog share={editing} onClose={() => setEditing(null)} />;
    return (
        <Dialog title={`Share ${target.name}`} onClose={onClose}>
            {created ? (
                <div className="share-done">
                    <p>
                        <Check size={16} aria-hidden="true" /> Link created
                    </p>
                    <input
                        className="input mono"
                        readOnly
                        value={shareUrl(created.token)}
                        onFocus={(e) => e.target.select()}
                        aria-label="Share link"
                    />
                    <div className="row">
                        <CopyLink token={created.token} />
                        <button
                            type="button"
                            className="btn ghost sm"
                            onClick={() => setCreated(null)}
                        >
                            Create another
                        </button>
                    </div>
                </div>
            ) : (
                <ShareForm
                    submitLabel="Create link"
                    busy={create.isPending}
                    onSubmit={(v) => create.mutate(v)}
                />
            )}
            {mine.length > 0 ? (
                <>
                    <h3 className="share-h">Existing links</h3>
                    <ul className="share-list">
                        {mine.map((s) => (
                            <ShareRow key={s.id} share={s} onEdit={() => setEditing(s)} />
                        ))}
                    </ul>
                </>
            ) : null}
        </Dialog>
    );
}
