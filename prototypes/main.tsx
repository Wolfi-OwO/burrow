import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router';

import { App } from '../apps/frontend/src/App.tsx';
import { ToastProvider } from '../apps/frontend/src/components/ui.tsx';
import { EventsProvider } from '../apps/frontend/src/lib/events.tsx';
import { AuthProvider } from '../apps/frontend/src/lib/auth.tsx';
import '../apps/frontend/src/styles.css';
import { installMockApi } from './mock-api.ts';

installMockApi();

const client = new QueryClient({
    defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false } },
});

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing');

createRoot(root).render(
    <StrictMode>
        <QueryClientProvider client={client}>
            <HashRouter>
                <ToastProvider>
                    <AuthProvider>
                        <EventsProvider>
                            <App />
                        </EventsProvider>
                    </AuthProvider>
                </ToastProvider>
            </HashRouter>
        </QueryClientProvider>
    </StrictMode>,
);
