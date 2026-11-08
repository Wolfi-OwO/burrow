import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Just enough of the S3 API for the blob store: path-style single and multipart PUT, GET, HEAD and DELETE of objects.
 * It stands in for Backblaze B2 in tests, so the real client (retries, multipart, checksum settings) is what runs.
 */
export class FakeS3 {
    readonly objects = new Map<string, Buffer>();
    readonly calls: string[] = [];
    /** Requests currently being answered, for tests that need two reads to overlap. */
    gets = 0;
    private readonly uploads = new Map<string, Map<number, Buffer>>();
    private server: Server | undefined;
    delayGetMs = 0;

    async start(): Promise<string> {
        this.server = createServer((req, res) => {
            void this.handle(req, res).catch(() => {
                res.statusCode = 500;
                res.end();
            });
        });
        await new Promise<void>((resolve) => this.server?.listen(0, '127.0.0.1', resolve));
        return `http://127.0.0.1:${String((this.server?.address() as AddressInfo).port)}`;
    }

    async stop(): Promise<void> {
        await new Promise<void>((resolve) => this.server?.close(() => resolve()));
    }

    private static body(req: IncomingMessage): Promise<Buffer> {
        return new Promise((resolve) => {
            const chunks: Buffer[] = [];
            req.on('data', (c: Buffer) => chunks.push(c));
            req.on('end', () => {
                let data = Buffer.concat(chunks);
                // The SDK frames a streamed body as aws-chunked when it signs it: size;signature\r\n data \r\n ... 0\r\n
                if (
                    String(req.headers['content-encoding'] ?? '').includes('aws-chunked') ||
                    String(req.headers['x-amz-content-sha256'] ?? '').startsWith('STREAMING')
                ) {
                    const parts: Buffer[] = [];
                    let at = 0;
                    for (;;) {
                        const eol = data.indexOf('\r\n', at);
                        if (eol === -1) break;
                        const size = parseInt(
                            data.subarray(at, eol).toString().split(';')[0] ?? '0',
                            16,
                        );
                        if (!Number.isFinite(size) || size === 0) break;
                        parts.push(data.subarray(eol + 2, eol + 2 + size));
                        at = eol + 2 + size + 2;
                    }
                    data = Buffer.concat(parts);
                }
                resolve(data);
            });
        });
    }

    private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const url = new URL(req.url ?? '/', 'http://x');
        const key = decodeURIComponent(url.pathname.split('/').slice(2).join('/'));
        const method = req.method ?? 'GET';
        this.calls.push(`${method} ${key}${url.search}`);

        if (method === 'POST' && url.searchParams.has('uploads')) {
            const id = `up-${String(this.uploads.size + 1)}`;
            this.uploads.set(id, new Map());
            res.setHeader('content-type', 'application/xml');
            res.end(
                `<?xml version="1.0"?><InitiateMultipartUploadResult><Bucket>b</Bucket><Key>${key}</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`,
            );
            return;
        }
        if (method === 'PUT' && url.searchParams.has('partNumber')) {
            const parts = this.uploads.get(url.searchParams.get('uploadId') ?? '');
            const data = await FakeS3.body(req);
            parts?.set(Number(url.searchParams.get('partNumber')), data);
            res.setHeader('etag', `"part-${url.searchParams.get('partNumber') ?? ''}"`);
            res.end();
            return;
        }
        if (method === 'POST' && url.searchParams.has('uploadId')) {
            await FakeS3.body(req);
            const parts = this.uploads.get(url.searchParams.get('uploadId') ?? '') ?? new Map();
            const ordered = [...parts.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
            this.objects.set(key, Buffer.concat(ordered));
            res.setHeader('content-type', 'application/xml');
            res.end(
                `<?xml version="1.0"?><CompleteMultipartUploadResult><Key>${key}</Key><ETag>"done"</ETag></CompleteMultipartUploadResult>`,
            );
            return;
        }
        if (method === 'PUT') {
            this.objects.set(key, await FakeS3.body(req));
            res.setHeader('etag', '"single"');
            res.end();
            return;
        }
        if (method === 'HEAD' || method === 'GET') {
            const object = this.objects.get(key);
            if (!object) {
                res.statusCode = 404;
                res.setHeader('content-type', 'application/xml');
                res.end(
                    method === 'HEAD'
                        ? undefined
                        : '<?xml version="1.0"?><Error><Code>NoSuchKey</Code><Message>missing</Message></Error>',
                );
                return;
            }
            res.setHeader('content-length', String(object.length));
            if (method === 'HEAD') {
                res.end();
                return;
            }
            this.gets += 1;
            if (this.delayGetMs > 0) await new Promise((r) => setTimeout(r, this.delayGetMs));
            // Sent in pieces so a reader can walk away part-way.
            for (let i = 0; i < object.length; i += 4096) {
                if (!res.write(object.subarray(i, i + 4096)))
                    await new Promise((r) => res.once('drain', r));
            }
            res.end();
            return;
        }
        if (method === 'DELETE') {
            this.objects.delete(key);
            res.statusCode = 204;
            res.end();
            return;
        }
        res.statusCode = 400;
        res.end();
    }
}
