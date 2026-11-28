import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { Link, errorInfo } from '../core/pages/ui.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { fmtDate, qa, QA_TONE } from './api.js';

// Pieces the quality pages share: the runner of a call, and the bar of an approval document (send, withdraw, cancel, amend, print, decide) with its history.
export function useRunner() {
  const qc = useQueryClient(); const [error, setError] = useState(null); const [note, setNote] = useState(null); const [busy, setBusy] = useState(false);
  const run = async (fn, done) => { setError(null); setNote(null); setBusy(true); try { const x = await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['qa'] }); qc.invalidateQueries({ queryKey: ['list'] }); return x; } catch (e) { setError(errorInfo(e)); return null; } finally { setBusy(false); } };
  return { error, setError, note, setNote, busy, run };
}
/** Loads one record of a quality document; shows the states a page must show. */
export function useRecord(kind, id, what, permission) {
  const q = useQuery({ queryKey: ['qa', kind, id], queryFn: () => qa.one(kind, id), retry: false, enabled: Boolean(id) });
  const guard = q.error?.status === 403 || q.error?.status === 404 ? <NoPermission what={what} permission={permission} /> : q.isPending ? <Skeleton label={what} rows={4} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : null;
  return { q, guard };
}
export function Status({ x }) { const t = useT('qa'); return <StatusBadge status={QA_TONE[x.status]} label={t(`st.${x.status}`)} />; }
/** The actions of a document: what the server says the person can do, the decision panel for an approver, and the history. */
export function DocBar({ kind, x, printName, extra = null, beforeDecide = null }) {
  const t = useT('qa'); const { error, setError, note, busy, run } = useRunner(); const [comment, setComment] = useState(''); const can = x.can ?? {};
  const hq = useQuery({ queryKey: ['qa', kind, 'history', x.id, x.status], queryFn: () => qa.history(kind, x.id), retry: false });
  const why = (action, msg) => { const r = globalThis.prompt(t('why')); if (r) run(() => qa.act(kind, x.id, action, { reason: r }), msg); };
  const decide = (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('sayWhy') }); return; } run(async () => { await beforeDecide?.(action); return qa.decide(x.taskId, action, comment.trim() || null); }, t(`done.${action}`)); };
  return (
    <>
      {error?.form && <p className="field-error" role="alert" data-testid="qa-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}{note && <p className="mdm-banner" role="status" data-testid="qa-note">{note}</p>}
      <div className="actions-row no-print">
        {can.submit && <button type="button" className="btn btn-primary" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} onClick={() => run(() => qa.act(kind, x.id, 'submit'), t('submitted'))} data-testid="qa-submit">{t('sendForApproval')}</button>}
        {can.withdraw && <button type="button" className="btn" disabled={busy} onClick={() => why('withdraw', t('withdrawn'))} data-testid="qa-withdraw">{t('withdraw')}</button>}
        {can.cancel && <button type="button" className="btn" disabled={busy} onClick={() => why('cancel', t('cancelled'))} data-testid="qa-cancel">{t('cancel')}</button>}
        {can.amend && <button type="button" className="btn" disabled={busy} onClick={() => why('amend', t('amended'))} data-testid="qa-amend">{t('amend')}</button>}
        {can.print && printName && <button type="button" className="btn" onClick={() => qa.exportFile(`${kind}/${x.id}/print`, printName).catch(() => globalThis.alert?.(t('exportFailed')))} data-testid="qa-print">{t('print')}</button>}
        {extra}
      </div>
      {x.approve && x.taskId && (
        <div className="mdm-panel no-print" data-testid="qa-decide"><h2>{t('decision')}</h2>
          <label>{t('comment')}<textarea value={comment} onChange={(ev) => setComment(ev.target.value)} rows={2} style={{ width: "100%" }} data-testid="qa-comment" /></label>
          <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} onClick={() => decide('approve')} data-testid="qa-approve">{t('approve')}</button><button type="button" className="btn" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} onClick={() => decide('return')} data-testid="qa-return">{t('returnIt')}</button><button type="button" className="btn" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} onClick={() => decide('reject')} data-testid="qa-reject">{t('reject')}</button></div>
        </div>
      )}
      {hq.data && (
        <div className="table-scroll" data-testid="qa-history"><table className="data-table"><caption>{t('approvals')}</caption><thead><tr><th>{t('when')}</th><th>{t('who')}</th><th>{t('event')}</th><th>{t('comment')}</th></tr></thead>
          <tbody>{[...hq.data.approvals.map((a) => ({ at: a.at, who: a.actor, what: `${a.event}${a.step_code ? ` (${a.step_code})` : ''}`, c: a.comment })), ...hq.data.audit.map((a) => ({ at: a.at, who: a.actor, what: a.action, c: a.reason }))].sort((a, b) => String(a.at).localeCompare(String(b.at))).map((h, i) => <tr key={i}><td>{fmtDate(String(h.at).slice(0, 10))}</td><td>{h.who}</td><td>{h.what}</td><td>{h.c}</td></tr>)}</tbody></table></div>
      )}
    </>
  );
}
export function Back({ to, label }) { return <Link to={to}>{label}</Link>; }
export const sel = { minHeight: 'var(--erp-target-min)' };
