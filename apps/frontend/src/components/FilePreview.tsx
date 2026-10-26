import { Download, FileText } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { fetchBlob } from '../lib/api.ts';
import { formatBytes } from '../lib/format.ts';
import type { GeoData } from '../lib/geo.ts';
import { GeoPreview } from './GeoPreview.tsx';
import { Spinner } from './ui.tsx';

/** How much of a text file is shown; the rest is one Download away. */
const TEXT_LIMIT = 400_000;
const SHEET_ROWS = 300;

const TEXT_EXT =
    /\.(txt|md|markdown|json|jsonl|csv|tsv|log|xml|yml|yaml|ini|toml|cfg|conf|env|js|mjs|ts|tsx|jsx|py|java|kt|c|h|cpp|hpp|cs|go|rs|rb|php|sh|bash|zsh|sql|css|scss|html|htm|svg|tex|rtf|srt|vtt|gitignore)$/i;

/** Files shown as highlighted source; the language is the extension, which highlight.js knows by name or alias. */
const CODE_EXT =
    /\.(json|jsonl|xml|ya?ml|toml|ini|js|mjs|cjs|ts|tsx|jsx|py|java|kt|c|h|cpp|hpp|cs|go|rs|rb|php|sh|bash|zsh|sql|css|scss|html?|svg|swift|lua|r|pl|dart|gradle|dockerfile|makefile|vue|svelte)$/i;

type Kind =
    | 'pdf'
    | 'text'
    | 'csv'
    | 'docx'
    | 'xlsx'
    | 'pptx'
    | 'doc'
    | 'xls'
    | 'ppt'
    | 'odf'
    | 'zip'
    | 'geo'
    | 'markdown'
    | 'code'
    | 'audio'
    | 'video'
    | 'other';

/** What a file is, from its name first (browsers often send a generic type for Office files) and its type second. */
export function kindOf(name: string, mime: string): Kind {
    const n = name.toLowerCase();
    if (mime === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
    if (n.endsWith('.docx') || n.endsWith('.docm')) return 'docx';
    if (n.endsWith('.xlsx') || n.endsWith('.xlsm')) return 'xlsx';
    if (n.endsWith('.pptx') || n.endsWith('.pptm')) return 'pptx';
    if (n.endsWith('.doc') || n.endsWith('.dot')) return 'doc';
    if (n.endsWith('.xls') || n.endsWith('.xlt')) return 'xls';
    if (n.endsWith('.ppt') || n.endsWith('.pps')) return 'ppt';
    if (/\.(odt|ods|odp)$/.test(n)) return 'odf';
    if (/\.(csv|tsv)$/.test(n)) return 'csv';
    if (/\.(gpx|tcx|kml|geojson)$/.test(n)) return 'geo';
    if (/\.(md|markdown)$/.test(n)) return 'markdown';
    if (n.endsWith('.zip') || mime === 'application/zip') return 'zip';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime.startsWith('video/')) return 'video';
    if (CODE_EXT.test(n) || mime === 'application/json') return 'code';
    if (mime.startsWith('text/') || TEXT_EXT.test(n) || mime === 'application/json') return 'text';
    return 'other';
}

/** True for everything the viewer can show beyond the plain "no preview" card. */
export const previewable = (name: string, mime: string): boolean =>
    mime.startsWith('image/') || kindOf(name, mime) !== 'other';

type Loaded =
    | { kind: 'url'; url: string }
    | { kind: 'text'; text: string; truncated: boolean }
    | { kind: 'html'; html: string }
    | { kind: 'code'; html: string; truncated: boolean }
    | { kind: 'geo'; data: GeoData }
    | { kind: 'table'; sheets: { name: string; rows: string[][] }[] }
    | { kind: 'slides'; slides: string[] }
    | { kind: 'list'; entries: { name: string; size: number }[] }
    | { kind: 'none'; reason: string };

const cell = (v: unknown): string =>
    v === null || v === undefined ? '' : v instanceof Date ? v.toLocaleDateString() : String(v);

