import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDateTime } from '../../platform/format.js';
import { PRIORITY, comm, useCenter, useRefreshComm } from '../../platform/messages/Comm.jsx';
import { errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Communication Center (part 05.04, section 7.1): inside Messages. Tiles for the views (my chats, teams, projects, sites, departments, ERP-linked conversations, unread, pending acknowledgements, important instructions,
// escalations), the person's pending actions, and the exceptions. Every tile opens the filtered list or the page behind it.
const open = (to) => navigateTo(to);
function Tile({ label, value, sub, to, tone, testid }) {
  return (
    <button type="button" className={`cc-tile${tone ? ` is-${tone}` : ''}`} onClick={() => open(to)} data-testid={testid}>
      <span className="cc-value num">{value}</span><span className="cc-label">{label}</span>{sub && <span className="muted small">{sub}</span>}
    </button>
  );
}

function Escalations() {
  const refresh = useRefreshComm();
  const mine = useQuery({ queryKey: ['comm', 'esc', 'mine'], queryFn: () => comm.escalations('mine'), retry: false });
  const got = useQuery({ queryKey: ['comm', 'esc', 'received'], queryFn: () => comm.escalations('received'), retry: false });
  const [error, setError] = useState(null);
  const rows = [...(got.data ?? []).map((r) => ({ ...r, kind: 'Escalated to me' })), ...(mine.data ?? []).filter((r) => !(got.data ?? []).some((g) => g.id === r.id)).map((r) => ({ ...r, kind: 'Flagged by me or in my conversations' }))].filter((r) => r.status !== 'RESOLVED');
  const resolve = async (r) => { const how = window.prompt('How was it resolved?') ?? ''; if (how.trim().length < 3) return; try { await comm.resolve(r.id, how.trim()); refresh(); } catch (e) { setError(errorInfo(e)); } };
  return (
    <section aria-labelledby="cc-esc" data-testid="cc-escalations"><h2 id="cc-esc">Escalations</h2>
      {error?.form && <p className="field-error" role="alert">{error.form}</p>}
      {mine.isPending ? <Skeleton label="Loading escalations" rows={1} /> : rows.length === 0 ? <p className="muted">No flagged conversation is waiting. Use <strong>Flag</strong> in a conversation to escalate something unresolved.</p> : (
        <ul className="cc-list">{rows.map((r) => <li key={r.id} data-testid="cc-esc-row"><button type="button" className="link-button" onClick={() => open(`/collab/messages?c=${r.conversationId}`)}>{r.conversation}</button> · <StatusBadge status={r.status === 'ESCALATED' ? 'REJECTED' : 'IN_REVIEW'} label={r.status === 'ESCALATED' ? 'Escalated' : 'Waiting'} /> · {r.reason} <span className="muted small">({r.kind}; {r.status === 'OPEN' ? `goes to managers ${formatDateTime(r.escalateAt)}` : `to ${r.escalatedTo.map((u) => u.name).join(', ') || 'nobody'}`})</span> <button type="button" className="btn btn-small" onClick={() => resolve(r)}>Resolve</button></li>)}</ul>
      )}
    </section>
  );
}

export default function CommunicationCenterPage({ session }) {
  usePageTitle('Communication Center');
  const q = useCenter(session);
  const refresh = useRefreshComm();
  const [error, setError] = useState(null);
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (q.isPending) return <Skeleton label="Loading the Communication Center" rows={4} />;
  const { tiles: t, pending, exceptions, can } = q.data;
  const ack = async (r) => { setError(null); try { await comm.ack(r.id); refresh(); } catch (e) { setError(errorInfo(e)); } };
  return (
    <section aria-labelledby="cc-title" data-testid="comm-center">
      <PageHeader id="cc-title" title={"Communication Center"} actions={<><div className="actions">
          <button type="button" className="btn" onClick={() => open('/collab/messages')} data-testid="cc-messages">Open Messages</button>
          {can.announce && <button type="button" className="btn btn-primary" onClick={() => open('/collab/announcements/new')} data-testid="cc-new-announcement">New announcement</button>}
          {can.instruct && <button type="button" className="btn" onClick={() => open('/collab/instructions')} data-testid="cc-register">Instruction register</button>}
          {can.autogroups && <button type="button" className="btn" onClick={() => open('/admin/auto-groups')}>Auto groups</button>}
        </div></>} />
      <div className="cc-tiles" role="group" aria-label="Views">
        <Tile testid="tile-chats" label="My chats" value={t.myChats.total} sub={`${t.myChats.unread} unread`} to="/collab/messages" />
        <Tile testid="tile-teams" label="Teams" value={t.teams.total} sub={`${t.teams.unread} unread`} to="/collab/messages?view=TEAM" />
        <Tile testid="tile-projects" label="Projects" value={t.projects.total} sub={`${t.projects.unread} unread`} to="/collab/messages?view=PROJECT" />
        <Tile testid="tile-sites" label="Sites" value={t.sites.total} sub={`${t.sites.unread} unread`} to="/collab/messages?view=SITE" />
        <Tile testid="tile-departments" label="Departments" value={t.departments.total} sub={`${t.departments.unread} unread`} to="/collab/messages?view=DEPARTMENT" />
        <Tile testid="tile-linked" label="ERP-linked conversations" value={t.linked.total} sub={`${t.linked.unread} unread`} to="/collab/messages?view=RECORD" />
        <Tile testid="tile-unread" label="Unread" value={t.unread.total} sub={`${t.unread.messages} messages`} to="/collab/messages?view=unread" tone={t.unread.total ? 'info' : undefined} />
        <Tile testid="tile-acks" label="Pending acknowledgements" value={t.pendingAcknowledgements.pending} sub={`${t.pendingAcknowledgements.overdue} overdue`} to="/collab/acknowledgements" tone={t.pendingAcknowledgements.overdue ? 'danger' : t.pendingAcknowledgements.pending ? 'warning' : undefined} />
        <Tile testid="tile-important" label="Important instructions" value={t.importantInstructions.open} sub={can.instruct ? `${t.importantInstructions.sentOpen} sent open, ${t.importantInstructions.sentOverdue} overdue` : 'high or urgent, for me'} to={can.instruct ? '/collab/instructions' : '/collab/messages?view=important'} tone={t.importantInstructions.sentOverdue ? 'danger' : undefined} />
        <Tile testid="tile-announcements" label="Announcements" value={t.announcements.unread} sub="unread" to="/collab/announcements" tone={t.announcements.unread ? 'info' : undefined} />
        <Tile testid="tile-escalations" label="Escalations" value={t.escalations.raised + t.escalations.received} sub={`${t.escalations.received} sent to me`} to="/collab/messages?view=escalated" tone={t.escalations.received ? 'danger' : undefined} />
      </div>
      <div className="cc-grid">
        <section aria-labelledby="cc-pend" data-testid="cc-pending"><h2 id="cc-pend">My pending actions</h2>
          {error?.form && <p className="field-error" role="alert">{error.form}</p>}
          {pending.length === 0 ? <EmptyState compact title="Nothing to acknowledge" message="Instructions sent to you that need your acknowledgement appear here." /> : (
            <ul className="cc-list">{pending.map((r) => <li key={r.id} data-testid="cc-pending-row"><StatusBadge status={PRIORITY[r.priority][0]} label={PRIORITY[r.priority][1]} /> <strong>{r.title}</strong> <span className="muted small">from {r.sender.name}{r.dueAt ? `, due ${formatDateTime(r.dueAt)}` : ''}{r.overdue ? ' · overdue' : ''}</span> <button type="button" className="btn btn-small" onClick={() => ack(r)} data-testid="cc-ack">Acknowledge</button></li>)}</ul>
          )}
          <p><button type="button" className="link-button" onClick={() => open('/collab/acknowledgements')}>All pending acknowledgements</button></p>
        </section>
        <section aria-labelledby="cc-exc" data-testid="cc-exceptions"><h2 id="cc-exc">Exceptions</h2>
          {exceptions.length === 0 ? <EmptyState compact title="No exceptions" message="Overdue acknowledgements and conversations escalated to you appear here." /> : <ul className="cc-list">{exceptions.map((e) => <li key={`${e.kind}:${e.id}`}><StatusBadge status="REJECTED" label={e.kind === 'ESCALATION' ? 'Escalated' : 'Overdue'} /> <button type="button" className="link-button" onClick={() => open(e.link)}>{e.text}</button></li>)}</ul>}
        </section>
      </div>
      <Escalations />
    </section>
  );
}
