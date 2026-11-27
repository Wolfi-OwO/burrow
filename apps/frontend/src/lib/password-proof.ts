/**
 * The page never sends the password. It sends a proof derived from it, so the typed password is not in the request,
 * not in a proxy's log and not in anything that handles the request between the browser and the server. The server
 * hashes the proof again before storing it (Argon2id), so what it holds is a hash of a hash.
 *
 * The salt carries the app name and the username, so the same password gives a different proof in every app and for
 * every account. The username cannot be changed after sign-up, so the proof of an account never moves.
 *
 * What this does not do: the proof is a password for this site, so anyone who learns it can sign in. It protects the
 * password a person may have reused elsewhere, not this account from a stolen proof.
 */
const ITERATIONS = 310_000;
const PREFIX = 'pw1$';

const base64url = (bytes: Uint8Array): string =>
    btoa(String.fromCharCode(...bytes))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replaceAll('=', '');

/**
 * @param username - The account name; trimmed and lower-cased the way the server matches it.
 * @param password - What the person typed.
 * @returns `pw1$` followed by 43 characters.
 */
export async function derivePasswordProof(username: string, password: string): Promise<string> {
    const text = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw',
        text.encode(password.normalize('NFKC')),
        'PBKDF2',
        false,
        ['deriveBits'],
    );
    const bits = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            hash: 'SHA-256',
            iterations: ITERATIONS,
            salt: text.encode(`burrow:password:v1:${username.trim().toLowerCase()}`),
        },
        key,
        256,
    );
    return PREFIX + base64url(new Uint8Array(bits));
}
