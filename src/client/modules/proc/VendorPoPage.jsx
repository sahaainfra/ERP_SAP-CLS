import { useEffect, useState } from 'react';
import { vpo, fmtDate, fmtQty } from './api.js';

// The vendor's page for an order (part 15.05, FR-04, FR-06): no sign-in, the link is the proof. The vendor reads the order, acknowledges it and tells the dispatch (advance shipping notice).
const token = () => new URLSearchParams(window.location.search).get('token') ?? '';
const field = { minHeight: 44, width: '100%', boxSizing: 'border-box' };
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

export default function VendorPoPage() {
  const [info, setInfo] = useState(null); const [error, setError] = useState(null); const [done, setDone] = useState(null); const [busy, setBusy] = useState(false); const [note, setNote] = useState(''); const [qty, setQty] = useState({});
  const [f, setF] = useState({ dispatchDate: today(), expectedArrival: '', vehicleNo: '', ewayBillNo: '', vendorInvoiceNo: '', lrNo: '' });
  useEffect(() => { document.title = 'Your purchase order'; }, []);
  const load = () => vpo.info(token()).then(setInfo).catch((e) => setError({ message: e.message }));
  useEffect(() => { load(); }, []);
  const ack = async () => { setBusy(true); setError(null); try { setDone((await vpo.ack(token(), note.trim() || null)).message); await load(); } catch (e) { setError({ message: e.message }); } finally { setBusy(false); } };
  const send = async (ev) => {
    ev.preventDefault(); setBusy(true); setError(null);
    try { const lines = Object.entries(qty).filter(([, v]) => Number(v) > 0).map(([id, v]) => ({ poLineId: Number(id), qty: Number(v) })); const r = await vpo.dispatch(token(), { dispatchDate: f.dispatchDate, expectedArrival: f.expectedArrival || undefined, vehicleNo: f.vehicleNo || null, ewayBillNo: f.ewayBillNo || null, vendorInvoiceNo: f.vendorInvoiceNo || null, lrNo: f.lrNo || null, lines }); setDone(`${r.message} ${r.asnNo}`); setQty({}); await load(); }
    catch (e) { setError({ message: e.message, details: e.details }); } finally { setBusy(false); }
  };
  const shell = (c) => <main style={{ maxWidth: 1000, margin: '0 auto', padding: 16 }} data-testid="vendor-po-page">{c}</main>;
  if (!info) return shell(<><h1>Your purchase order</h1>{error ? <p className="field-error" role="alert" data-testid="vp-error">{error.message}</p> : <p>Opening the order…</p>}</>);
  return shell(
    <>
      <h1>{info.docNo}{info.amendmentNo ? ` (amendment ${info.amendmentNo})` : ''}</h1>
      <p className="muted">{info.company} has placed this order with {info.vendor}, dated {fmtDate(info.date)}. {info.acknowledgedAt ? <strong data-testid="vp-acked">You acknowledged it on {fmtDate(info.acknowledgedAt.slice(0, 10))}.</strong> : <strong data-testid="vp-not-acked">Please acknowledge it.</strong>}</p>
      <dl className="kv"><div><dt>Deliver to</dt><dd>{info.terms.deliveryAddress ?? '—'}</dd></div><div><dt>Payment</dt><dd>{info.terms.paymentTerms ?? '—'}{info.terms.advancePct ? `, advance ${info.terms.advancePct}%` : ''}</dd></div><div><dt>Value with GST</dt><dd>₹ {Number(info.totalAmount).toLocaleString('en-IN')}</dd></div>{info.terms.ldTerms && <div><dt>Late delivery</dt><dd>{info.terms.ldTerms}</dd></div>}{info.terms.documentsRequired && <div><dt>Documents with the goods</dt><dd>{info.terms.documentsRequired}</dd></div>}</dl>
      <div className="table-scroll"><table className="data-table" data-testid="vp-lines"><thead><tr><th>#</th><th>Item</th><th>Quantity</th><th>Rate</th><th>GST</th><th>Delivery</th><th>Sent so far</th></tr></thead><tbody>{info.lines.map((l) => <tr key={l.id} data-testid="vp-line"><td>{l.lineNo}</td><td>{l.description}</td><td>{fmtQty(l.qty)} {l.uom}</td><td>₹ {l.rate}</td><td>{l.gstPct}%</td><td>{l.schedule.map((s, i) => <div key={i}>{fmtDate(s.dueDate)}: {fmtQty(s.qty)}</div>)}</td><td>{fmtQty(l.receivedQty)} (left {fmtQty(l.balanceQty)})</td></tr>)}</tbody></table></div>
      {done && <p role="status" className="mdm-banner" data-testid="vp-done">{done}</p>}{error && <p className="field-error" role="alert" data-testid="vp-error">{error.message}{(error.details ?? []).map((d, i) => <span key={i}> {d.message}</span>)}</p>}
      {!info.acknowledgedAt && <div className="mdm-panel"><h2>Acknowledge</h2><label>Note (optional)<input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} style={field} data-testid="vp-note" /></label><div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={ack} data-testid="vp-ack">I acknowledge this order</button></div></div>}
      {info.status === 'APPROVED' && <form className="mdm-panel" onSubmit={send} noValidate data-testid="vp-asn"><h2>Tell us what you are sending</h2><p className="muted">Enter the quantity on the vehicle for each line.</p>
        {info.lines.filter((l) => l.balanceQty > 0).map((l) => <label key={l.id}>{l.lineNo}. {l.description} ({l.uom})<input type="number" min="0" step="0.001" max={l.balanceQty} value={qty[l.id] ?? ''} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} style={field} data-testid="vp-qty" /></label>)}
        <div className="form-grid"><label>Dispatch date<input type="date" value={f.dispatchDate} onChange={(e) => setF({ ...f, dispatchDate: e.target.value })} style={field} /></label><label>Expected at site<input type="date" value={f.expectedArrival} onChange={(e) => setF({ ...f, expectedArrival: e.target.value })} style={field} data-testid="vp-arrival" /></label><label>Vehicle number<input value={f.vehicleNo} maxLength={30} onChange={(e) => setF({ ...f, vehicleNo: e.target.value })} style={field} data-testid="vp-vehicle" /></label><label>E-way bill<input value={f.ewayBillNo} maxLength={30} onChange={(e) => setF({ ...f, ewayBillNo: e.target.value })} style={field} /></label><label>Your invoice number<input value={f.vendorInvoiceNo} maxLength={60} onChange={(e) => setF({ ...f, vendorInvoiceNo: e.target.value })} style={field} /></label><label>LR / challan number<input value={f.lrNo} maxLength={60} onChange={(e) => setF({ ...f, lrNo: e.target.value })} style={field} /></label></div>
        <div className="actions-row"><button type="submit" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy || Object.values(qty).every((v) => !(Number(v) > 0))} data-testid="vp-send">Send the dispatch details</button></div></form>}
    </>,
  );
}
