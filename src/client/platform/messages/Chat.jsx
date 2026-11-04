import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Icon from '../design/Icon.jsx';
import StatusBadge from '../design/StatusBadge.jsx';
import { EmptyState, QueryError, Skeleton } from '../feedback/states.jsx';
import { formatDate, formatDateTime, formatINR } from '../format.js';
import { useLiveRefresh } from '../realtime/socket.js';
import SecureConversation from '../secure/SecureConversation.jsx';
import { fetchFileUrl } from '../../modules/core/api/index.js';
import { api } from '../api/index.js';
import { markDelivered, sendTyping, useCalls, useConversation, useConversations, useFeatureActions, useMessageActions, useMessages, usePeople, uploadToConversation } from './api.js';
import { Gallery, PinsBar, PresenceLine, Privacy, ReceiptDetails, SearchFilters, SearchResults, StarredList, Ticks, TypingLine, VoicePlayer, useTyping } from './Features.jsx';

// The parts of the Messages app (part 05.01) that the page and the mini chat windows share: the conversation list, a conversation (bubbles, date separators, replies, reactions, record cards, files, voice notes,
// composer with mentions, emoji and a record picker, drafts) and its details (members, shared files, linked records, my settings). Nothing here decides who may see what: the server does, for every call.
export const EMOJI = ['👍', '❤️', '😂', '😮', '🙏', '✅'];
const TYPE_LABEL = { DIRECT: 'Direct', GROUP: 'Group', TEAM: 'Team', PROJECT: 'Project', SITE: 'Site', DEPARTMENT: 'Department', RECORD: 'Record', EXTERNAL: 'External' };
export const VIEWS = [['all', 'All'], ['unread', 'Unread'], ['pinned', 'Pinned'], ['starred', 'Starred'], ['archived', 'Archived']];
const errorText = (e) => `${e?.message ?? 'Something went wrong'}${e?.correlationId ? ` (Correlation ID: ${e.correlationId})` : ''}`;
const draftKey = (user, id) => `erp.msg.draft.${user}.${id}`;
const lsGet = (k) => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } };
const lsSet = (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* the draft lasts for this page view */ } };
const dayKey = (iso) => new Date(Date.parse(iso) + 5.5 * 3_600_000).toISOString().slice(0, 10);
const timeOf = (iso) => new Date(Date.parse(iso) + 5.5 * 3_600_000).toISOString().slice(11, 16);
const Mentions = ({ text }) => text.split(/((?:^|(?<=[^\w@]))@[A-Za-z0-9._-]{2,40})/g).map((p, i) => (/^@/.test(p) ? <strong key={i} className="msg-mention">{p}</strong> : <Fragment key={i}>{p}</Fragment>));

