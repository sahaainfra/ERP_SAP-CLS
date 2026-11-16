import { registerModule } from '../../platform/shell/registry.js';
import { lazyPage } from '../../platform/shell/lazyPage.js';

// Each page is fetched when it is first opened (part 166.4); the routes themselves stay in the first download.
const BoardPage = lazyPage(() => import('./BoardPage.jsx'));
const WasPage = lazyPage(() => import('./WasPage.jsx'));
const DailyPage = lazyPage(() => import('./DailyPage.jsx'));
const MobilePage = lazyPage(() => import('./MobilePage.jsx'));
const DprEntryPage = lazyPage(() => import('./DprEntryPage.jsx'));
const DprsPage = lazyPage(() => import('./DprsPage.jsx'));
const DprReportPage = lazyPage(() => import('./DprReportPage.jsx'));
const DprCompliancePage = lazyPage(() => import('./DprCompliancePage.jsx'));
const WeatherPage = lazyPage(() => import('./WeatherPage.jsx'));
const HindrancesPage = lazyPage(() => import('./HindrancesPage.jsx'));
const DiaryPage = lazyPage(() => import('./DiaryPage.jsx'));
const VisitorsPage = lazyPage(() => import('./VisitorsPage.jsx'));
const InstructionsPage = lazyPage(() => import('./InstructionsPage.jsx'));
const InstructionIssuePage = lazyPage(() => import('./InstructionIssuePage.jsx'));
const ProgressDashboardPage = lazyPage(() => import('./ProgressDashboardPage.jsx'));
const ProgressReportPage = lazyPage(() => import('./ProgressReportPage.jsx'));
const PeriodsPage = lazyPage(() => import('./PeriodsPage.jsx'));
const ClientProgressPage = lazyPage(() => import('./ClientProgressPage.jsx'));
const ProductivityDashboardPage = lazyPage(() => import('./ProductivityDashboardPage.jsx'));
const ProductivityReportPage = lazyPage(() => import('./ProductivityReportPage.jsx'));
const ProductivityNormsPage = lazyPage(() => import('./ProductivityNormsPage.jsx'));
const ControlDashboardPage = lazyPage(() => import('./ControlDashboardPage.jsx'));
const ControlVariancePage = lazyPage(() => import('./ControlVariancePage.jsx'));
const ControlUnallocatedPage = lazyPage(() => import('./ControlUnallocatedPage.jsx'));
const ProductivityRecordsPage = lazyPage(() => import('./ProductivityRecordsPage.jsx'));

registerModule({
  code: 'site',
  label: 'Site Execution',
  routes: [
    { path: '/site/board', label: 'Site Work Board', icon: 'erp.group.projects', permission: 'site.work_authorisation.view', flag: 'ff.site.p1401', Page: BoardPage },
    { path: '/site/work-authorisations', label: 'Work Authorisations', icon: 'erp.group.projects', permission: 'site.work_authorisation.view', flag: 'ff.site.p1401', Page: WasPage },
    { path: '/site/daily-plans', label: 'Daily Work Plan', icon: 'erp.group.projects', permission: 'site.daily_plan.view', flag: 'ff.site.p1401', Page: DailyPage },
    { path: '/site/wa-mobile', label: 'Approve and Close WA', icon: 'erp.group.projects', permission: 'site.work_authorisation.view', flag: 'ff.site.p1401', Page: MobilePage },
    { path: '/site/dpr-entry', label: 'Daily Progress Report Entry', icon: 'erp.group.projects', permission: 'site.dpr.create', flag: 'ff.site.p1402', Page: DprEntryPage },
    { path: '/site/dprs', label: 'DPR Register', icon: 'erp.group.projects', permission: 'site.dpr.view', flag: 'ff.site.p1402', Page: DprsPage },
    { path: '/site/dpr-report', label: 'Daily Site and Progress Reports', icon: 'erp.group.projects', permission: 'site.dpr.report', flag: 'ff.site.p1402', Page: DprReportPage },
    { path: '/site/dpr-compliance', label: 'DPR Compliance', icon: 'erp.group.projects', permission: 'site.dpr.report', flag: 'ff.site.p1402', Page: DprCompliancePage },
    { path: '/site/weather', label: 'Weather Log', icon: 'erp.group.projects', permission: 'site.weather.view', flag: 'ff.site.p1403', Page: WeatherPage },
    { path: '/site/hindrances', label: 'Hindrance Register', icon: 'erp.group.projects', permission: 'site.hindrance.view', flag: 'ff.site.p1403', Page: HindrancesPage },
    { path: '/site/diary', label: 'Site Diary', icon: 'erp.group.projects', permission: 'site.diary.view', flag: 'ff.site.p1403', Page: DiaryPage },
    { path: '/site/visitors', label: 'Visitor Log', icon: 'erp.group.projects', permission: 'site.visitor.view', flag: 'ff.site.p1403', Page: VisitorsPage },
    { path: '/site/instructions', label: 'Site Instructions', icon: 'erp.group.projects', permission: 'site.instruction.view', flag: 'ff.site.p1404', Page: InstructionsPage },
    { path: '/site/instruction-issue', label: 'Issue Instruction', icon: 'erp.group.projects', permission: 'site.instruction.create', flag: 'ff.site.p1404', Page: InstructionIssuePage },
    { path: '/site/progress', label: 'Progress Dashboard', icon: 'erp.group.projects', permission: 'site.period.view', flag: 'ff.site.p1405', Page: ProgressDashboardPage },
    { path: '/site/progress-report', label: 'Progress by WBS and Activity', icon: 'erp.group.projects', permission: 'site.period.view', flag: 'ff.site.p1405', Page: ProgressReportPage },
    { path: '/site/periods', label: 'Progress Period Close', icon: 'erp.group.projects', permission: 'site.period.view', flag: 'ff.site.p1405', Page: PeriodsPage },
    { path: '/site/client-progress', label: 'Client Progress Report', icon: 'erp.group.projects', permission: 'site.period.view', flag: 'ff.site.p1405', Page: ClientProgressPage },
    { path: '/site/productivity', label: 'Productivity Dashboard', icon: 'erp.group.projects', permission: 'site.productivity.view', flag: 'ff.site.p1406', Page: ProductivityDashboardPage },
    { path: '/site/productivity-report', label: 'Productivity Variance and Loss Reasons', icon: 'erp.group.projects', permission: 'site.productivity.view', flag: 'ff.site.p1406', Page: ProductivityReportPage },
    { path: '/site/productivity-norms', label: 'Productivity Norms', icon: 'erp.group.projects', permission: 'site.productivity.view', flag: 'ff.site.p1406', Page: ProductivityNormsPage },
    { path: '/site/productivity-records', label: 'Productivity Records', icon: 'erp.group.projects', permission: 'site.productivity.view', flag: 'ff.site.p1406', Page: ProductivityRecordsPage },
    { path: '/site/control', label: 'Project Cost Control', icon: 'erp.group.projects', permission: 'site.control.view', flag: 'ff.site.p1407', Page: ControlDashboardPage },
    { path: '/site/control-variance', label: 'Quantity and Rate Variance Analysis', icon: 'erp.group.projects', permission: 'site.control.view', flag: 'ff.site.p1407', Page: ControlVariancePage },
    { path: '/site/control-unallocated', label: 'Unallocated Costs', icon: 'erp.group.projects', permission: 'site.control.view', flag: 'ff.site.p1407', Page: ControlUnallocatedPage },
  ],
});
