import type { DatabaseRow, Queryable } from '../database/connection.ts';
import { getPool } from '../database/connection.ts';

export type ChatActionType =
    | 'create_category'
    | 'rename_category'
    | 'add_hint'
    | 'add_matching'
    | 'unsort_category'
    | 'unsort_all'
    | 'remove_category'
    | 'remove_all_categories'
    | 'create_file';

export interface ChatAction {
    type: ChatActionType;
    /**
     * done: it happened. exists: it was already so. skipped: it could not be done, `detail` says why.
     * pending: it changes or removes something, so it waits for the person's yes. declined: the person said no.
     */
    status: 'done' | 'exists' | 'skipped' | 'pending' | 'declined';
    label: string;
    detail?: string;
    categoryId?: number;
    /** The pictures an add_matching card would move, kept so a yes moves exactly those. */
    fileIds?: string[];
    /** A file the assistant wrote into the drive: what the page needs to open it. */
    fileId?: string;
    mime?: string;
}

export interface ChatMessage {
    id: number;
    role: 'user' | 'assistant';
    content: string;
    actions: ChatAction[];
    createdAt: string;
}

function toMessage(row: DatabaseRow): ChatMessage {
    return {
        id: Number(row.id),
        role: row.role as 'user' | 'assistant',
        content: row.content as string,
        actions: row.actions as ChatAction[],
        createdAt: (row.created_at as Date).toISOString(),
    };
}

/** How many hints one folder may carry: they all go into every score of that folder. */
export const MAX_HINTS_PER_CATEGORY = 12;

export const chatRepository = {
    /** @returns The newest `limit` messages, oldest first. */
    async recent(userId: string, limit: number, db: Queryable = getPool()): Promise<ChatMessage[]> {
        const { rows } = await db.query(
            `SELECT id, role, content, actions, created_at FROM chat_messages
              WHERE user_id = $1 ORDER BY id DESC LIMIT $2`,
            [userId, limit],
        );
        return rows.map(toMessage).reverse();
    },

    async add(
        userId: string,
        role: 'user' | 'assistant',
        content: string,
        actions: ChatAction[] = [],
        db: Queryable = getPool(),
    ): Promise<ChatMessage> {
        const { rows } = await db.query(
            `INSERT INTO chat_messages (user_id, role, content, actions)
             VALUES ($1, $2, $3, $4::jsonb) RETURNING id, role, content, actions, created_at`,
            [userId, role, content, JSON.stringify(actions)],
        );
        return toMessage(rows[0] as DatabaseRow);
    },

    /** One of the person's own messages, or null. */
    async find(userId: string, id: number, db: Queryable = getPool()): Promise<ChatMessage | null> {
        const { rows } = await db.query(
            `SELECT id, role, content, actions, created_at FROM chat_messages
              WHERE id = $1 AND user_id = $2`,
            [id, userId],
        );
        return rows[0] ? toMessage(rows[0]) : null;
    },

    async setActions(
        userId: string,
        id: number,
        actions: ChatAction[],
        db: Queryable = getPool(),
    ): Promise<void> {
        await db.query(
            'UPDATE chat_messages SET actions = $3::jsonb WHERE id = $1 AND user_id = $2',
            [id, userId, JSON.stringify(actions)],
        );
    },

    async clear(userId: string, db: Queryable = getPool()): Promise<void> {
        await db.query('DELETE FROM chat_messages WHERE user_id = $1', [userId]);
    },

    /** Every hint of the user, grouped by the folder it belongs to. */
    async hintsByCategory(
        userId: string,
        db: Queryable = getPool(),
    ): Promise<Map<number, string[]>> {
        const { rows } = await db.query(
            'SELECT category_id, phrase FROM category_hints WHERE user_id = $1 ORDER BY id',
            [userId],
        );
        const byCategory = new Map<number, string[]>();
        for (const row of rows) {
            const id = Number(row.category_id);
            byCategory.set(id, [...(byCategory.get(id) ?? []), row.phrase as string]);
        }
        return byCategory;
    },

    /** @returns `added`, `exists` (same phrase already there) or `full` (the folder carries enough already). */
    async addHint(
        userId: string,
        categoryId: number,
        phrase: string,
        db: Queryable = getPool(),
    ): Promise<'added' | 'exists' | 'full'> {
        const { rows } = await db.query(
            `SELECT count(*)::int AS n, bool_or(lower(phrase) = lower($3)) AS same
               FROM category_hints WHERE user_id = $1 AND category_id = $2`,
            [userId, categoryId, phrase],
        );
        const row = rows[0] as { n: number; same: boolean | null };
        if (row.same === true) return 'exists';
        if (row.n >= MAX_HINTS_PER_CATEGORY) return 'full';
        await db.query(
            `INSERT INTO category_hints (user_id, category_id, phrase) VALUES ($1, $2, $3)
             ON CONFLICT DO NOTHING`,
            [userId, categoryId, phrase],
        );
        return 'added';
    },
};
