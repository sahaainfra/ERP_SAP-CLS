import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { XPD_TONE, download, fmtDate, fmtQty, pc, px, today } from './api.js';
import { History, ProjectOrder, useRunner } from './XpdParts.jsx';
import { useSearch } from '../site/parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Vendor inspections (part 15.07, FR-02, FR-03): a stage, final or third-party inspection is called, its result and punch points are recorded, and a passed one goes to the quality engineer and the quality manager for the inspection release note (IRN).
// Dispatch of a shipment is cleared by that note where inspection is mandatory.
function Insp({ t, id }) {
  const q = useQuery({ queryKey: ['proc', 'insp', id], queryFn: () => px.insp(id), retry: false }); const hq = useQuery({ queryKey: ['proc', 'insp-history', id, q.data?.status], queryFn: () => px.inspHistory(id), enabled: q.isSuccess, retry: false });
  const { error, setError, note, busy, run } = useRunner(); const [comment, setComment] = useState(''); const [res, setRes] = useState(null); const [pp, setPp] = useState('');
  usePageTitle(t('x.inspTitle'));
  if (q.error?.status === 403) return <NoPermission what={t('x.inspTitle')} permission="proc.inspection.view" />;
  if (q.isPending) return <Skeleton label={t('x.inspTitle')} rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const r = q.data; const can = r.can; const rf = res ?? { inspectionDate: r.inspectionDate ?? today(), result: r.result === 'PENDING' ? 'PASSED' : r.result };
  const why = (action, msg) => { const x = window.prompt(t('x.why')); if (x) run(() => px.inspAct(r.id, action, { reason: x }), msg).then((d) => { if (d && action === 'amend') navigateTo(`/proc/inspections?id=${d.id}`); }); };
  const decide = (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('x.sayWhy') }); return; } run(() => pc.decide(r.taskId, action, comment.trim() || null), t(`x.done.${action}`)); };
  const record = () => run(() => px.inspAct(r.id, 'result', { inspectionDate: rf.inspectionDate, result: rf.result, punchPoints: [...r.punchPoints.map((p) => ({ point: p.point, severity: p.severity, status: p.status })), ...pp.split('\n').map((x) => x.trim()).filter(Boolean).map((point) => ({ point }))] }), t('x.resultSaved')).then(() => setPp(''));
  return (
    <div data-testid="in-object" data-status={r.status} data-result={r.result}>
      <PageHeader id="in-h" title={<>{r.docNo} <StatusBadge status={XPD_TONE[r.status]} label={t(`x.is.${r.status}`)} />{r.irnNo && <StatusBadge status="APPROVED" label={r.irnNo} />}</>} meta={<><Link to="/proc/inspections">{t('x.back')}</Link> · <Link to={`/proc/purchase-orders?id=${r.poId}`}>{r.poNo}</Link> {r.vendor} · {r.projectCode}</>} />
      <dl className="kv" data-testid="in-figures"><div><dt>{t('x.type')}</dt><dd>{r.typeLabel}</dd></div><div><dt>{t('x.mandatory')}</dt><dd>{r.mandatory ? t('x.yes') : t('x.no')}</dd></div><div><dt>{t('x.callDate')}</dt><dd>{fmtDate(r.callDate)}</dd></div><div><dt>{t('x.inspectedOn')}</dt><dd>{fmtDate(r.inspectionDate)}</dd></div>
        <div><dt>{t('x.inspector')}</dt><dd>{r.inspector ?? '—'}{r.agency ? ` · ${r.agency}` : ''}</dd></div><div><dt>{t('x.location')}</dt><dd>{r.location ?? '—'}</dd></div><div><dt>{t('x.result')}</dt><dd data-testid="in-result">{t(`x.r.${r.result}`)}</dd></div>{r.irnNo && <div><dt>{t('x.irn')}</dt><dd data-testid="in-irn">{r.irnNo} · {fmtDate(r.irnDate)}</dd></div>}</dl>
      {r.scope && <p>{r.scope}</p>}
      {error?.form && <p className="field-error" role="alert" data-testid="in-error">{error.form}</p>}{note && <p className="mdm-banner" role="status" data-testid="in-note">{note}</p>}
      {(r.lines ?? []).length > 0 && <div className="table-scroll"><table className="data-table" data-testid="in-lines"><caption>{t('x.lines')}</caption><thead><tr><th>#</th><th>{t('x.item')}</th><th className="num">{t('x.qty')}</th></tr></thead><tbody>{r.lines.map((l) => <tr key={l.poLineId}><td>{l.lineNo}</td><td>{l.description}</td><td className="num">{fmtQty(l.qty)}</td></tr>)}</tbody></table></div>}
      <div className="table-scroll"><table className="data-table" data-testid="in-punch"><caption>{t('x.punch')} ({r.openPunch} {t('x.open')})</caption><thead><tr><th>#</th><th>{t('x.punchPoint')}</th><th>{t('x.severity')}</th><th>{t('x.status')}</th></tr></thead>
        <tbody>{r.punchPoints.length === 0 ? <tr><td colSpan={4} className="muted">{t('x.noPunch')}</td></tr> : r.punchPoints.map((p) => <tr key={p.no} data-testid="in-punch-row"><td>{p.no}</td><td>{p.point}</td><td>{p.severity}</td><td>{p.status}</td></tr>)}</tbody></table></div>
      {can.result && <div className="mdm-panel no-print" data-testid="in-record"><h2>{t('x.recordResult')}</h2>
        <div className="form-grid"><Field label={t('x.inspectedOn')} name="inspectionDate" error={error}><input type="date" max={today()} value={rf.inspectionDate} onChange={(ev) => setRes({ ...rf, inspectionDate: ev.target.value })} style={{ minHeight: 44 }} data-testid="in-date" /></Field>
          <Field label={t('x.result')} name="result" error={error}><select value={rf.result} onChange={(ev) => setRes({ ...rf, result: ev.target.value })} style={{ minHeight: 44 }} data-testid="in-result-select">{['PASSED', 'PASSED_WITH_PUNCH', 'FAILED'].map((x) => <option key={x} value={x}>{t(`x.r.${x}`)}</option>)}</select></Field></div>
        <label>{t('x.newPunch')}<textarea rows={3} value={pp} maxLength={2000} onChange={(ev) => setPp(ev.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} data-testid="in-punch-text" /></label>
        <div className="actions-row"><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={record} data-testid="in-record-save">{t('x.saveResult')}</button></div></div>}
      <div className="actions-row no-print">
        {can.edit && <Link to={`/proc/inspections?new=1&edit=${r.id}`}>{t('x.edit')}</Link>}
        {can.submit && <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => run(() => px.inspAct(r.id, 'submit'), t('x.submittedIrn'))} data-testid="in-submit">{t('x.submitIrn')}</button>}
        {can.withdraw && <button type="button" className="btn" onClick={() => why('withdraw', t('x.withdrawn'))}>{t('x.withdraw')}</button>}
        {can.amend && <button type="button" className="btn" onClick={() => why('amend')} data-testid="in-amend">{t('x.reinspect')}</button>}
        {can.cancel && <button type="button" className="btn" onClick={() => why('cancel', t('x.cancelled'))} data-testid="in-cancel">{t('x.cancel')}</button>}
        {can.delete && <button type="button" className="btn" onClick={async () => { if (window.confirm(t('x.deleteAsk')) && await run(() => px.inspDelete(r.id))) navigateTo('/proc/inspections'); }}>{t('x.delete')}</button>}
        {can.print && <button type="button" className="btn" onClick={() => download(`/inspections/${r.id}/print`, `${(r.irnNo ?? r.docNo).replaceAll('/', '-')}.pdf`).catch(() => setError({ form: t('x.fileFailed') }))} data-testid="in-print">{t('x.print')}</button>}
        {(r.shipments ?? []).map((s) => <Link key={s.id} to={`/proc/shipments?id=${s.id}`}>{s.docNo}</Link>)}
        {r.workflowInstanceId && <Link to={`/workflow/instance?id=${r.workflowInstanceId}`}>{t('x.approval')}</Link>}
      </div>
      {r.taskId && <div className="mdm-panel no-print" data-testid="in-decide"><h2>{t('x.decideIrn')}</h2><label>{t('x.comment')}<input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} style={{ minHeight: 44 }} data-testid="in-comment" /></label>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('approve')} data-testid="in-approve">{t('x.release')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('return')}>{t('x.return')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('reject')}>{t('x.reject')}</button></div></div>}
      <History t={t} data={hq.data} testId="in-history" />
    </div>
  );
}

