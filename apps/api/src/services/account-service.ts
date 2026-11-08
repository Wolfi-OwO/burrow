import type { Writable } from 'node:stream';

import archiver from 'archiver';
import argon2 from 'argon2';

import type { DatabaseRow } from '../database/connection.ts';
import { getPool } from '../database/connection.ts';
import { blobStore } from '../lib/blob-store.ts';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../lib/errors.ts';
import { fileRepository } from '../repository/file.repository.ts';
import { userRepository } from '../repository/user.repository.ts';

/** One export per account at a time: it reads every stored byte, so parallel runs would only hurt the drive. */
const exporting = new Set<string>();

/** Drops characters that are not allowed in a zip path component and keeps the name readable. */
function safeName(name: string): string {
    const cleaned = [...name]
        .map((ch) => (ch.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(ch) ? '_' : ch))
        .join('')
        .replace(/_+/g, '_')
        .trim();
    return cleaned === '' || cleaned === '.' || cleaned === '..' ? '_' : cleaned.slice(0, 200);
}

export const accountService = {
    /**
     * Writes everything the account holds as a zip (Art 15 and 20 DSGVO): `account.json`, `categories.json`,
     * `assistant.json` (the chat and what it taught the sorter), `files.json` with every stored field, and the file bytes under `files/<category>/<name>`.
     * The zip is streamed, so a large drive never has to fit in memory.
     *
     * @param userId - The account to export.
     * @param out - Where the zip goes (the HTTP response).
     */
    async exportTo(userId: string, out: Writable): Promise<void> {
        const user = await userRepository.findById(userId);
        if (!user) throw new NotFoundError();
        if (exporting.has(userId)) {
            throw new ConflictError('An export of this account is already running.');
        }
        exporting.add(userId);
        try {
            const pool = getPool();
            const [identities, categories, files] = await Promise.all([
                pool.query(
                    'SELECT provider, email, email_verified, created_at FROM user_identities WHERE user_id = $1 ORDER BY id',
                    [userId],
                ),
                pool.query(
                    'SELECT id, parent_id, name, public_preview, created_at FROM categories WHERE user_id = $1 ORDER BY id',
                    [userId],
                ),
                pool.query(
                    `SELECT id, name, mime, size, blob_sha256, category_id, suggested_category_id, status, confidence,
                            nsfw_score, classified_at, latitude, longitude, place, place_score, taken_at, created_at
                       FROM files WHERE user_id = $1 ORDER BY created_at, id`,
                    [userId],
                ),
            ]);

            const byId = new Map<number, DatabaseRow>(
                categories.rows.map((c: DatabaseRow) => [Number(c.id), c]),
            );
            const pathOf = (categoryId: number | null): string => {
                const parts: string[] = [];
                let cursor = categoryId === null ? undefined : byId.get(categoryId);
                while (cursor) {
                    parts.unshift(safeName(cursor.name as string));
                    cursor =
                        cursor.parent_id === null ? undefined : byId.get(Number(cursor.parent_id));
                }
                return parts.length > 0 ? parts.join('/') : 'Unsorted';
            };

            const zip = archiver('zip', { store: true });
            const finished = new Promise<void>((resolve, reject) => {
                zip.on('error', reject);
                out.on('error', reject);
                out.on('close', resolve);
                out.on('finish', resolve);
            });
            zip.pipe(out);

            const json = (value: unknown): string => JSON.stringify(value, null, 2);
            zip.append(
                json({
                    exportedAt: new Date().toISOString(),
                    account: {
                        id: user.id,
                        username: user.username,
                        displayName: user.displayName,
                        bio: user.bio,
                        role: user.role,
                        hasPassword: user.passwordHash !== null,
                        nsfwOptIn: user.nsfwOptIn,
                        createdAt: user.createdAt,
                    },
                    signInMethods: identities.rows,
                }),
                { name: 'account.json' },
            );
            zip.append(json(categories.rows), { name: 'categories.json' });
            // What was said to the assistant and what it taught the sorter are the person's data too.
            zip.append(
                json({
                    messages: (
                        await getPool().query(
                            'SELECT role, content, actions, created_at FROM chat_messages WHERE user_id = $1 ORDER BY id',
                            [userId],
                        )
                    ).rows,
                    learnedPhrases: (
                        await getPool().query(
                            'SELECT category_id, phrase, created_at FROM category_hints WHERE user_id = $1 ORDER BY id',
                            [userId],
                        )
                    ).rows,
                }),
                { name: 'assistant.json' },
            );

            const seen = new Set<string>();
            const entries = files.rows.map((f: DatabaseRow) => {
                let entry = `files/${pathOf(f.category_id === null ? null : Number(f.category_id))}/${safeName(f.name as string)}`;
                // Two files with the same name in one folder must both survive: the id keeps the second one apart.
                if (seen.has(entry.toLowerCase())) {
                    entry = `${entry}.${(f.id as string).slice(0, 8)}`;
                }
                seen.add(entry.toLowerCase());
                return { row: f, exportPath: entry };
            });
            zip.append(json(entries.map((e) => ({ ...e.row, exportPath: e.exportPath }))), {
                name: 'files.json',
            });

            for (const { row, exportPath } of entries) {
                try {
                    zip.append(await blobStore.open(row.blob_sha256 as string), {
                        name: exportPath,
                    });
                } catch {
                    // A blob that cannot be read must not abort the whole export: say so inside the archive instead.
                    zip.append(
                        `The stored bytes of this file could not be read: ${row.id as string}\n`,
                        {
                            name: `${exportPath}.MISSING.txt`,
                        },
                    );
                }
            }
            await zip.finalize();
            await finished;
        } finally {
            exporting.delete(userId);
        }
    },

    /**
     * Deletes the account and everything it owns (Art 17 DSGVO): the account row, files, categories, shares, sign-in
     * methods and sessions go in one statement, then every stored blob that no other account still uses is removed
     * from the disk. Encrypted backup copies age out as described in PRIVACY.md section 6.
     *
     * @param userId - The signed-in account.
     * @param input - The username repeated as confirmation, and the password for an account that has one.
     */
    async deleteAccount(
        userId: string,
        input: { username: string; password?: string },
    ): Promise<void> {
        const user = await userRepository.findById(userId);
        if (!user) throw new NotFoundError();
        if (input.username.trim().toLowerCase() !== user.username.toLowerCase()) {
            throw new BadRequestError('Type your username exactly to confirm.');
        }
        if (user.passwordHash) {
            const ok =
                input.password !== undefined &&
                (await argon2.verify(user.passwordHash, input.password));
            if (!ok) throw new ForbiddenError('The password is not correct.');
        }

        const hashes = await getPool().transaction(async (tx) => {
            const { rows } = await tx.query(
                'SELECT DISTINCT blob_sha256 AS sha FROM files WHERE user_id = $1',
                [userId],
            );
            const found = new Set<string>(rows.map((r: DatabaseRow) => r.sha as string));
            if (user.avatarSha256) found.add(user.avatarSha256);
            // Categories reference their parent with ON DELETE RESTRICT, so take them out deepest first.
            await tx.query('DELETE FROM files WHERE user_id = $1', [userId]);
            for (;;) {
                const { rowCount } = await tx.query(
                    `DELETE FROM categories c WHERE c.user_id = $1
                       AND NOT EXISTS (SELECT 1 FROM categories k WHERE k.parent_id = c.id)`,
                    [userId],
                );
                if ((rowCount ?? 0) === 0) break;
            }
            await userRepository.remove(userId, tx);
            return [...found];
        });

        for (const sha256 of hashes) {
            if ((await fileRepository.blobReferences(sha256)) === 0) {
                await getPool().query('DELETE FROM blobs WHERE sha256 = $1', [sha256]);
                await blobStore.remove(sha256);
            }
        }
    },
};
