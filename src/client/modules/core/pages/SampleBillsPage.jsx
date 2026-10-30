import { useRef, useState } from 'react';
import { useCalcTraces, useCreateBill, useRecalculateBill, useSampleBills, useSubmitBill, useUpdateBill } from '../api/index.js';
import { TraceView } from '../components/TraceView.jsx';
import { formatINR } from '../../../platform/format.js';
import { Field, FormDialog, Pager, QueryState, errorInfo, usePageTitle } from './ui.jsx';

const FIELDS = [['taxableAmount', 'Taxable'], ['cgstAmount', 'CGST'], ['sgstAmount', 'SGST'], ['igstAmount', 'IGST'], ['totalAmount', 'Total']];

function TraceDialog({ dialogRef, bill, field }) {
  const traces = useCalcTraces('sample_bill', bill?.id, Boolean(bill));
  const calc = bill && field ? bill.calculations[field] : null;
  const trace = calc ? traces.data?.find((t) => t.formula.code === calc.formula) : null;
  return (
    <dialog ref={dialogRef} className="dialog dialog-wide" aria-labelledby="trace-title">
      <h2 id="trace-title">How {calc ? FIELDS.find(([k]) => k === field)[1] : ''} was calculated</h2>
      {traces.isPending && <p className="muted">Loading the calculation...</p>}
      {traces.isError && <p className="field-error" role="alert">{traces.error.message}{traces.error.correlationId && <> (Correlation ID: <code>{traces.error.correlationId}</code>)</>}</p>}
      {calc && trace && (
        <>
          <p>The value <strong>{bill[field]}</strong> is the output <code>{calc.output}</code> of this calculation.</p>
          <TraceView trace={trace} />
        </>
      )}
      <div className="actions"><button type="button" className="btn" onClick={() => dialogRef.current?.close()}>Close</button></div>
    </dialog>
  );
}

/**
 * The reference record for the calculation engine: a bill whose amounts are calculated on the server by registered formulas.
 * Each amount has a "Show calculation" link, and the formula versions used are kept on the bill.
 */
