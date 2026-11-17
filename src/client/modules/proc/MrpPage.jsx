import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import Chart from '../../platform/charts/Chart.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { RUN_TONE, download, fmtDate, fmtQty, pc } from './api.js';
import { useSearch } from '../site/parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Run MRP (part 15.02, FR-01 to FR-03): the parameters of a run (project, weeks ahead, buffer before the start of an activity, whether released take-offs count), the earlier runs of the project, and the result of a run: for each item and week the gross
// requirement, free stock, orders, in transit, requisitions, safety stock, net requirement, the quantity proposed and its dates; a row opens the activities behind it. Proposals wait for the planner (BR-01).
const refresh = (qc) => { qc.invalidateQueries({ queryKey: ['proc'] }); qc.invalidateQueries({ queryKey: ['list'] }); };

function Run({ t, id }) {
  const qc = useQueryClient(); const q = useQuery({ queryKey: ['proc', 'run', id], queryFn: () => pc.run(id), retry: false }); const [pick, setPick] = useState(null); const [error, setError] = useState(null); const [note, setNote] = useState(null); const [busy, setBusy] = useState(false); const [only, setOnly] = useState(true);
  usePageTitle(t('p.mrpResult'));
  if (q.error?.status === 403) return <NoPermission what={t('p.mrpResult')} permission="proc.run.view" />;
  if (q.isPending) return <Skeleton label={t('p.mrpResult')} rows={5} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const r = q.data; const can = r.can; const lines = (r.lines ?? []).filter((l) => !only || l.grossReq > 0 || l.netReq > 0 || l.proposedQty > 0);
  const run = async (fn, done) => { setError(null); setNote(null); setBusy(true); try { const x = await fn(); if (done) setNote(done); refresh(qc); return x; } catch (e) { setError(errorInfo(e)); return null; } finally { setBusy(false); } };
  const why = (action, msg) => { const x = window.prompt(t('p.why')); if (x) run(() => pc.runAct(r.id, action, { reason: x }), msg).then((d) => { if (d && action === 'amend') navigateTo(`/proc/mrp?id=${d.id}`); }); };
  const weeks = [...new Set((r.lines ?? []).map((l) => l.weekStart))].sort(); const short = weeks.map((w) => (r.lines ?? []).filter((l) => l.weekStart === w).reduce((n, l) => n + l.netReq, 0));
  return (
    <div data-testid="run-object" data-status={r.status}>
      <PageHeader id="mrp-h" title={<>{r.docNo} <StatusBadge status={RUN_TONE[r.status]} label={t(`p.run.${r.status}`)} /></>} meta={<><Link to="/proc/mrp">{t('p.back')}</Link> · <Link to={`/proc/mrp-proposals?runId=${r.id}`}>{t('p.proposals')}</Link> · <Link to={`/proc/mrp-heatmap?runId=${r.id}`}>{t('p.heatmap')}</Link></>} />
      <dl className="kv" data-testid="run-figures"><div><dt>{t('p.project')}</dt><dd>{r.projectCode}</dd></div><div><dt>{t('p.horizon')}</dt><dd>{t('p.weeksN', { n: r.horizonWeeks })}</dd></div><div><dt>{t('p.buffer')}</dt><dd>{t('p.daysN', { n: r.bufferDays })}</dd></div><div><dt>{t('p.runAt')}</dt><dd>{r.runAt ? `${fmtDate(r.runAt.slice(0, 10))} · ${r.runBy}` : '—'}</dd></div><div><dt>{t('p.itemsN')}</dt><dd data-testid="run-items">{r.itemCount}</dd></div><div><dt>{t('p.shortWeeks')}</dt><dd data-testid="run-short">{r.shortageCount}</dd></div><div><dt>{t('p.proposals')}</dt><dd data-testid="run-proposals">{r.proposalCount} ({t('p.openN', { n: r.openProposals })})</dd></div></dl>
      {r.warnings.length > 0 && <ul className="mdm-banner" role="status" data-testid="run-warnings">{r.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      {error?.form && <p className="field-error" role="alert" data-testid="run-error">{error.form}</p>}{note && <p className="mdm-banner" role="status" data-testid="run-note">{note}</p>}
      <div className="actions-row no-print">
        {can.run && <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => run(() => pc.runMake(r.id), t('p.runDone'))} data-testid="run-make">{t('p.runMrp')}</button>}
        {can.amend && <button type="button" className="btn" onClick={() => why('amend')} data-testid="run-amend">{t('p.runAgain')}</button>}
        {can.cancel && <button type="button" className="btn" onClick={() => why('cancel', t('p.cancelled'))} data-testid="run-cancel">{t('p.cancel')}</button>}
        {can.print && <button type="button" className="btn" onClick={() => download(`/runs/${r.id}/print`, `${r.docNo.replaceAll('/', '-')}.pdf`).catch(() => setError({ form: t('p.fileFailed') }))} data-testid="run-print">{t('p.print')}</button>}
        {can.export && ['xlsx', 'csv'].map((f) => <button key={f} type="button" className="btn" onClick={() => download(`/runs/${r.id}/export?kind=RESULT&format=${f}`, `${r.docNo.replaceAll('/', '-')}.${f}`).catch(() => setError({ form: t('p.fileFailed') }))} data-testid={`run-export-${f}`}>{f.toUpperCase()}</button>)}
      </div>
      {r.status !== 'DRAFT' && (
        <>
          <div className="mdm-panel" data-testid="run-chart"><h2>{t('p.shortByWeek')}</h2>{weeks.length === 0 ? <p className="muted">{t('p.noData')}</p> : <Chart type="bar" data={{ categories: weeks.map((w) => w.slice(5)), series: [{ name: t('p.net'), values: short }] }} title={t('p.shortByWeek')} />}</div>
          <label className="no-print"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} data-testid="run-only" /> {t('p.onlyWithDemand')}</label>
          {lines.length === 0 ? <div className="mdm-panel" data-testid="run-empty"><h2>{t('p.nothingNeeded')}</h2><p className="muted">{t('p.nothingNeededBody')}</p></div> : (
            <div className="table-scroll"><table className="data-table" data-testid="run-grid"><caption>{t('p.mrpResult')}</caption>
              <thead><tr><th>{t('p.item')}</th><th>{t('p.week')}</th><th className="num">{t('p.gross')}</th><th className="num">{t('p.freeStock')}</th><th className="num">{t('p.openPo')}</th><th className="num">{t('p.inTransit')}</th><th className="num">{t('p.openPr')}</th><th className="num">{t('p.safety')}</th><th className="num">{t('p.net')}</th><th className="num">{t('p.proposedQty')}</th><th>{t('p.requiredBy')}</th><th>{t('p.orderBy')}</th></tr></thead>
              <tbody>{lines.map((l) => <tr key={l.id} data-testid="run-line" data-late={l.late ? '1' : '0'}><td>{l.itemCode} · {l.itemName}</td><td>{fmtDate(l.weekStart)}</td><td className="num"><button type="button" className="btn-link" onClick={() => setPick(l)} aria-label={`${l.itemCode} ${l.weekStart}: ${t('p.activities')}`} data-testid="run-drill">{fmtQty(l.grossReq)}</button></td><td className="num">{fmtQty(l.freeStock)}</td><td className="num">{fmtQty(l.openPo)}</td><td className="num">{fmtQty(l.inTransit)}</td><td className="num">{fmtQty(l.openPr)}</td><td className="num">{fmtQty(l.safetyStock)}</td><td className="num"><strong>{fmtQty(l.netReq)}</strong></td><td className="num">{fmtQty(l.proposedQty)}</td><td>{l.requiredBy ? fmtDate(l.requiredBy) : '—'}</td><td>{l.orderBy ? fmtDate(l.orderBy) : '—'} {l.late && <StatusBadge status="REJECTED" label={t('p.late')} />}</td></tr>)}</tbody></table></div>
          )}
          {pick && (
            <div className="mdm-panel" data-testid="run-activities" role="region" aria-label={t('p.activities')}><h2>{t('p.activitiesOf', { i: pick.itemCode, w: fmtDate(pick.weekStart) })}</h2>
              {pick.activities.length === 0 ? <p className="muted">{t('p.noActivities')}</p> : <ul>{pick.activities.map((a) => <li key={`${a.activityId}-${a.code}`} data-testid="run-activity">{a.scheduleId ? <Link to={`/plan/schedules?id=${a.scheduleId}`}>{a.code}</Link> : a.code} · {a.name}{a.start ? ` (${fmtDate(a.start)} – ${fmtDate(a.finish)})` : ''}</li>)}</ul>}
              <button type="button" className="btn" onClick={() => setPick(null)}>{t('p.close')}</button></div>
          )}
        </>
      )}
    </div>
  );
}

