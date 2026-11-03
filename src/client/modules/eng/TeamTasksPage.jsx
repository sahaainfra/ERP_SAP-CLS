import { useState } from 'react';
import Chart from '../../platform/charts/Chart.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDate } from '../../platform/format.js';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { useTeamDashboard } from '../../platform/tasks/api.js';
import { Link, Tile, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { taskLink } from './tasks-common.js';

// Team Tasks (part 04.08, section 7.4): the workload of the people in your projects, who is late, and whether the team is closing as many tasks as it opens. Every tile and bar opens the list of the tasks
// behind it.
export default function TeamTasksPage() {
  usePageTitle('Team Tasks');
  const [project, setProject] = useState('');
  const q = useTeamDashboard({ projectId: project });
  if (q.error?.status === 403) return <NoPermission what="the tasks of your team" permission="tsk.team.view" />;
  const d = q.data;
  const trend = d && { categories: d.trend.map((w) => formatDate(w.week)), series: [{ name: 'Made', values: d.trend.map((w) => w.created) }, { name: 'Closed', values: d.trend.map((w) => w.closed) }] };
  const load = d && d.people.length > 0 && { categories: d.people.map((p) => p.name), series: [{ name: 'Open', values: d.people.map((p) => p.open - p.overdue) }, { name: 'Overdue', values: d.people.map((p) => p.overdue) }] };
  return (
    <section aria-labelledby="tt-title" data-testid="team-tasks">
      <h1 id="tt-title">Team Tasks</h1>
      <p className="muted">The tasks of the people in your projects: how much each has, what is late, and whether the team is keeping up.</p>
      <form className="srch-form" role="search" aria-label="Filters" onSubmit={(e) => e.preventDefault()}>
        <LookupField id="tt-project" label="Project" lookup="iam/projects" value={project} onChange={setProject} />
        {project && <button type="button" className="btn" onClick={() => setProject('')}>All my projects</button>}
      </form>
      {q.isPending && <Skeleton label="Loading the team's tasks" rows={4} />}
      {q.isError && q.error?.status !== 403 && <ErrorState title="The figures could not be loaded" error={q.error} onRetry={() => q.refetch()} />}
      {d && <>
        <div className="tiles" data-testid="team-tiles">
          <Tile label="Open" value={d.tiles.open} to="/tasks" testId="tile-open" />
          <Tile label="Overdue" value={d.tiles.overdue} status={d.tiles.overdue ? 'danger' : 'success'} to="/tasks" hint="past their due date" testId="tile-overdue" />
          <Tile label="Blocked" value={d.tiles.blocked} status={d.tiles.blocked ? 'warning' : 'success'} testId="tile-blocked" />
          <Tile label="Escalated" value={d.tiles.escalated} status={d.tiles.escalated ? 'warning' : 'success'} testId="tile-escalated" />
          <Tile label="Waiting to be verified" value={d.tiles.toVerify} testId="tile-verify" />
          <Tile label="Closed in 30 days" value={d.tiles.closed30} status="success" testId="tile-closed" />
        </div>
        {d.people.length === 0 ? <EmptyState title="No open tasks in your team" message="When tasks are given to people in your projects, their workload appears here." action={{ label: 'New task', onClick: () => navigateTo('/tasks/new') }} /> : <>
          <Chart type="stacked" data={load} title="Open tasks by person (overdue shown apart)" exportName="team-workload" />
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Workload by person">
            <table className="grid">
              <thead><tr><th>Person</th><th className="num">Open</th><th className="num">Overdue</th><th className="num">High or urgent</th></tr></thead>
              <tbody>{d.people.map((p) => <tr key={p.user} data-testid={`person-${p.user}`}><th scope="row" data-label="Person">{p.name}<br /><span className="muted small">{p.user}</span></th><td className="num" data-label="Open">{p.open}</td><td className="num" data-label="Overdue">{p.overdue}</td><td className="num" data-label="High or urgent">{p.high}</td></tr>)}</tbody>
            </table>
          </div></>}
        <Chart type="line" data={trend} title="Tasks made and closed each week" exportName="task-trend" />
        <section aria-label="The most overdue" data-testid="overdue-list">
          <h2>The most overdue</h2>
          {d.overdueList.length === 0 ? <p className="muted">Nothing is overdue.</p> : <ul>{d.overdueList.map((t) => <li key={t.id}><Link to={taskLink(t.id)}>{t.taskNo} {t.title}</Link> <span className="muted small">{t.assignees.map((a) => a.user).join(', ')}, {t.daysLate} day(s) late{t.escalationLevel ? `, level ${t.escalationLevel}` : ''}</span></li>)}</ul>}
        </section>
      </>}
    </section>
  );
}
