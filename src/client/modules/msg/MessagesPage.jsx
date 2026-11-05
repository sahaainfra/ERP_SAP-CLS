import { useEffect, useState } from 'react';
import Icon from '../../platform/design/Icon.jsx';
import { EmptyState } from '../../platform/feedback/states.jsx';
import { useLayout } from '../../platform/device/layout.js';
import { ConversationList, ConversationView, Details, chatWindows } from '../../platform/messages/Chat.jsx';
import { navigateTo, usePageTitle } from '../core/pages/ui.jsx';

// Messages (part 05.01, section 7.1): one list of conversations (direct, group, department, project, site, team, record-linked and the external threads of the gateway), one conversation with its composer and its details.
// Three panes on a computer (list, conversation, details), two on a tablet (details open over the conversation), one on a phone (the list, then the conversation with a back button).
const fromUrl = () => Number(new URLSearchParams(window.location.search).get('c')) || null;
const viewFromUrl = () => new URLSearchParams(window.location.search).get('view') || 'all';
const messageFromUrl = () => Number(new URLSearchParams(window.location.search).get('m')) || null;

export default function MessagesPage({ session }) {
  usePageTitle('Messages');
  const layout = useLayout();
  const [active, setActive] = useState(fromUrl);
  const [around, setAround] = useState(messageFromUrl);
  const [details, setDetails] = useState(null); // null: the default for the width (open on a computer, closed on a tablet and a phone)
  const [filters, setFilters] = useState({ view: viewFromUrl(), q: '' });
  useEffect(() => {
    const onPop = () => { setActive(fromUrl()); setAround(messageFromUrl()); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const open = (id, messageId = null) => { window.history.pushState(null, '', id ? `/collab/messages?c=${id}${messageId ? `&m=${messageId}` : ''}` : '/collab/messages'); setActive(id); setAround(messageId); setDetails(null); };
  const phone = layout === 'phone';
  const showList = !phone || !active;
  const showConv = !phone || Boolean(active);
  const detailsOpen = details ?? layout === 'desktop';
  const showDetails = Boolean(active) && detailsOpen;
  return (
    <section aria-labelledby="msg-title" className={`msg-app msg-${layout}`} data-testid="messages" data-layout={layout}>
      <div className="page-head"><h1 id="msg-title">Messages</h1>
        <button type="button" className="btn btn-primary" onClick={() => navigateTo('/collab/messages/new')} data-testid="msg-new"><Icon name="erp.action.create" size={18} /> New</button>
      </div>
      <div className="msg-panes">
        {showList && <div className="msg-pane msg-pane-list"><ConversationList activeId={active} onOpen={open} filters={filters} setFilters={setFilters} session={session} /></div>}
        {showConv && (
          <div className="msg-pane msg-pane-conv">
            {active ? <ConversationView id={active} around={around} session={session} onBack={phone ? () => open(null) : undefined} onDetails={() => setDetails(!detailsOpen)} onPopOut={layout === 'desktop' ? () => { chatWindows.open(active); open(null); } : undefined} />
              : <EmptyState title="Choose a conversation" message="Pick one from the list, or start a new one." action={{ label: 'New conversation', onClick: () => navigateTo('/collab/messages/new') }} />}
          </div>
        )}
        {showDetails && active && <div className={`msg-pane msg-pane-details${layout === 'desktop' ? '' : ' is-overlay'}`}><Details id={active} session={session} onClose={() => setDetails(false)} onLeft={() => open(null)} /></div>}
      </div>
    </section>
  );
}