function InspForm({ t, editId, project0, po0 }) {
  const eq = useQuery({ queryKey: ['proc', 'insp', editId], queryFn: () => px.insp(editId), enabled: Boolean(editId), retry: false }); const e = eq.data;
  const [projectId, setProjectId] = useState(project0 ? String(project0) : ''); const [orderId, setOrderId] = useState(po0 ? String(po0) : ''); const [f, setF] = useState(null); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  usePageTitle(t('x.newInsp'));
  if (editId && eq.isPending) return <Skeleton label={t('x.newInsp')} rows={4} />;
  const form = f ?? { itype: e?.itype ?? 'FINAL', mandatory: e?.mandatory ?? true, callDate: e?.callDate ?? today(), inspector: e?.inspector ?? '', agency: e?.agency ?? '', location: e?.location ?? '', scope: e?.scope ?? '' }; const set = (k, v) => setF({ ...form, [k]: v });
  const body = () => ({ itype: form.itype, mandatory: form.mandatory, callDate: form.callDate, inspector: form.inspector || null, agency: form.agency || null, location: form.location || null, scope: form.scope || null });
  const save = async () => { setError(null); setBusy(true); try { const d = editId ? await px.inspUpdate(editId, { ...body(), rowVersion: e.rowVersion }) : await px.inspCreate({ poId: Number(orderId), ...body() }); navigateTo(`/proc/inspections?id=${d.id}`); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); } };
  return (
    <section aria-labelledby="inn-h" data-testid="proc-in-form"><PageHeader id="inn-h" title={editId ? t('x.edit') : t('x.newInsp')} subtitle={t('x.newInspHelp')} meta={<Link to="/proc/inspections">{t('x.back')}</Link>} />
      <form className="mdm-panel" onSubmit={(ev) => { ev.preventDefault(); save(); }} noValidate>
        <div className="form-grid">
          {editId ? <p>{e.poNo} · {e.vendor}</p> : <ProjectOrder t={t} projectId={projectId} setProjectId={setProjectId} orderId={orderId} setOrderId={setOrderId} error={error} prefix="inn" />}
          <Field label={t('x.type')} name="itype" error={error}><select value={form.itype} onChange={(ev) => set('itype', ev.target.value)} style={{ minHeight: 44 }} data-testid="inn-type">{['STAGE', 'FINAL', 'TPI'].map((x) => <option key={x} value={x}>{t(`x.t.${x}`)}</option>)}</select></Field>
          <Field label={t('x.callDate')} name="callDate" error={error}><input type="date" value={form.callDate} onChange={(ev) => set('callDate', ev.target.value)} style={{ minHeight: 44 }} data-testid="inn-call" /></Field>
          <Field label={t('x.inspector')} name="inspector" error={error}><input value={form.inspector} maxLength={80} onChange={(ev) => set('inspector', ev.target.value)} style={{ minHeight: 44 }} data-testid="inn-inspector" /></Field>
          <Field label={t('x.agency')} name="agency" error={error}><input value={form.agency} maxLength={120} onChange={(ev) => set('agency', ev.target.value)} style={{ minHeight: 44 }} /></Field>
          <Field label={t('x.location')} name="location" error={error}><input value={form.location} maxLength={160} onChange={(ev) => set('location', ev.target.value)} style={{ minHeight: 44 }} data-testid="inn-location" /></Field></div>
        <label><input type="checkbox" checked={form.mandatory} onChange={(ev) => set('mandatory', ev.target.checked)} data-testid="inn-mandatory" /> {t('x.mandatory')}</label>
        <label>{t('x.scope')}<textarea rows={3} value={form.scope} maxLength={1000} onChange={(ev) => set('scope', ev.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} /></label>
        {error?.form && <p className="field-error" role="alert" data-testid="inn-error">{error.form}</p>}
        <div className="actions-row"><button type="submit" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy || (!editId && !orderId)} data-testid="inn-save">{t('x.save')}</button></div></form></section>
  );
}

