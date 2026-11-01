import { useMemo, useRef, useState } from 'react';
import { formatDate } from '../../../platform/format.js';
import { Field, FormDialog, Link, Pager, QueryState, can, errorInfo, usePageTitle } from '../../core/pages/ui.jsx';
import { useAssignments, useEndAssignment, useRequestAssignment, useRoles } from '../api/access.js';
import { useOrgTree } from '../api/org.js';
import { useUsers } from '../api/users.js';

const SCOPES = [['COMPANY', 'The whole company'], ['BRANCH', 'Branches'], ['DEPARTMENT', 'Departments'], ['PROJECT', 'Projects'], ['SITE', 'Sites'], ['OWN', "The person's own records"]];
const scopeLabel = (t) => SCOPES.find(([v]) => v === t)?.[1] ?? t;

const flatten = (nodes, depth = 0) => nodes.flatMap((n) => [{ ...n, depth }, ...flatten(n.children ?? [], depth + 1)]);

/** The choices of a scope, from the organisation tree: branches, departments, projects, or sites grouped by project. */
function ScopePicker({ type, selected, onChange, tree }) {
  const options = useMemo(() => {
    if (!tree) return [];
    if (type === 'BRANCH') return flatten(tree.branches).map((b) => ({ id: b.id, label: `${'— '.repeat(b.depth)}${b.code} ${b.name}` }));
    if (type === 'DEPARTMENT') return flatten(tree.departments).map((d) => ({ id: d.id, label: `${'— '.repeat(d.depth)}${d.code} ${d.name}` }));
    if (type === 'PROJECT') return tree.projects.map((p) => ({ id: p.id, label: `${p.code} ${p.name}` }));
    if (type === 'SITE') return tree.projects.flatMap((p) => p.sites.map((s) => ({ id: s.id, label: `${p.code} › ${s.code} ${s.name}` })));
    return [];
  }, [tree, type]);
  if (!['BRANCH', 'DEPARTMENT', 'PROJECT', 'SITE'].includes(type)) return <p className="muted small">{type === 'OWN' ? 'The person sees and changes only records they own.' : 'Applies everywhere in the company.'}</p>;
  if (options.length === 0) return <p className="muted small" role="status">There are no {scopeLabel(type).toLowerCase()} to choose from yet.</p>;
  return (
    <fieldset className="field"><legend>Choose {scopeLabel(type).toLowerCase()}</legend>
      {options.map((o) => (
        <label key={o.id}><input type="checkbox" checked={selected.includes(o.id)} onChange={(e) => onChange(e.target.checked ? [...selected, o.id] : selected.filter((x) => x !== o.id))} /> {o.label}</label>
      ))}
    </fieldset>
  );
}

