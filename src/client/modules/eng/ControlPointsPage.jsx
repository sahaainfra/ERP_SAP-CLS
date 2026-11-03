import { useState } from 'react';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ConfirmDialog } from '../../platform/feedback/Dialogs.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDateTime } from '../../platform/format.js';
import { useControl, useControlOptions, useControls, useCreateControl, useRemoveControl, useUpdateControl } from '../../platform/protocol/api.js';
import { Field, Link, can, errorInfo, usePageTitle } from '../core/pages/ui.jsx';

// Control Points Registry (part 04.04, section 7.1; Administration > Controls): every control point of the company with its stage, how hard it acts (enforcement), the mode
// it is in (OFF, OBSERVE, WARN, ENFORCE), its thresholds and its owner, and for the ones being observed what they would have stopped. A control that is in ENFORCE, or is going
// there, is changed only through the approval of its owner and then the auditor or director; and goes to ENFORCE only after the days of observation the company set.
export const MODE = { OFF: ['cancelled', 'Off'], OBSERVE: ['draft', 'Observe'], WARN: ['returned', 'Warn'], ENFORCE: ['approved', 'Enforce'] };
export const ENFORCEMENT = { BLOCK: 'Blocks', EXCEPTION: 'Needs an exception', WARN: 'Warns', MONITOR: 'Monitors' };
const STAGES = { PLAN: 'Plan', VERIFY: 'Verify', APPROVE: 'Approve', EXECUTE: 'Execute', RECORD: 'Record', MONITOR: 'Monitor', RECONCILE: 'Reconcile', CLOSE: 'Close' };

