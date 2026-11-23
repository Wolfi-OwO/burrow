import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

// A small simulation of the sorter with made-up scores, so a visitor can see how it decides without an account. The
// thresholds are the real ones (apps/api config: auto-file from 0.6, review from 0.3); the pictures are captions.
const AUTO_FILE = 0.6;
const REVIEW_FLOOR = 0.3;
const FOLDERS = ['Wolves', 'Cats', 'Mountains', 'Beach', 'Documents'] as const;
type Folder = (typeof FOLDERS)[number];

interface Sample {
    id: number;
    caption: string;
    /** What the picture looks like, so a correction teaches the sorter about similar ones. */
    look: string;
    scores: Partial<Record<Folder, number>>;
    batch: 1 | 2;
}

const SAMPLES: Sample[] = [
    { id: 1, caption: 'Wolf in snow', look: 'wolf', scores: { Wolves: 0.82, Cats: 0.1 }, batch: 1 },
    {
        id: 2,
        caption: 'Tabby cat on a sofa',
        look: 'cat',
        scores: { Cats: 0.88, Wolves: 0.12 },
        batch: 1,
    },
    {
        id: 3,
        caption: 'Alpine ridge at dawn',
        look: 'ridge',
        scores: { Mountains: 0.79, Beach: 0.1 },
        batch: 1,
    },
    {
        id: 4,
        caption: 'Beach at sunset',
        look: 'beach',
        scores: { Beach: 0.84, Mountains: 0.15 },
        batch: 1,
    },
    { id: 5, caption: 'Scanned invoice', look: 'paper', scores: { Documents: 0.91 }, batch: 1 },
    {
        id: 6,
        caption: 'Husky puppy',
        look: 'canine',
        scores: { Wolves: 0.46, Cats: 0.31 },
        batch: 1,
    },
    {
        id: 7,
        caption: 'Blurry night shot',
        look: 'blur',
        scores: { Beach: 0.14, Cats: 0.12 },
        batch: 1,
    },
    {
        id: 8,
        caption: 'Wolf pup in fog',
        look: 'canine',
        scores: { Wolves: 0.52, Cats: 0.08 },
        batch: 2,
    },
    {
        id: 9,
        caption: 'Husky on a trail',
        look: 'canine',
        scores: { Wolves: 0.49, Mountains: 0.33 },
        batch: 2,
    },
];

type Place =
    { kind: 'waiting' } | { kind: 'filed' | 'review' | 'unsorted'; folder?: Folder; why: string };

function best(scores: Sample['scores']): [Folder, number] | null {
    let top: [Folder, number] | null = null;
    for (const f of FOLDERS) {
        const s = scores[f];
        if (s !== undefined && (top === null || s > top[1])) top = [f, s];
    }
    return top;
}

