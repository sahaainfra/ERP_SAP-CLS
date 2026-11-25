import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Chart from '../../platform/charts/Chart.jsx';
import { Card, CardGrid } from '../../platform/design/Card.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { useFormat, useT } from '../../platform/i18n/index.js';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from '../eng/common.js';
import { Pager, ParamPanel, TONE, download, go, post, qs, read } from './common.jsx';

// Part 30.02: Reconciliation Health (overview page §3.4): the trace completeness first, the key figures, a card per reconciliation check with
// its differences ("View all" opens its exceptions), the differences by check and the runs over time, the exceptions with a link to the record
// behind each, and what is waiting for me. Amounts show only to holders of tst.recon.amounts; a run is a background job the page follows.
const BASE = '/admin/reconciliation-health';

export function ReconHealth() {
  const t = useT('tst');
  const { number, money, dateTime } = useFormat();
  const search = useSearch();
  const cache = useQueryClient();
  usePageTitle(t('rh.title'));
  const params = { run: search.get('run') ?? '', check: search.get('check') ?? '', status: search.get('status') ?? '', q: search.get('q') ?? '', page: search.get('page') ?? '' };
  const q = useQuery({ queryKey: ['tst', 'recon', params], queryFn: () => read(`/tst/reconciliation${qs(params)}`), retry: false, placeholderData: (p) => p });
  const [runId, setRunId] = useState(null);
  const [text, setText] = useState(params.q);
  const start = useMutation({ mutationFn: () => post('/tst/reconciliation/runs'), onSuccess: (r) => setRunId(r.id) });
  const running = useQuery({ queryKey: ['tst', 'recon-run', runId], queryFn: () => read(`/tst/reconciliation/runs/${runId}`), enabled: Boolean(runId), refetchInterval: (x) => (['DONE', 'FAILED'].includes(x.state.data?.status) ? false : 1500) });
  const done = ['DONE', 'FAILED'].includes(running.data?.status);
  useEffect(() => { if (done) { cache.invalidateQueries({ queryKey: ['tst', 'recon'] }); setRunId(null); } }, [done, cache]);
  const exp = useMutation({ mutationFn: (f) => download('/tst/reconciliation/export', { run: params.run, check: params.check, status: params.status, format: f }, `reconciliation.${f}`) });

  if (q.error?.status === 403) return <NoPermission what={t('rh.noPermission')} permission="tst.recon.view" />;
  if (q.isPending) return <section><PageHeader title={t('rh.title')} /><Skeleton label={t('rh.title')} rows={8} /></section>;
  if (q.error) return <section><PageHeader title={t('rh.title')} /><ErrorState error={q.error} onRetry={q.refetch} /></section>;
  const d = q.data;
  const n = (v) => (v == null ? '—' : number(String(v), { decimals: 0 }));
  const value = (unit, v, masked) => (masked || v == null ? (masked ? t('rh.masked') : '—') : unit === 'money' ? money(v) : number(String(v), { decimals: unit === 'qty' ? 3 : 0 }));
  const busy = Boolean(runId) || start.isPending;
  const actions = d.can.run ? <button type="button" className="btn btn-primary" onClick={() => start.mutate()} disabled={busy} data-testid="rh-run">{busy ? t('running') : t('rh.run')}</button> : null;
  const menu = d.can.export && d.run ? ['xlsx', 'csv', 'pdf'].map((f) => ({ label: t('exportAs', { f: f.toUpperCase() }), testid: `rh-export-${f}`, onClick: () => exp.mutate(f) })) : [];
  if (!d.run) return <section aria-labelledby="rh-h" data-testid="tst-recon">
    <PageHeader id="rh-h" title={t('rh.title')} subtitle={t('rh.subtitle')} actions={actions} />
    {start.error && <ErrorState error={start.error} />}
    <EmptyState title={t('rh.none')} message={d.running ? t('rh.queued') : t('rh.noneBody')} action={actions} />
  </section>;
  const R = d.run; const tr = d.trace;
  const failing = d.summary.filter((s) => s.status === 'FAIL' || s.status === 'ERROR');
  const byCheck = { categories: d.summary.map((s) => s.code), series: [{ name: t('rh.findings'), values: d.summary.map((s) => s.failed), drill: d.summary.map((s) => `${BASE}?check=${s.code}`) }] };
  const history = { categories: d.history.map((h) => h.runNo), series: [{ name: t('rh.critical'), values: d.history.map((h) => h.critical), drill: d.history.map((h) => `${BASE}?run=${h.id}`) }, { name: t('rh.tracePct'), values: d.history.map((h) => h.tracePct ?? 0), drill: d.history.map((h) => `${BASE}?run=${h.id}`) }] };
  const set = (patch) => go(BASE, patch);
  return <section aria-labelledby="rh-h" data-testid="tst-recon" data-result={R.result}>
    <PageHeader id="rh-h" title={t('rh.title')} status={<StatusBadge status={TONE[R.result]} label={t(`st.${R.result}`)} variant="solid" />}
      subtitle={t('rh.runOf', { run: R.runNo, at: dateTime(R.finishedAt), by: R.requestedBy })} actions={actions} menu={menu} />
    {(start.error || exp.error) && <ErrorState error={start.error ?? exp.error} />}
    {!d.amountsVisible && <p className="muted small" data-testid="rh-masked-note">{t('rh.maskedNote')}</p>}
    <KpiRow testid="rh-tiles" label={t('rh.title')}>
      <KpiTile testid="rh-trace" label={t('rh.trace')} kind="quality" value={tr ? `${tr.pct}` : '—'} unit="%" tone={tr?.met ? 'success' : 'error'} to={`${BASE}#trace`}>{t('rh.traceOf', { linked: n(tr?.linked), total: n(tr?.total), target: d.tolerance.traceTargetPct })}</KpiTile>
      <KpiTile testid="rh-critical" label={t('rh.critical')} kind="risk" value={n(R.critical)} tone={R.critical ? 'error' : 'success'} to={`${BASE}?status=FAIL`} />
      <KpiTile label={t('rh.checksFailing')} kind="count" value={`${n(failing.length)} / ${n(d.summary.length)}`} tone={failing.length ? 'error' : 'success'} to={`${BASE}?status=FAIL`} />
      <KpiTile label={t('rh.tolerance')} kind="money" value={d.tolerance.money == null ? '—' : money(d.tolerance.money)} to={`${BASE}#tolerance`}>{t('rh.toleranceQty', { q: d.tolerance.qty })}</KpiTile>
    </KpiRow>
    <CardGrid testid="rh-checks">
      {d.summary.map((s) => <Card key={s.code} title={s.label} subtitle={t('rh.owner', { part: s.owner })} testid="rh-check" viewAll={`${BASE}?check=${s.code}`} viewAllLabel={t('viewAll')}
        menu={<StatusBadge status={TONE[s.status]} label={t(`st.${s.status}`)} size="sm" />}>
        <p data-testid="rh-check-facts" data-code={s.code} data-status={s.status}>{s.status === 'SKIPPED' || s.status === 'ERROR' ? s.note : t('rh.checkFacts', { compared: n(s.compared), failed: n(s.failed) })}</p>
        {s.failed > 0 && <p><strong>{t('rh.difference')}:</strong> {value(s.unit, s.difference, s.unit === 'money' && !d.amountsVisible)}</p>}
        <p className="small"><Link to={s.drill}>{t('rh.openOwner')}</Link></p>
      </Card>)}
    </CardGrid>
    <CardGrid>
      <Card title={t('rh.byCheck')} testid="rh-chart"><Chart type="bar" data={byCheck} title={t('rh.byCheck')} onDrill={(to) => navigateTo(to)} exportName="reconciliation-by-check" /></Card>
      <Card title={t('rh.history')} testid="rh-history"><Chart type="line" data={history} title={t('rh.history')} onDrill={(to) => navigateTo(to)} exportName="reconciliation-runs" /></Card>
    </CardGrid>
    <Card title={t('rh.pending')} testid="rh-pending">
      {failing.length === 0 && tr?.met ? <EmptyState compact title={t('rh.nothingPending')} message={t('rh.nothingPendingBody')} />
        : <ul className="lp-list">{failing.map((s) => <li key={s.code}><Link to={`${BASE}?check=${s.code}`}>{t('rh.clear', { n: n(s.failed), check: s.label })}</Link></li>)}{tr && !tr.met && <li><a href="#trace">{t('rh.fixTrace', { n: n(tr.missing) })}</a></li>}</ul>}
    </Card>
    <Card title={t('rh.exceptions')} subtitle={params.check ? d.summary.find((s) => s.code === params.check)?.label : t('rh.exceptionsAll')} testid="rh-exceptions">
      <ParamPanel label={t('params')} done={t('done')} count={[params.check, params.status, params.q].filter(Boolean).length} testid="rh-params">
        <Field name="rh-check" label={t('rh.check')}><select value={params.check} onChange={(e) => set({ check: e.target.value })} data-testid="rh-f-check"><option value="">{t('all')}</option>{d.checks.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}</select></Field>
        <Field name="rh-status" label={t('status')}><select value={params.status} onChange={(e) => set({ status: e.target.value })} data-testid="rh-f-status"><option value="">{t('rh.failing')}</option>{['PASS', 'FAIL', 'INFO', 'SKIPPED', 'ERROR'].map((s) => <option key={s} value={s}>{t(`st.${s}`)}</option>)}</select></Field>
        <Field name="rh-q" label={t('search')}><input type="search" inputMode="search" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') set({ q: text.trim().length >= 2 ? text.trim() : '' }); }} data-testid="rh-f-q" /></Field>
      </ParamPanel>
      {!d.exceptions.rows.length ? <EmptyState compact title={t('rh.noExceptions')} message={t('rh.noExceptionsBody')} /> : <>
        <div className="table-scroll"><table className="data-table" data-testid="rh-exception-table">
          <thead><tr><th>{t('rh.check')}</th><th>{t('rh.scope')}</th><th>{t('rh.record')}</th><th className="num">{t('rh.expected')}</th><th className="num">{t('rh.actual')}</th><th className="num">{t('rh.difference')}</th><th>{t('status')}</th></tr></thead>
          <tbody>{d.exceptions.rows.map((x) => <tr key={x.id} data-testid="rh-exception" data-check={x.check} data-severity={x.severity}>
            <td data-label={t('rh.check')}>{x.checkLabel}</td><td data-label={t('rh.scope')}>{x.scope ?? '—'}</td>
            <td data-label={t('rh.record')}>{x.drill ? <Link to={x.drill}>{x.label}</Link> : x.label}{x.detail ? <><br /><span className="muted small">{x.detail}</span></> : null}</td>
            <td data-label={t('rh.expected')} className="num">{value(x.unit, x.expected, x.masked)}</td><td data-label={t('rh.actual')} className="num">{value(x.unit, x.actual, x.masked)}</td>
            <td data-label={t('rh.difference')} className="num">{value(x.unit, x.difference, x.masked)}</td>
            <td data-label={t('status')}><StatusBadge status={TONE[x.status]} label={x.severity === 'CRITICAL' ? t('rh.criticalOne') : t(`st.${x.status}`)} size="sm" /></td>
          </tr>)}</tbody>
          <tfoot className="sticky-total"><tr><th scope="row" colSpan={6}>{t('rh.exceptionsTotal', { n: n(d.exceptions.total) })}</th><td data-label={t('rh.critical')}>{n(R.critical)}</td></tr></tfoot>
        </table></div>
        <Pager page={d.exceptions.page} pageSize={d.exceptions.pageSize} total={d.exceptions.total} onPage={(p) => set({ page: p })} t={t} testid="rh-pager" />
      </>}
    </Card>
    <Card title={t('rh.traceTitle')} subtitle={t('rh.traceNote')} testid="rh-trace-card"><span id="trace" />
      {!tr?.groups.length ? <EmptyState compact title={t('rh.noTrace')} message={t('rh.noTraceBody')} /> : <div className="table-scroll"><table className="data-table" data-testid="rh-trace-table">
        <thead><tr><th>{t('rh.derived')}</th><th>{t('rh.source')}</th><th className="num">{t('rh.records')}</th><th className="num">{t('rh.missing')}</th></tr></thead>
        <tbody>{tr.groups.map((g) => <tr key={`${g.table}|${g.source}|${g.handoff ?? ''}`} data-testid="rh-trace-row" data-missing={g.missing}><td data-label={t('rh.derived')}>{g.handoff ? <><strong>{g.handoff}</strong> {g.label}<br /></> : null}<code>{g.table}</code></td><td data-label={t('rh.source')}><code>{g.source}</code></td><td data-label={t('rh.records')} className="num">{n(g.total)}</td><td data-label={t('rh.missing')} className="num">{n(g.missing)}{g.samples.length ? <><br /><span className="muted small">{g.samples.map((s) => `#${s.id}`).join(', ')}</span></> : null}</td></tr>)}</tbody>
        <tfoot className="sticky-total"><tr><th scope="row" colSpan={3}>{t('rh.traceTotal', { pct: tr.pct, total: n(tr.total) })}</th><td data-label={t('rh.missing')} className="num">{n(tr.missing)}</td></tr></tfoot>
      </table></div>}
    </Card>
    <Card title={t('rh.toleranceTitle')} testid="rh-tolerance"><span id="tolerance" />
      <p>{t('rh.toleranceBody', { money: d.tolerance.money == null ? '—' : money(d.tolerance.money), qty: d.tolerance.qty, trace: d.tolerance.traceTargetPct })}</p>
      <p className="small muted">{t('rh.toleranceHow')} {d.tolerance.keys.map((k) => <code key={k}>{k} </code>)}</p>
      {d.can.tolerance && <p><Link to="/admin/control?tab=change">{t('rh.requestChange')}</Link></p>}
    </Card>
  </section>;
}
