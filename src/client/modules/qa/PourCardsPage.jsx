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

// Pour cards (part 18.05): the clearance to pour with the approved inspection requests and the pre-pour checks (BR-01); after the approval the pour is recorded with its delivery tickets and the cubes are cast.
const POUR_TONE = { PLANNED: 'DRAFT', IN_PROGRESS: 'IN_REVIEW', COMPLETED: 'APPROVED' }; const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
function Pour({ id }) {
  const t = useT('qa'); const { q, guard } = useRecord('/pour-cards', id, t('pc.title'), 'qa.pour_card.view'); const { error, run, busy, note } = useRunner(); usePageTitle(t('pc.title'));
  const oq = useQuery({ queryKey: ['qa', 'pour-options', q.data?.projectId], queryFn: () => qa.get(`/pour-cards/options?projectId=${q.data.projectId}`), enabled: Boolean(q.data?.can?.edit), retry: false });
  const [links, setLinks] = useState(null); const [checks, setChecks] = useState(null); const [rec, setRec] = useState({ weather: '' }); const [tk, setTk] = useState({ ticketNo: '', batchRef: '', truckNo: '', qty: '', slumpMm: '' }); const [cu, setCu] = useState({ cubes: '6', castDate: today(), ticketId: '' });
  if (guard) return guard; const x = q.data;
  if (x.can.edit && !links) { setLinks(Object.fromEntries(x.irLinks.map((l) => [l.kind, String(l.irId)]))); setChecks(Object.fromEntries(x.checks.map((c) => [c.code, c.result ?? '']))); }
  const o = oq.data; const save = () => run(() => qa.edit('/pour-cards', x.id, { irLinks: Object.entries(links).filter(([, v]) => v).map(([kind, v]) => ({ kind, irId: Number(v) })), checks: Object.entries(checks).map(([code, result]) => ({ code, result: result || null })), rowVersion: x.version }), t('saved'));
  const act = (action, body, msg) => run(() => qa.act('/pour-cards', x.id, action, body), msg);
  const addTicket = async () => { const d = await act('tickets', { ticketNo: tk.ticketNo, batchRef: tk.batchRef || null, truckNo: tk.truckNo || null, qty: Number(tk.qty), slumpMm: tk.slumpMm ? Number(tk.slumpMm) : null }, t('pc.ticketAdded')); if (d) setTk({ ticketNo: '', batchRef: '', truckNo: '', qty: '', slumpMm: '' }); };
  return (
    <div data-testid="qa-pour-object" data-status={x.status} data-pour={x.pourStatus}><PageHeader id="pc-h" title={<>{x.docNo} <Status x={x} /> <StatusBadge status={POUR_TONE[x.pourStatus]} label={t(`pour.${x.pourStatus}`)} /></>} meta={<><Link to="/qa/pour-cards">{t('pc.title')}</Link> · {x.project} · {x.element} · {x.grade} (fck {x.fck}) · {t('pc.planned')} {x.plannedVolume} m³{x.plannedOn ? ` · ${fmtDate(x.plannedOn)}` : ''} · {t('pc.actual')} {x.actualVolume} m³</>} />
      {error?.form && <p className="field-error" role="alert" data-testid="pc-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}{note && <p className="mdm-banner" role="status" data-testid="pc-note">{note}</p>}
      <DocBar kind="/pour-cards" x={x} printName={`${x.docNo.replaceAll('/', '-')}.pdf`} />
      {x.can.edit && links && o && (
        <div className="mdm-panel no-print" data-testid="pc-edit"><h2>{t('pc.irs')}</h2><p className="muted">{t('pc.irsHint')}</p>
          <div className="form-grid">{Object.keys({ ...Object.fromEntries(x.requiredKinds.map((k) => [k, 1])), ...links }).map((kind) => <Field key={kind} label={`${t(`irk.${kind}`)}${x.requiredKinds.includes(kind) ? ` (${t('perf.required')})` : ''}`} name={`ir-${kind}`} error={error}><select value={links[kind] ?? ''} onChange={(e) => setLinks({ ...links, [kind]: e.target.value })} style={sel} data-testid={`pc-ir-${kind}`}><option value="">—</option>{o.irs.map((i) => <option key={i.id} value={i.id}>{i.docNo} {i.description}</option>)}</select></Field>)}</div>
          <h2>{t('pc.checks')}</h2><div className="form-grid">{o.checks.map((c) => <Field key={c.id} label={c.label} name={`chk-${c.id}`} error={error}><select value={checks[c.id] ?? ''} onChange={(e) => setChecks({ ...checks, [c.id]: e.target.value })} style={sel} data-testid={`pc-check-${c.id}`}><option value="">—</option><option value="YES">{t('yes')}</option><option value="NO">{t('no')}</option><option value="NA">{t('na')}</option></select></Field>)}</div>
          <button type="button" className="btn btn-primary" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} onClick={save} data-testid="pc-save">{t('save')}</button></div>)}
      {!x.can.edit && <div className="table-scroll"><table className="data-table" data-testid="pc-irs"><caption>{t('pc.irs')}</caption><thead><tr><th>{t('tpl.type')}</th><th>{t('ir.title')}</th><th>{t('tc.status')}</th></tr></thead><tbody>{x.irLinks.map((l) => <tr key={l.kind}><td>{t(`irk.${l.kind}`)}</td><td>{l.irNo ? <Link to={`/qa/inspection-requests?id=${l.irId}`}>{l.irNo}</Link> : '—'}</td><td>{l.approved ? t('ins.ok') : t('pc.notApproved')}</td></tr>)}</tbody></table></div>}
      {x.can.record && (
        <div className="mdm-panel no-print" data-testid="pc-record"><h2>{t('pc.pour')}</h2><div className="form-grid">
          <Field label={t('pc.ticketNo')} name="ticketNo" error={error}><input value={tk.ticketNo} onChange={(e) => setTk({ ...tk, ticketNo: e.target.value })} maxLength={60} style={sel} data-testid="tk-no" /></Field>
          <Field label={t('pc.batch')} name="batchRef" error={error}><input value={tk.batchRef} onChange={(e) => setTk({ ...tk, batchRef: e.target.value })} maxLength={80} style={sel} data-testid="tk-batch" /></Field>
          <Field label={t('pc.truck')} name="truckNo" error={error}><input value={tk.truckNo} onChange={(e) => setTk({ ...tk, truckNo: e.target.value })} maxLength={30} style={sel} data-testid="tk-truck" /></Field>
          <Field label={t('pc.qty')} name="qty" error={error}><input type="number" min="0" step="0.001" value={tk.qty} onChange={(e) => setTk({ ...tk, qty: e.target.value })} style={sel} data-testid="tk-qty" /></Field>
          <Field label={t('pc.slump')} name="slumpMm" error={error}><input type="number" min="0" max="300" value={tk.slumpMm} onChange={(e) => setTk({ ...tk, slumpMm: e.target.value })} style={sel} data-testid="tk-slump" /></Field></div>
          <button type="button" className="btn" style={{ minHeight: 'var(--erp-target-min)' }} disabled={busy || !tk.ticketNo || !tk.qty} onClick={addTicket} data-testid="tk-add">{t('pc.addTicket')}</button>
          <div className="form-grid"><Field label={t('pc.weather')} name="weather" error={error}><input value={rec.weather} onChange={(e) => setRec({ ...rec, weather: e.target.value })} maxLength={200} style={sel} data-testid="pc-weather" /></Field></div>
          <button type="button" className="btn btn-primary" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} onClick={() => act('record', { pourEnd: new Date().toISOString(), weather: rec.weather || null }, t('pc.completed'))} data-testid="pc-complete">{t('pc.complete')}</button></div>)}
      {x.tickets.length > 0 && <div className="table-scroll"><table className="data-table" data-testid="pc-tickets"><caption>{t('pc.tickets')}</caption><thead><tr><th>{t('pc.ticketNo')}</th><th>{t('pc.batch')}</th><th>{t('pc.truck')}</th><th className="num">{t('pc.qty')}</th><th className="num">{t('pc.slump')}</th></tr></thead><tbody>{x.tickets.map((k) => <tr key={k.id} data-testid="pc-ticket"><td>{k.ticketNo}</td><td>{k.batchRef ?? '—'}</td><td>{k.truckNo ?? '—'}</td><td className="num">{k.qty}</td><td className="num">{k.slumpMm ?? '—'}</td></tr>)}</tbody></table></div>}
      {x.can.sample && <div className="mdm-panel no-print" data-testid="pc-cubes"><h2>{t('pc.cubes')}</h2><div className="form-grid">
        <Field label={t('pc.cubeCount')} name="cubes" error={error}><input type="number" min="3" max="12" value={cu.cubes} onChange={(e) => setCu({ ...cu, cubes: e.target.value })} style={sel} data-testid="cu-count" /></Field>
        <Field label={t('pc.castDate')} name="castDate" error={error}><input type="date" max={today()} value={cu.castDate} onChange={(e) => setCu({ ...cu, castDate: e.target.value })} style={sel} data-testid="cu-date" /></Field>
        <Field label={t('pc.ticketNo')} name="ticketId" error={error}><select value={cu.ticketId} onChange={(e) => setCu({ ...cu, ticketId: e.target.value })} style={sel} data-testid="cu-ticket"><option value="">—</option>{x.tickets.map((k) => <option key={k.id} value={k.id}>{k.ticketNo}</option>)}</select></Field></div>
        <button type="button" className="btn" style={{ minHeight: 'var(--erp-target-min)' }} disabled={busy} onClick={() => act('samples', { cubes: Number(cu.cubes), castDate: cu.castDate, ticketId: cu.ticketId ? Number(cu.ticketId) : null }, t('pc.sampleAdded'))} data-testid="cu-add">{t('pc.addSample')}</button></div>}
      {x.samples.length > 0 && <div className="table-scroll"><table className="data-table" data-testid="pc-samples"><caption>{t('pc.samples')}</caption><thead><tr><th>{t('cube.sample')}</th><th>{t('pc.castDate')}</th><th>{t('cube.due7')}</th><th>{t('cube.due28')}</th></tr></thead><tbody>{x.samples.map((s) => <tr key={s.id} data-testid="pc-sample"><td><Link to={`/qa/cubes?id=${s.id}`}>{s.sampleNo}</Link></td><td>{fmtDate(s.castDate)}</td><td>{fmtDate(s.due7)}</td><td>{fmtDate(s.due28)}</td></tr>)}</tbody></table></div>}
    </div>
  );
}
function NewPour() {
  const t = useT('qa'); usePageTitle(t('pc.new')); const { error, run, busy } = useRunner(); const oq = useQuery({ queryKey: ['qa', 'pour-options'], queryFn: () => qa.get('/pour-cards/options'), retry: false }); const o = oq.data;
  const [f, setF] = useState({ projectId: '', siteId: '', element: '', grade: 'M25', fck: '25', plannedVolume: '', plannedOn: today() }); const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const save = async () => { const d = await run(() => qa.make('/pour-cards', { projectId: Number(f.projectId), siteId: f.siteId ? Number(f.siteId) : null, element: f.element, grade: f.grade, fck: Number(f.fck), plannedVolume: Number(f.plannedVolume), plannedOn: f.plannedOn || null }), t('saved')); if (d) navigateTo(`/qa/pour-cards?id=${d.id}`); }; const big = { minHeight: 'var(--erp-target-large)', fontSize: '1rem' };
  return (
    <section aria-labelledby="pcn-h" data-testid="qa-pour-new"><PageHeader id="pcn-h" title={t('pc.new')} subtitle={<Link to="/qa/pour-cards">{t('pc.title')}</Link>} />
      {error?.form && <p className="field-error" role="alert" data-testid="pcn-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
      <div className="mdm-panel"><div className="form-grid">
        <Field label={t('project')} name="projectId" error={error}><select value={f.projectId} onChange={(e) => set('projectId', e.target.value)} style={big} data-testid="pcn-project"><option value="">—</option>{(o?.projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></Field>
        <Field label={t('site')} name="siteId" error={error}><select value={f.siteId} onChange={(e) => set('siteId', e.target.value)} style={big}><option value="">—</option>{(o?.sites ?? []).filter((s) => String(s.projectId) === String(f.projectId)).map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</select></Field>
        <Field label={t('pc.element')} name="element" error={error}><input value={f.element} onChange={(e) => set('element', e.target.value)} maxLength={200} style={big} data-testid="pcn-element" /></Field>
        <Field label={t('pc.grade')} name="grade" error={error}><input value={f.grade} onChange={(e) => set('grade', e.target.value)} maxLength={10} style={big} data-testid="pcn-grade" /></Field>
        <Field label={t('pc.fck')} name="fck" error={error}><input type="number" min="5" max="100" value={f.fck} onChange={(e) => set('fck', e.target.value)} style={big} data-testid="pcn-fck" /></Field>
        <Field label={t('pc.plannedVolume')} name="plannedVolume" error={error}><input type="number" min="0" step="0.001" value={f.plannedVolume} onChange={(e) => set('plannedVolume', e.target.value)} style={big} data-testid="pcn-volume" /></Field>
        <Field label={t('pc.plannedOn')} name="plannedOn" error={error}><input type="date" value={f.plannedOn} onChange={(e) => set('plannedOn', e.target.value)} style={big} /></Field></div>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy || !f.projectId || !f.element || !f.plannedVolume} onClick={save} data-testid="pcn-save">{t('save')}</button></div></div>
    </section>
  );
}
export default function PourCardsPage() {
  const t = useT('qa'); usePageTitle(t('pc.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession();
  if (sp.get('new')) return <NewPour />; if (id) return <section aria-labelledby="pc-h"><Pour id={id} /></section>;
  return (
    <section aria-labelledby="pcl-h" data-testid="qa-pours"><PageHeader id="pcl-h" title={t('pc.title')} subtitle={t('pc.intro')} />
      <div className="actions-row no-print"><Link to="/qa/pour-cards?new=1">{t('pc.new')}</Link><Link to="/qa/cubes">{t('cube.title')}</Link><Link to="/qa/concrete-acceptance">{t('ca.title')}</Link><Link to="/qa/concrete-traceability">{t('ct.title')}</Link><button type="button" className="btn" onClick={() => qa.exportFile('/pour-cards/export', 'pour-cards.csv').catch(() => globalThis.alert?.(t('exportFailed')))} data-testid="pc-export">{t('export')}</button></div>
      <ListReport listCode="qa.pour_cards" endpoint="/qa/pour-cards" title={t('pc.title')} session={session.data} rowHref={(r) => `/qa/pour-cards?id=${r.id}`} onOpen={(r) => navigateTo(`/qa/pour-cards?id=${r.id}`)} cardFields={['docNo', 'element', 'grade', 'status']} statusKey="status" dateKey="planned" empty={{ title: t('pc.emptyTitle'), text: t('pc.emptyBody') }} />
    </section>
  );
}
