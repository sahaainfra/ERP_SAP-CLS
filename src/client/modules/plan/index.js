import { registerModule } from '../../platform/shell/registry.js';
import { lazyPage } from '../../platform/shell/lazyPage.js';

// Each page is fetched when it is first opened (part 166.4); the routes themselves stay in the first download.
const SchedulesPage = lazyPage(() => import('./SchedulesPage.jsx'));
const ActivitiesPage = lazyPage(() => import('./ActivitiesPage.jsx'));
const GeneratePage = lazyPage(() => import('./GeneratePage.jsx'));
const CriticalPage = lazyPage(() => import('./CriticalPage.jsx'));
const CalendarsPage = lazyPage(() => import('./CalendarsPage.jsx'));
const GanttPage = lazyPage(() => import('./GanttPage.jsx'));
const HistogramPage = lazyPage(() => import('./HistogramPage.jsx'));
const ProgrammePage = lazyPage(() => import('./ProgrammePage.jsx'));
const BaselinesPage = lazyPage(() => import('./BaselinesPage.jsx'));
const ImportPage = lazyPage(() => import('./ImportPage.jsx'));
const VariancePage = lazyPage(() => import('./VariancePage.jsx'));
const LookaheadPage = lazyPage(() => import('./LookaheadPage.jsx'));
const ConstraintsPage = lazyPage(() => import('./ConstraintsPage.jsx'));
const WeeklyPage = lazyPage(() => import('./WeeklyPage.jsx'));
const DelaysPage = lazyPage(() => import('./DelaysPage.jsx'));
const TiaPage = lazyPage(() => import('./TiaPage.jsx'));
const DelaySummaryPage = lazyPage(() => import('./DelaySummaryPage.jsx'));

registerModule({
  code: 'plan',
  label: 'Planning & Scheduling',
  routes: [
    { path: '/plan/schedules', label: 'Schedules', icon: 'erp.group.projects', permission: 'plan.schedule.view', flag: 'ff.plan.p1301', Page: SchedulesPage },
    { path: '/plan/activities', label: 'Activities', icon: 'erp.group.projects', permission: 'plan.schedule.view', flag: 'ff.plan.p1301', Page: ActivitiesPage },
    { path: '/plan/generate', label: 'Generate Activities from Template', icon: 'erp.action.create', permission: 'plan.schedule.edit', flag: 'ff.plan.p1301', Page: GeneratePage },
    { path: '/plan/critical', label: 'Critical Path & Float Report', icon: 'erp.group.projects', permission: 'plan.schedule.view', flag: 'ff.plan.p1301', Page: CriticalPage },
    { path: '/plan/gantt', label: 'Gantt Planner', icon: 'erp.group.projects', permission: 'plan.schedule.view', flag: 'ff.plan.p1302', Page: GanttPage },
    { path: '/plan/histogram', label: 'Resource Histogram', icon: 'erp.group.projects', permission: 'plan.resource.view', flag: 'ff.plan.p1302', Page: HistogramPage },
    { path: '/plan/programme', label: 'Printable Programme', icon: 'erp.group.projects', permission: 'plan.schedule.print', flag: 'ff.plan.p1302', Page: ProgrammePage },
    { path: '/plan/import', label: 'Import Schedule', icon: 'erp.action.create', permission: 'plan.schedule.import', flag: 'ff.plan.p1303', Page: ImportPage },
    { path: '/plan/baselines', label: 'Baselines', icon: 'erp.group.projects', permission: 'plan.baseline.view', flag: 'ff.plan.p1303', Page: BaselinesPage },
    { path: '/plan/variance', label: 'Variance and Quality', icon: 'erp.group.projects', permission: 'plan.baseline.view', flag: 'ff.plan.p1303', Page: VariancePage },
    { path: '/plan/lookahead', label: 'Look-ahead Board', icon: 'erp.group.projects', permission: 'plan.lookahead.view', flag: 'ff.plan.p1304', Page: LookaheadPage },
    { path: '/plan/constraints', label: 'Constraint Log', icon: 'erp.group.projects', permission: 'plan.constraint.view', flag: 'ff.plan.p1304', Page: ConstraintsPage },
    { path: '/plan/weekly', label: 'Weekly Work Plan', icon: 'erp.group.projects', permission: 'plan.weekly_plan.view', flag: 'ff.plan.p1304', Page: WeeklyPage },
    { path: '/plan/delays', label: 'Delay Register', icon: 'erp.group.projects', permission: 'plan.delay.view', flag: 'ff.plan.p1305', Page: DelaysPage },
    { path: '/plan/tia', label: 'Time Impact Analysis', icon: 'erp.group.projects', permission: 'plan.delay.analyse', flag: 'ff.plan.p1305', Page: TiaPage },
    { path: '/plan/delay-summary', label: 'Delay Summary', icon: 'erp.group.projects', permission: 'plan.delay.view', flag: 'ff.plan.p1305', Page: DelaySummaryPage },
    { path: '/plan/calendars', label: 'Work Calendars', icon: 'erp.group.projects', permission: 'plan.calendar.view', flag: 'ff.plan.p1301', Page: CalendarsPage },
  ],
});
