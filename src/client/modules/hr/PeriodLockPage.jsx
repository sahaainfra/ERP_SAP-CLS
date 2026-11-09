import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { formatDateTime } from '../../platform/format.js';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { dayIST, regs } from './api.js';

// Period Lock (HR, part 07.06, FR-07): what is still open in an attendance period (requests waiting, days with a missing punch), and the lock itself. HR locks a period after its last day, for a site or for all sites; once locked the register never
// changes: a correction becomes arrears for payroll. Reopening a locked period is asked for here and decided by another HR manager and the finance head.
export default function PeriodLockPage() {
  usePageTitle('Period Lock');
  const qc = useQueryClient();
  const [period, setPeriod] = useState(dayIST(-31));
  const [siteId, setSiteId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const q = useQuery({ queryKey: ['att', 'lock', period, siteId], queryFn: () => regs.lockStatus({ period, siteId: siteId || undefined }), retry: false });
  const arrears = useQuery({ queryKey: ['att', 'arrears', q.data?.period.start], queryFn: () => regs.arrears({ periodStart: q.data.period.start, status: 'OPEN' }), enabled: Boolean(q.data), retry: false });
  if (q.error?.status === 403) return <NoPermission what="period locks" permission="att.register.view" />;
  const d = q.data;
  const refresh = () => qc.invalidateQueries({ queryKey: ['att'] });
  const run = async (fn, done) => { setError(null); setNote(null); try { await fn(); setNote(done); setReason(''); refresh(); } catch (e) { setError(errorInfo(e)); } };
  const r = d?.readiness;
  return (
    <section aria-labelledby="pl-title" data-testid="lock">
      <h1 id="pl-title">Period Lock</h1>
      <form className="srch-form" aria-label="Parameters" onSubmit={(e) => e.preventDefault()}>
        <Field label="Any day of the period" name="period" error={null}><input type="date" value={period} onChange={(e) => setPeriod(e.target.value)} data-testid="pl-period" /></Field>
        <LookupField id="pl-site" label="Site (empty for all sites)" lookup="iam/sites" value={siteId} onChange={setSiteId} />
      </form>
      {error?.form && <p className="field-error" role="alert" data-testid="pl-error">{error.form}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="pl-note">{note}</p>}
      {q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : q.isPending ? <Skeleton label="Loading the period" rows={4} /> : (
        <>
          <p data-testid="pl-head"><strong>{d.period.label}</strong> ({d.period.start} to {d.period.end}){!d.period.ended && <> · the period has not ended: it is locked after its last day</>}</p>
          {d.lock ? (
            <div data-testid="pl-locked">
              <p><strong>{d.lock.status === 'REOPEN_PENDING' ? 'Locked; reopening waits for approval' : 'Locked'}</strong> by {d.lock.lockedBy} on {formatDateTime(d.lock.lockedAt)} ({d.lock.site}): {d.lock.summary.employees} people, {d.lock.summary.paidDays} paid days, {d.lock.summary.lopDays} days of loss of pay, {Math.round((d.lock.summary.otMinutes ?? 0) / 60)} overtime hours.</p>
              {d.can.lock && d.lock.status === 'LOCKED' && (
                <form className="mdm-panel" onSubmit={(e) => { e.preventDefault(); run(() => regs.reopen(d.lock.id, { reason: reason.trim() }), 'The request to reopen was sent: another HR manager and the finance head approve it.'); }}>
                  <Field label="Why must it be reopened? (needed)" name="reason" error={error}><textarea rows="2" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="pl-reason" /></Field>
                  <div className="actions"><button type="submit" className="btn" data-testid="pl-reopen">Ask to reopen</button></div>
                </form>
              )}
              <h2>Corrections kept as arrears</h2>
              {arrears.data?.length ? <ul className="mdm-list" data-testid="pl-arrears">{arrears.data.map((a) => <li key={a.id}>{a.employee} on {a.workDate}: paid days {a.deltaPaidDays > 0 ? '+' : ''}{a.deltaPaidDays}, loss of pay {a.deltaLopDays > 0 ? '+' : ''}{a.deltaLopDays}, overtime {a.deltaOtMinutes} min</li>)}</ul> : <p className="muted">None. A change after the lock appears here and goes to payroll.</p>}
            </div>
          ) : (
            <div data-testid="pl-open">
              <h2>Before the lock</h2>
              <ul className="mdm-list" data-testid="pl-checklist">
                <li data-ok={r.regularisations.length === 0}>{r.regularisations.length === 0 ? 'No regularisation waits.' : `${r.regularisations.length} regularisation(s) wait: ${r.regularisations.slice(0, 5).map((x) => x.docNo).join(', ')}`}</li>
                <li data-ok={r.overtime.length === 0}>{r.overtime.length === 0 ? 'No overtime request waits.' : `${r.overtime.length} overtime request(s) wait: ${r.overtime.slice(0, 5).map((x) => x.docNo).join(', ')}`}</li>
                <li data-ok={r.manual.length === 0}>{r.manual.length === 0 ? 'No manual entry waits.' : `${r.manual.length} manual entr${r.manual.length === 1 ? 'y' : 'ies'} wait: ${r.manual.slice(0, 5).map((x) => x.docNo).join(', ')}`}</li>
                <li data-ok={r.missingPunch.length === 0}>{r.missingPunch.length === 0 ? 'No day has a missing punch.' : `${r.missingPunch.length} day(s) have a missing punch: ${r.missingPunch.slice(0, 5).map((x) => x.workDate).join(', ')}`}</li>
              </ul>
              {d.can.lock ? <div className="actions"><button type="button" className="btn btn-primary" disabled={!d.period.ended} onClick={() => run(() => regs.lock({ period: d.period.start, siteId: siteId ? Number(siteId) : undefined }), 'The period is locked and payroll was told.')} data-testid="pl-lock">Lock the period</button></div> : <p className="muted">Only the HR manager locks a period.</p>}
            </div>
          )}
        </>
      )}
      <p className="small"><Link to="/att/register">Monthly Attendance Register</Link> · <Link to="/att/approvals">Attendance Approvals</Link></p>
    </section>
  );
}
