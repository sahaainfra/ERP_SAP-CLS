import { useRef, useState } from 'react';
import { useEventMetrics, useEvents, useEventTypes, useReplay } from '../api/index.js';
import { formatDateTime } from '../../../platform/format.js';
import { Field, FormDialog, Link, Pager, QueryState, Tile, can, errorInfo, usePageTitle } from './ui.jsx';

const lagStatus = (s) => (s > 300 ? 'error' : s > 60 ? 'warn' : 'ok');
const seconds = (s) => (s < 120 ? `${s} s` : `${Math.round(s / 60)} min`);

function EventLog() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const events = useEvents({ page, q });
  return (
    <section aria-labelledby="log-title">
      <h2 id="log-title">Recent events</h2>
      <div className="toolbar">
        <label className="field field-inline"><span className="sr-only">Search event types</span>
          <input type="search" placeholder="Search event type" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </label>
      </div>
      <QueryState query={events} what="events" permission="core.events.view" />
      {events.data?.data.length === 0 && <div className="state"><h2>No events</h2><p>{q ? 'Nothing matches that search.' : 'No event has been raised yet.'}</p></div>}
      {events.data?.data.length > 0 && (
        <>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Recent events, newest first</caption>
              <thead><tr><th>Event</th><th>When (IST)</th><th>Entity</th><th>By</th><th>State</th><th>Data (masked)</th></tr></thead>
              <tbody>
                {events.data.data.map((e) => (
                  <tr key={e.id} data-testid={`event-${e.id}`}>
                    <td data-label="Event"><code>{e.type}</code><div className="muted small">v{e.version}</div></td>
                    <td data-label="When">{formatDateTime(e.occurredAt)}</td>
                    <td data-label="Entity">{e.entity} {e.entityId}</td>
                    <td data-label="By">{e.actorId}</td>
                    <td data-label="State"><span className={`chip ${e.published ? 'chip-on' : 'chip-off'}`}>{e.published ? 'Published' : 'Waiting'}</span></td>
                    <td data-label="Data"><details><summary>Show</summary><pre className="payload">{JSON.stringify(e.data, null, 2)}</pre></details></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager meta={events.data.meta} page={page} setPage={setPage} noun="events" />
        </>
      )}
    </section>
  );
}

function Catalogue() {
  const types = useEventTypes();
  return (
    <details className="card">
      <summary><strong>Event catalogue</strong> {types.data ? `(${types.data.length} types)` : ''}</summary>
      <QueryState query={types} what="the event catalogue" permission="core.events.view" />
      {types.data && (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Registered event types and their versions</caption>
            <thead><tr><th>Type</th><th>Version</th><th>Owner</th><th>Meaning</th></tr></thead>
            <tbody>
              {types.data.map((t) => (
                <tr key={`${t.type}-${t.version}`}><td data-label="Type"><code>{t.type}</code></td><td data-label="Version">{t.version}</td><td data-label="Owner">{t.owner}</td><td data-label="Meaning">{t.description}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}

export default function OperationsPage({ session }) {
  usePageTitle('Events & Jobs Monitor');
  const metrics = useEventMetrics();
  const replay = useReplay();
  const dialog = useRef(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const m = metrics.data;
  const canReplay = can(session, 'core.events.replay');

  const submitReplay = async (f) => {
    setError(null);
    const types = String(f.get('types')).split(',').map((t) => t.trim()).filter(Boolean);
    try {
      const job = await replay.mutateAsync({
        types: types.length ? types : ['*'],
        from: String(f.get('from')) || undefined,
        to: String(f.get('to')) || undefined,
        consumer: String(f.get('consumer')) || undefined,
        reset: f.get('reset') === 'on',
        reason: String(f.get('reason')),
      });
      dialog.current?.close();
      setNotice(`Replay queued as job ${job.id}. Follow it under Background Jobs.`);
    } catch (err) {
      setError(errorInfo(err));
    }
  };

  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Operations &rsaquo; Events &amp; Jobs Monitor</nav>
      <div className="page-head">
        <h1 id="page-title">Events &amp; Jobs Monitor</h1>
        <button type="button" className="btn" disabled={!canReplay} title={canReplay ? '' : 'Needs core.events.replay (IT Administrator)'} onClick={() => { setError(null); dialog.current?.showModal(); }}>Replay events</button>
      </div>
      <p className="muted">Refreshes every few seconds. Events are written with the business change; the relay hands each one to its consumers, which retry with back-off and end up in the dead-letter queue if they keep failing.</p>
      <p role="status" className="notice">{notice}</p>
      <QueryState query={metrics} what="the monitor" permission="core.events.view" />
      {m && (
        <>
          <div className="tiles" role="group" aria-label="Key figures">
            <Tile label="Events, last hour" value={m.events.lastHour} testId="tile-hour" />
            <Tile label="Events, last 24 hours" value={m.events.lastDay} testId="tile-day" />
            <Tile label="Waiting to be relayed" value={m.events.unpublished} status={m.events.unpublished > 0 ? lagStatus(m.events.relayLagSeconds) : 'ok'} hint={`oldest ${seconds(m.events.relayLagSeconds)}`} testId="tile-unpublished" />
            <Tile label="Deliveries pending" value={m.inbox.pending} status={m.inbox.pending > 0 ? lagStatus(m.inbox.deliveryLagSeconds) : 'ok'} hint={`lag ${seconds(m.inbox.deliveryLagSeconds)}`} testId="tile-pending" />
            <Tile label="Dead letters" value={m.inbox.dead} status={m.inbox.dead > 0 ? 'error' : 'ok'} to="/admin/operations/dead-letters" hint="open the queue" testId="tile-dead" />
            <Tile label="Background jobs" value="Open" to="/admin/operations/jobs" hint="status, progress, logs" />
          </div>

          {m.events.unregisteredTypes.length > 0 && (
            <p className="state state-warn" role="status">
              Event types not in the catalogue (their payloads are not validated): {m.events.unregisteredTypes.map((t) => <code key={t}> {t}</code>)}
            </p>
          )}

          <h2>Consumers</h2>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Consumers and their delivery counts</caption>
              <thead><tr><th>Consumer</th><th>Listens to</th><th className="num">Pending</th><th className="num">Processed</th><th className="num">Dead</th></tr></thead>
              <tbody>
                {m.consumers.map((c) => (
                  <tr key={c.name} data-testid={`consumer-${c.name}`}>
                    <td data-label="Consumer"><code>{c.name}</code></td><td data-label="Listens to">{c.patterns.join(', ')}</td>
                    <td data-label="Pending" className="num">{c.pending}</td><td data-label="Processed" className="num">{c.processed}</td>
                    <td data-label="Dead" className="num">{c.dead > 0 ? <Link to="/admin/operations/dead-letters">{c.dead}</Link> : 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2>Busiest event types, last 24 hours</h2>
          {m.events.byType.length === 0 ? <p className="muted">No events in the last 24 hours.</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Event type</th><th className="num">Events</th></tr></thead>
                <tbody>{m.events.byType.map((t) => <tr key={t.type}><td data-label="Event type"><code>{t.type}</code></td><td data-label="Events" className="num">{t.n}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          <p className="muted small">Generated {formatDateTime(m.generatedAt)}.</p>
        </>
      )}

      <EventLog />
      <Catalogue />

      <FormDialog dialogRef={dialog} title="Replay events" error={error} busy={replay.isPending} submitLabel="Queue replay" onSubmit={submitReplay}>
        <p className="muted">Re-runs past events through consumers to rebuild a projection, as a background job. Notifications and other outside effects are suppressed.</p>
        <Field label="Event types" name="types" error={error} hint="Comma separated, for example core.sample_document.* (empty means all)"><input name="types" defaultValue="core.sample_document.*" /></Field>
        <Field label="From date" name="from" error={error}><input name="from" type="date" /></Field>
        <Field label="To date" name="to" error={error}><input name="to" type="date" /></Field>
        <Field label="Consumer" name="consumer" error={error} hint="Leave empty for every consumer">
          <select name="consumer" defaultValue="">
            <option value="">All consumers</option>
            {(m?.consumers ?? []).map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
        </Field>
        <label className="check"><input name="reset" type="checkbox" /> Empty the consumer&apos;s projection first</label>
      </FormDialog>
    </section>
  );
}
