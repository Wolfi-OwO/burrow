/**
 * The speed of a transfer and the time it still needs, for the uploads panel.
 *
 * The speed is measured over the last few seconds (not since the start), so the estimate follows the connection:
 * it recovers after a stall and does not stay pessimistic because of a slow beginning. Between two progress reports
 * the remaining time keeps counting down by itself, which is what makes it look live; if nothing arrives for a while
 * the transfer is shown as stalled instead of counting down forever.
 */

/** How far back the speed looks. Long enough to smooth bursts, short enough to notice a change. */
const WINDOW_MS = 12_000;
/** No progress for this long means the transfer is waiting on something (a retry, a lost connection). */
export const STALL_MS = 8_000;

export interface Rate {
    /** Units done at `at` (bytes for an upload, entries for an unpacking zip). */
    sent: number;
    total: number;
    /** Units per second over the window; 0 until there is a second of data. */
    speed: number;
    at: number;
}

const samples = new Map<string, { t: number; sent: number }[]>();

/** Records one progress report of the transfer called `key` and returns its current rate. */
export function trackRate(key: string, sent: number, total: number, now = Date.now()): Rate {
    const list = samples.get(key) ?? [];
    list.push({ t: now, sent });
    while (list.length > 2 && now - (list[0]?.t ?? now) > WINDOW_MS) list.shift();
    samples.set(key, list);
    const first = list[0];
    const last = list[list.length - 1];
    const seconds = first && last ? (last.t - first.t) / 1000 : 0;
    const speed =
        first && last && seconds >= 1 ? Math.max(0, (last.sent - first.sent) / seconds) : 0;
    return { sent, total, speed, at: now };
}

/** Forgets a finished transfer. */
export function forgetRate(key: string): void {
    samples.delete(key);
}

export type Remaining =
    { kind: 'measuring' } | { kind: 'stalled' } | { kind: 'eta'; seconds: number; speed: number };

/** Where the transfer stands at `now`: still measuring, stalled, or this many seconds to go. */
export function remaining(rate: Rate | undefined, now = Date.now()): Remaining {
    if (!rate || rate.speed <= 0) return { kind: 'measuring' };
    const idle = now - rate.at;
    if (idle > STALL_MS && rate.sent < rate.total) return { kind: 'stalled' };
    const done = rate.sent + (rate.speed * Math.min(idle, STALL_MS)) / 1000;
    const left = Math.max(0, rate.total - done);
    return { kind: 'eta', seconds: left / rate.speed, speed: rate.speed };
}

/**
 * The time left across several transfers that share one connection: what is left in total divided by what the line
 * carries in total.
 */
export function remainingTogether(rates: (Rate | undefined)[], now = Date.now()): Remaining {
    let left = 0;
    let speed = 0;
    for (const rate of rates) {
        const each = remaining(rate, now);
        if (each.kind !== 'eta' || !rate) return each;
        left += each.seconds * each.speed;
        speed += each.speed;
    }
    return speed > 0 ? { kind: 'eta', seconds: left / speed, speed } : { kind: 'measuring' };
}
