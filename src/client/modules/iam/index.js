import { registerModule } from '../../platform/shell/registry.js';
import { lazyPage } from '../../platform/shell/lazyPage.js';

// Each page is fetched when it is first opened (part 166.4); the routes themselves stay in the first download.
const CostCentresPage = lazyPage(() => import('./pages/CostCentresPage.jsx'));
const LoginHistoryPage = lazyPage(() => import('./pages/LoginHistoryPage.jsx'));
const OrgChartPage = lazyPage(() => import('./pages/OrgChartPage.jsx'));
const OrganisationPage = lazyPage(() => import('./pages/OrganisationPage.jsx'));
const PolicyPage = lazyPage(() => import('./pages/PolicyPage.jsx'));
const ProjectsPage = lazyPage(() => import('./pages/ProjectsPage.jsx'));
const SecurityPage = lazyPage(() => import('./pages/SecurityPage.jsx'));
const SessionsPage = lazyPage(() => import('./pages/SessionsPage.jsx'));
const AssignmentsPage = lazyPage(() => import('./pages/AssignmentsPage.jsx'));
const EffectivePage = lazyPage(() => import('./pages/EffectivePage.jsx'));
const LegacyAccessPage = lazyPage(() => import('./pages/LegacyAccessPage.jsx'));
const ProfilePage = lazyPage(() => import('./pages/ProfilePage.jsx'));
const RolesPage = lazyPage(() => import('./pages/RolesPage.jsx'));
const UsersPage = lazyPage(() => import('./pages/UsersPage.jsx'));
const WelcomePage = lazyPage(() => import('./pages/WelcomePage.jsx'));
const AccessReviewsPage = lazyPage(() => import('./pages/AccessReviewsPage.jsx'));
const MyAccessReviewPage = lazyPage(() => import('./pages/AccessReviewsPage.jsx'), 'MyAccessReviewPage');
const ElevationPage = lazyPage(() => import('./pages/ElevationPage.jsx'));
const ElevationApprovalsPage = lazyPage(() => import('./pages/ElevationPage.jsx'), 'ElevationApprovalsPage');
const SodRulesPage = lazyPage(() => import('./pages/SodRulesPage.jsx'));
const SodViolationsPage = lazyPage(() => import('./pages/SodViolationsPage.jsx'));

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
    { path: '/admin/sod/rules', label: 'SoD Rules', permission: 'iam.sod.view', flag: 'ff.iam.p0205', Page: SodRulesPage },
    { path: '/admin/sod/violations', label: 'SoD Violations', permission: 'iam.sod.view', flag: 'ff.iam.p0205', Page: SodViolationsPage },
    { path: '/account/elevation', label: 'Request Elevated Access', permission: 'iam.elevation.request', flag: 'ff.iam.p0205', Page: ElevationPage },
    { path: '/admin/elevation-approvals', label: 'Elevation Approvals', permission: 'iam.elevation.request', flag: 'ff.iam.p0205', Page: ElevationApprovalsPage },
    { path: '/admin/access-reviews', label: 'Access Reviews', permission: 'iam.review.view', flag: 'ff.iam.p0205', Page: AccessReviewsPage },
    { path: '/account/access-review', label: 'My Access Review', permission: 'iam.review.decide', flag: 'ff.iam.p0205', Page: MyAccessReviewPage },
    { path: '/admin/security/policy', label: 'Authentication Policy', permission: 'iam.security.view', flag: 'ff.iam.p0201', Page: PolicyPage },
    { path: '/admin/organisation', label: 'Organisation', permission: 'org.view', flag: 'ff.iam.p0202', Page: OrganisationPage },
    { path: '/admin/projects', label: 'Projects & Sites', permission: 'org.view', flag: 'ff.iam.p0202', Page: ProjectsPage },
    { path: '/admin/org-chart', label: 'Organisation Chart', permission: 'org.view', flag: 'ff.iam.p0202', Page: OrgChartPage },
    { path: '/admin/cost-centres', label: 'Cost & Profit Centres', permission: 'org.view', flag: 'ff.iam.p0202', Page: CostCentresPage },
    { path: '/admin/security/login-history', label: 'Login History', permission: 'iam.security.view', flag: 'ff.iam.p0201', Page: LoginHistoryPage },
  ],
});
