import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, Tile, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { fmtDate, fmtRs, ri } from './api.js';
import { useRunner } from './XpdParts.jsx';
import { useSearch } from '../site/parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { KpiRow } from '../../platform/design/Kpi.jsx';

// Rate intelligence (part 15.09, FR-03, FR-04): the benchmark of each material (the median landed rate per base unit of the recent observations, outliers left out), its change against last month, volatility, the monthly trend and the external price indices.
// An observation is never edited: a wrong one is corrected by a new one that replaces it.
const rs = (paise) => (paise == null ? '—' : fmtRs(paise / 100));

function Trend({ t, itemId, region }) {
  const q = useQuery({ queryKey: ['proc', 'rate-series', itemId, region], queryFn: () => ri.series(itemId, region || null, 12), retry: false });
  if (q.isPending) return <Skeleton label={t('i.trend')} rows={2} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data; const W = 44; const H = 100; const max = Math.max(1, ...d.points.map((p) => p.max ?? 0));
  return (
    <div className="mdm-panel" data-testid="ri-trend"><h2>{d.item.code} {d.item.name} <span className="muted">({t('i.perUnit', { u: d.item.uom })})</span></h2>
      {d.points.length === 0 ? <p className="muted">{t('i.noPoints')}</p> : <figure style={{ margin: 0 }}><figcaption className="muted">{t('i.trendHelp')}</figcaption>
        <svg role="img" aria-label={t('i.trend')} viewBox={`0 0 ${d.points.length * W + 10} ${H + 28}`} style={{ width: '100%', maxWidth: 560, height: 'auto' }}>
          {d.points.map((p, i) => { const x = 8 + i * W; const y = (v) => H - Math.round((v / max) * H); return <g key={p.month}><rect x={x} y={y(p.max)} width={W - 10} height={Math.max(2, y(p.min) - y(p.max))} fill="var(--erp-color-status-info-bg)" stroke="var(--erp-color-status-info-solid)" /><line x1={x} x2={x + W - 10} y1={y(p.avg)} y2={y(p.avg)} stroke="var(--erp-color-status-info-solid)" strokeWidth="2" /><text x={x + (W - 10) / 2} y={H + 14} textAnchor="middle" fontSize="9" fill="currentColor">{p.month.slice(2)}</text></g>; })}
        </svg></figure>}
      <div className="table-scroll"><table className="data-table" data-testid="ri-months"><caption>{t('i.byMonth')}</caption><thead><tr><th>{t('i.month')}</th><th className="num">{t('i.count')}</th><th className="num">{t('i.min')}</th><th className="num">{t('i.avg')}</th><th className="num">{t('i.max')}</th><th className="num">{t('i.volatility')}</th></tr></thead>
        <tbody>{d.points.map((p) => <tr key={p.month} data-testid="ri-month"><td>{p.month}</td><td className="num">{p.count}</td><td className="num">{rs(p.min)}</td><td className="num">{rs(p.avg)}</td><td className="num">{rs(p.max)}</td><td className="num">{p.volatilityPct ?? '—'}%</td></tr>)}</tbody></table></div>
      {d.indices.length > 0 && <p data-testid="ri-index-line">{t('i.index')} {d.indexGroup}: {d.indices.map((x) => `${x.period} ${x.value}`).join(' · ')}</p>}
      {d.outliers > 0 && <p className="muted">{t('i.outliersNote', { n: d.outliers })}</p>}
    </div>
  );
}

function Observation({ t, id }) {
  const q = useQuery({ queryKey: ['proc', 'rate-obs', id], queryFn: () => ri.obs(id), retry: false }); const sq = useSession(); const can = (sq.data?.permissions ?? []).includes('proc.rate_intel.survey');
  const { error, note, busy, run } = useRunner(); const [f, setF] = useState({ rate: '', reason: '' });
  usePageTitle(t('i.obsTitle'));
  if (q.error?.status === 403) return <NoPermission what={t('i.obsTitle')} permission="proc.rate_intel.view" />;
  if (q.isPending) return <Skeleton label={t('i.obsTitle')} rows={3} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const o = q.data;
  return (
    <section aria-labelledby="ro-h" data-testid="ri-obs"><PageHeader id="ro-h" title={<>{o.itemCode} {o.item} <StatusBadge status={o.outlier ? 'REJECTED' : 'APPROVED'} label={o.outlier ? t('i.outlier') : t('i.counted')} />{o.replacedBy && <StatusBadge status="CANCELLED" label={t('i.replaced')} />}</>} meta={<Link to="/proc/rate-intelligence">{t('x.back')}</Link>} />
      <dl className="kv"><div><dt>{t('i.date')}</dt><dd>{fmtDate(o.date)}</dd></div><div><dt>{t('i.source')}</dt><dd>{o.sourceLabel}</dd></div><div><dt>{t('i.region')}</dt><dd>{o.region}</dd></div><div><dt>{t('x.vendor')}</dt><dd>{o.vendor ?? '—'}</dd></div><div><dt>{t('i.recorded')}</dt><dd>{rs(o.rate)} / {o.uom}</dd></div><div><dt>{t('i.landed')}</dt><dd data-testid="ri-obs-landed">{rs(o.baseLandedRate)} / {o.baseUom}</dd></div><div><dt>{t('i.basis')}</dt><dd>{t(`i.b.${o.basis}`)}</dd></div></dl>
      {o.outlierReason && <p className="field-error" data-testid="ri-obs-outlier">{o.outlierReason}</p>}{o.correctionReason && <p>{t('i.correctionOf')} #{o.supersedesId}: {o.correctionReason}</p>}
      {error?.form && <p className="field-error" role="alert" data-testid="ri-obs-error">{error.form}</p>}{note && <p className="mdm-banner" role="status" data-testid="ri-obs-note">{note}</p>}
      {can && !o.replacedBy && <div className="mdm-panel no-print" data-testid="ri-correct"><h2>{t('i.correct')}</h2><p className="muted">{t('i.correctHelp')}</p><div className="form-grid">
        <label>{t('i.newRate')}<input type="number" min="0" step="0.01" value={f.rate} onChange={(ev) => setF({ ...f, rate: ev.target.value })} style={{ minHeight: 44 }} data-testid="ri-correct-rate" /></label>
        <label>{t('i.reason')}<input value={f.reason} maxLength={1000} onChange={(ev) => setF({ ...f, reason: ev.target.value })} style={{ minHeight: 44 }} data-testid="ri-correct-reason" /></label></div>
        <div className="actions-row"><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy || !f.rate || f.reason.trim().length < 5} onClick={() => run(() => ri.correct(o.id, { rate: Number(f.rate), reason: f.reason }), t('i.corrected')).then((x) => x && navigateTo(`/proc/rate-intelligence?obs=${x.id}`))} data-testid="ri-correct-go">{t('i.correct')}</button></div></div>}
      {o.replacedBy && <p><Link to={`/proc/rate-intelligence?obs=${o.replacedBy}`}>{t('i.seeCorrection')}</Link></p>}
    </section>
  );
}

