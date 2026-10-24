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

/** @returns A short relative time such as "3 min ago". */
export function ago(iso: string | null): string {
    if (!iso) return 'never';
    const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${String(Math.round(seconds / 60))} min ago`;
    if (seconds < 86_400) return `${String(Math.round(seconds / 3600))} h ago`;
    return `${String(Math.round(seconds / 86_400))} d ago`;
}
