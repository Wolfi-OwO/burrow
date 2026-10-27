import type { ReactNode } from 'react';

import { kindOf } from './FilePreview.tsx';

/** Colour per kind of file, so a Word file, a sheet and a route stop looking alike. Brand colours where one exists. */
const TINT: Record<string, string> = {
    docx: '#2b579a',
    doc: '#2b579a',
    xlsx: '#1d7a46',
    xls: '#1d7a46',
    csv: '#1d7a46',
    pptx: '#c43e1c',
    ppt: '#c43e1c',
    odf: '#0e85cd',
    pdf: '#d93025',
    zip: '#a16207',
    audio: '#db2777',
    video: '#0891b2',
    geo: '#0d9488',
    code: '#7c3aed',
    markdown: '#475569',
    text: '#64748b',
    other: '#71717a',
};

/** A page with a folded corner in the kind's colour and the extension on it. */
export function TypeIcon({
    name,
    mime,
    size = 56,
}: {
    name: string;
    mime: string;
    size?: number;
}): ReactNode {
    const kind = kindOf(name, mime);
    const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toUpperCase().slice(0, 4);
    const tint = TINT[kind] ?? TINT.other;
    return (
        <svg
            width={size}
            height={(size * 4) / 3}
            viewBox="0 0 48 64"
            role="img"
            aria-label={ext || 'file'}
            className="type-icon"
        >
            <path d="M6 2h26l12 12v46a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" fill={tint} />
            <path d="M32 2l12 12H34a2 2 0 0 1-2-2V2Z" fill="#fff" opacity="0.35" />
            <text
                x="24"
                y="46"
                textAnchor="middle"
                fontSize={ext.length > 3 ? 11 : 13}
                fontWeight="700"
                fontFamily="Geist Variable, system-ui, sans-serif"
                fill="#fff"
            >
                {ext}
            </text>
        </svg>
    );
}