/** Assignments: who holds which role, for what part of the company and for how long, and the form that asks for a new one. */
export default function AssignmentsPage({ session }) {
  usePageTitle('Assignments');
  const manage = can(session, 'iam.assignment.manage');
  const params = new URLSearchParams(window.location.search);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState({ status: 'ACTIVE' });
  const [notice, setNotice] = useState('');
  const [error, setError] = useState(null);
  const [scopeType, setScopeType] = useState('COMPANY');
  const [scopeIds, setScopeIds] = useState([]);
  const [endTarget, setEndTarget] = useState(null);
  const list = useAssignments({ page, pageSize: 25, q, filters: filter });
  const users = useUsers({ pageSize: 200, sort: 'displayName' });
  const roles = useRoles({ pageSize: 100, filters: { status: 'ACTIVE' } });
  const tree = useOrgTree();
  const request = useRequestAssignment();
  const end = useEndAssignment();
  const form = useRef(null);
  const endDialog = useRef(null);
  const rows = list.data?.data ?? [];

  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Assignments</nav>
      <div className="page-head"><h1 id="page-title">Assignments</h1></div>
      <p className="muted">A person can hold different roles for different projects. An assignment is a request: it exists once the approvers have decided it. Ending one takes effect at once.</p>
      <p role="status" className="notice" data-testid="assign-notice">{notice}</p>
      <div className="toolbar">
        <label className="field field-inline"><span className="sr-only">Search assignments</span><input type="search" placeholder="Search person or role" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></label>
        <label className="field field-inline"><span className="sr-only">Status</span>
          <select aria-label="Status" value={filter.status ?? ''} onChange={(e) => { setFilter((f) => ({ ...f, status: e.target.value })); setPage(1); }}><option value="">Status: any</option><option value="ACTIVE">In effect or waiting</option><option value="ENDED">Ended</option></select>
        </label>
        <label className="field field-inline"><span className="sr-only">Scope</span>
          <select aria-label="Scope" value={filter.scopeType ?? ''} onChange={(e) => { setFilter((f) => ({ ...f, scopeType: e.target.value })); setPage(1); }}><option value="">Scope: any</option>{SCOPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        {manage && <button type="button" className="btn btn-primary" onClick={() => { setError(null); form.current?.scrollIntoView?.({ block: 'start' }); document.getElementById('assign-user')?.focus(); }}>Assign a role</button>}
      </div>
      <QueryState query={list} what="assignments" permission="iam.assignment.view" />
      {list.data && rows.length === 0 && <div className="state"><h2>No assignments</h2><p>{manage ? 'Use the form below to ask for a role to be given.' : 'Nothing matches those filters.'}</p></div>}
      {rows.length > 0 && (
        <>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Assignments</caption>
              <thead><tr><th>Person</th><th>Role</th><th>Held for</th><th>From</th><th>To</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} data-testid={`assignment-${a.id}`}>
                    <td data-label="Person">{a.displayName} <span className="muted">({a.username})</span></td>
                    <td data-label="Role"><code>{a.roleCode}</code> {a.roleName}</td>
                    <td data-label="Held for">{a.scopeType === 'COMPANY' ? 'The whole company' : a.scopeType === 'OWN' ? 'Own records' : `${scopeLabel(a.scopeType)}: ${a.scopeNames.join(', ')}`}</td>
                    <td data-label="From">{a.effectiveFrom ? formatDate(a.effectiveFrom) : 'Approval'}</td>
                    <td data-label="To">{a.effectiveTo ? formatDate(a.effectiveTo) : 'No end'}</td>
                    <td data-label="Status"><span className={`chip ${a.status === 'ENDED' ? 'chip-never' : a.inForce ? 'chip-pass' : 'chip-not_applicable'}`}>{a.status === 'ENDED' ? 'Ended' : a.inForce ? 'In force' : 'Not in force yet'}</span></td>
                    <td data-label="Actions">{manage && a.status === 'ACTIVE' && <button type="button" className="btn btn-small" aria-label={`End the assignment of ${a.roleCode} to ${a.username}`} onClick={() => { setEndTarget(a); setError(null); endDialog.current?.showModal(); }}>End</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager meta={list.data.meta} page={page} setPage={setPage} noun="assignments" />
        </>
      )}

      {manage ? (
        <form
          ref={form}
          className="card"
          aria-labelledby="assign-title"
          onSubmit={async (e) => {
            e.preventDefault();
            const formEl = e.currentTarget; // React drops currentTarget once the handler awaits
            const f = new FormData(formEl);
            setError(null);
            setNotice('');
            try {
              const out = await request.mutateAsync({ userId: Number(f.get('userId')), roleId: Number(f.get('roleId')), scopeType, scopeIds, effectiveFrom: String(f.get('effectiveFrom') || '') || null, effectiveTo: String(f.get('effectiveTo') || '') || null, reason: String(f.get('reason')) });
              setNotice(`Request ${out.id} was raised: ${out.title}. It needs ${out.chain.map((c) => c.replace('|', ' or ')).join(' then ')} to approve it on the Approvals page.`);
              formEl.reset();
              setScopeType('COMPANY');
              setScopeIds([]);
            } catch (err) { setError(errorInfo(err)); }
          }}
        >
          <h2 id="assign-title">Assign a role</h2>
          <div className="form-grid">
            <Field label="Person *" name="userId" error={error}>
              <select id="assign-user" name="userId" required defaultValue={params.get('userId') ?? ''}>
                <option value="">Choose a person...</option>
                {(users.data?.data ?? []).filter((u) => !['SUSPENDED', 'DEACTIVATED'].includes(u.status)).map((u) => <option key={u.id} value={u.id}>{u.displayName} ({u.username})</option>)}
              </select>
            </Field>
            <Field label="Role *" name="roleId" error={error}>
              <select name="roleId" required defaultValue="">
                <option value="">Choose a role...</option>
                {(roles.data?.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.code} - {r.name}</option>)}
              </select>
            </Field>
            <Field label="Held for *" name="scopeType" error={error}>
              <select name="scopeType" value={scopeType} onChange={(e) => { setScopeType(e.target.value); setScopeIds([]); }}>{SCOPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            </Field>
            <ScopePicker type={scopeType} selected={scopeIds} onChange={setScopeIds} tree={tree.data} />
            {error?.fields?.scopeIds && <span className="field-error" role="alert">{error.fields.scopeIds}</span>}
            <Field label="From" name="effectiveFrom" error={error} hint="Leave empty to start when approved"><input type="date" name="effectiveFrom" /></Field>
            <Field label="To" name="effectiveTo" error={error} hint="Leave empty for no end"><input type="date" name="effectiveTo" /></Field>
            <Field label="Reason (required, min 5 characters) *" name="reason" error={error}><textarea name="reason" rows="2" required minLength={5} maxLength={500} /></Field>
          </div>
          {error?.form && <p className="field-error" role="alert">{error.form}{error.correlationId && <> (Correlation ID: <code>{error.correlationId}</code>)</>}</p>}
          <div className="actions"><button type="reset" className="btn" onClick={() => { setScopeType('COMPANY'); setScopeIds([]); setError(null); }}>Clear</button><button type="submit" className="btn btn-primary" disabled={request.isPending}>{request.isPending ? 'Sending...' : 'Raise the request'}</button></div>
          <p className="muted small">Who approves: the system administrator for an ordinary role; for a privileged role (one with sensitive permissions) the IT administrator or the director as well; a finance approver or the Super Admin role needs the director. See <Link to="/admin/effective-access">Effective Permissions</Link> for what a person can do.</p>
        </form>
      ) : null}

      <FormDialog
        dialogRef={endDialog}
        title={endTarget ? `End ${endTarget.roleCode} for ${endTarget.username}` : 'End the assignment'}
        submitLabel="End the assignment"
        error={error}
        busy={end.isPending}
        onSubmit={async (f) => {
          setError(null);
          try {
            await end.mutateAsync({ id: endTarget.id, reason: String(f.get('reason')) });
            endDialog.current?.close();
            setNotice(`The assignment of ${endTarget.roleCode} to ${endTarget.username} has ended.`);
          } catch (err) { setError(errorInfo(err)); }
        }}
      >
        <p className="muted">Takes effect on their next request and is kept in the history. A person left with no role returns to Onboarding.</p>
      </FormDialog>
    </section>
  );
}
