import { useEffect, useState } from 'react';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDate, formatDateTime } from '../../platform/format.js';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { useTask, useTaskAct, useTaskChecklist, useTaskComment, useTaskDepend, useTaskPeople, useUpdateTask } from '../../platform/tasks/api.js';
import { AttachmentList, FileUploader } from '../core/components/Attachments.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from './common.js';
import { ACTION_LABEL, NEEDS_REASON, ORIGIN, PRIORITY, STATUS, taskLink } from './tasks-common.js';

// Task (part 04.08, section 7.2): one task as an Object Page. The header says where it stands and offers what this person may do next; the tabs hold the details (and how an instruction was routed),
// the checklist, the evidence, what it depends on, the discussion and the history with its escalations. A task that needs evidence does not close without a file; one that needs
// verification does not close before the person who gave it has checked it.
const TABS = [['details', 'Details'], ['checklist', 'Checklist'], ['evidence', 'Evidence'], ['depends', 'Dependencies'], ['discussion', 'Discussion'], ['history', 'History']];
const ORDER = ['accept', 'start', 'unblock', 'complete', 'verify', 'close', 'block', 'reopen', 'cancel'];

function Details({ t, edit, setEdit, onSave, saving, error }) {
  const [form, setForm] = useState({ title: t.title, description: t.description ?? '', priority: t.priority, dueDate: t.dueDate ?? '' });
  const [people, setPeople] = useState({ assignee: '', watcher: '' });
  const peopleMut = useTaskPeople();
  const [perr, setPerr] = useState(null);
  useEffect(() => setForm({ title: t.title, description: t.description ?? '', priority: t.priority, dueDate: t.dueDate ?? '' }), [t.version]);
  const addPerson = (role, user) => {
    setPerr(null);
    const now = role === 'assignee' ? t.assignees.map((a) => a.user) : t.watchers;
    if (!user || now.includes(user)) return;
    peopleMut.mutate({ id: t.id, [role === 'assignee' ? 'assignees' : 'watchers']: [...now, user] }, { onError: (e) => setPerr(errorInfo(e)) });
  };
  const removePerson = (role, user) => {
    setPerr(null);
    const now = role === 'assignee' ? t.assignees.map((a) => a.user) : t.watchers;
    const next = now.filter((u) => u !== user);
    if (role === 'assignee' && next.length === 0) { setPerr({ form: 'A task needs someone to do it. Add the new person first.' }); return; }
    peopleMut.mutate({ id: t.id, [role === 'assignee' ? 'assignees' : 'watchers']: next }, { onError: (e) => setPerr(errorInfo(e)) });
  };
  return (
    <div data-testid="task-details">
      {edit ? (
        <form className="form-grid" aria-label="Change the task" onSubmit={(e) => { e.preventDefault(); onSave({ id: t.id, ...form, description: form.description || undefined, dueDate: form.dueDate || undefined, version: t.version }); }}>
          <Field label="Title" name="title" error={error}><input value={form.title} maxLength={200} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Description" name="description" error={error}><textarea rows="4" value={form.description} maxLength={4000} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <div className="wf-inline">
            <label className="field"><span>Priority</span><select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>{Object.entries(PRIORITY).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <Field label="Due date" name="dueDate" error={error}><input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></Field>
          </div>
          {error?.form && <p role="alert" className="error">{error.form}</p>}
          <div className="actions"><button type="submit" className="btn btn-primary" disabled={saving}>Save</button><button type="button" className="btn" onClick={() => setEdit(false)}>Cancel</button></div>
        </form>
      ) : (
        <dl className="kv">
          <dt>Description</dt><dd>{t.description || <span className="muted">None</span>}</dd>
          <dt>Record</dt><dd>{t.entityLabel ? `${t.entityLabel}` : t.entity ? `${t.entity} ${t.entityId}` : <span className="muted">Not linked to a record</span>}</dd>
          <dt>Given by</dt><dd>{t.assigner}</dd>
          <dt>Dates</dt><dd>{t.startDate ? `from ${formatDate(t.startDate)} ` : ''}{t.dueDate ? `due ${formatDate(t.dueDate)}` : 'no due date'}</dd>
          <dt>How it started</dt><dd>{ORIGIN[t.origin]}{t.topicCode ? ` (topic ${t.topicCode})` : ''}</dd>
          {t.recurrence && <><dt>Repeats</dt><dd data-testid="task-recurrence">every {t.recurrence.interval > 1 ? `${t.recurrence.interval} ` : ''}{({ DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month' })[t.recurrence.freq]}{t.recurrence.interval > 1 ? 's' : ''}{t.recurrence.until ? ` until ${formatDate(t.recurrence.until)}` : ''}</dd></>}
          <dt>Needs</dt><dd>{[t.requiresAcceptance && 'acceptance', t.requiresEvidence && 'evidence', t.requiresVerification && 'verification'].filter(Boolean).join(', ') || 'nothing more than doing it'}</dd>
          {t.blockedReason && <><dt>Blocked because</dt><dd data-testid="task-blocked">{t.blockedReason}</dd></>}
        </dl>
      )}
      {t.routing && (
        <section className="card" aria-label="How this instruction was routed" data-testid="task-routing">
          <h3>How it was routed</h3>
          <p>Department <strong>{t.routing.department ?? '—'}</strong>, role <strong>{t.routing.role ?? '—'}</strong>, person <strong>{t.routing.employee}</strong>{t.routing.failed ? <span className="error small"> (the matrix had no answer: {t.routing.failed})</span> : null}</p>
          <ol>{t.routing.trail.map((x, i) => <li key={i} className="small">{x}</li>)}</ol>
        </section>
      )}
      <section aria-label="People" data-testid="task-people">
        <h3>People</h3>
        {perr?.form && <p role="alert" className="error">{perr.form}</p>}
        <p>Doing it: {t.assignees.map((a) => <span key={a.user} className="chip">{a.user}{a.acceptedAt ? ' (accepted)' : ''}{t.canEdit && <button type="button" className="btn btn-small" aria-label={`Remove ${a.user}`} onClick={() => removePerson('assignee', a.user)}>×</button>}</span>)}</p>
        <p>Watching: {t.watchers.length ? t.watchers.map((u) => <span key={u} className="chip">{u}{t.canEdit && <button type="button" className="btn btn-small" aria-label={`Stop ${u} watching`} onClick={() => removePerson('watcher', u)}>×</button>}</span>) : <span className="muted">Nobody</span>}</p>
        {t.canEdit && <div className="wf-inline">
          <LookupField id="tk-add-assignee" label="Give it to" lookup="iam/users" valueKey="code" value={people.assignee} onChange={(v) => setPeople({ ...people, assignee: v })} onPick={(row) => { if (row) { addPerson('assignee', row.code); setPeople({ ...people, assignee: '' }); } }} />
          <LookupField id="tk-add-watcher" label="Add a watcher" lookup="iam/users" valueKey="code" value={people.watcher} onChange={(v) => setPeople({ ...people, watcher: v })} onPick={(row) => { if (row) { addPerson('watcher', row.code); setPeople({ ...people, watcher: '' }); } }} />
        </div>}
      </section>
    </div>
  );
}

export default function TaskPage() {
  usePageTitle('Task');
  const id = Number(useSearch().get('id')) || null;
  const q = useTask(id);
  const act = useTaskAct();
  const update = useUpdateTask();
  const comment = useTaskComment();
  const checklist = useTaskChecklist();
  const depend = useTaskDepend();
  const [tab, setTab] = useState('details');
  const [edit, setEdit] = useState(false);
  const [asking, setAsking] = useState(null);
  const [reason, setReason] = useState('');
  const [text, setText] = useState('');
  const [item, setItem] = useState('');
  const [dep, setDep] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const [uploaded, setUploaded] = useState(0);
  if (!id) return <section aria-labelledby="tk-title"><h1 id="tk-title">Task</h1><EmptyState title="No task chosen" message="Open a task from My Tasks." action={{ label: 'Open My Tasks', onClick: () => navigateTo('/tasks') }} /></section>;
  if (q.error?.status === 404) return <section aria-labelledby="tk-title"><h1 id="tk-title">Task</h1><EmptyState title="This task was not found" message="It does not exist, or you take no part in it." action={{ label: 'Open My Tasks', onClick: () => navigateTo('/tasks') }} /></section>;
  const t = q.data;
  const run = (action, why) => {
    setError(null);
    act.mutate({ id, action, reason: why }, { onSuccess: (r) => { setAsking(null); setReason(''); setNotice(r.warnings?.length ? `Done. Note: ${r.warnings.join(' ')}` : `${ACTION_LABEL[action]}: done.`); }, onError: (e) => { setNotice(''); setError(errorInfo(e)); } });
  };
  const wrap = (mut, vars, ok) => { setError(null); mut.mutate(vars, { onSuccess: ok, onError: (e) => setError(errorInfo(e)) }); };
  return (
    <section aria-labelledby="tk-title" data-testid="task-page">
      <h1 id="tk-title">Task</h1>
      {q.isPending && <Skeleton label="Loading the task" rows={4} />}
      {q.isError && q.error?.status !== 404 && <ErrorState title="The task could not be loaded" error={q.error} onRetry={() => q.refetch()} />}
      {t && <>
        <header className="card">
          <h2>{t.taskNo}: {t.title}</h2>
          <p><StatusBadge status={STATUS[t.status][0]} label={STATUS[t.status][1]} /> <StatusBadge status={PRIORITY[t.priority][0]} label={PRIORITY[t.priority][1]} />
            {t.overdue && <span className="error" data-testid="task-late"> {t.daysLate} day(s) late{t.escalationLevel ? `, escalated to level ${t.escalationLevel}` : ''}</span>}
            {t.dueDate && !t.overdue && <span className="muted small"> due {formatDate(t.dueDate)}</span>}</p>
          {t.warnings.length > 0 && <p role="status" className="notice" data-testid="task-warnings">{t.warnings.join(' ')} It cannot start until then.</p>}
          {notice && <p role="status" className="notice" data-testid="task-notice">{notice}</p>}
          {error?.form && <p role="alert" className="error" data-testid="task-error">{error.form}</p>}
          <div className="actions" role="group" aria-label="What you can do">
            {ORDER.filter((a) => t.allowed[a]).map((a) => (NEEDS_REASON.includes(a)
              ? <button key={a} type="button" className="btn" aria-expanded={asking === a} onClick={() => { setAsking(asking === a ? null : a); setReason(''); }}>{ACTION_LABEL[a]}</button>
              : <button key={a} type="button" className={`btn${['complete', 'verify', 'accept', 'start'].includes(a) ? ' btn-primary' : ''}`} disabled={act.isPending} onClick={() => run(a)}>{ACTION_LABEL[a]}</button>))}
            {t.canEdit && !edit && <button type="button" className="btn" onClick={() => setEdit(true)}>Change the task</button>}
            <Link to="/tasks">Back to My Tasks</Link>
          </div>
          {asking && (
            <form className="wf-inline" aria-label={ACTION_LABEL[asking]} onSubmit={(e) => { e.preventDefault(); run(asking, reason); }}>
              <Field label={`Why? (${ACTION_LABEL[asking].toLowerCase()})`} name="reason" error={error}><input value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} /></Field>
              <button type="submit" className="btn btn-primary" disabled={act.isPending || reason.trim().length < 3}>{ACTION_LABEL[asking]}</button>
            </form>)}
        </header>
        <div role="tablist" aria-label="Task sections" className="tabs">{TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`btn${tab === k ? ' btn-primary' : ''}`} onClick={() => setTab(k)}>{l}{k === 'checklist' && t.checklist.total ? ` (${t.checklist.done}/${t.checklist.total})` : ''}{k === 'discussion' && t.comments.length ? ` (${t.comments.length})` : ''}</button>)}</div>
        {tab === 'details' && <Details t={t} edit={edit} setEdit={setEdit} saving={update.isPending} error={error} onSave={(vars) => wrap(update, vars, () => { setEdit(false); setNotice('Saved.'); })} />}
        {tab === 'checklist' && (
          <div data-testid="task-checklist">
            {t.checklistItems.length === 0 && <p className="muted">No checklist yet.</p>}
            <ul>{t.checklistItems.map((c) => (
              <li key={c.id}><label><input type="checkbox" checked={c.done} disabled={checklist.isPending || ['CLOSED', 'CANCELLED'].includes(t.status)} onChange={(e) => wrap(checklist, { id, toggle: { id: c.id, done: e.target.checked } })} /> {c.text}</label>{c.done && <span className="muted small"> {c.doneBy}, {formatDateTime(c.doneAt)}</span>}</li>))}</ul>
            {!['CLOSED', 'CANCELLED'].includes(t.status) && <form className="wf-inline" aria-label="Add a checklist item" onSubmit={(e) => { e.preventDefault(); wrap(checklist, { id, add: item }, () => setItem('')); }}>
              <Field label="New item" name="add" error={error}><input value={item} maxLength={300} onChange={(e) => setItem(e.target.value)} /></Field>
              <button type="submit" className="btn" disabled={!item.trim()}>Add</button></form>}
          </div>)}
        {tab === 'evidence' && (
          <div data-testid="task-evidence">
            <p>{t.requiresEvidence ? (t.evidenceFileIds.length ? <span data-testid="evidence-ok">Evidence attached: {t.evidenceFileIds.length} file(s).</span> : <span className="error" data-testid="evidence-missing">This task needs a photo or a document before it can be marked done.</span>) : 'This task does not need evidence, but you may attach files.'}</p>
            {!['CLOSED', 'CANCELLED'].includes(t.status) && (t.relation.assignee || t.relation.assigner) && <FileUploader entity="tsk_task" entityId={t.id} onDone={() => { setUploaded((n) => n + 1); q.refetch(); }} />}
            <AttachmentList key={uploaded} entity="tsk_task" entityId={t.id} canEdit={!['CLOSED', 'CANCELLED'].includes(t.status)} onReplace={() => {}} />
          </div>)}
        {tab === 'depends' && (
          <div data-testid="task-depends">
            <h3>This task waits for</h3>
            {t.dependencies.length === 0 ? <p className="muted">Nothing.</p> : <ul>{t.dependencies.map((d) => <li key={d.id}><Link to={taskLink(d.id)}>{d.taskNo} {d.title}</Link> <StatusBadge status={STATUS[d.status][0]} label={STATUS[d.status][1]} />{t.canEdit && <button type="button" className="btn btn-small" onClick={() => wrap(depend, { id, remove: d.id })}>Remove</button>}</li>)}</ul>}
            <h3>Waiting for this task</h3>
            {t.dependents.length === 0 ? <p className="muted">Nothing.</p> : <ul>{t.dependents.map((d) => <li key={d.id}><Link to={taskLink(d.id)}>{d.taskNo} {d.title}</Link></li>)}</ul>}
            {t.canEdit && <form className="wf-inline" aria-label="Add a dependency" onSubmit={(e) => { e.preventDefault(); wrap(depend, { id, add: Number(dep) }, () => setDep('')); }}>
              <Field label="Task number or id it waits for" name="add" error={error}><input type="number" min="1" value={dep} onChange={(e) => setDep(e.target.value)} /></Field>
              <button type="submit" className="btn" disabled={!dep}>Add</button></form>}
          </div>)}
        {tab === 'discussion' && (
          <div data-testid="task-discussion">
            {t.comments.length === 0 && <p className="muted">No comments yet.</p>}
            <ul>{t.comments.map((c) => <li key={c.id}><strong>{c.by}</strong> <span className="muted small">{formatDateTime(c.at)}</span><br />{c.body}</li>)}</ul>
            <form className="form-grid" aria-label="Add a comment" onSubmit={(e) => { e.preventDefault(); wrap(comment, { id, body: text }, () => setText('')); }}>
              <Field label="Comment" name="body" error={error}><textarea rows="3" value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} /></Field>
              <button type="submit" className="btn" disabled={comment.isPending || !text.trim()}>Comment</button>
            </form>
          </div>)}
        {tab === 'history' && (
          <div data-testid="task-history">
            {t.escalations.length > 0 && <><h3>Escalations</h3><ul>{t.escalations.map((e, i) => <li key={i}>Level {e.level} to {e.toRole ?? 'the department head'}{e.toUser ? ` (${e.toUser})` : ''}, {e.daysLate} day(s) late, {formatDateTime(e.at)}</li>)}</ul></>}
            <h3>What happened</h3>
            <ol>{t.history.map((h, i) => <li key={i}><strong>{h.action}</strong> by {h.by}, {formatDateTime(h.at)}{h.to?.status ? ` → ${STATUS[h.to.status]?.[1] ?? h.to.status}` : ''}{h.reason ? `: ${h.reason}` : ''}</li>)}</ol>
          </div>)}
      </>}
    </section>
  );
}
