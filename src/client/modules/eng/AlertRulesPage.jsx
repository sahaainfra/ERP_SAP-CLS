import { useState } from 'react';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDateTime } from '../../platform/format.js';
import { useAdoptRule, useDryRun, useEnableRule, useRules, useRuns, useRunRule } from '../../platform/alerts/api.js';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { OUTCOME, SEVERITY, scheduleText } from './alerts-common.js';

// Alert Rules (part 04.09, section 7.1): the rules of the company with their state, the switch on and off, a dry-run that shows what a rule would do now, a run by hand, and the log of the runs;
// below them the standard library, from which a company takes a rule when its module is live. A rule that sends something outside waits for approval before it is in force.
const triggerText = (r) => (r.triggerType === 'EVENT' ? `when ${r.eventType} happens` : `${scheduleText(r.schedule)}, looking at ${r.dataset}`);

function DryRunResult({ out, onClose }) {
  return (
    <section className="card" aria-label="Dry-run" data-testid="dry-run">
      <div className="wf-inline"><h3>What it would do now</h3><button type="button" className="btn btn-small" onClick={onClose}>Close</button></div>
      {out.error && <p role="alert" className="error">{out.error}</p>}
      <p data-testid="dry-summary">Looked at {out.looked} record(s): <strong>{out.matched}</strong> match; <strong>{out.wouldCreate}</strong> new alert(s), <strong>{out.wouldRepeat}</strong> repeat(s), <strong>{out.throttled}</strong> held back by the window. Nothing was written.</p>
      {out.items.length > 0 && <div className="table-wrap" tabIndex={0} role="region" aria-label="What would happen">
        <table className="grid"><thead><tr><th>Record</th><th>Message</th><th>Outcome</th><th>Actions</th></tr></thead>
          <tbody>{out.items.map((i) => <tr key={`${i.entity}-${i.entityId}`}><th scope="row" data-label="Record">{i.label}</th><td data-label="Message">{i.message}</td><td data-label="Outcome">{OUTCOME[i.outcome]}</td><td data-label="Actions" className="small">{i.actions.join('; ') || 'none'}</td></tr>)}</tbody></table>
      </div>}
    </section>
  );
}

