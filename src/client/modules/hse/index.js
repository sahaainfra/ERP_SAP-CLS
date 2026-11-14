import DashboardPage from './DashboardPage.jsx';
import { CampOccupancyPage, CampSetupPage, AllocationsPage, CampInspectionsPage, CampMessPage } from './CampPages.jsx';
import { registerModule } from '../../platform/shell/registry.js';
import PlansPage from './PlansPage.jsx';
import HiraPage from './HiraPage.jsx';
import JsaPage from './JsaPage.jsx';
import InductionPage from './InductionPage.jsx';
import ToolboxPage from './ToolboxPage.jsx';
import LibraryPage from './LibraryPage.jsx';
import CompliancePage from './CompliancePage.jsx';
import PermitsPage, { RequestPermit } from './PermitsPage.jsx';
import { IncidentsPage, LessonsPage, ReportIncidentPage } from './IncidentPages.jsx';
import { ContractorScoresPage, EquipmentPage, ObservationCardPage, ObservationsPage, PpeIssuePage, PpeRegisterPage, SchedulesPage } from './SafetyPages.jsx';
import { CarbonPage, ConsentsPage, EsgDashboardPage, EsgEntryPage, FactorsPage, WastePage } from './EsgPages.jsx';
import { PatrolCompliancePage, PatrolScanPage, RosterBoardPage, SecurityIncidentsPage, SecurityPostsPage, VisitorGatePage, VisitorsPage } from './SecurityPages.jsx';
import { PermitApprovalsPage, PermitBoardPage, PermitTypesPage } from './PermitMisc.jsx';

