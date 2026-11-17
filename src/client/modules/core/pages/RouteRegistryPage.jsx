import { useState } from 'react';
import { formatDateTime, toCsv } from '../../../platform/format.js';
import { useRoutes, useSelfTest } from '../api/security.js';
import { Pager, QueryState, can, downloadCsv, errorInfo, usePageTitle } from './ui.jsx';
import PageHeader from '../../../platform/design/PageHeader.jsx';
import { KpiRow } from '../../../platform/design/Kpi.jsx';

const GUARD = { permission: ['chip-pass', 'Permission'], self: ['chip-not_applicable', 'Own account'], record: ['chip-not_applicable', 'Record rules'], public: ['chip-bad', 'Public'], infra: ['chip-never', 'Infrastructure'] };
const RESULT = { pass: ['chip-pass', 'Passed'], fail: ['chip-bad', 'Failed'], skipped: ['chip-never', 'Not applicable'] };

/** Every route of the application and how it is protected, with the result of its last test. */
export default function RouteRegistryPage({ session }) {
  usePageTitle('Route Registry');
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState({ module: '', guard: '', result: '', method: '' });
  const [notice, setNotice] = useState('');
  const [failures, setFailures] = useState([]);
  const list = useRoutes({ page, pageSize: 50, q, filters });
  const test = useSelfTest();
  const rows = list.data?.data ?? [];
  const s = list.data?.summary;
  const set = (name, value) => { setFilters((f) => ({ ...f, [name]: value })); setPage(1); };

  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Security &rsaquo; Route registry</nav>
      <PageHeader id="page-title" title={"Route Registry"} subtitle={"Every route of the application, with the permission it needs, what it is scoped by, its rate-limit class and the result of its last test. A route that is not declared here stops the application from starting in staging and production."} />
      <p role="status" className="notice" data-testid="route-notice">{notice}</p>
      {s && (
        <KpiRow data-testid="route-summary">
          <div className={`tile ${s.undeclared ? 'tile-bad' : 'tile-ok'}`}><span>Routes declared</span><strong>{s.declaredPct}%</strong><span className="muted small">{s.total} routes{s.undeclared ? `, ${s.undeclared} missing` : ''}</span></div>
          <div className="tile"><span>With a permission</span><strong>{s.permission}</strong></div>
          <div className="tile"><span>Own account or record rules</span><strong>{s.self + s.record}</strong></div>
          <div className="tile"><span>Public</span><strong>{s.public}</strong></div>
          <div className={`tile ${s.failed ? 'tile-bad' : s.passed ? 'tile-ok' : ''}`}><span>Last self-test</span><strong>{s.passed + s.failed ? `${s.passed} passed, ${s.failed} failed` : 'Not run'}</strong><span className="muted small">{s.testedAt ? formatDateTime(s.testedAt) : ''}</span></div>
        </KpiRow>
      )}
      <div className="toolbar">
        <label className="field field-inline"><span className="sr-only">Search routes</span><input type="search" placeholder="Search path or permission" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></label>
        <label className="field field-inline"><span className="sr-only">Module</span>
          <select aria-label="Module" value={filters.module} onChange={(e) => set('module', e.target.value)}><option value="">Module: any</option>{(list.data?.modules ?? []).map((m) => <option key={m.module} value={m.module}>{m.module} ({m.routes})</option>)}</select>
        </label>
        <label className="field field-inline"><span className="sr-only">Protection</span>
          <select aria-label="Protection" value={filters.guard} onChange={(e) => set('guard', e.target.value)}><option value="">Protection: any</option>{Object.entries(GUARD).map(([v, [, l]]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        <label className="field field-inline"><span className="sr-only">Method</span>
          <select aria-label="Method" value={filters.method} onChange={(e) => set('method', e.target.value)}><option value="">Method: any</option>{['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m} value={m}>{m}</option>)}</select>
        </label>
        <label className="field field-inline"><span className="sr-only">Last test</span>
          <select aria-label="Last test" value={filters.result} onChange={(e) => set('result', e.target.value)}><option value="">Last test: any</option>{Object.entries(RESULT).map(([v, [, l]]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        <button type="button" className="btn" disabled={rows.length === 0} onClick={() => downloadCsv('route-registry.csv', toCsv(['Method', 'Path', 'Module', 'Protection', 'Permission', 'Scope', 'Rate class', 'Public', 'Audited', 'Last test', 'Detail'], rows.map((r) => [r.method, r.path, r.module, r.guard, r.permission ?? '', r.scope, r.rateClass, r.public ? 'Yes' : 'No', r.audit ? 'Yes' : 'No', r.lastTestResult ?? '', r.lastTestDetail ?? ''])))}>Export CSV</button>
        {can(session, 'core.security.configure') && (
          <button type="button" className="btn btn-primary" disabled={test.isPending} onClick={async () => {
            setNotice(''); setFailures([]);
            try { const r = await test.mutateAsync(); setFailures(r.failures); setNotice(`Tested ${r.tested} routes: ${r.passed} passed, ${r.failed} failed; ${r.skipped} need no test.`); } catch (err) { setNotice(errorInfo(err).form); }
          }}>{test.isPending ? 'Testing...' : 'Run the self-test'}</button>
        )}
      </div>
      {failures.length > 0 && <ul className="field-error" role="alert">{failures.map((f) => <li key={`${f.method}${f.path}`}>{f.method} {f.path}: {f.detail}</li>)}</ul>}
      <QueryState query={list} what="the routes" permission="core.routes.view" />
      {list.data && rows.length === 0 && <div className="state"><h2>No routes</h2><p>Nothing matches those filters.</p></div>}
      {rows.length > 0 && (
        <>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Routes</caption>
              <thead><tr><th>Method</th><th>Path</th><th>Protection</th><th>Permission</th><th>Scope</th><th>Rate class</th><th>Audited</th><th>Last test</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.method} ${r.path}`} data-testid={`route-${r.method}-${r.path}`}>
                    <td data-label="Method"><code>{r.method}</code></td>
                    <td data-label="Path"><code>{r.path}</code></td>
                    <td data-label="Protection"><span className={`chip ${GUARD[r.guard][0]}`}>{GUARD[r.guard][1]}</span></td>
                    <td data-label="Permission">{r.permission ? <code>{r.permission}</code> : <span className="muted">none needed</span>}</td>
                    <td data-label="Scope">{r.scope}</td>
                    <td data-label="Rate class">{r.rateClass}</td>
                    <td data-label="Audited">{r.audit ? 'Yes' : 'No'}</td>
                    <td data-label="Last test">{r.lastTestResult ? <span className={`chip ${RESULT[r.lastTestResult][0]}`} title={r.lastTestDetail ?? ''}>{RESULT[r.lastTestResult][1]}</span> : <span className="muted">Not run</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager meta={list.data.meta} page={page} setPage={setPage} noun="routes" />
        </>
      )}
    </section>
  );
}
