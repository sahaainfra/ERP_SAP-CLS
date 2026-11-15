import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { hse, qs } from './api.js';
import { DocBar, ErrorLine, ProjectSite, Status, big, today, useRecord, useRunner } from './HseParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Part 19.07: camp occupancy and muster, camp set-up (rooms, assets), the room and bed board, welfare inspections, the mess register and the monthly recovery.
const AL = { ALLOCATED: 'IN_REVIEW', CHECKED_IN: 'APPROVED', CHECKED_OUT: 'DRAFT', CANCELLED: 'CANCELLED' };
const AREAS = ['WATER', 'TOILETS', 'DRAINAGE', 'ELECTRICITY', 'FIRE_SAFETY', 'FIRST_AID', 'CRECHE', 'MESS', 'GENERAL'];

function useOccupancy() { return useQuery({ queryKey: ['hse', 'camp-occupancy'], queryFn: () => hse.get('/camp-occupancy'), retry: false }); }
function CampPick({ camps, value, onChange, testid }) {
  const t = useT('hse');
  return <Field label={t('camp.camp')} name="campId" error={null}><select value={value} onChange={(e) => onChange(e.target.value)} style={big} data-testid={testid}><option value="">—</option>{camps.map((c) => <option key={c.campId} value={c.campId}>{c.code} {c.name}</option>)}</select></Field>;
}

export function CampOccupancyPage() {
  const t = useT('hse'); usePageTitle(t('camp.title')); const sp = useSearch(); const muster = Number(sp.get('muster')) || null; const oq = useOccupancy();
  if (muster) return <Muster id={muster} />;
  if (oq.error?.status === 403) return <NoPermission what={t('camp.title')} permission="hse.camp.view" />; if (oq.isPending) return <Skeleton label={t('camp.title')} rows={3} />; if (oq.isError) return <ErrorState error={oq.error} onRetry={oq.refetch} />; const o = oq.data;
  return (
    <section aria-labelledby="co-h" data-testid="hse-camp-occupancy"><PageHeader id="co-h" title={t('camp.title')} subtitle={t('camp.intro')} />
      <p data-testid="hse-occ-total">{t('camp.total', { beds: o.totals.beds, occ: o.totals.occupied, free: o.totals.free })}</p>
      {o.camps.length === 0 ? <div className="empty-state"><h2>{t('camp.emptyTitle')}</h2><p>{t('camp.emptyBody')}</p></div> : (
        <div className="table-scroll"><table className="data-table" data-testid="hse-occ-table"><thead><tr><th>{t('camp.camp')}</th><th>{t('camp.beds')}</th><th>{t('camp.occupied')}</th><th>{t('camp.free')}</th><th>{t('camp.pct')}</th><th>{t('camp.inCamp')}</th><th>{t('camp.byContractor')}</th><th /></tr></thead>
          <tbody>{o.camps.map((c) => <tr key={c.campId} data-testid="hse-occ-row"><td>{c.code} {c.name}</td><td>{c.beds}</td><td>{c.occupied}</td><td>{c.free}</td><td>{c.occupancyPct ?? '—'}</td><td>{c.inCamp}</td><td>{c.byContractor.map((b) => `${b.name} ${b.beds}`).join(', ') || '—'}</td><td><Link to={`/hse/camp?muster=${c.campId}`}>{t('camp.muster')}</Link> · <Link to={`/hse/camp-setup?camp=${c.campId}`}>{t('camp.setup')}</Link></td></tr>)}</tbody></table></div>)}
      <div className="actions-row no-print"><Link to="/hse/camp-setup">{t('camp.camps')}</Link> · <Link to="/hse/camp-allocation">{t('camp.board')}</Link> · <Link to="/hse/camp-mess">{t('camp.mess')}</Link> · <Link to="/hse/camp-inspections">{t('camp.inspections')}</Link></div>
    </section>
  );
}

