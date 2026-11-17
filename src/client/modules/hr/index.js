import { registerModule } from '../../platform/shell/registry.js';
import { lazyPage } from '../../platform/shell/lazyPage.js';

// Each page is fetched when it is first opened (part 166.4); the routes themselves stay in the first download.
const AnomaliesPage = lazyPage(() => import('./AnomaliesPage.jsx'));
const CandidatePage = lazyPage(() => import('./CandidatePage.jsx'));
const CrewPunchPage = lazyPage(() => import('./CrewPunchPage.jsx'));
const KioskPage = lazyPage(() => import('./KioskPage.jsx'));
const PunchPage = lazyPage(() => import('./PunchPage.jsx'));
const TodayAttendancePage = lazyPage(() => import('./TodayAttendancePage.jsx'));
const CertificationsPage = lazyPage(() => import('./CertificationsPage.jsx'));
const ComplianceReportPage = lazyPage(() => import('./ComplianceReportPage.jsx'));
const MyTrainingPage = lazyPage(() => import('./MyTrainingPage.jsx'));
const SkillMatrixPage = lazyPage(() => import('./SkillMatrixPage.jsx'));
const TrainingCalendarPage = lazyPage(() => import('./TrainingCalendarPage.jsx'));
const TrainingSessionPage = lazyPage(() => import('./TrainingSessionPage.jsx'));
const TrainingSetupPage = lazyPage(() => import('./TrainingSetupPage.jsx'));
const FeedbackPage = lazyPage(() => import('./FeedbackPage.jsx'));
const GoalSettingPage = lazyPage(() => import('./GoalSettingPage.jsx'));
const KpiLibraryPage = lazyPage(() => import('./KpiLibraryPage.jsx'));
const MyPerformancePage = lazyPage(() => import('./MyPerformancePage.jsx'));
const ReviewPage = lazyPage(() => import('./ReviewPage.jsx'));
const ReviewsPage = lazyPage(() => import('./ReviewsPage.jsx'));
const TeamPerformancePage = lazyPage(() => import('./TeamPerformancePage.jsx'));
const AdvanceRequestPage = lazyPage(() => import('./AdvanceRequestPage.jsx'));
const ClaimApprovalsPage = lazyPage(() => import('./ClaimApprovalsPage.jsx'));
const ClaimPage = lazyPage(() => import('./ClaimPage.jsx'));
const ExpenseAnalysisPage = lazyPage(() => import('./ExpenseAnalysisPage.jsx'));
const ExpensePoliciesPage = lazyPage(() => import('./ExpensePoliciesPage.jsx'));
const MyExpensesPage = lazyPage(() => import('./MyExpensesPage.jsx'));
const TravelRequestPage = lazyPage(() => import('./TravelRequestPage.jsx'));
const ClearanceWorklistPage = lazyPage(() => import('./ClearanceWorklistPage.jsx'));
const DisciplinaryPage = lazyPage(() => import('./DisciplinaryPage.jsx'));
const GrievancePage = lazyPage(() => import('./GrievancePage.jsx'));
const GrievancesPage = lazyPage(() => import('./GrievancesPage.jsx'));
const RaiseGrievancePage = lazyPage(() => import('./RaiseGrievancePage.jsx'));
const ResignationPage = lazyPage(() => import('./ResignationPage.jsx'));
const SeparationPage = lazyPage(() => import('./SeparationPage.jsx'));
const SeparationsPage = lazyPage(() => import('./SeparationsPage.jsx'));
const LetterRequestPage = lazyPage(() => import('./LetterRequestPage.jsx'));
const MyAttendancePage = lazyPage(() => import('./MyAttendancePage.jsx'));
const MyHrPage = lazyPage(() => import('./MyHrPage.jsx'));
const MyTeamPage = lazyPage(() => import('./MyTeamPage.jsx'));
const ProfileChangePage = lazyPage(() => import('./ProfileChangePage.jsx'));
const ContractorPage = lazyPage(() => import('./ContractorPage.jsx'));
const ContractorsPage = lazyPage(() => import('./ContractorsPage.jsx'));
const PrintCardsPage = lazyPage(() => import('./PrintCardsPage.jsx'));
const RegisterWorkerPage = lazyPage(() => import('./RegisterWorkerPage.jsx'));
const WageRatesPage = lazyPage(() => import('./WageRatesPage.jsx'));
const WorkerPage = lazyPage(() => import('./WorkerPage.jsx'));
const WorkersPage = lazyPage(() => import('./WorkersPage.jsx'));
const ApplyLeavePage = lazyPage(() => import('./ApplyLeavePage.jsx'));
const LeaveApprovalsPage = lazyPage(() => import('./LeaveApprovalsPage.jsx'));
const LeaveBalanceReportPage = lazyPage(() => import('./LeaveBalanceReportPage.jsx'));
const LeaveTypesPage = lazyPage(() => import('./LeaveTypesPage.jsx'));
const MyLeavePage = lazyPage(() => import('./MyLeavePage.jsx'));
const TeamLeaveCalendarPage = lazyPage(() => import('./TeamLeaveCalendarPage.jsx'));
const YearEndPage = lazyPage(() => import('./YearEndPage.jsx'));
const AttendanceApprovalsPage = lazyPage(() => import('./AttendanceApprovalsPage.jsx'));
const DailyAttendancePage = lazyPage(() => import('./DailyAttendancePage.jsx'));
const MonthlyRegisterPage = lazyPage(() => import('./MonthlyRegisterPage.jsx'));
const OvertimeRequestPage = lazyPage(() => import('./OvertimeRequestPage.jsx'));
const PeriodLockPage = lazyPage(() => import('./PeriodLockPage.jsx'));
const RegularisationRequestPage = lazyPage(() => import('./RegularisationRequestPage.jsx'));
const PoliciesPage = lazyPage(() => import('./PoliciesPage.jsx'));
const PolicyAssignmentPage = lazyPage(() => import('./PolicyAssignmentPage.jsx'));
const PolicyEditorPage = lazyPage(() => import('./PolicyEditorPage.jsx'));
const RosterPlannerPage = lazyPage(() => import('./RosterPlannerPage.jsx'));
const ShiftEditorPage = lazyPage(() => import('./ShiftEditorPage.jsx'));
const ShiftsPage = lazyPage(() => import('./ShiftsPage.jsx'));
const CrewPage = lazyPage(() => import('./CrewPage.jsx'));
const CrewsPage = lazyPage(() => import('./CrewsPage.jsx'));
const DeploymentBoardPage = lazyPage(() => import('./DeploymentBoardPage.jsx'));
const DeploymentPage = lazyPage(() => import('./DeploymentPage.jsx'));
const DeploymentsPage = lazyPage(() => import('./DeploymentsPage.jsx'));
const NewDeploymentPage = lazyPage(() => import('./NewDeploymentPage.jsx'));
const NewTransferPage = lazyPage(() => import('./NewTransferPage.jsx'));
const TransferPage = lazyPage(() => import('./TransferPage.jsx'));
const TransfersPage = lazyPage(() => import('./TransfersPage.jsx'));
const CandidatePipelinePage = lazyPage(() => import('./CandidatePipelinePage.jsx'));
const Employee360Page = lazyPage(() => import('./Employee360Page.jsx'));
const EmployeeDirectoryPage = lazyPage(() => import('./EmployeeDirectoryPage.jsx'));
const HrOverviewPage = lazyPage(() => import('./HrOverviewPage.jsx'));
const WorkforcePage = lazyPage(() => import('./GatePages.jsx'), 'WorkforcePage');
const GatesPage = lazyPage(() => import('./GatePages.jsx'), 'GatesPage');
const GatePage = lazyPage(() => import('./GatePages.jsx'), 'GatePage');
const NewEmployeePage = lazyPage(() => import('./NewEmployeePage.jsx'));
const NewRequisitionPage = lazyPage(() => import('./NewRequisitionPage.jsx'));
const OfferBuilderPage = lazyPage(() => import('./OfferBuilderPage.jsx'));
const OffersPage = lazyPage(() => import('./OffersPage.jsx'));
const OnboardingPage = lazyPage(() => import('./OnboardingPage.jsx'));
const RequisitionPage = lazyPage(() => import('./RequisitionPage.jsx'));
const RequisitionsPage = lazyPage(() => import('./RequisitionsPage.jsx'));

