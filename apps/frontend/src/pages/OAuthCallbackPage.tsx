import type { ReactNode } from 'react';
import { Navigate } from 'react-router';

import { Spinner } from '../components/ui.tsx';
import { useAuth } from '../lib/auth.tsx';

/**
 * The provider redirect lands here with only the HttpOnly refresh cookie. AuthProvider already traded it for
 * an access token on load, so this page just waits for that and moves on; no token ever sits in the URL.
 */
export function OAuthCallbackPage(): ReactNode {
    const { user } = useAuth();
    if (user === undefined)
        return (
            <p className="muted" style={{ padding: 32 }}>
                <Spinner /> Signing you in
            </p>
        );
    return (
        <Navigate
            to={user ? '/' : '/login?error=Sign-in%20failed.%20Please%20try%20again.'}
            replace
        />
    );
}
