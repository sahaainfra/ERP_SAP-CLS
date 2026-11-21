import { useEffect, useRef, useState } from 'react';
import { SupplierLanguage, useSupplierLocale } from './SupplierLocale.js';
import SupplierUpload from './SupplierUpload.jsx';
import { Card } from '../../platform/design/Card.jsx';

const quantityFields = [
  ['offeredQty', 'Offered quantity', '0.001'], ['rate', 'Unit rate', '0.01'],
  ['discountPct', 'Discount %', '0.01'], ['gstRate', 'GST %', '0.01'],
  ['freight', 'Freight', '0.01'], ['loading', 'Loading', '0.01'], ['otherCharges', 'Other charges', '0.01'],
];

function Input({ label, name, value, ...props }) {
  const { t } = useSupplierLocale();
  return <label>{t(label)}<input name={name} defaultValue={value ?? ''} inputMode={props.type === 'number' ? 'decimal' : undefined} {...props} /></label>;
}

function QuoteForm({ record, submit, busy, auth }) {
  const { t, qty } = useSupplierLocale();
  const [fileId, setFileId] = useState(null);
  const quote = record.quote;
  const byLine = new Map(quote?.lines.map((line) => [line.rfqLineId, line]));
  return <form className="portal-form" onSubmit={(event) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const lines = record.lines.flatMap((line) => {
      const read = (name) => fields.get(`${line.id}-${name}`);
      if (read('offeredQty') === '' && read('rate') === '') return [];
      return [{
        rfqLineId: line.id, offeredQty: read('offeredQty') === '' ? line.qty : Number(read('offeredQty')), rate: Number(read('rate')),
        ...Object.fromEntries(quantityFields.slice(2).map(([key]) => [key, Number(read(key))])),
        make: read('make'), deviation: read('deviation'),
      }];
    });
    submit('quotations', { version: record.revision, ...(fileId ? { fileIds: [fileId] } : {}), data: {
      quoteRef: fields.get('quoteRef'), validUntil: fields.get('validUntil'), deliveryDays: Number(fields.get('deliveryDays')),
      paymentTerms: fields.get('paymentTerms'), freightTerms: fields.get('freightTerms'), deviations: fields.get('deviations'),
      gstInclusive: fields.has('gstInclusive'), lines,
    } });
  }}>
    {quote && <p>Current quotation {quote.docNo}</p>}
    <Input label="Quotation reference" name="quoteRef" value={quote?.quoteRef} maxLength={60} />
    <Input label="Valid until" name="validUntil" type="date" value={quote?.validUntil} required />
    <Input label="Delivery days" name="deliveryDays" type="number" min="0" max="1000" value={quote?.deliveryDays ?? 0} required />
    <details className="supplier-options">
      <summary>{t("Commercial terms")}</summary>
      <div className="portal-form">
        <Input label="Payment terms" name="paymentTerms" value={quote?.paymentTerms} maxLength={300} />
        <Input label="Freight terms" name="freightTerms" value={quote?.freightTerms} maxLength={300} />
        <Input label="Deviations" name="deviations" value={quote?.deviations} maxLength={1000} />
        <label className="portal-terms"><input name="gstInclusive" type="checkbox" defaultChecked={quote?.gstInclusive} />{t("Rates include GST")}</label>
      </div>
    </details>
    <p>{t("Leave quantity and rate blank for lines you aren’t quoting.")}</p>
    {record.lines.map((line) => {
      const previous = byLine.get(line.id);
      return <fieldset key={line.id} className="portal-form supplier-line">
        <legend>{line.item} · {qty(line.qty, line.uom)}</legend>
        {quantityFields.slice(0, 2).map(([key, label, step]) => <Input key={key} label={label} name={`${line.id}-${key}`}
          type="number" min="0" step={step} value={previous?.[key]} />)}
        <details className="supplier-options">
          <summary>{t("Taxes, charges and specifications")}</summary>
          <div className="portal-form">
            {quantityFields.slice(2).map(([key, label, step]) => <Input key={key} label={label} name={`${line.id}-${key}`}
              type="number" min="0" step={step} value={previous?.[key]} />)}
            <Input label="Make" name={`${line.id}-make`} value={previous?.make} maxLength={120} />
            <Input label="Line deviation" name={`${line.id}-deviation`} value={previous?.deviation} maxLength={500} />
          </div>
        </details>
      </fieldset>;
    })}
    {record.attachments && <SupplierUpload auth={auth} label="Quotation attachment" onChange={setFileId} />}
    <button className="btn btn-primary" disabled={busy || fileId === 0}>{t(quote ? 'Send revised quotation' : 'Submit quotation')}</button>
  </form>;
}

