import { useEffect, useState } from 'react';
import { useIntegrityRuns, useIntegritySummary, useRunIntegrity } from '../api/index.js';
import { formatDateTime, toCsv } from '../../../platform/format.js';

const STATUS_LABEL = { pass: 'Passed', fail: 'Failed', not_applicable: 'Nothing to check yet', never: 'Not run yet' };
const SKELETON = [0, 1, 2, 3, 4];

const statusOf = (check) => check.last?.status ?? 'never';

function sampleText(sample) {
  return Object.entries(sample)
    .map(([k, v]) => `${k}: ${typeof v === 'object' && v !== null ? JSON.stringify(v) : v}`)
    .join(', ');
}

function History({ check }) {
  const q = useIntegrityRuns({ check });
  if (q.isPending) return <p className="muted">Loading history...</p>;
  if (q.isError) return <p className="field-error" role="alert">Could not load the history: {q.error.message}{q.error.correlationId && <> (Correlation ID: <code>{q.error.correlationId}</code>)</>}</p>;
  if (q.data.data.length === 0) return <p className="muted">This check has not been run yet.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Run at (IST)</th><th>Result</th><th className="num">Checked</th><th className="num">Failures</th><th>Run by</th></tr></thead>
        <tbody>
          {q.data.data.map((r) => (
            <tr key={r.id}>
              <td data-label="Run at">{formatDateTime(r.runAt)}</td>
              <td data-label="Result">{STATUS_LABEL[r.status]}</td>
              <td data-label="Checked" className="num">{r.checked}</td>
              <td data-label="Failures" className="num">{r.failures}</td>
              <td data-label="Run by">{r.triggeredBy}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DataHealthPage({ session }) {
  const canRun = session?.permissions?.includes('core.integrity.run');
  const query = useIntegritySummary();
  const run = useRunIntegrity();
  const [open, setOpen] = useState(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    document.title = 'Data Health - Administration - ERP';
  }, []);

  const runNow = async () => {
    setNotice('');
    try {
      const out = await run.mutateAsync();
      const s = out.data.summary;
      setNotice(`Checks finished: ${s.pass} passed, ${s.fail} failed, ${s.notApplicable} with nothing to check yet.`);
    } catch {
      /* the error is shown below from run.error */
    }
  };

  const d = query.data;
  const counts = { pass: 0, fail: 0, not_applicable: 0, never: 0 };
  for (const c of d?.checks ?? []) counts[statusOf(c)]++;

  const exportCsv = () => {
    const csv = toCsv(
      ['Check', 'Code', 'Severity', 'Result', 'Checked', 'Failures', 'Last run (IST)'],
      d.checks.map((c) => [c.name, c.code, c.severity, STATUS_LABEL[statusOf(c)], c.last?.checked ?? '', c.last?.failures ?? '', c.last ? formatDateTime(c.last.runAt) : '']),
    );
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    Object.assign(document.createElement('a'), { href: url, download: 'data-health.csv' }).click();
    URL.revokeObjectURL(url);
  };

  let body;
  if (query.isError) {
    const e = query.error;
    body =
      e.status === 403 ? (
        <div className="state" role="alert"><h2>You do not have access to Data Health</h2><p>It needs the core.integrity.view permission (System Administrator or IT Administrator).</p></div>
      ) : e.status === 404 ? (
        <div className="state" role="alert"><h2>Data Health is not enabled</h2><p>{e.message}</p></div>
      ) : (
        <div className="state state-error" role="alert">
          <h2>Could not load the integrity report</h2>
          <p>{e.message}</p>
          {e.correlationId && <p className="muted">Correlation ID: <code>{e.correlationId}</code></p>}
          <button type="button" className="btn" onClick={() => query.refetch()}>Try again</button>
        </div>
      );
  } else if (!d) {
    body = <div className="skeleton" aria-busy="true" aria-label="Loading the integrity report">{SKELETON.map((i) => <div key={i} className="skeleton-row" />)}</div>;
  } else {
    body = (
      <>
        <div className="tiles" aria-label="Summary of the last run">
          <div className="tile tile-ok"><strong data-testid="count-pass">{counts.pass}</strong><span>Passed</span></div>
          <div className={`tile ${counts.fail ? 'tile-bad' : ''}`}><strong data-testid="count-fail">{counts.fail}</strong><span>Failed</span></div>
          <div className="tile"><strong data-testid="count-na">{counts.not_applicable}</strong><span>Nothing to check yet</span></div>
          {counts.never > 0 && <div className="tile"><strong data-testid="count-never">{counts.never}</strong><span>Not run yet</span></div>}
        </div>
        <p className="muted" data-testid="last-run">
          {d.runAt ? <>Last run {formatDateTime(d.runAt)} by {d.triggeredBy}.</> : 'The checks have not been run yet.'}
          {' '}Samples show identifiers only, never amounts or personal data.
        </p>
        {!d.runAt && (
          <div className="state">
            <h2>No integrity run yet</h2>
            <p>Run the checks to see whether the database is consistent.</p>
            {canRun && <button type="button" className="btn btn-primary" onClick={runNow} disabled={run.isPending}>Run checks now</button>}
          </div>
        )}
        <div className="table-wrap">
          <table data-testid="checks-table">
            <thead><tr><th>Check</th><th>Severity</th><th>Result</th><th className="num">Checked</th><th className="num">Failures</th><th>Details</th></tr></thead>
            <tbody>
              {d.checks.map((c) => {
                const status = statusOf(c);
                return (
                  <tr key={c.code} data-testid={`check-${c.code}`} className={status === 'fail' ? 'row-bad' : ''}>
                    <td data-label="Check"><strong>{c.name}</strong><div className="muted small">{c.description}</div><code className="small">{c.code}</code></td>
                    <td data-label="Severity"><span className={`chip ${c.severity === 'Critical' ? 'chip-bad' : 'chip-off'}`}>{c.severity}</span></td>
                    <td data-label="Result"><span className={`chip chip-${status}`}>{STATUS_LABEL[status]}</span></td>
                    <td data-label="Checked" className="num">{c.last?.checked ?? '-'}</td>
                    <td data-label="Failures" className="num">{c.last?.failures ?? '-'}</td>
                    <td data-label="Details">
                      {c.last?.samples?.length > 0 && (
                        <details>
                          <summary>{c.last.failures} failure(s): samples</summary>
                          <ul>{c.last.samples.map((s, i) => <li key={i}><code>{sampleText(s)}</code></li>)}</ul>
                        </details>
                      )}
                      {status === 'not_applicable' && <span className="muted small">No tables or rules to check yet.</span>}
                      <button type="button" className="btn btn-small" aria-expanded={open === c.code} onClick={() => setOpen(open === c.code ? null : c.code)}>
                        {open === c.code ? 'Hide history' : 'History'}
                      </button>
                      {open === c.code && <History check={c.code} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Data Health</nav>
      <div className="page-head"><h1 id="page-title">Database Integrity Report</h1></div>
      <p className="muted">Finds orphan links, duplicate numbers, totals that do not add up, unbalanced journals, negative quantities, rows without a company and invalid statuses.</p>
      <div className="toolbar">
        <button
          type="button"
          className="btn btn-primary"
          onClick={runNow}
          disabled={!canRun || run.isPending}
          aria-busy={run.isPending}
          title={canRun ? '' : 'Only the IT Administrator can run the checks (core.integrity.run)'}
        >
          {run.isPending ? 'Running...' : 'Run checks now'}
        </button>
        <button type="button" className="btn" onClick={exportCsv} disabled={!d}>Export CSV</button>
      </div>
      <p role="status" className="notice">{notice}</p>
      {run.isError && (
        <p className="field-error" role="alert">
          Could not run the checks: {run.error.message}
          {run.error.correlationId && <> (Correlation ID: <code>{run.error.correlationId}</code>)</>}
        </p>
      )}
      {body}
    </section>
  );
}
