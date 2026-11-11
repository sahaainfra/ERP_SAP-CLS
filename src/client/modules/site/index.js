import { registerModule } from '../../platform/shell/registry.js';
import BoardPage from './BoardPage.jsx';
import WasPage from './WasPage.jsx';
import DailyPage from './DailyPage.jsx';
import MobilePage from './MobilePage.jsx';
import DprEntryPage from './DprEntryPage.jsx';
import DprsPage from './DprsPage.jsx';
import DprReportPage from './DprReportPage.jsx';
import DprCompliancePage from './DprCompliancePage.jsx';
import WeatherPage from './WeatherPage.jsx';
import HindrancesPage from './HindrancesPage.jsx';
import DiaryPage from './DiaryPage.jsx';
import VisitorsPage from './VisitorsPage.jsx';
import InstructionsPage from './InstructionsPage.jsx';
import InstructionIssuePage from './InstructionIssuePage.jsx';
import ProgressDashboardPage from './ProgressDashboardPage.jsx';
import ProgressReportPage from './ProgressReportPage.jsx';
import PeriodsPage from './PeriodsPage.jsx';
import ClientProgressPage from './ClientProgressPage.jsx';
import ProductivityDashboardPage from './ProductivityDashboardPage.jsx';
import ProductivityReportPage from './ProductivityReportPage.jsx';
import ProductivityNormsPage from './ProductivityNormsPage.jsx';
import ProductivityRecordsPage from './ProductivityRecordsPage.jsx';

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
  ],
});
