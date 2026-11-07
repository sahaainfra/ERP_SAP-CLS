import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';

// Project Portfolio (part 10.01, FR-06): every project with its lifecycle state, approval status, contract value, dates, manager and health (the schedule from its key dates now; budget, progress and safety join as those parts arrive).
export default function ProjectsPage() {
  const t = useT('proj');
  usePageTitle(t('list.title'));
  const session = useSession();
  const can = (session.data?.permissions ?? []).includes('proj.project.create');
  return (
    <section aria-labelledby="proj-list-h" data-testid="projects">
      <h1 id="proj-list-h" className="sr-only">{t('list.title')}</h1>
      <ListReport listCode="proj.projects" endpoint="/proj/projects" title={t('list.title')} session={session.data} rowHref={(r) => `/proj/project?id=${r.id}`} onOpen={(r) => navigateTo(`/proj/project?id=${r.id}`)} cardFields={['code', 'name', 'state', 'health']} statusKey="state"
        newAction={can ? { label: t('list.new'), onClick: () => navigateTo('/proj/wizard') } : undefined} empty={{ title: t('list.emptyTitle'), text: t('list.emptyText') }} />
    </section>
  );
}
