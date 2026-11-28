import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, usePageTitle } from '../core/pages/ui.jsx';
import { RAG_TONE, p3 } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { useFlagOn } from '../../platform/shell/api.js';

// Portfolio Overview (part 10.08, FR-05): every project the person may see with its health, the overdue milestones, the critical risks and the open issues; the counters filter by health and every card opens Project 360.
export default function PortfolioPage() {
  const t = useT('proj');
  usePageTitle(t('p3.portfolioTitle'));
  const [health, setHealth] = useState(''); const [search, setSearch] = useState('');
  // PACK-16 (ff.proj.pack16): filters by state (the GST state of the project's registrations), client, type and stage
  const pack16 = useFlagOn('ff.proj.pack16'); const [flt, setFlt] = useState({ state: '', clientId: '', type: '', stage: '' });
  const chosen = pack16 ? Object.fromEntries(Object.entries(flt).filter(([, v]) => v)) : {};
  const d = useQuery({ queryKey: ['proj', 'portfolio', health, search, chosen], queryFn: () => p3.portfolio({ ...(health ? { health } : {}), ...(search.trim() ? { q: search.trim() } : {}), ...chosen }), retry: false, placeholderData: (p) => p });
  if (d.error?.status === 403) return <NoPermission what={t('p3.portfolioTitle')} permission="proj.p360.view" />;
  if (d.isPending) return <Skeleton label={t('p3.portfolioTitle')} rows={6} />;
  if (d.isError) return <ErrorState error={d.error} onRetry={d.refetch} />;
  const { projects, summary } = d.data;
  const tile = (k, n) => <li key={k}><button type="button" className={`btn${health === k ? ' btn-primary' : ''}`} aria-pressed={health === k} onClick={() => setHealth(health === k ? '' : k)} data-testid={`pf-tile-${k}`}><strong style={{ fontSize: '1.4em' }}>{n}</strong> {t(k ? `p3.health.${k}` : 'p3.all')}</button></li>;
  return (
    <section aria-labelledby="pf-h" data-testid="portfolio">
      <header><PageHeader id="pf-h" title={t('p3.portfolioTitle')} /></header>
      <ul className="p3-tiles" aria-label={t('p3.healthTitle')} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, listStyle: 'none', padding: 0 }}>{[['RED', summary.red], ['AMBER', summary.amber], ['GREEN', summary.green], ['NONE', summary.none]].map(([k, n]) => tile(k, n))}</ul>
      <div className="actions-row no-print"><Field label={t('p3.search')} name="q"><input type="search" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="pf-search" /></Field>
        {pack16 && d.data.options && [['state', 'states'], ['clientId', 'clients'], ['type', 'types'], ['stage', 'stages']].map(([k, list]) => (
          <Field key={k} label={t(`p3.f.${k}`)} name={`pf-${k}`}><select value={flt[k]} onChange={(e) => setFlt({ ...flt, [k]: e.target.value })} data-testid={`pf-filter-${k}`}>
            <option value="">{t('p3.f.any')}</option>{d.data.options[list].map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>))}
        {(health || Object.keys(chosen).length > 0) && <button type="button" className="btn" onClick={() => { setHealth(''); setFlt({ state: '', clientId: '', type: '', stage: '' }); }}>{t('p3.clear')}</button>}</div>
      {projects.length === 0 ? <EmptyState title={t('p3.noProjects')} message={t('p3.noProjectsText')} /> : (
        <div className="p3-grid" style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }} data-testid="pf-grid">
          {projects.map((p) => (
            <article key={p.projectId} className="mdm-panel" data-testid={`pf-card-${p.code}`} data-health={p.health} aria-labelledby={`pf-${p.code}`}>
              <h2 id={`pf-${p.code}`} style={{ fontSize: '1.1em' }}><Link to={`/proj/project-360?projectId=${p.projectId}`}>{p.code}</Link> · {p.name}</h2>
              <p><StatusBadge status={RAG_TONE[p.health]} label={p.health === 'NONE' ? t('p3.noData') : t(`p3.health.${p.health}`)} /> <span className="muted">{p.lifecycleLabel} · {p.pm ?? '—'}</span></p>
              <ul className="muted small" style={{ listStyle: 'none', padding: 0, display: 'flex', flexWrap: 'wrap', gap: 8 }}>{p.healthItems.map((h) => <li key={h.code}><StatusBadge status={RAG_TONE[h.level]} label={h.label} /></li>)}</ul>
              <dl className="p3-figures"><div><dt>{t('p3.overdueMilestones')}</dt><dd>{p.overdueMilestones}</dd></div>{p.criticalRisks != null && <div><dt>{t('p3.criticalRisks')}</dt><dd>{p.criticalRisks}</dd></div>}{p.openIssues != null && <div><dt>{t('p3.openIssues')}</dt><dd>{p.openIssues}</dd></div>}</dl>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
