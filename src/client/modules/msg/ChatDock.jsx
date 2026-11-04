import { useEffect, useRef, useState } from 'react';
import { useLayout } from '../../platform/device/layout.js';
import { ConversationView, chatWindows, useChatWindows } from '../../platform/messages/Chat.jsx';
import { beat, callApi, useUnread } from '../../platform/messages/api.js';
import { useLiveRefresh, follow } from '../../platform/realtime/socket.js';
import Icon from '../../platform/design/Icon.jsx';

// The mini chat dock (part 05.01, FR-07) and what must reach a person on any page (part 05.02): the heartbeat that says they are online, and a call that rings. On a computer, small chat windows float over any page
// (up to three) with a button that shows the unread count; a ringing call shows on every screen with Answer and Decline.
const go = (to) => { window.history.pushState(null, '', to); window.dispatchEvent(new PopStateEvent('popstate')); };

function useRinging(user) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    let live = true;
    const load = () => callApi.ringing().then((r) => live && setRows(r)).catch(() => {});
    load();
    const t = setInterval(load, 8000);
    const off = user ? follow(`user:${user}`, (ev) => {
      if (ev.type === 'msg.call.ringing') load();
      if (ev.type === 'msg.call.state' && ['DECLINED', 'MISSED', 'ENDED', 'ACTIVE'].includes(ev.data?.status)) load();
    }) : () => {};
    return () => { live = false; clearInterval(t); off(); };
  }, [user]);
  return [rows, setRows];
}
/** A ringtone made with the browser's own sound generator (nothing to download); it may stay silent where the browser requires a tap first. */
function useRingtone(on) {
  const ctx = useRef(null);
  useEffect(() => {
    if (!on) return undefined;
    let timer = null;
    const tone = () => {
      try {
        ctx.current ??= new (globalThis.AudioContext ?? globalThis.webkitAudioContext)();
        const a = ctx.current; const o = a.createOscillator(); const g = a.createGain();
        o.frequency.value = 520; g.gain.value = 0.05; o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + 0.4);
        navigator.vibrate?.([200, 100, 200]);
      } catch { /* silent */ }
    };
    tone(); timer = setInterval(tone, 2200);
    return () => clearInterval(timer);
  }, [on]);
}

export default function ChatDock({ session }) {
  const layout = useLayout();
  const wins = useChatWindows();
  const unread = useUnread();
  const [ringing, setRinging] = useRinging(session?.user);
  useLiveRefresh(session?.user ? [`user:${session.user}`] : [], [['msg']]);
  useRingtone(ringing.length > 0);
  useEffect(() => {
    const send = () => beat(document.visibilityState === 'hidden' ? 'AWAY' : 'ONLINE');
    send();
    const t = setInterval(send, 30_000);
    document.addEventListener('visibilitychange', send);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', send); };
  }, []);
  const onCallPage = window.location.pathname.startsWith('/collab/call');
  const n = unread.data?.unread ?? 0;
  const answer = (c) => { setRinging((rs) => rs.filter((r) => r.id !== c.id)); go(`/collab/call?call=${c.id}`); };
  const decline = async (c) => { setRinging((rs) => rs.filter((r) => r.id !== c.id)); try { await callApi.decline(c.id); } catch { /* it stopped ringing already */ } };
  return (
    <>
      {ringing.length > 0 && !onCallPage && (
        <div className="msg-ringing" role="alertdialog" aria-label="Incoming call" aria-live="assertive" data-testid="ringing">
          {ringing.map((c) => (
            <div key={c.id} className="msg-ring-card">
              <strong>{c.startedBy.name}</strong> is calling you ({c.type === 'VIDEO' ? 'video' : 'voice'})
              <div className="actions"><button type="button" className="btn btn-primary btn-large" onClick={() => answer(c)} data-testid="ring-answer">Answer</button><button type="button" className="btn btn-large" onClick={() => decline(c)} data-testid="ring-decline">Decline</button></div>
            </div>
          ))}
        </div>
      )}
      {layout === 'desktop' && !window.location.pathname.startsWith('/collab/messages') && !onCallPage && (
        <div className="msg-dock" data-testid="msg-dock" role="region" aria-label="Chats">
          {wins.map((w) => (
            <div key={w.id} className={`msg-minichat${w.min ? ' is-min' : ''}`} data-testid="minichat">
              {w.min ? <button type="button" className="btn" onClick={() => chatWindows.toggle(w.id)}>Chat {w.id}</button> : <ConversationView id={w.id} session={session} compact onClose={() => chatWindows.close(w.id)} onMinimise={() => chatWindows.toggle(w.id)} />}
            </div>
          ))}
          <a className="btn btn-primary msg-dock-button" href="/collab/messages" data-testid="dock-open" onClick={(e) => { e.preventDefault(); go('/collab/messages'); }}>
            <Icon name="erp.action.comment" size={18} /> Messages{n > 0 && <span className="op-count" aria-label={`${n} unread`} data-testid="dock-unread">{n}</span>}
          </a>
        </div>
      )}
    </>
  );
}
