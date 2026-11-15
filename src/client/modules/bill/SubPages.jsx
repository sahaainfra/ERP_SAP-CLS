import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { AttachmentPanel } from '../../platform/object/panels.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { bill, fmtDate } from './api.js';
import { DocBar, ErrorLine, Status, big, useRecord, useRunner } from './BillParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';

// Subcontractor measurement and bills (part 22.05).
const nf = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }); const mf = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n = (v) => (v == null ? '—' : nf.format(v)); const money = (v) => (v == null ? '—' : `₹ ${mf.format(v)}`); const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const MEAS_TONE = { RECORDED: 'DRAFT', SIGNED: 'IN_REVIEW', VERIFIED: 'APPROVED', CANCELLED: 'CANCELLED' };
const DIMS = { QTY: [], NOS: ['nos'], LENGTH: ['nos', 'length'], AREA: ['nos', 'length', 'breadth'], VOLUME: ['nos', 'length', 'breadth', 'depth'] };

function MeasureForm() {
  const t = useT('bill'); const { error, run, busy } = useRunner(); const o = useQuery({ queryKey: ['bill', 'sm-options'], queryFn: () => bill.get('/sub-measurements/options'), retry: false });
  const [v, setV] = useState({ woId: '', woItemId: '', locationId: '', description: '', template: 'QTY', nos: '1', length: '', breadth: '', depth: '', deduction: '0', qty: '', measuredOn: today() });
  if (o.error?.status === 403) return <NoPermission what={t('sm.record')} permission="bill.sub_measure.create" />; if (o.isPending) return <Skeleton label={t('sm.record')} rows={4} />; if (o.isError) return <ErrorState error={o.error} onRetry={o.refetch} />;
  const d = o.data; const fe = error?.fields ?? {}; const set = (k) => (e) => setV({ ...v, [k]: e.target.value }); const wo = d.workOrders.find((x) => String(x.id) === String(v.woId)); const item = wo?.items.find((i) => String(i.id) === String(v.woItemId)); const dims = DIMS[v.template]; const locs = d.locations.filter((l) => !wo || String(l.projectId) === String(wo.projectId));
  const num = (s) => (s === '' ? null : Number(s));
  const body = { woId: Number(v.woId), woItemId: Number(v.woItemId), locationId: v.locationId ? Number(v.locationId) : null, description: v.description, template: v.template, nos: dims.includes('nos') ? num(v.nos) : null, length: dims.includes('length') ? num(v.length) : null, breadth: dims.includes('breadth') ? num(v.breadth) : null, depth: dims.includes('depth') ? num(v.depth) : null, deduction: Number(v.deduction || 0), qty: v.template === 'QTY' ? num(v.qty) : null, measuredOn: v.measuredOn };
  return (
    <form className="mdm-panel" data-testid="bill-sm-form" onSubmit={async (e) => { e.preventDefault(); const r = await run(() => bill.post('/sub-measurements', body)); if (r) navigateTo(`/bill/sub-measure?id=${r.id}`); }}>
      <ErrorLine error={error} id="bill-error" />
      <div className="form-grid"><Field label={t('sm.wo')} name="woId" error={fe.woId}><select value={v.woId} onChange={(e) => setV({ ...v, woId: e.target.value, woItemId: '' })} style={big} data-testid="bill-sm-wo"><option value="">—</option>{d.workOrders.map((w) => <option key={w.id} value={w.id}>{w.woNo} · {w.subcontractor}</option>)}</select></Field>
        <Field label={t('sm.item')} name="woItemId" error={fe.woItemId}><select value={v.woItemId} onChange={set('woItemId')} style={big} data-testid="bill-sm-item"><option value="">—</option>{(wo?.items ?? []).map((i) => <option key={i.id} value={i.id}>{i.lineNo}. {i.description} ({n(i.measured)} / {n(i.ordered)} {i.uom})</option>)}</select></Field>
        <Field label={t('rec.location')} name="locationId" error={fe.locationId}><select value={v.locationId} onChange={set('locationId')} style={big}><option value="">—</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.code} {l.name}</option>)}</select></Field>
        <Field label={t('rec.date')} name="measuredOn" error={fe.measuredOn}><input type="date" value={v.measuredOn} onChange={set('measuredOn')} style={big} /></Field>
        <Field label={t('rec.description')} name="description" error={fe.description}><input value={v.description} onChange={set('description')} style={big} maxLength={500} data-testid="bill-sm-description" /></Field>
        <Field label={t('rec.template')} name="template" error={fe.template}><select value={v.template} onChange={set('template')} style={big} data-testid="bill-sm-template">{d.templates.map((x) => <option key={x.id} value={x.id}>{t(`tpl.${x.id}`)}</option>)}</select></Field>
        {v.template === 'QTY' ? <Field label={t('rec.qty')} name="qty" error={fe.qty}><input type="number" min="0" step="any" value={v.qty} onChange={set('qty')} style={big} data-testid="bill-sm-qty" /></Field> : dims.map((k) => <Field key={k} label={t(`rec.${k}`)} name={k} error={fe[k]}><input type="number" min="0" step="any" value={v[k]} onChange={set(k)} style={big} data-testid={`bill-sm-${k}`} /></Field>)}
        <Field label={t('rec.deduction')} name="deduction" error={fe.deduction}><input type="number" min="0" step="any" value={v.deduction} onChange={set('deduction')} style={big} /></Field></div>
      {item && <p className="muted" data-testid="bill-sm-room">{t('sm.room', { measured: n(item.measured), ordered: n(item.ordered), uom: item.uom ?? '' })}</p>}
      <div className="actions-row"><button type="submit" className="btn btn-primary" style={big} disabled={busy || !v.woId || !v.woItemId || v.description.trim().length < 3} data-testid="bill-sm-save">{t('rec.save')}</button></div></form>
  );
}

