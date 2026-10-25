import { useQuery } from '@tanstack/react-query';
import type { FormEvent, ReactNode } from 'react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';

import { Mark } from '../components/Shell.tsx';
import { LegalLinks } from './LegalPage.tsx';
import { Spinner } from '../components/ui.tsx';
import { api, ApiError } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';

const LABELS: Record<string, string> = {
    github: 'GitHub',
    microsoft: 'Microsoft',
    google: 'Google',
};

/** Sign in, or create the owner account on a fresh install. */
export function GatePage(): ReactNode {
    const { login, register } = useAuth();
    const [params] = useSearchParams();
    const [mode, setMode] = useState<'login' | 'register'>('login');
    const [setupToken, setSetupToken] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(params.get('error'));
    const providers = useQuery({
        queryKey: ['providers'],
        queryFn: () =>
            api<{ providers: string[]; setupRequired: boolean }>('GET', '/api/auth/providers'),
    });

    const submit = async (event: FormEvent): Promise<void> => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
            if (mode === 'login') await login(username, password);
            else await register(username, password, username, setupToken);
        } catch (e) {
            setError(
                e instanceof ApiError
                    ? (e.issues[0]?.message ?? e.message)
                    : 'Could not reach the server.',
            );
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="gate">
            <div className="gate-card">
                <div>
                    <div className="mark">
                        <Mark size={64} />
                    </div>
                    <h1 style={{ marginTop: 14 }}>
                        {mode === 'login' ? 'Welcome back' : 'Dig the first room'}
                    </h1>
                    <p className="muted" style={{ marginTop: 6 }}>
                        {mode === 'login'
                            ? 'Your private drive, sorted while you were away.'
                            : 'Create the owner account for this burrow.'}
                    </p>
                </div>
                <form onSubmit={(event) => void submit(event)} style={{ display: 'grid', gap: 14 }}>
                    <div className="field">
                        <label htmlFor="u">Username</label>
                        <input
                            id="u"
                            className="input"
                            autoComplete="username"
                            required
                            minLength={3}
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                        />
                    </div>
                    <div className="field">
                        <label htmlFor="p">
                            Password{mode === 'register' ? ' (12 characters or more)' : ''}
                        </label>
                        <input
                            id="p"
                            className="input"
                            type="password"
                            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                            required
                            minLength={mode === 'register' ? 12 : 1}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        />
                    </div>
                    {mode === 'register' && providers.data?.setupRequired ? (
                        <div className="field">
                            <label htmlFor="t">
                                Setup token (from the server's .env: OWNER_SETUP_TOKEN)
                            </label>
                            <input
                                id="t"
                                className="input"
                                type="password"
                                autoComplete="off"
                                required
                                value={setupToken}
                                onChange={(e) => setSetupToken(e.target.value)}
                            />
                        </div>
                    ) : null}
                    {error ? (
                        <p className="error" role="alert">
                            {error}
                        </p>
                    ) : null}
                    <button
                        className="btn"
                        type="submit"
                        disabled={busy}
                        style={{ justifyContent: 'center' }}
                    >
                        {busy ? <Spinner /> : null}
                        {mode === 'login' ? 'Sign in' : 'Create account'}
                    </button>
                </form>
                {providers.data &&
                providers.data.providers.length > 0 &&
                !providers.data.setupRequired ? (
                    <>
                        <div className="divider">or</div>
                        <div className="oauth-row">
                            {providers.data.providers.map((p) => (
                                <a
                                    key={p}
                                    className="btn ghost"
                                    style={{ justifyContent: 'center' }}
                                    href={`/api/auth/${p}`}
                                >
                                    Continue with {LABELS[p] ?? p}
                                </a>
                            ))}
                        </div>
                    </>
                ) : null}
                <button
                    className="btn ghost sm"
                    style={{ justifySelf: 'center' }}
                    onClick={() => {
                        setMode(mode === 'login' ? 'register' : 'login');
                        setError(null);
                    }}
                >
                    {mode === 'login'
                        ? 'First time here? Create the owner account'
                        : 'I already have an account'}
                </button>
                <LegalLinks />
            </div>
        </div>
    );
}
