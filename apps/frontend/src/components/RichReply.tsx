import { ArrowRight, Folder, FolderOpen } from 'lucide-react';
import type { ReactNode } from 'react';

import { parseBlocks, parseTree } from '../lib/rich-reply.ts';
import type { TreeNode } from '../lib/rich-reply.ts';

/**
 * What the assistant writes is plain text with three shapes the page draws properly: a fenced `tree` block (two
 * spaces per level, an optional count in brackets), a fenced `flow` block (one chain per line, steps joined by `->`)
 * and `- ` lists. Nothing else is interpreted, and nothing becomes HTML, so a reply can never inject markup.
 */
function TreeNodes({ nodes }: { nodes: TreeNode[] }): ReactNode {
    return (
        <ul className="rich-tree">
            {nodes.map((n, i) => (
                <li key={`${n.name}-${String(i)}`}>
                    <span className="rich-node">
                        {n.children.length > 0 ? (
                            <FolderOpen size={14} aria-hidden="true" />
                        ) : (
                            <Folder size={14} aria-hidden="true" />
                        )}
                        <span>{n.name}</span>
                        {n.count !== null ? <small>{n.count}</small> : null}
                    </span>
                    {n.children.length > 0 ? <TreeNodes nodes={n.children} /> : null}
                </li>
            ))}
        </ul>
    );
}

function Flow({ lines }: { lines: string[] }): ReactNode {
    return (
        <div className="rich-flow">
            {lines
                .filter((l) => l.trim() !== '')
                .map((line, row) => (
                    <div className="rich-chain" key={`${line}-${String(row)}`}>
                        {line.split(/\s*(?:->|→|=>)\s*/).map((step, i) => (
                            <span className="rich-step-wrap" key={`${step}-${String(i)}`}>
                                {i > 0 ? <ArrowRight size={14} aria-hidden="true" /> : null}
                                <span className="rich-step">{step.trim()}</span>
                            </span>
                        ))}
                    </div>
                ))}
        </div>
    );
}

/** "- a", "  - b" lines as a nested list; the rest as paragraphs. */
function TextLines({ lines }: { lines: string[] }): ReactNode {
    const out: ReactTreeNode[] = [];
    let items: { depth: number; text: string }[] = [];
    const flush = (): void => {
        if (items.length === 0) return;
        const base = Math.min(...items.map((i) => i.depth));
        const nodes: TreeNode[] = parseTree(
            items.map((i) => `${' '.repeat((i.depth - base) * 2)}${i.text}`),
        );
        out.push(<TextList key={`l${String(out.length)}`} nodes={nodes} />);
        items = [];
    };
    for (const line of lines) {
        const item = /^(\s*)[-*•]\s+(.*)$/.exec(line);
        if (item) {
            items.push({ depth: Math.floor((item[1] ?? '').length / 2), text: item[2] ?? '' });
            continue;
        }
        flush();
        if (line.trim() !== '') out.push(<p key={`p${String(out.length)}`}>{line}</p>);
    }
    flush();
    return <>{out}</>;
}

function TextList({ nodes }: { nodes: TreeNode[] }): ReactNode {
    return (
        <ul className="rich-list">
            {nodes.map((n, i) => (
                <li key={`${n.name}-${String(i)}`}>
                    {n.name}
                    {n.count !== null ? ` (${n.count})` : ''}
                    {n.children.length > 0 ? <TextList nodes={n.children} /> : null}
                </li>
            ))}
        </ul>
    );
}

export function RichReply({ text }: { text: string }): ReactNode {
    return (
        <>
            {parseBlocks(text).map((b, i) =>
                b.kind === 'tree' ? (
                    <TreeNodes key={i} nodes={parseTree(b.lines)} />
                ) : b.kind === 'flow' ? (
                    <Flow key={i} lines={b.lines} />
                ) : b.kind === 'code' ? (
                    <pre key={i} className="rich-code">
                        {b.lines.join('\n')}
                    </pre>
                ) : (
                    <TextLines key={i} lines={b.lines} />
                ),
            )}
        </>
    );
}
