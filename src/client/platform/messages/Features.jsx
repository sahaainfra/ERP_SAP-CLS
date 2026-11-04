import { useEffect, useRef, useState } from 'react';
import Icon from '../design/Icon.jsx';
import { EmptyState, QueryError, Skeleton } from '../feedback/states.jsx';
import { formatDate, formatDateTime } from '../format.js';
import { follow } from '../realtime/socket.js';
import { fetchFileUrl } from '../../modules/core/api/index.js';
import { useFeatureActions, useMedia, useMeSettings, usePins, usePresence, useReceipts, useSearch, useStarred } from './api.js';

// The extra parts of a conversation (part 05.02): receipt ticks and who read, voice notes with their waveform, the typing line, presence, search results, pinned and starred messages, the media gallery and the
// person's privacy. Each asks the API for what it shows; the server decides what the person may see.
const errorText = (e) => `${e?.message ?? 'Something went wrong'}${e?.correlationId ? ` (Correlation ID: ${e.correlationId})` : ''}`;
const TICK = { sent: ['✓', 'Sent'], delivered: ['✓✓', 'Delivered'], read: ['✓✓', 'Read'] };

export function Ticks({ receipt, onClick }) {
  if (!receipt) return null;
  const [glyph, label] = TICK[receipt.state];
  const text = receipt.of > 1 ? `${label}: delivered to ${receipt.delivered} of ${receipt.of}, read by ${receipt.read}` : label;
  return <button type="button" className={`msg-ticks is-${receipt.state}`} aria-label={text} title={text} onClick={onClick} data-testid="msg-ticks" data-state={receipt.state}>{glyph}</button>;
}

export function ReceiptDetails({ messageId }) {
  const q = useReceipts(messageId, true);
  if (q.isPending) return <Skeleton label="Loading who read it" rows={1} />;
  if (q.isError) return <p className="field-error" role="alert">{errorText(q.error)}</p>;
  const d = q.data;
  return (
    <div className="msg-receipt-details" data-testid="receipt-details" role="group" aria-label="Who has had this message">
      <p className="muted small">Delivered to {d.delivered} of {d.total}, read by {d.read}{d.enforced ? ' (read receipts are required by your organisation)' : ''}.</p>
      <ul>{d.recipients.map((r) => <li key={r.username}><strong>{r.name}</strong> <span className="muted small">{r.readAt ? `read ${formatDateTime(r.readAt)}` : r.readHidden ? 'read (hidden by their setting)' : r.deliveredAt ? `delivered ${formatDateTime(r.deliveredAt)}` : 'not yet delivered'}</span></li>)}</ul>
    </div>
  );
}

/** A voice note: the bars are the loudness it was recorded with; pressing play fetches a link and plays it. */
export function VoicePlayer({ m }) {
  const [url, setUrl] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const audio = useRef(null);
  const file = m.attachments[0];
  const bars = m.voice?.waveform?.length ? m.voice.waveform : Array.from({ length: 24 }, () => 30);
  const toggle = async () => {
    let src = url;
    if (!src && file) { try { src = (await fetchFileUrl(file.id, {})).url; setUrl(src); } catch { return; } }
    const a = audio.current;
    if (!a) return;
    if (playing) { a.pause(); return; }
    a.src = src;
    a.play().catch(() => {});
  };
  const secs = Math.round((m.voice?.durationMs ?? 0) / 1000);
  return (
    <div className="msg-voice" data-testid="voice-note">
      <button type="button" className="btn btn-small" onClick={toggle} aria-label={playing ? 'Pause the voice note' : 'Play the voice note'} aria-pressed={playing}>{playing ? '❚❚' : '▶'}</button>
      <span className="msg-wave" role="img" aria-label={`Voice note, ${secs} seconds`}>{bars.map((b, i) => <i key={i} className={i / bars.length <= at ? 'is-played' : ''} style={{ height: `${Math.max(12, b)}%` }} />)}</span>
      <span className="muted small">{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</span>
      <audio ref={audio} preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setAt(0); }} onTimeUpdate={(e) => setAt(e.currentTarget.duration ? e.currentTarget.currentTime / e.currentTarget.duration : 0)} />
    </div>
  );
}

