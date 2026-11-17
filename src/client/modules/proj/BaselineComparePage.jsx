import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { bl, inr } from './api.js';
import { useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Baseline vs Current (part 10.02, FR-05): the signed-off baseline of a project beside the current figures. The current side is filled by the budget (12.01) and the forecast (23.11) when those parts are live; until then the baseline is shown alone,
// by section, with the reason. Costs appear only for those who hold the right.
export default function BaselineComparePage() {
  const t = useT('proj');
  usePageTitle(t('cmp.title'));
  const sp = useSearch(); const projectId = Number(sp.get('projectId')) || null;
  const pq = useQuery({ queryKey: ['proj', 'baseline-packs-all'], queryFn: async () => (await import('../../platform/api/index.js')).api.get('/proj/baseline-packs?pageSize=100').then((r) => r.data), retry: false });
  const q = useQuery({ queryKey: ['proj', 'baseline-report', projectId], queryFn: () => bl.report(projectId), enabled: Boolean(projectId), retry: false });
  const projects = [...new Map((pq.data ?? []).filter((p) => p.status === 'APPROVED').map((p) => [p.projectId, p])).values()];
  const r = q.data; const max = r ? Math.max(1, ...r.sections.map((s) => Number(s.amount))) : 1;
  return (
    <section aria-labelledby="cmp-h" data-testid="baseline-compare">
      <PageHeader id="cmp-h" title={t('cmp.title')} subtitle={t('cmp.intro')} />
      <Field label={t('cmp.project')} name="projectId">
        <select value={projectId ?? ''} onChange={(e) => navigateTo(e.target.value ? `/proj/baseline-compare?projectId=${e.target.value}` : '/proj/baseline-compare')} data-testid="cmp-project">
          <option value="">{t('cmp.choose')}</option>
          {projects.map((p) => <option key={p.projectId} value={p.projectId}>{p.project} · {p.name}</option>)}
        </select>
      </Field>
      {pq.error?.status === 403 && <NoPermission what={t('cmp.title')} permission="proj.baseline_pack.view" />}
      {!projectId && !pq.isPending && projects.length === 0 && <div className="mdm-banner" data-testid="cmp-empty"><strong>{t('cmp.emptyTitle')}</strong> {t('cmp.emptyText')} <Link to="/proj/baseline-packs">{t('bl.listTitle')}</Link></div>}
      {projectId && q.isPending && <Skeleton label={t('cmp.title')} rows={4} />}
      {projectId && q.isError && (q.error?.status === 403 ? <NoPermission what={t('cmp.title')} permission="proj.baseline_pack.view" /> : <ErrorState error={q.error} onRetry={q.refetch} />)}
      {r && (
        <div data-testid="cmp-report">
          <h2>{r.project}{r.pack ? ` · ${r.pack.docNo}` : ''}</h2>
          {!r.pack && <p className="mdm-banner" role="status" data-testid="cmp-nopack">{r.reason}</p>}
          {r.pack && !r.available && <p className="mdm-banner" role="status" data-testid="cmp-reason">{r.reason}</p>}
          {r.pack && (
            <>
              <table className="data-table" data-testid="cmp-table"><caption className="sr-only">{t('cmp.title')}</caption>
                <thead><tr><th scope="col">{t('cmp.measure')}</th><th scope="col" className="num">{t('cmp.baseline')}</th><th scope="col" className="num">{t('cmp.current')}</th><th scope="col" className="num">{t('cmp.variance')}</th></tr></thead>
                <tbody>{r.rows.map((x) => <tr key={x.key}><th scope="row">{x.label}</th><td className="num">{inr(x.baseline)}</td><td className="num">{x.current == null ? '—' : inr(x.current)}</td><td className="num">{x.variance == null ? '—' : inr(x.variance)}</td></tr>)}</tbody>
              </table>
              <h3>{t('cmp.bySection')}</h3>
              <ul className="bar-list" data-testid="cmp-sections">{r.sections.map((s) => <li key={s.code}><span>{s.code} {s.name}</span><span className="bar" role="img" aria-label={`${s.code} ${inr(s.amount)}`} style={{ display: 'inline-block', height: 10, width: `${Math.max(2, (Number(s.amount) / max) * 60)}%`, background: 'var(--erp-color-brand-primary)', marginInline: 8 }} /> {inr(s.amount)}</li>)}</ul>
              <p className="small"><Link to={`/proj/baseline-pack?id=${r.pack.id}`}>{r.pack.docNo}</Link></p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
