import { Fragment, useMemo, useState } from 'react';
import { AttachmentList, FileUploader } from '../../modules/core/components/Attachments.jsx';
import { Changes } from '../audit/RecordHistory.jsx';
import StatusBadge from '../design/StatusBadge.jsx';
import { EmptyState, QueryError, Skeleton } from '../feedback/states.jsx';
import { formatDateTime, formatINR } from '../format.js';
import { LookupField } from '../forms/LookupField.jsx';
import { useCollabActions, useComments, useTimeline, useTrace } from './api.js';

// The three tabs every record can show (part 04.14): Discussion (threaded comments, @mentions, attachments, reactions), Timeline (everything that happened to the record, from every source, with filters)
// and Trace (what the record came from and what came from it). They work for any record type registered with the object type registry; the server applies the person's right to the record.
const REACTION = { like: ['Like', '👍'], ack: ['Acknowledged', '✅'], eyes: ['Seen', '👀'], thanks: ['Thanks', '🙏'] };
const KINDS = [['', 'Everything'], ['audit', 'Changes'], ['approval', 'Approvals'], ['workflow', 'Workflow'], ['comment', 'Comments'], ['document', 'Documents'], ['task', 'Tasks'], ['message', 'Messages']];
const KIND_LABEL = Object.fromEntries(KINDS.filter(([k]) => k).map(([k, l]) => [k, l.replace(/s$/, '')]));

const errorText = (err) => (err?.message ?? 'Something went wrong') + (err?.correlationId ? ` (Correlation ID: ${err.correlationId})` : '');
const Mentioned = ({ text }) => text.split(/((?:^|(?<=[^\w@]))@[A-Za-z0-9._-]{2,40})/g).map((part, i) => (/^@/.test(part) ? <strong key={i} className="col-mention">{part}</strong> : <Fragment key={i}>{part}</Fragment>));

function Composer({ actions, parentId = null, settings, onDone, label = 'Add a comment', autoFocus = false }) {
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const [mention, setMention] = useState('');
  const [posted, setPosted] = useState(null);
  const max = settings?.maxLength ?? 2000;
  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await actions.post.mutateAsync({ body: text.trim(), parentId: parentId ?? undefined });
      setText('');
      setPosted(res.id);
      onDone?.(res);
    } catch (err) { setError(err); }
  };
  return (
    <form onSubmit={submit} className="op-comment-form col-composer" noValidate>
      <label className="field"><span>{label}</span>
        <textarea rows={parentId ? 2 : 3} value={text} maxLength={max} autoFocus={autoFocus} onChange={(e) => setText(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? 'col-error' : undefined} />
      </label>
      <p className="muted small">{text.length} of {max} characters. Mention someone with @username; they are told, and only if they can open this record.</p>
      <LookupField id={`f-mention-${parentId ?? 'new'}`} label="Mention someone" lookup="iam/users" valueKey="code" value={mention} onChange={() => {}} onPick={(row) => { if (row) { setText((t) => `${t}${t && !/\s$/.test(t) ? ' ' : ''}@${row.code} `); setMention(''); } }} compact />
      {error && <p id="col-error" className="field-error" role="alert" data-testid="col-error">{errorText(error)}</p>}
      {posted && !error && <p className="muted small" role="status">Posted. You can add files to it while it can still be edited.</p>}
      <div className="actions"><button type="submit" className="btn btn-primary" disabled={actions.post.isPending || !text.trim()}>{actions.post.isPending ? 'Posting...' : parentId ? 'Reply' : 'Post comment'}</button></div>
      {posted && <FileUploader entity="col_comment" entityId={posted} onDone={() => actions.post.reset()} />}
    </form>
  );
}

