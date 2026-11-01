// The pure rules of the line grid (part 03.02, FR-06): new rows, how pasted text is read per column, computed cells and pasting a
// block into the grid. Kept apart from the component so Node tests drive the same code (T-01).
import { multiply, parseNumberInput } from '../../../shared/forms/numbers.js';
import { parseClipboardTable, rowsFromPaste } from '../../../shared/forms/paste.js';
import { parseTypedDate } from './dates.js';

export const SCALES = { quantity: 3, currency: 2, number: 2, percent: 4 };
let seq = 0;
export const newRow = (values = {}) => ({ _k: `r${Date.now().toString(36)}${(seq += 1)}`, ...values });

/** How pasted text is read for a column (the same rules as typing). */
export function columnParser(col) {
  if (['quantity', 'currency', 'number', 'percent'].includes(col.type)) return (t) => parseNumberInput(t, { scale: col.scale ?? SCALES[col.type] });
  if (col.type === 'date') return (t) => (t === '' ? { ok: true, value: '' } : parseTypedDate(t) ? { ok: true, value: parseTypedDate(t) } : { ok: false, error: 'Not a date' });
  if (col.type === 'lookup' && col.valueKey === 'code') return (t) => ({ ok: true, value: t.toUpperCase() });
  return (t) => ({ ok: true, value: t });
}

/** The value of a computed column from its inputs (shown while typing; the server recomputes it). */
export function computeCell(col, row) {
  if (!col.computed) return row[col.key];
  const [a, b] = col.computed.map((k) => parseNumberInput(row[k] ?? '', { scale: 6 }));
  return a.ok && b.ok && a.value !== '' && b.value !== '' ? multiply(a.value, b.value, col.scale ?? 2) : '';
}

/** Put pasted rows into the grid from row `at`, column `colIndex` on; adds rows as needed (never beyond maxRows). */
export function pasteInto(rows, text, { columns, at, colIndex, maxRows }) {
  const editable = columns.filter((c) => !c.computed);
  const from = editable.slice(colIndex).map((c) => ({ ...c, parse: columnParser(c) }));
  const { rows: pasted, skippedHeader } = rowsFromPaste(parseClipboardTable(text), from);
  const next = rows.slice();
  const room = Math.max(0, maxRows - at);
  pasted.slice(0, room).forEach((p, i) => {
    const target = at + i;
    next[target] = { ...(next[target] ?? newRow()), ...p.values };
  });
  return { rows: next, count: Math.min(pasted.length, room), dropped: Math.max(0, pasted.length - room), skippedHeader };
}

