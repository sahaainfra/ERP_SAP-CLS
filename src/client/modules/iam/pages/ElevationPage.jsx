import { useRef, useState } from 'react';
import { formatDateTime } from '../../../platform/format.js';
import { Field, FormDialog, Link, Pager, QueryState, can, errorInfo, usePageTitle } from '../../core/pages/ui.jsx';
import { useCancelElevation, useDecideElevation, useElevation, useElevationRoles, useElevations, useRequestElevation, useRevokeElevation } from '../api/privileged.js';
import { StatusChip, remaining } from '../components/privilegedCommon.jsx';
import PageHeader from '../../../platform/design/PageHeader.jsx';

/** One elevation: its approval, and every request made while it was in force. */
function ElevationDetail({ id, onClose }) {
  const q = useElevation(id);
  const e = q.data;
  return (
    <aside className="card" aria-labelledby="elev-detail-title" data-testid="elevation-detail">
      <div className="page-head"><h2 id="elev-detail-title">{e ? `${e.roleCode} for ${e.username}` : 'Elevation'}</h2><button type="button" className="btn btn-small" onClick={onClose}>Close</button></div>
      <QueryState query={q} what="the elevation" permission="iam.elevation.request" />
      {e && (
        <>
          <dl className="kv">
            <dt>Status</dt><dd><StatusChip status={e.status} /> {remaining(e)}</dd>
            <dt>Reason</dt><dd>{e.reason}</dd>
            <dt>Applies to</dt><dd>{e.scopeType === 'COMPANY' ? 'The whole company' : e.scopeType === 'OWN' ? 'Own records' : `${e.scopeType.toLowerCase()} ${e.scopeIds.join(', ')}`}</dd>
            {e.startsAt && <><dt>From</dt><dd>{formatDateTime(e.startsAt)} to {formatDateTime(e.endsAt)}</dd></>}
            {e.financial && <><dt>Financial</dt><dd>Yes: the chief financial officer approves as well.</dd></>}
            {e.revokedBy && <><dt>Revoked</dt><dd>by {e.revokedBy}: {e.revokeReason}</dd></>}
          </dl>
          {e.request && <><h3>Approval</h3><ol>{e.request.chain.map((c, i) => { const step = e.request.steps.find((s) => s.stepNo === i + 1); return <li key={c}>{c.startsWith('@') ? `Manager (${c.slice(1)})` : c.replace('|', ' or ')}: {step ? `${step.decision.toLowerCase()} by ${step.decidedBy}` : 'waiting'}</li>; })}</ol></>}
          <h3>Everything done while elevated ({e.logCount})</h3>
          {e.log.length === 0 ? <p className="muted">Nothing yet.</p> : (
            <div className="table-wrap"><table><caption className="sr-only">Requests made during the elevation</caption>
              <thead><tr><th>When</th><th>Request</th><th>Result</th><th>Correlation ID</th></tr></thead>
              <tbody>{e.log.map((l, i) => <tr key={i}><td data-label="When">{formatDateTime(l.at)}</td><td data-label="Request"><code>{l.method} {l.route}</code></td><td data-label="Result">{l.status}</td><td data-label="Correlation ID"><code>{l.correlationId}</code></td></tr>)}</tbody></table></div>
          )}
          {e.audit.length > 0 && <><h3>Changes recorded in the audit trail</h3><ul>{e.audit.map((a, i) => <li key={i}>{formatDateTime(a.at)}: {a.actor} {a.action} {a.entity} {a.entityId}</li>)}</ul></>}
        </>
      )}
    </aside>
  );
}