function CommentItem({ c, actions, settings, canModerate, depth = 0 }) {
  const [mode, setMode] = useState(null); // 'reply' | 'edit' | 'delete' | 'files'
  const [draft, setDraft] = useState(c.body);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const deleted = c.status === 'DELETED';
  const run = async (fn) => { setError(null); try { await fn(); setMode(null); } catch (err) { setError(err); } };
  return (
    <li className={`col-comment${deleted ? ' is-deleted' : ''}`} data-testid="comment" id={`comment-${c.id}`}>
      <div><strong>{c.author.name ?? c.author.username}</strong> <span className="muted small">{c.author.username}</span> <span className="muted small">{formatDateTime(c.createdAt)}</span>{c.editedAt && <span className="muted small"> (edited)</span>}</div>
      {deleted ? <p className="muted"><em>This comment was deleted.</em>{c.deletedReason ? ` Reason: ${c.deletedReason}` : ''}</p> : mode === 'edit' ? (
        <form onSubmit={(e) => { e.preventDefault(); run(() => actions.edit.mutateAsync({ commentId: c.id, body: draft.trim(), version: c.version })); }} noValidate>
          <label className="field"><span>Edit your comment</span><textarea rows="3" value={draft} maxLength={settings.maxLength} onChange={(e) => setDraft(e.target.value)} /></label>
          <div className="actions"><button type="submit" className="btn btn-primary" disabled={actions.edit.isPending || !draft.trim()}>Save</button><button type="button" className="btn" onClick={() => setMode(null)}>Cancel</button></div>
        </form>
      ) : <p><Mentioned text={c.body} /></p>}
      {!deleted && c.files.length > 0 && <AttachmentList entity="col_comment" entityId={c.id} canEdit={c.canEdit} />}
      {!deleted && (
        <div className="toolbar col-actions" role="group" aria-label="Comment actions">
          {settings.reactionsEnabled && Object.entries(REACTION).map(([k, [label, glyph]]) => (
            <button key={k} type="button" className={`lr-chip${c.reactions[k].mine ? ' is-on' : ''}`} aria-pressed={c.reactions[k].mine} aria-label={`${label}, ${c.reactions[k].count}`} onClick={() => run(() => actions.react.mutateAsync({ commentId: c.id, reaction: k, on: !c.reactions[k].mine }))}>
              <span aria-hidden="true">{glyph}</span> {c.reactions[k].count > 0 ? c.reactions[k].count : ''}
            </button>
          ))}
          {depth < 3 && <button type="button" className="btn btn-small" onClick={() => setMode(mode === 'reply' ? null : 'reply')}>Reply</button>}
          {c.canEdit && <button type="button" className="btn btn-small" onClick={() => { setDraft(c.body); setMode('edit'); }}>Edit</button>}
          {c.canEdit && <button type="button" className="btn btn-small" onClick={() => setMode(mode === 'files' ? null : 'files')}>Add files</button>}
          {c.canDelete && <button type="button" className="btn btn-small" onClick={() => setMode('delete')}>Delete</button>}
        </div>
      )}
      {mode === 'files' && <FileUploader entity="col_comment" entityId={c.id} onDone={() => actions.post.reset()} />}
      {mode === 'delete' && (
        <form onSubmit={(e) => { e.preventDefault(); run(() => actions.remove.mutateAsync({ commentId: c.id, reason: reason.trim() || undefined })); }} noValidate>
          <label className="field"><span>{canModerate && c.author.username ? 'Why is this comment being deleted?' : 'Reason (optional)'}</span><input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></label>
          <div className="actions"><button type="submit" className="btn btn-primary" disabled={actions.remove.isPending}>Delete comment</button><button type="button" className="btn" onClick={() => setMode(null)}>Keep it</button></div>
        </form>
      )}
      {error && <p className="field-error" role="alert">{errorText(error)}</p>}
      {mode === 'reply' && <Composer actions={actions} parentId={c.id} settings={settings} label="Your reply" autoFocus onDone={() => setMode(null)} />}
      {c.replies.length > 0 && <ul className="op-comments col-replies">{c.replies.map((r) => <CommentItem key={r.id} c={r} actions={actions} settings={settings} canModerate={canModerate} depth={depth + 1} />)}</ul>}
    </li>
  );
}

