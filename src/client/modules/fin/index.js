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
const GstReconPage = lazyPage(() => import('./GstReconPages.jsx'), 'GstReconPage');
const GstReturnsPage = lazyPage(() => import('./GstReconPages.jsx'), 'GstReturnsPage');
const AssetRegisterPage = lazyPage(() => import('./AssetPages.jsx'), 'AssetRegisterPage');
const RevenueRecognitionPage = lazyPage(() => import('./ProjectAccountingPages.jsx'), 'RevenueRecognitionPage');
const ProjectAccountsPage = lazyPage(() => import('./ProjectAccountingPages.jsx'), 'ProjectAccountsPage');
const ForecastWorkbenchPage = lazyPage(() => import('./ForecastPages.jsx'), 'ForecastWorkbenchPage');
const ForecastReportsPage = lazyPage(() => import('./ForecastPages.jsx'), 'ForecastReportsPage');
const ProjectPlPage = lazyPage(() => import('./PlPages.jsx'), 'ProjectPlPage');
const ProfitabilityPage = lazyPage(() => import('./PlPages.jsx'), 'ProfitabilityPage');
const TreasuryPage = lazyPage(() => import('./TreasuryPages.jsx'), 'TreasuryPage');
const CashReportsPage = lazyPage(() => import('./TreasuryPages.jsx'), 'CashReportsPage');
const ClosePage = lazyPage(() => import('./ClosePages.jsx'), 'ClosePage');
const StatementsPage = lazyPage(() => import('./ClosePages.jsx'), 'StatementsPage');
const FinanceDashboardPage = lazyPage(() => import('./ClosePages.jsx'), 'FinanceDashboardPage');
const YearEndPage = lazyPage(() => import('./ClosePages.jsx'), 'YearEndPage');
const AssetAccountingPage = lazyPage(() => import('./AssetPages.jsx'), 'AssetAccountingPage');
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
    // part 23.08: GST reconciliation, ITC review, returns and TDS
    { path: '/finance/gst-reconciliation', label: 'GSTR-2B Reconciliation & ITC Review', labelHi: 'जीएसटीआर-2बी मिलान व आईटीसी', icon: 'erp.action.history', permission: 'fin.gst_recon.view', flag: 'ff.fin.p2308', Page: GstReconPage },
    { path: '/finance/gst-returns', label: 'GST & TDS Returns, Compliance Calendar', labelHi: 'जीएसटी व टीडीएस रिटर्न', icon: 'erp.action.history', permission: 'fin.gst_return.view', flag: 'ff.fin.p2308', Page: GstReturnsPage },
    // part 23.09: fixed assets and depreciation
    { path: '/finance/assets', label: 'Asset Register', labelHi: 'परिसंपत्ति रजिस्टर', icon: 'erp.action.history', permission: 'fin.asset.view', flag: 'ff.fin.p2309', Page: AssetRegisterPage },
    { path: '/finance/asset-accounting', label: 'Capitalise, Depreciate & FA Reports', labelHi: 'पूंजीकरण व मूल्यह्रास', icon: 'erp.action.history', permission: 'fin.asset.view', flag: 'ff.fin.p2309', Page: AssetAccountingPage },
    { path: '/finance/revenue-recognition', label: 'Revenue Recognition', labelHi: 'राजस्व मान्यता', icon: 'erp.action.history', permission: 'fin.revenue_recognition.view', flag: 'ff.fin.p2310', Page: RevenueRecognitionPage },
    { path: '/finance/project-accounts', label: 'Project Trial Balance & WIP', labelHi: 'परियोजना तलपट व WIP', icon: 'erp.action.history', permission: 'fin.project_ledger.view', flag: 'ff.fin.p2310', Page: ProjectAccountsPage },
    { path: '/finance/cost-forecasts', label: 'Forecast Workbench', labelHi: 'पूर्वानुमान कार्यक्षेत्र', icon: 'erp.action.history', permission: 'fin.forecast.view', flag: 'ff.fin.p2311', Page: ForecastWorkbenchPage },
    { path: '/finance/forecast-reports', label: 'EAC Trend & Forecast Variance', labelHi: 'EAC प्रवृत्ति व पूर्वानुमान अंतर', icon: 'erp.action.history', permission: 'fin.forecast.view', flag: 'ff.fin.p2311', Page: ForecastReportsPage },
    { path: '/finance/project-pl', label: 'Project P&L', labelHi: 'परियोजना लाभ-हानि', icon: 'erp.action.history', permission: 'fin.pl.view', flag: 'ff.fin.p2312', Page: ProjectPlPage },
    { path: '/finance/profitability', label: 'Profitability Overview', labelHi: 'लाभप्रदता अवलोकन', icon: 'erp.action.history', permission: 'fin.pl.view', flag: 'ff.fin.p2312', Page: ProfitabilityPage },
    { path: '/finance/treasury', label: 'Treasury & Cash Position', labelHi: 'ट्रेज़री और नकद स्थिति', icon: 'erp.action.history', permission: 'fin.cash_forecast.view', flag: 'ff.fin.p2313', Page: TreasuryPage },
    { path: '/finance/cash-reports', label: 'Cash Reports', labelHi: 'नकद रिपोर्ट', icon: 'erp.action.history', permission: 'fin.cash_curve.view', flag: 'ff.fin.p2313', Page: CashReportsPage },
    { path: '/finance/close', label: 'Period Close', labelHi: 'अवधि समापन', icon: 'erp.action.history', permission: 'fin.period.view', flag: 'ff.fin.p2314', Page: ClosePage },
    { path: '/finance/statements', label: 'Financial Statements', labelHi: 'वित्तीय विवरण', icon: 'erp.action.history', permission: 'fin.statements.view', flag: 'ff.fin.p2314', Page: StatementsPage },
    { path: '/finance/dashboard', label: 'Finance Dashboard', labelHi: 'वित्त डैशबोर्ड', icon: 'erp.action.history', permission: 'fin.dashboard.view', flag: 'ff.fin.p2314', Page: FinanceDashboardPage },
    { path: '/finance/year-end', label: 'Year-End Closing', labelHi: 'वर्षांत समापन', icon: 'erp.action.history', permission: 'fin.period.view', flag: 'ff.fin.p2314', Page: YearEndPage },
    { path: '/finance/category-mapping', label: 'Item Category → GL / Cost Code Mapping', icon: 'erp.action.settings', permission: 'fin.coa.view', flag: 'ff.mdm.p0605', Page: CategoryMappingPage },
  ],
});
