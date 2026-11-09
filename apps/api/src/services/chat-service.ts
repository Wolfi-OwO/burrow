import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { config } from '../config/index.ts';
import {
    BadRequestError,
    ConflictError,
    NotFoundError,
    ServiceUnavailableError,
} from '../lib/errors.ts';
import { llmHealthy, streamCompletion } from '../lib/llm-client.ts';
import type { LlmMessage } from '../lib/llm-client.ts';
import { logger } from '../lib/logger.ts';
import { visionClient } from '../lib/vision-client.ts';
import { ReplyStream } from '../lib/reply-stream.ts';
import type { Category } from '../models/category.model.ts';
import { categoryRepository } from '../repository/category.repository.ts';
import type { ChatAction, ChatActionType, ChatMessage } from '../repository/chat.repository.ts';
import { chatRepository } from '../repository/chat.repository.ts';
import { fileRepository } from '../repository/file.repository.ts';
import { parseOutline } from '../lib/outline.ts';
import { categoryService, plainName } from './category-service.ts';
import { cleanFileName, fileService } from './file-service.ts';
import { storageService } from './storage-service.ts';

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
                    type: {
                        type: 'string',
                        enum: [
                            'create_category',
                            'rename_category',
                            'add_hint',
                            'add_matching',
                            'unsort_category',
                            'unsort_all',
                            'remove_category',
                            'remove_all_categories',
                            'create_file',
                        ],
                    },
                    name: { type: 'string' },
                    parent: { type: 'string' },
                    phrase: { type: 'string' },
                    content: { type: 'string', maxLength: 4000 },
                },
                required: ['type', 'name', 'parent', 'phrase', 'content'],
                additionalProperties: false,
            },
        },
    },
    required: ['reply', 'actions'],
    additionalProperties: false,
} as const;

export interface RawAction {
    type: ChatActionType;
    name: string;
    parent: string;
    phrase: string;
    /** The text of a file for create_file; empty for every other action. */
    content: string;
}

const HISTORY = 10;
const MAX_TREE_LINES = 120;

/** What the model is told about the drive: every folder with its number of files, and the totals. */
export interface DriveSummary {
    counts: Map<number, number>;
    total: number;
    unsorted: number;
    /** What the sorter recognised in the unfiled pictures, most common first. */
    places?: { place: string; count: number }[];
}

function describeTree(
    categories: Category[],
    hints: Map<number, string[]>,
    drive: DriveSummary,
): string {
    const seen = drive.places?.length
        ? ` The unfiled pictures show: ${drive.places.map((p) => `${p.place} (${String(p.count)})`).join(', ')}.`
        : '';
    const head = `Files in total: ${String(drive.total)}. Not in any folder: ${String(drive.unsorted)}.${seen}`;
    if (categories.length === 0) return `${head}\n(no folders yet)`;
    const byId = new Map(categories.map((c) => [c.id, c]));
    const lines = categories.slice(0, MAX_TREE_LINES).map((c) => {
        const names: string[] = [];
        for (let node: Category | undefined = c; node; node = byId.get(node.parentId ?? -1))
            names.unshift(node.name);
        const learned = hints.get(c.id);
        const files = drive.counts.get(c.id) ?? 0;
        return `- ${names.join(' > ')} (${String(files)} file${files === 1 ? '' : 's'}${learned ? `; also scored as: ${learned.join('; ')}` : ''})`;
    });
    if (categories.length > MAX_TREE_LINES)
        lines.push(`- ...and ${String(categories.length - MAX_TREE_LINES)} more`);
    return [head, ...lines].join('\n');
}

