import { useEffect, useState } from 'react';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { EventList } from '../../platform/collab/CollabTabs.jsx';
import { useProjectFeed } from '../../platform/collab/api.js';
import { navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Project Activity Feed (part 04.14, section 7.3): what happened across a project's records, newest first: changes, approvals, workflow steps, comments, documents and tasks, with filters. A row opens the record it is
// about, if the person may open it. The person sees only the projects they hold the right for, and only the records they may open.
export default function ProjectActivityPage() {
  usePageTitle('Project Activity Feed');
  const [filters, setFilters] = useState({ projectId: '', kinds: '', from: '', to: '', q: '', limit: 50, offset: 0 });
  const params = { ...filters, kinds: filters.kinds || undefined, projectId: filters.projectId || undefined };
  const q = useProjectFeed(params);
  const projects = q.data?.projects ?? [];
  useEffect(() => { if (!filters.projectId && projects.length === 1) setFilters((f) => ({ ...f, projectId: String(projects[0].id) })); }, [projects, filters.projectId]);
  return (
    <section aria-labelledby="paf-title" data-testid="project-activity">
      <PageHeader id="paf-title" title={"Project Activity Feed"} subtitle={"What happened across the records of a project, newest first. Open an entry to go to the record it is about."} />
      {q.isPending && <Skeleton label="Loading the projects" />}
      {q.isError && (q.error?.status === 403 ? <NoPermission what="the project activity feed" permission="col.activity.view" /> : <ErrorState error={q.error} onRetry={q.refetch} />)}
      {q.data && projects.length === 0 && <EmptyState title="No projects to show" message="You do not hold the right to see the activity of any project. Ask your project manager or administrator." />}
      {q.data && projects.length > 0 && (
        <>
          <label className="field"><span>Project</span>
            <select value={filters.projectId} onChange={(e) => setFilters({ ...filters, projectId: e.target.value, offset: 0, limit: 50 })} data-testid="paf-project">
              <option value="">Choose a project</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}
            </select>
          </label>
          {!filters.projectId ? <EmptyState compact title="Choose a project" message="The feed shows one project at a time." /> : <EventList data={q.data} query={q} filters={filters} setFilters={setFilters} withRecord navigate={navigateTo} />}
        </>
      )}
    </section>
  );
}
