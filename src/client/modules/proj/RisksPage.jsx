import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { RISK_CATEGORIES, RISK_STRATEGIES, dayIST, rk, st } from './api.js';
import { useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Risk and Opportunity Register (part 10.06, FR-01, FR-02): the register of every project you may see; a new risk or opportunity starts with its assessment, the score, level and EMV are worked out on the server and shown on its page.
export const emptyRisk = () => ({ projectId: '', rtype: 'RISK', title: '', category: 'TECHNICAL', ownerUser: '', probability: 3, impactCost: 3, impactTime: 1, impactQuality: 1, impactSafety: 1, strategy: 'MITIGATE', mostLikely: '0', actionText: '', actionOwner: '', actionDue: dayIST(14) });
export default function RisksPage() {
  const t = useT('proj');
  usePageTitle(t('rk.registerTitle'));
  const qc = useQueryClient();
  const session = useSession(); const perms = session.data?.permissions ?? [];
  const search = useSearch(); const fp = Number(/filter\[projectId\]=(\d+)/.exec(window.location.search)?.[1]) || null; void search;
  const [open, setOpen] = useState(false); const [error, setError] = useState(null);
  const [f, setF] = useState({ ...emptyRisk(), projectId: fp ?? '' });
  const pq = useQuery({ queryKey: ['proj', 'picker'], queryFn: st.projects, retry: false, enabled: open });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v, ...(k === 'rtype' ? { strategy: v === 'RISK' ? 'MITIGATE' : 'EXPLOIT' } : {}) }));
  const create = async (e) => {
    e.preventDefault(); setError(null);
    try {
      const ml = String(f.mostLikely || '0');
      const body = { projectId: Number(f.projectId), rtype: f.rtype, title: f.title.trim(), category: f.category, ownerUser: f.ownerUser, probability: Number(f.probability), impactCost: Number(f.impactCost), impactTime: Number(f.impactTime), impactQuality: Number(f.impactQuality), impactSafety: Number(f.impactSafety), strategy: f.strategy,
        exposureCost: { min: '0', mostLikely: ml, max: ml }, actions: f.actionText.trim() ? [{ description: f.actionText.trim(), ownerUser: f.actionOwner || f.ownerUser, dueDate: f.actionDue }] : [] };
      const r = await rk.createRisk(body); qc.invalidateQueries({ queryKey: ['proj'] }); navigateTo(`/proj/risk?id=${r.id}`);
    } catch (x) { setError(errorInfo(x)); }
  };
  const scale = [1, 2, 3, 4, 5];
  const num = (k, label) => <Field label={label} name={k} error={error}><select value={f[k]} onChange={(e) => set(k, e.target.value)} data-testid={`rk-f-${k}`}>{scale.map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>;
  return (
    <section aria-labelledby="rk-list-h" data-testid="risks">
      <PageHeader id="rk-list-h" srOnly title={t('rk.registerTitle')} />
      <div className="actions-row no-print">
        {perms.includes('proj.risk.create') && <button type="button" className="btn btn-primary" onClick={() => setOpen(!open)} data-testid="rk-new">{t('rk.new')}</button>}
        <Link to={fp ? `/proj/risk-dashboard?projectId=${fp}` : '/proj/risk-dashboard'}>{t('rk.dashTitle')}</Link><Link to={fp ? `/proj/issues?filter[projectId]=${fp}` : '/proj/issues'}>{t('rk.issuesTitle')}</Link>
      </div>
      {open && (
        <form className="mdm-panel" aria-label={t('rk.new')} data-testid="rk-new-form" onSubmit={create}>
          <h2>{t('rk.new')}</h2>
          <div className="form-grid">
            <Field label={t('st.project')} name="projectId" error={error}><select value={f.projectId} onChange={(e) => set('projectId', e.target.value)} required data-testid="rk-f-project"><option value="">{t('st.chooseProject')}</option>{(pq.data ?? []).map((p) => <option key={p.projectId} value={p.projectId}>{p.code} · {p.name}</option>)}</select></Field>
            <Field label={t('f.type')} name="rtype" error={error}><select value={f.rtype} onChange={(e) => set('rtype', e.target.value)} data-testid="rk-f-type"><option value="RISK">{t('rk.type.RISK')}</option><option value="OPPORTUNITY">{t('rk.type.OPPORTUNITY')}</option></select></Field>
            <Field label={t('rk.col.title')} name="title" error={error}><input value={f.title} onChange={(e) => set('title', e.target.value)} required maxLength={200} data-testid="rk-f-title" /></Field>
            <Field label={t('rk.col.category')} name="category" error={error}><select value={f.category} onChange={(e) => set('category', e.target.value)} data-testid="rk-f-category">{RISK_CATEGORIES.map((k) => <option key={k} value={k}>{t(`rk.cat.${k}`)}</option>)}</select></Field>
            <LookupField id="rk-f-owner" label={t('rk.col.owner')} lookup="proj/people" valueKey="code" value={f.ownerUser} onChange={(v) => set('ownerUser', v)} required />
            {num('probability', t('rk.probability'))}{num('impactCost', t('rk.impactCost'))}{num('impactTime', t('rk.impactTime'))}{num('impactQuality', t('rk.impactQuality'))}{num('impactSafety', t('rk.impactSafety'))}
            <Field label={t('rk.strategy')} name="strategy" error={error}><select value={f.strategy} onChange={(e) => set('strategy', e.target.value)} data-testid="rk-f-strategy">{RISK_STRATEGIES[f.rtype].map((k) => <option key={k} value={k}>{t(`rk.strat.${k}`)}</option>)}</select></Field>
            <Field label={t('rk.mostLikely')} name="exposureCost" error={error}><input value={f.mostLikely} onChange={(e) => set('mostLikely', e.target.value)} inputMode="decimal" data-testid="rk-f-ml" /></Field>
            <Field label={t('rk.firstAction')} name="actions" error={error}><input value={f.actionText} onChange={(e) => set('actionText', e.target.value)} maxLength={1000} data-testid="rk-f-action" /></Field>
            <Field label={t('rk.actionDue')} name="actionDue" error={error}><input type="date" value={f.actionDue} onChange={(e) => set('actionDue', e.target.value)} /></Field>
          </div>
          {error?.form && <p className="field-error" role="alert" data-testid="rk-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 4).join('; ')}` : ''}</p>}
          <div className="actions"><button type="button" className="btn" onClick={() => setOpen(false)}>{t('act.close')}</button><button type="submit" className="btn btn-primary" disabled={!f.projectId || f.title.trim().length < 3 || !f.ownerUser} data-testid="rk-create">{t('rk.create')}</button></div>
        </form>
      )}
      <ListReport listCode="proj.risks" endpoint="/proj/risks" title={t('rk.registerTitle')} session={session.data} rowHref={(r) => `/proj/risk?id=${r.id}`} onOpen={(r) => navigateTo(`/proj/risk?id=${r.id}`)} cardFields={['docNo', 'title', 'levelLabel', 'emv', 'statusLabel']} statusKey="statusLabel" empty={{ title: t('rk.emptyTitle'), text: t('rk.emptyText') }}
        contextFilters={fp ? [{ key: 'projectId', op: 'eq', value: String(fp) }] : []} />
    </section>
  );
}
