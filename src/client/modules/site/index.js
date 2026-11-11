import { registerModule } from '../../platform/shell/registry.js';
import BoardPage from './BoardPage.jsx';
import WasPage from './WasPage.jsx';
import DailyPage from './DailyPage.jsx';
import MobilePage from './MobilePage.jsx';
import DprEntryPage from './DprEntryPage.jsx';
import DprsPage from './DprsPage.jsx';
import DprReportPage from './DprReportPage.jsx';
import DprCompliancePage from './DprCompliancePage.jsx';

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
  ],
});
