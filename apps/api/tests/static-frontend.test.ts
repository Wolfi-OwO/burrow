import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const apiDir = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Boots src/server.ts in its own process (the frontend is mounted at import time) and resolves once it listens. */
function boot(port: number): Promise<{ stop: () => void }> {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['--experimental-strip-types', 'src/server.ts'], {
            cwd: apiDir,
            env: { ...process.env, PORT: String(port), LOG_LEVEL: 'info' },
        });
        const timer = setTimeout(() => reject(new Error('server did not start')), 15_000);
        child.stdout.on('data', (chunk: Buffer) => {
            if (chunk.toString().includes('listening')) {
                clearTimeout(timer);
                resolve({ stop: () => child.kill() });
            }
        });
        child.on('error', reject);
    });
}

describe('static frontend', () => {
    it('serves the shell for client routes and 404s a missing asset instead of answering with HTML', async () => {
        const publicDir = join(apiDir, 'public');
        rmSync(publicDir, { recursive: true, force: true });
        mkdirSync(join(publicDir, 'assets'), { recursive: true });
        writeFileSync(join(publicDir, 'index.html'), '<div id="root"></div>');
        writeFileSync(join(publicDir, 'assets', 'app.js'), 'console.log(1)');
        const port = 18_000 + Math.floor(Math.random() * 1000);
        const server = await boot(port);
        try {
            const get = (path: string): Promise<Response> =>
                fetch(`http://127.0.0.1:${String(port)}${path}`);
            assert.equal(
                (await get('/review')).headers.get('content-type')?.startsWith('text/html'),
                true,
            );
            assert.equal((await get('/oauth/callback')).status, 200);
            assert.equal((await get('/assets/app.js')).status, 200);
            assert.equal((await get('/assets/missing.js')).status, 404);
            assert.equal(
                (await get('/health')).headers.get('content-type')?.startsWith('application/json'),
                true,
            );
        } finally {
            server.stop();
            rmSync(publicDir, { recursive: true, force: true });
        }
    });
});
