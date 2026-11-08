import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';

import { errorHandler } from '../../src/middlewares/error-handler.ts';
import { ValidationError } from '../../src/lib/errors.ts';
import { currentTraceId, newTraceId, traceIdFrom, withTrace } from '../../src/lib/trace.ts';
import { api, closeServer, registerOwner, resetDatabase } from '../helpers.ts';

after(closeServer);

const HEX12 = /^[0-9a-f]{12}$/;

describe('trace ids', () => {
    beforeEach(resetDatabase);

    it('gives every response an id, a new one each time', async () => {
        const a = await api('GET', '/livez');
        const b = await api('GET', '/livez');
        assert.match(a.headers.get('x-trace-id') ?? '', HEX12);
        assert.notEqual(a.headers.get('x-trace-id'), b.headers.get('x-trace-id'));
    });

    it('keeps a well-formed id the client sent, so the same id is on both sides', async () => {
        const sent = 'a1b2c3d4e5f6';
        const reply = await api('GET', '/livez', { headers: { 'x-trace-id': sent } });
        assert.equal(reply.headers.get('x-trace-id'), sent);
        const old = await api('GET', '/livez', {
            headers: { 'x-correlation-id': 'older-caller-1234' },
        });
        assert.equal(old.headers.get('x-trace-id'), 'older-caller-1234');
    });

    it('replaces an id that is too short, too long or not made of plain characters', async () => {
        for (const bad of [
            'short',
            'x'.repeat(65),
            'has space in it 123',
            'semi;colon;12345',
            '<script>alert(1)</script>',
        ]) {
            const reply = await api('GET', '/livez', { headers: { 'x-trace-id': bad } });
            assert.match(reply.headers.get('x-trace-id') ?? '', HEX12, bad);
        }
        assert.match(
            traceIdFrom({ 'x-trace-id': ['a', 'b'] }),
            HEX12,
            'a repeated header is not an id',
        );
    });

    it('puts the same id in the body of every kind of error, so the page can show it', async () => {
        const { token } = await registerOwner();
        const missing = await api('GET', '/api/files/00000000-0000-4000-8000-000000000000', {
            token,
            headers: { 'x-trace-id': 'trace-404-aaaa' },
        });
        assert.equal(missing.status, 404);
        assert.equal(missing.json.traceId, 'trace-404-aaaa');
        assert.equal(missing.headers.get('x-trace-id'), 'trace-404-aaaa');

        const unauthorised = await api('GET', '/api/files');
        assert.equal(unauthorised.status, 401);
        assert.equal(unauthorised.json.traceId, unauthorised.headers.get('x-trace-id'));

        const invalid = await api('POST', '/api/auth/login', { body: { username: 1 } });
        assert.equal(invalid.status, 400);
        assert.equal(invalid.json.traceId, invalid.headers.get('x-trace-id'));

        const tooBig = await api('POST', '/api/chat', {
            token,
            body: { message: 'x'.repeat(1501) },
        });
        assert.equal(tooBig.json.traceId, tooBig.headers.get('x-trace-id'));
    });

    it('is known to code that runs while the request is handled, and to nothing outside of one', () => {
        assert.equal(currentTraceId(), undefined);
        withTrace('inside-0000', () => assert.equal(currentTraceId(), 'inside-0000'));
        assert.equal(currentTraceId(), undefined);
        assert.match(newTraceId(), HEX12);
    });

    it('gives an unexpected failure the id of the request it happened in', () => {
        let status = 0;
        let body: Record<string, unknown> = {};
        const res = {
            status(code: number) {
                status = code;
                return this;
            },
            json(value: Record<string, unknown>) {
                body = value;
                return this;
            },
        };
        withTrace('boom-trace-1234', () => {
            errorHandler(
                new Error('database password is hunter2'),
                {} as never,
                res as never,
                (() => undefined) as never,
            );
        });
        assert.equal(status, 500);
        assert.equal(body.traceId, 'boom-trace-1234');
        withTrace('valid-trace-5678', () => {
            errorHandler(
                new ValidationError([{ path: 'a', message: 'b' }]),
                {} as never,
                res as never,
                (() => undefined) as never,
            );
        });
        assert.equal(body.traceId, 'valid-trace-5678');
    });
});