/** Discussion: threaded comments with replies, @mentions, reactions and files. Comments written before this part (03.04) are listed first, read only. */
export function DiscussionTab({ entity, id }) {
  const q = useComments(entity, id);
  const actions = useCollabActions(entity, id);
  if (q.isPending) return <Skeleton label="Loading the discussion" rows={2} />;
  if (q.isError) return <QueryError error={q.error} what="the discussion" permission="the record's permission" onRetry={q.refetch} />;
  const { comments, legacy, settings, canModerate } = q.data;
  return (
    <div data-testid="discussion-panel">
      {comments.length === 0 && legacy.length === 0 && <EmptyState compact title="No comments yet" message="Ask a question or leave a note for the people working on this record. Mention someone with @username." />}
      {(legacy.length > 0 || comments.length > 0) && (
        <ul className="op-comments">
          {legacy.map((c) => <li key={c.id} data-testid="comment"><strong>{c.author.name ?? c.author.username}</strong> <span className="muted small">{formatDateTime(c.createdAt)}</span><p><Mentioned text={c.body} /></p></li>)}
          {comments.map((c) => <CommentItem key={c.id} c={c} actions={actions} settings={settings} canModerate={canModerate} />)}
        </ul>
      )}
      <Composer actions={actions} settings={settings} />
    </div>
  );
}

const KindTag = ({ kind }) => <span className={`op-kind op-kind-${kind}`}>{KIND_LABEL[kind] ?? kind}</span>;

/** The filters and the list of events shared by the record timeline and the project activity feed. */
export function EventList({ data, query, filters, setFilters, withRecord = false, navigate }) {
  const counts = data?.counts ?? {};
  return (
    <div data-testid="timeline-panel">
      <div className="toolbar" role="group" aria-label="Show">
        {KINDS.map(([k, l]) => <button key={k} type="button" className={`lr-chip${(filters.kinds ?? '') === k ? ' is-on' : ''}`} aria-pressed={(filters.kinds ?? '') === k} onClick={() => setFilters({ ...filters, kinds: k, offset: 0 })}>{l}{k && counts[k] ? ` (${counts[k]})` : ''}</button>)}
      </div>
      <div className="toolbar col-filters">
        <label className="field field-inline"><span>From</span><input type="date" value={filters.from ?? ''} onChange={(e) => setFilters({ ...filters, from: e.target.value, offset: 0 })} /></label>
        <label className="field field-inline"><span>To</span><input type="date" value={filters.to ?? ''} onChange={(e) => setFilters({ ...filters, to: e.target.value, offset: 0 })} /></label>
        <label className="field field-inline"><span>Search</span><input type="search" value={filters.q ?? ''} maxLength={100} onChange={(e) => setFilters({ ...filters, q: e.target.value, offset: 0 })} /></label>
      </div>
      {query.isPending && <Skeleton label="Loading the timeline" />}
      {query.isError && <QueryError error={query.error} what="the timeline" permission="the record's permission" onRetry={query.refetch} />}
      {data && data.rows.length === 0 && <EmptyState compact title="Nothing recorded yet" message="Changes, approvals, comments, documents, tasks and messages appear here as they happen." />}
      {data && data.rows.length > 0 && (
        <>
          <p className="muted small" role="status">Showing {data.rows.length} of {data.total}, newest first.</p>
          <ol className="timeline op-timeline">
            {data.rows.map((e) => (
              <li key={e.key} data-testid={`tl-${e.kind}`}>
                <KindTag kind={e.kind} /> <strong>{e.action}</strong>{e.actor && <> by {e.actorName ?? e.actor}</>} <span className="muted">{formatDateTime(e.at)}</span>
                {withRecord && e.record && <> <span className="muted">on</span> {e.record.route ? <a href={e.record.route} onClick={(ev) => { if (navigate) { ev.preventDefault(); navigate(e.record.route); } }}>{e.record.label}</a> : e.record.label}</>}
                {e.summary && e.kind !== 'audit' && <p className="muted small">{e.summary}</p>}
                {e.reason && <p>{e.reason}</p>}
                {e.kind === 'audit' && Object.keys(e.changes).length > 0 && <Changes changes={e.changes} />}
              </li>
            ))}
          </ol>
          {data.total > data.rows.length + (filters.offset ?? 0) && <div className="actions"><button type="button" className="btn" onClick={() => setFilters({ ...filters, limit: (filters.limit ?? 50) + 50 })}>Show more</button></div>}
        </>
      )}
    </div>
  );
}

