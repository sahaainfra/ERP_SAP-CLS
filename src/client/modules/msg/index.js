import { registerModule } from '../../platform/shell/registry.js';
import MessagesPage from './MessagesPage.jsx';
import NewConversationPage from './NewConversationPage.jsx';

// Module "msg" (part 05.01): the unified Messages app. One entry in the navigation; the old chat and channel screens do not exist as separate pages.
registerModule({
  code: 'msg',
  label: 'Collaboration & Messaging',
  routes: [
    { path: '/collab/messages', label: 'Messages', icon: 'erp.action.inbox', flag: 'ff.msg.p0501', Page: MessagesPage },
    { path: '/collab/messages/new', label: 'New conversation', icon: 'erp.action.create', flag: 'ff.msg.p0501', Page: NewConversationPage },
  ],
});
