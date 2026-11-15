import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../platform/api/index.js';
import { DiscussionTab, TimelineTab } from '../../platform/collab/CollabTabs.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDate, formatDateTime } from '../../platform/format.js';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { AttachmentList, FileUploader } from '../core/components/Attachments.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { CHANGE_STATUS, DOC_TYPES, EMPLOYMENT_STATUS, EVENT_LABELS, EVENT_TYPES, RECORD_STATUS, dayIST, employees, todayIST } from './api.js';
import { AddressFields, ContactsEditor, EmploymentFields, addressOrNull, blankAddress, blankContact, contactsOut } from './HrForms.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Employee 360 (HR, part 07.01): one employee. Header: code, name, record status (Draft to Approved) and employment status (Active, Notice, Separated, Absconding), department, designation, grade, type, joining, manager, work
// location and user account, with the actions allowed for this person and status: send a draft for approval, correct it, withdraw, cancel, amend (personal, employment, statutory, bank, status), create or link the user account,
// print. Tabs: Personal · Employment · Statutory (restricted) · Bank (restricted, masked, shown on request and logged) · Documents (with expiry) · History (promotions, transfers, increments, with effective dates) ·
// Changes (requests and their dates) · Approvals · Timeline · Discussion · and a tab for each part that holds data for the person (attendance, leave, assets, training) once it is in use.
// `?me=1` (or no `id`) opens the signed-in person's own record, where they ask for a change of their contact details; any signed-in person may open the page, the service decides what they see.
const BASE_TABS = [['personal', 'Personal'], ['employment', 'Employment'], ['statutory', 'Statutory'], ['bank', 'Bank'], ['documents', 'Documents'], ['history', 'History'], ['changes', 'Changes'], ['approvals', 'Approvals'], ['timeline', 'Timeline'], ['discussion', 'Discussion']];
const DOC_STATE = { EXPIRED: ['OVERDUE', 'Expired'], DUE: ['AT_RISK', 'Expires soon'], VALID: ['ACTIVE', 'Valid'], NO_EXPIRY: ['ACTIVE', 'No expiry'] };
const yn = (b) => (b ? 'Yes' : 'No');
const addrText = (a) => (a ? [a.line, a.city, a.stateCode, a.pin].filter(Boolean).join(', ') : null);
export default function Employee360Page() {
  const sp = new URLSearchParams(window.location.search);
  const id = Number(sp.get('id')) || null;
  const mine = sp.get('me') === '1' || !id; // without an employee chosen the page shows the signed-in person's own record
  const q = useQuery({ queryKey: ['hr', 'employee', mine ? 'me' : id], queryFn: () => (mine ? employees.me() : employees.get(id)), enabled: mine || Boolean(id), retry: false });
  usePageTitle(q.data ? `${q.data.code} ${q.data.name}` : 'Employee 360');
  const [tab, setTab] = useState(() => sp.get('tab') ?? 'personal');
  if (q.error?.status === 403) return <NoPermission what="employees" permission="hr.employee.team.view" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (q.isPending) return <Skeleton label="Loading the employee" rows={6} />;
  const e = q.data;
  const restricted = e.accessLevel === 'team';
  const tabs = [...BASE_TABS.filter(([k]) => !(restricted && ['documents', 'changes'].includes(k))), ...(e.relatedTabs ?? []).map((r) => [`rel-${r.code}`, r.label])];
  const onKey = (ev) => { const i = tabs.findIndex(([k]) => k === tab); const n = ev.key === 'ArrowRight' ? tabs[(i + 1) % tabs.length] : ev.key === 'ArrowLeft' ? tabs[(i - 1 + tabs.length) % tabs.length] : null; if (n) { ev.preventDefault(); setTab(n[0]); document.getElementById(`e3-tab-${n[0]}`)?.focus(); } };
  const [recStatus, recLabel] = RECORD_STATUS[e.status];
  const [empStatus, empLabel] = EMPLOYMENT_STATUS[e.employmentStatus];
  return (
    <section aria-labelledby="e3-title" data-testid="employee-page">
      <p><Link to="/hr/employees">← Employee Directory</Link></p>
      {sp.get('sent') === '1' && <p className="mdm-banner" role="status" data-testid="e3-sent">Sent for approval to another HR manager.</p>}
      <header className="op-header">
        <PageHeader id="e3-title" title={<>{e.code} · {e.name}</>} status={<StatusBadge status={recStatus} label={recLabel} />} actions={<>{e.status === 'APPROVED' && <StatusBadge status={empStatus} label={empLabel} />}</>} />
        <dl className="op-figures">
          <div><dt>Department</dt><dd data-testid="e3-department">{e.department ?? '—'}</dd></div><div><dt>Designation</dt><dd data-testid="e3-designation">{e.designation ?? '—'}{e.grade ? ` (${e.grade})` : ''}</dd></div><div><dt>Type</dt><dd>{e.employmentTypeLabel}</dd></div>
          <div><dt>Joined</dt><dd>{formatDate(e.doj)}</dd></div><div><dt>Reports to</dt><dd>{e.manager ? <Link to={`/hr/employees/employee?id=${e.managerId}`}>{e.manager.emp_code} {e.manager.full_name}</Link> : '—'}</dd></div>
          <div><dt>Works at</dt><dd>{e.locationType === 'SITE' ? `Site ${e.site ?? e.project ?? ''}` : 'Head office'}</dd></div>
          {e.user !== undefined && <div><dt>User account</dt><dd data-testid="e3-user">{e.user ? `${e.user.username} (${String(e.user.lifecycle).toLowerCase()})` : 'None'}</dd></div>}
          {e.lastWorkingDate && <div><dt>Last working day</dt><dd>{formatDate(e.lastWorkingDate)}</dd></div>}
          {e.masked && !restricted && <div><dt>Statutory and bank</dt><dd>Masked for your role</dd></div>}
        </dl>
        <Actions e={e} mine={mine} />
      </header>
      <div role="tablist" aria-label="Employee sections" className="op-tabs" onKeyDown={onKey}>{tabs.map(([k, l]) => <button key={k} type="button" role="tab" id={`e3-tab-${k}`} aria-selected={tab === k} aria-controls={`e3-panel-${k}`} tabIndex={tab === k ? 0 : -1} className={`op-tab${tab === k ? ' is-active' : ''}`} onClick={() => setTab(k)} data-testid={`e3-tab-${k}`}>{l}</button>)}</div>
      <div role="tabpanel" id={`e3-panel-${tab}`} aria-labelledby={`e3-tab-${tab}`} className="op-panel" tabIndex={0}>
        {tab === 'personal' && <Personal e={e} />}
        {tab === 'employment' && <Employment e={e} />}
        {tab === 'statutory' && <Statutory e={e} />}
        {tab === 'bank' && <Banks e={e} />}
        {tab === 'documents' && <Documents e={e} />}
        {tab === 'history' && <History e={e} />}
        {tab === 'changes' && <Changes e={e} />}
        {tab === 'approvals' && <Approvals e={e} />}
        {tab === 'timeline' && <TimelineTab entity="hr_employee" id={e.id} />}
        {tab === 'discussion' && <DiscussionTab entity="hr_employee" id={e.id} />}
        {tab.startsWith('rel-') && <ul className="mdm-list">{(e.relatedTabs.find((r) => `rel-${r.code}` === tab)?.items ?? []).map((x) => <li key={x.label}>{x.route ? <Link to={x.route}>{x.label}</Link> : x.label} {x.value}</li>)}</ul>}
      </div>
    </section>
  );
}

