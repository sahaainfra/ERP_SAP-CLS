import { useEffect, useState } from 'react';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDateTime, formatINR } from '../../platform/format.js';
import { useAct, useEvidence, useInbox } from '../../platform/workflow/api.js';
import { errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { Flags, show } from './Evidence.jsx';
import { SLA } from './InboxPage.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Approvals on a phone (part 04.03, section 7.3, FR-05): the pending documents as large cards, the most urgent first; a tap opens the document with its flags and the
// figures that matter; Approve is one tap; Reject asks for a reason (required). Large touch targets, nothing to type to approve, works at 360 px.
function Detail({ taskId, onDone, onBack }) {
  const ev = useEvidence(taskId);
  const act = useAct();
  const [mode, setMode] = useState(null);
  const [comment, setComment] = useState('');
  const [error, setError] = useState(null);
  if (ev.isPending) return <Skeleton label="Loading the document" rows={3} />;
  if (ev.isError) return <ErrorState title="The document could not be loaded" error={ev.error} onRetry={() => ev.refetch()} />;
  const d = ev.data;
  const metrics = d.sections.filter((s) => s.kind === 'metrics').flatMap((s) => s.items).filter((i) => !i.masked).slice(0, 6);
  const go = (action) => act.mutate({ taskId, action, comment: comment || undefined, version: d.task.version }, { onSuccess: () => onDone(action), onError: (e) => setError(errorInfo(e)) });
  return (
    <article className="card mob-detail" aria-label="Document to decide" data-testid="mob-detail">
      <button type="button" className="btn mob-btn" onClick={onBack}>Back to the list</button>
      <h2>{d.instance.docRef ?? d.instance.docId}</h2>
      <p>{d.instance.docLabel}: {d.instance.title} · raised by {d.instance.submittedBy}</p>
      <Flags flags={d.flags} />
      {d.summary && <dl className="kv">{d.summary.fields.slice(0, 5).map((f) => <div key={f.label}><dt>{f.label}</dt><dd>{show(f.value, f.format)}</dd></div>)}</dl>}
      {metrics.length > 0 && <dl className="kv" aria-label="Key figures">{metrics.map((m, i) => <div key={i}><dt>{m.label}</dt><dd>{show(m.value, m.format)}</dd></div>)}</dl>}
      {d.emptyMessage && <p className="muted small">{d.emptyMessage}</p>}
      {error && <p role="alert" className="error">{error.form}</p>}
      {!d.canAct ? <p className="notice" role="note">{d.whyNot}</p> : mode === null ? (
        <div className="mob-actions">
          <button type="button" className="btn btn-primary mob-btn" disabled={act.isPending} onClick={() => go('approve')}>Approve</button>
          <button type="button" className="btn btn-danger mob-btn" onClick={() => setMode('reject')}>Reject</button>
          <button type="button" className="btn mob-btn" onClick={() => setMode('return')}>Return</button>
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); go(mode); }}>
          <label className="field"><span>Why do you {mode}? (needed)</span><textarea rows={3} value={comment} minLength={5} maxLength={2000} required onChange={(e) => setComment(e.target.value)} /></label>
          <div className="mob-actions"><button type="submit" className="btn btn-primary mob-btn" disabled={act.isPending || comment.trim().length < 5}>{mode === 'reject' ? 'Reject' : 'Return'} now</button><button type="button" className="btn mob-btn" onClick={() => setMode(null)}>Cancel</button></div>
        </form>
      )}
    </article>
  );
}

export default function MobileApprovalsPage() {
  usePageTitle('Approvals');
  const list = useInbox({ limit: 50, offset: 0, sort: 'urgency' });
  const [open, setOpen] = useState(null);
  const [notice, setNotice] = useState('');
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => { const on = () => setOnline(true); const off = () => setOnline(false); window.addEventListener('online', on); window.addEventListener('offline', off); return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); }; }, []);
  return (
    <section aria-labelledby="mb-title" data-testid="mobile-approvals">
      <PageHeader id="mb-title" title={"Approvals"} />
      {!online && <p className="notice" role="status" data-testid="mob-offline">You are offline. Decisions need a connection; what you see may be out of date.</p>}
      {notice && <p role="status" className="notice" data-testid="mob-notice">{notice}</p>}
      {open ? <Detail key={open} taskId={open} onBack={() => setOpen(null)} onDone={(a) => { setOpen(null); setNotice(`Done: ${a === 'approve' ? 'approved' : a === 'reject' ? 'rejected' : 'returned'}.`); list.refetch(); }} /> : (
        <>
          {list.isPending && <Skeleton label="Loading your approvals" rows={3} />}
          {list.isError && <ErrorState title="Your approvals could not be loaded" error={list.error} onRetry={() => list.refetch()} />}
          {list.data && (list.data.rows.length === 0 ? <EmptyState title="Nothing is waiting for you" message="New approvals appear here when a document needs your decision." /> : (
            <ul className="mob-list" aria-label="Waiting for you">
              {list.data.rows.map((r) => (
                <li key={r.taskId}>
                  <button type="button" className="card mob-card" onClick={() => { setNotice(''); setOpen(r.taskId); }} data-testid={`mob-card-${r.taskId}`}>
                    <strong>{r.docRef ?? r.title}</strong>
                    <span>{r.docLabel}: {r.title}</span>
                    <span>{r.amount == null ? '' : formatINR(r.amount)} · from {r.submittedBy}</span>
                    <span><StatusBadge status={SLA[r.sla][0]} label={SLA[r.sla][1]} />{r.dueAt ? ` due ${formatDateTime(r.dueAt)}` : ''}</span>
                    {r.flags.length > 0 && <span className="small">{r.flags.map((f) => f.label).join(', ')}</span>}
                  </button>
                </li>
              ))}
            </ul>
          ))}
        </>
      )}
    </section>
  );
}
