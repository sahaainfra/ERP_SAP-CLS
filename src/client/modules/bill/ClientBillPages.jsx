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

// The client RA bill (part 22.03): Prepare RA Bill (pulls the certified measurements of the period), the Client Bills list and the bill with its abstract, deductions, GST, documents and tracking, and the abstract in the format given to the client.
const nf = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }); const mf = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n = (v) => (v == null ? '—' : nf.format(v)); const money = (v) => (v == null ? '—' : `₹ ${mf.format(v)}`);
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const CLIENT_TONE = { NOT_SENT: 'DRAFT', SENT: 'IN_REVIEW' };
const blank = () => ({ projectId: '', contractId: '', billType: 'RA', periodFrom: `${today().slice(0, 8)}01`, periodTo: today(), supply: 'intra', gstPct: '', manual: [], ldAmount: '', notes: '' });
const payload = (v) => ({ projectId: Number(v.projectId), contractId: Number(v.contractId), billType: v.billType, periodFrom: v.periodFrom, periodTo: v.periodTo, supply: v.supply, gstPct: v.gstPct === '' ? null : Number(v.gstPct), manual: v.manual.map((m) => ({ kind: m.kind, label: m.label || null, amount: Number(m.amount), reason: m.reason })), ldAmount: v.ldAmount === '' ? 0 : Number(v.ldAmount), notes: v.notes || null });
const fromBill = (x) => ({ projectId: String(x.projectId), contractId: String(x.contractId), billType: x.billType, periodFrom: x.periodFrom, periodTo: x.periodTo, supply: x.supply, gstPct: String(x.gstPct), manual: x.manual.map((m) => ({ kind: m.kind, label: m.label ?? '', amount: String(m.amount), reason: m.reason })), ldAmount: x.ldAmount ? String(x.ldAmount) : '', notes: x.notes ?? '' });

export function AbstractTable({ x, testid }) {
  const t = useT('bill');
  return (
    <div className="table-scroll" data-testid={testid}><table className="data-table"><thead><tr><th>{t('cb.sl')}</th><th>{t('rc.item')}</th><th>{t('rc.description')}</th><th>{t('rc.unit')}</th><th className="num">{t('cb.rate')}</th><th className="num">{t('cb.prevQty')}</th><th className="num">{t('cb.thisQty')}</th><th className="num">{t('cb.cumQty')}</th><th className="num">{t('cb.prevAmt')}</th><th className="num">{t('cb.thisAmt')}</th><th className="num">{t('cb.cumAmt')}</th></tr></thead>
      <tbody>{x.items.map((i) => <tr key={i.lineNo} data-testid="bill-cb-item" data-code={i.code} data-kind={i.kind}><td>{i.lineNo}</td><td>{i.code}{i.voNo ? ` (${i.voNo})` : ''}</td><td>{i.description}{i.kind === 'EXTRA' ? ` · ${t('cb.extra')}` : ''}</td><td>{i.uom}</td><td className="num">{money(i.rate)}</td><td className="num">{n(i.prevQty)}</td><td className="num">{n(i.thisQty)}</td><td className="num">{n(i.cumQty)}</td><td className="num">{money(i.prevAmount)}</td><td className="num">{money(i.thisAmount)}</td><td className="num">{money(i.cumAmount)}</td></tr>)}</tbody></table></div>
  );
}
function Summary({ x, testid }) {
  const t = useT('bill'); const row = (k, v, strong) => <tr data-testid={`bill-cb-sum-${k}`}><th scope="row">{t(`cb.s.${k}`)}</th><td className="num">{strong ? <strong>{money(v)}</strong> : money(v)}</td></tr>;
  return (
    <div className="table-scroll" data-testid={testid}><table className="data-table"><tbody>{row('gross', x.gross)}{x.escalation ? row('escalation', x.escalation) : null}{row('taxable', x.taxable)}
      {x.cgst || x.sgst ? <>{row('cgst', x.cgst)}{row('sgst', x.sgst)}</> : row('igst', x.igst ?? x.gst)}{row('gst', x.gst)}{row('deductions', -x.deductionsTotal)}{row('net', x.net, true)}</tbody></table></div>
  );
}
function Deductions({ x }) {
  const t = useT('bill');
  return (
    <div className="table-scroll" data-testid="bill-cb-deductions"><table className="data-table"><thead><tr><th>{t('cb.deduction')}</th><th className="num">{t('cb.basis')}</th><th className="num">%</th><th className="num">{t('cb.amount')}</th><th>{t('cb.working')}</th></tr></thead>
      <tbody>{x.deductions.map((d, i) => <tr key={i} data-testid="bill-cb-deduction" data-kind={d.kind}><td>{t(`dk.${d.kind}`)}{d.label && d.manual ? `: ${d.label}` : ''}</td><td className="num">{d.basis == null ? '—' : money(d.basis)}</td><td className="num">{d.pct ?? '—'}</td><td className="num">{money(d.amount)}</td><td>{d.note}{d.calc ? ` · ${d.calc}` : ''}</td></tr>)}</tbody>
      <tfoot><tr><th colSpan={3}>{t('cb.total')}</th><th className="num" data-testid="bill-cb-deductions-total">{money(x.deductionsTotal)}</th><th /></tr></tfoot></table></div>
  );
}
function Issues({ issues }) {
  const t = useT('bill'); if (!issues?.length) return null;
  return <ul className="mdm-panel" data-testid="bill-cb-issues" role="status">{issues.map((i, k) => <li key={k} data-code={i.code} data-severity={i.severity}>{i.severity === 'WARN' ? '⚠' : 'ℹ'} {i.message}</li>)}<li className="muted">{t('cb.issuesNote')}</li></ul>;
}

