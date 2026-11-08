import type { DecipherGCM } from 'node:crypto';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Transform } from 'node:stream';
import type { TransformCallback } from 'node:stream';

/**
 * Client-side encryption of what goes into the object store, so the provider holds bytes it cannot read and a file's
 * lawfulness never depends on its content policy. AES-256-GCM, a fresh random IV per object, the key only on this server.
 *
 * Object layout: 8 bytes magic, 12 bytes IV, the ciphertext, 16 bytes authentication tag. The tag is checked when the
 * stream ends, so a changed object (a flipped byte, a swapped file) fails the read instead of being served.
 *
 * An object without the magic is read as plain bytes: that keeps anything stored before encryption was switched on
 * readable. A reader holds back the last 16 bytes of every encrypted object, so it never passes on the tag as data.
 */
export const MAGIC = Buffer.from('BURROWv1');
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER = MAGIC.length + IV_BYTES;

/** @returns The key from a base64 string, or an error for one that is not 32 bytes. */
export function parseKey(base64: string): Buffer {
    const key = Buffer.from(base64, 'base64');
    if (key.length !== 32)
        throw new Error(
            'BLOB_ENCRYPTION_KEY must be 32 bytes in base64 (openssl rand -base64 32).',
        );
    return key;
}

/** Turns plain bytes into an encrypted object as they pass through. */
export function encryptStream(key: Buffer): Transform {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    let started = false;
    return new Transform({
        transform(chunk: Buffer, _encoding, done: TransformCallback): void {
            if (!started) {
                started = true;
                this.push(Buffer.concat([MAGIC, iv]));
            }
            done(null, cipher.update(chunk));
        },
        flush(done: TransformCallback): void {
            if (!started) this.push(Buffer.concat([MAGIC, iv]));
            this.push(cipher.final());
            this.push(cipher.getAuthTag());
            done();
        },
    });
}

/** Turns an object back into plain bytes, failing at the end if it was changed or the key is wrong. */
export function decryptStream(key: Buffer): Transform {
    let head = Buffer.alloc(0);
    let decipher: DecipherGCM | null = null;
    let plain = false;
    // The last 16 bytes seen so far: the tag, once the stream ends. Everything before them is ciphertext.
    let tail = Buffer.alloc(0);
    return new Transform({
        transform(chunk: Buffer, _encoding, done: TransformCallback): void {
            try {
                if (plain) {
                    done(null, chunk);
                    return;
                }
                let data = chunk;
                if (!decipher) {
                    head = Buffer.concat([head, data]);
                    if (head.length < HEADER) {
                        // Not enough yet to tell. A shorter object that is not ours is passed on at the end.
                        done();
                        return;
                    }
                    if (!head.subarray(0, MAGIC.length).equals(MAGIC)) {
                        plain = true;
                        done(null, head);
                        return;
                    }
                    decipher = createDecipheriv(
                        'aes-256-gcm',
                        key,
                        head.subarray(MAGIC.length, HEADER),
                    );
                    data = head.subarray(HEADER);
                    head = Buffer.alloc(0);
                }
                const all = Buffer.concat([tail, data]);
                const keep = Math.min(TAG_BYTES, all.length);
                tail = all.subarray(all.length - keep);
                const body = all.subarray(0, all.length - keep);
                done(null, body.length > 0 ? decipher.update(body) : undefined);
            } catch (error) {
                done(error as Error);
            }
        },
        flush(done: TransformCallback): void {
            try {
                if (plain) {
                    done();
                    return;
                }
                if (!decipher) {
                    // Shorter than a header: not an encrypted object, whatever there is goes through unchanged.
                    if (head.length > 0) this.push(head);
                    done();
                    return;
                }
                if (tail.length !== TAG_BYTES) throw new Error('The stored object is cut short.');
                decipher.setAuthTag(tail);
                this.push(decipher.final());
                done();
            } catch {
                done(new Error('The stored object failed its integrity check.'));
            }
        },
    });
}
