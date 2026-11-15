import { useRef, useState } from 'react';
import { formatDateTime, toCsv } from '../../../platform/format.js';
import { Field, FormDialog, Link, Pager, QueryState, can, downloadCsv, errorInfo, usePageTitle } from '../../core/pages/ui.jsx';
import { useDormant, useResolveViolation, useScanDormant, useScanViolations, useSodViolation, useSodViolations } from '../api/privileged.js';
import { SeverityChip, StatusChip } from '../components/privilegedCommon.jsx';
import PageHeader from '../../../platform/design/PageHeader.jsx';
import { KpiRow } from '../../../platform/design/Kpi.jsx';

/** The remedy for one violation: take a role away (system administrator) or accept the risk with a reason (auditor, director). */
function ResolveDialog({ dialogRef, violation, session, onDone }) {
  const detail = useSodViolation(violation?.id);
  const resolve = useResolveViolation();
  const [error, setError] = useState(null);
  const [mode, setMode] = useState('ACCEPT');
  const v = detail.data;
  const canRemove = can(session, 'iam.user.manage') && v?.source === 'ASSIGNMENT';
  const canAccept = can(session, 'iam.sod.resolve');
  return (
    <FormDialog
      dialogRef={dialogRef}
      title={violation ? `${violation.ruleCode}: ${violation.user}` : 'Deal with a violation'}
      submitLabel={mode === 'ACCEPT' ? 'Accept the risk' : 'Take the role away'}
      error={error}
      busy={resolve.isPending}
      onSubmit={async (f) => {
        setError(null);
        try {
          const role = String(f.get('role') ?? '');
          const holding = v.holdings.find((h) => `${h.role}|${h.assignmentId ?? ''}` === role);
          await resolve.mutateAsync({ id: violation.id, action: mode, ...(mode === 'REMOVE_ROLE' ? { roleCode: holding?.assignmentId ? undefined : holding?.role, assignmentId: holding?.assignmentId ?? undefined } : {}), reason: String(f.get('reason')) });
          dialogRef.current?.close();
          onDone(mode === 'ACCEPT' ? `The risk of ${violation.ruleCode} for ${violation.user} was accepted.` : `The role was taken away from ${violation.user}; the conflict is re-checked.`);
        } catch (err) { setError(errorInfo(err)); }
      }}
    >
      {v && (
        <>
          <p>{v.detail?.a ? <>Holds <strong>{v.detail.a.join(', ')}</strong> ({(v.detail.rolesA ?? []).join(', ')}) together with <strong>{v.detail.b.join(', ')}</strong> ({(v.detail.rolesB ?? []).join(', ')}).</> : <>You already did <strong>{v.detail.did}</strong>, then <strong>{v.detail.doing}</strong>.</>}</p>
          <fieldset className="field"><legend>What to do</legend>
            {canAccept && <label><input type="radio" name="mode" checked={mode === 'ACCEPT'} onChange={() => setMode('ACCEPT')} /> Accept the risk (a reason is kept on the record)</label>}
            {canRemove && <label><input type="radio" name="mode" checked={mode === 'REMOVE_ROLE'} onChange={() => setMode('REMOVE_ROLE')} /> Take a role away</label>}
          </fieldset>
          {mode === 'REMOVE_ROLE' && canRemove && (
            <Field label="Role to take away *" name="role" error={error}>
              <select name="role" required defaultValue="">
                <option value="">Choose...</option>
                {v.holdings.map((h) => <option key={`${h.role}-${h.assignmentId}`} value={`${h.role}|${h.assignmentId ?? ''}`}>{h.role} ({h.assignmentId ? `assignment, ${h.scopeType.toLowerCase()}` : 'role list'})</option>)}
              </select>
            </Field>
          )}
        </>
      )}
    </FormDialog>
  );
}

