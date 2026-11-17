import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDateTime } from '../../platform/format.js';
import { comm } from '../../platform/messages/Comm.jsx';
import { can, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Announcements (part 05.04, FR-04): what was announced to the person (read when opened, confirmed with an optional quiz) and what they announced (recipients, read and confirmed percentages, who has not read it).
const STATUS = { DRAFT: ['DRAFT', 'Draft'], SCHEDULED: ['IN_REVIEW', 'Scheduled'], PUBLISHED: ['COMPLETED', 'Published'], EXPIRED: ['DRAFT', 'Expired'], CANCELLED: ['REJECTED', 'Cancelled'] };
const fromUrl = () => Number(new URLSearchParams(window.location.search).get('a')) || null;

function Detail({ id, session }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['comm', 'announcement', id], queryFn: async () => { const a = await comm.announcement(id); if (a.mine && !a.mine.readAt && a.status === 'PUBLISHED') return comm.readAnnouncement(id).then((r) => ({ ...a, mine: r.mine })).catch(() => a); return a; }, retry: false });
  const [answers, setAnswers] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { setAnswers([]); setResult(null); setError(null); }, [id]);
  if (q.isPending) return <Skeleton label="Loading the announcement" rows={3} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const a = q.data;
  const refresh = () => { qc.invalidateQueries({ queryKey: ['comm'] }); };
  const confirm = async () => { setError(null); try { const r = await comm.confirmAnnouncement(id, answers); setResult(r); refresh(); } catch (e) { setError(errorInfo(e)); } };
  const mineSender = a.sender.username === session.user;
  const act = async (fn) => { setError(null); try { await fn(); refresh(); } catch (e) { setError(errorInfo(e)); } };
  return (
    <article className="card" aria-labelledby="an-title" data-testid="announcement">
      <h2 id="an-title">{a.title}</h2>
      <p className="muted small">From {a.sender.name} · <StatusBadge status={STATUS[a.status][0]} label={STATUS[a.status][1]} />{a.publishedAt ? ` · ${formatDateTime(a.publishedAt)}` : ''}{a.expiresAt ? ` · expires ${formatDateTime(a.expiresAt)}` : ''}</p>
      <p className="an-body" data-testid="an-body">{a.body}</p>
      {a.mine && a.requireConfirmation && (
        a.mine.confirmedAt ? <p role="status" className="notice" data-testid="an-confirmed">You confirmed this on {formatDateTime(a.mine.confirmedAt)}{a.mine.score !== null ? ` (quiz ${a.mine.score} of ${a.quiz.length})` : ''}.</p> : a.status === 'PUBLISHED' && (
          <fieldset className="card" data-testid="an-confirm"><legend>Please confirm that you have read and understood this</legend>
            {a.quiz.map((qz, k) => (
              <div key={k} role="radiogroup" aria-label={qz.q} className="an-quiz"><p><strong>{k + 1}. {qz.q}</strong></p>
                {qz.options.map((o, i) => <label key={i} className="field field-inline"><span>{o}</span><input type="radio" name={`q${k}`} checked={answers[k] === i} onChange={() => { const n = [...answers]; n[k] = i; setAnswers(n); }} data-testid={`an-q${k}-${i}`} /></label>)}</div>
            ))}
            {result && !result.passed && <p className="field-error" role="alert" data-testid="an-wrong">{result.score} of {result.of} right. Read it again and try once more.</p>}
            <button type="button" className="btn btn-primary" onClick={confirm} disabled={a.quiz.length > 0 && answers.filter((x) => x !== undefined).length < a.quiz.length} data-testid="an-confirm-go">{a.quiz.length ? 'Check my answers and confirm' : 'I have read and understood'}</button>
          </fieldset>
        )
      )}
      {mineSender && (
        <section aria-label="Delivery" data-testid="an-stats"><h3>Delivery</h3>
          <p>{a.stats.recipients} recipients · read {a.stats.read} ({a.stats.readPercent}%){a.requireConfirmation ? ` · confirmed ${a.stats.confirmed} (${a.stats.confirmedPercent}%)` : ''}</p>
          {a.recipients && <div className="table-wrap" tabIndex={0} role="region" aria-label="Recipients"><table className="grid"><thead><tr><th>Person</th><th>Read</th><th>Confirmed</th>{a.quiz.length > 0 && <th>Quiz</th>}</tr></thead><tbody>{a.recipients.map((r) => <tr key={r.username} data-testid="an-recipient"><th scope="row" data-label="Person">{r.name}</th><td data-label="Read">{r.readAt ? formatDateTime(r.readAt) : 'Not yet'}</td><td data-label="Confirmed">{r.confirmedAt ? formatDateTime(r.confirmedAt) : '—'}</td>{a.quiz.length > 0 && <td data-label="Quiz">{r.score !== null ? `${r.score} of ${a.quiz.length} (${r.attempts} tries)` : '—'}</td>}</tr>)}</tbody></table></div>}
          <div className="actions">
            {a.status === 'DRAFT' && <button type="button" className="btn btn-primary" onClick={() => act(() => comm.publishAnnouncement(id))} data-testid="an-publish">Publish</button>}
            {['PUBLISHED', 'SCHEDULED'].includes(a.status) && <button type="button" className="btn" onClick={() => { const why = window.prompt('Why is it being cancelled?') ?? ''; if (why.trim().length >= 5) act(() => comm.cancelAnnouncement(id, why.trim())); }} data-testid="an-cancel">Cancel it</button>}
          </div>
        </section>
      )}
      {error?.form && <p className="field-error" role="alert" data-testid="an-error">{error.form}{error.correlationId && <> (Correlation ID: <code>{error.correlationId}</code>)</>}</p>}
    </article>
  );
}

