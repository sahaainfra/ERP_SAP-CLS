import { useEffect, useState } from 'react';
import { api } from '../../platform/api/index.js';
import Icon from '../../platform/design/Icon.jsx';
import { navigateTo } from '../core/pages/ui.jsx';
import { downloadReport } from '../bi/api.js';

// Shared by the go-live consoles of module M30 (parts 30.01-30.03): the API calls, the URL parameters, the parameter panel (a bottom sheet on a
// phone, inline on a desktop, standard §3.5) and the status words → the shared status tones.

export const read = async (path) => (await api.get(path)).data;
export const post = async (path, body = {}) => (await api.post(path, body, { headers: { 'idempotency-key': globalThis.crypto.randomUUID() } })).data;
export const qs = (o) => { const p = new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v != null)); const s = p.toString(); return s ? `?${s}` : ''; };
export const download = (path, params, name) => downloadReport(`/api/v1${path}${qs(params)}`, name);
/** Change the page's parameters in the address (so a filter survives a refresh and can be shared). */
export const go = (base, patch) => {
  const p = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(patch)) { if (v === '' || v == null) p.delete(k); else p.set(k, String(v)); }
  if (!('page' in patch)) p.delete('page');
  navigateTo(`${base}${p.toString() ? `?${p}` : ''}`);
};
/** The status words of these consoles shown with the shared tones. */
export const TONE = { PASS: 'APPROVED', GREEN: 'APPROVED', FAIL: 'REJECTED', RED: 'REJECTED', BROKEN: 'REJECTED', REKEYED: 'REJECTED', ERROR: 'REJECTED', NO_DATA: 'DRAFT', NOT_EXERCISED: 'DRAFT', NOT_TESTED: 'DRAFT', NOT_INSTALLED: 'CANCELLED', PENDING: 'SUBMITTED', SENT: 'SUBMITTED', QUEUED: 'SUBMITTED', RUNNING: 'SUBMITTED', SKIPPED: 'CANCELLED', INFO: 'DRAFT', OPEN: 'REJECTED', FIXED: 'APPROVED', RESCHEDULED: 'AT_RISK', RESCHEDULE_REQUESTED: 'SUBMITTED' };
export const COLOUR = { PASS: 'var(--erp-color-status-success-solid)', FAIL: 'var(--erp-color-status-error-solid)', OTHER: 'var(--erp-color-border-strong)' };

export function useNarrow(query = '(max-width: 767px)') {
  const [on, setOn] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false));
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia(query); const f = () => setOn(mq.matches);
    mq.addEventListener('change', f); return () => mq.removeEventListener('change', f);
  }, [query]);
  return on;
}

/** The parameter panel: inline on a desktop; on a phone a button with the number of parameters set that opens a bottom sheet. */
export function ParamPanel({ label, count = 0, done, children, testid }) {
  const narrow = useNarrow();
  const [open, setOpen] = useState(false);
  if (!narrow) return <div className="actions-row" role="group" aria-label={label} data-testid={testid}>{children}</div>;
  return <>
    <div className="actions-row"><button type="button" className="btn" onClick={() => setOpen(true)} aria-haspopup="dialog" data-testid={`${testid}-open`}><Icon name="erp.action.filter" size={16} />{label}{count ? ` (${count})` : ''}</button></div>
    {open && <div className="lr-sheet-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />}
    <div className={`lr-sheet${open ? ' is-open' : ''}`} role="dialog" aria-modal={open ? 'true' : undefined} aria-label={label} hidden={!open} data-testid={testid}>
      <div className="lr-sheet-head"><strong>{label}</strong><button type="button" className="btn btn-small" onClick={() => setOpen(false)} data-testid={`${testid}-close`}>{done}</button></div>
      <div className="form-grid">{children}</div>
    </div>
  </>;
}

/** Pill tabs (standard M-06) bound to a URL parameter. */
export function PillTabs({ label, tabs, value, onChange, testid }) {
  return <div role="tablist" aria-label={label} className="tabs" data-testid={testid}>
    {tabs.map(([k, text]) => <button key={k} type="button" role="tab" aria-selected={value === k} data-tab={k} className={`btn${value === k ? ' btn-primary' : ''}`} onClick={() => onChange(k)}>{text}</button>)}
  </div>;
}

/** Previous / next of a server page. */
export function Pager({ page, pageSize, total, onPage, t, testid }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return <nav className="actions-row" aria-label={t('pager')} data-testid={testid}>
    <button type="button" className="btn" disabled={page <= 1} onClick={() => onPage(page - 1)}>{t('prev')}</button>
    <span className="muted">{t('pageOf', { page, pages })}</span>
    <button type="button" className="btn" disabled={page >= pages} onClick={() => onPage(page + 1)}>{t('next')}</button>
  </nav>;
}
