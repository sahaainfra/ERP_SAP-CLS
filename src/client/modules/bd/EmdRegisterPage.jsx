import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { aw, inrShort } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// EMD & Fee Register (business development, part 08.03, FR-02, BR-02): every EMD and tender fee with its mode, amount, instrument validity, the approval of the request and the refund, with the days since the result; above the list the refunds due by age.
export default function EmdRegisterPage() {
  const t = useT('bd');
  usePageTitle(t('emd.register'));
  const session = useSession();
  const q = useQuery({ queryKey: ['bd', 'emd-ageing'], queryFn: aw.ageing, retry: false });
  return (
    <section aria-labelledby="emdr-title" data-testid="emd-register">
      <PageHeader id="emdr-title" title={t('emd.register')} />
      {q.data && (
        <dl className="op-figures" data-testid="emd-ageing">
          <div><dt>{t('emd.held')}</dt><dd>{q.data.held.count} · {inrShort(q.data.held.amount)}</dd></div>
          <div><dt>{t('emd.due')}</dt><dd data-testid="emd-due">{q.data.due.count} · {inrShort(q.data.due.amount)}</dd></div>
          {q.data.buckets.map((b) => <div key={b.bucket}><dt>{t('emd.bucket', { b: b.bucket })}</dt><dd data-testid={`emd-bucket-${b.bucket}`} className={b.bucket === '90+' && b.count ? 'field-error' : ''}>{b.count} · {inrShort(b.amount)}</dd></div>)}
        </dl>)}
      <ListReport listCode="bd.emd" endpoint="/bd/emd" title={t('emd.register')} session={session.data} rowHref={(r) => `/bd/emd/record?id=${r.id}`} onOpen={(r) => navigateTo(`/bd/emd/record?id=${r.id}`)} cardFields={['docNo', 'nameOfWork', 'amount', 'refund']} statusKey="refund" empty={{ title: t('emd.emptyTitle'), text: t('emd.emptyText') }} />
      <p className="small"><Link to="/bd/tenders">{t('tenders.title')}</Link></p>
    </section>
  );
}