export default function AnnouncementsPage({ session }) {
  usePageTitle('Announcements');
  const [view, setView] = useState('received');
  const [sel, setSel] = useState(fromUrl);
  const q = useQuery({ queryKey: ['comm', 'announcements', view], queryFn: () => comm.announcements({ view }), retry: false });
  useEffect(() => { const f = () => setSel(fromUrl()); window.addEventListener('popstate', f); return () => window.removeEventListener('popstate', f); }, []);
  const choose = (id) => { window.history.pushState(null, '', `/collab/announcements?a=${id}`); setSel(id); };
  return (
    <section aria-labelledby="ann-title" data-testid="announcements">
      <PageHeader id="ann-title" title={"Announcements"} actions={<>{can(session, 'msg.announcement.send') && <button type="button" className="btn btn-primary" onClick={() => navigateTo('/collab/announcements/new')} data-testid="an-new">New announcement</button>}</>} />
      <div className="msg-filters" role="tablist" aria-label="Which announcements">
        {[['received', 'For me'], ...(can(session, 'msg.announcement.send') ? [['sent', 'Sent by me']] : []), ...(can(session, 'msg.comm.view_all') ? [['all', 'All']] : [])].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={view === k} className={`lr-chip${view === k ? ' is-on' : ''}`} onClick={() => { setView(k); setSel(null); }} data-testid={`an-tab-${k}`}>{l}{k === 'received' && q.data?.unread ? ` (${q.data.unread} unread)` : ''}</button>)}
      </div>
      {q.isError && <ErrorState error={q.error} onRetry={q.refetch} />}
      {q.isPending && <Skeleton label="Loading announcements" rows={3} />}
      {q.data && (q.data.rows.length === 0 ? <EmptyState title="No announcements" message={view === 'received' ? 'Nothing has been announced to you yet.' : 'Nothing here yet.'} action={can(session, 'msg.announcement.send') ? <button type="button" className="btn btn-primary" onClick={() => navigateTo('/collab/announcements/new')}>New announcement</button> : undefined} /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Announcements"><table className="grid"><thead><tr><th>Title</th><th>From</th><th>Status</th><th>Published</th><th>{view === 'received' ? 'Me' : 'Delivery'}</th></tr></thead>
          <tbody>{q.data.rows.map((r) => <tr key={r.id} className={sel === r.id ? 'is-selected' : ''} data-testid="an-row"><th scope="row" data-label="Title"><button type="button" className="link-button" onClick={() => choose(r.id)} data-testid="an-open">{!r.mine?.readAt && r.status === 'PUBLISHED' && view === 'received' ? '● ' : ''}{r.title}</button></th><td data-label="From">{r.sender.name}</td><td data-label="Status"><StatusBadge status={STATUS[r.status][0]} label={STATUS[r.status][1]} /></td><td data-label="Published">{r.publishedAt ? formatDateTime(r.publishedAt) : '—'}</td>
            <td data-label={view === 'received' ? 'Me' : 'Delivery'}>{view === 'received' ? (r.mine?.confirmedAt ? 'Confirmed' : r.mine?.readAt ? (r.requireConfirmation ? 'Read, to confirm' : 'Read') : 'Unread') : `${r.stats.readPercent}% read${r.requireConfirmation ? `, ${r.stats.confirmedPercent}% confirmed` : ''}`}</td></tr>)}</tbody></table></div>
      ))}
      {sel && <Detail id={sel} session={session} />}
    </section>
  );
}
