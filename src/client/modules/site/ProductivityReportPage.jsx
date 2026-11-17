import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import Chart from '../../platform/charts/Chart.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { LOSS_CODES, download, fmtDate, fmtPct, fmtQty, st, today } from './api.js';
import { ProdFilters, qsOf, useFilters } from './ProductivityDashboardPage.jsx';
import { useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Productivity Variance and Loss Reasons (part 14.06, FR-03, FR-04): output per man-day and machine-hour against the norm by activity, work type, crew, contractor, site or week; the man-days lost by reason with the losses the
// site records; the benchmarks of a work type across the sites; the records behind every figure; exports to Excel, CSV and PDF.
const GROUPS = ['ACTIVITY', 'WORK_TYPE', 'CREW', 'CONTRACTOR', 'SITE', 'WEEK'];
const DRILL = { ACTIVITY: 'activity', WORK_TYPE: 'workType', CREW: 'crew', CONTRACTOR: 'contractor', SITE: 'site' };
function LossForm({ t, sites, activities, onDone }) {
  const [f, setF] = useState({ siteId: sites.length === 1 ? sites[0].id : '', date: today(), activityCode: '', reasonCode: 'IDLE', hoursLost: '', note: '' }); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = async (e) => { e.preventDefault(); setError(null); setBusy(true); try { await st.prodLossCreate({ siteId: Number(f.siteId), date: f.date, activityCode: f.activityCode || null, reasonCode: f.reasonCode, hoursLost: Number(f.hoursLost), note: f.note.trim() || null }); setF((x) => ({ ...x, hoursLost: '', note: '' })); onDone(); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); } };
  return (
    <form className="mdm-panel no-print" onSubmit={save} aria-label={t('cnd.prd.recordLoss')} data-testid="pr-loss-form"><h2>{t('cnd.prd.recordLoss')}</h2><p className="muted">{t('cnd.prd.recordLossHelp')}</p>
      <div className="form-grid">
        <Field label={t('f.site')} name="siteId" error={error}><select value={f.siteId} onChange={(e) => set('siteId', e.target.value)} data-testid="pr-loss-site"><option value="">{t('f.chooseSite')}</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.code} {s.name}</option>)}</select></Field>
        <Field label={t('f.date')} name="date" error={error}><input type="date" value={f.date} max={today()} onChange={(e) => e.target.value && set('date', e.target.value)} data-testid="pr-loss-date" /></Field>
        <Field label={t('cnd.prg.activity')} name="activityCode" error={error}><select value={f.activityCode} onChange={(e) => set('activityCode', e.target.value)} data-testid="pr-loss-activity"><option value="">{t('cnd.prd.wholeSite')}</option>{activities.map((a) => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}</select></Field>
        <Field label={t('cnd.prd.reason')} name="reasonCode" error={error}><select value={f.reasonCode} onChange={(e) => set('reasonCode', e.target.value)} data-testid="pr-loss-reason">{LOSS_CODES.map((c) => <option key={c} value={c}>{t(`cnd.prd.r.${c}`)}</option>)}</select></Field>
        <Field label={t('cnd.prd.hours')} name="hoursLost" error={error}><input type="number" min="0" step="0.5" inputMode="decimal" value={f.hoursLost} onChange={(e) => set('hoursLost', e.target.value)} data-testid="pr-loss-hours" /></Field>
      </div>
      <Field label={t('cnd.notes')} name="note" error={error}><input value={f.note} maxLength={500} onChange={(e) => set('note', e.target.value)} /></Field>
      {error?.form && <p className="field-error" role="alert" data-testid="pr-loss-error">{error.form}</p>}
      <button type="submit" className="btn btn-primary" disabled={busy || !f.siteId} data-testid="pr-loss-save">{t('act.save')}</button>
    </form>
  );
}

