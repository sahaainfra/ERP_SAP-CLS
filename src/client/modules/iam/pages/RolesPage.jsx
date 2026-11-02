import { useMemo, useRef, useState } from 'react';
import { formatDateTime, toCsv } from '../../../platform/format.js';
import { Field, FormDialog, Link, Pager, QueryState, can, downloadCsv, errorInfo, usePageTitle } from '../../core/pages/ui.jsx';
import { useCreateRole, useMaskFields, usePermissions, useRequestRoleChange, useRole, useRoleCompare, useRoles } from '../api/access.js';
import PermissionMatrix from '../components/PermissionMatrix.jsx';
import RequestCards from '../components/RequestCards.jsx';

const ROLE_STATUS = { DRAFT: ['Draft', 'chip-not_applicable'], ACTIVE: ['Active', 'chip-pass'], RETIRED: ['Retired', 'chip-never'] };
const CATEGORY = { HEAD_OFFICE: 'Head office', SITE_OFFICE: 'Site office', SUPPORTING: 'Supporting', EXTERNAL: 'External', CUSTOM: 'Custom' };
const LEVELS = ['public', 'internal', 'confidential', 'restricted'];
const RULES = [['', 'Field default'], ['hide', 'Hide'], ['partial', 'Partly show'], ['show', 'Show in full']];

const StatusChip = ({ status }) => { const [l, c] = ROLE_STATUS[status] ?? [status, 'chip-not_applicable']; return <span className={`chip ${c}`} data-testid="role-status">{l}</span>; };
const KindChip = ({ kind }) => <span className={`chip ${kind === 'SYSTEM' ? 'chip-never' : 'chip-pass'}`}>{kind === 'SYSTEM' ? 'System (locked)' : 'Custom'}</span>;

/** Roles: system templates (locked) and custom copies; clone, compare two, and one role's page with its permission matrix. */
export default function RolesPage({ session }) {
  usePageTitle('Roles');
  const [openId, setOpenId] = useState(null);
  if (openId) return <RolePage id={openId} session={session} onBack={() => setOpenId(null)} />;
  return <RoleList session={session} onOpen={setOpenId} />;
}

