import { registerModule } from '../../platform/shell/registry.js';
import ContractsPage from './ContractsPage.jsx';
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
  ],
});
