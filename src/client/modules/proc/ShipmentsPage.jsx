import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { SHIP_TONE, addDays, download, fmtDate, fmtQty, px, today } from './api.js';
import { ProjectOrder, useRunner } from './XpdParts.jsx';
import { useSearch } from '../site/parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Shipments tracker (part 15.07, FR-03, FR-04): a consignment against an order with the transporter, LR or bill of lading, e-way bill, packing list and (for over-dimensional cargo) the permit; dispatch is cleared by the inspection release note where inspection is
// mandatory (CP-PROC-07); tracking events move the ETA and the plan is worked out again; the dispatch and delivery go to the gate entry.
function Ship({ t, id }) {
  const q = useQuery({ queryKey: ['proc', 'ship', id], queryFn: () => px.ship(id), retry: false });
  const { error, setError, note, busy, run } = useRunner(); const [d, setD] = useState({ dispatchedOn: today(), eta: '' }); const [tr, setTr] = useState({ location: '', note: '', eta: '' });
  usePageTitle(t('x.shipTitle'));
  if (q.error?.status === 403) return <NoPermission what={t('x.shipTitle')} permission="proc.shipment.view" />;
  if (q.isPending) return <Skeleton label={t('x.shipTitle')} rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const r = q.data; const can = r.can; const eta = d.eta || r.eta || '';
  const why = (action, msg) => { const x = window.prompt(t('x.why')); if (x) run(() => px.shipAct(r.id, action, { reason: x }), msg); };
  return (
    <div data-testid="sh-object" data-status={r.status} data-clearance={r.clearance}>
      <PageHeader id="sh-h" title={<>{r.docNo} <StatusBadge status={SHIP_TONE[r.status]} label={t(`x.sh.${r.status}`)} />{r.isOdc && <StatusBadge status="RETURNED" label={t('x.odc')} />}</>} meta={<><Link to="/proc/shipments">{t('x.back')}</Link> · <Link to={`/proc/purchase-orders?id=${r.poId}`}>{r.poNo}</Link> {r.vendor} · {r.projectCode}</>} />
      <dl className="kv" data-testid="sh-figures"><div><dt>{t('x.transporter')}</dt><dd>{r.transporter ?? '—'}</dd></div><div><dt>{t('x.vehicle')}</dt><dd>{r.vehicleNo ?? '—'}</dd></div><div><dt>{t('x.lr')}</dt><dd>{r.lrNo ?? r.blNo ?? '—'}</dd></div><div><dt>{t('x.eway')}</dt><dd>{r.ewayBillNo ?? '—'}</dd></div><div><dt>{t('x.packages')}</dt><dd>{r.packages}</dd></div>
        <div><dt>{t('x.dispatchedOn')}</dt><dd>{fmtDate(r.dispatchedOn)}</dd></div><div><dt>{t('x.eta')}</dt><dd data-testid="sh-eta">{fmtDate(r.eta)}</dd></div><div><dt>{t('x.requiredOnSite')}</dt><dd>{fmtDate(r.requiredOnSite)}{r.lateBy > 0 && <span className="field-error"> {t('x.lateBy', { n: r.lateBy })}</span>}</dd></div>
        <div><dt>{t('x.clearance')}</dt><dd data-testid="sh-clearance">{t(`x.c.${r.clearance}`)}{r.irnNo ? ` · ${r.irnNo}` : ''}</dd></div>{r.isOdc && <div><dt>{t('x.odcPermit')}</dt><dd>{r.odcPermitNo} · {t('x.validTo')} {fmtDate(r.odcValidTo)}{r.odcDimensions ? ` · ${r.odcDimensions}` : ''}</dd></div>}</dl>
      {r.packingList && <p>{r.packingList}</p>}
      {error?.form && <p className="field-error" role="alert" data-testid="sh-error">{error.form}</p>}{note && <p className="mdm-banner" role="status" data-testid="sh-note">{note}</p>}
      <div className="table-scroll"><table className="data-table" data-testid="sh-lines"><caption>{t('x.lines')}</caption><thead><tr><th>#</th><th>{t('x.item')}</th><th className="num">{t('x.qty')}</th></tr></thead><tbody>{r.lines.map((l) => <tr key={l.poLineId}><td>{l.lineNo}</td><td>{l.description}</td><td className="num">{fmtQty(l.qty)} {l.uom}</td></tr>)}</tbody></table></div>
      {can.dispatch && <div className="mdm-panel no-print" data-testid="sh-dispatch"><h2>{t('x.dispatch')}</h2><p className="muted">{t('x.dispatchHelp')}</p>
        <div className="form-grid"><Field label={t('x.dispatchedOn')} name="dispatchedOn" error={error}><input type="date" value={d.dispatchedOn} onChange={(ev) => setD({ ...d, dispatchedOn: ev.target.value })} style={{ minHeight: 44 }} data-testid="sh-date" /></Field><Field label={t('x.eta')} name="eta" error={error}><input type="date" value={eta} onChange={(ev) => setD({ ...d, eta: ev.target.value })} style={{ minHeight: 44 }} data-testid="sh-eta-input" /></Field></div>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => run(() => px.shipAct(r.id, 'dispatch', { dispatchedOn: d.dispatchedOn, eta: eta || undefined }), t('x.dispatched'))} data-testid="sh-dispatch-go">{t('x.dispatchGo')}</button></div></div>}
      {can.track && <div className="mdm-panel no-print" data-testid="sh-track"><h2>{t('x.track')}</h2>
        <div className="form-grid"><Field label={t('x.where')} name="location" error={error}><input value={tr.location} maxLength={120} onChange={(ev) => setTr({ ...tr, location: ev.target.value })} style={{ minHeight: 44 }} data-testid="sh-where" /></Field><Field label={t('x.newEta')} name="eta" error={error}><input type="date" min={addDays(0)} value={tr.eta} onChange={(ev) => setTr({ ...tr, eta: ev.target.value })} style={{ minHeight: 44 }} data-testid="sh-new-eta" /></Field>
          <Field label={t('x.note')} name="note" error={error}><input value={tr.note} maxLength={300} onChange={(ev) => setTr({ ...tr, note: ev.target.value })} style={{ minHeight: 44 }} /></Field></div>
        <div className="actions-row"><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => run(() => px.shipAct(r.id, 'track', { location: tr.location || null, note: tr.note || null, eta: tr.eta || undefined }), t('x.tracked')).then(() => setTr({ location: '', note: '', eta: '' }))} data-testid="sh-track-go">{t('x.addEvent')}</button>
          {can.deliver && <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => run(() => px.shipAct(r.id, 'deliver', {}), t('x.delivered'))} data-testid="sh-deliver">{t('x.deliver')}</button>}</div></div>}
      {(r.events ?? []).length > 0 && <div className="table-scroll"><table className="data-table" data-testid="sh-events"><caption>{t('x.events')}</caption><thead><tr><th>{t('x.when')}</th><th>{t('x.where')}</th><th>{t('x.note')}</th><th>{t('x.eta')}</th></tr></thead><tbody>{r.events.map((e) => <tr key={e.id}><td>{String(e.at).slice(0, 16).replace('T', ' ')}</td><td>{e.location ?? ''}</td><td>{e.note ?? ''}</td><td>{fmtDate(e.etaAfter)}</td></tr>)}</tbody></table></div>}
      <div className="actions-row no-print">
        {can.edit && <Link to={`/proc/shipments?new=1&edit=${r.id}`}>{t('x.edit')}</Link>}
        {can.cancel && <button type="button" className="btn" onClick={() => why('cancel', t('x.cancelled'))} data-testid="sh-cancel">{t('x.cancel')}</button>}
        {can.delete && <button type="button" className="btn" onClick={async () => { if (window.confirm(t('x.deleteAsk')) && await run(() => px.shipDelete(r.id))) navigateTo('/proc/shipments'); }}>{t('x.delete')}</button>}
        {can.print && <button type="button" className="btn" onClick={() => download(`/shipments/${r.id}/print`, `${r.docNo.replaceAll('/', '-')}.pdf`).catch(() => setError({ form: t('x.fileFailed') }))} data-testid="sh-print">{t('x.print')}</button>}
      </div>
    </div>
  );
}

