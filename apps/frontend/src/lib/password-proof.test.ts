import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { derivePasswordProof } from './password-proof.ts';

describe('derivePasswordProof', () => {
    it('is a prefixed, fixed-length, URL-safe string that never contains the password', async () => {
        const proof = await derivePasswordProof('wolf', 'correct horse battery');
        assert.match(proof, /^pw1\$[A-Za-z0-9_-]{43}$/);
        assert.ok(!proof.includes('correct'));
    });

    it('gives the same proof for the same account and password, whatever the username casing or spacing', async () => {
        const a = await derivePasswordProof('Wolf', 'correct horse battery');
        const b = await derivePasswordProof('  wolf ', 'correct horse battery');
        assert.equal(a, b);
    });

    it('differs between accounts and between passwords', async () => {
        const base = await derivePasswordProof('wolf', 'correct horse battery');
        assert.notEqual(base, await derivePasswordProof('fox', 'correct horse battery'));
        assert.notEqual(base, await derivePasswordProof('wolf', 'correct horse batterz'));
    });

    it('treats a password typed with composed or decomposed characters alike', async () => {
        const composed = await derivePasswordProof('wolf', 'café café café');
        const decomposed = await derivePasswordProof('wolf', 'café café café');
        assert.equal(composed, decomposed);
    });
});
