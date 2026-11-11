import { Check, ChevronDown } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { categoryRows, placeList, typeAhead } from '../lib/category-select.ts';
import type { Placement } from '../lib/category-select.ts';
import type { CategoryNode } from '../lib/types.ts';

/**
 * The one way to pick a folder anywhere in the app (filing a review item, a file's category, moving a folder, moving a
 * selection). A native `<select>` could not do it: its list ignores indentation in some browsers and opens as wide as
 * its longest name, partly off the screen. This one draws its own list, indented by depth, kept inside the window
 * (wider than the button when a name needs it, above the button near the bottom, pulled in from the edges), and works
 * from the keyboard: arrows, Home/End, Enter, Escape and typing the first letters of a name.
 */
export function CategorySelect({
    id,
    value,
    onChange,
    categories,
    emptyLabel,
    width,
    disabled = false,
    label,
}: {
    id?: string;
    /** The chosen folder's id as text, or '' for the empty choice. */
    value: string;
    onChange: (value: string) => void;
    /** In tree order (a parent before its children), each with its depth, as the API sends them. */
    categories: readonly Pick<CategoryNode, 'id' | 'name' | 'depth'>[];
    /** What the empty choice is called: "Unsorted", "Top level", "Another category...". */
    emptyLabel: string;
    width?: number | string;
    disabled?: boolean;
    /** Names the control for a screen reader when no visible <label> points at it. */
    label?: string;
}): ReactNode {
    const uid = useId();
    const rows = useMemo(() => categoryRows(categories, emptyLabel), [categories, emptyLabel]);
    const selectedIndex = Math.max(
        0,
        rows.findIndex((r) => r.value === value),
    );
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(selectedIndex);
    const [place, setPlace] = useState<Placement | null>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const list = useRef<HTMLUListElement>(null);
    const typed = useRef({ text: '', at: 0 });

    const show = (): void => {
        const box = trigger.current?.getBoundingClientRect();
        if (!box) return;
        setPlace(placeList(box, window.innerWidth, window.innerHeight));
        setActive(selectedIndex);
        setOpen(true);
    };
    const close = (refocus: boolean): void => {
        setOpen(false);
        if (refocus) trigger.current?.focus();
    };
    const choose = (index: number): void => {
        const row = rows[index];
        if (row) onChange(row.value);
        close(true);
    };

    useEffect(() => {
        if (!open) return;
        const away = (event: PointerEvent): void => {
            const target = event.target as Node;
            if (!list.current?.contains(target) && !trigger.current?.contains(target)) close(false);
        };
        // The list is placed once, so anything that moves the button or the window closes it rather than leave it behind.
        const leave = (event: Event): void => {
            if (!list.current?.contains(event.target as Node)) close(false);
        };
        document.addEventListener('pointerdown', away);
        window.addEventListener('resize', leave);
        window.addEventListener('scroll', leave, true);
        return () => {
            document.removeEventListener('pointerdown', away);
            window.removeEventListener('resize', leave);
            window.removeEventListener('scroll', leave, true);
        };
    }, [open]);

    useEffect(() => {
        if (open) list.current?.children[active]?.scrollIntoView({ block: 'nearest' });
    }, [open, active]);

    const onKey = (event: KeyboardEvent<HTMLButtonElement>): void => {
        if (!open) {
            if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
                event.preventDefault();
                show();
            }
            return;
        }
        const last = rows.length - 1;
        if (event.key === 'ArrowDown') setActive((a) => Math.min(a + 1, last));
        else if (event.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
        else if (event.key === 'Home') setActive(0);
        else if (event.key === 'End') setActive(last);
        else if (event.key === 'Enter' || event.key === ' ') choose(active);
        else if (event.key === 'Escape') close(true);
        else if (event.key === 'Tab') close(false);
        else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
            const now = Date.now();
            typed.current = {
                text: (now - typed.current.at < 700 ? typed.current.text : '') + event.key,
                at: now,
            };
            const hit = typeAhead(rows, typed.current.text, active);
            if (hit >= 0) setActive(hit);
        } else return;
        event.preventDefault();
    };

    const chosen = rows[selectedIndex];
    return (
        <>
            <button
                ref={trigger}
                id={id}
                type="button"
                role="combobox"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={`${uid}-list`}
                aria-activedescendant={open ? `${uid}-opt-${String(active)}` : undefined}
                aria-label={label}
                className="input catsel"
                style={width === undefined ? undefined : { width }}
                disabled={disabled}
                title={chosen?.path}
                onClick={() => (open ? close(false) : show())}
                onKeyDown={onKey}
            >
                <span className={`catsel-text${value === '' ? ' empty' : ''}`}>
                    {chosen?.label}
                </span>
                <ChevronDown size={15} aria-hidden="true" />
            </button>
            {open && place
                ? createPortal(
                      <ul
                          ref={list}
                          id={`${uid}-list`}
                          role="listbox"
                          className="catsel-list"
                          style={{
                              left: place.left,
                              top: place.top,
                              width: place.width,
                              maxHeight: place.maxHeight,
                              transform: place.above ? 'translateY(-100%)' : undefined,
                          }}
                      >
                          {rows.map((row, index) => (
                              <li
                                  key={row.value}
                                  id={`${uid}-opt-${String(index)}`}
                                  role="option"
                                  aria-selected={index === selectedIndex}
                                  className={`catsel-opt${index === active ? ' active' : ''}${index === selectedIndex ? ' chosen' : ''}`}
                                  style={{ paddingLeft: 12 + row.depth * 16 }}
                                  title={row.path}
                                  onPointerEnter={() => setActive(index)}
                                  onClick={() => choose(index)}
                              >
                                  {row.depth > 0 ? (
                                      <span className="catsel-elbow" aria-hidden="true">
                                          &#9492;
                                      </span>
                                  ) : null}
                                  <span className="catsel-label">{row.label}</span>
                                  {index === selectedIndex ? (
                                      <Check size={14} aria-hidden="true" />
                                  ) : null}
                              </li>
                          ))}
                      </ul>,
                      document.body,
                  )
                : null}
        </>
    );
}