// Module "hr" (part 07.01): the employee master. HR Overview (dashboard), Employee Directory (list), Employee 360 (object, with the signed-in person's own record at ?me=1) and the New Employee wizard (form).
registerModule({
  code: 'hr',
  label: 'HR & Workforce',
  routes: [
    { path: '/hr', label: 'HR Overview', icon: 'erp.group.workforce', permission: 'hr.employee.view', flag: 'ff.hr.p0701', Page: HrOverviewPage },
    // part 07.14 (built in 166.6): the workforce dashboard and the gates G1–G4
    { path: '/hr/workforce', label: 'Workforce Dashboard', icon: 'erp.group.workforce', permission: 'hr.workforce.view', flag: 'ff.hr.p0714', Page: WorkforcePage },
    { path: '/admin/gates', label: 'Programme Gates', icon: 'erp.state.approved', permission: 'hr.gate.view', flag: 'ff.hr.p0714', Page: GatesPage },
    { path: '/admin/gate', label: 'Gate', menu: false, icon: 'erp.state.approved', permission: 'hr.gate.view', flag: 'ff.hr.p0714', Page: GatePage },
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
    { path: '/labour/workers/worker', label: 'Worker', menu: false, icon: 'erp.action.info', permission: 'hr.worker.view', flag: 'ff.hr.p0708', Page: WorkerPage },
    { path: '/labour/contractors', label: 'Labour Contractors', icon: 'erp.action.history', permission: 'hr.worker.view', flag: 'ff.hr.p0708', Page: ContractorsPage },
    { path: '/labour/contractors/contractor', label: 'Contractor compliance', menu: false, icon: 'erp.action.info', permission: 'hr.worker.view', flag: 'ff.hr.p0708', Page: ContractorPage },
    { path: '/labour/wages', label: 'Wage Rates & Minimum Wages', icon: 'erp.action.info', permission: 'hr.worker.view', flag: 'ff.hr.p0708', Page: WageRatesPage },
    { path: '/labour/cards', label: 'Print Labour ID Cards', icon: 'erp.action.create', permission: 'hr.worker.print', flag: 'ff.hr.p0708', Page: PrintCardsPage },
    { path: '/my-hr', label: 'My HR', icon: 'erp.group.workforce', permission: 'hr.ess.view', flag: 'ff.hr.p0709', Page: MyHrPage },
    { path: '/my-hr/attendance', label: 'My Attendance', icon: 'erp.action.history', permission: 'hr.ess.view', flag: 'ff.hr.p0709', Page: MyAttendancePage },
    { path: '/my-hr/profile', label: 'Profile Change Request', icon: 'erp.action.create', permission: 'hr.ess.view', flag: 'ff.hr.p0709', Page: ProfileChangePage },
    { path: '/my-hr/letters', label: 'Letter Request', icon: 'erp.action.create', permission: 'hr.ess.letter.create', flag: 'ff.hr.p0709', Page: LetterRequestPage },
    { path: '/my-team', label: 'My Team', icon: 'erp.group.workforce', permission: 'hr.ess.team', flag: 'ff.hr.p0709', Page: MyTeamPage },
    { path: '/training', label: 'Training Calendar', icon: 'erp.group.workforce', permission: 'hr.session.view', flag: 'ff.hr.p0710', Page: TrainingCalendarPage },
    { path: '/training/session', label: 'Training Session', menu: false, icon: 'erp.group.workforce', permission: 'hr.session.view', flag: 'ff.hr.p0710', Page: TrainingSessionPage },
    { path: '/training/certifications', label: 'Certifications & Licences', icon: 'erp.group.workforce', permission: 'hr.cert.view', flag: 'ff.hr.p0710', Page: CertificationsPage },
    { path: '/training/skills', label: 'Skill Matrix', icon: 'erp.group.workforce', permission: 'hr.skill.view', flag: 'ff.hr.p0710', Page: SkillMatrixPage },
    { path: '/training/compliance', label: 'Mandatory Training Compliance', icon: 'erp.group.workforce', permission: 'hr.training.report', flag: 'ff.hr.p0710', Page: ComplianceReportPage },
    { path: '/training/mine', label: 'My Training', icon: 'erp.group.workforce', permission: 'hr.training.own', flag: 'ff.hr.p0710', Page: MyTrainingPage },
    { path: '/training/setup', label: 'Training Set-up', icon: 'erp.action.settings', permission: 'hr.training.configure', flag: 'ff.hr.p0710', Page: TrainingSetupPage },
    { path: '/performance', label: 'My Performance', icon: 'erp.group.workforce', permission: 'hr.perf.own', flag: 'ff.hr.p0711', Page: MyPerformancePage },
    { path: '/performance/team', label: 'Team Performance', icon: 'erp.group.workforce', permission: 'hr.perf.team', flag: 'ff.hr.p0711', Page: TeamPerformancePage },
    { path: '/performance/goals', label: 'Goal Setting', icon: 'erp.action.create', permission: 'hr.perf.own', flag: 'ff.hr.p0711', Page: GoalSettingPage },
    { path: '/performance/review', label: 'Appraisal Review', menu: false, icon: 'erp.group.workforce', permission: 'hr.review.view', flag: 'ff.hr.p0711', Page: ReviewPage },
    { path: '/performance/reviews', label: 'Appraisal Reviews', icon: 'erp.group.workforce', permission: 'hr.review.view', flag: 'ff.hr.p0711', Page: ReviewsPage },
    { path: '/performance/feedback', label: 'Feedback & One-to-One', icon: 'erp.group.workforce', permission: 'hr.perf.own', flag: 'ff.hr.p0711', Page: FeedbackPage },
    { path: '/performance/kpis', label: 'KPI Library & Cycles', icon: 'erp.action.settings', permission: 'hr.perf.configure', flag: 'ff.hr.p0711', Page: KpiLibraryPage },
    { path: '/expenses', label: 'My Claims & Advances', icon: 'erp.group.workforce', permission: 'hr.claim.view', flag: 'ff.hr.p0712', Page: MyExpensesPage },
    { path: '/expenses/claim', label: 'New Expense Claim', icon: 'erp.action.create', permission: 'hr.claim.view', flag: 'ff.hr.p0712', Page: ClaimPage },
    { path: '/expenses/travel', label: 'Travel Request', icon: 'erp.action.create', permission: 'hr.travel_request.view', flag: 'ff.hr.p0712', Page: TravelRequestPage },
    { path: '/expenses/advance', label: 'Advance Request', icon: 'erp.action.create', permission: 'hr.advance.view', flag: 'ff.hr.p0712', Page: AdvanceRequestPage },
    { path: '/expenses/approvals', label: 'Claim Approvals', icon: 'erp.action.approve', permission: 'hr.claim.approve', flag: 'ff.hr.p0712', Page: ClaimApprovalsPage },
    { path: '/expenses/analysis', label: 'Expense Analysis', icon: 'erp.group.workforce', permission: 'hr.expense.report', flag: 'ff.hr.p0712', Page: ExpenseAnalysisPage },
    { path: '/expenses/policies', label: 'Expense Policies', icon: 'erp.action.settings', permission: 'hr.expense.configure', flag: 'ff.hr.p0712', Page: ExpensePoliciesPage },
    { path: '/exit/resign', label: 'Resignation', icon: 'erp.action.create', permission: 'hr.separation.create', flag: 'ff.hr.p0713', Page: ResignationPage },
    { path: '/exit/separations', label: 'Separations', icon: 'erp.group.workforce', permission: 'hr.separation.view_all', flag: 'ff.hr.p0713', Page: SeparationsPage },
    { path: '/exit/separation', label: 'Separation', menu: false, icon: 'erp.group.workforce', permission: 'hr.separation.view', flag: 'ff.hr.p0713', Page: SeparationPage },
    { path: '/exit/clearances', label: 'My Clearance Items', icon: 'erp.action.approve', permission: 'hr.clearance.view', flag: 'ff.hr.p0713', Page: ClearanceWorklistPage },
    { path: '/grievances', label: 'Grievances', icon: 'erp.group.workforce', permission: 'hr.grievance.view', flag: 'ff.hr.p0713', Page: GrievancesPage },
    { path: '/grievances/new', label: 'Raise Grievance', icon: 'erp.action.create', permission: 'hr.grievance.create', flag: 'ff.hr.p0713', Page: RaiseGrievancePage },
    { path: '/grievances/grievance', label: 'Grievance', menu: false, icon: 'erp.group.workforce', permission: 'hr.grievance.view', flag: 'ff.hr.p0713', Page: GrievancePage },
    { path: '/disciplinary', label: 'Disciplinary Cases', icon: 'erp.group.workforce', permission: 'hr.disciplinary.view', flag: 'ff.hr.p0713', Page: DisciplinaryPage },
    { path: '/disciplinary/mine', label: 'My Disciplinary Cases', icon: 'erp.group.workforce', permission: 'hr.separation.view', flag: 'ff.hr.p0713', Page: DisciplinaryPage },
  ],
});
