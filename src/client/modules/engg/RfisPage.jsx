import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// RFI Register (part 11.02, FR-05): every RFI you may see with its ball in court, ageing and impacts; a new one is raised on the Raise RFI page.
export default function RfisPage() {
  const t = useT('engg');
  usePageTitle(t('rfi.registerTitle'));
  const session = useSession(); const perms = session.data?.permissions ?? [];
  const fp = Number(/filter\[projectId\]=(\d+)/.exec(window.location.search)?.[1]) || null;
  return (
    <section aria-labelledby="rfis-h" data-testid="eg-rfis">
      <PageHeader id="rfis-h" srOnly title={t('rfi.registerTitle')} />
      <div className="actions-row no-print">
        {perms.includes('engg.rfi.create') && <button type="button" className="btn btn-primary" onClick={() => navigateTo('/engg/rfi-raise')} data-testid="rfi-new">{t('nav.raise')}</button>}
        <Link to="/engg/rfi-dashboard">{t('rfid.title')}</Link>
      </div>
      <ListReport listCode="engg.rfis" endpoint="/engg/rfis" title={t('rfi.registerTitle')} session={session.data} rowHref={(r) => `/engg/rfi?id=${r.id}`} onOpen={(r) => navigateTo(`/engg/rfi?id=${r.id}`)} cardFields={['rfiNo', 'subject', 'priorityLabel', 'statusLabel']} statusKey="statusLabel"
        empty={{ title: t('rfi.emptyTitle'), text: t('rfi.emptyBody') }} contextFilters={fp ? [{ key: 'projectId', op: 'eq', value: String(fp) }] : []} />
    </section>
  );
}
