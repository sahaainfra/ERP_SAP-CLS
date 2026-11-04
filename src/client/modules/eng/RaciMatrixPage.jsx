import { useEffect, useMemo, useState } from 'react';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { useApplyTemplate, useGaps, useProposeRaci, useRaci, useRaciScopes } from '../../platform/accountability/api.js';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';

// RACI Matrix (part 04.05, section 7.1): the processes of the company against the people and roles who are Responsible, Accountable, Consulted or Informed in one scope (the company,
// a department, a project or a site). Exactly one person is Accountable for a process in a scope; many may be Responsible. A change of a live project is approved by its project
// manager and then its project director; any other change takes effect at once. The gap check lists the processes nobody is accountable for.
const LETTERS = ['', 'R', 'A', 'C', 'I'];
const NAME = { R: 'Responsible', A: 'Accountable', C: 'Consulted', I: 'Informed' };
const colKey = (c) => `${c.kind}:${c.ref}`;

function fromGrid(grid) {
  const cols = [];
  const cells = {};
  for (const p of grid.processes) for (const a of p.assignments) {
    const c = { kind: a.user ? 'user' : 'role', ref: a.user ?? a.role };
    if (!cols.some((x) => colKey(x) === colKey(c))) cols.push(c);
    cells[`${p.code}|${colKey(c)}`] = a.raci;
  }
  return { cols, cells };
}

