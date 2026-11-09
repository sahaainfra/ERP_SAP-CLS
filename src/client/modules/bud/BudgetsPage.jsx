import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';

// Budget Versions (part 12.01): every budget of the projects the person may see, original and revised, with its status, totals and the margin warning.
export default function BudgetsPage() {
  const t = useT('bud');
  usePageTitle(t('list.title'));
  const session = useSession(); const perms = session.data?.permissions ?? [];
  const fp = Number(/filter\[projectId\]=(\d+)/.exec(window.location.search)?.[1]) || null;
  return (
    <section aria-labelledby="bd-list-h" data-testid="bd-budgets">
      <h1 id="bd-list-h" className="sr-only">{t('list.title')}</h1>
      <div className="actions-row no-print">
        {perms.includes('bud.budget.create') && <button type="button" className="btn btn-primary" onClick={() => navigateTo('/bud/generate')} data-testid="bd-new">{t('list.generate')}</button>}
      </div>
      <ListReport listCode="bud.budgets" endpoint="/bud/budgets" title={t('list.title')} session={session.data} rowHref={(r) => `/bud/budget?id=${r.id}`} onOpen={(r) => navigateTo(`/bud/budget?id=${r.id}`)}
        cardFields={[{ key: 'project', label: t('f.project') }, { key: 'versionNo', label: t('f.version') }, { key: 'status', label: t('f.status') }, { key: 'total', label: t('f.total') }]} statusKey="status"
        empty={{ title: t('list.emptyTitle'), text: t('list.emptyBody') }} contextFilters={fp ? [{ key: 'projectId', op: 'eq', value: String(fp) }] : []} />
    </section>
  );
}