/** Parses delimiter-separated text, honouring quotes. */
function parseDelimited(text: string, delimiter: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i] as string;
        if (quoted) {
            if (c === '"' && text[i + 1] === '"') {
                field += '"';
                i += 1;
            } else if (c === '"') quoted = false;
            else field += c;
        } else if (c === '"') quoted = true;
        else if (c === delimiter) {
            row.push(field);
            field = '';
        } else if (c === '\n' || c === '\r') {
            if (c === '\r' && text[i + 1] === '\n') i += 1;
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
            if (rows.length >= SHEET_ROWS) return rows;
        } else field += c;
    }
    if (field !== '' || row.length > 0) rows.push([...row, field]);
    return rows;
}

const textOf = (xml: string, tag: RegExp): string =>
    [...xml.matchAll(tag)].map((m) => (m[1] ?? '').replace(/<[^>]+>/g, '')).join(' ');

async function load(path: string, name: string, mime: string, kind: Kind): Promise<Loaded> {
    const blob = await fetchBlob(path);
    switch (kind) {
        case 'pdf': {
            const head = new TextDecoder().decode(await blob.slice(0, 5).arrayBuffer());
            if (!head.startsWith('%PDF'))
                return { kind: 'none', reason: 'This file is not a valid PDF.' };
            // The type is set here, not taken from the upload, so the browser can only ever treat it as a PDF.
            return {
                kind: 'url',
                url: URL.createObjectURL(new Blob([blob], { type: 'application/pdf' })),
            };
        }
        case 'audio':
        case 'video':
            return { kind: 'url', url: URL.createObjectURL(new Blob([blob], { type: mime })) };
        case 'geo': {
            const { parseGeo } = await import('../lib/geo.ts');
            return { kind: 'geo', data: parseGeo(await blob.text(), name) };
        }
        case 'markdown': {
            const [{ marked }, { default: DOMPurify }] = await Promise.all([
                import('marked'),
                import('dompurify'),
            ]);
            const text = await blob.slice(0, TEXT_LIMIT).text();
            return { kind: 'html', html: DOMPurify.sanitize(await marked.parse(text)) };
        }
        case 'code': {
            const [{ default: hljs }, { default: DOMPurify }] = await Promise.all([
                import('highlight.js/lib/common'),
                import('dompurify'),
            ]);
            let text = await blob.slice(0, TEXT_LIMIT).text();
            const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase();
            if (ext === 'json') {
                try {
                    if (blob.size <= TEXT_LIMIT) text = JSON.stringify(JSON.parse(text), null, 2);
                } catch {
                    // not valid JSON: shown as it is
                }
            }
            const language = hljs.getLanguage(ext) ? ext : undefined;
            const out = language ? hljs.highlight(text, { language }) : hljs.highlightAuto(text);
            return {
                kind: 'code',
                html: DOMPurify.sanitize(out.value),
                truncated: blob.size > TEXT_LIMIT,
            };
        }
        case 'text': {
            const text = await blob.slice(0, TEXT_LIMIT).text();
            return { kind: 'text', text, truncated: blob.size > TEXT_LIMIT };
        }
        case 'csv': {
            const text = await blob.slice(0, TEXT_LIMIT).text();
            const tab = name.toLowerCase().endsWith('.tsv');
            return {
                kind: 'table',
                sheets: [
                    {
                        name,
                        rows: parseDelimited(
                            text,
                            tab ? '\t' : text.split('\n', 1)[0]?.includes(';') ? ';' : ',',
                        ),
                    },
                ],
            };
        }
        case 'docx': {
            const [{ default: mammoth }, { default: DOMPurify }] = await Promise.all([
                import('mammoth'),
                import('dompurify'),
            ]);
            const result = await mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() });
            return { kind: 'html', html: DOMPurify.sanitize(result.value) };
        }
        case 'xlsx': {
            const { default: readExcelFile } = await import('read-excel-file/browser');
            const sheets = (await readExcelFile(blob)) as unknown as {
                sheet: string;
                data: unknown[][];
            }[];
            return {
                kind: 'table',
                sheets: sheets.slice(0, 12).map((s) => ({
                    name: s.sheet,
                    rows: s.data.slice(0, SHEET_ROWS).map((r) => r.map(cell)),
                })),
            };
        }
        case 'doc': {
            const { docText } = await import('../lib/legacy-office.ts');
            const text = docText(new Uint8Array(await blob.arrayBuffer()));
            return text === null
                ? { kind: 'none', reason: 'No readable text in this Word document.' }
                : {
                      kind: 'text',
                      text: text.slice(0, TEXT_LIMIT),
                      truncated: text.length > TEXT_LIMIT,
                  };
        }
        case 'ppt': {
            const { pptSlides } = await import('../lib/legacy-office.ts');
            const slides = pptSlides(new Uint8Array(await blob.arrayBuffer()));
            return slides === null
                ? { kind: 'none', reason: 'No readable slides in this presentation.' }
                : { kind: 'slides', slides };
        }
        case 'xls': {
            const XLSX = await import('xlsx');
            const book = XLSX.read(await blob.arrayBuffer(), { type: 'array' });
            return {
                kind: 'table',
                sheets: book.SheetNames.slice(0, 12).map((sheetName) => ({
                    name: sheetName,
                    rows: (
                        XLSX.utils.sheet_to_json(book.Sheets[sheetName] as object, {
                            header: 1,
                            raw: false,
                            defval: '',
                        }) as unknown[][]
                    )
                        .slice(0, SHEET_ROWS)
                        .map((r) => r.map(cell)),
                })),
            };
        }
        case 'pptx':
        case 'odf': {
            const { unzipSync, strFromU8 } = await import('fflate');
            const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
            if (kind === 'pptx') {
                const slides = Object.keys(files)
                    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
                    .sort(
                        (a, b) =>
                            Number(/(\d+)\.xml/.exec(a)?.[1]) - Number(/(\d+)\.xml/.exec(b)?.[1]),
                    )
                    .map((f) =>
                        textOf(strFromU8(files[f] as Uint8Array), /<a:t>([\s\S]*?)<\/a:t>/g),
                    );
                return { kind: 'slides', slides };
            }
            const content = files['content.xml'];
            if (!content) return { kind: 'none', reason: 'No readable content in this document.' };
            const xml = strFromU8(content);
            const text = xml
                .replace(/<text:(p|h)[^>]*>/g, '\n')
                .replace(/<table:table-cell[^>]*>/g, ' \t')
                .replace(/<[^>]+>/g, '')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .trim();
            return {
                kind: 'text',
                text: text.slice(0, TEXT_LIMIT),
                truncated: text.length > TEXT_LIMIT,
            };
        }
        case 'zip':
            return { kind: 'list', entries: await listZip(blob) };
        default:
            return { kind: 'none', reason: 'There is no preview for this kind of file.' };
    }
}

