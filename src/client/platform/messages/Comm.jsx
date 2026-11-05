import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/index.js';
import StatusBadge from '../design/StatusBadge.jsx';
import { formatDateTime } from '../format.js';
import { useLiveRefresh } from '../realtime/socket.js';

// The Communication Center pieces of the Messages app (part 05.04): the instruction badge and form on a message, message-to-action, flagging a conversation as unresolved, and the data hooks of the center pages.
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const q = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
const errorText = (e) => `${e?.message ?? 'Something went wrong'}${e?.correlationId ? ` (Correlation ID: ${e.correlationId})` : ''}`;
export const PRIORITY = { URGENT: ['REJECTED', 'Urgent'], HIGH: ['IN_REVIEW', 'High'], NORMAL: ['DRAFT', 'Normal'], LOW: ['DRAFT', 'Low'] };
export const INSTR_STATUS = { OPEN: ['IN_REVIEW', 'Open'], ESCALATED: ['REJECTED', 'Escalated'], COMPLETED: ['COMPLETED', 'Everyone acknowledged'], CANCELLED: ['DRAFT', 'Cancelled'] };

export const comm = {
  summary: async () => (await api.get('/msg/center/summary')).data,
  pending: async () => (await api.get('/msg/acknowledgements/pending')).data,
  ack: async (id, response) => (await api.post(`/msg/instructions/${id}/ack`, { ...(response ? { response } : {}) }, idem())).data,
  bulkAck: async (ids) => (await api.post('/msg/acknowledgements/bulk', { ids }, idem())).data,
  instructions: async (f) => (await api.get(`/msg/instructions?${q(f)}`)).data,
  instruction: async (id) => (await api.get(`/msg/instructions/${id}`)).data,
  cancelInstruction: async (id, reason) => (await api.post(`/msg/instructions/${id}/cancel`, { reason }, idem())).data,
  makeInstruction: async (messageId, body) => (await api.post(`/msg/messages/${messageId}/instruction`, body, idem())).data,
  actionTypes: async () => (await api.get('/msg/action-types')).data.rows,
  draft: async (messageId, type) => (await api.get(`/msg/messages/${messageId}/action-draft?type=${type}`)).data,
  toAction: async (messageId, body) => (await api.post(`/msg/messages/${messageId}/to-action`, body, idem())).data,
  announcements: async (f) => (await api.get(`/msg/announcements?${q(f)}`)).data,
  announcement: async (id) => (await api.get(`/msg/announcements/${id}`)).data,
  createAnnouncement: async (b) => (await api.post('/msg/announcements', b, idem())).data,
  publishAnnouncement: async (id) => (await api.post(`/msg/announcements/${id}/publish`, {}, idem())).data,
  cancelAnnouncement: async (id, reason) => (await api.post(`/msg/announcements/${id}/cancel`, { reason }, idem())).data,
  audience: async (audience) => (await api.post('/msg/announcements/audience', { audience })).data,
  readAnnouncement: async (id) => (await api.post(`/msg/announcements/${id}/read`, {})).data,
  confirmAnnouncement: async (id, answers) => (await api.post(`/msg/announcements/${id}/confirm`, { answers }, idem())).data,
  escalate: async (convId, body) => (await api.post(`/msg/conversations/${convId}/escalate`, body, idem())).data,
  escalations: async (view) => (await api.get(`/msg/escalations?view=${view}`)).data.rows,
  resolve: async (id, resolution) => (await api.post(`/msg/escalations/${id}/resolve`, { resolution }, idem())).data,
  rules: async () => (await api.get('/msg/auto-group-rules')).data,
  proposeRules: async (b) => (await api.post('/msg/auto-group-rules/changes', b, idem())).data,
  syncGroups: async () => (await api.post('/msg/auto-group-rules/sync', {}, idem())).data,
};
export const useCenter = (session) => { useLiveRefresh(session?.user ? [`user:${session.user}`] : [], [['comm']]); return useQuery({ queryKey: ['comm', 'summary'], queryFn: comm.summary, retry: false, refetchInterval: 30_000 }); };
export const usePending = (session) => { useLiveRefresh(session?.user ? [`user:${session.user}`] : [], [['comm']]); return useQuery({ queryKey: ['comm', 'pending'], queryFn: comm.pending, retry: false, refetchInterval: 30_000 }); };
export const useRefreshComm = () => { const qc = useQueryClient(); return () => { qc.invalidateQueries({ queryKey: ['comm'] }); qc.invalidateQueries({ queryKey: ['msg'] }); }; };

