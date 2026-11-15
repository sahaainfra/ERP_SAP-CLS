import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { errorInfo } from '../core/pages/ui.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { bill, fmtDate, BILL_TONE } from './api.js';

// Pieces the billing pages share: the runner of a call, the loader of one record, and the bar of an approval document with its history.
export function useRunner() {
  const qc = useQueryClient(); const [error, setError] = useState(null); const [note, setNote] = useState(null); const [busy, setBusy] = useState(false);
  const run = async (fn, done) => { setError(null); setNote(null); setBusy(true); try { const x = await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['bill'] }); qc.invalidateQueries({ queryKey: ['list'] }); return x; } catch (e) { setError(e?.errors?.length ? { form: e.message, fields: Object.fromEntries(e.errors.map((x) => [x.field, x.message])) } : errorInfo(e)); return null; } finally { setBusy(false); } };
  return { error, setError, note, setNote, busy, run };
}
export function useRecord(kind, id, what, permission) {
  const q = useQuery({ queryKey: ['bill', kind, id], queryFn: () => bill.one(kind, id), retry: false, enabled: Boolean(id) });
  const guard = q.error?.status === 403 || q.error?.status === 404 ? <NoPermission what={what} permission={permission} /> : q.isPending ? <Skeleton label={what} rows={4} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : null;
  return { q, guard };
}
export function Status({ x }) { const t = useT('bill'); return <StatusBadge status={BILL_TONE[x.status]} label={t(`st.${x.status}`)} />; }
export const big = { minHeight: 48, fontSize: '1rem' };
export function ErrorLine({ error, id }) { return error?.form ? <p className="field-error" role="alert" data-testid={id}>{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p> : null; }
export function DocBar({ kind, x, printName, extra = null }) {
  const t = useT('bill'); const { error, setError, note, busy, run } = useRunner(); const [comment, setComment] = useState(''); const can = x.can ?? {};
  const hq = useQuery({ queryKey: ['bill', kind, 'history', x.id, x.status], queryFn: () => bill.history(kind, x.id), retry: false });
  const why = (action, msg) => { const r = globalThis.prompt(t('why')); if (r) run(() => bill.act(kind, x.id, action, { reason: r }), msg); };
  const decide = (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('sayWhy') }); return; } run(() => bill.decide(x.taskId, action, comment.trim() || null), t(`done.${action}`)); };
  return (
    <>
      <ErrorLine error={error} id="bill-error" />{note && <p className="mdm-banner" role="status" data-testid="bill-note">{note}</p>}
      <div className="actions-row no-print">
        {can.submit && <button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => bill.act(kind, x.id, 'submit'), t('submitted'))} data-testid="bill-submit">{t('sendForApproval')}</button>}
        {can.withdraw && <button type="button" className="btn" disabled={busy} onClick={() => why('withdraw', t('withdrawn'))} data-testid="bill-withdraw">{t('withdraw')}</button>}
        {can.cancel && <button type="button" className="btn" disabled={busy} onClick={() => why('cancel', t('cancelled'))} data-testid="bill-cancel">{t('cancel')}</button>}
        {can.print && printName && <button type="button" className="btn" onClick={() => bill.exportFile(`${kind}/${x.id}/print`, printName).catch(() => globalThis.alert?.(t('exportFailed')))} data-testid="bill-print">{t('print')}</button>}
        {extra}
      </div>
      {x.approve && x.taskId && (
        <div className="mdm-panel no-print" data-testid="bill-decide"><h2>{t('decision')}</h2>
          <label>{t('comment')}<textarea value={comment} onChange={(ev) => setComment(ev.target.value)} rows={2} style={{ width: '100%' }} data-testid="bill-comment" /></label>
          <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => decide('approve')} data-testid="bill-approve">{t('approve')}</button><button type="button" className="btn" style={big} disabled={busy} onClick={() => decide('return')} data-testid="bill-return">{t('returnIt')}</button><button type="button" className="btn" style={big} disabled={busy} onClick={() => decide('reject')} data-testid="bill-reject">{t('reject')}</button></div>
        </div>
      )}
      {hq.data && (
        <div className="table-scroll" data-testid="bill-history"><table className="data-table"><caption>{t('approvals')}</caption><thead><tr><th>{t('when')}</th><th>{t('who')}</th><th>{t('event')}</th><th>{t('comment')}</th></tr></thead>
          <tbody>{[...hq.data.approvals.map((a) => ({ at: a.at, who: a.actor, what: `${a.event}${a.step_code ? ` (${a.step_code})` : ''}`, c: a.comment })), ...hq.data.audit.map((a) => ({ at: a.at, who: a.actor, what: a.action, c: a.reason }))].sort((a, b) => String(a.at).localeCompare(String(b.at))).map((h, i) => <tr key={i}><td>{fmtDate(h.at)}</td><td>{h.who}</td><td>{h.what}</td><td>{h.c ?? ''}</td></tr>)}</tbody></table></div>
      )}
    </>
  );
}
