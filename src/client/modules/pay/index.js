import { registerModule } from '../../platform/shell/registry.js';
import { lazyPage } from '../../platform/shell/lazyPage.js';

// Module "pay" (M24): payroll. Each page is fetched when it is first opened (part 166.4).
const ComponentsPage = lazyPage(() => import('./SetupPages.jsx'), 'ComponentsPage');
const AssignmentsPage = lazyPage(() => import('./SetupPages.jsx'), 'AssignmentsPage');
const StatutoryPage = lazyPage(() => import('./SetupPages.jsx'), 'StatutoryPage');
const CalendarPage = lazyPage(() => import('./SetupPages.jsx'), 'CalendarPage');
const RunsPage = lazyPage(() => import('./RunPages.jsx'), 'RunsPage');
const RegisterPage = lazyPage(() => import('./RunPages.jsx'), 'RegisterPage');
const DeclarationsPage = lazyPage(() => import('./RunPages.jsx'), 'DeclarationsPage');
const WageRunsPage = lazyPage(() => import('./WagePages.jsx'), 'WageRunsPage');
const WageRegisterPage = lazyPage(() => import('./WagePages.jsx'), 'WageRegisterPage');
const ContractorWagesPage = lazyPage(() => import('./WagePages.jsx'), 'ContractorWagesPage');
const ComplianceBoardPage = lazyPage(() => import('./StatPages.jsx'), 'ComplianceBoardPage');
const RegistersPage = lazyPage(() => import('./StatPages.jsx'), 'RegistersPage');

registerModule({
  code: 'pay',
  label: 'Payroll',
  routes: [
    { path: '/payroll/components', label: 'Pay Components & Salary Structures', labelHi: 'वेतन घटक व वेतन संरचना', icon: 'erp.group.workforce', permission: 'pay.component.view', flag: 'ff.pay.p2401', Page: ComponentsPage },
    { path: '/payroll/assignments', label: 'Employee Pay Assignments & Revisions', labelHi: 'कर्मचारी वेतन निर्धारण व संशोधन', icon: 'erp.group.workforce', permission: 'pay.assignment.view', flag: 'ff.pay.p2401', Page: AssignmentsPage },
    { path: '/payroll/statutory', label: 'Statutory Parameters', labelHi: 'सांविधिक मानदंड', icon: 'erp.group.workforce', permission: 'pay.statutory.view', flag: 'ff.pay.p2401', Page: StatutoryPage },
    { path: '/payroll/calendar', label: 'Payroll Calendar', labelHi: 'वेतन कैलेंडर', icon: 'erp.group.workforce', permission: 'pay.calendar.view', flag: 'ff.pay.p2401', Page: CalendarPage },
    { path: '/payroll/runs', label: 'Payroll Run', labelHi: 'वेतन रन', icon: 'erp.group.workforce', permission: 'pay.run.view', flag: 'ff.pay.p2402', Page: RunsPage },
    { path: '/payroll/register', label: 'Payroll Register & Variance', labelHi: 'वेतन रजिस्टर व अंतर', icon: 'erp.group.workforce', permission: 'pay.run.view', flag: 'ff.pay.p2402', Page: RegisterPage },
    { path: '/payroll/wage-runs', label: 'Wage Run', labelHi: 'मज़दूरी रन', icon: 'erp.group.workforce', permission: 'pay.wage_run.view', flag: 'ff.pay.p2403', Page: WageRunsPage },
    { path: '/payroll/wage-register', label: 'Wage Register & Muster Roll', labelHi: 'मज़दूरी रजिस्टर व हाज़िरी', icon: 'erp.group.workforce', permission: 'pay.wage_run.view', flag: 'ff.pay.p2403', Page: WageRegisterPage },
    { path: '/payroll/contractor-wages', label: 'Contractor Wage Verification', labelHi: 'ठेकेदार मज़दूरी सत्यापन', icon: 'erp.group.workforce', permission: 'pay.wage_check.view', flag: 'ff.pay.p2403', Page: ContractorWagesPage },
    { path: '/payroll/compliance', label: 'Statutory Calendar & Filings', labelHi: 'सांविधिक कैलेंडर व दाखिल', icon: 'erp.group.workforce', permission: 'pay.stat.calendar.view', flag: 'ff.pay.p2404', Page: ComplianceBoardPage },
    { path: '/payroll/registers', label: 'Labour Registers, Form 16 & Bonus / Gratuity', labelHi: 'श्रम रजिस्टर, फ़ॉर्म 16 व बोनस / ग्रेच्युटी', icon: 'erp.group.workforce', permission: 'pay.stat.register.view', flag: 'ff.pay.p2404', Page: RegistersPage },
    { path: '/payroll/declarations', label: 'Tax Declarations', labelHi: 'कर घोषणाएँ', icon: 'erp.group.workforce', permission: 'pay.declaration.own', flag: 'ff.pay.p2402', Page: DeclarationsPage },
  ],
});
