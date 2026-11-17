import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { AttachmentPanel } from '../../platform/object/panels.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { bill, fmtDate, qs } from './api.js';
import { DocBar, ErrorLine, Status, big, useRecord, useRunner } from './BillParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import DocumentFlow from '../../platform/object/DocumentFlow.jsx';

// The client certification and the submitted-against-certified analysis (part 22.04).
const nf = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }); const mf = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n = (v) => (v == null ? '—' : nf.format(v)); const money = (v) => (v == null ? '—' : `₹ ${mf.format(v)}`); const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const pctText = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v}%`);

function Diff({ x }) {
  const t = useT('bill');
  return (
    <>
      <div className="table-scroll" data-testid="bill-ce-items"><table className="data-table"><thead><tr><th>{t('rc.item')}</th><th className="num">{t('ce.subQty')}</th><th className="num">{t('ce.certQty')}</th><th className="num">{t('ce.subAmt')}</th><th className="num">{t('ce.certAmt')}</th><th>{t('ds.reason')}</th></tr></thead>
        <tbody>{x.items.map((i) => <tr key={i.lineNo} data-testid="bill-ce-item" data-diff={i.certifiedQty !== i.submittedQty ? '1' : '0'}><td>{i.code} {i.description}</td><td className="num">{n(i.submittedQty)}</td><td className="num">{n(i.certifiedQty)}</td><td className="num">{money(i.submittedAmount)}</td><td className="num">{money(i.certifiedAmount)}</td><td>{i.reason ?? ''}{i.carryForward ? ` · ${t('ce.carried')}` : ''}</td></tr>)}</tbody></table></div>
      <h3>{t('cb.tab.deductions')}</h3>
      <div className="table-scroll" data-testid="bill-ce-deductions"><table className="data-table"><thead><tr><th>{t('cb.deduction')}</th><th className="num">{t('ce.submitted')}</th><th className="num">{t('ce.certified')}</th><th>{t('ds.reason')}</th></tr></thead>
        <tbody>{x.deductions.map((d, i) => <tr key={i} data-testid="bill-ce-deduction" data-kind={d.kind}><td>{t(`dk.${d.kind}`)}{d.label && d.label !== t(`dk.${d.kind}`) ? `: ${d.label}` : ''}{d.added ? ` · ${t('ce.added')}` : ''}</td><td className="num">{money(d.submitted)}</td><td className="num">{money(d.certified)}</td><td>{d.reason ?? ''}</td></tr>)}</tbody></table></div>
    </>
  );
}
function Totals({ x, testid }) {
  const t = useT('bill'); const r = (k, v, s) => <tr data-testid={`bill-ce-sum-${k}`}><th scope="row">{t(`ce.s.${k}`)}</th><td className="num">{s ? <strong>{money(v)}</strong> : money(v)}</td></tr>;
  return (<div className="table-scroll" data-testid={testid}><table className="data-table"><tbody>{r('gross', x.certifiedGross ?? x.gross)}{(x.certifiedEscalation ?? x.escalation) ? r('escalation', x.certifiedEscalation ?? x.escalation) : null}{r('gst', x.certifiedGst ?? x.gst)}{r('deductions', -(x.certifiedDeductions ?? x.deductionsTotal))}{r('net', x.certifiedNet ?? x.net, true)}<tr data-testid="bill-ce-sum-diff"><th scope="row">{t('ce.s.diff')}</th><td className="num">{money(x.diffGross)} ({pctText(x.diffPct)}){x.bigDiff ? ` · ${t('ce.big')}` : ''}</td></tr></tbody></table></div>);
}

function CertForm({ initialBill }) {
  const t = useT('bill'); const { error, run, busy } = useRunner(); const o = useQuery({ queryKey: ['bill', 'ce-options'], queryFn: () => bill.get('/certifications/options'), retry: false });
  const [billId, setBillId] = useState(initialBill ?? ''); const [h, setH] = useState({ certNo: '', certDate: today(), fileRef: '', notes: '', escalation: '', escalationReason: '' }); const [rows, setRows] = useState({}); const [ded, setDed] = useState({}); const [extra, setExtra] = useState([]);
  const sub = useQuery({ queryKey: ['bill', 'ce-submitted', billId], queryFn: () => bill.get(`/certifications/submitted${qs({ billId })}`), enabled: Boolean(billId), retry: false });
  const items = (sub.data?.items ?? []).filter((i) => rows[i.lineNo] && rows[i.lineNo].qty !== '' && Number(rows[i.lineNo].qty) !== i.submittedQty).map((i) => ({ lineNo: i.lineNo, certifiedQty: Number(rows[i.lineNo].qty), reason: rows[i.lineNo].reason || null, carryForward: Boolean(rows[i.lineNo].carry) }));
  const deductions = [...Object.entries(ded).filter(([, v]) => v.certified !== '').map(([k, v]) => ({ kind: k.split('|')[0], label: v.label ?? null, certified: Number(v.certified), reason: v.reason || null })), ...extra.filter((x) => x.certified !== '').map((x) => ({ kind: x.kind, label: x.label || null, certified: Number(x.certified), reason: x.reason || null }))];
  const body = billId ? { billId: Number(billId), certDate: h.certDate, items, escalation: h.escalation === '' ? null : Number(h.escalation), escalationReason: h.escalationReason || null, deductions } : null;
  const pv = useQuery({ queryKey: ['bill', 'ce-preview', JSON.stringify(body)], queryFn: () => bill.post('/certifications/preview', body), enabled: Boolean(body && sub.data), retry: false, placeholderData: (p) => p });
  if (o.error?.status === 403) return <NoPermission what={t('ce.record')} permission="bill.certification.create" />; if (o.isPending) return <Skeleton label={t('ce.record')} rows={4} />; if (o.isError) return <ErrorState error={o.error} onRetry={o.refetch} />; const fe = error?.fields ?? {}; const set = (k) => (e) => setH({ ...h, [k]: e.target.value });
  return (
    <form className="mdm-panel" data-testid="bill-ce-form" onSubmit={async (e) => { e.preventDefault(); const r = await run(() => bill.post('/certifications', { ...body, siteId: null, certNo: h.certNo, fileRef: h.fileRef || null, notes: h.notes || null })); if (r) navigateTo(`/bill/certifications?id=${r.id}`); }}>
      <ErrorLine error={error} id="bill-error" />
      <div className="form-grid"><Field label={t('ce.bill')} name="billId" error={fe.billId}><select value={billId} onChange={(e) => { setBillId(e.target.value); setRows({}); setDed({}); setExtra([]); }} style={big} data-testid="bill-ce-bill"><option value="">—</option>{o.data.bills.map((b) => <option key={b.id} value={b.id}>{b.billNo} · {money(b.gross)} · {fmtDate(b.sentOn)}</option>)}</select></Field>
        <Field label={t('ce.certNo')} name="certNo" error={fe.certNo}><input value={h.certNo} onChange={set('certNo')} style={big} maxLength={60} data-testid="bill-ce-certno" /></Field>
        <Field label={t('ce.certDate')} name="certDate" error={fe.certDate}><input type="date" value={h.certDate} onChange={set('certDate')} style={big} data-testid="bill-ce-date" /></Field>
        <Field label={t('ce.fileRef')} name="fileRef" error={fe.fileRef}><input value={h.fileRef} onChange={set('fileRef')} style={big} maxLength={200} data-testid="bill-ce-file" /></Field></div>
      {!billId ? <p className="muted">{t('ce.pickBill')}</p> : sub.isPending ? <Skeleton label={t('ce.record')} rows={3} /> : sub.isError ? <ErrorState error={sub.error} onRetry={sub.refetch} /> : (<>
        <h2>{t('ce.items')}</h2><p className="muted">{t('ce.itemsNote')}</p>
        <div className="table-scroll"><table className="data-table" data-testid="bill-ce-lines"><thead><tr><th>{t('rc.item')}</th><th className="num">{t('ce.subQty')}</th><th>{t('ce.certQty')}</th><th>{t('ds.reason')}</th><th>{t('ce.carry')}</th></tr></thead>
          <tbody>{sub.data.items.map((i) => <tr key={i.lineNo} data-testid="bill-ce-line"><td>{i.code} {i.description}</td><td className="num">{n(i.submittedQty)} {i.uom}</td><td><input type="number" min="0" step="any" value={rows[i.lineNo]?.qty ?? ''} placeholder={String(i.submittedQty)} onChange={(e) => setRows({ ...rows, [i.lineNo]: { ...rows[i.lineNo], qty: e.target.value } })} style={{ ...big, width: 130 }} aria-label={t('ce.certQty')} data-testid="bill-ce-qty" /></td><td><input value={rows[i.lineNo]?.reason ?? ''} onChange={(e) => setRows({ ...rows, [i.lineNo]: { ...rows[i.lineNo], reason: e.target.value } })} style={big} maxLength={300} aria-label={t('ds.reason')} data-testid="bill-ce-reason" /></td><td><input type="checkbox" checked={Boolean(rows[i.lineNo]?.carry)} onChange={(e) => setRows({ ...rows, [i.lineNo]: { ...rows[i.lineNo], carry: e.target.checked } })} aria-label={t('ce.carry')} data-testid="bill-ce-carry" /></td></tr>)}</tbody></table></div>
        <h2>{t('ce.deductions')}</h2><p className="muted">{t('ce.dedNote')}</p>
        <div className="table-scroll"><table className="data-table" data-testid="bill-ce-ded-lines"><thead><tr><th>{t('cb.deduction')}</th><th className="num">{t('ce.submitted')}</th><th>{t('ce.certified')}</th><th>{t('ds.reason')}</th></tr></thead>
          <tbody>{sub.data.deductions.map((d, i) => { const k = `${d.kind}|${i}`; return <tr key={k}><td>{t(`dk.${d.kind}`)}{d.manual && d.label ? `: ${d.label}` : ''}</td><td className="num">{money(d.amount)}</td><td><input type="number" min="0" step="any" value={ded[k]?.certified ?? ''} onChange={(e) => setDed({ ...ded, [k]: { ...ded[k], label: d.manual ? d.label : null, certified: e.target.value } })} style={{ ...big, width: 150 }} aria-label={t('ce.certified')} data-testid={`bill-ce-ded-${d.kind}`} /></td><td><input value={ded[k]?.reason ?? ''} onChange={(e) => setDed({ ...ded, [k]: { ...ded[k], reason: e.target.value } })} style={big} maxLength={300} aria-label={t('ds.reason')} /></td></tr>; })}</tbody></table></div>
        {extra.map((x, i) => <div className="form-grid" key={i} data-testid="bill-ce-extra"><Field label={t('cb.deduction')} name={`k${i}`} error={null}><select value={x.kind} onChange={(e) => setExtra(extra.map((y, j) => (j === i ? { ...y, kind: e.target.value } : y)))} style={big} data-testid="bill-ce-extra-kind">{['OTHER', 'WATER_ELECTRICITY', 'CLIENT_MATERIAL', 'SECURED_ADVANCE', 'LD'].map((k) => <option key={k} value={k}>{t(`dk.${k}`)}</option>)}</select></Field>
          <Field label={t('ce.certified')} name={`a${i}`} error={null}><input type="number" min="0" step="any" value={x.certified} onChange={(e) => setExtra(extra.map((y, j) => (j === i ? { ...y, certified: e.target.value } : y)))} style={big} data-testid="bill-ce-extra-amount" /></Field><Field label={t('ds.reason')} name={`r${i}`} error={null}><input value={x.reason} onChange={(e) => setExtra(extra.map((y, j) => (j === i ? { ...y, reason: e.target.value } : y)))} style={big} maxLength={300} data-testid="bill-ce-extra-reason" /></Field></div>)}
        <div className="actions-row"><button type="button" className="btn" onClick={() => setExtra([...extra, { kind: 'OTHER', label: '', certified: '', reason: '' }])} data-testid="bill-ce-add-ded">{t('ce.addDeduction')}</button></div>
        <div className="form-grid"><Field label={t('ce.escalation')} name="escalation" error={fe.escalation}><input type="number" step="any" value={h.escalation} placeholder={String(sub.data.bill.escalation)} onChange={set('escalation')} style={big} data-testid="bill-ce-escalation" /></Field><Field label={t('ce.escalationReason')} name="escalationReason" error={fe.escalationReason}><input value={h.escalationReason} onChange={set('escalationReason')} style={big} maxLength={300} /></Field></div>
        <h2>{t('cb.preview')}</h2>{pv.isError ? <p className="field-error" role="alert" data-testid="bill-ce-preview-error">{pv.error?.message}</p> : pv.isPending ? <Skeleton label={t('cb.preview')} rows={2} /> : <div data-testid="bill-ce-preview"><Totals x={pv.data} testid="bill-ce-preview-sum" />{pv.data.disputed > 0 && <p data-testid="bill-ce-disputed">{t('ce.disputed', { amount: money(pv.data.disputed) })}</p>}</div>}</>)}
      <Field label={t('ds.notes')} name="notes" error={fe.notes}><input value={h.notes} onChange={set('notes')} style={big} maxLength={2000} data-testid="bill-ce-notes" /></Field>
      <div className="actions-row"><button type="submit" className="btn btn-primary" style={big} disabled={busy || !billId || !h.certNo || pv.isError} data-testid="bill-ce-save">{t('cb.saveDraft')}</button></div></form>
  );
}

function EditPanel({ x, run, busy }) {
  const t = useT('bill'); const [it, setIt] = useState(Object.fromEntries(x.items.map((i) => [i.lineNo, { qty: String(i.certifiedQty), reason: i.reason ?? '', carry: i.carryForward }]))); const [dd, setDd] = useState(Object.fromEntries(x.deductions.map((d, k) => [k, { certified: String(d.certified), reason: d.reason ?? '' }])));
  return (
    <form className="mdm-panel no-print" data-testid="bill-ce-edit" onSubmit={(e) => { e.preventDefault(); run(() => bill.patch(`/certifications/${x.id}`, { items: x.items.map((i) => ({ lineNo: i.lineNo, certifiedQty: Number(it[i.lineNo].qty), reason: it[i.lineNo].reason || null, carryForward: it[i.lineNo].carry })), deductions: x.deductions.map((d, k) => ({ kind: d.kind, label: d.label, certified: Number(dd[k].certified), reason: dd[k].reason || null })), rowVersion: x.version }), t('k.saved')); }}>
      <h2>{t('ce.editTitle')}</h2>
      {x.items.map((i) => <div className="form-grid" key={i.lineNo} data-testid="bill-ce-edit-line"><span>{i.code} {i.description} ({n(i.submittedQty)})</span><input type="number" min="0" step="any" value={it[i.lineNo].qty} onChange={(e) => setIt({ ...it, [i.lineNo]: { ...it[i.lineNo], qty: e.target.value } })} style={big} aria-label={t('ce.certQty')} data-testid="bill-ce-edit-qty" /><input value={it[i.lineNo].reason} onChange={(e) => setIt({ ...it, [i.lineNo]: { ...it[i.lineNo], reason: e.target.value } })} style={big} aria-label={t('ds.reason')} maxLength={300} /><label><input type="checkbox" checked={it[i.lineNo].carry} onChange={(e) => setIt({ ...it, [i.lineNo]: { ...it[i.lineNo], carry: e.target.checked } })} /> {t('ce.carry')}</label></div>)}
      {x.deductions.map((d, k) => <div className="form-grid" key={k}><span>{t(`dk.${d.kind}`)}</span><input type="number" min="0" step="any" value={dd[k].certified} onChange={(e) => setDd({ ...dd, [k]: { ...dd[k], certified: e.target.value } })} style={big} aria-label={t('ce.certified')} /><input value={dd[k].reason} onChange={(e) => setDd({ ...dd, [k]: { ...dd[k], reason: e.target.value } })} style={big} aria-label={t('ds.reason')} maxLength={300} /></div>)}
      <div className="actions-row"><button className="btn btn-primary" style={big} disabled={busy} data-testid="bill-ce-edit-save">{t('ce.saveChanges')}</button></div></form>
  );
}
function Certification({ id }) {
  const t = useT('bill'); const { q, guard } = useRecord('/certifications', id, t('ce.title'), 'bill.certification.view'); const { error, run, busy, note } = useRunner(); const [tab, setTab] = useState('items'); usePageTitle(t('ce.title'));
  if (guard) return guard; const x = q.data;
  return (
    <div data-testid="bill-ce-object" data-status={x.status} data-big={x.bigDiff ? '1' : '0'}><PageHeader id="ce-h" title={<>{x.certNo} <Status x={x} /></>} meta={<><Link to="/bill/certifications">{t('ce.title')}</Link> · {x.docNo} · {x.project} · <Link to={`/bill/client-bills?id=${x.billId}`}>{x.billNo}</Link> · {t('ce.certDate')} {fmtDate(x.certDate)}</>} />
      <DocumentFlow type="CERT" id={x.id} />
      <KpiRow><KpiTile label={t('ce.submitted')} value={money(x.submittedGross)} amount={x.submittedGross} kind="money" valueTestid="bill-ce-submitted" /><KpiTile label={t('ce.certified')} value={money(x.certifiedGross)} amount={x.certifiedGross} kind="money" valueTestid="bill-ce-certified"><div data-testid="bill-ce-diffpct">{pctText(-x.diffPct)}</div></KpiTile><KpiTile label={t('ce.s.net')} value={money(x.certifiedNet)} amount={x.certifiedNet} kind="money" valueTestid="bill-ce-net"><div className="muted">{t('ce.due')}: {fmtDate(x.dueDate)}</div></KpiTile></KpiRow>
      {x.bigDiff && <p className="mdm-banner" role="status" data-testid="bill-ce-bigdiff">{t('ce.bigNote')}</p>}{x.disputed > 0 && <p data-testid="bill-ce-disputed">{t('ce.disputed', { amount: money(x.disputed) })}</p>}
      <ErrorLine error={error} id="bill-error" />{note && <p className="mdm-banner" role="status">{note}</p>}
      <div className="actions-row no-print">{x.can.invoice && <button type="button" className="btn btn-primary" onClick={() => navigateTo(`/bill/tax-invoices?new=1&certId=${x.id}`)} data-testid="bill-ce-invoice">{t('ti.make')}</button>}{x.invoiceId && <Link to={`/bill/tax-invoices?id=${x.invoiceId}`} data-testid="bill-ce-invoice-link">{x.invoiceNo ?? t('ti.title')}</Link>}</div>
      <div className="actions-row no-print" role="tablist">{['items', 'summary', 'documents', ...(x.can.edit ? ['edit'] : [])].map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`btn${tab === k ? ' btn-primary' : ''}`} onClick={() => setTab(k)} data-testid={`bill-ce-tab-${k}`}>{t(`ce.tab.${k}`)}</button>)}</div>
      {tab === 'items' && <Diff x={x} />}{tab === 'summary' && <Totals x={x} testid="bill-ce-summary" />}{tab === 'edit' && x.can.edit && <EditPanel x={x} run={run} busy={busy} />}{tab === 'documents' && <AttachmentPanel type="bill_certifications" id={x.id} entity="bill_certifications" canEdit={x.can.edit} />}
      <DocBar kind="/certifications" x={x} printName={`${x.certNo.replaceAll('/', '-')}.pdf`} />
    </div>
  );
}

export function RecordCertificationPage() {
  const t = useT('bill'); usePageTitle(t('ce.record')); const sp = useSearch();
  return (<section aria-labelledby="cen-h" data-testid="bill-ce-record"><PageHeader id="cen-h" title={t('ce.record')} subtitle={t('ce.intro')} meta={<Link to="/bill/certifications">{t('ce.title')}</Link>} /><CertForm initialBill={sp.get('billId')} /></section>);
}
export function CertificationsPage() {
  const t = useT('bill'); usePageTitle(t('ce.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession();
  if (id) return <section aria-labelledby="ce-h"><Certification id={id} /></section>;
  return (
    <section aria-labelledby="ces-h" data-testid="bill-certifications"><PageHeader id="ces-h" title={t('ce.title')} subtitle={t('ce.listIntro')} />
      <div className="actions-row no-print"><Link to="/bill/certification-new" data-testid="bill-ce-new">{t('ce.record')}</Link> · <Link to="/bill/cert-analysis">{t('ca.title')}</Link> · <Link to="/bill/tax-invoices">{t('ti.title')}</Link></div>
      <ListReport listCode="bill.certifications" endpoint="/bill/certifications" title={t('ce.title')} session={session.data} rowHref={(r) => `/bill/certifications?id=${r.id}`} onOpen={(r) => navigateTo(`/bill/certifications?id=${r.id}`)} cardFields={['certNo', 'bill', 'certDate', 'certified', 'diff', 'status']} statusKey="status" empty={{ title: t('ce.emptyTitle'), text: t('ce.emptyBody') }} />
    </section>
  );
}
export function CertAnalysisPage() {
  const t = useT('bill'); usePageTitle(t('ca.title')); const o = useQuery({ queryKey: ['bill', 'recon-options'], queryFn: () => bill.get('/qty-recon/options'), retry: false }); const [pj, setPj] = useState(''); const [only, setOnly] = useState(false);
  const projects = o.data?.projects ?? []; const pid = pj || (projects.length === 1 ? String(projects[0].id) : '');
  const q = useQuery({ queryKey: ['bill', 'cert-analysis', pid, only], queryFn: () => bill.get(`/cert-analysis${qs({ projectId: pid, differencesOnly: only ? 'true' : '' })}`), enabled: Boolean(pid), retry: false, placeholderData: (p) => p });
  if (o.error?.status === 403) return <NoPermission what={t('ca.title')} permission="bill.certification.view" />; if (o.isPending) return <Skeleton label={t('ca.title')} rows={4} />; const d = q.data; const maxPct = Math.max(1, ...(d?.rows ?? []).map((r) => Math.abs(r.diffPct ?? 0)));
  return (
    <section aria-labelledby="ca-h" data-testid="bill-cert-analysis"><PageHeader id="ca-h" title={t('ca.title')} subtitle={t('ca.intro')} />
      <div className="form-grid no-print"><Field label={t('project')} name="projectId" error={null}><select value={pid} onChange={(e) => setPj(e.target.value)} style={big} data-testid="bill-ca-project"><option value="">—</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></Field><label style={{ minHeight: 48, alignSelf: 'end' }}><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} data-testid="bill-ca-only" /> {t('ca.only')}</label></div>
      {q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : !d ? <p className="muted">{t('rc.pick')}</p> : d.rows.length === 0 ? <div className="empty-state"><h2>{t('ca.emptyTitle')}</h2><p>{t('ca.emptyBody')}</p><Link to="/bill/client-bills">{t('cb.title')}</Link></div> : (<>
        <KpiRow data-testid="bill-ca-totals">{[['bills', d.totals.bills], ['certified', d.totals.certified], ['waiting', d.totals.waiting], ['submittedGross', money(d.totals.submittedGross), d.totals.submittedGross], ['certifiedGross', money(d.totals.certifiedGross), d.totals.certifiedGross], ['diffGross', money(d.totals.diffGross), d.totals.diffGross], ['disputed', money(d.totals.disputed), d.totals.disputed], ['avgDays', d.totals.avgDays ?? '—']].map(([k, v, amt, kd]) => <KpiTile label={t(`ca.t.${k}`)} value={v} amount={amt} kind={kd ?? (amt !== undefined ? 'money' : /day/i.test(k) ? 'time' : 'count')} key={k} data-testid={`bill-ca-t-${k}`} />)}</KpiRow>
        <div className="table-scroll"><table className="data-table" data-testid="bill-ca-table"><thead><tr><th>{t('ce.bill')}</th><th>{t('ca.sentOn')}</th><th className="num">{t('ce.submitted')}</th><th className="num">{t('ce.certified')}</th><th className="num">{t('ce.s.diff')}</th><th>%</th><th>{t('ca.days')}</th><th>{t('ce.certNo')}</th></tr></thead>
          <tbody>{d.rows.map((r) => <tr key={r.billId} data-testid="bill-ca-row" data-state={r.certId ? 'CERTIFIED' : 'WAITING'} data-big={r.bigDiff ? '1' : '0'}><td><Link to={`/bill/client-bills?id=${r.billId}`}>{r.billNo}</Link></td><td>{fmtDate(r.sentOn)}</td><td className="num">{money(r.submittedGross)}</td><td className="num">{r.certId ? money(r.certifiedGross) : t('ca.waiting')}</td><td className="num">{r.certId ? money(r.diffGross) : '—'}</td>
            <td><div style={{ minWidth: 90 }} aria-label={pctText(r.diffPct)}><div style={{ height: 8, width: `${Math.round((Math.abs(r.diffPct ?? 0) / maxPct) * 100)}%`, background: r.bigDiff ? 'var(--erp-color-status-error-fg)' : 'var(--erp-color-text-primary)' }} />{pctText(r.diffPct)}</div></td><td>{r.daysToCertify ?? '—'}</td><td>{r.certId ? <Link to={`/bill/certifications?id=${r.certId}`}>{r.certNo}</Link> : '—'}</td></tr>)}</tbody></table></div></>)}
    </section>
  );
}
