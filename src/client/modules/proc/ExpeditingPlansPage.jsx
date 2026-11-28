import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { MS_TONE, XPD_TONE, download, fmtDate, pc, px, today } from './api.js';
import { History, ProjectOrder, useRunner } from './XpdParts.jsx';
import { useSearch } from '../site/parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Expediting plan of an order (part 15.07, FR-01, FR-05): the milestones from drawing approval to dispatch with planned, forecast and actual dates, the date the item is expected at site, and the activities of the approved schedule that wait for it.
// The buyer and the vendor (on its order link) record progress; the server works out the risk, the arrival date and the alert.
function Plan({ t, id }) {
  const q = useQuery({ queryKey: ['proc', 'plan', id], queryFn: () => px.plan(id), retry: false }); const hq = useQuery({ queryKey: ['proc', 'plan-history', id, q.data?.status], queryFn: () => px.planHistory(id), enabled: q.isSuccess, retry: false });
  const { error, setError, note, busy, run } = useRunner(); const [comment, setComment] = useState(''); const [edit, setEdit] = useState({});
  usePageTitle(t('x.planTitle'));
  if (q.error?.status === 403) return <NoPermission what={t('x.planTitle')} permission="proc.expediting_plan.view" />;
  if (q.isPending) return <Skeleton label={t('x.planTitle')} rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const r = q.data; const can = r.can;
  const why = (action, msg) => { const x = window.prompt(t('x.why')); if (x) run(() => px.planAct(r.id, action, { reason: x }), msg).then((d) => { if (d && action === 'amend') navigateTo(`/proc/expediting-plans?id=${d.id}`); }); };
  const decide = (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('x.sayWhy') }); return; } run(() => pc.decide(r.taskId, action, comment.trim() || null), t(`x.done.${action}`)); };
  const save = (m) => { const e = edit[m.id] ?? {}; run(() => px.progress(r.id, m.id, { forecastDate: e.forecastDate ?? m.forecastDate ?? null, actualDate: e.actualDate ?? m.actualDate ?? null, remarks: e.remarks ?? m.remarks ?? null }), t('x.saved')); };
  const setE = (m, k, v) => setEdit({ ...edit, [m.id]: { ...(edit[m.id] ?? {}), [k]: v || null } });
  return (
    <div data-testid="xp-object" data-status={r.status} data-risk={r.atRisk ? 'yes' : 'no'}>
      <PageHeader id="xp-h" title={<>{r.docNo} <StatusBadge status={XPD_TONE[r.status]} label={t(`x.s.${r.status}`)} />{r.atRisk && <StatusBadge status="REJECTED" label={t('x.atRisk')} />}</>} meta={<><Link to="/proc/expediting-plans">{t('x.back')}</Link> · <Link to={`/proc/purchase-orders?id=${r.poId}`}>{r.poNo}</Link> {r.vendor} · {r.projectCode}</>} />
      <dl className="kv" data-testid="xp-figures"><div><dt>{t('x.requiredOnSite')}</dt><dd data-testid="xp-required">{fmtDate(r.requiredOnSite)}</dd></div><div><dt>{t('x.eta')}</dt><dd data-testid="xp-eta">{fmtDate(r.eta)}</dd></div><div><dt>{t('x.daysLate')}</dt><dd data-testid="xp-late">{r.daysLate > 0 ? r.daysLate : 0}</dd></div><div><dt>{t('x.transitDays')}</dt><dd>{r.transitDays}</dd></div>
        <div><dt>{t('x.longLead')}</dt><dd>{r.longLead ? t('x.yes') : t('x.no')}</dd></div><div><dt>{t('x.inspRequired')}</dt><dd>{r.inspectionRequired ? t('x.yes') : t('x.no')}</dd></div><div><dt>{t('x.expediter')}</dt><dd>{r.expediter ?? '—'}</dd></div></dl>
      {(r.warnings ?? []).map((w) => <p key={w.code} className="mdm-banner" role="status" data-testid={`xp-warn-${w.code}`}>{w.message}</p>)}
      {error?.form && <p className="field-error" role="alert" data-testid="xp-error">{error.form}</p>}{note && <p className="mdm-banner" role="status" data-testid="xp-note">{note}</p>}
      <div className="table-scroll"><table className="data-table" data-testid="xp-milestones"><caption>{t('x.milestones')}</caption><thead><tr><th>#</th><th>{t('x.milestone')}</th><th>{t('x.planned')}</th><th>{t('x.forecast')}</th><th>{t('x.actual')}</th><th>{t('x.status')}</th><th>{t('x.note')}</th>{can.progress && <th />}</tr></thead>
        <tbody>{r.milestones.map((m) => (
          <tr key={m.id} data-testid="xp-ms" data-status={m.status} data-beyond={m.beyondRequired ? 'yes' : 'no'}><td>{m.seqNo}</td><td>{m.name}{m.updatedVia === 'VENDOR' && <span className="muted small"> · {t('x.byVendor')}</span>}</td><td>{fmtDate(m.plannedDate)}</td>
            <td>{can.progress ? <input type="date" value={edit[m.id]?.forecastDate ?? m.forecastDate ?? ''} onChange={(ev) => setE(m, 'forecastDate', ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} aria-label={`${m.name} ${t('x.forecast')}`} data-testid="xp-forecast" /> : fmtDate(m.forecastDate)}{m.beyondRequired && <span className="field-error"> {t('x.beyond')}</span>}</td>
            <td>{can.progress ? <input type="date" max={today()} value={edit[m.id]?.actualDate ?? m.actualDate ?? ''} onChange={(ev) => setE(m, 'actualDate', ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} aria-label={`${m.name} ${t('x.actual')}`} data-testid="xp-actual" /> : fmtDate(m.actualDate)}</td>
            <td><StatusBadge status={MS_TONE[m.status]} label={t(`x.ms.${m.status}`)} /></td><td>{can.progress ? <input value={edit[m.id]?.remarks ?? m.remarks ?? ''} maxLength={500} onChange={(ev) => setE(m, 'remarks', ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} aria-label={t('x.note')} data-testid="xp-remarks" /> : (m.remarks ?? '')}</td>
            {can.progress && <td><button type="button" className="btn" style={{ minHeight: 'var(--erp-target-min)' }} disabled={busy} onClick={() => save(m)} data-testid="xp-save-ms">{t('x.save')}</button></td>}</tr>))}</tbody></table></div>
      {(r.activities ?? []).length > 0 && <div className="table-scroll"><table className="data-table" data-testid="xp-activities"><caption>{t('x.activities')}</caption><thead><tr><th>{t('x.activity')}</th><th>{t('x.starts')}</th><th>{t('x.daysBefore')}</th></tr></thead>
        <tbody>{r.activities.map((a) => <tr key={a.activityId} data-testid="xp-activity"><td>{a.code} {a.name}</td><td>{fmtDate(a.start)}</td><td className="num">{a.daysBeforeArrival}</td></tr>)}</tbody></table></div>}
      {(r.vdr ?? []).length > 0 && <div className="table-scroll"><table className="data-table" data-testid="xp-vdr"><caption>{t('x.vdr')}</caption><thead><tr><th>{t('x.vdrNo')}</th><th>{t('x.milestone')}</th><th>{t('x.due')}</th><th>{t('x.status')}</th></tr></thead>
        <tbody>{r.vdr.map((v) => <tr key={v.vdrNo}><td>{v.vdrNo}</td><td>{v.title}</td><td>{fmtDate(v.dueDate)}{v.overdue && <span className="field-error"> {t('x.overdue')}</span>}</td><td>{v.status}</td></tr>)}</tbody></table></div>}
      <div className="table-scroll"><table className="data-table" data-testid="xp-linked"><caption>{t('x.linked')}</caption><thead><tr><th>{t('x.document')}</th><th>{t('x.status')}</th><th>{t('x.detail')}</th></tr></thead>
        <tbody>{(r.inspections ?? []).map((i) => <tr key={`i${i.id}`}><td><Link to={`/proc/inspections?id=${i.id}`}>{i.docNo}</Link></td><td>{i.statusLabel}</td><td>{i.typeLabel} · {fmtDate(i.callDate)}{i.irnNo ? ` · ${i.irnNo}` : ''}</td></tr>)}
          {(r.shipments ?? []).map((s) => <tr key={`s${s.id}`}><td><Link to={`/proc/shipments?id=${s.id}`}>{s.docNo}</Link></td><td>{s.statusLabel}</td><td>{s.transporter ?? ''} · {t('x.eta')} {fmtDate(s.eta)}</td></tr>)}</tbody></table></div>
      <div className="actions-row no-print">
        {can.edit && <Link to={`/proc/expediting-plans?new=1&edit=${r.id}`}>{t('x.edit')}</Link>}
        {can.submit && <button type="button" className="btn btn-primary" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} onClick={() => run(() => px.planAct(r.id, 'submit'), t('x.submitted'))} data-testid="xp-submit">{t('x.submit')}</button>}
        {can.withdraw && <button type="button" className="btn" onClick={() => why('withdraw', t('x.withdrawn'))}>{t('x.withdraw')}</button>}
        {can.inspect && <Link to={`/proc/inspections?new=1&po=${r.poId}&project=${r.projectId}`}>{t('x.callInspection')}</Link>}
        {can.ship && <Link to={`/proc/shipments?new=1&po=${r.poId}&project=${r.projectId}`}>{t('x.planShipment')}</Link>}
        {can.amend && <button type="button" className="btn" onClick={() => why('amend')} data-testid="xp-amend">{t('x.amend')}</button>}
        {can.close && <button type="button" className="btn" onClick={() => why('close', t('x.closed'))} data-testid="xp-close">{t('x.close')}</button>}
        {can.cancel && <button type="button" className="btn" onClick={() => why('cancel', t('x.cancelled'))} data-testid="xp-cancel">{t('x.cancel')}</button>}
        {can.delete && <button type="button" className="btn" onClick={async () => { if (window.confirm(t('x.deleteAsk')) && await run(() => px.planDelete(r.id))) navigateTo('/proc/expediting-plans'); }}>{t('x.delete')}</button>}
        {can.print && <button type="button" className="btn" onClick={() => download(`/expediting-plans/${r.id}/print`, `${r.docNo.replaceAll('/', '-')}.pdf`).catch(() => setError({ form: t('x.fileFailed') }))} data-testid="xp-print">{t('x.print')}</button>}
        {r.workflowInstanceId && <Link to={`/workflow/instance?id=${r.workflowInstanceId}`}>{t('x.approval')}</Link>}
      </div>
      {r.taskId && <div className="mdm-panel no-print" data-testid="xp-decide"><h2>{t('x.decide')}</h2><label>{t('x.comment')}<input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="xp-comment" /></label>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} onClick={() => decide('approve')} data-testid="xp-approve">{t('x.approve')}</button><button type="button" className="btn" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} onClick={() => decide('return')}>{t('x.return')}</button><button type="button" className="btn" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} onClick={() => decide('reject')}>{t('x.reject')}</button></div></div>}
      <History t={t} data={hq.data} testId="xp-history" />
    </div>
  );
}

