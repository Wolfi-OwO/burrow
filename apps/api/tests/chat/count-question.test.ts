import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { answerCount, parseCountQuestion, type Counts } from '../../src/lib/count-question.ts';

const FOLDERS = ['Furry', 'Matura feier', 'Wolves'];
const counts: Counts = {
    total: 120,
    unsorted: 15,
    review: 7,
    folders: new Map([
        ['furry', 40],
        ['wolves', 1],
    ]),
    tree: [
        { name: 'Furry', depth: 0, count: 40 },
        { name: 'Wolves', depth: 1, count: 1 },
        { name: 'Matura feier', depth: 0, count: 0 },
    ],
};
const ask = (text: string): string | null => {
    const q = parseCountQuestion(text, FOLDERS);
    return q ? answerCount(q, counts) : null;
};

describe('count questions are answered from the numbers, not by the model', () => {
    it('knows what "review" means', () => {
        assert.match(
            ask('How many pictures are in review?') ?? '',
            /7 files are waiting in review/,
        );
        assert.match(ask('how many files are in the review queue') ?? '', /7 files/);
        assert.match(ask('Wie viele Bilder sind im Review?') ?? '', /Im Review warten 7 Dateien/);
    });

    it('answers in the language of the question', () => {
        assert.match(ask('Wie viele Dateien habe ich insgesamt?') ?? '', /insgesamt 120 Dateien/);
        assert.match(ask('How many files do I have?') ?? '', /120 files in total/);
    });

    it('counts what is in no folder', () => {
        assert.match(ask('how many files are unsorted?') ?? '', /15 files are not in any folder/);
        assert.match(
            ask('Wie viele Dateien sind nicht einsortiert?') ?? '',
            /15 Dateien liegen in keinem Ordner/,
        );
    });

    it('counts one folder by its name, singular and plural', () => {
        assert.equal(ask('how many pictures are in Furry?'), '"Furry" holds 40 files.');
        assert.equal(ask('how many are in Wolves'), '"Wolves" holds 1 file.');
        assert.equal(ask('how many files are in Matura feier?'), '"Matura feier" holds 0 files.');
    });

    it('says plainly when nothing is in review', () => {
        const q = parseCountQuestion('how many are in review', FOLDERS);
        assert.ok(q);
        assert.equal(
            answerCount(q, { ...counts, review: 0 }),
            'Nothing is waiting in review right now.',
        );
    });

    it('answers a request for the folder tree with every folder and its count', () => {
        const reply = ask(
            'Make me a nice tree of my current categories + how many pictures are there in each category',
        );
        assert.match(reply ?? '', /Furry: 40\n {4}└ Wolves: 1\nMatura feier: 0/);
        assert.match(reply ?? '', /In no folder: 15, in review: 7\. 120 files in total/);
        assert.match(ask('Wie viele Bilder sind in jedem Ordner?') ?? '', /Deine Ordner/);
        assert.match(ask('show me my folders') ?? '', /Furry: 40/);
    });

    it('does not take a request to build folders for a request to list them', () => {
        assert.equal(
            parseCountQuestion('Create a tree of folders for each holiday', FOLDERS),
            null,
        );
        assert.equal(parseCountQuestion('Travel > Italy > Rome', FOLDERS), null);
    });

    it('leaves everything else to the model', () => {
        assert.equal(parseCountQuestion('Make a folder called Travel', FOLDERS), null);
        assert.equal(parseCountQuestion('how do I share a folder?', FOLDERS), null);
        assert.equal(parseCountQuestion('Put all wolf pictures into Furry', FOLDERS), null);
        assert.equal(parseCountQuestion('how many calories are in a banana', FOLDERS), null);
    });
});
