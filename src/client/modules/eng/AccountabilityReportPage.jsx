import { useMemo, useState } from 'react';
import Chart from '../../platform/charts/Chart.jsx';
import Icon from '../../platform/design/Icon.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDateTime } from '../../platform/format.js';
import { authHeaders, scoresUrl, useLedger, useScores } from '../../platform/accountability/api.js';
import { Link, usePageTitle } from '../core/pages/ui.jsx';
import { ACTION } from './MyAccountabilityPage.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Accountability Report (part 04.05, section 7.3): by person, role or project, how many actions were taken, how many on time, what was returned or rejected, the exceptions raised and the
// items past their time, with a figure that is an input to a review. A row opens the actions behind it. Exports honour the filters; the figure is never an automatic penalty.
const EMPTY = { by: 'person', projectId: '', processCode: '', from: '', to: '' };

export default function AccountabilityReportPage() {
  usePageTitle('Accountability Report');
  const [filters, setFilters] = useState(EMPTY);
  const [drill, setDrill] = useState(null);
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState('');
  const q = useScores(filters);
  const ledgerFilters = drill ? { ...(filters.by === 'person' ? { user: drill.key } : {}), ...(filters.by === 'project' ? { project: drill.key } : {}), ...(filters.projectId && filters.by !== 'project' ? { project: filters.projectId } : {}), process: filters.processCode, from: filters.from, to: filters.to, limit: 25, offset: (page - 1) * 25 } : null;
  const ledger = useLedger(ledgerFilters ?? { limit: 1 });
  const d = q.data;
  const chart = useMemo(() => d && d.rows.length > 0 && ({ categories: d.rows.slice(0, 12).map((r) => r.label), series: [{ name: 'Score', values: d.rows.slice(0, 12).map((r) => r.score) }], unit: 'points' }), [d]);
  const download = async (format) => {
    const res = await fetch(scoresUrl(format, filters), { headers: { ...authHeaders(), 'x-correlation-id': globalThis.crypto.randomUUID() } });
    if (!res.ok) { setNotice('The export could not be prepared.'); return; }
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement('a'), { href: url, download: `accountability.${format}` }).click();
    URL.revokeObjectURL(url);
    setNotice('');
  };
  if (q.error?.status === 403) return <NoPermission what="the accountability report" permission="acc.report.view" />;
  const set = (patch) => { setFilters((f) => ({ ...f, ...patch })); setDrill(null); setPage(1); };
  const t = d?.totals;
  return (
    <section aria-labelledby="ar-title" data-testid="accountability-report">
      <PageHeader id="ar-title" title={"Accountability Report"} subtitle={d?.note ?? 'How actions were taken: on time or late, returned or rejected, exceptions raised, and items past their time. An input to a review, read by a person.'} />
      {notice && <p role="status" className="notice">{notice}</p>}
      <form className="srch-form" role="search" aria-label="Report parameters" onSubmit={(e) => e.preventDefault()}>
        <label className="field"><span>By</span><select value={filters.by} onChange={(e) => set({ by: e.target.value })}><option value="person">Person</option><option value="role">Role</option><option value="project">Project</option></select></label>
        <label className="field"><span>Project</span><select value={filters.projectId} onChange={(e) => set({ projectId: e.target.value })}><option value="">All projects</option>{(d?.projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></label>
        <label className="field"><span>From</span><input type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} /></label>
        <label className="field"><span>To</span><input type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} /></label>
        {JSON.stringify(filters) !== JSON.stringify(EMPTY) && <button type="button" className="btn" onClick={() => set(EMPTY)}>Clear filters</button>}
      </form>
      <div className="srch-tools">
        <button type="button" className="btn" onClick={() => download('xlsx')}><Icon name="erp.action.export" size={16} /> Export XLSX</button>
        <button type="button" className="btn" onClick={() => download('csv')}>Export CSV</button>
        <button type="button" className="btn" onClick={() => download('pdf')}>Export PDF</button>
        <Link to="/admin/raci">RACI Matrix</Link>
      </div>
      {q.isPending && <Skeleton label="Loading the report" rows={5} />}
      {q.isError && q.error?.status !== 403 && <ErrorState title="The report could not be loaded" error={q.error} onRetry={() => q.refetch()} />}
      {d && (d.rows.length === 0 ? <EmptyState title="No action recorded in this period" message="Actions are recorded as people create, submit, approve and return documents. Change the period or the filters." /> : (
        <>
          {chart && <Chart type="bar" data={chart} title={`Score by ${filters.by}`} exportName="accountability-scores" />}
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Scores">
            <table className="grid" data-testid="ar-table">
              <thead><tr><th>{{ person: 'Person', role: 'Role', project: 'Project' }[d.by]}</th><th className="num">Actions</th><th className="num">On time</th><th className="num">Late</th><th className="num">On time %</th><th className="num">Exceptions raised</th><th className="num">Returned</th><th className="num">Rejected</th><th className="num">Open and overdue</th><th className="num">Score</th></tr></thead>
              <tbody>{d.rows.map((r) => (
                <tr key={r.key} data-testid={`ar-row-${r.key}`}>
                  <th scope="row" data-label="Who"><button type="button" className="link" onClick={() => { setDrill(r); setPage(1); }} aria-label={`Show the actions of ${r.label}`}>{r.label}</button></th>
                  <td className="num" data-label="Actions">{r.actions}</td><td className="num" data-label="On time">{r.onTime}</td><td className="num" data-label="Late">{r.late}</td><td className="num" data-label="On time %">{r.onTimePct ?? '—'}</td>
                  <td className="num" data-label="Exceptions raised">{r.exceptionsRaised}</td><td className="num" data-label="Returned">{r.returnsReceived}</td><td className="num" data-label="Rejected">{r.rejectsReceived}</td><td className="num" data-label="Open and overdue">{r.overdueOpen}</td><td className="num" data-label="Score">{r.score}</td>
                </tr>))}</tbody>
              <tfoot><tr><th scope="row">All shown</th><td className="num">{t.actions}</td><td className="num">{t.onTime}</td><td className="num">{t.late}</td><td className="num">{t.onTimePct ?? '—'}</td><td className="num">{t.exceptionsRaised}</td><td className="num">{t.returnsReceived}</td><td className="num">{t.rejectsReceived}</td><td className="num">{t.overdueOpen}</td><td className="num">{t.score}</td></tr></tfoot>
            </table>
          </div>
        </>
      ))}
      {drill && (
        <section className="card" aria-labelledby="ar-drill" data-testid="ar-drill">
          <h2 id="ar-drill">Actions of {drill.label}</h2>
          {ledger.isPending && <Skeleton label="Loading the actions" rows={3} />}
          {ledger.isError && <ErrorState title="The actions could not be loaded" error={ledger.error} onRetry={() => ledger.refetch()} />}
          {ledger.data && (ledger.data.rows.length === 0 ? <p className="muted">No action in this period.</p> : (
            <>
              <div className="table-wrap" tabIndex={0} role="region" aria-label="Actions">
                <table className="grid"><thead><tr><th>When</th><th>By</th><th>Action</th><th>On</th><th>Result</th><th>Time</th></tr></thead>
                  <tbody>{ledger.data.rows.filter((e) => filters.by !== 'role' || e.role === drill.key).map((e) => <tr key={e.id}><td data-label="When">{formatDateTime(e.at)}</td><td data-label="By">{e.actor}{e.role ? ` (${e.role})` : ''}</td><td data-label="Action">{ACTION[e.action]}</td><th scope="row" data-label="On">{e.entityRef ?? `${e.entity} ${e.entityId}`}</th><td data-label="Result">{e.outcome.replaceAll('_', ' ').toLowerCase()}</td><td data-label="Time">{e.onTime == null ? '' : e.onTime ? 'On time' : 'Late'}</td></tr>)}</tbody></table>
              </div>
              <div className="pager"><span>{ledger.data.total} action(s), page {page}</span>
                <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button type="button" className="btn" disabled={page * 25 >= ledger.data.total} onClick={() => setPage(page + 1)}>Next</button></div>
            </>
          ))}
          <button type="button" className="btn" onClick={() => setDrill(null)}>Close the actions</button>
        </section>
      )}
    </section>
  );
}
