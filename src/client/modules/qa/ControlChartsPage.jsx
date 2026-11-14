import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, usePageTitle } from '../core/pages/ui.jsx';
import { qa } from './api.js';
import { sel } from './QaParts.jsx';

// Concrete Control Charts (part 18.07, FR-02): the X-bar and R charts of the 28-day cube results by grade and supplier, with centre line and limits, the points beyond them, and the trend of the standard deviation.
const W = 640; const H = 220; const PAD = 36;
function Chart({ values, centre, ucl, lcl, flags, label, testId, extra }) {
  const t = useT('qa'); const all = [...values, ucl, lcl, centre, ...(extra ?? [])].filter((v) => v != null); const lo = Math.min(...all); const hi = Math.max(...all); const span = hi - lo || 1; const x = (i) => PAD + (values.length < 2 ? (W - 2 * PAD) / 2 : (i * (W - 2 * PAD)) / (values.length - 1)); const y = (v) => H - PAD - ((v - lo) / span) * (H - 2 * PAD);
  const line = (v, name, dash) => <g key={name}><line x1={PAD} x2={W - PAD} y1={y(v)} y2={y(v)} stroke="var(--erp-color-text-muted)" strokeDasharray={dash} /><text x={W - PAD + 2} y={y(v) + 4} fontSize="10" fill="var(--erp-color-text-secondary)">{name} {v}</text></g>;
  return (
    <figure className="mdm-panel" data-testid={testId}><figcaption>{label}</figcaption>
      <svg viewBox={`0 0 ${W + 60} ${H}`} role="img" aria-label={label} style={{ width: '100%', maxWidth: 760 }}>
        {line(centre, t('cc.cl'), '')}{ucl != null && line(ucl, t('cc.ucl'), '4 3')}{lcl != null && line(lcl, t('cc.lcl'), '4 3')}
        <polyline fill="none" stroke="var(--erp-color-status-info-solid)" strokeWidth="2" points={values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
        {values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={flags[i] ? 6 : 4} fill={flags[i] ? 'var(--erp-color-status-error-solid)' : 'var(--erp-color-status-info-solid)'} data-testid={flags[i] ? 'cc-out' : 'cc-point'}><title>{v}</title></circle>)}
      </svg></figure>
  );
}
export default function ControlChartsPage() {
  const t = useT('qa'); usePageTitle(t('cc.title')); const [f, setF] = useState({ projectId: '', grade: '', supplierId: '' }); const oq = useQuery({ queryKey: ['qa', 'projects'], queryFn: () => qa.get('/projects').then((p) => ({ projects: p })), retry: false });
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString(); const q = useQuery({ queryKey: ['qa', 'chart', qs], queryFn: () => qa.get(`/control-charts${qs ? `?${qs}` : ''}`), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('cc.title')} permission="qa.dashboard.view" />; if (q.isPending) return <Skeleton label={t('cc.title')} rows={5} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const c = q.data; const set = (k, v) => setF((s) => ({ ...s, [k]: v, ...(k === 'grade' ? { supplierId: '' } : {}) }));
  return (
    <section aria-labelledby="cc-h" data-testid="qa-control-charts"><h1 id="cc-h">{t('cc.title')}</h1><p className="muted"><Link to="/qa/dashboard">{t('dash.title')}</Link> · {t('cc.intro')}</p>
      <div className="mdm-panel no-print"><div className="form-grid">
        <Field label={t('project')} name="projectId"><select value={f.projectId} onChange={(e) => set('projectId', e.target.value)} style={sel} data-testid="cc-project"><option value="">{t('allProjects')}</option>{(oq.data?.projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></Field>
        <Field label={t('pc.grade')} name="grade"><select value={f.grade || c.grade || ''} onChange={(e) => set('grade', e.target.value)} style={sel} data-testid="cc-grade">{c.grades.map((g) => <option key={g} value={g}>{g}</option>)}</select></Field>
        <Field label={t('cc.supplier')} name="supplierId"><select value={f.supplierId} onChange={(e) => set('supplierId', e.target.value)} style={sel} data-testid="cc-supplier"><option value="">{t('cc.allSuppliers')}</option>{c.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field></div>
        <button type="button" className="btn" onClick={() => qa.exportFile(`/dashboard/export?kind=chart${qs ? `&${qs}` : ''}`, 'control-chart.csv').catch(() => globalThis.alert?.(t('exportFailed')))} data-testid="cc-export">{t('export')}</button></div>
      {!c.limits ? <EmptyState title={t('cc.emptyTitle')} message={t('cc.emptyBody')} /> : (
        <>
          <p data-testid="cc-summary">{t('cc.summary', { grade: c.grade, n: c.n, k: c.limits.k, mean: c.limits.grandMean, sigma: c.limits.sigmaHat })}{c.limits.provisional ? ` · ${t('cc.provisional')}` : ''}{c.belowFck ? ` · ${t('cc.belowFck', { fck: c.fck })}` : ''}{c.limits.longRun ? ` · ${t('cc.longRun')}` : ''}</p>
          <Chart testId="cc-xbar" label={t('cc.xbar')} values={c.points.map((p) => p.xbar)} centre={c.limits.grandMean} ucl={c.limits.ucl} lcl={c.limits.lcl} flags={c.points.map((p) => p.outX)} extra={c.fck ? [c.fck] : []} />
          <Chart testId="cc-range" label={t('cc.range')} values={c.points.map((p) => p.range)} centre={c.limits.rBar} ucl={c.limits.uclR} lcl={c.limits.lclR} flags={c.points.map((p) => p.outR)} />
          <div className="table-scroll"><table className="data-table" data-testid="cc-table"><caption>{t('cc.points')}</caption><thead><tr><th>{t('cube.sample')}</th><th>{t('cube.testedOn')}</th><th>{t('cc.supplier')}</th><th className="num">{t('cc.xbar')}</th><th className="num">{t('cc.range')}</th><th className="num">{t('cc.sd', { n: c.windowSize })}</th><th /></tr></thead>
            <tbody>{c.points.map((p, i) => <tr key={p.sampleId} data-testid="cc-row" data-out={String(p.outX || p.outR)}><td><Link to={`/qa/cubes?id=${p.sampleId}`}>{p.sampleNo}</Link></td><td>{p.testedOn}</td><td>{p.supplier ?? '—'}</td><td className="num">{p.xbar}</td><td className="num">{p.range}</td><td className="num">{c.sdTrend[i] ?? '—'}</td><td>{p.outX || p.outR ? t('cc.outOfControl') : ''}</td></tr>)}</tbody></table></div>
        </>)}
    </section>
  );
}