/** Who is typing in this conversation right now (events that are not kept; a name goes after a few seconds of quiet). */
export function useTyping(convId, me) {
  const [who, setWho] = useState({});
  useEffect(() => {
    if (!convId) return undefined;
    setWho({});
    const off = follow(`conv:${convId}`, (ev) => {
      if (ev.type === 'msg.typing' && ev.room === `conv:${convId}` && ev.data.user !== me) setWho((cur) => ({ ...cur, [ev.data.user]: { name: ev.data.name, until: Date.now() + 4500 } }));
      if (ev.type === 'msg.message.created' && ev.room === `conv:${convId}`) setWho((cur) => { const n = { ...cur }; delete n[ev.data.sender]; return n; });
    });
    const t = setInterval(() => setWho((cur) => { const n = Object.fromEntries(Object.entries(cur).filter(([, v]) => v.until > Date.now())); return Object.keys(n).length === Object.keys(cur).length ? cur : n; }), 1000);
    return () => { off(); clearInterval(t); };
  }, [convId, me]);
  return Object.values(who).map((w) => w.name);
}
export const TypingLine = ({ names }) => (names.length ? <p className="msg-typing muted small" role="status" aria-live="polite" data-testid="typing">{names.length > 2 ? 'Several people are typing…' : `${names.join(' and ')} ${names.length === 1 ? 'is' : 'are'} typing…`}</p> : <p className="msg-typing" aria-hidden="true" />);

const PRESENCE = { ONLINE: 'Online', AWAY: 'Away', OFFLINE: 'Offline' };
export function PresenceLine({ users }) {
  const q = usePresence(users);
  const rows = q.data ?? [];
  if (!rows.length) return null;
  const one = rows[0];
  const text = rows.length === 1 ? `${PRESENCE[one.state]}${one.lastSeen ? `, last seen ${formatDateTime(one.lastSeen)}` : ''}` : `${rows.filter((r) => r.state === 'ONLINE').length} online`;
  return <span className={`msg-presence is-${rows.length === 1 ? one.state.toLowerCase() : 'group'}`} data-testid="presence" data-state={rows.length === 1 ? one.state : 'GROUP'}><i aria-hidden="true" /> {text}</span>;
}

/** Results of a search across my conversations; choosing one opens the conversation at that message. */
export function SearchResults({ filters, onOpen }) {
  const enabled = Boolean(filters.q?.trim().length >= 2 || filters.kind || filters.sender || filters.from || filters.to);
  const q = useSearch(Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), enabled);
  if (!enabled) return null;
  return (
    <section className="msg-search-results" aria-label="Search results" data-testid="search-results">
      <h3>Messages</h3>
      {q.isPending && <Skeleton label="Searching" rows={2} />}
      {q.isError && <QueryError error={q.error} what="the search" permission="" onRetry={q.refetch} />}
      {q.data && q.data.rows.length === 0 && <EmptyState compact title="No message found" message="Try other words, or loosen the sender, date or kind." />}
      {q.data && q.data.rows.length > 0 && (
        <ul className="msg-rows" aria-label="Messages found">
          {q.data.rows.map((r) => (
            <li key={r.messageId}><button type="button" className="msg-row" onClick={() => onOpen(r.conversationId, r.messageId)} data-testid="search-hit">
              <span className="msg-row-main"><span className="msg-row-top"><strong>{r.conversation}</strong><span className="muted small">{formatDate(r.at)}</span></span>
                <span className="msg-snippet">{r.sender.name}: {r.snippet}</span><span className="muted small">{r.files ? `${r.files} file(s) ` : ''}{r.links ? `${r.links} record(s)` : ''}</span></span>
            </button></li>
          ))}
        </ul>
      )}
    </section>
  );
}
export function SearchFilters({ filters, setFilters }) {
  const set = (p) => setFilters({ ...filters, ...p });
  return (
    <details className="msg-filters"><summary>Search filters</summary>
      <label className="field"><span>Sent by (username)</span><input value={filters.sender ?? ''} onChange={(e) => set({ sender: e.target.value })} /></label>
      <label className="field"><span>From</span><input type="date" value={filters.from ?? ''} onChange={(e) => set({ from: e.target.value })} /></label>
      <label className="field"><span>To</span><input type="date" value={filters.to ?? ''} onChange={(e) => set({ to: e.target.value })} /></label>
      <label className="field"><span>Kind</span><select value={filters.kind ?? ''} onChange={(e) => set({ kind: e.target.value })}><option value="">Any</option><option value="images">Photos</option><option value="files">Files</option><option value="links">Links and records</option><option value="voice">Voice notes</option></select></label>
    </details>
  );
}

