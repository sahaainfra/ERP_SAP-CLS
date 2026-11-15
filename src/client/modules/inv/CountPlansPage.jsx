import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { COUNT_TONE, cn, download, fmtDate, fmtQty, fmtRs, iv, today } from './api.js';
import { History, useRunner } from './InvParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Count Plans (part 16.06, FR-01 to FR-04): the list with the counts that are due, a new plan, and the plan with its start, closing, variance review, the reasons and the adjustment.
function NewPlan({ t, onDone }) {
  const sq = useQuery({ queryKey: ['inv', 'stores-pick'], queryFn: iv.stores, retry: false }); const { error, run, busy } = useRunner(); const [f, setF] = useState({ storeId: '', type: 'FULL', abcClass: 'A', scheduledDate: today() }); const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const go = async () => { const d = await run(() => cn.create({ storeId: Number(f.storeId), type: f.type, ...(f.type === 'CYCLE' ? { abcClass: f.abcClass } : {}), scheduledDate: f.scheduledDate })); if (d) onDone(d); };
  return (
    <div className="mdm-panel" data-testid="plan-new"><h2>{t('cn.newTitle')}</h2>{error?.form && <p className="field-error" role="alert" data-testid="plan-new-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
      <div className="form-grid">
        <Field label={t('tr.store')} name="storeId" error={error}><select value={f.storeId} onChange={(ev) => set('storeId', ev.target.value)} style={{ minHeight: 44 }} data-testid="plan-store"><option value="">—</option>{(sq.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></Field>
        <Field label={t('cn.type')} name="type" error={error}><select value={f.type} onChange={(ev) => set('type', ev.target.value)} style={{ minHeight: 44 }} data-testid="plan-type"><option value="FULL">{t('cn.t.FULL')}</option><option value="CYCLE">{t('cn.t.CYCLE')}</option></select></Field>
        {f.type === 'CYCLE' && <Field label={t('cn.class')} name="abcClass" error={error}><select value={f.abcClass} onChange={(ev) => set('abcClass', ev.target.value)} style={{ minHeight: 44 }} data-testid="plan-class">{['A', 'B', 'C'].map((c) => <option key={c} value={c}>{t('cn.classN', { c })}</option>)}</select></Field>}
        <Field label={t('cn.scheduled')} name="scheduledDate" error={error}><input type="date" value={f.scheduledDate} onChange={(ev) => set('scheduledDate', ev.target.value)} style={{ minHeight: 44 }} data-testid="plan-date" /></Field></div>
      <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy || !f.storeId} onClick={go} data-testid="plan-create">{t('cn.create')}</button></div></div>
  );
}
function Plan({ t, id }) {
  const q = useQuery({ queryKey: ['inv', 'plan', id], queryFn: () => cn.plan(id), retry: false }); const hq = useQuery({ queryKey: ['inv', 'plan-history', id, q.data?.status], queryFn: () => cn.history(id), enabled: q.isSuccess, retry: false });
  const { error, setError, note, busy, run } = useRunner(); const [comment, setComment] = useState(''); const [reasons, setReasons] = useState({}); usePageTitle(t('cn.title'));
  if (q.error?.status === 403 || q.error?.status === 404) return <NoPermission what={t('cn.title')} permission="inv.count_plan.view" />;
  if (q.isPending) return <Skeleton label={t('cn.title')} rows={4} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const x = q.data; const can = x.can; const withBook = x.lines.some((l) => l.bookQty !== undefined); const why = (action, msg) => { const r = window.prompt(t('why')); if (r) run(() => cn.act(x.id, action, { reason: r }), msg); };
  const decide = (taskId, action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('sayWhy') }); return; } run(() => iv.decide(taskId, action, comment.trim() || null), t(`done.${action}`)); };
  const varLines = x.lines.filter((l) => l.varianceQty);
  const saveReasons = async () => { const list = varLines.map((l) => ({ lineId: l.id, reason: (reasons[l.id] ?? l.reason ?? '').trim() })).filter((r) => r.reason); return run(() => cn.review(x.id, list), t('cn.reasonsSaved')); };
  return (
    <div data-testid="plan-object" data-status={x.status}>
      <PageHeader id="plan-h" title={<>{x.docNo} <StatusBadge status={COUNT_TONE[x.status]} label={t(`cn.s.${x.status}`)} /></>} meta={<><Link to="/inv/count-plans">{t('cn.title')}</Link> · {x.store} · {t(`cn.t.${x.type}`)}{x.abcClass ? ` · ${t('cn.classN', { c: x.abcClass })}` : ''}</>} />
      {error?.form && <p className="field-error" role="alert" data-testid="plan-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}{note && <p className="mdm-banner" role="status" data-testid="plan-note">{note}</p>}
      <dl className="kv"><div><dt>{t('cn.scheduled')}</dt><dd>{fmtDate(x.scheduledDate)}</dd></div><div><dt>{t('cn.freeze')}</dt><dd>{x.freeze ? t('cn.yes') : t('cn.no')}</dd></div><div><dt>{t('cn.tolerance')}</dt><dd>{x.tolerancePct}%</dd></div><div><dt>{t('cn.progress')}</dt><dd data-testid="plan-progress">{x.countedLines}/{x.lineCount} · {t('cn.recountLines', { n: x.recountLines })}</dd></div><div><dt>{t('g.requestedBy')}</dt><dd>{x.requestedBy}</dd></div>{x.adjustment && <div><dt>{t('cn.adjustment')}</dt><dd data-testid="plan-adjustment"><Link to={`/inv/adjustments?id=${x.adjustment.id}`}>{x.adjustment.doc_no}</Link> · {x.adjustment.status}</dd></div>}</dl>
      {x.status === 'COUNTING' && x.freeze && <p className="mdm-banner" role="status" data-testid="plan-frozen">{t('cn.frozenNote')}</p>}
      {x.lines.length > 0 && <div className="table-scroll"><table className="data-table" data-testid="plan-lines"><caption>{t('r.lines')}</caption><thead><tr><th>{t('item')}</th><th>{t('cn.bin')}</th><th>{t('cn.class')}</th>{withBook && <th className="num">{t('cn.book')}</th>}<th className="num">{t('cn.counted')}</th><th className="num">{t('cn.recount')}</th>{withBook && <><th className="num">{t('cn.variance')}</th><th className="num">{t('r.value')}</th><th>{t('cn.reason')}</th></>}</tr></thead>
        <tbody>{x.lines.map((l) => <tr key={l.id} data-testid={`plan-line-${l.lineNo}`} className={l.needsRecount ? 'is-warn' : ''}><td data-label={t('item')}>{l.item}{l.batchNo ? ` · ${l.batchNo}` : ''}</td><td data-label={t('cn.bin')}>{l.bin}</td><td data-label={t('cn.class')}>{l.abcClass}</td>{withBook && <td className="num" data-label={t('cn.book')}>{fmtQty(l.bookQty)}</td>}<td className="num" data-label={t('cn.counted')}>{l.countedQty == null ? '—' : fmtQty(l.countedQty)}</td><td className="num" data-label={t('cn.recount')}>{l.recountQty == null ? (l.needsRecount ? t('cn.needed') : '—') : fmtQty(l.recountQty)}</td>
          {withBook && <><td className="num" data-label={t('cn.variance')} data-testid={`plan-var-${l.lineNo}`}>{l.varianceQty == null ? '—' : fmtQty(l.varianceQty)}</td><td className="num" data-label={t('r.value')}>{l.varianceValue == null ? '—' : fmtRs(l.varianceValue)}</td>
            <td data-label={t('cn.reason')}>{can.review && l.varianceQty ? <input value={reasons[l.id] ?? l.reason ?? ''} onChange={(ev) => setReasons({ ...reasons, [l.id]: ev.target.value })} maxLength={200} aria-label={t('cn.reason')} style={{ minHeight: 40 }} data-testid={`plan-reason-${l.lineNo}`} /> : (l.reason ?? '')}</td></>}</tr>)}</tbody></table></div>}
      <div className="actions-row no-print">
        {can.submit && <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => run(() => cn.act(x.id, 'submit'), t('submitted'))} data-testid="plan-submit">{t('sendForApproval')}</button>}
        {can.start && <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => run(() => cn.act(x.id, 'start'), t('cn.started'))} data-testid="plan-start">{t('cn.start')}</button>}
        {can.count && <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} onClick={() => navigateTo(`/inv/blind-count?id=${x.id}`)} data-testid="plan-count">{t('cn.countNow')}</button>}
        {can.close && <button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => run(() => cn.act(x.id, 'close'), t('cn.closed'))} data-testid="plan-close">{t('cn.close')}</button>}
        {can.review && varLines.length > 0 && <button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={saveReasons} data-testid="plan-save-reasons">{t('cn.saveReasons')}</button>}
        {can.adjust && <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => run(() => cn.adjust(x.id), t('cn.adjusted'))} data-testid="plan-adjust">{t('cn.raiseAdjustment')}</button>}
        {x.status === 'REVIEW' && <Link to={`/inv/count-variance?planId=${x.id}`}>{t('cn.varianceTitle')}</Link>}
        {can.withdraw && <button type="button" className="btn" onClick={() => why('withdraw', t('withdrawn'))}>{t('withdraw')}</button>}{can.cancel && <button type="button" className="btn" onClick={() => why('cancel', t('cancelled'))} data-testid="plan-cancel">{t('cancel')}</button>}
        {can.print && <button type="button" className="btn" onClick={() => download(`/count-plans/${x.id}/print`, `${x.docNo.replaceAll('/', '-')}.pdf`).catch(() => setError({ form: t('g.fileFailed') }))} data-testid="plan-print">{t('g.print')}</button>}{x.workflowInstanceId && <Link to={`/workflow/instance?id=${x.workflowInstanceId}`}>{t('approval')}</Link>}</div>
      {x.taskId && <div className="mdm-panel no-print" data-testid="plan-decide"><h2>{t('decide')}</h2><label>{t('comment')}<input value={comment} onChange={(ev) => setComment(ev.target.value)} maxLength={500} style={{ minHeight: 44 }} data-testid="plan-comment" /></label>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide(x.taskId, 'approve')} data-testid="plan-approve">{t('approve')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide(x.taskId, 'return')}>{t('return')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide(x.taskId, 'reject')}>{t('reject')}</button></div></div>}
      <History t={t} data={hq.data} testId="plan-history" />
    </div>
  );
}
export default function CountPlansPage() {
  const t = useT('inv'); usePageTitle(t('cn.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession(); const perms = session.data?.permissions ?? []; const [adding, setAdding] = useState(false);
  const dq = useQuery({ queryKey: ['inv', 'counts-due'], queryFn: cn.due, retry: false, enabled: !id });
  if (id) return <section aria-labelledby="plan-h" data-testid="count-plans"><Plan key={id} t={t} id={id} /></section>;
  const due = dq.data ?? [];
  return (
    <section aria-labelledby="cp-h" data-testid="count-plans"><PageHeader id="cp-h" title={t('cn.title')} subtitle={t('cn.intro')} />
      <div className="actions-row no-print">{perms.includes('inv.count_plan.create') && <button type="button" className="btn btn-primary" style={{ minHeight: 44 }} onClick={() => setAdding(!adding)} data-testid="plan-add">{t('cn.newTitle')}</button>} <Link to="/inv/blind-count">{t('cn.blindTitle')}</Link> <Link to="/inv/count-variance">{t('cn.varianceTitle')}</Link></div>
      {adding && <NewPlan t={t} onDone={(d) => navigateTo(`/inv/count-plans?id=${d.id}`)} />}
      {due.length > 0 && <div className="table-scroll"><table className="data-table" data-testid="counts-due"><caption>{t('cn.dueTitle')}</caption><thead><tr><th>{t('tr.store')}</th><th>{t('cn.class')}</th><th>{t('cn.lastCounted')}</th><th>{t('cn.dueOn')}</th><th className="num">{t('cn.overdue')}</th></tr></thead>
        <tbody>{due.map((d) => <tr key={`${d.storeId}-${d.class}`} className={d.overdueDays > 0 ? 'is-warn' : ''} data-testid={`due-${d.store}-${d.class}`}><td data-label={t('tr.store')}>{d.store}</td><td data-label={t('cn.class')}>{d.class === 'FULL' ? t('cn.t.FULL') : t('cn.classN', { c: d.class })}</td><td data-label={t('cn.lastCounted')}>{d.lastCounted ? fmtDate(d.lastCounted) : '—'}</td><td data-label={t('cn.dueOn')}>{fmtDate(d.dueOn)}</td><td className="num" data-label={t('cn.overdue')}>{d.overdueDays ?? 0}</td></tr>)}</tbody></table></div>}
      <ListReport listCode="inv.count_plans" endpoint="/inv/count-plans" title={t('cn.title')} session={session.data} rowHref={(r) => `/inv/count-plans?id=${r.id}`} onOpen={(r) => navigateTo(`/inv/count-plans?id=${r.id}`)} cardFields={['docNo', 'store', 'type', 'status']} statusKey="status" dateKey="date" empty={{ title: t('cn.emptyTitle'), text: t('cn.emptyBody') }} /></section>
  );
}
