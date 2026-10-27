import { useState } from 'react';
import type { ReactNode } from 'react';

const letters = (i: number): string => {
    let n = i;
    let out = '';
    do {
        out = String.fromCharCode(65 + (n % 26)) + out;
        n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return out;
};
const isNumber = (v: string): boolean => v !== '' && /^-?[\d\s.,]+(%|\s?€|\s?\$)?$/.test(v.trim());

/** A spreadsheet the way a spreadsheet looks: column letters, row numbers, gridlines, a cell box and formula bar, tabs below. */
export function SheetGrid({
    sheets,
    limit,
}: {
    sheets: { name: string; rows: string[][] }[];
    limit: number;
}): ReactNode {
    const [tab, setTab] = useState(0);
    const [sel, setSel] = useState<[number, number]>([0, 0]);
    const current = sheets[tab] ?? sheets[0];
    // Padded with empty cells so a small sheet still looks like a sheet.
    const data = current?.rows ?? [];
    const rows = [
        ...data,
        ...Array.from({ length: Math.max(0, 30 - data.length) }, () => [] as string[]),
    ];
    const cols = Math.min(60, Math.max(12, ...data.map((r) => r.length)));
    const shown = rows[sel[0]]?.[sel[1]] ?? '';
    return (
        <div className="xl">
            <div className="xl-bar">
                <span className="xl-name">{`${letters(sel[1])}${String(sel[0] + 1)}`}</span>
                <span className="xl-fx">fx</span>
                <span className="xl-formula" title={shown}>
                    {shown}
                </span>
            </div>
            <div className="xl-scroll">
                <table className="xl-grid">
                    <thead>
                        <tr>
                            <th className="corner" />
                            {Array.from({ length: cols }, (_, c) => (
                                <th key={c} className={c === sel[1] ? 'on' : ''} scope="col">
                                    {letters(c)}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, r) => (
                            <tr key={r}>
                                <th className={r === sel[0] ? 'on' : ''} scope="row">
                                    {r + 1}
                                </th>
                                {Array.from({ length: cols }, (_, c) => {
                                    const v = row[c] ?? '';
                                    return (
                                        <td
                                            key={c}
                                            className={`${isNumber(v) ? 'num' : ''} ${r === sel[0] && c === sel[1] ? 'sel' : ''}`}
                                            onClick={() => setSel([r, c])}
                                        >
                                            {v}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="xl-tabs" role="tablist" aria-label="Sheets">
                {sheets.map((s, i) => (
                    <button
                        key={s.name}
                        type="button"
                        role="tab"
                        aria-selected={i === tab}
                        className={i === tab ? 'on' : ''}
                        onClick={() => {
                            setTab(i);
                            setSel([0, 0]);
                        }}
                    >
                        {s.name}
                    </button>
                ))}
                {data.length >= limit ? (
                    <span className="muted small">First {limit} rows</span>
                ) : null}
            </div>
        </div>
    );
}