function Measurement({ id }) {
  const t = useT('bill'); const { q, guard } = useRecord('/sub-measurements', id, t('sm.title'), 'bill.sub_measure.view'); const { error, run, busy, note } = useRunner(); const [sg, setSg] = useState({ signer: '', signedOn: today(), signatureRef: '', method: 'MANUAL' }); usePageTitle(t('sm.title'));
  if (guard) return guard; const x = q.data; const row = (k, val) => <tr><th scope="row">{t(k)}</th><td>{val}</td></tr>;
  return (
    <div data-testid="bill-sm-object" data-state={x.state}><PageHeader id="sm-h" title={<>{x.docNo} <StatusBadge status={MEAS_TONE[x.state]} label={t(`sm.s.${x.state}`)} /></>} meta={<><Link to="/bill/sub-measure">{t('sm.title')}</Link> · {x.project} · {x.woNo} · {x.subcontractor} · {x.lineNo}. {x.item}</>} />
      <div className="mdm-panel"><div className="muted">{t('mb.measured')}</div><strong style={{ fontSize: '1.3rem' }} data-testid="bill-sm-qty-value">{n(x.qty)} {x.uom}</strong> <span className="muted">({t('sm.ordered', { qty: n(x.ordered) })})</span></div>
      <ErrorLine error={error} id="bill-error" />{note && <p className="mdm-banner" role="status" data-testid="bill-note">{note}</p>}
      <div className="table-scroll"><table className="data-table"><tbody>{row('rec.description', x.description)}{row('rec.template', t(`tpl.${x.template}`))}{x.nos != null && row('rec.nos', n(x.nos))}{x.length != null && row('rec.length', n(x.length))}{x.breadth != null && row('rec.breadth', n(x.breadth))}{x.depth != null && row('rec.depth', n(x.depth))}{row('mb.measuredBy', `${x.measuredBy} · ${fmtDate(x.measuredOn)}`)}{x.subSigner && row('sm.signedBy', `${x.subSigner} · ${fmtDate(x.subSignedOn)} · ${x.signMethod}${x.signatureRef ? ` · ${x.signatureRef}` : ''}`)}{x.verifiedBy && row('sm.verifiedBy', `${x.verifiedBy} · ${fmtDate(x.verifiedOn)}`)}</tbody></table></div>
      {x.can.sign && <form className="mdm-panel form-grid no-print" data-testid="bill-sm-sign-form" onSubmit={(e) => { e.preventDefault(); run(() => bill.post(`/sub-measurements/${x.id}/sign`, { signer: sg.signer, signedOn: sg.signedOn, signatureRef: sg.signatureRef || null, method: sg.method }), t('sm.signed')); }}>
        <Field label={t('sm.signer')} name="signer" error={null}><input value={sg.signer} onChange={(e) => setSg({ ...sg, signer: e.target.value })} style={big} maxLength={120} data-testid="bill-sm-signer" /></Field><Field label={t('chk.signature')} name="signatureRef" error={null}><input value={sg.signatureRef} onChange={(e) => setSg({ ...sg, signatureRef: e.target.value })} style={big} maxLength={160} data-testid="bill-sm-sigref" /></Field>
        <Field label={t('sm.method')} name="method" error={null}><select value={sg.method} onChange={(e) => setSg({ ...sg, method: e.target.value })} style={big}>{['MANUAL', 'OTP', 'PORTAL'].map((m) => <option key={m} value={m}>{t(`sm.m.${m}`)}</option>)}</select></Field>
        <div className="actions-row"><button className="btn btn-primary" style={big} disabled={busy || sg.signer.trim().length < 2} data-testid="bill-sm-sign">{t('sm.sign')}</button></div></form>}
      <div className="actions-row no-print">{x.can.verify && <button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => bill.post(`/sub-measurements/${x.id}/verify`), t('sm.verified'))} data-testid="bill-sm-verify">{t('sm.verify')}</button>}{x.can.cancel && <button type="button" className="btn" disabled={busy} onClick={() => { const r = globalThis.prompt(t('why')); if (r) run(() => bill.post(`/sub-measurements/${x.id}/cancel`, { reason: r }), t('cancelled')); }} data-testid="bill-sm-cancel">{t('cancel')}</button>}</div>
      <AttachmentPanel type="bill_sub_measurements" id={x.id} entity="bill_sub_measurements" canEdit={x.can.edit} />
    </div>
  );
}

