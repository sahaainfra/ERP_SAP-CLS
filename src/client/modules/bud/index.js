import { registerModule } from '../../platform/shell/registry.js';
import BudgetPage from './BudgetPage.jsx';
import BudgetsPage from './BudgetsPage.jsx';
import GeneratePage from './GeneratePage.jsx';
import ChangePage from './ChangePage.jsx';
import ChangesPage from './ChangesPage.jsx';
import ComparePage from './ComparePage.jsx';

registerModule({
  code: 'bud',
  label: 'Project Budget',
  routes: [
    { path: '/bud/budgets', label: 'Budget Versions', icon: 'erp.group.projects', permission: 'bud.budget.view', flag: 'ff.bud.p1201', Page: BudgetsPage },
    { path: '/bud/budget', label: 'Budget Workbench', menu: false, icon: 'erp.group.projects', permission: 'bud.budget.view', flag: 'ff.bud.p1201', Page: BudgetPage },
    { path: '/bud/generate', label: 'Generate Budget from Baseline', icon: 'erp.action.create', permission: 'bud.budget.create', flag: 'ff.bud.p1201', Page: GeneratePage },
    { path: '/bud/changes', label: 'Budget Change Requests', icon: 'erp.group.projects', permission: 'bud.change.view', flag: 'ff.bud.p1202', Page: ChangesPage },
    { path: '/bud/change', label: 'Budget Change Request', menu: false, icon: 'erp.group.projects', permission: 'bud.change.view', flag: 'ff.bud.p1202', Page: ChangePage },
    { path: '/bud/compare', label: 'Budget Version Comparison', icon: 'erp.group.projects', permission: 'bud.budget.view', flag: 'ff.bud.p1202', Page: ComparePage },
  ],
});
