import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { Field, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { EMPLOYMENT_TYPES, dayIST, recruit } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// New Requisition (HR, part 07.02): department, designation, project, positions, new or replacement (naming who is replaced), employment type, work location, the reporting manager, the budgeted CTC range a year,
// the date it is required and why. As it is typed the headcount plan is read: planned positions, people in post, open positions, and whether this requisition is within the plan or beyond it (then the director also approves).
// Save draft keeps it; Send for approval goes to the department or project head, the HR manager and, beyond the plan, the director. A draft or returned requisition opened with ?id= is corrected here.
const blank = () => ({ departmentId: '', designationId: '', projectId: '', positions: 1, reason: 'NEW', replacesEmployeeId: '', employmentType: 'PERMANENT', locationType: 'HO', siteId: '', managerId: '', ctcMin: '', ctcMax: '', requiredBy: dayIST(30), justification: '' });
const num = (v) => (v === '' || v == null ? null : Number(v));
export default function NewRequisitionPage() {
  const editId = Number(new URLSearchParams(window.location.search).get('id')) || null;
  usePageTitle(editId ? 'Requisition (correct)' : 'New Requisition');
  const existing = useQuery({ queryKey: ['hr', 'req', editId], queryFn: () => recruit.req(editId), enabled: Boolean(editId), retry: false });
  const [v, setV] = useState(blank);
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (p) => setV((x) => ({ ...x, ...p }));
  useEffect(() => {
    const r = existing.data; if (!r) return;
    setV({ departmentId: r.departmentId, designationId: r.designationId, projectId: r.projectId ?? '', positions: r.positions, reason: r.reason, replacesEmployeeId: r.replacesEmployeeId ?? '', employmentType: r.employmentType, locationType: r.locationType, siteId: r.siteId ?? '', managerId: r.managerId ?? '', ctcMin: r.ctcMin ?? '', ctcMax: r.ctcMax ?? '', requiredBy: r.requiredBy, justification: r.justification ?? '' });
  }, [existing.data]);
  useEffect(() => {
    if (!v.departmentId || !v.designationId) { setPlan(null); return undefined; }
    const t = setTimeout(async () => { try { setPlan(await recruit.planCheck({ departmentId: v.departmentId, designationId: v.designationId, projectId: v.projectId || undefined, positions: v.positions || 1, requisitionId: editId || undefined })); } catch { setPlan(null); } }, 400);
    return () => clearTimeout(t);
  }, [v.departmentId, v.designationId, v.projectId, v.positions, editId]);
  if (editId && existing.isPending) return <Skeleton label="Loading the requisition" rows={4} />;
  if (editId && existing.isError) return <ErrorState error={existing.error} onRetry={existing.refetch} />;
  const body = () => ({ departmentId: num(v.departmentId), designationId: num(v.designationId), projectId: num(v.projectId), positions: Number(v.positions), reason: v.reason, replacesEmployeeId: v.reason === 'REPLACEMENT' ? num(v.replacesEmployeeId) : null, employmentType: v.employmentType, locationType: v.locationType, siteId: v.locationType === 'SITE' ? num(v.siteId) : null, managerId: num(v.managerId), ctcMin: String(v.ctcMin), ctcMax: String(v.ctcMax), requiredBy: v.requiredBy, justification: v.justification || null });
  const save = async (submit) => {
    setBusy(true); setError(null);
    try {
      const out = editId ? await recruit.reqUpdate(editId, { ...body(), version: existing.data.rowVersion }) : await recruit.reqCreate({ ...body(), submit });
      if (editId && submit) await recruit.reqSubmit(editId);
      navigateTo(`/hr/requisitions/requisition?id=${out.id}${submit ? '&sent=1' : ''}`, { force: true });
    } catch (e) { setError(errorInfo(e)); } finally { setBusy(false); }
  };
  const fe = (k) => error?.fields?.[k];
  return (
    <section aria-labelledby="nr-title" data-testid="new-requisition">
      <PageHeader id="nr-title" title={editId ? `Requisition ${existing.data?.docNo}` : 'New Requisition'} />
      {error?.form && <p className="field-error" role="alert" data-testid="nr-error">{error.form}{error.fields ? ` ${Object.entries(error.fields).map(([k, x]) => `${k}: ${x}`).join('; ')}` : ''}</p>}
      <form className="mdm-fields" onSubmit={(e) => { e.preventDefault(); save(false); }}>
        <LookupField id="nr-department" label="Department" lookup="iam/departments" value={v.departmentId} onChange={(x) => set({ departmentId: x })} error={fe('departmentId')} required />
        <LookupField id="nr-designation" label="Designation" lookup="hr/designations" value={v.designationId} onChange={(x) => set({ designationId: x })} error={fe('designationId')} required />
        <LookupField id="nr-project" label="Project" lookup="iam/projects" value={v.projectId} onChange={(x) => set({ projectId: x })} error={fe('projectId')} />
        <Field label="Positions (required)" name="positions" error={error}><input type="number" min="1" max="500" value={v.positions} onChange={(e) => set({ positions: e.target.value })} data-testid="nr-positions" /></Field>
        <Field label="Reason" name="reason" error={error}><select value={v.reason} onChange={(e) => set({ reason: e.target.value })} data-testid="nr-reason"><option value="NEW">New position</option><option value="REPLACEMENT">Replacement</option></select></Field>
        {v.reason === 'REPLACEMENT' && <LookupField id="nr-replaces" label="Employee replaced" lookup="hr/employees" value={v.replacesEmployeeId} onChange={(x) => set({ replacesEmployeeId: x })} error={fe('replacesEmployeeId')} required />}
        <Field label="Employment type" name="employmentType" error={error}><select value={v.employmentType} onChange={(e) => set({ employmentType: e.target.value })}>{EMPLOYMENT_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Work location" name="locationType" error={error}><select value={v.locationType} onChange={(e) => set({ locationType: e.target.value })} data-testid="nr-location"><option value="HO">Head office</option><option value="SITE">Site</option></select></Field>
        {v.locationType === 'SITE' && <LookupField id="nr-site" label="Site" lookup="iam/sites" value={v.siteId} onChange={(x) => set({ siteId: x })} error={fe('siteId')} />}
        <LookupField id="nr-manager" label="Reports to" lookup="hr/employees" value={v.managerId} onChange={(x) => set({ managerId: x })} error={fe('managerId')} />
        <Field label="Budgeted CTC from, a year (₹)" name="ctcMin" error={error}><input inputMode="decimal" value={v.ctcMin} onChange={(e) => set({ ctcMin: e.target.value })} data-testid="nr-ctc-min" /></Field>
        <Field label="Budgeted CTC to, a year (₹)" name="ctcMax" error={error}><input inputMode="decimal" value={v.ctcMax} onChange={(e) => set({ ctcMax: e.target.value })} data-testid="nr-ctc-max" /></Field>
        <Field label="Required by" name="requiredBy" error={error}><input type="date" value={v.requiredBy} onChange={(e) => set({ requiredBy: e.target.value })} data-testid="nr-required" /></Field>
        <Field label="Why" name="justification" error={error}><textarea rows="3" value={v.justification} onChange={(e) => set({ justification: e.target.value })} data-testid="nr-why" /></Field>
      </form>
      {plan && <div className={`mdm-banner${plan.beyond ? ' is-warning' : ''}`} role="status" data-testid="nr-plan"><strong>{plan.beyond ? (plan.hasPlan ? 'Beyond the headcount plan: the director also approves.' : 'No headcount plan for this department: the director also approves.') : 'Within the headcount plan.'}</strong> Planned {plan.hasPlan ? plan.planned : '—'} · in post {plan.filled} · other open positions {plan.open} · asked {plan.requested}.</div>}
      <div className="actions">
        <button type="button" className="btn" onClick={() => navigateTo('/hr/requisitions')}>Cancel</button>
        <button type="button" className="btn" disabled={busy} onClick={() => save(false)} data-testid="nr-save">Save draft</button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => save(true)} data-testid="nr-send">{busy ? 'Saving...' : 'Send for approval'}</button>
      </div>
    </section>
  );
}
