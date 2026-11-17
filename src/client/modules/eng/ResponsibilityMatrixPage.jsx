import { useEffect, useState } from 'react';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDate } from '../../platform/format.js';
import { useProposeRouting, useRouting } from '../../platform/tasks/api.js';
import { Field, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { PRIORITY } from './tasks-common.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Department Responsibility Matrix (part 04.08, section 7.5): for each topic of an instruction, the department concerned, the role responsible, a fallback person and what the task needs. The
// accountability matrix (RACI) is consulted first when a topic names a process. A change takes effect from a date and waits for the system administrator or a director; what is in force
// stays until then.
const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const blank = (d) => ({ topicCode: '', topicName: '', departmentId: d ?? '', role: 'PM', fallbackUser: '', raciProcess: '', defaultPriority: 'MEDIUM', defaultDueDays: 7, requiresEvidence: false, requiresVerification: false, effectiveFrom: today() });
const toDraft = (r) => ({ topicCode: r.topicCode, topicName: r.topicName, departmentId: r.departmentId, role: r.role, fallbackUser: r.fallbackUser ?? '', raciProcess: r.raciProcess ?? '', defaultPriority: r.defaultPriority, defaultDueDays: r.defaultDueDays, requiresEvidence: r.requiresEvidence, requiresVerification: r.requiresVerification, effectiveFrom: today() });

export default function ResponsibilityMatrixPage() {
  usePageTitle('Department Responsibility Matrix');
  const q = useRouting();
  const propose = useProposeRouting();
  const [rows, setRows] = useState([]);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const d = q.data;
  useEffect(() => { if (d) setRows(d.rows.filter((r) => r.status === 'ACTIVE').map(toDraft)); }, [d]);
  if (q.error?.status === 403) return <NoPermission what="the department responsibility matrix" permission="tsk.routing.view" />;
  if (q.isPending) return <section aria-labelledby="rm-title"><PageHeader id="rm-title" title={"Department Responsibility Matrix"} /><Skeleton label="Loading the matrix" rows={4} /></section>;
  if (q.isError) return <ErrorState title="The matrix could not be loaded" error={q.error} onRetry={() => q.refetch()} />;
  const waiting = d.pendingBatch != null;
  const off = !d.canEdit || waiting;
  const patch = (i, p) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const submit = (e) => {
    e.preventDefault();
    setError(null);
    setNotice('');
    propose.mutate({ rows: rows.map((r) => ({ ...r, departmentId: Number(r.departmentId), defaultDueDays: Number(r.defaultDueDays), fallbackUser: r.fallbackUser || null, raciProcess: r.raciProcess || null })), reason }, {
      onSuccess: () => { setNotice('Sent for approval by the system administrator or a director. The matrix in force is unchanged until then.'); setReason(''); },
      onError: (er) => setError(errorInfo(er)),
    });
  };
  const err = (i, f) => error?.fields?.[`rows.${i}.${f}`];
  return (
    <section aria-labelledby="rm-title" data-testid="routing-matrix">
      <PageHeader id="rm-title" title={"Department Responsibility Matrix"} subtitle={"When a senior raises an instruction on a topic, this says which department is concerned, which role is responsible and who to try if the accountability matrix and the role have no answer."} />
      {notice && <p role="status" className="notice" data-testid="rm-notice">{notice}</p>}
      {waiting && <p role="status" className="notice" data-testid="rm-pending">A change of the matrix is waiting for approval. Nothing else can be changed until it is decided.</p>}
      <h2>In force</h2>
      {d.rows.filter((r) => r.status === 'ACTIVE').length === 0 ? <p className="muted">No topic is set up yet. Without one, an instruction goes to the head of the department it names.</p> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Topics in force">
          <table className="grid">
            <thead><tr><th>Topic</th><th>Department</th><th>Role</th><th>Fallback</th><th>Priority</th><th className="num">Days</th><th>Needs</th><th>From</th></tr></thead>
            <tbody>{d.rows.filter((r) => r.status === 'ACTIVE').map((r) => (
              <tr key={r.id} data-testid={`topic-${r.topicCode}`}><th scope="row" data-label="Topic">{r.topicName}<br /><span className="muted small">{r.topicCode}</span></th><td data-label="Department">{r.department}</td><td data-label="Role">{r.role}</td><td data-label="Fallback">{r.fallbackUser ?? ''}</td>
                <td data-label="Priority"><StatusBadge status={PRIORITY[r.defaultPriority][0]} label={PRIORITY[r.defaultPriority][1]} /></td><td className="num" data-label="Days">{r.defaultDueDays}</td>
                <td data-label="Needs">{[r.requiresEvidence && 'evidence', r.requiresVerification && 'verification'].filter(Boolean).join(', ')}</td><td data-label="From">{formatDate(r.effectiveFrom)}</td></tr>))}</tbody>
          </table>
        </div>)}
      {d.rows.some((r) => r.status === 'PENDING') && <p className="muted small">Waiting for approval: {d.rows.filter((r) => r.status === 'PENDING').map((r) => r.topicCode).join(', ')}.</p>}
      {d.canEdit && (
        <form className="form-grid" onSubmit={submit} aria-label="Change the matrix" data-testid="routing-form">
          <h2>Change it</h2>
          {rows.map((r, i) => (
            <fieldset key={i} className="card" data-testid={`row-${i}`}>
              <legend>{r.topicCode || `New topic ${i + 1}`}</legend>
              <div className="wf-inline">
                <Field label="Topic code" name={`rows.${i}.topicCode`} error={error}><input value={r.topicCode} disabled={off} maxLength={60} onChange={(e) => patch(i, { topicCode: e.target.value.trim() })} /></Field>
                <Field label="Topic name" name={`rows.${i}.topicName`} error={error}><input value={r.topicName} disabled={off} maxLength={120} onChange={(e) => patch(i, { topicName: e.target.value })} /></Field>
                <label className="field"><span>Department</span><select value={r.departmentId} disabled={off} onChange={(e) => patch(i, { departmentId: e.target.value })}><option value="">Choose</option>{d.departments.map((x) => <option key={x.id} value={x.id}>{x.name}{x.head ? '' : ' (no head)'}</option>)}</select></label>
                <Field label="Responsible role (code)" name={`rows.${i}.role`} error={error}><input value={r.role} disabled={off} maxLength={20} onChange={(e) => patch(i, { role: e.target.value.toUpperCase().trim() })} /></Field>
              </div>
              <div className="wf-inline">
                <Field label="Fallback person" name={`rows.${i}.fallbackUser`} error={error}><input value={r.fallbackUser} disabled={off} maxLength={60} onChange={(e) => patch(i, { fallbackUser: e.target.value.trim() })} /></Field>
                <label className="field"><span>Accountability process</span><select value={r.raciProcess} disabled={off} onChange={(e) => patch(i, { raciProcess: e.target.value })}><option value="">None</option>{d.processes.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}</select></label>
                <label className="field"><span>Priority</span><select value={r.defaultPriority} disabled={off} onChange={(e) => patch(i, { defaultPriority: e.target.value })}>{Object.entries(PRIORITY).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
                <Field label="Days to do it" name={`rows.${i}.defaultDueDays`} error={error}><input type="number" min="0" max="365" value={r.defaultDueDays} disabled={off} onChange={(e) => patch(i, { defaultDueDays: e.target.value })} /></Field>
                <Field label="Takes effect" name={`rows.${i}.effectiveFrom`} error={error}><input type="date" value={r.effectiveFrom} disabled={off} onChange={(e) => patch(i, { effectiveFrom: e.target.value })} /></Field>
              </div>
              <div className="wf-inline">
                <label className="field"><span><input type="checkbox" checked={r.requiresEvidence} disabled={off} onChange={(e) => patch(i, { requiresEvidence: e.target.checked })} /> Needs evidence</span></label>
                <label className="field"><span><input type="checkbox" checked={r.requiresVerification} disabled={off} onChange={(e) => patch(i, { requiresVerification: e.target.checked })} /> Needs verification</span></label>
                {!off && <button type="button" className="btn btn-small" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove from this change</button>}
              </div>
              {['topicCode', 'departmentId', 'role', 'fallbackUser', 'effectiveFrom'].map((f) => err(i, f) && <p key={f} role="alert" className="error small">{err(i, f)}</p>)}
            </fieldset>))}
          {!off && <button type="button" className="btn" onClick={() => setRows([...rows, blank(d.departments[0]?.id)])}>Add a topic</button>}
          {!off && <Field label="Reason for the change" name="reason" error={error}><input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></Field>}
          {error?.form && <p role="alert" className="error">{error.form}</p>}
          {!off && <button type="submit" className="btn btn-primary" disabled={propose.isPending || rows.length === 0}>Send for approval</button>}
        </form>)}
    </section>
  );
}