function ShipForm({ t, editId, project0, po0 }) {
  const eq = useQuery({ queryKey: ['proc', 'ship', editId], queryFn: () => px.ship(editId), enabled: Boolean(editId), retry: false }); const e = eq.data;
  const [projectId, setProjectId] = useState(project0 ? String(project0) : ''); const [orderId, setOrderId] = useState(po0 ? String(po0) : ''); const [f, setF] = useState(null); const [qty, setQty] = useState(null); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  usePageTitle(t('x.newShip'));
  if (editId && eq.isPending) return <Skeleton label={t('x.newShip')} rows={4} />;
  const form = f ?? { transporter: e?.transporter ?? '', vehicleNo: e?.vehicleNo ?? '', lrNo: e?.lrNo ?? '', blNo: e?.blNo ?? '', ewayBillNo: e?.ewayBillNo ?? '', packages: e?.packages ?? 1, packingList: e?.packingList ?? '', eta: e?.eta ?? '', isOdc: e?.isOdc ?? false, odcPermitNo: e?.odcPermitNo ?? '', odcValidTo: e?.odcValidTo ?? '', odcDimensions: e?.odcDimensions ?? '' };
  const q = qty ?? (e ? Object.fromEntries(e.lines.map((l) => [l.poLineId, String(l.qty)])) : {}); const set = (k, v) => setF({ ...form, [k]: v });
  const body = () => ({ transporter: form.transporter || null, vehicleNo: form.vehicleNo || null, lrNo: form.lrNo || null, blNo: form.blNo || null, ewayBillNo: form.ewayBillNo || null, packages: Number(form.packages) || 0, packingList: form.packingList || null, eta: form.eta || null, isOdc: form.isOdc, odcPermitNo: form.odcPermitNo || null, odcValidTo: form.odcValidTo || null, odcDimensions: form.odcDimensions || null, lines: Object.entries(q).filter(([, v]) => Number(v) > 0).map(([k, v]) => ({ poLineId: Number(k), qty: Number(v) })) });
  const save = async () => { setError(null); setBusy(true); try { const d = editId ? await px.shipUpdate(editId, { ...body(), rowVersion: e.rowVersion }) : await px.shipCreate({ poId: Number(orderId), ...body() }); navigateTo(`/proc/shipments?id=${d.id}`); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); } };
  const text = (k, label, max = 60, tid) => <Field label={label} name={k} error={error}><input value={form[k]} maxLength={max} onChange={(ev) => set(k, ev.target.value)} style={{ minHeight: 44 }} data-testid={tid} /></Field>;
  return (
    <section aria-labelledby="shn-h" data-testid="proc-sh-form"><PageHeader id="shn-h" title={editId ? t('x.edit') : t('x.newShip')} subtitle={t('x.newShipHelp')} meta={<Link to="/proc/shipments">{t('x.back')}</Link>} />
      <form className="mdm-panel" onSubmit={(ev) => { ev.preventDefault(); save(); }} noValidate>
        <div className="form-grid">
          {editId ? <p>{e.poNo} · {e.vendor}</p> : <ProjectOrder t={t} projectId={projectId} setProjectId={setProjectId} orderId={orderId} setOrderId={setOrderId} error={error} prefix="shn">{(order) => order && <div className="table-scroll" style={{ gridColumn: '1 / -1' }}><table className="data-table" data-testid="shn-lines"><caption>{t('x.lines')}</caption><thead><tr><th>#</th><th>{t('x.item')}</th><th className="num">{t('x.balance')}</th><th>{t('x.qty')}</th></tr></thead>
            <tbody>{order.lines.map((l) => <tr key={l.id} data-testid="shn-line"><td>{l.lineNo}</td><td>{l.description}</td><td className="num">{fmtQty(l.balance)} {l.uom}</td><td><input type="number" min="0" step="0.001" max={l.balance} value={q[l.id] ?? ''} onChange={(ev) => setQty({ ...q, [l.id]: ev.target.value })} style={{ minHeight: 44, width: 110 }} aria-label={`${l.description} ${t('x.qty')}`} data-testid="shn-qty" /></td></tr>)}</tbody></table></div>}</ProjectOrder>}
          {text('transporter', t('x.transporter'), 120, 'shn-transporter')}{text('vehicleNo', t('x.vehicle'), 30, 'shn-vehicle')}{text('lrNo', t('x.lr'), 60, 'shn-lr')}{text('blNo', t('x.bl'), 60)}{text('ewayBillNo', t('x.eway'), 30, 'shn-eway')}
          <Field label={t('x.packages')} name="packages" error={error}><input type="number" min="0" value={form.packages} onChange={(ev) => set('packages', ev.target.value)} style={{ minHeight: 44 }} /></Field>
          <Field label={t('x.eta')} name="eta" error={error}><input type="date" value={form.eta} onChange={(ev) => set('eta', ev.target.value)} style={{ minHeight: 44 }} data-testid="shn-eta" /></Field></div>
        <label>{t('x.packingList')}<textarea rows={2} value={form.packingList} maxLength={1000} onChange={(ev) => set('packingList', ev.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} /></label>
        <label><input type="checkbox" checked={form.isOdc} onChange={(ev) => set('isOdc', ev.target.checked)} data-testid="shn-odc" /> {t('x.odcCargo')}</label>
        {form.isOdc && <div className="form-grid" data-testid="shn-odc-fields">{text('odcPermitNo', t('x.odcPermit'), 60, 'shn-permit')}<Field label={t('x.validTo')} name="odcValidTo" error={error}><input type="date" value={form.odcValidTo} onChange={(ev) => set('odcValidTo', ev.target.value)} style={{ minHeight: 44 }} data-testid="shn-valid" /></Field>{text('odcDimensions', t('x.dimensions'), 200)}</div>}
        {error?.form && <p className="field-error" role="alert" data-testid="shn-error">{error.form}</p>}
        <div className="actions-row"><button type="submit" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy || (!editId && !orderId)} data-testid="shn-save">{t('x.save')}</button></div></form></section>
  );
}

