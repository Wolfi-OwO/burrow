import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Link2, Unlink } from 'lucide-react';
import { useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useSearchParams } from 'react-router';

import { ProtectedImage, useToast } from '../components/ui.tsx';
import { api, uploadForm } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { forgetImage } from '../lib/blob.ts';
import type { Account, Identity } from '../lib/types.ts';

const PROVIDERS: { id: Identity['provider']; label: string }[] = [
    { id: 'github', label: 'GitHub' },
    { id: 'microsoft', label: 'Microsoft' },
    { id: 'google', label: 'Google' },
];

export function ProfilePage(): ReactNode {
    const { user, setUser, logout } = useAuth();
    const toast = useToast();
    const client = useQueryClient();
    const [params] = useSearchParams();
    const file = useRef<HTMLInputElement>(null);
    const [displayName, setDisplayName] = useState(user?.displayName ?? '');
    const [bio, setBio] = useState(user?.bio ?? '');
    const [current, setCurrent] = useState('');
    const [next, setNext] = useState('');
    const identities = useQuery({
        queryKey: ['identities'],
        queryFn: () => api<{ identities: Identity[] }>('GET', '/api/me/identities'),
    });
    const configured = useQuery({
        queryKey: ['providers'],
        queryFn: () => api<{ providers: string[] }>('GET', '/api/auth/providers'),
    });
    const fail = (e: Error): void => toast.say(e.message);

    const save = useMutation({
        mutationFn: () => api<Account>('PATCH', '/api/me', { displayName, bio }),
        onSuccess: (u) => {
            setUser(u);
            toast.say('Saved.');
        },
        onError: fail,
    });
    const avatar = useMutation({
        mutationFn: (image: File) => uploadForm<Account>('PUT', '/api/me/avatar', image),
        onSuccess: (u) => {
            forgetImage(`/api/users/${u.id}/avatar`);
            setUser({ ...u });
            toast.say('Avatar updated.');
        },
        onError: fail,
    });
    const password = useMutation({
        mutationFn: () =>
            api('POST', '/api/auth/password', {
                ...(user?.hasPassword ? { currentPassword: current } : {}),
                newPassword: next,
            }),
        onSuccess: () => {
            toast.say('Password changed. Please sign in again.');
            void logout();
        },
        onError: fail,
    });
    const link = useMutation({
        mutationFn: (p: string) => api<{ url: string }>('POST', `/api/me/identities/${p}/link`),
        onSuccess: (r) => {
            window.location.assign(r.url);
        },
        onError: fail,
    });
    const unlink = useMutation({
        mutationFn: (p: string) => api('DELETE', `/api/me/identities/${p}`),
        onSuccess: () => {
            void client.invalidateQueries({ queryKey: ['identities'] });
            toast.say('Unlinked.');
        },
        onError: fail,
    });

    const submit = (event: FormEvent): void => {
        event.preventDefault();
        save.mutate();
    };
    const linked = new Set(identities.data?.identities.map((i) => i.provider));
    const offered = PROVIDERS.filter((p) => configured.data?.providers.includes(p.id));

    return (
        <>
            <header className="page-head">
                <div>
                    <h1>Profile</h1>
                    <p>How you appear, and how you sign in.</p>
                </div>
            </header>
            {params.get('linked') ? (
                <p className="chip live" role="status" style={{ marginBottom: 16 }}>
                    {params.get('linked')} linked.
                </p>
            ) : null}
            <div style={{ display: 'grid', gap: 20, maxWidth: 720 }}>
                <section className="panel" aria-labelledby="who">
                    <h2 id="who">About you</h2>
                    <div className="row">
                        <span className="avatar lg">
                            {user?.hasAvatar ? (
                                <ProtectedImage
                                    path={`/api/users/${user.id}/avatar`}
                                    alt="Your avatar"
                                />
                            ) : (
                                (user?.displayName[0] ?? '?').toUpperCase()
                            )}
                        </span>
                        <input
                            ref={file}
                            type="file"
                            accept="image/*"
                            hidden
                            onChange={(event) => {
                                const f = event.target.files?.[0];
                                if (f) avatar.mutate(f);
                                event.target.value = '';
                            }}
                        />
                        <button
                            className="btn ghost"
                            onClick={() => file.current?.click()}
                            disabled={avatar.isPending}
                        >
                            <Camera size={16} />
                            Change avatar
                        </button>
                    </div>
                    <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
                        <div className="field">
                            <label htmlFor="dn">Display name</label>
                            <input
                                id="dn"
                                className="input"
                                value={displayName}
                                maxLength={60}
                                onChange={(e) => setDisplayName(e.target.value)}
                            />
                        </div>
                        <div className="field">
                            <label htmlFor="bio">Bio</label>
                            <textarea
                                id="bio"
                                className="input"
                                value={bio}
                                maxLength={500}
                                onChange={(e) => setBio(e.target.value)}
                            />
                        </div>
                        <div>
                            <button className="btn" type="submit" disabled={save.isPending}>
                                Save
                            </button>
                        </div>
                    </form>
                </section>

                <section className="panel" aria-labelledby="signin">
                    <h2 id="signin">Sign-in methods</h2>
                    <p className="muted small">
                        Signed in as <b>@{user?.username}</b>. A provider can only be linked when it
                        has confirmed your email address.
                    </p>
                    {offered.length === 0 ? (
                        <p className="muted">No providers are configured on this server.</p>
                    ) : null}
                    {offered.map((p) => (
                        <div className="row" key={p.id} style={{ justifyContent: 'space-between' }}>
                            <span>
                                <b>{p.label}</b>{' '}
                                {linked.has(p.id) ? (
                                    <span className="chip live">
                                        linked
                                        {identities.data?.identities.find(
                                            (i) => i.provider === p.id,
                                        )?.email
                                            ? `: ${identities.data.identities.find((i) => i.provider === p.id)?.email ?? ''}`
                                            : ''}
                                    </span>
                                ) : (
                                    <span className="chip">not linked</span>
                                )}
                            </span>
                            {linked.has(p.id) ? (
                                <button
                                    className="btn sm ghost"
                                    onClick={() => unlink.mutate(p.id)}
                                >
                                    <Unlink size={14} />
                                    Unlink
                                </button>
                            ) : (
                                <button className="btn sm" onClick={() => link.mutate(p.id)}>
                                    <Link2 size={14} />
                                    Link
                                </button>
                            )}
                        </div>
                    ))}
                </section>

                <section className="panel" aria-labelledby="pw">
                    <h2 id="pw">{user?.hasPassword ? 'Change password' : 'Set a password'}</h2>
                    <form
                        onSubmit={(event) => {
                            event.preventDefault();
                            password.mutate();
                        }}
                        style={{ display: 'grid', gap: 14 }}
                    >
                        {user?.hasPassword ? (
                            <div className="field">
                                <label htmlFor="cur">Current password</label>
                                <input
                                    id="cur"
                                    className="input"
                                    type="password"
                                    autoComplete="current-password"
                                    value={current}
                                    onChange={(e) => setCurrent(e.target.value)}
                                />
                            </div>
                        ) : null}
                        <div className="field">
                            <label htmlFor="new">New password (12 characters or more)</label>
                            <input
                                id="new"
                                className="input"
                                type="password"
                                autoComplete="new-password"
                                minLength={12}
                                value={next}
                                onChange={(e) => setNext(e.target.value)}
                            />
                        </div>
                        <div>
                            <button
                                className="btn"
                                type="submit"
                                disabled={next.length < 12 || password.isPending}
                            >
                                Change password
                            </button>{' '}
                            <span className="muted small">This signs you out everywhere.</span>
                        </div>
                    </form>
                </section>
            </div>
        </>
    );
}