function BillForm({ initial, isNew, onSave, busy, error }) {
  const t = useT('bill'); const [v, setV] = useState(initial); const fe = error?.fields ?? {};
  const o = useQuery({ queryKey: ['bill', 'cb-options'], queryFn: () => bill.get('/client-bills/options'), retry: false });
  const ready = v.projectId && v.contractId && v.periodFrom && v.periodTo && v.periodTo >= v.periodFrom && v.manual.every((m) => Number(m.amount) > 0 && m.reason.trim().length >= 3);
  const body = ready ? payload(v) : null; const pvBody = body;
  const pv = useQuery({ queryKey: ['bill', 'cb-preview', JSON.stringify(pvBody)], queryFn: () => bill.post('/client-bills/preview', pvBody), enabled: Boolean(body), retry: false, placeholderData: (p) => p });
  if (o.error?.status === 403) return <NoPermission what={t('cb.prepare')} permission="bill.client_bill.create" />; if (o.isPending) return <Skeleton label={t('cb.prepare')} rows={4} />; if (o.isError) return <ErrorState error={o.error} onRetry={o.refetch} />;
  const d = o.data; const set = (k) => (e) => setV({ ...v, [k]: e.target.value }); const contracts = d.contracts.filter((c) => String(c.projectId) === String(v.projectId)); const setM = (i, patch) => setV({ ...v, manual: v.manual.map((m, j) => (j === i ? { ...m, ...patch } : m)) });
  return (
    <form className="mdm-panel" data-testid="bill-cb-form" onSubmit={(e) => { e.preventDefault(); onSave(v); }}>
      <ErrorLine error={error} id="bill-error" />
      <div className="form-grid">
        {isNew && <><Field label={t('project')} name="projectId" error={fe.projectId}><select value={v.projectId} onChange={(e) => setV({ ...v, projectId: e.target.value, contractId: '' })} style={big} data-testid="bill-cb-project"><option value="">—</option>{d.projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></Field>
          <Field label={t('cb.contract')} name="contractId" error={fe.contractId}><select value={v.contractId} onChange={set('contractId')} style={big} data-testid="bill-cb-contract"><option value="">—</option>{contracts.map((c) => <option key={c.id} value={c.id}>{c.contractNo}</option>)}</select></Field></>}
        <Field label={t('cb.type')} name="billType" error={fe.billType}><select value={v.billType} onChange={set('billType')} style={big} data-testid="bill-cb-type">{d.types.map((x) => <option key={x.id} value={x.id}>{t(`bt.${x.id}`)}</option>)}</select></Field>
        <Field label={t('cb.periodFrom')} name="periodFrom" error={fe.periodFrom}><input type="date" value={v.periodFrom} onChange={set('periodFrom')} style={big} data-testid="bill-cb-from" /></Field>
        <Field label={t('cb.periodTo')} name="periodTo" error={fe.periodTo}><input type="date" value={v.periodTo} onChange={set('periodTo')} style={big} data-testid="bill-cb-to" /></Field>
        <Field label={t('cb.supply')} name="supply" error={fe.supply}><select value={v.supply} onChange={set('supply')} style={big} data-testid="bill-cb-supply"><option value="intra">{t('cb.intra')}</option><option value="inter">{t('cb.inter')}</option></select></Field>
        <Field label={t('cb.gstPct')} name="gstPct" error={fe.gstPct}><input type="number" min="0" max="100" step="any" value={v.gstPct} placeholder={String(d.gstPct)} onChange={set('gstPct')} style={big} data-testid="bill-cb-gst" /></Field>
        <Field label={t('cb.ld')} name="ldAmount" error={fe.ldAmount}><input type="number" min="0" step="any" value={v.ldAmount} onChange={set('ldAmount')} style={big} data-testid="bill-cb-ld" /></Field></div>
      <h2>{t('cb.manual')}</h2><p className="muted">{t('cb.manualNote', { cess: d.cessPct, tds: d.tdsPct, gtds: d.gstTdsPct })}</p>
      {v.manual.map((m, i) => <div className="form-grid" key={i} data-testid="bill-cb-manual-row"><Field label={t('cb.deduction')} name={`k${i}`} error={null}><select value={m.kind} onChange={(e) => setM(i, { kind: e.target.value })} style={big} data-testid="bill-cb-manual-kind">{d.kinds.map((k) => <option key={k.id} value={k.id}>{t(`dk.${k.id}`)}</option>)}</select></Field>
        <Field label={t('cb.amount')} name={`a${i}`} error={fe[`manual.${i}.amount`]}><input type="number" min="0" step="any" value={m.amount} onChange={(e) => setM(i, { amount: e.target.value })} style={big} data-testid="bill-cb-manual-amount" /></Field>
        <Field label={t('ds.reason')} name={`r${i}`} error={fe[`manual.${i}.reason`]}><input value={m.reason} onChange={(e) => setM(i, { reason: e.target.value })} style={big} maxLength={300} data-testid="bill-cb-manual-reason" /></Field>
        <div className="actions-row"><button type="button" className="btn" onClick={() => setV({ ...v, manual: v.manual.filter((_, j) => j !== i) })}>{t('cb.remove')}</button></div></div>)}
      <div className="actions-row"><button type="button" className="btn" onClick={() => setV({ ...v, manual: [...v.manual, { kind: 'OTHER', label: '', amount: '', reason: '' }] })} data-testid="bill-cb-add-manual">{t('cb.addManual')}</button></div>
      <h2>{t('cb.preview')}</h2>
      {!body ? <p className="muted">{t('cb.previewPick')}</p> : pv.isError ? <p className="field-error" role="alert" data-testid="bill-cb-preview-error">{pv.error?.message}</p> : pv.isPending ? <Skeleton label={t('cb.preview')} rows={3} /> : (<div data-testid="bill-cb-preview"><p><strong>{pv.data.billNo}</strong></p><Issues issues={pv.data.issues} /><AbstractTable x={pv.data} testid="bill-cb-preview-items" /><Deductions x={pv.data} /><Summary x={pv.data} testid="bill-cb-preview-summary" /></div>)}
      <Field label={t('ds.notes')} name="notes" error={fe.notes}><input value={v.notes} onChange={set('notes')} style={big} maxLength={2000} data-testid="bill-cb-notes" /></Field>
      <div className="actions-row"><button type="submit" className="btn btn-primary" style={big} disabled={busy || !body || pv.isError} data-testid="bill-cb-save">{isNew ? t('cb.saveDraft') : t('cb.refresh')}</button></div></form>
  );
}

function SendPanel({ x, run, busy }) {
  const t = useT('bill'); const [s, setS] = useState({ sentOn: today(), clientRef: '' });
  if (x.can.send) return (
    <form className="mdm-panel no-print form-grid" data-testid="bill-cb-send-form" onSubmit={(e) => { e.preventDefault(); run(() => bill.post(`/client-bills/${x.id}/send`, { sentOn: s.sentOn, clientRef: s.clientRef || null }), t('cb.sent')); }}>
      <Field label={t('ds.sentOn')} name="sentOn" error={null}><input type="date" value={s.sentOn} onChange={(e) => setS({ ...s, sentOn: e.target.value })} style={big} data-testid="bill-cb-sent-on" /></Field><Field label={t('ds.clientRef')} name="clientRef" error={null}><input value={s.clientRef} onChange={(e) => setS({ ...s, clientRef: e.target.value })} style={big} maxLength={120} data-testid="bill-cb-sent-ref" /></Field>
      <div className="actions-row"><button className="btn btn-primary" style={big} disabled={busy} data-testid="bill-cb-send">{t('cb.send')}</button></div></form>);
  return <p data-testid="bill-cb-tracking">{t(`ccs.${x.clientState}`)}{x.sentOn ? ` · ${fmtDate(x.sentOn)}` : ''}{x.clientRef ? ` · ${x.clientRef}` : ''}</p>;
}

function Bill({ id, edit }) {
  const t = useT('bill'); const { q, guard } = useRecord('/client-bills', id, t('cb.title'), 'bill.client_bill.view'); const { error, run, busy, note } = useRunner(); const [tab, setTab] = useState('abstract'); usePageTitle(t('cb.title'));
  if (guard) return guard; const x = q.data;
  if (edit && x.can.edit) return (<div><PageHeader id="cb-h" title={x.billNo} meta={<Link to={`/bill/client-bills?id=${x.id}`}>{x.billNo}</Link>} /><BillForm initial={fromBill(x)} isNew={false} busy={busy} error={error} onSave={async (v) => { const rest = payload(v); delete rest.projectId; delete rest.contractId; if (await run(() => bill.patch(`/client-bills/${x.id}`, { ...rest, rowVersion: x.version }), t('cb.refreshed'))) navigateTo(`/bill/client-bills?id=${x.id}`); }} /></div>);
  return (
    <div data-testid="bill-cb-object" data-status={x.status} data-client={x.clientState} data-type={x.billType}><PageHeader id="cb-h" title={<>{x.billNo} <Status x={x} /> <StatusBadge status={CLIENT_TONE[x.clientState]} label={t(`ccs.${x.clientState}`)} /></>} meta={<><Link to="/bill/client-bills">{t('cb.title')}</Link> · {x.docNo} · {x.project} · {x.contractNo} · {t(`bt.${x.billType}`)} · {fmtDate(x.periodFrom)} → {fmtDate(x.periodTo)}</>} />
      <KpiRow><KpiTile label={t('cb.s.gross')} value={money(x.gross)} amount={x.gross} kind="money" valueTestid="bill-cb-gross"><div className="muted">{t('cb.cumulative')}: {money(x.cumGross)}</div></KpiTile><KpiTile label={t('cb.s.net')} value={money(x.net)} amount={x.net} kind="money" valueTestid="bill-cb-net" /></KpiRow>
      <ErrorLine error={error} id="bill-error" />{note && <p className="mdm-banner" role="status" data-testid="bill-note">{note}</p>}<Issues issues={x.issues} />
      <div className="actions-row no-print">{x.can.edit && <Link to={`/bill/client-bills?id=${x.id}&edit=1`} data-testid="bill-cb-edit">{t('cb.refreshEdit')}</Link>}<Link to={`/bill/client-bill-abstract?id=${x.id}`} data-testid="bill-cb-abstract-link">{t('cba.title')}</Link></div>
      <div className="actions-row no-print" role="tablist">{['abstract', 'deductions', 'summary', 'documents', 'tracking'].map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`btn${tab === k ? ' btn-primary' : ''}`} onClick={() => setTab(k)} data-testid={`bill-cb-tab-${k}`}>{t(`cb.tab.${k}`)}</button>)}</div>
      {tab === 'abstract' && <AbstractTable x={x} testid="bill-cb-items" />}{tab === 'deductions' && <Deductions x={x} />}{tab === 'summary' && <Summary x={x} testid="bill-cb-summary" />}
      {tab === 'documents' && <div data-testid="bill-cb-documents"><h2>{t('cb.measurements')}</h2>{x.measurements.length === 0 ? <p className="muted">{t('cb.noMeasurements')}</p> : <div className="table-scroll"><table className="data-table"><thead><tr><th>{t('rc.entry')}</th><th>{t('rc.item')}</th><th>{t('rc.description')}</th><th className="num">{t('rc.certified')}</th><th>{t('cb.page')}</th></tr></thead><tbody>{x.measurements.map((m) => <tr key={m.id}><td><Link to={`/bill/mb-entries?id=${m.id}`}>{m.docNo}</Link></td><td>{m.item}</td><td>{m.description}</td><td className="num">{n(m.certified)}</td><td>{m.page ? `${m.book}/${m.page}` : '—'}</td></tr>)}</tbody></table></div>}<p><Link to="/bill/mb-abstract">{t('abs.title')}</Link></p><h2>{t('cb.supporting')}</h2><AttachmentPanel type="bill_client_bills" id={x.id} entity="bill_client_bills" canEdit={x.can.edit || x.can.send} /></div>}
      {tab === 'tracking' && <div data-testid="bill-cb-tab-tracking"><SendPanel x={x} run={run} busy={busy} /></div>}
      <DocBar kind="/client-bills" x={x} printName={`${x.billNo.replaceAll('/', '-')}.pdf`} />
    </div>
  );
}

