import { useState } from 'react';
import { EmptyState, QueryError, Skeleton } from '../feedback/states.jsx';
import { formatDateTime } from '../format.js';
import { useMarkMentionsRead, useMentions } from './api.js';

// The mentions inbox (part 04.14, FR-05): the comments that name you, on records you can still open, newest first. Shown on the Notifications page.
export default function MentionsInbox({ navigate }) {
  const [all, setAll] = useState(false);
  const q = useMentions({ unread: all ? undefined : 'true', limit: 20 });
  const read = useMarkMentionsRead();
  const go = (ev, route) => { if (navigate && route) { ev.preventDefault(); navigate(route); } };
  return (
    <section aria-labelledby="mi-title" className="card col-mentions" data-testid="mentions-inbox">
      <h2 id="mi-title">Mentions{q.data?.unread ? <span className="op-count" aria-label={`${q.data.unread} unread`}> {q.data.unread}</span> : null}</h2>
      <div className="toolbar">
        <button type="button" className={`lr-chip${all ? '' : ' is-on'}`} aria-pressed={!all} onClick={() => setAll(false)}>Unread</button>
        <button type="button" className={`lr-chip${all ? ' is-on' : ''}`} aria-pressed={all} onClick={() => setAll(true)}>All</button>
        <button type="button" className="btn btn-small" disabled={!q.data?.unread || read.isPending} onClick={() => read.mutate({ all: true })}>Mark all as read</button>
      </div>
      {q.isPending && <Skeleton label="Loading mentions" rows={2} />}
      {q.isError && <QueryError error={q.error} what="your mentions" permission="" onRetry={q.refetch} />}
      {q.data && q.data.rows.length === 0 && <EmptyState compact title={all ? 'Nobody has mentioned you yet' : 'No unread mentions'} message="When someone writes @ and your username in a comment on a record you can open, it appears here." />}
      {q.data && q.data.rows.length > 0 && (
        <ul className="op-comments">
          {q.data.rows.map((m) => (
            <li key={m.id} data-testid="mention" className={m.read ? '' : 'is-unread'}>
              <strong>{m.author.name ?? m.author.username}</strong> on <a href={m.record.route ?? '#'} onClick={(ev) => { go(ev, m.record.route); if (!m.read) read.mutate({ ids: [m.id] }); }}>{m.record.label}</a> <span className="muted small">{formatDateTime(m.at)}</span>
              <p>{m.excerpt}</p>
              {!m.read && <button type="button" className="btn btn-small" onClick={() => read.mutate({ ids: [m.id] })}>Mark as read</button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