function useRun(e) {
  const qc = useQueryClient();
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const run = async (fn, done) => { setError(null); setNote(null); try { const out = await fn(); if (done) setNote(typeof done === 'function' ? done(out) : done); qc.invalidateQueries({ queryKey: ['hr'] }); return out; } catch (err) { setError(errorInfo(err)); return null; } };
  return { run, error, note, setNote, e };
}

function Actions({ e, mine }) {
  const { run, error, note } = useRun(e);
  const [mode, setMode] = useState(null);
  const [reason, setReason] = useState('');
  const can = e.canAmend || e.isSelf;
  const confirm = async (fn, text) => { await run(fn, text); setMode(null); setReason(''); };
  return (
    <div data-testid="e3-actions">
      <div className="actions-row">
        {e.canSubmit && <button type="button" className="btn btn-primary" onClick={() => run(() => employees.submit(e.id), 'Sent for approval.')} data-testid="e3-submit">Send for approval</button>}
        {e.canEdit && <button type="button" className="btn" onClick={() => navigateTo(`/hr/employees/new?id=${e.id}`)} data-testid="e3-edit">{e.status === 'RETURNED' ? 'Correct' : 'Edit'}</button>}
        {e.status === 'SUBMITTED' && <button type="button" className="btn" onClick={() => setMode('withdraw')} data-testid="e3-withdraw">Withdraw</button>}
        {['SUBMITTED', 'RETURNED'].includes(e.status) && e.canCancel && <button type="button" className="btn" onClick={() => setMode('cancel')} data-testid="e3-cancel">Cancel</button>}
        {e.canDelete && <button type="button" className="btn" onClick={() => { if (window.confirm('Delete this draft?')) run(() => employees.remove(e.id)).then(() => navigateTo('/hr/employees')); }} data-testid="e3-delete">Delete draft</button>}
        {e.status === 'APPROVED' && can && <button type="button" className="btn" onClick={() => setMode('amend')} data-testid="e3-amend">{mine ? 'Ask for a change' : 'Amend'}</button>}
        {e.status === 'APPROVED' && e.canLinkUser && !e.user && <button type="button" className="btn" onClick={() => setMode('user')} data-testid="e3-user-btn">Create or link a user account</button>}
        {e.canPrint && !mine && <a className="btn" href={`/api/v1/hr/employees/${e.id}/print`} target="_blank" rel="noreferrer" data-testid="e3-print">Print</a>}
      </div>
      {(mode === 'withdraw' || mode === 'cancel') && <form className="mdm-panel" onSubmit={(ev) => { ev.preventDefault(); confirm(() => (mode === 'withdraw' ? employees.withdraw(e.id, reason) : employees.cancel(e.id, reason)), mode === 'withdraw' ? 'Withdrawn: it is a draft again.' : 'Cancelled.'); }}>
        <Field label="Reason (required)" name="reason" error={error}><textarea rows="2" required minLength={5} value={reason} onChange={(ev) => setReason(ev.target.value)} data-testid="e3-reason" /></Field>
        <div className="actions"><button type="button" className="btn" onClick={() => setMode(null)}>Close</button><button type="submit" className="btn btn-primary" data-testid="e3-reason-go">Confirm</button></div></form>}
      {mode === 'amend' && <Amend e={e} mine={mine} onDone={(msg) => { setMode(null); return msg; }} close={() => setMode(null)} />}
      {mode === 'user' && <UserLink e={e} close={() => setMode(null)} />}
      {note && <p role="status" className="mdm-banner" data-testid="e3-note">{note}</p>}
      {error?.form && !mode && <p className="field-error" role="alert">{error.form}</p>}
    </div>
  );
}

