import { registerModule } from '../../platform/shell/registry.js';
import { lazyPage } from '../../platform/shell/lazyPage.js';

// Each page is fetched when it is first opened (part 166.4); the routes themselves stay in the first download.
const AccountPage = lazyPage(() => import('./AccountPage.jsx'));
const CategoryMappingPage = lazyPage(() => import('./CategoryMappingPage.jsx'));
const ChartOfAccountsPage = lazyPage(() => import('./ChartOfAccountsPage.jsx'));
const CostCodesPage = lazyPage(() => import('./CostCodesPage.jsx'));
const JournalsPage = lazyPage(() => import('./JournalsPage.jsx'));
const JournalEntryPage = lazyPage(() => import('./JournalEntryPage.jsx'));
const LedgerPage = lazyPage(() => import('./LedgerPages.jsx'), 'LedgerPage');
const TrialBalancePage = lazyPage(() => import('./LedgerPages.jsx'), 'TrialBalancePage');
const RecurringJournalsPage = lazyPage(() => import('./RecurringJournalsPage.jsx'));
const PostingRulesPage = lazyPage(() => import('./PostingPages.jsx'), 'PostingRulesPage');
const FailedPostingsPage = lazyPage(() => import('./PostingPages.jsx'), 'FailedPostingsPage');
const ReplayPage = lazyPage(() => import('./PostingPages.jsx'), 'ReplayPage');
const ReconciliationPage = lazyPage(() => import('./PostingPages.jsx'), 'ReconciliationPage');

// Module "fin" (part 06.05): the finance masters. The chart of accounts (tree, Schedule III, import from Tally, changes), the account object page (properties, dimension rules, mapping), the cost heads and cost
// codes, and the item category mapping. Every change is approved by the CFO before it applies.
registerModule({
  code: 'fin',
  label: 'Finance masters',
  routes: [
    { path: '/finance/chart-of-accounts', label: 'Chart of Accounts', icon: 'erp.action.history', permission: 'fin.coa.view', flag: 'ff.mdm.p0605', Page: ChartOfAccountsPage },
    { path: '/finance/accounts/account', label: 'Account', icon: 'erp.action.info', permission: 'fin.coa.view', flag: 'ff.mdm.p0605', Page: AccountPage },
    { path: '/finance/cost-codes', label: 'Cost Heads & Cost Codes', icon: 'erp.action.history', permission: 'fin.coa.view', flag: 'ff.mdm.p0605', Page: CostCodesPage },
    // part 23.01: the general ledger
    { path: '/finance/journals', label: 'Journals', labelHi: 'जर्नल', icon: 'erp.action.history', permission: 'fin.journal.view', flag: 'ff.fin.p2301', Page: JournalsPage },
    { path: '/finance/journal-entry', label: 'Manual Journal', labelHi: 'मैनुअल जर्नल', icon: 'erp.action.create', permission: 'fin.journal.create', flag: 'ff.fin.p2301', Page: JournalEntryPage },
    { path: '/finance/ledger', label: 'Account Ledger', labelHi: 'खाता बही', icon: 'erp.action.history', permission: 'fin.ledger.view', flag: 'ff.fin.p2301', Page: LedgerPage },
    { path: '/finance/trial-balance', label: 'Trial Balance', labelHi: 'तलपट', icon: 'erp.action.history', permission: 'fin.ledger.view', flag: 'ff.fin.p2301', Page: TrialBalancePage },
    { path: '/finance/recurring-journals', label: 'Recurring Journals', labelHi: 'आवर्ती जर्नल', icon: 'erp.action.history', permission: 'fin.journal.view', flag: 'ff.fin.p2301', Page: RecurringJournalsPage },
    // part 23.02: the posting engine
    { path: '/finance/posting-rules', label: 'Posting Rules', labelHi: 'पोस्टिंग नियम', icon: 'erp.action.settings', permission: 'fin.posting_rule.view', flag: 'ff.fin.p2302', Page: PostingRulesPage },
    { path: '/finance/failed-postings', label: 'Failed Postings', labelHi: 'विफल पोस्टिंग', icon: 'erp.action.settings', permission: 'fin.posting.view', flag: 'ff.fin.p2302', Page: FailedPostingsPage },
    { path: '/finance/posting-replay', label: 'Replay Events', labelHi: 'इवेंट पुनः चलाएँ', icon: 'erp.action.settings', permission: 'fin.replay.view', flag: 'ff.fin.p2302', Page: ReplayPage },
    { path: '/finance/reconciliation', label: 'Sub-ledger vs GL', labelHi: 'उप-खाता बनाम जीएल', icon: 'erp.action.settings', permission: 'fin.posting.view', flag: 'ff.fin.p2302', Page: ReconciliationPage },
    { path: '/finance/category-mapping', label: 'Item Category → GL / Cost Code Mapping', icon: 'erp.action.settings', permission: 'fin.coa.view', flag: 'ff.mdm.p0605', Page: CategoryMappingPage },
  ],
});
