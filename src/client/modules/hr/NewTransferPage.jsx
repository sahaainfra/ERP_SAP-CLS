import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { KINDS, dayIST, deploy } from './api.js';

// Transfer Request (HR, part 07.03): the employee, transfer or secondment, the receiving project, site and crew, the role there, the last day at the old place (relieving) and the first day at the new one (joining),
// the return date of a secondment, the reason, and whether travel and accommodation are needed. It goes to the current project manager, the receiving project manager (another project) and the HR manager; when it is
// approved the old posting ends on the relieving date and the new one starts on the joining date. A draft or returned transfer opened with ?id= is corrected here.
const blank = () => ({ employeeId: '', kind: 'TRANSFER', toProjectId: '', toSiteId: '', toCrewId: '', siteRole: '', relieveDate: dayIST(7), joinDate: dayIST(8), returnDate: '', reason: '', travelRequired: false, accommodationRequired: false });
const num = (v) => (v === '' || v == null ? null : Number(v));
export default function NewTransferPage() {
  const editId = Number(new URLSearchParams(window.location.search).get('id')) || null;
  usePageTitle(editId ? 'Transfer (correct)' : 'Transfer Request');
  const existing = useQuery({ queryKey: ['hr', 'trf', editId], queryFn: () => deploy.transfers.get(editId), enabled: Boolean(editId), retry: false });
  const [v, setV] = useState(blank);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (p) => setV((x) => ({ ...x, ...p }));
  useEffect(() => {
    const t = existing.data; if (!t) return;
    setV({ employeeId: t.employeeId, kind: t.kind, toProjectId: t.toProjectId, toSiteId: t.toSiteId ?? '', toCrewId: t.toCrewId ?? '', siteRole: t.siteRole ?? '', relieveDate: t.relieveDate, joinDate: t.joinDate, returnDate: t.returnDate ?? '', reason: t.reason, travelRequired: t.travelRequired, accommodationRequired: t.accommodationRequired });
  }, [existing.data]);
  if (editId && existing.isPending) return <Skeleton label="Loading the transfer" rows={4} />;
  if (editId && existing.isError) return <ErrorState error={existing.error} onRetry={existing.refetch} />;
  const body = () => ({ employeeId: num(v.employeeId), kind: v.kind, toProjectId: num(v.toProjectId), toSiteId: num(v.toSiteId), toCrewId: num(v.toCrewId), siteRole: v.siteRole.trim() || null, relieveDate: v.relieveDate, joinDate: v.joinDate, returnDate: v.kind === 'SECONDMENT' ? v.returnDate || null : null, reason: v.reason.trim(), travelRequired: v.travelRequired, accommodationRequired: v.accommodationRequired });
  const save = async (submit) => {
    setBusy(true); setError(null);
    try {
      const out = editId ? await deploy.transfers.update(editId, { ...body(), version: existing.data.rowVersion }) : await deploy.transfers.create({ ...body(), submit });
      if (editId && submit) await deploy.transfers.submit(editId);
      navigateTo(`/hr/transfers/transfer?id=${out.id}${submit ? '&sent=1' : ''}`, { force: true });
    } catch (e) { setError(errorInfo(e)); } finally { setBusy(false); }
  };
  const fe = (k) => error?.fields?.[k];
  return (
    <section aria-labelledby="nt-title" data-testid="new-transfer">
      <p><Link to="/hr/transfers">← Transfers</Link></p>
      <h1 id="nt-title">{editId ? `Transfer ${existing.data?.docNo}` : 'Transfer Request'}</h1>
      {error?.form && <p className="field-error" role="alert" data-testid="nt-error">{error.form}{error.fields ? ` ${Object.entries(error.fields).map(([k, x]) => `${k}: ${x}`).join('; ')}` : ''}</p>}
      <form className="mdm-fields" onSubmit={(e) => { e.preventDefault(); save(false); }}>
        <LookupField id="nt-employee" label="Employee" lookup="hr/employees" value={v.employeeId} onChange={(x) => set({ employeeId: x })} error={fe('employeeId')} required disabled={Boolean(editId)} />
        <Field label="Kind" name="kind" error={error}><select value={v.kind} onChange={(e) => set({ kind: e.target.value })} data-testid="nt-kind">{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <LookupField id="nt-project" label="To project" lookup="iam/projects" value={v.toProjectId} onChange={(x) => set({ toProjectId: x, toSiteId: '', toCrewId: '' })} error={fe('toProjectId')} required />
        <LookupField id="nt-site" label="To site" lookup="iam/sites" parent={v.toProjectId || undefined} parentLabel="project" value={v.toSiteId} onChange={(x) => set({ toSiteId: x, toCrewId: '' })} error={fe('toSiteId')} />
        <LookupField id="nt-crew" label="Crew or gang there" lookup="hr/crews" parent={v.toSiteId || undefined} parentLabel="site" value={v.toCrewId} onChange={(x) => set({ toCrewId: x })} error={fe('toCrewId')} />
        <Field label="Role there" name="siteRole" error={error}><input value={v.siteRole} maxLength={80} onChange={(e) => set({ siteRole: e.target.value })} data-testid="nt-role" /></Field>
        <Field label="Last day at the old place (relieving)" name="relieveDate" error={error}><input type="date" value={v.relieveDate} onChange={(e) => set({ relieveDate: e.target.value })} data-testid="nt-relieve" /></Field>
        <Field label="First day at the new place (joining)" name="joinDate" error={error}><input type="date" value={v.joinDate} onChange={(e) => set({ joinDate: e.target.value })} data-testid="nt-join" /></Field>
        {v.kind === 'SECONDMENT' && <Field label="Returns on" name="returnDate" error={error}><input type="date" value={v.returnDate} onChange={(e) => set({ returnDate: e.target.value })} data-testid="nt-return" /></Field>}
        <Field label="Reason" name="reason" error={error}><textarea rows="3" value={v.reason} onChange={(e) => set({ reason: e.target.value })} data-testid="nt-reason" /></Field>
        <label className="check"><input type="checkbox" checked={v.travelRequired} onChange={(e) => set({ travelRequired: e.target.checked })} data-testid="nt-travel" /> Travel is needed</label>
        <label className="check"><input type="checkbox" checked={v.accommodationRequired} onChange={(e) => set({ accommodationRequired: e.target.checked })} data-testid="nt-accommodation" /> Accommodation is needed</label>
      </form>
      <div className="actions">
        <button type="button" className="btn" onClick={() => navigateTo('/hr/transfers')}>Cancel</button>
        <button type="button" className="btn" disabled={busy} onClick={() => save(false)} data-testid="nt-save">Save draft</button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => save(true)} data-testid="nt-send">{busy ? 'Saving...' : 'Send for approval'}</button>
      </div>
    </section>
  );
}
