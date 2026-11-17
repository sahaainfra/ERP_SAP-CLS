import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import PageHeader from '../../platform/design/PageHeader.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { Field, Link, QueryState, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { mdm, todayIST } from './api.js';

// Part 166.8: the statutory changes of 2025-26 in one place, read from the dated masters. On a date: the GST rate of an HSN/SAC code and the TDS
// section of a nature of payment (with its legal reference, payment code and certificate form); the forms in force; the statutory calendar; and the
// documents not yet approved whose tax differs from the master on their date (FR-04). Every value is a master row with its dates: this page only reads.

const day = (iso) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).replace(/ /g, '-') : '—');
const go = (to) => (e) => { e.preventDefault(); navigateTo(to); };

export default function StatutoryPage() {
  usePageTitle('Statutory Changes');
  return (
    <section aria-labelledby="st-title" data-testid="statutory">
      <PageHeader id="st-title" title="Statutory Changes" subtitle="GST rates from 22-Sep-2025, the Labour Codes from 21-Nov-2025 and the Income-tax Act, 2025 from 01-Apr-2026, as dated master rows: a document takes the value of its own date." />
      <nav className="small" aria-label="The masters">
        <span className="muted">Masters: </span>
        {[['GST Rates', '/admin/master-data/common/gst-rates'], ['HSN/SAC Codes', '/admin/master-data/common/hsn-sac'], ['TDS/TCS Sections', '/admin/master-data/common/tds-sections'], ['TDS Forms', '/admin/master-data/common/tds-forms'], ['Statutory Calendar', '/admin/master-data/common/statutory-calendar'], ['Labour Code Rules', '/admin/master-data/common/labour-rules'], ['Pay Components', '/admin/master-data/common/pay-components']]
          .map(([l, to], i) => <span key={to}>{i > 0 && ' · '}<Link to={to}>{l}</Link></span>)}
      </nav>
      <OnADate />
      <Calendar />
      <Report />
    </section>
  );
}

/** FR-02: what applies on a date. */
function OnADate() {
  const [f, setF] = useState({ date: todayIST(), hsn: '2523', nature: 'CONTRACTOR', constitution: 'PARTNERSHIP' });
  const [ask, setAsk] = useState(f);
  const q = useQuery({ queryKey: ['mdm', 'statutory', 'lookup', ask], queryFn: () => mdm.statutoryLookup(ask), retry: false });
  const d = q.data;
  return (
    <section className="ui-card" aria-labelledby="st-date" data-testid="st-lookup">
      <h2 id="st-date" className="ui-card-head">On a date</h2>
      <div className="ui-card-body">
        <form className="form-grid" onSubmit={(e) => { e.preventDefault(); setAsk(f); }}>
          <Field label="Date of the document" name="date"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} data-testid="st-date" /></Field>
          <Field label="HSN/SAC code" name="hsn"><input inputMode="numeric" maxLength={8} value={f.hsn} onChange={(e) => setF({ ...f, hsn: e.target.value.replace(/\D/g, '') })} data-testid="st-hsn" /></Field>
          <Field label="Nature of payment" name="nature">
            <select value={f.nature} onChange={(e) => setF({ ...f, nature: e.target.value })} data-testid="st-nature">
              {(d?.natures ?? [{ code: 'CONTRACTOR', label: 'Payment to a contractor' }]).map((n) => <option key={n.code} value={n.code}>{n.label}</option>)}
            </select>
          </Field>
          <Field label="Payee" name="constitution">
            <select value={f.constitution} onChange={(e) => setF({ ...f, constitution: e.target.value })}>
              <option value="INDIVIDUAL">Individual or HUF</option><option value="PARTNERSHIP">Company, firm or others</option>
            </select>
          </Field>
          <div className="actions"><button type="submit" className="btn btn-primary" data-testid="st-go">Show</button></div>
        </form>
        <QueryState query={q} what="the values on that date" />
        {d && (
          <dl className="kv-list" data-testid="st-result">
            <div><dt>GST</dt><dd data-testid="st-gst">{d.gst ? <><strong>{d.gst.pct}%</strong> ({d.gst.rateCode}) for HSN {d.gst.hsn}, {d.gst.description}; this rate applies from {day(d.gst.hsnFrom)}{d.gst.hsnTo ? ` to ${day(d.gst.hsnTo)}` : ''}</> : 'That HSN/SAC code is not in force on the date'}</dd></div>
            <div><dt>TDS</dt><dd data-testid="st-tds">{d.tds ? <><strong>{d.tds.pct}%</strong> under {d.tds.legalRef}{d.tds.paymentCode ? `, payment code ${d.tds.paymentCode}` : ''}; threshold ₹{d.tds.thresholdSingle.toLocaleString('en-IN')} a payment, ₹{d.tds.thresholdAnnual.toLocaleString('en-IN')} a year; certificate in Form {d.tds.certificate}, statement in Form {d.tds.statement}</> : 'No section for that payment is in force on the date'}</dd></div>
            {d.forms.map((x) => <div key={x.purpose}><dt>{x.label}</dt><dd>{x.formCode ? <>Form {x.formCode}{x.replaces ? ` (replaces Form ${x.replaces})` : ''}, {x.legalRef}</> : '—'}</dd></div>)}
          </dl>
        )}
      </div>
    </section>
  );
}

