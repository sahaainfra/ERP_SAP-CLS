import { useState } from 'react';
import { Field, errorInfo } from '../core/pages/ui.jsx';
import { GENDERS } from './api.js';
import { AddressFields, ContactsEditor, addressOrNull, blankAddress, blankContact, contactsOut } from './HrForms.jsx';

// The pre-joining details of a candidate (part 07.02, FR-05): name, date of birth, address, emergency contact and nominee, PAN, Aadhaar (only the last four digits are kept), UAN, bank account. The candidate fills it
// through the offer link after accepting; HR can enter it on the candidate. `onSave(body)` sends it; what is entered here is what the employee record is made from, so nothing is typed twice.
export default function PrejoiningForm({ onSave, initialName = '', doneNote = 'Saved.' }) {
  const [v, setV] = useState({ firstName: initialName.split(' ')[0] ?? '', lastName: initialName.split(' ').slice(1).join(' '), gender: '', dob: '', permanentAddress: blankAddress(), contacts: [blankContact('EMERGENCY')], pan: '', aadhaar: '', uan: '', pf: true, accountNo: '', ifsc: '', accountName: initialName });
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (p) => setV((x) => ({ ...x, ...p }));
  const submit = async (e) => {
    e.preventDefault(); setError(null); setNote(null); setBusy(true);
    try {
      await onSave({
        firstName: v.firstName.trim(), lastName: v.lastName.trim() || null, gender: v.gender, dob: v.dob, bloodGroup: null, maritalStatus: null, permanentAddress: addressOrNull(v.permanentAddress), currentAddress: null, contacts: contactsOut(v.contacts), education: [], experience: [],
        statutory: { pan: v.pan.trim().toUpperCase() || null, aadhaar: v.aadhaar.replace(/\s/g, '') || null, uan: v.uan.trim() || null, esicIp: null, pfApplicable: v.pf, esiApplicable: false, ptState: v.permanentAddress.stateCode || null, lwfState: null },
        bank: v.accountNo.trim() ? { accountNo: v.accountNo.replace(/\s/g, ''), ifsc: v.ifsc.trim().toUpperCase(), accountName: v.accountName.trim() } : null,
      });
      setNote(doneNote);
    } catch (err) { setError(errorInfo(err)); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} data-testid="prejoining-form">
      <fieldset className="mdm-fields"><legend>About you</legend>
        <Field label="First name (required)" name="firstName" error={error}><input value={v.firstName} onChange={(e) => set({ firstName: e.target.value })} required data-testid="pj-first" /></Field>
        <Field label="Last name" name="lastName" error={error}><input value={v.lastName} onChange={(e) => set({ lastName: e.target.value })} data-testid="pj-last" /></Field>
        <Field label="Gender (required)" name="gender" error={error}><select value={v.gender} onChange={(e) => set({ gender: e.target.value })} required data-testid="pj-gender"><option value="">Choose</option>{GENDERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Date of birth (required)" name="dob" error={error}><input type="date" value={v.dob} onChange={(e) => set({ dob: e.target.value })} required data-testid="pj-dob" /></Field>
      </fieldset>
      <AddressFields legend="Permanent address" prefix="permanentAddress" value={v.permanentAddress} onChange={(a) => set({ permanentAddress: a })} error={error} testId="pj-address" />
      <ContactsEditor value={v.contacts} onChange={(c) => set({ contacts: c })} error={error} />
      <fieldset className="mdm-fields"><legend>Statutory and bank (kept encrypted; only HR and payroll see them)</legend>
        <Field label="PAN" name="statutory.pan" error={error} hint="Five letters, four digits, a letter; the fourth letter is P"><input value={v.pan} maxLength={10} onChange={(e) => set({ pan: e.target.value.toUpperCase() })} autoComplete="off" data-testid="pj-pan" /></Field>
        <Field label="Aadhaar" name="statutory.aadhaar" error={error} hint="Only the last four digits are kept"><input inputMode="numeric" value={v.aadhaar} maxLength={12} onChange={(e) => set({ aadhaar: e.target.value })} autoComplete="off" data-testid="pj-aadhaar" /></Field>
        <Field label="UAN (if you have one)" name="statutory.uan" error={error}><input inputMode="numeric" value={v.uan} maxLength={12} onChange={(e) => set({ uan: e.target.value })} /></Field>
        <label className="check"><input type="checkbox" checked={v.pf} onChange={(e) => set({ pf: e.target.checked })} /> Provident fund applies</label>
        <Field label="Bank account number" name="bank.accountNo" error={error}><input inputMode="numeric" value={v.accountNo} autoComplete="off" onChange={(e) => set({ accountNo: e.target.value })} data-testid="pj-acct" /></Field>
        <Field label="IFSC" name="bank.ifsc" error={error}><input value={v.ifsc} maxLength={11} onChange={(e) => set({ ifsc: e.target.value.toUpperCase() })} data-testid="pj-ifsc" /></Field>
        <Field label="Name on the account" name="bank.accountName" error={error}><input value={v.accountName} onChange={(e) => set({ accountName: e.target.value })} /></Field>
      </fieldset>
      {error?.form && <p className="field-error" role="alert" data-testid="pj-error">{error.form}{error.fields ? ` ${Object.entries(error.fields).map(([k, x]) => `${k}: ${x}`).join('; ')}` : ''}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="pj-note">{note}</p>}
      <div className="actions"><button type="submit" className="btn btn-primary" disabled={busy} data-testid="pj-save">{busy ? 'Saving...' : 'Save the details'}</button></div>
    </form>
  );
}