export function SubMeasurePage() {
  const t = useT('bill'); usePageTitle(t('sm.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession();
  if (id) return <section aria-labelledby="sm-h"><Measurement id={id} /></section>;
  if (sp.get('new')) return <section aria-labelledby="smn-h"><PageHeader id="smn-h" title={t('sm.record')} meta={<Link to="/bill/sub-measure">{t('sm.title')}</Link>} /><MeasureForm /></section>;
  return (
    <section aria-labelledby="sms-h" data-testid="bill-sub-measure"><PageHeader id="sms-h" title={t('sm.title')} subtitle={t('sm.intro')} />
      <div className="actions-row no-print"><Link to="/bill/sub-measure?new=1" data-testid="bill-sm-new">{t('sm.record')}</Link> · <Link to="/bill/sub-bills">{t('sb.title')}</Link></div>
      <ListReport listCode="bill.sub_measurements" endpoint="/bill/sub-measurements" title={t('sm.title')} session={session.data} rowHref={(r) => `/bill/sub-measure?id=${r.id}`} onOpen={(r) => navigateTo(`/bill/sub-measure?id=${r.id}`)} cardFields={['docNo', 'wo', 'subcontractor', 'qty', 'state']} statusKey="state" empty={{ title: t('sm.emptyTitle'), text: t('sm.emptyBody') }} />
    </section>
  );
}

function Deds({ x }) {
  const t = useT('bill');
  return (
    <div className="table-scroll" data-testid="bill-sb-deductions"><table className="data-table"><thead><tr><th>{t('cb.deduction')}</th><th className="num">%</th><th className="num">{t('cb.amount')}</th><th>{t('sb.source')}</th></tr></thead>
      <tbody>{x.deductions.map((d, i) => <tr key={i} data-testid="bill-sb-deduction" data-kind={d.kind}><td>{t(`sd.${d.kind}`)}{d.manual && d.label ? `: ${d.label}` : ''}</td><td className="num">{d.pct ?? '—'}</td><td className="num">{money(d.amount)}</td><td>{d.note}{d.calc ? ` · ${d.calc}` : ''}</td></tr>)}</tbody>
      <tfoot><tr><th colSpan={2}>{t('cb.total')}</th><th className="num" data-testid="bill-sb-ded-total">{money(x.deductionsTotal)}</th><th /></tr></tfoot></table></div>
  );
}
function ItemsTable({ x, testid }) {
  const t = useT('bill');
  return (
    <div className="table-scroll" data-testid={testid}><table className="data-table"><thead><tr><th>{t('cb.sl')}</th><th>{t('rc.description')}</th><th>{t('rc.unit')}</th><th className="num">{t('cb.rate')}</th><th className="num">{t('cb.prevQty')}</th><th className="num">{t('cb.thisQty')}</th><th className="num">{t('cb.cumQty')}</th><th className="num">{t('cb.thisAmt')}</th><th className="num">{t('cb.cumAmt')}</th></tr></thead>
      <tbody>{x.items.map((i) => <tr key={i.lineNo} data-testid="bill-sb-item"><td>{i.woLineNo}</td><td>{i.description}</td><td>{i.uom}</td><td className="num">{money(i.rate)}</td><td className="num">{n(i.prevQty)}</td><td className="num">{n(i.thisQty)}</td><td className="num">{n(i.cumQty)}</td><td className="num">{money(i.thisAmount)}</td><td className="num">{money(i.cumAmount)}</td></tr>)}</tbody></table></div>
  );
}
function Issues({ issues, complianceOk, reasons }) {
  const t = useT('bill'); if (!issues?.length && complianceOk) return null;
  return (<div className="mdm-panel" data-testid="bill-sb-issues" role="status">{!complianceOk && <p data-testid="bill-sb-hold">⛔ {t('sb.hold')}: {reasons.join('; ')}</p>}{issues?.filter((i) => i.code !== 'COMPLIANCE_HOLD').length > 0 && <ul>{issues.filter((i) => i.code !== 'COMPLIANCE_HOLD').map((i, k) => <li key={k} data-code={i.code}>⚠ {i.message}</li>)}</ul>}</div>);
}

function SubBill({ id }) {
  const t = useT('bill'); const { q, guard } = useRecord('/sub-bills', id, t('sb.title'), 'bill.sub_bill.view'); const { error, note } = useRunner(); const [tab, setTab] = useState('items'); usePageTitle(t('sb.title'));
  if (guard) return guard; const x = q.data; const r = (k, v, s) => <tr><th scope="row">{t(`sb.s.${k}`)}</th><td className="num">{s ? <strong>{money(v)}</strong> : money(v)}</td></tr>;
  return (
    <div data-testid="bill-sb-object" data-status={x.status} data-compliance={x.complianceOk ? 'OK' : 'HOLD'}><PageHeader id="sb-h" title={<>{x.billNo} <Status x={x} /> <StatusBadge status={x.complianceOk ? 'APPROVED' : 'REJECTED'} label={x.complianceOk ? t('sb.complianceOk') : t('sb.complianceHold')} /></>} meta={<><Link to="/bill/sub-bills">{t('sb.title')}</Link> · {x.docNo} · {x.project} · {x.woNo} · {x.subcontractor} · {fmtDate(x.periodFrom)} → {fmtDate(x.periodTo)}</>} />
      <KpiRow><KpiTile label={t('cb.s.gross')} value={money(x.gross)} amount={x.gross} kind="money" valueTestid="bill-sb-gross"><div className="muted">{t('cb.cumulative')}: {money(x.cumGross)}</div></KpiTile><KpiTile label={t('cb.s.net')} value={money(x.net)} amount={x.net} kind="money" valueTestid="bill-sb-net"><div className="muted">{t('ce.due')}: {fmtDate(x.dueDate)}</div></KpiTile></KpiRow>
      <ErrorLine error={error} id="bill-error" />{note && <p className="mdm-banner" role="status">{note}</p>}<Issues issues={x.issues} complianceOk={x.complianceOk} reasons={x.complianceReasons} />
      <div className="actions-row no-print" role="tablist">{['items', 'deductions', 'summary', 'measurements', 'documents'].map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`btn${tab === k ? ' btn-primary' : ''}`} onClick={() => setTab(k)} data-testid={`bill-sb-tab-${k}`}>{t(`sb.tab.${k}`)}</button>)}</div>
      {tab === 'items' && <ItemsTable x={x} testid="bill-sb-items" />}{tab === 'deductions' && <Deds x={x} />}
      {tab === 'summary' && <div className="table-scroll" data-testid="bill-sb-summary"><table className="data-table"><tbody>{r('gross', x.gross)}{x.gst ? r('gst', x.gst) : null}{r('deductions', -x.deductionsTotal)}{r('net', x.net, true)}{x.rcm ? <tr><th scope="row">{t('sb.s.rcm')}</th><td className="num">{money(x.rcm)}</td></tr> : null}<tr><th scope="row">{t('sb.s.payable')}</th><td>{t(`sb.p.${x.payableState}`)}{x.payableRef ? ` · ${x.payableRef}` : ''}</td></tr></tbody></table></div>}
      {tab === 'measurements' && <div className="table-scroll" data-testid="bill-sb-measurements"><table className="data-table"><thead><tr><th>{t('rc.entry')}</th><th>{t('rc.description')}</th><th className="num">{t('mb.measured')}</th><th>{t('sm.signedBy')}</th></tr></thead><tbody>{x.measurements.map((m) => <tr key={m.id}><td><Link to={`/bill/sub-measure?id=${m.id}`}>{m.docNo}</Link></td><td>{m.description}</td><td className="num">{n(m.qty)}</td><td>{m.signer} {m.signedOn ? `(${fmtDate(m.signedOn)})` : ''}</td></tr>)}</tbody></table></div>}
      {tab === 'documents' && <AttachmentPanel type="bill_sub_bills" id={x.id} entity="bill_sub_bills" canEdit={x.can.edit} />}
      <DocBar kind="/sub-bills" x={x} printName={`${x.billNo.replaceAll('/', '-')}.pdf`} />
    </div>
  );
}