/** The instruction on a message: who sent it, how urgent, when it is due, how many have acknowledged, and the button for a recipient who has not. */
export function InstructionBadge({ m }) {
  const refresh = useRefreshComm();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const i = m.instruction;
  const ack = async () => { setBusy(true); setError(null); try { await comm.ack(i.id); refresh(); } catch (e) { setError(e); } finally { setBusy(false); } };
  const pending = i.mine.recipient && !i.mine.acknowledgedAt && !['CANCELLED'].includes(i.status);
  return (
    <div className={`msg-instruction is-${i.priority.toLowerCase()}${i.overdue ? ' is-overdue' : ''}`} role="group" aria-label="Instruction" data-testid="instruction-badge">
      <strong>Instruction</strong> <StatusBadge status={PRIORITY[i.priority][0]} label={PRIORITY[i.priority][1]} /> <StatusBadge status={INSTR_STATUS[i.status][0]} label={INSTR_STATUS[i.status][1]} />
      <span className="muted small"> {i.dueAt ? `due ${formatDateTime(i.dueAt)}` : 'no due time'}{i.overdue ? ' · overdue' : ''} · {i.acknowledged} of {i.total} acknowledged</span>
      {i.mine.recipient && i.mine.acknowledgedAt && <span className="muted small"> · you acknowledged it</span>}
      {pending && <button type="button" className="btn btn-primary btn-small" onClick={ack} disabled={busy} data-testid="instruction-ack">Acknowledge</button>}
      {error && <span className="field-error" role="alert"> {errorText(error)}</span>}
    </div>
  );
}

/** Marks a message of the person as an instruction (priority, due time, acknowledgement). */
export function InstructionForm({ m, onClose }) {
  const refresh = useRefreshComm();
  const [priority, setPriority] = useState('NORMAL');
  const [due, setDue] = useState(new Date(Date.now() + 86_400_000 + 5.5 * 3_600_000).toISOString().slice(0, 10));
  const [title, setTitle] = useState('');
  const [ackReq, setAckReq] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => { e.preventDefault(); setBusy(true); setError(null); try { await comm.makeInstruction(m.id, { priority, dueAt: due || undefined, requiresAck: ackReq, ...(title.trim() ? { title: title.trim() } : {}) }); refresh(); onClose(); } catch (er) { setError(er); } finally { setBusy(false); } };
  return (
    <form className="msg-panel" onSubmit={submit} noValidate aria-label="Make this an instruction" data-testid="instruction-form">
      <h3>Make this an instruction</h3>
      <p className="muted small">The other people of this conversation have to acknowledge it. Whoever has not by the due time is escalated to their managers.</p>
      <label className="field"><span>Priority</span><select value={priority} onChange={(e) => setPriority(e.target.value)} data-testid="instr-priority"><option value="LOW">Low</option><option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="URGENT">Urgent</option></select></label>
      <label className="field"><span>Due *</span><input type="date" value={due} onChange={(e) => setDue(e.target.value)} data-testid="instr-due" /></label>
      <label className="field"><span>Short title (optional)</span><input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} data-testid="instr-title" /></label>
      <label className="field field-inline"><span>Acknowledgement is required</span><input type="checkbox" checked={ackReq} onChange={(e) => setAckReq(e.target.checked)} /></label>
      {error && <p className="field-error" role="alert" data-testid="instr-error">{errorText(error)}</p>}
      <div className="actions"><button type="submit" className="btn btn-primary btn-small" disabled={busy} data-testid="instr-send">Send as an instruction</button><button type="button" className="btn btn-small" onClick={onClose}>Cancel</button></div>
    </form>
  );
}

