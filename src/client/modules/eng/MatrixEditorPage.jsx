import { useEffect, useState } from 'react';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ConfirmDialog } from '../../platform/feedback/Dialogs.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { useUnsavedGuard } from '../../platform/forms/guard.js';
import { useActivateMatrix, useDefinitionOptions, useDeleteMatrix, useMatrix, useMatrixCompare, useMatrixHistory, useSaveMatrix, validateMatrix } from '../../platform/workflow/api.js';
import { Field, Link, can, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { DEF_STATUS, useSearch } from './common.js';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { todayIst } from '../../platform/forms/dates.js';

// Matrix Rule Editor (part 04.02, section 7.2): the decision table of one version. Rules in priority order, each with its conditions on the facts of the document
// and the steps to take; checks for gaps (a document no rule fits) and for rules that can never be reached; a comparison with another version; the request to
// activate from a date. A version in force or waiting for approval is shown and not changed.
const OPS = [['eq', 'is'], ['ne', 'is not'], ['gt', 'is above'], ['gte', 'is at least'], ['lt', 'is below'], ['lte', 'is at most'], ['in', 'is one of']];
const show = (v) => (Array.isArray(v) ? v.join(', ') : String(v));
const parseValue = (text, op) => {
  if (op === 'in') return text.split(',').map((x) => x.trim()).filter(Boolean).map((x) => (Number.isNaN(Number(x)) ? x : Number(x)));
  if (text === 'true') return true;
  if (text === 'false') return false;
  return text !== '' && !Number.isNaN(Number(text)) ? Number(text) : text;
};
const blankRule = (n) => ({ priority: n, name: `Rule ${n / 10}`, conditions: [], steps: [{ role: 'PM' }] });

function Steps({ rule, set, roles, disabled, i }) {
  const patch = (j, p) => set({ steps: rule.steps.map((s, k) => (k === j ? { ...s, ...p } : s)) });
  return (
    <div role="group" aria-label={`Steps of rule ${i + 1}`}>
      {rule.steps.map((s, j) => (
        <div className="wf-inline" key={j}>
          <label className="field"><span>Step {j + 1} role</span>
            <select value={s.role} disabled={disabled} onChange={(e) => patch(j, { role: e.target.value })}>
              <option value="MANAGER">The reporting manager</option>{s.role.includes('|') && <option value={s.role}>{s.role.replace('|', ' or ')}</option>}
              {roles.map((r) => <option key={r.code} value={r.code}>{r.code} {r.name}</option>)}</select></label>
          <label className="field"><span>Hours allowed</span><input type="number" min={1} max={720} disabled={disabled} value={s.slaHours ?? ''} onChange={(e) => patch(j, { slaHours: e.target.value === '' ? null : Number(e.target.value) })} /></label>
          <label className="field"><span>Parallel group</span><input disabled={disabled} maxLength={20} value={s.group ?? ''} placeholder="none" onChange={(e) => patch(j, { group: e.target.value || undefined })} /></label>
          {s.group && <label className="field"><span>Group needs</span><select disabled={disabled} value={s.groupMode ?? 'all'} onChange={(e) => patch(j, { groupMode: e.target.value })}><option value="all">all of them</option><option value="any">any one</option></select></label>}
          <label className="check"><input type="checkbox" disabled={disabled} checked={s.authority ?? j === rule.steps.length - 1} onChange={(e) => patch(j, { authority: e.target.checked })} /> Final authority (its limit is checked)</label>
          {!disabled && <button type="button" className="btn btn-small" disabled={rule.steps.length === 1} onClick={() => set({ steps: rule.steps.filter((_, k) => k !== j) })}>Remove<span className="sr-only"> step {j + 1} of rule {i + 1}</span></button>}
        </div>
      ))}
      {!disabled && <button type="button" className="btn btn-small" onClick={() => set({ steps: [...rule.steps, { role: 'PM' }] })}>Add a step<span className="sr-only"> to rule {i + 1}</span></button>}
    </div>
  );
}

function Conditions({ rule, set, disabled, i }) {
  const patch = (j, p) => set({ conditions: rule.conditions.map((c, k) => (k === j ? { ...c, ...p } : c)) });
  return (
    <div role="group" aria-label={`Conditions of rule ${i + 1}`}>
      {rule.conditions.length === 0 && <p className="muted small">No condition: this rule fits every document that reaches it.</p>}
      {rule.conditions.map((c, j) => (
        <div className="wf-inline" key={j}>
          <label className="field"><span>When (field)</span><input value={c.field} disabled={disabled} maxLength={60} placeholder="amount" onChange={(e) => patch(j, { field: e.target.value })} /></label>
          <label className="field"><span>Is</span><select value={c.op} disabled={disabled} onChange={(e) => patch(j, { op: e.target.value, value: parseValue(show(c.value), e.target.value) })}>{OPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className="field"><span>Value</span><input value={show(c.value)} disabled={disabled} onChange={(e) => patch(j, { value: parseValue(e.target.value, c.op) })} /></label>
          {!disabled && <button type="button" className="btn btn-small" onClick={() => set({ conditions: rule.conditions.filter((_, k) => k !== j) })}>Remove<span className="sr-only"> condition {j + 1} of rule {i + 1}</span></button>}
        </div>
      ))}
      {!disabled && <button type="button" className="btn btn-small" onClick={() => set({ conditions: [...rule.conditions, { field: 'amount', op: 'lte', value: 0 }] })}>Add a condition<span className="sr-only"> to rule {i + 1}</span></button>}
    </div>
  );
}

export default function MatrixEditorPage({ session }) {
  usePageTitle('Matrix Rule Editor');
  const id = Number(useSearch().get('id')) || null;
  const query = useMatrix(id);
  const options = useDefinitionOptions();
  const save = useSaveMatrix();
  const activate = useActivateMatrix();
  const remove = useDeleteMatrix();
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const [checks, setChecks] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [from, setFrom] = useState(todayIst(Date.now() + 86_400_000));
  const [dirty, setDirty] = useState(false);
  const [compareWith, setCompareWith] = useState('');
  useUnsavedGuard(dirty);
  const m = query.data;
  const history = useMatrixHistory(m?.docType);
  const compare = useMatrixCompare(compareWith, m?.id);
  useEffect(() => { if (m) setForm({ name: m.name, rules: m.rules }); }, [m?.id, m?.rowVersion]);
  const editable = Boolean(m && can(session, 'eng.matrix.manage') && ['DRAFT', 'REJECTED'].includes(m.status));
  const change = (patch) => { setDirty(true); setChecks(null); setForm((f) => ({ ...f, ...patch })); };
  const setRule = (i, p) => change({ rules: form.rules.map((r, k) => (k === i ? { ...r, ...p } : r)) });
  if (!id) return <section aria-labelledby="me-title"><PageHeader id="me-title" title={"Matrix Rule Editor"} /><EmptyState title="No version chosen" message="Open a version from the approval matrix, or make a new version of a document type there." action={{ label: 'Open the approval matrix', onClick: () => navigateTo('/admin/approval-matrix') }} /></section>;
  if (query.error?.status === 403) return <NoPermission what="the approval matrix" permission="eng.matrix.view" />;
  const body = () => ({ id, name: form.name, rules: form.rules.map(({ id: _i, version: _v, ...r }) => r), version: m.rowVersion });
  const doSave = () => save.mutateAsync(body()).then(() => { setDirty(false); setNotice('Saved.'); setError(null); return true; }).catch((e) => { setError(errorInfo(e)); return false; });
  const check = async () => { if (dirty && !(await doSave())) return; try { setChecks(await validateMatrix(id)); } catch (e) { setError(errorInfo(e)); } };
  const request = async () => {
    if (dirty && !(await doSave())) throw new Error('not saved');
    const out = await activate.mutateAsync({ id, effectiveFrom: from });
    setDirty(false);
    setConfirm(null);
    navigateTo(`/workflow/instance?id=${out.instance.id}`, { force: true });
  };
  return (
    <section aria-labelledby="me-title" data-testid="matrix-editor">
      <PageHeader id="me-title" title={"Matrix Rule Editor"} />
      {query.isPending && <Skeleton label="Loading the matrix" rows={4} />}
      {query.isError && query.error?.status !== 403 && <ErrorState title="The matrix could not be loaded" error={query.error} onRetry={() => query.refetch()} />}
      {m && form && (
        <>
          <p><strong>{m.docLabel}</strong> <code className="small">{m.docType}</code> · version {m.version} · <StatusBadge status={DEF_STATUS[m.status][0]} label={DEF_STATUS[m.status][1]} /> · {m.effectiveFrom ? `from ${m.effectiveFrom}${m.effectiveTo ? ` to ${m.effectiveTo}` : ''}` : 'no date yet'}
            {m.status === 'PENDING' && m.instanceId && <> · <Link to={`/workflow/instance?id=${m.instanceId}`}>see its approval</Link></>} · <Link to={`/admin/approval-simulator?docType=${m.docType}&matrixId=${m.id}`}>try it in the simulator</Link></p>
          {!editable && <p className="notice" role="note">{m.status === 'PENDING' ? 'This version waits for its approval and cannot be changed.' : 'A version in force, or one that was, is never changed, so the documents routed by it can be traced. Make a new version to change the rules.'}</p>}
          {notice && <p role="status" className="notice" data-testid="me-notice">{notice}</p>}
          {error && <div role="alert" className="state state-error"><p>{error.form}</p>{error.correlationId && <p className="muted small">Correlation ID: <code>{error.correlationId}</code></p>}{Object.entries(error.fields ?? {}).map(([k, v]) => <p key={k} className="small">{k}: {v}</p>)}</div>}
          <form onSubmit={(e) => { e.preventDefault(); doSave(); }} aria-label="Rules" noValidate>
            <Field label="Name of this version" name="name" error={error}><input value={form.name} disabled={!editable} maxLength={120} onChange={(e) => change({ name: e.target.value })} /></Field>
            <h2>Rules</h2>
            <p className="muted small">The rules are read from the smallest priority number up; the first rule whose conditions all hold decides the chain.</p>
            {form.rules.map((r, i) => (
              <fieldset className="wf-editor-step" key={i} disabled={!editable} data-testid={`me-rule-${i}`}>
                <legend>Rule {i + 1}: {r.name}</legend>
                <div className="form-grid">
                  <Field label="Priority" name={`rules.${i}.priority`} error={error}><input type="number" min={1} value={r.priority} onChange={(e) => setRule(i, { priority: Number(e.target.value) })} /></Field>
                  <Field label="Name of the rule" name={`rules.${i}.name`} error={error}><input value={r.name} maxLength={100} onChange={(e) => setRule(i, { name: e.target.value })} /></Field>
                </div>
                <Conditions rule={r} set={(p) => setRule(i, p)} disabled={!editable} i={i} />
                <Steps rule={r} set={(p) => setRule(i, p)} roles={options.data?.roles ?? []} disabled={!editable} i={i} />
                {editable && <div className="actions"><button type="button" className="btn btn-small btn-danger" disabled={form.rules.length === 1} onClick={() => change({ rules: form.rules.filter((_, k) => k !== i) })}>Remove rule<span className="sr-only"> {i + 1}</span></button></div>}
              </fieldset>
            ))}
            {editable && <div className="actions"><button type="button" className="btn" onClick={() => change({ rules: [...form.rules, blankRule((form.rules.reduce((n, r) => Math.max(n, r.priority), 0) || 0) + 10)] })}>Add a rule</button></div>}
            {editable && (
              <div className="actions">
                <label className="field"><span>Takes effect from</span><input type="date" value={from} min={todayIst()} onChange={(e) => setFrom(e.target.value)} /></label>
                <button type="submit" className="btn" disabled={save.isPending}>Save draft</button>
                <button type="button" className="btn" onClick={check}>Check for gaps</button>
                <button type="button" className="btn btn-primary" onClick={() => setConfirm('activate')}>Request activation</button>
                <button type="button" className="btn btn-danger" onClick={() => setConfirm('delete')}>Delete this draft</button>
              </div>
            )}
          </form>
          {checks && (
            <div className={checks.ok ? 'notice' : 'state state-error'} role="status" data-testid="me-checks">
              {checks.ok ? <p>No document can fall through these rules ({checks.tested} cases tried).</p> : <p>These rules leave gaps or are not valid.</p>}
              {checks.problems.map((p, i) => <p key={i} className="small">{p.field}: {p.message}</p>)}
              {checks.gaps.map((g, i) => <p key={i} className="small">A document like {JSON.stringify(g)} would match no rule.</p>)}
              {checks.shadowed.length > 0 && <p className="small">Never reached (an earlier rule always fits first): {checks.shadowed.map((s) => s.name).join(', ')}.</p>}
            </div>
          )}
          <h2>Compare with another version</h2>
          <label className="field"><span>Version</span><select value={compareWith} onChange={(e) => setCompareWith(e.target.value)}><option value="">Choose a version</option>{(history.data ?? []).filter((v) => v.id !== m.id).map((v) => <option key={v.id} value={v.id}>Version {v.version} ({DEF_STATUS[v.status][1]})</option>)}</select></label>
          {compare.data && (
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Differences">
              <table className="grid"><thead><tr><th>Priority</th><th>Rule</th><th>Change from that version to this</th></tr></thead>
                <tbody>{compare.data.map((c) => <tr key={c.priority}><td className="num" data-label="Priority">{c.priority}</td><th scope="row" data-label="Rule">{(c.to ?? c.from).name}</th><td data-label="Change">{{ SAME: 'No change', CHANGED: 'Changed', ADDED: 'Added', REMOVED: 'Removed' }[c.change]}</td></tr>)}</tbody></table>
            </div>
          )}
          <p className="muted small">Activation is a request. The system administrator, then the chief financial officer (or the owner of the process for documents that are not financial) must approve it, and nobody approves what they raised. It takes effect from the date you choose, never earlier than today.</p>
        </>
      )}
      <ConfirmDialog open={confirm === 'activate'} title="Request activation of this version?" text="The rules are checked for gaps and sent to the approval chain. From the date you choose the new documents of this type are routed by them." confirmLabel="Request activation" onConfirm={request} onCancel={() => setConfirm(null)} />
      <ConfirmDialog open={confirm === 'delete'} title="Delete this draft?" text="The draft is removed. Versions that were in force are never deleted." confirmLabel="Delete" danger onConfirm={async () => { await remove.mutateAsync(id); setDirty(false); setConfirm(null); navigateTo('/admin/approval-matrix', { force: true }); }} onCancel={() => setConfirm(null)} />
    </section>
  );
}