export default function AlertRulesPage() {
  usePageTitle('Alert Rules');
  const q = useRules();
  const [logCode, setLogCode] = useState('');
  const runs = useRuns({ code: logCode, limit: 10 });
  const enable = useEnableRule();
  const run = useRunRule();
  const dry = useDryRun();
  const adopt = useAdoptRule();
  const [dryOut, setDryOut] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState(null);
  const [adopting, setAdopting] = useState(null);
  const [reason, setReason] = useState('');
  const [filter, setFilter] = useState('');
  if (q.error?.status === 403) return <NoPermission what="the alert rules" permission="alr.rule.view" />;
  if (q.isPending) return <section aria-labelledby="ar-title"><h1 id="ar-title">Alert Rules</h1><Skeleton label="Loading the rules" rows={4} /></section>;
  if (q.isError) return <ErrorState title="The rules could not be loaded" error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const match = (r) => !filter || `${r.code} ${r.name} ${r.ownerModule}`.toLowerCase().includes(filter.toLowerCase());
  const doEnable = (r, on) => { setError(null); setNotice(''); enable.mutate({ code: r.code, enabled: on, reason: on ? undefined : 'Switched off from the rules list' }, { onSuccess: () => setNotice(`${r.code} is ${on ? 'on' : 'off'}.${on ? '' : ' Its alerts stay.'}`), onError: (e) => setError(errorInfo(e)) }); };
  const doRun = (r) => { setError(null); run.mutate(r.code, { onSuccess: (o) => setNotice(`${r.code} ran: ${o.matched} matched, ${o.created} new alert(s), ${o.throttled} held back${o.errors ? `, ${o.errors} error(s)` : ''}.`), onError: (e) => setError(errorInfo(e)) }); };
  const doDry = (r) => { setError(null); dry.mutate({ code: r.code }, { onSuccess: setDryOut, onError: (e) => setError(errorInfo(e)) }); };
  const doAdopt = (e) => { e.preventDefault(); setError(null); adopt.mutate({ code: adopting, reason }, { onSuccess: (o) => { setNotice(o.status === 'PENDING' ? 'Sent for approval.' : `${adopting} is now one of your rules.`); setAdopting(null); setReason(''); }, onError: (er) => setError(errorInfo(er)) }); };
  return (
    <section aria-labelledby="ar-title" data-testid="alert-rules">
      <h1 id="ar-title">Alert Rules</h1>
      <p className="muted">Rules watch events and records and raise alerts, tell people, make tasks or escalate. A rule that sends messages outside needs the approval of the process owner and the system administrator.</p>
      {notice && <p role="status" className="notice" data-testid="ar-notice">{notice}</p>}
      {error?.form && <p role="alert" className="error" data-testid="ar-error">{error.form}</p>}
      <div className="srch-tools">
        <label className="field"><span>Find a rule</span><input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} /></label>
        {d.canEdit && <button type="button" className="btn btn-primary" onClick={() => navigateTo('/admin/alert-rules/editor')}>New rule</button>}
      </div>
      {dryOut && <DryRunResult out={dryOut} onClose={() => setDryOut(null)} />}
      <h2>Your rules</h2>
      {d.rows.filter(match).length === 0 ? <EmptyState title="No rule yet" message="Take a standard rule from the library below, or build your own." action={d.canEdit ? { label: 'New rule', onClick: () => navigateTo('/admin/alert-rules/editor') } : undefined} /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Rules">
          <table className="grid">
            <thead><tr><th>Rule</th><th>Looks at</th><th>Severity</th><th>State</th><th className="num">Open alerts</th><th>Last run</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{d.rows.filter(match).map((r) => (
              <tr key={r.code} data-testid={`rule-${r.code}`}>
                <th scope="row" data-label="Rule">{r.name}<br /><span className="muted small">{r.code} v{r.version}</span></th>
                <td data-label="Looks at" className="small">{triggerText(r)}</td>
                <td data-label="Severity"><StatusBadge status={SEVERITY[r.severity][0]} label={SEVERITY[r.severity][1]} /></td>
                <td data-label="State">{r.status === 'PENDING' ? <StatusBadge status="submitted" label="Waiting for approval" /> : r.enabled ? <StatusBadge status="approved" label="On" /> : <StatusBadge status="cancelled" label={r.awaiting ? `Waiting for ${r.awaiting}` : 'Off'} />}{r.external && <><br /><span className="muted small">sends messages outside</span></>}</td>
                <td className="num" data-label="Open alerts">{r.openAlerts}</td>
                <td data-label="Last run" className="small">{r.lastRun ? `${formatDateTime(r.lastRun.started_at)}: ${r.lastRun.matched} matched${r.lastRun.errors ? `, ${r.lastRun.errors} error(s)` : ''}` : 'Not yet'}</td>
                <td data-label="Actions">
                  <button type="button" className="btn btn-small" onClick={() => doDry(r)} aria-label={`Dry-run ${r.code}`}>Dry-run</button>
                  {d.canEdit && r.status === 'ACTIVE' && <>
                    <button type="button" className="btn btn-small" disabled={enable.isPending} onClick={() => doEnable(r, !r.enabled)} aria-label={`${r.enabled ? 'Switch off' : 'Switch on'} ${r.code}`}>{r.enabled ? 'Switch off' : 'Switch on'}</button>
                    {r.enabled && <button type="button" className="btn btn-small" disabled={run.isPending} onClick={() => doRun(r)} aria-label={`Run ${r.code} now`}>Run now</button>}
                  </>}
                  {d.canEdit && <button type="button" className="btn btn-small" onClick={() => navigateTo(`/admin/alert-rules/editor?code=${r.code}`)} aria-label={`Change ${r.code}`}>Change</button>}
                  <button type="button" className="btn btn-small" onClick={() => setLogCode(logCode === r.code ? '' : r.code)} aria-expanded={logCode === r.code}>Log</button>
                </td>
              </tr>))}</tbody>
          </table>
        </div>)}
      <section aria-label="Run log" data-testid="run-log">
        <h2>Run log{logCode ? `: ${logCode}` : ''}</h2>
        {runs.isPending ? <Skeleton label="Loading the log" rows={2} /> : runs.data?.rows.length === 0 ? <p className="muted">Nothing has run yet.</p> : (
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Runs">
            <table className="grid"><thead><tr><th>When</th><th>Rule</th><th>How</th><th className="num">Matched</th><th className="num">New</th><th className="num">Held back</th><th className="num">Actions</th><th>Errors</th></tr></thead>
              <tbody>{runs.data?.rows.map((r) => <tr key={r.id}><td data-label="When">{formatDateTime(r.startedAt)}</td><th scope="row" data-label="Rule">{r.code}</th><td data-label="How">{r.trigger}</td><td className="num" data-label="Matched">{r.matched}</td><td className="num" data-label="New">{r.created}</td><td className="num" data-label="Held back">{r.throttled}</td><td className="num" data-label="Actions">{r.actions}</td><td data-label="Errors" className={r.errors ? 'error small' : 'small'}>{r.errors ? r.error ?? r.errors : ''}</td></tr>)}</tbody></table>
          </div>)}
      </section>
      <h2>The standard library</h2>
      {adopting && (
        <form className="card wf-inline" onSubmit={doAdopt} aria-label={`Take ${adopting}`}>
          <Field label={`Why does the company take ${adopting}?`} name="reason" error={error}><input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></Field>
          <button type="submit" className="btn btn-primary" disabled={adopt.isPending || reason.trim().length < 5}>Take this rule</button>
          <button type="button" className="btn" onClick={() => setAdopting(null)}>Cancel</button>
        </form>)}
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Library">
        <table className="grid">
          <thead><tr><th>Rule</th><th>Module</th><th>Looks at</th><th>Severity</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{d.library.filter(match).map((r) => (
            <tr key={r.code} data-testid={`lib-${r.code}`}>
              <th scope="row" data-label="Rule">{r.name}<br /><span className="muted small">{r.description}</span></th><td data-label="Module">{r.ownerModule}</td><td data-label="Looks at" className="small">{triggerText(r)}</td>
              <td data-label="Severity"><StatusBadge status={SEVERITY[r.severity][0]} label={SEVERITY[r.severity][1]} /></td>
              <td data-label="Actions">{r.adopted ? <span className="muted small">Taken</span> : d.canEdit ? <button type="button" className="btn btn-small" onClick={() => { setAdopting(r.code); setReason(''); }} aria-label={`Take ${r.code}`}>{r.ready ? 'Take this rule' : `Take it (waits for ${r.awaiting})`}</button> : null}</td>
            </tr>))}</tbody>
        </table>
      </div>
      <p className="muted small"><Link to="/alerts">Open the Alert Centre</Link></p>
    </section>
  );
}
