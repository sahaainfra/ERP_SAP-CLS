import { useMemo, useState } from 'react';
import Icon from '../../platform/design/Icon.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDate } from '../../platform/format.js';
import { authHeaders, tasksUrl, useTaskCounts, useTasks } from '../../platform/tasks/api.js';
import { Link, can, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { BOARD, PRIORITY, STATUS, VIEWS, taskLink } from './tasks-common.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// My Tasks (part 04.08, section 7.1): the tasks given to you, the ones you watch or gave, and your team's, as a list, a board by status or a calendar by due date. A task opens as an Object Page;
// a new one starts from the button. The figures at the top are yours: open, overdue, due today, waiting for your acceptance, waiting for you to verify.
const LAYOUTS = [['list', 'List'], ['board', 'Board'], ['calendar', 'Calendar']];
const EMPTY = { status: 'open', priority: '', q: '', overdue: false };
const PAGE = 25;
const pad = (n) => String(n).padStart(2, '0');

function Row({ t }) {
  return (
    <tr data-testid={`task-row-${t.id}`}>
      <th scope="row" data-label="Task"><Link to={taskLink(t.id)}>{t.taskNo}</Link><br /><span className="muted small">{t.title}</span></th>
      <td data-label="Status"><StatusBadge status={STATUS[t.status][0]} label={STATUS[t.status][1]} /></td>
      <td data-label="Priority"><StatusBadge status={PRIORITY[t.priority][0]} label={PRIORITY[t.priority][1]} /></td>
      <td data-label="Due">{t.dueDate ? formatDate(t.dueDate) : '—'}{t.overdue ? <><br /><span className="error small">{t.daysLate} day(s) late{t.escalationLevel ? `, escalated (level ${t.escalationLevel})` : ''}</span></> : null}</td>
      <td data-label="Given to">{t.assignees.map((a) => a.user).join(', ') || '—'}</td>
      <td data-label="Record">{t.entityLabel ?? ''}</td>
      <td data-label="Checklist">{t.checklist.total ? `${t.checklist.done} of ${t.checklist.total}` : ''}</td>
    </tr>
  );
}

function Board({ rows }) {
  return (
    <div className="tsk-board" role="group" aria-label="Tasks by status" data-testid="task-board">
      {BOARD.map(([status, label]) => {
        const col = rows.filter((t) => (status === 'DONE' ? ['DONE', 'VERIFIED'].includes(t.status) : t.status === status));
        return (
          <section key={status} className="card tsk-col" aria-label={`${label}, ${col.length} task(s)`} data-testid={`board-${status}`}>
            <h3>{label} <span className="muted small">{col.length}</span></h3>
            {col.length === 0 && <p className="muted small">Nothing here.</p>}
            <ul>{col.map((t) => (
              <li key={t.id} className="tsk-card">
                <Link to={taskLink(t.id)}>{t.taskNo} {t.title}</Link>
                <span className="muted small">{t.dueDate ? ` due ${formatDate(t.dueDate)}` : ''}{t.overdue ? ' (late)' : ''}</span>
                <StatusBadge status={PRIORITY[t.priority][0]} label={PRIORITY[t.priority][1]} />
              </li>))}</ul>
          </section>
        );
      })}
    </div>
  );
}

function Calendar({ month, setMonth, rows }) {
  const [y, m] = month;
  const first = new Date(Date.UTC(y, m, 1));
  const lead = (first.getUTCDay() + 6) % 7; // weeks start on Monday
  const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const key = (d) => `${y}-${pad(m + 1)}-${pad(d)}`;
  const move = (n) => { const d = new Date(Date.UTC(y, m + n, 1)); setMonth([d.getUTCFullYear(), d.getUTCMonth()]); };
  const name = first.toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return (
    <div data-testid="task-calendar">
      <div className="srch-tools"><button type="button" className="btn" onClick={() => move(-1)}>Previous month</button><strong aria-live="polite" data-testid="cal-month">{name}</strong><button type="button" className="btn" onClick={() => move(1)}>Next month</button></div>
      <div className="tsk-cal" role="grid" aria-label={name}>
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} role="columnheader" className="muted small">{d}</div>)}
        {cells.map((d, i) => (
          <div key={i} role="gridcell" className={`tsk-day${d ? '' : ' tsk-day-empty'}`} aria-label={d ? `${d} ${name}` : undefined}>
            {d && <><span className="muted small">{d}</span>
              <ul>{rows.filter((t) => t.dueDate === key(d)).map((t) => <li key={t.id}><Link to={taskLink(t.id)}>{t.title}</Link></li>)}</ul></>}
          </div>))}
      </div>
    </div>
  );
}