export function systemPrompt(
    categories: Category[],
    hints: Map<number, string[]>,
    drive: DriveSummary = { counts: new Map(), total: 0, unsorted: 0 },
): string {
    return [
        "You are the assistant of Burrow, a personal file drive that sorts a person's pictures into folders by itself.",
        'You help the person set up, teach and tidy their folders. You act by listing actions:',
        '- create_category: make a folder. "name" is only the folder\'s own short name, never a path and never with ">" in it. "parent" is "" (the top level) unless the person said where it goes; then it is the name of that folder, existing or created earlier in the same list.',
        '- rename_category: give the folder "name" a new name, written in "phrase" (again only the short name, no ">"). The folder stays where it is.',
        '- add_hint: teach the sorter what belongs in an existing folder. "name" is that folder, "phrase" is a short English description of a typical picture in it, such as "an orange tabby cat on a sofa". The sorter reads pictures in English only.',
        '- add_matching: find the pictures that look like a description and put them in a folder. "name" is the folder (made when it does not exist yet, inside "parent" when the person said where), "phrase" is a short English description of what the pictures show, such as "a brown dog on a beach" or "snowy mountains". Use it when the person asks to find, collect or put certain pictures into a folder. The person is shown how many pictures matched and confirms before anything moves.',
        '- unsort_category: send every file of the folder "name" (and its subfolders) back to Unsorted. The folder stays.',
        '- unsort_all: send every file of the drive back to Unsorted. "name" is "".',
        '- remove_category: remove the folder "name" together with every folder below it. Their files move up to the parent folder (or Unsorted); no file is deleted.',
        '- remove_all_categories: remove every folder. "name" is "". Files are not deleted.',
        '- create_file: write a file into the drive. "name" is the file name with its extension, "content" its text, "parent" is "" unless the person named the folder it goes in. Allowed: .md (Markdown), .txt, .csv, .svg (a drawing, as SVG code starting with <svg), .puml (PlantUML), .mmd (Mermaid), .dot (Graphviz). Use it when the person asks for a document, a diagram, a drawing or a table. You can write drawings and diagrams as text; you cannot make photos or other pixel images.',
        'unsort_category, unsort_all, remove_category and remove_all_categories change what is already there, so the person is asked to confirm each one: just list them when the person clearly asked for them, and say that they wait for the yes.',
        'You cannot move single files, delete files or open them. Only list an action when the person asked for it or clearly described what a folder is for. Otherwise "actions" is empty.',
        'In the list of folders below, ">" only shows where a folder sits: "Nature > Alps" is the folder Alps inside Nature. A real name never contains ">".',
        'When asked which folders you would recommend, answer in the reply with a short list of fitting folder names, based on what the unfiled pictures show and the folders that exist; list no actions for it, and offer to create them.',
        'The "reply" is only for talking to the person, in their own language, one to three short sentences, plain words. Never write actions into it. When asked about the drive, use the numbers below.',
        '',
        'Examples of correct answers:',
        'Person: Make a folder Cars with Audi and BMW inside.',
        '{"reply":"Done, I made Cars with Audi and BMW inside.","actions":[{"type":"create_category","name":"Cars","parent":"","phrase":"","content":""},{"type":"create_category","name":"Audi","parent":"Cars","phrase":"","content":""},{"type":"create_category","name":"BMW","parent":"Cars","phrase":"","content":""}]}',
        'Person: Lege Ordner für Hunde und Katzen an.',
        '{"reply":"Erledigt, ich habe die Ordner Hunde und Katzen angelegt.","actions":[{"type":"create_category","name":"Hunde","parent":"","phrase":"","content":""},{"type":"create_category","name":"Katzen","parent":"","phrase":"","content":""}]}',
        'Person: Pets is for my dog Rex, a brown labrador.',
        '{"reply":"Renamed, it still sits inside Nature.","actions":[{"type":"rename_category","name":"Nature > Kals am Großglockner","parent":"","phrase":"Kals am Großglockner","content":""}]}',
        '{"reply":"I looked for them; confirm below and they move into Dogs.","actions":[{"type":"add_matching","name":"Dogs","parent":"","phrase":"a dog","content":""}]}',
        '{"reply":"Got it, the sorter will look for brown labradors in Pets.","actions":[{"type":"add_hint","name":"Pets","parent":"","phrase":"a brown labrador dog","content":""}]}',
        'Person: Unsort everything and then remove all folders.',
        '{"reply":"Both are ready below. Confirm them in this order and your files stay, just unsorted.","actions":[{"type":"unsort_all","name":"","parent":"","phrase":"","content":""},{"type":"remove_all_categories","name":"","parent":"","phrase":"","content":""}]}',
        'Person: Unsort the folder Nature.',
        '{"reply":"Nature is ready to be unsorted below; its files go back to Unsorted once you confirm.","actions":[{"type":"unsort_category","name":"Nature","parent":"","phrase":"","content":""}]}',
        'Person: Entferne den Ordner Spain.',
        '{"reply":"Bestätige unten, dann entferne ich Spain mit allen Unterordnern. Die Dateien bleiben erhalten und kommen eine Ebene nach oben.","actions":[{"type":"remove_category","name":"Spain","parent":"","phrase":"","content":""}]}',
        'Person: Draw a simple red circle as SVG.',
        '{"reply":"Here is a red circle, saved as circle.svg.","actions":[{"type":"create_file","name":"circle.svg","parent":"","phrase":"","content":"<svg xmlns=\\"http://www.w3.org/2000/svg\\" viewBox=\\"0 0 100 100\\"><circle cx=\\"50\\" cy=\\"50\\" r=\\"40\\" fill=\\"red\\"/></svg>"}]}',
        'Person: Make a PlantUML diagram of login.',
        '{"reply":"I wrote the login sequence as login.puml.","actions":[{"type":"create_file","name":"login.puml","parent":"","phrase":"","content":"@startuml\\nUser -> App: log in\\nApp -> Server: check password\\nServer --> App: ok\\nApp --> User: welcome\\n@enduml"}]}',
        'Person: Hi, what can you do?',
        '{"reply":"I can create, teach, unsort and remove folders, and write documents and diagrams as files. Removing and unsorting ask you first.","actions":[]}',
        '',
        'The drive the person has now:',
        describeTree(categories, hints, drive),
    ].join('\n');
}

