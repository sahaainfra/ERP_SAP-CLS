import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { ext } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// My Clearance Items (HR, part 07.13, FR-02, the worklist): the clearances of leavers that the person's department owns (IT, stores, accounts, admin, the project of their team, HR), oldest last working day first, red when the day has passed,
// amber within three days. Each item is cleared, marked not applicable or cleared with an amount to recover in the full-and-final; what the system knows is shown (the user account, advances outstanding, open tasks, the exit interview) and
// an item that is not done cannot be cleared. HR can waive a department with a reason.
const TONE = { RED: 'OVERDUE', AMBER: 'AT_RISK', GREEN: 'ACTIVE' };
const inr = (n) => `₹ ${Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
export default function ClearanceWorklistPage() {
  const t = useT('sep');
  usePageTitle(t('clr.title'));
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ext', 'clearances'], queryFn: ext.clearances, retry: false });
  const [edit, setEdit] = useState({}); const [error, setError] = useState(null); const [note, setNote] = useState(null);
  if (q.error?.status === 403) return <NoPermission what={t('clr.title')} permission="hr.clearance.view" />;
  const run = async (fn, done) => { setError(null); setNote(null); try { await fn(); setNote(done); setEdit({}); qc.invalidateQueries({ queryKey: ['ext'] }); } catch (e) { setError(errorInfo(e)); } };
  const val = (c, i) => edit[c.id]?.[i.code] ?? { status: i.status, note: i.note ?? '', recovery: i.recovery ? String(i.recovery) : '' };
  const setItem = (c, i, patch) => setEdit({ ...edit, [c.id]: { ...(edit[c.id] ?? {}), [i.code]: { ...val(c, i), ...patch } } });
  return (
    <section aria-labelledby="cw-title" data-testid="clearances">
      <PageHeader id="cw-title" title={t('clr.title')} />
      {error?.form && <p className="field-error" role="alert" data-testid="cw-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="cw-note">{note}</p>}
      {q.isPending ? <Skeleton label={t('clr.title')} rows={4} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : q.data.length === 0 ? <EmptyState title={t('clr.none')} message={t('clr.noneHint')} /> : (
        <ul className="mdm-list" data-testid="cw-list">{q.data.map((c) => (
          <li key={c.id} className="mdm-panel" data-testid="cw-item" data-dept={c.department} data-tone={c.tone}>
            <h2><StatusBadge status={TONE[c.tone]} label={c.daysLeft < 0 ? t('clr.late', { n: -c.daysLeft }) : t('clr.left', { n: c.daysLeft })} /> {c.name}: {c.employee} <span className="muted small">{c.employeeCode} · {c.docNo} · {t('sep.lwd')} {c.lastWorkingDay}</span></h2>
            <p className="muted small" data-testid="cw-facts">{c.facts.userActive ? t('clr.userActive') : t('clr.userGone')} · {t('clr.advances', { amount: inr(c.facts.advancesMinor / 100) })} · {t('clr.tasks', { n: c.facts.openTasks })} · {c.facts.interview ? t('clr.ivDone') : t('clr.ivMissing')}</p>
            <div className="table-wrap" tabIndex={0} role="region" aria-label={c.name}>
              <table className="grid"><thead><tr><th>{t('clr.item')}</th><th>{t('sep.status')}</th><th>{t('clr.note')}</th><th>{t('clr.recovery')}</th></tr></thead>
                <tbody>{c.items.map((i) => { const x = val(c, i); return (
                  <tr key={i.code} data-testid="cw-row" data-code={i.code}>
                    <th scope="row" data-label={t('clr.item')}>{i.label}</th>
                    <td data-label={t('sep.status')}><select value={x.status} disabled={!c.can.clear} onChange={(e) => setItem(c, i, { status: e.target.value })} aria-label={`${t('sep.status')} ${i.label}`} data-testid="cw-status"><option value="PENDING">{t('item.PENDING')}</option><option value="CLEARED">{t('item.CLEARED')}</option><option value="NA">{t('item.NA')}</option></select></td>
                    <td data-label={t('clr.note')}><input value={x.note} maxLength={300} disabled={!c.can.clear} onChange={(e) => setItem(c, i, { note: e.target.value })} aria-label={`${t('clr.note')} ${i.label}`} /></td>
                    <td data-label={t('clr.recovery')}><input type="number" min="0" step="0.01" value={x.recovery} disabled={!c.can.clear} onChange={(e) => setItem(c, i, { recovery: e.target.value })} aria-label={`${t('clr.recovery')} ${i.label}`} data-testid="cw-recovery" /></td>
                  </tr>); })}</tbody></table>
            </div>
            <div className="actions">
              {c.can.clear && <button type="button" className="btn btn-primary" onClick={() => run(() => ext.saveClearance(c.id, { items: c.items.map((i) => { const x = val(c, i); return { code: i.code, status: x.status, note: x.note || null, ...(x.recovery ? { recovery: Number(x.recovery) } : {}) }; }), version: c.rowVersion }), t('clr.saved'))} data-testid="cw-save">{t('act.save')}</button>}
              {c.can.clear && <button type="button" className="btn" onClick={() => c.items.forEach((i) => setItem(c, i, { status: 'CLEARED' }))} data-testid="cw-all">{t('clr.allCleared')}</button>}
              {c.can.waive && <button type="button" className="btn" onClick={() => { const r = window.prompt(t('act.why')); if (r) run(() => ext.waive(c.id, r), t('clr.waived')); }} data-testid="cw-waive">{t('clr.waive')}</button>}
              <Link to={`/exit/separation?id=${c.separationId}`}>{t('sep.open')}</Link>
            </div>
          </li>))}</ul>
      )}
    </section>
  );
}
