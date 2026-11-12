import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { cn, fmtQty, fmtRs, saveCsv } from './api.js';

// Count Variance Report (part 16.06, FR-03): book, count, recount, final count and the difference in quantity, value and per cent for every count line. A counter sees nothing here: the book stays hidden from them.
export default function CountVariancePage() {
  const t = useT('inv'); usePageTitle(t('cn.varianceTitle')); const sp = useSearch(); const planId = Number(sp.get('planId')) || ''; const session = useSession(); const perms = session.data?.permissions ?? []; const [only, setOnly] = useState(true);
  const q = useQuery({ queryKey: ['inv', 'variance', planId], queryFn: () => cn.variance(planId ? { planId } : {}), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('cn.varianceTitle')} permission="inv.count_plan.view" />;
  const d = q.data; const rows = (d?.rows ?? []).filter((r) => !only || r.varianceQty !== 0);
  return (
    <section aria-labelledby="cv-h" data-testid="count-variance"><h1 id="cv-h">{t('cn.varianceTitle')}</h1><p className="muted">{t('cn.varianceIntro')}</p><p><Link to="/inv/count-plans">{t('cn.title')}</Link></p>
      <div className="actions-row no-print"><label className="check"><input type="checkbox" checked={only} onChange={(ev) => setOnly(ev.target.checked)} data-testid="cv-only" /> {t('cn.onlyVariance')}</label>
        {d && perms.includes('inv.count_plan.export') && <button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => saveCsv('count-variance.csv', [[t('cn.title'), t('tr.store'), t('item'), t('cn.book'), t('cn.counted'), t('cn.recount'), t('cn.final'), t('cn.variance'), t('r.value'), t('cn.reason')], ...rows.map((r) => [r.plan, r.store, r.item, r.bookQty, r.countedQty, r.recountQty, r.finalQty, r.varianceQty, r.varianceValue == null ? '' : r.varianceValue / 100, r.reason])])} data-testid="cv-export">{t('i.exportCsv')}</button>}</div>
      {q.isPending ? <Skeleton label={t('cn.varianceTitle')} rows={3} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : !d.canReview ? <div className="mdm-panel" data-testid="cv-blind"><h2>{t('cn.blindOnlyTitle')}</h2><p>{t('cn.blindOnlyBody')}</p></div> : rows.length === 0 ? <div className="mdm-panel" data-testid="cv-empty"><h2>{t('cn.varEmptyTitle')}</h2><p>{t('cn.varEmptyBody')}</p></div> : (<>
        <div className="kpi-row" role="list" data-testid="cv-totals"><div role="listitem" className="kpi-tile"><span className="kpi-value">{d.totals.withVariance}</span><span className="kpi-label">{t('cn.linesWithVariance')}</span></div>{d.totals.lossValue != null && <><div role="listitem" className="kpi-tile" data-testid="cv-loss"><span className="kpi-value">{fmtRs(d.totals.lossValue)}</span><span className="kpi-label">{t('cn.lossValue')}</span></div><div role="listitem" className="kpi-tile" data-testid="cv-gain"><span className="kpi-value">{fmtRs(d.totals.gainValue)}</span><span className="kpi-label">{t('cn.gainValue')}</span></div></>}</div>
        <div className="table-scroll"><table className="data-table" data-testid="cv-table"><caption>{t('cn.varianceTitle')}</caption><thead><tr><th>{t('cn.title')}</th><th>{t('item')}</th><th className="num">{t('cn.book')}</th><th className="num">{t('cn.counted')}</th><th className="num">{t('cn.recount')}</th><th className="num">{t('cn.final')}</th><th className="num">{t('cn.variance')}</th><th className="num">%</th><th className="num">{t('r.value')}</th><th>{t('cn.reason')}</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.lineId} data-testid={`cv-row-${r.lineId}`} className={r.varianceQty < 0 ? 'is-warn' : ''}><td data-label={t('cn.title')}><Link to={`/inv/count-plans?id=${r.planId}`}>{r.plan}</Link></td><td data-label={t('item')}>{r.item}{r.batchNo ? ` · ${r.batchNo}` : ''}</td><td className="num" data-label={t('cn.book')}>{fmtQty(r.bookQty)}</td><td className="num" data-label={t('cn.counted')}>{r.countedQty == null ? '—' : fmtQty(r.countedQty)}</td><td className="num" data-label={t('cn.recount')}>{r.recountQty == null ? '—' : fmtQty(r.recountQty)}</td><td className="num" data-label={t('cn.final')}>{r.finalQty == null ? '—' : fmtQty(r.finalQty)}</td><td className="num" data-label={t('cn.variance')}>{fmtQty(r.varianceQty)}</td><td className="num" data-label="%">{r.variancePct ?? '—'}</td><td className="num" data-label={t('r.value')}>{r.varianceValue == null ? '—' : fmtRs(r.varianceValue)}</td><td data-label={t('cn.reason')}>{r.reason ?? ''}</td></tr>)}</tbody></table></div></>)}
    </section>
  );
}
