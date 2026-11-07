import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatRemaining, formatSpeed } from './format.ts';
import { forgetRate, remaining, remainingTogether, STALL_MS, trackRate } from './transfer-rate.ts';

const MB = 1024 * 1024;

describe('the speed and time left of a transfer', () => {
    it('measures nothing until it has a second of data, then the speed over the recent seconds', () => {
        const key = 'a';
        assert.equal(trackRate(key, 0, 100 * MB, 0).speed, 0);
        assert.equal(trackRate(key, 1 * MB, 100 * MB, 500).speed, 0, 'half a second is not enough');
        const rate = trackRate(key, 4 * MB, 100 * MB, 2000);
        assert.equal(rate.speed, 2 * MB);
        forgetRate(key);
    });

    it('counts the time down between progress reports and stops counting when the transfer stalls', () => {
        const key = 'b';
        trackRate(key, 0, 100 * MB, 0);
        const rate = trackRate(key, 10 * MB, 100 * MB, 5000); // 2 MB/s, 90 MB to go
        assert.equal(rate.speed, 2 * MB);
        const atReport = remaining(rate, 5000);
        assert.equal(atReport.kind, 'eta');
        if (atReport.kind === 'eta') assert.equal(Math.round(atReport.seconds), 45);
        const later = remaining(rate, 8000); // three seconds later, nothing new: it must have moved on
        if (later.kind === 'eta') assert.equal(Math.round(later.seconds), 42);
        assert.equal(remaining(rate, 5000 + STALL_MS + 1).kind, 'stalled');
        forgetRate(key);
    });

    it('follows a change of speed: the window forgets a slow beginning', () => {
        const key = 'c';
        trackRate(key, 0, 1000 * MB, 0);
        trackRate(key, 1 * MB, 1000 * MB, 10_000); // crawling for ten seconds
        for (let second = 11; second <= 40; second++)
            trackRate(key, (1 + (second - 10) * 10) * MB, 1000 * MB, second * 1000);
        const fast = trackRate(key, (1 + 31 * 10) * MB, 1000 * MB, 41_000);
        assert.ok(
            fast.speed > 9.5 * MB && fast.speed < 10.5 * MB,
            `speed ${String(fast.speed / MB)} MB/s`,
        );
        forgetRate(key);
    });

    it('is only measuring before there is a speed, and never negative when a piece is retried', () => {
        assert.deepEqual(remaining(undefined), { kind: 'measuring' });
        const key = 'd';
        trackRate(key, 50 * MB, 100 * MB, 0);
        const back = trackRate(key, 30 * MB, 100 * MB, 3000); // a piece restarted, so the total went down
        assert.equal(back.speed, 0);
        assert.deepEqual(remaining(back, 3000), { kind: 'measuring' });
        forgetRate(key);
    });

    it('combines transfers that share one line', () => {
        const slow = { sent: 0, total: 60 * MB, speed: 1 * MB, at: 0 };
        const fast = { sent: 0, total: 60 * MB, speed: 2 * MB, at: 0 };
        const together = remainingTogether([slow, fast], 0);
        assert.equal(together.kind, 'eta');
        if (together.kind === 'eta') assert.equal(Math.round(together.seconds), 40); // 120 MB at 3 MB/s
        assert.deepEqual(remainingTogether([slow, undefined], 0), { kind: 'measuring' });
    });
});

describe('showing a duration and a speed', () => {
    it('words a duration at every scale', () => {
        assert.equal(formatRemaining(0), 'a few seconds');
        assert.equal(formatRemaining(4.4), 'a few seconds');
        assert.equal(formatRemaining(45), '45 s');
        assert.equal(formatRemaining(59.6), '1 min');
        assert.equal(formatRemaining(61), '2 min');
        assert.equal(formatRemaining(12 * 60), '12 min');
        assert.equal(formatRemaining(3600), '1 h 00 min');
        assert.equal(formatRemaining(3600 + 5 * 60), '1 h 05 min');
        assert.equal(formatRemaining(3599.6), '1 h 00 min');
        assert.equal(formatRemaining(26_000), '7 h 14 min');
    });

    it('shows a speed per second', () => {
        assert.equal(formatSpeed(2.4 * MB), '2.4 MB/s');
        assert.equal(formatSpeed(800 * 1024), '800 KB/s');
    });
});
