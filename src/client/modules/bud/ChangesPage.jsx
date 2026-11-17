import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Budget Change Requests (part 12.02): revisions, transfers, contingency drawdowns and the drafts from approved variations, with their effect on the budget and their status.
export default function ChangesPage() {
  const t = useT('bud');
  usePageTitle(t('chg.listTitle'));
  const session = useSession(); const perms = session.data?.permissions ?? [];
  const fp = Number(/filter\[projectId\]=(\d+)/.exec(window.location.search)?.[1]) || null;
  return (
    <section aria-labelledby="bc-list-h" data-testid="bc-changes">
      <PageHeader id="bc-list-h" srOnly title={t('chg.listTitle')} />
      <div className="actions-row no-print">
        {perms.includes('bud.change.create') && <button type="button" className="btn btn-primary" onClick={() => navigateTo('/bud/change')} data-testid="bc-new">{t('chg.new')}</button>}
        {perms.includes('bud.budget.view') && <button type="button" className="btn" onClick={() => navigateTo('/bud/compare')} data-testid="bc-compare">{t('cmp.title')}</button>}
      </div>
      <ListReport listCode="bud.changes" endpoint="/bud/changes" title={t('chg.listTitle')} session={session.data} rowHref={(r) => `/bud/change?id=${r.id}`} onOpen={(r) => navigateTo(`/bud/change?id=${r.id}`)}
        cardFields={[{ key: 'project', label: t('f.project') }, { key: 'changeType', label: t('chg.type') }, { key: 'status', label: t('f.status') }, { key: 'totalDelta', label: t('chg.totalDelta') }]} statusKey="status"
        empty={{ title: t('chg.emptyTitle'), text: t('chg.emptyBody') }} contextFilters={fp ? [{ key: 'projectId', op: 'eq', value: String(fp) }] : []} />
    </section>
  );
}
