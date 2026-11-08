import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ApiError, describeFailure, newTraceId } from './api.ts';

describe('what a person is told when a request fails', () => {
    it('makes ids of 12 hex characters, a new one each time', () => {
        assert.match(newTraceId(), /^[0-9a-f]{12}$/);
        assert.notEqual(newTraceId(), newTraceId());
    });

    it("explains a refusal in the server's own words, without a reference", () => {
        assert.equal(
            describeFailure(409, 'That username is taken.', 'abc123def456'),
            'That username is taken.',
        );
        assert.equal(describeFailure(404, 'Category not found.', undefined), 'Category not found.');
    });

    it('says plainly that the server broke, and gives the reference to quote', () => {
        assert.equal(
            describeFailure(500, 'Internal Server Error', 'abc123def456'),
            'Something went wrong on our side. Please try again in a moment. Reference: abc123def456',
        );
        assert.ok(
            describeFailure(502, 'Request failed (502)', 'abc123def456').includes(
                'Reference: abc123def456',
            ),
        );
    });

    it('shows "your storage is full" as the refusal it is, without a reference', () => {
        assert.equal(
            describeFailure(507, 'Your storage is full: 25 GB of 25 GB used.', 'abc123def456'),
            'Your storage is full: 25 GB of 25 GB used.',
        );
    });

    it('believes a server that says something useful about its own failure', () => {
        assert.equal(
            describeFailure(503, 'The assistant is not running right now.', 'abc123def456'),
            'The assistant is not running right now. Reference: abc123def456',
        );
    });

    it('tells a person who is offline to check the connection, with the id the page made', () => {
        const error = new ApiError(0, 'Could not reach the server.', [], 'abc123def456');
        assert.equal(
            error.message,
            'Could not reach the server. Check your connection and try again. Reference: abc123def456',
        );
        assert.equal(error.traceId, 'abc123def456');
    });

    it('leaves out the reference when there is none', () => {
        assert.equal(
            describeFailure(500, 'Internal Server Error', undefined),
            'Something went wrong on our side. Please try again in a moment.',
        );
    });
});
