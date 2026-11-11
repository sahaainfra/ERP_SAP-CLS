import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { QUOTE_TONE, addDays, download, fmtDate, fmtQty, fmtRs, pc, today } from './api.js';
import { useSearch } from '../site/parts.jsx';

// Quotation entry (part 15.03, FR-04 to FR-06): procurement keys in what a vendor quoted, line by line: rate, discount, GST rate, freight, loading, other charges, make and deviation. The landed rate of each line is worked out by the server
// when the draft is saved (GST left out when recoverable); recording it as received makes it the vendor's current quotation. A revision is a new version that replaces the earlier one. Rates are seen only by those with the right (BR-02).
const refresh = (qc) => { qc.invalidateQueries({ queryKey: ['proc'] }); qc.invalidateQueries({ queryKey: ['list'] }); };
const blank = (l) => ({ rfqLineId: l.id, label: `${l.lineNo}. ${l.itemCode ? `${l.itemCode} · ` : ''}${l.itemName}`, uom: l.uom, rfqQty: l.qty, offeredQty: String(l.qty), rate: '', discountPct: '', gstRate: '', freight: '', loading: '', otherCharges: '', make: '', deviation: '', landedRate: null });
const num = (s) => (s === '' || s == null ? undefined : Number(s));

function Quote({ t, id }) {
  const qc = useQueryClient(); const q = useQuery({ queryKey: ['proc', 'quote', id], queryFn: () => pc.quote(id), retry: false });
  const hq = useQuery({ queryKey: ['proc', 'quote-history', id, q.data?.status], queryFn: () => pc.quoteHistory(id), enabled: q.isSuccess, retry: false });
  const [error, setError] = useState(null); const [note, setNote] = useState(null); const [busy, setBusy] = useState(false);
  usePageTitle(t('q.quoteTitle'));
  if (q.error?.status === 403) return <NoPermission what={t('q.quoteTitle')} permission="proc.quotation.view" />;
  if (q.isPending) return <Skeleton label={t('q.quoteTitle')} rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const r = q.data; const can = r.can;
  const run = async (fn, done) => { setError(null); setNote(null); setBusy(true); try { const x = await fn(); if (done) setNote(done); refresh(qc); return x; } catch (e) { setError(errorInfo(e)); return null; } finally { setBusy(false); } };
  const why = (action, msg) => { const x = window.prompt(t('q.why')); if (x) run(() => pc.quoteAct(r.id, action, { reason: x }), msg).then((d) => { if (d && action === 'amend') navigateTo(`/proc/quotation-entry?id=${d.id}&edit=1`); }); };
  return (
    <div data-testid="quote-object" data-status={r.status}>
      <h1 id="quote-h">{r.docNo} <StatusBadge status={QUOTE_TONE[r.status]} label={t(`q.qs.${r.status}`)} /> {r.expired && <StatusBadge status="AT_RISK" label={t('q.expired')} />}</h1>
      <p><Link to={`/proc/rfqs?id=${r.rfqId}`}>{r.rfqNo}</Link> · <Link to="/proc/quotation-entry">{t('q.backQuotes')}</Link></p>
      <dl className="kv" data-testid="quote-figures"><div><dt>{t('q.vendor')}</dt><dd>{r.vendor}</dd></div><div><dt>{t('q.version')}</dt><dd>{r.versionNo}{r.enteredVia === 'PORTAL' ? ` · ${t('q.byVendor')}` : ''}</dd></div><div><dt>{t('q.quoteRef')}</dt><dd>{r.quoteRef ?? '—'}</dd></div><div><dt>{t('q.validUntil')}</dt><dd>{fmtDate(r.validUntil)}</dd></div>
        <div><dt>{t('q.deliveryDays')}</dt><dd>{r.deliveryDays}</dd></div><div><dt>{t('q.payment')}</dt><dd>{r.paymentTerms ?? '—'}</dd></div><div><dt>{t('q.gst')}</dt><dd>{r.gstInclusive ? t('q.gstIncl') : t('q.gstExcl')}</dd></div>{r.canSeeRates && <div><dt>{t('q.totalLanded')}</dt><dd data-testid="quote-total">{fmtRs(r.totalLanded)}</dd></div>}
        {r.deviations && <div><dt>{t('q.deviations')}</dt><dd>{r.deviations}</dd></div>}</dl>
      {error?.form && <p className="field-error" role="alert" data-testid="quote-error">{error.form}</p>}{note && <p className="mdm-banner" role="status" data-testid="quote-note">{note}</p>}
      <div className="table-scroll"><table className="data-table" data-testid="quote-lines"><caption>{t('q.lines')}</caption><thead><tr><th>#</th><th>{t('q.item')}</th><th className="num">{t('q.offered')}</th>{r.canSeeRates ? <><th className="num">{t('q.rate')}</th><th className="num">{t('q.discount')}</th><th className="num">{t('q.gstPct')}</th><th className="num">{t('q.charges')}</th><th className="num">{t('q.landedRate')}</th><th className="num">{t('q.landedAmount')}</th></> : null}<th>{t('q.make')}</th><th>{t('q.deviation')}</th></tr></thead>
        <tbody>{r.lines.map((l) => <tr key={l.id} data-testid="quote-line"><td>{l.lineNo}</td><td>{l.itemCode ? `${l.itemCode} · ` : ''}{l.itemName}</td><td className="num">{fmtQty(l.offeredQty)} / {fmtQty(l.rfqQty)} {l.uom}</td>
          {r.canSeeRates && <><td className="num">{fmtRs(l.rate)}</td><td className="num">{l.discountPct}%</td><td className="num">{l.gstRate}%</td><td className="num">{fmtRs((l.freight ?? 0) + (l.loading ?? 0) + (l.otherCharges ?? 0))}</td><td className="num" data-testid="quote-landed-rate">{fmtRs(l.landedRate)}</td><td className="num">{fmtRs(l.landedAmount)}</td></>}<td>{l.make ?? ''}</td><td>{l.deviation ?? ''}</td></tr>)}</tbody></table></div>
      <div className="actions-row no-print">
        {can.edit && <Link to={`/proc/quotation-entry?id=${r.id}&edit=1`}>{t('q.edit')}</Link>}
        {can.submit && <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => run(() => pc.quoteAct(r.id, 'submit'), t('q.recorded'))} data-testid="quote-submit">{t('q.record')}</button>}
        {can.amend && <button type="button" className="btn" style={{ minHeight: 48 }} onClick={() => why('amend')} data-testid="quote-amend">{t('q.revise')}</button>}
        {can.withdraw && <button type="button" className="btn" onClick={() => why('withdraw', t('q.withdrawnDone'))} data-testid="quote-withdraw">{t('q.withdraw')}</button>}
        {can.cancel && r.status !== 'RECEIVED' && <button type="button" className="btn" onClick={() => why('cancel', t('q.cancelled'))} data-testid="quote-cancel">{t('q.cancel')}</button>}
        {can.delete && <button type="button" className="btn" onClick={async () => { if (window.confirm(t('q.deleteAsk')) && await run(() => pc.quoteDelete(r.id))) navigateTo(`/proc/rfqs?id=${r.rfqId}`); }} data-testid="quote-delete">{t('q.delete')}</button>}
        {can.print && <button type="button" className="btn" onClick={() => download(`/quotations/${r.id}/print`, `${r.docNo.replaceAll('/', '-')}.pdf`).catch(() => setError({ form: t('q.fileFailed') }))} data-testid="quote-print">{t('q.print')}</button>}
      </div>
      {hq.data && hq.data.versions.length > 1 && <div className="table-scroll"><table className="data-table" data-testid="quote-versions"><caption>{t('q.versions')}</caption><thead><tr><th>{t('q.quotation')}</th><th>{t('q.version')}</th><th>{t('q.status')}</th><th>{t('q.when')}</th></tr></thead><tbody>{hq.data.versions.map((v) => <tr key={v.id}><td><Link to={`/proc/quotation-entry?id=${v.id}`}>{v.docNo}</Link></td><td>{v.versionNo}</td><td>{t(`q.qs.${v.status}`)}</td><td>{String(v.receivedAt ?? '').slice(0, 16).replace('T', ' ')}</td></tr>)}</tbody></table></div>}
    </div>
  );
}