function UserLink({ e, close }) {
  const { run, error, note } = useRun(e);
  const [pick, setPick] = useState('');
  const [invite, setInvite] = useState(true);
  return (
    <div className="mdm-panel" data-testid="e3-user-panel">
      <h3>User account</h3>
      <p className="muted small">The account gets the employee code, e-mail, mobile and department; roles are asked for in User Management. Choose one of the two.</p>
      <div className="actions-row"><label className="check"><input type="checkbox" checked={invite} onChange={(ev) => setInvite(ev.target.checked)} /> Send an invitation</label>
        <button type="button" className="btn btn-primary" onClick={() => run(() => employees.createUser(e.id, { invite }), 'The account was created and linked.')} data-testid="e3-user-create">Create from this employee</button></div>
      <LookupField id="e3-link-user" label="Or link an existing account" lookup="iam/users" value={pick} onChange={setPick} error={error?.fields?.userId} />
      <div className="actions"><button type="button" className="btn" onClick={close}>Close</button><button type="button" className="btn" disabled={!pick} onClick={() => run(() => employees.linkUser(e.id, Number(pick)), 'The account was linked.')} data-testid="e3-user-link">Link the account</button></div>
      {note && <p role="status" className="mdm-banner">{note}</p>}{error?.form && <p className="field-error" role="alert">{error.form}</p>}
    </div>
  );
}

