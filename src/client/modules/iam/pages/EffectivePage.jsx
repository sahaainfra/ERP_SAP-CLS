import { useMemo, useState } from 'react';
import { toCsv } from '../../../platform/format.js';
import { Field, QueryState, downloadCsv, usePageTitle } from '../../core/pages/ui.jsx';
import { useEffective } from '../api/access.js';
import { useUsers } from '../api/users.js';
import PageHeader from '../../../platform/design/PageHeader.jsx';
import { KpiRow } from '../../../platform/design/Kpi.jsx';

const where = (s) => (s.scopeType === 'COMPANY' ? 'whole company' : s.scopeType === 'OWN' ? 'own records' : `${s.scopeType.toLowerCase()} ${s.scopeIds.join(', ')}`);

/** Effective Permissions: pick a person (and perhaps a record), see what they may do and which grant decides it. */
export default function EffectivePage() {
  usePageTitle('Effective Permissions');
  const params = new URLSearchParams(window.location.search);
  const users = useUsers({ pageSize: 200, sort: 'displayName' });
  const [userId, setUserId] = useState(params.get('userId') ?? '');
  const [recordType, setRecordType] = useState('');
  const [recordId, setRecordId] = useState('');
  const [show, setShow] = useState('all');
  const [q, setQ] = useState('');
  const query = useEffective({ userId: userId ? Number(userId) : null, recordType: recordType && recordId ? recordType : null, recordId: recordType && recordId ? Number(recordId) : null });
  const d = query.data;
  const rows = useMemo(() => (d?.permissions ?? []).filter((p) => (show === 'all' || (show === 'allowed') === p.allowed) && (!q || p.key.includes(q.toLowerCase()) || p.description.toLowerCase().includes(q.toLowerCase()))), [d, show, q]);
  const allowed = d?.permissions.filter((p) => p.allowed).length ?? 0;

  const exportCsv = () => downloadCsv('effective-permissions.csv', toCsv(['Permission', 'Result', 'Why', 'Granted by'], rows.map((p) => [p.key, p.allowed ? 'Allowed' : 'Refused', p.reason, p.sources.map((s) => `${s.effect} ${s.role} (${where(s)})`).join('; ')])));

  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Effective Permissions</nav>
      <PageHeader id="page-title" title={"Effective Permissions"} subtitle={"Why can, or can't, this person do something? Every permission is shown with the roles that grant or deny it and the part of the company they apply to. Name a record to test the answer against that record."} />
      <div className="toolbar" role="group" aria-label="Who and what">
        <label className="field field-inline"><span className="sr-only">Person</span>
          <select aria-label="Person" value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Choose a person...</option>
            {(users.data?.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.displayName} ({u.username})</option>)}
          </select>
        </label>
        <label className="field field-inline"><span className="sr-only">Record type</span>
          <select aria-label="Record type" value={recordType} onChange={(e) => setRecordType(e.target.value)}>
            <option value="">Any record (no record)</option>
            {(d?.recordTypes ?? ['project', 'site', 'department', 'user']).map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        {recordType && <label className="field field-inline"><span className="sr-only">Record number</span><input aria-label="Record number" type="number" min="1" placeholder="Record number" value={recordId} onChange={(e) => setRecordId(e.target.value)} /></label>}
      </div>
      {!userId && <div className="state"><h2>Choose a person</h2><p>The permissions they hold, and why, appear here.</p></div>}
      {userId && <QueryState query={query} what="the effective permissions" permission="iam.role.view" />}
      {d && (
        <>
          <KpiRow>
            <div className="tile"><span className="tile-value" data-testid="eff-allowed">{allowed}</span><span className="tile-label">Allowed{d.record ? ' on this record' : ''}</span></div>
            <div className="tile"><span className="tile-value">{d.permissions.length - allowed}</span><span className="tile-label">Refused</span></div>
            <div className="tile"><span className="tile-value">{d.holdings.length}</span><span className="tile-label">Roles held</span></div>
            <div className="tile"><span className="tile-value">{d.clearance}</span><span className="tile-label">Highest confidentiality read</span></div>
          </KpiRow>
          <div className="card">
            <h2>{d.user.displayName} holds</h2>
            {d.holdings.length === 0 ? <p className="muted">No role: this person has no access beyond their own profile.</p> : <ul>{d.holdings.map((h, i) => <li key={i}><strong>{h.role}</strong> {h.roleName} for {where(h)} <span className="muted">({h.via})</span></li>)}</ul>}
            {d.record && <p>Tested against: <strong data-testid="eff-record">{d.record.label}</strong>{d.record.projectId ? ` (project ${d.record.projectId})` : ''}</p>}
          </div>
          <div className="toolbar">
            <label className="field field-inline"><span className="sr-only">Search permissions</span><input type="search" placeholder="Search permissions" value={q} onChange={(e) => setQ(e.target.value)} /></label>
            <label className="field field-inline"><span className="sr-only">Show</span>
              <select aria-label="Show" value={show} onChange={(e) => setShow(e.target.value)}><option value="all">Show all</option><option value="allowed">Allowed only</option><option value="refused">Refused only</option></select>
            </label>
            <button type="button" className="btn" disabled={rows.length === 0} onClick={exportCsv}>Export CSV</button>
          </div>
          {rows.length === 0 && <div className="state"><h2>Nothing to show</h2><p>No permission matches that filter.</p></div>}
          {rows.length > 0 && (
            <div className="table-wrap">
              <table>
                <caption className="sr-only">Effective permissions</caption>
                <thead><tr><th>Permission</th><th>Result</th><th>Why</th><th>Granted or denied by</th></tr></thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.key} data-testid={`eff-${p.key}`}>
                      <td data-label="Permission"><code>{p.key}</code>{p.sensitive ? ' *' : ''}<div className="muted small">{p.description}</div></td>
                      <td data-label="Result"><span className={`chip ${p.allowed ? 'chip-pass' : 'chip-fail'}`}>{p.allowed ? 'Allowed' : 'Refused'}</span></td>
                      <td data-label="Why">{p.reason}</td>
                      <td data-label="Granted by">{p.sources.length === 0 ? <span className="muted">No role</span> : p.sources.map((s, i) => <div key={i}><span className={`chip ${s.effect === 'allow' ? 'chip-pass' : 'chip-fail'}`}>{s.effect}</span> {s.role} <span className="muted">({where(s)})</span></div>)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Field label="" name="x"><span className="muted small">* A sensitive permission. A deny in any role held overrides an allow in another.</span></Field>
        </>
      )}
    </section>
  );
}
