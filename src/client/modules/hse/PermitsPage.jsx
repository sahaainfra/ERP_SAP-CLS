import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { fmtDate, hse, HSE_TONE, qs } from './api.js';
import { DocBar, ErrorLine, ProjectSite, Status, big, useRecord, useRunner } from './HseParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Permit to work (part 19.02): the register and the permit itself (checks, gas tests, isolation, extension, suspension, closure with handback), and the request form for the phone.
export const PERMIT_TONE = { PENDING: 'DRAFT', ON_HOLD: 'RETURNED', ACTIVE: 'APPROVED', SUSPENDED: 'REJECTED', EXPIRED: 'CANCELLED', CLOSED: 'CANCELLED' };
export const stamp = (iso) => (iso ? iso.replace('T', ' ') : '—');
const localIn = (h) => new Date(Date.now() + 5.5 * 3600_000 + h * 3_600_000).toISOString().slice(0, 16);
export function PermitState({ x }) { const t = useT('hse'); return <StatusBadge status={PERMIT_TONE[x.permitStatus]} label={t(`pst.${x.permitStatus}`)} />; }
function Actions({ x }) {
  const t = useT('hse'); const { error, run, busy, note } = useRunner(); const [gas, setGas] = useState({ gas: 'O2', reading: '' }); const [iso, setIso] = useState({ point: '', method: 'LOTO', tag: '' }); const [ext, setExt] = useState({ validTo: '', reason: '' }); const [hb, setHb] = useState({ siteClear: false, workComplete: false, note: '' });
  const act = (a, b, msg) => run(() => hse.act('/permits', x.id, a, b), msg); const why = (a, msg) => { const r = globalThis.prompt(t('why')); if (r) act(a, { reason: r }, msg); };
  return (
    <div className="no-print" data-testid="hse-permit-actions"><ErrorLine error={error} id="hse-permit-error" />{note && <p className="mdm-banner" role="status" data-testid="hse-permit-note">{note}</p>}
      <div className="actions-row">
        {x.can.suspend && <button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => why('suspend', t('pm.suspended'))} data-testid="hse-permit-suspend">{t('pm.suspend')}</button>}
        {x.can.resume && <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => act('resume', {}, t('pm.resumed'))} data-testid="hse-permit-resume">{t('pm.resume')}</button>}
        {x.can.activate && <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => act('activate', {}, t('pm.activated'))} data-testid="hse-permit-activate">{t('pm.activate')}</button>}
      </div>
      {x.can.record && (
        <div className="mdm-panel" data-testid="hse-permit-gas"><h2>{t('pm.gasTests')}</h2>
          <div className="form-grid"><Field label={t('pm.gas')} name="gas" error={error}><select value={gas.gas} onChange={(e) => setGas({ ...gas, gas: e.target.value })} style={big} data-testid="hse-gas-gas">{['O2', 'LEL', 'H2S', 'CO'].map((g) => <option key={g} value={g}>{g}</option>)}</select></Field><Field label={t('pm.reading')} name="reading" error={error}><input type="number" step="0.1" inputMode="decimal" value={gas.reading} onChange={(e) => setGas({ ...gas, reading: e.target.value })} style={big} data-testid="hse-gas-reading" /></Field>
            <button type="button" className="btn" style={big} disabled={busy || gas.reading === ''} onClick={async () => { if (await run(() => hse.post(`/permits/${x.id}/gas-tests`, { gas: gas.gas, reading: Number(gas.reading) }), t('pm.gasRecorded'))) setGas({ ...gas, reading: '' }); }} data-testid="hse-gas-add">{t('pm.record')}</button></div></div>)}
      {x.gasTests.length > 0 && <div className="table-scroll"><table className="data-table" data-testid="hse-permit-gas-list"><thead><tr><th>{t('when')}</th><th>{t('pm.gas')}</th><th>{t('pm.reading')}</th><th>{t('pm.result')}</th><th>{t('who')}</th></tr></thead><tbody>{x.gasTests.map((g, i) => <tr key={i}><td>{fmtDate(g.at)}</td><td>{g.gas}</td><td>{g.reading} {g.unit}</td><td><StatusBadge status={g.result === 'PASS' ? 'APPROVED' : 'REJECTED'} label={t(`pm.${g.result}`)} /></td><td>{g.by}</td></tr>)}</tbody></table></div>}
      {(x.can.record || x.isolations.length > 0) && (
        <div className="mdm-panel" data-testid="hse-permit-iso"><h2>{t('pm.isolations')}</h2>
          <ul>{x.isolations.map((i, k) => <li key={k} data-testid="hse-iso-row">{i.point} · {i.method} · <b>{i.tag}</b> {i.removedAt ? <StatusBadge status="CANCELLED" label={t('pm.removed')} /> : (x.can.record && <button type="button" className="btn" style={{ minHeight: 44 }} disabled={busy} onClick={() => run(() => hse.post(`/permits/${x.id}/isolations/remove`, { index: k }), t('pm.isoRemoved'))} data-testid="hse-iso-remove">{t('pm.remove')}</button>)}</li>)}</ul>
          {x.can.record && <div className="form-grid"><Field label={t('pm.isoPoint')} name="point" error={error}><input value={iso.point} onChange={(e) => setIso({ ...iso, point: e.target.value })} style={big} data-testid="hse-iso-point" /></Field><Field label={t('pm.isoMethod')} name="method" error={error}><select value={iso.method} onChange={(e) => setIso({ ...iso, method: e.target.value })} style={big}>{['LOTO', 'BLANKING', 'DISCONNECTION', 'OTHER'].map((m) => <option key={m} value={m}>{t(`iso.${m}`)}</option>)}</select></Field><Field label={t('pm.isoTag')} name="tag" error={error}><input value={iso.tag} onChange={(e) => setIso({ ...iso, tag: e.target.value })} style={big} data-testid="hse-iso-tag" /></Field>
            <button type="button" className="btn" style={big} disabled={busy || iso.point.length < 2 || !iso.tag} onClick={async () => { if (await run(() => hse.post(`/permits/${x.id}/isolations`, iso), t('pm.isoAdded'))) setIso({ point: '', method: 'LOTO', tag: '' }); }} data-testid="hse-iso-add">{t('pm.isoAdd')}</button></div>}</div>)}
      {x.can.extend && (
        <div className="mdm-panel" data-testid="hse-permit-extend"><h2>{t('pm.extend')}</h2><div className="form-grid"><Field label={t('pm.newEnd')} name="validTo" error={error}><input type="datetime-local" value={ext.validTo} onChange={(e) => setExt({ ...ext, validTo: e.target.value })} style={big} data-testid="hse-ext-to" /></Field><Field label={t('pm.reason')} name="reason" error={error}><input value={ext.reason} onChange={(e) => setExt({ ...ext, reason: e.target.value })} style={big} data-testid="hse-ext-reason" /></Field>
          <button type="button" className="btn" style={big} disabled={busy || !ext.validTo || ext.reason.length < 5} onClick={() => run(() => hse.post(`/permits/${x.id}/extend`, ext), t('pm.extended'))} data-testid="hse-ext-go">{t('pm.extend')}</button></div></div>)}
      {x.can.close && (
        <div className="mdm-panel" data-testid="hse-permit-close"><h2>{t('pm.close')}</h2>
          <label style={{ display: 'block', minHeight: 44 }}><input type="checkbox" checked={hb.workComplete} onChange={(e) => setHb({ ...hb, workComplete: e.target.checked })} data-testid="hse-hb-work" /> {t('pm.workComplete')}</label><label style={{ display: 'block', minHeight: 44 }}><input type="checkbox" checked={hb.siteClear} onChange={(e) => setHb({ ...hb, siteClear: e.target.checked })} data-testid="hse-hb-clear" /> {t('pm.siteClear')}</label>
          <Field label={t('pm.handbackNote')} name="note" error={error}><input value={hb.note} onChange={(e) => setHb({ ...hb, note: e.target.value })} style={big} /></Field><button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => hse.post(`/permits/${x.id}/close`, { ...hb, note: hb.note || null }), t('pm.closed'))} data-testid="hse-hb-go">{t('pm.close')}</button></div>)}
    </div>
  );
}
function Permit({ id }) {
  const t = useT('hse'); const { q, guard } = useRecord('/permits', id, t('pm.title'), 'hse.permit.view'); usePageTitle(t('pm.title')); if (guard) return guard; const x = q.data;
  return (
    <div data-testid="hse-permit-object" data-status={x.status} data-permit={x.permitStatus}><PageHeader id="pmo-h" title={<>{x.docNo} <PermitState x={x} /> <Status x={x} /> {x.riskClass === 'HIGH' && <StatusBadge status="REJECTED" label={t('pm.high')} />}</>} meta={<><Link to="/hse/permits">{t('pm.register')}</Link> · {x.project} · {x.type} · {x.location ?? '—'} · {x.title}</>} />
      <p data-testid="hse-permit-window">{t('pm.valid')}: {stamp(x.validFrom)} → {stamp(x.validTo)}{x.minutesLeft != null ? ` · ${t('pm.left', { n: x.minutesLeft })}` : ''} · {t('pm.supervisor')}: {x.supervisor} · {t('pm.extensions', { n: x.extensionCount })}</p>
      {x.holdReason && <p className="field-error" role="status">{x.holdReason}</p>}{x.suspendedReason && x.permitStatus === 'SUSPENDED' && <p className="field-error" role="status" data-testid="hse-permit-suspended">{x.suspendedReason}</p>}
      {x.problems.length > 0 && <div className="mdm-panel" data-testid="hse-permit-problems"><h2>{t('pm.before')}</h2><ul>{x.problems.map((p, i) => <li key={i}>{p.message}</li>)}</ul></div>}
      <div className="table-scroll"><table className="data-table" data-testid="hse-permit-workers"><caption>{t('pm.workers')}</caption><thead><tr><th>{t('who')}</th><th>{t('tbt.code')}</th><th>{t('pm.certs')}</th></tr></thead><tbody>{x.workers.map((w, i) => <tr key={i}><td>{w.name}</td><td>{w.code}</td><td>{w.problems.length ? <StatusBadge status="REJECTED" label={w.problems.join('; ')} /> : <StatusBadge status="APPROVED" label={t('pm.certOk')} />}</td></tr>)}</tbody></table></div>
      <p>{t('pm.ppe')}: {x.ppe.join(', ') || '—'} · {t('pm.certsNeeded')}: {x.requiredCerts.join(', ') || '—'}</p>
      {x.handback && <p data-testid="hse-permit-handback">{t('pm.handback')}: {x.handback.by} · {fmtDate(x.handback.at)}{x.handback.note ? ` · ${x.handback.note}` : ''}</p>}
      <Actions x={x} />
      <DocBar kind="/permits" x={x} printName={`${x.docNo}.pdf`} />
    </div>
  );
}
export function RequestPermit() {
  const t = useT('hse'); usePageTitle(t('pm.request')); const { error, run, busy } = useRunner(); const [v, setV] = useState({ projectId: '', siteId: '' }); const [f, setF] = useState({ typeId: '', locationId: '', title: '', supervisor: '', validFrom: localIn(0), validTo: localIn(8), workers: [] }); const [text, setText] = useState('');
  const oq = useQuery({ queryKey: ['hse', 'permit-options', v.projectId], queryFn: () => hse.get(`/permits/options${qs({ projectId: v.projectId })}`), placeholderData: (p) => p, retry: false });
  const pq = useQuery({ queryKey: ['hse', 'people', text], queryFn: () => hse.get(`/inductions/people${qs({ q: text })}`), enabled: text.trim().length >= 2, retry: false });
  const cq = useQuery({ queryKey: ['hse', 'permit-conflicts', v.siteId, f.locationId, f.typeId, f.validFrom, f.validTo], queryFn: () => hse.get(`/permits/conflicts${qs({ siteId: v.siteId, locationId: f.locationId, typeId: f.typeId, validFrom: f.validFrom, validTo: f.validTo })}`), enabled: Boolean(v.siteId && f.locationId && f.typeId && f.validFrom && f.validTo), retry: false });
  if (oq.error?.status === 403) return <NoPermission what={t('pm.request')} permission="hse.permit.create" />; if (oq.isPending) return <Skeleton label={t('pm.request')} rows={4} />; const o = oq.data; const type = o.types.find((x) => String(x.id) === String(f.typeId));
  const body = () => ({ projectId: Number(v.projectId), siteId: Number(v.siteId), typeId: Number(f.typeId), locationId: f.locationId ? Number(f.locationId) : null, title: f.title, supervisor: f.supervisor, validFrom: f.validFrom, validTo: f.validTo, workers: f.workers.map((w) => ({ kind: w.type, id: w.id })) });
  return (
    <section aria-labelledby="pmr-h" data-testid="hse-permit-request"><PageHeader id="pmr-h" title={t('pm.request')} subtitle={<><Link to="/hse/permits">{t('pm.register')}</Link> · {t('pm.requestHint')}</>} /><ErrorLine error={error} id="hse-permit-error" />
      <div className="mdm-panel"><div className="form-grid"><ProjectSite o={o} v={v} set={setV} error={error} />
        <Field label={t('pm.type')} name="typeId" error={error}><select value={f.typeId} onChange={(e) => setF({ ...f, typeId: e.target.value })} style={big} data-testid="hse-pm-type"><option value="">—</option>{o.types.map((x) => <option key={x.id} value={x.id}>{x.name}{x.riskClass === 'HIGH' ? ` (${t('pm.high')})` : ''}</option>)}</select></Field>
        <Field label={t('pm.location')} name="locationId" error={error}><select value={f.locationId} onChange={(e) => setF({ ...f, locationId: e.target.value })} style={big} data-testid="hse-pm-location"><option value="">—</option>{o.locations.map((l) => <option key={l.id} value={l.id}>{l.code} {l.name}</option>)}</select></Field>
        <Field label={t('pm.work')} name="title" error={error}><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={200} style={big} data-testid="hse-pm-title" /></Field>
        <Field label={t('pm.supervisor')} name="supervisor" error={error}><input value={f.supervisor} onChange={(e) => setF({ ...f, supervisor: e.target.value })} maxLength={120} style={big} data-testid="hse-pm-supervisor" /></Field>
        <Field label={t('pm.from')} name="validFrom" error={error}><input type="datetime-local" value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} style={big} data-testid="hse-pm-from" /></Field><Field label={t('pm.to')} name="validTo" error={error}><input type="datetime-local" value={f.validTo} onChange={(e) => setF({ ...f, validTo: e.target.value })} style={big} data-testid="hse-pm-to" /></Field></div>
        {type && <p className="muted" data-testid="hse-pm-type-info">{t('pm.typeInfo', { hours: type.maxHours, certs: type.certs.join(', ') || '—', gas: type.gas ? type.gases.join(', ') : '—', iso: type.isolation ? t('yes') : t('no') })}</p>}
        {cq.data?.length > 0 && <p className="field-error" role="alert" data-testid="hse-pm-conflicts">{t('pm.conflicts')}: {cq.data.map((c) => `${c.docNo} (${c.type}, ${stamp(c.validFrom)} → ${stamp(c.validTo)})`).join('; ')}</p>}</div>
      <div className="mdm-panel"><h2>{t('pm.workers')}</h2><Field label={t('ind.person')} name="workers" error={error}><input value={text} onChange={(e) => setText(e.target.value)} style={big} data-testid="hse-pm-search" /></Field>
        <ul>{(pq.data ?? []).map((p) => <li key={`${p.type}${p.id}`}><button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => { if (!f.workers.some((w) => w.id === p.id && w.type === p.type)) setF({ ...f, workers: [...f.workers, p] }); setText(''); }} data-testid="hse-pm-pick">{p.name} · {p.code} · {t(`ind.${p.type}`)}</button></li>)}</ul>
        <ul data-testid="hse-pm-workers">{f.workers.map((w, i) => <li key={i}>{w.name} ({w.code}) <button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => setF({ ...f, workers: f.workers.filter((_, j) => j !== i) })}>{t('remove')}</button></li>)}</ul></div>
      <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy || !v.siteId || !f.typeId || f.title.length < 3 || f.supervisor.length < 2} onClick={async () => { const r = await run(() => hse.make('/permits', body())); if (r) navigateTo(`/hse/permits?id=${r.id}`); }} data-testid="hse-pm-save">{t('pm.saveDraft')}</button>
        <button type="button" className="btn btn-primary" style={big} disabled={busy || !v.siteId || !f.typeId || f.title.length < 3 || f.supervisor.length < 2} onClick={async () => { const r = await run(() => hse.make('/permits', { ...body(), submit: true })); if (r) navigateTo(`/hse/permits?id=${r.id}`); }} data-testid="hse-pm-send">{t('pm.send')}</button></div>
    </section>
  );
}
export default function PermitsPage() {
  const t = useT('hse'); usePageTitle(t('pm.register')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession();
  if (id) return <section aria-labelledby="pmo-h"><Permit id={id} /></section>;
  return (
    <section aria-labelledby="pml-h" data-testid="hse-permits"><PageHeader id="pml-h" title={t('pm.register')} subtitle={t('pm.intro')} />
      <div className="actions-row no-print"><Link to="/hse/permit-request" data-testid="hse-permit-new">{t('pm.request')}</Link><Link to="/hse/permit-board">{t('pb.title')}</Link><button type="button" className="btn" onClick={() => hse.exportFile('/permits/export', 'permits.csv').catch(() => globalThis.alert?.(t('exportFailed')))}>{t('export')}</button></div>
      <ListReport listCode="hse.permits" endpoint="/hse/permits" title={t('pm.register')} session={session.data} rowHref={(r) => `/hse/permits?id=${r.id}`} onOpen={(r) => navigateTo(`/hse/permits?id=${r.id}`)} cardFields={['docNo', 'type', 'location', 'permitStatus']} statusKey="status" empty={{ title: t('pm.emptyTitle'), text: t('pm.emptyBody') }} />
    </section>
  );
}
void HSE_TONE;
