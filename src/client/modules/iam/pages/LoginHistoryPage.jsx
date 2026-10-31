import { useRef, useState } from 'react';
import { formatDateTime, toCsv } from '../../../platform/format.js';
import { FormDialog, Link, Pager, QueryState, can, downloadCsv, errorInfo, usePageTitle } from '../../core/pages/ui.jsx';
import { useAdminSessions, useAdminUsers, useLoginEvents, useRevokeAny, useSignOutUser, useUnlockUser } from '../api/index.js';

const RESULTS = {
  success: 'Signed in', failure: 'Failed', locked: 'Locked', mfa_required: 'Second step asked', mfa_failed: 'Second step failed', suspicious: 'Suspicious', refresh_reuse: 'Token reuse', logout: 'Signed out',
  forced_logout: 'Forced sign-out', password_changed: 'Password changed', password_reset: 'Password reset', pin_unlock: 'PIN unlock', pin_failed: 'PIN failed',
};
const CHIP = { success: 'chip-pass', failure: 'chip-never', locked: 'chip-fail', mfa_failed: 'chip-never', suspicious: 'chip-fail', refresh_reuse: 'chip-fail', forced_logout: 'chip-never' };

function History() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ q: '', user: '', result: '', from: '', to: '' });
  const events = useLoginEvents({ page, ...filters });
  const set = (k) => (e) => { setFilters((f) => ({ ...f, [k]: e.target.value })); setPage(1); };
  const rows = events.data?.data ?? [];
  const exportCsv = () =>
    downloadCsv('login-history.csv', toCsv(['When (IST)', 'User', 'Result', 'Address', 'Country', 'Device', 'Note'], rows.map((e) => [formatDateTime(e.at), e.user ?? '', RESULTS[e.result] ?? e.result, e.ip ?? '', e.country ?? '', e.device ?? '', e.reason ?? ''])));
  return (
    <>
      <div className="toolbar">
        <label className="field field-inline"><span className="sr-only">Search</span><input type="search" placeholder="Search user, address or note" value={filters.q} onChange={set('q')} /></label>
        <label className="field field-inline"><span className="sr-only">User</span><input placeholder="Exact username" value={filters.user} onChange={set('user')} /></label>
        <label className="field field-inline"><span className="sr-only">Result</span>
          <select value={filters.result} onChange={set('result')}><option value="">Any result</option>{Object.entries(RESULTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
        <label className="field field-inline"><span>From</span><input type="date" value={filters.from} onChange={set('from')} /></label>
        <label className="field field-inline"><span>To</span><input type="date" value={filters.to} onChange={set('to')} /></label>
        <button type="button" className="btn" disabled={rows.length === 0} onClick={exportCsv}>Export CSV</button>
      </div>
      <QueryState query={events} what="the login history" permission="iam.security.view" />
      {events.data && rows.length === 0 && <div className="state"><h2>No sign-in activity</h2><p>{Object.values(filters).some(Boolean) ? 'Nothing matches those filters.' : 'Nobody has signed in yet.'}</p></div>}
      {rows.length > 0 && (
        <>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Sign-in activity, newest first</caption>
              <thead><tr><th>When (IST)</th><th>User</th><th>Result</th><th>Address</th><th>Device</th><th>Note</th></tr></thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} data-testid={`event-${e.id}`} className={e.result === 'suspicious' ? 'row-bad' : ''}>
                    <td data-label="When">{formatDateTime(e.at)}</td>
                    <td data-label="User">{e.user ?? '-'}</td>
                    <td data-label="Result"><span className={`chip ${CHIP[e.result] ?? 'chip-not_applicable'}`}>{RESULTS[e.result] ?? e.result}</span></td>
                    <td data-label="Address">{e.ip ?? '-'}{e.country ? ` (${e.country})` : ''}</td>
                    <td data-label="Device">{e.device ?? '-'}</td>
                    <td data-label="Note">{e.reason ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager meta={events.data.meta} page={page} setPage={setPage} noun="events" />
        </>
      )}
    </>
  );
}

function Sessions({ canManage }) {
  const [page, setPage] = useState(1);
  const sessions = useAdminSessions({ page });
  const revoke = useRevokeAny();
  const dialog = useRef(null);
  const [target, setTarget] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const rows = sessions.data?.data ?? [];
  return (
    <>
      <p role="status" className="notice" data-testid="sessions-admin-notice">{notice}</p>
      <QueryState query={sessions} what="active sessions" permission="iam.security.view" />
      {sessions.data && rows.length === 0 && <div className="state"><h2>No active sessions</h2></div>}
      {rows.length > 0 && (
        <>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Active sessions of the company</caption>
              <thead><tr><th>User</th><th>Device</th><th>Address</th><th>Signed in</th><th>Last active</th><th /></tr></thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} data-testid={`admin-session-${s.user}`}>
                    <td data-label="User">{s.user}</td><td data-label="Device">{s.device ?? '-'}</td><td data-label="Address">{s.ip ?? '-'}</td>
                    <td data-label="Signed in">{formatDateTime(s.createdAt)}</td><td data-label="Last active">{formatDateTime(s.lastSeenAt)}</td>
                    <td data-label="Force"><button type="button" className="btn btn-small" disabled={!canManage} aria-label={`Force sign-out of ${s.user} on ${s.device ?? 'a device'}`} onClick={() => { setTarget(s); setError(null); dialog.current?.showModal(); }}>Force sign-out</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager meta={sessions.data.meta} page={page} setPage={setPage} noun="sessions" />
        </>
      )}
      <FormDialog
        dialogRef={dialog}
        title={`Force sign-out of ${target?.user ?? ''}`}
        error={error}
        busy={revoke.isPending}
        submitLabel="Sign them out"
        onSubmit={async (f) => {
          setError(null);
          try {
            await revoke.mutateAsync({ id: target.id, reason: String(f.get('reason')) });
            dialog.current?.close();
            setNotice(`${target.user} was signed out on ${target.device ?? 'that device'}. It takes effect on their next request.`);
          } catch (err) {
            setError(errorInfo(err));
          }
        }}
      >
        <p className="muted">The session ends at once and is recorded in the audit trail with your reason.</p>
      </FormDialog>
    </>
  );
}

