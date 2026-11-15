import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, usePageTitle } from '../core/pages/ui.jsx';
import { download, fmtDate, ordOf, pl } from './api.js';
import { SchedulePicker, useSearch } from './parts.jsx';
import { Buckets } from './BaselinesPage.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Variance and Quality (part 13.03, FR-03, FR-06): two reports of one programme. Variance: every activity of a baseline against the programme of today (or another baseline): start, finish and duration
// variance, the critical activities that slipped, the milestones, with the baseline and current bars drawn for the rows shown. Quality: the fourteen checks in the manner of DCMA-14 with their limits
// as parameters; a check opens the activities or links it found. Every figure is worked out by the server; both export as XLSX, PDF and CSV.
const signed = (n) => (n == null ? '—' : n > 0 ? `+${n}` : String(n));
const slug = (s) => String(s).replace(/[^A-Za-z0-9_-]+/g, '-');
const Q_TONE = { PASS: 'APPROVED', FAIL: 'REJECTED', NA: 'DRAFT' };
const ONLY = ['all', 'slipped', 'critical', 'milestones', 'changed', 'added', 'removed'];

/** The baseline bar (thin, neutral) over the current bar of each row shown: two series, so a legend; the variance is written beside the bars, never told by colour alone. */
function CompareBars({ t, rows }) {
  if (!rows.length) return null;
  const from = Math.min(...rows.flatMap((r) => [ordOf(r.bStart), ordOf(r.cStart)])); const to = Math.max(...rows.flatMap((r) => [ordOf(r.bFinish), ordOf(r.cFinish)])) + 1; const span = Math.max(1, to - from);
  const W = 760; const left = 150; const right = 70; const rowH = 26; const X = (iso, end = false) => left + ((W - left - right) * (ordOf(iso) + (end ? 1 : 0) - from)) / span;
  return (
    <figure data-testid="var-bars" style={{ margin: 0 }}>
      <figcaption className="muted"><svg width="12" height="8" aria-hidden="true"><rect width="12" height="4" y="2" rx="2" fill="var(--erp-color-text-muted)" /></svg> {t('var.legendBaseline')} · <svg width="12" height="8" aria-hidden="true"><rect width="12" height="8" rx="3" fill="var(--erp-chart-1)" /></svg> {t('var.legendCurrent')}</figcaption>
      <div className="table-scroll">
        <svg width={W} height={rows.length * rowH + 4} role="img" aria-label={t('var.chartBars')}>
          {rows.map((r, i) => { const y = i * rowH; const label = `${r.code} ${r.name}: ${t('var.legendBaseline')} ${fmtDate(r.bStart)} – ${fmtDate(r.bFinish)}, ${t('var.legendCurrent')} ${fmtDate(r.cStart)} – ${fmtDate(r.cFinish)} (${t('var.days', { n: signed(r.finishVar) })})`; return (
            <g key={r.code}><title>{label}</title>
              <rect x={0} y={y} width={W} height={rowH} fill="transparent" />
              <text x={left - 8} y={y + 17} fontSize="12" textAnchor="end" fill="var(--erp-color-text-secondary)">{r.code}</text>
              <rect x={X(r.bStart)} y={y + 4} width={Math.max(3, X(r.bFinish, true) - X(r.bStart))} height={4} rx="2" fill="var(--erp-color-text-muted)" />
              <rect x={X(r.cStart)} y={y + 11} width={Math.max(3, X(r.cFinish, true) - X(r.cStart))} height={9} rx="3" fill="var(--erp-chart-1)" />
              <text x={Math.min(W - 4, Math.max(X(r.bFinish, true), X(r.cFinish, true)) + 6)} y={y + 19} fontSize="11" fill="var(--erp-color-text-primary)">{signed(r.finishVar)}{r.critical && r.finishVar > 0 ? ` · ${t('f.critical')}` : ''}</text>
            </g>
          ); })}
        </svg>
      </div>
    </figure>
  );
}

