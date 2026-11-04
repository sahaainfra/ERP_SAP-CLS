import { useEffect, useRef, useState } from 'react';
import { api } from '../../../platform/api/index.js';
import { formatDateTime, toCsv } from '../../../platform/format.js';
import { Field, FormDialog, Pager, QueryState, can, downloadCsv, errorInfo, usePageTitle } from '../../core/pages/ui.jsx';
import { FieldInput, readForm } from '../components/OrgList.jsx';
import UserImport from '../components/UserImport.jsx';
import { CHANNELS, USER_FIELDS, USER_STATUS, USER_TYPES, UserStatusChip, roleLabel, typeLabel } from '../components/userCommon.jsx';
import { checkDuplicates, listParams, useBulkUsers, useCreateUser, useUserRoles, useUsers } from '../api/users.js';
import { useOrgList } from '../api/org.js';
import UserPage from './UserPage.jsx';

const COLUMNS = [
  { key: 'displayName', label: 'Name', sort: 'displayName' },
  { key: 'username', label: 'Username', sort: 'username' },
  { key: 'email', label: 'Email' },
  { key: 'mobile', label: 'Mobile' },
  { key: 'userType', label: 'Type', render: (r) => typeLabel(r.userType), text: (r) => r.userType },
  { key: 'departmentName', label: 'Department' },
  { key: 'projectName', label: 'Home project' },
  { key: 'roles', label: 'Roles', render: (r) => (r.roles.length ? r.roles.map(roleLabel).join(', ') : 'None yet'), text: (r) => r.roles.join(' ') },
  { key: 'status', label: 'Status', sort: 'status', text: (r) => USER_STATUS[r.status]?.[0] ?? r.status },
  { key: 'lastLoginAt', label: 'Last sign-in', sort: 'lastLoginAt', render: (r) => (r.lastLoginAt ? formatDateTime(r.lastLoginAt) : 'Never'), text: (r) => r.lastLoginAt ?? '' },
];
const DEFAULT_COLS = ['displayName', 'username', 'userType', 'departmentName', 'roles', 'status', 'lastLoginAt'];
const COL_KEY = 'erp.cols.users';
const VARIANT_KEY = 'erp.variants.users';

const read = (key, fallback) => {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null');
    return v ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* the choice lasts for this page view */ }
};