/** The model's text becomes a folder name or a scored phrase: no control characters, one line, bounded. */
export function clean(text: string, max: number): string {
    return text.replace(/\p{C}/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Finds a folder by name, or by "A > B" path (the last part decides), shallowest first. */
export function find(pool: Category[], wanted: string): Category | null {
    const whole = wanted.trim().toLowerCase();
    if (whole.includes('>')) {
        const byId = new Map(pool.map((c) => [c.id, c]));
        const full = pool.find((c) => {
            const names: string[] = [];
            for (let n: Category | undefined = c; n; n = byId.get(n.parentId ?? -1))
                names.unshift(n.name.toLowerCase());
            return (
                names.join(' > ') ===
                whole
                    .split('>')
                    .map((p) => p.trim())
                    .join(' > ')
            );
        });
        if (full) return full;
    }
    const literal = pool.find((c) => c.name.toLowerCase() === whole);
    if (literal) return literal;
    const last = wanted.split('>').pop()?.trim().toLowerCase();
    if (!last) return null;
    return (
        pool
            .filter((c) => c.name.toLowerCase() === last)
            .sort((a, b) => a.path.length - b.path.length)[0] ?? null
    );
}

const plural = (n: number, one: string, many: string): string =>
    `${String(n)} ${n === 1 ? one : many}`;

/**
 * An action that changes or removes what is already there is not done at once: it becomes a card with the exact
 * consequence, and waits for the person's yes (`confirmAction`).
 */
async function propose(
    userId: string,
    type: ChatActionType,
    name: string,
    pool: Category[],
    done: (action: ChatAction) => ChatAction,
): Promise<ChatAction> {
    if (type === 'unsort_all') {
        const n = await fileRepository.filedCount(userId);
        return done(
            n === 0
                ? {
                      type,
                      status: 'skipped',
                      label: 'Unsort everything',
                      detail: 'Nothing is filed.',
                  }
                : {
                      type,
                      status: 'pending',
                      label: 'Unsort everything',
                      detail: `${plural(n, 'file goes', 'files go')} back to Unsorted. The folders stay.`,
                  },
        );
    }
    if (type === 'remove_all_categories') {
        return done(
            pool.length === 0
                ? {
                      type,
                      status: 'skipped',
                      label: 'Remove all folders',
                      detail: 'There are none.',
                  }
                : {
                      type,
                      status: 'pending',
                      label: 'Remove all folders',
                      detail: `${plural(pool.length, 'folder', 'folders')} removed, no file is deleted.`,
                  },
        );
    }
    const target = find(pool, name);
    if (!target)
        return done({
            type,
            status: 'skipped',
            label: name,
            detail: `There is no folder called ${name}.`,
        });
    const files = await categoryRepository.countFilesInSubtree(userId, target.id);
    if (type === 'unsort_category') {
        return done(
            files === 0
                ? {
                      type,
                      status: 'skipped',
                      label: target.name,
                      detail: 'It holds no files.',
                      categoryId: target.id,
                  }
                : {
                      type,
                      status: 'pending',
                      label: target.name,
                      detail: `${plural(files, 'file goes', 'files go')} back to Unsorted. The folder stays.`,
                      categoryId: target.id,
                  },
        );
    }
    const below = pool.filter((c) => c.path.startsWith(`${target.path}.`)).length;
    return done({
        type: 'remove_category',
        status: 'pending',
        label: target.name,
        detail: `The folder${below > 0 ? ` and its ${plural(below, 'subfolder', 'subfolders')} are` : ' is'} removed. The ${plural(files, 'file', 'files')} in ${below > 0 ? 'them' : 'it'} move up one level. No file is deleted.`,
        categoryId: target.id,
    });
}

/**
 * Finds the pictures that look like a description (a CLIP text embedding against the stored picture embeddings) and
 * offers to file them in a folder. Nothing moves until the person confirms; the exact pictures found are kept on the
 * card so the yes moves those and not whatever a later search would return.
 */
async function proposeMatching(
    userId: string,
    raw: RawAction,
    name: string,
    pool: Category[],
    done: (action: ChatAction) => ChatAction,
): Promise<ChatAction> {
    const phrase = clean(raw.phrase, 120);
    const label = plainName(name);
    const skip = (detail: string): ChatAction =>
        done({ type: 'add_matching', status: 'skipped', label, detail });
    if (phrase.length < 3) return skip('It was not clear what the pictures should show.');
    let vector: number[];
    try {
        vector = await visionClient.embedText(phrase);
    } catch (error) {
        logger.warn({ err: error }, 'picture search is not available');
        return skip('The picture search is not available right now.');
    }
    const target = find(pool, name);
    const found = await fileRepository.nearest(userId, vector, target?.id ?? null, config.find.max);
    const best = found[0]?.similarity ?? 0;
    const floor = Math.max(config.find.minSimilarity, best - config.find.window);
    const hits = found.filter((f) => f.similarity >= floor);
    if (hits.length === 0) return skip(`No picture looks like "${phrase}".`);

    let categoryId = target?.id;
    let made = false;
    if (categoryId === undefined) {
        const created = await perform(
            userId,
            { type: 'create_category', name, parent: raw.parent, phrase: '', content: '' },
            pool,
            () => undefined,
        );
        if (created.categoryId === undefined)
            return skip(created.detail ?? 'The folder could not be made.');
        categoryId = created.categoryId;
        made = created.status === 'done';
    }
    const fresh = hits.filter((f) => f.categoryId === null).length;
    const elsewhere = hits.length - fresh;
    return done({
        type: 'add_matching',
        status: 'pending',
        label: target?.name ?? label,
        detail: `${plural(hits.length, 'picture', 'pictures')} that look like "${phrase}" go into it${
            elsewhere > 0
                ? ` (${String(fresh)} from Unsorted, ${String(elsewhere)} from other folders)`
                : ''
        }.${made ? ' The folder was made.' : ''}`,
        categoryId,
        fileIds: hits.map((f) => f.id),
    });
}

/** Carries out a confirmed action, on the asking person's own data only. */
async function execute(userId: string, action: ChatAction): Promise<ChatAction> {
    switch (action.type) {
        case 'unsort_all': {
            const n = await fileRepository.unsortAll(userId);
            return {
                ...action,
                status: 'done',
                detail: `${plural(n, 'file', 'files')} back in Unsorted.`,
            };
        }
        case 'add_matching': {
            if (
                action.categoryId === undefined ||
                !(await categoryRepository.findById(userId, action.categoryId))
            )
                return { ...action, status: 'skipped', detail: 'The folder is gone.' };
            const n = await fileRepository.setCategoryMany(
                userId,
                action.fileIds ?? [],
                action.categoryId,
            );
            return {
                ...action,
                status: 'done',
                detail: `${plural(n, 'picture', 'pictures')} filed.`,
            };
        }
        case 'unsort_category': {
            if (
                action.categoryId === undefined ||
                !(await categoryRepository.findById(userId, action.categoryId))
            )
                return { ...action, status: 'skipped', detail: 'The folder is gone.' };
            const n = await fileRepository.requeueCategory(userId, action.categoryId);
            return {
                ...action,
                status: 'done',
                detail: `${plural(n, 'file', 'files')} back in Unsorted.`,
            };
        }
        case 'remove_category': {
            if (
                action.categoryId === undefined ||
                !(await categoryRepository.findById(userId, action.categoryId))
            )
                return { ...action, status: 'skipped', detail: 'The folder is gone.' };
            const removed = await categoryService.removeTree(userId, [action.categoryId]);
            return {
                ...action,
                status: 'done',
                detail: `${plural(removed.categories, 'folder', 'folders')} removed, ${plural(removed.files, 'file', 'files')} moved up.`,
            };
        }
        case 'remove_all_categories': {
            const all = await categoryRepository.listAll(userId);
            const removed = await categoryService.removeTree(
                userId,
                all.filter((c) => c.parentId === null).map((c) => c.id),
            );
            return {
                ...action,
                status: 'done',
                detail: `${plural(removed.categories, 'folder', 'folders')} removed, ${plural(removed.files, 'file', 'files')} are in Unsorted.`,
            };
        }
        default:
            return { ...action, status: 'skipped', detail: 'Nothing to confirm.' };
    }
}

/** What the assistant may write, and the type each gets. Nothing a browser would run (no .html, no scripts). */
const WRITABLE: Record<string, string> = {
    md: 'text/markdown',
    markdown: 'text/markdown',
    txt: 'text/plain',
    csv: 'text/csv',
    svg: 'image/svg+xml',
    puml: 'text/plain',
    plantuml: 'text/plain',
    mmd: 'text/plain',
    dot: 'text/plain',
};

/**
 * @returns Why this SVG may not be saved, or null. The file is served in a sandbox without scripts anyway; this keeps
 *   active content and outside references out of the drive in the first place.
 */
export function svgProblem(svg: string): string | null {
    const text = svg.trim().replace(/^<\?xml[^>]*\?>\s*/i, '');
    if (!/^<svg[\s>]/i.test(text) || !/<\/svg>\s*$/i.test(text)) return 'It is not a complete SVG.';
    if (/<\s*(script|foreignObject|iframe|object|embed|use|animate|set|style)\b/i.test(text))
        return 'It contains elements that are not allowed in a drawing.';
    if (
        /\son[a-z]+\s*=/i.test(text) ||
        /javascript:/i.test(text) ||
        /<!(DOCTYPE|ENTITY)/i.test(text)
    )
        return 'It contains active content.';
    if (/(href|src)\s*=\s*(?!["']?\s*(data:image\/(png|jpeg|gif|webp);base64,|#))/i.test(text))
        return 'It refers to something outside the drawing.';
    return null;
}

async function writeFileAction(
    userId: string,
    raw: RawAction,
    name: string,
    pool: Category[],
    done: (action: ChatAction) => ChatAction,
): Promise<ChatAction> {
    const fileName = cleanFileName(name);
    const extension = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() : undefined;
    const mime = extension ? WRITABLE[extension] : undefined;
    const fail = (detail: string): ChatAction =>
        done({ type: 'create_file', status: 'skipped', label: fileName, detail });
    if (!mime)
        return fail(
            `Files of that kind cannot be written. Allowed: ${Object.keys(WRITABLE).join(', ')}.`,
        );
    const content = raw.content.replace(/\r\n/g, '\n');
    if (content.trim().length < 3) return fail('There was nothing to write.');
    if (mime === 'image/svg+xml') {
        const problem = svgProblem(content);
        if (problem) return fail(problem);
    }
    const parentName = clean(raw.parent, 60);
    const folder = parentName === '' ? null : find(pool, parentName);
    if (parentName !== '' && !folder) return fail(`There is no folder called ${parentName}.`);

    await storageService.assertRoom(userId, Buffer.byteLength(content));
    const staging = join(config.storage.dir, 'tmp');
    await mkdir(staging, { recursive: true });
    const path = join(staging, `chat-${randomUUID()}`);
    await writeFile(path, content, 'utf8');
    // The same path as any upload: hashed, deduplicated, and queued for the sorter like the rest.
    const { file } = await fileService.upload(
        userId,
        path,
        Buffer.byteLength(content),
        fileName,
        mime,
    );
    if (folder) await fileRepository.setCategory(userId, file.id, folder.id);
    return done({
        type: 'create_file',
        status: 'done',
        label: fileName,
        detail: folder ? `Saved in ${folder.name}.` : 'Saved in Unsorted.',
        fileId: file.id,
        mime: file.mime,
        ...(folder ? { categoryId: folder.id } : {}),
    });
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
    const needsName = raw.type !== 'unsort_all' && raw.type !== 'remove_all_categories';
    if (name === '' && needsName)
        return done({
            type: raw.type,
            status: 'skipped',
            label: 'Nothing named',
            detail: 'No name.',
        });

    if (raw.type === 'create_category') {
        const parts = name
            .split('>')
            .map((part) => part.trim())
            .filter(Boolean);
        const shown = parts.pop() ?? name;
        // "Nature > Alps" means Alps inside Nature; the path is never part of the name.
        const parentName = clean(raw.parent, 60) || parts.join(' > ');
        const parent = parentName === '' ? null : find(pool, parentName);
        if (parentName !== '' && !parent)
            return done({
                type: 'create_category',
                status: 'skipped',
                label: shown,
                detail: `There is no folder called ${parentName}.`,
            });
        const existing = pool.find(
            (c) =>
                c.parentId === (parent?.id ?? null) && c.name.toLowerCase() === shown.toLowerCase(),
        );
        if (existing)
            return done({
                type: 'create_category',
                status: 'exists',
                label: shown,
                detail: parent ? `Already inside ${parent.name}.` : 'Already there.',
                categoryId: existing.id,
            });
        try {
            const made = await categoryService.create(userId, parent?.id ?? null, shown);
            pool.push(made);
            return done({
                type: 'create_category',
                status: 'done',
                label: shown,
                detail: parent ? `Inside ${parent.name}.` : 'Top level.',
                categoryId: made.id,
            });
        } catch (error) {
            if (error instanceof ConflictError)
                return done({ type: 'create_category', status: 'exists', label: shown });
            throw error;
        }
    }

    if (raw.type === 'rename_category') {
        const target = find(pool, name);
        const next = plainName(clean(raw.phrase, 60));
        if (!target || next === '')
            return done({
                type: 'rename_category',
                status: 'skipped',
                label: name,
                detail: !target ? `There is no folder called ${name}.` : 'No new name was given.',
            });
        if (target.name === next)
            return done({
                type: 'rename_category',
                status: 'exists',
                label: next,
                categoryId: target.id,
            });
        try {
            const renamed = await categoryService.rename(userId, target.id, next);
            const slot = pool.findIndex((c) => c.id === renamed.id);
            if (slot >= 0) pool[slot] = { ...pool[slot], name: renamed.name } as Category;
            return done({
                type: 'rename_category',
                status: 'done',
                label: renamed.name,
                detail: `Was ${target.name}.`,
                categoryId: renamed.id,
            });
        } catch (error) {
            if (error instanceof ConflictError)
                return done({
                    type: 'rename_category',
                    status: 'skipped',
                    label: next,
                    detail: 'A folder with that name is already next to it.',
                });
            throw error;
        }
    }

    if (raw.type === 'add_matching') return proposeMatching(userId, raw, name, pool, done);
    if (raw.type === 'create_file')
        return writeFileAction(userId, raw, clean(raw.name, 120), pool, done);
    if (raw.type !== 'add_hint') return propose(userId, raw.type, name, pool, done);

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

    /** The person's yes or no to one waiting action of one message. @returns The action as it stands afterwards. */
    async resolveAction(
        userId: string,
        messageId: number,
        index: number,
        decision: 'confirm' | 'decline',
    ): Promise<ChatAction> {
        const message = await chatRepository.find(userId, messageId);
        const action = message?.actions[index];
        if (!message || !action) throw new NotFoundError('That action does not exist.');
        if (action.status !== 'pending')
            throw new BadRequestError('That action was already answered.');
        const result: ChatAction =
            decision === 'confirm'
                ? await execute(userId, action)
                : { ...action, status: 'declined', detail: 'Left as it was.' };
        await chatRepository.setActions(
            userId,
            messageId,
            message.actions.map((a, i) => (i === index ? result : a)),
        );
        return result;
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
        const outline = parseOutline(text);
        const needsModel = !outline || outline.question !== '';
        if (needsModel && (!config.llm.url || !(await llmHealthy())))
            throw new ServiceUnavailableError('The assistant is not running right now.');
        await chatRepository.add(userId, 'user', text);

        const built: ChatAction[] = [];
        if (outline) {
            // A drawn tree is built exactly as drawn, without asking the model to retype it.
            const pool = await categoryRepository.listAll(userId);
            for (const folder of outline.folders)
                built.push(
                    await perform(
                        userId,
                        {
                            type: 'create_category',
                            name: folder.name,
                            parent: folder.parent,
                            phrase: '',
                            content: '',
                        },
                        pool,
                        (action) => emit({ type: 'action', action }),
                    ),
                );
            if (outline.question === '') {
                const made = built.filter((r) => r.status === 'done').length;
                const reply =
                    made === 0
                        ? 'Everything in that tree was already there.'
                        : `I built your tree: ${String(made)} new folder${made === 1 ? '' : 's'}.`;
                emit({ type: 'delta', text: reply });
                emit({
                    type: 'done',
                    message: await chatRepository.add(userId, 'assistant', reply, built),
                });
                return;
            }
        }

        await acquire((position) => emit({ type: 'queued', position }), signal);
        try {
            const pool = await categoryRepository.listAll(userId);
            const hints = await chatRepository.hintsByCategory(userId);
            const tree = await categoryRepository.listTree(userId);
            const total = (await fileRepository.typeCounts(userId)).all ?? 0;
            const drive: DriveSummary = {
                counts: new Map(tree.map((c) => [c.id, c.fileCount])),
                total,
                unsorted: total - (await fileRepository.filedCount(userId)),
                places: await fileRepository.topPlaces(userId, 12),
            };
            const history = await chatRepository.recent(userId, HISTORY);
            // The tree is already built; the model only answers what was asked next to it.
            if (outline && history.length > 0)
                history[history.length - 1] = {
                    ...history[history.length - 1],
                    content: `${outline.question} (My folder tree is already made.)`,
                } as (typeof history)[number];
            const messages: LlmMessage[] = [
                { role: 'system', content: systemPrompt(pool, hints, drive) },
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
            const results: ChatAction[] = [...built];
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
