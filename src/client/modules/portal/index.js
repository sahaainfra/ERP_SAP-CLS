import { registerModule } from '../../platform/shell/registry.js';
import { lazyPage } from '../../platform/shell/lazyPage.js';

const AccountsPage = lazyPage(() => import('./Admin.jsx'), 'AccountsPage');
const InvitePage = lazyPage(() => import('./Admin.jsx'), 'InvitePage');

registerModule({
  code: 'portal',
  label: 'External Portals',
  routes: [
    { path: '/admin/portal-users', label: 'Portal users', icon: 'erp.admin.iam', permission: 'portal.account.view', flag: 'ff.portal.p2501', Page: AccountsPage },
    { path: '/admin/portal-invite', label: 'Invite portal user', icon: 'erp.admin.iam', permission: 'portal.account.invite', flag: 'ff.portal.p2501', Page: InvitePage },
  ],
});
