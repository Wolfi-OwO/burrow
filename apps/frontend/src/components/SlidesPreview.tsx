import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import type { Deck, Shape, Slide } from '../lib/pptx-render.ts';

/** Sizes are in points; the slide is as wide as its container, so a point is a share of that width. */
const EMU_PER_PT = 12700;

function Canvas({ deck, slide, fit }: { deck: Deck; slide: Slide; fit?: boolean }): ReactNode {
    const pct = (v: number, of: number): string => `${String((v / of) * 100)}%`;
    const cqw = (pt: number): string => `${String(((pt * EMU_PER_PT) / deck.width) * 100)}cqw`;
    const place = (s: Shape): CSSProperties => ({
        left: pct(s.x, deck.width),
        top: pct(s.y, deck.height),
        width: pct(s.w, deck.width),
        height: pct(s.h, deck.height),
        background: s.fill ?? undefined,
    });
    return (
        <div
            className="slide-canvas"
            style={{
                aspectRatio: `${String(deck.width)} / ${String(deck.height)}`,
                // The stage is as tall as the window allows, so a 4:3 slide is not taller than the screen.
                maxWidth: fit
                    ? `calc((100vh - 230px) * ${String(deck.width / deck.height)})`
                    : undefined,
                margin: fit ? '0 auto' : undefined,
                background: slide.background ?? '#ffffff',
            }}
        >
            {slide.shapes.map((s, i) => (
                <div key={i} className={`slide-shape ${s.role}`} style={place(s)}>
                    {s.image ? <img src={s.image} alt="" /> : null}
                    {s.paras.map((p, j) => (
                        <p
                            key={j}
                            className={p.bullet ? 'bullet' : undefined}
                            style={{ textAlign: p.align }}
                        >
                            {p.runs.map((r, k) => (
                                <span
                                    key={k}
                                    style={{
                                        fontSize: cqw(r.size ?? (s.role === 'title' ? 32 : 18)),
                                        fontWeight: r.bold || s.role === 'title' ? 700 : 400,
                                        fontStyle: r.italic ? 'italic' : 'normal',
                                        color: r.color ?? '#1f2933',
                                    }}
                                >
                                    {r.text}
                                </span>
                            ))}
                        </p>
                    ))}
                </div>
            ))}
        </div>
    );
}

/** A presentation as slides: a strip of thumbnails and the chosen slide large, arrow keys to move. */
export function SlidesPreview({ deck }: { deck: Deck }): ReactNode {
    const [at, setAt] = useState(0);
    const last = deck.slides.length - 1;
    useEffect(() => {
        // Captured before the lightbox sees the key: arrows turn slides first and only move to the next file once
        // the first or last slide is reached.
        const onKey = (e: KeyboardEvent): void => {
            const forward = e.key === 'ArrowRight' || e.key === 'ArrowDown';
            const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
            if ((forward && at < last) || (back && at > 0)) {
                e.stopImmediatePropagation();
                setAt(at + (forward ? 1 : -1));
            }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [at, last]);
    const slide = deck.slides[at];
    if (!slide) return <p className="muted">No slides found in this presentation.</p>;
    return (
        <div className="slides">
            <ol className="slide-strip" aria-label="Slides">
                {deck.slides.map((s, i) => (
                    <li key={i}>
                        <button
                            type="button"
                            className={i === at ? 'sel' : ''}
                            aria-label={`Slide ${String(i + 1)}`}
                            aria-current={i === at}
                            onClick={() => setAt(i)}
                        >
                            <span className="slide-no">{i + 1}</span>
                            <Canvas deck={deck} slide={s} />
                        </button>
                    </li>
                ))}
            </ol>
            <div className="slide-stage">
                <Canvas deck={deck} slide={slide} fit />
                <div className="slide-nav">
                    <button
                        className="btn"
                        disabled={at === 0}
                        onClick={() => setAt(at - 1)}
                        aria-label="Previous slide"
                    >
                        <ChevronLeft size={16} />
                    </button>
                    <span className="muted small">
                        {at + 1} / {deck.slides.length}
                    </span>
                    <button
                        className="btn"
                        disabled={at === last}
                        onClick={() => setAt(at + 1)}
                        aria-label="Next slide"
                    >
                        <ChevronRight size={16} />
                    </button>
                </div>
            </div>
        </div>
    );
}
