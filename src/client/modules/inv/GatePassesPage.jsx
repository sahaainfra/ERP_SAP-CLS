import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Returnable Gate Passes (part 16.02, FR-06): tools and equipment that left the site and are due back, with the overdue filter. The same alert is sent every morning for each pass past its date.
export default function GatePassesPage() {
  const t = useT('inv'); usePageTitle(t('g.returnables')); const session = useSession(); const sp = useSearch(); const overdue = sp.get('overdue') === '1';
  return (
    <section aria-labelledby="gp-h" data-testid="gate-passes"><PageHeader id="gp-h" title={t('g.returnables')} subtitle={t('g.returnablesIntro')} />
      <div className="actions-row no-print"><Link to={overdue ? '/inv/gate-passes' : '/inv/gate-passes?overdue=1'} data-testid="gp-overdue-toggle">{overdue ? t('g.showAll') : t('g.showOverdue')}</Link> <Link to="/inv/gate-register">{t('g.registerTitle')}</Link></div>
      <ListReport key={overdue ? 'o' : 'a'} listCode="inv.gate_passes" endpoint="/inv/passes" title={t('g.returnables')} session={session.data} rowHref={(r) => `/inv/gate-pass?id=${r.id}`} onOpen={(r) => navigateTo(`/inv/gate-pass?id=${r.id}`)} cardFields={['docNo', 'destination', 'expectedReturn', 'status']} statusKey="status" dateKey="date"
        contextFilters={[{ key: 'returnable', op: 'eq', value: 'Y' }, ...(overdue ? [{ key: 'overdue', op: 'eq', value: 'Y' }] : [])]} empty={{ title: t('g.passEmptyTitle'), text: t('g.passEmptyBody') }} /></section>
  );
}
