import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDate } from '../../platform/format.js';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { employees, recruit } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Onboarding Checklist (HR, part 07.02): the joining tasks given to the departments (IT access, ID card, PPE, induction, bank details, statutory forms), oldest first with a colour for how late each is. A department sees its
// own tasks; HR sees all. A task is completed with a note (a late one shows how many days), HR may waive one with a reason; once the employee is approved, "Create user account" makes the account from the employee record.
export default function OnboardingPage() {
  usePageTitle('Onboarding Checklist');
  const qc = useQueryClient();
  const [status, setStatus] = useState('OPEN');
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const q = useQuery({ queryKey: ['hr', 'onboarding', status], queryFn: () => recruit.tasks({ status: status || undefined }), retry: false });
  if (q.error?.status === 403) return <NoPermission what="the joining checklist" permission="hr.onboarding.view" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const run = async (fn, done) => { setError(null); setNote(null); try { await fn(); setNote(done); qc.invalidateQueries({ queryKey: ['hr'] }); } catch (e) { setError(errorInfo(e)); } };
  const finish = (t, waive) => { const text = window.prompt(waive ? 'Why is this task waived? (at least 5 characters)' : 'A note (optional)'); if (text === null) return; if (waive && text.trim().length < 5) return; run(() => recruit.complete(t.id, { note: text.trim() || undefined, waive }), waive ? 'Waived.' : 'Completed.'); };
  const d = q.data;
  return (
    <section aria-labelledby="ob2-title" data-testid="onboarding">
      <PageHeader id="ob2-title" title={"Onboarding Checklist"} />
      <form className="srch-form" aria-label="Filters" onSubmit={(e) => e.preventDefault()}>
        <Field label="Tasks" name="status" error={null}><select value={status} onChange={(e) => setStatus(e.target.value)} data-testid="on-status"><option value="OPEN">Open</option><option value="">All</option><option value="DONE">Done</option><option value="WAIVED">Waived</option></select></Field>
      </form>
      {d && <p className="muted" data-testid="on-counts">{d.counts.open} open · {d.counts.overdue} late · {d.counts.done} closed</p>}
      {error?.form && <p className="field-error" role="alert" data-testid="on-error">{error.form}</p>}{note && <p role="status" className="mdm-banner" data-testid="on-note">{note}</p>}
      {q.isPending ? <Skeleton label="Loading the checklist" rows={4} /> : d.rows.length === 0 ? <EmptyState title="No joining task" message="Tasks appear here when a candidate joins." /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Joining tasks"><table className="grid"><thead><tr><th>Task</th><th>Joiner</th><th>For</th><th>Due</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{d.rows.map((t) => (
            <tr key={t.id} className={t.tone === 'error' ? 'is-overdue' : t.tone === 'warning' ? 'is-soon' : ''} data-testid="on-row">
              <th scope="row" data-label="Task">{t.title}</th>
              <td data-label="Joiner">{t.employeeId ? <Link to={`/hr/employees/employee?id=${t.employeeId}`}>{t.employeeCode ?? t.candidate}</Link> : <Link to={`/hr/recruitment/candidate?id=${t.candidateId}`}>{t.candidate}</Link>} {t.candidate}</td>
              <td data-label="For">{t.role}</td>
              <td data-label="Due">{formatDate(t.dueDate)}{t.daysLate ? <div className="muted small">{t.daysLate} day(s) late</div> : null}</td>
              <td data-label="Status"><StatusBadge status={t.status === 'OPEN' ? (t.overdue ? 'OVERDUE' : 'ACTIVE') : 'COMPLETED'} label={t.status === 'OPEN' ? (t.overdue ? 'Late' : 'Open') : t.status === 'DONE' ? 'Done' : 'Waived'} /></td>
              <td>{t.canComplete && <button type="button" className="btn btn-small" onClick={() => finish(t, false)} data-testid="on-complete">Complete</button>}
                {t.canComplete && <button type="button" className="btn btn-small" onClick={() => finish(t, true)}>Waive</button>}
                {t.code === 'IT_ACCESS' && t.employeeApproved && !t.hasUser && <button type="button" className="btn btn-small" onClick={() => run(() => employees.createUser(t.employeeId, { invite: true }), 'The user account was created from the employee record.')} data-testid="on-user">Create user account</button>}</td>
            </tr>))}</tbody></table></div>
      )}
      <p className="small"><Link to="/hr/recruitment">Candidate Pipeline</Link></p>
    </section>
  );
}
