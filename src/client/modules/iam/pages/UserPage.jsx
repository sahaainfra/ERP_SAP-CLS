import { useRef, useState } from 'react';
import { api } from '../../../platform/api/index.js';
import { formatDateTime } from '../../../platform/format.js';
import { Field, FormDialog, Link, Pager, QueryState, can, errorInfo, usePageTitle } from '../../core/pages/ui.jsx';
import { FieldInput, readForm } from '../components/OrgList.jsx';
import { CHANNELS, USER_FIELDS, UserStatusChip, roleLabel, typeLabel } from '../components/userCommon.jsx';
import {
  useDeactivateUser, useDeactivationCheck, useInviteUser, useReactivateUser, useRequestRoles, useRevokeInvitation, useRevokeRoles, useSuspendUser, useUpdateUser, useUser, useUserLoginEvents, useUserRoles, useUserSessions,
  useUserTimeline, useUsers,
} from '../api/users.js';
import { useQueryClient } from '@tanstack/react-query';
import PageHeader from '../../../platform/design/PageHeader.jsx';
import { KpiRow } from '../../../platform/design/Kpi.jsx';

const TABS = [['details', 'Details'], ['assignments', 'Assignments'], ['sessions', 'Sessions'], ['history', 'Login history'], ['approvals', 'Approvals'], ['timeline', 'Timeline']];
const REQUEST_STATUS = { SUBMITTED: 'Waiting', APPROVED: 'Approved', REJECTED: 'Rejected', RETURNED: 'Returned', CANCELLED: 'Withdrawn' };
const REQUEST_CHIP = { SUBMITTED: 'chip-not_applicable', APPROVED: 'chip-pass', REJECTED: 'chip-fail', RETURNED: 'chip-fail', CANCELLED: 'chip-never' };
const RESULT = { success: 'Signed in', failure: 'Wrong details', locked: 'Locked', suspicious: 'Unusual sign-in', mfa_failed: 'Wrong second-step code', mfa_required: 'Second step asked', logout: 'Signed out', forced_logout: 'Signed out by an administrator', refresh_reuse: 'Session ended (token reuse)', password_changed: 'Password changed', password_reset: 'Password reset', pin_failed: 'Wrong PIN' };
const ACTIONS = {
  create: 'Account created', update: 'Details changed', invited: 'Invitation sent', invitation_resent: 'Invitation sent again', invitation_revoked: 'Invitation withdrawn', invitation_accepted: 'Invitation accepted',
  suspend: 'Suspended', reactivate: 'Reactivated', deactivate: 'Deactivated', roles_granted: 'Roles granted after approval', roles_revoked: 'Roles taken away', profile_update: 'Profile changed',
  forced_sign_out_all: 'All sessions ended by an administrator', unlocked: 'Sign-in lock cleared', import: 'Imported',
};

const dl = (rows) => (
  <dl className="facts">
    {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v || <span className="muted">Not set</span>}</dd></div>)}
  </dl>
);

