import { registerModule } from '../../platform/shell/registry.js';
import { lazyPage } from '../../platform/shell/lazyPage.js';

// Module "pay" (M24): payroll. Each page is fetched when it is first opened (part 166.4).
const ComponentsPage = lazyPage(() => import('./SetupPages.jsx'), 'ComponentsPage');
const AssignmentsPage = lazyPage(() => import('./SetupPages.jsx'), 'AssignmentsPage');
const StatutoryPage = lazyPage(() => import('./SetupPages.jsx'), 'StatutoryPage');
const CalendarPage = lazyPage(() => import('./SetupPages.jsx'), 'CalendarPage');

registerModule({
  code: 'pay',
  label: 'Payroll',
  routes: [
    { path: '/payroll/components', label: 'Pay Components & Salary Structures', labelHi: 'वेतन घटक व वेतन संरचना', icon: 'erp.group.workforce', permission: 'pay.component.view', flag: 'ff.pay.p2401', Page: ComponentsPage },
    { path: '/payroll/assignments', label: 'Employee Pay Assignments & Revisions', labelHi: 'कर्मचारी वेतन निर्धारण व संशोधन', icon: 'erp.group.workforce', permission: 'pay.assignment.view', flag: 'ff.pay.p2401', Page: AssignmentsPage },
    { path: '/payroll/statutory', label: 'Statutory Parameters', labelHi: 'सांविधिक मानदंड', icon: 'erp.group.workforce', permission: 'pay.statutory.view', flag: 'ff.pay.p2401', Page: StatutoryPage },
    { path: '/payroll/calendar', label: 'Payroll Calendar', labelHi: 'वेतन कैलेंडर', icon: 'erp.group.workforce', permission: 'pay.calendar.view', flag: 'ff.pay.p2401', Page: CalendarPage },
  ],
});