export default function MrpPage() {
  const t = useT('proc'); usePageTitle(t('p.mrpTitle')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const qc = useQueryClient();
  const pq = useQuery({ queryKey: ['proc', 'mrp-projects'], queryFn: pc.mrpProjects, retry: false }); const [f, setF] = useState({ projectId: '', horizonWeeks: '12', bufferDays: '3', includeMto: true }); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  const projects = (pq.data ?? []).filter((p) => p.canRun); const projectId = f.projectId || (projects[0] ? String(projects[0].id) : '');
  const rq = useQuery({ queryKey: ['proc', 'runs', projectId], queryFn: () => pc.runs(projectId), enabled: Boolean(projectId), retry: false });
  if (id) return <section aria-labelledby="mrp-h" data-testid="proc-mrp"><Run key={id} t={t} id={id} /></section>;
  if (pq.error?.status === 403) return <NoPermission what={t('p.mrpTitle')} permission="proc.run.view" />;
  if (pq.isPending) return <Skeleton label={t('p.mrpTitle')} rows={4} />;
  const sel = projects.find((p) => String(p.id) === projectId);
  const go = async () => { setError(null); setBusy(true); try { const c = await pc.runCreate({ projectId: Number(projectId), horizonWeeks: Number(f.horizonWeeks), bufferDays: Number(f.bufferDays), includeMto: f.includeMto }); await pc.runMake(c.id); qc.invalidateQueries({ queryKey: ['proc'] }); navigateTo(`/proc/mrp?id=${c.id}`); } catch (e) { setError(errorInfo(e)); } finally { setBusy(false); } };
  return (
    <section aria-labelledby="mrp-h" data-testid="proc-mrp">
      <PageHeader id="mrp-h" title={t('p.mrpTitle')} subtitle={t('p.mrpIntro')} />
      {projects.length === 0 ? <div className="mdm-panel" data-testid="mrp-none"><h2>{t('p.noProject')}</h2><p className="muted">{t('p.noProjectBody')}</p></div> : (
        <form className="mdm-panel" onSubmit={(e) => { e.preventDefault(); go(); }} noValidate aria-label={t('p.params')}>
          <div className="form-grid">
            <Field label={t('p.project')} name="projectId" error={error}><select value={projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })} style={{ minHeight: 44 }} data-testid="mrp-project">{projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></Field>
            <Field label={t('p.horizon')} name="horizonWeeks" error={error}><input type="number" min="1" max="52" value={f.horizonWeeks} onChange={(e) => setF({ ...f, horizonWeeks: e.target.value })} style={{ minHeight: 44 }} data-testid="mrp-horizon" /></Field>
            <Field label={t('p.buffer')} name="bufferDays" error={error}><input type="number" min="0" max="60" value={f.bufferDays} onChange={(e) => setF({ ...f, bufferDays: e.target.value })} style={{ minHeight: 44 }} data-testid="mrp-buffer" /></Field>
            <label><input type="checkbox" checked={f.includeMto} onChange={(e) => setF({ ...f, includeMto: e.target.checked })} data-testid="mrp-mto" /> {t('p.includeMto')}</label>
          </div>
          {sel && !sel.hasSchedule && <p className="mdm-banner" role="status" data-testid="mrp-no-schedule">{t('p.noSchedule')}</p>}
          {error?.form && <p className="field-error" role="alert" data-testid="mrp-error">{error.form}</p>}
          <button type="submit" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy || !projectId} data-testid="mrp-go">{t('p.runMrp')}</button>
        </form>
      )}
      <div className="mdm-panel" data-testid="mrp-runs"><h2>{t('p.earlierRuns')}</h2>
        {rq.isPending && projectId ? <Skeleton label={t('p.earlierRuns')} rows={2} /> : (rq.data ?? []).length === 0 ? <p className="muted" data-testid="mrp-runs-empty">{t('p.noRuns')}</p> : (
          <div className="table-scroll"><table className="data-table"><caption className="sr-only">{t('p.earlierRuns')}</caption><thead><tr><th>{t('p.docNo')}</th><th>{t('p.date')}</th><th className="num">{t('p.itemsN')}</th><th className="num">{t('p.shortWeeks')}</th><th className="num">{t('p.proposals')}</th><th>{t('p.status')}</th></tr></thead>
            <tbody>{rq.data.map((x) => <tr key={x.id} data-testid="mrp-run-row"><td><Link to={`/proc/mrp?id=${x.id}`}>{x.docNo}</Link></td><td>{fmtDate(x.date)}</td><td className="num">{x.items}</td><td className="num">{x.shortages}</td><td className="num">{x.proposals}</td><td><StatusBadge status={RUN_TONE[x.status]} label={t(`p.run.${x.status}`)} /></td></tr>)}</tbody></table></div>
        )}
      </div>
    </section>
  );
}
