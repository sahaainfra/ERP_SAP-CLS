import { useRef, useState } from 'react';
import { useDeadLetters, useDiscard, useRedrive } from '../api/index.js';
import { formatDateTime, toCsv } from '../../../platform/format.js';
import { FormDialog, Link, Pager, QueryState, can, downloadCsv, errorInfo, usePageTitle } from './ui.jsx';

const STATUSES = [['DEAD', 'Dead letters'], ['DISCARDED', 'Discarded'], ['PENDING', 'Still retrying']];

export default function DeadLettersPage({ session }) {
  usePageTitle('Dead-Letter Queue');
  const [status, setStatus] = useState('DEAD');
  const [page, setPage] = useState(1);
  const query = useDeadLetters({ page, status });
  const redrive = useRedrive();
  const discard = useDiscard();
  const [target, setTarget] = useState(null);
  const [action, setAction] = useState('redrive');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const dialog = useRef(null);
  const canAct = can(session, 'core.events.redrive');
  const rows = query.data?.data ?? [];

  const open = (row, kind) => {
    setTarget(row);
    setAction(kind);
    setError(null);
    dialog.current?.showModal();
  };
  const submit = async (f) => {
    setError(null);
    const mutation = action === 'redrive' ? redrive : discard;
    try {
      await mutation.mutateAsync({ id: target.id, reason: String(f.get('reason')) });
      dialog.current?.close();
      setNotice(action === 'redrive' ? `Event for ${target.consumer} is back in the queue.` : `Event for ${target.consumer} was discarded.`);
    } catch (err) {
      setError(errorInfo(err));
    }
  };

  const exportCsv = () =>
    downloadCsv('dead-letters.csv', toCsv(
      ['Consumer', 'Event type', 'Event ID', 'Status', 'Attempts', 'Last error', 'Updated (IST)'],
      rows.map((r) => [r.consumer, r.eventType, r.eventId, r.status, r.attempts, r.lastError, formatDateTime(r.updatedAt ?? r.createdAt)]),
    ));

  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Operations &rsaquo; Dead-Letter Queue</nav>
      <div className="page-head"><h1 id="page-title">Dead-Letter Queue</h1></div>
      <p className="muted">Events a consumer could not process after every attempt. Fix the cause, then re-drive; or discard with a reason if the event no longer matters. Payloads are masked. <Link to="/admin/operations">Back to the monitor</Link></p>
      <div className="toolbar">
        <label className="field field-inline"><span>Show</span>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} data-testid="dlq-status">
            {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <button type="button" className="btn" onClick={exportCsv} disabled={rows.length === 0}>Export CSV</button>
      </div>
      <p role="status" className="notice">{notice}</p>
      <QueryState query={query} what="the dead-letter queue" permission="core.events.view" />
      {query.data && rows.length === 0 && (
        <div className="state"><h2>{status === 'DEAD' ? 'No dead letters' : 'Nothing here'}</h2><p>{status === 'DEAD' ? 'Every event has been processed or is still being retried.' : 'No events in this state.'}</p></div>
      )}
      {rows.length > 0 && (
        <>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Failed event deliveries</caption>
              <thead><tr><th>Consumer</th><th>Event</th><th className="num">Attempts</th><th>Last error</th><th>Updated (IST)</th><th>Payload (masked)</th><th /></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} data-testid={`letter-${r.id}`}>
                    <td data-label="Consumer"><code>{r.consumer}</code></td>
                    <td data-label="Event"><code>{r.eventType}</code><div className="muted small">{r.eventId}</div></td>
                    <td data-label="Attempts" className="num">{r.attempts}</td>
                    <td data-label="Last error">{r.lastError}</td>
                    <td data-label="Updated">{formatDateTime(r.updatedAt ?? r.createdAt)}{r.resolvedBy ? <div className="muted small">by {r.resolvedBy}</div> : null}</td>
                    <td data-label="Payload"><details><summary>Show</summary><pre className="payload">{JSON.stringify(r.event?.data ?? {}, null, 2)}</pre></details></td>
                    <td>
                      {r.status === 'DEAD' && canAct && (
                        <>
                          <button type="button" className="link" aria-label={`Re-drive the event for ${r.consumer}`} onClick={() => open(r, 'redrive')}>Re-drive</button>
                          <button type="button" className="link" aria-label={`Discard the event for ${r.consumer}`} onClick={() => open(r, 'discard')}>Discard</button>
                        </>
                      )}
                      {r.status === 'DEAD' && !canAct && <span className="muted small" title="Needs core.events.redrive (IT Administrator)">View only</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager meta={query.data.meta} page={page} setPage={setPage} noun="events" />
        </>
      )}

      <FormDialog dialogRef={dialog} title={target ? `${action === 'redrive' ? 'Re-drive' : 'Discard'} the event for ${target.consumer}` : ''} error={error} busy={redrive.isPending || discard.isPending} submitLabel={action === 'redrive' ? 'Re-drive' : 'Discard'} onSubmit={submit}>
        <p>{action === 'redrive' ? 'The event is queued again with a fresh set of attempts. Do this after the cause is fixed.' : 'The event stays in the table as discarded, with your name and reason. It will not be processed.'}</p>
      </FormDialog>
    </section>
  );
}
