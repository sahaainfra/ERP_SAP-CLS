import { useEffect, useMemo, useState } from 'react';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ConfirmDialog } from '../../platform/feedback/Dialogs.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { useUnsavedGuard } from '../../platform/forms/guard.js';
import StepDiagram from '../../platform/workflow/StepDiagram.jsx';
import { useActivate, useCompare, useDefinition, useDefinitionOptions, useDefinitions, useDeleteDefinition, useSaveDefinition } from '../../platform/workflow/api.js';
import { Field, Link, can, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { DEF_STATUS, useSearch } from './common.js';

// Workflow Definition Editor (part 04.01, section 7.2): a form-based list of steps with a read-only diagram of what it makes, a comparison with the active
// version, and the request to activate it. An active or retired version is shown but never changed: make a new version instead.
const blankStep = (n) => ({ code: `STEP${n}`, name: `Step ${n}`, type: 'approval', mode: 'single', approvers: [{ kind: 'role', role: 'PM' }], slaHours: null, requireAttachment: false, checklist: [], when: null, notify: [], action: null });
const blankApprover = { kind: 'role', role: 'PM' };

function ApproverRows({ list, onChange, options, disabled, label, prefix, error }) {
  const set = (i, patch) => onChange(list.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const kindChange = (i, kind) => set(i, { kind, role: undefined, user: undefined, resolver: undefined, ...(kind === 'role' ? { role: 'PM' } : kind === 'user' ? { user: '' } : kind === 'resolver' ? { resolver: options.resolvers[0] } : {}) });
  return (
    <div role="group" aria-label={label}>
      {list.map((a, i) => (
        <div className="wf-inline" key={i}>
          <label className="field"><span>{label} {i + 1}</span>
            <select value={a.kind} disabled={disabled} onChange={(e) => kindChange(i, e.target.value)}><option value="role">A role</option><option value="user">A person</option><option value="manager">The reporting manager</option><option value="resolver">A rule</option></select></label>
          {a.kind === 'role' && <label className="field"><span>Role</span><select value={a.role} disabled={disabled} onChange={(e) => set(i, { role: e.target.value })}>{options.roles.map((r) => <option key={r.code} value={r.code}>{r.code} {r.name}</option>)}</select></label>}
          {a.kind === 'user' && <label className="field"><span>User name</span><input value={a.user} disabled={disabled} maxLength={60} onChange={(e) => set(i, { user: e.target.value })} /></label>}
          {a.kind === 'resolver' && <label className="field"><span>Rule</span><select value={a.resolver} disabled={disabled} onChange={(e) => set(i, { resolver: e.target.value })}>{options.resolvers.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>}
          {!disabled && <button type="button" className="btn btn-small" onClick={() => onChange(list.filter((_, j) => j !== i))}>Remove<span className="sr-only"> {label} {i + 1}</span></button>}
        </div>
      ))}
      {error?.fields?.[prefix] && <span className="field-error" role="alert">{error.fields[prefix]}</span>}
      {!disabled && <button type="button" className="btn btn-small" onClick={() => onChange([...list, blankApprover])}>Add {label.toLowerCase()}</button>}
    </div>
  );
}

function StepFields({ step, i, count, set, move, remove, options, disabled, error }) {
  const decides = step.type === 'approval' || step.type === 'review';
  return (
    <fieldset className="wf-editor-step" disabled={disabled} data-testid={`wf-edit-step-${i}`}>
      <legend>Step {i + 1}: {step.name}</legend>
      <div className="form-grid">
        <Field label="Code" name={`steps.${i}.code`} error={error} hint="Letters and digits; used in the history."><input value={step.code} maxLength={24} onChange={(e) => set({ code: e.target.value })} /></Field>
        <Field label="Name" name={`steps.${i}.name`} error={error}><input value={step.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label="Kind of step" name={`steps.${i}.type`} error={error}>
          <select value={step.type} onChange={(e) => set({ type: e.target.value, approvers: ['approval', 'review'].includes(e.target.value) ? (step.approvers.length ? step.approvers : [blankApprover]) : [], notify: e.target.value === 'notification' ? (step.notify.length ? step.notify : [blankApprover]) : [], action: e.target.value === 'system' ? (options.systemActions[0] ?? null) : null })}>
            <option value="approval">Approval</option><option value="review">Review</option><option value="notification">Notification</option><option value="system">System action</option>
          </select>
        </Field>
        {decides && <Field label="Who must decide" name={`steps.${i}.mode`} error={error}><select value={step.mode} onChange={(e) => set({ mode: e.target.value })}><option value="single">One approver</option><option value="parallel_all">All of them (in parallel)</option><option value="parallel_any">Any one of them (in parallel)</option></select></Field>}
        {decides && <Field label="Time allowed (hours)" name={`steps.${i}.slaHours`} error={error} hint="Empty uses the company default."><input type="number" min={1} max={2160} value={step.slaHours ?? ''} onChange={(e) => set({ slaHours: e.target.value === '' ? null : Number(e.target.value) })} /></Field>}
        {step.type === 'system' && <Field label="Action" name={`steps.${i}.action`} error={error}><select value={step.action ?? ''} onChange={(e) => set({ action: e.target.value })}>{options.systemActions.map((a) => <option key={a} value={a}>{a}</option>)}{options.systemActions.length === 0 && <option value="">No system action is registered</option>}</select></Field>}
      </div>
      {decides && <ApproverRows list={step.approvers} onChange={(approvers) => set({ approvers })} options={options} disabled={disabled} label="Approver" prefix={`steps.${i}.approvers`} error={error} />}
      {step.type === 'notification' && <ApproverRows list={step.notify} onChange={(notify) => set({ notify })} options={options} disabled={disabled} label="Person to tell" prefix={`steps.${i}.notify`} error={error} />}
      {decides && (
        <div className="form-grid">
          <label className="check"><input type="checkbox" checked={step.requireAttachment} onChange={(e) => set({ requireAttachment: e.target.checked })} /> The approver must attach a file</label>
          <Field label="Checklist (one item per line)" name={`steps.${i}.checklist`} error={error} hint="Every item must be ticked before the approver approves."><textarea rows="2" value={step.checklist.join('\n')} onChange={(e) => set({ checklist: e.target.value.split('\n').map((l) => l.trim()).filter(Boolean) })} /></Field>
        </div>
      )}
      <div className="wf-inline">
        <label className="field"><span>Only when (field)</span><input value={step.when?.field ?? ''} placeholder="amount" maxLength={60} onChange={(e) => set({ when: e.target.value ? { field: e.target.value, op: step.when?.op ?? 'gte', value: step.when?.value ?? '' } : null })} /></label>
        {step.when && (
          <>
            <label className="field"><span>is</span><select value={step.when.op} onChange={(e) => set({ when: { ...step.when, op: e.target.value } })}>{options.operators.map((o) => <option key={o} value={o}>{{ eq: 'equal to', ne: 'not equal to', gt: 'above', gte: 'at least', lt: 'below', lte: 'at most', in: 'one of' }[o]}</option>)}</select></label>
            <label className="field"><span>Value</span><input value={Array.isArray(step.when.value) ? step.when.value.join(',') : step.when.value} onChange={(e) => set({ when: { ...step.when, value: step.when.op === 'in' ? e.target.value.split(',').map((x) => x.trim()) : (e.target.value !== '' && !Number.isNaN(Number(e.target.value)) ? Number(e.target.value) : e.target.value) } })} /></label>
          </>
        )}
        <span className="muted small">{step.when ? '' : 'Leave empty to always include this step.'}</span>
      </div>
      {!disabled && (
        <div className="actions">
          <button type="button" className="btn btn-small" disabled={i === 0} onClick={() => move(-1)}>Move up<span className="sr-only"> step {i + 1}</span></button>
          <button type="button" className="btn btn-small" disabled={i === count - 1} onClick={() => move(1)}>Move down<span className="sr-only"> step {i + 1}</span></button>
          <button type="button" className="btn btn-small btn-danger" disabled={count === 1} onClick={remove}>Remove step<span className="sr-only"> {i + 1}</span></button>
        </div>
      )}
    </fieldset>
  );
}

export default function WorkflowEditorPage({ session }) {
  usePageTitle('Workflow Definition Editor');
  const id = Number(useSearch().get('id')) || null;
  const query = useDefinition(id);
  const options = useDefinitionOptions();
  const save = useSaveDefinition();
  const activate = useActivate();
  const remove = useDeleteDefinition();
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty);
  const [compareWith, setCompareWith] = useState('');
  const def = query.data;
  const versions = useDefinitions({ docType: def?.docType ?? '', limit: 100 });
  const compare = useCompare(compareWith, def?.id);
  useEffect(() => { if (def) setForm({ name: def.name, settings: def.settings, steps: def.steps }); }, [def?.id, def?.rowVersion]);
  const editable = Boolean(def && can(session, 'eng.workflow.define') && ['DRAFT', 'REJECTED'].includes(def.status));
  const change = (patch) => { setDirty(true); setForm((f) => ({ ...f, ...patch })); };
  const setStep = (i, patch) => change({ steps: form.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const preview = useMemo(() => form?.steps.map((s) => ({ ...s, notify: s.notify ?? [] })) ?? [], [form]);
  if (!id) return <section aria-labelledby="we-title"><h1 id="we-title">Workflow Definition Editor</h1><EmptyState title="No definition chosen" message="Open a definition from the list, or make a new version of a document type there." action={{ label: 'Open the workflow definitions', onClick: () => navigateTo('/admin/workflows') }} /></section>;
  if (query.error?.status === 403) return <NoPermission what="the workflow definitions" permission="eng.workflow.view" />;
  const body = () => ({ docType: def.docType, name: form.name, settings: form.settings, steps: form.steps });
  const doSave = () => save.mutateAsync({ id, definition: body(), version: def.rowVersion }).then(() => { setDirty(false); setNotice('Saved.'); setError(null); return true; }).catch((e) => { setError(errorInfo(e)); return false; });
  const request = async () => {
    if (!(await doSave())) throw new Error('not saved');
    const out = await activate.mutateAsync(id);
    setDirty(false);
    setConfirm(null);
    navigateTo(`/workflow/instance?id=${out.instance.id}`, { force: true });
  };
  return (
    <section aria-labelledby="we-title" data-testid="workflow-editor">
      <h1 id="we-title">Workflow Definition Editor</h1>
      {query.isPending && <Skeleton label="Loading the definition" rows={4} />}
      {query.isError && query.error?.status !== 403 && <ErrorState title="The definition could not be loaded" error={query.error} onRetry={() => query.refetch()} />}
      {def && form && (
        <>
          <p><strong>{def.docLabel}</strong> <code className="small">{def.docType}</code> · version {def.version} · <StatusBadge status={DEF_STATUS[def.status][0]} label={DEF_STATUS[def.status][1]} />
            {def.status === 'PENDING' && def.requestInstanceId && <> · <Link to={`/workflow/instance?id=${def.requestInstanceId}`}>see its approval</Link></>}</p>
          {!editable && <p className="notice" role="note">{['DRAFT', 'REJECTED'].includes(def.status) ? 'You can read this version but not change it.' : def.status === 'PENDING' ? 'This version is waiting for its approval chain and cannot be changed.' : 'An active or retired version is never changed, so the documents that used it can be traced. Make a new version of the document type to change the chain.'}</p>}
          {def.status === 'REJECTED' && <p className="notice" role="note">The approval of this version was rejected or returned. Correct it below and request activation again.</p>}
          {notice && <p role="status" className="notice" data-testid="we-notice">{notice}</p>}
          {error && <div role="alert" className="state state-error"><p>{error.form}</p>{error.correlationId && <p className="muted small">Correlation ID: <code>{error.correlationId}</code></p>}{Object.entries(error.fields ?? {}).map(([k, m]) => <p key={k} className="small">{k}: {m}</p>)}</div>}
          <form onSubmit={(e) => { e.preventDefault(); doSave(); }} aria-label="Definition" noValidate>
            <fieldset disabled={!editable} className="form-grid">
              <legend>The definition</legend>
              <Field label="Name" name="name" error={error}><input value={form.name} maxLength={120} required onChange={(e) => change({ name: e.target.value })} /></Field>
              <Field label="After a return to the originator, resubmission restarts" name="settings" error={error}><select value={form.settings.resubmit} onChange={(e) => change({ settings: { ...form.settings, resubmit: e.target.value } })}><option value="first">from the first step</option><option value="returning_step">from the step that returned it</option></select></Field>
              <label className="check"><input type="checkbox" checked={form.settings.distinctApprovers} onChange={(e) => change({ settings: { ...form.settings, distinctApprovers: e.target.checked } })} /> One person may decide only one step of a document</label>
            </fieldset>
            <h2>Steps</h2>
            {form.steps.map((s, i) => (
              <StepFields key={i} step={s} i={i} count={form.steps.length} options={options.data ?? { roles: [], resolvers: [], systemActions: [], operators: [] }} disabled={!editable} error={error}
                set={(patch) => setStep(i, patch)} move={(d) => { const steps = [...form.steps]; [steps[i], steps[i + d]] = [steps[i + d], steps[i]]; change({ steps }); }} remove={() => change({ steps: form.steps.filter((_, j) => j !== i) })} />
            ))}
            {editable && <div className="actions"><button type="button" className="btn" onClick={() => change({ steps: [...form.steps, blankStep(form.steps.length + 1)] })}>Add a step</button></div>}
            <h2>What this makes</h2>
            <StepDiagram steps={preview} label="Diagram of the workflow" />
            {editable && (
              <div className="actions">
                <button type="submit" className="btn" disabled={save.isPending}>Save draft</button>
                <button type="button" className="btn btn-primary" disabled={save.isPending || activate.isPending} onClick={() => setConfirm('activate')}>Save and request activation</button>
                <button type="button" className="btn btn-danger" onClick={() => setConfirm('delete')}>Delete this draft</button>
              </div>
            )}
          </form>
          <h2>Compare with another version</h2>
          <label className="field"><span>Version</span>
            <select value={compareWith} onChange={(e) => setCompareWith(e.target.value)}><option value="">Choose a version</option>{(versions.data?.rows ?? []).filter((v) => v.id !== def.id).map((v) => <option key={v.id} value={v.id}>Version {v.version} ({DEF_STATUS[v.status][1]})</option>)}</select></label>
          {compare.data && (
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Differences">
              <table className="grid"><thead><tr><th>Step</th><th>Change from that version to this</th></tr></thead>
                <tbody>{compare.data.map((c) => <tr key={c.code}><th scope="row" data-label="Step">{(c.to ?? c.from).name} <code className="small">{c.code}</code></th><td data-label="Change">{{ SAME: 'No change', CHANGED: 'Changed', ADDED: 'Added', REMOVED: 'Removed' }[c.change]}</td></tr>)}</tbody></table>
            </div>
          )}
          <p className="muted small">Activation is a request: the system administrator, the owner of the process of this document type and the IT administrator must each approve it, and nobody may approve a request they raised.</p>
        </>
      )}
      <ConfirmDialog open={confirm === 'activate'} title="Request activation of this version?" text="The version is saved and sent to the approval chain. It becomes the one new documents use only when every step has approved it; documents already in approval keep the version they started with." confirmLabel="Request activation" onConfirm={request} onCancel={() => setConfirm(null)} />
      <ConfirmDialog open={confirm === 'delete'} title="Delete this draft?" text="The draft is removed. Versions that were active are never deleted." confirmLabel="Delete" danger onConfirm={async () => { await remove.mutateAsync(id); setDirty(false); setConfirm(null); navigateTo('/admin/workflows', { force: true }); }} onCancel={() => setConfirm(null)} />
    </section>
  );
}
