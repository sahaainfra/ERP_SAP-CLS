import { useRef, useState } from 'react';
import { useCancelJob, useJobs, useRetryJob } from '../api/index.js';
import { formatDateTime, toCsv } from '../../../platform/format.js';
import { FormDialog, Link, Pager, QueryState, can, downloadCsv, errorInfo, usePageTitle } from './ui.jsx';

const STATUSES = ['', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'];
const LABEL = { QUEUED: 'Queued', RUNNING: 'Running', SUCCEEDED: 'Done', FAILED: 'Failed', CANCELLED: 'Cancelled' };
const CHIP = { QUEUED: 'chip-status-soft-closed', RUNNING: 'chip-status-open', SUCCEEDED: 'chip-on', FAILED: 'chip-status-closed', CANCELLED: 'chip-off' };
const duration = (ms) => (ms == null ? '-' : ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 60_000)} min`);

export default function JobsPage({ session }) {
  usePageTitle('Background Jobs');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const query = useJobs({ page, status });
  const cancel = useCancelJob();
  const retry = useRetryJob();
  const [target, setTarget] = useState(null);
  const [action, setAction] = useState('cancel');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const dialog = useRef(null);
  const canManage = can(session, 'core.jobs.manage');
  const rows = query.data?.data ?? [];

  const open = (job, kind) => {
    setTarget(job);
    setAction(kind);
    setError(null);
    dialog.current?.showModal();
  };
  const submit = async (f) => {
    setError(null);
    try {
      const out = await (action === 'cancel' ? cancel : retry).mutateAsync({ id: target.id, reason: String(f.get('reason')) });
      dialog.current?.close();
      setNotice(action === 'cancel' ? (out.cancelRequested && out.status === 'RUNNING' ? `Cancellation requested for job ${target.id}; it stops at its next check.` : `Job ${target.id} cancelled.`) : `Job ${target.id} queued again as job ${out.id}.`);
    } catch (err) {
      setError(errorInfo(err));
    }
  };
  const exportCsv = () =>
    downloadCsv('background-jobs.csv', toCsv(
      ['ID', 'Type', 'Status', 'Progress %', 'Attempts', 'Started (IST)', 'Duration', 'Started by', 'Error'],
      rows.map((j) => [j.id, j.type, LABEL[j.status], j.progress, `${j.attempts}/${j.maxAttempts}`, j.startedAt ? formatDateTime(j.startedAt) : '', duration(j.durationMs), j.createdBy, j.error]),
    ));

  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Operations &rsaquo; Background Jobs</nav>
      <div className="page-head"><h1 id="page-title">Background Jobs</h1></div>
      <p className="muted">Heavy and scheduled work runs here, with progress and a log. A failing job is retried with back-off before it is marked failed. <Link to="/admin/operations">Back to the monitor</Link></p>
      <div className="toolbar">
        <label className="field field-inline"><span>Status</span>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} data-testid="job-status">
            {STATUSES.map((s) => <option key={s} value={s}>{s ? LABEL[s] : 'All'}</option>)}
          </select>
        </label>
        <button type="button" className="btn" onClick={exportCsv} disabled={rows.length === 0}>Export CSV</button>
      </div>
      <p role="status" className="notice">{notice}</p>
      <QueryState query={query} what="background jobs" permission="core.jobs.view" />
      {query.data && rows.length === 0 && <div className="state"><h2>No jobs</h2><p>{status ? 'No jobs in this state.' : 'No background job has run yet. Replays and scheduled jobs appear here.'}</p></div>}
      {rows.length > 0 && (
        <>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Background jobs, newest first</caption>
              <thead><tr><th className="num">ID</th><th>Job</th><th>Status</th><th>Progress</th><th className="num">Attempts</th><th>Started (IST)</th><th>Took</th><th>Log</th><th /></tr></thead>
              <tbody>
                {rows.map((j) => (
                  <tr key={j.id} data-testid={`job-${j.id}`}>
                    <td data-label="ID" className="num">{j.id}</td>
                    <td data-label="Job"><code>{j.type}</code><div className="muted small">by {j.createdBy}{j.scheduleCode ? ` (${j.scheduleCode})` : ''}</div></td>
                    <td data-label="Status"><span className={`chip ${CHIP[j.status]}`}>{LABEL[j.status]}</span>{j.cancelRequested && j.status === 'RUNNING' ? <div className="muted small">cancelling</div> : null}</td>
                    <td data-label="Progress"><progress max="100" value={j.progress} aria-label={`Job ${j.id} progress`} /> <span className="small">{j.progress}%</span>{j.progressMessage ? <div className="muted small">{j.progressMessage}</div> : null}</td>
                    <td data-label="Attempts" className="num">{j.attempts}/{j.maxAttempts}</td>
                    <td data-label="Started">{j.startedAt ? formatDateTime(j.startedAt) : '-'}</td>
                    <td data-label="Took">{duration(j.durationMs)}</td>
                    <td data-label="Log">
                      {j.error && <div className="field-error">{j.error}</div>}
                      <details><summary>{j.log.length} lines</summary><pre className="payload">{j.log.join('\n') || 'No log lines.'}{j.result ? `\n\nResult: ${JSON.stringify(j.result)}` : ''}</pre></details>
                    </td>
                    <td>
                      {canManage && ['QUEUED', 'RUNNING'].includes(j.status) && <button type="button" className="link" aria-label={`Cancel job ${j.id}`} onClick={() => open(j, 'cancel')}>Cancel</button>}
                      {canManage && ['FAILED', 'CANCELLED'].includes(j.status) && <button type="button" className="link" aria-label={`Retry job ${j.id}`} onClick={() => open(j, 'retry')}>Retry</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager meta={query.data.meta} page={page} setPage={setPage} noun="jobs" />
        </>
      )}

      <FormDialog dialogRef={dialog} title={target ? `${action === 'cancel' ? 'Cancel' : 'Retry'} job ${target.id}` : ''} error={error} busy={cancel.isPending || retry.isPending} submitLabel={action === 'cancel' ? 'Cancel job' : 'Retry job'} onSubmit={submit}>
        <p>{action === 'cancel' ? 'A queued job stops at once. A running job stops at its next check and keeps what it has already done.' : 'The job is queued again as a new job with the same parameters.'}</p>
      </FormDialog>
    </section>
  );
}