function ViolationsTab({ session }) {
  const initial = new URLSearchParams(window.location.search);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState({ status: initial.get('status') ?? 'OPEN', ruleId: initial.get('ruleId') ?? '' });
  const [target, setTarget] = useState(null);
  const [notice, setNotice] = useState('');
  const [scanError, setScanError] = useState('');
  const list = useSodViolations({ page, pageSize: 25, q, sort: '-detectedAt', filters });
  const scan = useScanViolations();
  const dialog = useRef(null);
  const rows = list.data?.data ?? [];
  const s = list.data?.summary;
  const exportCsv = () => downloadCsv('sod-violations.csv', toCsv(['Detected', 'Person', 'Rule', 'Severity', 'Source', 'Outcome', 'Status', 'Document'], rows.map((v) => [v.detectedAt, v.user, `${v.ruleCode} ${v.ruleName}`, v.severity, v.source, v.outcome, v.status, v.documentType ? `${v.documentType} ${v.documentId}` : ''])));
  return (
    <>
      <p role="status" className="notice" data-testid="violation-notice">{notice}</p>
      {s && (
        <KpiRow data-testid="violation-summary">
          <div className={`tile ${s.open ? 'tile-bad' : 'tile-ok'}`}><span>Open</span><strong>{s.open}</strong></div>
          <div className="tile"><span>Blocked attempts</span><strong>{s.blocked}</strong></div>
          <div className="tile"><span>Resolved</span><strong>{s.resolved}</strong></div>
          <div className="tile"><span>Risk accepted</span><strong>{s.accepted}</strong></div>
        </KpiRow>
      )}
      <div className="toolbar">
        <label className="field field-inline"><span className="sr-only">Search violations</span><input type="search" placeholder="Search person, rule or document" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></label>
        <label className="field field-inline"><span className="sr-only">Status</span>
          <select aria-label="Status" value={filters.status} onChange={(e) => { setFilters((f) => ({ ...f, status: e.target.value })); setPage(1); }}><option value="">Status: any</option><option value="OPEN">Open</option><option value="BLOCKED">Blocked attempts</option><option value="RESOLVED">Resolved</option><option value="ACCEPTED">Risk accepted</option></select>
        </label>
        <label className="field field-inline"><span className="sr-only">Severity</span>
          <select aria-label="Severity" value={filters.severity ?? ''} onChange={(e) => { setFilters((f) => ({ ...f, severity: e.target.value })); setPage(1); }}><option value="">Severity: any</option><option value="BLOCK">Blocks</option><option value="WARN">Warns</option><option value="DETECT">Detects</option></select>
        </label>
        <label className="field field-inline"><span className="sr-only">Source</span>
          <select aria-label="Source" value={filters.source ?? ''} onChange={(e) => { setFilters((f) => ({ ...f, source: e.target.value })); setPage(1); }}><option value="">Source: any</option><option value="ASSIGNMENT">What a person holds</option><option value="TRANSACTION">A transaction</option></select>
        </label>
        <button type="button" className="btn" onClick={exportCsv} disabled={rows.length === 0}>Export CSV</button>
        {can(session, 'iam.sod.resolve') && <button type="button" className="btn btn-primary" disabled={scan.isPending} onClick={async () => { setScanError(''); try { const r = await scan.mutateAsync(); setNotice(`Checked ${r.users} people: ${r.conflicts} conflict(s) found.`); } catch (err) { setScanError(errorInfo(err).form); } }}>{scan.isPending ? 'Scanning...' : 'Scan now'}</button>}
      </div>
      {scanError && <p className="field-error" role="alert">{scanError}</p>}
      <QueryState query={list} what="the violations" permission="iam.sod.view" />
      {list.data && rows.length === 0 && <div className="state"><h2>No violations</h2><p>Nothing matches those filters.</p></div>}
      {rows.length > 0 && (
        <>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Segregation of duties violations</caption>
              <thead><tr><th>Detected</th><th>Person</th><th>Rule</th><th>Severity</th><th>What happened</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {rows.map((v) => (
                  <tr key={v.id} data-testid={`violation-${v.id}`}>
                    <td data-label="Detected">{formatDateTime(v.detectedAt)}</td>
                    <td data-label="Person">{v.user}</td>
                    <td data-label="Rule"><code>{v.ruleCode}</code> {v.ruleName}</td>
                    <td data-label="Severity"><SeverityChip severity={v.severity} /></td>
                    <td data-label="What happened">{v.source === 'ASSIGNMENT' ? `Holds both sides: ${(v.detail.a ?? []).join(', ')} and ${(v.detail.b ?? []).join(', ')}` : `${v.outcome === 'BLOCKED' ? 'Tried' : 'Did'} ${v.detail.doing} after ${v.detail.did} on ${v.documentType} ${v.documentId}`}</td>
                    <td data-label="Status"><StatusChip status={v.status} /></td>
                    <td data-label="Actions">{v.status === 'OPEN' && <button type="button" className="btn btn-small" aria-label={`Deal with violation ${v.id}`} onClick={() => { setTarget(v); dialog.current?.showModal(); }}>Deal with it</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager meta={list.data.meta} page={page} setPage={setPage} noun="violations" />
        </>
      )}
      <ResolveDialog key={target?.id ?? 'none'} dialogRef={dialog} violation={target} session={session} onDone={setNotice} />
    </>
  );
}

function DormantTab({ session }) {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [notice, setNotice] = useState('');
  const list = useDormant({ page, pageSize: 25, q, sort: '-days' });
  const scan = useScanDormant();
  const rows = list.data?.data ?? [];
  const policy = list.data?.policy;
  return (
    <>
      <p className="muted">An account counts as dormant after {policy?.days ?? 90} days without a sign-in. The daily check {policy?.action === 'suspend' ? <strong>suspends them and ends their sessions</strong> : <strong>only reports them</strong>}. Change this under System Parameters (iam.dormant.action). The last active system administrator is never suspended.</p>
      <p role="status" className="notice" data-testid="dormant-notice">{notice}</p>
      <div className="toolbar">
        <label className="field field-inline"><span className="sr-only">Search accounts</span><input type="search" placeholder="Search person" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></label>
        {can(session, 'iam.sod.resolve') && <button type="button" className="btn btn-primary" disabled={scan.isPending} onClick={async () => { try { const r = await scan.mutateAsync(); setNotice(`${r.dormant} dormant account(s); ${r.suspended.length} suspended${r.skipped.length ? `; ${r.skipped.length} kept (${r.skipped.map((x) => `${x.user}: ${x.why}`).join(', ')})` : ''}.`); } catch (err) { setNotice(errorInfo(err).form); } }}>{scan.isPending ? 'Checking...' : 'Check now'}</button>}
      </div>
      <QueryState query={list} what="the dormant accounts" permission="iam.sod.view" />
      {list.data && rows.length === 0 && <div className="state"><h2>No dormant accounts</h2><p>Everybody has signed in within {policy?.days ?? 90} days.</p></div>}
      {rows.length > 0 && (
        <>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Dormant accounts</caption>
              <thead><tr><th>Person</th><th>Roles</th><th>Last sign-in</th><th>Days</th><th>State</th></tr></thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id} data-testid={`dormant-${u.username}`}>
                    <td data-label="Person"><Link to={`/admin/users/${u.id}`}>{u.displayName}</Link> <span className="muted">({u.username})</span></td>
                    <td data-label="Roles">{u.roles.join(', ') || 'None'}</td>
                    <td data-label="Last sign-in">{u.neverSignedIn ? 'Never signed in' : formatDateTime(u.lastLoginAt)}</td>
                    <td data-label="Days">{u.days}</td>
                    <td data-label="State">{u.lifecycle}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager meta={list.data.meta} page={page} setPage={setPage} noun="accounts" />
        </>
      )}
    </>
  );
}

/** The detective report: conflicts people hold now, transactions that were warned of or blocked, and dormant accounts. */
export default function SodViolationsPage({ session }) {
  usePageTitle('Segregation of Duties Violations');
  const [tab, setTab] = useState('violations');
  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Segregation of duties &rsaquo; Violations</nav>
      <PageHeader id="page-title" title={"Violations & Dormant Accounts"} />
      <div role="tablist" aria-label="Report" className="toolbar">
        <button type="button" role="tab" id="tab-violations" aria-selected={tab === 'violations'} aria-controls="panel-violations" className={`btn${tab === 'violations' ? ' btn-primary' : ''}`} onClick={() => setTab('violations')}>Violations</button>
        <button type="button" role="tab" id="tab-dormant" aria-selected={tab === 'dormant'} aria-controls="panel-dormant" className={`btn${tab === 'dormant' ? ' btn-primary' : ''}`} onClick={() => setTab('dormant')}>Dormant accounts</button>
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>{tab === 'violations' ? <ViolationsTab session={session} /> : <DormantTab session={session} />}</div>
    </section>
  );
}