/** FR-03: the statutory calendar. */
function Calendar() {
  const q = useQuery({ queryKey: ['mdm', 'statutory', 'calendar'], queryFn: () => mdm.statutoryCalendar({}), retry: false });
  return (
    <section className="ui-card" aria-labelledby="st-cal" data-testid="st-calendar">
      <h2 id="st-cal" className="ui-card-head">Statutory calendar</h2>
      <div className="ui-card-body">
        <p className="muted small">Returns and deposits of the three months before and after today. The alert centre's rule "Statutory return or deposit due" tells the owner ahead of each due date.</p>
        <QueryState query={q} what="the calendar" />
        {q.data && (
          <div className="table-scroll">
            <table className="data-table">
              <caption className="sr-only">Statutory due dates</caption>
              <thead><tr><th scope="col">Obligation</th><th scope="col">Period</th><th scope="col">Form</th><th scope="col">Due</th><th scope="col">Days left</th><th scope="col">Rule</th></tr></thead>
              <tbody>
                {q.data.rows.map((r) => (
                  <tr key={`${r.code}/${r.periodEnd}`} data-testid="st-due">
                    <td data-label="Obligation">{r.obligation}</td><td data-label="Period">{r.period}</td><td data-label="Form">{r.form ?? '—'}</td><td data-label="Due">{day(r.dueDate)}</td>
                    <td data-label="Days left">{r.daysToDue < 0 ? <span className="muted">passed</span> : r.daysToDue <= r.alertDays ? <StatusBadge status="SUBMITTED" label={`${r.daysToDue} days`} size="sm" /> : r.daysToDue}</td>
                    <td data-label="Rule" className="small muted">{r.legalRef}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

/** FR-04: documents not yet approved whose tax differs from the master on their date. */
function Report() {
  const q = useQuery({ queryKey: ['mdm', 'statutory', 'report'], queryFn: mdm.migrationReport, retry: false });
  return (
    <section className="ui-card" aria-labelledby="st-rep" data-testid="st-report">
      <h2 id="st-rep" className="ui-card-head">Documents to review</h2>
      <div className="ui-card-body">
        <QueryState query={q} what="the documents to review" />
        {q.data && (
          <>
            <p className="muted small">{q.data.note}</p>
            {q.data.rows.length === 0 ? <p data-testid="st-report-empty">No document waiting for approval has a tax that differs from the master on its date.</p> : (
              <div className="table-scroll">
                <table className="data-table">
                  <caption className="sr-only">Documents to review</caption>
                  <thead><tr><th scope="col">Document</th><th scope="col">Date</th><th scope="col">Status</th><th scope="col">What</th><th scope="col">Has</th><th scope="col">In force on its date</th><th scope="col">To do</th></tr></thead>
                  <tbody>
                    {q.data.rows.map((r) => (
                      <tr key={`${r.kind}-${r.id}-${r.what}`} data-testid="st-report-row">
                        <td data-label="Document">{r.label} <a href={r.route} onClick={go(r.route)}>{r.ref}</a></td><td data-label="Date">{day(r.date)}</td>
                        <td data-label="Status"><StatusBadge status={r.status} size="sm" /></td><td data-label="What">{r.what}</td><td data-label="Has">{r.has}</td><td data-label="In force">{r.inForce}</td><td data-label="To do" className="small">{r.action}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {q.data.changes.length > 0 && <p className="small muted">Master rows of the changes: {q.data.changes.map((c) => `${c.kind} ${c.ref} from ${day(c.from)}`).join('; ')}.</p>}
          </>
        )}
      </div>
    </section>
  );
}
