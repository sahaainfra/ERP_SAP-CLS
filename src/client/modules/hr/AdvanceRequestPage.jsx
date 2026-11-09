import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { exp } from './api.js';

// Advance Request (HR, part 07.12, FR-02): a salary advance (recovered from salary in instalments by payroll) or a travel or imprest advance (settled against a claim). The manager approves, then HR (salary) or accounts, and the CFO above the limit;
// accounts record the payment and from then the advance is outstanding. A salary advance shows its instalments for payroll.
const TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', APPROVED: 'APPROVED', DISBURSED: 'ACTIVE', CLOSED: 'CLOSED', RETURNED: 'RETURNED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED' };
const inr = (n) => (n == null ? '—' : `₹ ${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export default function AdvanceRequestPage() {
  const t = useT('exp');
  const qc = useQueryClient();
  const params = new URLSearchParams(window.location.search);
  const id = Number(params.get('id')) || null;
  const q = useQuery({ queryKey: ['exp', 'advance', id], queryFn: () => exp.advance(id), enabled: Boolean(id), retry: false });
  const h = useQuery({ queryKey: ['exp', 'advance-history', id], queryFn: () => exp.advanceHistory(id), enabled: Boolean(id) && q.isSuccess, retry: false });
  const [v, setV] = useState({ type: params.get('travel') ? 'TRAVEL' : 'SALARY', amount: '', purpose: '', instalments: '1', travelRequestId: params.get('travel') ?? '' });
  const [error, setError] = useState(null); const [note, setNote] = useState(null); const loaded = useRef(false);
  const a = q.data;
  usePageTitle(a ? a.docNo : t('adv.title'));
  useEffect(() => { if (a && !loaded.current) { loaded.current = true; setV({ type: a.type, amount: String(a.amount), purpose: a.purpose, instalments: String(a.instalments), travelRequestId: a.travelRequestId ? String(a.travelRequestId) : '' }); } }, [a]);
  if (id && q.error?.status === 403) return <NoPermission what={t('adv.title')} permission="hr.advance.view" />;
  if (id && q.isPending) return <Skeleton label={t('adv.title')} rows={4} />;
  if (id && q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const editable = !id || a.can.edit;
  const body = () => ({ type: v.type, amount: Number(v.amount || 0), purpose: v.purpose.trim(), instalments: v.type === 'SALARY' ? Number(v.instalments || 1) : 1, travelRequestId: v.travelRequestId ? Number(v.travelRequestId) : null });
  const run = async (fn, done) => { setError(null); setNote(null); try { const out = await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['exp'] }); return out; } catch (e) { setError(errorInfo(e)); return null; } };
  const save = (submit) => run(async () => { const out = id ? await exp.updateAdvance(id, { ...body(), version: a.rowVersion }) : await exp.createAdvance({ ...body(), submit }); if (id && submit) await exp.advanceAct(id, 'submit'); if (!id) navigateTo(`/expenses/advance?id=${out.id}`, { force: true }); else loaded.current = false; return out; }, submit ? t('adv.sent') : t('adv.saved'));
  const per = v.type === 'SALARY' && Number(v.amount) > 0 ? Number(v.amount) / Math.max(1, Number(v.instalments || 1)) : null;
  return (
    <section aria-labelledby="ad-title" data-testid="advance" data-status={a?.status ?? 'NEW'}>
      <h1 id="ad-title">{a ? <>{a.docNo} <StatusBadge status={TONE[a.status]} label={t(`ast.${a.status}`)} /></> : t('adv.title')}</h1>
      {error?.form && <p className="field-error" role="alert" data-testid="ad-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="ad-note">{note}</p>}
      <form className="mdm-panel mdm-fields" onSubmit={(e) => { e.preventDefault(); save(false); }} data-testid="ad-form" aria-label={t('adv.title')}>
        <Field label={t('adv.kind')} name="type" error={error}><select value={v.type} disabled={!editable} onChange={(e) => setV({ ...v, type: e.target.value })} data-testid="ad-type">{['SALARY', 'TRAVEL', 'IMPREST'].map((k) => <option key={k} value={k}>{t(`atype.${k}`)}</option>)}</select></Field>
        <Field label={t('adv.amount')} name="amount" error={error}><input type="number" min="1" step="0.01" value={v.amount} disabled={!editable} onChange={(e) => setV({ ...v, amount: e.target.value })} required data-testid="ad-amount" /></Field>
        <Field label={t('claim.purpose')} name="purpose" error={error}><textarea rows="2" value={v.purpose} maxLength={300} disabled={!editable} onChange={(e) => setV({ ...v, purpose: e.target.value })} required data-testid="ad-purpose" /></Field>
        {v.type === 'SALARY' && <Field label={t('adv.instalments')} name="instalments" error={error} hint={per ? t('adv.perInstalment', { amount: inr(per) }) : t('adv.recoveredFromSalary')}><input type="number" min="1" max="36" value={v.instalments} disabled={!editable} onChange={(e) => setV({ ...v, instalments: e.target.value })} data-testid="ad-instalments" /></Field>}
        {v.type !== 'SALARY' && <p className="muted small">{t('adv.settled')}</p>}
        {v.travelRequestId && <p className="muted small">{t('adv.forTrip')}: <Link to={`/expenses/travel?id=${v.travelRequestId}`}>#{v.travelRequestId}</Link></p>}
        {editable && <div className="actions"><button type="submit" className="btn" data-testid="ad-save">{t('act.saveDraft')}</button><button type="button" className="btn btn-primary" onClick={() => save(true)} data-testid="ad-send">{t('act.saveSend')}</button></div>}
      </form>
      {a && (
        <>
          <dl className="op-figures" data-testid="ad-figures"><div><dt>{t('adv.amount')}</dt><dd>{inr(a.amount)}</dd></div><div><dt>{t('claim.outstanding')}</dt><dd data-testid="ad-outstanding">{inr(a.outstanding)}</dd></div><div><dt>{t('adv.paidOn')}</dt><dd>{a.disbursedAt ?? '—'}{a.disbursedRef ? ` · ${a.disbursedRef}` : ''}</dd></div></dl>
          {a.recoveries?.length > 0 && <><h2>{t('adv.recoveries')}</h2><ul className="mdm-list" data-testid="ad-recoveries">{a.recoveries.map((r) => <li key={r.id}>{t(`rec.${r.kind}`)} · {r.dueMonth ?? r.doneOn} · {inr(r.amount)} · {t(`recst.${r.status}`)}</li>)}</ul></>}
          <div className="actions-row no-print" data-testid="ad-actions">
            {a.can.delete && <button type="button" className="btn" onClick={() => run(async () => { await exp.removeAdvance(id); navigateTo('/expenses', { force: true }); })} data-testid="ad-delete">{t('act.delete')}</button>}
            {a.can.withdraw && <button type="button" className="btn" onClick={() => { const why = window.prompt(t('act.why')); if (why) run(() => exp.advanceAct(id, 'withdraw', { reason: why })); }} data-testid="ad-withdraw">{t('act.withdraw')}</button>}
            {a.can.cancel && <button type="button" className="btn" onClick={() => { const why = window.prompt(t('act.why')); if (why) run(() => exp.advanceAct(id, 'cancel', { reason: why })); }} data-testid="ad-cancel">{t('act.cancel')}</button>}
            {a.can.disburse && <button type="button" className="btn btn-primary" onClick={() => { const ref = window.prompt(t('claim.payRef')); if (ref) run(() => exp.advanceAct(id, 'disburse', { reference: ref }), t('adv.paidNote')); }} data-testid="ad-disburse">{t('adv.markPaid')}</button>}
            {a.can.print && <a className="btn" href={`/api/v1/hr/advances/${id}/print`} target="_blank" rel="noreferrer">{t('act.print')}</a>}
          </div>
        </>
      )}
      {h.data && (h.data.approvals.length > 0 || h.data.audit.length > 0) && <><h2>{t('act.history')}</h2><ul className="mdm-list" data-testid="ad-history">{[...h.data.approvals.map((x) => ({ at: x.at, text: `${x.event} · ${x.actor}${x.comment ? `: ${x.comment}` : ''}` })), ...h.data.audit.map((x) => ({ at: x.at, text: `${x.action} · ${x.by}${x.reason ? `: ${x.reason}` : ''}` }))].sort((x, y) => String(x.at).localeCompare(String(y.at))).map((x, i) => <li key={i}><span className="muted small">{String(x.at).slice(0, 16).replace('T', ' ')}</span> {x.text}</li>)}</ul></>}
      <p className="small"><Link to="/expenses">{t('my.title')}</Link></p>
    </section>
  );
}
