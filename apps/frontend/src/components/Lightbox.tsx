import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { ProtectedImage } from './ui.tsx';

/**
 * Full-screen viewer for the original file. Click the picture to switch between "fit the screen" and its real pixel
 * size (scroll to pan); Escape closes, the arrow keys step through the neighbours when there are any.
 */
export function Lightbox({
    name,
    path,
    onClose,
    onDownload,
    onPrev,
    onNext,
}: {
    name: string;
    path: string;
    onClose: () => void;
    onDownload?: () => void;
    onPrev?: (() => void) | undefined;
    onNext?: (() => void) | undefined;
}): ReactNode {
    const [actual, setActual] = useState(false);
    useEffect(() => setActual(false), [path]);
    useEffect(() => {
        const onKey = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') onClose();
            else if (event.key === 'ArrowLeft') onPrev?.();
            else if (event.key === 'ArrowRight') onNext?.();
        };
        document.addEventListener('keydown', onKey);
        const overflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = overflow;
        };
    }, [onClose, onPrev, onNext]);

    return createPortal(
        <div className="lightbox" role="dialog" aria-modal="true" aria-label={name}>
            <div className="lightbox-bar">
                <strong className="lightbox-name">{name}</strong>
                <span className="grow" />
                <span className="muted small hide-narrow">
                    {actual ? 'Actual size' : 'Fit to screen'} · click the picture to switch
                </span>
                {onDownload ? (
                    <button className="btn ghost sm" onClick={onDownload}>
                        <Download size={14} />
                        Download
                    </button>
                ) : null}
                <button className="tool" aria-label="Close" onClick={onClose}>
                    <X size={18} />
                </button>
            </div>
            <div className={`lightbox-body ${actual ? 'actual' : ''}`}>
                {onPrev ? (
                    <button className="lightbox-nav prev" aria-label="Previous" onClick={onPrev}>
                        <ChevronLeft size={22} />
                    </button>
                ) : null}
                <button
                    type="button"
                    className="lightbox-img"
                    aria-label={actual ? 'Fit to screen' : 'Show at actual size'}
                    onClick={() => setActual((v) => !v)}
                >
                    <ProtectedImage path={path} alt={name} />
                </button>
                {onNext ? (
                    <button className="lightbox-nav next" aria-label="Next" onClick={onNext}>
                        <ChevronRight size={22} />
                    </button>
                ) : null}
            </div>
        </div>,
        document.body,
    );
}
