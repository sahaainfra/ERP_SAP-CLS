import { registerModule } from '../../platform/shell/registry.js';
import MessagesPage from './MessagesPage.jsx';
import NewConversationPage from './NewConversationPage.jsx';
import CallPage from './CallPage.jsx';
import MessagingSettingsPage from './MessagingSettingsPage.jsx';
import SafetyNumberPage from './SafetyNumberPage.jsx';
import LicenceRegisterPage from './LicenceRegisterPage.jsx';
import SecurePolicyPage from './SecurePolicyPage.jsx';

// Module "msg" (part 05.01): the unified Messages app. One entry in the navigation; the old chat and channel screens do not exist as separate pages.
registerModule({
  code: 'msg',
  label: 'Collaboration & Messaging',
  routes: [
    { path: '/collab/messages', label: 'Messages', icon: 'erp.action.inbox', flag: 'ff.msg.p0501', Page: MessagesPage },
    { path: '/collab/call', label: 'Call', icon: 'erp.action.camera', flag: 'ff.msg.p0502', Page: CallPage },
    { path: '/admin/messaging', label: 'Messaging Settings', icon: 'erp.action.settings', permission: 'msg.settings.view', flag: 'ff.msg.p0502', Page: MessagingSettingsPage },
    { path: '/collab/safety-number', label: 'Safety Number Verification', icon: 'erp.action.lock', flag: 'ff.msg.p0503', Page: SafetyNumberPage },
    { path: '/admin/secure-messaging', label: 'Secure Messaging Policy', icon: 'erp.action.lock', permission: 'sec.policy.view', flag: 'ff.msg.p0503', Page: SecurePolicyPage },
    { path: '/admin/licences', label: 'Open-Source Licence Register', icon: 'erp.action.info', permission: 'sec.licence.view', flag: 'ff.msg.p0503', Page: LicenceRegisterPage },
    { path: '/collab/messages/new', label: 'New conversation', icon: 'erp.action.create', flag: 'ff.msg.p0501', Page: NewConversationPage },
  ],
});
