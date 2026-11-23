import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Chart from '../../platform/charts/Chart.jsx';
import { Card } from '../../platform/design/Card.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { useFormat, useT } from '../../platform/i18n/index.js';
import { Field, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from '../eng/common.js';
import { COLOUR, Pager, ParamPanel, PillTabs, TONE, download, go, post, qs, read } from './common.jsx';

// Part 30.01: Integration Matrix & Test Results (technical console, analytical report §3.5). Chart first, the key figures, the parameters
// (a bottom sheet on a phone), then the threads and their hand-offs, the matrix of producers, events, consumers and tests, the re-keying audit
// and the real-time latency. A run is a background job: the page follows it and reloads when it is done; so does a latency probe.
const BASE = '/admin/integration-matrix';

export function IntegrationMatrix() {
  const t = useT('tst');
  const { number, dateTime } = useFormat();
  const search = useSearch();
  const cache = useQueryClient();
  usePageTitle(t('im.title'));
  const params = { run: search.get('run') ?? '', status: search.get('status') ?? '', module: search.get('module') ?? '', q: search.get('q') ?? '', page: search.get('page') ?? '' };
  const tab = ['threads', 'matrix', 'rekeying', 'latency'].includes(search.get('tab')) ? search.get('tab') : 'threads';
  const q = useQuery({ queryKey: ['tst', 'integration', params], queryFn: () => read(`/tst/integration${qs(params)}`), retry: false, placeholderData: (p) => p });
  const [runId, setRunId] = useState(null);
  const [probeId, setProbeId] = useState(null);
  const [text, setText] = useState(params.q);
  const start = useMutation({ mutationFn: () => post('/tst/integration/runs'), onSuccess: (r) => setRunId(r.id) });
  const probe = useMutation({ mutationFn: () => post('/tst/integration/probes'), onSuccess: (r) => setProbeId(r.id) });
  const running = useQuery({ queryKey: ['tst', 'run', runId], queryFn: () => read(`/tst/integration/runs/${runId}`), enabled: Boolean(runId), refetchInterval: (x) => (['DONE', 'FAILED'].includes(x.state.data?.status) ? false : 1500) });
  const probing = useQuery({ queryKey: ['tst', 'probe', probeId], queryFn: () => read(`/tst/integration/probes/${probeId}`), enabled: Boolean(probeId), refetchInterval: (x) => (x.state.data?.status === 'SENT' ? 500 : false) });
  const runDone = ['DONE', 'FAILED'].includes(running.data?.status);
  const probeDone = probing.data && probing.data.status !== 'SENT';
  useEffect(() => { if (runDone) { cache.invalidateQueries({ queryKey: ['tst', 'integration'] }); setRunId(null); } }, [runDone, cache]);
  useEffect(() => { if (probeDone) cache.invalidateQueries({ queryKey: ['tst', 'integration'] }); }, [probeDone, cache]);
  const [format, setFormat] = useState('xlsx');
  const exp = useMutation({ mutationFn: (f) => download('/tst/integration/export', { run: params.run, status: params.status, module: params.module, format: f }, `integration-matrix.${f}`) });

  if (q.error?.status === 403) return <NoPermission what={t('im.noPermission')} permission="tst.integration.view" />;
  if (q.isPending) return <section><PageHeader title={t('im.title')} /><Skeleton label={t('im.title')} rows={8} /></section>;
  if (q.error) return <section><PageHeader title={t('im.title')} /><ErrorState error={q.error} onRetry={q.refetch} /></section>;
  const d = q.data; const T = d.totals;
  const n = (v) => (v == null ? '—' : number(String(v), { decimals: 0 }));
  const set = (patch) => go(BASE, patch);
  const chart = { categories: d.byModule.map((m) => m.module), series: [
    { name: t('st.PASS'), colour: COLOUR.PASS, values: d.byModule.map((m) => m.pass), drill: d.byModule.map((m) => `${BASE}?tab=matrix&module=${m.module}&status=PASS`) },
    { name: t('st.FAIL'), colour: COLOUR.FAIL, values: d.byModule.map((m) => m.fail), drill: d.byModule.map((m) => `${BASE}?tab=matrix&module=${m.module}&status=FAIL`) },
    { name: t('im.notExercised'), colour: COLOUR.OTHER, values: d.byModule.map((m) => m.other), drill: d.byModule.map((m) => `${BASE}?tab=matrix&module=${m.module}&status=NOT_EXERCISED`) },
  ] };
  const latencyOk = T.probeP95Ms == null || T.probeP95Ms <= T.targetMs;
  const menu = d.can.export ? ['xlsx', 'csv', 'pdf'].map((f) => ({ label: t('exportAs', { f: f.toUpperCase() }), testid: `im-export-${f}`, onClick: () => { setFormat(f); exp.mutate(f); } })) : [];
  const busy = Boolean(runId) || start.isPending;
  return <section aria-labelledby="im-h" data-testid="tst-integration" data-result={d.run.status}>
    <PageHeader id="im-h" title={t('im.title')} status={<StatusBadge status={TONE[d.run.status]} label={t(`st.${d.run.status}`)} variant="solid" />}
      subtitle={d.run.live ? t('im.live', { at: dateTime(d.run.computedAt) }) : t('im.runOf', { run: d.run.runNo, at: dateTime(d.run.computedAt) })}
      actions={<>{d.can.run && <button type="button" className="btn btn-primary" onClick={() => start.mutate()} disabled={busy} data-testid="im-run">{busy ? t('running') : t('im.run')}</button>}
        {d.can.run && <button type="button" className="btn" onClick={() => probe.mutate()} disabled={probe.isPending || (probeId && !probeDone)} data-testid="im-probe">{t('im.probe')}</button>}</>}
      menu={menu} />
    {(start.error || probe.error || exp.error) && <ErrorState error={start.error ?? probe.error ?? exp.error} />}
    {exp.isPending && <p className="muted" role="status">{t('exporting', { f: format.toUpperCase() })}</p>}
    {probing.data && <p className="mdm-banner" role="status" data-testid="im-probe-result" data-status={probing.data.status}>{probing.data.status === 'SENT' ? t('im.probeWaiting') : t('im.probeDone', { no: probing.data.probeNo, ms: n(probing.data.realtimeMs), target: n(probing.data.targetMs), result: t(`st.${probing.data.status}`) })}</p>}
    <Card title={t('im.byModule')} testid="im-chart"><Chart type="stacked" data={chart} title={t('im.byModule')} onDrill={(to) => navigateTo(to)} exportName="integration-by-module" /></Card>
    <KpiRow testid="im-tiles" label={t('im.title')}>
      <KpiTile testid="im-threads" label={t('im.threads')} kind="quality" value={`${n(T.threadsPassed)} / ${n(T.threads)}`} tone={T.threadsFailed ? 'error' : T.threadsPassed === T.threads ? 'success' : 'warning'} to={`${BASE}?tab=threads`} />
      <KpiTile testid="im-broken" label={t('im.broken')} kind="risk" value={n(T.handoffsBroken)} tone={T.handoffsBroken ? 'error' : 'success'} to={`${BASE}?tab=threads`} />
      <KpiTile testid="im-rekeyed" label={t('im.rekeyed')} kind="risk" value={n(T.rekeyed)} tone={T.rekeyed ? 'error' : 'success'} to={`${BASE}?tab=rekeying`} />
      <KpiTile testid="im-edges" label={t('im.edgesFailing')} kind="count" value={`${n(T.edgesFailed)} / ${n(T.edges)}`} tone={T.edgesFailed ? 'error' : 'success'} to={`${BASE}?tab=matrix&status=FAIL`} />
      <KpiTile testid="im-latency" label={t('im.latency')} kind="time" value={T.probeP95Ms == null ? t('im.noProbe') : n(T.probeP95Ms)} unit={T.probeP95Ms == null ? undefined : 'ms'} tone={latencyOk ? 'success' : 'error'} to={`${BASE}?tab=latency`}>{t('im.target', { ms: n(T.targetMs) })}</KpiTile>
      <KpiTile label={t('im.catalogue')} kind="count" value={`${n(T.eventTypes)} · ${n(T.consumers)}`} to={`${BASE}?tab=matrix`}>{t('im.catalogueNote')}</KpiTile>
    </KpiRow>
    <PillTabs label={t('im.title')} testid="im-tabs" value={tab} onChange={(k) => set({ tab: k === 'threads' ? '' : k })} tabs={[['threads', t('im.tab.threads')], ['matrix', t('im.tab.matrix')], ['rekeying', t('im.tab.rekeying')], ['latency', t('im.tab.latency')]]} />
    {tab === 'threads' && <Threads d={d} t={t} n={n} />}
    {tab === 'matrix' && <>
      <ParamPanel label={t('params')} done={t('done')} count={[params.status, params.module, params.q].filter(Boolean).length} testid="im-params">
        <Field name="im-status" label={t('status')}><select value={params.status} onChange={(e) => set({ status: e.target.value, tab: 'matrix' })} data-testid="im-f-status"><option value="">{t('all')}</option>{['PASS', 'FAIL', 'PENDING', 'NOT_EXERCISED'].map((s) => <option key={s} value={s}>{t(`st.${s}`)}</option>)}</select></Field>
        <Field name="im-module" label={t('module')}><select value={params.module} onChange={(e) => set({ module: e.target.value, tab: 'matrix' })} data-testid="im-f-module"><option value="">{t('all')}</option>{d.modules.map((m) => <option key={m} value={m}>{m}</option>)}</select></Field>
        <Field name="im-q" label={t('im.searchEvent')}><input type="search" inputMode="search" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') set({ q: text.trim().length >= 2 ? text.trim() : '', tab: 'matrix' }); }} data-testid="im-f-q" /></Field>
      </ParamPanel>
      <Matrix d={d} t={t} n={n} page={Number(params.page) || 1} />
      {d.dangling.length > 0 && <Card title={t('im.dangling', { n: d.dangling.length })} subtitle={t('im.danglingNote')} testid="im-dangling">
        <ul className="lp-list">{d.dangling.map((x) => <li key={`${x.consumer}|${x.pattern}`}><code>{x.consumer}</code> ← <code>{x.pattern}</code></li>)}</ul></Card>}
    </>}
    {tab === 'rekeying' && <Rekeying d={d} t={t} n={n} />}
    {tab === 'latency' && <Latency d={d} t={t} n={n} dateTime={dateTime} />}
  </section>;
}

function Threads({ d, t, n }) {
  const [open, setOpen] = useState(null);
  return <div data-testid="im-threads-list">
    {d.threads.map((th) => <Card key={th.code} title={`${th.code} · ${th.name}`} testid="im-thread" className="im-thread"
      subtitle={t('im.threadFacts', { coverage: th.coverage, broken: n(th.broken), rekeyed: n(th.rekeyed), modules: th.modules.join(', ') })}
      menu={<StatusBadge status={TONE[th.status]} label={t(`st.${th.status}`)} size="sm" />}>
      <button type="button" className="btn btn-small" aria-expanded={open === th.code} onClick={() => setOpen(open === th.code ? null : th.code)} data-testid="im-thread-toggle" data-code={th.code}>{open === th.code ? t('im.hide') : t('im.handoffs', { n: th.handoffs.length })}</button>
      {th.posting?.failed > 0 && <p className="field-error">{t('im.postingFailed', { n: th.posting.failed })}</p>}
      {open === th.code && <div className="table-scroll"><table className="data-table" data-testid="im-handoffs">
        <thead><tr><th>{t('im.handoff')}</th><th>{t('im.from')}</th><th className="num">{t('im.records')}</th><th>{t('im.findings')}</th><th>{t('status')}</th></tr></thead>
        <tbody>{th.handoffs.map((h) => <tr key={h.code} data-testid="im-handoff" data-code={h.code} data-status={h.status}>
          <td data-label={t('im.handoff')}><strong>{h.code}</strong> {h.label}<br /><span className="muted small">{h.to}</span></td>
          <td data-label={t('im.from')} className="small">{h.from}{h.events.length ? <><br /><span className="muted">{h.events.join(', ')}</span></> : null}</td>
          <td data-label={t('im.records')} className="num">{n(h.total)}</td>
          <td data-label={t('im.findings')} className="small">{h.error ?? ''}{h.brokenRows.map((r) => <div key={`b${r.id}`}>{t('im.brokenRow', { ref: r.ref })}</div>)}{h.rekeyedRows.map((r) => <div key={`r${r.id}${r.field}`}>{t('im.rekeyedRow', { ref: r.ref, field: r.fieldLabel, value: r.value, source: r.source })}</div>)}{!h.brokenRows.length && !h.rekeyedRows.length && !h.error ? '—' : null}</td>
          <td data-label={t('status')}><StatusBadge status={TONE[h.status]} label={t(`st.${h.status}`)} size="sm" /></td>
        </tr>)}</tbody>
      </table></div>}
    </Card>)}
  </div>;
}

function Matrix({ d, t, n, page }) {
  const m = d.matrix;
  if (!m.rows.length) return <EmptyState title={t('im.noEdges')} message={t('im.noEdgesBody')} action={<button type="button" className="btn" onClick={() => go(BASE, { status: '', module: '', q: '', tab: 'matrix' })}>{t('clear')}</button>} />;
  return <>
    <div className="table-scroll"><table className="data-table" data-testid="im-matrix">
      <thead><tr><th>{t('im.producer')}</th><th>{t('im.event')}</th><th>{t('im.consumer')}</th><th>{t('im.tests')}</th><th className="num">{t('im.deliveries')}</th><th className="num">{t('im.p95')}</th><th>{t('status')}</th></tr></thead>
      <tbody>{m.rows.map((r) => <tr key={`${r.event}|${r.consumer}`} data-testid="im-edge" data-status={r.status} data-event={r.event} data-consumer={r.consumer}>
        <td data-label={t('im.producer')}>{r.producer}</td>
        <td data-label={t('im.event')}><code>{r.event}</code></td>
        <td data-label={t('im.consumer')}><code>{r.consumer}</code>{r.wildcard ? <span className="muted small"> {t('im.wildcard')}</span> : null}</td>
        <td data-label={t('im.tests')} className="small">{r.testIds.length ? r.testIds.slice(0, 4).join(', ') + (r.testIds.length > 4 ? ` +${r.testIds.length - 4}` : '') : t('im.noTest')}</td>
        <td data-label={t('im.deliveries')} className="num">{t('im.deliveryFacts', { pub: n(r.published), ok: n(r.processed), pending: n(r.pending), dead: n(r.dead) })}</td>
        <td data-label={t('im.p95')} className="num">{r.latencyP95Ms == null ? '—' : `${n(r.latencyP95Ms)} ms`}</td>
        <td data-label={t('status')}><StatusBadge status={TONE[r.status]} label={t(`st.${r.status}`)} size="sm" /></td>
      </tr>)}</tbody>
      <tfoot className="sticky-total"><tr><th scope="row" colSpan={6}>{t('im.matrixTotal', { n: n(m.total), pass: n(d.totals.edgesPassed), fail: n(d.totals.edgesFailed) })}</th><td data-label={t('status')}>{d.totals.edgesFailed ? t('st.FAIL') : t('st.PASS')}</td></tr></tfoot>
    </table></div>
    <Pager page={page} pageSize={m.pageSize} total={m.total} onPage={(p) => go(BASE, { page: p })} t={t} testid="im-pager" />
  </>;
}

function Rekeying({ d, t, n }) {
  if (!d.rekeying.length) return <EmptyState title={t('im.noRekey')} message={t('im.noRekeyBody')} action={<button type="button" className="btn" onClick={() => go(BASE, { tab: '' })}>{t('im.tab.threads')}</button>} />;
  return <div className="table-scroll"><table className="data-table" data-testid="im-rekey">
    <thead><tr><th>{t('im.handoff')}</th><th>{t('im.record')}</th><th>{t('im.field')}</th><th>{t('im.typed')}</th><th>{t('im.source')}</th></tr></thead>
    <tbody>{d.rekeying.flatMap((r) => r.rows.map((x) => <tr key={`${r.handoff}|${x.id}|${x.field}`} data-testid="im-rekey-row">
      <td data-label={t('im.handoff')}><strong>{r.handoff}</strong> {r.label}</td><td data-label={t('im.record')}>{x.ref}</td><td data-label={t('im.field')}>{x.fieldLabel}</td>
      <td data-label={t('im.typed')}>{x.value}</td><td data-label={t('im.source')}>{x.source}</td></tr>))}</tbody>
    <tfoot className="sticky-total"><tr><th scope="row" colSpan={4}>{t('im.rekeyTotal')}</th><td data-label={t('im.rekeyTotal')}>{n(d.totals.rekeyed)}</td></tr></tfoot>
  </table></div>;
}

function Latency({ d, t, n, dateTime }) {
  const L = d.latency;
  const history = { categories: d.history.map((r) => r.runNo), series: [{ name: t('im.threadsPassed'), values: d.history.map((r) => r.totals?.threadsPassed ?? 0), drill: d.history.map((r) => `${BASE}?run=${r.id}`) }, { name: t('im.edgesFailing'), values: d.history.map((r) => r.totals?.edgesFailed ?? 0), drill: d.history.map((r) => `${BASE}?run=${r.id}&tab=matrix&status=FAIL`) }] };
  return <>
    <Card title={t('im.latencyTitle')} subtitle={t('im.latencyNote', { target: n(L.targetMs) })} testid="im-latency-card">
      {!d.probes.length ? <EmptyState compact title={t('im.noProbes')} message={t('im.noProbesBody')} /> : <div className="table-scroll"><table className="data-table" data-testid="im-probes">
        <thead><tr><th>{t('im.probeNo')}</th><th>{t('im.sentAt')}</th><th className="num">{t('im.busMs')}</th><th className="num">{t('im.realtimeMs')}</th><th className="num">{t('im.notifMs')}</th><th>{t('status')}</th></tr></thead>
        <tbody>{d.probes.map((p) => <tr key={p.id} data-testid="im-probe-row" data-status={p.status}><td data-label={t('im.probeNo')}>{p.probeNo}</td><td data-label={t('im.sentAt')}>{dateTime(p.sentAt)}</td><td data-label={t('im.busMs')} className="num">{n(p.busMs)}</td><td data-label={t('im.realtimeMs')} className="num">{n(p.realtimeMs)}</td><td data-label={t('im.notifMs')} className="num">{n(p.notificationMs)}</td><td data-label={t('status')}><StatusBadge status={TONE[p.status]} label={t(`st.${p.status}`)} size="sm" /></td></tr>)}</tbody>
        <tfoot className="sticky-total"><tr><th scope="row" colSpan={5}>{t('im.p95Of', { n: n(L.probes) })}</th><td data-label={t('im.p95')}>{L.p95Ms == null ? '—' : `${n(L.p95Ms)} ms`}</td></tr></tfoot>
      </table></div>}
    </Card>
    <Card title={t('im.history')} testid="im-history"><Chart type="line" data={history} title={t('im.history')} onDrill={(to) => navigateTo(to)} exportName="integration-runs" /></Card>
  </>;
}
