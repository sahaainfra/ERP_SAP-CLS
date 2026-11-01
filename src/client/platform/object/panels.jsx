import { useMemo, useState } from 'react';
import { FileUploader, AttachmentList } from '../../modules/core/components/Attachments.jsx';
import { Changes } from '../audit/RecordHistory.jsx';
import Icon from '../design/Icon.jsx';
import StatusBadge from '../design/StatusBadge.jsx';
import { EmptyState, QueryError, Skeleton } from '../feedback/states.jsx';
import { formatDateTime } from '../format.js';
import { LookupField } from '../forms/LookupField.jsx';
import { countdown, useAddComment, useDocumentLinks, useNow, useObjectPart } from './api.js';

// The panels of the Object Page (part 03.04): approvals, attachments with the required-document checklist, the timeline, the discussion,
// related records and the amendment comparison. Each loads its own data when its tab is opened.

const STEP_STATE = { APPROVED: ['COMPLETED', 'Approved'], REJECTED: ['REJECTED', 'Rejected'], RETURNED: ['RETURNED', 'Returned'], CURRENT: ['IN_REVIEW', 'Waiting for a decision'], WAITING: ['DRAFT', 'Not yet'] };
const ROUND_STATE = { SUBMITTED: 'In approval', APPROVED: 'Approved', REJECTED: 'Rejected', RETURNED: 'Returned', CANCELLED: 'Withdrawn' };

function Sla({ sla }) {
  const now = useNow();
  if (!sla) return null;
  const c = countdown(sla.dueAt, now);
  return <span className={`fb-sla${c.overdue ? ' is-overdue' : c.soon ? ' is-soon' : ''}`} data-testid="sla"><Icon name="erp.state.overdue" size={16} /> {c.text} <span className="muted small">(a step has {sla.hours} h)</span></span>;
}

