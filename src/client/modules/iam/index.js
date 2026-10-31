import { registerModule } from '../../platform/shell/registry.js';
import LoginHistoryPage from './pages/LoginHistoryPage.jsx';
import PolicyPage from './pages/PolicyPage.jsx';
import SecurityPage from './pages/SecurityPage.jsx';
import SessionsPage from './pages/SessionsPage.jsx';

// Module "iam" registers its pages once (part 02.01). The sign-in screen is not a route: the shell shows it before anything else.
registerModule({
  code: 'iam',
  label: 'Identity & Security',
  routes: [
    { path: '/account/security', label: 'Security & MFA', flag: 'ff.iam.p0201', Page: SecurityPage },
    { path: '/account/sessions', label: 'My Sessions', flag: 'ff.iam.p0201', Page: SessionsPage },
    { path: '/admin/security/policy', label: 'Authentication Policy', permission: 'iam.security.view', flag: 'ff.iam.p0201', Page: PolicyPage },
    { path: '/admin/security/login-history', label: 'Login History', permission: 'iam.security.view', flag: 'ff.iam.p0201', Page: LoginHistoryPage },
  ],
});