function PlanForm({ t, editId, project0, po0 }) {
  const eq = useQuery({ queryKey: ['proc', 'plan', editId], queryFn: () => px.plan(editId), enabled: Boolean(editId), retry: false }); const e = eq.data;
  const [projectId, setProjectId] = useState(project0 ? String(project0) : ''); const [orderId, setOrderId] = useState(po0 ? String(po0) : ''); const [f, setF] = useState(null); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  usePageTitle(t('x.newPlan'));
  if (editId && eq.isPending) return <Skeleton label={t('x.newPlan')} rows={4} />;
  const form = f ?? { requiredOnSite: e?.requiredOnSite ?? '', transitDays: e?.transitDays ?? 7, longLead: e?.longLead ?? false, inspectionRequired: e?.inspectionRequired ?? true, expediter: e?.expediter ?? '' }; const set = (k, v) => setF({ ...form, [k]: v });
  const body = () => ({ requiredOnSite: form.requiredOnSite || undefined, transitDays: Number(form.transitDays) || 0, longLead: form.longLead, inspectionRequired: form.inspectionRequired, expediter: form.expediter || null });
  const save = async (send) => { setError(null); setBusy(true); try { let d = editId ? await px.planUpdate(editId, { ...body(), rowVersion: e.rowVersion }) : await px.planCreate({ poId: Number(orderId), ...body() }); if (send) d = await px.planAct(d.id, 'submit'); navigateTo(`/proc/expediting-plans?id=${d.id}`); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); } };
  return (
    <section aria-labelledby="xpn-h" data-testid="proc-xp-form"><PageHeader id="xpn-h" title={editId ? t('x.edit') : t('x.newPlan')} subtitle={t('x.newPlanHelp')} meta={<Link to="/proc/expediting-plans">{t('x.back')}</Link>} />
      <form className="mdm-panel" onSubmit={(ev) => { ev.preventDefault(); save(false); }} noValidate>
        <div className="form-grid">
          {editId ? <p>{e.poNo} · {e.vendor}</p> : <ProjectOrder t={t} projectId={projectId} setProjectId={setProjectId} orderId={orderId} setOrderId={setOrderId} error={error} prefix="xpn" />}
          <Field label={t('x.requiredOnSite')} name="requiredOnSite" error={error}><input type="date" value={form.requiredOnSite} onChange={(ev) => set('requiredOnSite', ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="xpn-required" /></Field>
          <Field label={t('x.transitDays')} name="transitDays" error={error}><input type="number" min="0" max="365" value={form.transitDays} onChange={(ev) => set('transitDays', ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="xpn-transit" /></Field>
          <Field label={t('x.expediter')} name="expediter" error={error}><input value={form.expediter} maxLength={60} onChange={(ev) => set('expediter', ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="xpn-expediter" /></Field></div>
        <label><input type="checkbox" checked={form.longLead} onChange={(ev) => set('longLead', ev.target.checked)} data-testid="xpn-longlead" /> {t('x.longLead')}</label>{' '}
        <label><input type="checkbox" checked={form.inspectionRequired} onChange={(ev) => set('inspectionRequired', ev.target.checked)} data-testid="xpn-insp" /> {t('x.inspRequired')}</label>
        <p className="muted">{t('x.templateHelp')}</p>
        {error?.form && <p className="field-error" role="alert" data-testid="xpn-error">{error.form}</p>}
        <div className="actions-row"><button type="submit" className="btn" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy || (!editId && !orderId)} data-testid="xpn-save">{t('x.saveDraft')}</button><button type="button" className="btn btn-primary" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy || (!editId && !orderId)} onClick={() => save(true)} data-testid="xpn-send">{t('x.sendForApproval')}</button></div></form></section>
  );
}

export default function ExpeditingPlansPage() {
  const t = useT('proc'); usePageTitle(t('x.plansTitle')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession(); const perms = session.data?.permissions ?? [];
  if (sp.get('new') === '1') return <PlanForm key={sp.get('edit') ?? sp.get('po') ?? 'new'} t={t} editId={Number(sp.get('edit')) || null} project0={Number(sp.get('project')) || null} po0={Number(sp.get('po')) || null} />;
  if (id) return <section aria-labelledby="xp-h" data-testid="proc-xp"><Plan key={id} t={t} id={id} /></section>;
  return (
    <section aria-labelledby="xps-h" data-testid="proc-xp"><PageHeader id="xps-h" title={t('x.plansTitle')} subtitle={t('x.plansIntro')} />
      <div className="actions-row no-print">{perms.includes('proc.expediting_plan.create') && <Link to="/proc/expediting-plans?new=1">{t('x.newPlan')}</Link>} <Link to="/proc/expediting">{t('x.dashboard')}</Link></div>
      <ListReport listCode="proc.expediting_plans" endpoint="/proc/expediting-plans" exportEndpoint="/ui/lists/proc.expediting_plans/export" title={t('x.plansTitle')} session={session.data} rowHref={(r) => `/proc/expediting-plans?id=${r.id}`} onOpen={(r) => navigateTo(`/proc/expediting-plans?id=${r.id}`)}
        cardFields={['docNo', 'order', 'vendor', 'required', 'eta']} statusKey="status" empty={{ title: t('x.plansEmptyTitle'), text: t('x.plansEmptyBody') }} /></section>
  );
}
