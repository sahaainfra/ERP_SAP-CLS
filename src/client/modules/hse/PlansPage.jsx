import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { authHeaders } from '../../platform/api/index.js';
import { browserTransport, uploadFile } from '../../platform/files/upload.js';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { hse } from './api.js';
import { DocBar, ErrorLine, ProjectSite, Status, big, useRecord, useRunner } from './HseParts.jsx';

// HSE Plans (part 19.01, FR-01): the project HSE plan with its emergency contacts, assembly points and hospital; the project manager and the HSE head approve; an approved plan is amended into a new version.
const transport = browserTransport(authHeaders);
function PlanForm({ initial, onSave, busy, error }) {
  const t = useT('hse'); const o = useQuery({ queryKey: ['hse', 'plan-options'], queryFn: () => hse.get('/plans/options'), retry: false }); const [v, setV] = useState(initial);
  if (o.error?.status === 403) return <NoPermission what={t('plan.title')} permission="hse.plan.create" />; if (o.isPending) return <Skeleton label={t('plan.title')} rows={3} />;
  const setC = (i, k, val) => setV({ ...v, contacts: v.contacts.map((c, j) => (j === i ? { ...c, [k]: val } : c)) });
  return (
    <div className="mdm-panel" data-testid="hse-plan-form"><div className="form-grid">
      {!initial.id && <ProjectSite o={o.data} v={v} set={setV} error={error} siteOptional />}
      <Field label={t('plan.titleField')} name="title" error={error}><input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} maxLength={200} style={big} data-testid="hse-plan-title" /></Field>
      <Field label={t('plan.hospital')} name="hospital" error={error}><input value={v.hospital} onChange={(e) => setV({ ...v, hospital: e.target.value })} maxLength={300} style={big} data-testid="hse-plan-hospital" /></Field>
      <Field label={t('plan.assembly')} name="assembly" error={error}><textarea rows={2} value={v.assembly} onChange={(e) => setV({ ...v, assembly: e.target.value })} style={{ width: '100%' }} data-testid="hse-plan-assembly" /></Field>
      <Field label={t('plan.procedure')} name="procedure" error={error}><textarea rows={3} value={v.procedure} onChange={(e) => setV({ ...v, procedure: e.target.value })} maxLength={4000} style={{ width: '100%' }} data-testid="hse-plan-procedure" /></Field></div>
      <h2>{t('plan.contacts')}</h2>
      {v.contacts.map((c, i) => (
        <div className="form-grid" key={i} data-testid="hse-plan-contact"><Field label={t('plan.contactName')} name={`c${i}n`} error={error}><input value={c.name} onChange={(e) => setC(i, 'name', e.target.value)} style={big} /></Field><Field label={t('plan.contactRole')} name={`c${i}r`} error={error}><input value={c.role} onChange={(e) => setC(i, 'role', e.target.value)} style={big} /></Field><Field label={t('plan.contactPhone')} name={`c${i}p`} error={error}><input inputMode="tel" value={c.phone} onChange={(e) => setC(i, 'phone', e.target.value)} style={big} /></Field>
          <button type="button" className="btn" onClick={() => setV({ ...v, contacts: v.contacts.filter((_, j) => j !== i) })}>{t('remove')}</button></div>
      ))}
      <div className="actions-row"><button type="button" className="btn" onClick={() => setV({ ...v, contacts: [...v.contacts, { name: '', role: '', phone: '' }] })} data-testid="hse-plan-add-contact">{t('plan.addContact')}</button>
        <button type="button" className="btn btn-primary" style={big} disabled={busy || v.title.trim().length < 3 || (!initial.id && !v.siteId && !v.projectId)} onClick={() => onSave({ ...v, emergency: { contacts: v.contacts.filter((c) => c.name.trim()), assemblyPoints: v.assembly.split('\n').map((s) => s.trim()).filter(Boolean), hospital: v.hospital, procedure: v.procedure } })} data-testid="hse-plan-save">{t('save')}</button></div></div>
  );
}
const blank = { projectId: '', siteId: '', title: '', hospital: '', assembly: '', procedure: '', contacts: [{ name: '', role: '', phone: '' }] };
const toInitial = (x) => ({ id: x.id, title: x.title, hospital: x.emergency.hospital ?? '', assembly: (x.emergency.assemblyPoints ?? []).join('\n'), procedure: x.emergency.procedure ?? '', contacts: x.emergency.contacts?.length ? x.emergency.contacts : [{ name: '', role: '', phone: '' }] });
function Plan({ id }) {
  const t = useT('hse'); const { q, guard } = useRecord('/plans', id, t('plan.title'), 'hse.plan.view'); const { error, run, busy, note } = useRunner(); const [editing, setEditing] = useState(false); usePageTitle(t('plan.title')); if (guard) return guard; const x = q.data; const em = x.emergency ?? {};
  const upload = async (ev) => { const file = ev.target.files?.[0]; ev.target.value = ''; if (!file) return; await run(async () => { const up = await uploadFile(file, { transport, entity: 'hse_plans', entityId: x.id }); return hse.post(`/plans/${x.id}/file`, { fileId: up.id }); }, t('plan.uploaded')); };
  return (
    <div data-testid="hse-plan-object" data-status={x.status}><h1 id="pl-h">{x.docNo} <Status x={x} /></h1>
      <p><Link to="/hse/plans">{t('plan.title')}</Link> · {x.project} · {t('plan.version', { n: x.versionNo })} · {x.title}</p>
      <ErrorLine error={error} id="hse-plan-error" />{note && <p className="mdm-banner" role="status">{note}</p>}
      {x.can.edit && <div className="actions-row no-print"><button type="button" className="btn" onClick={() => setEditing(!editing)} data-testid="hse-plan-edit">{t('edit')}</button><label className="btn" style={{ minHeight: 44 }}>{t('plan.upload')}<input type="file" hidden onChange={upload} data-testid="hse-plan-file" /></label></div>}
      {editing && x.can.edit ? <PlanForm initial={toInitial(x)} busy={busy} error={error} onSave={async (v) => { const r = await run(() => hse.edit('/plans', x.id, { title: v.title, emergency: v.emergency, rowVersion: x.version }), t('saved')); if (r) setEditing(false); }} /> : (
        <div className="mdm-panel" data-testid="hse-plan-view"><p>{t('plan.hospital')}: {em.hospital || '—'}</p><p>{t('plan.assembly')}: {(em.assemblyPoints ?? []).join(', ') || '—'}</p><p>{t('plan.procedure')}: {em.procedure || '—'}</p>
          <div className="table-scroll"><table className="data-table"><caption>{t('plan.contacts')}</caption><thead><tr><th>{t('plan.contactName')}</th><th>{t('plan.contactRole')}</th><th>{t('plan.contactPhone')}</th></tr></thead><tbody>{(em.contacts ?? []).map((c, i) => <tr key={i}><td>{c.name}</td><td>{c.role}</td><td>{c.phone}</td></tr>)}</tbody></table></div>
          <p>{x.documentFileId ? t('plan.hasDocument') : t('plan.noDocument')}</p></div>)}
      <DocBar kind="/plans" x={x} printName={`${x.docNo}.pdf`} />
    </div>
  );
}
function PlanNew() {
  const t = useT('hse'); const { error, run, busy } = useRunner(); usePageTitle(t('plan.new'));
  return <section aria-labelledby="pln-h"><h1 id="pln-h">{t('plan.new')}</h1><p><Link to="/hse/plans">{t('plan.title')}</Link></p><ErrorLine error={error} id="hse-plan-error" /><PlanForm initial={blank} busy={busy} error={error} onSave={async (v) => { const r = await run(() => hse.make('/plans', { projectId: Number(v.projectId), siteId: v.siteId ? Number(v.siteId) : null, title: v.title, emergency: v.emergency })); if (r) navigateTo(`/hse/plans?id=${r.id}`); }} /></section>;
}
export default function PlansPage() {
  const t = useT('hse'); usePageTitle(t('plan.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession();
  if (id) return <section aria-labelledby="pl-h"><Plan id={id} /></section>; if (sp.get('new')) return <PlanNew />;
  return (
    <section aria-labelledby="pll-h" data-testid="hse-plans"><h1 id="pll-h">{t('plan.title')}</h1><p className="muted">{t('plan.intro')}</p>
      <div className="actions-row no-print"><Link to="/hse/plans?new=1" data-testid="hse-plan-new">{t('plan.new')}</Link></div>
      <ListReport listCode="hse.plans" endpoint="/hse/plans" title={t('plan.title')} session={session.data} rowHref={(r) => `/hse/plans?id=${r.id}`} onOpen={(r) => navigateTo(`/hse/plans?id=${r.id}`)} cardFields={['docNo', 'title', 'version', 'status']} statusKey="status" empty={{ title: t('plan.emptyTitle'), text: t('plan.emptyBody') }} />
    </section>
  );
}