export default function InspectionsPage() {
  const t = useT('proc'); usePageTitle(t('x.inspTitle')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession(); const perms = session.data?.permissions ?? [];
  if (sp.get('new') === '1') return <InspForm key={sp.get('edit') ?? sp.get('po') ?? 'new'} t={t} editId={Number(sp.get('edit')) || null} project0={Number(sp.get('project')) || null} po0={Number(sp.get('po')) || null} />;
  if (id) return <section aria-labelledby="in-h" data-testid="proc-in"><Insp key={id} t={t} id={id} /></section>;
  return (
    <section aria-labelledby="ins-h" data-testid="proc-in"><PageHeader id="ins-h" title={t('x.inspTitle')} subtitle={t('x.inspIntro')} />
      <div className="actions-row no-print">{perms.includes('proc.inspection.create') && <Link to="/proc/inspections?new=1">{t('x.newInsp')}</Link>} <Link to="/proc/expediting">{t('x.dashboard')}</Link></div>
      <ListReport listCode="proc.inspections" endpoint="/proc/inspections" exportEndpoint="/ui/lists/proc.inspections/export" title={t('x.inspTitle')} session={session.data} rowHref={(r) => `/proc/inspections?id=${r.id}`} onOpen={(r) => navigateTo(`/proc/inspections?id=${r.id}`)}
        cardFields={['docNo', 'order', 'vendor', 'itype', 'call', 'result']} statusKey="status" empty={{ title: t('x.inspEmptyTitle'), text: t('x.inspEmptyBody') }} /></section>
  );
}
