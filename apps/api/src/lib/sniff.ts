import { open } from 'node:fs/promises';

/**
 * A guess at the type from the first bytes, for files that arrive without an extension or as a generic type
 * (a name like "media-5" says nothing). Only the common kinds people file are recognised; null means "no idea".
 */
export async function sniffMime(path: string): Promise<string | null> {
    const handle = await open(path, 'r');
    try {
        const buf = Buffer.alloc(16);
        const { bytesRead } = await handle.read(buf, 0, 16, 0);
        const head = buf.subarray(0, bytesRead);
        const ascii = head.toString('latin1');
        if (ascii.startsWith('%PDF')) return 'application/pdf';
        if (ascii.startsWith('PK\u0003\u0004')) return 'application/zip';
        if (ascii.startsWith('ID3') || (head[0] === 0xff && ((head[1] ?? 0) & 0xe0) === 0xe0))
            return 'audio/mpeg';
        if (ascii.startsWith('OggS')) return 'audio/ogg';
        if (ascii.startsWith('fLaC')) return 'audio/flac';
        if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WAVE') return 'audio/wav';
        if (ascii.slice(4, 8) === 'ftyp') return 'video/mp4';
        if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3)
            return 'video/webm';
        if (head[0] === 0x37 && head[1] === 0x7a && head[2] === 0xbc && head[3] === 0xaf)
            return 'application/x-7z-compressed';
        if (ascii.startsWith('Rar!')) return 'application/vnd.rar';
        if (ascii.startsWith('\u001f\u008b')) return 'application/gzip';
        return null;
    } finally {
        await handle.close();
    }
}
