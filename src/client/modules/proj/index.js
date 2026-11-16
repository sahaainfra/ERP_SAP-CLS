import { registerModule } from '../../platform/shell/registry.js';
import { lazyPage } from '../../platform/shell/lazyPage.js';

// Each page is fetched when it is first opened (part 166.4); the routes themselves stay in the first download.
const BaselineComparePage = lazyPage(() => import('./BaselineComparePage.jsx'));
const BaselinePackPage = lazyPage(() => import('./BaselinePackPage.jsx'));
const BaselinePacksPage = lazyPage(() => import('./BaselinePacksPage.jsx'));
const FromAwardPage = lazyPage(() => import('./FromAwardPage.jsx'));
const BoqImportPage = lazyPage(() => import('./BoqImportPage.jsx'));
const BoqMappingPage = lazyPage(() => import('./BoqMappingPage.jsx'));
const BoqReportsPage = lazyPage(() => import('./BoqReportsPage.jsx'));
const BoqVersionPage = lazyPage(() => import('./BoqVersionPage.jsx'));
const BoqVersionsPage = lazyPage(() => import('./BoqVersionsPage.jsx'));
const ActionTrackerPage = lazyPage(() => import('./ActionTrackerPage.jsx'));
const LocationsPage = lazyPage(() => import('./LocationsPage.jsx'));
const MeetingPage = lazyPage(() => import('./MeetingPage.jsx'));
const MeetingsPage = lazyPage(() => import('./MeetingsPage.jsx'));
const GisConfigPage = lazyPage(() => import('./GisConfigPage.jsx'));
const IssuePage = lazyPage(() => import('./IssuePage.jsx'));
const IssuesPage = lazyPage(() => import('./IssuesPage.jsx'));
const ProjectPage = lazyPage(() => import('./ProjectPage.jsx'));
const PortfolioPage = lazyPage(() => import('./PortfolioPage.jsx'));
const Project360Page = lazyPage(() => import('./Project360Page.jsx'));
const ProjectMapPage = lazyPage(() => import('./ProjectMapPage.jsx'));
const RiskDashboardPage = lazyPage(() => import('./RiskDashboardPage.jsx'));
const RiskPage = lazyPage(() => import('./RiskPage.jsx'));
const RisksPage = lazyPage(() => import('./RisksPage.jsx'));
const StakeholdersPage = lazyPage(() => import('./StakeholdersPage.jsx'));
const StripChartPage = lazyPage(() => import('./StripChartPage.jsx'));
const TeamPage = lazyPage(() => import('./TeamPage.jsx'));
const ProjectsPage = lazyPage(() => import('./ProjectsPage.jsx'));
const WbsPage = lazyPage(() => import('./WbsPage.jsx'));
const WizardPage = lazyPage(() => import('./WizardPage.jsx'));
const WorkPackagePage = lazyPage(() => import('./WorkPackagePage.jsx'));
const WorkPackagesPage = lazyPage(() => import('./WorkPackagesPage.jsx'));

