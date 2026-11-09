import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDateTime } from '../../platform/format.js';
import { authHeaders } from '../../platform/api/index.js';
import { INSTR_STATUS, PRIORITY, comm } from '../../platform/messages/Comm.jsx';
import { Field, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';

// Instruction Register (part 05.04, section 7.3): the instructions a person sent (or all of them, for those who may see all): sender, recipients, acknowledgement percentage, overdue. A parameter panel, KPI tiles and a bar
// for each instruction, drill-down to the recipients and the message, CSV export that honours the filters, and cancel for the sender.
export default function InstructionRegisterPage() {
  usePageTitle('Instruction Register');
  const qc = useQueryClient();
  const [f, setF] = useState({ view: 'sent', status: '', priority: '', overdue: '', q: '', from: '', to: '' });
  const [open, setOpen] = useState(null);
  const [error, setError] = useState(null);
  const q = useQuery({ queryKey: ['comm', 'register', f], queryFn: () => comm.instructions(f), retry: false, placeholderData: (p) => p });
  const detail = useQuery({ queryKey: ['comm', 'instruction', open], queryFn: () => comm.instruction(open), enabled: Boolean(open), retry: false });
  if (q.error?.status === 403) return <NoPermission what="the instruction register" permission="msg.instruction.send" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (q.isPending) return <Skeleton label="Loading the register" rows={4} />;
  const d = q.data;
  const set = (p) => setF((cur) => ({ ...cur, ...p }));
  const exportCsv = async () => { const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString(); const res = await fetch(`/api/v1/msg/instructions/export?${qs}`, { headers: authHeaders() }); const url = URL.createObjectURL(await res.blob()); Object.assign(document.createElement('a'), { href: url, download: 'instruction-register.csv' }).click(); URL.revokeObjectURL(url); };
  const cancel = async (r) => { const why = window.prompt('Why is this instruction being cancelled?') ?? ''; if (why.trim().length < 5) return; try { await comm.cancelInstruction(r.id, why.trim()); qc.invalidateQueries({ queryKey: ['comm'] }); } catch (e) { setError(errorInfo(e)); } };
  return (
    <section aria-labelledby="ir-title" data-testid="instruction-register">
      <h1 id="ir-title">Instruction Register</h1>
      <form className="srch-form" role="search" aria-label="Filter the register" onSubmit={(e) => e.preventDefault()}>
        {d.canAll && <Field label="Show" name="view" error={null}><select value={f.view} onChange={(e) => set({ view: e.target.value })} data-testid="ir-view"><option value="sent">Sent by me</option><option value="all">All instructions</option></select></Field>}
        <Field label="Status" name="status" error={null}><select value={f.status} onChange={(e) => set({ status: e.target.value })} data-testid="ir-status"><option value="">Any</option>{Object.entries(INSTR_STATUS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Priority" name="priority" error={null}><select value={f.priority} onChange={(e) => set({ priority: e.target.value })}><option value="">Any</option>{Object.entries(PRIORITY).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Overdue only" name="overdue" error={null}><select value={f.overdue} onChange={(e) => set({ overdue: e.target.value })} data-testid="ir-overdue"><option value="">No</option><option value="1">Yes</option></select></Field>
        <Field label="Search" name="q" error={null}><input type="search" value={f.q} onChange={(e) => set({ q: e.target.value })} data-testid="ir-q" /></Field>
        <Field label="From" name="from" error={null}><input type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} /></Field>
        <Field label="To" name="to" error={null}><input type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} /></Field>
        <button type="button" className="btn" onClick={exportCsv} data-testid="ir-export">Export CSV</button>
      </form>
      <div className="cc-tiles" role="group" aria-label="Totals">
        {[['Instructions', d.summary.total], ['Open', d.summary.open], ['Escalated', d.summary.escalated], ['Overdue', d.summary.overdue], ['Average acknowledged', `${d.summary.percent}%`]].map(([l, v]) => <div key={l} className="cc-tile" data-testid={`ir-sum-${l.split(' ')[0].toLowerCase()}`}><span className="cc-value num">{v}</span><span className="cc-label">{l}</span></div>)}
      </div>
      {error?.form && <p className="field-error" role="alert">{error.form}</p>}
      {d.rows.length === 0 ? <EmptyState title="No instruction matches" message="Mark a message of yours as an instruction in Messages, or change the filters." action={<button type="button" className="btn btn-primary" onClick={() => navigateTo('/collab/messages')}>Open Messages</button>} /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Instructions"><table className="grid"><thead><tr><th>Instruction</th><th>Sender</th><th>Conversation</th><th>Priority</th><th>Due</th><th>Status</th><th>Acknowledged</th></tr></thead>
          <tbody>{d.rows.map((r) => (
            <tr key={r.id} className={r.overdue ? 'is-overdue' : ''} data-testid="ir-row">
              <th scope="row" data-label="Instruction"><button type="button" className="link-button" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id} data-testid="ir-open">{r.title}</button></th>
              <td data-label="Sender">{r.sender.name}</td><td data-label="Conversation">{r.conversation}</td>
              <td data-label="Priority"><StatusBadge status={PRIORITY[r.priority][0]} label={PRIORITY[r.priority][1]} /></td>
              <td data-label="Due">{r.dueAt ? formatDateTime(r.dueAt) : '—'}{r.overdue ? ' · overdue' : ''}</td>
              <td data-label="Status"><StatusBadge status={INSTR_STATUS[r.status][0]} label={INSTR_STATUS[r.status][1]} /></td>
              <td data-label="Acknowledged"><span className="cc-bar" role="img" aria-label={`${r.percent} percent`}><i style={{ width: `${r.percent}%` }} /></span> {r.acknowledged} of {r.total} ({r.percent}%)</td>
            </tr>))}</tbody></table></div>
      )}
      {open && (
        <section className="card" aria-label="Instruction details" data-testid="ir-detail">
          {detail.isPending ? <Skeleton label="Loading" rows={2} /> : detail.isError ? <ErrorState error={detail.error} onRetry={detail.refetch} /> : (
            <>
              <h2>{detail.data.title}</h2><p className="muted">{detail.data.excerpt}</p>
              {detail.data.cancelReason && <p className="muted">Cancelled: {detail.data.cancelReason}</p>}
              {detail.data.recipients && <div className="table-wrap" tabIndex={0} role="region" aria-label="Recipients"><table className="grid"><thead><tr><th>Person</th><th>Acknowledged</th><th>Answer</th></tr></thead><tbody>{detail.data.recipients.map((r) => <tr key={r.username} data-testid="ir-recipient"><th scope="row" data-label="Person">{r.name}</th><td data-label="Acknowledged">{r.acknowledgedAt ? formatDateTime(r.acknowledgedAt) : 'Not yet'}</td><td data-label="Answer">{r.response ?? '—'}</td></tr>)}</tbody></table></div>}
              <div className="actions"><button type="button" className="btn" onClick={() => navigateTo(`/collab/messages?c=${detail.data.conversationId}&m=${detail.data.messageId}`)}>Open the message</button>{['OPEN', 'ESCALATED'].includes(detail.data.status) && <button type="button" className="btn" onClick={() => cancel(detail.data)} data-testid="ir-cancel">Cancel the instruction</button>}</div>
            </>
          )}
        </section>
      )}
    </section>
  );
}
