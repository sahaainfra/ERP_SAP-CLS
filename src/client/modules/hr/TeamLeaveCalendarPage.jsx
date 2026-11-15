import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { Field, Link, usePageTitle } from '../core/pages/ui.jsx';
import { dayIST, lv } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Team Leave Calendar (HR, part 07.07, FR-07): who is away when, by site or department, for a month or less: a row for each person, a mark for each day of leave (solid for approved, outlined for waiting for approval), a count of the
// people away for each day and the holidays. A mark opens the application. Print gives the page as it is.
export default function TeamLeaveCalendarPage() {
  usePageTitle('Team Leave Calendar');
  const [from, setFrom] = useState(() => `${dayIST(0).slice(0, 8)}01`);
  const [siteId, setSiteId] = useState('');
  const to = (() => { const d = new Date(`${from}T00:00:00Z`); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10); })();
  const q = useQuery({ queryKey: ['lv', 'calendar', from, siteId], queryFn: () => lv.calendar({ from, to, siteId: siteId || undefined }), retry: false });
  if (q.error?.status === 403) return <NoPermission what="the team leave calendar" permission="lv.team.view" />;
  const d = q.data;
  const hol = new Map((d?.holidays ?? []).map((h) => [h.date, h.name]));
  return (
    <section aria-labelledby="tc-title" data-testid="team-calendar">
      <PageHeader id="tc-title" title={"Team Leave Calendar"} />
      <form className="srch-form" aria-label="Parameters" onSubmit={(e) => e.preventDefault()}>
        <Field label="Month starting" name="from" error={null}><input type="date" value={from} onChange={(e) => setFrom(`${e.target.value.slice(0, 8)}01`)} data-testid="tc-from" /></Field>
        <LookupField id="tc-site" label="Site" lookup="iam/sites" value={siteId} onChange={setSiteId} />
        <button type="button" className="btn" onClick={() => window.print()}>Print</button>
      </form>
      {q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : q.isPending ? <Skeleton label="Loading the calendar" rows={5} /> : d.rows.length === 0 ? <EmptyState title="Nobody is away" message="Leave that is approved or waiting for approval in this month appears here." /> : (
        <div className="table-wrap att-register" tabIndex={0} role="region" aria-label="Leave calendar">
          <table className="grid" data-testid="tc-table">
            <thead><tr><th scope="col">Person</th>{d.days.map((x, i) => <th key={x} scope="col" className={d.weekdays[i] === 0 || hol.has(x) ? 'att-sun' : ''} title={hol.get(x) ?? ''}>{x.slice(8)}</th>)}</tr></thead>
            <tbody>{d.rows.map((p) => (
              <tr key={p.employeeId} data-testid="tc-row">
                <th scope="row" data-label="Person">{p.name} <span className="muted small">{p.code}</span></th>
                {d.days.map((x) => { const c = p.cells[x]; return <td key={x} data-label={x.slice(8)} className={c ? `att-cell ${c.status === 'APPROVED' ? 'att-info' : 'att-warn'}` : 'att-cell'}>{c && <a href="/leave/my" className="att-cell-btn" aria-label={`${p.name}, ${x}: ${c.type}${c.half ? ' (half day)' : ''}, ${c.status === 'APPROVED' ? 'approved' : 'waiting for approval'}`} data-testid="tc-cell" data-status={c.status}>{c.code}{c.half ? '½' : ''}</a>}</td>; })}
              </tr>))}
              <tr data-testid="tc-count"><th scope="row">People away</th>{d.days.map((x) => <td key={x} className="num" data-label={x.slice(8)}>{d.perDay[x] || ''}</td>)}</tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">Solid: approved. Amber: waiting for approval. ½: half a day. Grey heading: Sunday or holiday.</p>
      <p className="small"><Link to="/leave/balances">Leave Balance Report</Link> · <Link to="/leave/apply">Apply Leave</Link></p>
    </section>
  );
}