/** The approval panel: the open round's steps with who decides, the clock, the buttons for the person who holds the task, and the history of every round. */
export function ApprovalPanel({ type, id, actions, onAction }) {
  const q = useObjectPart(type, id, 'approvals');
  if (q.isPending) return <Skeleton label="Loading approvals" />;
  if (q.isError) return <QueryError error={q.error} what="the approvals" permission="the record's permission" onRetry={q.refetch} />;
  const rounds = [...q.data.rounds].reverse();
  if (rounds.length === 0) return <EmptyState compact title="Not sent for approval yet" message="When the request is submitted its approvers and their decisions appear here." />;
  const current = rounds[0];
  const decisions = rounds.flatMap((r) => r.steps.filter((s) => s.decidedAt).map((s) => ({ ...s, round: r.id }))).sort((a, b) => (a.decidedAt < b.decidedAt ? 1 : -1));
  const mine = actions.filter((a) => ['approve', 'return', 'reject'].includes(a.id));
  return (
    <div className="op-approvals" data-testid="approval-panel">
      <div className="op-approval-head">
        <h3>Approval {current.id} <StatusBadge status={current.status === 'SUBMITTED' ? 'IN_REVIEW' : current.status === 'CANCELLED' ? 'CANCELLED' : current.status} label={ROUND_STATE[current.status]} /></h3>
        <Sla sla={current.sla} />
      </div>
      <p className="muted small">Sent by {current.requestedBy} on {formatDateTime(current.requestedAt)}. {current.reason}</p>
      <ol className="op-steps" aria-label="Approval steps">
        {current.steps.map((s) => (
          <li key={s.stepNo} className={`op-step is-${s.state.toLowerCase()}`} data-testid={`step-${s.stepNo}`} aria-current={s.state === 'CURRENT' ? 'step' : undefined}>
            <span className="op-step-no">{s.stepNo}</span>
            <div>
              <strong>{s.role.replace('|', ' or ')}</strong> <StatusBadge status={STEP_STATE[s.state][0]} label={STEP_STATE[s.state][1]} />
              {s.decidedBy && <p className="small">{s.decidedBy}{s.onBehalfOf ? ` (on behalf of ${s.onBehalfOf})` : ''}, {formatDateTime(s.decidedAt)}{s.comment ? `: ${s.comment}` : ''}</p>}
              {!s.decidedBy && s.approvers.length > 0 && <p className="muted small">Can be decided by {s.approvers.map((a) => a.name).join(', ')}</p>}
              {!s.decidedBy && s.approvers.length === 0 && <p className="muted small">Anyone who holds the {s.role.replace('|', ' or ')} role</p>}
            </div>
          </li>
        ))}
      </ol>
      {mine.length > 0 && current.status === 'SUBMITTED' && (
        <div className="op-approval-actions" role="group" aria-label="Your decision">
          {mine.map((a) => (
            <button key={a.id} type="button" className={`btn ${a.kind === 'primary' ? 'btn-primary' : a.kind === 'danger' ? 'btn-danger' : ''}`} aria-disabled={!a.allowed} title={a.reason ?? undefined} onClick={() => a.allowed && onAction(a)}>{a.label}</button>
          ))}
          {mine.filter((a) => !a.allowed && a.reason).slice(0, 1).map((a) => <span key="why" className="muted small" data-testid="approval-why">{a.reason}</span>)}
        </div>
      )}
      <div className="op-evidence" data-testid="evidence-slot"><strong>Evidence</strong><p className="muted small">Documents an approver attaches to a decision will be listed here once the workflow engine (04.01, 04.03) is in place. Files of the request are on the Attachments tab.</p></div>
      <p className="muted small">Delegating a step and asking the requester for clarification need the workflow engine (04.01); for now an approver approves, returns or rejects.</p>
      <h3>History</h3>
      {decisions.length === 0 ? <p className="muted">No decision has been made yet.</p> : (
        <div className="table-wrap">
          <table data-testid="approval-history">
            <caption className="visually-hidden">Approval history</caption>
            <thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">Role</th><th scope="col">Decision</th><th scope="col">On behalf of</th><th scope="col">Comment</th></tr></thead>
            <tbody>{decisions.map((d) => <tr key={`${d.round}-${d.stepNo}`}><td data-label="When">{formatDateTime(d.decidedAt)}</td><td data-label="Who">{d.decidedBy}</td><td data-label="Role">{d.role.replace('|', ' or ')}</td><td data-label="Decision">{STEP_STATE[d.state][1]}</td><td data-label="On behalf of">{d.onBehalfOf ?? '-'}</td><td data-label="Comment">{d.comment ?? ''}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** The icon of a file by its type: a camera for pictures, the drawing glyph for drawings, a paperclip for the rest. */
const fileIcon = (name) => { const ext = String(name).split('.').pop().toLowerCase(); return ['jpg', 'jpeg', 'png', 'webp', 'heic'].includes(ext) ? 'erp.action.camera' : ['dwg', 'dxf'].includes(ext) ? 'erp.cx.survey-point' : 'erp.action.attach'; };
const SCAN = { PENDING: 'being scanned', INFECTED: 'quarantined', ERROR: 'scan failed', CLEAN: 'clean' };

/** The attachment panel: the documents this kind of record needs and which are attached, an uploader that can say which one a file is, and every file with previews and versions. */
export function AttachmentPanel({ type, id, entity, canEdit }) {
  // while a linked file is still being scanned for viruses the checklist asks again every two seconds
  const docs = useObjectPart(type, id, 'documents', { refetchInterval: (q) => ((q.state.data?.requirements ?? []).some((r) => r.files.some((x) => x.scanStatus === 'PENDING')) ? 2000 : false) });
  const links = useDocumentLinks(type, id);
  const [forReq, setForReq] = useState('');
  const [msg, setMsg] = useState('');
  const requirements = docs.data?.requirements ?? [];
  const onDone = async (file) => {
    setMsg('');
    if (!forReq || !file?.id) return;
    try { await links.link.mutateAsync({ requirementCode: forReq, fileId: file.id }); setMsg('The file now stands for that document.'); } catch (err) { setMsg(err.message); }
  };
  return (
    <div className="op-attach" data-testid="attachment-panel">
      <h3>Required documents</h3>
      {docs.isPending && <Skeleton label="Loading the checklist" rows={2} />}
      {docs.isError && <QueryError error={docs.error} what="the document checklist" permission="the record's permission" onRetry={docs.refetch} />}
      {docs.data && requirements.length === 0 && <p className="muted">This kind of record needs no documents.</p>}
      {requirements.length > 0 && (
        <ul className="op-checklist" data-testid="checklist">
          {requirements.map((r) => (
            <li key={r.code} data-testid={`req-${r.code}`} className={r.satisfied ? 'is-ok' : r.required ? 'is-missing' : ''}>
              <Icon name={r.satisfied ? 'erp.state.approved' : r.required ? 'erp.state.exception' : 'erp.action.attach'} size={18} />
              <div>
                <strong>{r.label}</strong> <span className="muted small">{r.satisfied ? 'attached' : r.required ? `needed before ${r.requiredAt === 'submit' ? 'submitting' : 'approval'}` : 'optional'}</span>
                {r.description && <p className="muted small">{r.description}</p>}
                {r.files.map((f) => (
                  <p key={f.linkId} className="small"><Icon name={fileIcon(f.name)} size={14} /> {f.name} (version {f.versionNo}, {SCAN[f.scanStatus]}) {canEdit && <button type="button" className="link" aria-label={`Remove ${f.name} from ${r.label}`} onClick={() => links.unlink.mutate(f.linkId)}>Remove</button>}</p>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      {canEdit && entity && (
        <div className="op-upload">
          <label className="field"><span>This file is</span>
            <select value={forReq} onChange={(e) => setForReq(e.target.value)} aria-label="Which document this file is">
              <option value="">A general attachment</option>
              {requirements.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
            </select>
          </label>
          <FileUploader entity={entity} entityId={id} onDone={onDone} />
          <p role="status" className="notice">{msg}</p>
        </div>
      )}
      <h3>All files</h3>
      {entity && <AttachmentList entity={entity} entityId={id} canEdit={canEdit} />}
    </div>
  );
}

const KIND = { audit: 'Change', approval: 'Approval', comment: 'Comment' };

/** The timeline: audit entries, approval decisions and comments in one list, newest first, filterable by kind. */
export function TimelinePanel({ type, id }) {
  const q = useObjectPart(type, id, 'timeline');
  const [kind, setKind] = useState('');
  if (q.isPending) return <Skeleton label="Loading the timeline" />;
  if (q.isError) return <QueryError error={q.error} what="the timeline" permission="the record's permission" onRetry={q.refetch} />;
  const rows = q.data.filter((e) => !kind || e.kind === kind);
  return (
    <div data-testid="timeline-panel">
      <div className="toolbar" role="group" aria-label="Show">
        {[['', 'Everything'], ['audit', 'Changes'], ['approval', 'Approvals'], ['comment', 'Comments']].map(([k, l]) => <button key={k} type="button" className={`lr-chip ${kind === k ? 'is-on' : ''}`} aria-pressed={kind === k} onClick={() => setKind(k)}>{l}</button>)}
      </div>
      {rows.length === 0 ? <EmptyState compact title="Nothing recorded yet" message="Changes, approval decisions and comments appear here as they happen." /> : (
        <ol className="timeline op-timeline">
          {rows.map((e) => (
            <li key={e.key} data-testid={`tl-${e.kind}`}>
              <span className={`op-kind op-kind-${e.kind}`}>{KIND[e.kind]}</span> <strong>{e.action}</strong> by {e.actor} <span className="muted">{formatDateTime(e.at)}</span>
              {e.detail && <p className="muted small">{e.detail}</p>}
              {e.reason && <p>{e.reason}</p>}
              {e.kind === 'audit' && Object.keys(e.changes).length > 0 && <Changes changes={e.changes} />}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** The discussion: comments in order, with @mentions of people in the company; a note says where the conversation will also appear. */
export function DiscussionPanel({ type, id }) {
  const q = useObjectPart(type, id, 'comments');
  const add = useAddComment(type, id);
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const [mention, setMention] = useState('');
  const post = async (e) => {
    e.preventDefault();
    setError(null);
    try { await add.mutateAsync(text); setText(''); } catch (err) { setError(err); }
  };
  return (
    <div data-testid="discussion-panel">
      {q.isPending && <Skeleton label="Loading the discussion" rows={2} />}
      {q.isError && <QueryError error={q.error} what="the discussion" permission="the record's permission" onRetry={q.refetch} />}
      {q.data && q.data.length === 0 && <EmptyState compact title="No comments yet" message="Ask a question or leave a note for the people working on this record. Mention someone with @username." />}
      {q.data && q.data.length > 0 && (
        <ul className="op-comments">
          {q.data.map((c) => (
            <li key={c.id} data-testid="comment"><strong>{c.author}</strong> <span className="muted small">{formatDateTime(c.at)}</span>
              <p>{c.body}</p>
              {c.mentions.length > 0 && <p className="muted small">Mentioned: {c.mentions.map((m) => m.name).join(', ')}</p>}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={post} className="op-comment-form" noValidate>
        <label className="field"><span>Add a comment</span>
          <textarea rows="3" value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} aria-invalid={error ? true : undefined} />
        </label>
        <LookupField id="f-mention" label="Mention someone" lookup="iam/users" valueKey="code" value={mention} onChange={() => {}} onPick={(row) => { if (row) { setText((t) => `${t}${t && !/\s$/.test(t) ? ' ' : ''}@${row.code} `); setMention(''); } }} compact />
        {error && <p className="field-error" role="alert">{error.message}{error.correlationId && <> (Correlation ID: <code>{error.correlationId}</code>)</>}</p>}
        <div className="actions"><button type="submit" className="btn btn-primary" disabled={add.isPending || !text.trim()}>{add.isPending ? 'Posting...' : 'Post comment'}</button></div>
        <p className="muted small">The same conversation will also be reachable from Messages once it is built (05.01).</p>
      </form>
    </div>
  );
}

/** Related records: where this record came from and what came from it. */
export function RelatedPanel({ type, id, navigate }) {
  const q = useObjectPart(type, id, 'related');
  if (q.isPending) return <Skeleton label="Loading related records" rows={2} />;
  if (q.isError) return <QueryError error={q.error} what="the related records" permission="the record's permission" onRetry={q.refetch} />;
  const group = (direction, title) => {
    const list = q.data.filter((x) => x.direction === direction);
    return list.length === 0 ? null : (
      <section key={direction}><h3>{title}</h3>
        <ul className="plain">{list.map((x, i) => <li key={i}>{x.kind}: <a href={x.to} onClick={(e) => { e.preventDefault(); navigate(x.to); }}>{x.label}</a></li>)}</ul>
      </section>
    );
  };
  if (q.data.length === 0) return <EmptyState compact title="No related records" message="Documents this one was started from, and documents made from it, are linked here." />;
  return <div data-testid="related-panel">{group('source', 'Started from')}{group('derived', 'Made from this record')}</div>;
}

const CHANGE_LABEL = { added: 'Added', removed: 'Removed', changed: 'Changed', same: 'Unchanged' };

/** Amendment comparison: two versions side by side, the fields that differ marked with the word as well as the colour. */
export function ComparePanel({ type, id }) {
  const versions = useObjectPart(type, id, 'versions');
  const list = useMemo(() => [...(versions.data ?? []).map((v) => ({ value: String(v.versionNo), label: `${v.label} (${formatDateTime(v.at)})` })), { value: 'current', label: 'Current copy' }], [versions.data]);
  const [from, setFrom] = useState('1');
  const [to, setTo] = useState('current');
  const diff = useObjectPart(type, id, 'compare', { enabled: Boolean(versions.data), query: `?from=${from}&to=${to}` });
  if (versions.isPending) return <Skeleton label="Loading versions" rows={2} />;
  if (versions.isError) return <QueryError error={versions.error} what="the versions" permission="the record's permission" onRetry={versions.refetch} />;
  const d = diff.data;
  return (
    <div data-testid="compare-panel">
      <div className="toolbar">
        <label className="shell-field"><span>Compare</span><select value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Older version">{list.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}</select></label>
        <label className="shell-field"><span>with</span><select value={to} onChange={(e) => setTo(e.target.value)} aria-label="Newer version">{list.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}</select></label>
      </div>
      {diff.isPending && <Skeleton label="Comparing" rows={2} />}
      {diff.isError && <QueryError error={diff.error} what="the comparison" permission="the record's permission" onRetry={diff.refetch} />}
      {d && (
        <>
          <p role="status" data-testid="compare-summary">{d.summary.headerChanged} header field(s) changed; {d.summary.linesChanged} line(s) changed, {d.summary.linesAdded} added, {d.summary.linesRemoved} removed.</p>
          <div className="table-wrap">
            <table>
              <caption>Header</caption>
              <thead><tr><th scope="col">Field</th><th scope="col">Before</th><th scope="col">After</th><th scope="col"><span className="visually-hidden">Changed</span></th></tr></thead>
              <tbody>{d.header.map((h) => <tr key={h.key} className={h.changed ? 'op-changed' : ''} data-testid={`cmp-${h.key}`}><td data-label="Field">{h.label}</td><td data-label="Before">{h.changed ? <del>{String(h.from) || 'empty'}</del> : h.from}</td><td data-label="After">{h.changed ? <ins>{String(h.to) || 'empty'}</ins> : h.to}</td><td>{h.changed ? <strong>Changed</strong> : ''}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="table-wrap">
            <table>
              <caption>Lines</caption>
              <thead><tr><th scope="col">#</th><th scope="col">Line</th><th scope="col">What changed</th></tr></thead>
              <tbody>{d.lines.map((l) => (
                <tr key={l.key} className={l.status !== 'same' ? 'op-changed' : ''} data-testid={`cmp-line-${l.status}`}>
                  <td data-label="#">{l.no}</td>
                  <td data-label="Line">{l.fields.find((f) => f.key === 'description')?.to || l.fields.find((f) => f.key === 'description')?.from} <span className={`op-kind op-kind-${l.status}`}>{CHANGE_LABEL[l.status]}</span></td>
                  <td data-label="What changed">{l.status === 'same' ? <span className="muted">No change</span> : l.status === 'changed' ? l.fields.filter((f) => f.changed).map((f) => <span key={f.key} className="op-delta">{f.label}: <del>{String(f.from) || 'empty'}</del> <ins>{String(f.to) || 'empty'}</ins></span>) : l.fields.filter((f) => ['description', 'quantity', 'unitRate', 'amount'].includes(f.key)).map((f) => <span key={f.key} className="op-delta">{f.label}: {String(l.status === 'added' ? f.to : f.from)}</span>)}</td>
                </tr>))}</tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
