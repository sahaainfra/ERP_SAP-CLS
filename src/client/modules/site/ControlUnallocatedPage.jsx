import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { ALLOC_TONE, PRIORITY_TONE, fmtDate, fmtRs, st } from './api.js';
import { useSearch } from './parts.jsx';

// Unallocated Costs (part 14.07, FR-06, section 9): the costs that came without a WBS node or a cost code, oldest first. The quantity surveyor or project controls propose where a cost belongs and the project manager approves;
// the ledger row of the budget part is never changed, the approved allocation is what the control figures apply.
const refresh = (qc) => { qc.invalidateQueries({ queryKey: ['site'] }); qc.invalidateQueries({ queryKey: ['list'] }); };

function Alloc({ t, id }) {
  const qc = useQueryClient(); const q = useQuery({ queryKey: ['site', 'alloc', id], queryFn: () => st.alloc(id), retry: false });
  const oq = useQuery({ queryKey: ['site', 'alloc-options', q.data?.projectId], queryFn: () => st.allocOptions(q.data.projectId), enabled: Boolean(q.data?.can?.submit), retry: false });
  const hq = useQuery({ queryKey: ['site', 'alloc-history', id], queryFn: () => st.allocHistory(id), enabled: q.isSuccess, retry: false });
  const [f, setF] = useState(null); const [error, setError] = useState(null); const [note, setNote] = useState(null); const [busy, setBusy] = useState(false); const [comment, setComment] = useState('');
  usePageTitle(t('cnd.una.title'));
  if (q.error?.status === 403) return <NoPermission what={t('cnd.una.title')} permission="site.control.view" />;
  if (q.isPending) return <Skeleton label={t('cnd.una.title')} rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const a = q.data; const can = a.can; const form = f ?? { wbsId: a.allocWbsId ?? '', costCodeId: a.allocCostCodeId ?? '', note: a.note ?? '' };
  const needWbs = ['NO_WBS', 'NO_WBS_NO_COST_CODE'].includes(a.reason); const needCode = ['NO_COST_CODE', 'NO_WBS_NO_COST_CODE'].includes(a.reason);
  const run = async (fn, done) => { setError(null); setNote(null); setBusy(true); try { const x = await fn(); if (done) setNote(done); refresh(qc); return x; } catch (e) { setError(errorInfo(e)); return null; } finally { setBusy(false); } };
  const decide = (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('dpr.sayWhy') }); return; } run(() => st.decide(a.taskId, action, comment.trim() || null), t(`dpr.done.${action}`)); };
  const submit = (e) => { e.preventDefault(); run(() => st.allocSubmit(a.id, { wbsId: form.wbsId ? Number(form.wbsId) : null, costCodeId: form.costCodeId ? Number(form.costCodeId) : null, note: form.note.trim() || null, rowVersion: a.rowVersion }), t('act.sent')); };
  return (
    <div data-testid="alloc-object" data-status={a.status}>
      <h1 id="una-h">{a.projectCode} · {a.docRef ?? a.sourceId} <StatusBadge status={ALLOC_TONE[a.status]} label={t(`cnd.una.s.${a.status}`)} /> <StatusBadge status={PRIORITY_TONE[a.priority]} label={t(`cnd.una.p.${a.priority}`)} /></h1>
      <p><Link to="/site/control-unallocated">{t('cnd.una.back')}</Link></p>
      <dl className="kv" data-testid="alloc-figures"><div><dt>{t('cnd.ctl.amount')}</dt><dd data-testid="alloc-amount">{fmtRs(a.amount)}</dd></div><div><dt>{t('cnd.una.source')}</dt><dd>{a.sourceType} {a.sourceId}</dd></div><div><dt>{t('cnd.una.vendor')}</dt><dd>{a.vendor ?? '—'}</dd></div><div><dt>{t('cnd.ctl.date')}</dt><dd>{fmtDate(a.date)} ({t('cnd.una.age', { n: a.ageDays })})</dd></div><div><dt>{t('cnd.una.why')}</dt><dd>{t(`cnd.una.r.${a.reason}`)}</dd></div>{a.allocatedTo && <div><dt>{t('cnd.una.allocTo')}</dt><dd data-testid="alloc-to">{[a.allocatedTo.wbs, a.allocatedTo.costCode].filter(Boolean).join(' · ')}</dd></div>}{a.approvedBy && <div><dt>{t('wa.approvedBy')}</dt><dd>{a.approvedBy}</dd></div>}</dl>
      {a.note && <p>{a.note}</p>}{error?.form && <p className="field-error" role="alert" data-testid="alloc-error">{error.form}</p>}{note && <p className="mdm-banner" role="status" data-testid="alloc-note">{note}</p>}
      {can.submit && (
        <form className="mdm-panel no-print" onSubmit={submit} data-testid="alloc-form" aria-label={t('cnd.una.propose')}><h2>{t('cnd.una.propose')}</h2><p className="muted">{t('cnd.una.proposeHelp')}</p>
          <div className="form-grid">
            {(needWbs || a.reason === 'NO_COST_CODE') && <Field label={t('cnd.ctl.wbs')} name="wbsId" error={error}><select value={form.wbsId} disabled={!needWbs} onChange={(e) => setF({ ...form, wbsId: e.target.value })} data-testid="alloc-wbs"><option value="">{t('cnd.una.choose')}</option>{(oq.data?.wbs ?? []).map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}</select></Field>}
            {(needCode || a.reason === 'NO_WBS') && <Field label={t('cnd.una.costCode')} name="costCodeId" error={error}><select value={form.costCodeId} disabled={!needCode} onChange={(e) => setF({ ...form, costCodeId: e.target.value })} data-testid="alloc-code"><option value="">{t('cnd.una.choose')}</option>{(oq.data?.costCodes ?? []).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></Field>}
            <Field label={t('wa.note')} name="note"><input value={form.note} maxLength={500} onChange={(e) => setF({ ...form, note: e.target.value })} data-testid="alloc-note-input" /></Field>
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy} data-testid="alloc-submit">{t('act.submit')}</button>
        </form>
      )}
      <div className="actions-row no-print">
        {can.withdraw && <button type="button" className="btn" onClick={() => { const x = window.prompt(t('act.why')); if (x) run(() => st.allocWithdraw(a.id, x)); }} data-testid="alloc-withdraw">{t('act.withdraw')}</button>}
        {a.workflowInstanceId && <Link to={`/workflow/instance?id=${a.workflowInstanceId}`}>{t('act.approval')}</Link>}<Link to={`/site/control?projectId=${a.projectId}`}>{t('cnd.ctl.title')}</Link>
      </div>
      {a.taskId && (
        <div className="mdm-panel no-print" data-testid="alloc-decide"><h2>{t('dpr.decide')}</h2>
          <label>{t('mb.comment')}<input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} style={{ minHeight: 44 }} data-testid="alloc-comment" /></label>
          <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('approve')} data-testid="alloc-approve">{t('mb.approve')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('return')} data-testid="alloc-return">{t('mb.return')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('reject')} data-testid="alloc-reject">{t('mb.reject')}</button></div>
        </div>
      )}
      {hq.data && (hq.data.approvals.length > 0 || hq.data.audit.length > 0) && (
        <div className="table-scroll"><table className="data-table" data-testid="alloc-history"><caption>{t('wa.history')}</caption><thead><tr><th>{t('wa.when')}</th><th>{t('wa.who')}</th><th>{t('wa.what')}</th><th>{t('wa.note')}</th></tr></thead>
          <tbody>{[...hq.data.audit.map((x) => ({ at: x.at, who: x.actor, what: x.action, note: x.reason })), ...hq.data.approvals.map((x) => ({ at: x.at, who: x.actor, what: `${x.event}${x.step_code ? ` (${x.step_code})` : ''}`, note: x.comment }))].sort((x, y) => String(x.at).localeCompare(String(y.at))).map((r, i) => <tr key={i}><td>{String(r.at ?? '').slice(0, 16).replace('T', ' ')}</td><td>{r.who}</td><td>{r.what}</td><td>{r.note ?? ''}</td></tr>)}</tbody></table></div>
      )}
    </div>
  );
}

export default function ControlUnallocatedPage() {
  const t = useT('site'); usePageTitle(t('cnd.una.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession();
  if (id) return <section aria-labelledby="una-h" data-testid="site-control-unallocated"><Alloc key={id} t={t} id={id} /></section>;
  return (
    <section aria-labelledby="una-h" data-testid="site-control-unallocated">
      <h1 id="una-h">{t('cnd.una.title')}</h1><p className="muted">{t('cnd.una.intro')}</p>
      <div className="actions-row no-print"><Link to="/site/control">{t('cnd.ctl.title')}</Link> <Link to="/site/control-variance">{t('cnd.cvr.title')}</Link></div>
      <ListReport listCode="site.control_unallocated" endpoint="/site/control/unallocated" title={t('cnd.una.title')} session={session.data} rowHref={(r) => `/site/control-unallocated?id=${r.id}`} onOpen={(r) => navigateTo(`/site/control-unallocated?id=${r.id}`)}
        cardFields={['project', 'doc', 'amount', 'ageDays', 'reason']} statusKey="status" empty={{ title: t('cnd.una.emptyTitle'), text: t('cnd.una.emptyBody') }} />
    </section>
  );
}