export function CampSetupPage() {
  const t = useT('hse'); usePageTitle(t('camp.camps')); const session = useSession(); const sp = useSearch(); const campId = Number(sp.get('camp')) || null;
  if (campId) return <CampSetup id={campId} />; if (sp.get('new')) return <CampNew />;
  return (
    <section aria-labelledby="cl-h" data-testid="hse-camp-list"><PageHeader id="cl-h" title={t('camp.camps')} />
      <div className="actions-row no-print"><Link to="/hse/camp-setup?new=1" data-testid="hse-camp-new">{t('camp.new')}</Link> · <Link to="/hse/camp">{t('camp.title')}</Link></div>
      <ListReport listCode="hse.camps" endpoint="/hse/camps" title={t('camp.camps')} session={session.data} rowHref={(r) => `/hse/camp-setup?camp=${r.id}`} onOpen={(r) => navigateTo(`/hse/camp-setup?camp=${r.id}`)} cardFields={['code', 'name', 'site', 'status']} statusKey="status" empty={{ title: t('camp.emptyTitle'), text: t('camp.emptyBody') }} />
    </section>
  );
}

function CampNew() {
  const t = useT('hse'); usePageTitle(t('camp.new')); const { error, run, busy } = useRunner(); const [v, setV] = useState({ projectId: '', siteId: '' }); const [f, setF] = useState({ code: '', name: '', inCharge: '' }); const oq = useQuery({ queryKey: ['hse', 'camp-options'], queryFn: () => hse.get('/camps/options'), retry: false });
  if (oq.error?.status === 403) return <NoPermission what={t('camp.new')} permission="hse.camp.create" />; if (oq.isPending) return <Skeleton label={t('camp.new')} rows={3} />; const o = oq.data; const fe = error?.fields ?? {};
  const save = async (e) => { e.preventDefault(); const r = await run(() => hse.post('/camps', { projectId: Number(v.projectId), siteId: Number(v.siteId), code: f.code, name: f.name, inCharge: f.inCharge || undefined })); if (r) navigateTo(`/hse/camp-setup?camp=${r.id}`); };
  return (
    <section aria-labelledby="cn-h" data-testid="hse-camp-form"><PageHeader id="cn-h" title={t('camp.new')} /><ErrorLine error={error} id="hse-error" />
      <form onSubmit={save} className="form-grid"><ProjectSite o={o} v={v} set={setV} error={fe.siteId} />
        <Field label={t('camp.code')} name="code" error={fe.code}><input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} style={big} data-testid="hse-camp-code" /></Field>
        <Field label={t('camp.name')} name="name" error={fe.name}><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} style={big} data-testid="hse-camp-name" /></Field>
        <Field label={t('camp.inCharge')} name="inCharge" error={fe.inCharge}><select value={f.inCharge} onChange={(e) => setF({ ...f, inCharge: e.target.value })} style={big}><option value="">—</option>{o.users.map((u) => <option key={u.username} value={u.username}>{u.name}</option>)}</select></Field>
        <div className="actions-row"><button className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} data-testid="hse-camp-save">{t('save')}</button></div></form>
    </section>
  );
}