function Variance({ t, baselineId, scheduleId }) {
  const [p, setP] = useState({ only: 'all', wbs: '', q: '', sort: '-finishVar', page: 1, pageSize: 50 }); const [failed, setFailed] = useState(false);
  const set = (patch) => setP((x) => ({ ...x, page: 1, ...patch }));
  const qs = new URLSearchParams({ only: p.only, sort: p.sort, ...(p.wbs ? { wbs: p.wbs } : {}), ...(p.q.trim() ? { q: p.q.trim() } : {}), ...(scheduleId ? { scheduleId: String(scheduleId) } : {}) }); const pageQs = `${qs}&page=${p.page}&pageSize=${p.pageSize}`;
  const vq = useQuery({ queryKey: ['plan', 'variance', baselineId, pageQs], queryFn: () => pl.variance(baselineId, pageQs), retry: false, placeholderData: (x) => x });
  if (vq.error?.status === 403) return <NoPermission what={t('var.title')} permission="plan.baseline.view" />;
  if (vq.isPending) return <Skeleton label={t('var.title')} rows={6} />;
  if (vq.isError) return <ErrorState error={vq.error} onRetry={vq.refetch} />;
  const d = vq.data; const s = d.summary; const pages = Math.max(1, Math.ceil(d.total / d.pageSize)); const sid = d.against.kind === 'schedule' ? d.against.id : null;
  return (
    <div data-testid="var-report">
      <form className="mdm-panel no-print" onSubmit={(e) => e.preventDefault()} aria-label={t('act.filters')}>
        <div className="form-grid">
          <Field label={t('act.show')} name="only"><select value={p.only} onChange={(e) => set({ only: e.target.value })} data-testid="var-only">{ONLY.map((k) => <option key={k} value={k}>{t(`var.only.${k}`)}</option>)}</select></Field>
          <Field label={t('f.wbs')} name="wbs"><select value={p.wbs} onChange={(e) => set({ wbs: e.target.value })} data-testid="var-wbs"><option value="">{t('act.allWbs')}</option>{d.wbs.map((w) => <option key={w.code} value={w.code}>{w.label}</option>)}</select></Field>
          <Field label={t('act.search')} name="q"><input type="search" value={p.q} onChange={(e) => set({ q: e.target.value })} maxLength={100} data-testid="var-search" /></Field>
          <Field label={t('var.sort')} name="sort"><select value={p.sort} onChange={(e) => set({ sort: e.target.value })} data-testid="var-sort">{['-finishVar', 'finishVar', '-startVar', '-durationVar', 'cFinish', 'code'].map((k) => <option key={k} value={k}>{t(`var.sort.${k}`)}</option>)}</select></Field>
        </div>
        {d.can.export && <div className="actions">{['xlsx', 'pdf', 'csv'].map((f) => <button key={f} type="button" className="btn" onClick={() => { setFailed(false); download(`/baselines/${baselineId}/variance/export?${qs}&format=${f}`, `variance-${slug(d.baseline.docNo)}.${f}`).catch(() => setFailed(true)); }} data-testid={`var-export-${f}`}>{t('var.export', { f: f.toUpperCase() })}</button>)}</div>}
        {failed && <p className="field-error" role="alert">{t('bl.fileFailed')}</p>}
      </form>
      <p className="muted" data-testid="var-against">{t('var.against', { b: `${d.baseline.docNo} (${t('bl.revision')} ${d.baseline.baselineNo})`, c: d.against.label })}</p>
      {d.against.needsCalc && <p className="mdm-banner" role="status" data-testid="var-stale">{t('act.needsCalc')}</p>}
      <dl className="kv" data-testid="var-summary">
        <div><dt>{t('var.baselineFinish')}</dt><dd>{fmtDate(s.baselineFinish)}</dd></div><div><dt>{t('var.currentFinish')}</dt><dd>{fmtDate(s.currentFinish)}</dd></div><div><dt>{t('var.finishVar')}</dt><dd data-testid="var-finish-var">{t('var.days', { n: signed(s.finishVar) })}</dd></div>
        <div><dt>{t('var.slipped')}</dt><dd data-testid="var-slipped">{s.slipped}</dd></div><div><dt>{t('var.criticalSlipped')}</dt><dd data-testid="var-critical">{s.criticalSlipped}</dd></div><div><dt>{t('var.milestonesSlipped')}</dt><dd>{s.milestonesSlipped} / {s.milestones}</dd></div>
        <div><dt>{t('var.ahead')}</dt><dd>{s.ahead}</dd></div><div><dt>{t('var.added')}</dt><dd>{s.added}</dd></div><div><dt>{t('var.removed')}</dt><dd>{s.removed}</dd></div><div><dt>{t('var.maxSlip')}</dt><dd>{t('var.days', { n: s.maxSlip })}</dd></div>
      </dl>
      <h2>{t('var.chartSpread')}</h2>
      <Buckets t={t} buckets={s.buckets} />
      <h2>{t('var.chartBars')}</h2>
      <CompareBars t={t} rows={d.chart} />
      {d.rows.length === 0 ? <p className="muted" data-testid="var-none">{t('act.noneMatch')}</p> : (
        <div className="table-scroll"><table className="data-table" data-testid="var-table"><caption>{t('var.caption')}</caption>
          <thead><tr><th>{t('f.code')}</th><th>{t('f.activity')}</th><th>{t('f.status')}</th><th>{t('var.bStart')}</th><th>{t('var.bFinish')}</th><th>{t('var.cStart')}</th><th>{t('var.cFinish')}</th><th className="num">{t('var.startVar')}</th><th className="num">{t('var.finishVar')}</th><th className="num">{t('var.durationVar')}</th><th>{t('f.critical')}</th></tr></thead>
          <tbody>{d.rows.map((r) => (
            <tr key={`${r.status}${r.code}`} data-testid="var-row" data-code={r.code}>
              <td>{sid && r.activityId ? <Link to={`/plan/gantt?scheduleId=${sid}`}>{r.code}</Link> : r.code}</td><td>{r.name}{r.milestone ? ` · ${t('type.MILESTONE')}` : ''}</td><td>{t(`var.st.${r.status}`)}</td>
              <td>{fmtDate(r.bStart)}</td><td>{fmtDate(r.bFinish)}</td><td>{fmtDate(r.cStart)}</td><td>{fmtDate(r.cFinish)}</td><td className="num">{signed(r.startVar)}</td><td className="num" data-testid="var-fv">{signed(r.finishVar)}</td><td className="num">{signed(r.durationVar)}</td><td>{r.critical ? t('var.yes') : ''}</td>
            </tr>
          ))}</tbody>
          <tfoot><tr><th colSpan={2}>{t('f.total')}: {t('act.total', { n: d.filtered.rows })}</th><td colSpan={5}>{t('var.totalLine', { s: d.filtered.slipped, c: d.filtered.criticalSlipped })}</td><td /><td className="num">{t('var.maxShort', { n: d.filtered.maxSlip })}</td><td colSpan={2} /></tr></tfoot>
        </table></div>
      )}
      {pages > 1 && <div className="actions no-print"><button type="button" className="btn" disabled={p.page <= 1} onClick={() => setP({ ...p, page: p.page - 1 })}>{t('act.prev')}</button><span className="muted">{p.page} / {pages}</span><button type="button" className="btn" disabled={p.page >= pages} onClick={() => setP({ ...p, page: p.page + 1 })} data-testid="var-next">{t('act.next')}</button></div>}
    </div>
  );
}

