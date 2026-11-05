import { registerModule } from '../../platform/shell/registry.js';
import AccountPage from './AccountPage.jsx';
import CategoryMappingPage from './CategoryMappingPage.jsx';
import ChartOfAccountsPage from './ChartOfAccountsPage.jsx';
import CostCodesPage from './CostCodesPage.jsx';

// Module "fin" (part 06.05): the finance masters. The chart of accounts (tree, Schedule III, import from Tally, changes), the account object page (properties, dimension rules, mapping), the cost heads and cost
// codes, and the item category mapping. Every change is approved by the CFO before it applies.
registerModule({
  code: 'fin',
  label: 'Finance masters',
  routes: [
    { path: '/finance/chart-of-accounts', label: 'Chart of Accounts', icon: 'erp.action.history', permission: 'fin.coa.view', flag: 'ff.mdm.p0605', Page: ChartOfAccountsPage },
    { path: '/finance/accounts/account', label: 'Account', icon: 'erp.action.info', permission: 'fin.coa.view', flag: 'ff.mdm.p0605', Page: AccountPage },
    { path: '/finance/cost-codes', label: 'Cost Heads & Cost Codes', icon: 'erp.action.history', permission: 'fin.coa.view', flag: 'ff.mdm.p0605', Page: CostCodesPage },
    { path: '/finance/category-mapping', label: 'Item Category → GL / Cost Code Mapping', icon: 'erp.action.settings', permission: 'fin.coa.view', flag: 'ff.mdm.p0605', Page: CategoryMappingPage },
  ],
});
