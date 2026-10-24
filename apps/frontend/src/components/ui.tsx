import { Loader2 } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { useProtectedImage } from '../lib/blob.ts';

/** A thumbnail or avatar behind the bearer header: fetched as a blob, shown from an object URL. */
export function ProtectedImage({ path, alt }: { path: string | null; alt: string }): ReactNode {
    const url = useProtectedImage(path);
    return url ? <img src={url} alt={alt} loading="lazy" /> : null;
}

export function Spinner(): ReactNode {
    return <Loader2 className="spin" size={18} aria-label="Loading" />;
}

interface Toasts {
    say: (message: string) => void;
}
const ToastContext = createContext<Toasts>({ say: () => undefined });

/** One transient message at a time, announced to screen readers. */
export function ToastProvider({ children }: { children: ReactNode }): ReactNode {
    const [message, setMessage] = useState<string | null>(null);
    const timer = useRef<number | undefined>(undefined);
    const say = useCallback((text: string) => {
        setMessage(text);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setMessage(null), 3500);
    }, []);
    return (
        <ToastContext.Provider value={{ say }}>
            {children}
            <div role="status" aria-live="polite">
                {message ? <div className="toast">{message}</div> : null}
            </div>
        </ToastContext.Provider>
    );
}
export const useToast = (): Toasts => useContext(ToastContext);

interface DialogProps {
    title: string;
    children: ReactNode;
    onClose: () => void;
}

/** A modal that traps Escape and returns focus; used instead of window.prompt/confirm, which block the page. */
export function Dialog({ title, children, onClose }: DialogProps): ReactNode {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null;
        ref.current?.querySelector<HTMLElement>('input, select, button')?.focus();
        const onKey = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('keydown', onKey);
            previous?.focus();
        };
    }, [onClose]);
    // Portalled to <body>: rendered inside the sticky sidebar it would live in that element's stacking
    // context, and the page content next to it would paint over the dialog.
    return createPortal(
        <div
            className="modal-bg"
            onMouseDown={(event) => event.target === event.currentTarget && onClose()}
        >
            <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
                <h2>{title}</h2>
                {children}
            </div>
        </div>,
        document.body,
    );
}

/** Asks for one line of text. */
export function PromptDialog(props: {
    title: string;
    label: string;
    initial?: string;
    confirm: string;
    onSubmit: (value: string) => void;
    onClose: () => void;
}): ReactNode {
    const [value, setValue] = useState(props.initial ?? '');
    const submit = (event: FormEvent): void => {
        event.preventDefault();
        if (value.trim()) props.onSubmit(value.trim());
    };
    return (
        <Dialog title={props.title} onClose={props.onClose}>
            <form onSubmit={submit} className="field">
                <label htmlFor="prompt-input">{props.label}</label>
                <input
                    id="prompt-input"
                    className="input"
                    value={value}
                    maxLength={120}
                    onChange={(event) => setValue(event.target.value)}
                />
                <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
                    <button type="button" className="btn ghost" onClick={props.onClose}>
                        Cancel
                    </button>
                    <button type="submit" className="btn" disabled={!value.trim()}>
                        {props.confirm}
                    </button>
                </div>
            </form>
        </Dialog>
    );
}
