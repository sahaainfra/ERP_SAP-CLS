import { useState } from 'react';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// My Claims & Advances (HR, part 07.12): the list reports of expense claims, advances and travel requests: an employee sees their own, a manager those of the team, accounts and HR all of them; each opens the record; New starts a draft.
const TABS = [['claims', 'hr.claims', '/hr/claims', '/expenses/claim', 'hr.claim.create'], ['advances', 'hr.advances', '/hr/advances', '/expenses/advance', 'hr.advance.create'], ['travel', 'hr.travel_requests', '/hr/travel-requests', '/expenses/travel', 'hr.travel_request.create']];
export default function MyExpensesPage() {
  const t = useT('exp');
  usePageTitle(t('my.title'));
  const session = useSession();
  const perms = session.data?.permissions ?? [];
  const [tab, setTab] = useState('claims');
  const [, code, endpoint, route, create] = TABS.find((x) => x[0] === tab);
  const fields = { claims: ['docNo', 'purpose', 'total', 'status'], advances: ['docNo', 'type', 'amount', 'balance', 'status'], travel: ['docNo', 'to', 'startDate', 'estCost', 'status'] }[tab];
  return (
    <section aria-labelledby="me-title" data-testid="my-expenses">
      <PageHeader id="me-title" srOnly title={t('my.title')} />
      <div className="actions-row" role="tablist" aria-label={t('my.title')}>{TABS.map(([k]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`btn${tab === k ? ' btn-primary' : ''}`} onClick={() => setTab(k)} data-testid={`me-tab-${k}`}>{t(`my.tab.${k}`)}</button>)}</div>
      <ListReport key={tab} listCode={code} endpoint={endpoint} title={t(`my.tab.${tab}`)} session={session.data} rowHref={(r) => `${route}?id=${r.id}`} onOpen={(r) => navigateTo(`${route}?id=${r.id}`)} cardFields={fields} statusKey="status"
        newAction={perms.includes(create) ? { label: t(`my.new.${tab}`), onClick: () => navigateTo(route) } : undefined} empty={{ title: t('my.emptyTitle'), text: t('my.emptyText') }} />
      <p className="small"><Link to="/expenses/approvals">{t('appr.title')}</Link> · <Link to="/expenses/analysis">{t('ana.title')}</Link></p>
    </section>
  );
}
