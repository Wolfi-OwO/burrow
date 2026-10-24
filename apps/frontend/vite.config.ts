import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The API and the SPA share one origin in production; in development the proxy keeps that true, so the
// SameSite=Strict refresh cookie and CORS behave exactly as they will for real.
export default defineConfig({
    plugins: [react()],
    server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:8080' } },
    build: { sourcemap: false },
});
