import { useRef, useState } from 'react';
import { useConnectorLog, useConnectorLogs, useConnectors } from '../api/index.js';
import { formatDateTime, toCsv } from '../../../platform/format.js';
import { Link, Pager, QueryState, downloadCsv, usePageTitle } from './ui.jsx';

const STATUS = {
  success: 'chip-pass', failure: 'chip-fail', timeout: 'chip-fail', rejected: 'chip-never', circuit_open: 'chip-fail', rate_limited: 'chip-never', duplicate: 'chip-never',
};
const STATUS_LABEL = { success: 'Success', failure: 'Failed', timeout: 'Timed out', rejected: 'Refused', circuit_open: 'Circuit open', rate_limited: 'Rate limited', duplicate: 'Duplicate' };

function Detail({ id }) {
  const log = useConnectorLog(id);
  if (log.isPending) return <p className="muted">Loading...</p>;
  if (log.isError) return <p className="field-error" role="alert">{log.error.message}</p>;
  const l = log.data;
  return (
    <div data-testid="log-detail">
      <p className="muted small">Correlation ID <code>{l.correlationId ?? '-'}</code> &middot; {l.attempts} attempt(s) &middot; {l.durationMs} ms &middot; user {l.user ?? '-'}. Message text and identifiers are redacted before a call is logged.</p>
      {l.error && <p className="field-error">{l.error}</p>}
      <h3>Request</h3>
      <pre className="payload">{l.request ?? '(none)'}</pre>
      <h3>Response</h3>
      <pre className="payload">{l.response ?? '(none)'}</pre>
    </div>
  );
}

export default function IntegrationLogPage() {
  usePageTitle('Integration Log');
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ q: '', connector: '', status: '', direction: '', from: '', to: '' });
  const [open, setOpen] = useState(null);
  const dialog = useRef(null);
  const logs = useConnectorLogs({ page, ...filters });
  const connectors = useConnectors({ page: 1, pageSize: 100 });
  const rows = logs.data?.data ?? [];
  const set = (k) => (e) => { setFilters((f) => ({ ...f, [k]: e.target.value })); setPage(1); };

  const exportCsv = () =>
    downloadCsv('integration-log.csv', toCsv(
      ['Time (IST)', 'Connector', 'Direction', 'Operation', 'Status', 'HTTP', 'Duration ms', 'Attempts', 'Correlation ID', 'Error'],
      rows.map((r) => [formatDateTime(r.createdAt), r.connector, r.direction, r.operation, r.status, r.httpStatus ?? '', r.durationMs, r.attempts, r.correlationId ?? '', r.error ?? '']),
    ));

  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Integrations &rsaquo; Integration Log</nav>
      <div className="page-head">
        <h1 id="page-title">Integration Log</h1>
        <button type="button" className="btn" disabled={rows.length === 0} onClick={exportCsv}>Export CSV</button>
      </div>
      <p className="muted">Every call to or from an outside service, with the correlation ID that finds the matching server log lines. Rows are removed after each connector&apos;s retention period. <Link to="/admin/integrations">Back to connectors</Link></p>

      <div className="toolbar">
        <label className="field field-inline"><span className="sr-only">Search</span><input type="search" placeholder="Search operation, error or correlation ID" value={filters.q} onChange={set('q')} /></label>
        <label className="field field-inline"><span className="sr-only">Connector</span>
          <select value={filters.connector} onChange={set('connector')}>
            <option value="">All connectors</option>
            {(connectors.data?.data ?? []).map((c) => <option key={c.id} value={c.code}>{c.code}</option>)}
          </select>
        </label>
        <label className="field field-inline"><span className="sr-only">Status</span>
          <select value={filters.status} onChange={set('status')}>
            <option value="">Any status</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="field field-inline"><span className="sr-only">Direction</span>
          <select value={filters.direction} onChange={set('direction')}>
            <option value="">Any direction</option><option value="outbound">Outbound</option><option value="inbound">Inbound webhook</option><option value="test">Connection test</option>
          </select>
        </label>
        <label className="field field-inline"><span>From</span><input type="date" value={filters.from} onChange={set('from')} /></label>
        <label className="field field-inline"><span>To</span><input type="date" value={filters.to} onChange={set('to')} /></label>
      </div>

      <QueryState query={logs} what="the integration log" permission="core.connectors.view" />
      {logs.data && rows.length === 0 && <div className="state"><h2>No calls logged</h2><p>{Object.values(filters).some(Boolean) ? 'Nothing matches those filters.' : 'No call has been made to an outside service yet.'}</p></div>}
      {rows.length > 0 && (
        <>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Integration calls, newest first</caption>
              <thead><tr><th>Time (IST)</th><th>Connector</th><th>Operation</th><th>Status</th><th className="num">Duration</th><th>Correlation ID</th><th /></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} data-testid={`log-${r.id}`}>
                    <td data-label="Time">{formatDateTime(r.createdAt)}</td>
                    <td data-label="Connector"><code>{r.connector}</code><div className="muted small">{r.direction}</div></td>
                    <td data-label="Operation">{r.operation}{r.httpStatus ? <span className="muted small"> (HTTP {r.httpStatus})</span> : null}</td>
                    <td data-label="Status"><span className={`chip ${STATUS[r.status]}`}>{STATUS_LABEL[r.status]}</span>{r.attempts > 1 ? <div className="muted small">{r.attempts} attempts</div> : null}</td>
                    <td data-label="Duration" className="num">{r.durationMs} ms</td>
                    <td data-label="Correlation ID"><code>{r.correlationId ?? '-'}</code></td>
                    <td data-label="Details"><button type="button" className="btn btn-small" onClick={() => { setOpen(r.id); dialog.current?.showModal(); }} aria-label={`Show details of log ${r.id}`}>Details</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager meta={logs.data.meta} page={page} setPage={setPage} noun="calls" />
        </>
      )}

      <dialog ref={dialog} className="dialog" aria-label="Log entry">
        <h2>Log entry {open}</h2>
        {open && <Detail id={open} />}
        <div className="actions"><button type="button" className="btn" onClick={() => dialog.current?.close()}>Close</button></div>
      </dialog>
    </section>
  );
}