function CampSetup({ id }) {
  const t = useT('hse'); const { error, run, busy, note } = useRunner(); const { q, guard } = useRecord('/camps', id, t('camp.setup'), 'hse.camp.view'); const aq = useQuery({ queryKey: ['hse', 'camp-assets', id], queryFn: () => hse.get(`/camps/${id}/assets`), retry: false });
  const [r, setR] = useState({ block: 'A', roomNo: '', beds: '4', roomType: 'DORMITORY' }); const [a, setA] = useState({ assetName: '', category: 'FURNITURE', qty: '1' }); usePageTitle(t('camp.setup')); if (guard) return guard; const x = q.data; const fe = error?.fields ?? {};
  return (
    <section aria-labelledby="cs-h" data-testid="hse-camp-setup"><PageHeader id="cs-h" title={<>{x.code} {x.name}</>} meta={<><Link to="/hse/camp">{t('camp.title')}</Link> · {t('camp.total', { beds: x.beds, occ: x.occupied, free: x.free })}</>} /><ErrorLine error={error} id="hse-error" />{note && <p className="mdm-banner" role="status">{note}</p>}
      <div className="table-scroll"><table className="data-table" data-testid="hse-room-table"><thead><tr><th>{t('camp.block')}</th><th>{t('camp.room')}</th><th>{t('camp.beds')}</th><th>{t('camp.occupied')}</th><th>{t('camp.roomType')}</th><th>{t('camp.state')}</th><th /></tr></thead>
        <tbody>{x.rooms.map((m) => <tr key={m.id} data-testid="hse-room-row"><td>{m.block}</td><td>{m.roomNo}</td><td>{m.beds}</td><td>{m.occupied}</td><td>{t(`camp.rt.${m.type}`)}</td><td>{m.status}</td><td>{x.can.edit && <button type="button" className="btn" disabled={busy} onClick={() => run(() => hse.patch(`/camp-rooms/${m.id}`, { status: m.status === 'ACTIVE' ? 'MAINTENANCE' : 'ACTIVE' }), t('camp.saved'))}>{m.status === 'ACTIVE' ? t('camp.close') : t('camp.open')}</button>}</td></tr>)}</tbody></table></div>
      {x.can.edit && <form className="form-grid" data-testid="hse-room-form" onSubmit={async (e) => { e.preventDefault(); if (await run(() => hse.post('/camp-rooms', { campId: id, block: r.block, roomNo: r.roomNo, beds: Number(r.beds), roomType: r.roomType }), t('camp.saved'))) setR({ ...r, roomNo: '' }); }}><h2>{t('camp.addRoom')}</h2>
        <Field label={t('camp.block')} name="block" error={fe.block}><input value={r.block} onChange={(e) => setR({ ...r, block: e.target.value })} style={big} data-testid="hse-room-block" /></Field>
        <Field label={t('camp.room')} name="roomNo" error={fe.roomNo}><input value={r.roomNo} onChange={(e) => setR({ ...r, roomNo: e.target.value })} style={big} data-testid="hse-room-no" /></Field>
        <Field label={t('camp.beds')} name="beds" error={fe.beds}><input type="number" min="1" max="20" value={r.beds} onChange={(e) => setR({ ...r, beds: e.target.value })} style={big} data-testid="hse-room-beds" /></Field>
        <Field label={t('camp.roomType')} name="roomType" error={fe.roomType}><select value={r.roomType} onChange={(e) => setR({ ...r, roomType: e.target.value })} style={big}>{['DORMITORY', 'FAMILY', 'STAFF', 'ISOLATION'].map((k) => <option key={k} value={k}>{t(`camp.rt.${k}`)}</option>)}</select></Field>
        <div className="actions-row"><button className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} data-testid="hse-room-save">{t('camp.addRoom')}</button></div></form>}
      <h2>{t('camp.assets')}</h2>
      {aq.data?.length ? <div className="table-scroll"><table className="data-table" data-testid="hse-asset-table"><thead><tr><th>{t('camp.assetName')}</th><th>{t('camp.category')}</th><th>{t('camp.qty')}</th><th>{t('camp.condition')}</th></tr></thead><tbody>{aq.data.map((s) => <tr key={s.id}><td>{s.name}</td><td>{t(`camp.cat.${s.category}`)}</td><td>{s.qty}</td><td>{t(`camp.cond.${s.condition}`)}</td></tr>)}</tbody></table></div> : <p className="muted">{t('camp.noAssets')}</p>}
      <form className="form-grid" data-testid="hse-asset-form" onSubmit={async (e) => { e.preventDefault(); if (await run(() => hse.post('/camp-assets', { campId: id, assetName: a.assetName, category: a.category, qty: Number(a.qty) }), t('camp.saved'))) setA({ ...a, assetName: '' }); }}>
        <Field label={t('camp.assetName')} name="assetName" error={fe.assetName}><input value={a.assetName} onChange={(e) => setA({ ...a, assetName: e.target.value })} style={big} data-testid="hse-asset-name" /></Field>
        <Field label={t('camp.category')} name="category" error={fe.category}><select value={a.category} onChange={(e) => setA({ ...a, category: e.target.value })} style={big}>{['FURNITURE', 'BEDDING', 'KITCHEN', 'ELECTRICAL', 'SANITATION', 'OTHER'].map((k) => <option key={k} value={k}>{t(`camp.cat.${k}`)}</option>)}</select></Field>
        <Field label={t('camp.qty')} name="qty" error={fe.qty}><input type="number" min="0" value={a.qty} onChange={(e) => setA({ ...a, qty: e.target.value })} style={big} /></Field>
        <div className="actions-row"><button className="btn" style={{ minHeight: 48 }} disabled={busy} data-testid="hse-asset-save">{t('camp.addAsset')}</button></div></form>
    </section>
  );
}

