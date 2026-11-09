import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';

// Department budgets (part 12.04): the budgets of the cost centres of head office for a financial year, with their versions and status; the Workbench opens one.
export default function DeptBudgetsPage() {
  const t = useT('bud');
  usePageTitle(t('dp.listTitle'));
  const session = useSession(); const perms = session.data?.permissions ?? [];
  return (
    <section aria-labelledby="dp-list-h" data-testid="dp-budgets">
      <h1 id="dp-list-h" className="sr-only">{t('dp.listTitle')}</h1>
      <div className="actions-row no-print">
        {perms.includes('bud.dept_budget.create') && <button type="button" className="btn btn-primary" onClick={() => navigateTo('/bud/dept-budget')} data-testid="dp-new">{t('dp.new')}</button>}
        {perms.includes('bud.dept_report.view') && <button type="button" className="btn" onClick={() => navigateTo('/bud/dept-report')} data-testid="dp-to-report">{t('dr.title')}</button>}
        {perms.includes('bud.alloc.view') && <button type="button" className="btn" onClick={() => navigateTo('/bud/alloc')} data-testid="dp-to-alloc">{t('al.title')}</button>}
      </div>
      <ListReport listCode="bud.dept_budgets" endpoint="/bud/dept-budgets" title={t('dp.listTitle')} session={session.data} rowHref={(r) => `/bud/dept-budget?id=${r.id}`} onOpen={(r) => navigateTo(`/bud/dept-budget?id=${r.id}`)}
        cardFields={[{ key: 'costCentre', label: t('dp.costCentre') }, { key: 'fy', label: t('dp.fy') }, { key: 'status', label: t('f.status') }, { key: 'total', label: t('f.total') }]} statusKey="status"
        empty={{ title: t('dp.emptyTitle'), text: t('dp.emptyBody') }} />
    </section>
  );
}
