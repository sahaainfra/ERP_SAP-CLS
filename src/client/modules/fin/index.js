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
const ApBillsPage = lazyPage(() => import('./ApPages.jsx'), 'ApBillsPage');
const DebitNotesPage = lazyPage(() => import('./ApPages.jsx'), 'DebitNotesPage');
const PayablesPage = lazyPage(() => import('./ApPages.jsx'), 'PayablesPage');
const PaymentProposalsPage = lazyPage(() => import('./PaymentPages.jsx'), 'PaymentProposalsPage');
const PaymentsPage = lazyPage(() => import('./PaymentPages.jsx'), 'PaymentsPage');
const BankAccountsPage = lazyPage(() => import('./PaymentPages.jsx'), 'BankAccountsPage');
const ReceivablesPage = lazyPage(() => import('./ArPages.jsx'), 'ReceivablesPage');
const CollectionsPage = lazyPage(() => import('./ArPages.jsx'), 'CollectionsPage');
const BankReconciliationPage = lazyPage(() => import('./CashPages.jsx'), 'BankReconciliationPage');
const ImprestPage = lazyPage(() => import('./CashPages.jsx'), 'ImprestPage');
const CashPositionPage = lazyPage(() => import('./CashPages.jsx'), 'CashPositionPage');
const EinvoiceRegisterPage = lazyPage(() => import('./GstPages.jsx'), 'EinvoiceRegisterPage');
const EwayBillRegisterPage = lazyPage(() => import('./GstPages.jsx'), 'EwayBillRegisterPage');
const GstSettingsPage = lazyPage(() => import('./GstPages.jsx'), 'GstSettingsPage');

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
    // part 23.03: accounts payable
    { path: '/finance/ap-bills', label: 'AP Bills', labelHi: 'देय बिल', icon: 'erp.action.history', permission: 'fin.bill.view', flag: 'ff.fin.p2303', Page: ApBillsPage },
    { path: '/finance/debit-notes', label: 'Debit Notes', labelHi: 'डेबिट नोट', icon: 'erp.action.history', permission: 'fin.debit_note.view', flag: 'ff.fin.p2303', Page: DebitNotesPage },
    { path: '/finance/payables', label: 'Vendor Ledger & Payables Reports', labelHi: 'विक्रेता खाता', icon: 'erp.action.history', permission: 'fin.bill.view', flag: 'ff.fin.p2303', Page: PayablesPage },
    // part 23.04: payments
    { path: '/finance/payment-proposals', label: 'Payment Proposals', labelHi: 'भुगतान प्रस्ताव', icon: 'erp.action.history', permission: 'fin.proposal.view', flag: 'ff.fin.p2304', Page: PaymentProposalsPage },
    { path: '/finance/payments', label: 'Payments & Cheque Register', labelHi: 'भुगतान', icon: 'erp.action.history', permission: 'fin.payment.view', flag: 'ff.fin.p2304', Page: PaymentsPage },
    { path: '/finance/bank-accounts', label: 'Company Bank Accounts', labelHi: 'कंपनी बैंक खाते', icon: 'erp.action.history', permission: 'fin.bank.view', flag: 'ff.fin.p2304', Page: BankAccountsPage },
    // part 23.05: receivables
    { path: '/finance/receivables', label: 'Receivables & Receipts', labelHi: 'प्राप्य', icon: 'erp.action.history', permission: 'fin.invoice.view', flag: 'ff.fin.p2305', Page: ReceivablesPage },
    { path: '/finance/collections', label: 'Collections Follow-up', labelHi: 'वसूली', icon: 'erp.action.history', permission: 'fin.followup.view', flag: 'ff.fin.p2305', Page: CollectionsPage },
    // part 23.06: cash and bank
    { path: '/finance/bank-reconciliation', label: 'Bank Reconciliation', labelHi: 'बैंक मिलान', icon: 'erp.action.history', permission: 'fin.bank_statement.view', flag: 'ff.fin.p2306', Page: BankReconciliationPage },
    { path: '/finance/imprest', label: 'Site Imprest & Petty Cash', labelHi: 'साइट इम्प्रेस्ट', icon: 'erp.action.history', permission: 'fin.imprest_voucher.view', flag: 'ff.fin.p2306', Page: ImprestPage },
    { path: '/finance/cash-position', label: 'Daily Cash & Bank Position', labelHi: 'नकद व बैंक स्थिति', icon: 'erp.action.history', permission: 'fin.cash_position.view', flag: 'ff.fin.p2306', Page: CashPositionPage },
    // part 23.07: the GST service
    { path: '/finance/e-invoices', label: 'e-Invoice & e-Way Bill Register', labelHi: 'ई-इनवॉइस व ई-वे बिल', icon: 'erp.action.history', permission: 'fin.einvoice.view', flag: 'ff.fin.p2307', Page: EinvoiceRegisterPage },
    { path: '/finance/e-way-bills', label: 'e-Way Bills', labelHi: 'ई-वे बिल', icon: 'erp.action.history', permission: 'fin.ewaybill.view', flag: 'ff.fin.p2307', Page: EwayBillRegisterPage },
    { path: '/finance/gst-settings', label: 'GST Settings', labelHi: 'जीएसटी सेटिंग्स', icon: 'erp.action.settings', permission: 'fin.gst_setting.view', flag: 'ff.fin.p2307', Page: GstSettingsPage },
    { path: '/finance/category-mapping', label: 'Item Category → GL / Cost Code Mapping', icon: 'erp.action.settings', permission: 'fin.coa.view', flag: 'ff.mdm.p0605', Page: CategoryMappingPage },
  ],
});