const SEP = [['NOTICE', 'On notice'], ['SEPARATED', 'Separated'], ['ABSCONDING', 'Absconding'], ['ACTIVE', 'Back to active']];
function Amend({ e, mine, close }) {
  const { run, error, note } = useRun(e);
  const self = mine || (e.isSelf && !e.canAmend);
  const kinds = [['PROFILE', 'Personal details'], ...(self ? [['STATUTORY', 'Statutory details'], ['BANK', 'Bank account']] : [['EMPLOYMENT', 'Employment details'], ['STATUTORY', 'Statutory details'], ['BANK', 'Bank account'], ...(e.canSeparate ? [['SEPARATION', 'Employment status']] : [])])];
  const [type, setType] = useState('PROFILE');
  const [reason, setReason] = useState('');
  const [when, setWhen] = useState(todayIST());
  const [f, setF] = useState({
    mobile: e.mobile ?? '', email: e.email ?? '', maritalStatus: e.maritalStatus ?? '', currentAddress: e.currentAddress ?? blankAddress(), permanentAddress: e.permanentAddress ?? blankAddress(), firstName: e.firstName, lastName: e.lastName ?? '',
    contacts: e.contacts.length ? e.contacts.map((c) => ({ type: c.type, name: c.name, relation: c.relation, phone: c.phone ?? '', dob: c.dob ?? '', sharePct: c.sharePct ?? '' })) : [blankContact('EMERGENCY')], editContacts: false,
    departmentId: e.departmentId ?? '', designationId: e.designationId ?? '', grade: e.grade ?? '', gradeTouched: true, branchId: e.branchId ?? '', managerId: e.managerId ?? '', costCentreId: e.costCentreId ?? '', locationType: e.locationType, siteId: e.siteId ?? '', confirmationDate: e.confirmationDate ?? '', eventType: '', referenceDoc: '',
    pan: '', aadhaar: '', uan: '', esicIp: '', ptState: '', lwfState: '', pf: '', esi: '', accountNo: '', ifsc: '', accountName: e.name,
    status: 'NOTICE', lastWorkingDate: dayIST(30), separationReason: '',
  });
  const set = (p) => setF((x) => ({ ...x, ...p }));
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const changes = () => {
    if (type === 'PROFILE') {
      const c = {};
      if (f.mobile !== (e.mobile ?? '')) c.mobile = f.mobile.replace(/[\s-]/g, '').replace(/^(\+91|0)/, '');
      if (f.email !== (e.email ?? '')) c.email = f.email || null;
      if (f.maritalStatus !== (e.maritalStatus ?? '')) c.maritalStatus = f.maritalStatus || null;
      if (!same(addressOrNull(f.currentAddress), addressOrNull(e.currentAddress))) c.currentAddress = addressOrNull(f.currentAddress);
      if (!same(addressOrNull(f.permanentAddress), addressOrNull(e.permanentAddress))) c.permanentAddress = addressOrNull(f.permanentAddress);
      if (!self) { if (f.firstName !== e.firstName) c.firstName = f.firstName; if (f.lastName !== (e.lastName ?? '')) c.lastName = f.lastName || null; }
      if (f.editContacts) c.contacts = contactsOut(f.contacts);
      return c;
    }
    if (type === 'EMPLOYMENT') {
      const c = {}; const m = { departmentId: 'departmentId', designationId: 'designationId', branchId: 'branchId', managerId: 'managerId', costCentreId: 'costCentreId', siteId: 'siteId' };
      for (const [k, key] of Object.entries(m)) { const now = f[k] === '' ? null : Number(f[k]); if (now !== (e[key] ?? null)) c[key] = now; }
      if (f.locationType !== e.locationType) c.locationType = f.locationType;
      if (f.grade && f.grade !== (e.grade ?? '')) c.grade = f.grade;
      if (f.confirmationDate && f.confirmationDate !== (e.confirmationDate ?? '')) c.confirmationDate = f.confirmationDate;
      return c;
    }
    if (type === 'STATUTORY') {
      const c = {}; if (f.pan) c.pan = f.pan.toUpperCase(); if (f.aadhaar) c.aadhaar = f.aadhaar.replace(/\s/g, ''); if (f.uan) c.uan = f.uan; if (f.esicIp) c.esicIp = f.esicIp; if (f.ptState) c.ptState = f.ptState.toUpperCase(); if (f.lwfState) c.lwfState = f.lwfState.toUpperCase();
      if (f.pf !== '') c.pfApplicable = f.pf === 'yes'; if (f.esi !== '') c.esiApplicable = f.esi === 'yes';
      return c;
    }
    if (type === 'BANK') return { accountNo: f.accountNo.replace(/\s/g, ''), ifsc: f.ifsc.toUpperCase(), accountName: f.accountName };
    return { status: f.status, lastWorkingDate: f.lastWorkingDate || null, separationReason: f.separationReason };
  };
  const submit = (ev) => {
    ev.preventDefault();
    const body = { type, changes: changes(), reason, ...(type === 'EMPLOYMENT' ? { effectiveDate: when, eventType: f.eventType || undefined, referenceDoc: f.referenceDoc || null } : type === 'SEPARATION' ? { effectiveDate: when } : { effectiveDate: when }) };
    run(() => (self ? employees.amendMine(body) : employees.amend(e.id, body)), (out) => (out.change.status === 'PENDING' ? 'Sent for approval. It applies on its effective date once approved.' : 'Saved.'));
  };
  const fe = (k) => error?.fields?.[k];
  return (
    <form className="mdm-panel" onSubmit={submit} data-testid="e3-amend-form">
      <h3>{self ? 'Ask for a change' : 'Amend'}</h3>
      <p className="muted small">An approved record is locked: a change is a request, approved by another person, and applied on its effective date.</p>
      <Field label="What changes" name="type" error={error}><select value={type} onChange={(ev) => setType(ev.target.value)} data-testid="e3-amend-type">{kinds.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      {type === 'PROFILE' && <div className="mdm-fields">
        {!self && <><Field label="First name" name="changes.firstName" error={error}><input value={f.firstName} onChange={(ev) => set({ firstName: ev.target.value })} /></Field><Field label="Last name" name="changes.lastName" error={error}><input value={f.lastName} onChange={(ev) => set({ lastName: ev.target.value })} /></Field></>}
        <Field label="Mobile" name="changes.mobile" error={error}><input inputMode="tel" value={f.mobile} onChange={(ev) => set({ mobile: ev.target.value })} data-testid="e3-amend-mobile" /></Field>
        <Field label="E-mail" name="changes.email" error={error}><input type="email" value={f.email} onChange={(ev) => set({ email: ev.target.value })} /></Field>
        <AddressFields legend="Current address" prefix="changes.currentAddress" value={f.currentAddress} onChange={(a) => set({ currentAddress: a })} error={error} />
        <AddressFields legend="Permanent address" prefix="changes.permanentAddress" value={f.permanentAddress} onChange={(a) => set({ permanentAddress: a })} error={error} />
        <label className="check"><input type="checkbox" checked={f.editContacts} onChange={(ev) => set({ editContacts: ev.target.checked })} /> Change the emergency contacts, family and nominees</label>
        {f.editContacts && <ContactsEditor value={f.contacts} onChange={(c) => set({ contacts: c })} error={error} />}
      </div>}
      {type === 'EMPLOYMENT' && <div><EmploymentFields v={f} set={set} error={error} />
        <div className="mdm-fields">
          <Field label="Confirmation date" name="changes.confirmationDate" error={error}><input type="date" value={f.confirmationDate} onChange={(ev) => set({ confirmationDate: ev.target.value })} /></Field>
          <Field label="Kind of change" name="eventType" error={error}><select value={f.eventType} onChange={(ev) => set({ eventType: ev.target.value })} data-testid="e3-amend-event"><option value="">Decide from what changes</option>{EVENT_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Letter or reference" name="referenceDoc" error={error}><input value={f.referenceDoc} maxLength={80} onChange={(ev) => set({ referenceDoc: ev.target.value })} /></Field>
        </div></div>}
      {type === 'STATUTORY' && <div className="mdm-fields">
        <p className="muted small">Fill only what changes. The new values are not shown again to anyone but HR and payroll.</p>
        <Field label="PAN" name="changes.pan" error={error}><input value={f.pan} maxLength={10} onChange={(ev) => set({ pan: ev.target.value.toUpperCase() })} autoComplete="off" data-testid="e3-amend-pan" /></Field>
        <Field label="Aadhaar" name="changes.aadhaar" error={error} hint="Only the last four digits are kept"><input inputMode="numeric" value={f.aadhaar} maxLength={12} onChange={(ev) => set({ aadhaar: ev.target.value })} autoComplete="off" /></Field>
        <Field label="UAN" name="changes.uan" error={error}><input inputMode="numeric" value={f.uan} maxLength={12} onChange={(ev) => set({ uan: ev.target.value })} /></Field>
        <Field label="ESIC insurance number" name="changes.esicIp" error={error}><input inputMode="numeric" value={f.esicIp} maxLength={17} onChange={(ev) => set({ esicIp: ev.target.value })} /></Field>
        <Field label="PF applicable" name="pf" error={error}><select value={f.pf} onChange={(ev) => set({ pf: ev.target.value })}><option value="">No change</option><option value="yes">Yes</option><option value="no">No</option></select></Field>
        <Field label="ESI applicable" name="esi" error={error}><select value={f.esi} onChange={(ev) => set({ esi: ev.target.value })}><option value="">No change</option><option value="yes">Yes</option><option value="no">No</option></select></Field>
        <Field label="PT state" name="changes.ptState" error={error}><input value={f.ptState} maxLength={3} onChange={(ev) => set({ ptState: ev.target.value.toUpperCase() })} /></Field>
        <Field label="LWF state" name="changes.lwfState" error={error}><input value={f.lwfState} maxLength={3} onChange={(ev) => set({ lwfState: ev.target.value.toUpperCase() })} /></Field>
      </div>}
      {type === 'BANK' && <div className="mdm-fields">
        <p className="muted small">The change is approved by the HR manager and verified by payroll before the salary goes to the new account.</p>
        <Field label="New account number" name="changes.accountNo" error={error}><input inputMode="numeric" value={f.accountNo} autoComplete="off" onChange={(ev) => set({ accountNo: ev.target.value })} data-testid="e3-amend-acct" /></Field>
        <Field label="IFSC" name="changes.ifsc" error={error}><input value={f.ifsc} maxLength={11} onChange={(ev) => set({ ifsc: ev.target.value.toUpperCase() })} data-testid="e3-amend-ifsc" /></Field>
        <Field label="Name on the account" name="changes.accountName" error={error}><input value={f.accountName} onChange={(ev) => set({ accountName: ev.target.value })} /></Field>
      </div>}
      {type === 'SEPARATION' && <div className="mdm-fields">
        <p className="muted small">On the effective date the person's user account is deactivated (separation or absconding).</p>
        <Field label="Status" name="changes.status" error={error}><select value={f.status} onChange={(ev) => set({ status: ev.target.value })} data-testid="e3-sep-status">{SEP.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Last working day" name="changes.lastWorkingDate" error={error}><input type="date" value={f.lastWorkingDate} onChange={(ev) => set({ lastWorkingDate: ev.target.value })} data-testid="e3-sep-lwd" /></Field>
        <Field label="Why" name="changes.separationReason" error={error}><textarea rows="2" minLength={5} value={f.separationReason} onChange={(ev) => set({ separationReason: ev.target.value })} data-testid="e3-sep-reason" /></Field>
      </div>}
      <Field label="Effective from" name="effectiveDate" error={error}><input type="date" value={when} onChange={(ev) => setWhen(ev.target.value)} data-testid="e3-amend-date" /></Field>
      <Field label="Reason (required)" name="reason" error={error}><textarea rows="2" required minLength={5} value={reason} onChange={(ev) => setReason(ev.target.value)} data-testid="e3-amend-reason" /></Field>
      {fe('changes') && <p className="field-error" role="alert">{fe('changes')}</p>}
      {error?.form && <p className="field-error" role="alert" data-testid="e3-amend-error">{error.form}</p>}
      {note && <p role="status" className="mdm-banner" data-testid="e3-amend-note">{note}</p>}
      <div className="actions"><button type="button" className="btn" onClick={close}>Close</button><button type="submit" className="btn btn-primary" data-testid="e3-amend-go">Send for approval</button></div>
    </form>
  );
}

function Personal({ e }) {
  const rows = [['Name', e.name], ['Gender', e.gender], ['Date of birth', e.dob ? formatDate(e.dob) : null], ['Blood group', e.bloodGroup], ['Marital status', e.maritalStatus], ['Mobile', e.mobile], ['E-mail', e.email], ['Permanent address', addrText(e.permanentAddress)], ['Current address', addrText(e.currentAddress) ?? (e.permanentAddress ? 'Same as the permanent address' : null)], ['Languages', e.languages.join(', ')], ['Skills', e.skills.join(', ')]];
  const groups = [['EMERGENCY', 'Emergency contacts'], ['FAMILY', 'Family'], ['NOMINEE', 'Nominees']];
  return (
    <div data-testid="e3-personal">
      <dl className="kv-list">{rows.filter(([, v]) => v !== undefined).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v || '—'}</dd></div>)}</dl>
      {e.contacts && groups.map(([t, l]) => { const list = e.contacts.filter((c) => c.type === t); return list.length ? <div key={t}><h3>{l}</h3><ul className="mdm-list">{list.map((c) => <li key={c.id}>{c.name} ({c.relation}){c.phone ? ` · ${c.phone}` : ''}{c.sharePct ? ` · ${c.sharePct}%` : ''}</li>)}</ul></div> : null; })}
      {e.education?.length > 0 && <><h3>Education</h3><ul className="mdm-list">{e.education.map((x) => <li key={x.id}>{x.qualification}{x.institute ? `, ${x.institute}` : ''}{x.year ? ` (${x.year})` : ''}{x.grade ? ` · ${x.grade}` : ''}</li>)}</ul></>}
      {e.experience?.length > 0 && <><h3>Previous experience</h3><ul className="mdm-list">{e.experience.map((x) => <li key={x.id}>{x.jobTitle}, {x.employer} · {formatDate(x.fromDate)} to {x.toDate ? formatDate(x.toDate) : 'date'}</li>)}</ul></>}
      {e.canEditDetails && <Details e={e} />}
    </div>
  );
}

function Details({ e }) {
  const { run, error, note } = useRun(e);
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ skills: e.skills.join(', '), languages: e.languages.join(', '), qualification: '', institute: '', year: '' });
  if (!open) return <button type="button" className="btn btn-small" onClick={() => setOpen(true)} data-testid="e3-details-open">Update skills, languages and education</button>;
  const split = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
  return (
    <form className="mdm-panel mdm-fields" onSubmit={(ev) => { ev.preventDefault(); run(() => employees.details(e.id, { skills: split(v.skills), languages: split(v.languages), ...(v.qualification ? { education: [...e.education.map((x) => ({ qualification: x.qualification, institute: x.institute, year: x.year, grade: x.grade })), { qualification: v.qualification, institute: v.institute || null, year: v.year ? Number(v.year) : null, grade: null }] } : {}), version: e.rowVersion }), 'Saved.'); }} data-testid="e3-details-form">
      <Field label="Skills (comma separated)" name="skills" error={error}><input value={v.skills} onChange={(ev) => setV({ ...v, skills: ev.target.value })} data-testid="e3-skills" /></Field>
      <Field label="Languages" name="languages" error={error}><input value={v.languages} onChange={(ev) => setV({ ...v, languages: ev.target.value })} /></Field>
      <Field label="Add a qualification" name="education" error={error}><input value={v.qualification} onChange={(ev) => setV({ ...v, qualification: ev.target.value })} /></Field>
      <Field label="Institute" name="institute" error={error}><input value={v.institute} onChange={(ev) => setV({ ...v, institute: ev.target.value })} /></Field>
      <Field label="Year" name="year" error={error}><input inputMode="numeric" maxLength={4} value={v.year} onChange={(ev) => setV({ ...v, year: ev.target.value })} /></Field>
      <div className="actions"><button type="button" className="btn" onClick={() => setOpen(false)}>Close</button><button type="submit" className="btn btn-primary" data-testid="e3-details-save">Save</button></div>
      {note && <p role="status" className="mdm-banner">{note}</p>}{error?.form && <p className="field-error" role="alert">{error.form}</p>}
    </form>
  );
}