function RfqDetail({ record, submit, busy, auth, download }) {
  const { t, date, money, qty } = useSupplierLocale();
  return <>
    <p>{t("Due")} {date(record.rfq.dueDate)} · {record.status}</p>
    {Object.entries(record.rfq.terms).filter(([, value]) => typeof value === 'string' && value).map(([key, value]) =>
      <p key={key}>{key.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)} · {value}</p>)}
    {record.lines.map((line) => <p key={line.id}>{line.item} · {qty(line.qty, line.uom)}
      {line.requiredBy ? ` · Required by ${line.requiredBy}` : ''}{line.spec ? ` · ${line.spec}` : ''}</p>)}
    {record.attachments?.length > 0 && <section aria-label={t('RFQ documents')}>
      <h3>{t("RFQ documents")}</h3>
      {record.attachments.map((file) => <button key={file.id} type="button" className="btn" disabled={busy}
        onClick={() => download(`files/${file.id}`, file.name)}>{file.name}</button>)}
    </section>}
    {record.writable ? <QuoteForm record={record} submit={submit} busy={busy} auth={auth} /> : <>
      <p>Quotation submissions are closed.</p>
      {record.quote && <p>{record.quote.docNo} · Valid until {date(record.quote.validUntil)}</p>}
      {record.quote?.lines.map((line) => <p key={line.rfqLineId}>
        {record.lines.find((item) => item.id === line.rfqLineId)?.item} · {line.offeredQty} at {money(line.rate)}
      </p>)}
    </>}
    <h3>{t("Clarifications")}</h3>
    {record.clarifications.map((entry, index) => <div key={index}>
      <p>{entry.question}</p><p>{entry.answer ?? t('Awaiting buyer response')}</p>
    </div>)}
    {record.writable && <form className="portal-form" onSubmit={(event) => {
      event.preventDefault();
      submit('clarifications', Object.fromEntries(new FormData(event.currentTarget)));
    }}>
      <label>{t("Question")}<textarea name="question" required minLength={5} maxLength={1000} /></label>
      <button className="btn" disabled={busy}>{t("Send question")}</button>
    </form>}
  </>;
}

function Expediting({ record, submit, busy }) {
  const { t, date } = useSupplierLocale();
  return <section aria-label={t('Expediting milestones')}>
    <h3>{t("Expediting milestones")}</h3>
    <p>{record.expediting.plan.docNo} · Required on site {date(record.expediting.plan.requiredOnSite)}</p>
    {record.expediting.milestones.map((milestone) => <div key={milestone.id} className="supplier-line">
      <strong>{milestone.name}</strong>
      <p>Planned {date(milestone.plannedDate)} · {milestone.status}</p>
      {record.status === 'APPROVED' ? <form className="portal-form" onSubmit={(event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        submit(`milestones/${milestone.id}`, { version: milestone.version, data: {
          forecastDate: fields.get('forecastDate') || null, actualDate: fields.get('actualDate') || null,
          remarks: fields.get('remarks'),
        } });
      }}>
        <Input label="Forecast date" name="forecastDate" type="date" value={milestone.forecastDate} />
        <Input label="Actual date" name="actualDate" type="date" value={milestone.actualDate} />
        <Input label="Progress note" name="remarks" value={milestone.remarks} maxLength={500} />
        <button className="btn" disabled={busy}>{t("Update milestone")}</button>
      </form> : <p>{milestone.actualDate ?? milestone.forecastDate}</p>}
    </div>)}
  </section>;
}

