import { registerModule } from '../../platform/shell/registry.js';
import CostCentresPage from './pages/CostCentresPage.jsx';
import LoginHistoryPage from './pages/LoginHistoryPage.jsx';
import OrgChartPage from './pages/OrgChartPage.jsx';
import OrganisationPage from './pages/OrganisationPage.jsx';
import PolicyPage from './pages/PolicyPage.jsx';
import ProjectsPage from './pages/ProjectsPage.jsx';
import SecurityPage from './pages/SecurityPage.jsx';
import SessionsPage from './pages/SessionsPage.jsx';
import AssignmentsPage from './pages/AssignmentsPage.jsx';
import EffectivePage from './pages/EffectivePage.jsx';
import LegacyAccessPage from './pages/LegacyAccessPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import RolesPage from './pages/RolesPage.jsx';
import UsersPage from './pages/UsersPage.jsx';
import WelcomePage from './pages/WelcomePage.jsx';

// Module "iam" registers its pages once (part 02.01). The sign-in screen is not a route: the shell shows it before anything else.
registerModule({
  code: 'iam',
  label: 'Identity & Security',
  routes: [
    // `onboarding` marks the pages a person with no approved role may open (part 02.03); `onboardingOnly` shows the entry only to them.
    { path: '/welcome', label: 'Welcome', flag: 'ff.iam.p0203', onboarding: true, onboardingOnly: true, Page: WelcomePage },
    { path: '/account/profile', label: 'My Profile', flag: 'ff.iam.p0203', onboarding: true, Page: ProfilePage },
    { path: '/account/security', label: 'Security & MFA', flag: 'ff.iam.p0201', onboarding: true, Page: SecurityPage },
    { path: '/account/sessions', label: 'My Sessions', flag: 'ff.iam.p0201', onboarding: true, Page: SessionsPage },
    { path: '/admin/users', label: 'Users', permission: 'iam.user.view', flag: 'ff.iam.p0203', Page: UsersPage },
    { path: '/admin/roles', label: 'Roles', permission: 'iam.role.view', flag: 'ff.iam.p0204', Page: RolesPage },
    { path: '/admin/assignments', label: 'Assignments', permission: 'iam.assignment.view', flag: 'ff.iam.p0204', Page: AssignmentsPage },
    { path: '/admin/effective-access', label: 'Effective Permissions', permission: 'iam.role.view', flag: 'ff.iam.p0204', Page: EffectivePage },
    { path: '/admin/legacy-access', label: 'Legacy Access Comparison', permission: 'iam.role.view', flag: 'ff.iam.p0204', Page: LegacyAccessPage },
    { path: '/admin/security/policy', label: 'Authentication Policy', permission: 'iam.security.view', flag: 'ff.iam.p0201', Page: PolicyPage },
    { path: '/admin/organisation', label: 'Organisation', permission: 'org.view', flag: 'ff.iam.p0202', Page: OrganisationPage },
    { path: '/admin/projects', label: 'Projects & Sites', permission: 'org.view', flag: 'ff.iam.p0202', Page: ProjectsPage },
    { path: '/admin/org-chart', label: 'Organisation Chart', permission: 'org.view', flag: 'ff.iam.p0202', Page: OrgChartPage },
    { path: '/admin/cost-centres', label: 'Cost & Profit Centres', permission: 'org.view', flag: 'ff.iam.p0202', Page: CostCentresPage },
    { path: '/admin/security/login-history', label: 'Login History', permission: 'iam.security.view', flag: 'ff.iam.p0201', Page: LoginHistoryPage },
  ],
});