export default function MyTasksPage({ session }) {
  usePageTitle('My Tasks');
  const [view, setView] = useState('assigned');
  const [layout, setLayout] = useState('list');
  const [filters, setFilters] = useState(EMPTY);
  const [page, setPage] = useState(1);
  const now = new Date();
  const [month, setMonth] = useState([now.getUTCFullYear(), now.getUTCMonth()]);
  const [notice, setNotice] = useState('');
  const team = can(session, 'tsk.team.view');
  const calendar = layout === 'calendar';
  const range = calendar ? { from: `${month[0]}-${pad(month[1] + 1)}-01`, to: `${month[0]}-${pad(month[1] + 1)}-${pad(new Date(Date.UTC(month[0], month[1] + 1, 0)).getUTCDate())}` } : {};
  const query = useMemo(() => ({ view, ...filters, ...range, sort: calendar ? 'due' : 'due', limit: layout === 'list' ? PAGE : 200, offset: layout === 'list' ? (page - 1) * PAGE : 0 }), [view, filters, layout, page, month]);
  const list = useTasks(query);
  const counts = useTaskCounts();
  const download = async (format) => {
    const res = await fetch(tasksUrl(format, { view, status: filters.status }), { headers: { ...authHeaders(), 'x-correlation-id': globalThis.crypto.randomUUID() } });
    if (!res.ok) { setNotice('The export could not be prepared.'); return; }
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement('a'), { href: url, download: `tasks.${format}` }).click();
    URL.revokeObjectURL(url);
    setNotice('');
  };
  if (list.error?.status === 403) return <NoPermission what="those tasks" permission="tsk.team.view" />;
  const d = list.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / PAGE)) : 1;
  const set = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };
  const c = counts.data;
  return (
    <section aria-labelledby="mt-title" data-testid="my-tasks">
      <PageHeader id="mt-title" title={"My Tasks"} subtitle={"What you must do, what you watch and what you gave to others. Open a task to work on it."} />
      {notice && <p role="status" className="notice">{notice}</p>}
      {c && <ul className="srch-meta" aria-label="Your tasks" data-testid="task-counts">
        <li><strong data-testid="count-open">{c.open}</strong> open</li><li><strong data-testid="count-overdue">{c.overdue}</strong> overdue</li><li><strong>{c.dueToday}</strong> due today</li>
        {c.toAccept > 0 && <li><strong>{c.toAccept}</strong> to accept</li>}{c.toVerify > 0 && <li><strong>{c.toVerify}</strong> to verify</li>}</ul>}
      <div className="srch-tools">
        <div role="tablist" aria-label="Whose tasks">{VIEWS.filter(([k]) => k !== 'team' || team).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={view === k} className={`btn${view === k ? ' btn-primary' : ''}`} onClick={() => { setView(k); setPage(1); }}>{l}</button>)}</div>
        <div role="group" aria-label="Layout">{LAYOUTS.map(([k, l]) => <button key={k} type="button" aria-pressed={layout === k} className={`btn${layout === k ? ' btn-primary' : ''}`} onClick={() => { setLayout(k); setPage(1); }}>{l}</button>)}</div>
        <button type="button" className="btn btn-primary" onClick={() => navigateTo('/tasks/new')}><Icon name="erp.action.create" size={16} /> New task</button>
      </div>
      <form className="srch-form" role="search" aria-label="Filters" onSubmit={(e) => e.preventDefault()}>
        <label className="field"><span>Status</span><select value={filters.status} onChange={(e) => set({ status: e.target.value })}><option value="">Any status</option><option value="open">Not finished</option><option value="finished">Finished</option>{Object.entries(STATUS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="field"><span>Priority</span><select value={filters.priority} onChange={(e) => set({ priority: e.target.value })}><option value="">Any</option>{Object.entries(PRIORITY).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="field"><span>Words</span><input type="search" value={filters.q} onChange={(e) => set({ q: e.target.value })} /></label>
        <label className="field"><span><input type="checkbox" checked={filters.overdue} onChange={(e) => set({ overdue: e.target.checked })} /> Overdue only</span></label>
        {JSON.stringify(filters) !== JSON.stringify(EMPTY) && <button type="button" className="btn" onClick={() => set(EMPTY)}>Clear filters</button>}
      </form>
      <div className="srch-tools">
        <button type="button" className="btn" onClick={() => download('xlsx')}><Icon name="erp.action.export" size={16} /> Export XLSX</button>
        <button type="button" className="btn" onClick={() => download('csv')}>Export CSV</button>
        <button type="button" className="btn" onClick={() => download('pdf')}>Export PDF</button>
      </div>
      {list.isPending && <Skeleton label="Loading the tasks" rows={4} />}
      {list.isError && list.error?.status !== 403 && <ErrorState title="The tasks could not be loaded" error={list.error} onRetry={() => list.refetch()} />}
      {d && d.rows.length === 0 && layout !== 'calendar' && <EmptyState title="No task matches" message="Tasks given to you appear here. Change the filters, or make a task for yourself." action={{ label: 'New task', onClick: () => navigateTo('/tasks/new') }} />}
      {d && layout === 'list' && d.rows.length > 0 && (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Tasks">
          <table className="grid">
            <thead><tr><th>Task</th><th>Status</th><th>Priority</th><th>Due</th><th>Given to</th><th>Record</th><th>Checklist</th></tr></thead>
            <tbody>{d.rows.map((t) => <Row key={t.id} t={t} />)}</tbody>
          </table>
        </div>
      )}
      {d && layout === 'board' && d.rows.length > 0 && <Board rows={d.rows} />}
      {d && calendar && <Calendar month={month} setMonth={setMonth} rows={d.rows} />}
      {layout === 'list' && <div className="pager"><span>{d?.total ?? 0} task(s), page {page} of {pages}</span>
        <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button type="button" className="btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>}
    </section>
  );
}
