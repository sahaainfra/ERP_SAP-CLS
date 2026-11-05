import { registerModule } from '../../platform/shell/registry.js';
import Employee360Page from './Employee360Page.jsx';
import EmployeeDirectoryPage from './EmployeeDirectoryPage.jsx';
import HrOverviewPage from './HrOverviewPage.jsx';
import NewEmployeePage from './NewEmployeePage.jsx';

// Module "hr" (part 07.01): the employee master. HR Overview (dashboard), Employee Directory (list), Employee 360 (object, with the signed-in person's own record at ?me=1) and the New Employee wizard (form).
registerModule({
  code: 'hr',
  label: 'HR & Workforce',
  routes: [
    { path: '/hr', label: 'HR Overview', icon: 'erp.group.workforce', permission: 'hr.employee.view', flag: 'ff.hr.p0701', Page: HrOverviewPage },
    { path: '/hr/employees', label: 'Employee Directory', icon: 'erp.action.search', permission: 'hr.employee.team.view', flag: 'ff.hr.p0701', Page: EmployeeDirectoryPage },
    { path: '/hr/employees/employee', label: 'Employee 360', icon: 'erp.action.info', permission: null, flag: 'ff.hr.p0701', Page: Employee360Page },
    { path: '/hr/employees/new', label: 'New Employee', icon: 'erp.action.create', permission: 'hr.employee.create', flag: 'ff.hr.p0701', Page: NewEmployeePage },
  ],
});