export default function ShipmentsPage() {
  const t = useT('proc'); usePageTitle(t('x.shipTitle')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession(); const perms = session.data?.permissions ?? [];
  if (sp.get('new') === '1') return <ShipForm key={sp.get('edit') ?? sp.get('po') ?? 'new'} t={t} editId={Number(sp.get('edit')) || null} project0={Number(sp.get('project')) || null} po0={Number(sp.get('po')) || null} />;
  if (id) return <section aria-labelledby="sh-h" data-testid="proc-sh"><Ship key={id} t={t} id={id} /></section>;
  return (
    <section aria-labelledby="shs-h" data-testid="proc-sh"><PageHeader id="shs-h" title={t('x.shipTitle')} subtitle={t('x.shipIntro')} />
      <div className="actions-row no-print">{perms.includes('proc.shipment.create') && <Link to="/proc/shipments?new=1">{t('x.newShip')}</Link>} <Link to="/proc/expediting">{t('x.dashboard')}</Link></div>
      <ListReport listCode="proc.shipments" endpoint="/proc/shipments" exportEndpoint="/ui/lists/proc.shipments/export" title={t('x.shipTitle')} session={session.data} rowHref={(r) => `/proc/shipments?id=${r.id}`} onOpen={(r) => navigateTo(`/proc/shipments?id=${r.id}`)}
        cardFields={['docNo', 'order', 'vendor', 'transporter', 'eta']} statusKey="status" empty={{ title: t('x.shipEmptyTitle'), text: t('x.shipEmptyBody') }} /></section>
  );
}
