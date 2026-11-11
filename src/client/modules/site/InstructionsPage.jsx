import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { DiscussionTab } from '../../platform/collab/CollabTabs.jsx';
import { Field, Link, Tile, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { AttachmentList, FileUploader } from '../core/components/Attachments.jsx';
import { useSession } from '../core/api/index.js';
import { INS_TONE, download, fmtDate, openPrint, st } from './api.js';
import { useSearch } from './parts.jsx';
import { InstructionForm } from './InstructionIssuePage.jsx';

// Site Instructions (part 14.04): the register with the received and issued tabs and the compliance tracker; one instruction with its notice prompt, the variation decision, the back-charge, the recipients with
// their acknowledgement and compliance evidence, closing (not before the variation decision or compliance), amendment and approval.
const refresh = (qc) => { qc.invalidateQueries({ queryKey: ['site'] }); qc.invalidateQueries({ queryKey: ['list'] }); };

function Recipient({ t, d, a, busy, run, onUp }) {
  const [note, setNote] = useState(''); const [up, setUp] = useState(0);
  return (
    <li className="mdm-panel" style={{ margin: 0 }} data-testid="ins-ack" data-state={a.state}>
      <strong>{a.partyName}</strong> <span className="muted">({t(`cnd.ins.pt.${a.partyType}`)})</span> <StatusBadge status={a.state === 'COMPLIED' ? 'COMPLETED' : a.state === 'ACKNOWLEDGED' ? 'IN_REVIEW' : 'DRAFT'} label={t(`cnd.ins.as.${a.state}`)} />
      <div className="muted small">{a.acknowledgedAt ? `${t('cnd.ins.acknowledged')}: ${String(a.acknowledgedAt).slice(0, 16).replace('T', ' ')} · ${a.acknowledgedBy}` : t('cnd.ins.notAcknowledged')}{a.closedAt ? ` · ${t('cnd.ins.complied')}: ${String(a.closedAt).slice(0, 16).replace('T', ' ')}` : ''}</div>
      {a.complianceNote && <p>{a.complianceNote}</p>}
      {a.can.acknowledge && <button type="button" className="btn btn-primary" style={{ minHeight: 44 }} disabled={busy} onClick={() => run(() => st.insAck(d.id, a.id, 'acknowledge'), t('cnd.ins.ackDone'))} data-testid="ins-ack-go">{t('cnd.ins.acknowledge')}</button>}
      {a.can.attach && a.acknowledgedAt && <FileUploader entity="site_instruction_ack" entityId={a.id} onDone={() => { setUp((n) => n + 1); onUp(); }} />}
      {(a.evidence > 0 || a.can.attach) && <AttachmentList key={up} entity="site_instruction_ack" entityId={a.id} canEdit={a.can.attach} />}
      {a.can.comply && <div className="actions-row"><input aria-label={t('cnd.ins.complianceNote')} placeholder={t('cnd.ins.complianceNote')} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} style={{ minHeight: 44 }} data-testid="ins-comply-note" /><button type="button" className="btn btn-primary" style={{ minHeight: 44 }} disabled={busy} onClick={() => run(() => st.insAck(d.id, a.id, 'comply', { note: note.trim() }), t('cnd.ins.complyDone'))} data-testid="ins-comply-go">{t('cnd.ins.comply')}</button></div>}
    </li>
  );
}