registerModule({
  code: 'proj',
  label: 'Project Master',
  routes: [
    { path: '/proj/projects', label: 'Project Portfolio', icon: 'erp.group.projects', permission: 'proj.project.view', flag: 'ff.proj.p1001', Page: ProjectsPage },
    { path: '/proj/project', label: 'Project', menu: false, icon: 'erp.group.projects', permission: 'proj.project.view', flag: 'ff.proj.p1001', Page: ProjectPage },
    { path: '/proj/wizard', label: 'Project Setup Wizard', icon: 'erp.action.create', permission: 'proj.project.create', flag: 'ff.proj.p1001', Page: WizardPage },
    { path: '/proj/from-award', label: 'Project from Award', icon: 'erp.action.create', permission: 'proj.project.create', flag: 'ff.proj.p1002', Page: FromAwardPage },
    { path: '/proj/baseline-packs', label: 'Commercial Baseline', icon: 'erp.group.projects', permission: 'proj.baseline_pack.view', flag: 'ff.proj.p1002', Page: BaselinePacksPage },
    { path: '/proj/baseline-pack', label: 'Commercial Baseline Pack', menu: false, icon: 'erp.group.projects', permission: 'proj.baseline_pack.view', flag: 'ff.proj.p1002', Page: BaselinePackPage },
    { path: '/proj/baseline-compare', label: 'Baseline vs Current', icon: 'erp.group.projects', permission: 'proj.baseline_pack.view', flag: 'ff.proj.p1002', Page: BaselineComparePage },
    { path: '/proj/wbs', label: 'WBS Editor', icon: 'erp.group.projects', permission: 'proj.wbs.view', flag: 'ff.proj.p1003', Page: WbsPage },
    { path: '/proj/locations', label: 'Location Breakdown', icon: 'erp.group.projects', permission: 'proj.wbs.view', flag: 'ff.proj.p1003', Page: LocationsPage },
    { path: '/proj/work-packages', label: 'Work Packages', icon: 'erp.group.projects', permission: 'proj.wbs.view', flag: 'ff.proj.p1003', Page: WorkPackagesPage },
    { path: '/proj/work-package', label: 'Work Package', menu: false, icon: 'erp.group.projects', permission: 'proj.wbs.view', flag: 'ff.proj.p1003', Page: WorkPackagePage },
    { path: '/proj/versions', label: 'BOQ Versions', icon: 'erp.group.projects', permission: 'proj.version.view', flag: 'ff.proj.p1004', Page: BoqVersionsPage },
    { path: '/proj/version', label: 'BOQ', menu: false, icon: 'erp.group.projects', permission: 'proj.version.view', flag: 'ff.proj.p1004', Page: BoqVersionPage },
    { path: '/proj/boq-import', label: 'Import BOQ', icon: 'erp.action.import', permission: 'proj.boq.import', flag: 'ff.proj.p1004', Page: BoqImportPage },
    { path: '/proj/boq-mapping', label: 'WBS and Location Mapping', menu: false, icon: 'erp.group.projects', permission: 'proj.version.view', flag: 'ff.proj.p1004', Page: BoqMappingPage },
    { path: '/proj/boq-reports', label: 'BOQ Reports', icon: 'erp.group.projects', permission: 'proj.version.view', flag: 'ff.proj.p1004', Page: BoqReportsPage },
    { path: '/proj/team', label: 'Project Team', icon: 'erp.group.projects', permission: 'proj.team.view', flag: 'ff.proj.p1005', Page: TeamPage },
    { path: '/proj/stakeholders', label: 'Stakeholders', icon: 'erp.group.projects', permission: 'proj.stakeholder.view', flag: 'ff.proj.p1005', Page: StakeholdersPage },
    { path: '/proj/meetings', label: 'Meetings', icon: 'erp.group.projects', permission: 'proj.meeting.view', flag: 'ff.proj.p1005', Page: MeetingsPage },
    { path: '/proj/meeting', label: 'Meeting', menu: false, icon: 'erp.group.projects', permission: 'proj.meeting.view', flag: 'ff.proj.p1005', Page: MeetingPage },
    { path: '/proj/action-tracker', label: 'Action Item Tracker', icon: 'erp.group.projects', permission: 'proj.meeting.view', flag: 'ff.proj.p1005', Page: ActionTrackerPage },
    { path: '/proj/risk-dashboard', label: 'Risk Dashboard', icon: 'erp.group.projects', permission: 'proj.risk.view', flag: 'ff.proj.p1006', Page: RiskDashboardPage },
    { path: '/proj/risks', label: 'Risk and Opportunity Register', icon: 'erp.group.projects', permission: 'proj.risk.view', flag: 'ff.proj.p1006', Page: RisksPage },
    { path: '/proj/risk', label: 'Risk', menu: false, icon: 'erp.group.projects', permission: 'proj.risk.view', flag: 'ff.proj.p1006', Page: RiskPage },
    { path: '/proj/issues', label: 'Issue Log', icon: 'erp.group.projects', permission: 'proj.issue.view', flag: 'ff.proj.p1006', Page: IssuesPage },
    { path: '/proj/issue', label: 'Issue', menu: false, icon: 'erp.group.projects', permission: 'proj.issue.view', flag: 'ff.proj.p1006', Page: IssuePage },
    { path: '/proj/map', label: 'Project Map', icon: 'erp.group.projects', permission: 'proj.gis.view', flag: 'ff.proj.p1007', Page: ProjectMapPage },
    { path: '/proj/strip-chart', label: 'Chainage Progress Strip Chart', icon: 'erp.group.projects', permission: 'proj.gis.view', flag: 'ff.proj.p1007', Page: StripChartPage },
    { path: '/proj/gis-config', label: 'Layers and Overlays', icon: 'erp.group.projects', permission: 'proj.gis.view', flag: 'ff.proj.p1007', Page: GisConfigPage },
    { path: '/proj/project-360', label: 'Project 360', menu: false, icon: 'erp.group.projects', permission: 'proj.p360.view', flag: 'ff.proj.p1008', Page: Project360Page },
    { path: '/proj/portfolio', label: 'Portfolio Overview', icon: 'erp.group.projects', permission: 'proj.p360.view', flag: 'ff.proj.p1008', Page: PortfolioPage },
  ],
});