export default function RateIntelligencePage() {
  const t = useT('proc'); usePageTitle(t('i.title')); const sp = useSearch(); const obs = Number(sp.get('obs')) || null; const session = useSession(); const [region, setRegion] = useState(''); const [pick, setPick] = useState(null);
  const q = useQuery({ queryKey: ['proc', 'rate-dash', region], queryFn: () => ri.dashboard(region || null), retry: false, enabled: !obs });
  if (obs) return <Observation key={obs} t={t} id={obs} />;
  if (q.error?.status === 403) return <NoPermission what={t('i.title')} permission="proc.rate_intel.view" />;
  if (q.isPending) return <Skeleton label={t('i.title')} rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data; const chosen = pick ?? d.items[0]?.itemId ?? null;
  return (
    <section aria-labelledby="ri-h" data-testid="proc-ri"><PageHeader id="ri-h" title={t('i.title')} subtitle={t('i.intro')} />
      <div className="actions-row no-print"><label>{t('i.region')} <select value={region} onChange={(ev) => { setRegion(ev.target.value); setPick(null); }} style={{ minHeight: 44 }} data-testid="ri-region"><option value="">{t('i.allRegions')}</option>{d.regions.filter((r) => r !== 'ALL').map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
        {d.canSurvey && <Link to="/proc/rate-survey">{t('i.surveyTitle')}</Link>} <Link to="/proc/rate-exposure">{t('i.exposureTitle')}</Link></div>
      <KpiRow data-testid="ri-tiles"><Tile label={t('i.tileItems')} value={d.items.length} testId="ri-items" /><Tile label={t('i.tileObs')} value={d.totals.observations} testId="ri-obs-count" /><Tile label={t('i.tileOutliers')} value={d.totals.outliers} status={d.totals.outliers ? 'bad' : 'ok'} testId="ri-outliers" /></KpiRow>
      {d.items.length === 0 ? <div data-testid="ri-empty"><h2>{t('i.emptyTitle')}</h2><p className="muted">{t('i.emptyBody')}</p>{d.canSurvey && <Link to="/proc/rate-survey">{t('i.surveyTitle')}</Link>}</div>
        : <div className="table-scroll"><table className="data-table" data-testid="ri-items-table"><caption>{t('i.benchmarks')}</caption><thead><tr><th>{t('i.item')}</th><th className="num">{t('i.benchmark')}</th><th className="num">{t('i.min')}</th><th className="num">{t('i.max')}</th><th className="num">{t('i.change')}</th><th className="num">{t('i.volatility')}</th><th className="num">{t('i.count')}</th></tr></thead>
          <tbody>{d.items.map((x) => <tr key={x.itemId} data-testid="ri-item" aria-selected={x.itemId === chosen}><td><button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => setPick(x.itemId)} data-testid="ri-pick">{x.code} {x.name}</button></td><td className="num" data-testid="ri-benchmark">{rs(x.benchmark)} / {x.uom}{!x.enough && <span className="muted"> ({t('i.fewObs')})</span>}</td><td className="num">{rs(x.min)}</td><td className="num">{rs(x.max)}</td><td className="num">{x.changePct == null ? '—' : `${x.changePct}%`}</td><td className="num">{x.volatilityPct ?? '—'}%</td><td className="num">{x.count}</td></tr>)}</tbody></table></div>}
      {chosen && <Trend key={`${chosen}-${region}`} t={t} itemId={chosen} region={region} />}
      {d.indices.length > 0 && <div className="table-scroll"><table className="data-table" data-testid="ri-indices"><caption>{t('i.indices')}</caption><thead><tr><th>{t('i.group')}</th><th>{t('i.region')}</th><th>{t('i.month')}</th><th className="num">{t('i.value')}</th></tr></thead><tbody>{d.indices.map((x) => <tr key={`${x.group}-${x.region}`}><td>{x.group}</td><td>{x.region}</td><td>{x.period}</td><td className="num">{x.value}</td></tr>)}</tbody></table></div>}
      <h2>{t('i.history')}</h2>
      <ListReport listCode="proc.rate_observations" endpoint="/proc/rate-observations" title={t('i.history')} session={session.data} rowHref={(r) => `/proc/rate-intelligence?obs=${r.id}`} onOpen={(r) => navigateTo(`/proc/rate-intelligence?obs=${r.id}`)} cardFields={['item', 'region', 'date', 'source', 'rate']} empty={{ title: t('i.emptyTitle'), text: t('i.emptyBody') }} />
    </section>
  );
}