function RoleList({ session, onOpen }) {
  const manage = can(session, 'iam.role.manage');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [q, setQ] = useState(() => new URLSearchParams(window.location.search).get('q') ?? ''); // global search opens the page with the role's code (part 03.08)
  const [sort, setSort] = useState('code');
  const [filter, setFilter] = useState({});
  const [picked, setPicked] = useState([]);
  const [target, setTarget] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const list = useRoles({ page, pageSize, q, sort, filters: filter });
  const create = useCreateRole();
  const dialog = useRef(null);
  const rows = list.data?.data ?? [];
  const compare = useRoleCompare(picked[0], picked[1]);
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-2)));
  const setF = (k, v) => { setFilter((f) => ({ ...f, [k]: v })); setPage(1); };
  const open = (row) => { setTarget(row); setError(null); dialog.current?.showModal(); };

  const exportCsv = () => downloadCsv('roles.csv', toCsv(['Code', 'Name', 'Kind', 'Status', 'Category', 'Clearance', 'Permissions allowed', 'People holding it'], rows.map((r) => [r.code, r.name, r.kind, r.status, CATEGORY[r.category] ?? r.category, r.clearance, r.allowCount, r.holders])));

  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Roles</nav>
      <div className="page-head"><h1 id="page-title">Roles</h1></div>
      <p className="muted">A role is a set of permissions, default field masks and a confidentiality clearance. System roles are templates and cannot be changed; clone one into a custom role to adapt it. Any change to a custom role is a request that the IT administrator (and, for a privileged role, the director) approves.</p>
      <p role="status" className="notice" data-testid="roles-notice">{notice}</p>
      <div className="toolbar">
        <label className="field field-inline"><span className="sr-only">Search roles</span><input type="search" placeholder="Search code or name" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></label>
        <label className="field field-inline"><span className="sr-only">Kind</span>
          <select aria-label="Kind" value={filter.kind ?? ''} onChange={(e) => setF('kind', e.target.value)}><option value="">Kind: any</option><option value="SYSTEM">System</option><option value="CUSTOM">Custom</option></select>
        </label>
        <label className="field field-inline"><span className="sr-only">Category</span>
          <select aria-label="Category" value={filter.category ?? ''} onChange={(e) => setF('category', e.target.value)}><option value="">Category: any</option>{Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
        <label className="field field-inline"><span className="sr-only">Status</span>
          <select aria-label="Status" value={filter.status ?? ''} onChange={(e) => setF('status', e.target.value)}><option value="">Status: any</option>{Object.entries(ROLE_STATUS).map(([k, [v]]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
        <label className="field field-inline"><span className="sr-only">Rows per page</span>
          <select aria-label="Rows per page" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>{[25, 50, 100].map((n) => <option key={n} value={n}>{n} per page</option>)}</select>
        </label>
        <button type="button" className="btn" disabled={rows.length === 0} onClick={exportCsv}>Export CSV</button>
        {manage && <button type="button" className="btn btn-primary" onClick={() => open(null)}>New role</button>}
      </div>
      {picked.length > 0 && <p className="muted" data-testid="compare-hint">{picked.length === 2 ? 'Comparing the two selected roles below.' : 'Select one more role to compare.'} <button type="button" className="btn btn-small" onClick={() => setPicked([])}>Clear</button></p>}
      <QueryState query={list} what="roles" permission="iam.role.view" />
      {list.data && rows.length === 0 && <div className="state"><h2>No roles</h2><p>Nothing matches those filters.</p></div>}
      {rows.length > 0 && (
        <>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Roles</caption>
              <thead>
                <tr>
                  <th><span className="sr-only">Compare</span></th>
                  {[['code', 'Code'], ['name', 'Name']].map(([k, l]) => <th key={k} aria-sort={sort === k ? 'ascending' : sort === `-${k}` ? 'descending' : undefined}><button type="button" className="th-sort" onClick={() => setSort((s) => (s === k ? `-${k}` : k))}>{l}{sort === k ? ' ▲' : sort === `-${k}` ? ' ▼' : ''}</button></th>)}
                  <th>Kind</th><th>Category</th><th>Status</th><th>Clearance</th><th>Allowed</th>
                  <th aria-sort={sort === 'holders' ? 'ascending' : sort === '-holders' ? 'descending' : undefined}><button type="button" className="th-sort" onClick={() => setSort((s) => (s === 'holders' ? '-holders' : 'holders'))}>People{sort === 'holders' ? ' ▲' : sort === '-holders' ? ' ▼' : ''}</button></th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} data-testid={`role-row-${r.code}`}>
                    <td data-label="Compare"><input type="checkbox" aria-label={`Select ${r.code} to compare`} checked={picked.includes(r.id)} onChange={() => toggle(r.id)} /></td>
                    <td data-label="Code"><a href="#open" onClick={(e) => { e.preventDefault(); onOpen(r.id); }}>{r.code}</a></td>
                    <td data-label="Name">{r.name}</td>
                    <td data-label="Kind"><KindChip kind={r.kind} /></td>
                    <td data-label="Category">{CATEGORY[r.category] ?? r.category}</td>
                    <td data-label="Status"><StatusChip status={r.status} /></td>
                    <td data-label="Clearance">{r.clearance}</td>
                    <td data-label="Allowed">{r.allowCount}{r.denyCount ? ` (+${r.denyCount} denied)` : ''}</td>
                    <td data-label="People">{r.holders}</td>
                    <td data-label="Actions">{manage && <button type="button" className="btn btn-small" onClick={() => open(r)} aria-label={`Clone ${r.code}`}>Clone</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager meta={list.data.meta} page={page} setPage={setPage} noun="roles" />
        </>
      )}
      {picked.length === 2 && <Comparison query={compare} />}

      <FormDialog
        dialogRef={dialog}
        title={target ? `Clone ${target.code} into a custom role` : 'New custom role'}
        reason={false}
        submitLabel="Create role"
        error={error}
        busy={create.isPending}
        onSubmit={async (f) => {
          setError(null);
          try {
            const out = await create.mutateAsync({ code: String(f.get('code')), name: String(f.get('name')), description: String(f.get('description') ?? ''), ...(target ? { cloneFromId: target.id } : { clearance: String(f.get('clearance')) }) });
            dialog.current?.close();
            setNotice(`The custom role ${out.code} was created as a draft${target ? ` with the permissions of ${target.code}` : ''}. Open it and request the change that activates it.`);
          } catch (err) { setError(errorInfo(err)); }
        }}
      >
        <div key={target?.id ?? 'new'} className="form-grid">
          <Field label="Code *" name="code" error={error} hint="Capital letters, for example SITELEAD"><input name="code" required maxLength={20} /></Field>
          <Field label="Name *" name="name" error={error}><input name="name" required maxLength={80} /></Field>
          <Field label="Description" name="description" error={error}><textarea name="description" rows="2" maxLength={400} defaultValue={target ? `Copy of ${target.name}` : ''} /></Field>
          {!target && <Field label="Highest confidentiality it may read" name="clearance" error={error}><select name="clearance" defaultValue="internal">{LEVELS.map((l) => <option key={l}>{l}</option>)}</select></Field>}
        </div>
        <p className="muted">A new role is a draft: it grants nothing until the change that activates it is approved.</p>
      </FormDialog>
    </section>
  );
}

function Comparison({ query }) {
  const d = query.data;
  const [onlyDiff, setOnlyDiff] = useState(true);
  return (
    <div className="card" data-testid="role-compare">
      <QueryState query={query} what="the comparison" permission="iam.role.view" />
      {d && (
        <>
          <h2>{d.a.code} compared with {d.b.code}</h2>
          <p className="muted">{d.both} permissions in both; {d.onlyA} only in {d.a.code}; {d.onlyB} only in {d.b.code}. Clearance: {d.a.clearance} against {d.b.clearance}.</p>
          <label><input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /> Show only the differences</label>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Permissions of the two roles</caption>
              <thead><tr><th>Permission</th><th>{d.a.code}</th><th>{d.b.code}</th></tr></thead>
              <tbody>{d.permissions.filter((p) => !onlyDiff || !p.same).map((p) => <tr key={p.key} className={p.same ? '' : 'row-selected'}><td data-label="Permission"><code>{p.key}</code>{p.sensitive ? ' *' : ''}</td><td data-label={d.a.code}>{p.a ?? '-'}</td><td data-label={d.b.code}>{p.b ?? '-'}</td></tr>)}</tbody>
            </table>
          </div>
          {d.masks.length > 0 && (
            <>
              <h3>Field masks</h3>
              <div className="table-wrap"><table><caption className="sr-only">Field masks</caption><thead><tr><th>Field</th><th>{d.a.code}</th><th>{d.b.code}</th></tr></thead><tbody>{d.masks.map((m) => <tr key={m.field}><td data-label="Field">{m.field}</td><td data-label={d.a.code}>{m.a}</td><td data-label={d.b.code}>{m.b}</td></tr>)}</tbody></table></div>
            </>
          )}
        </>
      )}
    </div>
  );
}

const TABS = [['permissions', 'Permissions'], ['masks', 'Field masks'], ['users', 'Users holding it'], ['approvals', 'Approvals'], ['details', 'Details']];

function RolePage({ id, session, onBack }) {
  const q = useRole(id);
  const role = q.data;
  usePageTitle(role ? `Role ${role.code}` : 'Role');
  const registry = usePermissions();
  const fields = useMaskFields();
  const request = useRequestRoleChange();
  const [tab, setTab] = useState('permissions');
  const [grants, setGrants] = useState(null); // an edit in progress: Map key -> 'allow' | 'deny'
  const [maskDraft, setMaskDraft] = useState(null); // Map 'entity.field' -> rule
  const [clearance, setClearance] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const dialog = useRef(null);
  const manage = can(session, 'iam.role.manage');
  const custom = role?.kind === 'CUSTOM';
  const editable = manage && custom;

  const stored = useMemo(() => new Map((role?.permissions ?? []).map((p) => [p.key, p.effect])), [role]);
  const storedMasks = useMemo(() => new Map((role?.masks ?? []).map((m) => [`${m.entity}.${m.field}`, m.rule])), [role]);
  const current = grants ?? stored;
  const maskNow = maskDraft ?? storedMasks;
  const dirty = Boolean(grants) || Boolean(maskDraft) || (clearance && clearance !== role?.clearance);
  const discard = () => { setGrants(null); setMaskDraft(null); setClearance(null); };

  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb"><a href="#back" onClick={(e) => { e.preventDefault(); onBack(); }}>Administration &rsaquo; Roles</a> &rsaquo; {role?.code ?? '...'}</nav>
      <QueryState query={q} what="this role" permission="iam.role.view" />
      {role && (
        <>
          <div className="page-head">
            <div>
              <h1 id="page-title">{role.name}</h1>
              <p className="muted"><code>{role.code}</code> · <KindChip kind={role.kind} /> · <StatusChip status={role.status} />{role.privileged ? <> · <span className="chip chip-fail">Privileged</span></> : null} · clearance {role.clearance}{role.parent ? ` · copy of ${role.parent.code}` : ''}</p>
            </div>
            <div className="actions">
              <button type="button" className="btn" onClick={onBack}>Back to the list</button>
              {editable && dirty && <button type="button" className="btn" onClick={discard}>Discard edits</button>}
              {editable && <button type="button" className="btn btn-primary" disabled={!dirty && role.status === 'ACTIVE'} onClick={() => { setError(null); dialog.current?.showModal(); }}>{role.status === 'ACTIVE' ? 'Request the change' : 'Request activation'}</button>}
              {editable && role.status === 'ACTIVE' && !dirty && <button type="button" className="btn" onClick={() => { setError(null); setTab('details'); dialog.current?.showModal(); }}>Retire</button>}
            </div>
          </div>
          <p role="status" className="notice" data-testid="role-notice">{notice}</p>
          {!custom && <p className="notice" role="note" data-testid="locked-note">This is a system role. It is locked so every installation means the same by it: clone it from the Roles list to make an editable copy.</p>}
          {editable && role.status === 'DRAFT' && <p className="notice" role="note">This role is a draft and grants nothing yet. Choose its permissions below, then request activation.</p>}
          <div role="tablist" aria-label="Role sections" className="actions">
            {TABS.map(([k, l]) => <button key={k} type="button" role="tab" id={`rtab-${k}`} aria-selected={tab === k} className={`btn${tab === k ? ' btn-primary' : ''}`} onClick={() => setTab(k)}>{l}</button>)}
          </div>
          <div role="tabpanel" aria-labelledby={`rtab-${tab}`}>
            {tab === 'permissions' && (
              <>
                <QueryState query={registry} what="the permission registry" permission="iam.role.view" />
                {registry.data && <PermissionMatrix registry={registry.data} grants={current} editable={editable} onChange={setGrants} />}
              </>
            )}
            {tab === 'masks' && (
              <div className="card">
                <h2>Field masks</h2>
                <p className="muted">A sensitive field is hidden or partly shown unless a role says otherwise. Where a person holds several roles, the most open rule wins.</p>
                <QueryState query={fields} what="the sensitive fields" permission="iam.role.view" />
                {fields.data && (
                  <div className="table-wrap">
                    <table>
                      <caption className="sr-only">Field masks of this role</caption>
                      <thead><tr><th>Field</th><th>Without a rule of its own</th><th>This role</th></tr></thead>
                      <tbody>
                        {fields.data.map((f) => {
                          const k = `${f.entity}.${f.field}`;
                          return (
                            <tr key={k}>
                              <td data-label="Field"><strong>{f.label}</strong><div className="muted small">{k}{f.description ? `: ${f.description}` : ''}</div></td>
                              <td data-label="Default">{f.defaultRule}</td>
                              <td data-label="This role">
                                {editable ? (
                                  <select aria-label={`Mask rule for ${k}`} value={maskNow.get(k) ?? ''} onChange={(e) => { const n = new Map(maskNow); if (e.target.value) n.set(k, e.target.value); else n.delete(k); setMaskDraft(n); }}>
                                    {RULES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                                  </select>
                                ) : (RULES.find(([v]) => v === (storedMasks.get(k) ?? ''))?.[1])}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {editable && (
                  <Field label="Highest confidentiality this role may read" name="clearance">
                    <select value={clearance ?? role.clearance} onChange={(e) => setClearance(e.target.value)}>{LEVELS.map((l) => <option key={l}>{l}</option>)}</select>
                  </Field>
                )}
              </div>
            )}
            {tab === 'users' && (
              <div className="card">
                {role.holders.length === 0 ? <div className="state"><h2>Nobody holds this role</h2><p>People get a role through an assignment (Administration &rsaquo; Assignments).</p></div> : (
                  <div className="table-wrap">
                    <table>
                      <caption className="sr-only">People holding this role</caption>
                      <thead><tr><th>Person</th><th>Held for</th><th>How</th><th>Dates</th></tr></thead>
                      <tbody>{role.holders.map((h, i) => <tr key={`${h.userId}-${i}`}><td data-label="Person">{h.displayName} <span className="muted">({h.username})</span></td><td data-label="Held for">{h.scopeType === 'COMPANY' ? 'The whole company' : `${h.scopeType.toLowerCase()} ${h.scopeIds.join(', ')}`}</td><td data-label="How">{h.via}</td><td data-label="Dates">{h.effectiveFrom || h.effectiveTo ? `${h.effectiveFrom ?? 'now'} to ${h.effectiveTo ?? 'no end'}` : 'No end'}</td></tr>)}</tbody>
                    </table>
                  </div>
                )}
                <p className="muted small"><Link to="/admin/assignments">Assignments</Link></p>
              </div>
            )}
            {tab === 'approvals' && <RequestCards requests={role.requests} emptyText="A change to this role appears here with each approver's decision." />}
            {tab === 'details' && (
              <div className="card">
                <dl className="facts">
                  {[['Code', role.code], ['Name', role.name], ['Description', role.description], ['Department', role.authority.department], ['Default data scope', role.authority.scope], ['Main responsibilities', role.authority.responsibilities], ['Approval authority', role.authority.summary], ['Confidentiality clearance', role.clearance], ['Created', `${formatDateTime(role.createdAt)}${role.createdBy ? ` by ${role.createdBy}` : ''}`]]
                    .map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v || <span className="muted">Not set</span>}</dd></div>)}
                </dl>
                <p className="muted small">Approval limits (bands) are set in the approval matrix when the workflow engine exists (part 04.01).</p>
              </div>
            )}
          </div>

          <FormDialog
            dialogRef={dialog}
            title={role.status === 'ACTIVE' && !dirty ? `Retire ${role.code}` : role.status === 'ACTIVE' ? `Change ${role.code}` : `Activate ${role.code}`}
            submitLabel="Raise the request"
            error={error}
            busy={request.isPending}
            onSubmit={async (f) => {
              setError(null);
              const retire = role.status === 'ACTIVE' && !dirty;
              try {
                const body = { reason: String(f.get('reason')) };
                if (retire) body.retire = true;
                else {
                  if (grants || role.status === 'DRAFT') body.permissions = { allow: [...current].filter(([, v]) => v === 'allow').map(([k]) => k), deny: [...current].filter(([, v]) => v === 'deny').map(([k]) => k) };
                  if (maskDraft) body.masks = [...maskDraft].map(([k, rule]) => ({ entity: k.slice(0, k.indexOf('.')), field: k.slice(k.indexOf('.') + 1), rule }));
                  if (clearance && clearance !== role.clearance) body.clearance = clearance;
                  if (role.status !== 'ACTIVE') body.activate = true;
                }
                const out = await request.mutateAsync({ id: role.id, ...body });
                dialog.current?.close();
                discard();
                setTab('approvals');
                setNotice(`Request ${out.id} was raised. It needs ${out.chain.join(' then ')} to approve it on the Approvals page; nothing changes until then.`);
              } catch (err) { setError(errorInfo(err)); }
            }}
          >
            <p className="muted">
              {role.status === 'ACTIVE' && !dirty ? 'The role stops granting anything once the request is approved. It cannot be retired while somebody holds it.'
                : `${[...current].filter(([, v]) => v === 'allow').length} permissions allowed and ${[...current].filter(([, v]) => v === 'deny').length} denied will apply once the request is approved${role.status !== 'ACTIVE' ? ', and the role becomes active' : ''}.`}
            </p>
          </FormDialog>
        </>
      )}
    </section>
  );
}