function Muster({ id }) {
  const t = useT('hse'); usePageTitle(t('camp.muster')); const mq = useQuery({ queryKey: ['hse', 'muster', id], queryFn: () => hse.get(`/camps/${id}/muster`), retry: false });
  if (mq.error?.status === 403) return <NoPermission what={t('camp.muster')} permission="hse.camp.muster" />; if (mq.isPending) return <Skeleton label={t('camp.muster')} rows={4} />; if (mq.isError) return <ErrorState error={mq.error} onRetry={mq.refetch} />; const m = mq.data;
  return (
    <section aria-labelledby="mu-h" data-testid="hse-muster"><PageHeader id="mu-h" title={t('camp.muster')} meta={<><Link to="/hse/camp">{t('camp.title')}</Link> · <span data-testid="hse-muster-count">{t('camp.musterCount', { n: m.residents.length })}</span></>} />
      <div className="actions-row no-print"><button type="button" className="btn" onClick={() => hse.exportFile(`/camps/${id}/muster/pdf`, 'muster.pdf').catch(() => globalThis.alert?.(t('exportFailed')))} data-testid="hse-muster-pdf">{t('print')}</button></div>
      <div className="table-scroll"><table className="data-table"><thead><tr><th>{t('camp.person')}</th><th>{t('camp.code')}</th><th>{t('camp.room')}</th><th>{t('camp.bed')}</th><th>{t('camp.contractor')}</th></tr></thead><tbody>{m.residents.map((r, i) => <tr key={i}><td>{r.name}</td><td>{r.code}</td><td>{r.room}</td><td>{r.bed}</td><td>{r.contractor ?? '—'}</td></tr>)}</tbody></table></div>
    </section>
  );
}

