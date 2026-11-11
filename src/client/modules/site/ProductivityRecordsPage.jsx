import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';

// Productivity Records (part 14.06): the records behind every figure of the dashboard and the report, one a work line of an approved DPR, with the output per man-day, the variance from the norm, the man-days lost and the
// reason; a drill-down arrives here with its filter in the address.
export default function ProductivityRecordsPage() {
  const t = useT('site'); usePageTitle(t('cnd.prr.records')); const session = useSession();
  return (
    <section aria-labelledby="prec-h" data-testid="site-productivity-records">
      <h1 id="prec-h" className="sr-only">{t('cnd.prr.records')}</h1>
      <div className="actions-row no-print"><Link to="/site/productivity">{t('cnd.prd.title')}</Link> <Link to="/site/productivity-report">{t('cnd.prr.title')}</Link></div>
      <ListReport listCode="site.productivity" endpoint="/site/productivity/rows" title={t('cnd.prr.records')} session={session.data} rowHref={(x) => `/site/dprs?id=${x.dprId}`} onOpen={(x) => navigateTo(`/site/dprs?id=${x.dprId}`)}
        cardFields={['date', 'activity', 'site', 'productivity', 'variance']} empty={{ title: t('cnd.prd.emptyTitle'), text: t('cnd.prd.emptyBody') }} />
    </section>
  );
}
