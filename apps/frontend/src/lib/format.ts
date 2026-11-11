const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** @returns A short human size, 1024-based. */
export function formatBytes(bytes: number): string {
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < UNITS.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return `${value >= 10 || unit === 0 ? String(Math.round(value)) : value.toFixed(1)} ${UNITS[unit] ?? 'B'}`;
}

/** @returns A transfer speed such as "2.4 MB/s". */
export function formatSpeed(bytesPerSecond: number): string {
    return `${formatBytes(bytesPerSecond)}/s`;
}

/** @returns How long something still takes, in words: "a few seconds", "45 s", "12 min", "1 h 05 min". */
export function formatRemaining(seconds: number): string {
    const s = Math.max(0, Math.round(seconds));
    if (s < 5) return 'a few seconds';
    if (s < 60) return `${String(s)} s`;
    if (s < 3600) return `${String(Math.ceil(s / 60))} min`;
    const hours = Math.floor(s / 3600);
    const minutes = Math.ceil((s % 3600) / 60);
    return minutes === 60
        ? `${String(hours + 1)} h 00 min`
        : `${String(hours)} h ${String(minutes).padStart(2, '0')} min`;
}

/** @returns A short relative time such as "3 min ago". */
export function ago(iso: string | null): string {
    if (!iso) return 'never';
    const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${String(Math.round(seconds / 60))} min ago`;
    if (seconds < 86_400) return `${String(Math.round(seconds / 3600))} h ago`;
    return `${String(Math.round(seconds / 86_400))} d ago`;
}