function Employment({ e }) {
  const rows = [['Department', e.department], ['Designation', e.designation], ['Grade', e.grade], ['Branch', e.branch], ['Employment type', e.employmentTypeLabel], ['Date of joining', formatDate(e.doj)], ['Confirmation', e.confirmationDate ? formatDate(e.confirmationDate) : null], ['Reports to', e.manager ? `${e.manager.emp_code} ${e.manager.full_name}` : null], ['Cost centre', e.costCentre],
    ['Work location', e.locationType === 'SITE' ? `Site: ${e.site ?? e.project ?? ''}` : 'Head office'], ['Salary payment', e.salaryPaymentMode?.replace(/_/g, ' ').toLowerCase()], ['Employment status', e.employmentStatusLabel], ['Status from', e.statusEffectiveDate ? formatDate(e.statusEffectiveDate) : null], ['Last working day', e.lastWorkingDate ? formatDate(e.lastWorkingDate) : null], ['Reason', e.separationReason], ['Access', e.accessNote]];
  return <dl className="kv-list" data-testid="e3-employment">{rows.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

function Statutory({ e }) {
  const s = e.statutory;
  if (!s) return <p className="muted" data-testid="e3-statutory">No statutory details on file.</p>;
  return (
    <div data-testid="e3-statutory">
      {e.masked && <p className="mdm-banner" role="status">Masked for your role: statutory details are shown in full to HR, payroll and the employee.</p>}
      <dl className="kv-list">{[['PAN', s.pan], ['Aadhaar', s.aadhaar], ['UAN', s.uan], ['ESIC insurance number', s.esicIp], ['PF applicable', yn(s.pfApplicable)], ['ESI applicable', yn(s.esiApplicable)], ['Professional tax state', s.ptState], ['Labour welfare fund state', s.lwfState]].map(([k, v]) => <div key={k}><dt>{k}</dt><dd data-testid={k === 'PAN' ? 'e3-pan' : undefined}>{v || '—'}</dd></div>)}</dl>
    </div>
  );
}

function Banks({ e }) {
  const { run, error, note } = useRun(e);
  const [shown, setShown] = useState({});
  const [verify, setVerify] = useState(null);
  return (
    <div data-testid="e3-banks">
      {e.masked && <p className="mdm-banner" role="status">Masked for your role: bank details are shown to HR, payroll and the employee.</p>}
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Bank accounts"><table className="grid"><thead><tr><th>Account</th><th>IFSC · bank</th><th>Name</th><th>Status</th><th>Verified</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{e.banks.map((b) => <tr key={b.id} data-testid="e3-bank"><th scope="row" data-label="Account" className="num">{shown[b.id] ?? b.account}</th><td data-label="IFSC">{b.ifsc}{b.bankName ? <div className="muted small">{b.bankName}{b.branch ? `, ${b.branch}` : ''}</div> : null}</td><td data-label="Name">{b.accountName}</td>
          <td data-label="Status">{b.status.toLowerCase().replace(/_/g, ' ')}</td><td data-label="Verified">{b.verified.toLowerCase()}{b.verifiedBy ? ` by ${b.verifiedBy}` : ''}{b.verifyNote ? <div className="muted small">{b.verifyNote}</div> : null}</td>
          <td>{e.canSeeSensitive && !shown[b.id] && <button type="button" className="btn btn-small" onClick={async () => { const o = await run(() => employees.revealBank(e.id, b.id)); if (o) setShown({ ...shown, [b.id]: o.accountNo }); }} data-testid="e3-bank-show">Show (logged)</button>}
            {e.canVerifyBank && b.status === 'ACTIVE' && b.verified !== 'VERIFIED' && <button type="button" className="btn btn-small" onClick={() => setVerify({ id: b.id, result: 'VERIFIED', note: '' })} data-testid="e3-bank-verify">Verify</button>}</td></tr>)}</tbody></table></div>
      {e.banks.length === 0 && <p className="muted">No bank account.</p>}
      {verify && <form className="mdm-panel" onSubmit={(ev) => { ev.preventDefault(); run(() => employees.verifyBank(e.id, verify.id, { result: verify.result, note: verify.note }), 'Recorded.').then(() => setVerify(null)); }}>
        <Field label="Result" name="result" error={error}><select value={verify.result} onChange={(ev) => setVerify({ ...verify, result: ev.target.value })}><option value="VERIFIED">Verified</option><option value="FAILED">Failed</option></select></Field>
        <Field label="How it was verified (required)" name="note" error={error}><input value={verify.note} minLength={5} onChange={(ev) => setVerify({ ...verify, note: ev.target.value })} data-testid="e3-bank-note" /></Field>
        <div className="actions"><button type="button" className="btn" onClick={() => setVerify(null)}>Close</button><button type="submit" className="btn btn-primary" data-testid="e3-bank-verify-go">Record</button></div></form>}
      {note && <p role="status" className="mdm-banner">{note}</p>}{error?.form && <p className="field-error" role="alert">{error.form}</p>}
    </div>
  );
}

