import { useRef, useState } from 'react';
import Icon from '../design/Icon.jsx';
import { formatNumberInput, total } from '../../../shared/forms/numbers.js';
import { formatBusinessDate } from './dates.js';
import { SCALES, columnParser, computeCell, newRow, pasteInto } from './grid.js';
import { LookupField } from './LookupField.jsx';
import { fieldId } from './useForm.js';

// The line-item grid (part 03.02, FR-06): add, insert, duplicate and delete rows; move with Tab, Enter and the arrow keys; paste a
// block copied from Excel (T-01); look up inside a cell; see each row's problems on its cells; computed columns and a totals footer;
// the first column stays in view while the grid scrolls sideways; a comment and attachments per row.

export function LineGrid({ id, label, columns, rows, onChange, errors = {}, maxRows = 500, readOnly = false, onBlur, rowExtra }) {
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState(() => new Set());
  const [notice, setNotice] = useState('');
  const table = useRef(null);
  const editable = columns.filter((c) => !c.computed);
  const totals = columns.filter((c) => c.total);

  const focusCell = (r, key) => requestAnimationFrame(() => document.getElementById(fieldId(`${id}.${r}.${key}`))?.focus());
  const setRows = (next, message = '') => { onChange(next); if (message) setNotice(message); };
  const setCell = (r, key, value) => setRows(rows.map((row, i) => (i === r ? { ...row, [key]: value } : row)));
  const add = (at = rows.length) => {
    if (rows.length >= maxRows) { setNotice(`At most ${maxRows} rows.`); return; }
    const next = [...rows.slice(0, at), newRow(), ...rows.slice(at)];
    setRows(next, `Row ${at + 1} added.`);
    setCurrent(at);
    focusCell(at, editable[0].key);
  };
  const duplicate = () => {
    const targets = selected.size ? [...selected].sort((a, b) => a - b) : [current];
    if (rows.length + targets.length > maxRows) { setNotice(`At most ${maxRows} rows.`); return; }
    const next = [];
    rows.forEach((row, i) => { next.push(row); if (targets.includes(i)) { const copy = { ...row }; delete copy.id; delete copy._k; next.push(newRow(copy)); } });
    setRows(next, `${targets.length} row(s) duplicated.`);
    setSelected(new Set());
  };
  const remove = () => {
    const targets = selected.size ? selected : new Set([current]);
    const next = rows.filter((_, i) => !targets.has(i));
    setRows(next.length ? next : [newRow()], `${targets.size} row(s) deleted.`);
    setSelected(new Set());
    setCurrent(Math.min(current, Math.max(0, next.length - 1)));
  };
  const toggle = (i) => setSelected((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });

  const onKeyDown = (r, key) => (e) => {
    if (e.defaultPrevented) return;
    if (e.key === 'ArrowDown' || (e.key === 'Enter' && !e.shiftKey)) {
      e.preventDefault();
      if (r + 1 >= rows.length) { if (e.key === 'Enter') add(rows.length); return; }
      setCurrent(r + 1);
      focusCell(r + 1, key);
    } else if (e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey)) {
      e.preventDefault();
      if (r > 0) { setCurrent(r - 1); focusCell(r - 1, key); }
    } else if (e.key === 'Insert' || (e.altKey && e.key.toLowerCase() === 'n')) {
      e.preventDefault();
      add(r + 1);
    } else if (e.altKey && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      duplicate();
    }
  };
  const onPaste = (r, key) => (e) => {
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (!/[\t\n]/.test(text.replace(/\n$/, ''))) return; // one value: an ordinary paste into the cell
    e.preventDefault();
    const out = pasteInto(rows, text, { columns, at: r, colIndex: editable.findIndex((c) => c.key === key), maxRows });
    setRows(out.rows, `Pasted ${out.count} row(s)${out.skippedHeader ? ' (the heading row was left out)' : ''}${out.dropped ? `; ${out.dropped} did not fit (at most ${maxRows} rows)` : ''}. Check the marked cells.`);
  };

  const cell = (row, r, col) => {
    const path = `${id}.${r}.${col.key}`;
    const cid = fieldId(path);
    const err = errors[path];
    const common = { id: cid, 'aria-label': `${col.label}, row ${r + 1}`, 'aria-invalid': err ? true : undefined, 'aria-describedby': err ? `${cid}-err` : undefined, onFocus: () => setCurrent(r), onKeyDown: onKeyDown(r, col.key), onPaste: onPaste(r, col.key), onBlur };
    if (col.computed) {
      const given = readOnly && row[col.key] !== undefined ? String(row[col.key]) : null; // the server's own figure, masked or not
      if (given !== null && /^•+$/.test(given)) return <output id={cid} className="ff-cell-out" aria-label={`${col.label}, row ${r + 1}, hidden for your role`}>{given}</output>;
      const v = given ?? computeCell(col, row);
      return <output id={cid} className="ff-cell-out" aria-label={`${col.label}, row ${r + 1}`}>{v === '' ? '-' : formatNumberInput(v, { scale: col.scale ?? 2 })}</output>;
    }
    if (readOnly) {
      const v = row[col.key];
      if (typeof v === 'string' && /^•+$/.test(v)) return <span className="ff-cell-text num" title="Hidden for your role">{v}</span>;
      if (['quantity', 'currency', 'number'].includes(col.type)) return <span className="ff-cell-text num">{v === '' || v == null ? '' : formatNumberInput(v, { scale: col.scale ?? SCALES[col.type], trim: col.type === 'currency' && col.scale > 2 })}</span>;
      return <span className="ff-cell-text">{col.type === 'date' ? formatBusinessDate(v) : v}</span>;
    }
    if (col.type === 'lookup') {
      return (
        <div onKeyDown={onKeyDown(r, col.key)} onPaste={onPaste(r, col.key)} onFocus={() => setCurrent(r)}>
          <LookupField id={cid} label={`${col.label}, row ${r + 1}`} lookup={col.lookup} valueKey={col.valueKey ?? 'code'} value={row[col.key] ?? ''} onChange={(v) => setCell(r, col.key, v)} error={undefined} compact onBlur={onBlur} />
        </div>
      );
    }
    const numeric = ['quantity', 'currency', 'number', 'percent'].includes(col.type);
    const value = row[col.key] ?? '';
    return (
      <input {...common} className={`ff-input ff-cell${numeric ? ' ff-num' : ''}`} inputMode={numeric ? 'decimal' : undefined} maxLength={col.maxLength} value={col.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatBusinessDate(value) : value}
        placeholder={col.type === 'date' ? 'DD-MMM-YYYY' : undefined}
        onChange={(e) => setCell(r, col.key, e.target.value)}
        onBlur={(e) => { const p = columnParser(col)(e.target.value); if (p.ok && p.value !== e.target.value) setCell(r, col.key, p.value); onBlur?.(e); }} />
    );
  };

  const hidden = (c) => readOnly && rows.some((row) => /^•+$/.test(String(row[c.key] ?? '')));
  const sums = Object.fromEntries(totals.map((c) => [c.key, hidden(c) ? '•••' : total(rows.map((row) => (readOnly && row[c.key] !== undefined ? row[c.key] : computeCell(c, row))), c.scale ?? 2)]));
  const rowErrors = (r) => Object.entries(errors).filter(([p]) => p.startsWith(`${id}.${r}.`));
  return (
    <div className="ff-gridbox" data-field={fieldId(id)}>
      {!readOnly && (
        <div className="toolbar ff-grid-toolbar" role="toolbar" aria-label={`${label} rows`}>
          <button type="button" className="btn btn-small" onClick={() => add(rows.length)} disabled={rows.length >= maxRows}><Icon name="erp.action.add-row" size={16} />Add row</button>
          <button type="button" className="btn btn-small" onClick={() => add(current)} disabled={rows.length >= maxRows}>Insert above row {current + 1}</button>
          <button type="button" className="btn btn-small" onClick={duplicate}><Icon name="erp.action.duplicate" size={16} />Duplicate {selected.size ? `${selected.size} selected` : `row ${current + 1}`}</button>
          <button type="button" className="btn btn-small" onClick={remove}><Icon name="erp.action.delete" size={16} />Delete {selected.size ? `${selected.size} selected` : `row ${current + 1}`}</button>
          <span className="muted small">{rows.length} of {maxRows} rows. Enter moves down, Alt+N adds a row, paste a block copied from Excel.</span>
        </div>
      )}
      <p className="visually-hidden" aria-live="polite" data-testid="grid-notice">{notice}</p>
      {errors[id] && <p className="ff-error" role="alert" id={`${fieldId(id)}-err`}>{errors[id]}</p>}
      <div className="ff-gridwrap" tabIndex={-1} data-no-cards="">
        <table className="ff-table" ref={table} aria-label={label}>
          <thead>
            <tr>
              {!readOnly && <th className="ff-col-select" scope="col"><span className="visually-hidden">Select</span></th>}
              <th className="ff-col-no" scope="col">#</th>
              {columns.map((c) => <th key={c.key} scope="col" className={`${c.freeze ? 'ff-freeze ' : ''}${['quantity', 'currency', 'number'].includes(c.type) ? 'num' : ''}`}>{c.label}{c.required && !readOnly ? <span className="ff-req" aria-hidden="true"> *</span> : null}</th>)}
              {rowExtra && <th scope="col">Row files</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => {
              const errs = rowErrors(r);
              return (
                <tr key={row._k ?? row.id ?? r} className={`${r === current ? 'is-current' : ''} ${errs.length ? 'has-error' : ''}`} data-row={r}>
                  {!readOnly && <td className="ff-col-select"><input type="checkbox" aria-label={`Select row ${r + 1}`} checked={selected.has(r)} onChange={() => toggle(r)} /></td>}
                  <td className="ff-col-no">{r + 1}</td>
                  {columns.map((c) => {
                    const err = errors[`${id}.${r}.${c.key}`];
                    return (
                      <td key={c.key} className={`${c.freeze ? 'ff-freeze ' : ''}${c.computed ? 'num ' : ''}${err ? 'ff-cell-invalid' : ''}`} data-label={c.label}>
                        {cell(row, r, c)}
                        {err && <span className="ff-error ff-cell-error" id={`${fieldId(`${id}.${r}.${c.key}`)}-err`}>{err}</span>}
                      </td>
                    );
                  })}
                  {rowExtra && <td>{rowExtra(row, r)}</td>}
                </tr>
              );
            })}
          </tbody>
          {totals.length > 0 && (
            <tfoot>
              <tr>
                {!readOnly && <td />}
                <th scope="row" colSpan={1 + columns.findIndex((c) => c.total)} className="ff-freeze">Total ({rows.length} {rows.length === 1 ? 'row' : 'rows'})</th>
                {columns.slice(columns.findIndex((c) => c.total)).map((c) => <td key={c.key} className="num" data-testid={c.total ? `total-${c.key}` : undefined}>{c.total ? <strong>{sums[c.key] === '•••' ? '•••' : formatNumberInput(sums[c.key], { scale: c.scale ?? 2 })}</strong> : ''}</td>)}
                {rowExtra && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
