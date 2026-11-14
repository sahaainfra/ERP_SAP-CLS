import { registerModule } from '../../platform/shell/registry.js';
import ContractsPage from './ContractsPage.jsx';
import { VariationSummaryPage, VariationsPage } from './VariationPages.jsx';
import { SubCompliancePage, SubStrengthPage, SubcontractorsPage } from './SubcontractorPages.jsx';
import { WoMarginPage, WorkOrdersPage } from './WorkOrderPages.jsx';
import { BankGuaranteesPage, InsurancesPage, SecuritiesPage } from './SecurityPages.jsx';
import { AmendmentsPage, ObligationsPage } from './OtherPages.jsx';

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
  ],
});
