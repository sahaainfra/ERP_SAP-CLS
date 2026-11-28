import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { authHeaders } from '../../platform/api/index.js';
import { browserTransport, uploadFile } from '../../platform/files/upload.js';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { qa } from './api.js';
import { PlanPins } from './SnagParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Snag Walk (part 18.06, FR-01, FR-02, on a phone): choose the room and the plan, tap the plan to pin the defect, describe it, take the photograph, and go to the next one; what is shared by the room stays filled in.
const transport = browserTransport(authHeaders); const big = { minHeight: 'var(--erp-target-large)', fontSize: '1rem' };
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
export default function SnagWalkPage() {
  const t = useT('qa'); usePageTitle(t('walk.title')); const [projectId, setProjectId] = useState(''); const [common, setCommon] = useState({ locationId: '', drawingId: '', unitRef: '', responsibleType: 'OWN_CREW', responsibleId: '', dueDate: '' });
  const [f, setF] = useState({ description: '', category: 'FINISHING', punchClass: 'B', priority: 'MEDIUM' }); const [pin, setPin] = useState(null); const [photo, setPhoto] = useState(null); const [done, setDone] = useState([]); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  const oq = useQuery({ queryKey: ['qa', 'snag-options', projectId], queryFn: () => qa.get(`/snags/options${projectId ? `?projectId=${projectId}` : ''}`), retry: false }); const o = oq.data;
  if (oq.error?.status === 403) return <NoPermission what={t('walk.title')} permission="qa.snag.create" />; if (oq.isPending) return <Skeleton label={t('walk.title')} rows={4} />;
  const plan = (o?.drawings ?? []).find((d) => String(d.id) === String(common.drawingId)); const setC = (k, v) => setCommon((s) => ({ ...s, [k]: v }));
  const save = async () => {
    setError(null); setBusy(true);
    try {
      const body = { projectId: Number(projectId), locationId: common.locationId ? Number(common.locationId) : null, drawingId: common.drawingId ? Number(common.drawingId) : null, unitRef: common.unitRef || null, pin, category: f.category, punchClass: f.punchClass, priority: f.priority, description: f.description, responsibleType: common.responsibleType, responsibleId: common.responsibleId ? Number(common.responsibleId) : null, dueDate: common.dueDate || null };
      const s = await qa.make('/snags', body); if (photo) { const up = await uploadFile(photo, { transport, entity: 'qa_snags', entityId: s.id }); await qa.post(`/snags/${s.id}/photos`, { fileId: up.id, kind: 'BEFORE' }); }
      setDone((d) => [...d, { id: s.id, docNo: s.docNo, description: s.description, pin: s.pin }]); setF((s2) => ({ ...s2, description: '' })); setPin(null); setPhoto(null);
    } catch (e) { setError(e?.errors?.length ? { form: e.message } : errorInfo(e)); } finally { setBusy(false); }
  };
  return (
    <section aria-labelledby="walk-h" data-testid="qa-snag-walk"><PageHeader id="walk-h" title={t('walk.title')} subtitle={<><Link to="/qa/snags">{t('snag.title')}</Link> · {t('walk.hint')}</>} />
      {error?.form && <p className="field-error" role="alert" data-testid="walk-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
      <div className="mdm-panel"><div className="form-grid">
        <Field label={t('project')} name="projectId" error={error}><select value={projectId} onChange={(e) => { setProjectId(e.target.value); setC('locationId', ''); setC('drawingId', ''); }} style={big} data-testid="walk-project"><option value="">—</option>{(o?.projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></Field>
        <Field label={t('snag.location')} name="locationId" error={error}><select value={common.locationId} onChange={(e) => setC('locationId', e.target.value)} style={big} data-testid="walk-location"><option value="">—</option>{(o?.locations ?? []).map((l) => <option key={l.id} value={l.id}>{l.code} {l.name}</option>)}</select></Field>
        <Field label={t('snag.unitRef')} name="unitRef" error={error}><input value={common.unitRef} onChange={(e) => setC('unitRef', e.target.value)} maxLength={80} style={big} data-testid="walk-unit" /></Field>
        <Field label={t('snag.drawing')} name="drawingId" error={error}><select value={common.drawingId} onChange={(e) => setC('drawingId', e.target.value)} style={big} data-testid="walk-drawing"><option value="">{t('snag.blankPlan')}</option>{(o?.drawings ?? []).map((d) => <option key={d.id} value={d.id}>{d.drawingNo} {d.title}</option>)}</select></Field>
        <Field label={t('ncr.responsible')} name="responsibleType" error={error}><select value={common.responsibleType} onChange={(e) => setC('responsibleType', e.target.value)} style={big} data-testid="walk-resp">{['OWN_CREW', 'SUBCONTRACTOR', 'SUPPLIER'].map((x) => <option key={x} value={x}>{t(`resp.${x}`)}</option>)}</select></Field>
        {common.responsibleType !== 'OWN_CREW' && <Field label={t('ncr.party')} name="responsibleId" error={error}><select value={common.responsibleId} onChange={(e) => setC('responsibleId', e.target.value)} style={big} data-testid="walk-party"><option value="">—</option>{(o?.partners ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}
        <Field label={t('snag.due')} name="dueDate" error={error}><input type="date" min={today()} value={common.dueDate} onChange={(e) => setC('dueDate', e.target.value)} style={big} data-testid="walk-due" /></Field></div></div>
      <PlanPins fileId={plan?.fileId} pins={done.filter((d) => d.pin).map((d) => ({ ...d.pin, label: d.docNo }))} draft={pin} onPick={setPin} />
      <div className="mdm-panel"><div className="form-grid">
        <Field label={t('snag.category')} name="category" error={error}><select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} style={big} data-testid="walk-category">{['CIVIL', 'FINISHING', 'MEP', 'OTHER'].map((x) => <option key={x} value={x}>{t(`scat.${x}`)}</option>)}</select></Field>
        <Field label={t('snag.punch')} name="punchClass" error={error}><select value={f.punchClass} onChange={(e) => setF({ ...f, punchClass: e.target.value })} style={big} data-testid="walk-class">{['A', 'B', 'C'].map((x) => <option key={x} value={x}>{t(`punch.${x}`)}</option>)}</select></Field>
        <Field label={t('snag.priority')} name="priority" error={error}><select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} style={big}>{['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((x) => <option key={x} value={x}>{t(`prio.${x}`)}</option>)}</select></Field></div>
        <Field label={t('snag.description')} name="description" error={error}><textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={1000} style={{ width: '100%', fontSize: '1rem' }} data-testid="walk-description" /></Field>
        <div className="actions-row"><label className="btn" style={big}>{t('perf.photo')}<input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { setPhoto(e.target.files?.[0] ?? null); e.target.value = ''; }} data-testid="walk-photo" /></label><span className="muted" data-testid="walk-photo-name">{photo?.name ?? ''}</span></div>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy || !projectId || f.description.length < 3 || (common.responsibleType !== 'OWN_CREW' && !common.responsibleId)} onClick={save} data-testid="walk-save">{t('walk.saveNext')}</button></div></div>
      {done.length > 0 && <div className="table-scroll"><table className="data-table" data-testid="walk-done"><caption>{t('walk.raised', { n: done.length })}</caption><tbody>{done.map((d) => <tr key={d.id} data-testid="walk-done-row"><td><Link to={`/qa/snags?id=${d.id}`}>{d.docNo}</Link></td><td>{d.description}</td></tr>)}</tbody></table></div>}
    </section>
  );
}
