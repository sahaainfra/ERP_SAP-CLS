import { registerModule } from '../../platform/shell/registry.js';
import { lazyPage } from '../../platform/shell/lazyPage.js';

// Each page is fetched when it is first opened (part 166.4); the routes themselves stay in the first download.
const ContractsPage = lazyPage(() => import('./ContractsPage.jsx'));
const EscalationsPage = lazyPage(() => import('./PvcPages.jsx'), 'EscalationsPage');
const LdExposurePage = lazyPage(() => import('./PvcPages.jsx'), 'LdExposurePage');
const PvcPage = lazyPage(() => import('./PvcPages.jsx'), 'PvcPage');
const ClaimWatchlistPage = lazyPage(() => import('./ClaimPages.jsx'), 'ClaimWatchlistPage');
const ClaimsPage = lazyPage(() => import('./ClaimPages.jsx'), 'ClaimsPage');
const DisputesPage = lazyPage(() => import('./ClaimPages.jsx'), 'DisputesPage');
const VariationSummaryPage = lazyPage(() => import('./VariationPages.jsx'), 'VariationSummaryPage');
const VariationsPage = lazyPage(() => import('./VariationPages.jsx'), 'VariationsPage');
const SubCompliancePage = lazyPage(() => import('./SubcontractorPages.jsx'), 'SubCompliancePage');
const SubStrengthPage = lazyPage(() => import('./SubcontractorPages.jsx'), 'SubStrengthPage');
const SubcontractorsPage = lazyPage(() => import('./SubcontractorPages.jsx'), 'SubcontractorsPage');
const WoMarginPage = lazyPage(() => import('./WorkOrderPages.jsx'), 'WoMarginPage');
const WorkOrdersPage = lazyPage(() => import('./WorkOrderPages.jsx'), 'WorkOrdersPage');
const BankGuaranteesPage = lazyPage(() => import('./SecurityPages.jsx'), 'BankGuaranteesPage');
const InsurancesPage = lazyPage(() => import('./SecurityPages.jsx'), 'InsurancesPage');
const SecuritiesPage = lazyPage(() => import('./SecurityPages.jsx'), 'SecuritiesPage');
const AmendmentsPage = lazyPage(() => import('./OtherPages.jsx'), 'AmendmentsPage');
const ObligationsPage = lazyPage(() => import('./OtherPages.jsx'), 'ObligationsPage');

registerModule({
  code: 'ctr',
  label: 'Contracts and Commercial',
  routes: [
    { path: '/ctr/contracts', label: 'Contract Register', icon: 'erp.group.commercial', permission: 'ctr.contract.view', flag: 'ff.ctr.p2101', Page: ContractsPage },
    { path: '/ctr/obligations', label: 'Obligations Calendar', icon: 'erp.group.commercial', permission: 'ctr.obligation.view', flag: 'ff.ctr.p2101', Page: ObligationsPage },
    { path: '/ctr/amendments', label: 'Contract Amendments', icon: 'erp.group.commercial', permission: 'ctr.amendment.view', flag: 'ff.ctr.p2101', Page: AmendmentsPage },
    { path: '/ctr/bank-guarantees', label: 'Bank Guarantee Register', icon: 'erp.group.commercial', permission: 'ctr.bank_guarantee.view', flag: 'ff.ctr.p2102', Page: BankGuaranteesPage },
    { path: '/ctr/insurances', label: 'Insurance Policies', icon: 'erp.group.commercial', permission: 'ctr.insurance.view', flag: 'ff.ctr.p2102', Page: InsurancesPage },
    { path: '/ctr/securities', label: 'Securities Exposure', icon: 'erp.group.commercial', permission: 'ctr.bank_guarantee.view', flag: 'ff.ctr.p2102', Page: SecuritiesPage },
    { path: '/ctr/work-orders', label: 'Work Orders', icon: 'erp.group.commercial', permission: 'ctr.work_order.view', flag: 'ff.ctr.p2103', Page: WorkOrdersPage },
    { path: '/ctr/wo-margin', label: 'Back-to-Back Margin', icon: 'erp.group.commercial', permission: 'ctr.work_order.view', flag: 'ff.ctr.p2103', Page: WoMarginPage },
    { path: '/ctr/subcontractors', label: 'Subcontractor Workspace', icon: 'erp.group.commercial', permission: 'ctr.sub_workspace.view', flag: 'ff.ctr.p2104', Page: SubcontractorsPage },
    { path: '/ctr/sub-compliance', label: 'Monthly Compliance Verification', icon: 'erp.group.commercial', permission: 'ctr.sub_compliance.view', flag: 'ff.ctr.p2104', Page: SubCompliancePage },
    { path: '/ctr/sub-strength', label: 'Labour Strength vs Committed', icon: 'erp.group.commercial', permission: 'ctr.sub_workspace.view', flag: 'ff.ctr.p2104', Page: SubStrengthPage },
    { path: '/ctr/variations', label: 'Variation Register', icon: 'erp.group.commercial', permission: 'ctr.change.view', flag: 'ff.ctr.p2105', Page: VariationsPage },
    { path: '/ctr/variation-summary', label: 'Variation Summary', icon: 'erp.group.commercial', permission: 'ctr.change.view', flag: 'ff.ctr.p2105', Page: VariationSummaryPage },
    { path: '/ctr/claims', label: 'Claims Register', icon: 'erp.group.commercial', permission: 'ctr.claim.view', flag: 'ff.ctr.p2106', Page: ClaimsPage },
    { path: '/ctr/claim-watchlist', label: 'Time-bar Watchlist', icon: 'erp.group.commercial', permission: 'ctr.claim.view', flag: 'ff.ctr.p2106', Page: ClaimWatchlistPage },
    { path: '/ctr/disputes', label: 'Disputes', icon: 'erp.group.commercial', permission: 'ctr.dispute.view', flag: 'ff.ctr.p2106', Page: DisputesPage },
    { path: '/ctr/pvc', label: 'PVC Formulas and Price Indices', icon: 'erp.group.commercial', permission: 'ctr.pvc.view', flag: 'ff.ctr.p2107', Page: PvcPage },
    { path: '/ctr/escalations', label: 'Escalation Computations', icon: 'erp.group.commercial', permission: 'ctr.escalation.view', flag: 'ff.ctr.p2107', Page: EscalationsPage },
    { path: '/ctr/ld-exposure', label: 'LD Exposure', icon: 'erp.group.commercial', permission: 'ctr.ld.view', flag: 'ff.ctr.p2107', Page: LdExposurePage },
  ],
});
