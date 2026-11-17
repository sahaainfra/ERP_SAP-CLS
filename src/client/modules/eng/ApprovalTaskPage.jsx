import { useState } from 'react';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDateTime } from '../../platform/format.js';
import { useEvidence, useInstance, useIssueLink } from '../../platform/workflow/api.js';
import { AttachmentList } from '../core/components/Attachments.jsx';
import { Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import Evidence, { Flags, show } from './Evidence.jsx';
import { SLA } from './InboxPage.jsx';
import { EVENT, INST_STATUS, useSearch } from './common.js';
import { TaskCard } from './WorkflowInstancePage.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Approval Task (part 04.03, section 7.2): one task as an Object Page. The document at a glance, the risk flags, the evidence panel (computed when opened), what has
// happened so far, the attachments, and the decision: approve, reject, return, ask, delegate, with a comment and files. Nothing is decided for the approver.
const TABS = [['evidence', 'Evidence'], ['document', 'Document'], ['history', 'History'], ['attachments', 'Attachments']];
const slaOf = (t) => (t.escalatedAt ? 'ESCALATED' : t.dueAt && Date.now() >= Date.parse(t.dueAt) ? 'OVERDUE' : t.remindedAt || (t.remindAt && Date.now() >= Date.parse(t.remindAt)) ? 'DUE_SOON' : 'ON_TRACK');

export default function ApprovalTaskPage() {
  usePageTitle('Approval Task');
  const taskId = Number(useSearch().get('id')) || null;
  const ev = useEvidence(taskId);
  const wf = useInstance(ev.data?.instance.id);
  const link = useIssueLink();
  const [tab, setTab] = useState('evidence');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState(null);
  const [made, setMade] = useState(null);
  if (!taskId) return <section aria-labelledby="at-title"><PageHeader id="at-title" title={"Approval Task"} /><EmptyState title="No task chosen" message="Open a task from your approvals." action={{ label: 'Open My Approvals', onClick: () => navigateTo('/approvals') }} /></section>;
  if (ev.error?.status === 404) return <section aria-labelledby="at-title"><PageHeader id="at-title" title={"Approval Task"} /><EmptyState title="This task was not found" message="It does not exist, or you take no part in it." action={{ label: 'Open My Approvals', onClick: () => navigateTo('/approvals') }} /></section>;
  const d = ev.data;
  const decided = d && !d.canAct;
  return (
    <section aria-labelledby="at-title" data-testid="approval-task">
      <PageHeader id="at-title" title={"Approval Task"} />
      {ev.isPending && <Skeleton label="Loading the task" rows={4} />}
      {ev.isError && ev.error?.status !== 404 && <ErrorState title="The task could not be loaded" error={ev.error} onRetry={() => ev.refetch()} />}
      {d && (
        <>
          <header className="card">
            <h2>{d.instance.docLabel} {d.instance.docRef ?? d.instance.docId}{d.instance.title ? `: ${d.instance.title}` : ''}</h2>
            <p><StatusBadge status={INST_STATUS[d.instance.status][0]} label={INST_STATUS[d.instance.status][1]} /> <StatusBadge status={SLA[slaOf(d.task)][0]} label={SLA[slaOf(d.task)][1]} />
              {d.task.dueAt && <span className="muted small"> due {formatDateTime(d.task.dueAt)}</span>} · step <strong>{d.step?.name ?? d.task.step}</strong> · raised by <strong>{d.instance.submittedBy}</strong></p>
            <Flags flags={d.flags} />
            <div className="actions">
              {d.instance.route && <Link to={d.instance.route}>Open the document</Link>}
              <Link to={`/workflow/instance?id=${d.instance.id}`}>Open the whole approval</Link>
              {d.link.eligible && d.canAct && <button type="button" className="btn" disabled={link.isPending} onClick={() => link.mutate(taskId, { onSuccess: (r) => { setMade(r); setError(null); }, onError: (e) => setError(errorInfo(e)) })}>Make a secure link for my phone</button>}
            </div>
            {made && (
              <p role="status" className="notice" data-testid="at-link">Open this on your phone within {d.link.expiryMinutes} minutes; it works once{made.reauthRequired ? ' and asks you to sign in again, because of the amount' : ''}: <code>{window.location.origin}{made.url}</code></p>
            )}
          </header>
          {notice && <p role="status" className="notice" data-testid="at-notice">{notice} <Link to="/approvals">Back to My Approvals</Link></p>}
          {error && <div role="alert" className="state state-error"><p>{error.form}</p>{error.correlationId && <p className="muted small">Correlation ID: <code>{error.correlationId}</code></p>}</div>}
          {decided && <p className="notice" role="note" data-testid="at-readonly">{d.whyNot ?? 'You cannot decide this task.'}</p>}
          <div role="tablist" aria-label="Task sections" className="wf-tabs">
            {TABS.map(([k, l]) => <button key={k} type="button" role="tab" id={`at-tab-${k}`} aria-selected={tab === k} className={`btn${tab === k ? ' btn-primary' : ''}`} onClick={() => setTab(k)}>{l}</button>)}
          </div>
          <div role="tabpanel" aria-labelledby={`at-tab-${tab}`}>
            {tab === 'evidence' && <Evidence data={d} />}
            {tab === 'document' && (d.summary ? (
              <>
                <dl className="kv">{d.summary.fields.map((f) => <div key={f.label}><dt>{f.label}</dt><dd>{show(f.value, f.format)}</dd></div>)}</dl>
                {d.summary.lines && d.summary.lines.rows.length > 0 && (
                  <div className="table-wrap" tabIndex={0} role="region" aria-label="Lines">
                    <table className="grid"><thead><tr>{d.summary.lines.columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead><tbody>{d.summary.lines.rows.map((r, i) => <tr key={i}>{d.summary.lines.columns.map((c) => <td key={c.key}>{show(r[c.key], c.format)}</td>)}</tr>)}</tbody></table>
                  </div>
                )}
              </>
            ) : <EmptyState compact title="No summary" message="The module that owns this document has not given the approval a summary. Open the document to read it." />)}
            {tab === 'history' && (wf.data ? (
              <ol className="wf-timeline" aria-label="History">{wf.data.history.map((h) => <li key={h.id}><strong>{EVENT[h.event] ?? h.event}</strong>{h.step ? ` · ${h.step}` : ''} <span className="muted small">{h.actor} · {formatDateTime(h.at)}</span>{h.comment && <><br />{h.comment}</>}</li>)}</ol>
            ) : <Skeleton label="Loading the history" rows={2} />)}
            {tab === 'attachments' && (wf.data ? (
              wf.data.tasks.filter((t) => t.attachments.length > 0).length === 0 ? <EmptyState compact title="No attachments" message="Files an approver adds to a task appear here." /> :
                <ul className="lp-list">{wf.data.tasks.filter((t) => t.attachments.length).map((t) => <li key={t.id}><strong>{t.step}</strong><AttachmentList entity="wf_task" entityId={t.id} /></li>)}</ul>
            ) : <Skeleton label="Loading the attachments" rows={2} />)}
          </div>
          <h2>Your decision</h2>
          {wf.data ? (
            <ul className="lp-list" aria-label="Decision">
              <TaskCard task={wf.data.tasks.find((t) => t.id === taskId) ?? d.task} wf={wf.data} step={wf.data.steps.find((s) => s.code === d.task.step)} onDone={(m) => { setNotice(m); setError(null); ev.refetch(); wf.refetch(); }} onError={setError} />
            </ul>
          ) : <Skeleton label="Loading the decision form" rows={2} />}
        </>
      )}
    </section>
  );
}