function InvoiceStatus({ invoices, download, busy }) {
  const { t, date, money } = useSupplierLocale();
  return <section aria-label={t('Invoices and payments')}>
    <h3>{t("Invoices and payments")}</h3>
    {invoices.length === 0 && <p>{t("No submitted invoices for this order.")}</p>}
    {invoices.map((invoice) => <div key={invoice.docNo} className="supplier-line">
      <strong>{invoice.invoiceNo}</strong>
      <p>{date(invoice.invoiceDate)} · {money(invoice.total)} · {invoice.status} · {invoice.matchStatus}</p>
      {invoice.dueDate && <p>{t("Due")} {date(invoice.dueDate)}</p>}
      {invoice.amountDue != null && <p>{money(invoice.paid)} paid · {money(invoice.amountDue)} outstanding</p>}
      {invoice.payments.map((payment) => <div key={payment.docNo}>
        <p>{payment.docNo} · {date(payment.paidOn)} · {money(payment.amount)}{payment.utr && ` · UTR ${payment.utr}`}</p>
        <button className="btn" disabled={busy} onClick={() => download(payment.id)}>{t("Download payment advice")}</button>
      </div>)}
    </div>)}
  </section>;
}

function Scorecards({ items }) {
  return items.map((item) => <div key={item.period} className="supplier-line">
    <h3>{item.period}</h3>
    <p>{item.total == null ? 'Score unavailable' : `${item.total}%`}{item.rating ? ` · ${item.rating}` : ''}</p>
    <dl className="portal-details">
      {[['onTime', 'On-time delivery'], ['quality', 'Quality'], ['responsiveness', 'Responsiveness'],
        ['safety', 'Safety'], ['invoiceAccuracy', 'Invoice accuracy']].filter(([key]) => item[key] != null)
        .map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{item[key]}%</dd></div>)}
    </dl>
  </div>);
}

function InvoiceForm({ record, submit, busy, auth, expanded }) {
  const { t } = useSupplierLocale();
  const [fileId, setFileId] = useState(null);
  return <details className="supplier-options" open={expanded || undefined}>
    <summary>{t("Submit a GST invoice")}</summary>
    <form className="portal-form" onSubmit={(event) => {
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      const lines = record.lines.flatMap((line) => {
        const qty = Number(fields.get(`qty-${line.id}`));
        return qty > 0 ? [{ poLineId: line.id, qty, rate: Number(fields.get(`rate-${line.id}`)),
          gstPct: Number(fields.get(`gst-${line.id}`)), hsn: fields.get(`hsn-${line.id}`) || null }] : [];
      });
      submit('invoices', { fileId, data: { invoiceNo: fields.get('invoiceNo'), invoiceDate: fields.get('invoiceDate'),
        vendorGstin: fields.get('vendorGstin') || null, declaredTotal: Number(fields.get('declaredTotal')), lines } });
    }}>
      <Input label="GST invoice number" name="invoiceNo" required maxLength={40} />
      <Input label="Invoice date" name="invoiceDate" type="date" required />
      <Input label="Supplier GSTIN" name="vendorGstin" minLength={15} maxLength={15} />
      <Input label="Total shown on invoice" name="declaredTotal" type="number" min="0" step="0.01" required />
      {record.lines.map((line) => <fieldset key={line.id} className="portal-form supplier-line">
        <legend>{line.description}</legend>
        <Input label="Invoiced quantity" name={`qty-${line.id}`} type="number" min="0" step="0.001" />
        <Input label="Invoice rate" name={`rate-${line.id}`} type="number" min="0" step="0.01" value={line.rate} />
        <Input label="Invoice GST %" name={`gst-${line.id}`} type="number" min="0" max="100" step="0.01" value={line.gstPct} />
        <Input label="HSN or SAC" name={`hsn-${line.id}`} maxLength={12} />
      </fieldset>)}
      <SupplierUpload auth={auth} label="Invoice PDF" accept=".pdf,application/pdf" onChange={setFileId} />
      <button className="btn btn-primary" disabled={busy || !fileId}>{t("Send invoice for approval")}</button>
    </form>
  </details>;
}