function Edit({ code, options, canManage, onClose, setNotice }) {
  const query = useControl(code);
  const update = useUpdateControl();
  const [error, setError] = useState(null);
  const c = query.data;
  if (query.isPending) return <Skeleton label="Loading the control point" rows={3} />;
  if (query.isError) return <ErrorState title="The control point could not be loaded" error={query.error} onRetry={() => query.refetch()} />;
  const s = c.stats;
  const save = (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const thresholds = {};
    for (const k of Object.keys(c.thresholds)) { const raw = String(f.get(`t-${k}`)).trim(); thresholds[k] = raw !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : raw; }
    const body = { code: c.code, mode: String(f.get('mode')), enforcement: String(f.get('enforcement')), thresholds, evidenceRequired: f.get('evidence') === 'on', escalationLevel: Number(f.get('level')), ownerRole: String(f.get('owner')), emergencyAllowed: f.get('emergency') === 'on', description: String(f.get('description')), version: c.version, ...(String(f.get('reason')).trim() ? { reason: String(f.get('reason')).trim() } : {}) };
    setError(null);
    update.mutate(body, {
      onSuccess: (r) => { setNotice(r.applied ? `${c.code} saved.` : `${c.code}: the change is waiting for approval by the owner and then the auditor or director.`); onClose(); },
      onError: (er) => setError(errorInfo(er)),
    });
  };
  return (
    <section className="card" aria-label={`Control point ${c.code}`} data-testid="cp-edit">
      <h2>{c.code}</h2>
      <p>{c.description}</p>
      <ul className="srch-meta" aria-label="Observation" data-testid="cp-stats">
        <li>Observed <strong>{s.days}</strong> of {s.requiredDays} days{s.ready ? ' (enough to enforce)' : ''}</li>
        <li>Would have blocked <strong>{s.wouldBlock + s.wouldRequireException}</strong></li><li>Would have warned <strong>{s.wouldWarn}</strong></li>
        <li>Blocked <strong>{s.blocked + s.exceptionRequired}</strong></li><li>Excepted <strong>{s.excepted}</strong></li><li>Value at risk <strong>₹{Number(s.valueAtRisk).toLocaleString('en-IN')}</strong></li>
      </ul>
      {c.pendingChangeId && <p role="status" className="notice">A change of this control is waiting for approval{c.changes.find((x) => x.status === 'PENDING')?.instanceId ? <> — <Link to={`/workflow/instance?id=${c.changes.find((x) => x.status === 'PENDING').instanceId}`}>follow it</Link></> : ''}. It cannot be changed again until it is decided.</p>}
      <form className="form-grid" onSubmit={save} aria-label="Change the control point">
        <Field label="Mode" name="mode" error={error}><select name="mode" defaultValue={c.mode} disabled={!canManage || Boolean(c.pendingChangeId)}>{Object.entries(MODE).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Enforcement" name="enforcement" error={error}><select name="enforcement" defaultValue={c.enforcement} disabled={!canManage || Boolean(c.pendingChangeId)}>{Object.entries(ENFORCEMENT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        {Object.entries(c.thresholds).map(([k, v]) => <Field key={k} label={`Threshold: ${k}`} name={`t-${k}`} error={error}><input name={`t-${k}`} defaultValue={String(v)} disabled={!canManage || Boolean(c.pendingChangeId)} /></Field>)}
        <Field label="Level of approval for an exception" name="level" error={error}><select name="level" defaultValue={c.escalationLevel} disabled={!canManage || Boolean(c.pendingChangeId)}><option value="1">Level 1: project manager</option><option value="2">Level 2: project director</option><option value="3">Level 3: director</option></select></Field>
        <Field label="Owner" name="owner" error={error}><select name="owner" defaultValue={c.ownerRole} disabled={!canManage || Boolean(c.pendingChangeId)}>{options.roles.map((r) => <option key={r} value={r}>{r}</option>)}</select></Field>
        <Field label="Description" name="description" error={error}><input name="description" defaultValue={c.description} minLength={10} maxLength={300} disabled={!canManage || Boolean(c.pendingChangeId)} /></Field>
        <label className="check"><input type="checkbox" name="evidence" defaultChecked={c.evidenceRequired} disabled={!canManage || Boolean(c.pendingChangeId)} /> Evidence is required for an exception</label>
        <label className="check"><input type="checkbox" name="emergency" defaultChecked={c.emergencyAllowed} disabled={!canManage || Boolean(c.pendingChangeId)} /> An emergency exception may be raised (approved afterwards)</label>
        <Field label="Reason for the change" name="reason" error={error} hint="Needed when the control is in or going to ENFORCE; the approvers read it."><input name="reason" maxLength={500} disabled={!canManage || Boolean(c.pendingChangeId)} /></Field>
        {error && <p role="alert" className="error">{error.form}{error.correlationId && <> (<code>{error.correlationId}</code>)</>}</p>}
        <div className="actions">{canManage && !c.pendingChangeId && <button type="submit" className="btn btn-primary" disabled={update.isPending}>Save</button>}<button type="button" className="btn" onClick={onClose}>Close</button></div>
      </form>
      {c.recent.length > 0 && (
        <>
          <h3>What this control found lately</h3>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Recent findings">
            <table className="grid"><thead><tr><th>When</th><th>Result</th><th>For</th><th>By</th></tr></thead>
              <tbody>{c.recent.map((r) => <tr key={r.id}><td data-label="When">{formatDateTime(r.at)}</td><td data-label="Result">{r.result.replaceAll('_', ' ').toLowerCase()}</td><td data-label="For">{r.details.ref ?? `${r.entity} ${r.entityId}`}</td><td data-label="By">{r.user}</td></tr>)}</tbody></table>
          </div>
        </>
      )}
      {c.changes.length > 0 && (
        <>
          <h3>Changes</h3>
          <ul className="lp-list">{c.changes.map((x) => <li key={x.id}>{x.from} to {x.to}: {x.status.toLowerCase()} ({x.requestedBy}, {formatDateTime(x.at)}){x.reason ? ` — ${x.reason}` : ''}{x.instanceId ? <> <Link to={`/workflow/instance?id=${x.instanceId}`}>approval</Link></> : ''}</li>)}</ul>
        </>
      )}
    </section>
  );
}

function NewControl({ options, onClose, setNotice }) {
  const create = useCreateControl();
  const [error, setError] = useState(null);
  const submit = (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const limit = String(f.get('limit')).trim();
    const body = { code: String(f.get('code')).trim().toUpperCase(), module: String(f.get('module')).trim(), stage: String(f.get('stage')), description: String(f.get('description')), enforcement: String(f.get('enforcement')),
      rule: { field: String(f.get('field')).trim(), op: String(f.get('op')), threshold: 'limit' }, thresholds: { limit: Number.isNaN(Number(limit)) ? limit : Number(limit) }, evidenceRequired: f.get('evidence') === 'on', escalationLevel: Number(f.get('level')), ownerRole: String(f.get('owner')), emergencyAllowed: f.get('emergency') === 'on' };
    setError(null);
    create.mutate(body, { onSuccess: (c) => { setNotice(`${c.code} defined. It is OFF: put it in OBSERVE to see what it would stop.`); onClose(); }, onError: (er) => setError(errorInfo(er)) });
  };
  return (
    <form className="form-grid card" onSubmit={submit} aria-label="New control point">
      <h2>New control point</h2>
      <Field label="Code" name="code" error={error} hint="CP-<MODULE>-nn, for example CP-PROC-05"><input name="code" required pattern="CP-[A-Za-z]{2,8}-\d{2,3}" /></Field>
      <Field label="Module" name="module" error={error}><input name="module" required pattern="[a-z][a-z0-9_]{1,19}" placeholder="proc" /></Field>
      <Field label="Stage" name="stage" error={error}><select name="stage" defaultValue="VERIFY">{options.stages.map((s) => <option key={s} value={s}>{STAGES[s]}</option>)}</select></Field>
      <Field label="What it controls" name="description" error={error}><input name="description" required minLength={10} maxLength={300} /></Field>
      <Field label="Fails when the field" name="field" error={error} hint="A field of the document, for example amount"><input name="field" required /></Field>
      <Field label="is" name="op" error={error}><select name="op" defaultValue="gt"><option value="gt">above</option><option value="gte">at least</option><option value="lt">below</option><option value="lte">at most</option><option value="eq">equal to</option><option value="ne">not equal to</option></select></Field>
      <Field label="the limit" name="limit" error={error}><input name="limit" required /></Field>
      <Field label="Enforcement" name="enforcement" error={error}><select name="enforcement" defaultValue="EXCEPTION">{Object.entries(ENFORCEMENT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      <Field label="Level of approval for an exception" name="level" error={error}><select name="level" defaultValue="1"><option value="1">Level 1: project manager</option><option value="2">Level 2: project director</option><option value="3">Level 3: director</option></select></Field>
      <Field label="Owner" name="owner" error={error}><select name="owner" defaultValue="SYSADM">{options.roles.map((r) => <option key={r} value={r}>{r}</option>)}</select></Field>
      <label className="check"><input type="checkbox" name="evidence" /> Evidence is required for an exception</label>
      <label className="check"><input type="checkbox" name="emergency" /> An emergency exception may be raised</label>
      {error && <p role="alert" className="error">{error.form}{error.correlationId && <> (<code>{error.correlationId}</code>)</>}</p>}
      <div className="actions"><button type="submit" className="btn btn-primary" disabled={create.isPending}>Define</button><button type="button" className="btn" onClick={onClose}>Cancel</button></div>
    </form>
  );
}

export default function ControlPointsPage({ session }) {
  usePageTitle('Control Points');
  const [filters, setFilters] = useState({ module: '', mode: '', stage: '', q: '' });
  const [open, setOpen] = useState(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState('');
  const [removing, setRemoving] = useState(null);
  const [error, setError] = useState(null);
  const list = useControls(filters);
  const options = useControlOptions();
  const remove = useRemoveControl();
  const canManage = can(session, 'eng.pcs.manage');
  if (list.error?.status === 403) return <NoPermission what="the control points" permission="eng.pcs.view" />;
  const data = list.data;
  return (
    <section aria-labelledby="cp-title" data-testid="control-points">
      <h1 id="cp-title">Control Points</h1>
      <p className="muted">What the company checks, and how hard. A control starts in OBSERVE: it writes down what it would have stopped and affects nobody. After the days of observation the company set it may be enforced, with the approval of its owner and then the auditor or director.</p>
      {notice && <p role="status" className="notice" data-testid="cp-notice">{notice}</p>}
      {error && <p role="alert" className="error">{error.form}</p>}
      <div className="srch-tools">{canManage && !creating && <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>New control point</button>}<Link to="/admin/reason-codes">Reason Codes</Link><Link to="/controls/exceptions">Exceptions Register</Link></div>
      {creating && options.data && <NewControl options={options.data} onClose={() => setCreating(false)} setNotice={setNotice} />}
      <form className="srch-form" role="search" aria-label="Filter the control points" onSubmit={(e) => e.preventDefault()}>
        <label className="field"><span>Module</span><select value={filters.module} onChange={(e) => setFilters({ ...filters, module: e.target.value })}><option value="">All modules</option>{(data?.modules ?? []).map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
        <label className="field"><span>Mode</span><select value={filters.mode} onChange={(e) => setFilters({ ...filters, mode: e.target.value })}><option value="">Any mode</option>{Object.entries(MODE).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="field"><span>Stage</span><select value={filters.stage} onChange={(e) => setFilters({ ...filters, stage: e.target.value })}><option value="">Any stage</option>{Object.entries(STAGES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="field"><span>Code or words</span><input type="search" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} /></label>
      </form>
      {open && options.data && <Edit key={open} code={open} options={options.data} canManage={canManage} onClose={() => setOpen(null)} setNotice={setNotice} />}
      {list.isPending && <Skeleton label="Loading the control points" rows={4} />}
      {list.isError && list.error?.status !== 403 && <ErrorState title="The control points could not be loaded" error={list.error} onRetry={() => list.refetch()} />}
      {data && (data.rows.length === 0 ? <EmptyState title="No control point matches" message="Change the filters, or define a new control point." /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Control points">
          <table className="grid">
            <thead><tr><th>Code</th><th>Stage</th><th>Enforcement</th><th>Mode</th><th>Thresholds</th><th>Owner</th><th className="num">Observed (days)</th><th className="num">Would have stopped</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{data.rows.map((c) => (
              <tr key={c.code} data-testid={`cp-row-${c.code}`}>
                <th scope="row" data-label="Code"><code>{c.code}</code><br /><span className="muted small">{c.description}</span></th>
                <td data-label="Stage">{STAGES[c.stage]}</td><td data-label="Enforcement">{ENFORCEMENT[c.enforcement]}</td>
                <td data-label="Mode"><StatusBadge status={MODE[c.mode][0]} label={MODE[c.mode][1]} />{c.pendingChangeId ? <><br /><span className="muted small">change waiting</span></> : null}</td>
                <td data-label="Thresholds" className="small">{Object.entries(c.thresholds).map(([k, v]) => `${k}: ${v}`).join(', ') || '—'}</td>
                <td data-label="Owner">{c.ownerRole}</td><td className="num" data-label="Observed (days)">{c.mode === 'OFF' ? '—' : `${c.stats.days} / ${c.stats.requiredDays}`}</td>
                <td className="num" data-label="Would have stopped">{c.stats.wouldAffect}</td>
                <td data-label="Actions"><button type="button" className="btn btn-small" onClick={() => setOpen(c.code)}>{canManage ? 'Open' : 'View'}<span className="sr-only"> {c.code}</span></button>
                  {canManage && c.mode === 'OFF' && !c.rule.ref && <button type="button" className="btn btn-small" onClick={() => setRemoving(c.code)}>Remove<span className="sr-only"> {c.code}</span></button>}</td>
              </tr>))}</tbody>
          </table>
        </div>
      ))}
      <ConfirmDialog open={Boolean(removing)} title={`Remove ${removing}?`} text="The control point stops existing for this company. Its past results stay in the log." confirmLabel="Remove" danger
        onConfirm={async () => { try { await remove.mutateAsync(removing); setNotice(`${removing} removed.`); setRemoving(null); } catch (e) { setRemoving(null); setError(errorInfo(e)); } }} onCancel={() => setRemoving(null)} />
    </section>
  );
}
