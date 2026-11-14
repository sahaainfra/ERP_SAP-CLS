import { registerModule } from '../../platform/shell/registry.js';
import ContractsPage from './ContractsPage.jsx';
import { AmendmentsPage, ObligationsPage } from './OtherPages.jsx';

registerModule({
  code: 'ctr',
  label: 'Contracts and Commercial',
  routes: [
    { path: '/ctr/contracts', label: 'Contract Register', icon: 'erp.group.commercial', permission: 'ctr.contract.view', flag: 'ff.ctr.p2101', Page: ContractsPage },
    { path: '/ctr/obligations', label: 'Obligations Calendar', icon: 'erp.group.commercial', permission: 'ctr.obligation.view', flag: 'ff.ctr.p2101', Page: ObligationsPage },
    { path: '/ctr/amendments', label: 'Contract Amendments', icon: 'erp.group.commercial', permission: 'ctr.amendment.view', flag: 'ff.ctr.p2101', Page: AmendmentsPage },
  ],
});
