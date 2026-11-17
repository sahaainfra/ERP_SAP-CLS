import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { exp } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Claim Approvals (HR, part 07.12, the worklist): what waits for the person's decision (claims, advances, travel requests), with the policy flags of each claim and the reasons the claimant gave, so that the approver sees the deviations; approve, return
// or reject one or many. For the accounts manager also: the approved claims to pass for payment, the passed ones to mark paid, and the approved advances to record as paid out.
const inr = (n) => (n == null ? '—' : `₹ ${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export default function ClaimApprovalsPage() {
  const t = useT('exp');
  usePageTitle(t('appr.title'));
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['exp', 'approvals'], queryFn: exp.approvals, retry: false });
  const [picked, setPicked] = useState([]); const [comment, setComment] = useState(''); const [note, setNote] = useState(null); const [error, setError] = useState(null);
  if (q.error?.status === 403) return <NoPermission what={t('appr.title')} permission="hr.claim.approve" />;
  const d = q.data;
  const run = async (fn, done) => { setError(null); setNote(null); try { await fn(); setNote(done); setPicked([]); qc.invalidateQueries({ queryKey: ['exp'] }); } catch (e) { setError(errorInfo(e)); } };
  const decide = (decision) => {
    if (decision !== 'APPROVE' && comment.trim().length < 5) { setError({ form: t('appr.reasonFirst') }); return; }
    run(async () => { const r = await exp.bulk({ taskIds: picked, decision, comment: comment.trim() || undefined }); if (r.failed) throw Object.assign(new Error(r.results.filter((x) => !x.ok).map((x) => x.error).join('; ')), { status: 422 }); }, t('appr.done', { n: picked.length }));
  };
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <section aria-labelledby="ca-title" data-testid="approvals">
      <PageHeader id="ca-title" title={t('appr.title')} />
      {error?.form && <p className="field-error" role="alert" data-testid="ca-error">{error.form}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="ca-note">{note}</p>}
      {q.isPending ? <Skeleton label={t('appr.title')} rows={4} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
        <>
          <h2>{t('appr.waiting')}</h2>
          {d.items.length === 0 ? <EmptyState title={t('appr.none')} message={t('appr.noneHint')} /> : (
            <>
              <div className="table-wrap" tabIndex={0} role="region" aria-label={t('appr.waiting')}>
                <table className="grid" data-testid="ca-table"><thead><tr><th><span className="sr-only">{t('appr.pick')}</span></th><th>{t('appr.record')}</th><th>{t('appr.employee')}</th><th>{t('claim.amount')}</th><th>{t('claim.flag')}</th></tr></thead>
                  <tbody>{d.items.map((x) => (
                    <tr key={x.taskId} data-testid="ca-row" data-kind={x.kind} data-flags={x.flags.length}>
                      <td data-label={t('appr.pick')}><input type="checkbox" checked={picked.includes(x.taskId)} onChange={() => toggle(x.taskId)} aria-label={`${t('appr.pick')} ${x.docNo}`} data-testid="ca-pick" /></td>
                      <th scope="row" data-label={t('appr.record')}><Link to={`/expenses/${x.kind}?id=${x.docId}`}>{x.docNo}</Link> <span className="muted small">{t(`appr.kind.${x.kind}`)} · {x.title}</span></th>
                      <td data-label={t('appr.employee')}>{x.employee} <span className="muted small">{x.employeeCode}</span></td>
                      <td data-label={t('claim.amount')}>{inr(x.amount)}{x.kind === 'claim' ? <span className="muted small"> · {t('claim.net')} {inr(x.netPayable)}</span> : null}</td>
                      <td data-label={t('claim.flag')}>{x.flags.length === 0 ? '—' : <ul className="mdm-list">{x.flags.map((f) => <li key={f.lineNo}><StatusBadge status="AT_RISK" label={t(`flag.${f.flag}`)} /> {t('claim.line', { n: f.lineNo })}: {f.text}{f.justification ? ` — ${f.justification}` : ''}</li>)}</ul>}</td>
                    </tr>))}</tbody></table>
              </div>
              <div className="mdm-fields no-print"><label>{t('appr.comment')} <textarea rows="2" value={comment} onChange={(e) => setComment(e.target.value)} data-testid="ca-comment" /></label></div>
              <div className="actions-row no-print" data-testid="ca-bulk"><button type="button" className="btn btn-primary" disabled={picked.length === 0} onClick={() => decide('APPROVE')} data-testid="ca-approve">{t('appr.approve')}</button><button type="button" className="btn" disabled={picked.length === 0} onClick={() => decide('RETURN')} data-testid="ca-return">{t('appr.return')}</button><button type="button" className="btn" disabled={picked.length === 0} onClick={() => decide('REJECT')} data-testid="ca-reject">{t('appr.reject')}</button></div>
            </>
          )}
          {d.toPass.length > 0 && <><h2>{t('appr.toPass')}</h2><ul className="mdm-list" data-testid="ca-topass">{d.toPass.map((c) => <li key={c.id} data-testid="ca-pass-row"><Link to={`/expenses/claim?id=${c.id}`}>{c.docNo}</Link> · {c.employee} · {t('claim.net')} {inr(c.netPayable)} <button type="button" className="btn btn-small btn-primary" onClick={() => run(() => exp.claimAct(c.id, 'pass'), t('claim.passed'))} data-testid="ca-pass">{t('claim.pass')}</button></li>)}</ul></>}
          {d.toPay.length > 0 && <><h2>{t('appr.toPay')}</h2><ul className="mdm-list" data-testid="ca-topay">{d.toPay.map((c) => <li key={c.id}><Link to={`/expenses/claim?id=${c.id}`}>{c.docNo}</Link> · {c.employee} · {inr(c.netPayable)} <button type="button" className="btn btn-small" onClick={() => { const ref = window.prompt(t('claim.payRef')); if (ref) run(() => exp.claimAct(c.id, 'paid', { reference: ref }), t('claim.paidNote')); }} data-testid="ca-paid">{t('claim.markPaid')}</button></li>)}</ul></>}
          {d.toDisburse.length > 0 && <><h2>{t('appr.toDisburse')}</h2><ul className="mdm-list" data-testid="ca-todisburse">{d.toDisburse.map((a) => <li key={a.id}><Link to={`/expenses/advance?id=${a.id}`}>{a.docNo}</Link> · {a.employee} · {t(`atype.${a.type}`)} {inr(a.amount)} <button type="button" className="btn btn-small" onClick={() => { const ref = window.prompt(t('claim.payRef')); if (ref) run(() => exp.advanceAct(a.id, 'disburse', { reference: ref }), t('adv.paidNote')); }} data-testid="ca-disburse">{t('adv.markPaid')}</button></li>)}</ul></>}
        </>
      )}
      <p className="small"><Link to="/expenses">{t('my.title')}</Link></p>
    </section>
  );
}
