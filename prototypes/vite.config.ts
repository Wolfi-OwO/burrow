import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Reuses the real screens from apps/frontend with a mocked API; relative base so the build opens from any folder.
export default defineConfig({
    root: import.meta.dirname,
    base: './',
    plugins: [react()],
    publicDir: '../apps/frontend/public',
    server: { port: 5188, fs: { allow: ['..'] } },
    build: { outDir: 'dist', emptyOutDir: true },
});
