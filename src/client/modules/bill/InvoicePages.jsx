import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { AttachmentPanel } from '../../platform/object/panels.jsx';
import { NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { bill, fmtDate } from './api.js';
import { DocBar, ErrorLine, Status, big, useRecord, useRunner } from './BillParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';

// The GST tax invoice (part 22.04): made on the certification, approved by the accounts manager, numbered without a gap, with the status of its IRN and of the receivable.
const mf = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); const money = (v) => (v == null ? '—' : `₹ ${mf.format(v)}`); const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const IRN_TONE = { NONE: 'DRAFT', PENDING: 'IN_REVIEW', GENERATED: 'APPROVED', FAILED: 'REJECTED' }; const AR_TONE = { NOT_HANDED: 'DRAFT', HANDED: 'IN_REVIEW', LINKED: 'APPROVED' };

function InvoiceForm({ certId }) {
  const t = useT('bill'); const { error, run, busy } = useRunner(); const o = useQuery({ queryKey: ['bill', 'ti-options'], queryFn: () => bill.get('/tax-invoices/options'), retry: false });
  const [v, setV] = useState({ source: certId ?? '', gstinFrom: '', gstinTo: '', sacCode: '', description: '' });
  const src = o.data?.sources.find((s) => String(s.id) === String(v.source)); const basis = o.data?.basis;
  const body = src && v.gstinFrom && v.gstinTo.length === 15 ? { certificationId: basis === 'CERTIFICATION' ? src.id : null, billId: basis === 'CERTIFICATION' ? null : src.billId, gstinFrom: v.gstinFrom, gstinTo: v.gstinTo, sacCode: v.sacCode || null, description: v.description || null } : null;
  const pv = useQuery({ queryKey: ['bill', 'ti-preview', JSON.stringify(body)], queryFn: () => bill.post('/tax-invoices/preview', body), enabled: Boolean(body), retry: false, placeholderData: (p) => p });
  if (o.error?.status === 403) return <NoPermission what={t('ti.make')} permission="bill.tax_invoice.create" />; if (o.isPending) return <Skeleton label={t('ti.make')} rows={3} />; const fe = error?.fields ?? {}; const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  return (
    <form className="mdm-panel" data-testid="bill-ti-form" onSubmit={async (e) => { e.preventDefault(); const r = await run(() => bill.post('/tax-invoices', { ...body, siteId: null })); if (r) navigateTo(`/bill/tax-invoices?id=${r.id}`); }}>
      <ErrorLine error={error} id="bill-error" />
      <div className="form-grid"><Field label={basis === 'CERTIFICATION' ? t('ti.certification') : t('ce.bill')} name="certificationId" error={fe.certificationId ?? fe.billId}><select value={v.source} onChange={set('source')} style={big} data-testid="bill-ti-source"><option value="">—</option>{o.data.sources.map((s) => <option key={`${s.id}-${s.billId}`} value={s.id}>{s.ref} · {money(s.taxable)}</option>)}</select></Field>
        <Field label={t('ti.gstinFrom')} name="gstinFrom" error={fe.gstinFrom}><select value={v.gstinFrom} onChange={set('gstinFrom')} style={big} data-testid="bill-ti-from"><option value="">—</option>{o.data.ownGstins.map((g) => <option key={g.gstin} value={g.gstin}>{g.gstin}{g.name ? ` · ${g.name}` : ''}</option>)}</select></Field>
        <Field label={t('ti.gstinTo')} name="gstinTo" error={fe.gstinTo}>{src?.clientGstins.length ? <select value={v.gstinTo} onChange={set('gstinTo')} style={big} data-testid="bill-ti-to"><option value="">—</option>{src.clientGstins.map((g) => <option key={g} value={g}>{g}</option>)}</select> : <input value={v.gstinTo} onChange={(e) => setV({ ...v, gstinTo: e.target.value.toUpperCase() })} style={big} maxLength={15} data-testid="bill-ti-to" />}</Field>
        <Field label={t('ti.sac')} name="sacCode" error={fe.sacCode}><input value={v.sacCode} placeholder={o.data.sac} onChange={set('sacCode')} style={big} maxLength={10} data-testid="bill-ti-sac" /></Field>
        <Field label={t('rc.description')} name="description" error={fe.description}><input value={v.description} onChange={set('description')} style={big} maxLength={300} /></Field></div>
      <h2>{t('cb.preview')}</h2>{!body ? <p className="muted">{t('ti.previewPick')}</p> : pv.isError ? <p className="field-error" role="alert" data-testid="bill-ti-preview-error">{pv.error?.message}</p> : pv.isPending ? <Skeleton label={t('cb.preview')} rows={2} /> : (
        <div className="table-scroll" data-testid="bill-ti-preview"><table className="data-table"><tbody><tr><th scope="row">{t('ti.place')}</th><td>{pv.data.placeState} · {t(pv.data.supply === 'intra' ? 'cb.intra' : 'cb.inter')}</td></tr><tr><th scope="row">{t('ti.taxable')}</th><td className="num">{money(pv.data.taxable)}</td></tr>{pv.data.supply === 'intra' ? <><tr><th scope="row">{t('cb.s.cgst')}</th><td className="num">{money(pv.data.cgst)}</td></tr><tr><th scope="row">{t('cb.s.sgst')}</th><td className="num">{money(pv.data.sgst)}</td></tr></> : <tr><th scope="row">{t('cb.s.igst')}</th><td className="num">{money(pv.data.igst)}</td></tr>}<tr><th scope="row">{t('ti.total')}</th><td className="num"><strong data-testid="bill-ti-preview-total">{money(pv.data.total)}</strong></td></tr><tr><th scope="row">{t('ce.due')}</th><td>{fmtDate(pv.data.dueDate)}</td></tr></tbody></table></div>)}
      <div className="actions-row"><button className="btn btn-primary" style={big} disabled={busy || !body || pv.isError} data-testid="bill-ti-save">{t('cb.saveDraft')}</button></div></form>
  );
}

