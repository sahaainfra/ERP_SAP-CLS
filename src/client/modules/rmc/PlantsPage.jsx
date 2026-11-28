import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { fmtDate, rmc } from './api.js';
import { DocBar, ErrorLine, ProjectSite, Status, big, useRecord, useRunner } from './RmcParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Batching Plants (part 20.01, FR-01 and FR-02): the plant with capacity, silos and bins, weighing scales with calibration, crew and the project, site and cost centre; approved by the project manager; a move is an amendment approved again.
const SCALE_TONE = { OK: 'APPROVED', DUE_SOON: 'RETURNED', OVERDUE: 'REJECTED', NO_DATE: 'DRAFT' };
const blank = { projectId: '', siteId: '', code: '', name: '', capacityM3h: '', makeModel: '', ownership: 'OWN', costCentre: '', budgetHead: '', equipmentId: '', locationId: '', projectIds: [], crew: [{ name: '', role: '', phone: '' }] };
const toInitial = (x) => ({ id: x.id, projectId: String(x.projectId), siteId: String(x.siteId), code: x.code, name: x.name, capacityM3h: String(x.capacityM3h), makeModel: x.makeModel ?? '', ownership: x.ownership, costCentre: x.costCentre ?? '', budgetHead: x.budgetHead ?? '', equipmentId: x.equipmentId ? String(x.equipmentId) : '', locationId: x.locationId ? String(x.locationId) : '', projectIds: x.projectIds ?? [], crew: x.crew?.length ? x.crew : [{ name: '', role: '', phone: '' }] });
const payload = (v) => ({ name: v.name, projectId: Number(v.projectId), siteId: Number(v.siteId), capacityM3h: Number(v.capacityM3h), makeModel: v.makeModel || null, ownership: v.ownership, costCentre: v.costCentre || null, budgetHead: v.budgetHead || null, equipmentId: v.equipmentId ? Number(v.equipmentId) : null, locationId: v.locationId ? Number(v.locationId) : null, projectIds: v.projectIds, crew: v.crew.filter((c) => c.name.trim()) });
function PlantForm({ initial, onSave, busy, error }) {
  const t = useT('rmc'); const o = useQuery({ queryKey: ['rmc', 'plant-options'], queryFn: () => rmc.get('/plants/options'), retry: false }); const [v, setV] = useState(initial);
  if (o.error?.status === 403) return <NoPermission what={t('pl.title')} permission="rmc.plant.create" />; if (o.isPending) return <Skeleton label={t('pl.title')} rows={3} />; const d = o.data; const fe = error?.fields ?? {};
  const setC = (i, k, val) => setV({ ...v, crew: v.crew.map((c, j) => (j === i ? { ...c, [k]: val } : c)) }); const toggle = (id) => setV({ ...v, projectIds: v.projectIds.includes(id) ? v.projectIds.filter((x) => x !== id) : [...v.projectIds, id] });
  return (
    <div className="mdm-panel" data-testid="rmc-plant-form"><div className="form-grid">
      <ProjectSite o={d} v={v} set={setV} error={fe.siteId} />
      <Field label={t('pl.code')} name="code" error={fe.code}><input value={v.code} disabled={Boolean(initial.id)} onChange={(e) => setV({ ...v, code: e.target.value })} maxLength={30} style={big} data-testid="rmc-plant-code" /></Field>
      <Field label={t('pl.name')} name="name" error={fe.name}><input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} maxLength={120} style={big} data-testid="rmc-plant-name" /></Field>
      <Field label={t('pl.capacity')} name="capacityM3h" error={fe.capacityM3h}><input type="number" min="0" inputMode="decimal" value={v.capacityM3h} onChange={(e) => setV({ ...v, capacityM3h: e.target.value })} style={big} data-testid="rmc-plant-capacity" /></Field>
      <Field label={t('pl.makeModel')} name="makeModel" error={fe.makeModel}><input value={v.makeModel} onChange={(e) => setV({ ...v, makeModel: e.target.value })} maxLength={120} style={big} /></Field>
      <Field label={t('pl.ownership')} name="ownership" error={fe.ownership}><select value={v.ownership} onChange={(e) => setV({ ...v, ownership: e.target.value })} style={big}>{['OWN', 'HIRED'].map((k) => <option key={k} value={k}>{t(`pl.own.${k}`)}</option>)}</select></Field>
      <Field label={t('pl.costCentre')} name="costCentre" error={fe.costCentre}><input value={v.costCentre} onChange={(e) => setV({ ...v, costCentre: e.target.value })} maxLength={40} style={big} data-testid="rmc-plant-cc" /></Field>
      <Field label={t('pl.budgetHead')} name="budgetHead" error={fe.budgetHead}><input value={v.budgetHead} onChange={(e) => setV({ ...v, budgetHead: e.target.value })} maxLength={40} style={big} data-testid="rmc-plant-head" /></Field>
      <Field label={t('pl.equipment')} name="equipmentId" error={fe.equipmentId}><select value={v.equipmentId} onChange={(e) => setV({ ...v, equipmentId: e.target.value })} style={big}><option value="">—</option>{d.equipment.map((q) => <option key={q.id} value={q.id}>{q.assetCode} {q.make} {q.model}</option>)}</select></Field>
      <Field label={t('pl.location')} name="locationId" error={fe.locationId}><select value={v.locationId} onChange={(e) => setV({ ...v, locationId: e.target.value })} style={big}><option value="">—</option>{d.locations.filter((l) => String(l.projectId) === String(v.projectId)).map((l) => <option key={l.id} value={l.id}>{l.code} {l.name}</option>)}</select></Field></div>
      <fieldset><legend>{t('pl.serves')}</legend><div className="actions-row">{d.allProjects.map((p) => <label key={p.id} style={{ minHeight: 'var(--erp-target-min)' }}><input type="checkbox" checked={v.projectIds.includes(p.id)} onChange={() => toggle(p.id)} /> {p.code}</label>)}</div></fieldset>
      <h2>{t('pl.crew')}</h2>
      {v.crew.map((c, i) => (
        <div className="form-grid" key={i}><Field label={t('pl.crewName')} name={`c${i}n`} error={null}><input value={c.name} onChange={(e) => setC(i, 'name', e.target.value)} style={big} /></Field><Field label={t('pl.crewRole')} name={`c${i}r`} error={null}><input value={c.role} onChange={(e) => setC(i, 'role', e.target.value)} style={big} /></Field><Field label={t('pl.crewPhone')} name={`c${i}p`} error={null}><input value={c.phone} onChange={(e) => setC(i, 'phone', e.target.value)} style={big} inputMode="tel" /></Field>
          <button type="button" className="btn" onClick={() => setV({ ...v, crew: v.crew.filter((_, j) => j !== i) })}>{t('pl.remove')}</button></div>))}
      <div className="actions-row"><button type="button" className="btn" onClick={() => setV({ ...v, crew: [...v.crew, { name: '', role: '', phone: '' }] })}>{t('pl.addCrew')}</button>
        <button type="button" className="btn btn-primary" style={big} disabled={busy || !v.name.trim() || !v.siteId || !v.code.trim() || !v.capacityM3h} onClick={() => onSave(v)} data-testid="rmc-plant-save">{t('save')}</button></div>
    </div>
  );
}
function Silos({ x, run, busy }) {
  const t = useT('rmc'); const o = useQuery({ queryKey: ['rmc', 'plant-options'], queryFn: () => rmc.get('/plants/options'), retry: false, enabled: x.can.maintain }); const [s, setS] = useState({ code: '', itemId: '', capacity: '', level: '0' });
  return (
    <div data-testid="rmc-silos"><h2>{t('pl.silos')}</h2>
      {x.silos.length === 0 ? <p className="muted">{t('pl.noSilos')}</p> : <div className="table-scroll"><table className="data-table"><thead><tr><th>{t('pl.code')}</th><th>{t('pl.material')}</th><th className="num">{t('pl.capacityKg')}</th><th className="num">{t('pl.level')}</th><th className="num">%</th><th /></tr></thead>
        <tbody>{x.silos.map((q) => <tr key={q.id} data-testid="rmc-silo-row"><td>{q.code}</td><td>{q.item?.code} {q.item?.name}</td><td className="num">{new Intl.NumberFormat('en-IN').format(q.capacity)}</td><td className="num">{new Intl.NumberFormat('en-IN').format(q.level)}</td><td className="num"><progress value={q.level} max={q.capacity || 1} aria-label={q.code} /> {q.levelPct ?? '—'}</td>
          <td>{x.can.maintain && <button type="button" className="btn" disabled={busy} data-testid="rmc-silo-level" onClick={() => { const lv = globalThis.prompt(t('pl.newLevel')); if (lv == null || lv === '') return; const why = globalThis.prompt(t('why')); if (why) run(() => rmc.post(`/silos/${q.id}/level`, { level: Number(lv), reason: why }), t('pl.levelSet')); }}>{t('pl.setLevel')}</button>}</td></tr>)}</tbody></table></div>}
      {x.can.maintain && <form className="form-grid no-print" data-testid="rmc-silo-form" onSubmit={async (e) => { e.preventDefault(); if (await run(() => rmc.post(`/plants/${x.rootId}/silos`, { code: s.code, itemId: Number(s.itemId), capacity: Number(s.capacity), level: Number(s.level || 0) }), t('pl.siloAdded'))) setS({ ...s, code: '', capacity: '' }); }}>
        <Field label={t('pl.code')} name="siloCode" error={null}><input value={s.code} onChange={(e) => setS({ ...s, code: e.target.value })} style={big} data-testid="rmc-silo-code" /></Field>
        <Field label={t('pl.material')} name="itemId" error={null}><select value={s.itemId} onChange={(e) => setS({ ...s, itemId: e.target.value })} style={big} data-testid="rmc-silo-item"><option value="">—</option>{(o.data?.items ?? []).map((q) => <option key={q.id} value={q.id}>{q.code} {q.name}</option>)}</select></Field>
        <Field label={t('pl.capacityKg')} name="siloCap" error={null}><input type="number" min="0" value={s.capacity} onChange={(e) => setS({ ...s, capacity: e.target.value })} style={big} data-testid="rmc-silo-capacity" /></Field>
        <Field label={t('pl.level')} name="siloLevel" error={null}><input type="number" min="0" value={s.level} onChange={(e) => setS({ ...s, level: e.target.value })} style={big} /></Field>
        <div className="actions-row"><button className="btn" style={big} disabled={busy || !s.code || !s.itemId || !s.capacity} data-testid="rmc-silo-add">{t('pl.addSilo')}</button></div></form>}
    </div>
  );
}
function Scales({ x, run, busy }) {
  const t = useT('rmc'); const [s, setS] = useState({ code: '', scaleType: 'CEMENT', calibratedOn: '', calibrationDue: '' });
  return (
    <div data-testid="rmc-scales"><h2>{t('pl.scales')}</h2>
      {x.scales.length === 0 ? <p className="muted">{t('pl.noScales')}</p> : <div className="table-scroll"><table className="data-table"><thead><tr><th>{t('pl.code')}</th><th>{t('pl.scaleType')}</th><th>{t('pl.calibratedOn')}</th><th>{t('pl.calibrationDue')}</th><th>{t('pl.state')}</th><th /></tr></thead>
        <tbody>{x.scales.map((q) => <tr key={q.id} data-testid="rmc-scale-row" data-state={q.state}><td>{q.code}</td><td>{t(`pl.st.${q.type}`)}</td><td>{q.calibratedOn ? fmtDate(q.calibratedOn) : '—'}</td><td>{q.calibrationDue ? fmtDate(q.calibrationDue) : '—'}</td><td><StatusBadge status={SCALE_TONE[q.state]} label={t(`pl.ss.${q.state}`)} /></td>
          <td>{x.can.maintain && <button type="button" className="btn" disabled={busy} data-testid="rmc-scale-recal" onClick={() => { const due = globalThis.prompt(t('pl.newDue')); if (due) run(() => rmc.patch(`/scales/${q.id}`, { calibratedOn: new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10), calibrationDue: due }), t('pl.scaleSaved')); }}>{t('pl.recalibrated')}</button>}</td></tr>)}</tbody></table></div>}
      {x.can.maintain && <form className="form-grid no-print" data-testid="rmc-scale-form" onSubmit={async (e) => { e.preventDefault(); if (await run(() => rmc.post(`/plants/${x.rootId}/scales`, { code: s.code, scaleType: s.scaleType, calibratedOn: s.calibratedOn || null, calibrationDue: s.calibrationDue || null }), t('pl.scaleSaved'))) setS({ ...s, code: '' }); }}>
        <Field label={t('pl.code')} name="scaleCode" error={null}><input value={s.code} onChange={(e) => setS({ ...s, code: e.target.value })} style={big} data-testid="rmc-scale-code" /></Field>
        <Field label={t('pl.scaleType')} name="scaleType" error={null}><select value={s.scaleType} onChange={(e) => setS({ ...s, scaleType: e.target.value })} style={big} data-testid="rmc-scale-type">{['CEMENT', 'AGGREGATE', 'WATER', 'ADMIXTURE', 'OTHER'].map((k) => <option key={k} value={k}>{t(`pl.st.${k}`)}</option>)}</select></Field>
        <Field label={t('pl.calibratedOn')} name="calibratedOn" error={null}><input type="date" value={s.calibratedOn} onChange={(e) => setS({ ...s, calibratedOn: e.target.value })} style={big} /></Field>
        <Field label={t('pl.calibrationDue')} name="calibrationDue" error={null}><input type="date" value={s.calibrationDue} onChange={(e) => setS({ ...s, calibrationDue: e.target.value })} style={big} data-testid="rmc-scale-due" /></Field>
        <div className="actions-row"><button className="btn" style={big} disabled={busy || !s.code} data-testid="rmc-scale-add">{t('pl.addScale')}</button></div></form>}
    </div>
  );
}
function Plant({ id }) {
  const t = useT('rmc'); const { q, guard } = useRecord('/plants', id, t('pl.title'), 'rmc.plant.view'); const { error, run, busy, note } = useRunner(); const [editing, setEditing] = useState(false); usePageTitle(t('pl.title')); if (guard) return guard; const x = q.data;
  return (
    <div data-testid="rmc-plant-object" data-status={x.status}><PageHeader id="pl-h" title={<>{x.code} {x.name} <Status x={x} /></>} meta={<><Link to="/rmc/plants">{t('pl.title')}</Link> · {x.docNo} · {t('pl.version', { n: x.versionNo })} · {x.project} / {x.site}{x.usable ? ` · ${t('pl.usable')}` : ''}</>} />
      <ErrorLine error={error} id="rmc-error" />{note && <p className="mdm-banner" role="status" data-testid="rmc-note">{note}</p>}
      {x.can.edit && <div className="actions-row no-print"><button type="button" className="btn" onClick={() => setEditing(!editing)} data-testid="rmc-plant-edit">{t('edit')}</button></div>}
      {editing && x.can.edit ? <PlantForm initial={toInitial(x)} busy={busy} error={error} onSave={async (v) => { const r = await run(() => rmc.edit('/plants', x.id, { ...payload(v), rowVersion: x.version }), t('pl.saved')); if (r) setEditing(false); }} /> : (
        <div className="mdm-panel" data-testid="rmc-plant-view"><p>{t('pl.capacity')}: <strong data-testid="rmc-plant-cap">{x.capacityM3h}</strong> · {x.makeModel ?? '—'} · {x.ownershipLabel}</p><p>{t('pl.costCentre')}: {x.costCentre ?? '—'} · {t('pl.budgetHead')}: {x.budgetHead ?? '—'}</p><p>{t('pl.serves')}: {x.servedProjects.map((p) => p.code).join(', ') || '—'}</p>{x.equipment && <p>{t('pl.equipment')}: {x.equipment.assetCode} {x.equipment.make} {x.equipment.model}</p>}
          <div className="table-scroll"><table className="data-table"><caption>{t('pl.crew')}</caption><thead><tr><th>{t('pl.crewName')}</th><th>{t('pl.crewRole')}</th><th>{t('pl.crewPhone')}</th></tr></thead><tbody>{x.crew.map((c, i) => <tr key={i}><td>{c.name}</td><td>{c.role}</td><td>{c.phone}</td></tr>)}</tbody></table></div></div>)}
      <Silos x={x} run={run} busy={busy} /><Scales x={x} run={run} busy={busy} />
      <DocBar kind="/plants" x={x} printName={`${x.docNo}.pdf`} />
    </div>
  );
}
function PlantNew() {
  const t = useT('rmc'); const { error, run, busy } = useRunner(); usePageTitle(t('pl.new'));
  return <section aria-labelledby="pln-h"><PageHeader id="pln-h" title={t('pl.new')} meta={<Link to="/rmc/plants">{t('pl.title')}</Link>} /><ErrorLine error={error} id="rmc-error" /><PlantForm initial={blank} busy={busy} error={error} onSave={async (v) => { const r = await run(() => rmc.make('/plants', { ...payload(v), code: v.code })); if (r) navigateTo(`/rmc/plants?id=${r.id}`); }} /></section>;
}
export default function PlantsPage() {
  const t = useT('rmc'); usePageTitle(t('pl.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession();
  if (id) return <section aria-labelledby="pl-h"><Plant id={id} /></section>; if (sp.get('new')) return <PlantNew />;
  return (
    <section aria-labelledby="pls-h" data-testid="rmc-plants"><PageHeader id="pls-h" title={t('pl.title')} subtitle={t('pl.intro')} />
      <div className="actions-row no-print"><Link to="/rmc/plants?new=1" data-testid="rmc-plant-new">{t('pl.new')}</Link></div>
      <ListReport listCode="rmc.plants" endpoint="/rmc/plants" title={t('pl.title')} session={session.data} rowHref={(r) => `/rmc/plants?id=${r.id}`} onOpen={(r) => navigateTo(`/rmc/plants?id=${r.id}`)} cardFields={['code', 'name', 'project', 'status']} statusKey="status" empty={{ title: t('pl.emptyTitle'), text: t('pl.emptyBody') }} />
    </section>
  );
}
