import { useEffect, useState } from 'react';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { useUnsavedGuard } from '../../platform/forms/guard.js';
import { useDefinitionOptions, usePaths, useProposePath, useProposeSla, useSla } from '../../platform/workflow/api.js';
import { Field, Link, can, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';

// Escalation Paths & SLA settings (part 04.02, section 7.6): the management hierarchy a late task climbs (Site, Project, Regional, Head office, Director) and the time
// each kind of document has, in working hours, with the points of reminder and escalation. A change is asked for from a date and applies to new tasks once approved.
const today = () => new Date().toISOString().slice(0, 10);

function Paths({ canManage, options }) {
  const paths = usePaths();
  const propose = useProposePath();
  const [levels, setLevels] = useState(null);
  const [when, setWhen] = useState(today());
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  useUnsavedGuard(levels !== null);
  const current = paths.data?.find((p) => p.scopeType === 'COMPANY' && p.status === 'ACTIVE');
  const pending = paths.data?.find((p) => p.status === 'PENDING');
  useEffect(() => { setError(null); }, [levels]);
  if (paths.isPending) return <Skeleton label="Loading the hierarchy" rows={2} />;
  if (paths.isError) return <ErrorState title="The hierarchy could not be loaded" error={paths.error} onRetry={() => paths.refetch()} />;
  const shown = levels ?? current?.levels ?? [];
  const setLevel = (i, p) => setLevels(shown.map((l, k) => (k === i ? { ...l, ...p } : l)));
  const roleCodes = (options.roles ?? []).map((r) => r.code);
  const send = (e) => {
    e.preventDefault();
    propose.mutate({ levels: shown, effectiveFrom: when, reason }, { onSuccess: (r) => { setLevels(null); navigateTo(`/workflow/instance?id=${r.instance.id}`, { force: true }); }, onError: (er) => setError(errorInfo(er)) });
  };
  return (
    <section aria-labelledby="ep-paths" data-testid="escalation-paths">
      <h2 id="ep-paths">Escalation hierarchy</h2>
      <p className="muted small">A task that is not decided in time climbs one level at the due time and to the top level at twice the time. Order the levels from the nearest to the highest.</p>
      {pending && <p className="notice" role="note">A change of the hierarchy is waiting for approval (from {pending.effectiveFrom}).</p>}
      <ol className="wf-diagram" aria-label="Levels">
        {shown.map((l, i) => (
          <li className="wf-step" key={i}>
            <span className="wf-step-no" aria-hidden="true">{i + 1}</span>
            {canManage ? (
              <>
                <label className="field"><span>Level {i + 1} name</span><input value={l.level} maxLength={40} onChange={(e) => setLevel(i, { level: e.target.value })} /></label>
                <label className="field"><span>Roles at level {i + 1}</span>
                  <select multiple size={4} value={l.roles} onChange={(e) => setLevel(i, { roles: [...e.target.selectedOptions].map((o) => o.value) })}>{roleCodes.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
                <div className="wf-inline">
                  <button type="button" className="btn btn-small" disabled={i === 0} onClick={() => { const a = [...shown]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; setLevels(a); }}>Up<span className="sr-only"> level {i + 1}</span></button>
                  <button type="button" className="btn btn-small" disabled={i === shown.length - 1} onClick={() => { const a = [...shown]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; setLevels(a); }}>Down<span className="sr-only"> level {i + 1}</span></button>
                  <button type="button" className="btn btn-small" disabled={shown.length <= 2} onClick={() => setLevels(shown.filter((_, k) => k !== i))}>Remove<span className="sr-only"> level {i + 1}</span></button>
                </div>
              </>
            ) : <><strong>{l.level}</strong><span className="small">{l.roles.join(', ')}</span></>}
          </li>
        ))}
      </ol>
      {canManage && (
        <form className="form-grid" onSubmit={send} aria-label="Ask for a change of the hierarchy">
          <div className="actions"><button type="button" className="btn" onClick={() => setLevels([...shown, { level: `Level ${shown.length + 1}`, roles: [] }])}>Add a level</button></div>
          <Field label="Takes effect from" name="effectiveFrom" error={error}><input type="date" min={today()} value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
          <Field label="Reason" name="reason" error={error}><input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></Field>
          {error && <p role="alert" className="error">{error.form}{error.correlationId && <> (<code>{error.correlationId}</code>)</>}{Object.entries(error.fields ?? {}).map(([k, v]) => <span key={k} className="small"> {k}: {v}</span>)}</p>}
          <div className="actions"><button type="submit" className="btn btn-primary" disabled={levels === null || reason.trim().length < 5 || propose.isPending}>Ask for approval</button>{levels !== null && <button type="button" className="btn" onClick={() => setLevels(null)}>Discard the changes</button>}</div>
        </form>
      )}
    </section>
  );
}

function Sla({ canManage }) {
  const sla = useSla();
  const propose = useProposeSla();
  const [edits, setEdits] = useState({});
  const [when, setWhen] = useState(today());
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  useUnsavedGuard(Object.keys(edits).length > 0);
  if (sla.isPending) return <Skeleton label="Loading the SLA settings" rows={2} />;
  if (sla.isError) return <ErrorState title="The SLA settings could not be loaded" error={sla.error} onRetry={() => sla.refetch()} />;
  const rows = sla.data.filter((s) => s.status === 'ACTIVE');
  const pending = sla.data.some((s) => s.status === 'PENDING');
  const val = (r, k) => edits[r.docType]?.[k] ?? r[k];
  const set = (r, k, v) => setEdits({ ...edits, [r.docType]: { ...edits[r.docType], [k]: v === '' ? '' : Number(v) } });
  const changes = Object.entries(edits).map(([docType, e]) => { const r = rows.find((x) => x.docType === docType); return { docType, hours: e.hours ?? r.hours, remindPct: e.remindPct ?? r.remindPct, escalatePct: e.escalatePct ?? r.escalatePct, secondPct: e.secondPct ?? r.secondPct }; });
  const send = (e) => {
    e.preventDefault();
    propose.mutate({ settings: changes, effectiveFrom: when, reason }, { onSuccess: (r) => { setEdits({}); navigateTo(`/workflow/instance?id=${r.instance.id}`, { force: true }); }, onError: (er) => setError(errorInfo(er)) });
  };
  return (
    <section aria-labelledby="ep-sla" data-testid="sla-settings">
      <h2 id="ep-sla">Time allowed (SLA)</h2>
      <p className="muted small">In working hours: the hours of the working day, never a weekly off or a holiday of the company calendar. The row marked all applies to every document type without a row of its own.</p>
      {pending && <p className="notice" role="note">A change of the SLA settings is waiting for approval.</p>}
      <div className="table-wrap" tabIndex={0} role="region" aria-label="SLA settings">
        <table className="grid">
          <thead><tr><th>Document type</th><th className="num">Working hours</th><th className="num">Reminder at (%)</th><th className="num">Escalate at (%)</th><th className="num">Director at (%)</th><th>Status</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} data-testid={`sla-${r.docType}`}>
              <th scope="row" data-label="Document type">{r.docType === '*' ? 'All document types' : r.docType}</th>
              {[['hours', 'Working hours'], ['remindPct', 'Reminder at (%)'], ['escalatePct', 'Escalate at (%)'], ['secondPct', 'Director at (%)']].map(([k, l]) => (
                <td className="num" data-label={l} key={k}>{canManage ? <input type="number" aria-label={`${l} for ${r.docType === '*' ? 'all document types' : r.docType}`} size={5} value={val(r, k)} onChange={(e) => set(r, k, e.target.value)} /> : r[k]}</td>
              ))}
              <td data-label="Status"><StatusBadge status="approved" label="In force" /></td>
            </tr>))}</tbody>
        </table>
      </div>
      {canManage && (
        <form className="form-grid" onSubmit={send} aria-label="Ask for a change of the SLA settings">
          <Field label="Takes effect from" name="effectiveFrom" error={error}><input type="date" min={today()} value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
          <Field label="Reason" name="reason" error={error}><input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></Field>
          {error && <p role="alert" className="error">{error.form}{error.correlationId && <> (<code>{error.correlationId}</code>)</>}{Object.entries(error.fields ?? {}).map(([k, v]) => <span key={k} className="small"> {k}: {v}</span>)}</p>}
          <div className="actions"><button type="submit" className="btn btn-primary" disabled={changes.length === 0 || reason.trim().length < 5 || propose.isPending}>Ask for approval</button>{changes.length > 0 && <button type="button" className="btn" onClick={() => setEdits({})}>Discard the changes</button>}</div>
        </form>
      )}
    </section>
  );
}

export default function EscalationPage({ session }) {
  usePageTitle('Escalation Paths & SLA');
  const options = useDefinitionOptions();
  const paths = usePaths();
  const canManage = can(session, 'eng.matrix.manage');
  if (paths.error?.status === 403) return <NoPermission what="the escalation settings" permission="eng.matrix.view" />;
  return (
    <section aria-labelledby="es-title" data-testid="escalation">
      <h1 id="es-title">Escalation Paths &amp; SLA</h1>
      <p className="muted">How long an approver has, and who the task climbs to when the time passes. Changes are asked for here and approved by the system administrator and the chief financial officer.</p>
      <Paths canManage={canManage} options={options.data ?? {}} />
      <Sla canManage={canManage} />
      <p className="muted small"><Link to="/admin/approval-matrix">Approval Matrix</Link> · <Link to="/admin/workflows/monitor">Workflow Monitor</Link></p>
    </section>
  );
}
