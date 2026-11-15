import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { fmtDate, qa } from './api.js';
import { DocBar, Status, sel, useRecord, useRunner } from './QaParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Inspection requests (part 18.02): the register with ageing, the request object where the inspector records findings and decides (the consultant also, when required), and the raise form for a phone.
const RES_TONE = { APPROVED: 'APPROVED', APPROVED_WITH_COMMENTS: 'RETURNED', REJECTED: 'REJECTED' }; const REASONS = ['WORKMANSHIP', 'MATERIAL', 'DRAWING', 'SAFETY', 'INCOMPLETE', 'DOCUMENTS', 'OTHER'];
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
function Request({ id }) {
  const t = useT('qa'); const { q, guard } = useRecord('/inspection-requests', id, t('ir.title'), 'qa.inspection_request.view'); const [reason, setReason] = useState(''); const [text, setText] = useState(''); const [insId, setInsId] = useState('');
  const iq = useQuery({ queryKey: ['qa', 'ir-inspections', id], queryFn: () => qa.get('/inspections?pageSize=50'), enabled: Boolean(q.data?.assess), retry: false }); usePageTitle(t('ir.title')); if (guard) return guard; const x = q.data;
  const before = async (action) => { if (action === 'reject' && !reason) throw Object.assign(new Error(t('ir.reasonNeeded')), { status: 400 }); if (reason || text || insId) await qa.post(`/inspection-requests/${x.id}/assess`, { reasonCode: reason || null, assessment: text || null, inspectionId: insId ? Number(insId) : null }); };
  return (
    <div data-testid="qa-ir-object" data-status={x.status} data-result={x.result ?? ''}><PageHeader id="ir-h" title={<>{x.docNo} <Status x={x} /> {x.result && <StatusBadge status={RES_TONE[x.result]} label={t(`ires.${x.result}`)} />}</>} meta={<><Link to="/qa/inspection-requests">{t('ir.title')}</Link> · {x.project} · {x.activity ?? '—'} · {t(`pt.${x.pointType}`)}{x.itpStepCode ? ` ${x.itpStepCode}` : ''} · {t('ir.wantedFor')} {fmtDate(x.requestedFor)}{x.ageDays != null ? ` · ${t('ir.age', { n: x.ageDays })}` : ''}{x.overdue ? ` · ${t('ir.overdue')}` : ''}{x.consultantRequired ? ` · ${t('ir.consultantNeeded')}` : ''}</>} />
      <p>{x.description}</p>
      {x.reinspectionOf && <p data-testid="ir-reinspection-of">{t('ir.reinspectionOf')} <Link to={`/qa/inspection-requests?id=${x.reinspectionOf.id}`}>{x.reinspectionOf.docNo}</Link></p>}
      {x.needsReinspection && <div className="mdm-banner" role="status" data-testid="ir-needs-reinspection"><p>{t('ir.needsReinspection')}</p><Link to={`/qa/inspection-requests/new?reinspectionOfId=${x.id}`}>{t('ir.raiseReinspection')}</Link></div>}
      {x.reinspections.length > 0 && <p>{t('ir.reinspections')}: {x.reinspections.map((y) => <Link key={y.id} to={`/qa/inspection-requests?id=${y.id}`}>{y.docNo}</Link>)}</p>}
      {x.result && <div className="mdm-panel" data-testid="ir-outcome"><h2>{t('ir.outcome')}</h2><p>{t(`ires.${x.result}`)}{x.reasonLabel ? ` · ${x.reasonLabel}` : ''}</p>{x.assessment && <p>{x.assessment}</p>}{x.inspection && <p><Link to={`/qa/inspections?id=${x.inspection.id}`}>{x.inspection.docNo}</Link></p>}</div>}
      {x.assess && (
        <div className="mdm-panel no-print" data-testid="ir-assess"><h2>{t('ir.findings')}</h2><p className="muted">{t('ir.findingsHint')}</p>
          <div className="form-grid">
            <Field label={t('ir.reason')} name="reasonCode"><select value={reason} onChange={(e) => setReason(e.target.value)} style={sel} data-testid="ir-reason"><option value="">—</option>{REASONS.map((c) => <option key={c} value={c}>{t(`irr.${c}`)}</option>)}</select></Field>
            <Field label={t('ir.inspection')} name="inspectionId"><select value={insId} onChange={(e) => setInsId(e.target.value)} style={sel} data-testid="ir-inspection"><option value="">—</option>{(iq.data ?? []).map((i) => <option key={i.id} value={i.id}>{i.docNo} {i.template}</option>)}</select></Field>
            <Field label={t('ir.comments')} name="assessment"><textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} style={{ width: '100%' }} data-testid="ir-comments" /></Field></div></div>)}
      <DocBar kind="/inspection-requests" x={x} printName={`${x.docNo.replaceAll('/', '-')}.pdf`} beforeDecide={x.assess ? before : null} />
    </div>
  );
}
export default function InspectionRequestsPage() {
  const t = useT('qa'); usePageTitle(t('ir.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession();
  if (id) return <section aria-labelledby="ir-h"><Request id={id} /></section>;
  return (
    <section aria-labelledby="irl-h" data-testid="qa-irs"><PageHeader id="irl-h" title={t('ir.title')} subtitle={t('ir.intro')} />
      <div className="actions-row no-print"><Link to="/qa/inspection-requests/new">{t('ir.raise')}</Link><Link to="/qa/ir-analysis">{t('ira.title')}</Link><button type="button" className="btn" onClick={() => qa.exportFile('/inspection-requests/export', 'inspection-requests.csv').catch(() => globalThis.alert?.(t('exportFailed')))} data-testid="ir-export">{t('export')}</button></div>
      <ListReport listCode="qa.inspection_requests" endpoint="/qa/inspection-requests" title={t('ir.title')} session={session.data} rowHref={(r) => `/qa/inspection-requests?id=${r.id}`} onOpen={(r) => navigateTo(`/qa/inspection-requests?id=${r.id}`)} cardFields={['docNo', 'activity', 'requestedFor', 'status']} statusKey="status" dateKey="requestedFor" empty={{ title: t('ir.emptyTitle'), text: t('ir.emptyBody') }} />
    </section>
  );
}
export function IrRaisePage() {
  const t = useT('qa'); usePageTitle(t('ir.raise')); const sp = useSearch(); const re = Number(sp.get('reinspectionOfId')) || null; const { error, run, busy } = useRunner();
  const [f, setF] = useState({ projectId: '', siteId: '', plannedPointId: '', activityId: '', pointType: 'HOLD', description: '', requestedFor: today(), consultantRequired: false, reinspectionOfId: re ? String(re) : '' }); const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const oq = useQuery({ queryKey: ['qa', 'ir-options', f.projectId], queryFn: () => qa.get(`/inspection-requests/options${f.projectId ? `?projectId=${f.projectId}` : ''}`), retry: false }); const o = oq.data;
  const send = async () => { const body = { projectId: Number(f.projectId), siteId: f.siteId ? Number(f.siteId) : null, plannedPointId: f.plannedPointId ? Number(f.plannedPointId) : null, activityId: f.activityId ? Number(f.activityId) : null, pointType: f.pointType, description: f.description || null, requestedFor: f.requestedFor, consultantRequired: f.consultantRequired, reinspectionOfId: f.reinspectionOfId ? Number(f.reinspectionOfId) : null, submit: true }; const d = await run(() => qa.make('/inspection-requests', body), t('saved')); if (d) navigateTo(`/qa/inspection-requests?id=${d.id}`); };
  const big = { minHeight: 48, fontSize: '1rem' }; const points = (o?.points ?? []).filter((p) => !f.projectId || String(p.projectId) === String(f.projectId));
  return (
    <section aria-labelledby="irr-h" data-testid="qa-ir-raise"><PageHeader id="irr-h" title={t('ir.raise')} subtitle={<Link to="/qa/inspection-requests">{t('ir.title')}</Link>} />
      {error?.form && <p className="field-error" role="alert" data-testid="irr-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
      <div className="mdm-panel"><div className="form-grid">
        <Field label={t('project')} name="projectId" error={error}><select value={f.projectId} onChange={(e) => set('projectId', e.target.value)} style={big} data-testid="irr-project"><option value="">—</option>{(o?.projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></Field>
        <Field label={t('site')} name="siteId" error={error}><select value={f.siteId} onChange={(e) => set('siteId', e.target.value)} style={big}><option value="">—</option>{(o?.sites ?? []).filter((s) => String(s.projectId) === String(f.projectId)).map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</select></Field>
        {!re && <Field label={t('ir.point')} name="plannedPointId" error={error}><select value={f.plannedPointId} onChange={(e) => set('plannedPointId', e.target.value)} style={big} data-testid="irr-point"><option value="">{t('ir.noPoint')}</option>{points.map((p) => <option key={p.id} value={p.id}>{p.activity} · {p.stepCode} ({t(`pt.${p.pointType}`)})</option>)}</select></Field>}
        {!re && !f.plannedPointId && <Field label={t('ir.pointType')} name="pointType" error={error}><select value={f.pointType} onChange={(e) => set('pointType', e.target.value)} style={big}>{['HOLD', 'WITNESS', 'REVIEW', 'SURVEILLANCE'].map((p) => <option key={p} value={p}>{t(`pt.${p}`)}</option>)}</select></Field>}
        {re && <Field label={t('ir.reinspectionOf')} name="reinspectionOfId" error={error}><select value={f.reinspectionOfId} onChange={(e) => set('reinspectionOfId', e.target.value)} style={big} data-testid="irr-rejected">{(o?.rejected ?? []).map((x) => <option key={x.id} value={x.id}>{x.docNo} {x.description}</option>)}</select></Field>}
        <Field label={t('ir.what')} name="description" error={error}><input value={f.description} onChange={(e) => set('description', e.target.value)} maxLength={500} style={big} data-testid="irr-description" /></Field>
        <Field label={t('ir.wantedFor')} name="requestedFor" error={error}><input type="date" value={f.requestedFor} min={today()} onChange={(e) => set('requestedFor', e.target.value)} style={big} data-testid="irr-date" /></Field>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 48 }}><input type="checkbox" checked={f.consultantRequired} onChange={(e) => set('consultantRequired', e.target.checked)} style={{ minWidth: 24, minHeight: 24 }} data-testid="irr-consultant" />{t('ir.consultantNeeded')}</label></div>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy || !f.projectId} onClick={send} data-testid="irr-send">{t('ir.sendRequest')}</button></div></div>
    </section>
  );
}