/** Ask for access above your usual role for a few hours, with a reason; it ends by itself. */
export default function ElevationPage({ session }) {
  usePageTitle('Request Elevated Access');
  const [page, setPage] = useState(1);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState(null);
  const [scopeType, setScopeType] = useState('COMPANY');
  const roles = useElevationRoles();
  const list = useElevations({ page, pageSize: 25, filters: { mine: 'true' } });
  const request = useRequestElevation();
  const cancel = useCancelElevation();
  const rows = list.data?.data ?? [];
  const can2 = can(session, 'iam.elevation.request');

  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">My account &rsaquo; Elevated access</nav>
      <PageHeader id="page-title" title={"Request Elevated Access"} subtitle={"Use this when a task needs more than your usual role (a fix during an incident, covering for someone). Your manager and the IT administrator approve it; financial roles also need the chief financial officer. The access starts when approved, ends by itself at the time shown, and everything you do while it is in force is logged."} />
      <p role="status" className="notice" data-testid="elevation-notice">{notice}</p>
      {can2 ? (
        <form
          className="card"
          aria-labelledby="elev-title"
          onSubmit={async (ev) => {
            ev.preventDefault();
            const formEl = ev.currentTarget; // React drops currentTarget once the handler awaits
            const f = new FormData(formEl);
            setError(null);
            setNotice('');
            try {
              const out = await request.mutateAsync({ roleId: Number(f.get('roleId')), scopeType, scopeIds: [], hours: Number(f.get('hours')), reason: String(f.get('reason')) });
              setNotice(`Request ${out.id} was sent: ${out.request.chain.map((c) => (c.startsWith('@') ? 'your manager' : c.replace('|', ' or '))).join(', then ')} will decide.${out.sodWarnings?.length ? ` Note: ${out.sodWarnings.map((w) => w.name).join(', ')} will be recorded.` : ''}`);
              formEl.reset();
            } catch (err) { setError(errorInfo(err)); }
          }}
        >
          <h2 id="elev-title">New request</h2>
          <div className="form-grid">
            <Field label="Role you need *" name="roleId" error={error}>
              <select name="roleId" required defaultValue=""><option value="">Choose a role...</option>{(roles.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.code} - {r.name}</option>)}</select>
            </Field>
            <Field label="Where *" name="scopeType" error={error}>
              <select name="scopeType" value={scopeType} onChange={(e) => setScopeType(e.target.value)}><option value="COMPANY">The whole company</option><option value="OWN">My own records</option></select>
            </Field>
            <Field label="For how many hours *" name="hours" error={error} hint="Up to the limit set in System Parameters (default 24)"><input name="hours" type="number" min="1" max="72" step="1" required defaultValue="4" /></Field>
            <Field label="Reason (what needs doing and why your usual access is not enough) *" name="reason" error={error}><textarea name="reason" rows="3" required minLength={10} maxLength={500} /></Field>
          </div>
          {error?.form && <p className="field-error" role="alert">{error.form}{error.correlationId && <> (Correlation ID: <code>{error.correlationId}</code>)</>}</p>}
          <div className="actions"><button type="submit" className="btn btn-primary" disabled={request.isPending}>{request.isPending ? 'Sending...' : 'Send the request'}</button></div>
        </form>
      ) : <div className="state"><h2>Not available</h2><p>Your role does not include asking for elevated access.</p></div>}

      <h2>My requests</h2>
      <QueryState query={list} what="your requests" permission="iam.elevation.request" />
      {list.data && rows.length === 0 && <div className="state"><h2>No requests</h2><p>Your elevated-access requests appear here.</p></div>}
      {rows.length > 0 && (
        <>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">My elevated access requests</caption>
              <thead><tr><th>Role</th><th>Reason</th><th>Status</th><th>Time</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} data-testid={`elevation-${e.id}`}>
                    <td data-label="Role"><code>{e.roleCode}</code> {e.roleName}</td>
                    <td data-label="Reason">{e.reason}</td>
                    <td data-label="Status"><StatusChip status={e.status} /></td>
                    <td data-label="Time">{remaining(e)}</td>
                    <td data-label="Actions" className="actions">
                      <button type="button" className="btn btn-small" aria-label={`Open request ${e.id}`} onClick={() => setSelected(e.id)}>Open</button>
                      {e.status === 'REQUESTED' && <button type="button" className="btn btn-small" aria-label={`Cancel request ${e.id}`} onClick={async () => { try { await cancel.mutateAsync(e.id); setNotice('The request was cancelled.'); } catch (err) { setNotice(errorInfo(err).form); } }}>Cancel</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager meta={list.data.meta} page={page} setPage={setPage} noun="requests" />
        </>
      )}
      {selected && <ElevationDetail id={selected} onClose={() => setSelected(null)} />}
      <p className="muted small">Approvers decide on <Link to="/admin/elevation-approvals">Elevation Approvals</Link>.</p>
    </section>
  );
}