function TemplateForm({ scope, templates, onDone, onCancel }) {
  const apply = useApplyTemplate();
  const [error, setError] = useState(null);
  const roles = [...new Set(templates.flatMap((t) => t.roles.filter((r) => r.raci === 'A').map((r) => r.role)))];
  const submit = (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const people = {};
    for (const r of roles) { const v = String(f.get(`p-${r}`) ?? '').trim(); if (v) people[r] = v; }
    for (const r of new Set(templates.flatMap((t) => t.roles.map((x) => x.role)))) { const v = String(f.get(`p-${r}`) ?? '').trim(); if (v) people[r] = v; }
    setError(null);
    apply.mutate({ scopeType: scope.type, scopeId: scope.id, reason: String(f.get('reason')), people }, { onSuccess: onDone, onError: (er) => setError(errorInfo(er)) });
  };
  return (
    <form className="form-grid card" onSubmit={submit} aria-label="Apply the standard template">
      <h2>Apply the standard processes</h2>
      <p className="muted">Every standard process gets its usual roles. The accountable role of each needs a person; name who holds each role in this scope (the others may stay roles).</p>
      {roles.map((r) => <Field key={r} label={`Who is ${r}`} name={`people.${r}`} error={error}><input name={`p-${r}`} required minLength={2} maxLength={60} /></Field>)}
      <Field label="Reason" name="reason" error={error}><input name="reason" required minLength={5} maxLength={500} defaultValue="The standard set of processes for this scope" /></Field>
      {error && <p role="alert" className="error">{error.form}{error.correlationId && <> (<code>{error.correlationId}</code>)</>}</p>}
      <div className="actions"><button type="submit" className="btn btn-primary" disabled={apply.isPending}>Apply</button><button type="button" className="btn" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

function Gaps({ projectId }) {
  const q = useGaps({ projectId: projectId || '' });
  if (q.isPending) return <Skeleton label="Checking for gaps" rows={2} />;
  if (q.isError) return <ErrorState title="The gap check could not be run" error={q.error} onRetry={() => q.refetch()} />;
  const g = q.data;
  return (
    <section className="card" aria-labelledby="gap-title" data-testid="raci-gaps">
      <h2 id="gap-title">Gap check</h2>
      <p data-testid="gap-summary"><strong>{g.summary.gaps}</strong> process(es) with nobody accountable, <strong>{g.summary.multiple}</strong> with more than one, in {g.summary.projects} project(s).</p>
      {g.rows.length === 0 ? <p className="muted">Every process has exactly one accountable person.</p> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Processes without an accountable person">
          <table className="grid"><thead><tr><th>Project</th><th>Process</th><th>Problem</th></tr></thead>
            <tbody>{g.rows.slice(0, 100).map((r) => <tr key={`${r.projectId}-${r.processCode}`}><td data-label="Project">{r.project}</td><th scope="row" data-label="Process">{r.process}</th><td data-label="Problem">{r.status === 'GAP' ? 'Nobody is accountable' : 'More than one accountable'}</td></tr>)}</tbody></table>
        </div>
      )}
    </section>
  );
}

export default function RaciMatrixPage() {
  usePageTitle('RACI Matrix');
  const scopes = useRaciScopes();
  const [scope, setScope] = useState({ scopeType: 'PROJECT', scopeId: '' });
  const [cols, setCols] = useState([]);
  const [cells, setCells] = useState({});
  const [reason, setReason] = useState('');
  const [from, setFrom] = useState('');
  const [newCol, setNewCol] = useState({ kind: 'user', ref: '' });
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const [template, setTemplate] = useState(false);
  const propose = useProposeRaci();
  const want = scope.scopeType === 'COMPANY' || scope.scopeId ? { scopeType: scope.scopeType, scopeId: scope.scopeType === 'COMPANY' ? 0 : Number(scope.scopeId) } : null;
  const grid = useRaci(want);
  const base = useMemo(() => (grid.data ? fromGrid(grid.data) : null), [grid.data]);
  useEffect(() => { if (base) { setCols(base.cols); setCells(base.cells); } }, [base]);
  useEffect(() => { setNotice(''); setError(null); }, [scope.scopeType, scope.scopeId]);
  if (scopes.error?.status === 403) return <NoPermission what="the RACI matrix" permission="acc.raci.view" />;
  const options = scopes.data;
  const choices = options ? { PROJECT: options.projects.map((p) => [p.id, `${p.code} ${p.name}`]), SITE: options.sites.map((s) => [s.id, `${s.code} ${s.name}`]), DEPARTMENT: options.departments.map((d) => [d.id, d.name]) }[scope.scopeType] ?? [] : [];
  const g = grid.data;
  const processes = g?.processes ?? [];
  const changed = processes.filter((p) => {
    const was = new Set(base?.cells ? Object.entries(base.cells).filter(([k]) => k.startsWith(`${p.code}|`)).map(([k, v]) => `${k}=${v}`) : []);
    const now = new Set(Object.entries(cells).filter(([k, v]) => k.startsWith(`${p.code}|`) && v).map(([k, v]) => `${k}=${v}`));
    return was.size !== now.size || [...now].some((x) => !was.has(x));
  });
  const set = (process, col, letter) => setCells((c) => { const n = { ...c, [`${process}|${colKey(col)}`]: letter }; if (!letter) delete n[`${process}|${colKey(col)}`]; return n; });
  const addCol = (e) => {
    e.preventDefault();
    const ref = newCol.ref.trim();
    if (ref.length < 2 || cols.some((c) => colKey(c) === `${newCol.kind}:${ref}`)) return;
    setCols([...cols, { kind: newCol.kind, ref }]);
    setNewCol({ ...newCol, ref: '' });
  };
  const save = () => {
    setError(null);
    const body = {
      scopeType: want.scopeType, scopeId: want.scopeId, reason, ...(from ? { effectiveFrom: from } : {}),
      processes: changed.map((p) => ({ processCode: p.code, assignments: cols.filter((c) => cells[`${p.code}|${colKey(c)}`]).map((c) => ({ ...(c.kind === 'user' ? { user: c.ref } : { role: c.ref }), raci: cells[`${p.code}|${colKey(c)}`] })) })),
    };
    propose.mutate(body, {
      onSuccess: (r) => { setNotice(r.applied ? `Saved: ${r.processes.length} process(es) changed.` : `Sent for approval by the project manager and then the project director (${r.processes.length} process(es)).`); setReason(''); },
      onError: (er) => setError(errorInfo(er)),
    });
  };
  return (
    <section aria-labelledby="rc-title" data-testid="raci-matrix">
      <h1 id="rc-title">RACI Matrix</h1>
      <p className="muted">Who is Responsible, Accountable, Consulted and Informed for each process. Exactly one person is Accountable for a process in a scope; any number may be Responsible. A change of a live project is approved by its project manager and then its project director.</p>
      {notice && <p role="status" className="notice" data-testid="raci-notice">{notice}</p>}
      <form className="srch-form" role="search" aria-label="Choose the scope" onSubmit={(e) => e.preventDefault()}>
        <label className="field"><span>Scope</span><select value={scope.scopeType} onChange={(e) => setScope({ scopeType: e.target.value, scopeId: '' })}><option value="PROJECT">Project</option><option value="SITE">Site</option><option value="DEPARTMENT">Department</option><option value="COMPANY">The whole company</option></select></label>
        {scope.scopeType !== 'COMPANY' && <label className="field"><span>Which</span><select value={scope.scopeId} onChange={(e) => setScope({ ...scope, scopeId: e.target.value })}><option value="">Choose...</option>{choices.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>}
      </form>
      {scopes.isPending && <Skeleton label="Loading the scopes" rows={2} />}
      {!want && options && <EmptyState title="Choose a scope" message={choices.length || scope.scopeType === 'COMPANY' ? 'Pick the project, site or department whose responsibilities you want to see or change.' : 'There is nothing of this kind to choose yet.'} />}
      {want && grid.isPending && <Skeleton label="Loading the matrix" rows={5} />}
      {want && grid.isError && <ErrorState title="The matrix could not be loaded" error={grid.error} onRetry={() => grid.refetch()} />}
      {g && (
        <>
          <p data-testid="raci-scope"><strong>{g.scope.label}</strong>{g.scope.live ? ' (a live project: changes are approved)' : ''}</p>
          {g.pending && <p role="status" className="notice" data-testid="raci-pending">A change by {g.pending.by} for {g.pending.processes.length} process(es) is waiting for approval{g.pending.instanceId ? <> — <Link to={`/workflow/instance?id=${g.pending.instanceId}`}>follow it</Link></> : ''}. Nothing else can be changed in this scope until it is decided.</p>}
          <div className="srch-tools">{g.canMaintain && !g.pending && <button type="button" className="btn" onClick={() => setTemplate(true)}>Apply the standard processes</button>}</div>
          {template && <TemplateForm scope={g.scope} templates={g.templates} onCancel={() => setTemplate(false)} onDone={(r) => { setTemplate(false); setNotice(r.applied ? `Applied: ${r.processes.length} process(es).` : `Sent for approval (${r.processes.length} process(es)).`); }} />}
          {g.canMaintain && !g.pending && (
            <form className="wf-inline" aria-label="Add a person or a role" onSubmit={addCol}>
              <label className="field"><span>Add a column for</span><select value={newCol.kind} onChange={(e) => setNewCol({ ...newCol, kind: e.target.value })}><option value="user">A person</option><option value="role">A role</option></select></label>
              <label className="field"><span>{newCol.kind === 'user' ? 'User name' : 'Role code, such as PM'}</span><input value={newCol.ref} maxLength={60} onChange={(e) => setNewCol({ ...newCol, ref: newCol.kind === 'role' ? e.target.value.toUpperCase() : e.target.value })} /></label>
              <button type="submit" className="btn btn-small" disabled={newCol.ref.trim().length < 2}>Add column</button>
            </form>
          )}
          {cols.length === 0 ? <EmptyState title="Nobody is assigned yet" message="Apply the standard processes, or add a person or a role as a column and set R, A, C or I for each process." /> : (
            <div className="table-wrap" tabIndex={0} role="region" aria-label="RACI grid">
              <table className="grid" data-testid="raci-grid">
                <thead><tr><th>Process</th>{cols.map((c) => <th key={colKey(c)} scope="col">{c.ref}<br /><span className="muted small">{c.kind === 'role' ? 'role' : 'person'}</span></th>)}<th>Accountable</th></tr></thead>
                <tbody>{processes.map((p) => {
                  const a = cols.filter((c) => cells[`${p.code}|${colKey(c)}`] === 'A');
                  return (
                    <tr key={p.code} data-testid={`raci-row-${p.code}`}>
                      <th scope="row" data-label="Process">{p.name}{changed.some((x) => x.code === p.code) && <span className="small"> (changed)</span>}</th>
                      {cols.map((c) => (
                        <td key={colKey(c)} data-label={c.ref}>
                          <select aria-label={`${p.name}: ${c.ref}`} value={cells[`${p.code}|${colKey(c)}`] ?? ''} disabled={!g.canMaintain || Boolean(g.pending)} onChange={(e) => set(p.code, c, e.target.value)}>
                            {LETTERS.map((l) => <option key={l || 'none'} value={l} disabled={l === 'A' && c.kind === 'role'}>{l ? `${l} ${NAME[l]}` : '-'}</option>)}
                          </select>
                        </td>
                      ))}
                      <td data-label="Accountable">{a.length === 1 ? a[0].ref : a.length > 1 ? <strong role="alert">More than one</strong> : p.inherited ? <span className="muted">{p.inherited.user} (from {p.inherited.scope.type.toLowerCase()})</span> : <strong>Nobody</strong>}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          )}
          {g.canMaintain && !g.pending && changed.length > 0 && (
            <form className="form-grid card" aria-label="Save the changes" onSubmit={(e) => { e.preventDefault(); save(); }}>
              <p data-testid="raci-changed"><strong>{changed.length}</strong> process(es) changed.</p>
              <Field label="Takes effect from (today if empty)" name="effectiveFrom" error={error}><input type="date" value={from} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setFrom(e.target.value)} /></Field>
              <Field label="Reason" name="reason" error={error}><input value={reason} required minLength={5} maxLength={500} onChange={(e) => setReason(e.target.value)} /></Field>
              {error && <div role="alert" className="error" data-testid="raci-error"><p>{error.form}</p>{Object.entries(error.fields ?? {}).map(([k, m]) => <p key={k} className="small">{m}</p>)}{error.correlationId && <p className="small">Correlation ID: <code>{error.correlationId}</code></p>}</div>}
              <div className="actions"><button type="submit" className="btn btn-primary" disabled={propose.isPending || reason.trim().length < 5}>{g.scope.live ? 'Send for approval' : 'Save'}</button><button type="button" className="btn" onClick={() => { setCells(base.cells); setCols(base.cols); setError(null); }}>Discard the changes</button></div>
            </form>
          )}
        </>
      )}
      <Gaps projectId={scope.scopeType === 'PROJECT' ? scope.scopeId : ''} />
      <p className="muted small"><Link to="/accountability">My Accountability</Link> shows what you answer for. <Link to="/reports/accountability">The Accountability Report</Link> shows how each person and project is doing.</p>
    </section>
  );
}