/** The entry grid: a new quotation (from an issued RFQ and one of its vendors) or the edit of a draft. */
function Entry({ t, rfqId, vendorId, editId }) {
  const iq = useQuery({ queryKey: ['proc', 'issued-rfqs'], queryFn: pc.issuedRfqs, retry: false });
  const eq = useQuery({ queryKey: ['proc', 'quote', editId], queryFn: () => pc.quote(editId), enabled: Boolean(editId), retry: false });
  const e = eq.data; const rid = e ? e.rfqId : rfqId;
  const rq = useQuery({ queryKey: ['proc', 'rfq', rid], queryFn: () => pc.rfq(rid), enabled: Boolean(rid), retry: false }); const rfq = rq.data;
  const [f, setF] = useState(null); const [rows, setRows] = useState(null); const [error, setError] = useState(null); const [busy, setBusy] = useState(false); const [saved, setSaved] = useState(null);
  usePageTitle(t('q.entryTitle'));
  if (iq.error?.status === 403) return <NoPermission what={t('q.entryTitle')} permission="proc.quotation.create" />;
  if (iq.isPending || (editId && eq.isPending) || (rid && rq.isPending)) return <Skeleton label={t('q.entryTitle')} rows={4} />;
  const issued = iq.data ?? [];
  const form = f ?? { vendorId: String(e?.vendorId ?? vendorId ?? ''), quoteRef: e?.quoteRef ?? '', validUntil: e?.validUntil ?? addDays(30), deliveryDays: String(e?.deliveryDays ?? 7), paymentTerms: e?.paymentTerms ?? '', gstInclusive: e?.gstInclusive ?? false, deviations: e?.deviations ?? '' };
  const base = rfq ? rfq.lines.map((l) => { const x = e?.lines?.find((y) => y.rfqLineId === l.id); const b = blank(l); return x ? { ...b, offeredQty: String(x.offeredQty), rate: x.rate == null ? '' : String(x.rate), discountPct: x.discountPct ? String(x.discountPct) : '', gstRate: x.gstRate ? String(x.gstRate) : '', freight: x.freight ? String(x.freight) : '', loading: x.loading ? String(x.loading) : '', otherCharges: x.otherCharges ? String(x.otherCharges) : '', make: x.make ?? '', deviation: x.deviation ?? '', landedRate: x.landedRate } : b; }) : [];
  const grid = rows ?? base; const set = (k, v) => setF({ ...form, [k]: v }); const setRow = (i, k, v) => setRows(grid.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const body = () => ({ quoteRef: form.quoteRef.trim() || null, validUntil: form.validUntil, deliveryDays: Number(form.deliveryDays || 0), paymentTerms: form.paymentTerms.trim() || null, gstInclusive: form.gstInclusive, deviations: form.deviations.trim() || null,
    lines: grid.filter((l) => l.rate !== '' || Number(l.offeredQty) === 0).map((l) => ({ rfqLineId: l.rfqLineId, offeredQty: num(l.offeredQty), rate: Number(l.rate || 0), discountPct: num(l.discountPct), gstRate: num(l.gstRate), freight: num(l.freight), loading: num(l.loading), otherCharges: num(l.otherCharges), make: l.make.trim() || null, deviation: l.deviation.trim() || null })) });
  const save = async (record) => {
    setError(null); setBusy(true);
    try {
      const payload = body(); let d = saved;
      if (d) d = await pc.quoteUpdate(d.id, { ...payload, rowVersion: d.rowVersion }); else if (editId) d = await pc.quoteUpdate(editId, { ...payload, rowVersion: e.rowVersion }); else d = await pc.quoteCreate({ rfqId: Number(rid), vendorId: Number(form.vendorId), ...payload });
      setSaved(d); if (record) { await pc.quoteAct(d.id, 'submit'); navigateTo(`/proc/quotation-entry?id=${d.id}`); } else setRows(grid.map((l) => { const x = d.lines.find((y) => y.rfqLineId === l.rfqLineId); return x ? { ...l, landedRate: x.landedRate } : l; }));
    } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); }
  };
  return (
    <section aria-labelledby="qe-h" data-testid="proc-quote-entry">
      <h1 id="qe-h">{t('q.entryTitle')}</h1><p className="muted">{t('q.entryHelp')}</p><p><Link to="/proc/quotation-entry">{t('q.backQuotes')}</Link></p>
      <form className="mdm-panel" onSubmit={(ev) => { ev.preventDefault(); save(false); }} noValidate>
        <div className="form-grid">
          <Field label={t('q.rfq')} name="rfqId" error={error}><select value={rid ?? ''} disabled={Boolean(editId)} onChange={(ev) => navigateTo(`/proc/quotation-entry?rfq=${ev.target.value}`)} style={{ minHeight: 44 }} data-testid="qe-rfq"><option value="">{t('q.choose')}</option>{issued.map((x) => <option key={x.id} value={x.id}>{x.docNo} · {x.title}</option>)}</select></Field>
          <Field label={t('q.vendor')} name="vendorId" error={error}><select value={form.vendorId} disabled={Boolean(editId)} onChange={(ev) => set('vendorId', ev.target.value)} style={{ minHeight: 44 }} data-testid="qe-vendor"><option value="">{t('q.choose')}</option>{(rfq?.vendors ?? []).map((v) => <option key={v.vendorId} value={v.vendorId}>{v.name}</option>)}</select></Field>
          <Field label={t('q.quoteRef')} name="quoteRef" error={error}><input value={form.quoteRef} maxLength={60} onChange={(ev) => set('quoteRef', ev.target.value)} style={{ minHeight: 44 }} data-testid="qe-ref" /></Field>
          <Field label={t('q.validUntil')} name="validUntil" error={error}><input type="date" value={form.validUntil} min={today()} onChange={(ev) => set('validUntil', ev.target.value)} style={{ minHeight: 44 }} data-testid="qe-valid" /></Field>
          <Field label={t('q.deliveryDays')} name="deliveryDays" error={error}><input type="number" min="0" value={form.deliveryDays} onChange={(ev) => set('deliveryDays', ev.target.value)} style={{ minHeight: 44 }} data-testid="qe-days" /></Field>
          <Field label={t('q.payment')} name="paymentTerms" error={error}><input value={form.paymentTerms} maxLength={300} onChange={(ev) => set('paymentTerms', ev.target.value)} style={{ minHeight: 44 }} /></Field>
          <label><input type="checkbox" checked={form.gstInclusive} onChange={(ev) => set('gstInclusive', ev.target.checked)} data-testid="qe-incl" /> {t('q.gstInclusive')}</label>
          <Field label={t('q.deviations')} name="deviations" error={error}><input value={form.deviations} maxLength={1000} onChange={(ev) => set('deviations', ev.target.value)} style={{ minHeight: 44 }} /></Field>
        </div>
        {rfq && (
          <div className="table-scroll"><table className="data-table" data-testid="qe-grid"><caption>{t('q.lines')}</caption><thead><tr><th>{t('q.item')}</th><th>{t('q.offered')}</th><th>{t('q.rate')}</th><th>{t('q.discount')}</th><th>{t('q.gstPct')}</th><th>{t('q.freight')}</th><th>{t('q.loading')}</th><th>{t('q.other')}</th><th>{t('q.make')}</th><th>{t('q.deviation')}</th><th className="num">{t('q.landedRate')}</th></tr></thead>
            <tbody>{grid.map((l, i) => {
              const cell = (k, w = 90, extra = {}) => <td><input {...extra} value={l[k]} onChange={(ev) => setRow(i, k, ev.target.value)} style={{ minHeight: 40, width: w }} aria-label={`${l.label} ${t(`q.f.${k}`)}`} data-testid={`qe-${k}`} /></td>;
              return <tr key={l.rfqLineId} data-testid="qe-row"><td>{l.label}<div className="muted small">{fmtQty(l.rfqQty)} {l.uom}</div></td>{cell('offeredQty', 90, { type: 'number', min: '0', step: '0.001', inputMode: 'decimal' })}{cell('rate', 100, { type: 'number', min: '0', step: '0.01', inputMode: 'decimal' })}{cell('discountPct', 70, { type: 'number', min: '0', max: '100', step: '0.01' })}{cell('gstRate', 70, { type: 'number', min: '0', max: '100', step: '0.01' })}
                {cell('freight', 90, { type: 'number', min: '0', step: '0.01' })}{cell('loading', 90, { type: 'number', min: '0', step: '0.01' })}{cell('otherCharges', 90, { type: 'number', min: '0', step: '0.01' })}{cell('make', 110)}{cell('deviation', 140)}<td className="num" data-testid="qe-landed">{l.landedRate == null ? '—' : fmtRs(l.landedRate)}</td></tr>;
            })}</tbody></table></div>)}
        {saved && <p className="mdm-banner" role="status" data-testid="qe-saved">{t('q.draftSaved', { no: saved.docNo })}{saved.canSeeRates ? ` ${t('q.totalLanded')}: ${fmtRs(saved.totalLanded)}` : ''}</p>}
        {error?.form && <p className="field-error" role="alert" data-testid="qe-error">{error.form}</p>}
        <div className="actions-row"><button type="submit" className="btn" style={{ minHeight: 48 }} disabled={busy || !rid || !form.vendorId} data-testid="qe-save">{t('q.saveDraft')}</button><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy || !rid || !form.vendorId} onClick={() => save(true)} data-testid="qe-record">{t('q.record')}</button></div>
      </form>
    </section>
  );
}

