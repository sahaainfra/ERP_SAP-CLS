import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { LV_STATUS, lv } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// My Leave (HR, part 07.07, FR-03 and FR-05): my balances by type (the balance, what waits for approval, what can still be asked for) and my applications with what can be done to each: send, withdraw, cancel (before it starts),
// amend (an approved one, with approval again), delete a draft, print. Opens with ?done= after an application was made.
export default function MyLeavePage() {
  usePageTitle('My Leave');
  const qc = useQueryClient();
  const [error, setError] = useState(null);
  const [note, setNote] = useState(() => { const p = new URLSearchParams(window.location.search); return p.get('done') ? `${p.get('done')} ${p.get('sent') ? 'was sent for approval' : 'was saved as a draft'}.` : null; });
  const q = useQuery({ queryKey: ['lv', 'my'], queryFn: () => lv.my(), retry: false });
  if (q.error?.status === 403) return <NoPermission what="your leave" permission="hr.application.view" />;
  const run = async (fn, done) => { setError(null); setNote(null); try { await fn(); setNote(done); qc.invalidateQueries({ queryKey: ['lv'] }); } catch (e) { setError(errorInfo(e)); } };
  const ask = (text) => window.prompt(text);
  return (
    <section aria-labelledby="ml-title" data-testid="my-leave">
      <PageHeader id="ml-title" title={"My Leave"} />
      <div className="actions-row"><button type="button" className="btn btn-primary" onClick={() => navigateTo('/leave/apply')} data-testid="ml-apply">Apply for leave</button></div>
      {note && <p className="mdm-banner" role="status" data-testid="ml-note">{note}</p>}
      {error?.form && <p className="field-error" role="alert" data-testid="ml-error">{error.form}</p>}
      {q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : q.isPending ? <Skeleton label="Loading your leave" rows={5} /> : (
        <>
          <h2>Balances in {q.data.year}</h2>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Balances">
            <table className="grid" data-testid="ml-balances"><thead><tr><th>Type</th><th className="num">Opening</th><th className="num">Accrued</th><th className="num">Adjusted</th><th className="num">Taken</th><th className="num">Lapsed</th><th className="num">Encashed</th><th className="num">Balance</th><th className="num">Waiting</th></tr></thead>
              <tbody>{q.data.balances.map((b) => (
                <tr key={b.code} data-testid="ml-balance" data-code={b.code}><th scope="row" data-label="Type">{b.name}{b.paid ? '' : ' (unpaid)'}</th><td className="num" data-label="Opening">{b.opening}</td><td className="num" data-label="Accrued">{b.accrued}</td><td className="num" data-label="Adjusted">{b.adjusted}</td><td className="num" data-label="Taken">{b.availed}</td><td className="num" data-label="Lapsed">{b.lapsed}</td><td className="num" data-label="Encashed">{b.encashed}</td><td className="num" data-label="Balance"><strong>{b.remaining}</strong></td><td className="num" data-label="Waiting">{b.reserved}</td></tr>))}</tbody></table>
          </div>
          <h2>My applications</h2>
          {q.data.applications.length === 0 ? <EmptyState title="No leave applied for yet" message="Apply for leave and it appears here with its status." /> : (
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Applications">
              <table className="grid" data-testid="ml-table"><thead><tr><th>Application</th><th>Type</th><th>From</th><th>To</th><th className="num">Days</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>{q.data.applications.map((a) => (
                  <tr key={a.id} data-testid="ml-row" data-status={a.status}>
                    <td data-label="Application">{a.docNo}{a.revision > 1 ? ` r${a.revision}` : ''}</td><td data-label="Type">{a.leaveType}</td><td data-label="From">{a.fromDate}</td><td data-label="To">{a.toDate}</td><td className="num" data-label="Days">{a.days}</td>
                    <td data-label="Status"><StatusBadge status={(LV_STATUS[a.status] ?? [a.status])[0]} label={a.statusLabel} /></td>
                    <td data-label="Actions">
                      {a.can.submit && <button type="button" className="btn btn-small" onClick={() => run(() => lv.applications.submit(a.id), `${a.docNo} was sent for approval.`)} data-testid="ml-submit">Send</button>}{' '}
                      {a.can.withdraw && <button type="button" className="btn btn-small" onClick={() => { const w = ask('Why do you withdraw it? (at least 5 characters)'); if (w) run(() => lv.applications.withdraw(a.id, w), `${a.docNo} was withdrawn.`); }} data-testid="ml-withdraw">Withdraw</button>}{' '}
                      {a.can.cancel && <button type="button" className="btn btn-small" onClick={() => { const w = ask('Why do you cancel it? (at least 5 characters)'); if (w) run(() => lv.applications.cancel(a.id, w), `${a.docNo} was cancelled and the days went back to your balance.`); }} data-testid="ml-cancel">Cancel</button>}{' '}
                      {a.can.amend && <button type="button" className="btn btn-small" onClick={() => { const w = ask('What do you change, and why? (at least 5 characters)'); if (w) run(() => lv.applications.amend(a.id, w), `A new revision of ${a.docNo} was made: change it and send it for approval.`); }} data-testid="ml-amend">Amend</button>}{' '}
                      {a.can.delete && <button type="button" className="btn btn-small" onClick={() => run(() => lv.applications.remove(a.id), `${a.docNo} was deleted.`)} data-testid="ml-delete">Delete</button>}{' '}
                      {a.can.print && <a className="btn btn-small" href={`/api/v1/hr/applications/${a.id}/print`} target="_blank" rel="noreferrer">Print</a>}
                    </td>
                  </tr>))}</tbody></table>
            </div>
          )}
        </>
      )}
      <p className="small"><Link to="/leave/approvals">Leave Approvals</Link> · <Link to="/leave/calendar">Team Leave Calendar</Link></p>
    </section>
  );
}