function VendorDocument({ item, submit, busy, auth, orderOpen }) {
  const { t, date } = useSupplierLocale();
  const [fileId, setFileId] = useState(null);
  return <div className="supplier-line">
    <h4>{item.reference} · {item.title}</h4>
    <p>{item.status} · Due {date(item.dueDate)}</p>
    {item.reviewCode && <p>Review code {item.reviewCode}{item.reviewText ? ` · ${item.reviewText}` : ''}</p>}
    {orderOpen && ['REQUIRED', 'RESUBMIT'].includes(item.status) && <form className="portal-form" onSubmit={(event) => {
      event.preventDefault();
      submit(`vendor-documents/${item.id}`, { version: item.version, fileId });
    }}>
      <SupplierUpload auth={auth} label="Vendor document" onChange={setFileId} />
      <button className="btn" disabled={busy || !fileId}>{t("Submit vendor document")}</button>
    </form>}
  </div>;
}

function Compliance({ list, submit, busy, auth }) {
  const { t } = useSupplierLocale();
  const [fileId, setFileId] = useState(null);
  return <>
    {list.items.map((item) => <div key={item.id} className="supplier-line">
      <strong>{item.label} · {item.reference}</strong>
      <p>{t(item.verified ? 'Verified' : 'Awaiting verification')}{item.validUntil ? ` · Valid until ${item.validUntil}` : ''}</p>
    </div>)}
    <form className="portal-form" onSubmit={(event) => {
      event.preventDefault();
      submit('', { ...Object.fromEntries(new FormData(event.currentTarget)), fileId });
    }}>
      <h3>{t("Submit a renewal")}</h3>
      <label>{t("Document type")}<select name="docType" required>
        <option value="">{t("Choose a document")}</option>
        {list.types.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <Input label="Document reference" name="docNo" required maxLength={120} />
      <Input label="Valid from" name="validFrom" type="date" required />
      <Input label="Valid until" name="validUntil" type="date" required />
      <SupplierUpload auth={auth} label="Renewed compliance document" onChange={setFileId} />
      <button className="btn btn-primary" disabled={busy || !fileId}>{t("Send for verification")}</button>
    </form>
  </>;
}

function VendorDocuments({ record, submit, busy, auth }) {
  const { t } = useSupplierLocale();
  const open = ['APPROVED', 'CLOSED'].includes(record.status);
  return <section aria-label={t('Vendor document review')}>
      <h3>{t("Vendor document review")}</h3>
      {!record.vendorDocuments?.length && <p>{t('No records to show.')}</p>}
      {record.vendorDocuments?.map((item) => <VendorDocument key={item.id} item={item} submit={submit}
        busy={busy} auth={auth} orderOpen={open} />)}
    </section>;
}

function OrderDetail({ record, submit, busy, auth }) {
  const { t, date, money, qty } = useSupplierLocale();
  const [fileId, setFileId] = useState(null);
  const open = record.status === 'APPROVED';
  return <>
    <p>{record.status} · {money(record.totalAmount)}</p>
    {record.terms.deliveryAddress && <p>Deliver to {record.terms.deliveryAddress}</p>}
    {record.terms.paymentTerms && <p>Payment terms · {record.terms.paymentTerms}</p>}
    {record.lines.map((line) => <div key={line.id} className="supplier-line">
      <strong>{line.description}</strong>
      <p>{qty(line.qty, line.uom)} · {line.balanceQty} outstanding</p>
      {line.schedule.map((due, index) => <p key={index}>{date(due.dueDate)} · {qty(due.qty, line.uom)}</p>)}
    </div>)}
    {record.acknowledgedAt ? <p>Acknowledged on {date(record.acknowledgedAt)}</p> : open &&
      <form className="portal-form" onSubmit={(event) => {
        event.preventDefault();
        submit('acknowledgments', { version: record.version, data: Object.fromEntries(new FormData(event.currentTarget)) });
      }}>
        <Input label="Acknowledgment note" name="note" maxLength={500} />
        <button className="btn" disabled={busy}>{t("Acknowledge order")}</button>
      </form>}
    <h3>{t("Dispatches and receipts")}</h3>
    {record.dispatches.map((asn) => <p key={asn.asn_no}>{asn.asn_no} · {date(asn.dispatch_date)} · {asn.status}</p>)}
    {record.receipts.map((receipt, index) => <p key={index}>{receipt.grnRef} · {date(receipt.receivedOn)}
      {' · '}Line {receipt.lineNo} · {receipt.qty} received · {receipt.acceptedQty} accepted
      {receipt.rejectedQty > 0 && ` · ${receipt.rejectedQty} rejected at receipt`}
      {receipt.inspection && receipt.inspection !== 'NA' && ` · Inspection ${receipt.inspection}`}
      {receipt.releasedQty > 0 && ` · ${receipt.releasedQty} released by quality control`}
      {receipt.qcRejectedQty > 0 && ` · ${receipt.qcRejectedQty} rejected by quality control`}</p>)}
    {record.expediting?.plan && <Expediting record={record} submit={submit} busy={busy} />}

    {open && <form className="portal-form" onSubmit={(event) => {
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      const lines = record.lines.flatMap((line) => {
        const qty = Number(fields.get(`qty-${line.id}`));
        return qty > 0 ? [{ poLineId: line.id, qty }] : [];
      });
      const data = Object.fromEntries(['vendorInvoiceNo', 'lrNo', 'vehicleNo', 'ewayBillNo', 'dispatchDate', 'expectedArrival']
        .flatMap((key) => fields.get(key) ? [[key, fields.get(key)]] : []));
      submit('dispatches', { version: record.version, ...(fileId ? { fileIds: [fileId] } : {}), data: { ...data, lines } });
    }}>
      <h3>{t("New dispatch")}</h3>
      <Input label="Dispatch date" name="dispatchDate" type="date" required />
      <Input label="Expected arrival" name="expectedArrival" type="date" />
      <Input label="Invoice number" name="vendorInvoiceNo" maxLength={60} />
      <Input label="LR number" name="lrNo" maxLength={60} />
      <Input label="Vehicle number" name="vehicleNo" maxLength={30} />
      <Input label="E-way bill number" name="ewayBillNo" maxLength={30} />
      {record.lines.map((line) => <Input key={line.id} label={`${t('Dispatched quantity for line')} ${line.lineNo}`}
        name={`qty-${line.id}`} type="number" min="0" max={line.balanceQty} step="0.001" />)}
      {record.uploadsEnabled && <SupplierUpload auth={auth} label="Dispatch invoice copy (PDF)" accept=".pdf,application/pdf" onChange={setFileId} />}
      <button className="btn btn-primary" disabled={busy || fileId === 0}>{t("Record dispatch")}</button>
    </form>}
  </>;
}

function SupplierWorkspace({ kind, api, session }) {
  const { t, date } = useSupplierLocale();
  const [list, setList] = useState({ items: [], nextBefore: null });
  const [record, setRecord] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const [formRevision, setFormRevision] = useState(0);
  const retry = useRef(null);
  const resource = ['invoices', 'vendor-documents'].includes(kind) ? 'orders' : kind;
  const path = `/portal/supplier/${resource}`;
  const auth = `Bearer ${session}`;
  useEffect(() => {
    const controller = new AbortController();
    api.get(path, { signal: controller.signal, headers: { Authorization: auth } }).then((result) => {
      setList(result.data);
      setBusy(false);
    }).catch((err) => {
      if (!controller.signal.aborted) { setError(err); setBusy(false); }
    });
    return () => controller.abort();
  }, [api, auth, path]);

  async function run(action) {
    setBusy(true);
    setError(null);
    try { await action(); } catch (err) { setError(err); } finally { setBusy(false); }
  }

  const get = async (url) => (await api.get(url, { headers: { Authorization: auth } })).data;
  function submit(action, body) {
    void run(async () => {
      const url = record ? `${path}/${record.id}/${action}` : path;
      const signature = JSON.stringify([url, body]);
      if (retry.current?.signature !== signature) retry.current = { signature, key: crypto.randomUUID() };
      const result = await api.post(url, body, { headers: { Authorization: auth, 'Idempotency-Key': retry.current.key } });
      setNotice(result.data.message ?? (result.data.docNo ? `${result.data.docNo} received` : 'Document submitted.'));
      if (record) setRecord(await get(`${path}/${record.id}`));
      else setList(await get(path));
      retry.current = null;
      setFormRevision((value) => value + 1);
    });
  }

  function download(endpoint, filename) {
    void run(async () => {
      const response = await fetch(`/api/v1${path}/${record.id}/${endpoint}`, {
        headers: { Authorization: auth }, cache: 'no-store',
      });
      if (!response.ok) {
        const problem = (await response.json()).error;
        throw Object.assign(new Error(problem?.message ?? 'The payment advice could not be downloaded.'), {
          correlationId: problem?.correlationId,
        });
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  return <Card title={t({ rfqs: 'RFQs & Quotations', orders: 'Purchase Orders & ASN', invoices: 'Invoices and payments', 'vendor-documents': 'Vendor document review', scorecards: 'My Scorecard', compliance: 'Compliance documents' }[kind])}>
    {error && <div role="alert">
      <p>{error.message}{error.correlationId ? ` · Reference ${error.correlationId}` : ''}</p>
      {Array.isArray(error.details) && error.details.length > 0 && <ul>
        {error.details.map((detail, index) => <li key={index}>{detail.message}</li>)}
      </ul>}
    </div>}
    {notice && <p role="status">{notice}</p>}
    {busy && <p role="status">{t("Loading…")}</p>}
    {record ? <>
      <button className="btn" disabled={busy} onClick={() => {
        setRecord(null);
        setNotice('');
        void run(async () => setList(await get(path)));
      }}>{t("Back to list")}</button>
      <button className="btn" disabled={busy} onClick={() => void run(async () => {
        setRecord(await get(`${path}/${record.id}`));
        setFormRevision((value) => value + 1);
      })}>{t("Refresh")}</button>
      <h2>{record.rfq?.docNo ?? record.docNo}</h2>
      {kind === 'rfqs' && <RfqDetail key={formRevision} record={record} busy={busy} submit={submit} auth={auth} download={download} />}
      {kind === 'orders' && <OrderDetail key={formRevision} record={record} busy={busy} submit={submit} auth={auth} />}
      {kind === 'invoices' && <div key={formRevision}>
        <InvoiceStatus invoices={record.invoices ?? []} busy={busy}
          download={(id) => download(`payments/${id}/advice`, 'payment-advice.pdf')} />
        {record.invoiceIntake && <InvoiceForm record={record} submit={submit} busy={busy} auth={auth} expanded />}
      </div>}
      {kind === 'vendor-documents' && <VendorDocuments key={formRevision} record={record} submit={submit} busy={busy} auth={auth} />}
    </> : kind === 'compliance' ? list.types && <Compliance key={formRevision} list={list} submit={submit} busy={busy} auth={auth} /> : <>
      {!busy && !error && list.items.length === 0 && <p>{t("No records to show.")}</p>}
      {kind === 'scorecards' ? <Scorecards items={list.items} /> : <ul className="portal-items">{list.items.map((item) => <li key={item.id} className="portal-item">
        <button className="btn" type="button" disabled={busy} onClick={() => {
          setNotice('');
          void run(async () => setRecord(await get(`${path}/${item.id}`)));
        }}>{item.docNo}</button>
        <span>{item.title} {date(item.dueDate ?? item.date)} · {item.status}</span>
      </li>)}</ul>}
      {list.nextBefore && <button className="btn" disabled={busy} onClick={() => void run(async () => {
        const page = await get(`${path}?before=${list.nextBefore}`);
        setList({ items: [...list.items, ...page.items], nextBefore: page.nextBefore });
      })}>{t("Load more")}</button>}
    </>}
  </Card>;
}


export default function LocalizedSupplierWorkspace({ language, ...props }) {
  return <SupplierLanguage.Provider value={language}><SupplierWorkspace {...props} /></SupplierLanguage.Provider>;
}
