import { useState } from 'react';
import { toCsv } from '../../../platform/format.js';
import { Pager, QueryState, downloadCsv, usePageTitle } from '../../core/pages/ui.jsx';
import { useLegacyComparison } from '../api/access.js';
import PageHeader from '../../../platform/design/PageHeader.jsx';
import { KpiRow } from '../../../platform/design/Kpi.jsx';

const RESULT = {
  SAME: ['Same', 'chip-pass', 'Exactly the access they had before'],
  NEW_ONLY: ['New permissions only', 'chip-pass', 'The same as before, plus the role and assignment permissions this part adds'],
  LOST: ['Lost access', 'chip-fail', 'Had access before that the role engine no longer gives: fix before going live'],
  GAINED: ['Gained access', 'chip-fail', 'Has access the role did not give before: fix before going live'],
  UNMAPPED: ['Role not mapped', 'chip-not_applicable', 'Holds a role the engine does not know; it grants nothing now, as before'],
};

/** Legacy Access Comparison: for every user, the access before the role engine and now, with every difference classed. */
export default function LegacyAccessPage() {
  usePageTitle('Legacy Access Comparison');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [q, setQ] = useState('');
  const [result, setResult] = useState('');
  const query = useLegacyComparison({ page, pageSize, q, filters: { result } });
  const d = query.data;
  const rows = d?.data ?? [];

  const exportCsv = () => downloadCsv('legacy-access-comparison.csv', toCsv(['User', 'Name', 'Roles', 'Permissions before', 'Permissions now', 'Result', 'Lost', 'Gained', 'New only'], rows.map((r) => [r.username, r.displayName, r.roles.join(' '), r.before, r.after, RESULT[r.result][0], r.lost.join(' '), r.gained.join(' '), r.newOnly.join(' ')])));

  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Legacy Access Comparison</nav>
      <PageHeader id="page-title" title={"Legacy Access Comparison"} subtitle={"Before the role engine, access came from a fixed table of nine roles. This compares what each user could do then with what the engine gives them now, so nobody gains or loses access by accident."} />
      <QueryState query={query} what="the comparison" permission="iam.role.view" />
      {d && (
        <>
          <p role="status" className={`notice${d.clean ? '' : ' field-error'}`} data-testid="legacy-verdict">{d.clean ? 'Clean: nobody lost access and nobody gained any that is not new to the role engine.' : `Not clean: ${d.summary.lost} user(s) lost access and ${d.summary.gained} gained access they did not have. Review them below.`}</p>
          <KpiRow>
            {[['Users', d.summary.users], ['Same', d.summary.same], ['New permissions only', d.summary.newOnly], ['Lost access', d.summary.lost], ['Gained access', d.summary.gained], ['Role not mapped', d.summary.unmapped]].map(([l, v]) => <div key={l} className="tile"><span className="tile-value" data-testid={`legacy-${l.toLowerCase().replace(/ /g, '-')}`}>{v}</span><span className="tile-label">{l}</span></div>)}
          </KpiRow>
          <h2>Where each old role went</h2>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Mapping of the roles that existed before to the system roles</caption>
              <thead><tr><th>Old role</th><th>Now</th><th>How</th><th>Notes</th></tr></thead>
              <tbody>{d.mapping.map((m) => <tr key={m.legacyRole}><td data-label="Old role"><code>{m.legacyRole}</code></td><td data-label="Now">{m.roleCode} {m.roleName}</td><td data-label="How">{m.mappingType === 'ALIAS' ? 'Same role, same code' : m.mappingType}</td><td data-label="Notes">{m.notes}</td></tr>)}</tbody>
            </table>
          </div>
          <h2>Users</h2>
          <div className="toolbar">
            <label className="field field-inline"><span className="sr-only">Search users</span><input type="search" placeholder="Search users" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></label>
            <label className="field field-inline"><span className="sr-only">Result</span>
              <select aria-label="Result" value={result} onChange={(e) => { setResult(e.target.value); setPage(1); }}><option value="">Result: any</option>{Object.entries(RESULT).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
            </label>
            <label className="field field-inline"><span className="sr-only">Rows per page</span>
              <select aria-label="Rows per page" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>{[25, 50, 100].map((n) => <option key={n} value={n}>{n} per page</option>)}</select>
            </label>
            <button type="button" className="btn" disabled={rows.length === 0} onClick={exportCsv}>Export CSV</button>
          </div>
          {rows.length === 0 && <div className="state"><h2>No users</h2><p>Nobody matches those filters.</p></div>}
          {rows.length > 0 && (
            <>
              <div className="table-wrap">
                <table>
                  <caption className="sr-only">Access before and now, per user</caption>
                  <thead><tr><th>User</th><th>Roles</th><th>Before</th><th>Now</th><th>Result</th><th>Differences</th></tr></thead>
                  <tbody>
                    {rows.map((r) => {
                      const [label, cls, hint] = RESULT[r.result];
                      return (
                        <tr key={r.userId} data-testid={`legacy-row-${r.username}`}>
                          <td data-label="User">{r.displayName} <span className="muted">({r.username})</span></td>
                          <td data-label="Roles">{r.roles.length ? r.roles.join(', ') : 'None'}</td>
                          <td data-label="Before">{r.before}</td>
                          <td data-label="Now">{r.after}</td>
                          <td data-label="Result"><span className={`chip ${cls}`} title={hint}>{label}</span></td>
                          <td data-label="Differences">
                            {r.lost.length > 0 && <div>Lost: {r.lost.join(', ')}</div>}
                            {r.gained.length > 0 && <div>Gained: {r.gained.join(', ')}</div>}
                            {r.newOnly.length > 0 && <div className="muted small">New: {r.newOnly.join(', ')}</div>}
                            {r.unmapped.length > 0 && <div>Not mapped: {r.unmapped.join(', ')}</div>}
                            {!r.lost.length && !r.gained.length && !r.newOnly.length && !r.unmapped.length && <span className="muted">None</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pager meta={d.meta} page={page} setPage={setPage} noun="users" />
            </>
          )}
        </>
      )}
    </section>
  );
}
