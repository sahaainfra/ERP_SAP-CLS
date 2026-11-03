import { useState } from 'react';
import { EmptyState, ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { NTF, useMark, useNotifications, useReadAll } from '../../platform/notifications/api.js';
import { useLiveRefresh } from '../../platform/realtime/socket.js';
import { Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';

// Notification Centre (part 04.06, section 7.1): everything the person was told, newest first and grouped by day, with filters by kind, unread and archived views, a link to the work each
// one is about, and marks to read, unread and archive. It follows the person's own room, so a new notification appears as it is made.
export const CATEGORY = { approvals: 'Approvals', tasks: 'Tasks', alerts: 'Alerts', mentions: 'Mentions', system: 'System', security: 'Security', statutory: 'Statutory' };
const STATE = { inbox: 'All', unread: 'Unread', archived: 'Archived' };
const PAGE = 25;
const dayOf = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const dayLabel = (iso) => {
  const d = dayOf(iso);
  const today = dayOf(new Date().toISOString());
  const yesterday = dayOf(new Date(Date.now() - 86_400_000).toISOString());
  return d === today ? 'Today' : d === yesterday ? 'Yesterday' : new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'long', timeZone: 'Asia/Kolkata' });
};

export default function NotificationsPage({ session }) {
  usePageTitle('Notifications');
  const [filters, setFilters] = useState({ state: 'inbox', category: '', q: '' });
  const [page, setPage] = useState(1);
  const q = useNotifications({ ...filters, limit: PAGE, offset: (page - 1) * PAGE });
  const mark = useMark();
  const readAll = useReadAll();
  useLiveRefresh(session?.user ? [`user:${session.user}`] : [], [NTF]);
  const d = q.data;
  const set = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };
  const pages = d ? Math.max(1, Math.ceil(d.total / PAGE)) : 1;
  const groups = [];
  for (const n of d?.rows ?? []) { const l = dayLabel(n.at); const g = groups.at(-1); if (g?.label === l) g.rows.push(n); else groups.push({ label: l, rows: [n] }); }
  const open = (n) => { if (!n.read) mark.mutate({ id: n.id, action: 'read' }); if (n.link) navigateTo(n.link); };
  return (
    <section aria-labelledby="nc-title" data-testid="notifications">
      <h1 id="nc-title">Notifications</h1>
      <p className="muted">What the system told you. <Link to="/notifications/preferences">Preferences</Link> decide the channels, the quiet hours and the digest.</p>
      <div role="tablist" aria-label="Show" className="wf-inline">
        {Object.entries(STATE).map(([k, l]) => <button key={k} role="tab" type="button" aria-selected={filters.state === k} className={filters.state === k ? 'btn btn-primary' : 'btn'} onClick={() => set({ state: k })}>{l}{k === 'unread' && d?.counts.unread ? ` (${d.counts.unread})` : ''}</button>)}
      </div>
      <form className="srch-form" role="search" aria-label="Filter the notifications" onSubmit={(e) => e.preventDefault()}>
        <label className="field"><span>Kind</span><select value={filters.category} onChange={(e) => set({ category: e.target.value })}><option value="">All kinds</option>{Object.entries(CATEGORY).map(([k, l]) => <option key={k} value={k}>{l}{d?.counts.byCategory[k] ? ` (${d.counts.byCategory[k]} unread)` : ''}</option>)}</select></label>
        <label className="field"><span>Words</span><input type="search" value={filters.q} onChange={(e) => set({ q: e.target.value })} /></label>
        {(filters.category || filters.q) && <button type="button" className="btn" onClick={() => set({ category: '', q: '' })}>Clear filters</button>}
      </form>
      <div className="srch-tools"><button type="button" className="btn" disabled={!d?.counts.unread || readAll.isPending} onClick={() => readAll.mutate(filters.category ? { category: filters.category } : {})}>Mark all as read</button></div>
      {q.isPending && <Skeleton label="Loading the notifications" rows={4} />}
      {q.isError && <ErrorState title="The notifications could not be loaded" error={q.error} onRetry={() => q.refetch()} />}
      {d && (d.rows.length === 0 ? (
        <EmptyState title={filters.state === 'archived' ? 'Nothing archived' : filters.state === 'unread' ? 'You have read everything' : 'No notifications yet'} message="When a document needs you, something is returned to you or an alert is raised, it appears here as it happens." action={{ label: 'Choose what you are told', onClick: () => navigateTo('/notifications/preferences') }} />
      ) : (
        groups.map((g) => (
          <section key={g.label} aria-label={g.label} className="ntf-day">
            <h2>{g.label}</h2>
            <ul className="ntf-list" data-testid="nc-list" aria-label={g.label}>
              {g.rows.map((n) => (
                <li key={n.id} className={n.read ? 'ntf-item' : 'ntf-item ntf-unread'} data-testid={`nc-item-${n.id}`}>
                  <button type="button" className="ntf-open" onClick={() => open(n)}>
                    <strong>{n.title}</strong><span>{n.body}</span>
                    <span className="muted small">{CATEGORY[n.category]} · {new Date(n.at).toLocaleTimeString('en-IN', { timeStyle: 'short', timeZone: 'Asia/Kolkata' })}{n.priority === 'URGENT' || n.priority === 'HIGH' ? ' · ' : ''}{n.priority === 'URGENT' ? <StatusBadge status="rejected" label="Urgent" /> : n.priority === 'HIGH' ? <StatusBadge status="returned" label="High" /> : null}</span>
                  </button>
                  <span className="ntf-actions">
                    <button type="button" className="btn btn-small" onClick={() => mark.mutate({ id: n.id, action: n.read ? 'unread' : 'read' })}>{n.read ? 'Mark unread' : 'Mark read'}<span className="sr-only"> {n.title}</span></button>
                    <button type="button" className="btn btn-small" onClick={() => mark.mutate({ id: n.id, action: n.archived ? 'unarchive' : 'archive' })}>{n.archived ? 'Move back' : 'Archive'}<span className="sr-only"> {n.title}</span></button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))
      ))}
      <div className="pager"><span>{d?.total ?? 0} notification(s), page {page} of {pages}</span>
        <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button type="button" className="btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>
    </section>
  );
}
