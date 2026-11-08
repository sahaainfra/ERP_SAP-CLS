import { registerModule } from '../../platform/shell/registry.js';
import BudgetPage from './BudgetPage.jsx';
import BudgetsPage from './BudgetsPage.jsx';
import GeneratePage from './GeneratePage.jsx';

registerModule({
  code: 'bud',
  label: 'Project Budget',
  routes: [
    { path: '/bud/budgets', label: 'Budget Versions', icon: 'erp.group.projects', permission: 'bud.budget.view', flag: 'ff.bud.p1201', Page: BudgetsPage },
    { path: '/bud/budget', label: 'Budget Workbench', menu: false, icon: 'erp.group.projects', permission: 'bud.budget.view', flag: 'ff.bud.p1201', Page: BudgetPage },
    { path: '/bud/generate', label: 'Generate Budget from Baseline', icon: 'erp.action.create', permission: 'bud.budget.create', flag: 'ff.bud.p1201', Page: GeneratePage },
  ],
});
