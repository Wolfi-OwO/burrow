import { createWriteStream } from 'node:fs';
import { lookup } from 'node:dns/promises';
import type { IncomingMessage } from 'node:http';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { tidyFileName } from './file-name.ts';

/**
 * Downloads a file from a link a user typed in. That is a request the server makes on someone else's behalf, so the
 * address it reaches is the whole security question: a link must never be able to point at this machine, the docker
 * network, a cloud metadata address or anything else on a private range. The rules:
 *
 *  - only http and https, only ports 80 and 443, no user name or password in the link;
 *  - the host name is resolved here and EVERY address it resolves to must be public;
 *  - the connection is then made to that checked address (the host name only goes into the Host header and the TLS
 *    name), so the name cannot resolve to something else between the check and the connection;
 *  - every redirect is checked again from scratch, and https may not fall back to http;
 *  - a size cap, a connect timeout and a stall timeout bound what one link can cost.
 */

/** A refusal whose message is safe to show to the person who sent the link. */
export class LinkRefused extends Error {
    public constructor(message: string) {
        super(message);
        this.name = 'LinkRefused';
    }
}

const blocked = new BlockList();
const V4_BLOCKED: [string, number][] = [
    ['0.0.0.0', 8], // "this network"
    ['10.0.0.0', 8], // private
    ['100.64.0.0', 10], // carrier-grade NAT
    ['127.0.0.0', 8], // loopback
    ['169.254.0.0', 16], // link-local, including the cloud metadata address
    ['172.16.0.0', 12], // private
    ['192.0.0.0', 24], // IETF protocol assignments
    ['192.0.2.0', 24], // documentation
    ['192.88.99.0', 24], // 6to4 relay
    ['192.168.0.0', 16], // private
    ['198.18.0.0', 15], // benchmarking
    ['198.51.100.0', 24], // documentation
    ['203.0.113.0', 24], // documentation
    ['224.0.0.0', 4], // multicast
    ['240.0.0.0', 4], // reserved, and the broadcast address
];
const V6_BLOCKED: [string, number][] = [
    ['::', 96], // unspecified, loopback and the old IPv4-compatible range
    ['64:ff9b::', 96], // NAT64: embeds an IPv4 address
    ['64:ff9b:1::', 48],
    ['100::', 64], // discard-only
    ['2001::', 23], // IETF protocol assignments, Teredo
    ['2001:db8::', 32], // documentation
    ['2002::', 16], // 6to4: embeds an IPv4 address
    ['fc00::', 7], // unique local
    ['fe80::', 10], // link-local
    ['fec0::', 10], // site-local, deprecated
    ['ff00::', 8], // multicast
];
for (const [net, prefix] of V4_BLOCKED) blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of V6_BLOCKED) blocked.addSubnet(net, prefix, 'ipv6');

/**
 * @returns True only for an address on the public internet. An IPv4 address written as IPv4-mapped IPv6
 *   (`::ffff:127.0.0.1`) is judged by the IPv4 rules, which `BlockList` does for us.
 */