function Quality({ t, scheduleId }) {
  const [p, setP] = useState({ highFloat: '44', longDuration: '44', tolerance: '5' }); const [check, setCheck] = useState(null); const [page, setPage] = useState(1); const [failed, setFailed] = useState(false);
  const ok = [p.highFloat, p.longDuration].every((v) => Number(v) >= 1 && Number(v) <= 2000) && Number(p.tolerance) >= 0 && Number(p.tolerance) <= 100 && p.tolerance !== '';
  const qs = new URLSearchParams({ highFloat: String(Math.round(Number(p.highFloat))), longDuration: String(Math.round(Number(p.longDuration))), tolerance: String(Number(p.tolerance)) }); const full = `${qs}${check ? `&check=${check}&page=${page}&pageSize=50` : ''}`;
  const qq = useQuery({ queryKey: ['plan', 'quality', scheduleId, full], queryFn: () => pl.quality(scheduleId, full), enabled: ok, retry: false, placeholderData: (x) => x });
  if (qq.error?.status === 403) return <NoPermission what={t('q.title')} permission="plan.schedule.view" />;
  const d = qq.data; const s = d?.summary; const tot = s ? s.passed + s.failed + s.notApplicable : 0; const W = 420;
  return (
    <div data-testid="q-report">
      <form className="mdm-panel no-print" onSubmit={(e) => e.preventDefault()} aria-label={t('q.limits')}>
        <div className="form-grid">
          <Field label={t('q.highFloat')} name="highFloat"><input type="number" min="1" max="2000" step="1" value={p.highFloat} onChange={(e) => setP({ ...p, highFloat: e.target.value })} data-testid="q-highfloat" /></Field>
          <Field label={t('q.longDuration')} name="longDuration"><input type="number" min="1" max="2000" step="1" value={p.longDuration} onChange={(e) => setP({ ...p, longDuration: e.target.value })} data-testid="q-longduration" /></Field>
          <Field label={t('q.tolerance')} name="tolerance"><input type="number" min="0" max="100" step="0.5" value={p.tolerance} onChange={(e) => setP({ ...p, tolerance: e.target.value })} data-testid="q-tolerance" /></Field>
        </div>
        {!ok && <p className="field-error" role="alert">{t('q.badLimits')}</p>}
        {d?.can.export && <div className="actions">{['xlsx', 'pdf', 'csv'].map((f) => <button key={f} type="button" className="btn" onClick={() => { setFailed(false); download(`/schedules/${scheduleId}/quality/export?${qs}&format=${f}`, `quality-${slug(d.subject.docNo)}.${f}`).catch(() => setFailed(true)); }} data-testid={`q-export-${f}`}>{t('var.export', { f: f.toUpperCase() })}</button>)}</div>}
        {failed && <p className="field-error" role="alert">{t('bl.fileFailed')}</p>}
      </form>
      {qq.isPending && ok && <Skeleton label={t('q.title')} rows={6} />}
      {qq.isError && qq.error?.status !== 403 && <ErrorState error={qq.error} onRetry={qq.refetch} />}
      {d && (
        <>
          {d.subject.needsCalc && <p className="mdm-banner" role="status" data-testid="q-stale">{t('act.needsCalc')}</p>}
          <dl className="kv" data-testid="q-summary">
            <div><dt>{t('f.schedule')}</dt><dd>{d.subject.label}</dd></div><div><dt>{t('q.passed')}</dt><dd data-testid="q-passed">{s.passed}</dd></div><div><dt>{t('q.failed')}</dt><dd data-testid="q-failed">{s.failed}</dd></div><div><dt>{t('q.na')}</dt><dd>{s.notApplicable}</dd></div>
            <div><dt>{t('q.score')}</dt><dd data-testid="q-score">{s.score == null ? '—' : `${s.score} %`}</dd></div><div><dt>{t('f.activities')}</dt><dd>{s.activities}</dd></div><div><dt>{t('bl.links')}</dt><dd>{s.links}</dd></div><div><dt>{t('f.dataDate')}</dt><dd>{fmtDate(s.dataDate)}</dd></div>
            <div><dt>{t('q.baseline')}</dt><dd>{d.baseline ? <Link to={`/plan/baselines?id=${d.baseline.id}`}>{d.baseline.docNo}</Link> : t('q.noBaseline')}</dd></div>
          </dl>
          <figure style={{ margin: 0 }} data-testid="q-chart">
            <svg width={W} height={18} role="img" aria-label={t('q.chart', { p: s.passed, f: s.failed, n: s.notApplicable })} style={{ maxWidth: '100%' }}>
              {tot > 0 && [['passed', s.passed, 'var(--erp-color-status-success-solid)'], ['failed', s.failed, 'var(--erp-color-status-error-solid)'], ['na', s.notApplicable, 'var(--erp-color-border-subtle)']].reduce((acc, [k, n, fill]) => { const w = (W * n) / tot; if (n) acc.out.push(<rect key={k} x={acc.x + 1} y={3} width={Math.max(1, w - 2)} height={12} rx="3" fill={fill}><title>{`${t(`q.${k}`)}: ${n}`}</title></rect>); acc.x += w; return acc; }, { x: 0, out: [] }).out}
            </svg>
            <figcaption className="muted">✓ {t('q.passed')} {s.passed} · ✗ {t('q.failed')} {s.failed} · – {t('q.na')} {s.notApplicable}</figcaption>
          </figure>
          <div className="table-scroll"><table className="data-table" data-testid="q-table"><caption>{t('q.caption')}</caption>
            <thead><tr><th>{t('q.check')}</th><th>{t('q.what')}</th><th>{t('q.found')}</th><th>{t('q.allowed')}</th><th>{t('q.result')}</th><th><span className="sr-only">{t('act.show')}</span></th></tr></thead>
            <tbody>{d.checks.map((c) => (
              <tr key={c.code} data-testid="q-row" data-code={c.code} data-status={c.status}>
                <td>{t(`q.c.${c.code}`)}</td><td>{t(`q.d.${c.code}`)}</td><td>{c.valueLabel}</td><td>{c.threshold}</td><td><StatusBadge status={Q_TONE[c.status]} label={t(`q.st.${c.status}`)} /></td>
                <td>{c.count > 0 && <button type="button" className="btn" aria-expanded={check === c.code} onClick={() => { setCheck(check === c.code ? null : c.code); setPage(1); }} data-testid="q-drill">{t('q.show', { n: c.count })}</button>}</td>
              </tr>
            ))}</tbody>
            <tfoot><tr><th colSpan={2}>{t('f.total')}</th><td colSpan={2}>{t('q.totalLine', { p: s.passed, f: s.failed, n: s.notApplicable })}</td><td colSpan={2}>{s.score == null ? '' : `${s.score} %`}</td></tr></tfoot>
          </table></div>
          {d.drill && (
            <div className="mdm-panel" data-testid="q-drill-panel">
              <h2>{t(`q.c.${d.drill.code}`)}: {d.drill.total}</h2>
              <div className="table-scroll"><table className="data-table"><caption className="sr-only">{t(`q.d.${d.drill.code}`)}</caption><thead><tr><th>{t('q.item')}</th><th>{t('f.name')}</th><th>{t('q.detail')}</th></tr></thead>
                <tbody>{d.drill.rows.map((r, i) => <tr key={i} data-testid="q-drill-row"><td>{r.activityId && d.subject.kind === 'schedule' ? <Link to={`/plan/gantt?scheduleId=${d.subject.id}`}>{r.code}</Link> : r.code}</td><td>{r.name}</td><td>{r.detail}</td></tr>)}</tbody></table></div>
              {d.drill.total > d.drill.pageSize && <div className="actions"><button type="button" className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('act.prev')}</button><span className="muted">{page} / {Math.ceil(d.drill.total / d.drill.pageSize)}</span><button type="button" className="btn" disabled={page * d.drill.pageSize >= d.drill.total} onClick={() => setPage(page + 1)}>{t('act.next')}</button></div>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function VariancePage() {
  const t = useT('plan');
  usePageTitle(t('var.pageTitle'));
  const sp = useSearch();
  const [tab, setTab] = useState(sp.get('tab') === 'quality' ? 'quality' : 'variance'); const [projectId, setProjectId] = useState(null); const [scheduleId, setScheduleId] = useState(Number(sp.get('scheduleId')) || null); const [baselineId, setBaselineId] = useState(Number(sp.get('baselineId')) || null);
  const sq = useQuery({ queryKey: ['plan', 'schedule', scheduleId], queryFn: () => pl.schedule(scheduleId), enabled: Boolean(scheduleId), retry: false });
  const b0 = useQuery({ queryKey: ['plan', 'baseline', baselineId], queryFn: () => pl.baseline(baselineId), enabled: Boolean(baselineId) && !projectId && !scheduleId, retry: false });
  const pid = projectId ?? sq.data?.projectId ?? b0.data?.projectId ?? null;
  const bq = useQuery({ queryKey: ['plan', 'baselines-of', pid], queryFn: () => pl.baselinesOf(pid), enabled: Boolean(pid), retry: false });
  const approved = (bq.data?.rows ?? []).filter((b) => b.status === 'APPROVED' || b.id === baselineId);
  useEffect(() => { if (bq.data && !baselineId && bq.data.currentId) setBaselineId(bq.data.currentId); }, [bq.data, baselineId]);
  if (bq.error?.status === 403) return <NoPermission what={t('var.pageTitle')} permission="plan.baseline.view" />;
  return (
    <section aria-labelledby="var-h" data-testid="plan-variance">
      <PageHeader id="var-h" title={t('var.pageTitle')} />
      <form className="mdm-panel no-print" onSubmit={(e) => e.preventDefault()} aria-label={t('pr.params')}>
        <SchedulePicker projectId={pid} scheduleId={scheduleId} onProject={(v) => { setProjectId(v); setScheduleId(null); setBaselineId(null); }} onSchedule={setScheduleId} testId="var" />
        <div className="form-grid">
          <Field label={t('var.baseline')} name="baselineId"><select value={baselineId ?? ''} onChange={(e) => setBaselineId(e.target.value ? Number(e.target.value) : null)} disabled={!pid} data-testid="var-baseline"><option value="">{t('var.chooseBaseline')}</option>{approved.map((b) => <option key={b.id} value={b.id}>{b.docNo} · {t('bl.revision')} {b.baselineNo}{b.current ? ` · ${t('bl.current')}` : ''}</option>)}</select></Field>
        </div>
      </form>
      <div role="tablist" aria-label={t('var.pageTitle')} className="actions-row no-print">
        {['variance', 'quality'].map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'btn btn-primary' : 'btn'} onClick={() => setTab(k)} data-testid={`var-tab-${k}`}>{t(k === 'variance' ? 'var.title' : 'q.title')}</button>)}
      </div>
      <div role="tabpanel">
        {tab === 'variance' && (baselineId ? <Variance key={baselineId} t={t} baselineId={baselineId} scheduleId={scheduleId} /> : <p className="muted" data-testid="var-choose">{pid && bq.data && approved.length === 0 ? t('var.noBaseline') : t('var.choose')} <Link to="/plan/baselines">{t('bl.title')}</Link></p>)}
        {tab === 'quality' && (scheduleId ? <Quality key={scheduleId} t={t} scheduleId={scheduleId} /> : <p className="muted" data-testid="q-choose">{t('q.choose')}</p>)}
      </div>
    </section>
  );
}
