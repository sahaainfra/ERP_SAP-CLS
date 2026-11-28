import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { qs, rmc } from './api.js';
import { DocBar, ErrorLine, Status, big, useRecord, useRunner } from './RmcParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Delivery tickets, the receipt at site and the consumption report (part 20.02, FR-03 to FR-06): a ticket per truck with a QR code, received by the site engineer (the same screen for an external supplier's truck), and the weights used against the mix designs.
const nowLocal = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 16); const stamp = (s) => (s ? s.replace('T', ' ').slice(0, 16) : '—'); const LOAD = { DISPATCHED: 'IN_REVIEW', ARRIVED: 'RETURNED', RECEIVED: 'APPROVED', REJECTED: 'REJECTED' };
const GRADES = ['M10', 'M15', 'M20', 'M25', 'M30', 'M35', 'M40', 'M45', 'M50', 'M55', 'M60'];
function TicketNew() {
  const t = useT('rmc'); const { error, run, busy } = useRunner(); usePageTitle(t('tk.new')); const o = useQuery({ queryKey: ['rmc', 'ticket-options'], queryFn: () => rmc.get('/delivery-tickets/options'), retry: false }); const [v, setV] = useState({ requisitionId: '', batchId: '', truckNo: '', driver: '', driverPhone: '', qty: '', outsidePremises: false, ewayNo: '' });
  if (o.error?.status === 403) return <NoPermission what={t('tk.title')} permission="rmc.delivery_ticket.create" />; if (o.isPending) return <Skeleton label={t('tk.title')} rows={3} />; const d = o.data; const fe = error?.fields ?? {}; const rq = d.requisitions.find((x) => String(x.id) === String(v.requisitionId));
  const save = async () => { const r = await run(() => rmc.make('/delivery-tickets', { requisitionId: Number(v.requisitionId), plantId: rq?.plantId ?? null, supplierId: rq?.plantId ? null : rq?.supplierId ?? null, batchId: v.batchId ? Number(v.batchId) : null, truckNo: v.truckNo, driver: v.driver || null, driverPhone: v.driverPhone || null, qty: Number(v.qty), outsidePremises: v.outsidePremises, ewayNo: v.ewayNo || null }), t('tk.made')); if (r) navigateTo(`/rmc/delivery-tickets?id=${r.id}`); };
  return (
    <section aria-labelledby="tkn-h" data-testid="rmc-ticket-form"><PageHeader id="tkn-h" title={t('tk.new')} meta={<Link to="/rmc/delivery-tickets">{t('tk.title')}</Link>} /><ErrorLine error={error} id="rmc-error" />
      <div className="mdm-panel"><div className="form-grid">
        <Field label={t('rq.title')} name="requisitionId" error={fe.requisitionId}><select value={v.requisitionId} onChange={(e) => setV({ ...v, requisitionId: e.target.value, batchId: '' })} style={big} data-testid="rmc-tk-req"><option value="">—</option>{d.requisitions.map((r) => <option key={r.id} value={r.id}>{r.docNo} {r.grade} {r.qty} m3 · {r.plant ?? r.supplier}</option>)}</select></Field>
        <Field label={t('bt.title')} name="batchId" error={fe.batchId}><select value={v.batchId} onChange={(e) => setV({ ...v, batchId: e.target.value })} style={big} data-testid="rmc-tk-batch"><option value="">—</option>{d.batches.filter((b) => rq && String(b.plantId) === String(rq.plantId) && (!b.requisitionId || b.requisitionId === rq.id)).map((b) => <option key={b.id} value={b.id}>{b.docNo} {b.qty} m3</option>)}</select></Field>
        <Field label={t('tk.truck')} name="truckNo" error={fe.truckNo}><input value={v.truckNo} onChange={(e) => setV({ ...v, truckNo: e.target.value })} maxLength={30} style={big} data-testid="rmc-tk-truck" /></Field>
        <Field label={t('tk.driver')} name="driver" error={fe.driver}><input value={v.driver} onChange={(e) => setV({ ...v, driver: e.target.value })} style={big} data-testid="rmc-tk-driver" /></Field>
        <Field label={t('tk.phone')} name="driverPhone" error={fe.driverPhone}><input value={v.driverPhone} inputMode="tel" onChange={(e) => setV({ ...v, driverPhone: e.target.value })} style={big} /></Field>
        <Field label={t('rq.qty')} name="qty" error={fe.qty}><input type="number" min="0" step="any" value={v.qty} onChange={(e) => setV({ ...v, qty: e.target.value })} style={big} data-testid="rmc-tk-qty" /></Field>
        <label style={{ minHeight: 'var(--erp-target-large)' }}><input type="checkbox" checked={v.outsidePremises} onChange={(e) => setV({ ...v, outsidePremises: e.target.checked })} data-testid="rmc-tk-outside" /> {t('tk.outside')}</label>
        {v.outsidePremises && <Field label={t('tk.eway')} name="ewayNo" error={fe.ewayNo}><input value={v.ewayNo} onChange={(e) => setV({ ...v, ewayNo: e.target.value })} maxLength={20} style={big} data-testid="rmc-tk-eway" /></Field>}</div>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy || !v.requisitionId || !v.truckNo || !v.qty} onClick={save} data-testid="rmc-tk-save">{t('tk.dispatch')}</button></div></div>
    </section>
  );
}
function Ticket({ id }) {
  const t = useT('rmc'); const { q, guard } = useRecord('/delivery-tickets', id, t('tk.title'), 'rmc.delivery_ticket.view'); const { error, run, busy, note } = useRunner(); usePageTitle(t('tk.title')); if (guard) return guard; const x = q.data;
  return (
    <div data-testid="rmc-ticket-object" data-status={x.status} data-state={x.state}><PageHeader id="tk-h" title={<>{x.ticketNo} <Status x={x} /> <StatusBadge status={LOAD[x.state]} label={x.stateLabel} /></>} meta={<><Link to="/rmc/delivery-tickets">{t('tk.title')}</Link> · {x.project} · {x.grade} · <strong data-testid="rmc-tk-qtyv">{x.qty}</strong> m3 · {x.truckNo} · {x.plant ?? x.supplier ?? '—'}</>} /><ErrorLine error={error} id="rmc-error" />{note && <p className="mdm-banner" role="status" data-testid="rmc-note">{note}</p>}
      <div className="mdm-panel" data-testid="rmc-ticket-view"><p>{t('tk.qr')}: <code data-testid="rmc-tk-qr">{x.qrCode}</code></p><p>{t('tk.driver')}: {x.driver ?? '—'} {x.driverPhone ?? ''} · {t('rq.title')}: <Link to={`/rmc/requisitions?id=${x.requisitionId}`}>{x.requisition}</Link> · {t('bt.title')}: {x.batch ?? '—'} · {t('rq.mix')}: {x.mix ?? '—'}</p>
        <p>{t('tk.times', { b: stamp(x.batchedAt), d: stamp(x.departedAt), a: stamp(x.arrivedAt) })} · {t('tk.unload', { s: stamp(x.unloadStart), e: stamp(x.unloadEnd) })}</p>
        <p>{t('tk.slump')}: {x.slumpMm ?? '—'} {x.slumpFlag ? `⚠ ${t('tk.slumpOut')}` : ''} · {t('tk.temp')}: {x.temperatureC ?? '—'} · {t('tk.returned')}: {x.returned} · {t('tk.wasted')}: {x.wasted} · {t('tk.net')}: <strong data-testid="rmc-tk-net">{x.net}</strong> m3 {x.returnReason ? `(${x.returnReason})` : ''}</p>
        <p>{t('tk.receivedBy')}: {x.receivedBy ?? '—'} · {x.outsidePremises ? `${t('tk.eway')}: ${x.ewayNo ?? (x.ewayAwaited ? t('tk.ewayAwaited') : '—')}` : ''}</p></div>
      <div className="actions-row no-print">{x.can.receive && <><button type="button" className="btn" disabled={busy || x.state !== 'DISPATCHED'} onClick={() => run(() => rmc.post(`/delivery-tickets/${x.id}/arrive`, {}), t('tk.arrivedNote'))} data-testid="rmc-tk-arrive">{t('tk.arrive')}</button><Link to={`/rmc/receipt?code=${encodeURIComponent(x.qrCode)}`} data-testid="rmc-tk-receive-link">{t('tk.receive')}</Link></>}</div>
      <DocBar kind="/delivery-tickets" x={x} printName={`${x.docNo}.pdf`} />
    </div>
  );
}
export function TicketsPage() {
  const t = useT('rmc'); usePageTitle(t('tk.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession();
  if (id) return <section aria-labelledby="tk-h"><Ticket id={id} /></section>; if (sp.get('new')) return <TicketNew />;
  return (
    <section aria-labelledby="tks-h" data-testid="rmc-tickets"><PageHeader id="tks-h" title={t('tk.title')} subtitle={t('tk.intro')} />
      <div className="actions-row no-print"><Link to="/rmc/delivery-tickets?new=1" data-testid="rmc-ticket-new">{t('tk.new')}</Link> · <Link to="/rmc/receipt">{t('rc.title')}</Link></div>
      <ListReport listCode="rmc.delivery_tickets" endpoint="/rmc/delivery-tickets" title={t('tk.title')} session={session.data} rowHref={(r) => `/rmc/delivery-tickets?id=${r.id}`} onOpen={(r) => navigateTo(`/rmc/delivery-tickets?id=${r.id}`)} cardFields={['ticketNo', 'grade', 'qty', 'state']} statusKey="status" empty={{ title: t('tk.emptyTitle'), text: t('tk.emptyBody') }} />
    </section>
  );
}
function Done({ done }) {
  const t = useT('rmc');
  return <div className="mdm-panel" data-testid="rmc-receipt-done"><h2>{t('rc.done')}</h2><p>{t('rc.net', { n: done.net })} {done.slumpFlag ? `⚠ ${t('tk.slumpOut')}` : ''}</p><p>{done.pour?.linked ? t('rc.pourLinked') : (done.pour?.message ?? t('rc.noPour'))}</p><Link to={`/rmc/delivery-tickets?id=${done.id}`}>{t('rc.open')}</Link></div>;
}
function ReceiveForm({ x, setDone }) {
  const t = useT('rmc'); const { error, run, busy, note } = useRunner(); const [v, setV] = useState({ arrivedAt: x.arrivedAt ?? nowLocal(), unloadStart: nowLocal(), unloadEnd: nowLocal(), slumpMm: '', temperatureC: '', returnedM3: '0', wastedM3: '0', returnReason: '' }); const fe = error?.fields ?? {};
  const save = async () => { const r = await run(() => rmc.post(`/delivery-tickets/${x.id}/receive`, { arrivedAt: v.arrivedAt, unloadStart: v.unloadStart, unloadEnd: v.unloadEnd, slumpMm: Number(v.slumpMm), temperatureC: v.temperatureC === '' ? null : Number(v.temperatureC), returnedM3: Number(v.returnedM3 || 0), wastedM3: Number(v.wastedM3 || 0), returnReason: v.returnReason || null }), t('rc.done')); if (r) setDone(r); };
  return (
    <div className="mdm-panel" data-testid="rmc-receipt-form"><ErrorLine error={error} id="rmc-error" />{note && <p className="mdm-banner" role="status">{note}</p>}<div className="form-grid">
      <Field label={t('tk.arrivedAt')} name="arrivedAt" error={fe.arrivedAt}><input type="datetime-local" value={v.arrivedAt} onChange={(e) => setV({ ...v, arrivedAt: e.target.value })} style={big} data-testid="rmc-rc-arrived" /></Field>
      <Field label={t('tk.unloadStart')} name="unloadStart" error={fe.unloadStart}><input type="datetime-local" value={v.unloadStart} onChange={(e) => setV({ ...v, unloadStart: e.target.value })} style={big} data-testid="rmc-rc-start" /></Field>
      <Field label={t('tk.unloadEnd')} name="unloadEnd" error={fe.unloadEnd}><input type="datetime-local" value={v.unloadEnd} onChange={(e) => setV({ ...v, unloadEnd: e.target.value })} style={big} data-testid="rmc-rc-end" /></Field>
      <Field label={t('tk.slump')} name="slumpMm" error={fe.slumpMm}><input type="number" inputMode="numeric" min="0" max="300" value={v.slumpMm} onChange={(e) => setV({ ...v, slumpMm: e.target.value })} style={big} data-testid="rmc-rc-slump" /></Field>
      <Field label={t('tk.temp')} name="temperatureC" error={fe.temperatureC}><input type="number" inputMode="numeric" value={v.temperatureC} onChange={(e) => setV({ ...v, temperatureC: e.target.value })} style={big} data-testid="rmc-rc-temp" /></Field>
      <Field label={t('tk.returned')} name="returnedM3" error={fe.returnedM3}><input type="number" min="0" step="any" inputMode="decimal" value={v.returnedM3} onChange={(e) => setV({ ...v, returnedM3: e.target.value })} style={big} data-testid="rmc-rc-returned" /></Field>
      <Field label={t('tk.wasted')} name="wastedM3" error={fe.wastedM3}><input type="number" min="0" step="any" inputMode="decimal" value={v.wastedM3} onChange={(e) => setV({ ...v, wastedM3: e.target.value })} style={big} data-testid="rmc-rc-wasted" /></Field>
      <Field label={t('tk.returnReason')} name="returnReason" error={fe.returnReason}><input value={v.returnReason} onChange={(e) => setV({ ...v, returnReason: e.target.value })} maxLength={300} style={big} data-testid="rmc-rc-reason" /></Field></div>
      <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 56, fontSize: '1.1rem' }} disabled={busy || v.slumpMm === ''} onClick={save} data-testid="rmc-rc-save">{t('rc.receive')}</button>
        <button type="button" className="btn" style={{ minHeight: 56 }} disabled={busy} onClick={() => { const r = globalThis.prompt(t('rc.rejectWhy')); if (r) run(() => rmc.post(`/delivery-tickets/${x.id}/reject`, { reason: r }), t('rc.rejected')).then((z) => z && setDone({ ...z, net: 0, pour: null })); }} data-testid="rmc-rc-reject">{t('rc.reject')}</button></div>
    </div>
  );
}
export function ReceiptPage() {
  const t = useT('rmc'); usePageTitle(t('rc.title')); const sp = useSearch(); const code = sp.get('code') ?? ''; const [typed, setTyped] = useState(code); const [done, setDone] = useState(null);
  const f = useQuery({ queryKey: ['rmc', 'by-code', code], queryFn: () => rmc.get(`/delivery-tickets/by-code${qs({ code })}`), enabled: Boolean(code), retry: false });
  const wait = useQuery({ queryKey: ['rmc', 'on-the-way'], queryFn: async () => { const a = await rmc.get('/delivery-tickets?page=1&pageSize=25&filter[state]=DISPATCHED'); const b = await rmc.get('/delivery-tickets?page=1&pageSize=25&filter[state]=ARRIVED'); return [...(Array.isArray(a) ? a : a?.data ?? []), ...(Array.isArray(b) ? b : b?.data ?? [])]; }, retry: false });
  if (wait.error?.status === 403) return <NoPermission what={t('rc.title')} permission="rmc.delivery_ticket.receive" />;
  return (
    <section aria-labelledby="rc-h" data-testid="rmc-receipt"><PageHeader id="rc-h" title={t('rc.title')} subtitle={t('rc.intro')} />
      <form className="mdm-panel no-print" onSubmit={(e) => { e.preventDefault(); navigateTo(`/rmc/receipt?code=${encodeURIComponent(typed.trim())}`); }}><Field label={t('rc.code')} name="code" error={f.error ? { form: f.error.message } : null}><input value={typed} onChange={(e) => setTyped(e.target.value)} style={big} autoFocus data-testid="rmc-rc-code" /></Field><div className="actions-row"><button className="btn btn-primary" style={big} disabled={!typed.trim()} data-testid="rmc-rc-find">{t('rc.find')}</button></div></form>
      {code && f.isPending && <Skeleton label={t('rc.title')} rows={2} />}{f.isError && <ErrorState error={f.error} onRetry={f.refetch} />}
      {f.data && (<div data-testid="rmc-rc-ticket"><div className="mdm-panel"><h2>{f.data.ticketNo} <StatusBadge status={LOAD[f.data.state]} label={f.data.stateLabel} /></h2><p>{f.data.grade} · {f.data.qty} m3 · {f.data.truckNo} · {f.data.plant ?? f.data.supplier} · {f.data.requisition}</p></div>
        {done && done.id === f.data.id ? <Done done={done} /> : ['DISPATCHED', 'ARRIVED'].includes(f.data.state) && f.data.can.receive ? <ReceiveForm x={f.data} setDone={setDone} /> : <p className="mdm-banner" data-testid="rmc-rc-closed">{t('rc.closed')} <Link to={`/rmc/delivery-tickets?id=${f.data.id}`}>{t('rc.open')}</Link></p>}</div>)}
      {!code && (<div className="mdm-panel" data-testid="rmc-rc-waiting"><h2>{t('rc.onTheWay')}</h2>{(wait.data ?? []).length === 0 ? <p className="muted">{t('rc.noneWaiting')}</p> : (wait.data ?? []).map((k) => <p key={k.id} data-testid="rmc-rc-wait-row"><Link to={`/rmc/receipt?code=${encodeURIComponent(k.qrCode)}`}>{k.ticketNo}</Link> · {k.grade} · {k.qty} m3 · {k.truckNo} · {k.stateLabel}</p>)}</div>)}
    </section>
  );
}
export function ConsumptionPage() {
  const t = useT('rmc'); usePageTitle(t('co.title')); const [f, setF] = useState({ from: '', to: '', grade: '' }); const query = qs(f); const q = useQuery({ queryKey: ['rmc', 'consumption', query], queryFn: () => rmc.get(`/consumption${query}`), retry: false, placeholderData: (p) => p });
  if (q.error?.status === 403) return <NoPermission what={t('co.title')} permission="rmc.consumption.view" />; if (q.isPending) return <Skeleton label={t('co.title')} rows={4} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />; const d = q.data;
  return (
    <section aria-labelledby="co-h" data-testid="rmc-consumption"><PageHeader id="co-h" title={t('co.title')} /><p className="muted" data-testid="rmc-co-total">{t('co.total', { n: d.totals.batches, q: d.totals.qty, f: d.totals.flagged, tol: d.tolerancePct })}</p>
      <div className="mdm-panel no-print"><div className="form-grid">
        <Field label={t('cmp.from')} name="from" error={null}><input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} style={big} data-testid="rmc-co-from" /></Field>
        <Field label={t('cmp.to')} name="to" error={null}><input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} style={big} /></Field>
        <Field label={t('mx.grade')} name="grade" error={null}><select value={f.grade} onChange={(e) => setF({ ...f, grade: e.target.value })} style={big} data-testid="rmc-co-grade"><option value="">—</option>{GRADES.map((g) => <option key={g} value={g}>{g}</option>)}</select></Field></div>
        <div className="actions-row"><button type="button" className="btn" onClick={() => rmc.exportFile(`/consumption/export${query}`, 'consumption.csv').catch(() => globalThis.alert?.(t('exportFailed')))} data-testid="rmc-co-export">{t('co.export')}</button></div></div>
      {d.materials.length === 0 ? <div className="empty-state"><h2>{t('co.emptyTitle')}</h2><p>{t('co.emptyBody')}</p></div> : (
        <div className="table-scroll"><table className="data-table" data-testid="rmc-co-table"><thead><tr><th>{t('mx.material')}</th><th className="num">{t('bt.theoretical')}</th><th className="num">{t('bt.actual')}</th><th className="num">{t('co.variance')}</th><th className="num">%</th></tr></thead>
          <tbody>{d.materials.map((m) => <tr key={m.component} data-flagged={m.flagged} data-testid="rmc-co-row"><td>{t(`mx.c.${m.component}`)}</td><td className="num">{m.theoretical}</td><td className="num">{m.actual}</td><td className="num">{m.variance}</td><td className="num">{m.variancePct} {m.flagged ? '⚠' : ''}</td></tr>)}</tbody></table></div>)}
      <p data-testid="rmc-co-returns">{t('co.returns', { r: d.concrete.returned, w: d.concrete.wasted, n: d.concrete.tickets })}</p>
      {d.flaggedBatches.length > 0 && <div className="table-scroll"><table className="data-table" data-testid="rmc-co-flagged"><caption>{t('co.flagged')}</caption><thead><tr><th>{t('bt.title')}</th><th>{t('mx.plant')}</th><th className="num">{t('co.max')}</th></tr></thead><tbody>{d.flaggedBatches.map((b) => <tr key={b.id}><td><Link to={`/rmc/batches?id=${b.id}`}>{b.docNo}</Link></td><td>{b.plant}</td><td className="num">{b.maxVariancePct}</td></tr>)}</tbody></table></div>}
    </section>
  );
}
