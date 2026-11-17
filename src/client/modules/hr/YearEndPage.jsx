import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { dayIST, lv } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Year-End Processing (HR, part 07.07, FR-08): choose the leave year that has ended, see for each person and type what year-end will do (encash up to the limit, carry forward up to the limit, lapse the rest), and run it once.
// It does not run while applications of the year wait for a decision. The carried days open the next year; the encashment goes to payroll (24.02) as inputs.
export default function YearEndPage() {
  usePageTitle('Year-End Processing');
  const qc = useQueryClient();
  const [year, setYear] = useState(Number(dayIST(0).slice(0, 4)) - 1);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const q = useQuery({ queryKey: ['lv', 'yearend', year], queryFn: () => lv.yearEndPreview(year), retry: false });
  const runs = useQuery({ queryKey: ['lv', 'yearend-runs'], queryFn: lv.yearEndRuns, retry: false });
  if (q.error?.status === 403) return <NoPermission what="year-end processing" permission="lv.yearend.run" />;
  const d = q.data;
  const run = async () => {
    setError(null); setNote(null);
    if (!window.confirm(`Run year-end of ${year}? It is done once and cannot be undone.`)) return;
    try { const r = await lv.yearEndRun(year); setNote(`Year-end of ${year} was processed: ${r.people} people, ${r.carry} days carried forward, ${r.lapse} lapsed, ${r.encash} to be encashed.`); qc.invalidateQueries({ queryKey: ['lv'] }); } catch (e) { setError(errorInfo(e)); }
  };
  return (
    <section aria-labelledby="ye-title" data-testid="year-end">
      <PageHeader id="ye-title" title={"Year-End Processing"} />
      <form className="srch-form" aria-label="Parameters" onSubmit={(e) => e.preventDefault()}>
        <Field label="Leave year" name="year" error={null}><input type="number" min="2000" max="2100" value={year} onChange={(e) => setYear(Number(e.target.value))} data-testid="ye-year" /></Field>
      </form>
      {error?.form && <p className="field-error" role="alert" data-testid="ye-error">{error.form}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="ye-note">{note}</p>}
      {q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : q.isPending ? <Skeleton label="Working out year-end" rows={4} /> : (
        <>
          {d.done && <p className="mdm-banner" data-testid="ye-done">Year-end of {d.year} was processed by {d.doneBy}.</p>}
          {d.waiting > 0 && <p className="field-error" role="alert" data-testid="ye-waiting">{d.waiting} leave application(s) of {d.year} wait for a decision: decide them first.</p>}
          <dl className="op-figures" data-testid="ye-totals"><div><dt>People</dt><dd>{d.totals.people}</dd></div><div><dt>Carried forward</dt><dd>{d.totals.carry}</dd></div><div><dt>Lapsing</dt><dd>{d.totals.lapse}</dd></div><div><dt>To be encashed</dt><dd>{d.totals.encash}</dd></div></dl>
          {d.rows.length === 0 ? <EmptyState title="Nothing to process" message="There is no balance in this year." /> : (
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Year-end plan">
              <table className="grid" data-testid="ye-table"><thead><tr><th>Person</th><th>Type</th><th className="num">Balance</th><th className="num">Encash</th><th className="num">Carry forward</th><th className="num">Lapse</th></tr></thead>
                <tbody>{d.rows.map((r) => <tr key={`${r.employeeId}-${r.type}`} data-testid="ye-row"><th scope="row" data-label="Person">{r.employee} <span className="muted small">{r.code}</span></th><td data-label="Type">{r.type}</td><td className="num" data-label="Balance">{r.balance}</td><td className="num" data-label="Encash">{r.encash}</td><td className="num" data-label="Carry forward">{r.carry}</td><td className="num" data-label="Lapse">{r.lapse}</td></tr>)}</tbody></table>
            </div>
          )}
          <div className="actions"><button type="button" className="btn btn-primary" disabled={d.done || d.waiting > 0 || d.rows.length === 0} onClick={run} data-testid="ye-run">Run year-end of {year}</button></div>
        </>
      )}
      {runs.data?.length > 0 && <p className="muted small">Earlier runs: {runs.data.map((r) => `${r.year} (${r.runBy})`).join(', ')}</p>}
      <p className="small"><Link to="/leave/balances">Leave Balance Report</Link> · <Link to="/leave/types">Leave Types & Rules</Link></p>
    </section>
  );
}
