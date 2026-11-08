import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, usePageTitle } from '../core/pages/ui.jsx';
import { ep } from './api.js';
import { ProjectSelect } from './parts.jsx';

// Engineering Progress (part 11.04, FR-02): weighted progress against plan, the S-curve, progress by discipline and package, overdue deliverables and open holds.
function SCurve({ points, label }) {
  const t = useT('engg'); const W = 600; const H = 220; const pad = 36;
  if (points.length < 2) return <p className="muted" data-testid="scurve-none">{t('prog.noCurve')}</p>;
  const x = (i) => pad + (i * (W - 2 * pad)) / (points.length - 1); const y = (bp) => H - pad - (bp / 10000) * (H - 2 * pad);
  const line = (key) => points.map((p, i) => (p[key] == null ? null : `${x(i)},${y(p[key])}`)).filter(Boolean).join(' ');
  return (
    <figure data-testid="scurve" style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} style={{ width: '100%', height: 'auto', maxHeight: '18rem' }}>
        {[0, 25, 50, 75, 100].map((v) => <g key={v}><line x1={pad} x2={W - pad} y1={y(v * 100)} y2={y(v * 100)} stroke="var(--erp-color-border-subtle)" /><text x={4} y={y(v * 100) + 4} fontSize="10" fill="var(--erp-color-text-muted)">{v}%</text></g>)}
        <polyline points={line('plannedBp')} fill="none" stroke="var(--erp-color-status-info-solid)" strokeWidth="2.5" data-testid="scurve-planned" />
        <polyline points={line('actualBp')} fill="none" stroke="var(--erp-color-status-success-solid)" strokeWidth="2.5" data-testid="scurve-actual" />
        {points.map((p, i) => (i % Math.ceil(points.length / 6) === 0 || i === points.length - 1) ? <text key={p.date} x={x(i)} y={H - 10} fontSize="10" textAnchor="middle" fill="var(--erp-color-text-muted)">{p.date.slice(2, 7)}</text> : null)}
      </svg>
      <figcaption className="muted"><span style={{ color: 'var(--erp-color-status-info-fg)' }}>━</span> {t('prog.planned')} · <span style={{ color: 'var(--erp-color-status-success-fg)' }}>━</span> {t('prog.actual')}</figcaption>
    </figure>
  );
}
export default function ProgressPage() {
  const t = useT('engg');
  usePageTitle(t('prog.title'));
  const [projectId, setProjectId] = useState('');
  const q = useQuery({ queryKey: ['engg', 'progress', projectId], queryFn: () => ep.progress(projectId), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('prog.title')} permission="engg.deliverable.view" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  return (
    <section aria-labelledby="prog-h" data-testid="eg-progress">
      <h1 id="prog-h">{t('prog.title')}</h1>
      <ProjectSelect value={projectId} onChange={setProjectId} allowAll testId="prog-project" />
      {q.isPending ? <Skeleton label={t('prog.title')} rows={4} /> : (
        <>
          <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(10rem, 1fr))', gap: '0.75rem' }} data-testid="prog-tiles">
            {d.tiles.map((x) => <li key={x.key} className="mdm-panel" data-testid={`prog-tile-${x.key}`} data-value={x.value}><Link to={x.key === 'vdr' ? '/engg/vdr' : '/engg/deliverables'}><strong style={{ fontSize: '1.6rem' }}>{x.value}</strong></Link><br /><span className="muted">{t(`prog.tile.${x.key}`)}</span></li>)}
          </ul>
          <div className="mdm-panel"><h2>{t('prog.scurve')}</h2><SCurve points={d.sCurve} label={t('prog.scurve')} /></div>
          <div className="mdm-panel" data-testid="prog-disc"><h2>{t('prog.byDiscipline')}</h2>
            {d.byDiscipline.length === 0 ? <p className="muted">{t('prog.none')}</p> : <div className="table-scroll"><table><thead><tr><th>{t('col.discipline')}</th><th>{t('prog.count')}</th><th>{t('prog.weight')}</th><th>{t('prog.actual')} %</th><th>{t('prog.planned')} %</th></tr></thead>
              <tbody>{d.byDiscipline.map((g) => <tr key={g.key} data-testid={`prog-disc-${g.key}`} data-progress={g.progress}><td>{t(`ddisc.${g.key}`)}</td><td>{g.count}</td><td>{g.weight}</td><td><progress value={g.progressBp} max="10000" aria-label={g.label} /> {g.progress}</td><td>{g.planned}</td></tr>)}</tbody></table></div>}</div>
          <div className="mdm-panel" data-testid="prog-overdue"><h2>{t('prog.overdue')}</h2>
            {d.overdue.length === 0 ? <p className="muted">{t('prog.noneOverdue')}</p> : <ul>{d.overdue.slice(0, 12).map((r) => <li key={r.id}><Link to={`/engg/deliverable?id=${r.id}`}>{r.deliverableNo}</Link> · {r.title} · {r.milestone} {t('prog.plannedOn')} {r.planned} · {r.daysLate} {t('rfid.days')}</li>)}</ul>}</div>
          <div className="mdm-panel" data-testid="prog-holds"><h2>{t('prog.holds')}</h2>
            {d.holds.length === 0 ? <p className="muted">{t('prog.noHolds')}</p> : <ul>{d.holds.map((h) => <li key={h.id}><Link to={`/engg/deliverable?id=${h.deliverableId}`}>{h.holdNo}</Link> · {h.deliverableNo} · {h.description}{h.impactProcurement ? ` · ${t('hold.procurement')}` : ''}{h.impactConstruction ? ` · ${t('hold.construction')}` : ''}</li>)}</ul>}</div>
          <p className="actions-row"><Link to="/engg/deliverables">{t('nav.deliverables')}</Link> <Link to="/engg/vdr">{t('nav.vdr')}</Link></p>
        </>
      )}
    </section>
  );
}
