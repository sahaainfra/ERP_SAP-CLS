import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import Chart from '../../platform/charts/Chart.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, usePageTitle } from '../core/pages/ui.jsx';
import { download, fmtQty, fmtRs, st } from './api.js';
import { useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Quantity & Rate Variance Analysis (part 14.07, FR-05): the budget against the actual cost with the variance split into a quantity variance ((earned qty - actual qty) x budget rate) and a rate variance ((budget rate - actual rate) x
// actual qty), which together are the cost variance; planned against earned; committed against budget. Exports to Excel, CSV and PDF; every group opens the cost control dashboard for its drill-down.
const GROUPS = ['WBS', 'COST_CODE', 'COST_HEAD', 'RESOURCE'];
const num = (v) => (v == null ? '—' : fmtRs(v));
const tone = (v) => (v == null || v === 0 ? '' : v < 0 ? 'is-negative' : 'is-positive');

export default function ControlVariancePage() {
  const t = useT('site'); usePageTitle(t('cnd.cvr.title')); const sp = useSearch();
  const [f, setF] = useState({ projectId: sp.get('projectId') ?? '', groupBy: sp.get('groupBy') ?? 'WBS', period: sp.get('period') ?? '' }); const [error, setError] = useState(null);
  const pq = useQuery({ queryKey: ['site', 'ctl-projects'], queryFn: st.ctlProjects, retry: false });
  const projectId = f.projectId || (pq.data?.[0] ? String(pq.data[0].id) : '');
  const qs = new URLSearchParams({ projectId, groupBy: f.groupBy, ...(f.period ? { period: f.period } : {}) }).toString();
  const q = useQuery({ queryKey: ['site', 'ctl-variance', qs], queryFn: () => st.ctlVariance(qs), enabled: Boolean(projectId), retry: false });
  if (pq.error?.status === 403 || q.error?.status === 403) return <NoPermission what={t('cnd.cvr.title')} permission="site.control.view" />;
  const r = q.data; const exp = (format) => download(`/control/variance/export?${qs}&format=${format}`, `control-variance.${format}`).catch(() => setError(t('bl.fileFailed')));
  return (
    <section aria-labelledby="cvr-h" data-testid="site-control-variance">
      <PageHeader id="cvr-h" title={t('cnd.cvr.title')} subtitle={t('cnd.cvr.intro')} />
      <form className="mdm-panel no-print" onSubmit={(e) => e.preventDefault()} aria-label={t('cnd.prd.params')}>
        <div className="form-grid">
          <Field label={t('cnd.prg.project')} name="projectId"><select value={projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })} data-testid="cvr-project">{(pq.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></Field>
          <Field label={t('cnd.ctl.groupBy')} name="groupBy"><select value={f.groupBy} onChange={(e) => setF({ ...f, groupBy: e.target.value })} data-testid="cvr-by">{GROUPS.map((g) => <option key={g} value={g}>{t(`cnd.ctl.g.${g}`)}</option>)}</select></Field>
          <Field label={t('cnd.ctl.period')} name="period"><input type="month" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })} data-testid="cvr-period" /></Field>
        </div>
      </form>
      {pq.isSuccess && pq.data.length === 0 && <div className="mdm-panel"><h2>{t('cnd.ctl.noProject')}</h2><p className="muted">{t('cnd.ctl.noProjectBody')}</p></div>}
      {q.isPending && projectId && <Skeleton label={t('cnd.cvr.title')} rows={6} />}{q.isError && q.error?.status !== 403 && <ErrorState error={q.error} onRetry={q.refetch} />}
      {r && (
        <>
          <div className="actions-row no-print">{r.can.export && ['xlsx', 'csv', 'pdf'].map((x) => <button key={x} type="button" className="btn" onClick={() => exp(x)} data-testid={`cvr-export-${x}`}>{x.toUpperCase()}</button>)}<Link to={`/site/control?projectId=${projectId}`}>{t('cnd.ctl.title')}</Link></div>
          {error && <p className="field-error" role="alert">{error}</p>}
          {r.rows.length === 0 ? <div className="mdm-panel" data-testid="cvr-empty"><h2>{t('cnd.ctl.emptyTitle')}</h2><p className="muted">{t('cnd.ctl.emptyBody')}</p></div> : (
            <>
              <div className="mdm-panel" data-testid="cvr-chart"><h2>{t('cnd.cvr.chart')}</h2>
                <Chart type="bar" data={{ categories: r.rows.map((x) => x.label.slice(0, 28)), series: [{ name: t('cnd.cvr.qtyVar'), values: r.rows.map((x) => x.quantityVariance ?? 0) }, { name: t('cnd.cvr.rateVar'), values: r.rows.map((x) => x.rateVariance ?? 0) }] }} title={t('cnd.cvr.chart')} />
              </div>
              <div className="mdm-panel" data-testid="cvr-table"><h2>{t('cnd.cvr.table', { g: r.groupLabel })}</h2>
                <div className="table-scroll"><table className="data-table"><caption className="sr-only">{t('cnd.cvr.title')}</caption>
                  <thead><tr><th>{r.groupLabel}</th><th className="num">{t('cnd.ctl.budget')}</th><th className="num">{t('cnd.ctl.planned')}</th><th className="num">{t('cnd.ctl.earned')}</th><th className="num">{t('cnd.ctl.actual')}</th><th className="num">{t('cnd.ctl.committed')}</th><th className="num">{t('cnd.cvr.budgetQty')}</th><th className="num">{t('cnd.cvr.earnedQty')}</th><th className="num">{t('cnd.cvr.actualQty')}</th><th className="num">{t('cnd.cvr.budgetRate')}</th><th className="num">{t('cnd.cvr.actualRate')}</th><th className="num">{t('cnd.cvr.qtyVar')}</th><th className="num">{t('cnd.cvr.rateVar')}</th><th className="num">{t('cnd.ctl.cv')}</th><th className="num">{t('cnd.cvr.sv')}</th></tr></thead>
                  <tbody>{r.rows.map((x) => <tr key={x.label} data-testid="cvr-row" data-over={x.over ? '1' : '0'}><td>{x.label}</td><td className="num">{num(x.budget)}</td><td className="num">{num(x.planned)}</td><td className="num">{num(x.earned)}</td><td className="num">{num(x.actual)}</td><td className="num">{num(x.committed)}</td><td className="num">{fmtQty(x.budgetQty)}</td><td className="num">{fmtQty(x.earnedQty)}</td><td className="num">{fmtQty(x.actualQty)}</td><td className="num">{num(x.budgetRate)}</td><td className="num">{num(x.actualRate)}</td><td className={`num ${tone(x.quantityVariance)}`}>{num(x.quantityVariance)}</td><td className={`num ${tone(x.rateVariance)}`}>{num(x.rateVariance)}</td><td className={`num ${tone(x.costVariance)}`}>{num(x.costVariance)}</td><td className={`num ${tone(x.scheduleVariance)}`}>{num(x.scheduleVariance)}</td></tr>)}</tbody>
                  <tfoot><tr data-testid="cvr-totals"><th>{t('cnd.ctl.total')}</th><td className="num">{num(r.totals.budget)}</td><td className="num">{num(r.totals.planned)}</td><td className="num">{num(r.totals.earned)}</td><td className="num">{num(r.totals.actual)}</td><td className="num">{num(r.totals.committed)}</td><td className="num">{fmtQty(r.totals.budgetQty)}</td><td className="num">{fmtQty(r.totals.earnedQty)}</td><td className="num">{fmtQty(r.totals.actualQty)}</td><td className="num" /><td className="num" /><td className="num" data-testid="cvr-total-qty">{num(r.totals.quantityVariance)}</td><td className="num" data-testid="cvr-total-rate">{num(r.totals.rateVariance)}</td><td className="num" data-testid="cvr-total-cv">{num(r.totals.costVariance)}</td><td className="num">{num(r.totals.scheduleVariance)}</td></tr></tfoot></table></div>
                <p className="muted">{t('cnd.cvr.formula')}</p>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
