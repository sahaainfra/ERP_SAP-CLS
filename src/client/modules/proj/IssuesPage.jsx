import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { PRIORITIES, dayIST, rk, st } from './api.js';

// Issue Log (part 10.06, FR-03): the problems that have happened, with a priority, an owner, a due date, the impact and the resolution.
export default function IssuesPage() {
  const t = useT('proj');
  usePageTitle(t('rk.issuesTitle'));
  const qc = useQueryClient();
  const session = useSession(); const perms = session.data?.permissions ?? [];
  const fp = Number(/filter\[projectId\]=(\d+)/.exec(window.location.search)?.[1]) || null;
  const [open, setOpen] = useState(false); const [error, setError] = useState(null);
  const [f, setF] = useState({ projectId: fp ?? '', title: '', priority: 'MEDIUM', ownerUser: '', dueDate: dayIST(7), impactCost: '0', impactTime: 0, description: '' });
  const pq = useQuery({ queryKey: ['proj', 'picker'], queryFn: st.projects, retry: false, enabled: open });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const create = async (e) => {
    e.preventDefault(); setError(null);
    try { const r = await rk.createIssue({ projectId: Number(f.projectId), title: f.title.trim(), priority: f.priority, ownerUser: f.ownerUser, dueDate: f.dueDate || null, impactCost: String(f.impactCost || '0'), impactTime: Number(f.impactTime) || 0, description: f.description || null }); qc.invalidateQueries({ queryKey: ['proj'] }); navigateTo(`/proj/issue?id=${r.id}`); } catch (x) { setError(errorInfo(x)); }
  };
  return (
    <section aria-labelledby="iss-list-h" data-testid="issues">
      <h1 id="iss-list-h" className="sr-only">{t('rk.issuesTitle')}</h1>
      <div className="actions-row no-print">
        {perms.includes('proj.issue.create') && <button type="button" className="btn btn-primary" onClick={() => setOpen(!open)} data-testid="iss-new">{t('rk.issueNew')}</button>}
        <Link to={fp ? `/proj/risk-dashboard?projectId=${fp}` : '/proj/risk-dashboard'}>{t('rk.dashTitle')}</Link><Link to={fp ? `/proj/risks?filter[projectId]=${fp}` : '/proj/risks'}>{t('rk.registerTitle')}</Link>
      </div>
      {open && (
        <form className="mdm-panel" aria-label={t('rk.issueNew')} data-testid="iss-new-form" onSubmit={create}>
          <h2>{t('rk.issueNew')}</h2>
          <div className="form-grid">
            <Field label={t('st.project')} name="projectId" error={error}><select value={f.projectId} onChange={(e) => set('projectId', e.target.value)} required data-testid="iss-f-project"><option value="">{t('st.chooseProject')}</option>{(pq.data ?? []).map((p) => <option key={p.projectId} value={p.projectId}>{p.code} · {p.name}</option>)}</select></Field>
            <Field label={t('rk.col.title')} name="title" error={error}><input value={f.title} onChange={(e) => set('title', e.target.value)} required maxLength={200} data-testid="iss-f-title" /></Field>
            <Field label={t('rk.priority')} name="priority" error={error}><select value={f.priority} onChange={(e) => set('priority', e.target.value)} data-testid="iss-f-priority">{PRIORITIES.map((k) => <option key={k} value={k}>{t(`rk.level.${k}`)}</option>)}</select></Field>
            <LookupField id="iss-f-owner" label={t('rk.col.owner')} lookup="proj/people" valueKey="code" value={f.ownerUser} onChange={(v) => set('ownerUser', v)} required />
            <Field label={t('rk.due')} name="dueDate" error={error}><input type="date" value={f.dueDate} onChange={(e) => set('dueDate', e.target.value)} data-testid="iss-f-due" /></Field>
            <Field label={t('rk.impactCostRs')} name="impactCost" error={error}><input value={f.impactCost} onChange={(e) => set('impactCost', e.target.value)} inputMode="decimal" /></Field>
            <Field label={t('rk.delayDays')} name="impactTime" error={error}><input type="number" min="0" value={f.impactTime} onChange={(e) => set('impactTime', e.target.value)} /></Field>
            <Field label={t('rk.description')} name="description" error={error}><textarea value={f.description} onChange={(e) => set('description', e.target.value)} maxLength={3000} rows={3} /></Field>
          </div>
          {error?.form && <p className="field-error" role="alert" data-testid="iss-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 4).join('; ')}` : ''}</p>}
          <div className="actions"><button type="button" className="btn" onClick={() => setOpen(false)}>{t('act.close')}</button><button type="submit" className="btn btn-primary" disabled={!f.projectId || f.title.trim().length < 3 || !f.ownerUser} data-testid="iss-create">{t('rk.create')}</button></div>
        </form>
      )}
      <ListReport listCode="proj.issues" endpoint="/proj/issues" title={t('rk.issuesTitle')} session={session.data} rowHref={(r) => `/proj/issue?id=${r.id}`} onOpen={(r) => navigateTo(`/proj/issue?id=${r.id}`)} cardFields={['docNo', 'title', 'priority', 'dueDate', 'statusLabel']} statusKey="statusLabel" empty={{ title: t('rk.issueEmptyTitle'), text: t('rk.issueEmptyText') }}
        contextFilters={fp ? [{ key: 'projectId', op: 'eq', value: String(fp) }] : []} />
    </section>
  );
}
