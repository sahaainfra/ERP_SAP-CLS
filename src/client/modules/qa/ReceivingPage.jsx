import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, usePageTitle } from '../core/pages/ui.jsx';
import { fmtDate, fmtQty, qa } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Receiving Inspections pending (part 18.03, FR-01): the lines of posted receipts still in the inspection stock, oldest first, with what has been asked for each. A line is opened into a test request.
export default function ReceivingPage() {
  const t = useT('qa'); usePageTitle(t('rcv.title')); const q = useQuery({ queryKey: ['qa', 'receiving'], queryFn: () => qa.get('/receiving'), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('rcv.title')} permission="qa.test_request.view" />; if (q.isPending) return <Skeleton label={t('rcv.title')} rows={5} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const rows = q.data;
  return (
    <section aria-labelledby="rcv-h" data-testid="qa-receiving"><PageHeader id="rcv-h" title={t('rcv.title')} subtitle={t('rcv.intro')} />
      <div className="actions-row no-print"><Link to="/qa/test-requests">{t('tr.title')}</Link><Link to="/qa/test-compliance">{t('tc.title')}</Link></div>
      {rows.length === 0 ? <EmptyState title={t('rcv.emptyTitle')} message={t('rcv.emptyBody')} /> : (
        <div className="table-scroll"><table className="data-table" data-testid="rcv-table"><thead><tr><th>{t('rcv.grn')}</th><th>{t('project')}</th><th>{t('rcv.item')}</th><th>{t('rcv.vendor')}</th><th className="num">{t('rcv.open')}</th><th>{t('rcv.age')}</th><th>{t('rcv.cert')}</th><th>{t('rcv.requests')}</th><th /></tr></thead>
          <tbody>{rows.map((x) => <tr key={x.id} data-testid="rcv-row" data-age={x.ageDays}><td><Link to={`/inv/grns?id=${x.grnId}`}>{x.grnNo}</Link> · {fmtDate(String(x.receivedAt).slice(0, 10))}</td><td>{x.project}</td><td>{x.item}{x.batchNo ? ` · ${x.batchNo}` : ''}</td><td>{x.vendor}</td><td className="num">{fmtQty(x.openQty)} {x.uom}</td><td>{t('rcv.days', { n: x.ageDays })}</td><td>{x.hasCertificate ? t('yes') : t('no')}</td><td>{x.openRequests} / {x.decidedRequests}</td><td><Link to={`/qa/test-requests?new=1&grnLineId=${x.id}`}>{t('rcv.request')}</Link></td></tr>)}</tbody></table></div>)}
    </section>
  );
}
