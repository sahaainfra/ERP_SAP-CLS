import { useLayout } from '../../platform/device/layout.js';
import { ConversationView, chatWindows, useChatWindows } from '../../platform/messages/Chat.jsx';
import { useUnread } from '../../platform/messages/api.js';
import { useLiveRefresh } from '../../platform/realtime/socket.js';
import Icon from '../../platform/design/Icon.jsx';

// The mini chat dock (part 05.01, FR-07): on a computer, small chat windows over any page (up to three) and a button with the number of unread conversations that opens the Messages app.
export default function ChatDock({ session }) {
  const layout = useLayout();
  const wins = useChatWindows();
  const unread = useUnread();
  useLiveRefresh(session?.user ? [`user:${session.user}`] : [], [['msg']]);
  if (layout !== 'desktop' || window.location.pathname.startsWith('/collab/messages')) return null;
  const n = unread.data?.unread ?? 0;
  return (
    <div className="msg-dock" data-testid="msg-dock" role="region" aria-label="Chats">
      {wins.map((w) => (
        <div key={w.id} className={`msg-minichat${w.min ? ' is-min' : ''}`} data-testid="minichat">
          {w.min ? <button type="button" className="btn" onClick={() => chatWindows.toggle(w.id)}>Chat {w.id}</button> : <ConversationView id={w.id} session={session} compact onClose={() => chatWindows.close(w.id)} onMinimise={() => chatWindows.toggle(w.id)} />}
        </div>
      ))}
      <a className="btn btn-primary msg-dock-button" href="/collab/messages" data-testid="dock-open" onClick={(e) => { e.preventDefault(); window.history.pushState(null, '', '/collab/messages'); window.dispatchEvent(new PopStateEvent('popstate')); }}>
        <Icon name="erp.action.comment" size={18} /> Messages{n > 0 && <span className="op-count" aria-label={`${n} unread`} data-testid="dock-unread">{n}</span>}
      </a>
    </div>
  );
}
