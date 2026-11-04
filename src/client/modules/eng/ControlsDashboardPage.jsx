import { useMemo, useState } from 'react';
import Chart from '../../platform/charts/Chart.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatINR } from '../../platform/format.js';
import { useControlsDashboard } from '../../platform/protocol/api.js';
import { Link, Tile, usePageTitle } from '../core/pages/ui.jsx';
import { MODE } from './ControlPointsPage.jsx';

// Controls Dashboard (part 04.04, section 7.4): exceptions over time, the controls that fail most, the value at risk, how long open exceptions have waited, and how far
// the company has taken its controls from OFF to ENFORCE. Every figure leads to the list of records behind it.
export default function ControlsDashboardPage() {
  usePageTitle('Controls Dashboard');
  const [filters, setFilters] = useState({ projectId: '', days: 90 });
  const q = useControlsDashboard({ projectId: filters.projectId, days: filters.days });
  const d = q.data;
  const trend = useMemo(() => d && ({ categories: d.trend.map((t) => t.from), series: [{ name: 'Exceptions raised', values: d.trend.map((t) => t.raised) }], unit: 'exceptions' }), [d]);
  const failing = useMemo(() => d && ({ categories: d.topFailing.map((t) => t.control), series: [{ name: 'Times it failed', values: d.topFailing.map((t) => t.fails) }], unit: 'failures' }), [d]);
  if (q.error?.status === 403) return <NoPermission what="the controls dashboard" permission="eng.pcs.view" />;
  return (
    <section aria-labelledby="cd-title" data-testid="controls-dashboard">
      <h1 id="cd-title">Controls Dashboard</h1>
      <form className="srch-form" role="search" aria-label="Filter the dashboard" onSubmit={(e) => e.preventDefault()}>
        <label className="field"><span>Project</span><select value={filters.projectId} onChange={(e) => setFilters({ ...filters, projectId: e.target.value })}><option value="">All projects</option>{(d?.projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></label>
        <label className="field"><span>Period</span><select value={filters.days} onChange={(e) => setFilters({ ...filters, days: Number(e.target.value) })}><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="180">Last 180 days</option><option value="365">Last year</option></select></label>
      </form>
      {q.isPending && <Skeleton label="Loading the dashboard" rows={4} />}
      {q.isError && q.error?.status !== 403 && <ErrorState title="The dashboard could not be loaded" error={q.error} onRetry={() => q.refetch()} />}
      {d && (
        <>
          <div className="tiles" data-testid="cd-tiles">
            <Tile label="Open exceptions" value={d.tiles.open} status={d.tiles.open ? 'warn' : 'ok'} to="/controls/exceptions?status=OPEN" testId="cd-open" />
            <Tile label="Value at risk" value={formatINR(d.tiles.valueAtRisk)} status={Number(d.tiles.valueAtRisk) > 0 ? 'warn' : 'ok'} to="/controls/exceptions?status=OPEN" testId="cd-value" />
            <Tile label="Waiting for approval" value={d.tiles.awaitingApproval} to="/controls/exceptions?status=PENDING" testId="cd-pending" />
            <Tile label="Emergency, past the time to regularise" value={d.tiles.emergencyOverdue} status={d.tiles.emergencyOverdue ? 'bad' : 'ok'} to="/controls/exceptions?emergency=true&status=PENDING" testId="cd-emergency" />
            <Tile label="Oldest open (days)" value={d.tiles.oldestDays} testId="cd-oldest" />
          </div>
          <h2>How far the controls have been taken</h2>
          <ul className="srch-meta" aria-label="Rollout" data-testid="cd-rollout">{Object.entries(d.rollout).map(([m, n]) => <li key={m}>{MODE[m][1]} <strong>{n}</strong></li>)}<li><Link to="/admin/controls">Control Points</Link></li></ul>
          <h2>Exceptions over time</h2>
          {d.trend.length === 0 ? <EmptyState title="No exception in this period" message="Exceptions raised in the period appear here by week." /> : <Chart type="bar" data={trend} title="Exceptions raised by week" exportName="exceptions-by-week" />}
          <h2>Controls that fail most</h2>
          {d.topFailing.length === 0 ? <EmptyState title="No control has failed in this period" message="A control that blocks, warns or would have blocked appears here." /> : (
            <>
              <Chart type="bar" data={failing} title="Failures by control" exportName="failing-controls" />
              <div className="table-wrap" tabIndex={0} role="region" aria-label="Top failing controls">
                <table className="grid"><thead><tr><th>Control</th><th>Mode</th><th className="num">Failures</th><th className="num">Value at risk</th></tr></thead>
                  <tbody>{d.topFailing.map((f) => <tr key={f.control}><th scope="row" data-label="Control"><Link to={`/controls/exceptions?control=${f.control}`}>{f.control}</Link><br /><span className="muted small">{f.description}</span></th><td data-label="Mode">{MODE[f.mode][1]}</td><td className="num" data-label="Failures">{f.fails}</td><td className="num" data-label="Value at risk">{formatINR(f.valueAtRisk)}</td></tr>)}</tbody></table>
              </div>
            </>
          )}
          <h2>How long open exceptions have waited</h2>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Ageing">
            <table className="grid"><thead><tr><th>Age</th><th className="num">Exceptions</th><th className="num">Value at risk</th></tr></thead>
              <tbody>{d.ageing.map((a) => <tr key={a.label}><th scope="row" data-label="Age">{a.label}</th><td className="num" data-label="Exceptions">{a.count}</td><td className="num" data-label="Value at risk">{formatINR(a.valueAtRisk)}</td></tr>)}</tbody></table>
          </div>
          <div className="pcs-two">
            <div>
              <h2>Open, by control</h2>
              {d.byControl.length === 0 ? <p className="muted">None open.</p> : <ul className="lp-list">{d.byControl.map((c) => <li key={c.control}><Link to={`/controls/exceptions?control=${c.control}&status=OPEN`}>{c.control}</Link>: {c.count} ({formatINR(c.valueAtRisk)})</li>)}</ul>}
            </div>
            <div>
              <h2>Raised most, by person</h2>
              {d.byUser.length === 0 ? <p className="muted">None in this period.</p> : <ul className="lp-list">{d.byUser.map((u) => <li key={u.user}>{u.user}: {u.count} ({formatINR(u.valueAtRisk)})</li>)}</ul>}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