registerModule({
  code: 'hse',
  label: 'HSE and Site Security',
  routes: [
    { path: '/hse/dashboard', label: 'HSE Dashboard', icon: 'erp.qhse.hse', permission: 'hse.dashboard.view', flag: 'ff.hse.p1908', Page: DashboardPage },
    { path: '/hse/plans', label: 'HSE Plans', icon: 'erp.qhse.hse', permission: 'hse.plan.view', flag: 'ff.hse.p1901', Page: PlansPage },
    { path: '/hse/hira', label: 'HIRA Register', icon: 'erp.qhse.hse', permission: 'hse.hira.view', flag: 'ff.hse.p1901', Page: HiraPage },
    { path: '/hse/jsa', label: 'JSA Builder', icon: 'erp.qhse.hse', permission: 'hse.jsa.view', flag: 'ff.hse.p1901', Page: JsaPage },
    { path: '/hse/induction', label: 'Site Induction', icon: 'erp.qhse.hse', permission: 'hse.induction.view', flag: 'ff.hse.p1901', Page: InductionPage },
    { path: '/hse/toolbox', label: 'Toolbox Talks', icon: 'erp.qhse.hse', permission: 'hse.toolbox_talk.view', flag: 'ff.hse.p1901', Page: ToolboxPage },
    { path: '/hse/library', label: 'Induction Content and Talk Topics', icon: 'erp.qhse.hse', permission: 'hse.induction_content.view', flag: 'ff.hse.p1901', Page: LibraryPage },
    { path: '/hse/compliance', label: 'Induction and Toolbox Compliance', icon: 'erp.qhse.hse', permission: 'hse.induction.view', flag: 'ff.hse.p1901', Page: CompliancePage },
    { path: '/hse/permit-request', label: 'Request Permit', icon: 'erp.qhse.hse', permission: 'hse.permit.create', flag: 'ff.hse.p1902', Page: RequestPermit },
    { path: '/hse/permit-approvals', label: 'Permit Approvals', icon: 'erp.qhse.hse', permission: 'hse.permit.approve', flag: 'ff.hse.p1902', Page: PermitApprovalsPage },
    { path: '/hse/permit-board', label: 'Active Permits Board', icon: 'erp.qhse.hse', permission: 'hse.permit.view', flag: 'ff.hse.p1902', Page: PermitBoardPage },
    { path: '/hse/permits', label: 'Permit Register', icon: 'erp.qhse.hse', permission: 'hse.permit.view', flag: 'ff.hse.p1902', Page: PermitsPage },
    { path: '/hse/permit-types', label: 'Permit Types', icon: 'erp.qhse.hse', permission: 'hse.permit_type.view', flag: 'ff.hse.p1902', Page: PermitTypesPage },
    { path: '/hse/incident-report', label: 'Report Incident', icon: 'erp.qhse.hse', permission: 'hse.incident.create', flag: 'ff.hse.p1903', Page: ReportIncidentPage },
    { path: '/hse/incidents', label: 'Incident Register', icon: 'erp.qhse.hse', permission: 'hse.incident.view', flag: 'ff.hse.p1903', Page: IncidentsPage },
    { path: '/hse/lessons', label: 'Lessons Learned', icon: 'erp.qhse.hse', permission: 'hse.lesson.view', flag: 'ff.hse.p1903', Page: LessonsPage },
    { path: '/hse/observation', label: 'Safety Observation', icon: 'erp.qhse.hse', permission: 'hse.observation.create', flag: 'ff.hse.p1904', Page: ObservationCardPage },
    { path: '/hse/observations', label: 'Observations', icon: 'erp.qhse.hse', permission: 'hse.observation.view', flag: 'ff.hse.p1904', Page: ObservationsPage },
    { path: '/hse/ppe-issue', label: 'PPE Issue by QR', icon: 'erp.qhse.hse', permission: 'hse.ppe.give', flag: 'ff.hse.p1904', Page: PpeIssuePage },
    { path: '/hse/ppe-register', label: 'PPE Register by Person', icon: 'erp.qhse.hse', permission: 'hse.ppe.view', flag: 'ff.hse.p1904', Page: PpeRegisterPage },
    { path: '/hse/equipment', label: 'Safety Equipment Register', icon: 'erp.qhse.hse', permission: 'hse.equipment.view', flag: 'ff.hse.p1904', Page: EquipmentPage },
    { path: '/hse/inspection-schedules', label: 'Inspection Schedules', icon: 'erp.qhse.hse', permission: 'hse.schedule.view', flag: 'ff.hse.p1904', Page: SchedulesPage },
    { path: '/hse/contractor-scores', label: 'Contractor Safety Scorecard', icon: 'erp.qhse.hse', permission: 'hse.contractor_score.view', flag: 'ff.hse.p1904', Page: ContractorScoresPage },
    { path: '/hse/esg', label: 'Environment and ESG Dashboard', icon: 'erp.qhse.hse', permission: 'hse.esg.view', flag: 'ff.hse.p1905', Page: EsgDashboardPage },
    { path: '/hse/esg-entry', label: 'Monthly Environmental Data Entry', icon: 'erp.qhse.hse', permission: 'hse.esg.record', flag: 'ff.hse.p1905', Page: EsgEntryPage },
    { path: '/hse/waste', label: 'Waste Register', icon: 'erp.qhse.hse', permission: 'hse.esg.view', flag: 'ff.hse.p1905', Page: WastePage },
    { path: '/hse/carbon', label: 'Carbon Emissions', icon: 'erp.qhse.hse', permission: 'hse.esg.view', flag: 'ff.hse.p1905', Page: CarbonPage },
    { path: '/hse/consents', label: 'Environmental Consents', icon: 'erp.qhse.hse', permission: 'hse.esg.view', flag: 'ff.hse.p1905', Page: ConsentsPage },
    { path: '/hse/emission-factors', label: 'Emission Factors', icon: 'erp.qhse.hse', permission: 'hse.esg.view', flag: 'ff.hse.p1905', Page: FactorsPage },
    { path: '/hse/visitor-gate', label: 'Visitor Check-in and Check-out', icon: 'erp.qhse.hse', permission: 'hse.visitor.checkin', flag: 'ff.hse.p1906', Page: VisitorGatePage },
    { path: '/hse/visitors', label: 'Visitors', icon: 'erp.qhse.hse', permission: 'hse.visitor.view', flag: 'ff.hse.p1906', Page: VisitorsPage },
    { path: '/hse/patrol-scan', label: 'Patrol Scan', icon: 'erp.qhse.hse', permission: 'hse.patrol.scan', flag: 'ff.hse.p1906', Page: PatrolScanPage },
    { path: '/hse/patrol-compliance', label: 'Patrol Compliance', icon: 'erp.qhse.hse', permission: 'hse.patrol.view', flag: 'ff.hse.p1906', Page: PatrolCompliancePage },
    { path: '/hse/rosters', label: 'Guard Roster', icon: 'erp.qhse.hse', permission: 'hse.roster.view', flag: 'ff.hse.p1906', Page: RosterBoardPage },
    { path: '/hse/security-incidents', label: 'Security Incidents', icon: 'erp.qhse.hse', permission: 'hse.security_incident.view', flag: 'ff.hse.p1906', Page: SecurityIncidentsPage },
    { path: '/hse/camp', label: 'Camp Occupancy', icon: 'erp.qhse.hse', permission: 'hse.camp.view', flag: 'ff.hse.p1907', Page: CampOccupancyPage },
    { path: '/hse/camp-setup', label: 'Camps, Rooms and Assets', icon: 'erp.qhse.hse', permission: 'hse.camp.view', flag: 'ff.hse.p1907', Page: CampSetupPage },
    { path: '/hse/camp-allocation', label: 'Room and Bed Allocation', icon: 'erp.qhse.hse', permission: 'hse.allocation.view', flag: 'ff.hse.p1907', Page: AllocationsPage },
    { path: '/hse/camp-inspections', label: 'Camp Welfare Inspections', icon: 'erp.qhse.hse', permission: 'hse.camp_inspection.view', flag: 'ff.hse.p1907', Page: CampInspectionsPage },
    { path: '/hse/camp-mess', label: 'Mess and Recovery', icon: 'erp.qhse.hse', permission: 'hse.camp_meal.view', flag: 'ff.hse.p1907', Page: CampMessPage },
    { path: '/hse/security-posts', label: 'Security Posts and Checkpoints', icon: 'erp.qhse.hse', permission: 'hse.security_post.view', flag: 'ff.hse.p1906', Page: SecurityPostsPage },
  ],
});