/** The entries of a zip from its central directory, without unpacking anything. */
async function listZip(blob: Blob): Promise<{ name: string; size: number }[]> {
    const data = new DataView(await blob.arrayBuffer());
    let end = data.byteLength - 22;
    while (end >= 0 && data.getUint32(end, true) !== 0x06054b50) end -= 1;
    if (end < 0) return [];
    const count = data.getUint16(end + 10, true);
    let pos = data.getUint32(end + 16, true);
    const entries: { name: string; size: number }[] = [];
    for (let i = 0; i < Math.min(count, 500); i++) {
        if (data.getUint32(pos, true) !== 0x02014b50) break;
        const size = data.getUint32(pos + 24, true);
        const nameLength = data.getUint16(pos + 28, true);
        const extra = data.getUint16(pos + 30, true);
        const comment = data.getUint16(pos + 32, true);
        const name = new TextDecoder().decode(new Uint8Array(data.buffer, pos + 46, nameLength));
        if (!name.endsWith('/')) entries.push({ name, size });
        pos += 46 + nameLength + extra + comment;
    }
    return entries;
}

/** Shows a file's contents inside the page: documents, spreadsheets, slides, PDFs, text, audio and video. */
export function FilePreview({
    path,
    name,
    mime,
    size,
    onDownload,
}: {
    path: string;
    name: string;
    mime: string;
    size: number;
    onDownload?: () => void;
}): ReactNode {
    const kind = kindOf(name, mime);
    const [state, setState] = useState<Loaded | 'loading' | 'failed'>('loading');
    const [sheet, setSheet] = useState(0);
    useEffect(() => {
        let live = true;
        let url: string | null = null;
        setState('loading');
        setSheet(0);
        load(path, name, mime, kind).then(
            (loaded) => {
                if (!live) return;
                if (loaded.kind === 'url') url = loaded.url;
                setState(loaded);
            },
            () => live && setState('failed'),
        );
        return () => {
            live = false;
            if (url) URL.revokeObjectURL(url);
        };
    }, [path, name, mime, kind]);

    const fallback = (reason: string): ReactNode => (
        <div className="preview-none">
            <FileText size={40} aria-hidden="true" />
            <strong>{name}</strong>
            <span className="muted small">
                {mime} · {formatBytes(size)}
            </span>
            <p className="muted">{reason}</p>
            {onDownload ? (
                <button className="btn" onClick={onDownload}>
                    <Download size={16} />
                    Download
                </button>
            ) : null}
        </div>
    );

    if (state === 'loading')
        return (
            <p className="muted" style={{ padding: 24 }}>
                <Spinner /> Preparing the preview
            </p>
        );
    if (state === 'failed')
        return fallback(
            'This file could not be opened for a preview. It may be damaged or password protected.',
        );
    switch (state.kind) {
        case 'url':
            return kind === 'pdf' ? (
                <iframe className="preview-frame" title={name} src={state.url} />
            ) : kind === 'audio' ? (
                <audio controls src={state.url} style={{ width: 'min(520px, 90%)' }} />
            ) : (
                <video controls src={state.url} className="preview-video" />
            );
        case 'text':
            return (
                <div className="preview-doc">
                    <pre className="preview-text">{state.text}</pre>
                    {state.truncated ? (
                        <p className="muted small">Showing the first part of the file.</p>
                    ) : null}
                </div>
            );
        case 'geo':
            return <GeoPreview data={state.data} />;
        case 'code':
            return (
                <div className="preview-doc wide">
                    <pre className="preview-text hljs">
                        <code dangerouslySetInnerHTML={{ __html: state.html }} />
                    </pre>
                    {state.truncated ? (
                        <p className="muted small">Showing the first part of the file.</p>
                    ) : null}
                </div>
            );
        case 'html':
            return (
                <div className="preview-doc">
                    <article
                        className="preview-prose"
                        dangerouslySetInnerHTML={{ __html: state.html }}
                    />
                </div>
            );
        case 'table': {
            const current = state.sheets[sheet] ?? state.sheets[0];
            return (
                <div className="preview-doc wide">
                    {state.sheets.length > 1 ? (
                        <div className="segmented sheets" role="tablist" aria-label="Sheets">
                            {state.sheets.map((s, i) => (
                                <button
                                    key={s.name}
                                    type="button"
                                    role="tab"
                                    aria-selected={i === sheet}
                                    aria-checked={i === sheet}
                                    onClick={() => setSheet(i)}
                                >
                                    {s.name}
                                </button>
                            ))}
                        </div>
                    ) : null}
                    <div className="preview-table-wrap">
                        <table className="preview-table">
                            <tbody>
                                {(current?.rows ?? []).map((row, r) => (
                                    <tr key={r}>
                                        <th scope="row">{r + 1}</th>
                                        {row.map((c, i) => (
                                            <td key={i}>{c}</td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {(current?.rows.length ?? 0) >= SHEET_ROWS ? (
                        <p className="muted small">Showing the first {SHEET_ROWS} rows.</p>
                    ) : null}
                </div>
            );
        }
        case 'slides':
            return (
                <div className="preview-doc">
                    {state.slides.map((s, i) => (
                        <section key={i} className="preview-slide">
                            <span className="muted small">Slide {i + 1}</span>
                            <p>{s || '(no text on this slide)'}</p>
                        </section>
                    ))}
                </div>
            );
        case 'list':
            return (
                <div className="preview-doc">
                    <ul className="preview-list">
                        {state.entries.map((e) => (
                            <li key={e.name}>
                                <span>{e.name}</span>
                                <span className="muted small">{formatBytes(e.size)}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            );
        default:
            return fallback(
                state.kind === 'none' ? state.reason : 'There is no preview for this kind of file.',
            );
    }
}
