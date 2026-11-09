import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { AttachmentList, FileUploader } from '../core/components/Attachments.jsx';
import { Field, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { BLOOD_GROUPS, DOC_TYPES, EMPLOYMENT_TYPES, GENDERS, MARITAL, PAYMENT_MODES, employees } from './api.js';
import { AddressFields, ContactsEditor, EmploymentFields, addressOrNull, blankAddress, blankContact, contactsOut } from './HrForms.jsx';

// New Employee (HR, part 07.01): a wizard. 1 Personal details; 2 Employment (department, designation and grade filled from it, reporting manager, work location, cost centre); 3 Statutory and bank (PAN, Aadhaar
// last four digits only, UAN, ESIC, PF and ESI, the bank account); 4 Contacts, nominees, education and experience; 5 Review, with the people who look like this one found as it is typed (PAN, Aadhaar, mobile,
// name and date of birth); "Save draft" keeps it; 6 Documents (the files and their expiry) on the saved draft, then "Send for approval" goes to another HR manager. A draft opened with ?id= is corrected and sent from here.
// The draft is kept in this browser while it is typed. The wizard never shows a bank account or a PAN of someone else's record.
const STEPS = ['Personal', 'Employment', 'Statutory and bank', 'Contacts and background', 'Review', 'Documents'];
const DRAFT = 'erp.hr.employee-draft';
const blank = () => ({
  firstName: '', lastName: '', gender: '', dob: '', bloodGroup: '', maritalStatus: '', mobile: '', email: '', permanentAddress: blankAddress(), currentAddress: blankAddress(), sameAddress: true,
  departmentId: '', designationId: '', grade: '', gradeTouched: false, branchId: '', managerId: '', costCentreId: '', employmentType: 'PERMANENT', doj: '', confirmationDate: '', locationType: 'HO', siteId: '', salaryPaymentMode: 'BANK_TRANSFER',
  pan: '', aadhaar: '', uan: '', esicIp: '', pfApplicable: true, esiApplicable: false, ptState: '', lwfState: '', accountNo: '', ifsc: '', accountName: '',
  contacts: [blankContact('EMERGENCY')], education: [], experience: [], languages: '', skills: '',
});
const num = (v) => (v === '' || v == null ? null : Number(v));
export default function NewEmployeePage() {
  const editId = Number(new URLSearchParams(window.location.search).get('id')) || null;
  usePageTitle(editId ? 'New Employee (edit draft)' : 'New Employee');
  const existing = useQuery({ queryKey: ['hr', 'employee', editId], queryFn: () => employees.get(editId), enabled: Boolean(editId), retry: false });
  const [step, setStep] = useState(0);
  const [v, setV] = useState(() => { if (editId) return blank(); try { return { ...blank(), ...(JSON.parse(localStorage.getItem(DRAFT) ?? 'null') ?? {}) }; } catch { return blank(); } });
  const [dups, setDups] = useState([]);
  const [ack, setAck] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(editId ? { id: editId } : null);
  const [doc, setDoc] = useState({ docType: 'ID_PROOF', docNo: '', validFrom: '', validUntil: '' });
  const [docs, setDocs] = useState([]);
  useEffect(() => { if (!editId && !saved) try { localStorage.setItem(DRAFT, JSON.stringify({ ...v, accountNo: '', aadhaar: '' })); } catch { /* storage off */ } }, [v, editId, saved]);
  useEffect(() => {
    const e = existing.data; if (!e) return;
    setV({
      ...blank(), firstName: e.firstName, lastName: e.lastName ?? '', gender: e.gender, dob: e.dob ?? '', bloodGroup: e.bloodGroup ?? '', maritalStatus: e.maritalStatus ?? '', mobile: e.mobile ?? '', email: e.email ?? '',
      permanentAddress: e.permanentAddress ?? blankAddress(), currentAddress: e.currentAddress ?? blankAddress(), sameAddress: !e.currentAddress,
      departmentId: e.departmentId ?? '', designationId: e.designationId ?? '', grade: e.grade ?? '', gradeTouched: true, branchId: e.branchId ?? '', managerId: e.managerId ?? '', costCentreId: e.costCentreId ?? '', employmentType: e.employmentType, doj: e.doj, confirmationDate: e.confirmationDate ?? '',
      locationType: e.locationType, siteId: e.siteId ?? '', salaryPaymentMode: e.salaryPaymentMode, pan: e.statutory?.pan && !e.masked ? e.statutory.pan : '', aadhaar: '', uan: e.masked ? '' : e.statutory?.uan ?? '', esicIp: e.masked ? '' : e.statutory?.esicIp ?? '',
      pfApplicable: e.statutory?.pfApplicable ?? false, esiApplicable: e.statutory?.esiApplicable ?? false, ptState: e.statutory?.ptState ?? '', lwfState: e.statutory?.lwfState ?? '',
      contacts: e.contacts.length ? e.contacts.map((c) => ({ type: c.type, name: c.name, relation: c.relation, phone: c.phone ?? '', dob: c.dob ?? '', sharePct: c.sharePct ?? '' })) : [blankContact('EMERGENCY')],
      education: e.education.map((x) => ({ qualification: x.qualification, institute: x.institute ?? '', year: x.year ?? '', grade: x.grade ?? '' })), experience: e.experience.map((x) => ({ employer: x.employer, jobTitle: x.jobTitle, fromDate: x.fromDate, toDate: x.toDate ?? '', leavingReason: x.leavingReason ?? '' })),
      languages: e.languages.join(', '), skills: e.skills.join(', '),
    });
    setDocs(e.documents ?? []);
  }, [existing.data]);
  const set = (p) => setV((x) => ({ ...x, ...p }));
  const split = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
  const body = () => ({
    firstName: v.firstName.trim(), lastName: v.lastName.trim() || null, gender: v.gender, dob: v.dob, bloodGroup: v.bloodGroup || null, maritalStatus: v.maritalStatus || null, mobile: v.mobile.replace(/[\s-]/g, '').replace(/^(\+91|0)/, ''), email: v.email.trim() || null,
    permanentAddress: addressOrNull(v.permanentAddress), currentAddress: v.sameAddress ? null : addressOrNull(v.currentAddress),
    branchId: num(v.branchId), departmentId: num(v.departmentId), designationId: num(v.designationId), grade: v.grade.trim() || null, employmentType: v.employmentType, doj: v.doj, confirmationDate: v.confirmationDate || null, managerId: num(v.managerId), costCentreId: num(v.costCentreId),
    locationType: v.locationType, siteId: v.locationType === 'SITE' ? num(v.siteId) : null, projectId: null, salaryPaymentMode: v.salaryPaymentMode, languages: split(v.languages), skills: split(v.skills),
    contacts: contactsOut(v.contacts), education: v.education.filter((x) => x.qualification.trim()).map((x) => ({ qualification: x.qualification.trim(), institute: x.institute?.trim() || null, year: num(x.year), grade: x.grade?.trim() || null })),
    experience: v.experience.filter((x) => x.employer.trim() && x.fromDate).map((x) => ({ employer: x.employer.trim(), jobTitle: x.jobTitle.trim() || 'Not stated', fromDate: x.fromDate, toDate: x.toDate || null, leavingReason: x.leavingReason?.trim() || null })),
    statutory: { pan: v.pan.trim().toUpperCase() || null, aadhaar: v.aadhaar.replace(/\s/g, '') || null, uan: v.uan.trim() || null, esicIp: v.esicIp.trim() || null, pfApplicable: v.pfApplicable, esiApplicable: v.esiApplicable, ptState: v.ptState.trim().toUpperCase() || null, lwfState: v.lwfState.trim().toUpperCase() || null },
    bank: v.accountNo.trim() ? { accountNo: v.accountNo.replace(/\s/g, ''), ifsc: v.ifsc.trim().toUpperCase(), accountName: v.accountName.trim() } : null,
  });
  // the duplicate check as the identity is typed (FR-09)
  useEffect(() => {
    if (!v.firstName && !v.pan && !v.mobile) return undefined;
    const t = setTimeout(async () => { try { const b = body(); const c = await employees.check({ ...b, employeeId: editId ?? undefined }); setDups(c.duplicates); } catch { setDups([]); } }, 600);
    return () => clearTimeout(t);
  }, [v.firstName, v.lastName, v.dob, v.mobile, v.pan, v.aadhaar]);
  if (editId && existing.isPending) return <Skeleton label="Loading the employee" rows={4} />;
  if (editId && existing.isError) return <ErrorState error={existing.error} onRetry={existing.refetch} />;
  const fe = (k) => error?.fields?.[k];
  const next = () => {
    setError(null);
    const f = {};
    if (step === 0) { if (!v.firstName.trim()) f.firstName = 'required'; if (!v.gender) f.gender = 'required'; if (!v.dob) f.dob = 'required'; if (!v.mobile.trim()) f.mobile = 'required'; }
    if (step === 1) { if (!v.departmentId) f.departmentId = 'required'; if (!v.designationId) f.designationId = 'required'; if (!v.doj) f.doj = 'required'; if (v.locationType === 'SITE' && !v.siteId) f.siteId = 'required'; }
    if (step === 2 && !v.pan.trim()) f.pan = 'required';
    if (Object.keys(f).length) { setError({ form: 'Fill in the fields marked required.', fields: f }); return; }
    setStep(step + 1);
  };
  const save = async (andContinue) => {
    setBusy(true); setError(null);
    try {
      const out = saved ? await employees.update(saved.id, { ...body(), version: existing.data?.rowVersion ?? saved.rowVersion, acknowledgeDuplicates: ack }) : await employees.create({ ...body(), acknowledgeDuplicates: ack, submit: false });
      setSaved({ id: out.id, rowVersion: out.rowVersion, code: out.code });
      try { localStorage.removeItem(DRAFT); } catch { /* storage off */ }
      if (andContinue) setStep(5);
    } catch (e) { setError(e.code?.startsWith('DUPLICATE') ? { ...errorInfo(e), form: e.message } : errorInfo(e)); } finally { setBusy(false); }
  };
  const send = async () => {
    setBusy(true); setError(null);
    try { const out = await employees.submit(saved.id); navigateTo(`/hr/employees/employee?id=${saved.id}&sent=${out.status === 'SUBMITTED' ? 1 : 0}`, { force: true }); } catch (e) { setError(errorInfo(e)); } finally { setBusy(false); }
  };
  const addDoc = async () => {
    setError(null);
    try { setDocs(await employees.addDocument(saved.id, { docType: doc.docType, docNo: doc.docNo || null, validFrom: doc.validFrom || null, validUntil: doc.validUntil || null })); setDoc({ docType: 'ID_PROOF', docNo: '', validFrom: '', validUntil: '' }); } catch (e) { setError(errorInfo(e)); }
  };
  const blocked = dups.some((d) => d.block);
  return (
    <section aria-labelledby="ne-title" data-testid="new-employee">
      <h1 id="ne-title">{saved?.code ? `New Employee: ${saved.code}` : 'New Employee'}</h1>
      <ol className="wizard-steps" aria-label="Steps">{STEPS.map((s, i) => <li key={s} aria-current={i === step ? 'step' : undefined} className={i === step ? 'is-current' : i < step ? 'is-done' : ''}><button type="button" className="btn btn-small" onClick={() => setStep(i)} disabled={i > step || (i === 5 && !saved)}>{i + 1}. {s}</button></li>)}</ol>
      {dups.length > 0 && <div className="mdm-check" role="status" data-testid="ne-duplicates"><p><strong>{blocked ? 'Already employed:' : 'This looks like:'}</strong></p><ul>{dups.map((d) => <li key={`${d.id}${d.rule}`} className={d.block ? 'field-error' : ''}><a href={`/hr/employees/employee?id=${d.id}`} target="_blank" rel="noreferrer">{d.code} {d.name}</a>: {d.rule}{d.rehire ? ' (has left: a rehire)' : ''}</li>)}</ul></div>}
      {error?.form && <p className="field-error" role="alert" data-testid="ne-error">{error.form}{error.fields && Object.values(error.fields).some((x) => x && x !== 'required') ? ` ${Object.entries(error.fields).filter(([, x]) => x && x !== 'required').map(([k, x]) => `${k}: ${x}`).join('; ')}` : ''}</p>}
      {step === 0 && (
        <fieldset className="mdm-fields"><legend>Personal details</legend>
          <Field label="First name (required)" name="firstName" error={error}><input value={v.firstName} maxLength={60} onChange={(e) => set({ firstName: e.target.value })} aria-invalid={Boolean(fe('firstName'))} data-testid="ne-first" autoComplete="given-name" /></Field>
          <Field label="Last name" name="lastName" error={error}><input value={v.lastName} maxLength={60} onChange={(e) => set({ lastName: e.target.value })} data-testid="ne-last" autoComplete="family-name" /></Field>
          <Field label="Gender (required)" name="gender" error={error}><select value={v.gender} onChange={(e) => set({ gender: e.target.value })} data-testid="ne-gender"><option value="">Choose</option>{GENDERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Date of birth (required)" name="dob" error={error}><input type="date" value={v.dob} onChange={(e) => set({ dob: e.target.value })} data-testid="ne-dob" /></Field>
          <Field label="Blood group" name="bloodGroup" error={error}><select value={v.bloodGroup} onChange={(e) => set({ bloodGroup: e.target.value })}><option value="">Not stated</option>{BLOOD_GROUPS.map((b) => <option key={b} value={b}>{b}</option>)}</select></Field>
          <Field label="Marital status" name="maritalStatus" error={error}><select value={v.maritalStatus} onChange={(e) => set({ maritalStatus: e.target.value })}><option value="">Not stated</option>{MARITAL.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Mobile (required)" name="mobile" error={error} hint="Ten digits"><input inputMode="tel" value={v.mobile} maxLength={16} onChange={(e) => set({ mobile: e.target.value })} data-testid="ne-mobile" autoComplete="tel" /></Field>
          <Field label="E-mail" name="email" error={error}><input type="email" value={v.email} maxLength={160} onChange={(e) => set({ email: e.target.value })} data-testid="ne-email" autoComplete="email" /></Field>
          <AddressFields legend="Permanent address" prefix="permanentAddress" value={v.permanentAddress} onChange={(a) => set({ permanentAddress: a })} error={error} testId="ne-permanent" />
          <label className="check"><input type="checkbox" checked={v.sameAddress} onChange={(e) => set({ sameAddress: e.target.checked })} /> The current address is the same</label>
          {!v.sameAddress && <AddressFields legend="Current address" prefix="currentAddress" value={v.currentAddress} onChange={(a) => set({ currentAddress: a })} error={error} testId="ne-current" />}
        </fieldset>
      )}
      {step === 1 && (
        <fieldset><legend>Employment</legend>
          <EmploymentFields v={v} set={set} error={error} />
          <div className="mdm-fields">
            <Field label="Employment type (required)" name="employmentType" error={error}><select value={v.employmentType} onChange={(e) => set({ employmentType: e.target.value })} data-testid="ne-type">{EMPLOYMENT_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="Date of joining (required)" name="doj" error={error}><input type="date" value={v.doj} onChange={(e) => set({ doj: e.target.value })} data-testid="ne-doj" /></Field>
            <Field label="Confirmation date" name="confirmationDate" error={error}><input type="date" value={v.confirmationDate} onChange={(e) => set({ confirmationDate: e.target.value })} /></Field>
            <Field label="Salary payment" name="salaryPaymentMode" error={error}><select value={v.salaryPaymentMode} onChange={(e) => set({ salaryPaymentMode: e.target.value })}>{PAYMENT_MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          </div>
        </fieldset>
      )}
      {step === 2 && (
        <fieldset className="mdm-fields"><legend>Statutory and bank (restricted: only HR and payroll see these once saved)</legend>
          <Field label="PAN (required)" name="statutory.pan" error={error} hint="Five letters, four digits, a letter; the fourth letter is P"><input value={v.pan} maxLength={10} onChange={(e) => set({ pan: e.target.value.toUpperCase() })} autoComplete="off" data-testid="ne-pan" /></Field>
          <Field label="Aadhaar" name="statutory.aadhaar" error={error} hint="Only the last four digits are kept"><input inputMode="numeric" value={v.aadhaar} maxLength={12} onChange={(e) => set({ aadhaar: e.target.value })} autoComplete="off" data-testid="ne-aadhaar" /></Field>
          <Field label="UAN" name="statutory.uan" error={error}><input inputMode="numeric" value={v.uan} maxLength={12} onChange={(e) => set({ uan: e.target.value })} /></Field>
          <Field label="ESIC insurance number" name="statutory.esicIp" error={error}><input inputMode="numeric" value={v.esicIp} maxLength={17} onChange={(e) => set({ esicIp: e.target.value })} /></Field>
          <label className="check"><input type="checkbox" checked={v.pfApplicable} onChange={(e) => set({ pfApplicable: e.target.checked })} /> PF applicable</label>
          <label className="check"><input type="checkbox" checked={v.esiApplicable} onChange={(e) => set({ esiApplicable: e.target.checked })} /> ESI applicable</label>
          <Field label="Professional tax state" name="statutory.ptState" error={error} hint="For example MH"><input value={v.ptState} maxLength={3} onChange={(e) => set({ ptState: e.target.value.toUpperCase() })} /></Field>
          <Field label="Labour welfare fund state" name="statutory.lwfState" error={error}><input value={v.lwfState} maxLength={3} onChange={(e) => set({ lwfState: e.target.value.toUpperCase() })} /></Field>
          {v.salaryPaymentMode === 'BANK_TRANSFER' && <>
            <Field label="Bank account number" name="bank.accountNo" error={error}><input inputMode="numeric" value={v.accountNo} autoComplete="off" onChange={(e) => set({ accountNo: e.target.value })} data-testid="ne-acct" /></Field>
            <Field label="IFSC" name="bank.ifsc" error={error} hint="Four letters, a zero and six letters or digits"><input value={v.ifsc} maxLength={11} onChange={(e) => set({ ifsc: e.target.value.toUpperCase() })} data-testid="ne-ifsc" /></Field>
            <Field label="Name on the account" name="bank.accountName" error={error}><input value={v.accountName} onChange={(e) => set({ accountName: e.target.value })} data-testid="ne-acct-name" /></Field></>}
        </fieldset>
      )}
      {step === 3 && (
        <div>
          <ContactsEditor value={v.contacts} onChange={(c) => set({ contacts: c })} error={error} />
          <fieldset><legend>Education</legend>
            {v.education.map((x, i) => <div key={i} className="mdm-fields mdm-card"><Field label="Qualification" name={`education.${i}.qualification`} error={error}><input value={x.qualification} onChange={(e) => set({ education: v.education.map((y, j) => (j === i ? { ...y, qualification: e.target.value } : y)) })} /></Field>
              <Field label="Institute" name={`education.${i}.institute`} error={error}><input value={x.institute} onChange={(e) => set({ education: v.education.map((y, j) => (j === i ? { ...y, institute: e.target.value } : y)) })} /></Field>
              <Field label="Year" name={`education.${i}.year`} error={error}><input inputMode="numeric" value={x.year} maxLength={4} onChange={(e) => set({ education: v.education.map((y, j) => (j === i ? { ...y, year: e.target.value } : y)) })} /></Field>
              <button type="button" className="btn btn-small" onClick={() => set({ education: v.education.filter((_, j) => j !== i) })}>Remove</button></div>)}
            <button type="button" className="btn btn-small" onClick={() => set({ education: [...v.education, { qualification: '', institute: '', year: '', grade: '' }] })} data-testid="add-education">Add a qualification</button>
          </fieldset>
          <fieldset><legend>Previous experience</legend>
            {v.experience.map((x, i) => <div key={i} className="mdm-fields mdm-card"><Field label="Employer" name={`experience.${i}.employer`} error={error}><input value={x.employer} onChange={(e) => set({ experience: v.experience.map((y, j) => (j === i ? { ...y, employer: e.target.value } : y)) })} /></Field>
              <Field label="Job title" name={`experience.${i}.jobTitle`} error={error}><input value={x.jobTitle} onChange={(e) => set({ experience: v.experience.map((y, j) => (j === i ? { ...y, jobTitle: e.target.value } : y)) })} /></Field>
              <Field label="From" name={`experience.${i}.fromDate`} error={error}><input type="date" value={x.fromDate} onChange={(e) => set({ experience: v.experience.map((y, j) => (j === i ? { ...y, fromDate: e.target.value } : y)) })} /></Field>
              <Field label="To" name={`experience.${i}.toDate`} error={error}><input type="date" value={x.toDate} onChange={(e) => set({ experience: v.experience.map((y, j) => (j === i ? { ...y, toDate: e.target.value } : y)) })} /></Field>
              <button type="button" className="btn btn-small" onClick={() => set({ experience: v.experience.filter((_, j) => j !== i) })}>Remove</button></div>)}
            <button type="button" className="btn btn-small" onClick={() => set({ experience: [...v.experience, { employer: '', jobTitle: '', fromDate: '', toDate: '', leavingReason: '' }] })} data-testid="add-experience">Add a job</button>
          </fieldset>
          <div className="mdm-fields">
            <Field label="Languages (comma separated)" name="languages" error={error}><input value={v.languages} onChange={(e) => set({ languages: e.target.value })} /></Field>
            <Field label="Skills (comma separated)" name="skills" error={error} hint="Detailed skills and certificates are kept with training"><input value={v.skills} onChange={(e) => set({ skills: e.target.value })} /></Field>
          </div>
        </div>
      )}
      {step === 4 && (
        <div data-testid="ne-review">
          <dl className="kv-list">{[['Name', `${v.firstName} ${v.lastName}`.trim()], ['Gender', GENDERS.find(([k]) => k === v.gender)?.[1]], ['Date of birth', v.dob], ['Mobile', v.mobile], ['E-mail', v.email], ['Type', EMPLOYMENT_TYPES.find(([k]) => k === v.employmentType)?.[1]], ['Date of joining', v.doj], ['Work location', v.locationType === 'SITE' ? 'Site' : 'Head office'], ['Grade', v.grade], ['PAN', v.pan ? `••••••${v.pan.slice(-4)}` : ''], ['Bank account', v.accountNo ? `••••••${v.accountNo.slice(-4)} · ${v.ifsc}` : 'none'], ['Emergency contacts', String(v.contacts.filter((c) => c.type === 'EMERGENCY' && c.name).length)], ['Nominees', String(v.contacts.filter((c) => c.type === 'NOMINEE' && c.name).length)]].map(([k, x]) => <div key={k}><dt>{k}</dt><dd>{x || '—'}</dd></div>)}</dl>
          {!blocked && dups.length > 0 && <label className="check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="ne-ack" /> I checked: this is a different person or a rehire</label>}
          <p className="muted small">Saving keeps a draft. You then add the documents and send it for approval to another HR manager.</p>
        </div>
      )}
      {step === 5 && saved && (
        <div data-testid="ne-documents">
          <h2>Documents</h2>
          <p className="muted">Upload the scanned documents of {saved.code ?? 'the employee'}, then record each one with its number and expiry so that HR is told before it lapses.</p>
          <AttachmentList entity="hr_employee" entityId={saved.id} canEdit />
          <FileUploader entity="hr_employee" entityId={saved.id} />
          <form className="mdm-panel mdm-fields" onSubmit={(e) => { e.preventDefault(); addDoc(); }}>
            <Field label="Document" name="docType" error={error}><select value={doc.docType} onChange={(e) => setDoc({ ...doc, docType: e.target.value })} data-testid="ne-doc-type">{DOC_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="Number" name="docNo" error={error}><input value={doc.docNo} onChange={(e) => setDoc({ ...doc, docNo: e.target.value })} /></Field>
            <Field label="Valid from" name="validFrom" error={error}><input type="date" value={doc.validFrom} onChange={(e) => setDoc({ ...doc, validFrom: e.target.value })} /></Field>
            <Field label="Valid until" name="validUntil" error={error}><input type="date" value={doc.validUntil} onChange={(e) => setDoc({ ...doc, validUntil: e.target.value })} data-testid="ne-doc-until" /></Field>
            <button type="submit" className="btn" data-testid="ne-doc-add">Record the document</button>
          </form>
          {docs.length > 0 && <ul className="mdm-list" data-testid="ne-doc-list">{docs.map((d) => <li key={d.id}>{d.typeLabel}{d.number ? ` ${d.number}` : ''}{d.validUntil ? ` · valid until ${d.validUntil}` : ''}</li>)}</ul>}
        </div>
      )}
      <div className="actions">
        <button type="button" className="btn" onClick={() => { if (window.confirm('Leave this page? A new employee is kept as a draft in this browser until it is saved.')) navigateTo('/hr/employees'); }}>Cancel</button>
        {step > 0 && <button type="button" className="btn" onClick={() => setStep(step - 1)}>Back</button>}
        {step < 4 && <button type="button" className="btn btn-primary" onClick={next} data-testid="ne-next">Next</button>}
        {step === 4 && <><button type="button" className="btn" disabled={busy || blocked} onClick={() => save(false)} data-testid="ne-save">Save draft</button><button type="button" className="btn btn-primary" disabled={busy || blocked} onClick={() => save(true)} data-testid="ne-save-docs">{busy ? 'Saving...' : 'Save and add documents'}</button></>}
        {step === 5 && <><button type="button" className="btn" onClick={() => navigateTo(`/hr/employees/employee?id=${saved.id}`)} data-testid="ne-later">Finish later</button><button type="button" className="btn btn-primary" disabled={busy} onClick={send} data-testid="ne-send">{busy ? 'Sending...' : 'Send for approval'}</button></>}
      </div>
    </section>
  );
}
