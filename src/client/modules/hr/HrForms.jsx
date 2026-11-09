import { LookupField } from '../../platform/forms/LookupField.jsx';
import { Field } from '../core/pages/ui.jsx';
import { CONTACT_TYPES } from './api.js';

// Pieces of the employee forms shared by the New Employee wizard and the amendments on Employee 360 (part 07.01).
export const blankAddress = () => ({ line: '', city: '', stateCode: '', pin: '' });
export const addressOrNull = (a) => (a && a.line?.trim() ? { line: a.line.trim(), city: a.city?.trim() || null, stateCode: a.stateCode?.trim().toUpperCase() || null, pin: a.pin?.trim() || null } : null);

/** An address: line, city, state code and PIN. `prefix` names the fields for server messages (permanentAddress.pin). */
export function AddressFields({ legend, prefix, value, onChange, error, testId }) {
  const set = (p) => onChange({ ...value, ...p });
  return (
    <fieldset className="mdm-fields" data-testid={testId}><legend>{legend}</legend>
      <Field label="Address" name={`${prefix}.line`} error={error}><input value={value.line ?? ''} maxLength={200} onChange={(e) => set({ line: e.target.value })} autoComplete="street-address" /></Field>
      <Field label="City" name={`${prefix}.city`} error={error}><input value={value.city ?? ''} maxLength={60} onChange={(e) => set({ city: e.target.value })} /></Field>
      <Field label="State code" name={`${prefix}.stateCode`} error={error} hint="For example MH"><input value={value.stateCode ?? ''} maxLength={3} onChange={(e) => set({ stateCode: e.target.value.toUpperCase() })} /></Field>
      <Field label="PIN code" name={`${prefix}.pin`} error={error}><input inputMode="numeric" value={value.pin ?? ''} maxLength={6} onChange={(e) => set({ pin: e.target.value })} /></Field>
    </fieldset>
  );
}

export const blankContact = (type = 'EMERGENCY') => ({ type, name: '', relation: '', phone: '', dob: '', sharePct: '' });
export const contactsOut = (list) => list.filter((c) => c.name.trim()).map((c) => ({ type: c.type, name: c.name.trim(), relation: c.relation.trim() || 'Not stated', phone: c.phone?.trim() || null, dob: c.dob || null, sharePct: c.type === 'NOMINEE' && c.sharePct !== '' ? String(c.sharePct) : null }));

/** Emergency contacts, family members and nominees (with their share, which must add up to 100%). */
export function ContactsEditor({ value, onChange, error }) {
  const setAt = (i, p) => onChange(value.map((c, j) => (j === i ? { ...c, ...p } : c)));
  const nominees = value.filter((c) => c.type === 'NOMINEE' && c.name.trim());
  const total = nominees.reduce((a, c) => a + (Number(c.sharePct) || 0), 0);
  return (
    <fieldset data-testid="contacts-editor"><legend>Emergency contacts, family and nominees</legend>
      {error?.fields?.contacts && <p className="field-error" role="alert">{error.fields.contacts}</p>}
      {value.map((c, i) => (
        <div key={i} className="mdm-fields mdm-card" data-testid="contact-row">
          <Field label="Kind" name={`contacts.${i}.type`} error={error}><select value={c.type} onChange={(e) => setAt(i, { type: e.target.value })}>{CONTACT_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Name" name={`contacts.${i}.name`} error={error}><input value={c.name} maxLength={100} onChange={(e) => setAt(i, { name: e.target.value })} data-testid="contact-name" /></Field>
          <Field label="Relation" name={`contacts.${i}.relation`} error={error}><input value={c.relation} maxLength={40} onChange={(e) => setAt(i, { relation: e.target.value })} data-testid="contact-relation" /></Field>
          <Field label="Phone" name={`contacts.${i}.phone`} error={error}><input inputMode="tel" value={c.phone} maxLength={16} onChange={(e) => setAt(i, { phone: e.target.value })} data-testid="contact-phone" /></Field>
          {c.type === 'NOMINEE' && <Field label="Share (%)" name={`contacts.${i}.sharePct`} error={error}><input inputMode="decimal" value={c.sharePct} maxLength={8} onChange={(e) => setAt(i, { sharePct: e.target.value })} data-testid="contact-share" /></Field>}
          <button type="button" className="btn btn-small" onClick={() => onChange(value.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      {nominees.length > 0 && <p className={total === 100 ? 'muted small' : 'field-error'} role="status">Nominee shares add up to {total}% (they must add up to 100%).</p>}
      <div className="actions-row">{CONTACT_TYPES.map(([k, l]) => <button key={k} type="button" className="btn btn-small" onClick={() => onChange([...value, blankContact(k)])} data-testid={`add-${k.toLowerCase()}`}>Add {l.toLowerCase()}</button>)}</div>
    </fieldset>
  );
}

/** The employment fields (organisation lookups). `designation` fills the grade when the row carries one. */
export function EmploymentFields({ v, set, error, only = null }) {
  const show = (k) => !only || only.includes(k);
  return (
    <div className="mdm-fields" data-testid="employment-fields">
      {show('departmentId') && <LookupField id="emp-department" label="Department" lookup="iam/departments" value={v.departmentId} onChange={(x) => set({ departmentId: x })} error={error?.fields?.departmentId} required />}
      {show('designationId') && <LookupField id="emp-designation" label="Designation" lookup="hr/designations" value={v.designationId} onChange={(x) => set({ designationId: x })} onPick={(r) => { if (r?.extra?.grade && !v.gradeTouched) set({ designationId: r.id, grade: r.extra.grade }); }} error={error?.fields?.designationId} required />}
      {show('grade') && <Field label="Grade" name="grade" error={error} hint="Filled from the designation"><input value={v.grade ?? ''} maxLength={20} onChange={(e) => set({ grade: e.target.value, gradeTouched: true })} data-testid="emp-grade" /></Field>}
      {show('branchId') && <LookupField id="emp-branch" label="Branch" lookup="hr/branches" value={v.branchId} onChange={(x) => set({ branchId: x })} error={error?.fields?.branchId} />}
      {show('managerId') && <LookupField id="emp-manager" label="Reports to" lookup="hr/employees" value={v.managerId} onChange={(x) => set({ managerId: x })} error={error?.fields?.managerId} />}
      {show('costCentreId') && <LookupField id="emp-cost-centre" label="Cost centre" lookup="iam/cost-centres" value={v.costCentreId} onChange={(x) => set({ costCentreId: x })} error={error?.fields?.costCentreId} />}
      {show('locationType') && <Field label="Work location" name="locationType" error={error}><select value={v.locationType} onChange={(e) => set({ locationType: e.target.value, ...(e.target.value === 'HO' ? { siteId: '', projectId: '' } : {}) })} data-testid="emp-location"><option value="HO">Head office</option><option value="SITE">Site</option></select></Field>}
      {show('siteId') && v.locationType === 'SITE' && <LookupField id="emp-site" label="Site" lookup="iam/sites" value={v.siteId} onChange={(x) => set({ siteId: x })} error={error?.fields?.siteId} required />}
    </div>
  );
}
