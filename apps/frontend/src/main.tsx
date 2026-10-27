import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';

import { App } from './App.tsx';
import { ToastProvider } from './components/ui.tsx';
import { AuthProvider } from './lib/auth.tsx';
import { EventsProvider } from './lib/events.tsx';
import { UploadsProvider } from './lib/uploads.tsx';
import './styles.css';

const client = new QueryClient({
    defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false } },
});

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing');

createRoot(root).render(
    <StrictMode>
        <QueryClientProvider client={client}>
            <BrowserRouter>
                <ToastProvider>
                    <AuthProvider>
                        <EventsProvider>
                            <UploadsProvider>
                                <App />
                            </UploadsProvider>
                        </EventsProvider>
                    </AuthProvider>
                </ToastProvider>
            </BrowserRouter>
        </QueryClientProvider>
    </StrictMode>,
);
