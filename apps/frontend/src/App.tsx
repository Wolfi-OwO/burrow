import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';

import { Shell } from './components/Shell.tsx';
import { Spinner } from './components/ui.tsx';
import { useAuth } from './lib/auth.tsx';
import { DrivePage } from './pages/DrivePage.tsx';
import { GatePage } from './pages/GatePage.tsx';
import { LegalPage } from './pages/LegalPage.tsx';
import { OAuthCallbackPage } from './pages/OAuthCallbackPage.tsx';
import { ProfilePage } from './pages/ProfilePage.tsx';
import { ReviewPage } from './pages/ReviewPage.tsx';
import { SearchPage } from './pages/SearchPage.tsx';

export function App(): ReactNode {
    return (
        <Routes>
            {/* Public: the Impressum has to be reachable without signing in, and must not wait for the session check. */}
            <Route path="/impressum" element={<LegalPage doc="impressum" />} />
            <Route path="/privacy" element={<LegalPage doc="privacy" />} />
            <Route path="/terms" element={<LegalPage doc="terms" />} />
            <Route path="*" element={<Session />} />
        </Routes>
    );
}

/** Everything that needs to know whether someone is signed in. */
function Session(): ReactNode {
    const { user } = useAuth();
    if (user === undefined) {
        return (
            <p className="muted" style={{ padding: 32 }}>
                <Spinner /> Opening the burrow
            </p>
        );
    }
    return (
        <Routes>
            <Route path="/oauth/callback" element={<OAuthCallbackPage />} />
            <Route path="/login" element={user ? <Navigate to="/" replace /> : <GatePage />} />
            {user ? (
                <Route element={<Shell />}>
                    <Route index element={<DrivePage />} />
                    <Route path="search" element={<SearchPage />} />
                    <Route path="review" element={<ReviewPage />} />
                    <Route path="profile" element={<ProfilePage />} />
                </Route>
            ) : null}
            <Route path="*" element={<Navigate to={user ? '/' : '/login'} replace />} />
        </Routes>
    );
}
