import { config } from '../config/index.ts';
import { ConflictError, ServiceUnavailableError } from '../lib/errors.ts';
import { llmHealthy, streamCompletion } from '../lib/llm-client.ts';
import type { LlmMessage } from '../lib/llm-client.ts';
import { logger } from '../lib/logger.ts';
import { ReplyStream } from '../lib/reply-stream.ts';
import type { Category } from '../models/category.model.ts';
import { categoryRepository } from '../repository/category.repository.ts';
import type { ChatAction, ChatMessage } from '../repository/chat.repository.ts';
import { chatRepository } from '../repository/chat.repository.ts';
import { categoryService } from './category-service.ts';

/** What the page is told while an answer is being made. */
export type ChatEvent =
    | { type: 'queued'; position: number }
    | { type: 'delta'; text: string }
    | { type: 'action'; action: ChatAction }
    | { type: 'done'; message: ChatMessage };

/** The answer is constrained to this shape; `reply` comes first so it can be shown while the rest is written. */
const TURN_SCHEMA = {
    type: 'object',
    properties: {
        reply: { type: 'string', maxLength: 280 },
        actions: {
            type: 'array',
            maxItems: 8,
            items: {
                type: 'object',
                properties: {
                    type: { type: 'string', enum: ['create_category', 'add_hint'] },
                    name: { type: 'string' },
                    parent: { type: 'string' },
                    phrase: { type: 'string' },
                },
                required: ['type', 'name', 'parent', 'phrase'],
                additionalProperties: false,
            },
        },
    },
    required: ['reply', 'actions'],
    additionalProperties: false,
} as const;

export interface RawAction {
    type: 'create_category' | 'add_hint';
    name: string;
    parent: string;
    phrase: string;
}

const HISTORY = 10;
const MAX_TREE_LINES = 120;

function describeTree(categories: Category[], hints: Map<number, string[]>): string {
    if (categories.length === 0) return '(no folders yet)';
    const byId = new Map(categories.map((c) => [c.id, c]));
    const lines = categories.slice(0, MAX_TREE_LINES).map((c) => {
        const names: string[] = [];
        for (let node: Category | undefined = c; node; node = byId.get(node.parentId ?? -1))
            names.unshift(node.name);
        const learned = hints.get(c.id);
        return `- ${names.join(' > ')}${learned ? ` (also scored as: ${learned.join('; ')})` : ''}`;
    });
    if (categories.length > MAX_TREE_LINES)
        lines.push(`- ...and ${String(categories.length - MAX_TREE_LINES)} more`);
    return lines.join('\n');
}

export function systemPrompt(categories: Category[], hints: Map<number, string[]>): string {
    return [
        "You are the assistant of Burrow, a personal file drive that sorts a person's pictures into folders by itself.",
        'You help the person set up and teach their folders. You can do exactly two things, by listing actions:',
        '- create_category: make a folder. "name" is the new folder. "parent" is "" (the top level) unless the person said where it goes; then it is the name of that folder, existing or created earlier in the same list.',
        '- add_hint: teach the sorter what belongs in an existing folder. "name" is that folder, "phrase" is a short English description of a typical picture in it, such as "an orange tabby cat on a sofa". The sorter reads pictures in English only.',
        'You cannot move, rename, delete or open files. If asked, say the sorter files pictures by itself and the person can press Sort now on the Review page.',
        'Only list an action when the person asked for it or clearly described what a folder is for. Otherwise "actions" is empty.',
        'The "reply" is only for talking to the person, in their own language, one to three short sentences, plain words. Never write actions into it.',
        '',
        'Examples of correct answers:',
        'Person: Make a folder Cars with Audi and BMW inside.',
        '{"reply":"Done, I made Cars with Audi and BMW inside.","actions":[{"type":"create_category","name":"Cars","parent":"","phrase":""},{"type":"create_category","name":"Audi","parent":"Cars","phrase":""},{"type":"create_category","name":"BMW","parent":"Cars","phrase":""}]}',
        'Person: Lege Ordner für Hunde und Katzen an.',
        '{"reply":"Erledigt, ich habe die Ordner Hunde und Katzen angelegt.","actions":[{"type":"create_category","name":"Hunde","parent":"","phrase":""},{"type":"create_category","name":"Katzen","parent":"","phrase":""}]}',
        'Person: Pets is for my dog Rex, a brown labrador.',
        '{"reply":"Got it, the sorter will look for brown labradors in Pets.","actions":[{"type":"add_hint","name":"Pets","parent":"","phrase":"a brown labrador dog"}]}',
        'Person: Hi, what can you do?',
        '{"reply":"I can create folders for you and teach the sorter what belongs in them.","actions":[]}',
        '',
        'The folders the person has now:',
        describeTree(categories, hints),
    ].join('\n');
}

