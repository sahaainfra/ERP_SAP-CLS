import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { authHeaders } from '../../platform/api/index.js';
import { browserTransport, uploadFile } from '../../platform/files/upload.js';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { fmtDate, hse, qs } from './api.js';
import { DocBar, ErrorLine, ProjectSite, Status, big, useRecord, useRunner } from './HseParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Part 19.04: the safety observation card (phone), the observations register and object (action, verification, penalty), PPE issue by QR (phone) and the register by person, the safety equipment register, inspection schedules and the contractor scorecard.
const SEV_TONE = { LOW: 'APPROVED', MEDIUM: 'IN_REVIEW', HIGH: 'RETURNED', CRITICAL: 'REJECTED' }; const transport = browserTransport(authHeaders); const stamp = (s) => (s ? s.replace('T', ' ') : '—'); const nowIn = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
export function ObservationCardPage() {
  const t = useT('hse'); usePageTitle(t('ob.card')); const { error, run, busy } = useRunner(); const [v, setV] = useState({ projectId: '', siteId: '' }); const [f, setF] = useState({ obsType: 'UNSAFE_CONDITION', severity: 'MEDIUM', locationId: '', description: '', responsibleType: 'OWN_CREW', responsibleId: '', immediateAction: '' }); const [photo, setPhoto] = useState(null);
  const oq = useQuery({ queryKey: ['hse', 'obs-options', v.projectId], queryFn: () => hse.get(`/observations/options${qs({ projectId: v.projectId })}`), placeholderData: (p) => p, retry: false });
  if (oq.error?.status === 403) return <NoPermission what={t('ob.card')} permission="hse.observation.create" />; if (oq.isPending) return <Skeleton label={t('ob.card')} rows={4} />; const o = oq.data;
  const send = async () => { const r = await run(async () => { const c = await hse.make('/observations', { projectId: Number(v.projectId), siteId: Number(v.siteId), obsType: f.obsType, severity: f.severity, locationId: f.locationId ? Number(f.locationId) : null, description: f.description, responsibleType: f.responsibleType, responsibleId: f.responsibleId ? Number(f.responsibleId) : null, immediateAction: f.immediateAction || null }); if (photo) { const up = await uploadFile(photo, { transport, entity: 'hse_observations', entityId: c.id }); await hse.post(`/observations/${c.id}/photos`, { fileId: up.id }); } return c; }); if (r) navigateTo(`/hse/observations?id=${r.id}`); };
  return (
    <section aria-labelledby="obc-h" data-testid="hse-obs-card"><PageHeader id="obc-h" title={t('ob.card')} subtitle={<><Link to="/hse/observations">{t('ob.title')}</Link> · {t('ob.cardHint')}</>} /><ErrorLine error={error} id="hse-ob-error" />
      <div className="mdm-panel"><div className="form-grid"><ProjectSite o={o} v={v} set={setV} error={error} />
        <Field label={t('ob.type')} name="obsType" error={error}><select value={f.obsType} onChange={(e) => setF({ ...f, obsType: e.target.value })} style={big} data-testid="hse-ob-type">{['UNSAFE_ACT', 'UNSAFE_CONDITION', 'POSITIVE'].map((x) => <option key={x} value={x}>{t(`obt.${x}`)}</option>)}</select></Field>
        {f.obsType !== 'POSITIVE' && <Field label={t('ob.severity')} name="severity" error={error}><select value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })} style={big} data-testid="hse-ob-severity">{['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((x) => <option key={x} value={x}>{t(`obs.${x}`)}{o.sla?.[x] ? ` (${o.sla[x]} h)` : ''}</option>)}</select></Field>}
        <Field label={t('pm.location')} name="locationId" error={error}><select value={f.locationId} onChange={(e) => setF({ ...f, locationId: e.target.value })} style={big}><option value="">—</option>{o.locations.map((l) => <option key={l.id} value={l.id}>{l.code} {l.name}</option>)}</select></Field>
        <Field label={t('ob.responsible')} name="responsibleType" error={error}><select value={f.responsibleType} onChange={(e) => setF({ ...f, responsibleType: e.target.value })} style={big} data-testid="hse-ob-resp"><option value="OWN_CREW">{t('ob.OWN_CREW')}</option><option value="SUBCONTRACTOR">{t('ob.SUBCONTRACTOR')}</option><option value="SUPPLIER">{t('ob.SUPPLIER')}</option></select></Field>
        {f.responsibleType !== 'OWN_CREW' && <Field label={t('ob.party')} name="responsibleId" error={error}><select value={f.responsibleId} onChange={(e) => setF({ ...f, responsibleId: e.target.value })} style={big} data-testid="hse-ob-party"><option value="">—</option>{o.partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}</div>
        <Field label={t('ob.what')} name="description" error={error}><textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={2000} style={{ width: '100%', fontSize: '1rem' }} data-testid="hse-ob-what" /></Field>
        <Field label={t('inc.immediate')} name="immediateAction" error={error}><input value={f.immediateAction} onChange={(e) => setF({ ...f, immediateAction: e.target.value })} style={big} /></Field>
        <div className="actions-row"><label className="btn" style={big}>{t('perf.photo')}<input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { setPhoto(e.target.files?.[0] ?? null); e.target.value = ''; }} data-testid="hse-ob-photo" /></label><span className="muted">{photo?.name ?? ''}</span></div></div>
      <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy || !v.siteId || f.description.trim().length < 5 || (f.responsibleType !== 'OWN_CREW' && !f.responsibleId)} onClick={send} data-testid="hse-ob-send">{t('ob.send')}</button></div>
    </section>
  );
}
function Observation({ id }) {
  const t = useT('hse'); const { q, guard } = useRecord('/observations', id, t('ob.title'), 'hse.observation.view'); const { error, run, busy, note } = useRunner(); const [act, setAct] = useState(''); const [pen, setPen] = useState({ amount: '', reason: '' }); usePageTitle(t('ob.title')); if (guard) return guard; const x = q.data;
  const photo = async (ev) => { const file = ev.target.files?.[0]; ev.target.value = ''; if (!file) return; await run(async () => { const up = await uploadFile(file, { transport, entity: 'hse_observations', entityId: x.id }); return hse.post(`/observations/${x.id}/photos`, { fileId: up.id }); }, t('tbt.photoAdded')); };
  return (
    <div data-testid="hse-obs-object" data-state={x.state} data-status={x.status}><PageHeader id="obo-h" title={<>{x.docNo} <StatusBadge status={SEV_TONE[x.severity]} label={t(`obs.${x.severity}`)} /> <StatusBadge status={x.state === 'CLOSED' ? 'APPROVED' : x.overdue ? 'REJECTED' : 'IN_REVIEW'} label={t(`obst.${x.state}`)} />{x.escalationLevel > 0 && <> <StatusBadge status="REJECTED" label={t('ob.escalated', { n: x.escalationLevel })} /></>}</>} meta={<><Link to="/hse/observations">{t('ob.title')}</Link> · {x.project} · {t(`obt.${x.obsType}`)} · {x.responsible ?? t(`ob.${x.responsibleType}`)} · {t('ob.due')}: {stamp(x.dueAt)}{x.overdue ? ` · ${t('inc.overdue')}` : ''} · {x.observedBy}</>} />
      <p>{x.description}</p>{x.actionNote && <p data-testid="hse-ob-actionnote">{t('ob.actionDone')}: {x.actionNote} ({x.actionDoneBy}, {fmtDate(x.actionDoneOn)})</p>}{x.penalty && <p data-testid="hse-ob-penalty">{t('ob.penalty')}: ₹ {x.penalty.amount} · {x.penalty.reason}</p>}
      <ErrorLine error={error} id="hse-ob-error" />{note && <p className="mdm-banner" role="status" data-testid="hse-ob-note">{note}</p>}
      <div className="actions-row no-print">{x.can.photo && <label className="btn" style={{ minHeight: 44 }}>{t('tbt.addPhoto')}<input type="file" accept="image/*" capture="environment" hidden onChange={photo} data-testid="hse-ob-add-photo" /></label>}
        {x.can.close && <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => run(() => hse.act('/observations', x.id, 'close', {}), t('ob.closed'))} data-testid="hse-ob-close">{t('ob.verify')}</button>}
        {x.can.reopen && <button type="button" className="btn" disabled={busy} onClick={() => { const r = globalThis.prompt(t('why')); if (r) run(() => hse.act('/observations', x.id, 'reopen', { reason: r }), t('ob.reopened')); }}>{t('ob.reopen')}</button>}
        {x.can.cancel && x.state !== 'CLOSED' && <button type="button" className="btn" disabled={busy} onClick={() => { const r = globalThis.prompt(t('why')); if (r) run(() => hse.act('/observations', x.id, 'cancel', { reason: r }), t('cancelled')); }} data-testid="hse-ob-cancel-obs">{t('cancel')}</button>}</div>
      {x.can.act && <div className="mdm-panel no-print" data-testid="hse-ob-act"><h2>{t('ob.reportAction')}</h2><Field label={t('ob.actionTaken')} name="note" error={error}><textarea rows={2} value={act} onChange={(e) => setAct(e.target.value)} style={{ width: '100%' }} data-testid="hse-ob-act-note" /></Field><button type="button" className="btn btn-primary" style={big} disabled={busy || act.trim().length < 3} onClick={() => run(() => hse.act('/observations', x.id, 'act', { note: act }), t('ob.actionSaved'))} data-testid="hse-ob-act-go">{t('ob.actionDone')}</button></div>}
      {x.can.penalty && (
        <div className="mdm-panel no-print" data-testid="hse-ob-penalty-form"><h2>{t('ob.penalty')}</h2><div className="form-grid"><Field label={t('ob.amount')} name="amount" error={error}><input type="number" min="1" inputMode="decimal" value={pen.amount} onChange={(e) => setPen({ ...pen, amount: e.target.value })} style={big} data-testid="hse-pen-amount" /></Field><Field label={t('pm.reason')} name="reason" error={error}><input value={pen.reason} onChange={(e) => setPen({ ...pen, reason: e.target.value })} style={big} data-testid="hse-pen-reason" /></Field><button type="button" className="btn" style={big} disabled={busy || !pen.amount || pen.reason.length < 5} onClick={() => run(() => hse.post(`/observations/${x.id}/penalty`, { amount: Number(pen.amount), reason: pen.reason }), t('ob.penaltySaved'))} data-testid="hse-pen-save">{t('ob.proposePenalty')}</button></div></div>)}
      <DocBar kind="/observations" x={x} printName={`${x.docNo}.pdf`} />
    </div>
  );
}
export function ObservationsPage() {
  const t = useT('hse'); usePageTitle(t('ob.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession();
  if (id) return <section aria-labelledby="obo-h"><Observation id={id} /></section>;
  return (
    <section aria-labelledby="obl-h" data-testid="hse-observations"><PageHeader id="obl-h" title={t('ob.title')} subtitle={t('ob.intro')} />
      <div className="actions-row no-print"><Link to="/hse/observation" data-testid="hse-ob-new">{t('ob.card')}</Link><button type="button" className="btn" onClick={() => hse.exportFile('/observations/export', 'observations.csv').catch(() => globalThis.alert?.(t('exportFailed')))}>{t('export')}</button></div>
      <ListReport listCode="hse.observations" endpoint="/hse/observations" title={t('ob.title')} session={session.data} rowHref={(r) => `/hse/observations?id=${r.id}`} onOpen={(r) => navigateTo(`/hse/observations?id=${r.id}`)} cardFields={['docNo', 'type', 'severity', 'state']} statusKey="status" empty={{ title: t('ob.emptyTitle'), text: t('ob.emptyBody') }} />
    </section>
  );
}
export function PpeIssuePage() {
  const t = useT('hse'); usePageTitle(t('ppe.title')); const { error, run, busy } = useRunner(); const [siteId, setSiteId] = useState(''); const [itemId, setItemId] = useState(''); const [badge, setBadge] = useState(''); const [done, setDone] = useState([]); const [holds, setHolds] = useState(null);
  const oq = useQuery({ queryKey: ['hse', 'ppe-options'], queryFn: () => hse.get('/ppe/options'), retry: false });
  if (oq.error?.status === 403) return <NoPermission what={t('ppe.title')} permission="hse.ppe.give" />; if (oq.isPending) return <Skeleton label={t('ppe.title')} rows={3} />; const o = oq.data;
  const go = async () => { const r = await run(() => hse.post('/ppe', { siteId: Number(siteId), ppeItemId: Number(itemId), badge })); if (r) { setDone((d) => [r, ...d]); setHolds(await hse.get(`/ppe/person${qs({ badge })}`).catch(() => null)); setBadge(''); } };
  return (
    <section aria-labelledby="ppe-h" data-testid="hse-ppe-issue"><PageHeader id="ppe-h" title={t('ppe.title')} subtitle={<><Link to="/hse/ppe-register">{t('ppe.register')}</Link> · {t('ppe.hint')}</>} /><ErrorLine error={error} id="hse-ppe-error" />
      <div className="mdm-panel"><div className="form-grid"><Field label={t('site')} name="siteId" error={error}><select value={siteId} onChange={(e) => setSiteId(e.target.value)} style={big} data-testid="hse-ppe-site"><option value="">—</option>{o.sites.map((s) => <option key={s.id} value={s.id}>{s.code} {s.name}</option>)}</select></Field>
        <Field label={t('ppe.item')} name="ppeItemId" error={error}><select value={itemId} onChange={(e) => setItemId(e.target.value)} style={big} data-testid="hse-ppe-item"><option value="">—</option>{o.items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></Field>
        <Field label={t('ind.badge')} name="badge" error={error}><input value={badge} onChange={(e) => setBadge(e.target.value)} placeholder="LAB:…" autoComplete="off" style={big} data-testid="hse-ppe-badge" /></Field></div>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy || !siteId || !itemId || badge.length < 3} onClick={go} data-testid="hse-ppe-go">{t('ppe.issue')}</button></div></div>
      {done.length > 0 && <div className="table-scroll"><table className="data-table" data-testid="hse-ppe-done"><caption>{t('ppe.issuedNow')}</caption><tbody>{done.map((d) => <tr key={d.id} data-testid="hse-ppe-done-row"><td>{d.docNo}</td><td>{d.personName} ({d.personCode})</td><td>{d.item}</td><td>{d.replacesId ? t('ppe.replacement') : ''}</td><td>{d.replaceDue ? `${t('ppe.replaceBy')} ${fmtDate(d.replaceDue)}` : ''}</td></tr>)}</tbody></table></div>}
      {holds && <p data-testid="hse-ppe-holds">{t('ppe.holds', { name: holds.person.name, n: holds.issued.length, od: holds.overdue })}</p>}
    </section>
  );
}
export function PpeRegisterPage() {
  const t = useT('hse'); usePageTitle(t('ppe.register')); const session = useSession(); const { run, busy, error, note } = useRunner();
  return (
    <section aria-labelledby="ppr-h" data-testid="hse-ppe-register"><PageHeader id="ppr-h" title={t('ppe.register')} subtitle={<>{t('ppe.registerIntro')} <Link to="/hse/ppe-issue">{t('ppe.title')}</Link></>} /><ErrorLine error={error} id="hse-ppr-error" />{note && <p className="mdm-banner" role="status" data-testid="hse-ppr-note">{note}</p>}
      <ListReport listCode="hse.ppe_issues" endpoint="/hse/ppe" exportEndpoint="/ui/lists/hse.ppe_issues/export" title={t('ppe.register')} session={session.data} cardFields={['person', 'item', 'replaceDue', 'state']} statusKey="state" dateKey="replaceDue" rowActions={(r) => (r.state === 'ISSUED' && r.can?.return ? [{ key: 'ret', label: t('ppe.return'), onSelect: () => run(() => hse.post(`/ppe/${r.id}/return`, { condition: 'GOOD' }), t('ppe.returned')) }] : [])} empty={{ title: t('ppe.emptyTitle'), text: t('ppe.emptyBody') }} />
      <span hidden>{String(busy)}</span>
    </section>
  );
}
export function EquipmentPage() {
  const t = useT('hse'); usePageTitle(t('eq.title')); const session = useSession(); const { error, run, busy, note } = useRunner(); const [v, setV] = useState({ projectId: '', siteId: '' }); const [f, setF] = useState({ equipType: 'FIRE_EXTINGUISHER', tag: '', locationText: '', capacity: '', expiryDate: '' });
  const oq = useQuery({ queryKey: ['hse', 'eq-options', v.projectId], queryFn: () => hse.get(`/equipment/options${qs({ projectId: v.projectId })}`), placeholderData: (p) => p, retry: false });
  return (
    <section aria-labelledby="eq-h" data-testid="hse-equipment"><PageHeader id="eq-h" title={t('eq.title')} subtitle={t('eq.intro')} />
      {oq.data && <details className="mdm-panel no-print" data-testid="hse-eq-form"><summary>{t('eq.new')}</summary><ErrorLine error={error} id="hse-eq-error" />{note && <p className="mdm-banner" role="status" data-testid="hse-eq-note">{note}</p>}
        <div className="form-grid"><ProjectSite o={oq.data} v={v} set={setV} error={error} />
          <Field label={t('eq.type')} name="equipType" error={error}><select value={f.equipType} onChange={(e) => setF({ ...f, equipType: e.target.value })} style={big}>{oq.data.types.map((x) => <option key={x.id} value={x.id}>{t(`eqt.${x.id}`)}</option>)}</select></Field>
          <Field label={t('eq.tag')} name="tag" error={error}><input value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value })} style={big} data-testid="hse-eq-tag" /></Field><Field label={t('eq.where')} name="locationText" error={error}><input value={f.locationText} onChange={(e) => setF({ ...f, locationText: e.target.value })} style={big} /></Field>
          <Field label={t('eq.capacity')} name="capacity" error={error}><input value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} style={big} /></Field><Field label={t('eq.expiry')} name="expiryDate" error={error}><input type="date" value={f.expiryDate} onChange={(e) => setF({ ...f, expiryDate: e.target.value })} style={big} data-testid="hse-eq-expiry" /></Field></div>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy || !v.siteId || !f.tag} onClick={() => run(() => hse.make('/equipment', { projectId: Number(v.projectId), siteId: Number(v.siteId), equipType: f.equipType, tag: f.tag, locationText: f.locationText || null, capacity: f.capacity || null, expiryDate: f.expiryDate || null }), t('eq.saved'))} data-testid="hse-eq-save">{t('save')}</button></div></details>}
      <ListReport listCode="hse.equipment" endpoint="/hse/equipment" exportEndpoint="/ui/lists/hse.equipment/export" title={t('eq.title')} session={session.data} cardFields={['tag', 'type', 'expiry', 'status']} statusKey="status" dateKey="expiry" empty={{ title: t('eq.emptyTitle'), text: t('eq.emptyBody') }} />
    </section>
  );
}
export function SchedulesPage() {
  const t = useT('hse'); usePageTitle(t('sch.title')); const session = useSession(); const { error, run, busy, note } = useRunner(); const [v, setV] = useState({ projectId: '', siteId: '' }); const [f, setF] = useState({ code: '', title: '', registerType: 'SCAFFOLD', templateId: '', frequencyDays: 7, nextDue: nowIn() });
  const oq = useQuery({ queryKey: ['hse', 'sch-options'], queryFn: () => hse.get('/inspection-schedules/options'), retry: false });
  return (
    <section aria-labelledby="sch-h" data-testid="hse-schedules"><PageHeader id="sch-h" title={t('sch.title')} subtitle={t('sch.intro')} />
      {oq.data && <details className="mdm-panel no-print" data-testid="hse-sch-form"><summary>{t('sch.new')}</summary><ErrorLine error={error} id="hse-sch-error" />{note && <p className="mdm-banner" role="status" data-testid="hse-sch-note">{note}</p>}
        <div className="form-grid"><ProjectSite o={oq.data} v={v} set={setV} error={error} /><Field label={t('lib.code')} name="code" error={error}><input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} style={big} data-testid="hse-sch-code" /></Field><Field label={t('sch.what')} name="title" error={error}><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} style={big} data-testid="hse-sch-title" /></Field>
          <Field label={t('sch.register')} name="registerType" error={error}><select value={f.registerType} onChange={(e) => setF({ ...f, registerType: e.target.value })} style={big}>{oq.data.registerTypes.map((x) => <option key={x.id} value={x.id}>{t(`reg.${x.id}`)}</option>)}</select></Field>
          <Field label={t('sch.checklist')} name="templateId" error={error}><select value={f.templateId} onChange={(e) => setF({ ...f, templateId: e.target.value })} style={big} data-testid="hse-sch-template"><option value="">—</option>{oq.data.templates.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
          <Field label={t('sch.every')} name="frequencyDays" error={error}><input type="number" min="1" max="366" value={f.frequencyDays} onChange={(e) => setF({ ...f, frequencyDays: e.target.value })} style={big} /></Field><Field label={t('sch.nextDue')} name="nextDue" error={error}><input type="date" value={f.nextDue} onChange={(e) => setF({ ...f, nextDue: e.target.value })} style={big} /></Field></div>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy || !v.siteId || !f.templateId || f.code.length < 2 || f.title.length < 3} onClick={() => run(() => hse.make('/inspection-schedules', { code: f.code, title: f.title, registerType: f.registerType, projectId: Number(v.projectId), siteId: Number(v.siteId), templateId: Number(f.templateId), frequencyDays: Number(f.frequencyDays), nextDue: f.nextDue }), t('sch.saved'))} data-testid="hse-sch-save">{t('save')}</button></div></details>}
      <ListReport listCode="hse.schedules" endpoint="/hse/inspection-schedules" exportEndpoint="/ui/lists/hse.schedules/export" title={t('sch.title')} session={session.data} cardFields={['title', 'site', 'nextDue', 'status']} statusKey="status" dateKey="nextDue" empty={{ title: t('sch.emptyTitle'), text: t('sch.emptyBody') }} />
    </section>
  );
}
export function ContractorScoresPage() {
  const t = useT('hse'); usePageTitle(t('cs.title')); const [period, setPeriod] = useState(nowIn().slice(0, 7)); const q = useQuery({ queryKey: ['hse', 'contractor-scores', period], queryFn: () => hse.get(`/contractor-scores${qs({ period })}`), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('cs.title')} permission="hse.contractor_score.view" />; if (q.isPending) return <Skeleton label={t('cs.title')} rows={4} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />; const d = q.data; const tone = { A: 'APPROVED', B: 'IN_REVIEW', C: 'RETURNED', D: 'REJECTED' };
  return (
    <section aria-labelledby="cs-h" data-testid="hse-contractor-scores"><PageHeader id="cs-h" title={t('cs.title')} subtitle={t('cs.intro', { v: d.weights.violation, i: d.weights.incident })} />
      <div className="form-grid no-print"><Field label={t('cs.period')} name="period" error={null}><input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} style={big} data-testid="hse-cs-period" /></Field><button type="button" className="btn" style={big} onClick={() => hse.exportFile(`/contractor-scores/export${qs({ period })}`, `contractor-safety-${period}.csv`).catch(() => globalThis.alert?.(t('exportFailed')))} data-testid="hse-cs-export">{t('export')}</button></div>
      {d.rows.length === 0 ? <div className="empty-state" data-testid="hse-cs-empty"><h2>{t('cs.emptyTitle')}</h2><p>{t('cs.emptyBody')}</p></div> : (
        <div className="table-scroll"><table className="data-table" data-testid="hse-cs-table"><thead><tr><th>{t('cs.contractor')}</th><th>{t('cs.workers')}</th><th>{t('cs.induction')}</th><th>{t('cs.ppe')}</th><th>{t('cs.violations')}</th><th>{t('cs.incidents')}</th><th>{t('cs.penalties')}</th><th>{t('cs.score')}</th></tr></thead>
          <tbody>{d.rows.map((r) => <tr key={r.partnerId} data-testid="hse-cs-row"><td>{r.name}</td><td>{r.workers}</td><td>{r.inductionPct}%</td><td>{r.ppePct}%</td><td>{r.violations}</td><td>{r.incidents}</td><td>₹ {r.penalties}</td><td><StatusBadge status={tone[r.band]} label={`${r.score} (${r.band})`} /></td></tr>)}</tbody></table></div>)}
    </section>
  );
}
void Status;
