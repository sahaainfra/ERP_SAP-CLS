import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import Chart from '../../platform/charts/Chart.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, Tile, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { download, fmtDate, fmtQty, st, today } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { KpiRow } from '../../platform/design/Kpi.jsx';

// Daily Site Report, Weekly and Monthly Progress Report (part 14.02, FR-07): the approved daily progress reports of the period and sites chosen, added up: the work by activity, the labour by trade, the materials,
// the equipment, the weather, the hindrances and the safety and quality notes, with the report of every site and day behind them. Every figure is that of the approved reports.
const PERIODS = ['DAY', 'WEEK', 'MONTH', 'RANGE'];
export default function DprReportPage() {
  const t = useT('site'); usePageTitle(t('dpr.reportTitle'));
  const session = useSession(); const perms = session.data?.permissions ?? [];
  const [p, setP] = useState({ period: 'DAY', date: today(), from: today(), to: today(), siteId: '' }); const [failed, setFailed] = useState(false);
  const sitesQ = useQuery({ queryKey: ['site', 'dpr-sites'], queryFn: st.dprSites, retry: false });
  const qs = useMemo(() => new URLSearchParams(Object.entries({ period: p.period, ...(p.period === 'RANGE' ? { from: p.from, to: p.to } : { date: p.date }), siteId: p.siteId }).filter(([, v]) => v)).toString(), [p]);
  const q = useQuery({ queryKey: ['site', 'dpr-report', qs], queryFn: () => st.dprReport(qs), retry: false });
  const r = q.data; const byDate = useMemo(() => { const m = new Map(); for (const d of r?.days ?? []) m.set(d.date, (m.get(d.date) ?? 0) + (d.manDays ?? 0)); return [...m.entries()].sort(); }, [r]);
  if (q.error?.status === 403) return <NoPermission what={t('dpr.reportTitle')} permission="site.dpr.report" />;
  return (
    <section aria-labelledby="dr-h" data-testid="site-dpr-report">
      <PageHeader id="dr-h" title={t('dpr.reportTitle')} />
      <form className="mdm-panel no-print" onSubmit={(e) => e.preventDefault()} aria-label={t('dpr.params')}>
        <div className="form-grid">
          <Field label={t('dpr.period')} name="period"><select value={p.period} onChange={(e) => setP({ ...p, period: e.target.value })} data-testid="dr-period">{PERIODS.map((k) => <option key={k} value={k}>{t(`dpr.per.${k}`)}</option>)}</select></Field>
          {p.period === 'RANGE' ? <>
            <Field label={t('h.from')} name="from"><input type="date" value={p.from} onChange={(e) => setP({ ...p, from: e.target.value })} data-testid="dr-from" /></Field>
            <Field label={t('h.to')} name="to"><input type="date" value={p.to} onChange={(e) => setP({ ...p, to: e.target.value })} data-testid="dr-to" /></Field>
          </> : <Field label={t('f.date')} name="date"><input type="date" value={p.date} onChange={(e) => e.target.value && setP({ ...p, date: e.target.value })} data-testid="dr-date" /></Field>}
          <Field label={t('f.site')} name="siteId"><select value={p.siteId} onChange={(e) => setP({ ...p, siteId: e.target.value })} data-testid="dr-site"><option value="">{t('dpr.allSites')}</option>{(sitesQ.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.projectCode} · {s.code} {s.name}</option>)}</select></Field>
        </div>
        <div className="actions">{perms.includes('site.dpr.export') && ['xlsx', 'pdf', 'csv'].map((f) => <button key={f} type="button" className="btn" onClick={() => { setFailed(false); download(`/dprs/report/export?${qs}&format=${f}`, `progress-report.${f}`).catch(() => setFailed(true)); }} data-testid={`dr-export-${f}`}>{t('dpr.export', { f: f.toUpperCase() })}</button>)}<button type="button" className="btn" onClick={() => window.print()}>{t('act.print')}</button></div>
        {failed && <p className="field-error" role="alert">{t('bl.fileFailed')}</p>}
      </form>
      {q.isPending && <Skeleton label={t('dpr.reportTitle')} rows={5} />}
      {q.isError && q.error?.status !== 403 && <ErrorState error={q.error} onRetry={q.refetch} />}
      {r && (
        <>
          <h2 data-testid="dr-label">{t(`dpr.per.${r.period.kind}`)} · {r.period.label}</h2>
          <KpiRow data-testid="dr-tiles">
            <Tile label={t('dpr.tReports')} value={r.counts.dprs} testId="dr-count" /><Tile label={t('dpr.tSiteDays')} value={r.counts.siteDays} /><Tile label={t('dpr.tManDays')} value={fmtQty(r.totals.manDays)} testId="dr-mandays" />
            <Tile label={t('dpr.tLate')} value={r.counts.late} status={r.counts.late ? 'warning' : 'success'} /><Tile label={t('dpr.tPending')} value={r.counts.pendingApproval} status={r.counts.pendingApproval ? 'warning' : 'neutral'} /><Tile label={t('dpr.tHindrances')} value={r.totals.hindrances} status={r.totals.hindrances ? 'warning' : 'success'} />
          </KpiRow>
          {r.counts.dprs === 0 ? <p className="muted" data-testid="dr-empty">{t('dpr.reportEmpty')} <Link to="/site/dprs">{t('dpr.register')}</Link></p> : (
            <>
              {byDate.length > 1 && <Chart type="bar" data={{ categories: byDate.map(([d]) => d.slice(5)), series: [{ name: t('dpr.tManDays'), values: byDate.map(([, v]) => v) }] }} title={t('dpr.chartManDays')} exportName="dpr-man-days" />}
              <div className="mdm-panel" data-testid="dr-work"><h2>{t('dpr.s.work')}</h2><div className="table-scroll"><table className="data-table"><caption className="sr-only">{t('dpr.s.work')}</caption><thead><tr><th>{t('wa.activity')}</th><th className="num">{t('wa.qtyShort')}</th><th className="num">{t('dpr.authorised')}</th><th className="num">{t('dpr.pctWa')}</th><th>{t('f.site')}</th></tr></thead><tbody>{r.work.map((w) => <tr key={`${w.activityId}${w.uom}`} data-testid="dr-work-row"><td>{w.activity}</td><td className="num">{fmtQty(w.qty)} {w.uom ?? ''}</td><td className="num">{fmtQty(w.plannedQty)}</td><td className="num">{w.pctOfPlan ?? '—'} %{w.overWa ? ` · ${w.overWa} ${t('dpr.overWa')}` : ''}</td><td>{w.sites.join(', ')}</td></tr>)}</tbody></table></div></div>
              <div className="mdm-panel" data-testid="dr-labour"><h2>{t('dpr.s.labour')}</h2><div className="table-scroll"><table className="data-table"><caption className="sr-only">{t('dpr.s.labour')}</caption><thead><tr><th>{t('dpr.category')}</th><th>{t('dpr.contractor')}</th><th>{t('dpr.trade')}</th><th className="num">{t('dpr.manDays')}</th><th className="num">{t('dpr.ot')}</th><th className="num">{t('dpr.flagged')}</th></tr></thead><tbody>{r.labour.map((l, i) => <tr key={i}><td>{l.categoryLabel}</td><td>{l.contractor ?? '—'}</td><td>{l.trade}</td><td className="num">{fmtQty(l.manDays)}</td><td className="num">{fmtQty(l.otHours)}</td><td className="num">{l.flagged}</td></tr>)}</tbody><tfoot><tr><th colSpan={3}>{t('f.total')}</th><td className="num">{fmtQty(r.totals.manDays)}</td><td colSpan={2} /></tr></tfoot></table></div></div>
              {r.materials.length > 0 && <div className="mdm-panel"><h2>{t('dpr.s.materials')}</h2><div className="table-scroll"><table className="data-table"><caption className="sr-only">{t('dpr.s.materials')}</caption><thead><tr><th>{t('dpr.item')}</th><th className="num">{t('wa.qtyShort')}</th></tr></thead><tbody>{r.materials.map((m, i) => <tr key={i}><td>{m.item}</td><td className="num">{fmtQty(m.qty)} {m.uom ?? ''}</td></tr>)}</tbody></table></div></div>}
              {r.equipment.length > 0 && <div className="mdm-panel"><h2>{t('dpr.s.equipment')}</h2><div className="table-scroll"><table className="data-table"><caption className="sr-only">{t('dpr.s.equipment')}</caption><thead><tr><th>{t('dpr.equipment')}</th><th className="num">{t('dpr.hWorked')}</th><th className="num">{t('dpr.hIdle')}</th><th className="num">{t('dpr.hBreakdown')}</th></tr></thead><tbody>{r.equipment.map((e, i) => <tr key={i}><td>{e.label}</td><td className="num">{fmtQty(e.hoursWorked)}</td><td className="num">{fmtQty(e.hoursIdle)}</td><td className="num">{fmtQty(e.hoursBreakdown)}</td></tr>)}</tbody></table></div></div>}
              {r.weather.length > 0 && <div className="mdm-panel"><h2>{t('dpr.weather')}</h2><ul>{r.weather.map((w, i) => <li key={i}>{w.weather}: {w.days} {t('dpr.days')}, {w.rainMm} mm</li>)}</ul></div>}
              {r.notes.length > 0 && <div className="mdm-panel" data-testid="dr-notes"><h2>{t('dpr.s.notes')}</h2><ul>{r.notes.map((n, i) => <li key={i}><strong>{t(`dpr.n.${n.type}`)}</strong> · {fmtDate(n.date)} · {n.site}: {n.text}</li>)}</ul></div>}
              <div className="mdm-panel" data-testid="dr-days"><h2>{t('dpr.reportsOf')}</h2><div className="table-scroll"><table className="data-table"><caption className="sr-only">{t('dpr.reportsOf')}</caption><thead><tr><th>{t('f.date')}</th><th>{t('f.site')}</th><th>{t('dpr.title')}</th><th>{t('wa.supervisor')}</th><th className="num">{t('dpr.manDays')}</th><th className="num">{t('dpr.workLines')}</th><th>{t('dpr.weather')}</th><th /></tr></thead><tbody>{r.days.map((d) => <tr key={d.dprId} data-testid="dr-day-row"><td>{fmtDate(d.date)}</td><td>{d.project} · {d.site}</td><td><Link to={`/site/dprs?id=${d.dprId}`}>{d.docNo}</Link></td><td>{d.supervisor}</td><td className="num">{fmtQty(d.manDays)}</td><td className="num">{d.workLines}</td><td>{d.weather ?? '—'}</td><td>{d.late ? t('dpr.lateShort') : ''}{d.flagged ? ` ${t('dpr.flagged')}` : ''}</td></tr>)}</tbody></table></div></div>
            </>
          )}
        </>
      )}
    </section>
  );
}
