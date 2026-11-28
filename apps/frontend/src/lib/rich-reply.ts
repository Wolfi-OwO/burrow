/** Parsing of the assistant's replies: fenced tree and flow blocks, and indented lists. */
export type Block =
    | { kind: 'text'; lines: string[] }
    | { kind: 'tree'; lines: string[] }
    | { kind: 'flow'; lines: string[] }
    | { kind: 'code'; lines: string[] };

/** Splits on ``` fences. A fence still open (the reply is being written) takes the rest of the text. */
export function parseBlocks(text: string): Block[] {
    const blocks: Block[] = [];
    let current: Block = { kind: 'text', lines: [] };
    for (const line of text.split('\n')) {
        const fence = /^\s*```\s*([a-z]*)\s*$/i.exec(line);
        if (fence) {
            if (current.kind === 'text') {
                if (current.lines.some((l) => l.trim() !== '')) blocks.push(current);
                const name = (fence[1] ?? '').toLowerCase();
                current = { kind: name === 'tree' || name === 'flow' ? name : 'code', lines: [] };
            } else {
                blocks.push(current);
                current = { kind: 'text', lines: [] };
            }
            continue;
        }
        current.lines.push(line);
    }
    if (current.lines.some((l) => l.trim() !== '')) blocks.push(current);
    return blocks;
}

export interface TreeNode {
    name: string;
    count: string | null;
    children: TreeNode[];
}

/** Indented lines become a forest; a line indented deeper than the one before it is that one's child. */
export function parseTree(lines: string[]): TreeNode[] {
    const roots: TreeNode[] = [];
    const stack: { depth: number; node: TreeNode }[] = [];
    for (const raw of lines) {
        if (raw.trim() === '') continue;
        const indent = /^[\s│├└─|`'-]*/.exec(raw.replace(/\t/g, '  '))?.[0].length ?? 0;
        const body = raw
            .slice(raw.length - raw.trimStart().length)
            .replace(/^[│├└─|`'\-+*\s]+/, '');
        const match = /^(.*?)\s*(?:\((\d+)\)|:\s*(\d+))\s*$/.exec(body);
        const node: TreeNode = {
            name: (match?.[1] ?? body).trim(),
            count: match?.[2] ?? match?.[3] ?? null,
            children: [],
        };
        while (stack.length > 0 && (stack[stack.length - 1] as { depth: number }).depth >= indent)
            stack.pop();
        const parent = stack[stack.length - 1]?.node;
        (parent ? parent.children : roots).push(node);
        stack.push({ depth: indent, node });
    }
    return roots;
}