export function DemoPage(): ReactNode {
    const [batch, setBatch] = useState<1 | 2>(1);
    const [placed, setPlaced] = useState<Record<number, Place>>({});
    const [learned, setLearned] = useState<Record<string, Folder>>({});

    useEffect(() => {
        const previous = document.title;
        document.title = 'Try the burrow sorter: how pictures get filed into your own folders';
        const meta = document.querySelector('meta[name="description"]');
        const before = meta?.getAttribute('content') ?? '';
        meta?.setAttribute(
            'content',
            'A small interactive demo of how burrow files pictures into your own folder tree, sends doubtful ones to review and learns from your corrections.',
        );
        return () => {
            document.title = previous;
            meta?.setAttribute('content', before);
        };
    }, []);

    const visible = useMemo(() => SAMPLES.filter((s) => s.batch <= batch), [batch]);
    const waiting = visible.filter((s) => placed[s.id] === undefined).length;
    const counts = useMemo(() => {
        const out: Record<string, number> = { Review: 0, Unsorted: 0 };
        for (const f of FOLDERS) out[f] = 0;
        for (const s of visible) {
            const p = placed[s.id];
            if (!p || p.kind === 'waiting') continue;
            if (p.kind === 'filed' && p.folder) out[p.folder] = (out[p.folder] ?? 0) + 1;
            if (p.kind === 'review') out.Review = (out.Review ?? 0) + 1;
            if (p.kind === 'unsorted') out.Unsorted = (out.Unsorted ?? 0) + 1;
        }
        return out;
    }, [placed, visible]);

    const sortNow = (): void => {
        const next = { ...placed };
        for (const s of visible) {
            if (next[s.id] !== undefined) continue;
            const learnedFolder = learned[s.look];
            const top = best(s.scores);
            if (learnedFolder) {
                next[s.id] = {
                    kind: 'filed',
                    folder: learnedFolder,
                    why: `Learned: you filed a ${s.look}-looking picture under ${learnedFolder} before.`,
                };
            } else if (top && top[1] >= AUTO_FILE) {
                next[s.id] = {
                    kind: 'filed',
                    folder: top[0],
                    why: `${top[0]} scored ${top[1].toFixed(2)}, above ${AUTO_FILE}.`,
                };
            } else if (top && top[1] >= REVIEW_FLOOR) {
                next[s.id] = {
                    kind: 'review',
                    folder: top[0],
                    why: `Best guess ${top[0]} scored ${top[1].toFixed(2)}: not sure enough, so you decide.`,
                };
            } else {
                next[s.id] = {
                    kind: 'unsorted',
                    why: 'Nothing fits well enough, so it stays unsorted.',
                };
            }
        }
        setPlaced(next);
    };

    const moveTo = (s: Sample, folder: Folder): void => {
        setPlaced((p) => ({
            ...p,
            [s.id]: { kind: 'filed', folder, why: `You filed it under ${folder}.` },
        }));
        setLearned((l) => ({ ...l, [s.look]: folder }));
    };

    const reset = (): void => {
        setBatch(1);
        setPlaced({});
        setLearned({});
    };

    return (
        <main className="demo">
            <header className="demo-head">
                <div>
                    <p className="kicker">Demo</p>
                    <h1>Try the sorter</h1>
                    <p className="demo-lead">
                        Burrow files pictures into the folders you made, by what is in them. A
                        confident match is filed, a doubtful one waits in Review, and every
                        correction teaches it. This is a small simulation with made-up scores, so
                        you can watch it decide.
                    </p>
                </div>
                <div className="demo-actions">
                    <Link className="btn" to="/login">
                        Create your own drive
                    </Link>
                </div>
            </header>

            <div className="demo-grid">
                <aside className="demo-tree" aria-label="Folders">
                    <h2>Your folders</h2>
                    <ul>
                        {FOLDERS.map((f) => (
                            <li key={f}>
                                <span>{f}</span>
                                <b>{counts[f]}</b>
                            </li>
                        ))}
                        <li className="sep">
                            <span>Review</span>
                            <b>{counts.Review}</b>
                        </li>
                        <li>
                            <span>Unsorted</span>
                            <b>{counts.Unsorted}</b>
                        </li>
                    </ul>
                </aside>

                <section aria-label="Pictures">
                    <div className="demo-bar">
                        <p>
                            <b>{waiting}</b> picture{waiting === 1 ? '' : 's'} waiting to be sorted
                        </p>
                        <div className="demo-actions">
                            <button className="btn" onClick={sortNow} disabled={waiting === 0}>
                                Sort now
                            </button>
                            {batch === 1 ? (
                                <button className="btn ghost" onClick={() => setBatch(2)}>
                                    Add two more pictures
                                </button>
                            ) : null}
                            <button className="btn ghost" onClick={reset}>
                                Start over
                            </button>
                        </div>
                    </div>
                    <ul className="demo-tiles">
                        {visible.map((s) => {
                            const p = placed[s.id];
                            return (
                                <li key={s.id} className={`demo-tile ${p?.kind ?? 'waiting'}`}>
                                    <div
                                        className="demo-pic"
                                        style={{ ['--h' as string]: String(s.id * 41) }}
                                    >
                                        {s.caption}
                                    </div>
                                    <p className="demo-state">
                                        {!p
                                            ? 'Waiting'
                                            : p.kind === 'filed'
                                              ? `Filed in ${p.folder ?? ''}`
                                              : p.kind === 'review'
                                                ? 'In Review'
                                                : 'Unsorted'}
                                    </p>
                                    {p && p.kind !== 'waiting' ? (
                                        <p className="demo-why">{p.why}</p>
                                    ) : null}
                                    {p?.kind === 'review' || p?.kind === 'unsorted' ? (
                                        <label className="demo-move">
                                            <span>Move to</span>
                                            <select
                                                value=""
                                                onChange={(e) =>
                                                    moveTo(s, e.target.value as Folder)
                                                }
                                            >
                                                <option value="" disabled>
                                                    Choose a folder
                                                </option>
                                                {FOLDERS.map((f) => (
                                                    <option key={f} value={f}>
                                                        {f}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>
                                    ) : null}
                                </li>
                            );
                        })}
                    </ul>
                    <p className="demo-note">
                        Try it: press Sort now, move the husky puppy from Review into Wolves, then
                        add two more pictures and sort again. The similar ones go straight to
                        Wolves, because you showed it.
                    </p>
                </section>
            </div>
        </main>
    );
}