function IrnPanel({ x, run, busy }) {
  const t = useT('bill'); const [f, setF] = useState({ irn: '', ackNo: '', ackDate: today() });
  return (
    <div className="mdm-panel" data-testid="bill-ti-irn"><h2>{t('ti.irn')}</h2><p><StatusBadge status={IRN_TONE[x.irnState]} label={t(`irn.${x.irnState}`)} /> {x.irn ? <code data-testid="bill-ti-irn-value">{x.irn}</code> : null}{x.ackNo ? ` · ${t('ti.ack')} ${x.ackNo} (${fmtDate(x.ackDate)})` : ''}</p>
      {x.can.irn && <form className="form-grid no-print" data-testid="bill-ti-irn-form" onSubmit={(e) => { e.preventDefault(); run(() => bill.post(`/tax-invoices/${x.id}/irn`, f), t('ti.irnDone')); }}>
        <Field label={t('ti.irn')} name="irn" error={null}><input value={f.irn} onChange={(e) => setF({ ...f, irn: e.target.value })} style={big} maxLength={64} data-testid="bill-ti-irn-input" /></Field><Field label={t('ti.ack')} name="ackNo" error={null}><input value={f.ackNo} onChange={(e) => setF({ ...f, ackNo: e.target.value })} style={big} maxLength={40} data-testid="bill-ti-ack-input" /></Field><Field label={t('ti.ackDate')} name="ackDate" error={null}><input type="date" value={f.ackDate} onChange={(e) => setF({ ...f, ackDate: e.target.value })} style={big} /></Field>
        <div className="actions-row"><button className="btn btn-primary" style={big} disabled={busy || f.irn.length !== 64} data-testid="bill-ti-irn-save">{t('ti.recordIrn')}</button></div></form>}</div>
  );
}