function Lookup({ entity, label, value, onChange }) {
  const list = useOrgList(entity, { pageSize: 200 });
  return (
    <label className="field field-inline"><span className="sr-only">{label}</span>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{label}: any</option>
        {(list.data?.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
    </label>
  );
}

/** Users (Administration > Users): a list, and one person's page when a name is opened. */
export default function UsersPage({ session }) {
  usePageTitle('Users');
  const [openId, setOpenId] = useState(null);
  if (openId) return <UserPage id={openId} session={session} onBack={() => setOpenId(null)} />;
  return <UserList session={session} onOpen={setOpenId} />;
}

function UserList({ session, onOpen }) {
  const manage = can(session, 'iam.user.manage');
  const suspend = can(session, 'iam.user.suspend');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [q, setQ] = useState(() => new URLSearchParams(window.location.search).get('q') ?? ''); // global search opens the page with the person's username (part 03.08)
  const [sort, setSort] = useState('displayName');
  const [filter, setFilter] = useState({});
  const [visible, setVisible] = useState(() => read(COL_KEY, DEFAULT_COLS).filter((k) => COLUMNS.some((c) => c.key === k)));
  const [variants, setVariants] = useState(() => read(VARIANT_KEY, []));
  const [selected, setSelected] = useState(() => new Set());
  const [notice, setNotice] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [dupes, setDupes] = useState([]);
  const [formKey, setFormKey] = useState(0);
  const list = useUsers({ page, pageSize, q, sort, filters: filter });
  const roles = useUserRoles();
  const create = useCreateUser();
  const bulk = useBulkUsers();
  const createDialog = useRef(null);
  useEffect(() => { if (manage && new URLSearchParams(window.location.search).get('invite') === '1') { setFormKey((k) => k + 1); createDialog.current?.showModal?.(); } }, [manage]); // the palette command "Invite a person"
  const suspendDialog = useRef(null);
  const importDialog = useRef(null);
  const variantDialog = useRef(null);
  const rows = list.data?.data ?? [];
  const shown = COLUMNS.filter((c) => visible.includes(c.key));

  useEffect(() => { setSelected(new Set()); }, [page, pageSize, q, sort, filter]);

  const setCols = (next) => { setVisible(next); write(COL_KEY, next); };
  const setF = (name, value) => { setFilter((f) => ({ ...f, [name]: value })); setPage(1); };
  const toggle = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));

  const exportCsv = async () => {
    const all = [];
    for (let p = 1; p <= 50; p += 1) {
      const res = await api.get(`/iam/users?${new URLSearchParams(listParams({ page: p, pageSize: 200, q, sort, filters: filter }))}`);
      all.push(...res.data);
      if (p >= res.meta.totalPages) break;
    }
    downloadCsv('users.csv', toCsv(shown.map((c) => c.label), all.map((r) => shown.map((c) => (c.text ? c.text(r) : r[c.key] ?? '')))));
  };

  const saveVariant = (f) => {
    const name = String(f.get('name')).trim();
    if (!name) return;
    const next = [...variants.filter((v) => v.name !== name), { name, q, sort, filter, pageSize, visible }];
    setVariants(next);
    write(VARIANT_KEY, next);
    variantDialog.current?.close();
    setNotice(`View "${name}" was saved in this browser.`);
  };
  const applyVariant = (name) => {
    const v = variants.find((x) => x.name === name);
    if (!v) return;
    setQ(v.q); setSort(v.sort); setFilter(v.filter); setPageSize(v.pageSize); setVisible(v.visible); setPage(1);
  };

  const runBulk = async (action, reason) => {
    setNotice('');
    setResult(null);
    try {
      const out = await bulk.mutateAsync({ action, ids: [...selected], ...(reason ? { reason } : {}) });
      setResult(out);
      setSelected(new Set());
      setNotice(`${action === 'invite' ? 'Invited' : 'Suspended'} ${out.succeeded} of ${out.requested}${out.failed ? `; ${out.failed} could not be done (below)` : ''}.`);
      return true;
    } catch (err) {
      setNotice(errorInfo(err).form);
      return false;
    }
  };

  const lookDupes = async (form) => {
    const params = { email: form.get('email'), mobile: form.get('mobile'), employeeCode: form.get('employeeCode') };
    if (!params.email && !params.mobile && !params.employeeCode) return setDupes([]);
    try { setDupes(await checkDuplicates(params)); } catch { setDupes([]); }
  };

  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Users</nav>
      <div className="page-head"><h1 id="page-title">Users</h1></div>
      <p className="muted">Every person has one account and no access until a role is approved. New people are invited, set their own password, and wait in Onboarding until a role is granted.</p>
      <p role="status" className="notice" data-testid="users-notice">{notice}</p>
      {result?.failed > 0 && (
        <div className="state state-error" role="alert" data-testid="bulk-result">
          <h3>Not done</h3>
          <ul>{result.results.filter((r) => !r.ok).map((r) => <li key={r.id}>User {r.id}: {r.error}</li>)}</ul>
        </div>
      )}

      <div className="toolbar">
        <label className="field field-inline"><span className="sr-only">Search users</span><input type="search" placeholder="Search name, username, email, employee" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></label>
        <label className="field field-inline"><span className="sr-only">Status</span>
          <select aria-label="Status" value={filter.status ?? ''} onChange={(e) => setF('status', e.target.value)}>
            <option value="">Status: any</option>
            {Object.entries(USER_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className="field field-inline"><span className="sr-only">Type</span>
          <select aria-label="Type" value={filter.type ?? ''} onChange={(e) => setF('type', e.target.value)}>
            <option value="">Type: any</option>
            {USER_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <Lookup entity="departments" label="Department" value={filter.departmentId ?? ''} onChange={(v) => setF('departmentId', v)} />
        <Lookup entity="projects" label="Project" value={filter.projectId ?? ''} onChange={(v) => setF('projectId', v)} />
        <label className="field field-inline"><span className="sr-only">Role</span>
          <select aria-label="Role" value={filter.role ?? ''} onChange={(e) => setF('role', e.target.value)}>
            <option value="">Role: any</option>
            {(roles.data ?? []).map((r) => <option key={r.code} value={r.code}>{roleLabel(r.code)}</option>)}
          </select>
        </label>
        <label className="field field-inline"><span className="sr-only">Rows per page</span>
          <select aria-label="Rows per page" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>{[25, 50, 100].map((n) => <option key={n} value={n}>{n} per page</option>)}</select>
        </label>
        <details className="col-chooser">
          <summary className="btn">Columns</summary>
          <div className="col-chooser-list" role="group" aria-label="Choose columns">
            {COLUMNS.map((c) => (
              <label key={c.key}><input type="checkbox" checked={visible.includes(c.key)} disabled={visible.length === 1 && visible.includes(c.key)} onChange={(e) => setCols(e.target.checked ? [...visible, c.key] : visible.filter((k) => k !== c.key))} /> {c.label}</label>
            ))}
          </div>
        </details>
        {variants.length > 0 && (
          <label className="field field-inline"><span className="sr-only">Saved views</span>
            <select aria-label="Saved views" value="" onChange={(e) => applyVariant(e.target.value)}>
              <option value="">Saved views</option>
              {variants.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
            </select>
          </label>
        )}
        <button type="button" className="btn" onClick={() => variantDialog.current?.showModal()}>Save view</button>
        <button type="button" className="btn" disabled={rows.length === 0} onClick={exportCsv}>Export CSV</button>
        {manage && <button type="button" className="btn" onClick={() => importDialog.current?.showModal()}>Import users</button>}
        {manage && <button type="button" className="btn btn-primary" onClick={() => { setError(null); setDupes([]); setFormKey((k) => k + 1); createDialog.current?.showModal(); }}>Invite user</button>}
      </div>

      {selected.size > 0 && (
        <div className="toolbar" role="group" aria-label="Actions for the selected users" data-testid="bulk-bar">
          <strong>{selected.size} selected</strong>
          {manage && <button type="button" className="btn" disabled={bulk.isPending} onClick={() => runBulk('invite')}>Send invitations</button>}
          {suspend && <button type="button" className="btn" disabled={bulk.isPending} onClick={() => suspendDialog.current?.showModal()}>Suspend</button>}
          <button type="button" className="btn" onClick={() => setSelected(new Set())}>Clear selection</button>
        </div>
      )}

      <QueryState query={list} what="users" permission="iam.user.view" />
      {list.data && rows.length === 0 && (
        <div className="state">
          <h2>No users</h2>
          <p>{q || Object.values(filter).some(Boolean) ? 'Nothing matches those filters.' : manage ? 'Invite the first person to get started.' : 'No users have been set up yet.'}</p>
          {manage && !q && <button type="button" className="btn btn-primary" onClick={() => { setError(null); setDupes([]); setFormKey((k) => k + 1); createDialog.current?.showModal(); }}>Invite user</button>}
        </div>
      )}
      {rows.length > 0 && (
        <>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Users</caption>
              <thead>
                <tr>
                  <th><input type="checkbox" aria-label="Select all users on this page" checked={allOnPage} onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></th>
                  {shown.map((c) => (
                    <th key={c.key} aria-sort={sort === c.sort ? 'ascending' : sort === `-${c.sort}` ? 'descending' : undefined}>
                      {c.sort ? <button type="button" className="th-sort" onClick={() => setSort((s) => (s === c.sort ? `-${c.sort}` : c.sort))}>{c.label}{sort === c.sort ? ' ▲' : sort === `-${c.sort}` ? ' ▼' : ''}</button> : c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} data-testid={`user-row-${r.username}`}>
                    <td data-label="Select"><input type="checkbox" aria-label={`Select ${r.displayName}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} /></td>
                    {shown.map((c, i) => (
                      <td key={c.key} data-label={c.label}>
                        {i === 0 ? <a href="#open" onClick={(e) => { e.preventDefault(); onOpen(r.id); }}>{c.render ? c.render(r) : r[c.key]}</a>
                          : c.key === 'status' ? (
                            <>
                              <UserStatusChip status={r.status} />
                              {r.status === 'INVITED' && r.invitation && <div className="muted small">{r.invitation.status === 'PENDING' ? `Invitation expires ${formatDateTime(r.invitation.expiresAt)}` : `Invitation ${r.invitation.status.toLowerCase()}`}</div>}
                              {r.status === 'INVITED' && !r.invitation && <div className="muted small">Not invited yet</div>}
                            </>
                          ) : c.render ? c.render(r) : (r[c.key] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager meta={list.data.meta} page={page} setPage={setPage} noun="users" />
        </>
      )}

      <FormDialog
        dialogRef={createDialog}
        title="Invite a user"
        reason={false}
        submitLabel="Create user"
        error={error}
        busy={create.isPending}
        onSubmit={async (f) => {
          setError(null);
          try {
            const body = { ...readForm(f, USER_FIELDS, { creating: true }), invite: f.get('invite') === 'on', ...(f.get('channel') ? { channel: f.get('channel') } : {}) };
            const out = await create.mutateAsync(body);
            createDialog.current?.close();
            const sent = out.inviteResult?.invitation ? ` An invitation was sent by ${out.inviteResult.invitation.channel}${out.inviteResult.delivered ? '' : ' but could not be delivered; check the connector and resend'}.` : out.inviteResult?.error ? ` The invitation was not sent: ${out.inviteResult.error}` : ' No invitation was sent yet.';
            setNotice(`${out.displayName} (${out.username}) was created as Invited.${sent}${out.inviteResult?.devLink ? ` Development link: ${out.inviteResult.devLink}` : ''}`);
          } catch (err) {
            setError(errorInfo(err));
          }
        }}
      >
        <div key={formKey} className="form-grid" onBlurCapture={(e) => lookDupes(new FormData(e.currentTarget.closest('form')))}>
          {USER_FIELDS.map((s) => <FieldInput key={s.name} spec={s} row={null} error={error} />)}
          <Field label="Send the invitation by" name="channel" error={error}>
            <select name="channel" defaultValue="">
              <option value="">Email if there is one, else text message</option>
              {CHANNELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <label className="field"><span><input type="checkbox" name="invite" defaultChecked /> Send the invitation now</span></label>
        </div>
        {dupes.length > 0 && (
          <div className="state state-error" role="alert" data-testid="duplicate-warning">
            <h3>This person may already have an account</h3>
            <ul>{dupes.map((d, i) => <li key={i}>{d.otherCompany ? `The ${d.field} is used by an account of another company.` : `The ${d.field} matches ${d.displayName} (${d.username}, ${USER_STATUS[d.status]?.[0].toLowerCase()}).`}</li>)}</ul>
          </div>
        )}
      </FormDialog>

      <FormDialog
        dialogRef={suspendDialog}
        title={`Suspend ${selected.size} user(s)`}
        submitLabel="Suspend"
        busy={bulk.isPending}
        onSubmit={async (f) => { if (await runBulk('suspend', String(f.get('reason')))) suspendDialog.current?.close(); }}
      >
        <p className="muted">Their sessions end now and they cannot sign in until reactivated. Only Active and Onboarding accounts can be suspended.</p>
      </FormDialog>

      <FormDialog dialogRef={variantDialog} title="Save this view" reason={false} onSubmit={saveVariant}>
        <p className="muted">Keeps the search, filters, sort, columns and page size under a name, in this browser.</p>
        <Field label="Name of the view" name="name"><input name="name" required maxLength={40} /></Field>
      </FormDialog>

      <dialog ref={importDialog} className="dialog dialog-wide" aria-labelledby="import-title">
        <UserImport onClose={() => importDialog.current?.close()} onDone={(msg) => setNotice(msg)} />
      </dialog>
    </section>
  );
}