export default function ProductivityReportPage() {
  const t = useT('site'); usePageTitle(t('cnd.prr.title')); const sp = useSearch(); const qc = useQueryClient();
  const [f, set] = useFilters(); const [by, setBy] = useState(sp.get('groupBy') ?? 'ACTIVITY'); const [error, setError] = useState(null);
  const qs = qsOf(f, { groupBy: by });
  const q = useQuery({ queryKey: ['site', 'prod-report', qs], queryFn: () => st.prodReport(qs), retry: false });
  const meta = useQuery({ queryKey: ['site', 'prod-dashboard', qsOf(f)], queryFn: () => st.prodDashboard(qsOf(f)), retry: false });
  const oq = useQuery({ queryKey: ['site', 'prod-options', f.projectId], queryFn: () => st.prodOptions(f.projectId), enabled: Boolean(f.projectId), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('cnd.prr.title')} permission="site.productivity.view" />;
  const r = q.data; const sites = (meta.data?.sites ?? []).filter((s) => s.canRecord); const refresh = () => { qc.invalidateQueries({ queryKey: ['site'] }); qc.invalidateQueries({ queryKey: ['list'] }); };
  const exp = (format) => download(`/productivity/report/export?${qs}&format=${format}`, `productivity.${format}`).catch(() => setError(t('bl.fileFailed')));
  return (
    <section aria-labelledby="pr-h" data-testid="site-productivity-report">
      <PageHeader id="pr-h" title={t('cnd.prr.title')} />
      <ProdFilters t={t} f={f} set={set} projects={meta.data?.projects ?? []} sites={meta.data?.sites ?? []} testId="pr" />
      <div className="mdm-panel no-print"><div className="form-grid"><Field label={t('cnd.prr.groupBy')} name="groupBy"><select value={by} onChange={(e) => setBy(e.target.value)} data-testid="pr-groupby">{GROUPS.map((g) => <option key={g} value={g}>{t(`cnd.prr.g.${g}`)}</option>)}</select></Field></div>
        {r && <div className="actions-row">{['xlsx', 'csv', 'pdf'].map((x) => <button key={x} type="button" className="btn" onClick={() => exp(x)} data-testid={`pr-export-${x}`}>{x.toUpperCase()}</button>)}<Link to={`/site/productivity?${qsOf(f)}`}>{t('cnd.prd.title')}</Link></div>}{error && <p className="field-error" role="alert">{error}</p>}</div>
      {q.isPending && <Skeleton label={t('cnd.prr.title')} rows={6} />}
      {q.isError && q.error?.status !== 403 && <ErrorState error={q.error} onRetry={q.refetch} />}
      {r && (
        <>
          <div className="mdm-panel" data-testid="pr-totals"><strong>{fmtDate(r.from)} – {fmtDate(r.to)}</strong> · {t('cnd.prd.efficiency')} {fmtPct(r.efficiency)} · {t('cnd.prd.lost')} {fmtQty(r.lostManDays)} · {t('cnd.prd.records')} {r.records} · {t('cnd.prd.toCheck')} {r.outlierCount}</div>
          <div className="mdm-panel" data-testid="pr-groups"><h2>{t(`cnd.prr.g.${by}`)}</h2>
            {r.groups.length === 0 ? <p className="muted" data-testid="pr-empty">{t('cnd.prd.noData')}</p> : (
              <>
                <Chart type="bar" data={{ categories: r.groups.map((g) => String(g.label).replace('UOM:', '').slice(0, 14)), series: [{ name: t('cnd.prd.efficiency'), values: r.groups.map((g) => g.efficiency ?? 0) }] }} title={`${t(`cnd.prr.g.${by}`)} (%)`} />
                <div className="table-scroll"><table className="data-table"><caption className="sr-only">{t(`cnd.prr.g.${by}`)}</caption><thead><tr><th>{t(`cnd.prr.g.${by}`)}</th><th className="num">{t('cnd.prd.output')}</th><th className="num">{t('cnd.prd.manDays')}</th><th className="num">{t('cnd.prd.machineHours')}</th><th className="num">{t('cnd.prd.perMd')}</th><th className="num">{t('cnd.prd.perMh')}</th><th className="num">{t('cnd.prd.efficiency')}</th><th className="num">{t('cnd.prd.lost')}</th></tr></thead>
                  <tbody>{r.groups.map((g) => <tr key={g.key} data-testid="pr-group-row"><td>{DRILL[by] ? <Link to={`/site/productivity-records?filter[${DRILL[by]}]=${encodeURIComponent(g.label)}`}>{g.label}</Link> : g.label}</td><td className="num">{fmtQty(g.qty)} {g.uom ?? ''}</td><td className="num">{fmtQty(g.manDays)}</td><td className="num">{fmtQty(g.machineHours)}</td><td className="num">{g.outputPerMd == null ? '—' : fmtQty(g.outputPerMd)}</td><td className="num">{g.outputPerMh == null ? '—' : fmtQty(g.outputPerMh)}</td><td className="num">{fmtPct(g.efficiency)}</td><td className="num">{fmtQty(g.lostManDays)}</td></tr>)}</tbody></table></div>
              </>
            )}
          </div>
          <div className="mdm-panel" data-testid="pr-reasons"><h2>{t('cnd.prd.reasons')}</h2>
            {r.reasons.length === 0 ? <p className="muted">{t('cnd.prd.noLoss')}</p> : (
              <>
                <Chart type="bar" data={{ categories: r.reasons.map((x) => t(`cnd.prd.r.${x.reason}`)), series: [{ name: t('cnd.prd.lost'), values: r.reasons.map((x) => x.lostManDays) }] }} title={t('cnd.prd.lostByReason')} />
                <div className="table-scroll"><table className="data-table"><caption className="sr-only">{t('cnd.prd.reasons')}</caption><thead><tr><th>{t('cnd.prd.reason')}</th><th className="num">{t('cnd.prd.lost')}</th><th className="num">{t('cnd.prd.share')}</th><th className="num">{t('cnd.prd.records')}</th></tr></thead><tbody>{r.reasons.map((x) => <tr key={x.reason} data-testid="pr-reason-row"><td><Link to={`/site/productivity-records?filter[reason]=${x.reason}`}>{t(`cnd.prd.r.${x.reason}`)}</Link></td><td className="num">{fmtQty(x.lostManDays)}</td><td className="num">{fmtPct(x.sharePct)}</td><td className="num">{x.records}</td></tr>)}</tbody></table></div>
              </>
            )}
          </div>
          {sites.length > 0 && <LossForm t={t} sites={sites} activities={oq.data?.activities ?? []} onDone={refresh} />}
          <div className="mdm-panel" data-testid="pr-losses"><h2>{t('cnd.prd.recorded')}</h2>
            {r.losses.length === 0 ? <p className="muted">{t('cnd.prd.noRecorded')}</p> : <div className="table-scroll"><table className="data-table"><caption className="sr-only">{t('cnd.prd.recorded')}</caption><thead><tr><th>{t('f.date')}</th><th>{t('f.site')}</th><th>{t('cnd.prg.activity')}</th><th>{t('cnd.prd.reason')}</th><th className="num">{t('cnd.prd.hours')}</th><th>{t('cnd.notes')}</th><th /></tr></thead>
              <tbody>{r.losses.map((l) => <tr key={l.id} data-testid="pr-loss-row"><td>{fmtDate(l.date)}</td><td>{l.siteCode}</td><td>{l.activityCode ?? t('cnd.prd.wholeSite')}</td><td>{t(`cnd.prd.r.${l.reasonCode}`)}</td><td className="num">{fmtQty(l.hoursLost)}</td><td>{l.note ?? ''}</td><td>{l.can.delete && <button type="button" className="btn" onClick={async () => { try { await st.prodLossRemove(l.id); refresh(); } catch (e) { setError(errorInfo(e).form); } }} aria-label={t('act.remove')}>×</button>}</td></tr>)}</tbody></table></div>}
          </div>
          <div className="mdm-panel" data-testid="pr-benchmarks"><h2>{t('cnd.prd.benchmarks')}</h2><p className="muted">{t('cnd.prd.benchmarksHelp')}</p>
            {r.benchmarks.length === 0 ? <p className="muted">{t('cnd.prd.noData')}</p> : r.benchmarks.map((b) => <div key={b.workType} className="table-scroll"><table className="data-table" data-testid="pr-benchmark"><caption>{b.workType.replace('UOM:', '')} · {t('cnd.prd.average')} {b.averageOutputPerMd == null ? '—' : fmtQty(b.averageOutputPerMd)} {b.uom ?? ''}/{t('cnd.prd.manDay')}{b.best ? ` · ${t('cnd.prd.best')} ${b.best.project} ${b.best.site}` : ''}</caption><thead><tr><th>{t('cnd.prg.project')}</th><th>{t('f.site')}</th><th className="num">{t('cnd.prd.perMd')}</th><th className="num">{t('cnd.prd.vsAverage')}</th><th className="num">{t('cnd.prd.efficiency')}</th></tr></thead>
              <tbody>{b.sites.map((s) => <tr key={s.siteId}><td>{s.project}</td><td>{s.site}</td><td className="num">{s.outputPerMd == null ? '—' : fmtQty(s.outputPerMd)}</td><td className="num">{fmtPct(s.vsAveragePct)}</td><td className="num">{fmtPct(s.efficiency)}</td></tr>)}</tbody></table></div>)}
          </div>
          <p data-testid="pr-records"><Link to="/site/productivity-records">{t('cnd.prr.records')}</Link></p>
        </>
      )}
    </section>
  );
}