function Invoice({ id }) {
  const t = useT('bill'); const { q, guard } = useRecord('/tax-invoices', id, t('ti.title'), 'bill.tax_invoice.view'); const { error, run, busy, note } = useRunner(); const [tab, setTab] = useState('invoice'); usePageTitle(t('ti.title'));
  if (guard) return guard; const x = q.data; const row = (k, val) => <tr><th scope="row">{t(k)}</th><td>{val}</td></tr>;
  return (
    <div data-testid="bill-ti-object" data-status={x.status} data-irn={x.irnState} data-ar={x.arState}><PageHeader id="ti-h" title={<>{x.invoiceNo ?? x.docNo} <Status x={x} /> <StatusBadge status={AR_TONE[x.arState]} label={t(`ar.${x.arState}`)} /></>} meta={<><Link to="/bill/tax-invoices">{t('ti.title')}</Link> · {x.project} · <Link to={`/bill/client-bills?id=${x.billId}`}>{x.billNo}</Link>{x.certNo ? <> · <Link to={`/bill/certifications?id=${x.certificationId}`}>{x.certNo}</Link></> : null}</>} />
      <KpiRow><KpiTile label={t('ti.taxable')} value={money(x.taxable)} amount={x.taxable} kind="money" valueTestid="bill-ti-taxable" /><KpiTile label={t('ti.total')} value={money(x.total)} amount={x.total} kind="money" valueTestid="bill-ti-total" /></KpiRow>
      <ErrorLine error={error} id="bill-error" />{note && <p className="mdm-banner" role="status" data-testid="bill-note">{note}</p>}<IrnPanel x={x} run={run} busy={busy} />
      <div className="actions-row no-print" role="tablist">{['invoice', 'documents'].map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`btn${tab === k ? ' btn-primary' : ''}`} onClick={() => setTab(k)} data-testid={`bill-ti-tab-${k}`}>{t(`ti.tab.${k}`)}</button>)}</div>
      {tab === 'invoice' && <div className="table-scroll" data-testid="bill-ti-details"><table className="data-table"><tbody>{row('ti.number', x.invoiceNo ?? t('ti.notIssued'))}{x.invoiceDate && row('ti.date', fmtDate(x.invoiceDate))}{row('ti.gstinFrom', x.gstinFrom)}{row('ti.gstinTo', x.gstinTo)}{row('ti.place', `${x.placeState} · ${t(x.supply === 'intra' ? 'cb.intra' : 'cb.inter')}`)}{row('ti.sac', x.sacCode)}{row('rc.description', x.description)}{x.supply === 'intra' ? <>{row('cb.s.cgst', money(x.cgst))}{row('cb.s.sgst', money(x.sgst))}</> : row('cb.s.igst', money(x.igst))}{row('ce.due', fmtDate(x.dueDate))}{row('ti.receivable', `${t(`ar.${x.arState}`)}${x.arRef ? ` · ${x.arRef}` : ''}`)}</tbody></table></div>}
      {tab === 'documents' && <AttachmentPanel type="bill_tax_invoices" id={x.id} entity="bill_tax_invoices" canEdit={x.can.edit} />}
      <DocBar kind="/tax-invoices" x={x} printName={`${(x.invoiceNo ?? x.docNo).replaceAll('/', '-')}.pdf`} />
    </div>
  );
}

export function TaxInvoicesPage() {
  const t = useT('bill'); usePageTitle(t('ti.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession();
  if (id) return <section aria-labelledby="ti-h"><Invoice id={id} /></section>;
  if (sp.get('new')) return <section aria-labelledby="tin-h"><PageHeader id="tin-h" title={t('ti.make')} meta={<Link to="/bill/tax-invoices">{t('ti.title')}</Link>} /><InvoiceForm certId={sp.get('certId')} /></section>;
  return (
    <section aria-labelledby="tis-h" data-testid="bill-tax-invoices"><PageHeader id="tis-h" title={t('ti.title')} subtitle={t('ti.intro')} />
      <div className="actions-row no-print"><Link to="/bill/tax-invoices?new=1" data-testid="bill-ti-new">{t('ti.make')}</Link> · <Link to="/bill/certifications">{t('ce.title')}</Link></div>
      <ListReport listCode="bill.tax_invoices" endpoint="/bill/tax-invoices" title={t('ti.title')} session={session.data} rowHref={(r) => `/bill/tax-invoices?id=${r.id}`} onOpen={(r) => navigateTo(`/bill/tax-invoices?id=${r.id}`)} cardFields={['invoiceNo', 'bill', 'invoiceDate', 'total', 'irn', 'status']} statusKey="status" empty={{ title: t('ti.emptyTitle'), text: t('ti.emptyBody') }} />
    </section>
  );
}