function Documents({ e }) {
  const { run, error } = useRun(e);
  const [d, setD] = useState(null);
  return (
    <div data-testid="e3-documents">
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Documents"><table className="grid"><thead><tr><th>Document</th><th>Number</th><th>Valid</th><th>State</th><th>Verified</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{e.documents.map((x) => <tr key={x.id} className={x.state === 'EXPIRED' ? 'is-overdue' : x.state === 'DUE' ? 'is-soon' : ''} data-testid="e3-doc"><th scope="row" data-label="Document">{x.typeLabel}</th><td data-label="Number">{x.number ?? '—'}</td><td data-label="Valid">{x.validFrom ? formatDate(x.validFrom) : '—'} to {x.validUntil ? formatDate(x.validUntil) : 'no expiry'}</td>
          <td data-label="State"><StatusBadge status={DOC_STATE[x.state][0]} label={DOC_STATE[x.state][1]} /></td><td data-label="Verified">{x.verifiedBy ? `${x.verifiedBy}, ${formatDate(x.verifiedAt)}` : '—'}</td>
          <td>{e.canEditDetails && !x.verifiedBy && <button type="button" className="btn btn-small" onClick={() => run(() => employees.verifyDocument(e.id, x.id))} data-testid="e3-doc-verify">Verify</button>}</td></tr>)}</tbody></table></div>
      {e.documents.length === 0 && <p className="muted">No document yet.</p>}
      {(e.canEditDetails || e.isSelf) && (d ? <form className="mdm-panel mdm-fields" onSubmit={(ev) => { ev.preventDefault(); run(() => employees.addDocument(e.id, { docType: d.docType, docNo: d.docNo || null, validFrom: d.validFrom || null, validUntil: d.validUntil || null })).then((o) => o && setD(null)); }} data-testid="e3-doc-form">
        <Field label="Document" name="docType" error={error}><select value={d.docType} onChange={(ev) => setD({ ...d, docType: ev.target.value })} data-testid="e3-doc-type">{DOC_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Number" name="docNo" error={error}><input value={d.docNo} onChange={(ev) => setD({ ...d, docNo: ev.target.value })} /></Field>
        <Field label="Valid from" name="validFrom" error={error}><input type="date" value={d.validFrom} onChange={(ev) => setD({ ...d, validFrom: ev.target.value })} /></Field>
        <Field label="Valid until" name="validUntil" error={error}><input type="date" value={d.validUntil} onChange={(ev) => setD({ ...d, validUntil: ev.target.value })} data-testid="e3-doc-until" /></Field>
        <div className="actions"><button type="button" className="btn" onClick={() => setD(null)}>Close</button><button type="submit" className="btn btn-primary" data-testid="e3-doc-save">Add</button></div></form>
        : <button type="button" className="btn" onClick={() => setD({ docType: 'ID_PROOF', docNo: '', validFrom: '', validUntil: '' })} data-testid="e3-doc-add">Record a document</button>)}
      {error?.form && <p className="field-error" role="alert">{error.form}</p>}
      <h3>Files</h3>
      <AttachmentList entity="hr_employee" entityId={e.id} canEdit={e.canEditDetails || e.isSelf} />{(e.canEditDetails || e.isSelf) && <FileUploader entity="hr_employee" entityId={e.id} />}
    </div>
  );
}

