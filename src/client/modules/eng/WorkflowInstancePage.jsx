import { useLiveRefresh } from '../../platform/realtime/socket.js';
import { useState } from 'react';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ConfirmDialog } from '../../platform/feedback/Dialogs.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDateTime } from '../../platform/format.js';
import StepDiagram from '../../platform/workflow/StepDiagram.jsx';
import { findDocument, useAct, useAssign, useDocTypes, useInstance, useInstanceAction, useTasks } from '../../platform/workflow/api.js';
import { AttachmentList, FileUploader } from '../core/components/Attachments.jsx';
import { Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { EVENT, INST_STATUS, TASK_STATUS, useSearch } from './common.js';

// Workflow Instance (part 04.01, section 7.3): one document's approval as an Object Page. Header with the document, status and the actions this person may
// take; tabs for the steps and tasks (where the decisions are taken), the timeline, attachments, related documents and details. Every document's
// Approvals tab links here.
const TABS = [['steps', 'Steps and tasks'], ['timeline', 'Timeline'], ['attachments', 'Attachments'], ['related', 'Related'], ['details', 'Details']];

export function TaskCard({ task, wf, step, onDone, onError }) {
  const act = useAct();
  const assign = useAssign();
  const [comment, setComment] = useState('');
  const [delegateTo, setDelegateTo] = useState('');
  const [returnTo, setReturnTo] = useState('originator');
  const [checked, setChecked] = useState([]);
  const [assignee, setAssignee] = useState('');
  const earlier = wf.steps.slice(0, wf.steps.findIndex((s) => s.code === task.step));
  const go = (action, extra = {}) => act.mutate({ taskId: task.id, action, comment: comment || undefined, version: task.version, ...extra }, { onSuccess: (r) => { setComment(''); setChecked([]); onDone(`Done: ${action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : action === 'return' ? 'returned' : action === 'clarify' ? 'question asked' : action === 'answer' ? 'answer sent' : 'delegated'}.`, r); }, onError: (e) => onError(errorInfo(e)) });
  const open = task.status === 'OPEN';
  return (
    <li className="card" data-testid={`wf-task-${task.id}`}>
      <p><strong>{step?.name ?? task.step}</strong> · {task.assigneeUser ?? task.assigneeRole?.replace(/\|/g, ' or ') ?? 'nobody yet'} · <StatusBadge status={TASK_STATUS[task.status][0]} label={TASK_STATUS[task.status][1]} />
        {task.overdue && <> · <span className="field-error">overdue</span></>}{task.clarification === 'ASKED' && <> · <StatusBadge status="returned" label="Question waiting" /></>}</p>
      <p className="muted small">{task.dueAt && open ? `Due ${formatDateTime(task.dueAt)}` : ''}{task.delegatedFrom ? ` Delegated from ${task.delegatedFrom}.` : ''}{task.onBehalfOf ? ` Decided on behalf of ${task.onBehalfOf}.` : ''}{task.escalatedAt ? ' Escalated.' : ''}</p>
      {task.action && <p>{task.action === 'approve' ? 'Approved' : task.action === 'reject' ? 'Rejected' : 'Returned'} {formatDateTime(task.actedAt)}{task.comment ? `: ${task.comment}` : ''}</p>}
      {task.status === 'ADMIN_QUEUE' && (
        <>
          <p role="note" className="notice">No eligible approver was found for this step, so nothing has been approved. A workflow administrator must choose who decides.</p>
          {wf.actions.assign && (
            <form className="wf-inline" onSubmit={(e) => { e.preventDefault(); assign.mutate({ taskId: task.id, user: assignee }, { onSuccess: () => onDone('The task was assigned.'), onError: (er) => onError(errorInfo(er)) }); }}>
              <label className="field"><span>Assign to (user name)</span><input value={assignee} onChange={(e) => setAssignee(e.target.value)} required maxLength={60} /></label>
              <button type="submit" className="btn btn-primary" disabled={assign.isPending}>Assign</button>
            </form>
          )}
        </>
      )}
      {open && task.canAnswer && (
        <form onSubmit={(e) => { e.preventDefault(); go('answer'); }}>
          <label className="field"><span>Answer the question</span><textarea rows="2" value={comment} onChange={(e) => setComment(e.target.value)} required minLength={5} maxLength={2000} /></label>
          <button type="submit" className="btn btn-primary" disabled={act.isPending}>Send the answer</button>
        </form>
      )}
      {open && task.canAct && (
        <form onSubmit={(e) => e.preventDefault()} aria-label={`Decide ${step?.name ?? task.step}`}>
          {step?.checklist?.length > 0 && (
            <fieldset><legend>Checklist</legend>
              {step.checklist.map((c) => <label key={c} className="check"><input type="checkbox" checked={checked.includes(c)} onChange={(e) => setChecked(e.target.checked ? [...checked, c] : checked.filter((x) => x !== c))} /> {c}</label>)}
            </fieldset>
          )}
          <label className="field"><span>Comment{step?.requireAttachment ? '' : ' (needed to reject, return or ask)'}</span><textarea rows="2" value={comment} maxLength={2000} onChange={(e) => setComment(e.target.value)} /></label>
          <details><summary>{step?.requireAttachment ? 'Attach the file this step needs' : 'Attach a file'}</summary>
            <FileUploader entity="wf_task" entityId={task.id} />
          </details>
          <div className="actions">
            <button type="button" className="btn btn-primary" disabled={act.isPending} onClick={() => go('approve', { checked })}>Approve</button>
            <button type="button" className="btn btn-danger" disabled={act.isPending} onClick={() => go('reject')}>Reject</button>
            <button type="button" className="btn" disabled={act.isPending} onClick={() => go('clarify')}>Ask a question</button>
          </div>
          <div className="wf-inline">
            <label className="field"><span>Return to</span><select value={returnTo} onChange={(e) => setReturnTo(e.target.value)}><option value="originator">The person who raised it</option>{earlier.map((s) => <option key={s.code} value={s.code}>Step: {s.name}</option>)}</select></label>
            <button type="button" className="btn" disabled={act.isPending} onClick={() => go('return', { returnToStep: returnTo })}>Return</button>
          </div>
          <div className="wf-inline">
            <label className="field"><span>Delegate to (user name)</span><input value={delegateTo} maxLength={60} onChange={(e) => setDelegateTo(e.target.value)} /></label>
            <button type="button" className="btn" disabled={act.isPending || !delegateTo} onClick={() => go('delegate', { delegateTo })}>Delegate</button>
          </div>
        </form>
      )}
      {open && !task.canAct && !task.canAnswer && task.whyNot && <p className="muted small">{task.whyNot}</p>}
    </li>
  );
}

function Lookup() {
  const types = useDocTypes();
  const mine = useTasks('assigned');
  const started = useTasks('started');
  const [form, setForm] = useState({ docType: '', docId: '' });
  const [error, setError] = useState(null);
  const submit = (e) => { e.preventDefault(); setError(null); findDocument(form.docType, form.docId).then((r) => (r ? navigateTo(`/workflow/instance?id=${r.id}`, { force: true }) : setError('That document has not been submitted into approval.'))).catch((er) => setError(errorInfo(er).form)); };
  return (
    <>
      <p className="muted">Open the approval of a document: from its Approvals tab, from the lists below, or by its document type and id.</p>
      <form className="srch-form" onSubmit={submit} aria-label="Find an approval">
        <label className="field"><span>Document type</span><select value={form.docType} required onChange={(e) => setForm({ ...form, docType: e.target.value })}><option value="">Choose</option>{(types.data ?? []).map((t) => <option key={t.docType} value={t.docType}>{t.label}</option>)}</select></label>
        <label className="field"><span>Document id</span><input value={form.docId} required maxLength={60} onChange={(e) => setForm({ ...form, docId: e.target.value })} /></label>
        <button type="submit" className="btn btn-primary">Open</button>
      </form>
      {error && <p role="alert" className="error">{error}</p>}
      <h2>Waiting for my decision</h2>
      {mine.isPending ? <Skeleton label="Loading my tasks" rows={2} /> : mine.data?.rows.length ? (
        <ul className="lp-list" data-testid="wf-my-tasks">{mine.data.rows.map((t) => <li key={t.id}><Link to={`/workflow/instance?id=${t.instance.id}`}>{t.instance.docLabel} {t.instance.docRef ?? t.instance.docId}</Link> <span className="muted small">{t.step}, due {t.dueAt ? formatDateTime(t.dueAt) : 'when possible'}</span></li>)}</ul>
      ) : <EmptyState compact title="Nothing is waiting for you" message="Tasks appear here when a document needs your decision." />}
      <h2>Documents I raised</h2>
      {started.data?.rows.length ? <ul className="lp-list">{started.data.rows.map((i) => <li key={i.id}><Link to={`/workflow/instance?id=${i.id}`}>{i.docLabel} {i.docRef ?? i.docId}</Link> <StatusBadge status={INST_STATUS[i.status][0]} label={INST_STATUS[i.status][1]} /></li>)}</ul> : <p className="muted">You have not submitted a document into approval.</p>}
    </>
  );
}

export default function WorkflowInstancePage() {
  usePageTitle('Workflow Instance');
  const id = Number(useSearch().get('id')) || null;
  const query = useInstance(id);
  useLiveRefresh(id ? [`record:workflow_instance:${id}`] : [], [['workflow']]);
  const action = useInstanceAction();
  const [tab, setTab] = useState('steps');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState(null);
  const [dialog, setDialog] = useState(null);
  const wf = query.data;
  const done = (message) => { setNotice(message); setError(null); };
  if (!id) return <section aria-labelledby="wi-title" data-testid="workflow-instance"><h1 id="wi-title">Workflow Instance</h1><Lookup /></section>;
  if (query.error?.status === 404) return <section aria-labelledby="wi-title"><h1 id="wi-title">Workflow Instance</h1><EmptyState title="This approval was not found" message="It does not exist, or you take no part in it." action={{ label: 'Back to my approvals', onClick: () => navigateTo('/workflow/instance') }} /></section>;
  if (query.error?.status === 403) return <NoPermission what="this approval" permission="eng.workflow.view" />;
  const run = (name, body = {}) => action.mutateAsync({ id, action: name, ...body }).then(() => done({ withdraw: 'The document was withdrawn.', cancel: 'The approval was cancelled.', resubmit: 'The document is back in approval.', watch: 'You are watching this document.', unwatch: 'You no longer watch this document.' }[name])).catch((e) => { setError(errorInfo(e)); throw e; });
  const attachments = wf?.tasks.filter((t) => !t.superseded) ?? [];
  return (
    <section aria-labelledby="wi-title" data-testid="workflow-instance">
      <h1 id="wi-title">Workflow Instance</h1>
      {query.isPending && <Skeleton label="Loading the approval" rows={4} />}
      {query.isError && ![403, 404].includes(query.error?.status) && <ErrorState title="The approval could not be loaded" error={query.error} onRetry={() => query.refetch()} />}
      {wf && (
        <>
          <header className="card">
            <h2>{wf.docLabel} {wf.docRef ?? wf.docId}{wf.title ? `: ${wf.title}` : ''}</h2>
            <p><StatusBadge status={INST_STATUS[wf.status][0]} label={INST_STATUS[wf.status][1]} data-testid="wi-status" />{wf.needsAdmin && <> · <StatusBadge status="returned" label="Waiting for an administrator" /></>}</p>
            <ul className="srch-meta" aria-label="Key facts">
              <li>Raised by <strong>{wf.submittedBy}</strong> on {formatDateTime(wf.submittedAt)}</li><li>Definition version <strong>{wf.definitionVersion}</strong></li><li>Round <strong>{wf.cycle}</strong></li>
              {wf.currentStep && wf.status === 'RUNNING' && <li>At step <strong>{wf.steps.find((s) => s.code === wf.currentStep)?.name ?? wf.currentStep}</strong></li>}
              {wf.completedAt && <li>Finished {formatDateTime(wf.completedAt)}</li>}
            </ul>
            <div className="actions">
              {wf.route && <Link to={wf.route}>Open the document</Link>}
              {wf.actions.withdraw && <button type="button" className="btn" onClick={() => setDialog('withdraw')}>Withdraw</button>}
              {wf.actions.resubmit && <button type="button" className="btn btn-primary" onClick={() => setDialog('resubmit')}>Resubmit</button>}
              {wf.actions.cancel && <button type="button" className="btn btn-danger" onClick={() => setDialog('cancel')}>Cancel the approval</button>}
              <button type="button" className="btn" onClick={() => run(wf.watching ? 'unwatch' : 'watch').catch(() => {})}>{wf.watching ? 'Stop watching' : 'Watch'}</button>
            </div>
          </header>
          {notice && <p role="status" className="notice" data-testid="wi-notice">{notice}</p>}
          {error && <div role="alert" className="state state-error"><p>{error.form}</p>{error.correlationId && <p className="muted small">Correlation ID: <code>{error.correlationId}</code></p>}</div>}
          <div role="tablist" aria-label="Approval sections" className="wf-tabs">
            {TABS.map(([k, l]) => <button key={k} type="button" role="tab" id={`wi-tab-${k}`} aria-selected={tab === k} className={`btn${tab === k ? ' btn-primary' : ''}`} onClick={() => setTab(k)}>{l}</button>)}
          </div>
          <div role="tabpanel" aria-labelledby={`wi-tab-${tab}`}>
            {tab === 'steps' && (
              <>
                <StepDiagram steps={wf.steps} label="Steps of this approval" />
                <h3>Tasks</h3>
                <ul className="lp-list" aria-label="Tasks">
                  {wf.tasks.filter((t) => !t.superseded).map((t) => <TaskCard key={t.id} task={t} wf={wf} step={wf.steps.find((s) => s.code === t.step)} onDone={done} onError={setError} />)}
                </ul>
                {wf.tasks.some((t) => t.superseded) && <p className="muted small">{wf.tasks.filter((t) => t.superseded).length} task(s) of earlier rounds are in the timeline.</p>}
              </>
            )}
            {tab === 'timeline' && (
              <ol className="wf-timeline" aria-label="Timeline" data-testid="wi-timeline">
                {wf.history.map((h) => (
                  <li key={h.id}><strong>{EVENT[h.event] ?? h.event}</strong>{h.step ? ` · ${wf.steps.find((s) => s.code === h.step)?.name ?? h.step}` : ''} <span className="muted small">{h.actor} · {formatDateTime(h.at)} · round {h.cycle}</span>{h.comment && <><br />{h.comment}</>}</li>
                ))}
              </ol>
            )}
            {tab === 'attachments' && (
              attachments.every((t) => t.attachments.length === 0) ? <EmptyState compact title="No attachments" message="Files an approver attaches to a task appear here." /> : (
                <ul className="lp-list">{attachments.filter((t) => t.attachments.length).map((t) => <li key={t.id}><strong>{wf.steps.find((s) => s.code === t.step)?.name}</strong><AttachmentList entity="wf_task" entityId={t.id} /></li>)}</ul>
              )
            )}
            {tab === 'related' && (
              <ul className="lp-list">
                {wf.route && <li>The document: <Link to={wf.route}>{wf.docRef ?? wf.docId}</Link></li>}
                {wf.previous && <li>Amends: <Link to={`/workflow/instance?id=${wf.previous.id}`}>{wf.previous.docRef ?? wf.previous.docId}</Link> ({INST_STATUS[wf.previous.status][1]})</li>}
                {wf.amendments.map((a) => <li key={a.id}>Amended by: <Link to={`/workflow/instance?id=${a.id}`}>{a.docRef ?? a.docId}</Link> ({INST_STATUS[a.status][1]})</li>)}
                <li>Definition: <Link to={`/admin/workflows/editor?id=${wf.definitionId}`}>version {wf.definitionVersion}</Link></li>
                {!wf.previous && wf.amendments.length === 0 && <li className="muted">No amendment is linked to this approval.</li>}
              </ul>
            )}
            {tab === 'details' && (
              <dl className="kv"><dt>Document type</dt><dd>{wf.docType}</dd><dt>Document id</dt><dd>{wf.docId}</dd><dt>Watching</dt><dd>{wf.watchers.join(', ') || 'nobody'}</dd><dt>Resubmission restarts</dt><dd>{wf.settings.resubmit === 'first' ? 'from the first step' : 'from the step that returned it'}</dd>
                {Object.entries(wf.context).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div>)}</dl>
            )}
          </div>
        </>
      )}
      <ConfirmDialog open={dialog === 'withdraw'} title="Withdraw this document?" text="Nobody has acted on it yet, so it goes back to you as it was. You can submit it again." confirmLabel="Withdraw" commentOptional onConfirm={({ reason } = {}) => run('withdraw', { comment: reason || undefined }).then(() => setDialog(null))} onCancel={() => setDialog(null)} />
      <ConfirmDialog open={dialog === 'resubmit'} title="Resubmit this document?" text="It goes back into approval; the earlier decisions stay in its history." confirmLabel="Resubmit" commentOptional onConfirm={({ reason } = {}) => run('resubmit', { comment: reason || undefined }).then(() => setDialog(null))} onCancel={() => setDialog(null)} />
      <ConfirmDialog open={dialog === 'cancel'} title="Cancel this approval?" text="The document is closed. Say why; the reason is kept in its history." confirmLabel="Cancel the approval" danger reasonFor="cancel" onConfirm={({ reason }) => run('cancel', { reason }).then(() => setDialog(null))} onCancel={() => setDialog(null)} />
    </section>
  );
}
