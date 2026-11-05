import { registerModule } from '../../platform/shell/registry.js';
import CandidatePage from './CandidatePage.jsx';
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
  ],
});