/** The model's text becomes a folder name or a scored phrase: no control characters, one line, bounded. */
export function clean(text: string, max: number): string {
    return text.replace(/\p{C}/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Finds a folder by name, or by "A > B" path (the last part decides), shallowest first. */
export function find(pool: Category[], wanted: string): Category | null {
    const last = wanted.split('>').pop()?.trim().toLowerCase();
    if (!last) return null;
    return (
        pool
            .filter((c) => c.name.toLowerCase() === last)
            .sort((a, b) => a.path.length - b.path.length)[0] ?? null
    );
}

/** Does what one action asks, if it is valid and the person's own data allows it. Never throws for bad input. */
export async function perform(
    userId: string,
    raw: RawAction,
    pool: Category[],
    emit: (action: ChatAction) => void = () => undefined,
): Promise<ChatAction> {
    const name = clean(raw.name, 60);
    const done = (action: ChatAction): ChatAction => {
        emit(action);
        return action;
    };
    if (name === '')
        return done({
            type: raw.type,
            status: 'skipped',
            label: 'Nothing named',
            detail: 'No name.',
        });

    if (raw.type === 'create_category') {
        const parentName = clean(raw.parent, 60);
        const parent = parentName === '' ? null : find(pool, parentName);
        if (parentName !== '' && !parent)
            return done({
                type: 'create_category',
                status: 'skipped',
                label: name,
                detail: `There is no folder called ${parentName}.`,
            });
        const existing = pool.find(
            (c) =>
                c.parentId === (parent?.id ?? null) && c.name.toLowerCase() === name.toLowerCase(),
        );
        if (existing)
            return done({
                type: 'create_category',
                status: 'exists',
                label: name,
                detail: parent ? `Already inside ${parent.name}.` : 'Already there.',
                categoryId: existing.id,
            });
        try {
            const made = await categoryService.create(userId, parent?.id ?? null, name);
            pool.push(made);
            return done({
                type: 'create_category',
                status: 'done',
                label: name,
                detail: parent ? `Inside ${parent.name}.` : 'Top level.',
                categoryId: made.id,
            });
        } catch (error) {
            if (error instanceof ConflictError)
                return done({ type: 'create_category', status: 'exists', label: name });
            throw error;
        }
    }

    const target = find(pool, name);
    const phrase = clean(raw.phrase, 120);
    if (!target || phrase.length < 3)
        return done({
            type: 'add_hint',
            status: 'skipped',
            label: name,
            detail: !target ? `There is no folder called ${name}.` : 'The phrase was too short.',
        });
    const result = await chatRepository.addHint(userId, target.id, phrase);
    return done({
        type: 'add_hint',
        status: result === 'added' ? 'done' : result === 'exists' ? 'exists' : 'skipped',
        label: `${target.name}: ${phrase}`,
        detail:
            result === 'full'
                ? 'This folder has learned enough phrases already.'
                : result === 'exists'
                  ? 'Already learned.'
                  : 'The sorter scores pictures against this too from now on.',
        categoryId: target.id,
    });
}

// The model runs on the server's own CPU, so only a few answers are made at once and the rest wait their turn.
let running = 0;
const waiting: (() => void)[] = [];

async function acquire(onPosition: (position: number) => void, signal: AbortSignal): Promise<void> {
    if (running < config.llm.concurrency) {
        running += 1;
        return;
    }
    await new Promise<void>((resolve, reject) => {
        const turn = (): void => resolve();
        waiting.push(turn);
        onPosition(waiting.length);
        signal.addEventListener(
            'abort',
            () => {
                const at = waiting.indexOf(turn);
                if (at !== -1) waiting.splice(at, 1);
                reject(new Error('aborted'));
            },
            { once: true },
        );
    });
}

function release(): void {
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
}

export const chatService = {
    async status(): Promise<{ enabled: boolean; ready: boolean }> {
        return { enabled: Boolean(config.llm.url), ready: await llmHealthy() };
    },

    history(userId: string): Promise<ChatMessage[]> {
        return chatRepository.recent(userId, 60);
    },

    clear(userId: string): Promise<void> {
        return chatRepository.clear(userId);
    },

    /**
     * One turn: the person's message goes in, the answer streams out through `emit`, and whatever the assistant
     * decided to do (new folders, learned phrases) is done and reported as cards.
     */
    async turn(
        userId: string,
        text: string,
        signal: AbortSignal,
        emit: (event: ChatEvent) => void,
    ): Promise<void> {
        if (!config.llm.url || !(await llmHealthy()))
            throw new ServiceUnavailableError('The assistant is not running right now.');
        await chatRepository.add(userId, 'user', text);

        await acquire((position) => emit({ type: 'queued', position }), signal);
        try {
            const pool = await categoryRepository.listAll(userId);
            const hints = await chatRepository.hintsByCategory(userId);
            const history = await chatRepository.recent(userId, HISTORY);
            const messages: LlmMessage[] = [
                { role: 'system', content: systemPrompt(pool, hints) },
                ...history.map((m) => ({ role: m.role, content: m.content })),
            ];

            const reply = new ReplyStream();
            let json = '';
            for await (const piece of streamCompletion(messages, TURN_SCHEMA, signal)) {
                json += piece;
                const shown = reply.push(piece);
                if (shown !== '') emit({ type: 'delta', text: shown });
            }

            let turn: { reply: string; actions: RawAction[] };
            try {
                turn = JSON.parse(json) as { reply: string; actions: RawAction[] };
            } catch {
                // Cut off by the length limit: keep what was said, do nothing.
                logger.warn('assistant answer did not parse; no actions taken');
                turn = { reply: '', actions: [] };
            }
            const results: ChatAction[] = [];
            for (const raw of turn.actions.slice(0, 8))
                results.push(
                    await perform(userId, raw, pool, (action) => emit({ type: 'action', action })),
                );

            const message = await chatRepository.add(
                userId,
                'assistant',
                turn.reply.trim() === '' ? 'Done.' : turn.reply.trim(),
                results,
            );
            emit({ type: 'done', message });
        } finally {
            release();
        }
    },
};
