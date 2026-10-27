import { strFromU8, unzipSync } from 'fflate';

export interface Run {
    text: string;
    /** Points; null when the file leaves it to the theme. */
    size: number | null;
    bold: boolean;
    italic: boolean;
    color: string | null;
}
export interface Paragraph {
    align: 'left' | 'center' | 'right';
    bullet: boolean;
    runs: Run[];
}
export interface Shape {
    /** All in EMU, as the file stores them. */
    x: number;
    y: number;
    w: number;
    h: number;
    fill: string | null;
    paras: Paragraph[];
    image: string | null;
    /** Title and body placeholders get a default size when the file gives none. */
    role: 'title' | 'body' | 'other';
}
export interface Slide {
    background: string | null;
    shapes: Shape[];
}
export interface Deck {
    width: number;
    height: number;
    slides: Slide[];
    /** Object URLs for the pictures; the caller revokes them. */
    urls: string[];
}

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const parse = (xml: string): Document => new DOMParser().parseFromString(xml, 'application/xml');
const kids = (el: Element, ns: string, name: string): Element[] =>
    [...el.children].filter((c) => c.localName === name && c.namespaceURI === ns);
const first = (el: Element | null | undefined, ns: string, name: string): Element | null =>
    el ? (kids(el, ns, name)[0] ?? null) : null;
const num = (v: string | null | undefined): number | null =>
    v === null || v === undefined || v === '' ? null : Number(v);

const MIME: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
};

/** The relationship targets of one part, by id, resolved against the part's folder. */
function rels(files: Record<string, Uint8Array>, part: string): Record<string, string> {
    const dir = part.slice(0, part.lastIndexOf('/') + 1);
    const relFile = files[`${dir}_rels/${part.slice(dir.length)}.rels`];
    const out: Record<string, string> = {};
    if (!relFile) return out;
    for (const rel of parse(strFromU8(relFile)).getElementsByTagName('Relationship')) {
        const target = rel.getAttribute('Target') ?? '';
        const parts = (target.startsWith('/') ? target.slice(1) : dir + target).split('/');
        const stack: string[] = [];
        for (const p of parts) {
            if (p === '..') stack.pop();
            else if (p !== '.') stack.push(p);
        }
        out[rel.getAttribute('Id') ?? ''] = stack.join('/');
    }
    return out;
}

const colorOf = (el: Element | null | undefined): string | null => {
    const solid = first(el, A, 'solidFill');
    const srgb = solid ? first(solid, A, 'srgbClr') : null;
    return srgb?.getAttribute('val') ? `#${srgb.getAttribute('val')}` : null;
};

interface Frame {
    x: number;
    y: number;
    w: number;
    h: number;
}
const frameOf = (sp: Element): Frame | null => {
    const xfrm = [...sp.getElementsByTagNameNS(A, 'xfrm')][0] ?? null;
    const off = first(xfrm, A, 'off');
    const ext = first(xfrm, A, 'ext');
    if (!off || !ext) return null;
    return {
        x: num(off.getAttribute('x')) ?? 0,
        y: num(off.getAttribute('y')) ?? 0,
        w: num(ext.getAttribute('cx')) ?? 0,
        h: num(ext.getAttribute('cy')) ?? 0,
    };
};
const placeholder = (sp: Element): { type: string; idx: string } | null => {
    const ph = [...sp.getElementsByTagNameNS(P, 'ph')][0];
    return ph
        ? { type: ph.getAttribute('type') ?? 'body', idx: ph.getAttribute('idx') ?? '' }
        : null;
};

/** A placeholder with no position of its own takes the one its layout, then its master, gives that placeholder. */
function inheritedFrame(ph: { type: string; idx: string }, docs: Document[]): Frame | null {
    for (const doc of docs) {
        for (const sp of doc.getElementsByTagNameNS(P, 'sp')) {
            const other = placeholder(sp);
            if (!other) continue;
            const same =
                (ph.idx !== '' && other.idx === ph.idx) ||
                (ph.idx === '' && other.type === ph.type) ||
                (ph.type === 'ctrTitle' && other.type === 'title');
            const frame = same ? frameOf(sp) : null;
            if (frame) return frame;
        }
    }
    return null;
}

