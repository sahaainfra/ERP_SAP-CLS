import { registerModule } from '../../platform/shell/registry.js';
import AnomaliesPage from './AnomaliesPage.jsx';
import CandidatePage from './CandidatePage.jsx';
import CrewPunchPage from './CrewPunchPage.jsx';
import KioskPage from './KioskPage.jsx';
import PunchPage from './PunchPage.jsx';
import TodayAttendancePage from './TodayAttendancePage.jsx';
import CertificationsPage from './CertificationsPage.jsx';
import ComplianceReportPage from './ComplianceReportPage.jsx';
import MyTrainingPage from './MyTrainingPage.jsx';
import SkillMatrixPage from './SkillMatrixPage.jsx';
import TrainingCalendarPage from './TrainingCalendarPage.jsx';
import TrainingSessionPage from './TrainingSessionPage.jsx';
import TrainingSetupPage from './TrainingSetupPage.jsx';
import LetterRequestPage from './LetterRequestPage.jsx';
import MyAttendancePage from './MyAttendancePage.jsx';
import MyHrPage from './MyHrPage.jsx';
import MyTeamPage from './MyTeamPage.jsx';
import ProfileChangePage from './ProfileChangePage.jsx';
import ContractorPage from './ContractorPage.jsx';
import ContractorsPage from './ContractorsPage.jsx';
import PrintCardsPage from './PrintCardsPage.jsx';
import RegisterWorkerPage from './RegisterWorkerPage.jsx';
import WageRatesPage from './WageRatesPage.jsx';
import WorkerPage from './WorkerPage.jsx';
import WorkersPage from './WorkersPage.jsx';
import ApplyLeavePage from './ApplyLeavePage.jsx';
import LeaveApprovalsPage from './LeaveApprovalsPage.jsx';
import LeaveBalanceReportPage from './LeaveBalanceReportPage.jsx';
import LeaveTypesPage from './LeaveTypesPage.jsx';
import MyLeavePage from './MyLeavePage.jsx';
import TeamLeaveCalendarPage from './TeamLeaveCalendarPage.jsx';
import YearEndPage from './YearEndPage.jsx';
import AttendanceApprovalsPage from './AttendanceApprovalsPage.jsx';
import DailyAttendancePage from './DailyAttendancePage.jsx';
import MonthlyRegisterPage from './MonthlyRegisterPage.jsx';
import OvertimeRequestPage from './OvertimeRequestPage.jsx';
import PeriodLockPage from './PeriodLockPage.jsx';
import RegularisationRequestPage from './RegularisationRequestPage.jsx';
import PoliciesPage from './PoliciesPage.jsx';
import PolicyAssignmentPage from './PolicyAssignmentPage.jsx';
import PolicyEditorPage from './PolicyEditorPage.jsx';
import RosterPlannerPage from './RosterPlannerPage.jsx';
import ShiftEditorPage from './ShiftEditorPage.jsx';
import ShiftsPage from './ShiftsPage.jsx';
import CrewPage from './CrewPage.jsx';
import CrewsPage from './CrewsPage.jsx';
import DeploymentBoardPage from './DeploymentBoardPage.jsx';
import DeploymentPage from './DeploymentPage.jsx';
import DeploymentsPage from './DeploymentsPage.jsx';
import NewDeploymentPage from './NewDeploymentPage.jsx';
import NewTransferPage from './NewTransferPage.jsx';
import TransferPage from './TransferPage.jsx';
import TransfersPage from './TransfersPage.jsx';
import CandidatePipelinePage from './CandidatePipelinePage.jsx';
import Employee360Page from './Employee360Page.jsx';
import EmployeeDirectoryPage from './EmployeeDirectoryPage.jsx';
import HrOverviewPage from './HrOverviewPage.jsx';
import NewEmployeePage from './NewEmployeePage.jsx';
import NewRequisitionPage from './NewRequisitionPage.jsx';
import OfferBuilderPage from './OfferBuilderPage.jsx';
import OffersPage from './OffersPage.jsx';
import OnboardingPage from './OnboardingPage.jsx';
import RequisitionPage from './RequisitionPage.jsx';
import RequisitionsPage from './RequisitionsPage.jsx';