function History({ e }) {
  return (
    <div data-testid="e3-history">
      {e.history.length === 0 ? <p className="muted">The history starts when the employee is approved.</p> : (
        <ol className="mdm-list">{e.history.map((h) => <li key={h.id} data-testid="e3-history-row"><strong>{EVENT_LABELS[h.event] ?? h.event}</strong> · effective {formatDate(h.effectiveDate)}{h.referenceDoc ? ` · ${h.referenceDoc}` : ''}
          {Object.keys(h.to).length > 0 && <div className="muted small">{Object.entries(h.to).map(([k, v]) => `${k}: ${h.from[k] !== undefined ? `${h.from[k]} → ` : ''}${v}`).join(' · ')}</div>}{h.reason && <div className="muted small">{h.reason}</div>}</li>)}</ol>
      )}
    </div>
  );
}

function Changes({ e }) {
  const { run, error } = useRun(e);
  return (
    <div data-testid="e3-changes">
      {e.changes.length === 0 ? <p className="muted">No change has been asked for.</p> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Changes"><table className="grid"><thead><tr><th>Change</th><th>From</th><th>What</th><th>Status</th><th>Asked by</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{e.changes.map((c) => <tr key={c.id} data-testid="e3-change"><th scope="row" data-label="Change">{c.typeLabel}{c.senior ? ' (senior grade)' : ''}</th><td data-label="From">{formatDate(c.effectiveDate)}</td>
            <td data-label="What">{Object.entries(c.summary).map(([k, v]) => <div key={k}>{k}: {c.before[k] !== undefined ? `${c.before[k]} → ` : ''}{String(v)}</div>)}<div className="muted small">{c.reason}</div></td>
            <td data-label="Status"><StatusBadge status={CHANGE_STATUS[c.status][0]} label={CHANGE_STATUS[c.status][1]} />{c.appliedAt ? <div className="muted small">applied {formatDateTime(c.appliedAt)}</div> : null}</td><td data-label="Asked by">{c.requestedBy}{c.selfService ? ' (employee)' : ''}</td>
            <td>{['PENDING', 'RETURNED', 'SCHEDULED'].includes(c.status) && <button type="button" className="btn btn-small" onClick={() => { const r = window.prompt('Why is this change cancelled?'); if (r && r.length >= 5) run(() => employees.cancelChange(c.id, r)); }} data-testid="e3-change-cancel">Cancel</button>}</td></tr>)}</tbody></table></div>
      )}
      {error?.form && <p className="field-error" role="alert">{error.form}</p>}
    </div>
  );
}

function Approvals({ e }) {
  const ids = [e.instanceId, ...(e.changes ?? []).map((c) => c.instanceId)].filter(Boolean);
  const q = useQuery({ queryKey: ['workflow', 'instances', ids], queryFn: async () => Promise.all(ids.map(async (i) => (await api.get(`/workflow/instances/${i}`)).data)), enabled: ids.length > 0, retry: false });
  if (!ids.length) return <p className="muted">Nothing sent for approval yet.</p>;
  if (q.isPending) return <Skeleton label="Loading the approvals" rows={2} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  return <ul className="mdm-list" data-testid="e3-approvals">{q.data.map((i) => <li key={i.id}><strong>{i.docTypeLabel ?? i.docType}</strong> · {String(i.status).toLowerCase()} · sent by {i.submittedBy}{i.submittedAt ? ` on ${formatDateTime(i.submittedAt)}` : ''}{(i.history ?? []).length ? <ol>{i.history.map((h, k) => <li key={k}>{h.event} · {h.actor}{h.comment ? `: ${h.comment}` : ''}</li>)}</ol> : null}</li>)}</ul>;
}