function paragraphs(sp: Element): Paragraph[] {
    const body = first(sp, P, 'txBody');
    if (!body) return [];
    return kids(body, A, 'p').map((p) => {
        const pPr = first(p, A, 'pPr');
        const algn = pPr?.getAttribute('algn');
        const runs: Run[] = [];
        for (const r of kids(p, A, 'r')) {
            const rPr = first(r, A, 'rPr');
            const sz = num(rPr?.getAttribute('sz'));
            runs.push({
                text: first(r, A, 't')?.textContent ?? '',
                size: sz === null ? null : sz / 100,
                bold: rPr?.getAttribute('b') === '1',
                italic: rPr?.getAttribute('i') === '1',
                color: colorOf(rPr),
            });
        }
        return {
            align: algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : 'left',
            bullet: Boolean(first(pPr, A, 'buChar')) || Boolean(first(pPr, A, 'buAutoNum')),
            runs,
        };
    });
}

/** Reads a .pptx into shapes with positions, text styling, fills and pictures: a faithful-enough picture of each slide. */
export function readDeck(data: Uint8Array): Deck {
    const files = unzipSync(data);
    const pres = files['ppt/presentation.xml'];
    const size = pres ? parse(strFromU8(pres)).getElementsByTagNameNS(P, 'sldSz')[0] : undefined;
    const width = num(size?.getAttribute('cx')) ?? 9144000;
    const height = num(size?.getAttribute('cy')) ?? 5143500;
    const urls: string[] = [];
    const picture = (path: string | undefined): string | null => {
        const bytes = path ? files[path] : undefined;
        if (!bytes || !path) return null;
        const type = MIME[path.split('.').pop()?.toLowerCase() ?? ''];
        if (!type || type === 'image/svg+xml') return null;
        const url = URL.createObjectURL(new Blob([bytes], { type }));
        urls.push(url);
        return url;
    };

    const slideFiles = Object.keys(files)
        .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
        .sort((a, b) => Number(/(\d+)\.xml/.exec(a)?.[1]) - Number(/(\d+)\.xml/.exec(b)?.[1]));
    const slides = slideFiles.map((file): Slide => {
        const doc = parse(strFromU8(files[file] as Uint8Array));
        const links = rels(files, file);
        const layoutPath = Object.values(links).find((t) => t.includes('slideLayouts/'));
        const layoutDoc =
            layoutPath && files[layoutPath] ? parse(strFromU8(files[layoutPath])) : null;
        const masterPath = layoutPath
            ? Object.values(rels(files, layoutPath)).find((t) => t.includes('slideMasters/'))
            : undefined;
        const masterDoc =
            masterPath && files[masterPath] ? parse(strFromU8(files[masterPath])) : null;
        const chain = [layoutDoc, masterDoc].filter((d): d is Document => d !== null);

        const bg = doc.getElementsByTagNameNS(P, 'bg')[0];
        const bgFill = bg ? colorOf(bg.getElementsByTagNameNS(P, 'bgPr')[0]) : null;
        const shapes: Shape[] = [];
        const tree = doc.getElementsByTagNameNS(P, 'spTree')[0];
        for (const el of tree ? [...tree.children] : []) {
            if (el.localName === 'sp') {
                const ph = placeholder(el);
                const role0 = ph ? (/^(title|ctrTitle)$/.test(ph.type) ? 'title' : 'body') : 'other';
                // No position anywhere in the file (generated decks): title on top, the rest below it.
                const fallback: Frame =
                    role0 === 'title'
                        ? { x: width * 0.06, y: height * 0.06, w: width * 0.88, h: height * 0.2 }
                        : { x: width * 0.06, y: height * 0.3, w: width * 0.88, h: height * 0.6 };
                const frame = frameOf(el) ?? (ph ? inheritedFrame(ph, chain) : null) ?? fallback;
                const spPr = first(el, P, 'spPr');
                const role = ph ? (/^(title|ctrTitle)$/.test(ph.type) ? 'title' : 'body') : 'other';
                shapes.push({
                    ...frame,
                    fill: colorOf(spPr),
                    paras: paragraphs(el),
                    image: null,
                    role,
                });
            } else if (el.localName === 'pic') {
                const frame = frameOf(el);
                const embed = [...el.getElementsByTagNameNS(A, 'blip')][0]?.getAttributeNS(
                    R,
                    'embed',
                );
                if (frame)
                    shapes.push({
                        ...frame,
                        fill: null,
                        paras: [],
                        image: picture(links[embed ?? '']),
                        role: 'other',
                    });
            }
        }
        return { background: bgFill, shapes };
    });
    return { width, height, slides, urls };
}
