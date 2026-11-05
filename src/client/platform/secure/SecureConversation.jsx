import { Fragment, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Icon from '../design/Icon.jsx';
import { QueryError, Skeleton } from '../feedback/states.jsx';
import { formatDate } from '../format.js';
import { Card, RecordPicker } from '../messages/Chat.jsx';
import { KeyChangeError, acceptKeys, ensureDevice, openFile, secApi, send, sendFile, useSecureThread } from './engine.js';

// A secure conversation inside the Messages app (part 05.03, FR-03, FR-04, FR-05, FR-06, FR-08). The words are encrypted on this device before they leave it; this screen shows what this device decrypted and kept.
// A lock marks the conversation, the safety number is one click away, a change of someone's keys must be accepted before the next message, and a record card is drawn from the record's own permission.
const SECS = { 0: 'Off', 3600: '1 hour', 86_400: '1 day', 604_800: '7 days' };
const secLabel = (s) => SECS[s] ?? `${s} seconds`;
const nav = (to) => { window.history.pushState(null, '', to); window.dispatchEvent(new PopStateEvent('popstate')); };
const dayKey = (iso) => iso.slice(0, 10);
const errorText = (e) => e?.message ?? 'Something went wrong. Try again.';

function SecureCard({ l }) {
  const q = useQuery({ queryKey: ['sec', 'card', l.entity, l.id], queryFn: () => secApi.card(l.entity, l.id), retry: false, staleTime: 30_000 });
  if (q.isPending) return <span className="muted small">Checking your access to the record…</span>;
  if (q.isError || q.data?.restricted) return <Card l={{ restricted: true }} />;
  return <Card l={{ ...q.data, typeLabel: l.entity.replace(/_/g, ' ') }} />;
}

function Bubble({ m, who }) {
  const [err, setErr] = useState('');
  const p = m.payload ?? {};
  return (
    <li className={`msg-bubble${m.mine ? ' is-mine' : ''}`} data-testid="smsg">
      {!m.mine && <span className="msg-sender">{who(m.sender)}</span>}
      {m.undecryptable && <p className="muted" data-testid="smsg-failed">This message could not be decrypted on this device (for example it was sent before this device was set up, or its key is gone).</p>}
      {!m.undecryptable && p.t === 'text' && <p className="msg-body">{p.body}</p>}
      {!m.undecryptable && p.t === 'file' && (
        <p><button type="button" className="msg-file" data-testid="smsg-file" onClick={() => openFile(p).catch((e) => setErr(errorText(e)))}><Icon name="erp.action.attach" size={14} /> {p.name} <span className="muted small">{Math.max(1, Math.round(p.size / 1024))} KB · encrypted</span></button>{err && <span className="field-error" role="alert"> {err}</span>}</p>
      )}
      {!m.undecryptable && (p.links ?? []).map((l) => <SecureCard key={`${l.entity}:${l.id}`} l={l} />)}
      {!m.undecryptable && p.t === 'file' && p.body && <p className="msg-body">{p.body}</p>}
      <span className="muted small msg-time">{new Date(m.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}{m.expiresAt ? ' · disappears' : ''}</span>
    </li>
  );
}

export default function SecureConversation({ id, c, session, compact, onBack, onDetails, onPopOut, onClose, onMinimise }) {
  const qc = useQueryClient();
  const sec = useQuery({ queryKey: ['sec', 'details', id], queryFn: () => secApi.details(id), retry: false });
  const t = useSecureThread(id, session);
  const [text, setText] = useState('');
  const [links, setLinks] = useState([]);
  const [picker, setPicker] = useState(false);
  const [error, setError] = useState(null);
  const [changes, setChanges] = useState(null);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);
  const file = useRef(null);
  const bottom = useRef(null);
  const others = (sec.data?.members ?? c.members ?? []).map((m) => m.user ?? m.username).filter((u) => u && u.toLowerCase() !== session.user.toLowerCase());
  const nameOf = (u) => (sec.data?.members ?? c.members ?? []).find((m) => (m.user ?? m.username) === u)?.name ?? u;
  const msgs = t.data?.messages ?? [];
  const lastAt = msgs.length ? msgs[msgs.length - 1].uid : '';
  useEffect(() => { bottom.current?.scrollIntoView?.({ block: 'end' }); }, [lastAt]);
  // privacy screen: when the tab is hidden (app switcher, another tab) the words are covered; a browser cannot block screenshots (D-277)
  useEffect(() => { const f = () => setHidden(document.visibilityState === 'hidden'); document.addEventListener('visibilitychange', f); return () => document.removeEventListener('visibilitychange', f); }, []);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['sec'] }); qc.invalidateQueries({ queryKey: ['msg'] }); };
  const opts = { members: others, disappearSeconds: sec.data?.disappearSeconds ?? 0 };
  const run = async (fn) => {
    setBusy(true); setError(null);
    try { await fn(); refresh(); } catch (e) { if (e instanceof KeyChangeError) setChanges(e.changes); else setError(errorText(e)); } finally { setBusy(false); }
  };
  const setup = () => run(async () => { await ensureDevice(session); });
  const submit = (e) => { e.preventDefault(); if (!text.trim() && !links.length) return; run(async () => { await send(session, id, { v: 1, t: 'text', body: text.trim(), ...(links.length ? { links: links.map(({ entity, id: rid }) => ({ entity, id: rid })) } : {}) }, opts); setText(''); setLinks([]); setChanges(null); }); };
  const attach = (files) => run(async () => { for (const f of files) { if (sec.data && !sec.data.policy.allowAttachments) throw new Error('The policy does not allow attachments in secure conversations.'); if (sec.data && f.size > sec.data.policy.maxAttachmentMb * 1024 * 1024) throw new Error(`A file can be at most ${sec.data.policy.maxAttachmentMb} MB.`); await sendFile(session, id, f, opts); } });
  const accept = () => run(async () => { for (const ch of changes) await acceptKeys(session, ch.user, ch.fingerprints, false); setChanges(null); });
  const noDevice = t.data && !t.data.device;
  const setDisappear = (v) => run(async () => { await secApi.disappearing(id, Number(v)); });
  let lastDay = '';
  return (
    <section className={`msg-conv msg-secure${compact ? ' is-compact' : ''}${hidden ? ' is-screen-hidden' : ''}`} aria-label={`Secure conversation with ${c.title}`} data-testid="msg-conversation" data-secure="true">
      <header className="msg-conv-head">
        {onBack && <button type="button" className="btn" onClick={onBack} aria-label="Back to the conversations" data-testid="msg-back"><Icon name="erp.action.previous" size={18} /></button>}
        <div className="msg-conv-title"><h2><span className="msg-lock"><Icon name="erp.action.lock" size={16} /></span> {c.title}</h2><span className="muted small" data-testid="secure-banner">End-to-end encrypted · {(sec.data?.members ?? c.members ?? []).length} people</span></div>
        <button type="button" className="btn" onClick={() => nav(`/collab/safety-number?c=${id}`)} data-testid="safety-link">Safety number</button>
        {onDetails && <button type="button" className="btn" onClick={onDetails} aria-label="Conversation details" data-testid="msg-details"><Icon name="erp.action.info" size={18} /></button>}
        {onPopOut && <button type="button" className="btn" onClick={onPopOut} aria-label="Open in a small window" data-testid="msg-popout"><Icon name="erp.action.next" size={18} /></button>}
        {onMinimise && <button type="button" className="btn" onClick={onMinimise} aria-label="Minimise">–</button>}
        {onClose && <button type="button" className="btn" onClick={onClose} aria-label="Close this window">×</button>}
      </header>
      <p className="notice small" data-testid="secure-notice">Messages are encrypted on your device. The company and the system administrators cannot read them. If you lose this device, what was on it cannot be recovered.{sec.data?.policy.screenshotWarning && ' Screenshots cannot be blocked in a browser: do not share what you see.'}</p>
      <label className="field field-inline msg-disappear"><span>Disappearing messages</span>
        <select value={sec.data?.disappearSeconds ?? 0} onChange={(e) => setDisappear(e.target.value)} disabled={!sec.data || busy} data-testid="disappear">{(sec.data?.allowedDisappearSeconds ?? [0]).map((s) => <option key={s} value={s}>{secLabel(s)}</option>)}</select></label>
      {changes && (
        <div className="notice is-warning" role="alert" data-testid="key-change">
          <strong>The safety number changed.</strong> {changes.map((ch) => `${ch.name ?? ch.user} ${ch.added.length ? `added a device` : ''}${ch.added.length && ch.removed.length ? ' and ' : ''}${ch.removed.length ? 'removed a device' : ''}${ch.wasVerified ? ' (you had verified this person)' : ''}`).join('; ')}.
          Check it with them (in person or by phone) before you send anything private.
          <div className="actions"><button type="button" className="btn" onClick={() => nav(`/collab/safety-number?c=${id}`)} data-testid="key-verify">Verify the safety number</button><button type="button" className="btn btn-primary" onClick={accept} disabled={busy} data-testid="key-accept">Accept the new keys and continue</button></div>
        </div>
      )}
      {(sec.isError || t.isError) && <QueryError error={sec.error ?? t.error} what="this secure conversation" permission="" onRetry={() => { sec.refetch(); t.refetch(); }} />}
      {t.isPending && <Skeleton label="Opening the secure conversation" rows={3} />}
      {noDevice && (
        <div className="card" data-testid="secure-setup">
          <h3>Set up secure messaging on this device</h3>
          <p>This browser has no keys yet. Setting up makes a pair of keys that stay on this device; only the public key is sent to the company. Messages sent before this will not appear here.</p>
          <button type="button" className="btn btn-primary" onClick={setup} disabled={busy} data-testid="secure-setup-go">Set up this device</button>
        </div>
      )}
      {t.data && !noDevice && (
        <ol className="msg-thread" aria-label="Messages" tabIndex={0} data-testid="msg-thread">
          {msgs.length === 0 && <li className="muted msg-empty">No messages on this device yet. What you write is encrypted before it is sent.</li>}
          {msgs.map((m) => {
            const day = dayKey(m.at);
            const sep = day !== lastDay;
            lastDay = day;
            return <Fragment key={m.uid}>{sep && <li className="msg-day" role="separator"><span>{day === dayKey(new Date().toISOString()) ? 'Today' : formatDate(m.at)}</span></li>}<Bubble m={m} who={nameOf} /></Fragment>;
          })}
          <li ref={bottom} aria-hidden="true" />
        </ol>
      )}
      {t.data && !noDevice && (
        <form className="msg-composer" onSubmit={submit} noValidate aria-label="Write a secure message" data-testid="composer">
          {links.length > 0 && <ul className="msg-attached" aria-label="Linked records">{links.map((l) => <li key={`${l.entity}:${l.id}`}>{l.label} <button type="button" className="btn btn-small" aria-label={`Remove ${l.label}`} onClick={() => setLinks(links.filter((x) => x !== l))}>×</button></li>)}</ul>}
          {picker && <RecordPicker onPick={(r) => { setLinks([...links, r]); setPicker(false); }} />}
          <div className="msg-compose-row">
            <label className="sr-only" htmlFor={`scompose-${id}`}>Secure message</label>
            <textarea id={`scompose-${id}`} rows="1" value={text} maxLength={4000} placeholder="Write a secure message" onChange={(e) => setText(e.target.value)} data-testid="compose-input" />
            <input ref={file} type="file" hidden multiple data-testid="compose-file" onChange={(e) => { attach([...e.target.files]); e.target.value = ''; }} />
            <button type="button" className="btn" aria-label="Attach an encrypted file" onClick={() => file.current?.click()} data-testid="compose-attach"><Icon name="erp.action.attach" size={18} /></button>
            <button type="button" className="btn" aria-label="Link a record" aria-expanded={picker} onClick={() => setPicker(!picker)} data-testid="compose-record"><Icon name="erp.action.drill" size={18} /></button>
            <button type="submit" className="btn btn-primary" disabled={busy || (!text.trim() && !links.length)} data-testid="compose-send"><Icon name="erp.action.submit" size={18} /> Send</button>
          </div>
          {error && <p className="field-error" role="alert" data-testid="compose-error">{error}</p>}
        </form>
      )}
    </section>
  );
}
