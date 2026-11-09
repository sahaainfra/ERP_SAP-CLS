import { registerModule } from '../../platform/shell/registry.js';
import SchedulesPage from './SchedulesPage.jsx';
import ActivitiesPage from './ActivitiesPage.jsx';
import GeneratePage from './GeneratePage.jsx';
import CriticalPage from './CriticalPage.jsx';
import CalendarsPage from './CalendarsPage.jsx';
import GanttPage from './GanttPage.jsx';
import HistogramPage from './HistogramPage.jsx';
import ProgrammePage from './ProgrammePage.jsx';

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
    { path: '/plan/calendars', label: 'Work Calendars', icon: 'erp.group.projects', permission: 'plan.calendar.view', flag: 'ff.plan.p1301', Page: CalendarsPage },
  ],
});
