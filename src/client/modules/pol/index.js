import { registerModule } from '../../platform/shell/registry.js';
import MyPoliciesPage from './MyPoliciesPage.jsx';
import PolicyDraftsPage from './PolicyDraftsPage.jsx';
import PolicyEditorPage from './PolicyEditorPage.jsx';
import PolicyRegisterPage from './PolicyRegisterPage.jsx';

// Module "pol" (part 05.05): company policies. The register and the editor for the owners of policies, My Policies for every employee, and the drafts made from policy requirements for the administrators.
registerModule({
  code: 'pol',
  label: 'Company Policies',
  routes: [
    { path: '/collab/policies', label: 'Policy Register', icon: 'erp.action.history', permission: 'pol.policy.view_all', flag: 'ff.msg.p0505', Page: PolicyRegisterPage },
    { path: '/collab/policies/edit', label: 'Policy Editor', icon: 'erp.action.edit', permission: 'pol.policy.create', flag: 'ff.msg.p0505', Page: PolicyEditorPage },
    { path: '/collab/my-policies', label: 'My Policies', icon: 'erp.action.sign', flag: 'ff.msg.p0505', Page: MyPoliciesPage },
    { path: '/admin/policy-drafts', label: 'Policy-to-Protocol Drafts', icon: 'erp.action.settings', permission: 'pol.draft.view', flag: 'ff.msg.p0505', Page: PolicyDraftsPage },
  ],
});
