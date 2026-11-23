import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Chart from '../../platform/charts/Chart.jsx';
import { Card, CardGrid } from '../../platform/design/Card.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { useFormat, useT } from '../../platform/i18n/index.js';
import { Field, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from '../eng/common.js';
import { COLOUR, Pager, ParamPanel, PillTabs, TONE, download, go, post, qs, read } from './common.jsx';

// Part 30.04: Test Coverage & Results (technical console, report pattern) and, on its second tab, the sandbox configuration: reset and
// scenario packs. The chart comes first (tests by type and their last result), then the key figures, the coverage by part (gaps first on
// request), workflow and permission coverage, the runs, and the tests themselves as a list (cards on a phone, parameters in a bottom sheet,
// a sticky total). The sandbox tab shows whether this installation is a sandbox, what it blocked, the synthetic companies, the packs with
// their expected and last actual KPI values, and the runs.
const BASE = '/admin/test-coverage';
const TYPES = ['UNIT', 'API', 'WORKFLOW', 'PERMISSION', 'E2E', 'VISUAL', 'ACCESSIBILITY', 'PERFORMANCE', 'SECURITY', 'INTEGRATION', 'DATA'];

export function TestCoverage() {
  const t = useT('tst');
  usePageTitle(t('tc.title'));
  const search = useSearch();
  const tab = search.get('tab') === 'sandbox' ? 'sandbox' : 'coverage';
  const params = { part: search.get('part') ?? '', type: search.get('type') ?? '', result: search.get('result') ?? '', q: search.get('q') ?? '', gaps: search.get('gaps') ?? '', page: search.get('page') ?? '' };
  const q = useQuery({ queryKey: ['tst', 'tests', params], queryFn: () => read(`/tst/tests${qs(params)}`), retry: false, placeholderData: (p) => p });
  if (q.error?.status === 403) return <NoPermission what={t('tc.noPermission')} permission="tst.catalogue.view" />;
  if (q.isPending) return <section><PageHeader title={t('tc.title')} /><Skeleton label={t('tc.title')} rows={8} /></section>;
  if (q.error) return <section><PageHeader title={t('tc.title')} /><ErrorState error={q.error} onRetry={q.refetch} /></section>;
  const d = q.data;
  const tabs = [['coverage', t('tc.tabCoverage')], ...(d.can.sandbox ? [['sandbox', t('tc.tabSandbox')]] : [])];
  return <section aria-labelledby="tc-h" data-testid="tst-coverage" data-tab={tab}>
    {tab === 'sandbox' && d.can.sandbox ? <Sandbox t={t} tabs={tabs} /> : <Coverage t={t} d={d} params={params} tabs={tabs} />}
  </section>;
}

function Coverage({ t, d, params, tabs }) {
  const { number, dateTime } = useFormat();
  const cache = useQueryClient();
  const [text, setText] = useState(params.q);
  const n = (v) => (v == null ? '—' : number(String(v), { decimals: 0 }));
  const sync = useMutation({ mutationFn: () => post('/tst/tests/sync'), onSuccess: () => cache.invalidateQueries({ queryKey: ['tst', 'tests'] }) });
  const exp = useMutation({ mutationFn: (f) => download('/tst/tests/export', { part: params.part, type: params.type, result: params.result, q: params.q, format: f }, `test-catalogue.${f}`) });
  const set = (patch) => go(BASE, { ...patch, page: patch.page ?? '' });
  const T = d.totals;
  const verdict = T.tests === 0 ? 'NOT_TESTED' : T.suiteGreen ? 'PASS' : 'FAIL';
  const actions = d.can.sync ? <button type="button" className="btn btn-primary" onClick={() => sync.mutate()} disabled={sync.isPending} data-testid="tc-sync">{sync.isPending ? t('running') : t('tc.sync')}</button> : null;
  const menu = ['xlsx', 'csv', 'pdf'].map((f) => ({ label: t('exportAs', { f: f.toUpperCase() }), testid: `tc-export-${f}`, onClick: () => exp.mutate(f) }));
  const header = <PageHeader id="tc-h" title={t('tc.title')} subtitle={t('tc.subtitle')} actions={actions} menu={T.tests ? menu : []}
    status={<StatusBadge status={TONE[verdict]} label={t(`tc.verdict.${verdict}`)} variant="solid" />} />;
  if (!T.tests) return <>{header}<PillTabs label={t('tc.title')} tabs={tabs} value="coverage" onChange={(k) => go(BASE, { tab: k === 'sandbox' ? 'sandbox' : '' })} testid="tc-tabs" />
    {sync.error && <ErrorState error={sync.error} />}
    <EmptyState title={t('tc.none')} message={t('tc.noneBody')} action={actions} /></>;
  const chart = { categories: d.byType.map((x) => x.type), series: [
    { name: t('st.PASS'), colour: COLOUR.PASS, values: d.byType.map((x) => x.passed ?? 0), drill: d.byType.map((x) => `${BASE}?type=${x.type}&result=PASS`) },
    { name: t('st.FAIL'), colour: COLOUR.FAIL, values: d.byType.map((x) => x.failed ?? 0), drill: d.byType.map((x) => `${BASE}?type=${x.type}&result=FAIL`) },
    { name: t('tc.notRun'), colour: COLOUR.OTHER, values: d.byType.map((x) => x.tests - (x.passed ?? 0) - (x.failed ?? 0)), drill: d.byType.map((x) => `${BASE}?type=${x.type}&result=NOT_RUN`) },
  ] };
  const parts = params.gaps ? d.parts : [...d.parts].sort((a, b) => Number(b.gap) - Number(a.gap) || b.failed - a.failed || a.partId.localeCompare(b.partId, 'en', { numeric: true }));
  const P = d.permission; const W = d.workflow;
  return <>
    {header}
    <PillTabs label={t('tc.title')} tabs={tabs} value="coverage" onChange={(k) => go(BASE, { tab: k === 'sandbox' ? 'sandbox' : '' })} testid="tc-tabs" />
    {(sync.error || exp.error) && <ErrorState error={sync.error ?? exp.error} />}
    {sync.data && <p className="muted small" role="status" data-testid="tc-synced">{t('tc.synced', { added: n(sync.data.added), updated: n(sync.data.updated), retired: n(sync.data.retired), tests: n(sync.data.tests) })}</p>}
    <Card title={t('tc.byType')} testid="tc-chart"><Chart type="stacked" data={chart} title={t('tc.byType')} onDrill={(to) => navigateTo(to)} exportName="tests-by-type" /></Card>
    <KpiRow testid="tc-tiles" label={t('tc.title')}>
      <KpiTile testid="tc-tests" label={t('tc.tests')} kind="count" value={n(T.tests)} to={BASE}>{t('tc.testsOf', { files: n(T.files), traced: n(T.traced) })}</KpiTile>
      <KpiTile testid="tc-failed" label={t('st.FAIL')} kind="risk" value={n(T.failed)} tone={T.failed ? 'error' : 'success'} to={`${BASE}?result=FAIL`} />
      <KpiTile testid="tc-notrun" label={t('tc.notRun')} kind="count" value={n(T.notRun)} tone={T.notRun ? 'warning' : 'success'} to={`${BASE}?result=NOT_RUN`} />
      <KpiTile testid="tc-parts" label={t('tc.partCoverage')} kind="quality" value={`${T.partCoveragePct}`} unit="%" tone={T.partCoveragePct >= 100 ? 'success' : 'warning'} to={`${BASE}?gaps=1#parts`}>{t('tc.partsOf', { covered: n(T.partsCovered), delivered: n(T.delivered) })}</KpiTile>
      <KpiTile testid="tc-workflow" label={t('tc.workflow')} kind="quality" value={`${W.pct}`} unit="%" tone={W.pct >= 100 ? 'success' : 'warning'} to={`${BASE}#workflow`}>{t('tc.workflowOf', { types: n(W.types), named: n(W.named) })}</KpiTile>
      <KpiTile testid="tc-permission" label={t('tc.permission')} kind="count" value={n(P.roleMatrixCells)} to={`${BASE}#permission`}>{t('tc.permissionOf', { roles: n(P.roles), endpoints: n(P.keyEndpoints) })}</KpiTile>
    </KpiRow>
    <CardGrid>
      <Card title={t('tc.workflowTitle')} testid="tc-workflow-card"><span id="workflow" />
        <p>{t('tc.workflowBody', { types: n(W.types), contract: n(W.contract), named: n(W.named) })}</p>
        <p className="small muted">{t('tc.workflowHow')}</p>
      </Card>
      <Card title={t('tc.permissionTitle')} testid="tc-permission-card"><span id="permission" />
        <p>{t('tc.permissionBody', { roles: n(P.roles), endpoints: n(P.keyEndpoints), cells: n(P.roleMatrixCells), routes: n(P.guardedRoutes) })}</p>
        <ul className="lp-list small">
          <li>{t('tc.roleMatrix')}: {P.matrixTest ? <StatusBadge status={TONE[P.roleMatrix?.at ? (P.roleMatrix.ok ? 'PASS' : 'FAIL') : 'NOT_TESTED']} label={P.roleMatrix?.at ? t(`st.${P.roleMatrix.ok ? 'PASS' : 'FAIL'}`) : t('tc.notRun')} size="sm" /> : t('tc.missing')}</li>
          <li>{t('tc.authzMatrix')}: {P.authzTest ? <StatusBadge status={TONE[P.authzMatrix?.at ? (P.authzMatrix.ok ? 'PASS' : 'FAIL') : 'NOT_TESTED']} label={P.authzMatrix?.at ? t(`st.${P.authzMatrix.ok ? 'PASS' : 'FAIL'}`) : t('tc.notRun')} size="sm" /> : t('tc.missing')}</li>
        </ul>
      </Card>
      <Card title={t('tc.runs')} testid="tc-runs">
        {!d.runs.length ? <EmptyState compact title={t('tc.noRuns')} message={t('tc.noRunsBody')} /> : <ul className="lp-list">{d.runs.slice(0, 6).map((r) => <li key={r.id} data-testid="tc-run" data-status={r.status}>
          <StatusBadge status={TONE[r.status === 'DONE' ? 'PASS' : 'FAIL']} label={r.runNo} size="sm" /> {t('tc.runFacts', { source: r.source, suite: r.suite, total: n(r.total), passed: n(r.passed), failed: n(r.failed) })} <span className="muted small">{dateTime(r.startedAt)}{r.commitRef ? ` · ${r.commitRef.slice(0, 7)}` : ''}</span></li>)}</ul>}
      </Card>
    </CardGrid>
    <Card title={t('tc.parts')} subtitle={params.gaps ? t('tc.gapsOnly') : t('tc.partsNote')} testid="tc-parts-card"><span id="parts" />
      <div className="actions-row"><button type="button" className={`btn btn-small${params.gaps ? ' btn-primary' : ''}`} onClick={() => set({ gaps: params.gaps ? '' : '1' })} data-testid="tc-gaps">{t('tc.showGaps')}</button></div>
      {!parts.length ? <EmptyState compact title={t('tc.noGaps')} message={t('tc.noGapsBody')} /> : <div className="table-scroll"><table className="data-table" data-testid="tc-parts-table">
        <thead><tr><th>{t('tc.part')}</th><th>{t('tc.partTitle')}</th><th>{t('status')}</th><th className="num">{t('tc.tests')}</th><th className="num">{t('tc.requirements')}</th><th className="num">{t('st.PASS')}</th><th className="num">{t('st.FAIL')}</th></tr></thead>
        <tbody>{parts.slice(0, params.gaps ? 500 : 40).map((p) => <tr key={p.partId} data-testid="tc-part" data-gap={p.gap ? '1' : '0'}>
          <td data-label={t('tc.part')}><a href={`${BASE}?part=${p.partId}#tests`} onClick={(e) => { e.preventDefault(); set({ part: p.partId }); }}>{p.partId}</a></td>
          <td data-label={t('tc.partTitle')}>{p.title}</td>
          <td data-label={t('status')}>{p.gap ? <StatusBadge status="REJECTED" label={t('tc.gap')} size="sm" /> : <span className="small">{p.status}</span>}</td>
          <td data-label={t('tc.tests')} className="num">{n(p.tests)}</td><td data-label={t('tc.requirements')} className="num">{n(p.requirements)}</td>
          <td data-label={t('st.PASS')} className="num">{n(p.passed)}</td><td data-label={t('st.FAIL')} className="num">{n(p.failed)}</td>
        </tr>)}</tbody>
        <tfoot className="sticky-total"><tr><th scope="row" colSpan={3}>{t('tc.partsTotal', { parts: n(T.parts), delivered: n(T.delivered), covered: n(T.partsCovered) })}</th><td className="num" data-label={t('tc.tests')}>{n(T.tests - T.unassigned)}</td><td colSpan={3} className="small muted" data-label={t('tc.unassigned')}>{t('tc.unassignedN', { n: n(T.unassigned) })}</td></tr></tfoot>
      </table></div>}
    </Card>
    <Card title={t('tc.testsTitle')} subtitle={params.part ? t('tc.ofPart', { part: params.part }) : t('tc.allTests')} testid="tc-tests-card"><span id="tests" />
      <ParamPanel label={t('params')} done={t('done')} count={[params.part, params.type, params.result, params.q].filter(Boolean).length} testid="tc-params">
        <Field name="tc-part" label={t('tc.part')}><input value={params.part} placeholder="30.04" onChange={(e) => { const v = e.target.value.trim(); if (!v || /^(\d{2}\.\d{2}|166\.\d)$/.test(v)) set({ part: v }); }} data-testid="tc-f-part" /></Field>
        <Field name="tc-type" label={t('tc.type')}><select value={params.type} onChange={(e) => set({ type: e.target.value })} data-testid="tc-f-type"><option value="">{t('all')}</option>{TYPES.map((x) => <option key={x} value={x}>{t(`tc.ty.${x}`)}</option>)}</select></Field>
        <Field name="tc-result" label={t('tc.result')}><select value={params.result} onChange={(e) => set({ result: e.target.value })} data-testid="tc-f-result"><option value="">{t('all')}</option>{['PASS', 'FAIL', 'SKIP', 'NOT_RUN'].map((x) => <option key={x} value={x}>{x === 'NOT_RUN' ? t('tc.notRun') : t(`st.${x}`)}</option>)}</select></Field>
        <Field name="tc-q" label={t('search')}><input type="search" inputMode="search" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') set({ q: text.trim().length >= 2 ? text.trim() : '' }); }} data-testid="tc-f-q" /></Field>
      </ParamPanel>
      {!d.tests.rows.length ? <EmptyState compact title={t('tc.noTests')} message={t('tc.noTestsBody')} /> : <>
        <div className="table-scroll"><table className="data-table" data-testid="tc-test-table">
          <thead><tr><th>{t('tc.test')}</th><th>{t('tc.part')}</th><th>{t('tc.refs')}</th><th>{t('tc.type')}</th><th>{t('tc.result')}</th></tr></thead>
          <tbody>{d.tests.rows.map((x) => <tr key={x.id} data-testid="tc-test" data-result={x.lastResult ?? 'NOT_RUN'}>
            <td data-label={t('tc.test')}>{x.name}<br /><code className="small">{x.file}</code>{!x.automated && <span className="muted small"> · {t('tc.manual')}</span>}</td>
            <td data-label={t('tc.part')}>{x.partId ?? '—'}</td><td data-label={t('tc.refs')} className="small">{x.requirementRef ?? '—'}</td>
            <td data-label={t('tc.type')}>{t(`tc.ty.${x.type}`)}</td>
            <td data-label={t('tc.result')}><StatusBadge status={TONE[x.lastResult ?? 'NOT_TESTED'] ?? 'CANCELLED'} label={x.lastResult ? t(`st.${x.lastResult}`) : t('tc.notRun')} size="sm" />{x.lastRunAt ? <><br /><span className="muted small">{dateTime(x.lastRunAt)}</span></> : null}</td>
          </tr>)}</tbody>
          <tfoot className="sticky-total"><tr><th scope="row" colSpan={4}>{t('tc.testsTotal', { n: n(d.tests.total) })}</th><td data-label={t('tc.result')}>{t('tc.passFail', { pass: n(T.passed), fail: n(T.failed) })}</td></tr></tfoot>
        </table></div>
        <Pager page={d.tests.page} pageSize={d.tests.pageSize} total={d.tests.total} onPage={(p) => set({ page: p })} t={t} testid="tc-pager" />
      </>}
    </Card>
  </>;
}

function Sandbox({ t, tabs }) {
  const { number, dateTime } = useFormat();
  const cache = useQueryClient();
  const n = (v) => (v == null ? '—' : number(String(v), { decimals: 0 }));
  const q = useQuery({ queryKey: ['tst', 'sandbox'], queryFn: () => read('/tst/sandbox'), retry: false });
  const refresh = () => cache.invalidateQueries({ queryKey: ['tst', 'sandbox'] });
  const gen = useMutation({ mutationFn: () => post('/tst/sandbox/generate', { months: 12 }), onSuccess: refresh });
  const reset = useMutation({ mutationFn: () => post('/tst/sandbox/reset', { confirm: 'RESET' }), onSuccess: refresh });
  const run = useMutation({ mutationFn: (pack) => post('/tst/sandbox/scenarios', { pack }), onSuccess: refresh });
  const [confirm, setConfirm] = useState(false);
  const header = <PageHeader id="tc-h" title={t('tc.title')} subtitle={t('sb.subtitle')} status={q.data ? <StatusBadge status={q.data.sandbox ? 'AT_RISK' : 'CANCELLED'} label={q.data.sandbox ? t('sb.isSandbox') : t('sb.notSandbox')} variant="solid" /> : null} />;
  const tabBar = <PillTabs label={t('tc.title')} tabs={tabs} value="sandbox" onChange={(k) => go(BASE, { tab: k === 'sandbox' ? 'sandbox' : '' })} testid="tc-tabs" />;
  if (q.error?.status === 403) return <>{header}{tabBar}<NoPermission what={t('sb.noPermission')} permission="tst.sandbox.view" /></>;
  if (q.isPending) return <>{header}{tabBar}<Skeleton label={t('tc.tabSandbox')} rows={6} /></>;
  if (q.error) return <>{header}{tabBar}<ErrorState error={q.error} onRetry={q.refetch} /></>;
  const s = q.data; const busy = gen.isPending || reset.isPending || run.isPending; const manage = s.can.manage && s.sandbox;
  const err = gen.error ?? reset.error ?? run.error;
  if (!s.sandbox) return <>{header}{tabBar}<EmptyState title={t('sb.notSandbox')} message={t('sb.notSandboxBody')} /></>;
  const last = gen.data ?? reset.data ?? run.data;
  return <div data-testid="tc-sandbox">
    {header}{tabBar}
    {err && <ErrorState error={err} />}
    {last && <p role="status" className="small" data-testid="sb-last" data-status={last.status} data-result={last.result ?? ''}>{t('sb.lastRun', { run: last.runNo, kind: t(`sb.kind.${last.kind}`), status: last.status })}{last.error ? ` — ${last.error}` : ''}</p>}
    <KpiRow testid="sb-tiles" label={t('tc.tabSandbox')}>
      <KpiTile label={t('sb.companies')} kind="count" value={n(s.companies.length)} />
      <KpiTile testid="sb-blocked" label={t('sb.blocked')} kind="count" value={n((s.blocked?.http ?? 0) + (s.blocked?.webhooks ?? 0) + (s.blocked?.push ?? 0))} tone="success">{t('sb.blockedOf', { http: n(s.blocked?.http), webhooks: n(s.blocked?.webhooks) })}</KpiTile>
      <KpiTile label={t('sb.database')} kind="count" value={s.database ?? '—'} />
    </KpiRow>
    {!s.runnerReady && <p className="muted small">{t('sb.runnerNotReady')}</p>}
    <CardGrid testid="sb-packs">
      {s.packs.map((p) => <Card key={p.code} title={t(`sb.pack.${p.code}`)} subtitle={t(`sb.check.${p.code}`)} testid="sb-pack"
        menu={p.last ? <StatusBadge status={TONE[p.last.result ?? 'FAIL']} label={t(`st.${p.last.result ?? 'FAIL'}`)} size="sm" /> : null}>
        <table className="data-table compact" data-testid="sb-kpis" data-pack={p.code} data-result={p.last?.result ?? ''}>
          <thead><tr><th>{t('sb.kpi')}</th><th className="num">{t('rh.expected')}</th><th className="num">{t('rh.actual')}</th></tr></thead>
          <tbody>{Object.entries(p.expected).map(([k, v]) => <tr key={k}><td data-label={t('sb.kpi')}>{t(`sb.k.${k}`)}</td><td className="num" data-label={t('rh.expected')}>{String(v)}</td><td className="num" data-label={t('rh.actual')}>{p.last?.actual?.[k] == null ? '—' : String(p.last.actual[k])}</td></tr>)}</tbody>
        </table>
        {manage && <p><button type="button" className="btn" disabled={busy || !s.runnerReady} onClick={() => run.mutate(p.code)} data-testid={`sb-run-${p.code}`}>{run.isPending && run.variables === p.code ? t('running') : t('sb.run')}</button></p>}
      </Card>)}
    </CardGrid>
    <CardGrid>
      <Card title={t('sb.data')} testid="sb-data">
        {!s.companies.length ? <EmptyState compact title={t('sb.noCompanies')} message={t('sb.noCompaniesBody')} /> : <ul className="lp-list">{s.companies.map((c) => <li key={c.id} data-testid="sb-company"><strong>{c.code}</strong> {c.name} · {t('sb.companyFacts', { projects: n(c.projects), users: n(c.users) })}</li>)}</ul>}
        {manage && <div className="actions-row">
          <button type="button" className="btn" disabled={busy || !s.runnerReady} onClick={() => gen.mutate()} data-testid="sb-generate">{gen.isPending ? t('running') : t('sb.generate')}</button>
          {!confirm ? <button type="button" className="btn btn-danger" disabled={busy || !s.runnerReady} onClick={() => setConfirm(true)} data-testid="sb-reset">{t('sb.reset')}</button>
            : <><span className="small">{t('sb.resetConfirm')}</span><button type="button" className="btn btn-danger" onClick={() => { setConfirm(false); reset.mutate(); }} data-testid="sb-reset-confirm">{reset.isPending ? t('running') : t('sb.resetYes')}</button><button type="button" className="btn" onClick={() => setConfirm(false)}>{t('cancel')}</button></>}
        </div>}
      </Card>
      <Card title={t('sb.isolation')} testid="sb-isolation">
        <p className="small">{t('sb.isolationBody')}</p>
        {s.lastBlocked.length ? <ul className="lp-list small">{s.lastBlocked.map((b, i) => <li key={i}>{b.kind}: {b.target} <span className="muted">{dateTime(b.at)}</span></li>)}</ul> : <p className="muted small">{t('sb.nothingBlocked')}</p>}
      </Card>
    </CardGrid>
    <Card title={t('sb.runs')} testid="sb-runs">
      {!s.runs.length ? <EmptyState compact title={t('sb.noRuns')} message={t('sb.noRunsBody')} /> : <div className="table-scroll"><table className="data-table" data-testid="sb-run-table">
        <thead><tr><th>{t('sb.runNo')}</th><th>{t('sb.kindH')}</th><th>{t('status')}</th><th>{t('sb.by')}</th><th>{t('sb.at')}</th></tr></thead>
        <tbody>{s.runs.map((r) => <tr key={r.id} data-testid="sb-run" data-kind={r.kind} data-result={r.result ?? ''}>
          <td data-label={t('sb.runNo')}>{r.runNo}</td><td data-label={t('sb.kindH')}>{t(`sb.kind.${r.kind}`)}{r.pack ? ` · ${t(`sb.pack.${r.pack}`)}` : ''}</td>
          <td data-label={t('status')}><StatusBadge status={TONE[r.result ?? (r.status === 'DONE' ? 'PASS' : r.status === 'FAILED' ? 'FAIL' : 'RUNNING')]} label={r.result ? t(`st.${r.result}`) : r.status} size="sm" />{r.error ? <><br /><span className="small muted">{r.error}</span></> : null}</td>
          <td data-label={t('sb.by')}>{r.requestedBy}</td><td data-label={t('sb.at')}>{dateTime(r.startedAt)}</td>
        </tr>)}</tbody>
        <tfoot className="sticky-total"><tr><th scope="row" colSpan={5}>{t('sb.runsTotal', { n: n(s.runs.length) })}</th></tr></tfoot>
      </table></div>}
    </Card>
  </div>;
}
