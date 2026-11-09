import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';

// Commercial Baseline Packs (part 10.02): every pack with its project, tender, contract value and sign-off status.
export default function BaselinePacksPage() {
  const t = useT('proj');
  usePageTitle(t('bl.listTitle'));
  const session = useSession();
  const can = (session.data?.permissions ?? []).includes('proj.project.create');
  return (
    <section aria-labelledby="bl-list-h" data-testid="baseline-packs">
      <h1 id="bl-list-h" className="sr-only">{t('bl.listTitle')}</h1>
      <ListReport listCode="proj.baseline_packs" endpoint="/proj/baseline-packs" title={t('bl.listTitle')} session={session.data} rowHref={(r) => `/proj/baseline-pack?id=${r.id}`} onOpen={(r) => navigateTo(`/proj/baseline-pack?id=${r.id}`)} cardFields={['docNo', 'project', 'statusLabel', 'contractValue']}
        newAction={can ? { label: t('bl.fromAward'), onClick: () => navigateTo('/proj/from-award') } : undefined} empty={{ title: t('bl.emptyTitle'), text: t('bl.emptyText') }} />
    </section>
  );
}
