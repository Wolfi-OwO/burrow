import CFB from 'cfb';

/** Plain-text readers for the old binary Office formats (.doc, .ppt), which are OLE containers, not zips. */

const readU16 = (b: Uint8Array, at: number): number => (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8);
const readU32 = (b: Uint8Array, at: number): number =>
    ((b[at] ?? 0) |
        ((b[at + 1] ?? 0) << 8) |
        ((b[at + 2] ?? 0) << 16) |
        ((b[at + 3] ?? 0) << 24)) >>>
    0;

function stream(file: Uint8Array, path: string): Uint8Array | null {
    const container = CFB.read(file, { type: 'array' });
    const entry = CFB.find(container, path);
    return entry?.content ? new Uint8Array(entry.content as ArrayLike<number>) : null;
}

/** Strips Word's control characters: cell and row marks become tabs and breaks, field codes and anchors vanish. */
function tidy(text: string): string {
    return text
        .replace(/\u0013[^\u0014\u0015]*\u0014?/g, '')
        .replace(/[\u0001\u0002\u0005\u0008\u0015]/g, '')
        .replace(/\u0007/g, '\t')
        .replace(/[\r\u000b\u000c]/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/** Printable runs of a byte stream, either 8-bit or UTF-16: the fallback when the text is stored in pieces. */
function printableRuns(bytes: Uint8Array): string {
    const wide = bytes.slice(0, 4000).filter((b) => b === 0).length > 600;
    const decoded = new TextDecoder(wide ? 'utf-16le' : 'windows-1252').decode(bytes);
    return decoded
        .split(/[^\p{L}\p{N}\p{P}\p{S}\s]+/u)
        .filter((run) => run.trim().length >= 4)
        .join('\n');
}

/** The text of a .doc: the body range named in the file header, or its readable runs when it is stored in pieces. */
export function docText(file: Uint8Array): string | null {
    const word = stream(file, '/WordDocument');
    if (!word || readU16(word, 0) !== 0xa5ec) return null;
    const flags = readU16(word, 0x0a);
    const complex = (flags & 0x0004) !== 0;
    const start = readU32(word, 0x18);
    const end = readU32(word, 0x1c);
    if (!complex && end > start && end <= word.length) {
        const body = word.slice(start, end);
        const wide =
            (flags & 0x1000) !== 0 || body.slice(0, 2000).filter((b) => b === 0).length > 400;
        return tidy(new TextDecoder(wide ? 'utf-16le' : 'windows-1252').decode(body));
    }
    return tidy(printableRuns(word));
}

/** The text of every slide in a .ppt, from its text atoms. */
export function pptSlides(file: Uint8Array): string[] | null {
    const data = stream(file, '/PowerPoint Document');
    if (!data) return null;
    const slides: string[][] = [];
    const SLIDE = 0x03ee;
    const TEXT_CHARS = 0x0fa0;
    const TEXT_BYTES = 0x0fa8;
    const NOTES = 0x03f0;
    let ignoring = true; // text on the master slide and on notes pages is not slide content

    const walk = (from: number, to: number): void => {
        let at = from;
        while (at + 8 <= to) {
            const container = (readU16(data, at) & 0x0f) === 0x0f;
            const type = readU16(data, at + 2);
            const length = readU32(data, at + 4);
            const body = at + 8;
            if (length > to - body) return;
            if (type === SLIDE) {
                slides.push([]);
                ignoring = false;
            } else if (type === NOTES) ignoring = true;
            if (container) walk(body, body + length);
            else if (type === TEXT_CHARS || type === TEXT_BYTES) {
                const raw = data.slice(body, body + length);
                const text = new TextDecoder(type === TEXT_CHARS ? 'utf-16le' : 'windows-1252')
                    .decode(raw)
                    .replace(/[\r\u000b]/g, '\n')
                    .trim();
                if (text && !ignoring) slides.at(-1)?.push(text);
            }
            at = body + length;
        }
    };
    walk(0, data.length);
    return slides.map((s) => s.join('\n'));
}
