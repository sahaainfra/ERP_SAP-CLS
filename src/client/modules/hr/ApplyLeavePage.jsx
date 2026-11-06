import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { dayIST, employees, lv } from './api.js';

// Apply Leave (HR, part 07.07, FR-03): the type, the dates, half a day, the reason, a certificate where the type asks for one, and who covers the approvals when an approver is away. Before it is saved the page shows what the server works out:
// the days (holidays and weekly offs left out unless the type counts them between leave days), the balance after, the people of the team away on the same days, and what is wrong. It goes to the reporting manager; beyond 10 days or for
// a special type the HR manager also decides. Works on a phone: one column, large fields.
const HALF = [['NONE', 'Whole days'], ['FIRST', 'First half of the day'], ['SECOND', 'Second half of the day']];
export default function ApplyLeavePage() {
  usePageTitle('Apply Leave');
  const session = useSession();
  const others = (session.data?.permissions ?? []).includes('lv.team.view');
  const me = useQuery({ queryKey: ['hr', 'me'], queryFn: employees.me, retry: false });
  const [v, setV] = useState({ employeeId: '', leaveTypeId: '', fromDate: dayIST(1), toDate: dayIST(1), halfDay: 'NONE', reason: '', attachmentFileId: '', delegateUser: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (p) => setV((x) => ({ ...x, ...p }));
  const employeeId = Number(v.employeeId) || me.data?.id || null;
  const types = useQuery({ queryKey: ['lv', 'types', employeeId], queryFn: () => lv.options(employeeId), enabled: Boolean(employeeId), retry: false });
  const typeId = v.leaveTypeId || types.data?.[0]?.id || '';
  const ready = employeeId && typeId && v.fromDate && v.toDate;
  const pv = useQuery({ queryKey: ['lv', 'check', employeeId, typeId, v.fromDate, v.toDate, v.halfDay, v.attachmentFileId], queryFn: () => lv.check({ employeeId, leaveTypeId: typeId, fromDate: v.fromDate, toDate: v.toDate, halfDay: v.halfDay, attachmentFileId: v.attachmentFileId || undefined }), enabled: Boolean(ready), retry: false });
  const bal = useQuery({ queryKey: ['lv', 'balance', employeeId], queryFn: () => lv.balance(employeeId), enabled: Boolean(employeeId), retry: false });
  const type = types.data?.find((t) => t.id === Number(typeId));
  const body = () => ({ employeeId, leaveTypeId: Number(typeId), fromDate: v.fromDate, toDate: v.toDate, halfDay: v.halfDay, reason: v.reason.trim(), attachmentFileId: v.attachmentFileId ? Number(v.attachmentFileId) : null, delegateUser: v.delegateUser.trim() || null });
  const save = async (submit) => {
    setBusy(true); setError(null);
    try { const out = await lv.applications.create({ ...body(), submit }); navigateTo(`/leave/my?done=${out.docNo}${submit ? '&sent=1' : ''}`, { force: true }); } catch (e) { setError(errorInfo(e)); } finally { setBusy(false); }
  };
  const fe = (k) => error?.fields?.[k];
  if (me.isPending && !others) return <Skeleton label="Loading" rows={3} />;
  if (me.isError && !others) return <ErrorState error={me.error} onRetry={me.refetch} />;
  const d = pv.data;
  return (
    <section aria-labelledby="al-title" data-testid="apply-leave">
      <h1 id="al-title">Apply Leave</h1>
      {error?.form && <p className="field-error" role="alert" data-testid="al-error">{error.form}</p>}
      <form className="mdm-fields" onSubmit={(e) => { e.preventDefault(); save(false); }}>
        {others && <LookupField id="al-employee" label="Employee (leave empty for yourself)" lookup="hr/employees" value={v.employeeId} onChange={(x) => set({ employeeId: x, leaveTypeId: '' })} error={fe('employeeId')} />}
        <Field label="Leave type" name="leaveTypeId" error={error}><select value={typeId} onChange={(e) => set({ leaveTypeId: e.target.value })} data-testid="al-type">{(types.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}{t.paid ? '' : ' (unpaid)'}</option>)}</select></Field>
        <Field label="From" name="fromDate" error={error}><input type="date" value={v.fromDate} onChange={(e) => set({ fromDate: e.target.value, toDate: v.toDate < e.target.value ? e.target.value : v.toDate })} data-testid="al-from" /></Field>
        <Field label="To" name="toDate" error={error}><input type="date" value={v.toDate} min={v.fromDate} onChange={(e) => set({ toDate: e.target.value })} data-testid="al-to" /></Field>
        {(type?.rules.allowHalfDay ?? true) && <Field label="Half day" name="halfDay" error={error}><select value={v.halfDay} onChange={(e) => set({ halfDay: e.target.value, toDate: e.target.value === 'NONE' ? v.toDate : v.fromDate })} data-testid="al-half">{HALF.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>}
        <Field label="Reason" name="reason" error={error}><textarea rows="3" value={v.reason} onChange={(e) => set({ reason: e.target.value })} data-testid="al-reason" /></Field>
        {d?.documentNeeded && <Field label="Certificate (number of the attached file)" name="attachmentFileId" error={error}><input inputMode="numeric" value={v.attachmentFileId} onChange={(e) => set({ attachmentFileId: e.target.value })} data-testid="al-file" /></Field>}
        <Field label="Who covers your approvals while you are away (user name, if you approve for others)" name="delegateUser" error={error}><input value={v.delegateUser} maxLength={60} onChange={(e) => set({ delegateUser: e.target.value })} data-testid="al-delegate" /></Field>
      </form>
      <div className="mdm-panel" aria-live="polite" data-testid="al-preview">
        <h2>What this leave takes</h2>
        {pv.isPending && ready ? <Skeleton label="Working it out" rows={2} /> : !d ? <p className="muted">Choose the type and the dates.</p> : (
          <>
            <p data-testid="al-days"><strong>{d.days} day{d.days === 1 ? '' : 's'}</strong>{d.sandwiched ? ` (${d.sandwiched} holiday or weekly off between leave days counted)` : ''}{d.offDays ? ` · ${d.offDays} holiday or weekly off not counted` : ''}</p>
            {d.balance && <p data-testid="al-balance">Balance now {d.balance.remaining}{d.balance.reserved ? `, ${d.balance.reserved} waiting for approval` : ''} · after this leave {d.balance.after}</p>}
            {d.band === 'EXTENDED' && <p className="muted">The HR manager also approves this one (over 10 days or a special type).</p>}
            {d.clashes.length > 0 && <p className="mdm-banner" data-testid="al-clash">Away on the same days: {d.clashes.map((c) => `${c.name} (${c.from} to ${c.to}${c.status === 'SUBMITTED' ? ', waiting' : ''})`).join('; ')}</p>}
            {d.problems.length > 0 && <ul className="field-error" role="alert" data-testid="al-problems">{d.problems.map((p) => <li key={p.message}>{p.message}</li>)}</ul>}
          </>
        )}
      </div>
      {bal.data && <p className="muted small" data-testid="al-balances">{bal.data.map((b) => `${b.code} ${b.remaining}`).join(' · ')}</p>}
      <div className="actions">
        <button type="button" className="btn" onClick={() => navigateTo('/leave/my')}>Cancel</button>
        <button type="button" className="btn" disabled={busy || !ready} onClick={() => save(false)} data-testid="al-save">Save draft</button>
        <button type="button" className="btn btn-primary" disabled={busy || !ready || (d?.problems.length ?? 0) > 0 || v.reason.trim().length < 5} onClick={() => save(true)} data-testid="al-send">{busy ? 'Saving...' : 'Send for approval'}</button>
      </div>
      <p className="small"><Link to="/leave/my">My Leave</Link></p>
    </section>
  );
}
