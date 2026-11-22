/**
 * "How many pictures are in review?" is a question about numbers the server already has, so it is answered from them
 * and not by the language model: a small model asked for a count in the middle of a long prompt says it cannot see the
 * files, and a made-up number is worse than that. Anything that is not clearly such a question goes to the model.
 */
export type CountTopic =
    | { kind: 'review' }
    | { kind: 'unsorted' }
    | { kind: 'total' }
    | { kind: 'folder'; folder: string };

export interface CountQuestion {
    topic: CountTopic;
    german: boolean;
}

export interface Counts {
    total: number;
    unsorted: number;
    review: number;
    /** Files in each folder, by the folder's own name (lower case). */
    folders: Map<string, number>;
}

const ASKING = /\b(how many|how much|number of|count|wie ?viele|anzahl|wieviel)\b/i;
const REVIEW =
    /\b(review|in review|queue|zur ?[uü]berpr[uü]fung|[uü]berpr[uü]f\w*|pr[uü]f\w*|warteschlange)\b/i;
const UNSORTED =
    /\b(unsorted|not sorted|unfiled|not filed|no folder|nicht (?:einsortiert|sortiert)|unsortiert|ohne ordner|in keinem ordner)\b/i;
const THINGS = /\b(files?|pictures?|photos?|images?|dateien|datei|bilder|fotos?)\b/i;
const GERMAN = /\b(wie ?viele|wieviel|anzahl|dateien|datei|bilder|fotos?|ordner|habe|sind|ist)\b/i;

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** @returns What is being counted, or null when the message is not a plain count question. */
export function parseCountQuestion(text: string, folderNames: string[]): CountQuestion | null {
    if (!ASKING.test(text)) return null;
    const german = GERMAN.test(text);
    if (REVIEW.test(text)) return { topic: { kind: 'review' }, german };
    if (UNSORTED.test(text)) return { topic: { kind: 'unsorted' }, german };
    // The longest folder name the message mentions as a whole word, so "Wolf pictures" is not "Wolf" nor "pictures".
    const named = folderNames
        .filter((n) => n.trim().length > 2)
        .filter((n) =>
            new RegExp(`(^|[^\\p{L}\\p{N}])${escape(n.trim())}($|[^\\p{L}\\p{N}])`, 'iu').test(
                text,
            ),
        )
        .sort((a, b) => b.length - a.length)[0];
    if (named) return { topic: { kind: 'folder', folder: named.trim() }, german };
    return THINGS.test(text) ? { topic: { kind: 'total' }, german } : null;
}

const files = (n: number, german: boolean): string =>
    german
        ? `${String(n)} ${n === 1 ? 'Datei' : 'Dateien'}`
        : `${String(n)} ${n === 1 ? 'file' : 'files'}`;

/** The answer, in the language of the question. */
export function answerCount(question: CountQuestion, counts: Counts): string {
    const { topic, german } = question;
    if (topic.kind === 'review') {
        if (counts.review === 0)
            return german
                ? 'Im Review wartet gerade nichts.'
                : 'Nothing is waiting in review right now.';
        return german
            ? `Im Review warten ${files(counts.review, true)}: Der Sortierer war sich nicht sicher, wohin sie gehören. Du findest sie auf der Review-Seite.`
            : `${files(counts.review, false)} ${counts.review === 1 ? 'is' : 'are'} waiting in review: the sorter was not sure where ${counts.review === 1 ? 'it goes' : 'they go'}. You will find ${counts.review === 1 ? 'it' : 'them'} on the Review page.`;
    }
    if (topic.kind === 'unsorted')
        return german
            ? `${files(counts.unsorted, true)} liegen in keinem Ordner.`
            : `${files(counts.unsorted, false)} ${counts.unsorted === 1 ? 'is' : 'are'} not in any folder.`;
    if (topic.kind === 'folder') {
        const n = counts.folders.get(topic.folder.toLowerCase()) ?? 0;
        return german
            ? `In „${topic.folder}“ liegen ${files(n, true)}.`
            : `"${topic.folder}" holds ${files(n, false)}.`;
    }
    return german
        ? `Du hast insgesamt ${files(counts.total, true)}, davon ${String(counts.unsorted)} in keinem Ordner und ${String(counts.review)} im Review.`
        : `You have ${files(counts.total, false)} in total: ${String(counts.unsorted)} in no folder and ${String(counts.review)} in review.`;
}
