import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { api, refreshSession, request, setAccessToken, setSessionLostHandler } from './api.ts';
import type { Account } from './types.ts';

interface AuthState {
    /** undefined while the first session check runs, null when signed out. */
    user: Account | null | undefined;
    login: (username: string, password: string) => Promise<void>;
    register: (
        username: string,
        password: string,
        displayName: string,
        setupToken?: string,
    ) => Promise<void>;
    logout: () => Promise<void>;
    setUser: (user: Account) => void;
    reload: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
    const [user, setUser] = useState<Account | null | undefined>(undefined);
    const queryClient = useQueryClient();

    const reload = useCallback(async () => {
        try {
            setUser(await api<Account>('GET', '/api/me'));
        } catch {
            setUser(null);
        }
    }, []);

    // A reload (or the OAuth redirect) arrives with only the cookie: trade it for an access token first.
    useEffect(() => {
        setSessionLostHandler(() => {
            setUser(null);
            queryClient.clear();
        });
        void (async () => {
            if (await refreshSession()) await reload();
            else setUser(null);
        })();
    }, [queryClient, reload]);

    const enter = useCallback((body: { accessToken: string; user: Account }) => {
        setAccessToken(body.accessToken);
        setUser(body.user);
    }, []);

    const value = useMemo<AuthState>(
        () => ({
            user,
            reload,
            setUser,
            login: async (username, password) => {
                enter(await api('POST', '/api/auth/login', { username, password }));
            },
            register: async (username, password, displayName, setupToken) => {
                enter(
                    await api('POST', '/api/auth/register', {
                        username,
                        password,
                        displayName,
                        ...(setupToken ? { setupToken } : {}),
                    }),
                );
            },
            logout: async () => {
                try {
                    await fetchLogout();
                } finally {
                    setAccessToken(null);
                    setUser(null);
                    queryClient.clear();
                }
            },
        }),
        [user, enter, reload, queryClient],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

async function fetchLogout(): Promise<void> {
    await request('/api/auth/logout', {
        method: 'POST',
        headers: { 'X-Requested-With': 'burrow' },
    });
}

export function useAuth(): AuthState {
    const value = useContext(AuthContext);
    if (!value) throw new Error('useAuth outside AuthProvider');
    return value;
}
