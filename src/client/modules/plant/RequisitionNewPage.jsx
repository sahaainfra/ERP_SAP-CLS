import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from '../site/parts.jsx';
import { pa } from './api.js';
import { useRunner } from './PlantParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// New equipment requisition (part 17.02, FR-01): the class, capacity, quantity, period, purpose and activity; the availability of the fleet for the period is shown while the form is filled.
const blank = { projectId: '', siteId: '', classItemId: '', capacity: '', qty: '1', fromDate: '', toDate: '', purpose: '', activityId: '', priority: 'NORMAL' };
export default function RequisitionNewPage() {
  const t = useT('plant'); const sp = useSearch(); const id = Number(sp.get('id')) || null; usePageTitle(t('a.reqNew')); const oq = useQuery({ queryKey: ['plant', 'req-options'], queryFn: pa.reqOptions, retry: false });
  const eq = useQuery({ queryKey: ['plant', 'req', id], queryFn: () => pa.req(id), enabled: Boolean(id), retry: false }); const { error, run, busy, note } = useRunner(); const [f, setF] = useState(blank); const [loaded, setLoaded] = useState(false); const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  useEffect(() => { const x = eq.data; if (x && !loaded) { setLoaded(true); setF({ projectId: String(x.projectId), siteId: x.siteId ? String(x.siteId) : '', classItemId: String(x.classItemId), capacity: x.capacity ?? '', qty: String(x.qty), fromDate: x.fromDate, toDate: x.toDate, purpose: x.purpose, activityId: x.activityId ? String(x.activityId) : '', priority: x.priority }); } }, [eq.data, loaded]);
  const av = useQuery({ queryKey: ['plant', 'avail-form', f.classItemId, f.fromDate, f.toDate], queryFn: () => pa.availability({ classItemId: f.classItemId, fromDate: f.fromDate, toDate: f.toDate }), enabled: Boolean(f.classItemId && f.fromDate && f.toDate && f.toDate >= f.fromDate), retry: false });
  if (oq.error?.status === 403) return <NoPermission what={t('a.reqNew')} permission="plant.requisition.create" />; if (oq.isPending || (id && eq.isPending)) return <Skeleton label={t('a.reqNew')} rows={5} />; if (oq.isError) return <ErrorState error={oq.error} onRetry={oq.refetch} />;
  const o = oq.data; const sites = o.sites.filter((s) => String(s.projectId) === String(f.projectId)); const acts = o.activities.filter((a) => String(a.projectId) === String(f.projectId));
  const body = () => ({ projectId: Number(f.projectId), siteId: f.siteId ? Number(f.siteId) : null, classItemId: Number(f.classItemId), capacity: f.capacity || null, qty: Number(f.qty) || 1, fromDate: f.fromDate, toDate: f.toDate, purpose: f.purpose, activityId: f.activityId ? Number(f.activityId) : null, priority: f.priority });
  const save = async (submit) => { const d = await run(async () => { let r = id ? await pa.reqUpdate(id, { ...body(), rowVersion: eq.data?.version }) : await pa.reqCreate(body()); if (submit) r = await pa.reqAct(r.id, 'submit'); return r; }, submit ? t('submitted') : t('saved')); if (d) navigateTo(`/plant/requisitions?id=${d.id}`); };
  const req = <span aria-hidden="true" className="muted"> *</span>; const ok = f.projectId && f.classItemId && f.fromDate && f.toDate && f.purpose;
  return (
    <section aria-labelledby="rn-h" data-testid="plant-rq-new"><PageHeader id="rn-h" title={id ? t('a.reqEdit') : t('a.reqNew')} subtitle={<>{t('a.reqNewIntro')} <Link to="/plant/requisitions">{t('a.reqTitle')}</Link></>} />
      {error?.form && <p className="field-error" role="alert" data-testid="rn-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}{note && <p className="mdm-banner" role="status">{note}</p>}
      <div className="mdm-panel"><h2>{t('a.secWhere')}</h2><div className="form-grid">
        <Field label={<>{t('project')}{req}</>} name="projectId" error={error}><select value={f.projectId} onChange={(ev) => setF({ ...f, projectId: ev.target.value, siteId: '', activityId: '' })} style={{ minHeight: 44 }} data-testid="rn-project" aria-required="true"><option value="">—</option>{o.projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></Field>
        <Field label={t('site')} name="siteId" error={error}><select value={f.siteId} onChange={(ev) => set('siteId', ev.target.value)} style={{ minHeight: 44 }} data-testid="rn-site"><option value="">—</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></Field>
        <Field label={t('a.activity')} name="activityId" error={error}><select value={f.activityId} onChange={(ev) => set('activityId', ev.target.value)} style={{ minHeight: 44 }}><option value="">—</option>{acts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></Field></div></div>
      <div className="mdm-panel"><h2>{t('a.secWhat')}</h2><div className="form-grid">
        <Field label={<>{t('class')}{req}</>} name="classItemId" error={error}><select value={f.classItemId} onChange={(ev) => set('classItemId', ev.target.value)} style={{ minHeight: 44 }} data-testid="rn-class" aria-required="true"><option value="">—</option>{o.classes.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></Field>
        <Field label={t('capacity')} name="capacity" error={error}><input value={f.capacity} onChange={(ev) => set('capacity', ev.target.value)} maxLength={80} style={{ minHeight: 44 }} data-testid="rn-capacity" /></Field>
        <Field label={<>{t('a.qty')}{req}</>} name="qty" error={error}><input type="number" min="1" max="1000" value={f.qty} onChange={(ev) => set('qty', ev.target.value)} style={{ minHeight: 44 }} data-testid="rn-qty" /></Field>
        <Field label={<>{t('a.from')}{req}</>} name="fromDate" error={error}><input type="date" value={f.fromDate} onChange={(ev) => set('fromDate', ev.target.value)} style={{ minHeight: 44 }} data-testid="rn-from" /></Field>
        <Field label={<>{t('a.to')}{req}</>} name="toDate" error={error}><input type="date" value={f.toDate} onChange={(ev) => set('toDate', ev.target.value)} style={{ minHeight: 44 }} data-testid="rn-to" /></Field>
        <Field label={t('a.priority')} name="priority" error={error}><select value={f.priority} onChange={(ev) => set('priority', ev.target.value)} style={{ minHeight: 44 }}>{o.priorities.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></Field></div>
        <Field label={<>{t('a.purpose')}{req}</>} name="purpose" error={error}><textarea value={f.purpose} onChange={(ev) => set('purpose', ev.target.value)} rows={2} maxLength={300} style={{ width: '100%' }} data-testid="rn-purpose" /></Field>
        {av.data && <p className="mdm-banner" role="status" data-testid="rn-avail">{av.data.usable >= (Number(f.qty) || 1) ? t('a.availOk', { n: av.data.usable }) : t('a.availShort', { n: av.data.usable, q: Number(f.qty) || 1 })}</p>}</div>
      <div className="actions-row"><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy || !ok} onClick={() => save(false)} data-testid="rn-save">{t('saveDraft')}</button><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy || !ok} onClick={() => save(true)} data-testid="rn-submit">{t('sendForApproval')}</button><button type="button" className="btn" style={{ minHeight: 48 }} onClick={() => { if (!id || globalThis.confirm(t('discard'))) navigateTo('/plant/requisitions'); }}>{t('cancel')}</button></div>
    </section>
  );
}
