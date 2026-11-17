import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { DAY_STATUS, dayIST, hoursText, regs } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { fmtDate } from '../../../shared/dates.js';

// Monthly Attendance Register (HR, part 07.06, FR-02 and FR-09): the people in the rows, the days of the attendance period in the columns, a code and a colour for each day (the colour is never the only sign: the code is written), and the totals
// at the right: present days, paid days, days of loss of pay and overtime hours. A day opens to show the punches and what made it. The register can be exported (XLSX, CSV, PDF) and printed; HR recomputes a site and locks the period from here.
const CELL = { P: 'ok', H: 'warn', A: 'bad', M: 'bad', L: 'info', HD: 'muted', WO: 'muted', OD: 'ok', CO: 'info', HW: 'ok', WW: 'ok' };
export default function MonthlyRegisterPage() {
  usePageTitle('Monthly Attendance Register');
  const qc = useQueryClient();
  const [period, setPeriod] = useState(dayIST(-31));
  const [siteId, setSiteId] = useState('');
  const [open, setOpen] = useState(null);
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);
  const filters = { period, siteId: siteId || undefined };
  const q = useQuery({ queryKey: ['att', 'register', period, siteId], queryFn: () => regs.register(filters), retry: false });
  if (q.error?.status === 403) return <NoPermission what="the attendance register" permission="att.register.view" />;
  const d = q.data;
  const fq = new URLSearchParams({ [`filter[periodStart]`]: d?.period.start ?? period, ...(siteId ? { 'filter[siteId]': siteId } : {}) }).toString();
  const recompute = async () => {
    setError(null); setNote(null);
    try { const r = await regs.recompute({ siteId: Number(siteId), from: d.period.start, to: d.period.end }); setNote(`Worked out again: ${r.employees} people, ${r.days} days (${r.created} new, ${r.updated} changed${r.arrears ? `, ${r.arrears} kept as arrears` : ''}).`); qc.invalidateQueries({ queryKey: ['att'] }); } catch (e) { setError(errorInfo(e)); }
  };
  return (
    <section aria-labelledby="rgs-title" data-testid="register">
      <PageHeader id="rgs-title" title={"Monthly Attendance Register"} />
      <form className="srch-form" aria-label="Parameters" onSubmit={(e) => e.preventDefault()}>
        <Field label="Any day of the period" name="period" error={null}><input type="date" value={period} onChange={(e) => { setPeriod(e.target.value); setOpen(null); }} data-testid="rgs-period" /></Field>
        <LookupField id="rgs-site" label="Site" lookup="iam/sites" value={siteId} onChange={(x) => { setSiteId(x); setOpen(null); }} />
        {d && <a className="btn" href={`/api/v1/att/register/export?format=xlsx&${fq}`} data-testid="rgs-xlsx">Export XLSX</a>}
        {d && <a className="btn" href={`/api/v1/att/register/export?format=csv&${fq}`} data-testid="rgs-csv">Export CSV</a>}
        {d && <a className="btn" href={`/api/v1/att/register/export?format=pdf&${fq}`} data-testid="rgs-pdf">Export PDF</a>}
        {d && <a className="btn" href={`/api/v1/att/register/print?period=${d.period.start}${siteId ? `&siteId=${siteId}` : ''}`} target="_blank" rel="noreferrer" data-testid="rgs-print">Print</a>}
        {d?.can.recompute && siteId && <button type="button" className="btn" onClick={recompute} data-testid="rgs-recompute">Work out again</button>}
      </form>
      {error?.form && <p className="field-error" role="alert">{error.form}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="rgs-note">{note}</p>}
      {q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : q.isPending ? <Skeleton label="Loading the register" rows={5} /> : (
        <>
          <p data-testid="rgs-head"><strong>{d.period.label}</strong> ({d.period.start} to {d.period.end}) · {d.lock ? <span data-testid="rgs-locked">Locked by {d.lock.lockedBy}{d.lock.status === 'REOPEN_PENDING' ? ' (reopening is waiting for approval)' : ''}</span> : <span data-testid="rgs-open">Not locked</span>}</p>
          <dl className="op-figures" data-testid="rgs-totals"><div><dt>People</dt><dd>{d.totals.employees}</dd></div><div><dt>Present days</dt><dd>{d.totals.presentDays}</dd></div><div><dt>Paid days</dt><dd data-testid="rgs-paid">{d.totals.paidDays}</dd></div><div><dt>Loss of pay days</dt><dd>{d.totals.lopDays}</dd></div><div><dt>Overtime hours</dt><dd>{d.totals.otHours}</dd></div><div><dt>Missing punches</dt><dd>{d.totals.missingPunch}</dd></div></dl>
          {d.rows.length === 0 ? <EmptyState title="No attendance in this period" message="Days appear here once people punch or are marked by the register." /> : (
            <>
            {/* part 166.2, U-06: 31 day columns cannot be read at 360 px, so a phone first shows one card per person with the totals and the days */}
            <ul className="ui-phone-only att-phone-list" data-testid="rgs-phone-list" aria-label="People in the register">
              {d.rows.map((p) => (
                <li key={p.employeeId} className="mdm-panel" data-testid="rgs-phone-person">
                  <strong>{p.name}</strong> <span className="muted small">{p.code}</span>
                  <div className="small">Present {p.totals.presentDays} · Paid {p.totals.paidDays} · LOP {p.totals.lopDays} · OT {p.totals.otHours} h</div>
                  <details><summary>Days</summary><ul className="att-phone-days">{d.days.filter((x) => p.cells[x]).map((x) => <li key={x}><span>{fmtDate(x)}</span> <strong className={`att-${CELL[p.cells[x].code] ?? 'muted'}`}>{p.cells[x].code}</strong></li>)}</ul></details>
                </li>
              ))}
            </ul>
            <div className="table-wrap att-register" tabIndex={0} role="region" aria-label="Attendance register" data-no-cards="">
              <table className="grid" data-testid="rgs-table">
                <thead><tr><th scope="col">Person</th>{d.days.map((x, i) => <th key={x} scope="col" className={d.weekdays[i] === 0 ? 'att-sun' : ''}>{x.slice(8)}</th>)}<th>Present</th><th>Paid</th><th>LOP</th><th>OT h</th></tr></thead>
                <tbody>{d.rows.map((p) => (
                  <tr key={p.employeeId} data-testid="rgs-row">
                    <th scope="row" data-label="Person">{p.name} <span className="muted small">{p.code}</span></th>
                    {d.days.map((x) => { const c = p.cells[x]; return <td key={x} data-label={x.slice(8)} className={c ? `att-cell att-${CELL[c.code] ?? 'muted'}` : 'att-cell'}>{c && <button type="button" className="att-cell-btn" onClick={() => setOpen({ employeeId: p.employeeId, date: x, name: p.name })} aria-label={`${p.name}, ${x}: ${DAY_STATUS[c.status]}`} data-testid="rgs-cell" data-code={c.code}>{c.code}{c.late ? '*' : ''}</button>}</td>; })}
                    <td className="num" data-label="Present">{p.totals.presentDays}</td><td className="num" data-label="Paid">{p.totals.paidDays}</td><td className="num" data-label="LOP">{p.totals.lopDays}</td><td className="num" data-label="OT h">{p.totals.otHours}</td>
                  </tr>))}</tbody>
              </table>
            </div>
            </>
          )}
          <p className="muted small" data-testid="rgs-legend">{d.legend.map((l) => `${l.code} ${l.label}`).join(' · ')} · * late</p>
          {open && <DayPanel open={open} close={() => setOpen(null)} />}
          <p className="small"><Link to="/att/daily">Daily Attendance</Link> · <Link to="/att/lock">Period Lock</Link> · <Link to="/att/approvals">Attendance Approvals</Link></p>
        </>
      )}
    </section>
  );
}