export default function QuotationEntryPage() {
  const t = useT('proc'); usePageTitle(t('q.entryTitle')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession(); const perms = session.data?.permissions ?? [];
  if (id && sp.get('edit') === '1') return <Entry key={`e${id}`} t={t} editId={id} />;
  if (id) return <section aria-labelledby="quote-h" data-testid="proc-quotes"><Quote key={id} t={t} id={id} /></section>;
  if (sp.get('rfq')) return <Entry key={`r${sp.get('rfq')}${sp.get('vendor')}`} t={t} rfqId={Number(sp.get('rfq'))} vendorId={Number(sp.get('vendor')) || null} />;
  return (
    <section aria-labelledby="quotes-h" data-testid="proc-quotes">
      <h1 id="quotes-h">{t('q.entryTitle')}</h1><p className="muted">{t('q.quotesIntro')}</p>
      <div className="actions-row no-print">{perms.includes('proc.quotation.create') && <Link to="/proc/quotation-entry?rfq=0">{t('q.newQuote')}</Link>} <Link to="/proc/rfqs">{t('q.title')}</Link></div>
      <ListReport listCode="proc.quotations" endpoint="/proc/quotations" title={t('q.quotesTitle')} session={session.data} rowHref={(r) => `/proc/quotation-entry?id=${r.id}`} onOpen={(r) => navigateTo(`/proc/quotation-entry?id=${r.id}`)}
        cardFields={['docNo', 'rfq', 'vendor', 'validUntil', 'total']} statusKey="status" empty={{ title: t('q.quotesEmptyTitle'), text: t('q.quotesEmptyBody') }} />
    </section>
  );
}