export function AllocationsPage() {
  const t = useT('hse'); usePageTitle(t('al.title')); const session = useSession(); const { error, run, busy, note } = useRunner(); const oq = useOccupancy(); const [campId, setCampId] = useState(''); const [pick, setPick] = useState(null); const [badge, setBadge] = useState('');
  const bq = useQuery({ queryKey: ['hse', 'alloc-board', campId], queryFn: () => hse.get(`/allocations/board${qs({ campId })}`), enabled: Boolean(campId), retry: false });
  if (oq.error?.status === 403) return <NoPermission what={t('al.title')} permission="hse.camp.view" />; if (oq.isPending) return <Skeleton label={t('al.title')} rows={3} />;
  const give = async (e) => { e.preventDefault(); const r = await run(() => hse.post('/allocations', { campId: Number(campId), roomId: pick.roomId, bedNo: pick.bedNo, badge }), t('al.given')); if (r) { setPick(null); setBadge(''); } };
  const act = (b, what, done) => run(() => hse.post(`/allocations/${b.allocationId}/${what}`), done);
  return (
    <section aria-labelledby="al-h" data-testid="hse-allocations"><PageHeader id="al-h" title={t('al.title')} subtitle={t('al.intro')} /><ErrorLine error={error} id="hse-error" />{note && <p className="mdm-banner" role="status" data-testid="hse-note">{note}</p>}
      <div className="form-grid no-print"><CampPick camps={oq.data?.camps ?? []} value={campId} onChange={(v) => { setCampId(v); setPick(null); }} testid="hse-al-camp" /></div>
      {!campId ? <div className="empty-state"><h2>{t('al.chooseCamp')}</h2></div> : bq.isPending ? <Skeleton label={t('al.title')} rows={3} /> : bq.isError ? <ErrorState error={bq.error} onRetry={bq.refetch} /> : (
        <div data-testid="hse-al-board">{bq.data.rooms.map((m) => (
          <div key={m.id} className="mdm-panel" data-testid="hse-al-room"><h2>{m.block}-{m.roomNo} <small>{t(`camp.rt.${m.type}`)}</small></h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{m.beds.map((b) => (
              <div key={b.bedNo} className="mdm-panel" data-testid="hse-al-bed" data-state={b.state} style={{ minWidth: 150 }}>
                <strong>{t('camp.bed')} {b.bedNo}</strong>
                {b.state === 'FREE' ? (m.status === 'ACTIVE' ? <div><button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => setPick({ roomId: m.id, bedNo: b.bedNo, label: `${m.block}-${m.roomNo} / ${b.bedNo}` })} data-testid="hse-al-free">{t('al.free')}</button></div> : <div className="muted">{t('camp.closed')}</div>) : (
                  <div><div>{b.person} <span className="muted">{b.code}</span></div><StatusBadge status={AL[b.state]} label={t(`al.st.${b.state}`)} />
                    <div className="actions-row">{b.state === 'ALLOCATED' && <><button type="button" className="btn" style={{ minHeight: 44 }} disabled={busy} onClick={() => act(b, 'check-in', t('al.checkedIn'))} data-testid="hse-al-checkin">{t('al.checkIn')}</button><button type="button" className="btn" style={{ minHeight: 44 }} disabled={busy} onClick={() => { const r = globalThis.prompt(t('why')); if (r) run(() => hse.post(`/allocations/${b.allocationId}/cancel`, { reason: r }), t('al.cancelled')); }}>{t('cancel')}</button></>}{b.state === 'CHECKED_IN' && <button type="button" className="btn" style={{ minHeight: 44 }} disabled={busy} onClick={() => act(b, 'check-out', t('al.checkedOut'))} data-testid="hse-al-checkout">{t('al.checkOut')}</button>}</div></div>)}
              </div>))}</div>
          </div>))}</div>)}
      {pick && <form onSubmit={give} className="mdm-panel no-print" data-testid="hse-al-form"><h2>{t('al.giveBed', { bed: pick.label })}</h2><Field label={t('al.badge')} name="badge" error={error?.fields?.badge}><input value={badge} onChange={(e) => setBadge(e.target.value)} style={big} autoFocus data-testid="hse-al-badge" /></Field><div className="actions-row"><button className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy || !badge.trim()} data-testid="hse-al-give">{t('al.give')}</button><button type="button" className="btn" onClick={() => setPick(null)}>{t('cancel')}</button></div></form>}
      <ListReport listCode="hse.allocations" endpoint="/hse/camp-allocation" title={t('al.title')} session={session.data} cardFields={['docNo', 'person', 'room', 'state']} statusKey="state" empty={{ title: t('al.emptyTitle'), text: t('al.emptyBody') }} />
    </section>
  );
}