/** Timeline: audit, approvals, workflow, comments, document versions, tasks and messages of one record in one list. */
export function TimelineTab({ entity, id }) {
  const [filters, setFilters] = useState({ kinds: '', from: '', to: '', q: '', limit: 50, offset: 0 });
  const clean = useMemo(() => ({ ...filters, kinds: filters.kinds || undefined }), [filters]);
  const query = useTimeline(entity, id, clean);
  return <EventList data={query.data} query={query} filters={filters} setFilters={setFilters} />;
}

function TraceNode({ n, navigate, onUnlink }) {
  const body = (
    <>
      <span className="muted small">{n.typeLabel}</span> <strong>{n.label}</strong>
      {n.status && <> <StatusBadge status={n.status} /></>}
      {n.amount !== null && n.amount !== undefined && <> <span className="num">{formatINR(n.amount)}</span></>}
      {n.manual && <span className="muted small"> (linked by hand)</span>}
    </>
  );
  return (
    <li data-testid="trace-node" className={n.restricted ? 'is-restricted' : ''} style={{ marginInlineStart: `calc(var(--erp-space-4) * ${n.level - 1})` }}>
      <span className="muted small">{n.relation.toLowerCase()}</span>{' '}
      {n.route && !n.restricted ? <a href={n.route} onClick={(ev) => { if (navigate) { ev.preventDefault(); navigate(n.route); } }}>{body}</a> : body}
      {n.restricted && <span className="muted small"> You do not have access to this record.</span>}
      {n.manual && onUnlink && <> <button type="button" className="btn btn-small" onClick={() => onUnlink(n)}>Remove link</button></>}
    </li>
  );
}

