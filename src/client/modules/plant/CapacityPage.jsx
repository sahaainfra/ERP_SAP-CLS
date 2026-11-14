import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, usePageTitle } from '../core/pages/ui.jsx';
import { fmtDate, fmtQty, cp } from './api.js';
import { useRunner } from './PlantParts.jsx';

// Resource capacity heat-map (part 17.08, FR-01 to FR-03): for each project, trade or equipment class and week, the supply against the demand of the resource-loaded schedule. Red is a shortage, green a surplus; the free pool is the last block. Each row opens the shortage and surplus report.
const tone = (gap) => (gap < 0 ? 'var(--erp-color-status-error-bg)' : gap > 0 ? 'var(--erp-color-status-success-bg)' : 'transparent');
export default function CapacityPage() {
  const t = useT('plant'); usePageTitle(t('r.capacityTitle')); const [f, setF] = useState({ type: 'LABOUR', weeks: 8 }); const q = useQuery({ queryKey: ['plant', 'capacity', f.type, f.weeks], queryFn: () => cp.heatmap({ type: f.type, weeks: f.weeks }), retry: false }); const { run, busy, note, error } = useRunner();
  if (q.error?.status === 403) return <NoPermission what={t('r.capacityTitle')} permission="plant.capacity.view" />; if (q.isPending) return <Skeleton label={t('r.capacityTitle')} rows={5} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  return (
    <section aria-labelledby="cp-h" data-testid="plant-capacity"><h1 id="cp-h">{t('r.capacityTitle')}</h1><p className="muted">{t('r.capacityIntro')}</p>
      {note && <p className="mdm-banner" role="status" data-testid="cp-note">{note}</p>}{error?.form && <p className="field-error" role="alert">{error.form}</p>}
      <div className="mdm-panel no-print" data-testid="cp-params"><div className="form-grid"><label>{t('r.type')}<select value={f.type} onChange={(ev) => setF({ ...f, type: ev.target.value })} style={{ minHeight: 44 }} data-testid="cp-type"><option value="LABOUR">{t('r.rt.LABOUR')}</option><option value="PLANT">{t('r.rt.PLANT')}</option></select></label><label>{t('r.weeks')}<select value={f.weeks} onChange={(ev) => setF({ ...f, weeks: Number(ev.target.value) })} style={{ minHeight: 44 }} data-testid="cp-weeks">{[4, 8, 12, 26].map((n) => <option key={n} value={n}>{n}</option>)}</select></label></div>
        <div className="actions-row"><Link to="/plant/shortage-surplus">{t('r.shortageTitle')}</Link><Link to="/plant/resource-plans">{t('r.plansTitle')}</Link><button type="button" className="btn" disabled={busy} style={{ minHeight: 44 }} onClick={() => run(() => cp.refresh(), t('r.refreshed'))} data-testid="cp-refresh">{t('r.refresh')}</button></div></div>
      <div className="form-grid" data-testid="cp-tiles"><div className="mdm-panel" data-testid="cp-tile-shortage"><div className="muted small">{t('r.shortage')}</div><strong style={{ fontSize: '1.5rem' }}>{fmtQty(d.totals.shortage)}</strong></div><div className="mdm-panel" data-testid="cp-tile-surplus"><div className="muted small">{t('r.surplus')}</div><strong style={{ fontSize: '1.5rem' }}>{fmtQty(d.totals.surplus)}</strong></div><div className="mdm-panel" data-testid="cp-tile-rows"><div className="muted small">{t('r.shortageRows')}</div><strong style={{ fontSize: '1.5rem' }}>{d.totals.shortageRows}</strong></div></div>
      {d.rows.length === 0 ? <div className="mdm-panel" data-testid="cp-empty"><h2>{t('r.emptyTitle')}</h2><p className="muted">{t('r.emptyBody')}</p></div> : <div className="table-scroll"><table className="data-table" data-testid="cp-grid"><thead><tr><th>{t('project')}</th><th>{t('r.resource')}</th>{d.weeks.map((w) => <th key={w} className="num">{fmtDate(w).slice(0, 6)}</th>)}</tr></thead>
        <tbody>{d.rows.map((r) => <tr key={`${r.project}-${r.key}`} data-testid="cp-row" data-project={r.project} data-key={r.key}><td>{r.project}</td><td>{r.label}</td>{r.cells.map((c) => <td key={c.week} className="num" style={{ background: r.projectId ? tone(c.gap) : 'transparent' }} title={t('r.cellTitle', { d: fmtQty(c.demand), s: fmtQty(c.supply) })} data-gap={c.gap} data-testid="cp-cell">{r.projectId ? (c.gap === 0 && c.demand === 0 ? '·' : fmtQty(c.gap)) : fmtQty(c.supply)}</td>)}</tr>)}</tbody></table></div>}
      <p className="muted small">{t('r.legend')}</p>
    </section>
  );
}