export function StarredList({ onOpen }) {
  const q = useStarred(true);
  if (q.isPending) return <Skeleton label="Loading starred messages" rows={2} />;
  if (q.isError) return <QueryError error={q.error} what="the starred messages" permission="" onRetry={q.refetch} />;
  if (!q.data.rows.length) return <EmptyState compact title="No starred messages" message="Star a message from its menu to find it here." />;
  return <ul className="msg-rows" aria-label="Starred messages" data-testid="starred">{q.data.rows.map((r) => <li key={r.messageId}><button type="button" className="msg-row" onClick={() => onOpen(r.conversationId, r.messageId)}><span className="msg-row-main"><span className="msg-row-top"><strong>{r.conversation}</strong><span className="muted small">{formatDate(r.at)}</span></span><span className="msg-snippet">★ {r.sender.name}: {r.snippet}</span></span></button></li>)}</ul>;
}

export function PinsBar({ id, onJump }) {
  const q = usePins(id);
  const rows = q.data?.rows ?? [];
  if (!rows.length) return null;
  return (
    <div className="msg-pins" role="region" aria-label="Pinned messages" data-testid="pins">
      <Icon name="erp.action.pin" size={14} /> {rows.slice(0, 3).map((p) => <button key={p.messageId} type="button" className="btn btn-small" onClick={() => onJump(p.messageId)}>{p.text || `${p.files} file(s)`}</button>)}{rows.length > 3 ? <span className="muted small"> +{rows.length - 3} more</span> : null}
    </div>
  );
}

function Thumb({ f }) {
  const [url, setUrl] = useState(null);
  useEffect(() => { let live = true; if (f.category === 'image') fetchFileUrl(f.id, { variant: 'thumbnail' }).then((l) => live && setUrl(l.url)).catch(() => {}); return () => { live = false; }; }, [f.id, f.category]);
  const open = async () => { const w = window.open('', '_blank'); try { const link = await fetchFileUrl(f.id, {}); if (w) w.location.href = link.url; } catch { w?.close(); } };
  return <button type="button" className="msg-thumb" onClick={open} aria-label={`Open ${f.name}`}>{url ? <img src={url} alt="" /> : <span aria-hidden="true">{f.category === 'video' ? '▶' : '📄'}</span>}<span className="small">{f.name}</span></button>;
}
export function Gallery({ id }) {
  const [kind, setKind] = useState('photos');
  const q = useMedia(id, kind);
  return (
    <section aria-labelledby="gal-title" data-testid="gallery"><h3 id="gal-title">Media</h3>
      <div className="toolbar" role="tablist" aria-label="Kind of media">
        {[['photos', 'Photos'], ['documents', 'Documents'], ['links', 'Links']].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={kind === k} className={`lr-chip${kind === k ? ' is-on' : ''}`} onClick={() => setKind(k)} data-testid={`gal-${k}`}>{l}</button>)}
      </div>
      {q.isPending && <Skeleton label="Loading media" rows={1} />}
      {q.isError && <QueryError error={q.error} what="the media" permission="" onRetry={q.refetch} />}
      {q.data && q.data.rows.length === 0 && <p className="muted small">Nothing here yet.</p>}
      {q.data && q.data.rows.length > 0 && <ul className="msg-gallery" aria-label={kind}>{q.data.rows.map((r, i) => <li key={i}>{r.file ? <Thumb f={r.file} /> : <a href={r.url} target="_blank" rel="noopener noreferrer">{r.url}</a>}<span className="muted small"> {r.sender.name}, {formatDate(r.at)}</span></li>)}</ul>}
    </section>
  );
}

export function Privacy() {
  const q = useMeSettings();
  const act = useFeatureActions(null);
  if (!q.data) return null;
  const s = q.data;
  return (
    <details className="msg-privacy" data-testid="privacy"><summary>My privacy</summary>
      <label className="field field-inline"><span>Show when I was last seen</span><input type="checkbox" checked={s.showLastSeen} onChange={(e) => act.me.mutate({ showLastSeen: e.target.checked })} data-testid="priv-seen" /></label>
      <label className="field field-inline"><span>Show when I am online</span><input type="checkbox" checked={s.showOnline} onChange={(e) => act.me.mutate({ showOnline: e.target.checked })} /></label>
      <label className="field field-inline"><span>Let people see that I read their messages</span><input type="checkbox" checked={s.shareReadReceipts || s.enforcedReceipts} disabled={s.enforcedReceipts} onChange={(e) => act.me.mutate({ shareReadReceipts: e.target.checked })} data-testid="priv-receipts" /></label>
      {s.enforcedReceipts && <p className="muted small">Your organisation requires read receipts.</p>}
    </details>
  );
}
