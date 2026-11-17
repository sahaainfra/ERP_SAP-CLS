import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { ACCESS_ROLES, dayIST, deploy } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// New Deployment / Bulk Deploy (HR, part 07.03): the person, project, site, crew, role on site, the dates, primary or secondary posting, the role the deployment gives at the site (access follows it and ends with it) and the default cost
// code. As it is typed the plan is read: planned posts of the designation at the site, people deployed, and whether this is within the plan or outside it (then the project director approves too). A person has one primary
// posting at a time: a clash is refused with the deployment it clashes with. Save draft keeps it; Send for approval goes to the project manager. A draft or returned deployment opened with ?id= is corrected here.
// The Bulk Deploy tab explains the Excel import: every row becomes a deployment waiting for approval; nothing is approved by the import.
const blank = () => ({ personId: '', projectId: '', siteId: '', crewId: '', siteRole: '', accessRole: '', fromDate: dayIST(0), toDate: '', isPrimary: true, defaultCostCodeId: '' });
const num = (v) => (v === '' || v == null ? null : Number(v));
export default function NewDeploymentPage() {
  const editId = Number(new URLSearchParams(window.location.search).get('id')) || null;
  usePageTitle(editId ? 'Deployment (correct)' : 'New Deployment');
  const existing = useQuery({ queryKey: ['hr', 'dep', editId], queryFn: () => deploy.get(editId), enabled: Boolean(editId), retry: false });
  const [mode, setMode] = useState(() => (new URLSearchParams(window.location.search).get('mode') === 'bulk' ? 'bulk' : 'single'));
  const [v, setV] = useState(blank);
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (p) => setV((x) => ({ ...x, ...p }));
  useEffect(() => {
    const r = existing.data; if (!r) return;
    setV({ personId: r.personId, projectId: r.projectId, siteId: r.siteId ?? '', crewId: r.crewId ?? '', siteRole: r.siteRole ?? '', accessRole: r.accessRole ?? '', fromDate: r.fromDate, toDate: r.toDate ?? '', isPrimary: r.isPrimary, defaultCostCodeId: r.defaultCostCodeId ?? '' });
  }, [existing.data]);
  useEffect(() => {
    if (!v.personId || !v.projectId) { setPlan(null); return undefined; }
    const t = setTimeout(async () => { try { setPlan(await deploy.planCheck({ personId: v.personId, projectId: v.projectId, siteId: v.siteId || undefined, date: v.fromDate || undefined })); } catch { setPlan(null); } }, 300);
    return () => clearTimeout(t);
  }, [v.personId, v.projectId, v.siteId, v.fromDate]);
  if (editId && existing.isPending) return <Skeleton label="Loading the deployment" rows={4} />;
  if (editId && existing.isError) return <ErrorState error={existing.error} onRetry={existing.refetch} />;
  const body = () => ({ personType: 'EMPLOYEE', personId: num(v.personId), projectId: num(v.projectId), siteId: num(v.siteId), crewId: num(v.crewId), siteRole: v.siteRole.trim() || null, accessRole: v.accessRole || null, fromDate: v.fromDate, toDate: v.toDate || null, isPrimary: v.isPrimary, defaultCostCodeId: num(v.defaultCostCodeId) });
  const save = async (submit) => {
    setBusy(true); setError(null);
    try {
      const out = editId ? await deploy.update(editId, { ...body(), version: existing.data.rowVersion }) : await deploy.create({ ...body(), submit });
      if (editId && submit) await deploy.submit(editId);
      navigateTo(`/hr/deployments/deployment?id=${out.id}${submit ? '&sent=1' : ''}`, { force: true });
    } catch (e) { setError(errorInfo(e)); } finally { setBusy(false); }
  };
  const fe = (k) => error?.fields?.[k];
  return (
    <section aria-labelledby="nd-title" data-testid="new-deployment">
      <p><Link to="/hr/deployments">← Deployments</Link></p>
      <PageHeader id="nd-title" title={editId ? `Deployment ${existing.data?.docNo}` : 'New Deployment'} />
      {!editId && <div role="tablist" aria-label="Single or bulk" className="op-tabs">{[['single', 'One person'], ['bulk', 'Bulk deploy (Excel)']].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={mode === k} className={`op-tab${mode === k ? ' is-active' : ''}`} onClick={() => setMode(k)} data-testid={`nd-mode-${k}`}>{l}</button>)}</div>}
      {mode === 'bulk' && !editId ? (
        <div className="mdm-panel" data-testid="nd-bulk">
          <p>Deploy many people at once from a spreadsheet. Each row names the employee, the project, the site and crew, the role on site and the dates; each valid row becomes a deployment waiting for approval by the project manager, and a row with a clash, an unknown code or the same person twice is refused with the reason.</p>
          <ol className="mdm-list"><li>Open the Import Center and choose <strong>Deployments (bulk deploy, sent for approval)</strong>.</li><li>Download the template, fill it, and upload it.</li><li>Check the errors file, correct, and commit the valid rows.</li></ol>
          <p><Link to="/import" className="btn btn-primary" data-testid="nd-bulk-go">Open the Import Center</Link></p>
        </div>
      ) : (
        <>
          {error?.form && <p className="field-error" role="alert" data-testid="nd-error">{error.form}{error.fields ? ` ${Object.entries(error.fields).map(([k, x]) => `${k}: ${x}`).join('; ')}` : ''}</p>}
          <form className="mdm-fields" onSubmit={(e) => { e.preventDefault(); save(false); }}>
            <LookupField id="nd-person" label="Employee" lookup="hr/employees" value={v.personId} onChange={(x) => set({ personId: x })} error={fe('personId')} required disabled={Boolean(editId)} />
            <LookupField id="nd-project" label="Project" lookup="iam/projects" value={v.projectId} onChange={(x) => set({ projectId: x, siteId: '', crewId: '' })} error={fe('projectId')} required />
            <LookupField id="nd-site" label="Site" lookup="iam/sites" parent={v.projectId || undefined} parentLabel="project" value={v.siteId} onChange={(x) => set({ siteId: x, crewId: '' })} error={fe('siteId')} />
            <LookupField id="nd-crew" label="Crew or gang" lookup="hr/crews" parent={v.siteId || undefined} parentLabel="site" value={v.crewId} onChange={(x) => set({ crewId: x })} error={fe('crewId')} />
            <Field label="Role on site" name="siteRole" error={error}><input value={v.siteRole} maxLength={80} onChange={(e) => set({ siteRole: e.target.value })} data-testid="nd-role" /></Field>
            <Field label="Site access role" name="accessRole" error={error} hint="The role the person holds at the site while deployed; it ends with the deployment."><select value={v.accessRole} onChange={(e) => set({ accessRole: e.target.value })} data-testid="nd-access">{ACCESS_ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="From" name="fromDate" error={error}><input type="date" value={v.fromDate} onChange={(e) => set({ fromDate: e.target.value })} data-testid="nd-from" /></Field>
            <Field label="To (empty for open)" name="toDate" error={error}><input type="date" value={v.toDate} onChange={(e) => set({ toDate: e.target.value })} data-testid="nd-to" /></Field>
            <label className="check"><input type="checkbox" checked={v.isPrimary} onChange={(e) => set({ isPrimary: e.target.checked })} data-testid="nd-primary" /> Primary posting (a person has one at a time)</label>
            <LookupField id="nd-cost" label="Default cost code" lookup="fin/cost-codes" value={v.defaultCostCodeId} onChange={(x) => set({ defaultCostCodeId: x })} error={fe('defaultCostCodeId')} />
          </form>
          {plan && <div className={`mdm-banner${plan.beyond ? ' is-warning' : ''}`} role="status" data-testid="nd-plan"><strong>{plan.beyond ? (plan.hasPlan ? 'Outside the plan: the planned posts are full, so the project director also approves.' : 'No planned post for this designation here: the project director also approves.') : 'Within the plan.'}</strong> Planned {plan.planned}, deployed {plan.deployed}.</div>}
          <div className="actions">
            <button type="button" className="btn" onClick={() => navigateTo('/hr/deployments')}>Cancel</button>
            <button type="button" className="btn" disabled={busy} onClick={() => save(false)} data-testid="nd-save">Save draft</button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => save(true)} data-testid="nd-send">{busy ? 'Saving...' : 'Send for approval'}</button>
          </div>
        </>
      )}
    </section>
  );
}
