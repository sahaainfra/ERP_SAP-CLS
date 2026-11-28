import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, usePageTitle } from '../core/pages/ui.jsx';
import { fmtDate, fmtQty, fmtRs, ri, saveCsv } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { KpiRow } from '../../platform/design/Kpi.jsx';

// Project rate exposure (part 15.09, FR-05): the quantity still to buy of each item (the net requirement of the latest MRP run) at the current benchmark against the budgeted rate; a positive figure is an overrun.
const rs = (paise) => (paise == null ? '—' : fmtRs(paise / 100));
export default function RateExposurePage() {
  const t = useT('proc'); usePageTitle(t('i.exposureTitle')); const [projectId, setProjectId] = useState('');
  const pq = useQuery({ queryKey: ['proc', 'rate-projects'], queryFn: ri.projects, retry: false });
  const q = useQuery({ queryKey: ['proc', 'rate-exposure', projectId], queryFn: () => ri.exposure(projectId), enabled: Boolean(projectId), retry: false });
  if (pq.error?.status === 403) return <NoPermission what={t('i.exposureTitle')} permission="proc.rate_intel.view" />;
  if (pq.isPending) return <Skeleton label={t('i.exposureTitle')} rows={3} />;
  if (pq.isError) return <ErrorState error={pq.error} onRetry={pq.refetch} />;
  const d = q.data;
  return (
    <section aria-labelledby="re-h" data-testid="proc-re"><PageHeader id="re-h" title={t('i.exposureTitle')} subtitle={t('i.exposureIntro')} />
      <div className="mdm-panel no-print" data-testid="re-params"><label>{t('x.project')}<select value={projectId} onChange={(ev) => setProjectId(ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="re-project"><option value="">{t('x.choose')}</option>{pq.data.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></label></div>
      {!projectId ? <p className="muted" data-testid="re-pick">{t('i.pickProject')}</p> : q.isPending ? <Skeleton label={t('i.exposureTitle')} rows={3} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} />
        : !d.run ? <div data-testid="re-empty"><h2>{t('i.noRunTitle')}</h2><p className="muted">{t('i.noRunBody')}</p><Link to="/proc/mrp">{t('i.runMrp')}</Link></div>
          : <>
            <p>{t('i.basedOn')} <strong>{d.run.docNo}</strong> {d.run.at ? `(${fmtDate(d.run.at.slice(0, 10))})` : ''}</p>
            <KpiRow data-testid="re-tiles"><div className={`tile ${d.totals.exposure > 0 ? 'tile-bad' : 'tile-ok'}`}><span className="tile-value" data-testid="re-total">{rs(d.totals.exposure)}</span><span className="tile-label">{t('i.netExposure')}</span></div><div className="tile"><span className="tile-value" data-testid="re-over">{rs(d.totals.over)}</span><span className="tile-label">{t('i.over')}</span></div><div className="tile"><span className="tile-value">{rs(d.totals.under)}</span><span className="tile-label">{t('i.under')}</span></div></KpiRow>
            <div className="table-scroll"><table className="data-table" data-testid="re-table"><caption>{d.project.code} · {d.project.name}</caption><thead><tr><th>{t('i.item')}</th><th className="num">{t('i.remaining')}</th><th className="num">{t('i.budgetRate')}</th><th className="num">{t('i.currentRate')}</th><th className="num">{t('i.deltaPct')}</th><th className="num">{t('i.exposure')}</th></tr></thead>
              <tbody>{d.lines.map((l) => <tr key={l.itemId} data-testid="re-row"><td>{l.code} {l.name}</td><td className="num">{fmtQty(l.remainingQty)} {l.uom}</td><td className="num">{rs(l.budgetRate)}{l.budgetRateFrom && <span className="muted small"> {t(`i.from.${l.budgetRateFrom}`)}</span>}</td><td className="num">{rs(l.currentRate)}{!l.enough && <span className="muted small"> ({t('i.fewObs')})</span>}</td><td className="num">{l.deltaPct == null ? '—' : `${l.deltaPct}%`}</td><td className="num">{rs(l.exposure)}</td></tr>)}</tbody></table></div>
            {d.totals.unpriced > 0 && <p className="muted" data-testid="re-unpriced">{t('i.unpriced', { n: d.totals.unpriced })}</p>}
            <div className="actions-row no-print"><button type="button" className="btn" onClick={() => saveCsv(`rate-exposure-${d.project.code}.csv`, [[t('i.item'), t('i.remaining'), t('i.budgetRate'), t('i.currentRate'), t('i.deltaPct'), t('i.exposure')], ...d.lines.map((l) => [`${l.code} ${l.name}`, l.remainingQty, l.budgetRate == null ? '' : l.budgetRate / 100, l.currentRate == null ? '' : l.currentRate / 100, l.deltaPct ?? '', l.exposure == null ? '' : l.exposure / 100])])} data-testid="re-export">{t('i.exportCsv')}</button><Link to="/proc/rate-intelligence">{t('i.title')}</Link></div>
          </>}
    </section>
  );
}