/** Trace: upstream (what this record came from) and downstream (what came from it) with status and amount, to a chosen depth; a link may be added by hand with a reason (BR-02). */
export function TraceTab({ entity, id, navigate }) {
  const [depth, setDepth] = useState(3);
  const q = useTrace(entity, id, depth);
  const actions = useCollabActions(entity, id);
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  if (q.isPending) return <Skeleton label="Loading the trace" />;
  if (q.isError) return <QueryError error={q.error} what="the trace" permission="the record's permission" onRetry={q.refetch} />;
  const t = q.data;
  const unlink = async (n) => { const reason = globalThis.prompt?.('Why is this link being removed?') ?? ''; if (!reason.trim()) return; try { await actions.unlink.mutateAsync({ linkId: n.linkId, reason: reason.trim() }); } catch (err) { setError(err); } };
  const add = async (e) => {
    e.preventDefault(); setError(null);
    const self = { entity, id: String(id) }; const other = { entity: form.type.trim(), id: form.id.trim() };
    try { await actions.link.mutateAsync({ from: form.direction === 'from' ? other : self, to: form.direction === 'from' ? self : other, relation: form.relation, reason: form.reason.trim() }); setForm(null); } catch (err) { setError(err); }
  };
  const total = (s) => (s ? <span className="muted small"> Total {formatINR(s)}</span> : null);
  return (
    <div data-testid="trace-panel">
      <div className="toolbar">
        <label className="field field-inline"><span>Depth</span>
          <select value={depth} onChange={(e) => setDepth(Number(e.target.value))}>{[1, 2, 3, 4, 5, 6, 8].map((d) => <option key={d} value={d}>{d} {d === 1 ? 'step' : 'steps'}</option>)}</select>
        </label>
        {t.canLink && <button type="button" className="btn" onClick={() => setForm({ direction: 'to', type: '', id: '', relation: 'REFERS', reason: '' })}>Link a record</button>}
      </div>
      {error && <p className="field-error" role="alert">{errorText(error)}</p>}
      {form && (
        <form onSubmit={add} className="op-comment-form" noValidate>
          <p className="muted small">Links are normally made by the system. A link made by hand needs a reason and is recorded in the audit trail.</p>
          <label className="field"><span>This record is</span><select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}><option value="to">the source of the other record</option><option value="from">derived from the other record</option></select></label>
          <label className="field"><span>Record type of the other record</span><input value={form.type} required pattern="[a-z][a-z_]*" onChange={(e) => setForm({ ...form, type: e.target.value })} /></label>
          <label className="field"><span>Number or id of the other record</span><input value={form.id} required onChange={(e) => setForm({ ...form, id: e.target.value })} /></label>
          <label className="field"><span>Relation</span><select value={form.relation} onChange={(e) => setForm({ ...form, relation: e.target.value })}>{['DERIVED', 'AMENDS', 'FULFILS', 'SETTLES', 'REFERS'].map((r) => <option key={r} value={r}>{r.toLowerCase()}</option>)}</select></label>
          <label className="field"><span>Reason (at least 10 characters)</span><textarea rows="2" value={form.reason} required minLength={10} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
          <div className="actions"><button type="submit" className="btn btn-primary" disabled={actions.link.isPending || form.reason.trim().length < 10 || !form.type || !form.id}>Add link</button><button type="button" className="btn" onClick={() => setForm(null)}>Cancel</button></div>
        </form>
      )}
      <h3>Came from{total(t.totals.upstream)}</h3>
      {t.upstream.length === 0 ? <EmptyState compact title="No source records" message="Nothing is recorded as the source of this record." /> : <ul className="op-trace">{t.upstream.map((n, i) => <TraceNode key={`u${i}`} n={n} navigate={navigate} onUnlink={t.canLink ? unlink : null} />)}</ul>}
      <h3>This record: <strong>{t.root.label}</strong> {t.root.status && <StatusBadge status={t.root.status} />}</h3>
      <h3>Led to{total(t.totals.downstream)}</h3>
      {t.downstream.length === 0 ? <EmptyState compact title="No derived records" message="No record is recorded as made from this one." /> : <ul className="op-trace">{t.downstream.map((n, i) => <TraceNode key={`d${i}`} n={n} navigate={navigate} onUnlink={t.canLink ? unlink : null} />)}</ul>}
      {t.truncated && <p className="muted small" role="status">The chain is longer than can be shown here; reduce the depth to see the nearest records.</p>}
    </div>
  );
}

/** The three tabs together, for a record page that has no Object Page of its own (the sample document of the workflow engine uses it). */
export function CollabTabs({ entity, id, navigate }) {
  const [tab, setTab] = useState('discussion');
  const tabs = [['discussion', 'Discussion'], ['timeline', 'Timeline'], ['trace', 'Trace']];
  const onKey = (e) => {
    const i = tabs.findIndex(([k]) => k === tab);
    const next = e.key === 'ArrowRight' ? tabs[(i + 1) % tabs.length] : e.key === 'ArrowLeft' ? tabs[(i - 1 + tabs.length) % tabs.length] : null;
    if (next) { e.preventDefault(); setTab(next[0]); document.getElementById(`col-tab-${next[0]}`)?.focus(); }
  };
  return (
    <section aria-label="Collaboration" className="col-tabs" data-testid="collab-tabs">
      <div role="tablist" aria-label="Discussion, timeline and trace" className="op-tabs" onKeyDown={onKey}>
        {tabs.map(([k, l]) => <button key={k} type="button" role="tab" id={`col-tab-${k}`} aria-selected={tab === k} aria-controls={`col-panel-${k}`} tabIndex={tab === k ? 0 : -1} className={`op-tab${tab === k ? ' is-active' : ''}`} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      <div role="tabpanel" id={`col-panel-${tab}`} aria-labelledby={`col-tab-${tab}`} className="op-panel" tabIndex={0}>
        {tab === 'discussion' && <DiscussionTab entity={entity} id={id} />}
        {tab === 'timeline' && <TimelineTab entity={entity} id={id} />}
        {tab === 'trace' && <TraceTab entity={entity} id={id} navigate={navigate} />}
      </div>
    </section>
  );
}
