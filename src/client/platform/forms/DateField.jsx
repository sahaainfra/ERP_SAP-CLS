import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/index.js';
import Icon from '../design/Icon.jsx';
import { FieldShell } from './fields.jsx';
import { MONTH_NAMES, addDays, formatBusinessDate, isoOf, monthGrid, parseTypedDate, todayIst } from './dates.js';

const pad = (n) => String(n).padStart(2, '0');

/** The holidays of a month for a place (GET /core/holidays), shared by every date field on the page. */
function useMonthHolidays(year, month, siteId) {
  const from = `${year}-${pad(month + 1)}-01`;
  const to = isoOf(year, month, new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return useQuery({
    queryKey: ['core', 'holidays', from, to, siteId ?? ''],
    queryFn: async () => (await api.get(`/core/holidays?from=${from}&to=${to}${siteId ? `&siteId=${siteId}` : ''}`)).data,
    staleTime: 10 * 60_000,
    retry: false,
  });
}

/** A month calendar: holidays marked and named, Sundays shaded, today ringed; arrows, Page Up/Down, Home/End, Enter and Escape. */
function Calendar({ id, value, min, max, siteId, onPick, onClose }) {
  const start = value || todayIst();
  const [focus, setFocus] = useState(start);
  const year = Number(focus.slice(0, 4));
  const month = Number(focus.slice(5, 7)) - 1;
  const holidays = useMonthHolidays(year, month, siteId);
  const byDate = new Map((holidays.data ?? []).map((h) => [h.date, h]));
  const grid = useRef(null);
  const today = todayIst();
  useEffect(() => { grid.current?.querySelector(`[data-iso="${focus}"]`)?.focus(); }, [focus]);
  const outOfRange = (iso) => (min && iso < min) || (max && iso > max);
  const moveMonth = (n) => {
    const d = new Date(Date.UTC(year, month + n, 1));
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    setFocus(isoOf(d.getUTCFullYear(), d.getUTCMonth(), Math.min(Number(focus.slice(8, 10)), last)));
  };
  const onKey = (e) => {
    const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (moves[e.key]) { e.preventDefault(); setFocus(addDays(focus, moves[e.key])); }
    else if (e.key === 'PageUp') { e.preventDefault(); moveMonth(-1); }
    else if (e.key === 'PageDown') { e.preventDefault(); moveMonth(1); }
    else if (e.key === 'Home') { e.preventDefault(); setFocus(`${focus.slice(0, 8)}01`); }
    else if (e.key === 'End') { e.preventDefault(); setFocus(isoOf(year, month, new Date(Date.UTC(year, month + 1, 0)).getUTCDate())); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!outOfRange(focus)) onPick(focus); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };
  const monthHolidays = (holidays.data ?? []);
  return (
    <div className="cal" role="dialog" aria-modal="false" aria-label={`Choose a date, ${MONTH_NAMES[month]} ${year}`} id={`${id}-calendar`}>
      <div className="cal-head">
        <button type="button" className="btn btn-small" onClick={() => moveMonth(-1)} aria-label="Previous month"><Icon name="erp.action.previous" size={16} /></button>
        <strong aria-live="polite">{MONTH_NAMES[month]} {year}</strong>
        <button type="button" className="btn btn-small" onClick={() => moveMonth(1)} aria-label="Next month"><Icon name="erp.action.next" size={16} /></button>
      </div>
      <table className="cal-grid" role="grid" ref={grid} onKeyDown={onKey}>
        <thead><tr>{['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => <th key={d} scope="col" abbr={d}>{d}</th>)}</tr></thead>
        <tbody>
          {monthGrid(year, month).map((week) => (
            <tr key={week[0].iso}>
              {week.map((d) => {
                const h = byDate.get(d.iso);
                const cls = ['cal-day', d.inMonth ? '' : 'cal-out', d.weekday === 0 ? 'cal-off' : '', h ? 'cal-holiday' : '', d.iso === today ? 'cal-today' : '', d.iso === value ? 'cal-selected' : ''].filter(Boolean).join(' ');
                return (
                  <td key={d.iso} role="gridcell" aria-selected={d.iso === value}>
                    <button type="button" className={cls} data-iso={d.iso} tabIndex={d.iso === focus ? 0 : -1} disabled={outOfRange(d.iso)} title={h ? `${h.name} (${h.calendar})` : undefined}
                      aria-label={`${formatBusinessDate(d.iso)}${h ? `, holiday: ${h.name}` : ''}${d.weekday === 0 ? ', Sunday' : ''}`} onClick={() => onPick(d.iso)}>
                      {d.day}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="cal-foot">
        {monthHolidays.length > 0
          ? <ul className="cal-holidays" aria-label="Holidays this month">{monthHolidays.map((h) => <li key={h.date}><span className="cal-dot" aria-hidden="true" /> {formatBusinessDate(h.date)}: {h.name}</li>)}</ul>
          : <span className="muted small">{holidays.isPending ? 'Loading holidays...' : holidays.isError ? 'Holidays could not be loaded.' : 'No holidays this month.'}</span>}
        <div className="actions">
          <button type="button" className="btn btn-small" onClick={() => onPick(today)} disabled={outOfRange(today)}>Today</button>
          <button type="button" className="btn btn-small" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

/**
 * A business date: typed as people write it (31-10-2026, 31 Oct 2026) or picked from the calendar, shown as DD-MMM-YYYY and kept as
 * YYYY-MM-DD. Holidays of the place (`siteId`) are marked in the calendar. Text that is not a date stays so the error can name it.
 */
export function DateField({ id, label, value, onChange, onBlur, error, hint, required, disabled, readOnly, min, max, siteId, demo }) {
  const [text, setText] = useState(null);
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const shown = text ?? (/^\d{4}-\d{2}-\d{2}$/.test(value ?? '') ? formatBusinessDate(value) : (value ?? ''));
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!wrap.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const commit = (raw) => {
    const iso = parseTypedDate(raw);
    setText(null);
    onChange(iso ?? raw);
  };
  return (
    <FieldShell id={id} label={label} required={required} hint={hint ?? 'DD-MMM-YYYY, for example 31-Oct-2026'} error={error} readOnly={readOnly} text={formatBusinessDate(value)}>
      {(aria) => (
        <div className="ff-date" ref={wrap}>
          <span className={`ff-affix${disabled ? ' is-disabled' : ''}`}>
            <input id={id} name={id} className={`ff-input${demo === 'focus' ? ' is-focus' : ''}`} value={shown} disabled={disabled} required={required} autoComplete="off" {...aria}
              onChange={(e) => setText(e.target.value)}
              onBlur={(e) => { if (text !== null) commit(text); onBlur?.(e); }}
              onKeyDown={(e) => { if (e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); setOpen(true); } if (e.key === 'Enter' && text !== null) { e.preventDefault(); commit(text); } }} />
            <button type="button" className="ff-suffix-btn" aria-label={`Open the calendar for ${label}`} aria-expanded={open} aria-controls={`${id}-calendar`} disabled={disabled} onClick={() => setOpen(!open)}>
              <Icon name="erp.action.calendar" size={16} />
            </button>
          </span>
          {open && <Calendar id={id} value={/^\d{4}-\d{2}-\d{2}$/.test(value ?? '') ? value : ''} min={min} max={max} siteId={siteId} onClose={() => { setOpen(false); document.getElementById(id)?.focus(); }} onPick={(iso) => { setText(null); onChange(iso); setOpen(false); document.getElementById(id)?.focus(); }} />}
        </div>
      )}
    </FieldShell>
  );
}

/** A period: from and to, the end never before the start. The value is { from, to }. */
export function DateRangeField({ id, label, value = {}, onChange, error, hint, required, disabled, readOnly, siteId, demo }) {
  const v = value ?? {};
  const rangeError = v.from && v.to && /^\d{4}/.test(v.from) && /^\d{4}/.test(v.to) && v.to < v.from ? 'The end date cannot be before the start date' : null;
  if (readOnly) return <FieldShell id={id} label={label} readOnly text={v.from || v.to ? `${formatBusinessDate(v.from) || '...'} to ${formatBusinessDate(v.to) || '...'}` : ''} />;
  return (
    <fieldset className={`ff ff-range ${error || rangeError ? 'ff-invalid' : ''}`} data-field={id}>
      <legend className="ff-label">{label}{required && <span className="ff-req" aria-hidden="true"> *</span>}</legend>
      <div className="ff-range-row">
        <DateField id={`${id}-from`} label="From" value={v.from} onChange={(from) => onChange({ ...v, from })} disabled={disabled} siteId={siteId} demo={demo} hint=" " />
        <DateField id={`${id}-to`} label="To" value={v.to} onChange={(to) => onChange({ ...v, to })} min={/^\d{4}/.test(v.from ?? '') ? v.from : undefined} disabled={disabled} siteId={siteId} hint=" " />
      </div>
      {hint && <span className="ff-hint">{hint}</span>}
      {(error || rangeError) && <span className="ff-error" role="alert">{error ?? rangeError}</span>}
    </fieldset>
  );
}
