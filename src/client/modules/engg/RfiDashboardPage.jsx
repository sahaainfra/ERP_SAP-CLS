import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, usePageTitle } from '../core/pages/ui.jsx';
import { rf } from './api.js';
import { ProjectSelect } from './parts.jsx';

// RFI Dashboard (part 11.02): open RFIs by ball in court, ageing, the ones on the critical path, the impact totals and what waits for me.
export default function RfiDashboardPage() {
  const t = useT('engg');
  usePageTitle(t('rfid.title'));
  const [projectId, setProjectId] = useState('');
  const q = useQuery({ queryKey: ['engg', 'rfi-dashboard', projectId], queryFn: () => rf.dashboard(projectId), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('rfid.title')} permission="engg.rfi.view" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  return (
    <section aria-labelledby="rfid-h" data-testid="rfi-dash">
      <h1 id="rfid-h">{t('rfid.title')}</h1>
      <ProjectSelect value={projectId} onChange={setProjectId} allowAll testId="rfid-project" />
      {q.isPending ? <Skeleton label={t('rfid.title')} rows={4} /> : (
        <>
          <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(10rem, 1fr))', gap: '0.75rem' }} data-testid="rfid-tiles">
            {d.tiles.map((x) => <li key={x.key} className="mdm-panel" data-testid={`rfid-tile-${x.key}`} data-value={x.value}><Link to={`/engg/rfis${projectId ? `?filter[projectId]=${projectId}` : ''}`}><strong style={{ fontSize: '1.6rem' }}>{x.value}</strong></Link><br /><span className="muted">{t(`rfid.tile.${x.key}`)}</span></li>)}
          </ul>
          <div className="mdm-panel" data-testid="rfid-ball"><h2>{t('rfid.ball')}</h2>
            <ul>{Object.entries(d.ball).map(([k, n]) => <li key={k} data-testid={`rfid-ball-${k}`}>{t(`ball.${k}`)}: <strong>{n}</strong></li>)}</ul></div>
          <div className="mdm-panel" data-testid="rfid-ageing"><h2>{t('rfid.ageing')}</h2>
            <ul>{[['d0_7', '0–7'], ['d8_14', '8–14'], ['d15_30', '15–30'], ['d30_plus', '30+']].map(([k, label]) => <li key={k} data-testid={`rfid-age-${k}`}>{label} {t('rfid.days')}: <strong>{d.ageing[k]}</strong></li>)}</ul></div>
          <div className="mdm-panel" data-testid="rfid-impact"><h2>{t('rfid.impact')}</h2>
            <p>{t('rfid.impactLine', { count: d.impact.count, cost: d.impact.cost, days: d.impact.days })}</p></div>
          <div className="mdm-panel" data-testid="rfid-critical"><h2>{t('rfid.critical')}</h2>
            {d.critical.length === 0 ? <p className="muted">{t('rfid.noCritical')}</p> : <ul>{d.critical.map((r) => <li key={r.id}><Link to={`/engg/rfi?id=${r.id}`}>{r.rfiNo}</Link> · {r.subject} · {r.activityRef ?? '—'} · {t('rfi.requiredBy')} {r.requiredBy}{r.overdue ? ` · ${t('dwg.overdue')}` : ''}</li>)}</ul>}</div>
          <div className="mdm-panel" data-testid="rfid-mine"><h2>{t('rfid.mine')}</h2>
            {d.mine.length === 0 ? <p className="muted">{t('rfid.nothingMine')}</p> : <ul>{d.mine.map((r) => <li key={r.id}><Link to={`/engg/rfi?id=${r.id}`}>{r.rfiNo}</Link> · {r.subject} · {t(`rfis.${r.status}`)}</li>)}</ul>}</div>
          <p className="actions-row"><Link to="/engg/rfis">{t('nav.rfis')}</Link> <Link to="/engg/rfi-raise">{t('nav.raise')}</Link></p>
        </>
      )}
    </section>
  );
}
