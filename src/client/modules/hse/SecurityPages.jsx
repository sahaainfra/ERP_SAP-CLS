import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { fmtDate, hse, qs } from './api.js';
import { DocBar, ErrorLine, ProjectSite, Status, big, useRecord, useRunner } from './HseParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Part 19.06: visitor gate and register, patrol scan and compliance, the guard roster board and roster, security incidents, posts and checkpoints with the shift handover log.
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10); const stamp = (s) => (s ? s.replace('T', ' ').slice(0, 16) : '—'); const VT = { AWAITING_HOST: 'IN_REVIEW', APPROVED: 'APPROVED', DECLINED: 'REJECTED', CHECKED_IN: 'APPROVED', CHECKED_OUT: 'DRAFT', CANCELLED: 'CANCELLED', NO_SHOW: 'CANCELLED' };
export function VisitorGatePage() {
  const t = useT('hse'); usePageTitle(t('vis.gate')); const { error, run, busy, note } = useRunner(); const [badge, setBadge] = useState(''); const [briefed, setBriefed] = useState(false); const [v, setV] = useState({ projectId: '', siteId: '' }); const [f, setF] = useState({ name: '', phone: '', organisation: '', idRef: '', hostUser: '', purpose: '', vehicleNo: '' }); const [last, setLast] = useState(null);
  const oq = useQuery({ queryKey: ['hse', 'visitor-options'], queryFn: () => hse.get('/visitors/options'), retry: false });
  if (oq.error?.status === 403) return <NoPermission what={t('vis.gate')} permission="hse.visitor.create" />; if (oq.isPending) return <Skeleton label={t('vis.gate')} rows={3} />; const o = oq.data;
  const gateCall = (path, msg) => async () => { const r = await run(() => hse.post(`/visitors/${path}`, { badge, safetyBriefed: briefed }), msg); if (r) { setLast(r); setBadge(''); setBriefed(false); } };
  return (
    <section aria-labelledby="vg-h" data-testid="hse-visitor-gate"><PageHeader id="vg-h" title={t('vis.gate')} subtitle={<><Link to="/hse/visitors">{t('vis.title')}</Link> · {t('vis.gateHint')}</>} /><ErrorLine error={error} id="hse-vis-error" />{note && <p className="mdm-banner" role="status" data-testid="hse-vis-note">{note}</p>}
      <div className="mdm-panel" data-testid="hse-vis-scan"><h2>{t('vis.scanTitle')}</h2><Field label={t('vis.badge')} name="badge" error={error}><input value={badge} onChange={(e) => setBadge(e.target.value)} placeholder="VIS:…" autoComplete="off" style={big} data-testid="hse-vis-badge" /></Field>
        <label style={{ display: 'block', minHeight: 44 }}><input type="checkbox" checked={briefed} onChange={(e) => setBriefed(e.target.checked)} data-testid="hse-vis-briefed" /> {t('vis.briefed')}</label>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy || badge.length < 4} onClick={gateCall('check-in', t('vis.in'))} data-testid="hse-vis-in">{t('vis.checkIn')}</button><button type="button" className="btn" style={big} disabled={busy || badge.length < 4} onClick={gateCall('check-out', t('vis.out'))} data-testid="hse-vis-out">{t('vis.checkOut')}</button></div>
        {last && <p data-testid="hse-vis-last">{last.name} · {t(`vst.${last.state}`)} · {last.host}</p>}</div>
      <div className="mdm-panel" data-testid="hse-vis-register"><h2>{t('vis.register')}</h2><div className="form-grid"><ProjectSite o={o} v={v} set={setV} error={error} />
        <Field label={t('vis.name')} name="name" error={error}><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} style={big} data-testid="hse-vis-name" /></Field><Field label={t('vis.phone')} name="phone" error={error}><input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} style={big} /></Field>
        <Field label={t('vis.organisation')} name="organisation" error={error}><input value={f.organisation} onChange={(e) => setF({ ...f, organisation: e.target.value })} style={big} /></Field><Field label={t('vis.idRef')} name="idRef" error={error}><input value={f.idRef} onChange={(e) => setF({ ...f, idRef: e.target.value })} style={big} data-testid="hse-vis-id" /></Field>
        <Field label={t('vis.host')} name="hostUser" error={error}><select value={f.hostUser} onChange={(e) => setF({ ...f, hostUser: e.target.value })} style={big} data-testid="hse-vis-host"><option value="">—</option>{o.hosts.map((h) => <option key={h.username} value={h.username}>{h.name}</option>)}</select></Field>
        <Field label={t('vis.purpose')} name="purpose" error={error}><input value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} style={big} data-testid="hse-vis-purpose" /></Field><Field label={t('vis.vehicle')} name="vehicleNo" error={error}><input value={f.vehicleNo} onChange={(e) => setF({ ...f, vehicleNo: e.target.value })} style={big} /></Field></div>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy || !v.siteId || f.name.length < 2 || !f.hostUser || f.purpose.length < 3} onClick={async () => { const r = await run(() => hse.make('/visitors', { projectId: Number(v.projectId), siteId: Number(v.siteId), name: f.name, phone: f.phone || null, organisation: f.organisation || null, idType: f.idRef ? 'ID' : null, idRef: f.idRef || null, hostUser: f.hostUser, purpose: f.purpose, vehicleNo: f.vehicleNo || null }), t('vis.registered')); if (r) { setLast(r); setF({ ...f, name: '', idRef: '', purpose: '' }); } }} data-testid="hse-vis-save">{t('vis.registerBtn')}</button></div></div>
    </section>
  );
}
function Visitor({ id }) {
  const t = useT('hse'); const { q, guard } = useRecord('/visitors', id, t('vis.title'), 'hse.visitor.view'); const { error, run, busy, note } = useRunner(); usePageTitle(t('vis.title')); if (guard) return guard; const x = q.data;
  return (
    <div data-testid="hse-visitor-object" data-state={x.state}><PageHeader id="vo-h" title={<>{x.docNo} <StatusBadge status={VT[x.state]} label={t(`vst.${x.state}`)} /></>} meta={<><Link to="/hse/visitors">{t('vis.title')}</Link> · {x.name}{x.organisation ? ` (${x.organisation})` : ''} · {t('vis.host')}: {x.host} · {x.purpose} · {t('vis.expected')} {fmtDate(x.expectedOn)} · {t('vis.idRef')}: {x.idRef ?? '—'}</>} />
      <p>{t('vis.in')}: {stamp(x.checkIn)} · {t('vis.out')}: {stamp(x.checkOut)}{x.overstay ? ` · ${t('vis.overstay')}` : ''}{x.declineReason ? ` · ${x.declineReason}` : ''}</p>
      <ErrorLine error={error} id="hse-vis-error" />{note && <p className="mdm-banner" role="status" data-testid="hse-vis-note">{note}</p>}
      <div className="actions-row no-print">{x.can.approve && <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => run(() => hse.act('/visitors', x.id, 'approve', {}), t('vis.approved'))} data-testid="hse-vis-approve">{t('approve')}</button>}
        {x.can.decline && <button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => { const r = globalThis.prompt(t('why')); if (r) run(() => hse.act('/visitors', x.id, 'decline', { reason: r }), t('vis.declined')); }} data-testid="hse-vis-decline">{t('vis.decline')}</button>}
        {x.can.cancel && <button type="button" className="btn" disabled={busy} onClick={() => { const r = globalThis.prompt(t('why')); if (r) run(() => hse.act('/visitors', x.id, 'cancel', { reason: r }), t('cancelled')); }}>{t('cancel')}</button>}</div>
      {x.badge && <div className="mdm-panel" data-testid="hse-vis-badge-card"><h2>{t('vis.badge')}</h2><p><code>{x.badge}</code></p><img alt={t('vis.badge')} src={`/api/v1/hse/visitors/${x.id}/badge`} width={160} height={160} /></div>}
    </div>
  );
}
export function VisitorsPage() {
  const t = useT('hse'); usePageTitle(t('vis.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession();
  if (id) return <section aria-labelledby="vo-h"><Visitor id={id} /></section>;
  return (
    <section aria-labelledby="vl-h" data-testid="hse-visitors"><PageHeader id="vl-h" title={t('vis.title')} subtitle={t('vis.intro')} />
      <div className="actions-row no-print"><Link to="/hse/visitor-gate" data-testid="hse-vis-new">{t('vis.gate')}</Link><button type="button" className="btn" onClick={() => hse.exportFile('/visitors/export', 'visitors.csv').catch(() => globalThis.alert?.(t('exportFailed')))}>{t('export')}</button></div>
      <ListReport listCode="hse.visitors" endpoint="/hse/visitors" title={t('vis.title')} session={session.data} rowHref={(r) => `/hse/visitors?id=${r.id}`} onOpen={(r) => navigateTo(`/hse/visitors?id=${r.id}`)} cardFields={['docNo', 'name', 'host', 'expected', 'state']} statusKey="state" dateKey="expected" empty={{ title: t('vis.emptyTitle'), text: t('vis.emptyBody') }} />
    </section>
  );
}
export function PatrolScanPage() {
  const t = useT('hse'); usePageTitle(t('pat.scan')); const { error, run, busy } = useRunner(); const [token, setToken] = useState(''); const [badge, setBadge] = useState(''); const [done, setDone] = useState([]);
  const go = async () => { let pos = {}; try { pos = await new Promise((ok, no) => navigator.geolocation.getCurrentPosition((p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude }), no, { timeout: 4000 })); } catch { /* no position: the scan is still recorded */ } const r = await run(() => hse.post('/patrol/scan', { token, badge, ...pos })); if (r) { setDone((d) => [r, ...d]); setToken(''); } };
  return (
    <section aria-labelledby="ps-h" data-testid="hse-patrol-scan"><PageHeader id="ps-h" title={t('pat.scan')} subtitle={<><Link to="/hse/patrol-compliance">{t('pat.compliance')}</Link> · {t('pat.hint')}</>} /><ErrorLine error={error} id="hse-pat-error" />
      <div className="mdm-panel"><Field label={t('pat.guardBadge')} name="badge" error={error}><input value={badge} onChange={(e) => setBadge(e.target.value)} placeholder="LAB:…" autoComplete="off" style={big} data-testid="hse-pat-badge" /></Field><Field label={t('pat.checkpoint')} name="token" error={error}><input value={token} onChange={(e) => setToken(e.target.value)} placeholder="CP:…" autoComplete="off" style={big} data-testid="hse-pat-token" /></Field>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy || token.length < 4 || badge.length < 3} onClick={go} data-testid="hse-pat-go">{t('pat.scanBtn')}</button></div></div>
      {done.length > 0 && <div className="table-scroll"><table className="data-table" data-testid="hse-pat-done"><tbody>{done.map((d) => <tr key={d.id} data-testid="hse-pat-done-row"><td>{d.checkpoint}</td><td>{d.guard}</td><td>{stamp(d.scannedAt)}</td><td>{d.offSite ? <StatusBadge status="REJECTED" label={t('pat.offSite', { n: d.distanceM })} /> : t('pat.ok')}</td></tr>)}</tbody></table></div>}
    </section>
  );
}
export function PatrolCompliancePage() {
  const t = useT('hse'); usePageTitle(t('pat.compliance')); const [siteId, setSiteId] = useState(''); const [from, setFrom] = useState(today()); const [to, setTo] = useState(today());
  const oq = useQuery({ queryKey: ['hse', 'site-options'], queryFn: () => hse.get('/rosters/options').catch(() => hse.get('/plans/options')), retry: false }); const q = useQuery({ queryKey: ['hse', 'patrol-compliance', siteId, from, to], queryFn: () => hse.get(`/patrol/compliance${qs({ siteId, from, to })}`), enabled: Boolean(siteId), retry: false });
  return (
    <section aria-labelledby="pc-h" data-testid="hse-patrol-compliance"><PageHeader id="pc-h" title={t('pat.compliance')} subtitle={t('pat.compIntro')} />
      <div className="form-grid no-print"><Field label={t('site')} name="siteId" error={null}><select value={siteId} onChange={(e) => setSiteId(e.target.value)} style={big} data-testid="hse-pc-site"><option value="">—</option>{(oq.data?.sites ?? []).map((s) => <option key={s.id} value={s.id}>{s.code} {s.name}</option>)}</select></Field><Field label={t('cmp.from')} name="from" error={null}><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={big} /></Field><Field label={t('cmp.to')} name="to" error={null}><input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={big} /></Field></div>
      {!siteId ? <div className="empty-state"><h2>{t('pat.chooseSite')}</h2></div> : q.isPending ? <Skeleton label={t('pat.compliance')} rows={3} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
        <><p data-testid="hse-pc-total">{t('pat.total', { exp: q.data.expected, got: q.data.scanned, miss: q.data.missed, pct: q.data.compliancePct ?? '—' })}</p>
          <div className="table-scroll"><table className="data-table" data-testid="hse-pc-table"><thead><tr><th>{t('pat.checkpoint')}</th><th>{t('esg.date')}</th><th>{t('pat.expected')}</th><th>{t('pat.scanned')}</th><th>{t('pat.missed')}</th><th>%</th></tr></thead><tbody>{q.data.rows.map((r, i) => <tr key={i} data-testid="hse-pc-row"><td>{r.name}</td><td>{fmtDate(r.date)}</td><td>{r.expected}</td><td>{r.scanned}</td><td>{r.missed > 0 ? <StatusBadge status="REJECTED" label={String(r.missed)} /> : 0}</td><td>{r.compliancePct ?? '—'}</td></tr>)}</tbody></table></div></>)}
    </section>
  );
}
export function RosterBoardPage() {
  const t = useT('hse'); usePageTitle(t('ros.title')); const session = useSession(); const sp = useSearch(); const id = Number(sp.get('id')) || null; const [siteId, setSiteId] = useState(''); const [date, setDate] = useState(today());
  const oq = useQuery({ queryKey: ['hse', 'site-options'], queryFn: () => hse.get('/rosters/options').catch(() => hse.get('/plans/options')), retry: false }); const q = useQuery({ queryKey: ['hse', 'roster-board', siteId, date], queryFn: () => hse.get(`/rosters/board${qs({ siteId, date })}`), enabled: Boolean(siteId) && !id, retry: false });
  if (id) return <section aria-labelledby="rp-h"><Roster id={id} /></section>; if (sp.get('new')) return <RosterNew />;
  return (
    <section aria-labelledby="rb-h" data-testid="hse-roster-board"><PageHeader id="rb-h" title={t('ros.title')} subtitle={t('ros.intro')} />
      <div className="form-grid no-print"><Field label={t('site')} name="siteId" error={null}><select value={siteId} onChange={(e) => setSiteId(e.target.value)} style={big} data-testid="hse-rb-site"><option value="">—</option>{(oq.data?.sites ?? []).map((s) => <option key={s.id} value={s.id}>{s.code} {s.name}</option>)}</select></Field><Field label={t('esg.date')} name="date" error={null}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={big} /></Field></div>
      {q.data && (q.data.posts.length === 0 ? <div className="empty-state"><h2>{t('ros.noPosts')}</h2></div> : <div className="table-scroll"><table className="data-table" data-testid="hse-rb-table"><caption>{q.data.approved ? t('ros.approved') : t('ros.noRoster')}</caption><thead><tr><th>{t('ros.post')}</th><th>{t('ros.day')}</th><th>{t('ros.night')}</th></tr></thead><tbody>{q.data.posts.map((p) => <tr key={p.postId} data-testid="hse-rb-row"><td>{p.code} {p.name} ({p.required})</td>{p.shifts.map((s) => <td key={s.shift}>{s.guards.map((g) => <div key={g.guardId}>{g.name}{g.reliever ? ` (${t('ros.reliever')})` : ''} <StatusBadge status={g.present ? 'APPROVED' : 'REJECTED'} label={g.present ? t('ros.present') : t('ros.absent')} /></div>)}{s.gap > 0 && <StatusBadge status="REJECTED" label={t('ros.gap', { n: s.gap })} />}</td>)}</tr>)}</tbody></table></div>)}
      <div className="actions-row no-print"><Link to="/hse/rosters?new=1" data-testid="hse-roster-new">{t('ros.new')}</Link></div>
      <ListReport listCode="hse.rosters" endpoint="/hse/rosters" exportEndpoint="/ui/lists/hse.rosters/export" title={t('ros.title')} session={session.data} rowHref={(r) => `/hse/rosters?id=${r.id}`} onOpen={(r) => navigateTo(`/hse/rosters?id=${r.id}`)} cardFields={['docNo', 'site', 'period', 'status']} statusKey="status" empty={{ title: t('ros.emptyTitle'), text: t('ros.emptyBody') }} />
    </section>
  );
}
function Roster({ id }) {
  const t = useT('hse'); const { q, guard } = useRecord('/rosters', id, t('ros.title'), 'hse.roster.view'); usePageTitle(t('ros.title')); if (guard) return guard; const x = q.data;
  return (
    <div data-testid="hse-roster-object" data-status={x.status}><PageHeader id="rp-h" title={<>{x.docNo} <Status x={x} /></>} meta={<><Link to="/hse/rosters">{t('ros.title')}</Link> · {x.period} · {t('ros.assignments', { n: x.assignmentCount, r: x.relievers })} · {t('ros.gaps', { n: x.gapCount })}</>} />
      {x.problems?.length > 0 && <div className="mdm-panel" data-testid="hse-roster-problems"><h2>{t('pm.before')}</h2><ul>{x.problems.map((p, i) => <li key={i}>{p.message}</li>)}</ul></div>}
      <div className="table-scroll"><table className="data-table"><thead><tr><th>{t('esg.date')}</th><th>{t('ros.post')}</th><th>{t('ros.shift')}</th><th>{t('ros.guard')}</th></tr></thead><tbody>{x.assignments.slice(0, 200).map((a, i) => <tr key={i}><td>{fmtDate(a.date)}</td><td>{a.postId}</td><td>{t(`ros.${a.shift === 'DAY' ? 'day' : 'night'}`)}</td><td>{a.guard?.name}{a.reliever ? ` (${t('ros.reliever')})` : ''}</td></tr>)}</tbody></table></div>
      <DocBar kind="/rosters" x={x} printName={`${x.docNo}.pdf`} />
    </div>
  );
}
function RosterNew() {
  const t = useT('hse'); usePageTitle(t('ros.new')); const { error, run, busy } = useRunner(); const [v, setV] = useState({ projectId: '', siteId: '' }); const [period, setPeriod] = useState(today().slice(0, 7)); const [list, setList] = useState([]); const [f, setF] = useState({ postId: '', guardId: '', shift: 'DAY', from: today(), to: today(), reliever: false });
  const oq = useQuery({ queryKey: ['hse', 'roster-options'], queryFn: () => hse.get('/rosters/options'), retry: false });
  if (oq.error?.status === 403) return <NoPermission what={t('ros.new')} permission="hse.roster.create" />; if (oq.isPending) return <Skeleton label={t('ros.new')} rows={3} />; const o = oq.data;
  const add = () => { const out = []; for (let d = f.from; d <= f.to && out.length < 62; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) out.push({ date: d, postId: Number(f.postId), shift: f.shift, guardId: Number(f.guardId), reliever: f.reliever }); setList((l) => [...l, ...out]); };
  return (
    <section aria-labelledby="rn-h" data-testid="hse-roster-new-form"><PageHeader id="rn-h" title={t('ros.new')} meta={<Link to="/hse/rosters">{t('ros.title')}</Link>} /><ErrorLine error={error} id="hse-ros-error" />
      <div className="mdm-panel"><div className="form-grid"><ProjectSite o={o} v={v} set={setV} error={error} /><Field label={t('ros.month')} name="period" error={error}><input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} style={big} /></Field>
        <Field label={t('ros.post')} name="postId" error={error}><select value={f.postId} onChange={(e) => setF({ ...f, postId: e.target.value })} style={big} data-testid="hse-ros-post"><option value="">—</option>{o.posts.filter((p) => String(p.siteId) === String(v.siteId)).map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></Field>
        <Field label={t('ros.guard')} name="guardId" error={error}><select value={f.guardId} onChange={(e) => setF({ ...f, guardId: e.target.value })} style={big} data-testid="hse-ros-guard"><option value="">—</option>{o.guards.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.code})</option>)}</select></Field>
        <Field label={t('ros.shift')} name="shift" error={error}><select value={f.shift} onChange={(e) => setF({ ...f, shift: e.target.value })} style={big}><option value="DAY">{t('ros.day')}</option><option value="NIGHT">{t('ros.night')}</option></select></Field>
        <Field label={t('cmp.from')} name="from" error={error}><input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} style={big} /></Field><Field label={t('cmp.to')} name="to" error={error}><input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} style={big} /></Field></div>
        <label style={{ display: 'block', minHeight: 44 }}><input type="checkbox" checked={f.reliever} onChange={(e) => setF({ ...f, reliever: e.target.checked })} /> {t('ros.reliever')}</label>
        <div className="actions-row"><button type="button" className="btn" style={big} disabled={!f.postId || !f.guardId || f.to < f.from} onClick={add} data-testid="hse-ros-add">{t('ros.addDays')}</button><button type="button" className="btn btn-primary" style={big} disabled={busy || !v.siteId || list.length === 0} onClick={async () => { const r = await run(() => hse.make('/rosters', { projectId: Number(v.projectId), siteId: Number(v.siteId), period, assignments: list })); if (r) navigateTo(`/hse/rosters?id=${r.id}`); }} data-testid="hse-ros-save">{t('save')}</button></div>
        <p data-testid="hse-ros-count">{t('ros.pending', { n: list.length })}</p></div>
    </section>
  );
}
function SecIncident({ id }) {
  const t = useT('hse'); const { q, guard } = useRecord('/security-incidents', id, t('si.title'), 'hse.security_incident.view'); const { error, run, busy, note } = useRunner(); const [inv, setInv] = useState(null); usePageTitle(t('si.title')); if (guard) return guard; const x = q.data; const text = inv ?? x.investigation ?? '';
  return (
    <div data-testid="hse-secinc-object" data-status={x.status}><PageHeader id="sio-h" title={<>{x.docNo} <Status x={x} /> <StatusBadge status="IN_REVIEW" label={t(`sit.${x.type}`)} /></>} meta={<><Link to="/hse/security-incidents">{t('si.title')}</Link> · {stamp(x.occurredAt)} · {x.reportedBy} · {t('si.loss')} ₹ {x.loss}</>} /><p>{x.description}</p>{x.actionTaken && <p>{t('inc.immediate')}: {x.actionTaken}</p>}
      <ErrorLine error={error} id="hse-si-error" />{note && <p className="mdm-banner" role="status" data-testid="hse-si-note">{note}</p>}
      {x.can.edit && <div className="mdm-panel no-print"><h2>{t('inc.investigation')}</h2><textarea rows={4} value={text} onChange={(e) => setInv(e.target.value)} style={{ width: '100%' }} data-testid="hse-si-inv" /><button type="button" className="btn btn-primary" style={big} disabled={busy || text.trim().length < 5} onClick={() => run(() => hse.edit('/security-incidents', x.id, { investigation: text, rowVersion: x.version }), t('saved'))} data-testid="hse-si-save">{t('save')}</button></div>}
      {!x.can.edit && x.investigation && <p>{t('inc.investigation')}: {x.investigation}</p>}
      <DocBar kind="/security-incidents" x={x} printName={`${x.docNo}.pdf`} />
    </div>
  );
}
export function SecurityIncidentsPage() {
  const t = useT('hse'); usePageTitle(t('si.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession(); const { error, run, busy } = useRunner(); const [v, setV] = useState({ projectId: '', siteId: '' }); const [f, setF] = useState({ incidentType: 'THEFT', description: '', actionTaken: '', lossEstimate: '' });
  const oq = useQuery({ queryKey: ['hse', 'si-options'], queryFn: () => hse.get('/security-incidents/options'), retry: false, enabled: !id });
  if (id) return <section aria-labelledby="sio-h"><SecIncident id={id} /></section>;
  return (
    <section aria-labelledby="sil-h" data-testid="hse-security-incidents"><PageHeader id="sil-h" title={t('si.title')} subtitle={t('si.intro')} />
      {oq.data && <details className="mdm-panel no-print" data-testid="hse-si-form"><summary>{t('si.new')}</summary><ErrorLine error={error} id="hse-si-error" /><div className="form-grid"><ProjectSite o={oq.data} v={v} set={setV} error={error} />
        <Field label={t('inc.type')} name="incidentType" error={error}><select value={f.incidentType} onChange={(e) => setF({ ...f, incidentType: e.target.value })} style={big} data-testid="hse-si-type">{oq.data.types.map((x) => <option key={x.id} value={x.id}>{t(`sit.${x.id}`)}</option>)}</select></Field><Field label={t('si.loss')} name="lossEstimate" error={error}><input type="number" min="0" inputMode="decimal" value={f.lossEstimate} onChange={(e) => setF({ ...f, lossEstimate: e.target.value })} style={big} /></Field></div>
        <Field label={t('inc.what')} name="description" error={error}><textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} style={{ width: '100%', fontSize: '1rem' }} data-testid="hse-si-what" /></Field><Field label={t('inc.immediate')} name="actionTaken" error={error}><input value={f.actionTaken} onChange={(e) => setF({ ...f, actionTaken: e.target.value })} style={big} /></Field>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy || !v.siteId || f.description.length < 5} onClick={async () => { const r = await run(() => hse.make('/security-incidents', { projectId: Number(v.projectId), siteId: Number(v.siteId), incidentType: f.incidentType, occurredAt: new Date(Date.now() + 5.5 * 3600_000 - 60_000).toISOString().slice(0, 16), description: f.description, actionTaken: f.actionTaken || null, lossEstimate: Number(f.lossEstimate) || 0 })); if (r) navigateTo(`/hse/security-incidents?id=${r.id}`); }} data-testid="hse-si-send">{t('inc.send')}</button></div></details>}
      <ListReport listCode="hse.security_incidents" endpoint="/hse/security-incidents" exportEndpoint="/ui/lists/hse.security_incidents/export" title={t('si.title')} session={session.data} rowHref={(r) => `/hse/security-incidents?id=${r.id}`} onOpen={(r) => navigateTo(`/hse/security-incidents?id=${r.id}`)} cardFields={['docNo', 'type', 'occurredAt', 'status']} statusKey="status" empty={{ title: t('si.emptyTitle'), text: t('si.emptyBody') }} />
    </section>
  );
}
export function SecurityPostsPage() {
  const t = useT('hse'); usePageTitle(t('sp.title')); const session = useSession(); const { error, run, busy, note } = useRunner(); const [v, setV] = useState({ projectId: '', siteId: '' }); const [f, setF] = useState({ code: '', name: '', postType: 'GATE', requiredGuards: 1, agencyId: '' }); const [cp, setCp] = useState({ postId: '', code: '', name: '', intervalMin: 120 }); const [made, setMade] = useState(null);
  const oq = useQuery({ queryKey: ['hse', 'post-options'], queryFn: () => hse.get('/security-posts/options'), retry: false });
  return (
    <section aria-labelledby="sp-h" data-testid="hse-security-posts"><PageHeader id="sp-h" title={t('sp.title')} subtitle={<>{t('sp.intro')} <Link to="/hse/patrol-scan">{t('pat.scan')}</Link></>} /><ErrorLine error={error} id="hse-sp-error" />{note && <p className="mdm-banner" role="status" data-testid="hse-sp-note">{note}</p>}
      {oq.data && <details className="mdm-panel no-print" data-testid="hse-post-form"><summary>{t('sp.new')}</summary><div className="form-grid"><ProjectSite o={oq.data} v={v} set={setV} error={error} />
        <Field label={t('lib.code')} name="code" error={error}><input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} style={big} data-testid="hse-post-code" /></Field><Field label={t('sp.name')} name="name" error={error}><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} style={big} data-testid="hse-post-name" /></Field>
        <Field label={t('sp.guards')} name="requiredGuards" error={error}><input type="number" min="1" value={f.requiredGuards} onChange={(e) => setF({ ...f, requiredGuards: e.target.value })} style={big} /></Field><Field label={t('sp.agency')} name="agencyId" error={error}><select value={f.agencyId} onChange={(e) => setF({ ...f, agencyId: e.target.value })} style={big}><option value="">—</option>{oq.data.agencies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field></div>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy || !v.siteId || !f.code || !f.name} onClick={() => run(() => hse.make('/security-posts', { projectId: Number(v.projectId), siteId: Number(v.siteId), code: f.code, name: f.name, postType: f.postType, requiredGuards: Number(f.requiredGuards), agencyId: f.agencyId ? Number(f.agencyId) : null }), t('sp.saved'))} data-testid="hse-post-save">{t('save')}</button></div>
        <h3>{t('sp.newCheckpoint')}</h3><div className="form-grid"><Field label={t('ros.post')} name="postId" error={error}><input type="number" value={cp.postId} onChange={(e) => setCp({ ...cp, postId: e.target.value })} style={big} data-testid="hse-cp-post" /></Field><Field label={t('lib.code')} name="cpcode" error={error}><input value={cp.code} onChange={(e) => setCp({ ...cp, code: e.target.value })} style={big} data-testid="hse-cp-code" /></Field><Field label={t('sp.name')} name="cpname" error={error}><input value={cp.name} onChange={(e) => setCp({ ...cp, name: e.target.value })} style={big} data-testid="hse-cp-name" /></Field><Field label={t('sp.interval')} name="intervalMin" error={error}><input type="number" min="10" value={cp.intervalMin} onChange={(e) => setCp({ ...cp, intervalMin: e.target.value })} style={big} /></Field></div>
        <button type="button" className="btn" style={big} disabled={busy || !v.siteId || !cp.code || !cp.name} onClick={async () => { const r = await run(() => hse.make('/checkpoints', { siteId: Number(v.siteId), postId: cp.postId ? Number(cp.postId) : null, code: cp.code, name: cp.name, intervalMin: Number(cp.intervalMin) }), t('sp.cpSaved')); if (r) setMade(r); }} data-testid="hse-cp-save">{t('save')}</button>
        {made && <div data-testid="hse-cp-made"><p><code>{made.token}</code></p><div dangerouslySetInnerHTML={{ __html: made.qrSvg }} style={{ maxWidth: 200 }} /></div>}</details>}
      <ListReport listCode="hse.security_posts" endpoint="/hse/security-posts" exportEndpoint="/ui/lists/hse.security_posts/export" title={t('sp.title')} session={session.data} cardFields={['code', 'name', 'guards', 'status']} statusKey="status" empty={{ title: t('sp.emptyTitle'), text: t('sp.emptyBody') }} />
    </section>
  );
}
