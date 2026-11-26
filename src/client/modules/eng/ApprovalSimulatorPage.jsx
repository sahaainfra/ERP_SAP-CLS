import { useState } from 'react';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { NoPermission } from '../../platform/feedback/states.jsx';
import { simulate, useMatrixHistory, useMatrixList } from '../../platform/workflow/api.js';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from './common.js';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { todayIst } from '../../platform/forms/dates.js';

// Approval Simulator (part 04.02, section 7.4): enter the facts of a document that does not exist and see the chain it would get: the rule that fits, the steps after
// the authority limits, who would be asked. A version that is not yet active can be tried first. The routing of a real document comes from the same function.
const PRESETS = [['amount', '2500000'], ['days', '12'], ['otHours', '5'], ['changePct', '4'], ['severity', 'major'], ['seniorGrade', 'true'], ['partyType', 'client'], ['highRisk', 'true']];
const value = (t) => (t === 'true' ? true : t === 'false' ? false : t !== '' && !Number.isNaN(Number(t)) ? Number(t) : t);

export default function ApprovalSimulatorPage() {
  usePageTitle('Approval Simulator');
  const q = useSearch();
  const types = useMatrixList({ limit: 100 });
  const [docType, setDocType] = useState(q.get('docType') ?? '');
  const [matrixId, setMatrixId] = useState(q.get('matrixId') ?? '');
  const [projectId, setProjectId] = useState('');
  const [date, setDate] = useState(todayIst());
  const [rows, setRows] = useState([{ key: 'amount', value: '' }]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const versions = useMatrixHistory(docType);
  if (types.error?.status === 403) return <NoPermission what="the approval simulator" permission="eng.matrix.view" />;
  const run = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const context = Object.fromEntries(rows.filter((r) => r.key.trim()).map((r) => [r.key.trim(), value(r.value.trim())]));
      setResult(await simulate({ docType, context, date, ...(projectId ? { projectId: Number(projectId) } : {}), ...(matrixId ? { matrixId: Number(matrixId) } : {}) }));
    } catch (er) { setError(errorInfo(er)); setResult(null); } finally { setBusy(false); }
  };
  const set = (i, p) => setRows(rows.map((r, k) => (k === i ? { ...r, ...p } : r)));
  return (
    <section aria-labelledby="as-title" data-testid="approval-simulator">
      <PageHeader id="as-title" title={"Approval Simulator"} subtitle={"Describe a document by its facts and see who would have to approve it, in what order, before you change a rule. Nothing is submitted or saved."} />
      <form onSubmit={run} aria-label="Simulate an approval" className="form-grid">
        <Field label="Document type" name="docType" error={error}>
          <select required value={docType} onChange={(e) => { setDocType(e.target.value); setMatrixId(''); setResult(null); }}><option value="">Choose a document type</option>{(types.data?.docTypes ?? []).map((t) => <option key={t.docType} value={t.docType}>{t.label}</option>)}</select>
        </Field>
        <Field label="Version to try" name="matrixId" error={error} hint="The one in force unless you choose a draft."><select value={matrixId} onChange={(e) => setMatrixId(e.target.value)} disabled={!docType}><option value="">The version in force</option>{(versions.data ?? []).map((v) => <option key={v.id} value={v.id}>Version {v.version} ({v.status.toLowerCase()})</option>)}</select></Field>
        <Field label="Date" name="date" error={error}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
        <Field label="Project number (optional)" name="projectId" error={error} hint="A project may have a matrix of its own."><input inputMode="numeric" value={projectId} onChange={(e) => setProjectId(e.target.value.replace(/\D/g, ''))} /></Field>
        <fieldset className="wf-editor-step"><legend>Facts of the document</legend>
          {rows.map((r, i) => (
            <div className="wf-inline" key={i}>
              <label className="field"><span>Field</span><input value={r.key} maxLength={60} onChange={(e) => set(i, { key: e.target.value })} /></label>
              <label className="field"><span>Value</span><input value={r.value} onChange={(e) => set(i, { value: e.target.value })} /></label>
              <button type="button" className="btn btn-small" onClick={() => setRows(rows.filter((_, k) => k !== i))}>Remove<span className="sr-only"> fact {i + 1}</span></button>
            </div>
          ))}
          <div className="wf-inline">{PRESETS.map(([k, v]) => <button key={k} type="button" className="btn btn-small" onClick={() => setRows([...rows.filter((r) => r.key !== k), { key: k, value: v }])}>Add {k}</button>)}
            <button type="button" className="btn btn-small" onClick={() => setRows([...rows, { key: '', value: '' }])}>Add another fact</button></div>
          <p className="muted small">Amounts are in rupees. Write true or false for yes-or-no facts.</p>
        </fieldset>
        <div className="actions"><button type="submit" className="btn btn-primary" disabled={busy || !docType}>Show the chain</button></div>
      </form>
      {error && <div role="alert" className="state state-error"><p>{error.form}</p>{error.correlationId && <p className="muted small">Correlation ID: <code>{error.correlationId}</code></p>}</div>}
      {result && (
        <section aria-labelledby="as-result" data-testid="as-result">
          <h2 id="as-result">The chain</h2>
          {!result.found && <p className="notice" role="note">{result.message}</p>}
          {result.found && !result.matched && <p role="alert" className="error">{result.message}</p>}
          {result.matched && (
            <>
              <p>Rule <strong data-testid="as-rule">{result.trace.rule}</strong> (priority {result.trace.priority}) of version {result.trace.matrixVersion} decides. <Link to={`/admin/approval-matrix/editor?id=${result.trace.matrixId}`}>Open that version</Link></p>
              <ol className="wf-diagram" aria-label="Steps of the chain" data-testid="as-steps">
                {result.steps.map((s, i) => (
                  <li key={s.code} className={`wf-step${s.applies ? '' : ' wf-step-skipped'}`}>
                    <span className="wf-step-no" aria-hidden="true">{i + 1}</span>
                    <strong>{s.name}</strong>
                    <span className="small">{s.approvers.map((a) => a.label).join(s.mode === 'parallel_all' ? ' and ' : ' / ')}</span>
                    {s.approvers.some((a) => a.holders.length > 0) && <span className="muted small">{s.approvers.flatMap((a) => a.holders).join(', ')}</span>}
                    {s.slaHours && <span className="muted small">{s.slaHours} working hours</span>}
                    {s.condition && <span className="muted small">only when {s.condition.field} {s.condition.op} {String(s.condition.value)}</span>}
                    <StatusBadge status={s.applies ? 'submitted' : 'cancelled'} label={s.applies ? 'Applies' : 'Does not apply to these facts'} />
                  </li>
                ))}
              </ol>
              {result.trace.skipped?.length > 0 && (
                <div className="notice" role="note" data-testid="as-skipped">
                  {result.trace.skipped.map((k) => <p key={k.step}>{k.role} was passed over: {k.reason}. {k.takenBy ? `${k.takenBy} takes the step.` : 'Nobody above has the authority either.'}</p>)}
                </div>
              )}
            </>
          )}
        </section>
      )}
    </section>
  );
}