function Instruction({ t, id, onGone }) {
  const qc = useQueryClient(); const q = useQuery({ queryKey: ['site', 'instruction', id], queryFn: () => st.instruction(id), retry: false });
  const hq = useQuery({ queryKey: ['site', 'ins-history', id], queryFn: () => st.insHistory(id), enabled: q.isSuccess, retry: false });
  const [error, setError] = useState(null); const [note, setNote] = useState(null); const [busy, setBusy] = useState(false); const [talk, setTalk] = useState(false); const [up, setUp] = useState(0); const [comment, setComment] = useState('');
  const [closing, setClosing] = useState(false); const [cn, setCn] = useState(''); const [vd, setVd] = useState({ decision: 'ACCEPTED', ref: '', note: '' }); const [editing, setEditing] = useState(false);
  usePageTitle(q.data ? `${q.data.docNo} · ${t('cnd.ins.title')}` : t('cnd.ins.title'));
  if (q.error?.status === 403) return <NoPermission what={t('cnd.ins.title')} permission="site.instruction.view" />;
  if (q.isPending) return <Skeleton label={t('cnd.ins.title')} rows={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data; const can = d.can;
  const run = async (fn, done) => { setError(null); setNote(null); setBusy(true); try { const x = await fn(); if (done) setNote(done); refresh(qc); return x; } catch (e) { setError(errorInfo(e)); return null; } finally { setBusy(false); } };
  const why = (fn, done) => { const x = window.prompt(t('act.why')); if (x) run(() => fn(x), done); };
  const decide = (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('dpr.sayWhy') }); return; } run(() => st.decide(d.taskId, action, comment.trim() || null), t(`dpr.done.${action}`)); };
  if (editing) return <InstructionForm t={t} editing={d} onSaved={() => { setEditing(false); refresh(qc); }} onCancel={() => setEditing(false)} />;
  const noticeLate = d.noticeDueDate && !d.letter && d.noticeDueDate <= new Date(Date.now() + 19_800_000).toISOString().slice(0, 10);
  return (
    <div data-testid="ins-object" data-status={d.status}>
      <h1 id="ins-h">{d.docNo} · {d.subject} <StatusBadge status={INS_TONE[d.status]} label={t(`cnd.ins.s.${d.status}`)} />{d.overdue && <> <StatusBadge status="OVERDUE" label={t('cnd.ins.overdue')} /></>}</h1>
      <p><Link to="/site/instructions">{t('cnd.ins.back')}</Link>{d.revisionNo > 1 && <> · {t('dpr.amendmentOf', { n: d.previous?.docNo ?? '' })}</>}</p>
      <dl className="kv" data-testid="ins-figures">
        <div><dt>{t('cnd.ins.type')}</dt><dd>{t(`cnd.ins.t.${d.type}`)}</dd></div><div><dt>{t('f.site')}</dt><dd>{d.projectCode} · {d.siteCode} {d.siteName}</dd></div><div><dt>{t('f.date')}</dt><dd>{fmtDate(d.date)}{d.theirRef ? ` · ${d.theirRef}` : ''}</dd></div>
        <div><dt>{t('cnd.ins.from')}</dt><dd>{d.fromParty}</dd></div><div><dt>{t('cnd.ins.to')}</dt><dd>{d.toParty ?? '—'}</dd></div><div><dt>{t('cnd.ins.due')}</dt><dd>{d.dueDate ? fmtDate(d.dueDate) : '—'}</dd></div>
        <div><dt>{t('cnd.ins.location')}</dt><dd>{d.location ?? '—'}</dd></div><div><dt>{t('cnd.ins.activity')}</dt><dd>{d.activity ?? '—'}</dd></div>
        <div><dt>{t('cnd.ins.cost')}</dt><dd>{d.costImplication ? t('cnd.yes') : t('cnd.no')}</dd></div><div><dt>{t('cnd.ins.time')}</dt><dd>{d.timeImplication ? t('cnd.yes') : t('cnd.no')}</dd></div>
        {d.backcharge && <div data-testid="ins-backcharge"><dt>{t('cnd.ins.backcharge')}</dt><dd>{d.backchargePartner ?? '—'} · {d.amountMasked ? t('cnd.ins.amountMasked') : `₹ ${Number(d.backchargeAmount ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`}</dd></div>}
        <div><dt>{t('wa.raisedBy')}</dt><dd>{d.requestedBy ?? '—'}</dd></div>{d.approvedAt && <div><dt>{t('wa.approvedBy')}</dt><dd>{d.approvedBy} · {fmtDate(d.approvedAt.slice(0, 10))}</dd></div>}
      </dl>
      {d.description && <p style={{ whiteSpace: 'pre-wrap' }}>{d.description}</p>}
      {d.status === 'OPEN' && <p className="muted" data-testid="ins-locked">{t('cnd.ins.locked')}</p>}
      {d.closureNotes && <p data-testid="ins-closure"><strong>{t('cnd.ins.closure')}:</strong> {d.closureNotes}</p>}
      {error?.form && <p className="field-error" role="alert" data-testid="ins-obj-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 3).join('; ')}` : ''}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="ins-obj-note">{note}</p>}
      <div className="actions-row no-print">
        {can.edit && <button type="button" className="btn" onClick={() => setEditing(true)} data-testid="ins-edit">{t('act.edit')}</button>}
        {can.submit && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run(() => st.insAct(d.id, 'submit'), d.needsApproval ? t('act.sent') : t('cnd.ins.opened'))} data-testid="ins-submit">{d.needsApproval ? t('act.submit') : d.direction === 'RECEIVED' ? t('cnd.ins.register') : t('cnd.ins.issue')}</button>}
        {can.withdraw && <button type="button" className="btn" onClick={() => why((x) => st.insAct(d.id, 'withdraw', { reason: x }))}>{t('act.withdraw')}</button>}
        {can.cancel && <button type="button" className="btn" onClick={() => why((x) => st.insAct(d.id, 'cancel', { reason: x }))} data-testid="ins-cancel">{t('act.cancel')}</button>}
        {can.delete && <button type="button" className="btn" onClick={async () => { if (window.confirm(t('cnd.ins.deleteAsk')) && await run(() => st.removeInstruction(d.id))) onGone(); }}>{t('act.delete')}</button>}
        {can.amend && <button type="button" className="btn" onClick={async () => { const x = window.prompt(t('act.why')); if (x) { const n = await run(() => st.insAct(d.id, 'amend', { reason: x })); if (n) navigateTo(`/site/instructions?id=${n.id}`); } }} data-testid="ins-amend">{t('cnd.hin.amend')}</button>}
        {d.status === 'OPEN' && (can.close || d.blockers.length > 0) && <button type="button" className="btn btn-primary" onClick={() => setClosing(!closing)} aria-expanded={closing} data-testid="ins-close-open">{t('cnd.ins.close')}</button>}
        {can.print && <button type="button" className="btn" onClick={() => openPrint(`/instructions/${d.id}/print`).catch(() => null)} data-testid="ins-print">{t('act.print')}</button>}
        {can.print && <button type="button" className="btn" onClick={() => download(`/instructions/${d.id}/pdf`, `${d.docNo.replace(/\W+/g, '-')}.pdf`).catch(() => setError({ form: t('bl.fileFailed') }))} data-testid="ins-pdf">PDF</button>}
        <button type="button" className="btn" onClick={() => setTalk(!talk)} aria-expanded={talk}>{t('act.discussion')}</button>
        {d.workflowInstanceId && <Link to={`/workflow/instance?id=${d.workflowInstanceId}`}>{t('act.approval')}</Link>}
      </div>
      {closing && (
        <form className="mdm-panel no-print" data-testid="ins-close-form" onSubmit={async (e) => { e.preventDefault(); const x = await run(() => st.insAct(d.id, 'close', { closureNotes: cn.trim() }), t('cnd.ins.closedNote')); if (x) setClosing(false); }}>
          <h2>{t('cnd.ins.close')}</h2><p className="muted">{t('cnd.ins.closeHelp')}</p>
          <Field label={t('cnd.ins.closure')} name="closureNotes"><input value={cn} maxLength={2000} onChange={(e) => setCn(e.target.value)} data-testid="ins-close-notes" /></Field>
          <button type="submit" className="btn btn-primary" disabled={busy} data-testid="ins-close-go">{t('cnd.ins.close')}</button>
        </form>
      )}
      {d.taskId && (
        <div className="mdm-panel no-print" data-testid="ins-decide"><h2>{t('dpr.decide')}</h2>
          <label>{t('mb.comment')}<input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} style={{ minHeight: 44 }} data-testid="ins-comment" /></label>
          <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('approve')} data-testid="ins-approve">{t('mb.approve')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('return')}>{t('mb.return')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('reject')}>{t('mb.reject')}</button></div>
        </div>
      )}
      {talk && <div className="mdm-panel"><DiscussionTab entity="site_instruction" id={d.id} /></div>}
      {d.direction === 'RECEIVED' && (d.costImplication || d.timeImplication) && (
        <div className="mdm-panel" data-testid="ins-variation"><h2>{t('cnd.ins.variation')}</h2>
          <p data-testid="ins-notice" className={noticeLate ? 'field-error' : 'muted'}>{t('cnd.ins.noticeDue', { d: d.noticeDueDate ? fmtDate(d.noticeDueDate) : '—' })} {d.letter ? <Link to={`/engg/letters?id=${d.letter.id}`}>{d.letter.letterNo}</Link> : <><span>{t('cnd.ins.noNotice')}</span> <Link to="/engg/letters">{t('cnd.ins.raiseNotice')}</Link></>}</p>
          {d.variationDecision ? <p data-testid="ins-variation-done"><StatusBadge status={d.variationDecision === 'ACCEPTED' ? 'APPROVED' : 'REJECTED'} label={d.variationLabel} /> {d.variationRef ?? ''} {d.variationNote ?? ''} · {d.variationBy}</p>
            : d.costImplication ? <p className="mdm-banner" role="status" data-testid="ins-variation-pending">{t('cnd.ins.variationPending')}</p> : <p className="muted">{t('cnd.ins.timeOnly')}</p>}
          {can.variation && (
            <form className="no-print" onSubmit={(e) => { e.preventDefault(); run(() => st.insAct(d.id, 'variation-decision', { decision: vd.decision, ref: vd.ref.trim() || null, note: vd.note.trim() || null }), t('cnd.ins.variationDone')); }} data-testid="ins-variation-form">
              <div className="form-grid"><Field label={t('cnd.ins.decision')} name="decision"><select value={vd.decision} onChange={(e) => setVd({ ...vd, decision: e.target.value })} data-testid="ins-vd-decision">{['ACCEPTED', 'REJECTED', 'WITHDRAWN'].map((x) => <option key={x} value={x}>{t(`cnd.ins.v.${x}`)}</option>)}</select></Field>
                <Field label={t('cnd.ins.variationRef')} name="ref"><input value={vd.ref} maxLength={80} onChange={(e) => setVd({ ...vd, ref: e.target.value })} data-testid="ins-vd-ref" /></Field></div>
              <Field label={t('cnd.notes')} name="note"><input value={vd.note} maxLength={1000} onChange={(e) => setVd({ ...vd, note: e.target.value })} /></Field>
              <button type="submit" className="btn btn-primary" disabled={busy} data-testid="ins-vd-go">{t('cnd.ins.recordDecision')}</button>
            </form>
          )}
        </div>
      )}
      {d.direction === 'ISSUED' && (
        <div className="mdm-panel" data-testid="ins-recipients"><h2>{t('cnd.ins.recipients')} ({d.acks.length})</h2>
          {d.status === 'SUBMITTED' && <p className="muted">{t('cnd.ins.waitingApproval')}</p>}
          {d.acks.length === 0 ? <p className="muted">{t('cnd.ins.noRecipients')}</p> : <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 8 }}>{d.acks.map((a) => <Recipient key={a.id} t={t} d={d} a={a} busy={busy} run={run} onUp={() => refresh(qc)} />)}</ul>}
        </div>
      )}
      <div className="mdm-panel" data-testid="ins-attachments"><h2>{t('cnd.diary.attachments')} ({d.attachments})</h2>
        {(can.edit || (d.status === 'OPEN' && can.addParties)) && <FileUploader entity="site_instruction" entityId={d.id} onDone={() => { setUp((n) => n + 1); refresh(qc); }} />}
        <AttachmentList key={up} entity="site_instruction" entityId={d.id} canEdit={can.edit} />
      </div>
      {d.letter && d.direction === 'ISSUED' && <p>{t('cnd.hin.letter')}: <Link to={`/engg/letters?id=${d.letter.id}`}>{d.letter.letterNo} {d.letter.subject}</Link></p>}
      {hq.data && (hq.data.approvals.length > 0 || hq.data.audit.length > 0) && (
        <div className="table-scroll"><table className="data-table" data-testid="ins-history"><caption>{t('wa.history')}</caption><thead><tr><th>{t('wa.when')}</th><th>{t('wa.who')}</th><th>{t('wa.what')}</th><th>{t('wa.note')}</th></tr></thead>
          <tbody>{[...hq.data.audit.map((a) => ({ at: a.at, who: a.actor, what: a.action, note: a.reason })), ...hq.data.approvals.map((a) => ({ at: a.at, who: a.actor, what: `${a.event}${a.step_code ? ` (${a.step_code})` : ''}`, note: a.comment }))].sort((x, y) => String(x.at).localeCompare(String(y.at))).map((r, i) => <tr key={i}><td>{String(r.at ?? '').slice(0, 16).replace('T', ' ')}</td><td>{r.who}</td><td>{r.what}</td><td>{r.note ?? ''}</td></tr>)}</tbody></table></div>
      )}
    </div>
  );
}

