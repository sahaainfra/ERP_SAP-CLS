import { useEffect, useRef, useState } from 'react';
import { useActOnRequest, useChangeRequests, useCronPreview, useRequestScheduleChange, useSchedules } from '../api/index.js';
import { formatDateTime } from '../../../platform/format.js';
import { Field, FormDialog, Link, QueryState, can, errorInfo, usePageTitle } from './ui.jsx';
import PageHeader from '../../../platform/design/PageHeader.jsx';

function Pending({ session }) {
  const requests = useChangeRequests({ status: 'SUBMITTED' });
  const act = useActOnRequest();
  const [message, setMessage] = useState('');
  const rows = (requests.data?.data ?? []).filter((r) => r.type === 'schedule_change');
  const roles = [session?.roles ?? []].flat().join(',').split(',');
  const decide = async (r, action) => {
    setMessage('');
    try {
      await act.mutateAsync({ id: r.id, action, comment: action === 'reject' ? 'Not approved' : 'Approved', version: r.version });
      setMessage(`Request ${r.id} ${action === 'approve' ? 'approved and applied' : 'rejected'}.`);
    } catch (err) {
      setMessage(errorInfo(err).form);
    }
  };
  if (rows.length === 0 && !message) return null;
  return (
    <section aria-labelledby="pending-title" className="card">
      <h2 id="pending-title">Schedule changes waiting for a decision</h2>
      <ul className="plain">
        {rows.map((r) => {
          const step = r.chain[r.currentStep - 1];
          const mine = roles.includes(step) && r.requestedBy !== session?.user;
          return (
            <li key={r.id} data-testid={`schedule-request-${r.id}`}>
              <strong>{r.title}</strong>: <code>{r.payload.from.cron}</code> {r.payload.from.enabled ? 'on' : 'off'} &rarr; <code>{r.payload.changes.cron ?? r.payload.from.cron}</code> {(r.payload.changes.enabled ?? r.payload.from.enabled) ? 'on' : 'off'}
              <div className="muted small">{r.reason} - requested by {r.requestedBy}; waiting for {step}</div>
              {mine && (
                <div className="actions">
                  <button type="button" className="btn btn-primary" disabled={act.isPending} onClick={() => decide(r, 'approve')}>Approve</button>
                  <button type="button" className="btn" disabled={act.isPending} onClick={() => decide(r, 'reject')}>Reject</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p role="status" className="notice">{message}</p>
    </section>
  );
}

export default function SchedulesPage({ session }) {
  usePageTitle('Scheduled Jobs');
  const schedules = useSchedules();
  const requestChange = useRequestScheduleChange();
  const canManage = can(session, 'core.schedule.manage');
  const [target, setTarget] = useState(null);
  const [cron, setCron] = useState('');
  const [typed, setTyped] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const dialog = useRef(null);

  // The preview asks the server (same cron code as the scheduler) once typing pauses.
  useEffect(() => {
    const t = setTimeout(() => setTyped(cron), 300);
    return () => clearTimeout(t);
  }, [cron]);
  const preview = useCronPreview(typed);

  const open = (s) => {
    setTarget(s);
    setCron(s.cron);
    setTyped(s.cron);
    setError(null);
    dialog.current?.showModal();
  };
  const submit = async (f) => {
    setError(null);
    const changes = {};
    if (cron.trim() !== target.cron) changes.cron = cron.trim();
    const enabled = f.get('enabled') === 'on';
    if (enabled !== target.enabled) changes.enabled = enabled;
    try {
      await requestChange.mutateAsync({ id: target.id, changes, reason: String(f.get('reason')) });
      dialog.current?.close();
      setNotice(`Change to ${target.code} sent for approval by the System Administrator. It takes effect when approved.`);
    } catch (err) {
      setError(errorInfo(err));
    }
  };

  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Operations &rsaquo; Scheduled Jobs</nav>
      <PageHeader id="page-title" title={"Scheduled Jobs"} subtitle={<>Times are Indian Standard Time. Only one application instance runs each scheduled slot. Changes are maker-checker: the IT Administrator asks, the System Administrator approves. <Link to="/admin/operations/jobs">See the jobs they started</Link></>} />
      <p role="status" className="notice">{notice}</p>
      <QueryState query={schedules} what="schedules" permission="core.schedule.view" />
      {schedules.data?.length === 0 && <div className="state"><h2>No schedules</h2><p>No module has registered a scheduled job yet.</p></div>}
      {schedules.data?.length > 0 && (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Scheduled jobs</caption>
            <thead><tr><th>Schedule</th><th>Cron</th><th>Job</th><th>Status</th><th>Last run (IST)</th><th>Next run (IST)</th><th /></tr></thead>
            <tbody>
              {schedules.data.map((s) => (
                <tr key={s.id} data-testid={`schedule-${s.code}`}>
                  <td data-label="Schedule"><code>{s.code}</code><div className="muted small">{s.description}</div></td>
                  <td data-label="Cron"><code>{s.cron}</code></td>
                  <td data-label="Job"><code>{s.jobType}</code></td>
                  <td data-label="Status"><span className={`chip ${s.enabled ? 'chip-on' : 'chip-off'}`}>{s.enabled ? 'Enabled' : 'Disabled'}</span></td>
                  <td data-label="Last run">{s.lastRunAt ? formatDateTime(s.lastRunAt) : 'Never'}</td>
                  <td data-label="Next run">{s.enabled && s.nextRunAt ? formatDateTime(s.nextRunAt) : '-'}</td>
                  <td>{canManage && <button type="button" className="link" aria-label={`Request a change to ${s.code}`} onClick={() => open(s)}>Request change</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pending session={session} />

      <FormDialog dialogRef={dialog} title={target ? `Change ${target.code}` : ''} error={error} busy={requestChange.isPending} submitLabel="Send for approval" onSubmit={submit}>
        {target && (
          <>
            <Field label="Cron expression" name="changes.cron" error={error} hint="minute hour day-of-month month day-of-week, for example 30 1 * * *">
              <input value={cron} onChange={(e) => setCron(e.target.value)} required aria-describedby="cron-preview" />
            </Field>
            <div id="cron-preview" className="preview" aria-live="polite" data-testid="cron-preview">
              {preview.isError && <span className="field-error">{preview.error.message}</span>}
              {preview.data && <>Next runs (IST): <ul className="plain">{preview.data.nextRuns.map((t) => <li key={t}>{formatDateTime(t)}</li>)}</ul></>}
              {preview.isPending && typed.trim() && <span className="muted">Checking...</span>}
            </div>
            <label className="check"><input name="enabled" type="checkbox" defaultChecked={target.enabled} /> Enabled</label>
          </>
        )}
      </FormDialog>
    </section>
  );
}
