import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { fmtDate, rmc, qs } from './api.js';
import { DocBar, ErrorLine, ProjectSite, Status, big, useRecord, useRunner } from './RmcParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Concrete requisitions, the production schedule board and batch records (part 20.02, FR-01 and FR-02): the site engineer asks, the construction manager approves, the plant in-charge schedules on a plant with an approved mix design in force, the operator records each batch.
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10); const stamp = (s) => (s ? s.replace('T', ' ').slice(0, 16) : '—'); const URG = { RED: 'REJECTED', AMBER: 'RETURNED', GREEN: 'APPROVED' };
const GRADES = ['M10', 'M15', 'M20', 'M25', 'M30', 'M35', 'M40', 'M45', 'M50', 'M55', 'M60'];
function ReqForm({ initial, onSave, busy, error }) {
  const t = useT('rmc'); const [v, setV] = useState(initial); const o = useQuery({ queryKey: ['rmc', 'req-options', v.projectId], queryFn: () => rmc.get(`/requisitions/options${qs({ projectId: v.projectId })}`), retry: false, placeholderData: (p) => p });
  if (o.error?.status === 403) return <NoPermission what={t('rq.title')} permission="rmc.requisition.create" />; if (o.isPending) return <Skeleton label={t('rq.title')} rows={3} />; const d = o.data; const fe = error?.fields ?? {};
  const pick = (id) => { const c = d.pourCards.find((x) => String(x.id) === String(id)); setV({ ...v, pourCardId: id, ...(c ? { grade: c.grade, locationId: c.locationId ? String(c.locationId) : v.locationId } : {}) }); };
  return (
    <div className="mdm-panel" data-testid="rmc-req-form"><div className="form-grid">
      {!initial.id && <ProjectSite o={d} v={v} set={setV} error={fe.siteId} />}
      <Field label={t('rq.pourCard')} name="pourCardId" error={fe.pourCardId}><select value={v.pourCardId} onChange={(e) => pick(e.target.value)} style={big} data-testid="rmc-req-pour"><option value="">—</option>{d.pourCards.filter((c) => !v.projectId || String(c.projectId) === String(v.projectId)).map((c) => <option key={c.id} value={c.id}>{c.docNo} {c.element} {c.grade}</option>)}</select></Field>
      <Field label={t('mx.grade')} name="grade" error={fe.grade}><select value={v.grade} onChange={(e) => setV({ ...v, grade: e.target.value })} style={big} data-testid="rmc-req-grade">{GRADES.map((g) => <option key={g} value={g}>{g}</option>)}</select></Field>
      <Field label={t('rq.qty')} name="qty" error={fe.qty}><input type="number" min="0" step="any" inputMode="decimal" value={v.qty} onChange={(e) => setV({ ...v, qty: e.target.value })} style={big} data-testid="rmc-req-qty" /></Field>
      <Field label={t('rq.requiredAt')} name="requiredAt" error={fe.requiredAt}><input type="datetime-local" value={v.requiredAt} onChange={(e) => setV({ ...v, requiredAt: e.target.value })} style={big} data-testid="rmc-req-at" /></Field>
      <Field label={t('rq.location')} name="locationText" error={fe.locationText}><input value={v.locationText} onChange={(e) => setV({ ...v, locationText: e.target.value })} maxLength={200} style={big} data-testid="rmc-req-location" /></Field>
      <label style={{ minHeight: 48 }}><input type="checkbox" checked={v.pumpRequired} onChange={(e) => setV({ ...v, pumpRequired: e.target.checked })} data-testid="rmc-req-pump" /> {t('rq.pump')}</label></div>
      <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy || !v.siteId || !v.qty || !v.requiredAt} onClick={() => onSave({ projectId: Number(v.projectId), siteId: Number(v.siteId), pourCardId: v.pourCardId ? Number(v.pourCardId) : null, grade: v.grade, qty: Number(v.qty), requiredAt: v.requiredAt, pumpRequired: v.pumpRequired, locationText: v.locationText || null })} data-testid="rmc-req-save">{t('save')}</button></div>
    </div>
  );
}
function SchedulePanel({ x, run, busy, error }) {
  const t = useT('rmc'); const o = useQuery({ queryKey: ['rmc', 'schedule-options'], queryFn: () => rmc.get('/production/board'), retry: false }); const [s, setS] = useState({ plantId: '', slotFrom: x.requiredAt, slotTo: x.requiredAt }); const [sup, setSup] = useState('');
  void error; return (
    <div className="mdm-panel no-print" data-testid="rmc-schedule"><h2>{t('rq.schedule')}</h2><div className="form-grid">
      <Field label={t('mx.plant')} name="plantId" error={null}><select value={s.plantId} onChange={(e) => setS({ ...s, plantId: e.target.value })} style={big} data-testid="rmc-sch-plant"><option value="">—</option>{(o.data?.plants ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></Field>
      <Field label={t('rq.slotFrom')} name="slotFrom" error={null}><input type="datetime-local" value={s.slotFrom} onChange={(e) => setS({ ...s, slotFrom: e.target.value })} style={big} data-testid="rmc-sch-from" /></Field>
      <Field label={t('rq.slotTo')} name="slotTo" error={null}><input type="datetime-local" value={s.slotTo} onChange={(e) => setS({ ...s, slotTo: e.target.value })} style={big} data-testid="rmc-sch-to" /></Field></div>
      <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy || !s.plantId} onClick={() => run(() => rmc.post(`/requisitions/${x.id}/schedule`, { plantId: Number(s.plantId), slotFrom: s.slotFrom, slotTo: s.slotTo }), t('rq.scheduled'))} data-testid="rmc-sch-go">{t('rq.scheduleGo')}</button>
        <select value={sup} onChange={(e) => setSup(e.target.value)} style={{ minHeight: 44 }} aria-label={t('rq.supplier')} data-testid="rmc-sch-supplier"><option value="">{t('rq.supplier')}</option>{(o.data?.suppliers ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <button type="button" className="btn" disabled={busy || !sup} onClick={() => run(() => rmc.post(`/requisitions/${x.id}/schedule`, { supplierId: Number(sup), slotFrom: s.slotFrom, slotTo: s.slotTo }), t('rq.scheduled'))} data-testid="rmc-sch-supplier-go">{t('rq.giveSupplier')}</button></div>
    </div>
  );
}
function Requisition({ id }) {
  const t = useT('rmc'); const { q, guard } = useRecord('/requisitions', id, t('rq.title'), 'rmc.requisition.view'); const { error, run, busy, note } = useRunner(); usePageTitle(t('rq.title')); if (guard) return guard; const x = q.data;
  return (
    <div data-testid="rmc-req-object" data-status={x.status} data-prod={x.prodStatus}><PageHeader id="rq-h" title={<>{x.docNo} <Status x={x} /></>} meta={<><Link to="/rmc/requisitions">{t('rq.title')}</Link> · {x.project} · {x.grade} · {x.qty} m3 · {stamp(x.requiredAt)} · {x.pumpRequired ? t('rq.pump') : ''} · <span data-testid="rmc-req-prod">{x.prodLabel}</span></>} />
      <ErrorLine error={error} id="rmc-error" />{note && <p className="mdm-banner" role="status" data-testid="rmc-note">{note}</p>}
      <div className="mdm-panel"><p>{t('rq.pourCard')}: {x.pourCard ?? '—'} · {t('mx.plant')}: {x.plant ?? x.supplier ?? '—'} · {t('rq.mix')}: {x.mix ? `${x.mix.code} v${x.mix.version_no}` : '—'} · {t('rq.slot')}: {stamp(x.slotFrom)} → {stamp(x.slotTo)}</p>
        <p>{t('rq.progress', { sent: x.dispatched, got: x.delivered, left: x.remaining, max: x.allowed })}</p>
        {x.tickets.length > 0 && <div className="table-scroll"><table className="data-table"><caption>{t('tk.title')}</caption><thead><tr><th>{t('tk.ticket')}</th><th>{t('tk.truck')}</th><th className="num">m3</th><th>{t('tk.load')}</th></tr></thead><tbody>{x.tickets.map((k) => <tr key={k.id}><td><Link to={`/rmc/delivery-tickets?id=${k.id}`}>{k.ticketNo}</Link></td><td>{k.truck}</td><td className="num">{k.qty}</td><td>{k.stateLabel}</td></tr>)}</tbody></table></div>}</div>
      {x.can.schedule && <SchedulePanel x={x} run={run} busy={busy} error={error} />}
      {x.can.close && <div className="actions-row no-print"><button type="button" className="btn" disabled={busy} onClick={() => { const r = globalThis.prompt(t('why')); if (r) run(() => rmc.post(`/requisitions/${x.id}/close`, { reason: r }), t('rq.closed')); }} data-testid="rmc-req-close">{t('rq.close')}</button></div>}
      <DocBar kind="/requisitions" x={x} printName={`${x.docNo}.pdf`} />
    </div>
  );
}
const blankReq = { projectId: '', siteId: '', pourCardId: '', grade: 'M25', qty: '', requiredAt: '', locationText: '', pumpRequired: false };
export function RequisitionsPage() {
  const t = useT('rmc'); usePageTitle(t('rq.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession(); const { error, run, busy } = useRunner();
  if (id) return <section aria-labelledby="rq-h"><Requisition id={id} /></section>;
  if (sp.get('new')) return <section aria-labelledby="rqn-h"><PageHeader id="rqn-h" title={t('rq.new')} meta={<Link to="/rmc/requisitions">{t('rq.title')}</Link>} /><ErrorLine error={error} id="rmc-error" /><ReqForm initial={blankReq} busy={busy} error={error} onSave={async (v) => { const r = await run(() => rmc.make('/requisitions', v)); if (r) navigateTo(`/rmc/requisitions?id=${r.id}`); }} /></section>;
  return (
    <section aria-labelledby="rqs-h" data-testid="rmc-requisitions"><PageHeader id="rqs-h" title={t('rq.title')} subtitle={t('rq.intro')} />
      <div className="actions-row no-print"><Link to="/rmc/requisitions?new=1" data-testid="rmc-req-new">{t('rq.new')}</Link> · <Link to="/rmc/production">{t('pb.title')}</Link></div>
      <ListReport listCode="rmc.requisitions" endpoint="/rmc/requisitions" title={t('rq.title')} session={session.data} rowHref={(r) => `/rmc/requisitions?id=${r.id}`} onOpen={(r) => navigateTo(`/rmc/requisitions?id=${r.id}`)} cardFields={['docNo', 'grade', 'qty', 'status']} statusKey="status" empty={{ title: t('rq.emptyTitle'), text: t('rq.emptyBody') }} />
    </section>
  );
}
export function ProductionBoardPage() {
  const t = useT('rmc'); usePageTitle(t('pb.title')); const [date, setDate] = useState(today()); const q = useQuery({ queryKey: ['rmc', 'board', date], queryFn: () => rmc.get(`/production/board${qs({ date })}`), retry: false, refetchInterval: 30_000 });
  if (q.error?.status === 403) return <NoPermission what={t('pb.title')} permission="rmc.requisition.view" />; if (q.isPending) return <Skeleton label={t('pb.title')} rows={4} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />; const d = q.data;
  const col = (key, rows) => (
    <div className="mdm-panel" data-testid={`rmc-board-${key}`} key={key}><h2>{t(`pb.${key}`)} <small>({rows.length})</small></h2>
      {rows.length === 0 ? <p className="muted">{t('pb.none')}</p> : rows.map((c) => (
        <div key={c.id} className="mdm-panel" data-testid="rmc-board-card" data-urgency={c.urgency}><strong><Link to={`/rmc/requisitions?id=${c.id}`}>{c.docNo}</Link></strong> <StatusBadge status={URG[c.urgency]} label={t(`pb.u.${c.urgency}`)} />
          <div>{c.grade} · {c.qty} m3 · {c.project}{c.pumpRequired ? ` · ${t('rq.pump')}` : ''}</div><div className="muted">{stamp(c.requiredAt)}{c.plant ? ` · ${c.plant}` : ''}{c.supplier ? ` · ${c.supplier}` : ''} · {t('rq.progressShort', { got: c.delivered, qty: c.qty })}</div></div>))}
    </div>
  );
  return (
    <section aria-labelledby="pb-h" data-testid="rmc-board"><PageHeader id="pb-h" title={t('pb.title')} subtitle={t('pb.intro')} />
      <div className="form-grid no-print"><Field label={t('esg.date')} name="date" error={null}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={big} data-testid="rmc-board-date" /></Field></div>
      <div className="table-scroll"><table className="data-table" data-testid="rmc-board-load"><caption>{t('pb.load')}</caption><thead><tr><th>{t('mx.plant')}</th><th className="num">{t('pb.scheduled')}</th><th className="num">{t('pb.capacity')}</th><th className="num">%</th></tr></thead><tbody>{d.load.map((p) => <tr key={p.plantId}><td>{p.plant}</td><td className="num">{p.scheduled}</td><td className="num">{p.capacity}</td><td className="num">{p.pct ?? '—'}</td></tr>)}</tbody></table></div>
      <div className="form-grid">{col('pending', d.pending)}{col('scheduled', d.scheduled)}{col('inProgress', d.inProgress)}{col('fulfilled', d.fulfilled)}</div>
    </section>
  );
}
function BatchNew() {
  const t = useT('rmc'); const { error, run, busy } = useRunner(); usePageTitle(t('bt.new')); const o = useQuery({ queryKey: ['rmc', 'batch-options'], queryFn: () => rmc.get('/batches/options'), retry: false }); const [v, setV] = useState({ plantId: '', mixDesignId: '', requisitionId: '', batchTime: '', qty: '', batchRef: '', w: {} });
  const mx = useQuery({ queryKey: ['rmc', 'mix', v.mixDesignId], queryFn: () => rmc.one('/mix-designs', v.mixDesignId), enabled: Boolean(v.mixDesignId), retry: false });
  if (o.error?.status === 403) return <NoPermission what={t('bt.title')} permission="rmc.batch.record" />; if (o.isPending) return <Skeleton label={t('bt.title')} rows={3} />; const d = o.data; const fe = error?.fields ?? {}; const comps = mx.data?.components ?? [];
  const theo = (c) => (v.qty ? Math.round(c.qty * Number(v.qty) * 1000) / 1000 : '');
  const fillTheo = () => setV({ ...v, w: Object.fromEntries(comps.map((c) => [c.component, String(theo(c))])) });
  const save = async () => { const r = await run(() => rmc.make('/batches', { plantId: Number(v.plantId), mixDesignId: Number(v.mixDesignId), requisitionId: v.requisitionId ? Number(v.requisitionId) : null, batchTime: v.batchTime, qty: Number(v.qty), batchRef: v.batchRef || null, weights: comps.map((c) => ({ component: c.component, kg: Number(v.w[c.component] ?? 0) })) }), t('bt.saved')); if (r) navigateTo(`/rmc/batches?id=${r.id}`); };
  return (
    <section aria-labelledby="btn-h" data-testid="rmc-batch-form"><PageHeader id="btn-h" title={t('bt.new')} meta={<Link to="/rmc/batches">{t('bt.title')}</Link>} /><ErrorLine error={error} id="rmc-error" />
      <div className="mdm-panel"><div className="form-grid">
        <Field label={t('mx.plant')} name="plantId" error={fe.plantId}><select value={v.plantId} onChange={(e) => setV({ ...v, plantId: e.target.value, mixDesignId: '', requisitionId: '' })} style={big} data-testid="rmc-batch-plant"><option value="">—</option>{d.plants.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></Field>
        <Field label={t('rq.mix')} name="mixDesignId" error={fe.mixDesignId}><select value={v.mixDesignId} onChange={(e) => setV({ ...v, mixDesignId: e.target.value, w: {} })} style={big} data-testid="rmc-batch-mix"><option value="">—</option>{d.mixes.filter((m) => String(m.plantId) === String(v.plantId)).map((m) => <option key={m.id} value={m.id}>{m.code} v{m.versionNo} {m.grade}</option>)}</select></Field>
        <Field label={t('rq.title')} name="requisitionId" error={fe.requisitionId}><select value={v.requisitionId} onChange={(e) => setV({ ...v, requisitionId: e.target.value })} style={big} data-testid="rmc-batch-req"><option value="">—</option>{d.requisitions.filter((r) => String(r.plantId) === String(v.plantId)).map((r) => <option key={r.id} value={r.id}>{r.docNo} {r.grade} {r.qty} m3</option>)}</select></Field>
        <Field label={t('bt.batchTime')} name="batchTime" error={fe.batchTime}><input type="datetime-local" value={v.batchTime} onChange={(e) => setV({ ...v, batchTime: e.target.value })} style={big} data-testid="rmc-batch-time" /></Field>
        <Field label={t('rq.qty')} name="qty" error={fe.qty}><input type="number" min="0" step="any" value={v.qty} onChange={(e) => setV({ ...v, qty: e.target.value })} style={big} data-testid="rmc-batch-qty" /></Field>
        <Field label={t('bt.ref')} name="batchRef" error={fe.batchRef}><input value={v.batchRef} onChange={(e) => setV({ ...v, batchRef: e.target.value })} maxLength={60} style={big} data-testid="rmc-batch-ref" /></Field></div></div>
      {comps.length > 0 && <div className="mdm-panel"><div className="table-scroll"><table className="data-table" data-testid="rmc-batch-weights"><caption>{t('bt.weights')}</caption><thead><tr><th>{t('mx.material')}</th><th className="num">{t('bt.theoretical')}</th><th className="num">{t('bt.actual')}</th></tr></thead>
        <tbody>{comps.map((c) => <tr key={c.component}><td>{t(`mx.c.${c.component}`)}</td><td className="num">{theo(c) || '—'}</td><td className="num"><input aria-label={`${t(`mx.c.${c.component}`)} ${t('bt.actual')}`} type="number" min="0" step="any" value={v.w[c.component] ?? ''} onChange={(e) => setV({ ...v, w: { ...v.w, [c.component]: e.target.value } })} style={{ minHeight: 44, width: 120 }} data-testid={`rmc-batch-w-${c.component}`} /></td></tr>)}</tbody></table></div>
        <div className="actions-row"><button type="button" className="btn" onClick={fillTheo} disabled={!v.qty} data-testid="rmc-batch-fill">{t('bt.fill')}</button><button type="button" className="btn btn-primary" style={big} disabled={busy || !v.plantId || !v.mixDesignId || !v.qty || !v.batchTime} onClick={save} data-testid="rmc-batch-save">{t('save')}</button></div></div>}
    </section>
  );
}
function Batch({ id }) {
  const t = useT('rmc'); const { q, guard } = useRecord('/batches', id, t('bt.title'), 'rmc.batch.view'); const { error, run, busy, note } = useRunner(); usePageTitle(t('bt.title')); if (guard) return guard; const x = q.data;
  return (
    <div data-testid="rmc-batch-object" data-flagged={x.flagged}><PageHeader id="bt-h" title={<>{x.docNo} {x.status === 'CANCELLED' && <StatusBadge status="CANCELLED" label={t('bt.cancelled')} />}</>} meta={<><Link to="/rmc/batches">{t('bt.title')}</Link> · {x.plant} · {x.mix.code} v{x.mix.version_no} · {x.grade} · {x.qty} m3 · {stamp(x.batchTime)} · {x.requisition ?? '—'}</>} /><ErrorLine error={error} id="rmc-error" />{note && <p className="mdm-banner" role="status">{note}</p>}
      <div className="table-scroll"><table className="data-table" data-testid="rmc-batch-lines"><thead><tr><th>{t('mx.material')}</th><th className="num">{t('bt.theoretical')}</th><th className="num">{t('bt.actual')}</th><th className="num">{t('co.variance')}</th><th className="num">%</th></tr></thead><tbody>{x.lines.map((l) => <tr key={l.component} data-flagged={l.flagged}><td>{t(`mx.c.${l.component}`)}</td><td className="num">{l.theoretical}</td><td className="num">{l.actual}</td><td className="num">{l.variance}</td><td className="num">{l.variancePct} {l.flagged ? '⚠' : ''}</td></tr>)}</tbody></table></div>
      {x.can.cancel && <div className="actions-row no-print"><button type="button" className="btn" disabled={busy} onClick={() => { const r = globalThis.prompt(t('why')); if (r) run(() => rmc.post(`/batches/${x.id}/cancel`, { reason: r }), t('bt.cancelledNote')); }} data-testid="rmc-batch-cancel">{t('cancel')}</button></div>}
    </div>
  );
}
export function BatchesPage() {
  const t = useT('rmc'); usePageTitle(t('bt.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession();
  if (id) return <section aria-labelledby="bt-h"><Batch id={id} /></section>; if (sp.get('new')) return <BatchNew />;
  return (
    <section aria-labelledby="bts-h" data-testid="rmc-batches"><PageHeader id="bts-h" title={t('bt.title')} subtitle={t('bt.intro')} />
      <div className="actions-row no-print"><Link to="/rmc/batches?new=1" data-testid="rmc-batch-new">{t('bt.new')}</Link> · <Link to="/rmc/consumption">{t('co.title')}</Link></div>
      <ListReport listCode="rmc.batches" endpoint="/rmc/batches" title={t('bt.title')} session={session.data} rowHref={(r) => `/rmc/batches?id=${r.id}`} onOpen={(r) => navigateTo(`/rmc/batches?id=${r.id}`)} cardFields={['docNo', 'plant', 'grade', 'qty']} empty={{ title: t('bt.emptyTitle'), text: t('bt.emptyBody') }} />
    </section>
  );
}
export { fmtDate };
