import { useEffect, useState } from 'react';
import { EmptyState } from '../../platform/feedback/states.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { useCreateTask, useInstruct, useRoutePreview } from '../../platform/tasks/api.js';
import { Field, Link, can, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { PRIORITY, taskLink } from './tasks-common.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// New Task / Senior Instruction (part 04.08, section 7.3): a task for yourself or, with the right, for someone else; or an instruction by topic, where the department responsibility matrix
// names the department, the role and the person, and the form shows that routing before it is sent. The person given an instruction must accept it.
const BLANK = { title: '', description: '', priority: 'MEDIUM', dueDate: '', topicCode: '', projectId: '', departmentId: '', assignee: '', checklist: '', requiresEvidence: false, requiresVerification: false, repeat: '', interval: '1' };
const DRAFT = 'erp.task.draft';
const load = () => { try { return { ...BLANK, ...JSON.parse(globalThis.localStorage.getItem(DRAFT) ?? '{}') }; } catch { return BLANK; } };

export default function NewTaskPage({ session }) {
  usePageTitle('New Task');
  const senior = can(session, 'tsk.instruction.create');
  const assign = can(session, 'tsk.task.assign');
  const [mode, setMode] = useState('task');
  const [f, setF] = useState(load);
  const [error, setError] = useState(null);
  const create = useCreateTask();
  const instruct = useInstruct();
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  useEffect(() => { try { globalThis.localStorage.setItem(DRAFT, JSON.stringify(f)); } catch { /* a draft is a convenience */ } }, [f]);
  const instruction = mode === 'instruction';
  const preview = useRoutePreview({ topicCode: f.topicCode, projectId: f.projectId, departmentId: f.departmentId }, instruction && /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/.test(f.topicCode));
  const body = () => ({
    title: f.title, ...(f.description ? { description: f.description } : {}), priority: f.priority, ...(f.dueDate ? { dueDate: f.dueDate } : {}),
    ...(f.projectId ? { projectId: Number(f.projectId) } : {}), ...(f.departmentId ? { departmentId: Number(f.departmentId) } : {}),
    ...(f.checklist.trim() ? { checklist: f.checklist.split('\n').map((x) => x.trim()).filter(Boolean) } : {}), requiresEvidence: f.requiresEvidence, requiresVerification: f.requiresVerification,
  });
  const done = (t) => { try { globalThis.localStorage.removeItem(DRAFT); } catch { /* ignore */ } navigateTo(taskLink(t.id)); };
  const submit = (e) => {
    e.preventDefault();
    setError(null);
    if (instruction) instruct.mutate({ ...body(), topicCode: f.topicCode }, { onSuccess: done, onError: (er) => setError(errorInfo(er)) });
    else create.mutate({ ...body(), ...(f.assignee ? { assignees: [f.assignee], requiresAcceptance: true } : {}), ...(f.repeat ? { recurrence: { freq: f.repeat, interval: Number(f.interval) || 1 } } : {}) }, { onSuccess: done, onError: (er) => setError(errorInfo(er)) });
  };
  const r = preview.data;
  const pending = create.isPending || instruct.isPending;
  return (
    <section aria-labelledby="nt-title" data-testid="new-task">
      <PageHeader id="nt-title" title={"New Task / Senior Instruction"} />
      {senior && <div role="tablist" aria-label="What to make" className="tabs">
        <button type="button" role="tab" aria-selected={!instruction} className={`btn${!instruction ? ' btn-primary' : ''}`} onClick={() => setMode('task')}>Task</button>
        <button type="button" role="tab" aria-selected={instruction} className={`btn${instruction ? ' btn-primary' : ''}`} onClick={() => setMode('instruction')}>Senior instruction by topic</button></div>}
      <p className="muted">{instruction ? 'Name the topic. The department responsibility matrix finds the department, the role and the person; they must accept it, and you can ask for evidence and verification.' : 'A task for yourself' + (assign ? ', or for someone else.' : '.')}</p>
      <form className="form-grid" onSubmit={submit} aria-label={instruction ? 'Raise an instruction' : 'Make a task'} data-testid="task-form">
        <Field label="Title" name="title" error={error}><input value={f.title} maxLength={200} required onChange={(e) => set({ title: e.target.value })} /></Field>
        <Field label="Description" name="description" error={error}><textarea rows="3" value={f.description} maxLength={4000} onChange={(e) => set({ description: e.target.value })} /></Field>
        {instruction && <Field label="Topic (for example safety.ppe)" name="topicCode" error={error}><input value={f.topicCode} maxLength={60} onChange={(e) => set({ topicCode: e.target.value.trim() })} /></Field>}
        <div className="wf-inline">
          <label className="field"><span>Priority</span><select value={f.priority} onChange={(e) => set({ priority: e.target.value })}>{Object.entries(PRIORITY).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <Field label="Due date" name="dueDate" error={error}><input type="date" value={f.dueDate} onChange={(e) => set({ dueDate: e.target.value })} /></Field>
        </div>
        <div className="wf-inline">
          <LookupField id="nt-project" label="Project" lookup="iam/projects" value={f.projectId} onChange={(v) => set({ projectId: v })} />
          <LookupField id="nt-department" label={instruction ? 'Department (if the topic has none)' : 'Department'} lookup="iam/departments" value={f.departmentId} onChange={(v) => set({ departmentId: v })} />
        </div>
        {!instruction && assign && <LookupField id="nt-assignee" label="Give it to (leave empty for yourself)" lookup="iam/users" valueKey="code" value={f.assignee} onChange={(v) => set({ assignee: v })} />}
        <Field label="Checklist (one item on each line)" name="checklist" error={error}><textarea rows="3" value={f.checklist} onChange={(e) => set({ checklist: e.target.value })} /></Field>
        <div className="wf-inline">
          <label className="field"><span><input type="checkbox" checked={f.requiresEvidence} onChange={(e) => set({ requiresEvidence: e.target.checked })} /> Needs evidence (a photo or a document)</span></label>
          <label className="field"><span><input type="checkbox" checked={f.requiresVerification} onChange={(e) => set({ requiresVerification: e.target.checked })} /> I will verify it before it closes</span></label>
        </div>
        {!instruction && <div className="wf-inline">
          <label className="field"><span>Repeats</span><select value={f.repeat} onChange={(e) => set({ repeat: e.target.value })}><option value="">Does not repeat</option><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option></select></label>
          {f.repeat && <Field label="Every how many" name="recurrence.interval" error={error}><input type="number" min="1" max="52" value={f.interval} onChange={(e) => set({ interval: e.target.value })} /></Field>}
        </div>}
        {instruction && (
          <section className="card" aria-live="polite" aria-label="Where this instruction goes" data-testid="route-preview">
            <h2>Where it goes</h2>
            {!r && <p className="muted">Enter a topic to see who it would go to.</p>}
            {r && <>
              <p>Department <strong>{r.department?.name ?? '—'}</strong> · role <strong>{r.role ?? '—'}</strong> · person <strong data-testid="route-employee">{r.employeeName ?? r.employee ?? 'nobody found'}</strong></p>
              {r.failed && <p role="status" className="notice" data-testid="route-failed">{r.failed} {r.employee ? 'It goes to the head of the department to place.' : 'Choose a department so it can go to its head, or ask for the matrix to be completed.'}</p>}
              <ol>{r.trail.map((x, i) => <li key={i} className="small">{x}</li>)}</ol>
            </>}
          </section>)}
        {error?.form && <p role="alert" className="error">{error.form}</p>}
        <div className="actions"><button type="submit" className="btn btn-primary" disabled={pending || f.title.trim().length < 3 || (instruction && !f.topicCode)}>{instruction ? 'Send the instruction' : 'Make the task'}</button><Link to="/tasks">Cancel</Link>
          <button type="button" className="btn" onClick={() => setF(BLANK)}>Clear the form</button></div>
      </form>
      {!senior && instruction && <EmptyState title="Instructions are for seniors" message="You may make tasks for yourself." />}
    </section>
  );
}