function DayPanel({ open, close }) {
  const q = useQuery({ queryKey: ['att', 'day', open.employeeId, open.date], queryFn: () => regs.day(open.employeeId, open.date), retry: false });
  return (
    <aside className="mdm-panel" aria-label={`${open.name} on ${open.date}`} data-testid="rgs-day">
      <h2>{open.name}, {open.date}</h2>
      {q.isPending ? <Skeleton label="Loading the day" rows={2} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
        <>
          <p><strong>{q.data.statusLabel}</strong>{q.data.locked ? ' · locked' : ''} · worked {hoursText(q.data.workedMinutes)} · overtime paid {hoursText(q.data.otPaidMinutes)} · paid day {q.data.paidDay} · loss of pay {q.data.lopDay}</p>
          <p className="small">In {q.data.inTime ?? '—'} · Out {q.data.outTime ?? '—'} · made from: {q.data.source.toLowerCase()}</p>
          {q.data.flags.length > 0 && <ul className="mdm-list">{q.data.flags.map((f) => <li key={f.code}>{f.label}</li>)}</ul>}
          {q.data.requests.length > 0 && <p className="small">Requests: {q.data.requests.map((r) => `${r.docNo} (${r.status.toLowerCase()})`).join(', ')}</p>}
        </>
      )}
      <div className="actions"><button type="button" className="btn" onClick={close} data-testid="rgs-day-close">Close</button></div>
    </aside>
  );
}