export function CampInspectionsPage() {
  const t = useT('hse'); usePageTitle(t('ci.title')); const session = useSession(); const { error, run, busy, note } = useRunner(); const oq = useOccupancy(); const cq = useQuery({ queryKey: ['hse', 'camp-compliance'], queryFn: () => hse.get('/camp-inspections/compliance'), retry: false }); const [f, setF] = useState({ campId: '', area: 'WATER', result: 'PASS', findings: '' });
  if (cq.error?.status === 403) return <NoPermission what={t('ci.title')} permission="hse.camp_inspection.view" />; if (cq.isPending) return <Skeleton label={t('ci.title')} rows={3} />; const fe = error?.fields ?? {};
  const save = async (e) => { e.preventDefault(); const r = await run(() => hse.post('/camp-inspections', { campId: Number(f.campId), area: f.area, result: f.result, findings: f.findings || undefined }), t('ci.saved')); if (r) setF({ ...f, findings: '' }); };
  return (
    <section aria-labelledby="ci-h" data-testid="hse-camp-inspections"><PageHeader id="ci-h" title={t('ci.title')} subtitle={t('ci.intro')} /><ErrorLine error={error} id="hse-error" />{note && <p className="mdm-banner" role="status" data-testid="hse-note">{note}</p>}
      <div className="table-scroll"><table className="data-table" data-testid="hse-ci-compliance"><thead><tr><th>{t('camp.camp')}</th><th>{t('ci.areas')}</th><th>{t('ci.passing')}</th><th>{t('ci.failing')}</th><th>{t('ci.pct')}</th></tr></thead><tbody>{cq.data.camps.map((c) => <tr key={c.campId} data-testid="hse-ci-row"><td>{c.camp}</td><td>{c.areasInspected}/{c.areas}</td><td>{c.passing}</td><td>{c.failing}</td><td>{c.compliancePct ?? '—'}</td></tr>)}</tbody></table></div>
      <form onSubmit={save} className="form-grid no-print" data-testid="hse-ci-form"><h2>{t('ci.record')}</h2><CampPick camps={oq.data?.camps ?? []} value={f.campId} onChange={(v) => setF({ ...f, campId: v })} testid="hse-ci-camp" />
        <Field label={t('ci.area')} name="area" error={fe.area}><select value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} style={big} data-testid="hse-ci-area">{AREAS.map((k) => <option key={k} value={k}>{t(`ci.a.${k}`)}</option>)}</select></Field>
        <Field label={t('ci.result')} name="result" error={fe.result}><select value={f.result} onChange={(e) => setF({ ...f, result: e.target.value })} style={big} data-testid="hse-ci-result">{['PASS', 'CONDITIONAL', 'FAIL'].map((k) => <option key={k} value={k}>{t(`ci.r.${k}`)}</option>)}</select></Field>
        <Field label={t('ci.findings')} name="findings" error={fe.findings}><textarea rows={3} value={f.findings} onChange={(e) => setF({ ...f, findings: e.target.value })} style={big} data-testid="hse-ci-findings" /></Field>
        <div className="actions-row"><button className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy || !f.campId} data-testid="hse-ci-save">{t('save')}</button></div></form>
      <ListReport listCode="hse.camp_inspections" endpoint="/hse/camp-inspections" title={t('ci.title')} session={session.data} cardFields={['camp', 'area', 'date', 'result']} empty={{ title: t('ci.emptyTitle'), text: t('ci.emptyBody') }} />
    </section>
  );
}