// Module "hr" (part 07.01): the employee master. HR Overview (dashboard), Employee Directory (list), Employee 360 (object, with the signed-in person's own record at ?me=1) and the New Employee wizard (form).
registerModule({
  code: 'hr',
  label: 'HR & Workforce',
  routes: [
    { path: '/hr', label: 'HR Overview', icon: 'erp.group.workforce', permission: 'hr.employee.view', flag: 'ff.hr.p0701', Page: HrOverviewPage },
    { path: '/hr/employees', label: 'Employee Directory', icon: 'erp.action.search', permission: 'hr.employee.team.view', flag: 'ff.hr.p0701', Page: EmployeeDirectoryPage },
    { path: '/hr/employees/employee', label: 'Employee 360', icon: 'erp.action.info', permission: null, flag: 'ff.hr.p0701', Page: Employee360Page },
    { path: '/hr/employees/new', label: 'New Employee', icon: 'erp.action.create', permission: 'hr.employee.create', flag: 'ff.hr.p0701', Page: NewEmployeePage },
    { path: '/hr/requisitions', label: 'Manpower Requisitions', icon: 'erp.action.history', permission: 'hr.requisition.view', flag: 'ff.hr.p0702', Page: RequisitionsPage },
    { path: '/hr/requisitions/requisition', label: 'Requisition', icon: 'erp.action.info', permission: 'hr.requisition.view', flag: 'ff.hr.p0702', Page: RequisitionPage },
    { path: '/hr/requisitions/new', label: 'New Requisition', icon: 'erp.action.create', permission: 'hr.requisition.create', flag: 'ff.hr.p0702', Page: NewRequisitionPage },
    { path: '/hr/recruitment', label: 'Candidate Pipeline', icon: 'erp.action.inbox', permission: 'hr.candidate.view', flag: 'ff.hr.p0702', Page: CandidatePipelinePage },
    { path: '/hr/recruitment/candidate', label: 'Candidate', icon: 'erp.action.info', permission: null, flag: 'ff.hr.p0702', Page: CandidatePage },
    { path: '/hr/offers', label: 'Offers', icon: 'erp.action.history', permission: 'hr.offer.view', flag: 'ff.hr.p0702', Page: OffersPage },
    { path: '/hr/offers/offer', label: 'Offer Builder', icon: 'erp.action.create', permission: 'hr.offer.view', flag: 'ff.hr.p0702', Page: OfferBuilderPage },
    { path: '/hr/onboarding', label: 'Onboarding Checklist', icon: 'erp.action.inbox', permission: 'hr.onboarding.view', flag: 'ff.hr.p0702', Page: OnboardingPage },
    { path: '/hr/deployment-board', label: 'Deployment Board', icon: 'erp.action.history', permission: 'hr.deployment.view', flag: 'ff.hr.p0703', Page: DeploymentBoardPage },
    { path: '/hr/deployments', label: 'Deployments', icon: 'erp.action.history', permission: 'hr.deployment.view', flag: 'ff.hr.p0703', Page: DeploymentsPage },
    { path: '/hr/deployments/deployment', label: 'Deployment', icon: 'erp.action.info', permission: 'hr.deployment.view', flag: 'ff.hr.p0703', Page: DeploymentPage },
    { path: '/hr/deployments/new', label: 'New Deployment / Bulk Deploy', icon: 'erp.action.create', permission: 'hr.deployment.create', flag: 'ff.hr.p0703', Page: NewDeploymentPage },
    { path: '/hr/crews', label: 'Crews & Gangs', icon: 'erp.action.history', permission: 'hr.crew.view', flag: 'ff.hr.p0703', Page: CrewsPage },
    { path: '/hr/crews/crew', label: 'Crew', icon: 'erp.action.info', permission: 'hr.crew.view', flag: 'ff.hr.p0703', Page: CrewPage },
    { path: '/hr/transfers', label: 'Transfers', icon: 'erp.action.history', permission: 'hr.transfer.view', flag: 'ff.hr.p0703', Page: TransfersPage },
    { path: '/hr/transfers/transfer', label: 'Transfer', icon: 'erp.action.info', permission: 'hr.transfer.view', flag: 'ff.hr.p0703', Page: TransferPage },
    { path: '/hr/transfers/new', label: 'Transfer Request', icon: 'erp.action.create', permission: 'hr.transfer.create', flag: 'ff.hr.p0703', Page: NewTransferPage },
    { path: '/hr/attendance/shifts', label: 'Shifts', icon: 'erp.action.history', permission: 'att.shift.view', flag: 'ff.hr.p0704', Page: ShiftsPage },
    { path: '/hr/attendance/shifts/shift', label: 'Shift Editor', icon: 'erp.action.info', permission: 'att.shift.view', flag: 'ff.hr.p0704', Page: ShiftEditorPage },
    { path: '/hr/attendance/roster', label: 'Roster Planner', icon: 'erp.action.history', permission: 'att.roster.view', flag: 'ff.hr.p0704', Page: RosterPlannerPage },
    { path: '/hr/attendance/policies', label: 'Attendance Policies', icon: 'erp.action.history', permission: 'att.policy.view', flag: 'ff.hr.p0704', Page: PoliciesPage },
    { path: '/hr/attendance/policies/policy', label: 'Policy Rules Editor', icon: 'erp.action.info', permission: 'att.policy.view', flag: 'ff.hr.p0704', Page: PolicyEditorPage },
    { path: '/hr/attendance/assignment', label: 'Policy Assignment', icon: 'erp.action.history', permission: 'att.assignment.view', flag: 'ff.hr.p0704', Page: PolicyAssignmentPage },
    { path: '/att/punch', label: 'Punch In/Out', icon: 'erp.action.create', permission: 'att.punch.own', flag: 'ff.hr.p0705', Page: PunchPage },
    { path: '/att/crew-punch', label: 'Crew Punch', icon: 'erp.action.create', permission: 'att.punch.crew', flag: 'ff.hr.p0705', Page: CrewPunchPage },
    { path: '/att/kiosk', label: 'Kiosk Mode', icon: 'erp.action.create', permission: 'att.punch.kiosk', flag: 'ff.hr.p0705', Page: KioskPage },
    { path: '/att/anomalies', label: 'Attendance Anomalies', icon: 'erp.action.inbox', permission: 'att.anomaly.view', flag: 'ff.hr.p0705', Page: AnomaliesPage },
    { path: '/att/today', label: 'Attendance Today', icon: 'erp.action.history', permission: 'att.punch.view', flag: 'ff.hr.p0705', Page: TodayAttendancePage },
    { path: '/att/register', label: 'Monthly Attendance Register', icon: 'erp.action.history', permission: 'att.register.view', flag: 'ff.hr.p0706', Page: MonthlyRegisterPage },
    { path: '/att/daily', label: 'Daily Attendance', icon: 'erp.action.history', permission: 'att.register.view', flag: 'ff.hr.p0706', Page: DailyAttendancePage },
    { path: '/att/regularisation', label: 'Regularisation Request', icon: 'erp.action.create', permission: 'hr.regularisation.create', flag: 'ff.hr.p0706', Page: RegularisationRequestPage },
    { path: '/att/overtime', label: 'Overtime Request', icon: 'erp.action.create', permission: 'hr.overtime_request.create', flag: 'ff.hr.p0706', Page: OvertimeRequestPage },
    { path: '/att/approvals', label: 'Attendance Approvals', icon: 'erp.action.inbox', permission: 'att.register.view', flag: 'ff.hr.p0706', Page: AttendanceApprovalsPage },
    { path: '/att/lock', label: 'Period Lock', icon: 'erp.action.history', permission: 'att.register.view', flag: 'ff.hr.p0706', Page: PeriodLockPage },
    { path: '/leave/apply', label: 'Apply Leave', icon: 'erp.action.create', permission: 'hr.application.create', flag: 'ff.hr.p0707', Page: ApplyLeavePage },
    { path: '/leave/my', label: 'My Leave', icon: 'erp.action.history', permission: 'hr.application.view', flag: 'ff.hr.p0707', Page: MyLeavePage },
    { path: '/leave/approvals', label: 'Leave Approvals', icon: 'erp.action.inbox', permission: 'hr.application.approve', flag: 'ff.hr.p0707', Page: LeaveApprovalsPage },
    { path: '/leave/calendar', label: 'Team Leave Calendar', icon: 'erp.action.history', permission: 'lv.team.view', flag: 'ff.hr.p0707', Page: TeamLeaveCalendarPage },
    { path: '/leave/balances', label: 'Leave Balance Report', icon: 'erp.action.history', permission: 'lv.team.view', flag: 'ff.hr.p0707', Page: LeaveBalanceReportPage },
    { path: '/leave/types', label: 'Leave Types & Rules', icon: 'erp.action.info', permission: 'lv.type.view', flag: 'ff.hr.p0707', Page: LeaveTypesPage },
    { path: '/leave/year-end', label: 'Year-End Processing', icon: 'erp.action.create', permission: 'lv.yearend.run', flag: 'ff.hr.p0707', Page: YearEndPage },
    { path: '/labour/workers', label: 'Workers Register', icon: 'erp.action.history', permission: 'hr.worker.view', flag: 'ff.hr.p0708', Page: WorkersPage },
    { path: '/labour/workers/new', label: 'Register Worker', icon: 'erp.action.create', permission: 'hr.worker.create', flag: 'ff.hr.p0708', Page: RegisterWorkerPage },
    { path: '/labour/workers/worker', label: 'Worker', icon: 'erp.action.info', permission: 'hr.worker.view', flag: 'ff.hr.p0708', Page: WorkerPage },
    { path: '/labour/contractors', label: 'Labour Contractors', icon: 'erp.action.history', permission: 'hr.worker.view', flag: 'ff.hr.p0708', Page: ContractorsPage },
    { path: '/labour/contractors/contractor', label: 'Contractor compliance', icon: 'erp.action.info', permission: 'hr.worker.view', flag: 'ff.hr.p0708', Page: ContractorPage },
    { path: '/labour/wages', label: 'Wage Rates & Minimum Wages', icon: 'erp.action.info', permission: 'hr.worker.view', flag: 'ff.hr.p0708', Page: WageRatesPage },
    { path: '/labour/cards', label: 'Print Labour ID Cards', icon: 'erp.action.create', permission: 'hr.worker.print', flag: 'ff.hr.p0708', Page: PrintCardsPage },
    { path: '/my-hr', label: 'My HR', icon: 'erp.group.workforce', permission: 'hr.ess.view', flag: 'ff.hr.p0709', Page: MyHrPage },
    { path: '/my-hr/attendance', label: 'My Attendance', icon: 'erp.action.history', permission: 'hr.ess.view', flag: 'ff.hr.p0709', Page: MyAttendancePage },
    { path: '/my-hr/profile', label: 'Profile Change Request', icon: 'erp.action.create', permission: 'hr.ess.view', flag: 'ff.hr.p0709', Page: ProfileChangePage },
    { path: '/my-hr/letters', label: 'Letter Request', icon: 'erp.action.create', permission: 'hr.ess.letter.create', flag: 'ff.hr.p0709', Page: LetterRequestPage },
    { path: '/my-team', label: 'My Team', icon: 'erp.group.workforce', permission: 'hr.ess.team', flag: 'ff.hr.p0709', Page: MyTeamPage },
    { path: '/training', label: 'Training Calendar', icon: 'erp.group.workforce', permission: 'hr.session.view', flag: 'ff.hr.p0710', Page: TrainingCalendarPage },
    { path: '/training/session', label: 'Training Session', icon: 'erp.group.workforce', permission: 'hr.session.view', flag: 'ff.hr.p0710', Page: TrainingSessionPage },
    { path: '/training/certifications', label: 'Certifications & Licences', icon: 'erp.group.workforce', permission: 'hr.cert.view', flag: 'ff.hr.p0710', Page: CertificationsPage },
    { path: '/training/skills', label: 'Skill Matrix', icon: 'erp.group.workforce', permission: 'hr.skill.view', flag: 'ff.hr.p0710', Page: SkillMatrixPage },
    { path: '/training/compliance', label: 'Mandatory Training Compliance', icon: 'erp.group.workforce', permission: 'hr.training.report', flag: 'ff.hr.p0710', Page: ComplianceReportPage },
    { path: '/training/mine', label: 'My Training', icon: 'erp.group.workforce', permission: 'hr.training.own', flag: 'ff.hr.p0710', Page: MyTrainingPage },
    { path: '/training/setup', label: 'Training Set-up', icon: 'erp.action.settings', permission: 'hr.training.configure', flag: 'ff.hr.p0710', Page: TrainingSetupPage },
  ],
});
