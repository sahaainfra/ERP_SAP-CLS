import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import Chart from '../../platform/charts/Chart.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, usePageTitle } from '../core/pages/ui.jsx';
import { LEVEL_TONE, download, fmtDate, fmtQty, pc } from './api.js';
import { useSearch } from '../site/parts.jsx';

// Shortage Heat-map and Long-Lead Items (part 15.02, FR-05, FR-06): for the latest run of a project (or the one named), every item against every week of the horizon, coloured by how short it is (short; critical when the order-by date has passed or the
// item is long-lead), and the long-lead materials with their lead time, order-by date, days left to it and the supplier's capacity. Exports to Excel, CSV and PDF.
export default function MrpHeatmapPage() {
  const t = useT('proc'); usePageTitle(t('p.heatmapTitle')); const sp = useSearch(); const named = Number(sp.get('runId')) || null;
  const pq = useQuery({ queryKey: ['proc', 'mrp-projects'], queryFn: pc.mrpProjects, retry: false }); const [projectId, setProjectId] = useState(''); const [error, setError] = useState(null);
  const projects = pq.data ?? []; const pid = projectId || (projects[0] ? String(projects[0].id) : '');
  const rq = useQuery({ queryKey: ['proc', 'runs', pid], queryFn: () => pc.runs(pid), enabled: Boolean(pid) && !named, retry: false });
  const runId = named ?? (rq.data ?? []).find((x) => x.status === 'COMPLETED' || x.status === 'CLOSED')?.id ?? null;
  const hq = useQuery({ queryKey: ['proc', 'heatmap', runId], queryFn: () => pc.heatmap(runId), enabled: Boolean(runId), retry: false });
  const lq = useQuery({ queryKey: ['proc', 'long-lead', runId], queryFn: () => pc.longLead(runId), enabled: Boolean(runId), retry: false });
  if (pq.error?.status === 403 || hq.error?.status === 403) return <NoPermission what={t('p.heatmapTitle')} permission="proc.run.view" />;
  if (pq.isPending) return <Skeleton label={t('p.heatmapTitle')} rows={4} />;
  const h = hq.data; const l = lq.data; const exp = (kind, format) => download(`/runs/${runId}/export?kind=${kind}&format=${format}`, `${kind.toLowerCase()}.${format}`).catch(() => setError(t('p.fileFailed')));
  const perWeek = h ? h.weeks.map((_, i) => h.items.reduce((n, it) => n + it.weeks[i].net, 0)) : [];
  return (
    <section aria-labelledby="hm-h" data-testid="proc-heatmap">
      <h1 id="hm-h">{t('p.heatmapTitle')}</h1><p className="muted">{t('p.heatmapIntro')}</p>
      <form className="mdm-panel no-print" onSubmit={(e) => e.preventDefault()} aria-label={t('p.params')}><div className="form-grid"><Field label={t('p.project')} name="projectId"><select value={pid} onChange={(e) => setProjectId(e.target.value)} disabled={Boolean(named)} style={{ minHeight: 44 }} data-testid="hm-project">{projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></Field></div></form>
      {!runId && !rq.isPending && <div className="mdm-panel" data-testid="hm-empty"><h2>{t('p.noRunYet')}</h2><p className="muted">{t('p.noRunYetBody')}</p><Link to="/proc/mrp">{t('p.mrpTitle')}</Link></div>}
      {hq.isPending && runId && <Skeleton label={t('p.heatmapTitle')} rows={5} />}{hq.isError && hq.error?.status !== 403 && <ErrorState error={hq.error} onRetry={hq.refetch} />}
      {h && (
        <>
          <p data-testid="hm-run">{t('p.ofRun')} <Link to={`/proc/mrp?id=${h.run.id}`}>{h.run.docNo}</Link> · {t('p.runAt')} {h.run.runAt ? fmtDate(h.run.runAt.slice(0, 10)) : '—'}</p>
          <div className="tiles"><div className="tile" data-testid="hm-items"><span className="tile-value">{h.totals.items}</span><span className="tile-label">{t('p.itemsN')}</span></div><div className="tile" data-testid="hm-short"><span className="tile-value">{h.totals.short}</span><span className="tile-label">{t('p.itemsShort')}</span></div><div className="tile" data-testid="hm-critical"><span className="tile-value">{h.totals.critical}</span><span className="tile-label">{t('p.itemsCritical')}</span></div></div>
          <div className="actions-row no-print">{h.run.can.export && ['xlsx', 'csv', 'pdf'].map((f) => <button key={f} type="button" className="btn" onClick={() => exp('HEATMAP', f)} data-testid={`hm-export-${f}`}>{f.toUpperCase()}</button>)}</div>{error && <p className="field-error" role="alert">{error}</p>}
          <div className="mdm-panel" data-testid="hm-chart"><h2>{t('p.shortByWeek')}</h2><Chart type="bar" data={{ categories: h.weeks.map((w) => w.slice(5)), series: [{ name: t('p.net'), values: perWeek }] }} title={t('p.shortByWeek')} /></div>
          {h.items.length === 0 ? <p className="muted" data-testid="hm-none">{t('p.nothingNeededBody')}</p> : (
            <div className="table-scroll"><table className="data-table" data-testid="hm-grid"><caption>{t('p.heatmap')}</caption>
              <thead><tr><th>{t('p.item')}</th>{h.weeks.map((w) => <th key={w} className="num">{w.slice(5)}</th>)}<th className="num">{t('p.totalShort')}</th></tr></thead>
              <tbody>{h.items.map((it) => <tr key={it.itemId} data-testid="hm-row"><td>{it.code} · {it.name} {it.longLead && <StatusBadge status="RETURNED" label={t('p.longLead')} />}</td>{it.weeks.map((w) => <td key={w.weekStart} className="num" data-testid="hm-cell" data-level={w.level} title={`${t(`p.lvl.${w.level}`)}: ${t('p.gross')} ${fmtQty(w.gross)}, ${t('p.net')} ${fmtQty(w.net)}`}>{w.level === 'NONE' ? '' : w.net > 0 ? <StatusBadge status={LEVEL_TONE[w.level]} label={fmtQty(w.net)} /> : <span className="muted">{fmtQty(w.gross)}</span>}</td>)}<td className="num"><strong>{fmtQty(it.totalShort)} {it.uom}</strong></td></tr>)}</tbody></table></div>
          )}
          <p className="muted small">{t('p.legend')}</p>
        </>
      )}
      {l && (
        <div className="mdm-panel" data-testid="ll-panel"><h2>{t('p.longLeadTitle')}</h2>
          {l.rows.length === 0 ? <p className="muted" data-testid="ll-empty">{t('p.noLongLead')}</p> : (
            <div className="table-scroll"><table className="data-table" data-testid="ll-grid"><caption className="sr-only">{t('p.longLeadTitle')}</caption><thead><tr><th>{t('p.item')}</th><th className="num">{t('p.leadDays')}</th><th className="num">{t('p.totalShort')}</th><th>{t('p.requiredBy')}</th><th>{t('p.orderBy')}</th><th className="num">{t('p.daysToOrder')}</th><th>{t('p.supplier')}</th><th>{t('p.capacity')}</th></tr></thead>
              <tbody>{l.rows.map((x) => <tr key={x.itemId} data-testid="ll-row" data-late={x.late ? '1' : '0'}><td>{x.code} · {x.name}</td><td className="num">{x.leadDays}</td><td className="num">{fmtQty(x.totalShort)} {x.uom}</td><td>{x.requiredBy ? fmtDate(x.requiredBy) : '—'}</td><td>{x.orderBy ? fmtDate(x.orderBy) : '—'}</td><td className="num">{x.daysToOrder == null ? '—' : x.late ? <StatusBadge status="REJECTED" label={t('p.daysLate', { n: -x.daysToOrder })} /> : x.daysToOrder}</td><td>{x.vendor ?? '—'}</td><td>{x.capacityNote ?? '—'}</td></tr>)}</tbody></table></div>
          )}
          {l.run.can.export && <div className="actions-row no-print">{['xlsx', 'csv', 'pdf'].map((f) => <button key={f} type="button" className="btn" onClick={() => exp('LONG_LEAD', f)} data-testid={`ll-export-${f}`}>{f.toUpperCase()}</button>)}</div>}
        </div>
      )}
    </section>
  );
}