function SubBillForm({ initial, isNew, onSave, busy, error }) {
  const t = useT('bill'); const [v, setV] = useState(initial); const fe = error?.fields ?? {}; const o = useQuery({ queryKey: ['bill', 'sb-options'], queryFn: () => bill.get('/sub-bills/options'), retry: false });
  const ready = v.woId && v.periodFrom && v.periodTo && v.periodTo >= v.periodFrom && v.manual.every((m) => Number(m.amount) > 0 && m.reason.trim().length >= 3);
  const body = ready ? { woId: Number(v.woId), billType: v.billType, periodFrom: v.periodFrom, periodTo: v.periodTo, manual: v.manual.map((m) => ({ kind: 'OTHER', label: m.label || null, amount: Number(m.amount), reason: m.reason })), notes: v.notes || null } : null;
  const pv = useQuery({ queryKey: ['bill', 'sb-preview', JSON.stringify(body)], queryFn: () => bill.post('/sub-bills/preview', body), enabled: Boolean(body), retry: false, placeholderData: (p) => p });
  if (o.error?.status === 403) return <NoPermission what={t('sb.prepare')} permission="bill.sub_bill.create" />; if (o.isPending) return <Skeleton label={t('sb.prepare')} rows={4} />; if (o.isError) return <ErrorState error={o.error} onRetry={o.refetch} />;
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value }); const setM = (i, p) => setV({ ...v, manual: v.manual.map((m, j) => (j === i ? { ...m, ...p } : m)) });
  return (
    <form className="mdm-panel" data-testid="bill-sb-form" onSubmit={(e) => { e.preventDefault(); onSave(body); }}>
      <ErrorLine error={error} id="bill-error" />
      <div className="form-grid">{isNew && <Field label={t('sm.wo')} name="woId" error={fe.woId}><select value={v.woId} onChange={set('woId')} style={big} data-testid="bill-sb-wo"><option value="">—</option>{o.data.workOrders.map((w) => <option key={w.id} value={w.id}>{w.woNo} · {w.subcontractor}</option>)}</select></Field>}
        <Field label={t('cb.type')} name="billType" error={fe.billType}><select value={v.billType} onChange={set('billType')} style={big} data-testid="bill-sb-type">{o.data.types.map((x) => <option key={x} value={x}>{t(`bt.${x}`)}</option>)}</select></Field>
        <Field label={t('cb.periodFrom')} name="periodFrom" error={fe.periodFrom}><input type="date" value={v.periodFrom} onChange={set('periodFrom')} style={big} data-testid="bill-sb-from" /></Field><Field label={t('cb.periodTo')} name="periodTo" error={fe.periodTo}><input type="date" value={v.periodTo} onChange={set('periodTo')} style={big} data-testid="bill-sb-to" /></Field></div>
      <h2>{t('cb.manual')}</h2><p className="muted">{t('sb.manualNote', { cess: o.data.cessPct })}</p>
      {v.manual.map((m, i) => <div className="form-grid" key={i} data-testid="bill-sb-manual-row"><Field label={t('rc.description')} name={`l${i}`} error={null}><input value={m.label} onChange={(e) => setM(i, { label: e.target.value })} style={big} maxLength={120} data-testid="bill-sb-manual-label" /></Field><Field label={t('cb.amount')} name={`a${i}`} error={fe[`manual.${i}.amount`]}><input type="number" min="0" step="any" value={m.amount} onChange={(e) => setM(i, { amount: e.target.value })} style={big} data-testid="bill-sb-manual-amount" /></Field><Field label={t('ds.reason')} name={`r${i}`} error={fe[`manual.${i}.reason`]}><input value={m.reason} onChange={(e) => setM(i, { reason: e.target.value })} style={big} maxLength={300} data-testid="bill-sb-manual-reason" /></Field><div className="actions-row"><button type="button" className="btn" onClick={() => setV({ ...v, manual: v.manual.filter((_, j) => j !== i) })}>{t('cb.remove')}</button></div></div>)}
      <div className="actions-row"><button type="button" className="btn" onClick={() => setV({ ...v, manual: [...v.manual, { label: '', amount: '', reason: '' }] })} data-testid="bill-sb-add-manual">{t('cb.addManual')}</button></div>
      <h2>{t('cb.preview')}</h2>{!body ? <p className="muted">{t('sb.previewPick')}</p> : pv.isError ? <p className="field-error" role="alert" data-testid="bill-sb-preview-error">{pv.error?.message}</p> : pv.isPending ? <Skeleton label={t('cb.preview')} rows={3} /> : (<div data-testid="bill-sb-preview"><p><strong>{pv.data.billNo}</strong></p><Issues issues={pv.data.issues} complianceOk={pv.data.complianceOk} reasons={pv.data.complianceReasons} /><ItemsTable x={pv.data} testid="bill-sb-preview-items" /><Deds x={pv.data} /><p><strong data-testid="bill-sb-preview-net">{t('cb.s.net')}: {money(pv.data.net)}</strong></p></div>)}
      <div className="actions-row"><button type="submit" className="btn btn-primary" style={big} disabled={busy || !body || pv.isError} data-testid="bill-sb-save">{isNew ? t('cb.saveDraft') : t('cb.refresh')}</button></div></form>
  );
}