/** Message to action: the kinds of record, the form filled from the message (title, text, attachments, project), and what was made. */
export function ActionPanel({ m, onClose }) {
  const refresh = useRefreshComm();
  const types = useQuery({ queryKey: ['comm', 'action-types'], queryFn: comm.actionTypes, retry: false, staleTime: 60_000 });
  const [type, setType] = useState('TASK');
  const draft = useQuery({ queryKey: ['comm', 'draft', m.id, type], queryFn: () => comm.draft(m.id, type), retry: false });
  const [f, setF] = useState(null);
  const [error, setError] = useState(null);
  const [made, setMade] = useState(null);
  const d = draft.data;
  const form = f ?? (d ? { title: d.title, description: d.description, assignee: '', dueDate: '', priority: 'MEDIUM', includeAttachments: true } : null);
  const sel = types.data?.find((t) => t.type === type);
  const go = useMutation({ mutationFn: () => comm.toAction(m.id, { type, title: form.title, description: form.description, assignees: form.assignee ? [form.assignee] : [], ...(form.dueDate ? { dueDate: form.dueDate } : {}), priority: form.priority, includeAttachments: form.includeAttachments }), onSuccess: (r) => { setMade(r); refresh(); }, onError: (e) => setError(e) });
  const set = (p) => setF({ ...form, ...p });
  if (made) return (
    <div className="msg-panel" role="status" data-testid="action-made"><p><strong>Done.</strong> {sel?.label ?? 'Record'} <a href={made.route ?? '#'} data-testid="action-link" onClick={(e) => { if (made.route) { e.preventDefault(); window.history.pushState(null, '', made.route); window.dispatchEvent(new PopStateEvent('popstate')); } }}>{made.label}</a> was made{made.attachmentsCopied ? `, with ${made.attachmentsCopied} attachment(s)` : ''}. It is linked to this message.</p>
      {made.attachmentsFailed?.length > 0 && <p className="field-error" role="alert">Not copied: {made.attachmentsFailed.map((x) => `${x.name} (${x.why})`).join('; ')}</p>}
      <button type="button" className="btn btn-small" onClick={onClose}>Close</button></div>
  );
  return (
    <form className="msg-panel" onSubmit={(e) => { e.preventDefault(); setError(null); go.mutate(); }} noValidate aria-label="Make a record from this message" data-testid="action-form">
      <h3>Make a record from this message</h3>
      <label className="field"><span>What to make</span><select value={type} onChange={(e) => { setType(e.target.value); setF(null); setError(null); }} data-testid="action-type">{(types.data ?? []).map((t) => <option key={t.type} value={t.type}>{t.label}{t.available ? '' : ` (part ${t.part}, not live yet)`}</option>)}</select></label>
      {types.isPending && <p className="muted small">Loading…</p>}
      {sel && !sel.available && <p className="notice is-warning" role="status" data-testid="action-unavailable">{sel.label} is built in part {sel.part}, which is not live yet. Nothing can be made until it is.</p>}
      {sel?.available && form && (
        <>
          <label className="field"><span>Title *</span><input value={form.title} maxLength={200} onChange={(e) => set({ title: e.target.value })} data-testid="action-title" /></label>
          <label className="field"><span>Description</span><textarea rows="3" value={form.description} onChange={(e) => set({ description: e.target.value })} /></label>
          <label className="field"><span>Give it to</span><select value={form.assignee} onChange={(e) => set({ assignee: e.target.value })} data-testid="action-assignee"><option value="">Me</option>{(d?.people ?? []).map((p) => <option key={p.username} value={p.username}>{p.name}</option>)}</select></label>
          <label className="field"><span>Due</span><input type="date" value={form.dueDate} onChange={(e) => set({ dueDate: e.target.value })} data-testid="action-due" /></label>
          <label className="field"><span>Priority</span><select value={form.priority} onChange={(e) => set({ priority: e.target.value })}><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option><option value="URGENT">Urgent</option></select></label>
          {d?.attachments?.length > 0 && <label className="field field-inline"><span>Copy the attachments ({d.attachments.map((a) => a.name).join(', ')})</span><input type="checkbox" checked={form.includeAttachments} onChange={(e) => set({ includeAttachments: e.target.checked })} data-testid="action-attach" /></label>}
        </>
      )}
      {error && <p className="field-error" role="alert" data-testid="action-error">{errorText(error)}</p>}
      <div className="actions"><button type="submit" className="btn btn-primary btn-small" disabled={!sel?.available || !form || go.isPending || !form.title.trim()} data-testid="action-go">Make it</button><button type="button" className="btn btn-small" onClick={onClose}>Cancel</button></div>
    </form>
  );
}

/** What a message became (a task, ...): chips that open the record. */
export function ActionChips({ list }) {
  const ROUTES = { tsk_task: (id) => `/work/tasks/${id}` };
  return <span className="msg-action-chips" data-testid="action-chips">{list.map((a) => <a key={`${a.entity}:${a.id}`} className="lr-chip" href={ROUTES[a.entity]?.(a.id) ?? '#'} onClick={(e) => { const r = ROUTES[a.entity]?.(a.id); if (r) { e.preventDefault(); window.history.pushState(null, '', r); window.dispatchEvent(new PopStateEvent('popstate')); } }}>{a.type === 'TASK' ? 'Task' : a.type} {a.label}</a>)}</span>;
}

/** Flags the conversation as unresolved: it goes to the managers after the chosen hours unless somebody resolves it. */
export function EscalatePanel({ convId, onClose }) {
  const refresh = useRefreshComm();
  const [reason, setReason] = useState('');
  const [hours, setHours] = useState(24);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const submit = async (e) => { e.preventDefault(); setError(null); try { await comm.escalate(convId, { reason, afterHours: Number(hours) }); setDone(true); refresh(); } catch (er) { setError(er); } };
  if (done) return <div className="msg-panel" role="status" data-testid="escalate-done"><p>The conversation is flagged. It goes to the managers in {hours} hour(s) unless it is resolved.</p><button type="button" className="btn btn-small" onClick={onClose}>Close</button></div>;
  return (
    <form className="msg-panel" onSubmit={submit} noValidate aria-label="Flag this conversation as unresolved" data-testid="escalate-form">
      <h3>Flag this conversation as unresolved</h3>
      <label className="field"><span>What is unresolved *</span><textarea rows="2" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} data-testid="escalate-reason" /></label>
      <label className="field"><span>Escalate to my managers after</span><select value={hours} onChange={(e) => setHours(e.target.value)}><option value="1">1 hour</option><option value="4">4 hours</option><option value="24">24 hours</option><option value="72">3 days</option></select></label>
      {error && <p className="field-error" role="alert">{errorText(error)}</p>}
      <div className="actions"><button type="submit" className="btn btn-primary btn-small" disabled={reason.trim().length < 5} data-testid="escalate-go">Flag it</button><button type="button" className="btn btn-small" onClick={onClose}>Cancel</button></div>
    </form>
  );
}