export function ClientBillsPage() {
  const t = useT('bill'); usePageTitle(t('cb.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession();
  if (id) return <section aria-labelledby="cb-h"><Bill id={id} edit={Boolean(sp.get('edit'))} /></section>;
  return (
    <section aria-labelledby="cbs-h" data-testid="bill-client-bills"><PageHeader id="cbs-h" title={t('cb.title')} subtitle={t('cb.intro')} />
      <div className="actions-row no-print"><Link to="/bill/client-bill-new" data-testid="bill-cb-new">{t('cb.prepare')}</Link> · <Link to="/bill/mb-entries">{t('mb.title')}</Link></div>
      <ListReport listCode="bill.client_bills" endpoint="/bill/client-bills" title={t('cb.title')} session={session.data} rowHref={(r) => `/bill/client-bills?id=${r.id}`} onOpen={(r) => navigateTo(`/bill/client-bills?id=${r.id}`)} cardFields={['billNo', 'project', 'periodTo', 'gross', 'net', 'client', 'status']} statusKey="status" empty={{ title: t('cb.emptyTitle'), text: t('cb.emptyBody') }} />
    </section>
  );
}
export function PrepareBillPage() {
  const t = useT('bill'); usePageTitle(t('cb.prepare')); const { error, run, busy } = useRunner();
  return (<section aria-labelledby="cbn-h" data-testid="bill-cb-prepare"><PageHeader id="cbn-h" title={t('cb.prepare')} subtitle={t('cb.prepareIntro')} meta={<Link to="/bill/client-bills">{t('cb.title')}</Link>} /><BillForm initial={blank()} isNew busy={busy} error={error} onSave={async (v) => { const r = await run(() => bill.post('/client-bills', payload(v))); if (r) navigateTo(`/bill/client-bills?id=${r.id}`); }} /></section>);
}
export function BillAbstractPage() {
  const t = useT('bill'); usePageTitle(t('cba.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const { error, run } = useRunner(); const { q, guard } = useRecord('/client-bills', id, t('cba.title'), 'bill.client_bill.view');
  if (!id) return <section aria-labelledby="cba-h"><PageHeader id="cba-h" title={t('cba.title')} /><div className="empty-state"><h2>{t('cba.pickTitle')}</h2><p>{t('cba.pickBody')}</p><Link to="/bill/client-bills">{t('cb.title')}</Link></div></section>;
  if (guard) return guard; const x = q.data;
  return (
    <section aria-labelledby="cba-h" data-testid="bill-cb-abstract"><PageHeader id="cba-h" title={<>{t('cba.title')} · {x.billNo}</>} meta={<>{x.project} · {x.contractNo} · {t(`bt.${x.billType}`)} · {fmtDate(x.periodFrom)} → {fmtDate(x.periodTo)}</>} /><ErrorLine error={error} id="bill-error" />
      <div className="actions-row no-print"><button type="button" className="btn btn-primary" style={big} onClick={() => run(() => bill.exportFile(`/client-bills/${x.id}/print`, `${x.billNo.replaceAll('/', '-')}.pdf`))} data-testid="bill-cb-pdf">{t('cba.pdf')}</button><button type="button" className="btn" style={big} onClick={() => globalThis.print()} data-testid="bill-cb-print">{t('print')}</button><Link to={`/bill/client-bills?id=${x.id}`}>{x.billNo}</Link></div>
      <AbstractTable x={x} testid="bill-cba-items" /><h2>{t('cb.tab.deductions')}</h2><Deductions x={x} /><h2>{t('cb.tab.summary')}</h2><Summary x={x} testid="bill-cba-summary" />
    </section>
  );
}
