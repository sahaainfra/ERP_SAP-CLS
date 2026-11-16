import { registerModule } from '../../platform/shell/registry.js';
import { lazyPage } from '../../platform/shell/lazyPage.js';

// Each page is fetched when it is first opened (part 166.4); the routes themselves stay in the first download.
const DashboardPage = lazyPage(() => import('./DashboardPage.jsx'));
const CampOccupancyPage = lazyPage(() => import('./CampPages.jsx'), 'CampOccupancyPage');
const CampSetupPage = lazyPage(() => import('./CampPages.jsx'), 'CampSetupPage');
const AllocationsPage = lazyPage(() => import('./CampPages.jsx'), 'AllocationsPage');
const CampInspectionsPage = lazyPage(() => import('./CampPages.jsx'), 'CampInspectionsPage');
const CampMessPage = lazyPage(() => import('./CampPages.jsx'), 'CampMessPage');
const PlansPage = lazyPage(() => import('./PlansPage.jsx'));
const HiraPage = lazyPage(() => import('./HiraPage.jsx'));
const JsaPage = lazyPage(() => import('./JsaPage.jsx'));
const InductionPage = lazyPage(() => import('./InductionPage.jsx'));
const ToolboxPage = lazyPage(() => import('./ToolboxPage.jsx'));
const LibraryPage = lazyPage(() => import('./LibraryPage.jsx'));
const CompliancePage = lazyPage(() => import('./CompliancePage.jsx'));
const PermitsPage = lazyPage(() => import('./PermitsPage.jsx'));
const RequestPermit = lazyPage(() => import('./PermitsPage.jsx'), 'RequestPermit');
const IncidentsPage = lazyPage(() => import('./IncidentPages.jsx'), 'IncidentsPage');
const LessonsPage = lazyPage(() => import('./IncidentPages.jsx'), 'LessonsPage');
const ReportIncidentPage = lazyPage(() => import('./IncidentPages.jsx'), 'ReportIncidentPage');
const ContractorScoresPage = lazyPage(() => import('./SafetyPages.jsx'), 'ContractorScoresPage');
const EquipmentPage = lazyPage(() => import('./SafetyPages.jsx'), 'EquipmentPage');
const ObservationCardPage = lazyPage(() => import('./SafetyPages.jsx'), 'ObservationCardPage');
const ObservationsPage = lazyPage(() => import('./SafetyPages.jsx'), 'ObservationsPage');
const PpeIssuePage = lazyPage(() => import('./SafetyPages.jsx'), 'PpeIssuePage');
const PpeRegisterPage = lazyPage(() => import('./SafetyPages.jsx'), 'PpeRegisterPage');
const SchedulesPage = lazyPage(() => import('./SafetyPages.jsx'), 'SchedulesPage');
const CarbonPage = lazyPage(() => import('./EsgPages.jsx'), 'CarbonPage');
const ConsentsPage = lazyPage(() => import('./EsgPages.jsx'), 'ConsentsPage');
const EsgDashboardPage = lazyPage(() => import('./EsgPages.jsx'), 'EsgDashboardPage');
const EsgEntryPage = lazyPage(() => import('./EsgPages.jsx'), 'EsgEntryPage');
const FactorsPage = lazyPage(() => import('./EsgPages.jsx'), 'FactorsPage');
const WastePage = lazyPage(() => import('./EsgPages.jsx'), 'WastePage');
const PatrolCompliancePage = lazyPage(() => import('./SecurityPages.jsx'), 'PatrolCompliancePage');
const PatrolScanPage = lazyPage(() => import('./SecurityPages.jsx'), 'PatrolScanPage');
const RosterBoardPage = lazyPage(() => import('./SecurityPages.jsx'), 'RosterBoardPage');
const SecurityIncidentsPage = lazyPage(() => import('./SecurityPages.jsx'), 'SecurityIncidentsPage');
const SecurityPostsPage = lazyPage(() => import('./SecurityPages.jsx'), 'SecurityPostsPage');
const VisitorGatePage = lazyPage(() => import('./SecurityPages.jsx'), 'VisitorGatePage');
const VisitorsPage = lazyPage(() => import('./SecurityPages.jsx'), 'VisitorsPage');
const PermitApprovalsPage = lazyPage(() => import('./PermitMisc.jsx'), 'PermitApprovalsPage');
const PermitBoardPage = lazyPage(() => import('./PermitMisc.jsx'), 'PermitBoardPage');
const PermitTypesPage = lazyPage(() => import('./PermitMisc.jsx'), 'PermitTypesPage');

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
