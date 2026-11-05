import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDate } from '../../platform/format.js';
import { Field, Link, Tile, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { dayIST, employees } from './api.js';

// HR Overview (HR, part 07.01): the headcount (active and on notice), joiners and leavers in the chosen period, people on notice, what waits for approval and the changes scheduled, from the live records. Headcount by department, by
// site and by type as bars that open the directory behind them; what needs attention (expired and expiring documents, a separated person whose access could not be removed, people with no user account); the recent joiners and
// leavers and "My pending actions". Filters: period and work location. Every tile and bar opens the filtered list.
const KIND = { ERROR: 'is-overdue', WARNING: 'is-soon', INFO: '' };
export default function HrOverviewPage() {
  usePageTitle('HR Overview');
  const [f, setF] = useState({ from: dayIST(-30), to: dayIST(0), locationType: '' });
  const q = useQuery({ queryKey: ['hr', 'overview', f], queryFn: () => employees.overview(f), retry: false });
  const w = useQuery({ queryKey: ['hr', 'queue'], queryFn: () => employees.queue(), retry: false });
  if (q.error?.status === 403) return <NoPermission what="the HR overview" permission="hr.employee.view" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  const max = (rows) => Math.max(1, ...rows.map((r) => r.n));
  const Bars = ({ title, rows, href }) => (
    <section aria-label={title} className="hr-bars"><h2>{title}</h2>
      {rows.length === 0 ? <EmptyState compact title="No one yet" message="Approved employees appear here." /> : <ul className="mdm-list">{rows.map((r) => <li key={`${r.key}${r.label}`}><Link to={href(r)}><span className="hr-bar-label">{r.label}</span><span className="hr-bar" role="img" aria-label={`${r.n} of ${max(rows)}`}><span style={{ width: `${Math.round((r.n / max(rows)) * 100)}%` }} /></span><span className="num">{r.n}</span></Link></li>)}</ul>}
    </section>
  );
  return (
    <section aria-labelledby="hro-title" data-testid="hr-overview">
      <h1 id="hro-title">HR Overview</h1>
      <form className="srch-form" aria-label="Filters" onSubmit={(e) => e.preventDefault()}>
        <Field label="Joiners and leavers from" name="from" error={null}><input type="date" value={f.from} max={f.to} onChange={(e) => setF({ ...f, from: e.target.value })} data-testid="hro-from" /></Field>
        <Field label="to" name="to" error={null}><input type="date" value={f.to} min={f.from} onChange={(e) => setF({ ...f, to: e.target.value })} data-testid="hro-to" /></Field>
        <Field label="Work location" name="locationType" error={null}><select value={f.locationType} onChange={(e) => setF({ ...f, locationType: e.target.value })} data-testid="hro-location"><option value="">All</option><option value="HO">Head office</option><option value="SITE">Site</option></select></Field>
      </form>
      {q.isPending ? <Skeleton label="Loading the HR overview" rows={4} /> : (
        <>
          <div className="tiles" data-testid="hro-tiles">{d.tiles.map((t) => <Tile key={t.key} label={t.label} value={t.value} status={t.tone} hint={t.hint} to={t.to} testId={`hro-${t.key}`} />)}</div>
          <div className="mdm-two">
            <section aria-labelledby="hro-attention"><h2 id="hro-attention">Needs attention</h2>
              {d.attention.length === 0 ? <EmptyState compact title="Nothing needs attention" message="No expired document, no access left open." /> : <ul className="mdm-list" data-testid="hro-attention">{d.attention.map((x) => <li key={x.text} className={KIND[x.kind]}><Link to={x.link}>{x.text}</Link></li>)}</ul>}
            </section>
            <section aria-labelledby="hro-mine"><h2 id="hro-mine">My pending actions</h2>
              {w.isError ? <p className="muted">The worklist is for HR managers and payroll.</p> : (d.mine.length === 0 ? <EmptyState compact title="Nothing waits for you" message="New employees and changes you must approve appear here." /> : <ul className="mdm-list" data-testid="hro-mine">{d.mine.map((r) => <li key={`${r.kind}${r.id}`}><button type="button" className="link-button" onClick={() => navigateTo(`/hr/employees/employee?id=${r.employeeId}`)}>{r.code} {r.name}: {r.what}</button></li>)}</ul>)}
            </section>
          </div>
          <div className="mdm-two">
            <Bars title="Headcount by department" rows={d.byDepartment} href={(r) => `/hr/employees?filter[departmentId]=${r.key ?? ''}&filter[status]=ACTIVE,NOTICE`} />
            <Bars title="Headcount by site" rows={d.bySite} href={(r) => (r.key ? `/hr/employees?filter[siteId]=${r.key}` : '/hr/employees?filter[locationType]=HO')} />
          </div>
          <div className="mdm-two">
            <Bars title="Headcount by type" rows={d.byType} href={(r) => `/hr/employees?filter[employmentType]=${r.key}&filter[status]=ACTIVE,NOTICE`} />
            <section aria-labelledby="hro-recent"><h2 id="hro-recent">Recent joiners and leavers</h2>
              <ul className="mdm-list" data-testid="hro-recent">{d.recentJoiners.map((r) => <li key={`j${r.id}`}><Link to={`/hr/employees/employee?id=${r.id}`}>{r.code} {r.name}</Link> joined {formatDate(r.doj)}{r.department ? ` · ${r.department}` : ''}</li>)}{d.recentLeavers.map((r) => <li key={`l${r.id}`}><Link to={`/hr/employees/employee?id=${r.id}`}>{r.code} {r.name}</Link> {r.status === 'ABSCONDING' ? 'absconded' : 'left'} {r.date ? formatDate(r.date) : ''}</li>)}</ul>
              {d.recentJoiners.length + d.recentLeavers.length === 0 && <EmptyState compact title="No joiners or leavers" message="Joiners and leavers appear here as employees are approved and separated." />}
            </section>
          </div>
          <p className="small"><Link to="/hr/employees">Employee Directory</Link>{w.data ? ` · ${Object.values(w.data.counts).reduce((a, b) => a + b, 0)} item(s) in the HR worklist` : ''}</p>
        </>
      )}
    </section>
  );
}
