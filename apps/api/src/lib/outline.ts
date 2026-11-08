/**
 * Reads a pasted folder outline ("|- Furry", indented lists, "(make folders for: A, B)" notes) into the folders to
 * create. A small model cannot hold forty folders and their parents straight, so a person who draws the tree gets
 * exactly that tree.
 */
export interface OutlineFolder {
    name: string;
    /** Full path of the parent as "A > B", or "" for the top level. */
    parent: string;
}

const MARK = /^[\s|`'+*•·\-–—>└├─│]*/u;
const MAX_FOLDERS = 120;

function tidy(name: string): string {
    let text = name
        .replace(/[)(\][]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    // A loop instead of a /[.:;,]+$/ pattern, which backtracks quadratically on long runs of punctuation.
    while (text !== '' && '.:;,'.includes(text.charAt(text.length - 1))) text = text.slice(0, -1);
    return text === '' ? '' : text.charAt(0).toUpperCase() + text.slice(1);
}

/** The names a note such as "(Then make categories for: A, B and C)" asks for, or none when it lists nothing. */
function listed(note: string): string[] {
    const body = note.replace(/^\s*\(/, '').replace(/\)\s*$/, '');
    const cut = Math.max(body.lastIndexOf('->'), body.lastIndexOf(':'));
    if (cut < 0) return [];
    return body
        .slice(cut + (body.startsWith('->', cut) ? 2 : 1))
        .split(/,|;|\band\b|\bund\b/i)
        .map((part) => tidy(part))
        .filter((part) => part !== '' && !/^(etc|etcetera|and so on|\.+)$/i.test(part));
}

/** @returns The folders in creation order, or null when the text is not a tree outline. */
export function parseOutline(text: string): OutlineFolder[] | null {
    const lines = text.replace(/\t/g, '    ').split('\n');
    const real = lines.filter((line) => line.trim() !== '');
    const drawn = real.filter((line) => /^[\s]*[|`├└│+*•\-–]/u.test(line)).length;
    if (real.length < 3 || drawn < 2) return null;

    const folders: OutlineFolder[] = [];
    const stack: { key: number; path: string }[] = [];
    let last: string | null = null;
    const seen = new Set<string>();
    const add = (name: string, parent: string): string => {
        const path = parent === '' ? name : `${parent} > ${name}`;
        if (!seen.has(path.toLowerCase())) {
            seen.add(path.toLowerCase());
            folders.push({ name, parent });
        }
        return path;
    };

    for (const line of lines) {
        if (line.trim() === '') continue;
        const marks = MARK.exec(line)?.[0] ?? '';
        const rest = line.slice(marks.length).trim();
        if (rest === '') continue;
        if (rest.startsWith('(') || /^(maybe|then|also|add|make)\b/i.test(rest)) {
            if (last !== null) for (const name of listed(rest)) add(name, last);
            continue;
        }
        const name = tidy(rest);
        if (name === '') continue;
        const indent = marks.search(/[^\s]/u) === -1 ? marks.length : marks.search(/[^\s]/u);
        const key = indent * 2 + (/[^\s]/u.test(marks) ? 1 : 0);
        while (stack.length > 0 && (stack.at(-1)?.key ?? 0) >= key) stack.pop();
        last = add(name, stack.at(-1)?.path ?? '');
        stack.push({ key, path: last });
        if (folders.length >= MAX_FOLDERS) break;
    }
    return folders.length >= 2 ? folders : null;
}