export function CampMessPage() {
  const t = useT('hse'); usePageTitle(t('mess.title')); const session = useSession(); const sp = useSearch(); const id = Number(sp.get('id')) || null; const { error, run, busy, note } = useRunner(); const oq = useOccupancy(); const [period, setPeriod] = useState(today().slice(0, 7));
  const [m, setM] = useState({ campId: '', contractorId: '', mealDate: today(), meal: 'LUNCH', plannedCount: '', servedCount: '' }); const [rc, setRc] = useState({ campId: '', contractorId: '' });
  const rq = useQuery({ queryKey: ['hse', 'camp-mess', period], queryFn: () => hse.get(`/camp-mess${qs({ period })}`), retry: false, enabled: !id });
  if (id) return <section aria-labelledby="rc-h"><Recovery id={id} /></section>;
  if (rq.error?.status === 403) return <NoPermission what={t('mess.title')} permission="hse.camp_meal.view" />; if (rq.isPending) return <Skeleton label={t('mess.title')} rows={3} />; if (rq.isError) return <ErrorState error={rq.error} onRetry={rq.refetch} />; const rep = rq.data; const fe = error?.fields ?? {};
  const contractors = (campId) => (oq.data?.camps ?? []).find((c) => String(c.campId) === String(campId))?.byContractor.filter((b) => b.contractorId) ?? [];
  const saveMeal = async (e) => { e.preventDefault(); await run(() => hse.post('/camp-meals', { campId: Number(m.campId), contractorId: m.contractorId ? Number(m.contractorId) : undefined, mealDate: m.mealDate, meal: m.meal, plannedCount: Number(m.plannedCount), servedCount: Number(m.servedCount) }), t('mess.saved')); };
  const makeRecovery = async (e) => { e.preventDefault(); const r = await run(() => hse.post('/camp-recoveries', { campId: Number(rc.campId), contractorId: Number(rc.contractorId), period }), t('mess.recoveryMade')); if (r) navigateTo(`/hse/camp-mess?id=${r.id}`); };
  return (
    <section aria-labelledby="ms-h" data-testid="hse-camp-mess"><PageHeader id="ms-h" title={t('mess.title')} subtitle={t('mess.intro')} /><ErrorLine error={error} id="hse-error" />{note && <p className="mdm-banner" role="status" data-testid="hse-note">{note}</p>}
      <div className="form-grid no-print"><Field label={t('mess.period')} name="period" error={null}><input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} style={big} data-testid="hse-mess-period" /></Field></div>
      {rep.rows.length === 0 ? <div className="empty-state"><h2>{t('mess.emptyTitle')}</h2><p>{t('mess.emptyBody')}</p></div> : (
        <div className="table-scroll"><table className="data-table" data-testid="hse-mess-table"><thead><tr><th>{t('camp.camp')}</th><th>{t('camp.contractor')}</th><th>{t('mess.planned')}</th><th>{t('mess.served')}</th><th>{t('mess.amount')}</th><th>{t('mess.pending')}</th></tr></thead><tbody>{rep.rows.map((r, i) => <tr key={i} data-testid="hse-mess-row"><td>{r.camp}</td><td>{r.contractor}</td><td>{r.planned}</td><td>{r.served}</td><td>{r.amount}</td><td>{r.pending}</td></tr>)}</tbody><tfoot><tr><th colSpan={2}>{t('mess.totals')}</th><th>{rep.totals.planned}</th><th>{rep.totals.served}</th><th>{rep.totals.amount}</th><th>{rep.totals.pending}</th></tr></tfoot></table></div>)}
      <form onSubmit={saveMeal} className="form-grid no-print" data-testid="hse-meal-form"><h2>{t('mess.record')}</h2><CampPick camps={oq.data?.camps ?? []} value={m.campId} onChange={(v) => setM({ ...m, campId: v, contractorId: '' })} testid="hse-meal-camp" />
        <Field label={t('camp.contractor')} name="contractorId" error={fe.contractorId}><select value={m.contractorId} onChange={(e) => setM({ ...m, contractorId: e.target.value })} style={big} data-testid="hse-meal-contractor"><option value="">{t('mess.ownStaff')}</option>{contractors(m.campId).map((b) => <option key={b.contractorId} value={b.contractorId}>{b.name}</option>)}</select></Field>
        <Field label={t('esg.date')} name="mealDate" error={fe.mealDate}><input type="date" value={m.mealDate} max={today()} onChange={(e) => setM({ ...m, mealDate: e.target.value })} style={big} /></Field>
        <Field label={t('mess.meal')} name="meal" error={fe.meal}><select value={m.meal} onChange={(e) => setM({ ...m, meal: e.target.value })} style={big} data-testid="hse-meal-kind">{['BREAKFAST', 'LUNCH', 'DINNER'].map((k) => <option key={k} value={k}>{t(`mess.m.${k}`)}</option>)}</select></Field>
        <Field label={t('mess.planned')} name="plannedCount" error={fe.plannedCount}><input type="number" min="0" inputMode="numeric" value={m.plannedCount} onChange={(e) => setM({ ...m, plannedCount: e.target.value })} style={big} data-testid="hse-meal-planned" /></Field>
        <Field label={t('mess.served')} name="servedCount" error={fe.servedCount}><input type="number" min="0" inputMode="numeric" value={m.servedCount} onChange={(e) => setM({ ...m, servedCount: e.target.value })} style={big} data-testid="hse-meal-served" /></Field>
        <div className="actions-row"><button className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy || !m.campId || m.plannedCount === '' || m.servedCount === ''} data-testid="hse-meal-save">{t('save')}</button></div></form>
      <form onSubmit={makeRecovery} className="form-grid no-print" data-testid="hse-recovery-form"><h2>{t('mess.makeRecovery')}</h2><CampPick camps={oq.data?.camps ?? []} value={rc.campId} onChange={(v) => setRc({ campId: v, contractorId: '' })} testid="hse-rc-camp" />
        <Field label={t('camp.contractor')} name="contractorId" error={fe.contractorId}><select value={rc.contractorId} onChange={(e) => setRc({ ...rc, contractorId: e.target.value })} style={big} data-testid="hse-rc-contractor"><option value="">—</option>{contractors(rc.campId).map((b) => <option key={b.contractorId} value={b.contractorId}>{b.name}</option>)}</select></Field>
        <div className="actions-row"><button className="btn" style={{ minHeight: 48 }} disabled={busy || !rc.campId || !rc.contractorId} data-testid="hse-rc-make">{t('mess.makeRecovery')}</button></div></form>
      <ListReport listCode="hse.recoveries" endpoint="/hse/camp-recoveries" title={t('mess.recoveries')} session={session.data} rowHref={(r) => `/hse/camp-mess?id=${r.id}`} onOpen={(r) => navigateTo(`/hse/camp-mess?id=${r.id}`)} cardFields={['docNo', 'contractor', 'period', 'total', 'status']} statusKey="status" empty={{ title: t('mess.noRecoveries'), text: t('mess.noRecoveriesBody') }} />
    </section>
  );
}