function Tracker({ t }) {
  const q = useQuery({ queryKey: ['site', 'ins-tracker'], queryFn: () => st.insTracker(), retry: false });
  if (q.isPending) return <Skeleton label={t('cnd.ins.tracker')} rows={2} />;
  if (q.isError) return q.error?.status === 403 ? null : <ErrorState error={q.error} onRetry={q.refetch} />;
  const c = q.data.counts;
  return (
    <div className="mdm-panel" data-testid="ins-tracker"><h2>{t('cnd.ins.tracker')}</h2>
      <div className="tiles"><Tile label={t('cnd.ins.tOpen')} value={c.open} testId="ins-t-open" /><Tile label={t('cnd.ins.tAck')} value={c.awaitingAck} status={c.awaitingAck ? 'warning' : 'success'} testId="ins-t-ack" /><Tile label={t('cnd.ins.tComply')} value={c.awaitingCompliance} status={c.awaitingCompliance ? 'warning' : 'success'} testId="ins-t-comply" />
        <Tile label={t('cnd.ins.tVariation')} value={c.variationPending} status={c.variationPending ? 'warning' : 'success'} testId="ins-t-variation" /><Tile label={t('cnd.ins.tNotice')} value={c.noticeDue} status={c.noticeDue ? 'danger' : 'success'} testId="ins-t-notice" /><Tile label={t('cnd.ins.tOverdue')} value={c.overdue} status={c.overdue ? 'danger' : 'success'} testId="ins-t-overdue" /></div>
      {q.data.items.length > 0 && <ul data-testid="ins-tracker-items">{q.data.items.slice(0, 8).map((i) => <li key={i.id}><Link to={`/site/instructions?id=${i.id}`}>{i.docNo}</Link> · {i.subject} · {t(`cnd.ins.cs.${i.state}`)}{i.overdue ? ` · ${t('cnd.ins.overdue')}` : ''}{i.noticeDue ? ` · ${t('cnd.ins.tNotice')}` : ''}</li>)}</ul>}
    </div>
  );
}

