import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { Field, errorInfo } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { BAND_TEXT, MANUAL_ENTRIES, REQ_STATUS, dayIST, employees, regs } from './api.js';

// The form of a request about a day of attendance (part 07.06): a regularisation of the punches, an overtime request or a manual entry. The person asks for themself; a supervisor or HR names the employee. A day in a locked period is raised as
// arrears and says so. Below the form are the requests made, with what can be done with each (send, withdraw, cancel, amend, delete, print).
const LABELS = { regularisation: 'Regularisation', overtime: 'Overtime request', manual: 'Manual attendance entry' };
const blank = (kind, me) => ({ employeeId: me ?? '', workDate: dayIST(kind === 'overtime' ? 0 : -1), requestedIn: '', requestedOut: '', reason: '', otType: 'POST', hours: '2', entryStatus: 'PRESENT', inTime: '', outTime: '', arrears: false });
export default function RequestForm({ kind, testid }) {
  const qc = useQueryClient();
  const session = useSession();
  const perms = session.data?.permissions ?? [];
  const others = perms.includes('att.register.view');
  const me = useQuery({ queryKey: ['hr', 'me'], queryFn: employees.me, enabled: !others || kind !== 'manual', retry: false });
  const [v, setV] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(false);
  const mine = useQuery({ queryKey: ['hr', 'regs', kind], queryFn: () => regs[kind].list({ pageSize: 25 }), retry: false });
  if (session.isPending) return <Skeleton label="Loading" rows={3} />;
  const form = v ?? blank(kind, me.data?.id ?? '');
  const set = (p) => setV({ ...form, ...p });
  const fe = (k) => error?.fields?.[k];
  const body = () => ({
    employeeId: Number(form.employeeId) || null, workDate: form.workDate, arrears: form.arrears, reason: form.reason.trim(),
    ...(kind === 'regularisation' ? { requestedIn: form.requestedIn || null, requestedOut: form.requestedOut || null } : kind === 'overtime' ? { otType: form.otType, minutes: Math.round(Number(form.hours) * 60) } : { entryStatus: form.entryStatus, inTime: form.inTime || null, outTime: form.outTime || null }),
  });
  const save = async (submit) => {
    setBusy(true); setError(null); setNote(null);
    try {
      const out = await regs[kind].create({ ...body(), submit });
      setNote(`${out.docNo} ${submit ? 'was sent for approval' : 'was saved as a draft'}${out.band && out.band !== 'STANDARD' ? `: ${BAND_TEXT[out.band]}` : ''}.`);
      setV(null); qc.invalidateQueries({ queryKey: ['hr', 'regs'] });
    } catch (e) {
      const info = errorInfo(e);
      if (e?.code === 'PERIOD_LOCKED' || /locked/i.test(info.form ?? '')) { set({ arrears: false }); }
      setError(info);
    } finally { setBusy(false); }
  };
  const act = async (fn, done) => { setError(null); setNote(null); try { await fn(); setNote(done); qc.invalidateQueries({ queryKey: ['hr', 'regs'] }); } catch (e) { setError(errorInfo(e)); } };
  const rows = mine.data?.data ?? [];
  return (
    <div data-testid={testid}>
      {error?.form && <p className="field-error" role="alert" data-testid="rq-error">{error.form}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="rq-note">{note}</p>}
      <form className="mdm-fields" onSubmit={(e) => { e.preventDefault(); save(false); }}>
        {others
          ? <LookupField id="rq-employee" label="Employee" lookup="hr/employees" value={form.employeeId} onChange={(x) => set({ employeeId: x })} error={fe('employeeId')} required />
          : <Field label="Employee" name="employeeId" error={error}><input value={me.data ? `${me.data.fullName ?? me.data.name ?? ''} (${me.data.code ?? me.data.empCode ?? ''})` : '…'} readOnly data-testid="rq-me" /></Field>}
        <Field label="Day" name="workDate" error={error}><input type="date" value={form.workDate} onChange={(e) => set({ workDate: e.target.value })} data-testid="rq-date" /></Field>
        {kind === 'regularisation' && <>
          <Field label="In time" name="requestedIn" error={error}><input type="datetime-local" value={form.requestedIn} onChange={(e) => set({ requestedIn: e.target.value })} data-testid="rq-in" /></Field>
          <Field label="Out time" name="requestedOut" error={error}><input type="datetime-local" value={form.requestedOut} onChange={(e) => set({ requestedOut: e.target.value })} data-testid="rq-out" /></Field>
        </>}
        {kind === 'overtime' && <>
          <Field label="When" name="otType" error={error}><select value={form.otType} onChange={(e) => set({ otType: e.target.value })} data-testid="rq-ottype"><option value="POST">After the work (claim)</option><option value="PRE">Before the work (approval)</option></select></Field>
          <Field label="Hours" name="minutes" error={error}><input type="number" min="0.25" max="12" step="0.25" value={form.hours} onChange={(e) => set({ hours: e.target.value })} data-testid="rq-hours" /></Field>
        </>}
        {kind === 'manual' && <>
          <Field label="Entry" name="entryStatus" error={error}><select value={form.entryStatus} onChange={(e) => set({ entryStatus: e.target.value })} data-testid="rq-entry">{MANUAL_ENTRIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="In time (optional)" name="inTime" error={error}><input type="datetime-local" value={form.inTime} onChange={(e) => set({ inTime: e.target.value })} data-testid="rq-in" /></Field>
          <Field label="Out time (optional)" name="outTime" error={error}><input type="datetime-local" value={form.outTime} onChange={(e) => set({ outTime: e.target.value })} data-testid="rq-out" /></Field>
        </>}
        <Field label="Reason" name="reason" error={error}><textarea rows="3" value={form.reason} onChange={(e) => set({ reason: e.target.value })} data-testid="rq-reason" /></Field>
        <label className="check"><input type="checkbox" checked={form.arrears} onChange={(e) => set({ arrears: e.target.checked })} data-testid="rq-arrears" /> The day is in a locked period: raise it as arrears for payroll</label>
      </form>
      <div className="actions">
        <button type="button" className="btn" disabled={busy} onClick={() => save(false)} data-testid="rq-save">Save draft</button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => save(true)} data-testid="rq-send">{busy ? 'Saving...' : 'Send for approval'}</button>
      </div>
      <h2>{LABELS[kind]}s made</h2>
      {mine.isError ? <ErrorState error={mine.error} onRetry={mine.refetch} /> : mine.isPending ? <Skeleton label="Loading" rows={3} /> : rows.length === 0 ? <p className="muted" data-testid="rq-empty">Nothing yet.</p> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Requests made">
          <table className="grid" data-testid="rq-table"><thead><tr><th>Request</th><th>Employee</th><th>Day</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} data-testid="rq-row">
                <td data-label="Request">{r.docNo}{r.arrears ? ' · arrears' : ''}</td><td data-label="Employee">{r.employee}</td><td data-label="Day">{r.workDate}</td>
                <td data-label="Status"><StatusBadge status={(REQ_STATUS[r.status] ?? [r.status])[0]} label={r.statusLabel} /></td>
                <td data-label="Actions">
                  {['DRAFT', 'RETURNED'].includes(r.status) && <button type="button" className="btn btn-small" onClick={() => act(() => regs[kind].submit(r.id), `${r.docNo} was sent for approval.`)} data-testid="rq-submit">Send</button>}{' '}
                  {r.status === 'SUBMITTED' && <button type="button" className="btn btn-small" onClick={() => { const why = window.prompt('Why do you withdraw it? (at least 5 characters)'); if (why) act(() => regs[kind].withdraw(r.id, why), `${r.docNo} was withdrawn.`); }} data-testid="rq-withdraw">Withdraw</button>}{' '}
                  {r.status === 'DRAFT' && <button type="button" className="btn btn-small" onClick={() => act(() => regs[kind].remove(r.id), `${r.docNo} was deleted.`)} data-testid="rq-delete">Delete</button>}{' '}
                  <a className="btn btn-small" href={`/api/v1/hr/${kind === 'overtime' ? 'overtime-requests' : kind === 'manual' ? 'manual-entries' : 'regularisations'}/${r.id}/print`} target="_blank" rel="noreferrer">Print</a>
                </td>
              </tr>))}</tbody></table>
        </div>
      )}
    </div>
  );
}
