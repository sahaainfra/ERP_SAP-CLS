import { useEffect, useState } from 'react';
import { vq, fmtDate, fmtQty } from './api.js';

// The vendor's page (part 15.03, FR-03): outside the application shell and before anybody is signed in. The link in the enquiry leads here (/vendor-quote?token=...). It shows the request, takes one quotation and then stops working;
// it shows no estimate and no other vendor. Plain words, large touch targets, one column on a phone.
const token = () => new URLSearchParams(window.location.search).get('token') ?? '';
const addDays = (n) => new Date(Date.now() + 5.5 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);
const num = (s) => (s === '' || s == null ? undefined : Number(s));
const field = { minHeight: 44, width: '100%', boxSizing: 'border-box' };

export default function VendorQuotePage() {
  const [info, setInfo] = useState(null); const [error, setError] = useState(null); const [done, setDone] = useState(null); const [busy, setBusy] = useState(false); const [rows, setRows] = useState([]); const [asked, setAsked] = useState(null); const [question, setQuestion] = useState('');
  const [f, setF] = useState({ quoteRef: '', validUntil: addDays(30), deliveryDays: '7', paymentTerms: '', freightTerms: '', gstInclusive: false, deviations: '' });
  useEffect(() => { document.title = 'Send your quotation'; }, []);
  useEffect(() => { vq.info(token()).then((d) => { setInfo(d); setRows(d.lines.map((l) => ({ rfqLineId: l.id, offeredQty: String(l.qty), rate: '', discountPct: '', gstRate: '', freight: '', loading: '', otherCharges: '', make: '', deviation: '' }))); const days = Number(d.rfq.terms?.validityDays); if (days) setF((x) => ({ ...x, validUntil: addDays(days) })); }).catch((e) => setError({ message: e.message, status: e.status })); }, []);
  const set = (k, v) => setF({ ...f, [k]: v }); const setRow = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const send = async (ev) => {
    ev.preventDefault(); setBusy(true); setError(null);
    try { setDone(await vq.submit(token(), { quoteRef: f.quoteRef.trim() || null, validUntil: f.validUntil, deliveryDays: Number(f.deliveryDays || 0), paymentTerms: f.paymentTerms.trim() || null, freightTerms: f.freightTerms.trim() || null, gstInclusive: f.gstInclusive, deviations: f.deviations.trim() || null,
      lines: rows.filter((r) => r.rate !== '').map((r) => ({ rfqLineId: r.rfqLineId, offeredQty: num(r.offeredQty), rate: Number(r.rate), discountPct: num(r.discountPct), gstRate: num(r.gstRate), freight: num(r.freight), loading: num(r.loading), otherCharges: num(r.otherCharges), make: r.make.trim() || null, deviation: r.deviation.trim() || null })) })); }
    catch (e) { setError({ message: e.message, status: e.status, details: e.details }); } finally { setBusy(false); }
  };
  const decline = async () => { const reason = window.prompt('Why are you not quoting? (optional)'); if (reason === null) return; setBusy(true); try { setDone(await vq.decline(token(), reason.trim() || null)); } catch (e) { setError({ message: e.message, status: e.status }); } finally { setBusy(false); } };
  const ask = async () => { if (question.trim().length < 5) return; try { setAsked((await vq.ask(token(), question.trim())).message); setQuestion(''); } catch (e) { setError({ message: e.message, status: e.status }); } };
  const shell = (children) => <main style={{ maxWidth: 1000, margin: '0 auto', padding: '16px' }} data-testid="vendor-quote-page">{children}</main>;
  if (done) return shell(<><h1>Thank you</h1><p role="status" data-testid="vq-done">{done.message}</p>{done.docNo && <p>Your reference: <strong>{done.docNo}</strong> (version {done.versionNo})</p>}</>);
  if (!info) return shell(<><h1>Send your quotation</h1>{error ? <p className="field-error" role="alert" data-testid="vq-error">{error.message}</p> : <p>Opening the request…</p>}</>);
  const fieldErr = (name) => error?.details?.find?.((d) => d.field === name)?.message;
  return shell(
    <>
      <h1>{info.rfq.title}</h1>
      <p className="muted">{info.company} asks {info.vendor} for a quotation, reference <strong>{info.rfq.docNo}</strong>. Please reply by <strong>{fmtDate(info.rfq.dueDate)}</strong>. {info.revising && <strong data-testid="vq-revising">You have quoted before: this replaces your earlier quotation.</strong>}</p>
      <dl className="kv"><div><dt>Delivery</dt><dd>{info.rfq.terms?.delivery ?? '—'}</dd></div><div><dt>Payment</dt><dd>{info.rfq.terms?.payment ?? '—'}</dd></div>{info.rfq.terms?.technicalSpecs && <div><dt>Specification</dt><dd>{info.rfq.terms.technicalSpecs}</dd></div>}{info.rfq.terms?.approvedMakes && <div><dt>Approved makes</dt><dd>{info.rfq.terms.approvedMakes}</dd></div>}</dl>
      {info.clarifications.length > 0 && <div data-testid="vq-clarifications"><h2>Questions and answers</h2><ul>{info.clarifications.map((c, i) => <li key={i}><strong>{c.question}</strong><div>{c.answer}</div></li>)}</ul></div>}
      <form onSubmit={send} noValidate data-testid="vq-form">
        <h2>Your rates</h2><p className="muted">Rates in rupees for the unit shown. Charges (freight, loading, other) are for the whole line.</p>
        {info.lines.map((l, i) => (
          <fieldset key={l.id} style={{ marginBottom: 12, padding: 12 }} data-testid="vq-line"><legend>{l.lineNo}. {l.item}: {fmtQty(l.qty)} {l.uom}{l.requiredBy ? `, by ${fmtDate(l.requiredBy)}` : ''}</legend>{l.spec && <p className="muted small">{l.spec}</p>}
            <div className="form-grid">
              {[['offeredQty', 'Quantity you offer', '0.001'], ['rate', `Rate per ${l.uom} (₹)`, '0.01'], ['discountPct', 'Discount (%)', '0.01'], ['gstRate', 'GST (%)', '0.01'], ['freight', 'Freight (₹)', '0.01'], ['loading', 'Loading and unloading (₹)', '0.01'], ['otherCharges', 'Other charges (₹)', '0.01']].map(([k, label, step]) => (
                <label key={k}>{label}<input type="number" inputMode="decimal" min="0" step={step} value={rows[i]?.[k] ?? ''} onChange={(ev) => setRow(i, k, ev.target.value)} style={field} data-testid={`vq-${k}`} />{fieldErr(`lines.${i}.${k}`) && <span className="field-error" role="alert">{fieldErr(`lines.${i}.${k}`)}</span>}</label>))}
              <label>Make or brand<input value={rows[i]?.make ?? ''} maxLength={120} onChange={(ev) => setRow(i, 'make', ev.target.value)} style={field} data-testid="vq-make" /></label>
              <label>Deviation from the specification<input value={rows[i]?.deviation ?? ''} maxLength={500} onChange={(ev) => setRow(i, 'deviation', ev.target.value)} style={field} /></label>
            </div>
          </fieldset>))}
        <div className="form-grid">
          <label>Your quotation number<input value={f.quoteRef} maxLength={60} onChange={(ev) => set('quoteRef', ev.target.value)} style={field} data-testid="vq-ref" /></label>
          <label>Valid until<input type="date" value={f.validUntil} onChange={(ev) => set('validUntil', ev.target.value)} style={field} data-testid="vq-valid" />{fieldErr('validUntil') && <span className="field-error" role="alert">{fieldErr('validUntil')}</span>}</label>
          <label>Delivery in (days)<input type="number" min="0" value={f.deliveryDays} onChange={(ev) => set('deliveryDays', ev.target.value)} style={field} data-testid="vq-days" /></label>
          <label>Payment terms you offer<input value={f.paymentTerms} maxLength={300} onChange={(ev) => set('paymentTerms', ev.target.value)} style={field} /></label>
          <label>Freight terms<input value={f.freightTerms} maxLength={300} onChange={(ev) => set('freightTerms', ev.target.value)} style={field} /></label>
          <label>Other deviations or conditions<input value={f.deviations} maxLength={1000} onChange={(ev) => set('deviations', ev.target.value)} style={field} /></label>
          <label><input type="checkbox" checked={f.gstInclusive} onChange={(ev) => set('gstInclusive', ev.target.checked)} data-testid="vq-incl" /> My rates include GST</label>
        </div>
        {error && <p className="field-error" role="alert" data-testid="vq-error">{error.message}{(error.details ?? []).filter((d) => !/^lines\.\d+\.\w+$|^validUntil$/.test(d.field)).map((d, i) => <span key={i}> {d.message}</span>)}</p>}
        <div className="actions-row"><button type="submit" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} data-testid="vq-submit">Send my quotation</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={decline} data-testid="vq-decline">I will not quote</button></div>
      </form>
      <div style={{ marginTop: 24 }}><h2>Ask a question</h2><div className="actions-row"><input value={question} maxLength={1000} placeholder="Your question about this request" onChange={(ev) => setQuestion(ev.target.value)} style={{ ...field, flex: 1 }} data-testid="vq-question" /><button type="button" className="btn" style={{ minHeight: 48 }} onClick={ask} data-testid="vq-ask">Send question</button></div>{asked && <p role="status" data-testid="vq-asked">{asked}</p>}</div>
    </>,
  );
}
