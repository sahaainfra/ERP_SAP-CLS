import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import Chart from '../../platform/charts/Chart.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, Tile, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { fmtDate, fmtRatio, fmtRs, st } from './api.js';
import { useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { KpiRow } from '../../platform/design/Kpi.jsx';

// Project Cost Control (part 14.07, FR-01, FR-04): the budget, what is committed, the actual cost and the earned value of a project by WBS node, cost head or resource, with the cost variance, what waits to be allocated and the
// last reconciliation against the ledgers. Every figure opens the source documents behind it (the budget lines, the commitments, the postings, the activities); nothing on this page can be typed over.
const MEASURES = [['budget', 'BUDGET', 'cnd.ctl.budget'], ['planned', 'PLANNED', 'cnd.ctl.planned'], ['committed', 'COMMITTED', 'cnd.ctl.committed'], ['actual', 'ACTUAL', 'cnd.ctl.actual'], ['earned', 'EARNED', 'cnd.ctl.earned']];
const sevTone = (k) => (k === 'OVER_BUDGET' || k === 'RECONCILIATION' ? 'OVERDUE' : 'IN_REVIEW');

function Drill({ t, projectId, spec, period, onClose }) {
  const q = useQuery({ queryKey: ['site', 'ctl-drill', projectId, spec, period], queryFn: () => st.ctlDrill(new URLSearchParams(Object.entries({ projectId, measure: spec.measure, wbsId: spec.wbsId, resourceType: spec.resourceType, period: spec.measure === 'ACTUAL' ? period : '' }).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString()), retry: false });
  return (
    <div className="mdm-panel" data-testid="ctl-drill" role="region" aria-label={t('cnd.ctl.drill')}>
      <h2>{t('cnd.ctl.drillTitle', { m: t(`cnd.ctl.m.${spec.measure}`), l: spec.label })}</h2>
      {q.isPending && <Skeleton label={t('cnd.ctl.drill')} rows={3} />}{q.isError && <ErrorState error={q.error} onRetry={q.refetch} />}
      {q.data && (q.data.rows.length === 0 ? <p className="muted" data-testid="ctl-drill-empty">{t('cnd.ctl.drillEmpty')}</p> : (
        <div className="table-scroll"><table className="data-table"><caption className="sr-only">{t('cnd.ctl.drill')}</caption><thead><tr><th>{t('cnd.ctl.doc')}</th><th>{t('cnd.ctl.what')}</th><th>{t('cnd.ctl.wbs')}</th><th className="num">{t('cnd.ctl.amount')}</th><th>{t('cnd.ctl.date')}</th><th>{t('cnd.ctl.note')}</th></tr></thead>
          <tbody>{q.data.rows.map((r, i) => <tr key={`${r.id}-${i}`} data-testid="ctl-drill-row"><td><Link to={r.link}>{r.docRef}</Link> <span className="muted">{r.kind}</span></td><td>{r.description ?? ''}</td><td>{r.wbs}{r.costCode ? ` · ${r.costCode}` : ''}</td><td className="num">{fmtRs(r.amount)}</td><td>{r.date ? fmtDate(r.date) : ''}</td><td>{r.counted ? (r.note ?? '') : <StatusBadge status="CANCELLED" label={t('cnd.ctl.notCounted')} />} {!r.counted && r.note}</td></tr>)}</tbody>
          <tfoot><tr><th colSpan={3}>{t('cnd.ctl.total')}</th><td className="num" data-testid="ctl-drill-total">{fmtRs(q.data.total)}</td><td colSpan={2} /></tr></tfoot></table></div>
      ))}
      <div className="actions-row"><button type="button" className="btn" onClick={onClose} data-testid="ctl-drill-close">{t('act.close')}</button></div>
    </div>
  );
}

export default function ControlDashboardPage() {
  const t = useT('site'); usePageTitle(t('cnd.ctl.title')); const sp = useSearch(); const qc = useQueryClient();
  const [f, setF] = useState({ projectId: sp.get('projectId') ?? '', period: sp.get('period') ?? '' }); const [by, setBy] = useState('byWbs'); const [drill, setDrill] = useState(null); const [msg, setMsg] = useState(null); const [error, setError] = useState(null);
  const pq = useQuery({ queryKey: ['site', 'ctl-projects'], queryFn: st.ctlProjects, retry: false });
  const projectId = f.projectId || (pq.data?.[0] ? String(pq.data[0].id) : '');
  const q = useQuery({ queryKey: ['site', 'ctl-dashboard', projectId, f.period], queryFn: () => st.ctlDashboard(new URLSearchParams({ projectId, ...(f.period ? { period: f.period } : {}) }).toString()), enabled: Boolean(projectId), retry: false });
  if (pq.error?.status === 403 || q.error?.status === 403) return <NoPermission what={t('cnd.ctl.title')} permission="site.control.view" />;
  const d = q.data; const rows = d ? d[by] : [];
  const reconcile = async () => { setError(null); setMsg(null); try { const r = await st.ctlReconcile(Number(projectId)); setMsg(r.status === 'CLEAN' ? t('cnd.ctl.reconClean', { n: r.checked }) : t('cnd.ctl.reconDiff', { n: r.differences.length })); qc.invalidateQueries({ queryKey: ['site'] }); } catch (e) { setError(errorInfo(e).form); } };
  const open = (r, m) => setDrill({ measure: m, wbsId: by === 'byWbs' ? (r.id ?? 0) : undefined, resourceType: by === 'byResource' ? r.id : undefined, label: r.label });
  const tl = d?.tiles;
  return (
    <section aria-labelledby="ctl-h" data-testid="site-control">
      <PageHeader id="ctl-h" title={t('cnd.ctl.title')} subtitle={t('cnd.ctl.intro')} />
      <form className="mdm-panel no-print" onSubmit={(e) => e.preventDefault()} aria-label={t('cnd.prd.params')}>
        <div className="form-grid">
          <Field label={t('cnd.prg.project')} name="projectId"><select value={projectId} onChange={(e) => { setF({ ...f, projectId: e.target.value }); setDrill(null); }} data-testid="ctl-project">{(pq.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></Field>
          <Field label={t('cnd.ctl.period')} name="period"><input type="month" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })} data-testid="ctl-period" /></Field>
          <Field label={t('cnd.ctl.groupBy')} name="by"><select value={by} onChange={(e) => { setBy(e.target.value); setDrill(null); }} data-testid="ctl-by"><option value="byWbs">{t('cnd.ctl.g.WBS')}</option><option value="byCostHead">{t('cnd.ctl.g.COST_HEAD')}</option><option value="byResource">{t('cnd.ctl.g.RESOURCE')}</option></select></Field>
        </div>
      </form>
      {pq.isSuccess && pq.data.length === 0 && <div className="mdm-panel" data-testid="ctl-no-project"><h2>{t('cnd.ctl.noProject')}</h2><p className="muted">{t('cnd.ctl.noProjectBody')}</p></div>}
      {q.isPending && projectId && <Skeleton label={t('cnd.ctl.title')} rows={6} />}{q.isError && q.error?.status !== 403 && <ErrorState error={q.error} onRetry={q.refetch} />}
      {d && (
        <>
          {!d.budgetDocNo && <div className="mdm-panel" data-testid="ctl-empty"><h2>{t('cnd.ctl.emptyTitle')}</h2><p className="muted">{t('cnd.ctl.emptyBody')}</p><Link to="/bud/budgets">{t('cnd.ctl.toBudget')}</Link></div>}
          <KpiRow data-testid="ctl-tiles">
            <Tile label={t('cnd.ctl.budget')} value={fmtRs(tl.budget)} hint={d.budgetDocNo ?? ''} testId="ctl-budget" />
            <Tile label={t('cnd.ctl.committed')} value={fmtRs(tl.committed)} status={tl.over ? 'danger' : 'neutral'} testId="ctl-committed" />
            <Tile label={t('cnd.ctl.actual')} value={fmtRs(tl.actual)} testId="ctl-actual" />
            <Tile label={t('cnd.ctl.earned')} value={fmtRs(tl.earned)} testId="ctl-earned" />
            <Tile label={t('cnd.ctl.available')} value={fmtRs(tl.available)} status={tl.available < 0 ? 'danger' : 'success'} hint={tl.usedPct == null ? '' : t('cnd.ctl.used', { n: tl.usedPct })} testId="ctl-available" />
            <Tile label={t('cnd.ctl.cv')} value={fmtRs(tl.costVariance)} status={tl.costVariance < 0 ? 'danger' : 'success'} hint={`CPI ${fmtRatio(tl.cpi)}`} to={`/site/control-variance?projectId=${projectId}`} testId="ctl-cv" />
            <Tile label={t('cnd.ctl.outlook')} value={fmtRs(tl.outlook)} hint={t('cnd.ctl.outlookHelp')} testId="ctl-outlook" />
            <Tile label={t('cnd.ctl.unallocated')} value={d.unallocated.count} status={d.unallocated.count ? 'warning' : 'success'} hint={fmtRs(d.unallocated.amount)} to="/site/control-unallocated" testId="ctl-unalloc" />
          </KpiRow>
          <div className="mdm-panel" data-testid="ctl-recon"><h2>{t('cnd.ctl.recon')}</h2>
            {d.reconciliation ? <p>{d.reconciliation.status === 'CLEAN' ? <StatusBadge status="APPROVED" label={t('cnd.ctl.clean')} /> : <StatusBadge status="OVERDUE" label={t('cnd.ctl.differs')} />} {t('cnd.ctl.reconLast', { d: fmtDate(d.reconciliation.runAt.slice(0, 10)), n: d.reconciliation.checked, k: d.reconciliation.differences })}</p> : <p className="muted">{t('cnd.ctl.reconNone')}</p>}
            <p className="muted">{t('cnd.ctl.rule', { r: d.materialRule === 'GRN' ? t('cnd.ctl.ruleGrn') : t('cnd.ctl.ruleIssue') })}</p>
            {d.can.reconcile && <button type="button" className="btn no-print" onClick={reconcile} data-testid="ctl-reconcile">{t('cnd.ctl.reconcile')}</button>}{msg && <p className="mdm-banner" role="status" data-testid="ctl-recon-note">{msg}</p>}{error && <p className="field-error" role="alert">{error}</p>}
          </div>
          <div className="mdm-panel" data-testid="ctl-exceptions"><h2>{t('cnd.ctl.exceptions')}</h2>
            {d.exceptions.length === 0 ? <p className="muted">{t('cnd.ctl.noExceptions')}</p> : <ul>{d.exceptions.map((x, i) => <li key={i} data-testid="ctl-exception"><StatusBadge status={sevTone(x.kind)} label={t(`cnd.ctl.k.${x.kind}`)} /> {x.label}: {x.detail}{x.link && <> · <Link to={x.link}>{t('cnd.ctl.open')}</Link></>}{x.groupBy === 'WBS' && <> · <button type="button" className="btn-link" onClick={() => { setBy('byWbs'); setDrill({ measure: 'ACTUAL', wbsId: x.id ?? 0, label: x.label }); }}>{t('cnd.ctl.drill')}</button></>}</li>)}</ul>}
            {d.myPending > 0 && <p data-testid="ctl-pending"><Link to="/site/control-unallocated?filter[status]=SUBMITTED">{t('cnd.ctl.pending', { n: d.myPending })}</Link></p>}
          </div>
          <div className="mdm-panel" data-testid="ctl-chart"><h2>{t('cnd.ctl.chart')}</h2>
            {rows.length === 0 ? <p className="muted">{t('cnd.prd.noData')}</p> : <Chart type="bar" data={{ categories: rows.map((r) => r.label.slice(0, 28)), series: MEASURES.filter(([k]) => ['budget', 'committed', 'actual', 'earned'].includes(k)).map(([k, , lab]) => ({ name: t(lab), values: rows.map((r) => r[k] ?? 0) })) }} title={t('cnd.ctl.chart')} />}
          </div>
          <div className="mdm-panel" data-testid="ctl-table"><h2>{t(`cnd.ctl.g.${by === 'byWbs' ? 'WBS' : by === 'byCostHead' ? 'COST_HEAD' : 'RESOURCE'}`)}</h2>
            {rows.length === 0 ? <p className="muted">{t('cnd.prd.noData')}</p> : (
              <div className="table-scroll"><table className="data-table"><caption className="sr-only">{t('cnd.ctl.title')}</caption>
                <thead><tr><th>{t('cnd.prd.group')}</th>{MEASURES.map(([k, , lab]) => <th key={k} className="num">{t(lab)}</th>)}<th className="num">{t('cnd.ctl.cv')}</th><th className="num">{t('cnd.ctl.used2')}</th></tr></thead>
                <tbody>{rows.map((r) => <tr key={r.key} data-testid="ctl-row" data-over={r.over ? '1' : '0'}><td>{r.label}</td>{MEASURES.map(([k, m]) => <td key={k} className="num">{by === 'byCostHead' ? fmtRs(r[k]) : <button type="button" className="btn-link" onClick={() => open(r, m)} aria-label={`${r.label}: ${t(`cnd.ctl.m.${m}`)}`} data-testid={`ctl-cell-${k}`}>{fmtRs(r[k])}</button>}</td>)}<td className="num">{fmtRs(r.costVariance)}</td><td className="num">{r.usedPct == null ? '—' : `${r.usedPct} %`}</td></tr>)}</tbody></table></div>
            )}
          </div>
          {drill && <Drill t={t} projectId={projectId} spec={drill} period={f.period} onClose={() => setDrill(null)} />}
          <div className="mdm-panel" data-testid="ctl-trend"><h2>{t('cnd.ctl.trend')}</h2>
            {d.trend.length === 0 ? <p className="muted">{t('cnd.prd.noData')}</p> : <Chart type="line" data={{ categories: d.trend.map((m) => m.month), series: [{ name: t('cnd.ctl.cumActual'), values: d.trend.map((m) => m.cumulative) }, { name: t('cnd.ctl.actual'), values: d.trend.map((m) => m.actual) }] }} title={t('cnd.ctl.trend')} />}
          </div>
          <p className="actions-row no-print"><Link to={`/site/control-variance?projectId=${projectId}`}>{t('cnd.cvr.title')}</Link> · <Link to="/site/control-unallocated">{t('cnd.una.title')}</Link></p>
        </>
      )}
    </section>
  );
}
