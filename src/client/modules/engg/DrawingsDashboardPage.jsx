import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, usePageTitle } from '../core/pages/ui.jsx';
import { STATUS_CODES, eg } from './api.js';
import { ProjectSelect } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Drawings Dashboard (part 11.01): drawings received against planned, the IFC status, the overdue ones and the responses still pending.
export default function DrawingsDashboardPage() {
  const t = useT('engg');
  usePageTitle(t('dash.title'));
  const [projectId, setProjectId] = useState('');
  const q = useQuery({ queryKey: ['engg', 'dashboard', projectId], queryFn: () => eg.dashboard(projectId), retry: false });
  const s = useQuery({ queryKey: ['engg', 'schedule', projectId], queryFn: () => eg.schedule(projectId), retry: false, enabled: q.isSuccess });
  if (q.error?.status === 403) return <NoPermission what={t('dash.title')} permission="engg.drawing.view" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data; const overdue = s.data?.overdue ?? [];
  const pct = d && d.planned ? Math.min(100, Math.round((d.received / d.planned) * 100)) : null;
  return (
    <section aria-labelledby="eg-dash-h" data-testid="eg-dash">
      <PageHeader id="eg-dash-h" title={t('dash.title')} />
      <ProjectSelect value={projectId} onChange={setProjectId} allowAll testId="eg-dash-project" />
      {q.isPending ? <Skeleton label={t('dash.title')} rows={4} /> : (
        <>
          <ul className="tiles" data-testid="eg-tiles" style={{ listStyle: 'none', padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(10rem, 1fr))', gap: '0.75rem' }}>
            {d.tiles.map((x) => <li key={x.key} className="mdm-panel" data-testid={`eg-tile-${x.key}`} data-value={x.value}><strong style={{ fontSize: '1.6rem' }}>{x.value}</strong><br /><span className="muted">{t(`dash.tile.${x.key}`)}</span></li>)}
          </ul>
          <div className="mdm-panel" data-testid="eg-received"><h2>{t('dash.receivedVsPlanned')}</h2>
            <p>{t('dash.receivedLine', { received: d.received, planned: d.planned })}{pct != null ? ` · ${pct}%` : ''}</p>
            {pct != null && <progress value={pct} max="100" aria-label={t('dash.receivedVsPlanned')} />}</div>
          <div className="mdm-panel" data-testid="eg-codes"><h2>{t('dash.byCode')}</h2>
            <ul>{STATUS_CODES.map((c) => <li key={c} data-testid={`eg-code-${c}`}>{t(`code.${c}`)}: <strong>{d.byCode[c]}</strong></li>)}</ul></div>
          <div className="mdm-panel" data-testid="eg-overdue"><h2>{t('dash.overdue')}</h2>
            {overdue.length === 0 ? <p className="muted">{t('dash.noneOverdue')}</p> : (
              <div className="table-scroll"><table><thead><tr><th>{t('col.drawingNo')}</th><th>{t('col.title')}</th><th>{t('f.project')}</th><th>{t('col.planned')}</th><th>{t('dash.late')}</th></tr></thead>
                <tbody>{overdue.map((r) => <tr key={r.drawingId}><td><Link to={`/engg/drawing?id=${r.drawingId}`}>{r.drawingNo}</Link></td><td>{r.title}</td><td>{r.project}</td><td>{r.planned}</td><td>{r.varianceDays}</td></tr>)}</tbody></table></div>
            )}</div>
          <p className="actions-row"><Link to="/engg/drawings">{t('nav.drawings')}</Link> <Link to="/engg/transmittals">{t('nav.transmittals')}</Link> <Link to="/engg/site">{t('nav.site')}</Link></p>
        </>
      )}
    </section>
  );
}