export function SubBillsPage() {
  const t = useT('bill'); usePageTitle(t('sb.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession();
  if (id) return <section aria-labelledby="sb-h"><SubBill id={id} /></section>;
  return (
    <section aria-labelledby="sbs-h" data-testid="bill-sub-bills"><PageHeader id="sbs-h" title={t('sb.title')} subtitle={t('sb.intro')} />
      <div className="actions-row no-print"><Link to="/bill/sub-bill-new" data-testid="bill-sb-new">{t('sb.prepare')}</Link> · <Link to="/bill/sub-measure">{t('sm.title')}</Link></div>
      <ListReport listCode="bill.sub_bills" endpoint="/bill/sub-bills" title={t('sb.title')} session={session.data} rowHref={(r) => `/bill/sub-bills?id=${r.id}`} onOpen={(r) => navigateTo(`/bill/sub-bills?id=${r.id}`)} cardFields={['billNo', 'subcontractor', 'periodTo', 'gross', 'net', 'status']} statusKey="status" empty={{ title: t('sb.emptyTitle'), text: t('sb.emptyBody') }} />
    </section>
  );
}
export function PrepareSubBillPage() {
  const t = useT('bill'); usePageTitle(t('sb.prepare')); const { error, run, busy } = useRunner();
  return (<section aria-labelledby="sbn-h" data-testid="bill-sb-prepare"><PageHeader id="sbn-h" title={t('sb.prepare')} subtitle={t('sb.prepareIntro')} meta={<Link to="/bill/sub-bills">{t('sb.title')}</Link>} /><SubBillForm initial={{ woId: '', billType: 'RA', periodFrom: `${today().slice(0, 8)}01`, periodTo: today(), manual: [], notes: '' }} isNew busy={busy} error={error} onSave={async (body) => { const r = await run(() => bill.post('/sub-bills', body)); if (r) navigateTo(`/bill/sub-bills?id=${r.id}`); }} /></section>);
}
