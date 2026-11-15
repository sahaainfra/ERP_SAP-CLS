import { useRef, useState } from 'react';
import {
  useOpsAcknowledge, useOpsAlertRules, useOpsBaseline, useOpsChangeRequest, useOpsEvaluate, useOpsFollow, useOpsForceError, useOpsSlos, useOpsSummary, useOpsTrace, useOpsTraces,
} from '../api/index.js';
import { formatDateTime } from '../../../platform/format.js';
import { Field, FormDialog, Link, QueryState, Tile, can, errorInfo, usePageTitle } from './ui.jsx';
import PageHeader from '../../../platform/design/PageHeader.jsx';
import { KpiRow } from '../../../platform/design/Kpi.jsx';

const SLO_STATUS = { ok: ['chip-pass', 'Within objective'], at_risk: ['chip-never', 'At risk'], breached: ['chip-fail', 'Breached'], no_data: ['chip-not_applicable', 'No data yet'] };
const tileStatus = (s) => (s === 'breached' ? 'error' : s === 'at_risk' ? 'warn' : s === 'ok' ? 'ok' : 'neutral');
const ms = (v) => (v === null || v === undefined ? '-' : `${v} ms`);
const pct = (v) => (v === null || v === undefined ? '-' : `${v}%`);

function Sloes({ summary, canManage, onChange }) {
  const slos = useOpsSlos();
  const defs = new Map((slos.data ?? []).map((s) => [s.journey, s]));
  return (
    <section aria-labelledby="slo-title">
      <h2 id="slo-title">Service objectives for critical journeys</h2>
      <p className="muted small">Availability counts server errors only; latency is the stated percentile. The error budget is how many failures the objective allows over its window; when it is used up the journey is breached.</p>
      <div className="table-wrap">
        <table>
          <caption className="sr-only">Service-level objectives and how each journey is doing</caption>
          <thead><tr><th>Journey</th><th>Status</th><th className="num">Requests</th><th className="num">Availability</th><th className="num">Latency</th><th>Error budget used</th><th className="num">Burn (1 h)</th><th /></tr></thead>
          <tbody>
            {summary.slos.map((s) => {
              const [chip, label] = SLO_STATUS[s.status];
              return (
                <tr key={s.journey} data-testid={`slo-${s.journey}`}>
                  <td data-label="Journey"><strong>{s.label}</strong><div className="muted small">{s.windowDays} days</div></td>
                  <td data-label="Status"><span className={`chip ${chip}`}>{label}</span></td>
                  <td data-label="Requests" className="num">{s.requests}</td>
                  <td data-label="Availability" className="num">{pct(s.availabilityPct)}<div className="muted small">target {s.targetAvailabilityPct}%</div></td>
                  <td data-label="Latency" className="num">{ms(s.latencyMs)}<div className="muted small">p{s.latencyPercentile} target {s.targetLatencyMs} ms</div></td>
                  <td data-label="Error budget used"><progress max="100" value={Math.min(100, s.errorBudget.usedPct)} aria-label={`${s.label} error budget used`} /> {s.errorBudget.usedPct}%</td>
                  <td data-label="Burn" className="num">{s.burnRate1h}x</td>
                  <td data-label="Change"><button type="button" className="btn btn-small" disabled={!canManage || !defs.get(s.journey)} title={canManage ? '' : 'Needs core.ops.manage (IT Administrator)'} onClick={() => onChange('slo', defs.get(s.journey))}>Request change</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Alerts({ summary, canManage }) {
  const ack = useOpsAcknowledge();
  const rules = useOpsAlertRules();
  return (
    <section aria-labelledby="alert-title">
      <h2 id="alert-title">Alerts and recent incidents</h2>
      {summary.alerts.open.length === 0 && <p className="state state-warn" role="status" data-testid="no-open-alerts">No open alerts. Rules checked: {(rules.data ?? []).filter((r) => r.enabled).length} enabled.</p>}
      {summary.alerts.recent.length > 0 && (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Recent alerts, newest first</caption>
            <thead><tr><th>Fired</th><th>Rule</th><th>Severity</th><th>What happened</th><th>Told</th><th>State</th><th /></tr></thead>
            <tbody>
              {summary.alerts.recent.map((a) => (
                <tr key={a.id} data-testid={`alert-${a.id}`} className={a.status === 'OPEN' && a.severity === 'critical' ? 'row-bad' : ''}>
                  <td data-label="Fired">{formatDateTime(a.firedAt)}</td>
                  <td data-label="Rule"><code>{a.rule}</code></td>
                  <td data-label="Severity">{a.severity}</td>
                  <td data-label="What happened">{a.message}</td>
                  <td data-label="Told">{a.notified.length === 0 ? '-' : a.notified.map((n) => `${n.channel}: ${n.status.replace('_', ' ')}`).join(', ')}</td>
                  <td data-label="State">{a.status === 'OPEN' ? (a.acknowledgedBy ? `Open, seen by ${a.acknowledgedBy}` : 'Open') : `Resolved ${formatDateTime(a.resolvedAt)}`}</td>
                  <td data-label="Acknowledge">{a.status === 'OPEN' && !a.acknowledgedBy && <button type="button" className="btn btn-small" disabled={!canManage || ack.isPending} onClick={() => ack.mutate(a.id)}>Acknowledge</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RuleList({ canManage, onChange }) {
  const rules = useOpsAlertRules();
  return (
    <details className="card">
      <summary><strong>Alert rules</strong> {rules.data ? `(${rules.data.length})` : ''}</summary>
      <p className="muted small">Alerts go to the IT Administrator by email and WhatsApp. Sending is not connected yet, so alerts show here as "not configured" (defect D-047). Changing a rule is maker-checker: the IT Administrator asks, the System Administrator approves.</p>
      <QueryState query={rules} what="the alert rules" permission="core.ops.view" />
      {rules.data && (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Alert rules</caption>
            <thead><tr><th>Rule</th><th className="num">Threshold</th><th className="num">Window</th><th>Severity</th><th>Channels</th><th>On</th><th /></tr></thead>
            <tbody>
              {rules.data.map((r) => (
                <tr key={r.code} data-testid={`rule-${r.code}`}>
                  <td data-label="Rule"><code>{r.code}</code><div className="muted small">{r.description}</div></td>
                  <td data-label="Threshold" className="num">{r.threshold} {r.unit}</td>
                  <td data-label="Window" className="num">{r.windowMinutes} min</td>
                  <td data-label="Severity">{r.severity}</td>
                  <td data-label="Channels">{r.channels.join(', ') || 'none'}</td>
                  <td data-label="On">{r.enabled ? 'Yes' : 'No'}</td>
                  <td data-label="Change"><button type="button" className="btn btn-small" disabled={!canManage} onClick={() => onChange('alert_rule', r)}>Request change</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}

function Waterfall({ traceId }) {
  const trace = useOpsTrace(traceId);
  if (trace.isPending) return <p className="muted">Loading trace...</p>;
  if (trace.isError) return <p className="field-error" role="alert">{trace.error.message}</p>;
  const t = trace.data;
  const total = Math.max(1, t.durationMs);
  return (
    <div data-testid="waterfall">
      <p className="muted small">Trace <code>{t.traceId}</code>, {t.spans.length} spans, {t.durationMs} ms. Export: <a href={`/api/v1/core/ops/traces/${t.traceId}/otlp`} target="_blank" rel="noreferrer">OTLP JSON</a></p>
      <ul className="plain">
        {t.spans.map((s) => (
          <li key={s.spanId}>
            <span className="small">{s.name} ({s.kind}) {s.durationMs} ms {s.status === 'error' ? '- failed' : ''}</span>
            <div style={{ background: 'var(--erp-color-status-neutral-bg)', borderRadius: 3, height: 8 }} aria-hidden="true">
              <div style={{ marginLeft: `${Math.min(99, (s.offsetMs / total) * 100)}%`, width: `${Math.max(1, Math.min(100, (s.durationMs / total) * 100))}%`, height: 8, borderRadius: 3, background: s.status === 'error' ? 'var(--erp-color-status-error-solid)' : 'var(--erp-color-status-success-solid)' }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Traces() {
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState('');
  const traces = useOpsTraces({ status });
  return (
    <details className="card">
      <summary><strong>Recent traces</strong></summary>
      <label className="field field-inline"><span>Show</span>
        <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All traces</option><option value="error">Failed only</option></select>
      </label>
      <QueryState query={traces} what="traces" permission="core.ops.view" />
      {traces.data?.length === 0 && <p className="muted">No traces held. They are kept in memory and reset when the server restarts.</p>}
      {traces.data?.length > 0 && (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Recent traces</caption>
            <thead><tr><th>Root</th><th className="num">Duration</th><th>Status</th><th>Correlation ID</th><th /></tr></thead>
            <tbody>
              {traces.data.map((t) => (
                <tr key={t.traceId}>
                  <td data-label="Root">{t.name}</td><td data-label="Duration" className="num">{t.durationMs} ms</td><td data-label="Status">{t.status}</td>
                  <td data-label="Correlation ID"><code>{t.correlationId}</code></td>
                  <td data-label="Open"><button type="button" className="btn btn-small" onClick={() => setOpen(t.traceId)}>Waterfall</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <Waterfall traceId={open} />}
    </details>
  );
}

function Follow({ initial }) {
  const [id, setId] = useState(initial ?? '');
  const [asked, setAsked] = useState(initial ?? '');
  const f = useOpsFollow(asked);
  return (
    <section aria-labelledby="follow-title" className="card">
      <h2 id="follow-title">Follow a correlation ID</h2>
      <p className="muted small">Every error shown to a user carries a correlation ID. Paste it to see the request, the events and jobs it caused, and the log lines.</p>
      <form className="row" onSubmit={(e) => { e.preventDefault(); setAsked(id.trim()); }}>
        <label className="field"><span>Correlation ID</span><input value={id} onChange={(e) => setId(e.target.value)} placeholder="for example forced-error-0001" /></label>
        <button type="submit" className="btn" disabled={id.trim().length < 8}>Follow</button>
      </form>
      {asked && <QueryState query={f} what="that correlation ID" permission="core.ops.view" />}
      {f.data && (
        <div data-testid="follow-result">
          <p>{f.data.logs.length} log lines, {f.data.traces.length} trace(s), {f.data.events.length} event(s), {f.data.jobs.length} job(s), {f.data.clientReports.length} browser report(s).</p>
          {f.data.events.length > 0 && <p className="small">Events: {f.data.events.map((e) => <code key={e.id}> {e.type}</code>)}</p>}
          {f.data.jobs.length > 0 && <p className="small">Jobs: {f.data.jobs.map((j) => <code key={j.id}> {j.type} ({j.status})</code>)}</p>}
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Log lines for the correlation ID</caption>
              <thead><tr><th>Time</th><th>Level</th><th>Message</th></tr></thead>
              <tbody>{f.data.logs.map((l, i) => <tr key={i}><td data-label="Time">{l.time}</td><td data-label="Level">{l.level}</td><td data-label="Message">{l.msg}{l.error ? ` - ${l.error}` : ''}</td></tr>)}</tbody>
            </table>
          </div>
          {f.data.traces[0] && <Waterfall traceId={f.data.traces[0].traceId} />}
        </div>
      )}
    </section>
  );
}

function Baseline() {
  const b = useOpsBaseline();
  return (
    <details className="card">
      <summary><strong>Performance baseline</strong> {b.data?.available ? `(recorded ${formatDateTime(b.data.generatedAt)})` : ''}</summary>
      <QueryState query={b} what="the baseline" permission="core.ops.view" />
      {b.data && !b.data.available && <p className="muted">No baseline is stored. Run <code>npm run erp:perf-baseline -- --save</code>.</p>}
      {b.data?.available && (
        <>
          <p className="muted small">Recorded on {b.data.environment.cpus} CPUs, Node {b.data.environment.node}, with {b.data.dataset.events} events, {b.data.dataset.bills} bills, {b.data.dataset.documents} documents. Compared later by part 30.06; numbers only compare on a similar machine.</p>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Baseline latency by journey</caption>
              <thead><tr><th>Journey</th><th className="num">Req/s</th><th className="num">p50</th><th className="num">p95</th><th className="num">p99</th><th className="num">Standard</th><th>Result</th></tr></thead>
              <tbody>
                {b.data.journeys.map((j) => (
                  <tr key={j.id} data-testid={`baseline-${j.id}`}>
                    <td data-label="Journey">{j.label}</td><td data-label="Req/s" className="num">{j.requestsPerSecond}</td><td data-label="p50" className="num">{j.p50Ms} ms</td>
                    <td data-label="p95" className="num">{j.p95Ms} ms</td><td data-label="p99" className="num">{j.p99Ms} ms</td><td data-label="Standard" className="num">{j.standardMs} ms</td>
                    <td data-label="Result"><span className={`chip ${j.meetsStandard ? 'chip-pass' : 'chip-fail'}`}>{j.meetsStandard ? 'Meets' : 'Misses'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </details>
  );
}

export default function OperationsHealthPage({ session }) {
  usePageTitle('Operations Health');
  const summary = useOpsSummary();
  const evaluate = useOpsEvaluate();
  const forceError = useOpsForceError();
  const change = useOpsChangeRequest();
  const dialog = useRef(null);
  const [target, setTarget] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const [forced, setForced] = useState('');
  const canManage = can(session, 'core.ops.manage');
  const s = summary.data;

  const openChange = (kind, item) => {
    setError(null);
    setTarget({ kind, item });
    dialog.current?.showModal();
  };

  const submitChange = async (f) => {
    setError(null);
    const num = (n) => (String(f.get(n)) === '' ? undefined : Number(f.get(n)));
    const changes = target.kind === 'alert_rule'
      ? { threshold: num('threshold'), windowMinutes: num('windowMinutes'), channels: ['email', 'whatsapp'].filter((c) => f.get(`ch_${c}`) === 'on'), enabled: f.get('enabled') === 'on' }
      : { targetLatencyMs: num('targetLatencyMs'), targetAvailabilityBp: Math.round(Number(f.get('targetAvailabilityPct')) * 100), windowDays: num('windowDays'), enabled: f.get('enabled') === 'on' };
    try {
      const key = target.kind === 'alert_rule' ? target.item.code : target.item.journey;
      await change.mutateAsync({ kind: target.kind, key, changes: Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined && !Number.isNaN(v))), reason: String(f.get('reason')) });
      dialog.current?.close();
      setNotice('Change requested. The System Administrator approves it under Approvals; nothing changes until then.');
    } catch (err) {
      setError(errorInfo(err));
    }
  };

  const runForce = async () => {
    setForced('');
    try {
      await forceError.mutateAsync();
    } catch (err) {
      setForced(err.correlationId ?? '');
    }
  };

  const i = target?.item;
  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Operations &rsaquo; Operations Health</nav>
      <PageHeader id="page-title" title={"Operations Health"} actions={<><button type="button" className="btn" disabled={!canManage || evaluate.isPending} title={canManage ? '' : 'Needs core.ops.manage (IT Administrator)'} onClick={() => evaluate.mutate()}>Check alerts now</button></>} subtitle={<>Refreshes every 10 seconds. Request and error rates, latency, queues, database and the objectives of the critical journeys. <Link to="/admin/operations">Events &amp; Jobs Monitor</Link></>} />
      <p role="status" className="notice">{notice}</p>
      <QueryState query={summary} what="operations health" permission="core.ops.view" />
      {s && (
        <>
          <KpiRow role="group" aria-label="Key figures">
            <Tile label="Requests per minute (5 min)" value={s.http.last5m.perMinute} testId="tile-rpm" />
            <Tile label="Server errors (5 min)" value={`${s.http.last5m.errorRatePct}%`} status={s.http.last5m.serverErrors > 0 ? 'error' : 'ok'} hint={`${s.http.last5m.serverErrors} of ${s.http.last5m.requests}`} testId="tile-errors" />
            <Tile label="Latency p95 (5 min)" value={ms(s.http.last5m.p95)} hint={`p50 ${ms(s.http.last5m.p50)}`} testId="tile-p95" />
            <Tile label="Open alerts" value={s.alerts.open.length} status={s.alerts.open.length > 0 ? 'error' : 'ok'} testId="tile-alerts" />
            <Tile label="Events waiting" value={s.system.queues.outboxUnpublished} status={s.system.queues.outboxUnpublished > 100 ? 'warn' : 'ok'} testId="tile-outbox" />
            <Tile label="Dead letters" value={s.system.queues.deadLetters} status={s.system.queues.deadLetters > 0 ? 'error' : 'ok'} to="/admin/operations/dead-letters" testId="tile-dlq" />
            <Tile label="Jobs queued / running" value={`${s.system.queues.jobsQueued} / ${s.system.queues.jobsRunning}`} to="/admin/operations/jobs" testId="tile-jobs" />
            <Tile label="Database" value={`${s.system.database.sizeMb} MB`} hint={`${s.system.database.queries} queries, ${s.system.database.slowQueries} slow`} testId="tile-db" />
            <Tile label="Disk free" value={s.system.disk ? `${s.system.disk.freePct}%` : '-'} status={s.system.disk && s.system.disk.freePct < 15 ? 'error' : 'ok'} testId="tile-disk" />
            <Tile label="Browser errors (1 h)" value={s.clientReports.lastHour.js_error ?? 0} status={(s.clientReports.lastHour.js_error ?? 0) > 0 ? 'warn' : 'ok'} hint={`${s.clientReports.lastHour.api_failure ?? 0} failed calls`} testId="tile-browser" />
          </KpiRow>
          <KpiRow role="group" aria-label="Objectives at a glance">
            {s.slos.filter((x) => x.enabled).map((x) => <Tile key={x.journey} label={x.label} value={SLO_STATUS[x.status][1]} status={tileStatus(x.status)} />)}
          </KpiRow>

          <Sloes summary={s} canManage={canManage} onChange={openChange} />
          <Alerts summary={s} canManage={canManage} />

          <h2>Busiest and slowest routes, last hour</h2>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Routes by volume with latency and errors</caption>
              <thead><tr><th>Route</th><th className="num">Requests</th><th className="num">p50</th><th className="num">p95</th><th className="num">Server errors</th></tr></thead>
              <tbody>
                {s.http.topRoutes.map((r) => <tr key={r.route}><td data-label="Route"><code>{r.route}</code></td><td data-label="Requests" className="num">{r.requests}</td><td data-label="p50" className="num">{ms(r.p50)}</td><td data-label="p95" className="num">{ms(r.p95)}</td><td data-label="Server errors" className="num">{r.serverErrors}</td></tr>)}
              </tbody>
            </table>
          </div>

          <details className="card">
            <summary><strong>Database and background work</strong></summary>
            <p className="muted small">{s.system.database.engine}. {s.system.database.connections.note}. Cache hit rate, parameters: {pct(s.system.caches?.parameters?.hitRatePct)}. Socket connections: not measured, there is no socket server yet.</p>
            {s.slowQueries.length === 0 ? <p className="muted">No slow queries recorded since the server started.</p> : (
              <div className="table-wrap">
                <table>
                  <caption className="sr-only">Slow queries</caption>
                  <thead><tr><th>Statement (values removed)</th><th className="num">Took</th></tr></thead>
                  <tbody>{s.slowQueries.map((q, n) => <tr key={n}><td data-label="Statement"><code>{q.sql}</code></td><td data-label="Took" className="num">{q.ms} ms</td></tr>)}</tbody>
                </table>
              </div>
            )}
          </details>

          <RuleList canManage={canManage} onChange={openChange} />
          <Traces />
          <Follow />
          <Baseline />

          <section aria-labelledby="diag-title" className="card">
            <h2 id="diag-title">Test the trail</h2>
            <p className="muted small">Fails on purpose with a harmless diagnostic: it logs, raises an event and queues a job, then returns an error. Follow the correlation ID it shows to see every step.</p>
            <button type="button" className="btn" disabled={!canManage || forceError.isPending} title={canManage ? '' : 'Needs core.ops.manage (IT Administrator)'} onClick={runForce}>Force a test error</button>
            {forced && <p role="status" data-testid="forced-id">Test error raised. Correlation ID: <code>{forced}</code></p>}
          </section>
          <p className="muted small">Generated {formatDateTime(s.generatedAt)}. Uptime {Math.round(s.process.uptimeSeconds / 60)} min, memory {s.process.rssMb} MB, event-loop lag {s.process.eventLoopLagMs} ms.</p>
        </>
      )}

      <FormDialog dialogRef={dialog} title={target?.kind === 'alert_rule' ? `Request a change to ${i?.code}` : `Request a change to ${i?.label}`} error={error} busy={change.isPending} submitLabel="Request change" onSubmit={submitChange}>
        <p className="muted">The System Administrator must approve this before it takes effect.</p>
        {target?.kind === 'alert_rule' && i && (
          <>
            <Field label={`Threshold (${i.unit})`} name="threshold" error={error}><input name="threshold" type="number" min="0" defaultValue={i.threshold} /></Field>
            <Field label="Window (minutes)" name="windowMinutes" error={error}><input name="windowMinutes" type="number" min="1" defaultValue={i.windowMinutes} /></Field>
            <fieldset><legend>Tell</legend>
              <label className="check"><input name="ch_email" type="checkbox" defaultChecked={i.channels.includes('email')} /> Email</label>
              <label className="check"><input name="ch_whatsapp" type="checkbox" defaultChecked={i.channels.includes('whatsapp')} /> WhatsApp</label>
            </fieldset>
          </>
        )}
        {target?.kind === 'slo' && i && (
          <>
            <Field label="Target latency (ms)" name="targetLatencyMs" error={error}><input name="targetLatencyMs" type="number" min="10" defaultValue={i.targetLatencyMs} /></Field>
            <Field label="Target availability (%)" name="targetAvailabilityPct" error={error}><input name="targetAvailabilityPct" type="number" min="50" max="100" step="0.01" defaultValue={i.targetAvailabilityBp / 100} /></Field>
            <Field label="Window (days)" name="windowDays" error={error}><input name="windowDays" type="number" min="1" max="90" defaultValue={i.windowDays} /></Field>
          </>
        )}
        {i && <label className="check"><input name="enabled" type="checkbox" defaultChecked={i.enabled} /> Enabled</label>}
      </FormDialog>
    </section>
  );
}