export default function SampleBillsPage() {
  usePageTitle('Sample Bills');
  const [page, setPage] = useState(1);
  const list = useSampleBills(page);
  const create = useCreateBill();
  const update = useUpdateBill();
  const submit = useSubmitBill();
  const recalc = useRecalculateBill();
  const [editing, setEditing] = useState(null);
  const [shown, setShown] = useState({ bill: null, field: null });
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const formDialog = useRef(null);
  const traceDialog = useRef(null);
  const rows = list.data?.data ?? [];

  const openForm = (bill) => {
    setEditing(bill);
    setError(null);
    formDialog.current?.showModal();
  };
  const save = async (f) => {
    setError(null);
    const body = { title: String(f.get('title')), quantity: String(f.get('quantity')), unitRate: String(f.get('unitRate')), gstPercent: String(f.get('gstPercent')), supply: String(f.get('supply')) };
    try {
      const bill = editing ? await update.mutateAsync({ id: editing.id, version: editing.version, ...body }) : await create.mutateAsync(body);
      formDialog.current?.close();
      setNotice(`${bill.title} saved. Every amount was calculated by the server.`);
    } catch (err) {
      setError(errorInfo(err));
    }
  };
  const act = async (fn, bill, done) => {
    setNotice('');
    try {
      const out = await fn();
      setNotice(typeof done === 'function' ? done(out) : done);
    } catch (err) {
      setNotice(err.message);
    }
  };

  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Reference &rsaquo; Sample Bills</nav>
      <div className="page-head">
        <h1 id="page-title">Sample Bills</h1>
        <button type="button" className="btn btn-primary" onClick={() => openForm(null)}>New sample bill</button>
      </div>
      <p className="muted">Quantity x rate gives the taxable amount (<code>boq.line_amount</code>); GST is split by <code>tax.gst_split</code>. The amounts are never typed in: they come from the engine, and Show calculation opens the steps. A submitted bill keeps the formula versions it was calculated with.</p>
      <p role="status" className="notice">{notice}</p>
      <QueryState query={list} what="sample bills" permission="core.sample.use" />
      {list.data && rows.length === 0 && <div className="state"><h2>No sample bills yet</h2><p>Create one to see the calculation and its trace.</p><button type="button" className="btn btn-primary" onClick={() => openForm(null)}>New sample bill</button></div>}
      {rows.length > 0 && (
        <>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Sample bills</caption>
              <thead><tr><th>Bill</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">GST %</th><th>Supply</th>{FIELDS.map(([, l]) => <th key={l} className="num">{l}</th>)}<th>Formulas</th><th>Status</th><th /></tr></thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id} data-testid={`bill-${b.id}`}>
                    <td data-label="Bill">{b.title}</td>
                    <td data-label="Qty" className="num">{b.quantity}</td><td data-label="Rate" className="num">{b.unitRate}</td><td data-label="GST %" className="num">{b.gstPercent}</td><td data-label="Supply">{b.supply === 'intra' ? 'Within state' : 'Between states'}</td>
                    {FIELDS.map(([k, l]) => (
                      <td key={k} data-label={l} className="num">
                        <span data-testid={`bill-${b.id}-${k}`}>{formatINR(b[k], { symbol: false })}</span>
                        <button type="button" className="link" aria-label={`Show calculation of ${l} for ${b.title}`} onClick={() => { setShown({ bill: b, field: k }); traceDialog.current?.showModal(); }}>Show</button>
                      </td>
                    ))}
                    <td data-label="Formulas" className="small">{Object.entries(b.formulaPins).map(([c, v]) => <div key={c}><code>{c}</code> v{v}</div>)}</td>
                    <td data-label="Status"><span className={`chip ${b.status === 'DRAFT' ? 'chip-off' : 'chip-on'}`}>{b.status}</span></td>
                    <td>
                      {b.status === 'DRAFT' && <button type="button" className="link" onClick={() => openForm(b)} aria-label={`Edit ${b.title}`}>Edit</button>}
                      <button type="button" className="link" disabled={recalc.isPending} onClick={() => act(() => recalc.mutateAsync(b.id), b, (o) => (o.recalculation.usedPinnedVersions ? 'Calculated again with the versions this bill was calculated with: the amounts are unchanged.' : o.recalculation.changed ? 'Calculated again with the formula versions in force today: the amounts changed.' : 'Calculated again: nothing changed.'))} aria-label={`Recalculate ${b.title}`}>Recalculate</button>
                      {b.status === 'DRAFT' && <button type="button" className="link" disabled={submit.isPending} onClick={() => act(() => submit.mutateAsync({ id: b.id, version: b.version }), b, `${b.title} submitted. Its amounts and formula versions are now fixed.`)} aria-label={`Submit ${b.title}`}>Submit</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager meta={list.data.meta} page={page} setPage={setPage} noun="bills" />
        </>
      )}

      <TraceDialog dialogRef={traceDialog} bill={shown.bill} field={shown.field} />

      <FormDialog dialogRef={formDialog} title={editing ? `Edit ${editing.title}` : 'New sample bill'} reason={false} error={error} busy={create.isPending || update.isPending} submitLabel="Save" onSubmit={save}>
        <Field label="Title" name="title" error={error}><input name="title" required minLength={2} maxLength={120} defaultValue={editing?.title ?? ''} /></Field>
        <Field label="Quantity" name="quantity" error={error} hint="up to 3 decimal places"><input name="quantity" required inputMode="decimal" defaultValue={editing?.quantity ?? ''} /></Field>
        <Field label="Rate" name="unitRate" error={error} hint="up to 4 decimal places"><input name="unitRate" required inputMode="decimal" defaultValue={editing?.unitRate ?? ''} /></Field>
        <Field label="GST %" name="gstPercent" error={error}><input name="gstPercent" required inputMode="decimal" defaultValue={editing?.gstPercent ?? '18'} /></Field>
        <Field label="Supply" name="supply" error={error}>
          <select name="supply" defaultValue={editing?.supply ?? 'intra'}><option value="intra">Within the state (CGST + SGST)</option><option value="inter">Between states (IGST)</option></select>
        </Field>
      </FormDialog>
    </section>
  );
}