// ---- the list ----
export function ConversationList({ activeId, onOpen, filters, setFilters, session }) {
  const q = useConversations(filters.view === 'starred' ? { ...filters, view: 'all' } : filters);
  const [sf, setSf] = useState({ sender: '', from: '', to: '', kind: '' });
  useLiveRefresh(session?.user ? [`user:${session.user}`] : [], [['msg']]);
  const d = q.data;
  return (
    <div className="msg-list" data-testid="msg-list">
      <form role="search" aria-label="Search conversations" onSubmit={(e) => e.preventDefault()} className="msg-search">
        <label className="sr-only" htmlFor="msg-q">Search conversations by name</label>
        <input id="msg-q" type="search" placeholder="Search conversations" value={filters.q ?? ''} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
      </form>
      <div className="toolbar" role="group" aria-label="Show">
        {VIEWS.map(([k, l]) => <button key={k} type="button" className={`lr-chip${filters.view === k ? ' is-on' : ''}`} aria-pressed={filters.view === k} onClick={() => setFilters({ ...filters, view: k })}>{l}{k === 'unread' && d?.counts.unread ? ` (${d.counts.unread})` : ''}</button>)}
      </div>
      <SearchFilters filters={sf} setFilters={setSf} />
      {filters.view === 'starred' ? <StarredList onOpen={onOpen} /> : <SearchResults filters={{ q: filters.q, ...sf }} onOpen={onOpen} />}
      {filters.view !== 'starred' && q.isPending && <Skeleton label="Loading conversations" rows={4} />}
      {filters.view !== 'starred' && q.isError && <QueryError error={q.error} what="the conversations" permission="" onRetry={q.refetch} />}
      <Privacy />
      {filters.view !== 'starred' && d && d.rows.length === 0 && <EmptyState compact title={filters.q || filters.view !== 'all' ? 'No conversation matches' : 'No conversations yet'} message={filters.view === 'all' && !filters.q ? 'Start one with the New button: a person, a group, a project or a record.' : 'Try another filter.'} />}
      {filters.view !== 'starred' && d && d.rows.length > 0 && (
        <ul className="msg-rows" aria-label="Conversations">
          {d.rows.map((c) => (
            <li key={c.id}>
              <button type="button" className={`msg-row${activeId === c.id ? ' is-active' : ''}`} aria-current={activeId === c.id ? 'true' : undefined} onClick={() => onOpen(c.id)} data-testid={`conv-${c.id}`}>
                <span className="msg-avatar" aria-hidden="true">{c.title.slice(0, 1).toUpperCase()}</span>
                <span className="msg-row-main">
                  <span className="msg-row-top"><strong>{c.secure && <span className="msg-lock" title="Secure conversation, end-to-end encrypted" data-testid="secure-label"><Icon name="erp.action.lock" size={14} /><span className="sr-only">Secure conversation. </span></span>}{c.title}</strong><span className="muted small">{c.last ? formatListTime(c.last.at) : ''}</span></span>
                  <span className="msg-row-bottom"><span className="msg-preview">{c.last ? `${c.last.sender === c.title ? '' : `${c.last.sender}: `}${c.last.excerpt}` : 'No messages yet'}</span>
                    {c.pinned && <Icon name="erp.action.pin" size={14} />}{c.muted && <span className="muted small" title="Muted">muted</span>}
                    {c.unread > 0 && <span className="op-count" aria-label={`${c.unread} unread`} data-testid={`unread-${c.id}`}>{c.unread}</span>}</span>
                  <span className="muted small">{c.secure ? 'Secure · end-to-end encrypted' : TYPE_LABEL[c.type]}{c.readOnly ? ` · ${c.channel ?? 'read only'}` : ''}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
const formatListTime = (iso) => (dayKey(iso) === dayKey(new Date().toISOString()) ? timeOf(iso) : formatDate(iso));

// ---- a message ----
export function Card({ l }) {
  if (l.restricted) return <div className="msg-card is-restricted" data-testid="record-card" data-restricted="true"><Icon name="erp.action.lock" size={16} /> Restricted record</div>;
  return (
    <a className="msg-card" href={l.route ?? '#'} data-testid="record-card" data-restricted="false" onClick={(e) => { if (l.route) { e.preventDefault(); window.history.pushState(null, '', l.route); window.dispatchEvent(new PopStateEvent('popstate')); } }}>
      <span className="muted small">{l.typeLabel}</span> <strong>{l.label}</strong>{l.status && <> <StatusBadge status={l.status} /></>}{l.amount && <> <span className="num">{formatINR(l.amount)}</span></>}
    </a>
  );
}
function FileChip({ f }) {
  const open = async () => { const w = window.open('', '_blank'); try { const link = await fetchFileUrl(f.id, {}); if (w) w.location.href = link.url; } catch { w?.close(); } };
  return <button type="button" className="msg-file" onClick={open} data-testid="msg-file"><Icon name="erp.action.attach" size={14} /> {f.name} <span className="muted small">{Math.max(1, Math.round(f.size / 1024))} KB</span></button>;
}
function Bubble({ m, actions, fx, onReply, readOnly, forwardTargets, highlight }) {
  const [edit, setEdit] = useState(null);
  const [who, setWho] = useState(false);
  const [menu, setMenu] = useState(false);
  const [error, setError] = useState(null);
  const run = async (fn) => { setError(null); try { await fn(); setEdit(null); setMenu(false); } catch (e) { setError(e); } };
  if (m.kind === 'SYSTEM') return <li className="msg-system" data-testid="msg-system"><span>{m.body}</span></li>;
  return (
    <li className={`msg-bubble${m.mine ? ' is-mine' : ''}${m.deleted ? ' is-deleted' : ''}${highlight ? ' is-highlight' : ''}`} id={`msg-${m.id}`} data-testid="msg" data-id={m.id}>
      {!m.mine && <strong className="msg-sender">{m.sender.name}</strong>}
      {m.forwarded && <span className="muted small" data-testid="msg-forwarded">Forwarded</span>}
      {m.replyTo && <blockquote className="msg-quote"><strong>{m.replyTo.sender.name}</strong> {m.replyTo.excerpt}</blockquote>}
      {m.deleted ? <p className="muted"><em>message deleted</em></p> : edit !== null ? (
        <form onSubmit={(e) => { e.preventDefault(); run(() => actions.edit.mutateAsync({ id: m.id, body: edit })); }}>
          <label className="sr-only" htmlFor={`edit-${m.id}`}>Edit your message</label>
          <textarea id={`edit-${m.id}`} rows="2" value={edit} onChange={(e) => setEdit(e.target.value)} maxLength={4000} />
          <div className="actions"><button className="btn btn-primary btn-small" type="submit">Save</button><button className="btn btn-small" type="button" onClick={() => setEdit(null)}>Cancel</button></div>
        </form>
      ) : <>
        {m.kind === 'VOICE' && m.attachments[0] && <VoicePlayer m={m} />}
        {m.body && <p className="msg-text"><Mentions text={m.body} /></p>}
        {m.kind !== 'VOICE' && m.attachments.map((f) => <FileChip key={f.id} f={f} />)}
        {m.links.map((l, i) => <Card key={i} l={l} />)}
        {m.readOnly && m.subject && <p className="muted small">{m.subject}</p>}
      </>}
      <span className="msg-meta muted small">{m.starred && <span aria-label="Starred" title="Starred">★ </span>}{m.pinned && <span aria-label="Pinned" title="Pinned">📌 </span>}{timeOf(m.createdAt)}{m.editedAt ? ' · edited' : ''}{m.readOnly ? ` · ${m.channel} ${m.direction === 'IN' ? 'received' : String(m.deliveryStatus).toLowerCase()}` : ''} {m.mine && !m.deleted && <Ticks receipt={m.receipt} onClick={() => setWho(!who)} />}</span>
      {who && <ReceiptDetails messageId={m.id} />}
      {!m.deleted && m.reactions.length > 0 && <span className="msg-reactions">{m.reactions.map((r) => <button key={r.emoji} type="button" className={`lr-chip${r.mine ? ' is-on' : ''}`} aria-pressed={r.mine} aria-label={`${r.emoji} ${r.count}`} onClick={() => actions.react.mutate({ id: m.id, emoji: r.emoji, on: !r.mine })}>{r.emoji} {r.count}</button>)}</span>}
      {!readOnly && !m.deleted && (
        <div className="msg-actions">
          <button type="button" className="btn btn-small" aria-haspopup="true" aria-expanded={menu} aria-label="Message actions" onClick={() => setMenu(!menu)} data-testid="msg-more"><Icon name="erp.action.more" size={16} /></button>
          {menu && (
            <div className="msg-menu" role="menu">
              <div role="group" aria-label="React">{EMOJI.map((e) => <button key={e} type="button" role="menuitem" className="btn btn-small" onClick={() => { actions.react.mutate({ id: m.id, emoji: e, on: !m.reactions.find((r) => r.emoji === e)?.mine }); setMenu(false); }}>{e}</button>)}</div>
              <button type="button" role="menuitem" className="btn btn-small" onClick={() => { onReply(m); setMenu(false); }}>Reply</button>
              {m.canEdit && <button type="button" role="menuitem" className="btn btn-small" onClick={() => { setEdit(m.body); setMenu(false); }}>Edit</button>}
              <button type="button" role="menuitem" className="btn btn-small" data-testid="msg-star" onClick={() => run(() => fx.star.mutateAsync({ id: m.id, on: !m.starred }))}>{m.starred ? 'Remove the star' : 'Star'}</button>
              <button type="button" role="menuitem" className="btn btn-small" data-testid="msg-pin" onClick={() => run(() => fx.pin.mutateAsync({ id: m.id, on: !m.pinned }))}>{m.pinned ? 'Unpin' : 'Pin to the conversation'}</button>
              {m.mine && <button type="button" role="menuitem" className="btn btn-small" onClick={() => setWho(!who)}>Who has read it</button>}
              <button type="button" role="menuitem" className="btn btn-small" data-testid="msg-hide" onClick={() => run(() => fx.hide.mutateAsync(m.id))}>Delete for me</button>
              {forwardTargets.length > 0 && <label className="msg-forward"><span className="sr-only">Forward to</span><select defaultValue="" onChange={(e) => { if (e.target.value) run(() => actions.forward.mutateAsync({ id: m.id, conversationIds: [Number(e.target.value)] })); }}><option value="">Forward to...</option>{forwardTargets.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>}
              {m.canDelete && <button type="button" role="menuitem" className="btn btn-small" data-testid="msg-delete" onClick={() => { const reason = m.mine ? undefined : window.prompt('Why are you deleting this message?') ?? ''; if (m.mine || reason) run(() => actions.remove.mutateAsync({ id: m.id, reason })); }}>Delete for everyone</button>}
            </div>
          )}
        </div>
      )}
      {error && <p className="field-error" role="alert">{errorText(error)}</p>}
    </li>
  );
}

// ---- the composer ----
function Composer({ id, session, actions, replyTo, setReplyTo, members, compact }) {
  const user = session?.user ?? 'me';
  const [text, setText] = useState(() => lsGet(draftKey(user, id)));
  const [files, setFiles] = useState([]);
  const [links, setLinks] = useState([]);
  const [picker, setPicker] = useState(false);
  const [emoji, setEmoji] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(null);
  const input = useRef(null);
  useEffect(() => { setText(lsGet(draftKey(user, id))); setFiles([]); setLinks([]); setReplyTo(null); }, [id, user, setReplyTo]);
  const lastTyping = useRef(0);
  const change = (v) => { setText(v); lsSet(draftKey(user, id), v); if (v && Date.now() - lastTyping.current > 3000) { lastTyping.current = Date.now(); sendTyping(id); } };
  const [voice, setVoice] = useState(null);
  const mention = /(?:^|\s)@([A-Za-z0-9._-]*)$/.exec(text);
  const suggestions = mention ? members.filter((m) => m.username !== user && (m.username.toLowerCase().startsWith(mention[1].toLowerCase()) || m.name.toLowerCase().includes(mention[1].toLowerCase()))).slice(0, 5) : [];
  const attach = async (list) => {
    setBusy(true); setError(null);
    try { for (const f of list) { const done = await uploadToConversation(f, id); setFiles((cur) => [...cur, { id: done.id, name: f.name, kind: f.type?.startsWith('audio') ? 'VOICE' : 'FILE' }]); } } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const record = async () => {
    if (recording) { recording.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks = [];
      const peaks = [];
      const started = Date.now();
      let meter = null;
      try { // the loudness every tenth of a second becomes the waveform of the note
        const ctx = new (globalThis.AudioContext ?? globalThis.webkitAudioContext)();
        const an = ctx.createAnalyser(); an.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(an);
        const buf = new Uint8Array(an.fftSize);
        meter = setInterval(() => { an.getByteTimeDomainData(buf); let max = 0; for (const v of buf) max = Math.max(max, Math.abs(v - 128)); peaks.push(Math.min(100, Math.round((max / 128) * 140))); }, 100);
        rec.addEventListener('stop', () => { clearInterval(meter); ctx.close().catch(() => {}); });
      } catch { /* a note without a waveform is still a note */ }
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop()); setRecording(null);
        const step = Math.max(1, Math.ceil(peaks.length / 40));
        const wave = []; for (let i = 0; i < peaks.length; i += step) wave.push(Math.max(...peaks.slice(i, i + step)));
        setVoice({ durationMs: Date.now() - started, waveform: wave.length ? wave : [20, 40, 60, 40, 20] });
        await attach([new File(chunks, `voice-${Date.now()}.webm`, { type: 'audio/webm' })]);
      };
      rec.start(); setRecording(rec);
    } catch { setError(new Error('The microphone could not be used.')); }
  };
  const send = async (e) => {
    e?.preventDefault();
    if (!text.trim() && !files.length && !links.length) return;
    setError(null);
    try {
      const isVoice = files.length === 1 && files[0].kind === 'VOICE' && !text.trim();
      const voiceMeta = voice;
      await actions.send.mutateAsync({ body: text.trim(), attachments: files.map((f) => f.id), recordLinks: links.map((l) => ({ entity: l.entity, id: l.id })), replyToId: replyTo?.id, kind: isVoice ? 'VOICE' : 'TEXT', voice: isVoice && voiceMeta ? voiceMeta : undefined, clientId: globalThis.crypto.randomUUID().replace(/-/g, '') });
      change(''); setFiles([]); setLinks([]); setReplyTo(null); setVoice(null);
    } catch (er) { setError(er); }
  };
  return (
    <form className={`msg-composer${compact ? ' is-compact' : ''}`} onSubmit={send} noValidate aria-label="Write a message" data-testid="composer">
      {replyTo && <p className="msg-replying muted small">Replying to <strong>{replyTo.sender.name}</strong>: {replyTo.body.slice(0, 60)} <button type="button" className="btn btn-small" onClick={() => setReplyTo(null)}>Cancel</button></p>}
      {(files.length > 0 || links.length > 0) && <ul className="msg-pending" aria-label="Attached">{files.map((f) => <li key={f.id}>{f.name} <button type="button" className="btn btn-small" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((x) => x.id !== f.id))}>×</button></li>)}{links.map((l) => <li key={`${l.entity}${l.id}`}>{l.label} <button type="button" className="btn btn-small" aria-label={`Remove ${l.label}`} onClick={() => setLinks(links.filter((x) => x !== l))}>×</button></li>)}</ul>}
      {suggestions.length > 0 && <ul className="msg-suggest" role="listbox" aria-label="People to mention">{suggestions.map((m) => <li key={m.username}><button type="button" role="option" aria-selected="false" onClick={() => change(text.replace(/@[A-Za-z0-9._-]*$/, `@${m.username} `))}>{m.name} <span className="muted small">@{m.username}</span></button></li>)}</ul>}
      <div className="msg-compose-row">
        <label className="sr-only" htmlFor={`compose-${id}`}>Message</label>
        <textarea id={`compose-${id}`} rows="1" value={text} maxLength={4000} placeholder="Write a message, @ to mention" onChange={(e) => change(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} data-testid="compose-input" />
        <button type="button" className="btn" aria-label="Attach a file or photo" onClick={() => input.current?.click()} disabled={busy}><Icon name="erp.action.attach" size={18} /></button>
        <input ref={input} type="file" hidden multiple data-testid="compose-file" onChange={(e) => { attach([...e.target.files]); e.target.value = ''; }} />
        <button type="button" className="btn" aria-label="Link a record" onClick={() => setPicker(!picker)} aria-expanded={picker} data-testid="compose-record"><Icon name="erp.action.drill" size={18} /></button>
        <button type="button" className="btn" aria-label="Emoji" onClick={() => setEmoji(!emoji)} aria-expanded={emoji}>😊</button>
        {typeof MediaRecorder !== 'undefined' && <button type="button" className={`btn${recording ? ' btn-primary' : ''}`} aria-label={recording ? 'Stop recording' : 'Record a voice note'} aria-pressed={Boolean(recording)} onClick={record}><Icon name="erp.action.notify" size={18} /></button>}
        <button type="submit" className="btn btn-primary" disabled={actions.send.isPending || busy} data-testid="compose-send"><Icon name="erp.action.submit" size={18} /> Send</button>
      </div>
      {emoji && <div className="msg-emoji" role="group" aria-label="Emoji">{[...EMOJI, '👏', '🙂', '😅', '👀', '🚧', '🏗️'].map((e) => <button key={e} type="button" className="btn btn-small" onClick={() => { change(text + e); setEmoji(false); }}>{e}</button>)}</div>}
      {picker && <RecordPicker onPick={(l) => { setLinks((cur) => (cur.some((x) => x.entity === l.entity && x.id === l.id) ? cur : [...cur, l])); setPicker(false); }} />}
      {error && <p className="field-error" role="alert" data-testid="compose-error">{errorText(error)}</p>}
    </form>
  );
}
export function RecordPicker({ onPick }) {
  const [types, setTypes] = useState(null);
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  useEffect(() => { api.get('/msg/record-types').then((r) => { setTypes(r.data.rows); setType(r.data.rows[0]?.type ?? ''); }).catch(() => setTypes([])); }, []);
  useEffect(() => { if (!type) return undefined; let live = true; api.get(`/msg/records?type=${type}&q=${encodeURIComponent(q)}`).then((r) => live && setRows(r.data.rows)).catch(() => live && setRows([])); return () => { live = false; }; }, [type, q]);
  if (types && types.length === 0) return <p className="muted small">There are no kinds of record you can link yet.</p>;
  return (
    <div className="msg-picker" role="group" aria-label="Link a record">
      <label className="field"><span>Kind of record</span><select value={type} onChange={(e) => setType(e.target.value)}>{(types ?? []).map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}</select></label>
      <label className="field"><span>Number or title</span><input type="search" value={q} onChange={(e) => setQ(e.target.value)} data-testid="picker-q" /></label>
      <ul aria-label="Records">{rows.map((r) => <li key={r.id}><button type="button" className="btn btn-small" onClick={() => onPick({ entity: r.entity, id: r.id, label: r.label })} data-testid="picker-row">{r.label}{r.status ? ` · ${r.status}` : ''}</button></li>)}{rows.length === 0 && <li className="muted small">Nothing found.</li>}</ul>
    </div>
  );
}

// ---- a conversation ----
export function ConversationView({ id, session, around, compact = false, onBack, onDetails, onPopOut, onClose, onMinimise }) {
  const conv = useConversation(id);
  const msgs = useMessages(id, around);
  const actions = useMessageActions(id);
  const fx = useFeatureActions(id);
  const typing = useTyping(id, session?.user);
  const [jump, setJump] = useState(around ?? null);
  const [replyTo, setReplyTo] = useState(null);
  const bottom = useRef(null);
  const list = useConversations({ view: 'all', limit: 30 });
  useLiveRefresh(id ? [`conv:${id}`] : [], [['msg']]);
  const rows = msgs.data?.rows ?? [];
  const lastId = rows.length ? rows[rows.length - 1].id : 0;
  useEffect(() => { if (jump && document.getElementById(`msg-${jump}`)) document.getElementById(`msg-${jump}`).scrollIntoView?.({ block: 'center' }); else bottom.current?.scrollIntoView?.({ block: 'end' }); }, [lastId, id, jump, msgs.data]);
  useEffect(() => { setJump(around ?? null); }, [around, id]);
  useEffect(() => { if (msgs.data && lastId > 0 && !msgs.data.readOnly) markDelivered(id, lastId); }, [lastId, id]); // the sender is told that this screen has the messages
  useEffect(() => { if (msgs.data && lastId > (msgs.data.lastRead ?? 0) && !actions.read.isPending) actions.read.mutate(); }, [lastId, msgs.data?.lastRead]);
  const forwardTargets = (list.data?.rows ?? []).filter((c) => c.id !== id && !c.readOnly && !c.archived).slice(0, 12);
  const c = conv.data;
  const memberList = c?.members ?? [];
  const others = c?.type === 'DIRECT' || (c?.members?.length ?? 0) <= 12 ? memberList.filter((m) => m.username !== session?.user).map((m) => m.username) : [];
  const calls = useCalls(c && c.type !== 'EXTERNAL' ? id : null);
  const startCall = async (type) => { try { const r = await fx.startCall.mutateAsync(type); window.history.pushState(null, '', `/collab/call?call=${r.call.id}`); window.dispatchEvent(new PopStateEvent('popstate')); } catch (e) { window.alert(errorText(e)); } };
  let lastDay = '';
  if (c?.secure) return <SecureConversation id={id} c={c} session={session} compact={compact} onBack={onBack} onDetails={onDetails} onPopOut={onPopOut} onClose={onClose} onMinimise={onMinimise} />;
  return (
    <section className={`msg-conv${compact ? ' is-compact' : ''}`} aria-label={c ? `Conversation with ${c.title}` : 'Conversation'} data-testid="msg-conversation">
      <header className="msg-conv-head">
        {onBack && <button type="button" className="btn" onClick={onBack} aria-label="Back to the conversations" data-testid="msg-back"><Icon name="erp.action.previous" size={18} /></button>}
        <div className="msg-conv-title"><h2>{c?.title ?? 'Conversation'}</h2><span className="muted small">{c ? `${TYPE_LABEL[c.type]}${c.type !== 'EXTERNAL' && c.members ? ` · ${c.members.length} member(s)` : ''}${c.archived ? ' · archived' : ''}` : ''}</span>{others.length > 0 && <PresenceLine users={others} />}</div>
        {c && c.type !== 'EXTERNAL' && !compact && <><button type="button" className="btn" onClick={() => startCall('AUDIO')} aria-label="Start a voice call" disabled={fx.startCall.isPending} data-testid="call-audio">📞</button><button type="button" className="btn" onClick={() => startCall('VIDEO')} aria-label="Start a video call" disabled={fx.startCall.isPending} data-testid="call-video">🎥</button></>}
        {onDetails && <button type="button" className="btn" onClick={onDetails} aria-label="Conversation details" data-testid="msg-details"><Icon name="erp.action.info" size={18} /></button>}
        {onPopOut && <button type="button" className="btn" onClick={onPopOut} aria-label="Open in a small window" data-testid="msg-popout"><Icon name="erp.action.next" size={18} /></button>}
        {onMinimise && <button type="button" className="btn" onClick={onMinimise} aria-label="Minimise">–</button>}
        {onClose && <button type="button" className="btn" onClick={onClose} aria-label="Close this window">×</button>}
      </header>
      {calls.data?.active && <p className="notice msg-call-banner" role="status" data-testid="call-banner">A call is going on. <a href={`/collab/call?call=${calls.data.active}`} onClick={(e) => { e.preventDefault(); window.history.pushState(null, '', `/collab/call?call=${calls.data.active}`); window.dispatchEvent(new PopStateEvent('popstate')); }}>Join the call</a></p>}
      {c && c.type !== 'EXTERNAL' && <PinsBar id={id} onJump={(mid) => { setJump(mid); document.getElementById(`msg-${mid}`)?.scrollIntoView?.({ block: 'center' }); }} />}
      {(conv.isError || msgs.isError) && <QueryError error={conv.error ?? msgs.error} what="this conversation" permission="" onRetry={() => { conv.refetch(); msgs.refetch(); }} />}
      {msgs.isPending && !msgs.isError && <Skeleton label="Loading messages" rows={3} />}
      {msgs.data && (
        <ol className="msg-thread" aria-label="Messages" tabIndex={0} data-testid="msg-thread">
          {rows.length === 0 && <li className="muted msg-empty">No messages yet. Say hello.</li>}
          {rows.map((m) => {
            const day = dayKey(m.createdAt);
            const sep = day !== lastDay;
            lastDay = day;
            return (
              <Fragment key={m.id}>
                {sep && <li className="msg-day" role="separator" aria-label={formatDate(m.createdAt)}><span>{day === dayKey(new Date().toISOString()) ? 'Today' : formatDate(m.createdAt)}</span></li>}
                <Bubble m={m} actions={actions} fx={fx} highlight={jump === m.id} onReply={setReplyTo} readOnly={msgs.data.readOnly || c?.archived} forwardTargets={forwardTargets} />
              </Fragment>
            );
          })}
          <li ref={bottom} aria-hidden="true" />
        </ol>
      )}
      <TypingLine names={typing} />
      {msgs.data && !msgs.data.readOnly && !c?.archived && <Composer id={id} session={session} actions={actions} replyTo={replyTo} setReplyTo={setReplyTo} members={memberList} compact={compact} />}
      {msgs.data?.readOnly && <p className="muted small msg-readonly" data-testid="msg-readonly">This is a thread of the communication gateway. It is shown here read-only; reply from the communication centre.</p>}
      {c?.archived && <p className="muted small msg-readonly">This conversation is archived.</p>}
    </section>
  );
}

function CallHistory({ id }) {
  const q = useCalls(id);
  const rows = q.data?.rows ?? [];
  return (
    <section aria-labelledby="md-calls"><h3 id="md-calls">Calls</h3>
      {rows.length === 0 ? <p className="muted small">No calls yet.</p> : <ul aria-label="Calls" data-testid="call-history">{rows.map((r) => <li key={r.id}>{r.type === 'VIDEO' ? 'Video' : 'Voice'} call by {r.startedBy.name}, {r.status.toLowerCase()}{r.durationSeconds != null ? `, ${Math.floor(r.durationSeconds / 60)} min ${r.durationSeconds % 60} s` : ''} <span className="muted small">{formatDateTime(r.startedAt)}</span></li>)}</ul>}
    </section>
  );
}

// ---- details ----
const MUTES = [['', 'Not muted'], ['1h', 'Mute for 1 hour'], ['8h', 'Mute for 8 hours'], ['1w', 'Mute for 1 week'], ['forever', 'Mute until I unmute']];
export function Details({ id, session, onClose, onLeft }) {
  const conv = useConversation(id);
  const actions = useMessageActions(id);
  const [who, setWho] = useState('');
  const [error, setError] = useState(null);
  const people = usePeople(who);
  const run = async (fn) => { setError(null); try { return await fn(); } catch (e) { setError(e); return null; } };
  const c = conv.data;
  if (conv.isPending) return <Skeleton label="Loading the details" />;
  if (conv.isError) return <QueryError error={conv.error} what="the details" permission="" onRetry={conv.refetch} />;
  const muteValue = c.mine.muted ? 'forever' : '';
  const setMute = (v) => actions.settings.mutate({ mutedUntil: v === '' ? null : new Date(Date.now() + ({ '1h': 3_600_000, '8h': 8 * 3_600_000, '1w': 7 * 86_400_000, forever: 3650 * 86_400_000 })[v]).toISOString() });
  return (
    <aside className="msg-details" aria-label="Conversation details" data-testid="msg-details-panel">
      <header className="msg-conv-head"><h2>Details</h2>{onClose && <button type="button" className="btn" onClick={onClose} aria-label="Close the details">×</button>}</header>
      {error && <p className="field-error" role="alert">{errorText(error)}</p>}
      <section aria-labelledby="md-me"><h3 id="md-me">My settings</h3>
        <div className="toolbar">
          <label className="field field-inline"><span>Pinned</span><input type="checkbox" checked={c.mine.pinned} onChange={(e) => actions.settings.mutate({ pinned: e.target.checked })} data-testid="set-pin" /></label>
          <label className="field field-inline"><span>Mentions only</span><input type="checkbox" checked={c.mine.mentionOnly} onChange={(e) => actions.settings.mutate({ mentionOnly: e.target.checked })} data-testid="set-mentions" /></label>
          <label className="field field-inline"><span>Notifications</span><select value={muteValue} onChange={(e) => setMute(e.target.value)} data-testid="set-mute">{MUTES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className="field field-inline"><span>Archived for me</span><input type="checkbox" checked={c.mine.archived} onChange={(e) => actions.settings.mutate({ archived: e.target.checked })} /></label>
        </div>
      </section>
      {c.canManage && (
        <section aria-labelledby="md-admin"><h3 id="md-admin">Administration</h3>
          <form onSubmit={(e) => { e.preventDefault(); const t = new FormData(e.currentTarget).get('title'); run(() => actions.rename.mutateAsync(String(t))); }}><label className="field"><span>Name</span><input name="title" defaultValue={c.title} maxLength={120} /></label><button className="btn btn-small" type="submit">Rename</button></form>
          <button type="button" className="btn btn-small" onClick={() => run(() => actions.archive.mutateAsync(!c.archived))}>{c.archived ? 'Unarchive for everyone' : 'Archive for everyone'}</button>
        </section>
      )}
      {c.type !== 'EXTERNAL' && (
        <section aria-labelledby="md-members"><h3 id="md-members">Members ({c.members.length})</h3>
          {c.autoMembership && <p className="muted small">Members of this channel follow assignments. Someone added by hand stays until removed.</p>}
          <ul className="msg-members" aria-label="Members">
            {c.members.map((m) => (
              <li key={m.username} data-testid="member"><span>{m.name}{m.username === session?.user ? ' (you)' : ''}</span> <span className="muted small">{m.role === 'ADMIN' ? 'administrator' : ''}{m.source === 'AUTO' ? ' · by assignment' : ''}</span>
                {c.canManage && m.username !== session?.user && <button type="button" className="btn btn-small" onClick={() => run(() => actions.role.mutateAsync({ user: m.username, role: m.role === 'ADMIN' ? 'MEMBER' : 'ADMIN' }))}>{m.role === 'ADMIN' ? 'Make member' : 'Make administrator'}</button>}
                {c.canManage && m.username !== session?.user && m.source !== 'AUTO' && <button type="button" className="btn btn-small" aria-label={`Remove ${m.name}`} onClick={() => run(() => actions.removeMember.mutateAsync(m.username))}>Remove</button>}
              </li>
            ))}
          </ul>
          {c.canManage && c.type !== 'DIRECT' && (
            <div className="msg-add"><label className="field"><span>Add someone</span><input type="search" value={who} onChange={(e) => setWho(e.target.value)} data-testid="add-member-q" /></label>
              {who && <ul aria-label="People">{(people.data ?? []).filter((p) => !c.members.some((m) => m.username === p.username)).map((p) => <li key={p.username}><button type="button" className="btn btn-small" onClick={async () => { const r = await run(() => actions.addMembers.mutateAsync([p.username])); if (r) setWho(''); }}>{p.name} <span className="muted small">@{p.username}</span></button></li>)}</ul>}</div>
          )}
          {!['DIRECT'].includes(c.type) && !(c.autoMembership) && <button type="button" className="btn btn-small" onClick={async () => { if (window.confirm('Leave this conversation?')) { const r = await run(() => actions.removeMember.mutateAsync(session?.user)); if (r) onLeft?.(); } }} data-testid="leave">Leave the conversation</button>}
        </section>
      )}
      {c.type !== 'EXTERNAL' && <Gallery id={id} />}
      {c.type !== 'EXTERNAL' && <CallHistory id={id} />}
      <section aria-labelledby="md-files"><h3 id="md-files">Shared files</h3>
        {c.files.length === 0 ? <p className="muted small">No files shared yet.</p> : <ul aria-label="Files">{c.files.map((f) => <li key={f.id}><FileChip f={f} /></li>)}</ul>}
      </section>
      <section aria-labelledby="md-links"><h3 id="md-links">Linked records</h3>
        {c.links.length === 0 ? <p className="muted small">No records linked yet.</p> : <ul aria-label="Records">{c.links.map((l, i) => <li key={i}><Card l={l} /></li>)}</ul>}
        {c.type === 'RECORD' && <p className="muted small">This conversation belongs to the record. {formatDateTime(c.createdAt)}</p>}
      </section>
    </aside>
  );
}

// ---- the small windows (FR-07): a shared store, so the page and the dock agree on which chats are open over any page ----
const WKEY = 'erp.msg.windows';
const wRead = () => { try { return JSON.parse(sessionStorage.getItem(WKEY) ?? '[]'); } catch { return []; } };
let windows = wRead();
const wListeners = new Set();
const wSet = (next) => { windows = next; try { sessionStorage.setItem(WKEY, JSON.stringify(next)); } catch { /* kept for this page view */ } wListeners.forEach((l) => l()); };
export const chatWindows = {
  list: () => windows,
  open: (id) => wSet(windows.some((w) => w.id === id) ? windows.map((w) => (w.id === id ? { ...w, min: false } : w)) : [...windows.slice(-2), { id, min: false }]),
  close: (id) => wSet(windows.filter((w) => w.id !== id)),
  toggle: (id) => wSet(windows.map((w) => (w.id === id ? { ...w, min: !w.min } : w))),
  subscribe: (fn) => { wListeners.add(fn); return () => wListeners.delete(fn); },
};
export const useChatWindows = () => useSyncExternalStore(chatWindows.subscribe, chatWindows.list);
