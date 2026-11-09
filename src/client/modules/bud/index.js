import { registerModule } from '../../platform/shell/registry.js';
import BudgetPage from './BudgetPage.jsx';
import BudgetsPage from './BudgetsPage.jsx';
import GeneratePage from './GeneratePage.jsx';
import ChangePage from './ChangePage.jsx';
import ChangesPage from './ChangesPage.jsx';
import ComparePage from './ComparePage.jsx';
import CheckSettingsPage from './CheckSettingsPage.jsx';
import LedgerPage from './LedgerPage.jsx';
import DeptBudgetsPage from './DeptBudgetsPage.jsx';
import DeptBudgetPage from './DeptBudgetPage.jsx';
import DeptReportPage from './DeptReportPage.jsx';
import AllocPage from './AllocPage.jsx';

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
    { path: '/bud/ledger', label: 'Budget vs Committed vs Actual', icon: 'erp.group.projects', permission: 'bud.ledger.view', flag: 'ff.bud.p1203', Page: LedgerPage },
    { path: '/bud/check-settings', label: 'Budget Check Settings', icon: 'erp.group.projects', permission: 'bud.check.view', flag: 'ff.bud.p1203', Page: CheckSettingsPage },
    { path: '/bud/dept-budgets', label: 'Department Budget Workbench', icon: 'erp.group.projects', permission: 'bud.dept_budget.view', flag: 'ff.bud.p1204', Page: DeptBudgetsPage },
    { path: '/bud/dept-budget', label: 'Department Budget', menu: false, icon: 'erp.group.projects', permission: 'bud.dept_budget.view', flag: 'ff.bud.p1204', Page: DeptBudgetPage },
    { path: '/bud/dept-report', label: 'Department Budget vs Actual', icon: 'erp.group.projects', permission: 'bud.dept_report.view', flag: 'ff.bud.p1204', Page: DeptReportPage },
    { path: '/bud/alloc', label: 'Overhead Allocation Rules', icon: 'erp.group.projects', permission: 'bud.alloc.view', flag: 'ff.bud.p1204', Page: AllocPage },
  ],
});