export function isPublicAddress(address: string): boolean {
    const family = isIP(address);
    if (family === 0) return false;
    return !blocked.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

export interface Target {
    url: URL;
    address: string;
    family: 4 | 6;
    port: number;
}

/**
 * Validates one link (or one redirect hop) and resolves it to the address the connection will use.
 *
 * @param allowPrivate - Tests and local development only: lets a link point at this machine.
 * @throws LinkRefused with a message fit for the user.
 */
export async function checkTarget(raw: string | URL, allowPrivate = false): Promise<Target> {
    let url: URL;
    try {
        url = typeof raw === 'string' ? new URL(raw) : raw;
    } catch {
        throw new LinkRefused('That is not a valid link.');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
        throw new LinkRefused('Only http and https links can be imported.');
    if (url.username !== '' || url.password !== '')
        throw new LinkRefused('Links with a user name or password are not accepted.');
    const port = url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number(url.port);
    if (!allowPrivate && port !== 80 && port !== 443)
        throw new LinkRefused('Only links on the standard web ports (80 and 443) can be imported.');

    const host = url.hostname.replace(/^\[|\]$/g, '');
    let addresses: { address: string; family: number }[];
    if (isIP(host) !== 0) {
        addresses = [{ address: host, family: isIP(host) }];
    } else {
        try {
            addresses = await lookup(host, { all: true, verbatim: true });
        } catch {
            throw new LinkRefused('The address of that link could not be found.');
        }
    }
    const first = addresses[0];
    if (!first) throw new LinkRefused('The address of that link could not be found.');
    if (!allowPrivate && addresses.some((a) => !isPublicAddress(a.address)))
        throw new LinkRefused(
            'That link points to a private or internal address and cannot be imported.',
        );
    return { url, address: first.address, family: first.family === 6 ? 6 : 4, port };
}

/** The file name a download should get: the server's own suggestion, else the last part of the path. */
export function nameFromResponse(headers: IncomingMessage['headers'], url: URL): string {
    const disposition = String(headers['content-disposition'] ?? '');
    const star = /filename\*\s*=\s*[^']*'[^']*'([^;]+)/i.exec(disposition)?.[1];
    const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(disposition)?.[1];
    let raw = star ?? plain ?? '';
    if (raw === '') raw = url.pathname.split('/').filter(Boolean).pop() ?? '';
    try {
        raw = decodeURIComponent(raw);
    } catch {
        // keep the undecoded text
    }
    return tidyFileName(raw.trim() === '' ? 'download' : raw);
}

export interface DownloadOptions {
    maxBytes: number;
    allowPrivate?: boolean;
    connectTimeoutMs?: number;
    idleTimeoutMs?: number;
    maxRedirects?: number;
    onProgress?: (seen: number, total: number) => void;
}

export interface Downloaded {
    path: string;
    size: number;
    name: string;
    mime: string;
}

function open(target: Target, connectTimeoutMs: number): Promise<IncomingMessage> {
    return new Promise((resolve, reject) => {
        const secure = target.url.protocol === 'https:';
        const request = (secure ? httpsRequest : httpRequest)(
            {
                // The checked address, not the name: nothing can re-resolve between the check and the connection.
                host: target.address,
                family: target.family,
                port: target.port,
                path: `${target.url.pathname}${target.url.search}`,
                method: 'GET',
                headers: {
                    host: target.url.host,
                    'user-agent': 'burrow-import',
                    accept: '*/*',
                    // Stored exactly as sent: no transfer compression to inflate into something huge.
                    'accept-encoding': 'identity',
                },
                // The real name goes into the TLS handshake, so the certificate is checked against it.
                ...(secure && isIP(target.url.hostname.replace(/^\[|\]$/g, '')) === 0
                    ? { servername: target.url.hostname }
                    : {}),
                timeout: connectTimeoutMs,
            },
            resolve,
        );
        request.on('timeout', () =>
            request.destroy(new LinkRefused('The server took too long to answer.')),
        );
        request.on('error', reject);
        request.end();
    });
}

/**
 * Downloads a link to `destination`, following a few redirects, enforcing every rule above.
 *
 * @throws LinkRefused for anything wrong with the link; any other failure is reported as a generic one.
 */
export async function downloadTo(
    link: string,
    destination: string,
    options: DownloadOptions,
): Promise<Downloaded> {
    const allowPrivate = options.allowPrivate ?? false;
    const maxRedirects = options.maxRedirects ?? 5;
    const connectTimeoutMs = options.connectTimeoutMs ?? 15_000;
    const idleTimeoutMs = options.idleTimeoutMs ?? 60_000;
    let current: URL | string = link;
    let previous: URL | null = null;
    try {
        for (let hop = 0; ; hop++) {
            const target = await checkTarget(current, allowPrivate);
            if (previous?.protocol === 'https:' && target.url.protocol === 'http:')
                throw new LinkRefused('A link may not redirect from https to plain http.');
            const response = await open(target, connectTimeoutMs);
            const status = response.statusCode ?? 0;
            const location = response.headers.location;
            if ([301, 302, 303, 307, 308].includes(status) && location) {
                response.resume();
                if (hop >= maxRedirects)
                    throw new LinkRefused('The link redirects too many times.');
                previous = target.url;
                try {
                    current = new URL(location, target.url);
                } catch {
                    throw new LinkRefused('The link redirects to something that is not a link.');
                }
                continue;
            }
            if (status !== 200) {
                response.resume();
                throw new LinkRefused(`The link answered with an error (${String(status)}).`);
            }
            const total = Number(response.headers['content-length']);
            if (Number.isFinite(total) && total > options.maxBytes) {
                response.destroy();
                throw new LinkRefused('The file is larger than the import limit.');
            }
            response.socket.setTimeout(idleTimeoutMs, () =>
                response.destroy(new LinkRefused('The download stalled.')),
            );
            let seen = 0;
            let lastReport = 0;
            const counter = new Transform({
                transform(chunk: Buffer, _encoding, done) {
                    seen += chunk.length;
                    if (seen > options.maxBytes) {
                        done(new LinkRefused('The file is larger than the import limit.'));
                        return;
                    }
                    if (Date.now() - lastReport > 400) {
                        lastReport = Date.now();
                        options.onProgress?.(seen, Number.isFinite(total) ? total : 0);
                    }
                    done(null, chunk);
                },
            });
            await pipeline(response, counter, createWriteStream(destination));
            if (seen === 0) throw new LinkRefused('The link returned an empty file.');
            options.onProgress?.(seen, seen);
            const mime = String(response.headers['content-type'] ?? '')
                .split(';')[0]
                ?.trim();
            return {
                path: destination,
                size: seen,
                name: nameFromResponse(response.headers, target.url),
                mime: mime || 'application/octet-stream',
            };
        }
    } catch (error) {
        if (error instanceof LinkRefused) throw error;
        // Connection refused, TLS errors and the like: say so without leaking where the server tried to connect.
        throw new LinkRefused('Could not download from that link.');
    }
}