/** The worklist of approvers and administrators: what waits for you, everything that is or was in force, and revoking. */
export function ElevationApprovalsPage({ session }) {
  usePageTitle('Elevation Approvals');
  const viewAll = can(session, 'iam.elevation.view');
  const revokeRight = can(session, 'iam.elevation.revoke');
  const [tab, setTab] = useState('awaiting');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const [target, setTarget] = useState(null);
  const [mode, setMode] = useState('approve');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const list = useElevations({ page, pageSize: 25, filters: tab === 'awaiting' ? { awaiting: 'true' } : tab === 'active' ? { status: 'ACTIVE' } : {} });
  const decide = useDecideElevation();
  const revoke = useRevokeElevation();
  const dialog = useRef(null);
  const revokeDialog = useRef(null);
  const rows = list.data?.data ?? [];
  const tabs = [['awaiting', 'Waiting for me'], ...(viewAll ? [['active', 'In force'], ['all', 'All']] : [])];

  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Elevation approvals</nav>
      <PageHeader id="page-title" title={"Elevation Approvals"} subtitle={<>You see the requests that wait for you at their current step{viewAll ? ', and every elevation in the company' : ''}. Nobody approves their own request.</>} />
      <p role="status" className="notice" data-testid="approvals-notice">{notice}</p>
      <div role="tablist" aria-label="Elevations" className="toolbar">
        {tabs.map(([v, l]) => <button key={v} type="button" role="tab" aria-selected={tab === v} className={`btn${tab === v ? ' btn-primary' : ''}`} onClick={() => { setTab(v); setPage(1); }}>{l}</button>)}
      </div>
      <QueryState query={list} what="the elevations" permission="iam.elevation.request" />
      {list.data && rows.length === 0 && <div className="state"><h2>{tab === 'awaiting' ? 'Nothing is waiting for you' : 'No elevations'}</h2></div>}
      {rows.length > 0 && (
        <>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Elevations</caption>
              <thead><tr><th>Person</th><th>Role</th><th>Reason</th><th>Status</th><th>Time</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} data-testid={`elevation-${e.id}`}>
                    <td data-label="Person">{e.displayName} <span className="muted">({e.username})</span></td>
                    <td data-label="Role"><code>{e.roleCode}</code>{e.financial ? ' (financial)' : ''}</td>
                    <td data-label="Reason">{e.reason}</td>
                    <td data-label="Status"><StatusChip status={e.status} /></td>
                    <td data-label="Time">{remaining(e)}</td>
                    <td data-label="Actions" className="actions">
                      <button type="button" className="btn btn-small" aria-label={`Open elevation ${e.id}`} onClick={() => setSelected(e.id)}>Open</button>
                      {e.awaitingMe && <><button type="button" className="btn btn-small btn-primary" aria-label={`Approve elevation ${e.id}`} onClick={() => { setTarget(e); setMode('approve'); setError(null); dialog.current?.showModal(); }}>Approve</button><button type="button" className="btn btn-small" aria-label={`Reject elevation ${e.id}`} onClick={() => { setTarget(e); setMode('reject'); setError(null); dialog.current?.showModal(); }}>Reject</button></>}
                      {revokeRight && ['ACTIVE', 'REQUESTED'].includes(e.status) && <button type="button" className="btn btn-small" aria-label={`Revoke elevation ${e.id}`} onClick={() => { setTarget(e); setError(null); revokeDialog.current?.showModal(); }}>Revoke</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager meta={list.data.meta} page={page} setPage={setPage} noun="elevations" />
        </>
      )}
      {selected && <ElevationDetail id={selected} onClose={() => setSelected(null)} />}

      <FormDialog
        dialogRef={dialog}
        title={target ? `${mode === 'approve' ? 'Approve' : 'Reject'} ${target.roleCode} for ${target.username}` : 'Decide'}
        submitLabel={mode === 'approve' ? 'Approve' : 'Reject'}
        error={error}
        busy={decide.isPending}
        reason={false}
        onSubmit={async (f) => {
          setError(null);
          try {
            await decide.mutateAsync({ id: target.id, action: mode, comment: String(f.get('comment') ?? '') || undefined });
            dialog.current?.close();
            setNotice(mode === 'approve' ? `You approved the request of ${target.username}.` : `You rejected the request of ${target.username}.`);
          } catch (err) { setError(errorInfo(err)); }
        }}
      >
        {target && <p className="muted">{target.displayName} asks for {target.roleCode} for {target.requestedHours} hour(s): {target.reason}</p>}
        <Field label={mode === 'approve' ? 'Comment (optional)' : 'Comment (required, min 5 characters) *'} name="comment" error={error}><textarea name="comment" rows="2" maxLength={500} required={mode === 'reject'} minLength={mode === 'reject' ? 5 : undefined} /></Field>
      </FormDialog>
      <FormDialog
        dialogRef={revokeDialog}
        title={target ? `Revoke ${target.roleCode} for ${target.username}` : 'Revoke'}
        submitLabel="Revoke now"
        error={error}
        busy={revoke.isPending}
        onSubmit={async (f) => {
          setError(null);
          try {
            await revoke.mutateAsync({ id: target.id, reason: String(f.get('reason')) });
            revokeDialog.current?.close();
            setNotice(`The elevation of ${target.username} was revoked and ended at once.`);
          } catch (err) { setError(errorInfo(err)); }
        }}
      >
        <p className="muted">The access ends on their next request.</p>
      </FormDialog>
    </section>
  );
}
