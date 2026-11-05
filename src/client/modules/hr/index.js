import { registerModule } from '../../platform/shell/registry.js';
import CandidatePage from './CandidatePage.jsx';
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
  ],
});