/** One person: header with the actions their state and your role allow, and the tabs. */
export default function UserPage({ id, session, onBack }) {
  const q = useUser(id);
  const u = q.data;
  usePageTitle(u ? u.displayName : 'User');
  const manage = can(session, 'iam.user.manage');
  const suspend = can(session, 'iam.user.suspend');
  const [tab, setTab] = useState('details');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState(null);
  const [which, setWhich] = useState('');
  const [reasonKind, setReasonKind] = useState('suspend');
  const editDialog = useRef(null);
  const inviteDialog = useRef(null);
  const reasonDialog = useRef(null);
  const roleDialog = useRef(null);
  const revokeDialog = useRef(null);
  const deactivateDialog = useRef(null);
  const signOutDialog = useRef(null);
  const update = useUpdateUser();
  const invite = useInviteUser();
  const withdraw = useRevokeInvitation();
  const suspendU = useSuspendUser();
  const reactivate = useReactivateUser();
  const deactivate = useDeactivateUser();
  const requestRoles = useRequestRoles();
  const revokeRoles = useRevokeRoles();
  const qc = useQueryClient();
  const open = (ref, name) => { setError(null); setWhich(name); ref.current?.showModal(); };
  const saveNotice = (m) => setNotice(m);

  const lifecycle = u?.status;
  const canRole = manage && u && ['INVITED', 'ONBOARDING', 'ACTIVE'].includes(lifecycle);
  const canInvite = manage && lifecycle === 'INVITED' && u.userType !== 'SERVICE_ACCOUNT';

  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb"><a href="#back" onClick={(e) => { e.preventDefault(); onBack(); }}>Administration &rsaquo; Users</a> &rsaquo; {u?.displayName ?? '...'}</nav>
      <QueryState query={q} what="this user" permission="iam.user.view" />
      {u && (
        <>
          <div className="page-head">
            <div>
              <PageHeader id="page-title" title={u.displayName} subtitle={<>{u.username} · <UserStatusChip status={u.status} /> · {typeLabel(u.userType)}{u.statusReason ? ` · ${u.statusReason}` : ''}</>} />
            </div>
            <div className="actions">
              <button type="button" className="btn" onClick={onBack}>Back to the list</button>
              <button type="button" className="btn" onClick={() => q.refetch()} disabled={q.isFetching}>{q.isFetching ? 'Refreshing...' : 'Refresh'}</button>
              {manage && lifecycle !== 'DEACTIVATED' && <button type="button" className="btn" onClick={() => open(editDialog, 'edit')}>Edit details</button>}
              {canInvite && <button type="button" className="btn btn-primary" onClick={() => open(inviteDialog, 'invite')}>{u.invitation ? 'Send the invitation again' : 'Send an invitation'}</button>}
              {canInvite && u.invitation?.status === 'PENDING' && <button type="button" className="btn" onClick={async () => { try { await withdraw.mutateAsync(u.id); saveNotice('The invitation was withdrawn.'); } catch (err) { saveNotice(errorInfo(err).form); } }}>Withdraw the invitation</button>}
              {canRole && <button type="button" className="btn" onClick={() => open(roleDialog, 'roles')}>Request a role</button>}
              {suspend && ['ACTIVE', 'ONBOARDING'].includes(lifecycle) && <button type="button" className="btn" onClick={() => { setReasonKind('suspend'); open(reasonDialog, 'reason'); }}>Suspend</button>}
              {((suspend && lifecycle === 'SUSPENDED') || (manage && lifecycle === 'DEACTIVATED')) && <button type="button" className="btn" onClick={() => { setReasonKind('reactivate'); open(reasonDialog, 'reason'); }}>Reactivate</button>}
              {manage && lifecycle !== 'DEACTIVATED' && <button type="button" className="btn" onClick={() => open(deactivateDialog, 'deactivate')}>Deactivate</button>}
            </div>
          </div>
          <p role="status" className="notice" data-testid="user-notice">{notice}</p>
          <KpiRow>
            <div className="tile"><span className="tile-value">{u.roles.length}</span><span className="tile-label">Roles</span></div>
            <div className="tile"><span className="tile-value">{u.liveSessions}</span><span className="tile-label">Live sessions</span></div>
            <div className="tile"><span className="tile-value">{u.mfaEnrolled ? 'Yes' : 'No'}</span><span className="tile-label">Second step set up</span></div>
            <div className="tile"><span className="tile-value">{u.requests.filter((r) => r.status === 'SUBMITTED').length}</span><span className="tile-label">Requests waiting</span></div>
          </KpiRow>
          {lifecycle === 'ONBOARDING' && <p className="notice" role="note" data-testid="onboarding-note">This person has joined but holds no approved role, so they see only a welcome page and their profile. Request a role to give them access.</p>}

          <div role="tablist" aria-label="User sections" className="actions">
            {TABS.map(([k, l]) => <button key={k} type="button" role="tab" id={`utab-${k}`} aria-selected={tab === k} className={`btn${tab === k ? ' btn-primary' : ''}`} onClick={() => setTab(k)}>{l}</button>)}
          </div>
          <div role="tabpanel" aria-labelledby={`utab-${tab}`}>
            {tab === 'details' && (
              <div className="card">
                {dl([
                  ['Name', u.displayName], ['Username', u.username], ['Email', u.email], ['Mobile', u.mobile], ['Language', u.language === 'hi' ? 'Hindi' : 'English'], ['Type', typeLabel(u.userType)],
                  ['Employee code', u.employeeCode], ['Employee record', u.employeeId ? `#${u.employeeId}` : u.employeeCode ? 'Waiting for the employee master (part 07.01)' : ''], ['Department', u.departmentName], ['Home project', u.projectName],
                  ['Created', `${formatDateTime(u.createdAt)}${u.createdBy ? ` by ${u.createdBy}` : ''}`], ['Last sign-in', u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Never'],
                  ['Password set', u.hasPassword ? 'Yes' : 'No: not accepted the invitation yet'], ['Invitation', u.invitation ? `${u.invitation.status.toLowerCase()} (${u.invitation.channel} to ${u.invitation.sentTo}), ${u.invitation.status === 'PENDING' ? `expires ${formatDateTime(u.invitation.expiresAt)}` : `sent ${formatDateTime(u.invitation.sentAt)}`}${u.invitation.delivered ? '' : '; not delivered'}` : ''],
                ])}
              </div>
            )}
            {tab === 'assignments' && <Assignments u={u} manage={manage} onRevoke={() => open(revokeDialog, 'revoke')} />}
            {tab === 'sessions' && <Sessions u={u} canSignOut={can(session, 'iam.security.manage')} onSignOut={() => open(signOutDialog, 'signout')} />}
            {tab === 'history' && <History id={u.id} />}
            {tab === 'approvals' && <Approvals u={u} />}
            {tab === 'timeline' && <Timeline id={u.id} />}
          </div>

          <FormDialog
            dialogRef={editDialog}
            title={`Edit ${u.displayName}`}
            error={error}
            busy={update.isPending}
            onSubmit={async (f) => {
              setError(null);
              try {
                await update.mutateAsync({ id: u.id, version: u.version, ...readForm(f, USER_FIELDS, { creating: false }), reason: String(f.get('reason')) });
                editDialog.current?.close();
                saveNotice('The details were saved.');
              } catch (err) { setError(errorInfo(err)); }
            }}
          >
            <div key={`${u.id}-${u.version}`} className="form-grid">
              {USER_FIELDS.filter((s) => !s.createOnly).map((s) => <FieldInput key={s.name} spec={s} row={u} error={error} />)}
            </div>
            <p className="muted small">The mobile number shown is the stored one{manage ? '' : ' (masked for your role)'}.</p>
          </FormDialog>

          <FormDialog
            dialogRef={inviteDialog}
            title={u.invitation ? 'Send the invitation again' : 'Send an invitation'}
            reason={false}
            submitLabel="Send"
            error={error}
            busy={invite.isPending}
            onSubmit={async (f) => {
              setError(null);
              try {
                const out = await invite.mutateAsync({ id: u.id, ...(f.get('channel') ? { channel: f.get('channel') } : {}) });
                inviteDialog.current?.close();
                saveNotice(`Invitation sent by ${out.invitation.channel} to ${out.invitation.sentTo}${out.delivered ? '' : ' but it could not be delivered: check the connector, then send again'}; it works until ${formatDateTime(out.invitation.expiresAt)}.${out.devLink ? ` Development link: ${out.devLink}` : ''}`);
              } catch (err) { setError(errorInfo(err)); }
            }}
          >
            <p className="muted">A new link replaces any earlier one. It lets the person choose their password; it works once and expires in 7 days.</p>
            <Field label="Send by" name="channel" error={error}>
              <select name="channel" defaultValue="">
                <option value="">Email if there is one, else text message</option>
                {CHANNELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
          </FormDialog>

          <FormDialog
            dialogRef={reasonDialog}
            title={reasonKind === 'suspend' ? `Suspend ${u.displayName}` : `Reactivate ${u.displayName}`}
            submitLabel={reasonKind === 'suspend' ? 'Suspend' : 'Reactivate'}
            error={error}
            busy={suspendU.isPending || reactivate.isPending}
            onSubmit={async (f) => {
              setError(null);
              try {
                const body = { id: u.id, version: u.version, reason: String(f.get('reason')) };
                const out = reasonKind === 'suspend' ? await suspendU.mutateAsync(body) : await reactivate.mutateAsync(body);
                reasonDialog.current?.close();
                saveNotice(reasonKind === 'suspend' ? `${u.displayName} is suspended and every session has ended.` : `${u.displayName} is ${out.status.toLowerCase()} again.`);
              } catch (err) { setError(errorInfo(err)); }
            }}
          >
            <p className="muted">{reasonKind === 'suspend' ? 'Every session ends now and sign-in is refused until the account is reactivated. Roles are kept.' : u.status === 'DEACTIVATED' ? 'The person returns with the password they had and no role: access needs a new approval.' : 'The person can sign in again with their roles.'}</p>
          </FormDialog>

          <RoleDialog dialogRef={roleDialog} u={u} busy={requestRoles.isPending} error={error}
            onSubmit={async (f) => {
              setError(null);
              try {
                const out = await requestRoles.mutateAsync({ id: u.id, roles: f.getAll('roles'), reason: String(f.get('reason')) });
                roleDialog.current?.close();
                saveNotice(`Request ${out.id} was raised. It needs ${out.chain.join(' then ')} to approve it on the Approvals page; the roles apply when it is approved.`);
                setTab('approvals');
              } catch (err) { setError(errorInfo(err)); }
            }}
          />

          <FormDialog
            dialogRef={revokeDialog}
            title={`Take roles away from ${u.displayName}`}
            submitLabel="Take away"
            error={error}
            busy={revokeRoles.isPending}
            onSubmit={async (f) => {
              setError(null);
              try {
                await revokeRoles.mutateAsync({ id: u.id, roles: f.getAll('roles'), version: u.version, reason: String(f.get('reason')) });
                revokeDialog.current?.close();
                saveNotice('The roles were taken away.');
              } catch (err) { setError(errorInfo(err)); }
            }}
          >
            <p className="muted">Takes effect on their next request and is recorded. A person left with no role goes back to Onboarding.</p>
            <fieldset className="field"><legend>Roles to take away</legend>
              {u.roles.map((r) => <label key={r}><input type="checkbox" name="roles" value={r} /> {roleLabel(r)} ({r})</label>)}
            </fieldset>
            {error?.fields?.roles && <span className="field-error">{error.fields.roles}</span>}
          </FormDialog>

          <DeactivateDialog dialogRef={deactivateDialog} u={u} active={which === 'deactivate'} deactivate={deactivate} error={error} setError={setError}
            onDone={(out) => { deactivateDialog.current?.close(); const h = out.handedOver ?? {}; saveNotice(`${u.displayName} is deactivated: sessions ended, roles taken away${h.successor ? `, and the open items passed to ${h.successor} (${h.requests ?? 0} request(s), ${h.organisationRoles ?? 0} organisation role(s))` : ''}.`); }}
          />

          <FormDialog
            dialogRef={signOutDialog}
            title={`Sign ${u.displayName} out everywhere`}
            submitLabel="Sign out"
            error={error}
            onSubmit={async (f) => {
              setError(null);
              try {
                const out = await api.post(`/iam/admin/users/${encodeURIComponent(u.username)}/sign-out`, { reason: String(f.get('reason')) }, { headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
                signOutDialog.current?.close();
                await qc.invalidateQueries({ queryKey: ['iam'] });
                saveNotice(`${out.data.ended} session(s) ended.`);
              } catch (err) { setError(errorInfo(err)); }
            }}
          >
            <p className="muted">Ends every live session of this person at once. They can sign in again.</p>
          </FormDialog>
        </>
      )}
    </section>
  );
}

function Assignments({ u, manage, onRevoke }) {
  return (
    <div className="card">
      <h2>Roles</h2>
      {u.roles.length === 0 ? <p className="muted" data-testid="no-roles">No approved role yet: this person has no access beyond their own profile.</p>
        : <p data-testid="role-list">{u.roles.map((r) => <span key={r} className="chip chip-pass" style={{ marginRight: 6 }}>{roleLabel(r)}</span>)}</p>}
      {manage && u.roles.length > 0 && <button type="button" className="btn btn-small" onClick={onRevoke}>Take roles away</button>}
      <p className="muted small">Roles are granted by an approved request. To give a role for one project or site, or for a period, use <Link to={`/admin/assignments?userId=${u.id}`}>Assignments</Link>; to see what this person can do and why, open <Link to={`/admin/effective-access?userId=${u.id}`}>Effective Permissions</Link>.</p>
      <h2>Scoped assignments</h2>
      {(u.assignments ?? []).length === 0 ? <p className="muted">None. Roles above apply to the whole company.</p> : (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Role assignments of this person</caption>
            <thead><tr><th>Role</th><th>Held for</th><th>From</th><th>To</th><th>Status</th></tr></thead>
            <tbody>{u.assignments.map((a) => <tr key={a.id}><td data-label="Role">{a.roleCode}</td><td data-label="Held for">{a.scopeType === 'COMPANY' ? 'The whole company' : `${a.scopeType.toLowerCase()} ${a.scopeIds.join(', ')}`}</td><td data-label="From">{a.effectiveFrom ?? 'Approval'}</td><td data-label="To">{a.effectiveTo ?? 'No end'}</td><td data-label="Status">{a.status === 'ENDED' ? 'Ended' : 'Active'}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      <h2>Organisation roles</h2>
      {u.holdings.length === 0 ? <p className="muted">Not a department head, project manager or site in-charge.</p>
        : <ul>{u.holdings.map((h) => <li key={h.id}>{h.kind}: {h.code} {h.name}{h.pending ? ` (from ${h.effectiveFrom})` : ''}</li>)}</ul>}
      <h2>History of roles</h2>
      {u.grants.length === 0 ? <p className="muted">No role was ever granted.</p> : (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Roles granted and taken away</caption>
            <thead><tr><th>When</th><th>Role</th><th>Change</th><th>By</th><th>Why</th></tr></thead>
            <tbody>{u.grants.map((g, i) => <tr key={i}><td data-label="When">{formatDateTime(g.at)}</td><td data-label="Role">{roleLabel(g.role)}</td><td data-label="Change">{g.action === 'GRANTED' ? 'Granted' : 'Taken away'}</td><td data-label="By">{g.by}</td><td data-label="Why">{g.reason}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Sessions({ u, canSignOut, onSignOut }) {
  const q = useUserSessions(u.id);
  const rows = q.data ?? [];
  return (
    <div className="card">
      <QueryState query={q} what="sessions" permission="iam.user.view" />
      {q.data && rows.length === 0 && <div className="state"><h2>No live sessions</h2><p>This person is not signed in anywhere.</p></div>}
      {rows.length > 0 && (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Live sessions</caption>
            <thead><tr><th>Device</th><th>Address</th><th>Signed in</th><th>Last active</th><th>Ends</th></tr></thead>
            <tbody>{rows.map((s) => <tr key={s.id}><td data-label="Device">{s.device ?? 'Unknown'}</td><td data-label="Address">{s.ip ?? '-'}</td><td data-label="Signed in">{formatDateTime(s.createdAt)}</td><td data-label="Last active">{formatDateTime(s.lastSeenAt)}</td><td data-label="Ends">{formatDateTime(s.expiresAt)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      {canSignOut && rows.length > 0 && <button type="button" className="btn" onClick={onSignOut}>Sign out everywhere</button>}
    </div>
  );
}

function History({ id }) {
  const [page, setPage] = useState(1);
  const q = useUserLoginEvents(id, page);
  const rows = q.data?.data ?? [];
  return (
    <div className="card">
      <QueryState query={q} what="the login history" permission="iam.user.view" />
      {q.data && rows.length === 0 && <div className="state"><h2>No sign-ins yet</h2><p>Sign-in attempts and sign-outs of this person appear here.</p></div>}
      {rows.length > 0 && (
        <>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Login history</caption>
              <thead><tr><th>When</th><th>What</th><th>Address</th><th>Device</th><th>Note</th></tr></thead>
              <tbody>{rows.map((e) => <tr key={e.id}><td data-label="When">{formatDateTime(e.at)}</td><td data-label="What">{RESULT[e.result] ?? e.result}</td><td data-label="Address">{e.ip ?? '-'}</td><td data-label="Device">{e.device ?? '-'}</td><td data-label="Note">{e.reason ?? ''}</td></tr>)}</tbody>
            </table>
          </div>
          <Pager meta={q.data.meta} page={page} setPage={setPage} noun="events" />
        </>
      )}
    </div>
  );
}

function Approvals({ u }) {
  return (
    <div>
      {u.requests.length === 0 && <div className="state"><h2>No approval requests</h2><p>A request for a role appears here with each approver's decision.</p></div>}
      {u.requests.map((r) => (
        <article key={r.id} className="card" data-testid={`request-${r.id}`}>
          <h3>{r.title} <span className={`chip ${REQUEST_CHIP[r.status]}`}>{REQUEST_STATUS[r.status] ?? r.status}</span></h3>
          <p className="muted">Raised by {r.requestedBy} on {formatDateTime(r.requestedAt)}. Reason: {r.reason}</p>
          <ol className="steps">
            {r.chain.map((role, i) => {
              const s = r.steps.find((x) => x.stepNo === i + 1);
              return <li key={`${role}-${i}`}>{role}: {s ? `${s.decision.toLowerCase()} by ${s.decidedBy}${s.comment ? ` (${s.comment})` : ''}` : r.status === 'SUBMITTED' && r.currentStep === i + 1 ? 'waiting for a decision' : 'not reached'}</li>;
            })}
          </ol>
        </article>
      ))}
      <p className="muted small">Approvers decide on the <Link to="/admin/approvals">Approvals</Link> page.</p>
    </div>
  );
}

function Timeline({ id }) {
  const q = useUserTimeline(id);
  const rows = q.data ?? [];
  return (
    <div className="card">
      <QueryState query={q} what="the timeline" permission="iam.user.view" />
      {q.data && (
        <ol className="timeline">
          {rows.map((a, i) => (
            <li key={i}>
              <strong>{ACTIONS[a.action] ?? a.action.replace(/_/g, ' ')}</strong> <span className="muted">{formatDateTime(a.at)} by {a.actor}</span>
              {a.reason && <div>Reason: {a.reason}</div>}
              {a.before && a.after && <div className="muted small">{Object.keys(a.after).map((k) => `${k}: ${JSON.stringify(a.before[k] ?? null)} → ${JSON.stringify(a.after[k])}`).join('; ')}</div>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function RoleDialog({ dialogRef, u, onSubmit, error, busy }) {
  const roles = useUserRoles();
  return (
    <FormDialog dialogRef={dialogRef} title={`Request a role for ${u.displayName}`} submitLabel="Raise the request" error={error} busy={busy} onSubmit={onSubmit}>
      <p className="muted">Nothing changes until the request is approved. A system administrator approves ordinary roles; privileged roles (marked) need a second approver.</p>
      <fieldset className="field"><legend>Roles</legend>
        {(roles.data ?? []).filter((r) => !u.roles.includes(r.code)).map((r) => (
          <label key={r.code}><input type="checkbox" name="roles" value={r.code} /> {roleLabel(r.code)} ({r.code}){r.privileged ? ' - privileged, two approvers' : ''}</label>
        ))}
      </fieldset>
      {error?.fields?.roles && <span className="field-error">{error.fields.roles}</span>}
    </FormDialog>
  );
}

function DeactivateDialog({ dialogRef, u, active, deactivate, error, setError, onDone }) {
  const check = useDeactivationCheck(u.id, active);
  const people = useUsers({ pageSize: 200, filters: { status: 'ACTIVE' }, sort: 'displayName' });
  const c = check.data;
  return (
    <FormDialog
      dialogRef={dialogRef}
      title={`Deactivate ${u.displayName}`}
      submitLabel="Deactivate"
      error={error}
      busy={deactivate.isPending}
      onSubmit={async (f) => {
        setError(null);
        try {
          const successor = f.get('successorId');
          onDone(await deactivate.mutateAsync({ id: u.id, version: u.version, reason: String(f.get('reason')), ...(successor ? { successorId: Number(successor) } : {}) }));
        } catch (err) { setError(errorInfo(err)); }
      }}
    >
      <p className="muted">Ends every session at once and takes every role away. The history is kept; the account can be reactivated later (the person returns with no role).</p>
      <QueryState query={check} what="what this person still holds" permission="iam.user.manage" />
      {c && c.blockers.length === 0 && <p role="status" data-testid="no-blockers">Nothing is waiting on this person.</p>}
      {c && c.blockers.length > 0 && (
        <div className="state state-error" role="alert" data-testid="deactivation-blockers">
          <h3>Open items to hand over first</h3>
          <ul>
            {c.blockers.map((b, i) => (
              <li key={i}><strong>{b.count} {b.type}</strong>: {b.hint}{b.reassignable ? '' : ' (cannot be handed over from here)'}
                {b.items && <ul>{b.items.map((it, j) => <li key={j}>{it.title ?? `${it.kind}: ${it.code} ${it.name ?? ''}`}</li>)}</ul>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {c?.successorNeeded && (
        <Field label="Hand the open items to *" name="successorId" error={error}>
          <select name="successorId" required defaultValue="">
            <option value="">Choose a person...</option>
            {(people.data?.data ?? []).filter((p) => p.id !== u.id).map((p) => <option key={p.id} value={p.id}>{p.displayName} ({p.username})</option>)}
          </select>
        </Field>
      )}
    </FormDialog>
  );
}
