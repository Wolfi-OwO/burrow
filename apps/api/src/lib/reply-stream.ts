/**
 * Pulls the text of the `"reply"` string out of a JSON document that is still arriving, piece by piece, so the page
 * can show the answer as it is written while the rest of the document (the actions) is still being generated.
 * The document starts with `{"reply":"` because the schema lists `reply` first.
 */
export class ReplyStream {
    #raw = '';
    #cursor = 0;
    #started = false;
    #done = false;

    /** @returns The reply text that became readable with this piece. */
    public push(piece: string): string {
        this.#raw += piece;
        let out = '';
        if (!this.#started) {
            const match = /"reply"\s*:\s*"/.exec(this.#raw);
            if (!match) return '';
            this.#started = true;
            this.#cursor = match.index + match[0].length;
        }
        while (!this.#done && this.#cursor < this.#raw.length) {
            const ch = this.#raw[this.#cursor] as string;
            if (ch === '"') {
                this.#done = true;
            } else if (ch === '\\') {
                const next = this.#raw[this.#cursor + 1];
                if (next === undefined) break;
                if (next === 'u') {
                    const hex = this.#raw.slice(this.#cursor + 2, this.#cursor + 6);
                    if (hex.length < 4) break;
                    out += String.fromCharCode(parseInt(hex, 16));
                    this.#cursor += 6;
                    continue;
                }
                out += { n: '\n', t: '\t', r: '\r' }[next] ?? next;
                this.#cursor += 2;
                continue;
            } else {
                out += ch;
            }
            this.#cursor += 1;
        }
        return out;
    }
}