function Recovery({ id }) {
  const t = useT('hse'); const { q, guard } = useRecord('/camp-recoveries', id, t('mess.recovery'), 'hse.recovery.view'); usePageTitle(t('mess.recovery')); if (guard) return guard; const x = q.data; const p = x.preview;
  return (
    <div data-testid="hse-recovery-object" data-status={x.status}><PageHeader id="rc-h" title={<>{x.docNo} <Status x={x} /></>} meta={<><Link to="/hse/camp-mess">{t('mess.title')}</Link> · {x.camp} · {x.contractor} · {x.period}</>} />
      <div className="table-scroll"><table className="data-table" data-testid="hse-recovery-figures"><tbody>
        <tr><th>{t('mess.mealsServed')}</th><td data-testid="hse-rc-meals">{p ? p.mealsServed : x.mealsServed}</td></tr>
        <tr><th>{t('mess.messAmount')}</th><td>{p ? p.messPaise / 100 : x.mess}</td></tr>
        <tr><th>{t('mess.bedDays')}</th><td>{p ? p.bedDays : x.bedDays}</td></tr>
        <tr><th>{t('mess.rent')}</th><td>{p ? p.rentPaise / 100 : x.rent}</td></tr>
        <tr><th>{t('mess.total')}</th><td data-testid="hse-rc-total">{p ? p.totalPaise / 100 : x.total}</td></tr></tbody></table></div>
      <p className="muted">{t('mess.lockNote')}</p>
      <DocBar kind="/camp-recoveries" x={x} printName={`${x.docNo}.pdf`} />
    </div>
  );
}

