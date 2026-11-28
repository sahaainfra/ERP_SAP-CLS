import { useState } from 'react';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { gl } from './api.js';

// Small pieces shared by the finance pages of parts 23.11 to 23.15: the guard of a query, pill tabs, a definition list, the decision panel of an approval.
export const big = { minHeight: 'var(--erp-target-large)', fontSize: '1rem' };
export const can = (session, p) => Boolean(session?.permissions?.includes(p));
export const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
export const lastMonth = () => { const d = new Date(`${istToday().slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };
export const fyStartOf = (t) => { const y = Number(t.slice(0, 4)); return `${Number(t.slice(5, 7)) >= 4 ? y : y - 1}-04-01`; };
export const pct = (v) => (v == null ? '—' : `${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })} %`);
export const guardOf = (q, what, permission) => (q.error?.status === 403 || q.error?.status === 404 ? <NoPermission what={what} permission={permission} /> : q.isPending ? <Skeleton label={what} rows={4} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : null);
export const Pills = ({ tabs, tab, setTab, label, prefix }) => <div className="actions-row" role="tablist" aria-label={label}>{tabs.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`btn${tab === k ? ' btn-primary' : ''}`} style={{ minHeight: 'var(--erp-target-min)' }} onClick={() => setTab(k)} data-testid={`${prefix}-${k}`}>{l}</button>)}</div>;
export const Rows = ({ rows }) => <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(8rem, max-content) 1fr', gap: '4px 12px', margin: 0 }}>{rows.filter(([, v]) => v != null && v !== '').map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt className="muted">{k}</dt><dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{v}</dd></div>)}</dl>;
/** The decision panel of a record waiting for the viewer's approval; `t` gives the texts `<p>.decision` etc. of the page's area. */
export function Decide({ x, run, busy, t, p, testid }) {
  const [comment, setComment] = useState(''); const [err, setErr] = useState(null);
  if (!x?.can?.approve || !x.can.taskId) return null;
  const go = (a) => { if (a !== 'approve' && comment.trim().length < 5) { setErr(t(`${p}.sayWhy`)); return; } run(() => gl.decide(x.can.taskId, a, comment.trim() || null), t(`${p}.done.${a}`)); };
  return <div className="mdm-panel no-print" data-testid={testid}><h2>{t(`${p}.decision`)}</h2>{err && <p className="field-error" role="alert">{err}</p>}<label>{t(`${p}.comment`)}<textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} style={{ width: '100%', fontSize: '1rem' }} /></label>
    <div className="actions-row ff-actionbar"><button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => go('approve')} data-testid={`${testid}-approve`}>{t(`${p}.approve`)}</button><button type="button" className="btn" style={big} disabled={busy} onClick={() => go('return')}>{t(`${p}.return`)}</button><button type="button" className="btn" style={big} disabled={busy} onClick={() => go('reject')}>{t(`${p}.reject`)}</button></div></div>;
}