function Users({ canManage }) {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const users = useAdminUsers({ page, q });
  const signOut = useSignOutUser();
  const unlock = useUnlockUser();
  const dialog = useRef(null);
  const [target, setTarget] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const rows = users.data?.data ?? [];
  return (
    <>
      <div className="toolbar"><label className="field field-inline"><span className="sr-only">Search users</span><input type="search" placeholder="Search username or name" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></label></div>
      <p role="status" className="notice" data-testid="users-notice">{notice}</p>
      <QueryState query={users} what="users" permission="iam.security.view" />
      {rows.length > 0 && (
        <>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Users with their second-step and lock state</caption>
              <thead><tr><th>User</th><th>Roles</th><th>Second step</th><th>State</th><th className="num">Sessions</th><th>Last sign-in</th><th /></tr></thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.username} data-testid={`user-${u.username}`}>
                    <td data-label="User"><strong>{u.username}</strong><div className="muted small">{u.displayName}</div></td>
                    <td data-label="Roles">{u.roles.join(', ')}</td>
                    <td data-label="Second step"><span className={`chip ${u.mfaEnrolled ? 'chip-pass' : u.mfaRequired ? 'chip-fail' : 'chip-not_applicable'}`}>{u.mfaEnrolled ? 'Enrolled' : u.mfaRequired ? 'Required, not set up' : 'Not set up'}</span></td>
                    <td data-label="State">{u.status !== 'ACTIVE' ? 'Disabled' : u.locked ? <span className="chip chip-fail">Locked</span> : 'Active'}</td>
                    <td data-label="Sessions" className="num">{u.liveSessions}</td>
                    <td data-label="Last sign-in">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Never'}</td>
                    <td data-label="Actions">
                      <div className="actions">
                        <button type="button" className="btn btn-small" disabled={!canManage || !u.locked} onClick={() => { setTarget({ ...u, kind: 'unlock' }); setError(null); dialog.current?.showModal(); }} aria-label={`Unlock ${u.username}`}>Unlock</button>
                        <button type="button" className="btn btn-small" disabled={!canManage || u.liveSessions === 0} onClick={() => { setTarget({ ...u, kind: 'signout' }); setError(null); dialog.current?.showModal(); }} aria-label={`Sign out ${u.username} everywhere`}>Sign out everywhere</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager meta={users.data.meta} page={page} setPage={setPage} noun="users" />
        </>
      )}
      <FormDialog
        dialogRef={dialog}
        title={target?.kind === 'unlock' ? `Unlock ${target?.username}` : `Sign ${target?.username ?? ''} out everywhere`}
        error={error}
        busy={signOut.isPending || unlock.isPending}
        submitLabel={target?.kind === 'unlock' ? 'Unlock' : 'Sign out everywhere'}
        onSubmit={async (f) => {
          setError(null);
          try {
            const reason = String(f.get('reason'));
            if (target.kind === 'unlock') await unlock.mutateAsync({ username: target.username, reason });
            else await signOut.mutateAsync({ username: target.username, reason });
            dialog.current?.close();
            setNotice(target.kind === 'unlock' ? `${target.username} can sign in again.` : `${target.username} was signed out everywhere.`);
          } catch (err) {
            setError(errorInfo(err));
          }
        }}
      >
        <p className="muted">Recorded in the audit trail with your reason.</p>
      </FormDialog>
    </>
  );
}

const TABS = [['history', 'Login history'], ['sessions', 'Active sessions'], ['users', 'Users']];

export default function LoginHistoryPage({ session }) {
  usePageTitle('Login History');
  const [tab, setTab] = useState('history');
  const canManage = can(session, 'iam.security.manage');
  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Security &rsaquo; Login History</nav>
      <div className="page-head"><h1 id="page-title">Login History</h1></div>
      <p className="muted">Who signed in, from where, and what was refused. Unknown names that failed to sign in are listed too. <Link to="/admin/security/policy">Authentication policy</Link></p>
      <div role="tablist" aria-label="Security views" className="actions">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" id={`tab-${id}`} aria-selected={tab === id} className={`btn${tab === id ? ' btn-primary' : ''}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      <div role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'history' && <History />}
        {tab === 'sessions' && <Sessions canManage={canManage} />}
        {tab === 'users' && <Users canManage={canManage} />}
      </div>
    </section>
  );
}
