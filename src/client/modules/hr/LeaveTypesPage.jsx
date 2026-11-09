import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { lv } from './api.js';

// Leave Types & Rules (HR, part 07.07, FR-01 and FR-02): the types a company grants (casual, sick, earned, maternity, paternity, comp-off, bereavement, leave without pay) and the rules of each: the yearly quota and how it accrues, pro-rata
// for joiners, carry-forward and encashment limits, the least service, the longest run, a certificate after some days, the sandwich rule, half days, advance leave, the genders and employment categories it is for. HR changes them here
// (each change is audited); a change applies from the next application and the next accrual.
const NUM = [['quota', 'Yearly quota (days)'], ['carryForwardMax', 'Carry forward at most (days)'], ['encashMax', 'Encash at most (days)'], ['minServiceDays', 'Least service (days)'], ['maxConsecutive', 'Longest run (days)'], ['documentAfterDays', 'Certificate after (days)'], ['advanceMax', 'Advance leave up to (days)'], ['expiryDays', 'Expires after (days)']];
const BOOL = [['proRata', 'Pro-rata for joiners'], ['encashable', 'May be encashed'], ['sandwich', 'Sandwich rule (days off between leave days count)'], ['allowHalfDay', 'Half days allowed'], ['special', 'Special type (the HR manager also approves)']];
export default function LeaveTypesPage() {
  usePageTitle('Leave Types & Rules');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['lv', 'types-all'], queryFn: lv.types, retry: false });
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  if (q.error?.status === 403) return <NoPermission what="leave types" permission="lv.type.view" />;
  const open = (t) => { setNote(null); setError(null); setEdit(t ? { id: t.id, version: t.rowVersion, code: t.code, name: t.name, paid: t.paid, status: t.status, rules: { ...t.rules } } : { id: null, code: '', name: '', paid: true, status: 'ACTIVE', rules: { quota: 0, accrual: 'NONE', proRata: true, carryForwardMax: 0, encashable: false, encashMax: null, minServiceDays: 0, maxConsecutive: null, documentAfterDays: null, sandwich: false, allowHalfDay: true, advanceMax: 0, special: false, genders: [], categories: [], expiryDays: null } }); };
  const setRule = (k, v) => setEdit((e) => ({ ...e, rules: { ...e.rules, [k]: v } }));
  const num = (v) => (v === '' || v == null ? null : Number(v));
  const save = async () => {
    setError(null);
    const rules = { ...edit.rules, ...Object.fromEntries(NUM.map(([k]) => [k, k === 'quota' || k === 'carryForwardMax' || k === 'minServiceDays' || k === 'advanceMax' ? Number(edit.rules[k] ?? 0) : num(edit.rules[k])])) };
    try {
      if (edit.id) await lv.updateType(edit.id, { name: edit.name, paid: edit.paid, rules, status: edit.status, version: edit.version });
      else await lv.createType({ code: edit.code, name: edit.name, paid: edit.paid, rules, status: edit.status });
      setNote(`${edit.name} was saved.`); setEdit(null); qc.invalidateQueries({ queryKey: ['lv'] });
    } catch (e) { setError(errorInfo(e)); }
  };
  return (
    <section aria-labelledby="lt-title" data-testid="leave-types">
      <h1 id="lt-title">Leave Types & Rules</h1>
      {note && <p className="mdm-banner" role="status" data-testid="lt-note">{note}</p>}
      <div className="actions-row"><button type="button" className="btn btn-primary" onClick={() => open(null)} data-testid="lt-new">New leave type</button></div>
      {q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : q.isPending ? <Skeleton label="Loading the types" rows={4} /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Leave types">
          <table className="grid" data-testid="lt-table"><thead><tr><th>Code</th><th>Name</th><th>Paid</th><th className="num">Quota</th><th>Accrual</th><th className="num">Carry forward</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{q.data.map((t) => (
              <tr key={t.id} data-testid="lt-row" data-code={t.code}><th scope="row" data-label="Code">{t.code}</th><td data-label="Name">{t.name}</td><td data-label="Paid">{t.paid ? 'Paid' : 'Unpaid'}</td><td className="num" data-label="Quota">{t.rules.quota}</td><td data-label="Accrual">{t.rules.accrual.toLowerCase()}</td><td className="num" data-label="Carry forward">{t.rules.carryForwardMax}</td><td data-label="Status">{t.status === 'ACTIVE' ? 'In use' : 'Not in use'}</td>
                <td data-label="Actions"><button type="button" className="btn btn-small" onClick={() => open(t)} data-testid="lt-edit">Edit</button></td></tr>))}</tbody></table>
        </div>
      )}
      {edit && (
        <form className="mdm-panel" onSubmit={(e) => { e.preventDefault(); save(); }} aria-label="Leave type" data-testid="lt-form">
          <h2>{edit.id ? edit.code : 'New leave type'}</h2>
          {error?.form && <p className="field-error" role="alert" data-testid="lt-error">{error.form}</p>}
          {!edit.id && <Field label="Code" name="code" error={error}><input value={edit.code} maxLength={10} onChange={(e) => setEdit({ ...edit, code: e.target.value })} data-testid="lt-code" /></Field>}
          <Field label="Name" name="name" error={error}><input value={edit.name} maxLength={80} onChange={(e) => setEdit({ ...edit, name: e.target.value })} data-testid="lt-name" /></Field>
          <label className="check"><input type="checkbox" checked={edit.paid} onChange={(e) => setEdit({ ...edit, paid: e.target.checked })} /> Paid leave</label>
          <Field label="Accrual" name="accrual" error={error}><select value={edit.rules.accrual} onChange={(e) => setRule('accrual', e.target.value)} data-testid="lt-accrual">{[['NONE', 'None (balance is added by comp-off or adjustment)'], ['ANNUAL', 'Once a year'], ['QUARTERLY', 'Every quarter'], ['MONTHLY', 'Every month']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          {NUM.map(([k, l]) => <Field key={k} label={l} name={k} error={error}><input type="number" min="0" step="0.5" value={edit.rules[k] ?? ''} onChange={(e) => setRule(k, e.target.value)} data-testid={`lt-${k}`} /></Field>)}
          {BOOL.map(([k, l]) => <label key={k} className="check"><input type="checkbox" checked={Boolean(edit.rules[k])} onChange={(e) => setRule(k, e.target.checked)} data-testid={`lt-${k}`} /> {l}</label>)}
          <Field label="For" name="genders" error={error}><select value={edit.rules.genders[0] ?? ''} onChange={(e) => setRule('genders', e.target.value ? [e.target.value] : [])} data-testid="lt-gender"><option value="">Everyone</option><option value="FEMALE">Women</option><option value="MALE">Men</option></select></Field>
          <Field label="Status" name="status" error={error}><select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}><option value="ACTIVE">In use</option><option value="INACTIVE">Not in use</option></select></Field>
          <div className="actions"><button type="button" className="btn" onClick={() => setEdit(null)}>Close</button><button type="submit" className="btn btn-primary" data-testid="lt-save">Save</button></div>
        </form>
      )}
      <p className="small"><Link to="/leave/balances">Leave Balance Report</Link></p>
    </section>
  );
}
