import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, usePageTitle } from '../core/pages/ui.jsx';
import { AVL_TONE, RATING_TONE, pct, pv8 } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Vendor ranking by category (part 15.08): the vendors on the approved list for a category ordered by their score of a period, with the three headline measures; each row opens the vendor's scorecard.
export default function VendorRankingPage() {
  const t = useT('proc'); usePageTitle(t('v.rankTitle')); const [categoryId, setCategoryId] = useState(''); const [period, setPeriod] = useState('');
  const qs = [categoryId && `categoryId=${categoryId}`, categoryId && period && `period=${period}`].filter(Boolean).join('&');
  const q = useQuery({ queryKey: ['proc', 'vendor-ranking', qs], queryFn: () => pv8.ranking(qs), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('v.rankTitle')} permission="proc.vendor_score.view" />;
  if (q.isPending) return <Skeleton label={t('v.rankTitle')} rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  return (
    <section aria-labelledby="vr-h" data-testid="proc-vr"><PageHeader id="vr-h" title={t('v.rankTitle')} subtitle={t('v.rankIntro')} />
      <div className="mdm-panel no-print" data-testid="vr-params"><div className="form-grid">
        <label>{t('v.category')}<select value={categoryId} onChange={(ev) => { setCategoryId(ev.target.value); setPeriod(''); }} style={{ minHeight: 44 }} data-testid="vr-category"><option value="">{t('x.choose')}</option>{d.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>{t('v.period')}<select value={period || d.period || ''} disabled={!categoryId} onChange={(ev) => setPeriod(ev.target.value)} style={{ minHeight: 44 }} data-testid="vr-period">{d.periods.length === 0 && <option value="">—</option>}{d.periods.map((p) => <option key={p} value={p}>{p}</option>)}</select></label></div></div>
      {!categoryId ? <p className="muted" data-testid="vr-pick">{t('v.pickCategory')}</p>
        : d.rows.length === 0 ? <div data-testid="vr-empty"><h2>{t('v.rankEmptyTitle')}</h2><p className="muted">{t('v.rankEmptyBody')}</p><Link to="/proc/prequalifications?new=1">{t('v.newPreq')}</Link></div>
          : <div className="table-scroll"><table className="data-table" data-testid="vr-table"><caption>{d.category.name} · {d.period ?? '—'}</caption><thead><tr><th className="num">#</th><th>{t('x.vendor')}</th><th>{t('v.region')}</th><th>{t('x.status')}</th><th className="num">{t('v.total')}</th><th>{t('v.rating')}</th><th className="num">{t('v.m.onTime')}</th><th className="num">{t('v.m.quality')}</th><th className="num">{t('v.m.price')}</th></tr></thead>
            <tbody>{d.rows.map((r) => <tr key={r.partnerId} data-testid="vr-row"><td className="num">{r.rank ?? '—'}</td><td><Link to={`/proc/vendor-scorecards?partner=${r.partnerId}`}>{r.vendor}</Link></td><td>{r.regions.join(', ')}</td><td><StatusBadge status={AVL_TONE[r.avlStatus]} label={t(`v.avl.${r.avlStatus}`)} /></td><td className="num">{pct(r.total)}</td><td><StatusBadge status={RATING_TONE[r.rating]} label={r.rating === 'NA' ? t('v.notRated') : r.rating} /></td><td className="num">{pct(r.onTime)}</td><td className="num">{pct(r.quality)}</td><td className="num">{pct(r.price)}</td></tr>)}</tbody></table></div>}
    </section>
  );
}
