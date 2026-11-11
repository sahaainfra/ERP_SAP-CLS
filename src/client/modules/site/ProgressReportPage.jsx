import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, usePageTitle } from '../core/pages/ui.jsx';
import { download, fmtDate, fmtPct, fmtQty, fmtRs, st, today } from './api.js';
import { ProjectDay } from './progress-parts.jsx';
import { useSearch } from './parts.jsx';

// Progress by WBS and Activity (part 14.05, FR-06): planned against actual against forecast for each WBS node and activity as at a day, with the variance, the forecast finish and (for those who may see it)
// the budget, PV and EV; the table is the report, and it exports to Excel, CSV and PDF with the same parameters.
export default function ProgressReportPage() {
  const t = useT('site'); usePageTitle(t('cnd.rep.title')); const sp = useSearch();
  const [projectId, setProjectId] = useState(Number(sp.get('projectId')) || null); const [asOf, setAsOf] = useState(sp.get('asOf') || today()); const [wbsId, setWbsId] = useState(Number(sp.get('wbsId')) || null); const [error, setError] = useState(null);
  const qs = `projectId=${projectId}&asOf=${asOf}${wbsId ? `&wbsId=${wbsId}` : ''}`;
  const q = useQuery({ queryKey: ['site', 'prg-report', qs], queryFn: () => st.prgReport(qs), enabled: Boolean(projectId), retry: false });
  const all = useQuery({ queryKey: ['site', 'prg-report', `projectId=${projectId}&asOf=${asOf}`], queryFn: () => st.prgReport(`projectId=${projectId}&asOf=${asOf}`), enabled: Boolean(projectId) && Boolean(wbsId), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('cnd.rep.title')} permission="site.period.view" />;
  const r = q.data; const wbsList = (all.data ?? r)?.wbs ?? []; const cost = r?.canSeeCost;
  const exp = (format) => download(`/progress/report/export?projectId=${projectId}&asOf=${asOf}&format=${format}`, `progress-${asOf}.${format}`).catch(() => setError(t('bl.fileFailed')));
  return (
    <section aria-labelledby="rep-h" data-testid="site-progress-report">
      <h1 id="rep-h">{t('cnd.rep.title')}</h1>
      <ProjectDay projectId={projectId} asOf={asOf} onProject={(v) => { setProjectId(v); setWbsId(null); }} onAsOf={setAsOf} max={today()} testId="rep" />
      {projectId && <div className="mdm-panel no-print"><div className="form-grid"><Field label={t('cnd.prg.wbs')} name="wbsId"><select value={wbsId ?? ''} onChange={(e) => setWbsId(e.target.value ? Number(e.target.value) : null)} data-testid="rep-wbs"><option value="">{t('cnd.rep.allWbs')}</option>{wbsList.map((n) => <option key={n.id} value={n.id}>{'— '.repeat(n.level)}{n.code} {n.name}</option>)}</select></Field></div>
        {r && <div className="actions-row">{['xlsx', 'csv', 'pdf'].map((f) => <button key={f} type="button" className="btn" onClick={() => exp(f)} data-testid={`rep-export-${f}`}>{f.toUpperCase()}</button>)}<Link to={`/site/progress?projectId=${projectId}`}>{t('cnd.prg.title')}</Link></div>}
        {error && <p className="field-error" role="alert">{error}</p>}</div>}
      {q.isPending && projectId && <Skeleton label={t('cnd.rep.title')} rows={6} />}
      {q.isError && q.error?.status !== 403 && <ErrorState error={q.error} onRetry={q.refetch} />}
      {r && (
        <>
          <p className="muted" data-testid="rep-basis">{r.project.code} {r.project.name} · {fmtDate(r.asOf)} · {t('cnd.prg.basis', { s: r.schedule.docNo, b: r.baseline?.docNo ?? t('cnd.prg.noBaseline'), d: fmtDate(r.asOf) })}{r.baselineMissing ? ` · ${t('cnd.prg.baselineMissing')}` : ''} · {t('cnd.rep.forecastNote')}</p>
          <div className="mdm-panel" data-testid="rep-totals"><strong>{t('cnd.rep.project')}:</strong> {t('cnd.prg.planned')} {fmtPct(r.project.planned)} · {t('cnd.prg.actual')} {fmtPct(r.project.physical)} · {t('cnd.prg.forecast')} {fmtPct(r.project.forecast)} · SPI {r.project.spi == null ? '—' : r.project.spi.toFixed(2)}{cost ? ` · PV ${fmtRs(r.project.pv)} · EV ${fmtRs(r.project.ev)}` : ''}</div>
          <div className="mdm-panel" data-testid="rep-wbs-table"><h2>{t('cnd.prg.byWbs')}</h2><div className="table-scroll"><table className="data-table"><caption className="sr-only">{t('cnd.prg.byWbs')}</caption>
            <thead><tr><th>{t('cnd.prg.wbs')}</th><th className="num">{t('cnd.prg.planned')}</th><th className="num">{t('cnd.prg.actual')}</th><th className="num">{t('cnd.prg.forecast')}</th><th className="num">{t('cnd.prg.variance')}</th>{cost && <><th className="num">{t('cnd.rep.budget')}</th><th className="num">PV</th><th className="num">EV</th></>}</tr></thead>
            <tbody>{r.wbs.map((n) => <tr key={n.id} data-testid="rep-wbs-row" data-behind={n.behind ? '1' : undefined}><td style={{ paddingLeft: 8 + n.level * 16 }}>{n.code} {n.name}</td><td className="num">{fmtPct(n.planned)}</td><td className="num">{fmtPct(n.physical)}</td><td className="num">{fmtPct(n.forecast)}</td><td className="num">{n.behind ? <StatusBadge status="OVERDUE" label={fmtPct(-n.varianceBehind || 0)} /> : fmtPct(-n.varianceBehind || 0)}</td>{cost && <><td className="num">{fmtRs(n.bac)}</td><td className="num">{fmtRs(n.pv)}</td><td className="num">{fmtRs(n.ev)}</td></>}</tr>)}</tbody></table></div></div>
          <div className="mdm-panel" data-testid="rep-activities"><h2>{t('cnd.rep.activities')}</h2>
            {r.activities.length === 0 ? <p className="muted">{t('cnd.rep.noActivities')}</p> : <div className="table-scroll"><table className="data-table"><caption className="sr-only">{t('cnd.rep.activities')}</caption>
              <thead><tr><th>{t('cnd.prg.activity')}</th><th className="num">{t('cnd.rep.qty')}</th><th className="num">{t('cnd.rep.done')}</th><th className="num">{t('cnd.prg.planned')}</th><th className="num">{t('cnd.prg.actual')}</th><th className="num">{t('cnd.prg.forecast')}</th><th className="num">{t('cnd.prg.variance')}</th><th>{t('cnd.rep.finish')}</th><th>{t('cnd.rep.weight')}</th></tr></thead>
              <tbody>{r.activities.map((a) => <tr key={a.code} data-testid="rep-activity-row" data-behind={a.variance < 0 ? '1' : undefined}><td>{a.code} {a.name}</td><td className="num">{a.qty == null ? '—' : `${fmtQty(a.qty)} ${a.uom ?? ''}`}</td><td className="num">{fmtQty(a.cumQty)}</td><td className="num">{fmtPct(a.planned)}</td><td className="num">{fmtPct(a.physical)}</td><td className="num">{fmtPct(a.forecast)}</td><td className="num">{fmtPct(a.variance)}</td><td>{a.actualFinish ? fmtDate(a.actualFinish) : a.forecastFinish ? fmtDate(a.forecastFinish) : '—'}</td><td>{t(`cnd.rep.w.${a.weightBasis}`)}</td></tr>)}</tbody></table></div>}
          </div>
        </>
      )}
    </section>
  );
}