export default function InstructionsPage() {
  const t = useT('site'); usePageTitle(t('cnd.ins.title'));
  const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession(); const perms = session.data?.permissions ?? []; const dir = sp.get('filter[direction]') ?? '';
  if (id) return <section aria-labelledby="ins-h" data-testid="site-instructions"><Instruction key={id} t={t} id={id} onGone={() => navigateTo('/site/instructions')} /></section>;
  const tab = (value, label) => <Link to={value ? `/site/instructions?filter[direction]=${value}` : '/site/instructions'}><span aria-current={dir === value ? 'page' : undefined} style={{ fontWeight: dir === value ? 700 : 400 }} data-testid={`ins-tab-${value || 'all'}`}>{label}</span></Link>;
  return (
    <section aria-labelledby="ins-h" data-testid="site-instructions">
      <h1 id="ins-h">{t('cnd.ins.title')}</h1>
      <div className="actions-row no-print" role="navigation" aria-label={t('cnd.ins.tabs')}>{tab('', t('cnd.ins.tabAll'))} {tab('RECEIVED', t('cnd.ins.tabReceived'))} {tab('ISSUED', t('cnd.ins.tabIssued'))}{perms.includes('site.instruction.create') && <> · <Link to="/site/instruction-issue">{t('cnd.ins.new')}</Link></>}</div>
      <Tracker t={t} />
      <ListReport key={dir} listCode="site.instructions" endpoint="/site/instructions" title={t('cnd.ins.title')} session={session.data} rowHref={(r) => `/site/instructions?id=${r.id}`} onOpen={(r) => navigateTo(`/site/instructions?id=${r.id}`)}
        cardFields={['docNo', 'subject', 'site', 'dueDate', 'openAcks']} statusKey="status" empty={{ title: t('cnd.ins.emptyTitle'), text: t('cnd.ins.emptyBody') }} />
    </section>
  );
}
