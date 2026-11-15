import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { LEVEL_TONE, dayIST, inr, rk } from './api.js';
import ProjectPicker from './ProjectPicker.jsx';
import { APPROVAL_TONE, useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Risk Dashboard (part 10.06): the heat map of the open risks (probability against the worst impact, each cell opens the register for that cell), the tiles, the top risks, the EMV against the contingency, the exposure trend of the reviewed months,
// the thresholds and the contingency pool of the project (BR-01) and the monthly review (FR-06).
const cellTone = (score, th) => (score >= th.critical ? 'critical' : score >= th.high ? 'high' : score >= th.medium ? 'medium' : 'low');
const reg = (p, f) => `/proj/risks?filter[projectId]=${p}${Object.entries(f).map(([k, v]) => `&filter[${k}]=${encodeURIComponent(v)}`).join('')}`;
export default function RiskDashboardPage() {
  const t = useT('proj');
  const qc = useQueryClient();
  const session = useSession(); const perms = session.data?.permissions ?? [];
  const projectId = Number(useSearch().get('projectId')) || null;
  usePageTitle(t('rk.dashTitle'));
  const q = useQuery({ queryKey: ['proj', 'riskdash', projectId], queryFn: () => rk.dashboard(projectId), enabled: Boolean(projectId), retry: false });
  const rv = useQuery({ queryKey: ['proj', 'riskreviews', projectId], queryFn: () => rk.reviews(projectId), enabled: Boolean(projectId) && perms.includes('proj.risk.view'), retry: false });
  const [error, setError] = useState(null); const [note, setNote] = useState(null); const [cfg, setCfg] = useState(null); const [period, setPeriod] = useState(dayIST().slice(0, 7));
  const run = async (fn, done) => { setError(null); setNote(null); try { await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['proj'] }); } catch (e) { setError(errorInfo(e)); } };
  const head = (
    <header>
      <PageHeader id="rk-dash-h" title={t('rk.dashTitle')} />
      <div className="actions-row no-print"><ProjectPicker route="/proj/risk-dashboard" projectId={projectId} testId="rk-project" /><Link to={projectId ? `/proj/risks?filter[projectId]=${projectId}` : '/proj/risks'}>{t('rk.registerTitle')}</Link><Link to={projectId ? `/proj/issues?filter[projectId]=${projectId}` : '/proj/issues'}>{t('rk.issuesTitle')}</Link></div>
    </header>
  );
  if (!projectId) return <section aria-labelledby="rk-dash-h" data-testid="risk-dashboard">{head}<p className="muted">{t('rk.chooseProject')}</p></section>;
  if (q.error?.status === 403) return <NoPermission what={t('rk.dashTitle')} permission="proj.risk.view" />;
  if (q.isPending) return <Skeleton label={t('rk.dashTitle')} rows={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data; const th = d.thresholds; const form = cfg ?? { pool: d.contingency.pool, medium: th.medium, high: th.high, critical: th.critical };
  const maxTrend = Math.max(1, ...d.trend.map((x) => Number(x.riskEmv)));
  const saveCfg = () => run(async () => { await rk.putSettings({ projectId, contingencyPool: String(form.pool), thresholds: { medium: Number(form.medium), high: Number(form.high), critical: Number(form.critical) } }); setCfg(null); }, t('rk.cfgSaved'));
  return (
    <section aria-labelledby="rk-dash-h" data-testid="risk-dashboard">
      {head}
      {error?.form && <p className="field-error" role="alert" data-testid="rk-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 4).join('; ')}` : ''}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="rk-note">{note}</p>}
      <p className="muted">{d.projectCode} · {d.projectName}</p>
      <ul className="kpi-tiles" data-testid="rk-tiles" aria-label={t('rk.tiles')} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, listStyle: 'none', padding: 0 }}>
        {d.tiles.map((x) => (
          <li key={x.key} className="mdm-panel" style={{ minWidth: 130 }}>
            <a href={x.page === 'issues' ? `/proj/issues?filter[projectId]=${projectId}${Object.entries(x.filter).map(([k, v]) => `&filter[${k}]=${encodeURIComponent(v)}`).join('')}` : reg(projectId, Object.fromEntries(Object.entries(x.filter).map(([k, v]) => [k === 'type' ? 'type' : k, v])))} data-testid={`rk-tile-${x.key}`}><strong style={{ fontSize: '1.6em' }}>{x.value}</strong><br />{t(`rk.tile.${x.key}`)}</a>
          </li>
        ))}
      </ul>
      <div className="form-grid">
        <div className="mdm-panel" data-testid="rk-heat">
          <h2>{t('rk.heatMap')}</h2>
          <table className="heat" aria-label={t('rk.heatMap')} style={{ borderCollapse: 'collapse' }}>
            <caption className="sr-only">{t('rk.heatHelp')}</caption>
            <thead><tr><th scope="col">{t('rk.pxi')}</th>{[1, 2, 3, 4, 5].map((i) => <th key={i} scope="col">{i}</th>)}</tr></thead>
            <tbody>
              {[5, 4, 3, 2, 1].map((p) => (
                <tr key={p}>
                  <th scope="row">{p}</th>
                  {[1, 2, 3, 4, 5].map((i) => {
                    const n = d.heat[p - 1][i - 1]; const tone = cellTone(p * i, th);
                    return <td key={i} className={`heat-${tone}`} data-testid={`rk-cell-${p}-${i}`} data-count={n} style={{ width: 48, height: 40, textAlign: 'center', border: '1px solid var(--erp-color-border-strong)', background: `var(--erp-color-status-${{ low: 'success', medium: 'warning', high: 'warning', critical: 'danger' }[tone]}-bg)`, color: `var(--erp-color-status-${{ low: 'success', medium: 'warning', high: 'warning', critical: 'danger' }[tone]}-fg)`, fontWeight: tone === 'critical' || tone === 'high' ? 700 : 400 }}>{n > 0 ? <a href={reg(projectId, { type: 'RISK', status: 'OPEN', probability: p, impact: i })} aria-label={t('rk.cellOpen', { p, i, n })}>{n}</a> : <span aria-hidden="true">·</span>}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">{t('rk.heatLegend', { medium: th.medium, high: th.high, critical: th.critical })}</p>
          <ul aria-label={t('rk.byLevel')} className="muted">{['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((l) => <li key={l}>{t(`rk.level.${l}`)}: {d.byLevel[l]}</li>)}</ul>
        </div>
        <div className="mdm-panel" data-testid="rk-emv">
          <h2>{t('rk.emvVs')}</h2>
          <dl>
            <dt>{t('rk.riskEmv')}</dt><dd data-testid="rk-risk-emv">{inr(d.riskEmv)}</dd>
            <dt>{t('rk.oppEmv')}</dt><dd data-testid="rk-opp-emv">{inr(d.opportunityEmv)}</dd>
            <dt>{t('rk.exposureMl')}</dt><dd>{inr(d.exposureCostMl)} · {d.exposureDaysMl} {t('rk.days')}</dd>
            <dt>{t('rk.pool')}</dt><dd>{inr(d.contingency.pool)}</dd>
            <dt>{t('rk.allocated')}</dt><dd>{inr(d.contingency.allocated)}</dd>
            <dt>{t('rk.drawn')}</dt><dd>{inr(d.contingency.drawn)}</dd>
            <dt>{t('rk.left')}</dt><dd>{inr(d.contingency.left)}</dd>
          </dl>
          <p role="status" data-testid="rk-covered">{d.emvVsContingency.covered ? t('rk.covered') : t('rk.gap', { gap: inr(d.emvVsContingency.gap) })}</p>
        </div>
      </div>
      <div className="mdm-panel" data-testid="rk-top">
        <h2>{t('rk.top')}</h2>
        {d.top.length === 0 ? <p className="muted">{t('rk.noRisks')}</p> : (
          <table className="data-table"><thead><tr><th scope="col">{t('rk.col.no')}</th><th scope="col">{t('rk.col.title')}</th><th scope="col">{t('rk.col.score')}</th><th scope="col">{t('rk.col.emv')}</th><th scope="col">{t('rk.col.owner')}</th></tr></thead>
            <tbody>{d.top.map((r) => <tr key={r.id}><td><Link to={`/proj/risk?id=${r.id}`}>{r.docNo}</Link></td><td>{r.title}</td><td><StatusBadge status={LEVEL_TONE[r.level]} label={`${r.score} · ${t(`rk.level.${r.level}`)}`} /></td><td>{inr(r.emv)}</td><td>{r.owner}</td></tr>)}</tbody></table>
        )}
      </div>
      <div className="mdm-panel" data-testid="rk-trend">
        <h2>{t('rk.trend')}</h2>
        <svg role="img" aria-label={t('rk.trend')} viewBox={`0 0 ${Math.max(1, d.trend.length) * 70} 120`} width="100%" style={{ maxWidth: 560 }}>
          {d.trend.map((x, i) => { const h = (Number(x.riskEmv) / maxTrend) * 80; return <g key={x.period}><rect x={i * 70 + 10} y={100 - h} width="44" height={h} fill="currentColor" opacity="0.6"><title>{`${x.period}: ${inr(x.riskEmv)}`}</title></rect><text x={i * 70 + 32} y="114" fontSize="10" textAnchor="middle">{x.period === 'live' ? t('rk.live') : x.period}</text></g>; })}
        </svg>
      </div>
      {perms.includes('proj.risk.approve') && (
        <form className="mdm-panel" aria-label={t('rk.cfg')} data-testid="rk-cfg" onSubmit={(e) => { e.preventDefault(); saveCfg(); }}>
          <h2>{t('rk.cfg')}</h2>
          <div className="form-grid">
            <Field label={t('rk.pool')} name="pool"><input value={form.pool} onChange={(e) => setCfg({ ...form, pool: e.target.value })} inputMode="decimal" data-testid="rk-cfg-pool" /></Field>
            <Field label={t('rk.cfgMedium')} name="medium"><input type="number" min="2" max="24" value={form.medium} onChange={(e) => setCfg({ ...form, medium: e.target.value })} data-testid="rk-cfg-medium" /></Field>
            <Field label={t('rk.cfgHigh')} name="high"><input type="number" min="3" max="25" value={form.high} onChange={(e) => setCfg({ ...form, high: e.target.value })} data-testid="rk-cfg-high" /></Field>
            <Field label={t('rk.cfgCritical')} name="critical"><input type="number" min="4" max="25" value={form.critical} onChange={(e) => setCfg({ ...form, critical: e.target.value })} data-testid="rk-cfg-critical" /></Field>
          </div>
          <div className="actions"><button type="submit" className="btn btn-primary" data-testid="rk-cfg-save">{t('act.save')}</button></div>
        </form>
      )}
      <div className="mdm-panel" data-testid="rk-reviews">
        <h2>{t('rk.reviews')}</h2>
        {(rv.data ?? []).length === 0 ? <p className="muted">{t('rk.noReviews')}</p> : (
          <table className="data-table"><thead><tr><th scope="col">{t('rk.month')}</th><th scope="col">{t('rk.col.status')}</th><th scope="col">{t('rk.riskEmv')}</th><th scope="col"><span className="sr-only">{t('act.actions')}</span></th></tr></thead>
            <tbody>{rv.data.map((r) => (
              <tr key={r.id} data-testid={`rk-review-${r.period}`}><td>{r.period}</td><td><StatusBadge status={APPROVAL_TONE[r.status]} label={r.statusLabel} /></td><td>{inr(r.data.riskEmv)}</td>
                <td>{r.can.submit && <button type="button" className="btn" onClick={() => run(() => rk.reviewAct(r.id, 'submit'), t('rk.reviewSent'))} data-testid={`rk-review-submit-${r.period}`}>{t('act.submit')}</button>}
                  {r.can.withdraw && <button type="button" className="btn" onClick={() => { const w = window.prompt(t('act.why')); if (w) run(() => rk.reviewAct(r.id, 'withdraw', { reason: w })); }}>{t('act.withdraw')}</button>}</td></tr>
            ))}</tbody></table>
        )}
        {perms.includes('proj.risk.create') && (
          <div className="actions-row no-print">
            <Field label={t('rk.month')} name="period"><input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} data-testid="rk-review-period" /></Field>
            <button type="button" className="btn btn-primary" onClick={() => run(() => rk.createReview({ projectId, period }), t('rk.reviewMade'))} data-testid="rk-review-new">{t('rk.reviewNew')}</button>
          </div>
        )}
      </div>
      <p className="no-print"><button type="button" className="btn" onClick={() => navigateTo(`/proj/risks?filter[projectId]=${projectId}`)}>{t('rk.registerTitle')}</button></p>
    </section>
  );
}
