import { statfs } from 'node:fs/promises';

import { config } from '../config/index.ts';
import { getPool } from '../database/connection.ts';
import { QuotaExceededError } from '../lib/errors.ts';

const GIB = 1024 ** 3;
const gb = (bytes: number): string => `${(bytes / GIB).toFixed(bytes >= 10 * GIB ? 0 : 1)} GB`;

export interface StorageUsage {
    /** What the account's files add up to (every file counts, also a copy of one that is stored once). */
    used: number;
    /** The account's limit in bytes, or null for no limit. */
    quota: number | null;
}

export const storageService = {
    async usage(userId: string): Promise<StorageUsage> {
        const { rows } = await getPool().query(
            `SELECT coalesce((SELECT sum(size) FROM files WHERE user_id = $1), 0)::bigint AS used,
                    (SELECT quota_bytes FROM users WHERE id = $1) AS quota`,
            [userId],
        );
        const row = rows[0] as { used: string; quota: string | null } | undefined;
        const own = row?.quota === null || row?.quota === undefined ? null : Number(row.quota);
        // NULL = the server's default; 0, either way, = no limit.
        const limit = own ?? config.quota.userBytes;
        return { used: Number(row?.used ?? 0), quota: limit === 0 ? null : limit };
    },

    /** @returns How many more bytes the account may store, Infinity for an account without a limit. */
    async remaining(userId: string): Promise<number> {
        const { used, quota } = await storageService.usage(userId);
        return quota === null ? Infinity : Math.max(0, quota - used);
    },

    /** Free bytes on the disk the blobs live on, or Infinity when the system cannot say. */
    async diskFree(): Promise<number> {
        try {
            const stats = await statfs(config.storage.dir);
            return Number(stats.bavail) * Number(stats.bsize);
        } catch {
            return Infinity;
        }
    },

    /**
     * Refuses a write that would not fit: past the account's limit, or into a disk that would be left with less than
     * the reserve. Called before any byte is accepted, so nothing half-stored needs cleaning up.
     *
     * @param bytes - How much is about to be written.
     * @throws {QuotaExceededError} With a message fit for the person.
     */
    async assertRoom(userId: string, bytes: number): Promise<void> {
        const size = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
        const { used, quota } = await storageService.usage(userId);
        if (quota !== null && used + size > quota)
            throw new QuotaExceededError(
                `Your storage is full: ${gb(used)} of ${gb(quota)} used. Delete files you no longer need to make room.`,
            );
        if ((await storageService.diskFree()) - size < config.quota.diskReserveBytes)
            throw new QuotaExceededError(
                'The server is out of storage right now, so nothing can be added. Please try again later.',
            );
    },
};
