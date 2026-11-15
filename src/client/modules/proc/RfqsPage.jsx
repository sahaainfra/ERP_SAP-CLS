import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { QUOTE_TONE, RESPONSE_TONE, RFQ_TONE, download, fmtDate, fmtQty, fmtRs, pc } from './api.js';
import { useSearch } from '../site/parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Requests for quotation (part 15.03): the list; the RFQ with its lines, vendors and how each has answered, the quotations and the comparison (to those who may see rates), the clarification log and the actions of the buyer.
// Fewer vendors than the minimum on a value above the threshold needs the single-source justification, approved by the procurement manager and the project director. The links the vendors are sent are shown once, here.
const refresh = (qc) => { qc.invalidateQueries({ queryKey: ['proc'] }); qc.invalidateQueries({ queryKey: ['list'] }); };

function Links({ t, links }) {
  return (
    <div className="mdm-panel" data-testid="rfq-links"><h2>{t('q.linksTitle')}</h2><p className="muted">{t('q.linksHelp')}</p>
      <ul>{links.map((l) => <li key={l.vendorId} data-testid="rfq-link"><strong>{l.vendor}</strong> ({l.channel ?? ''}) <span className="muted">{l.sendStatus ? t(`q.send.${l.sendStatus}`) : ''}{l.note ? ` — ${l.note}` : ''}</span><br /><input readOnly value={l.url} onFocus={(e) => e.target.select()} style={{ width: '100%', minHeight: 40 }} aria-label={l.vendor} /></li>)}</ul></div>
  );
}

function Rfq({ t, id }) {
  const qc = useQueryClient(); const q = useQuery({ queryKey: ['proc', 'rfq', id], queryFn: () => pc.rfq(id), retry: false });
  const hq = useQuery({ queryKey: ['proc', 'rfq-history', id, q.data?.status], queryFn: () => pc.rfqHistory(id), enabled: q.isSuccess, retry: false });
  const cq = useQuery({ queryKey: ['proc', 'rfq-compare', id, q.data?.quotations?.length, q.data?.status], queryFn: () => pc.comparison(id), enabled: q.isSuccess && q.data.canSeeRates && q.data.respondedCount > 0, retry: false });
  const [error, setError] = useState(null); const [note, setNote] = useState(null); const [busy, setBusy] = useState(false); const [links, setLinks] = useState(null); const [comment, setComment] = useState(''); const [question, setQuestion] = useState(''); const [answers, setAnswers] = useState({});
  usePageTitle(t('q.title'));
  if (q.error?.status === 403) return <NoPermission what={t('q.title')} permission="proc.rfq.view" />;
  if (q.isPending) return <Skeleton label={t('q.title')} rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const r = q.data; const can = r.can;
  const run = async (fn, done) => { setError(null); setNote(null); setBusy(true); try { const x = await fn(); if (done) setNote(done); refresh(qc); return x; } catch (e) { setError(errorInfo(e)); return null; } finally { setBusy(false); } };
  const why = (action, msg, extra) => { const x = window.prompt(t('q.why')); if (x) run(() => pc.rfqAct(r.id, action, { reason: x, ...(extra ?? {}) }), msg); };
  const issue = () => run(() => pc.rfqAct(r.id, 'issue'), t('q.issued')).then((d) => { if (d) setLinks(d.links); });
  const reissue = (vendorId) => run(() => pc.rfqAct(r.id, 'reissue', { vendorId }), t('q.reissued')).then((d) => { if (d) setLinks([{ vendorId: d.vendorId, vendor: d.vendor, sendStatus: d.sendStatus, note: d.note, url: d.url }]); });
  const remind = () => run(() => pc.rfqAct(r.id, 'remind'), null).then((d) => { if (d) { setNote(t('q.reminded', { n: d.reminded })); setLinks(d.vendors.filter((v) => v.url).map((v) => ({ ...v }))); } });
  const amend = () => { const due = window.prompt(t('q.newDue'), r.dueDate); if (!due) return; const x = window.prompt(t('q.why')); if (x) run(() => pc.rfqAct(r.id, 'amend', { reason: x, dueDate: due }), t('q.amended')); };
  const regret = () => { const ids = r.vendors.filter((v) => !v.regretSentAt).map((v) => v.vendorId); if (ids.length) run(() => pc.rfqAct(r.id, 'regret', { vendorIds: ids }), t('q.regretSent')); };
  const decide = (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('q.sayWhy') }); return; } run(() => pc.decide(r.taskId, action, comment.trim() || null), t(`q.done.${action}`)); };
  const ask = () => { if (question.trim().length >= 5) run(() => pc.rfqAct(r.id, 'clarifications', { question: question.trim() }), t('q.asked')).then(() => setQuestion('')); };
  const terms = r.terms ?? {};
  return (
    <div data-testid="rfq-object" data-status={r.status}>
      <PageHeader id="rfq-h" title={<>{r.docNo} <StatusBadge status={RFQ_TONE[r.status]} label={t(`q.s.${r.status}`)} />{r.overdue && <> <StatusBadge status="AT_RISK" label={t('q.overdue')} /></>}</>} meta={<Link to="/proc/rfqs">{t('q.back')}</Link>} />
      <dl className="kv" data-testid="rfq-figures"><div><dt>{t('q.rfqTitle')}</dt><dd>{r.title}</dd></div><div><dt>{t('q.project')}</dt><dd>{r.projectCode}</dd></div><div><dt>{t('q.dueDate')}</dt><dd>{fmtDate(r.dueDate)}</dd></div>
        <div><dt>{t('q.vendorsAnswered')}</dt><dd data-testid="rfq-counts">{r.respondedCount} / {r.vendorCount}</dd></div>{r.canSeeRates && <div><dt>{t('q.estTotal')}</dt><dd>{fmtRs(r.estTotal)}</dd></div>}
        {terms.delivery && <div><dt>{t('q.delivery')}</dt><dd>{terms.delivery}</dd></div>}{terms.payment && <div><dt>{t('q.payment')}</dt><dd>{terms.payment}</dd></div>}{terms.validityDays && <div><dt>{t('q.validity')}</dt><dd>{terms.validityDays}</dd></div>}
        {terms.technicalSpecs && <div><dt>{t('q.techSpecs')}</dt><dd>{terms.technicalSpecs}</dd></div>}{terms.approvedMakes && <div><dt>{t('q.makes')}</dt><dd>{terms.approvedMakes}</dd></div>}</dl>
      {r.needsJustification && ['DRAFT', 'RETURNED'].includes(r.status) && <p className="mdm-banner" role="status" data-testid="rfq-needs-justification">{t('q.needsJustification', { n: r.minVendors, v: fmtRs(r.thresholdValue) })}</p>}
      {r.justification && <p data-testid="rfq-justification"><strong>{t('q.justification')}:</strong> {r.justification}{r.justified && <> <StatusBadge status="APPROVED" label={t('q.justified')} /></>}</p>}
      {error?.form && <p className="field-error" role="alert" data-testid="rfq-error">{error.form}{error.code === 'EXCEPTION_REQUIRED' && <> <Link to="/controls/exceptions">{t('q.raiseException')}</Link></>}</p>}{note && <p className="mdm-banner" role="status" data-testid="rfq-note">{note}</p>}
      {links && <Links t={t} links={links} />}
      <div className="table-scroll"><table className="data-table" data-testid="rfq-lines"><caption>{t('q.lines')}</caption><thead><tr><th>#</th><th>{t('q.item')}</th><th className="num">{t('q.qty')}</th><th>{t('q.requisition')}</th><th>{t('q.requiredBy')}</th>{r.canSeeRates && <th className="num">{t('q.estRate')}</th>}</tr></thead>
        <tbody>{r.lines.map((l) => <tr key={l.id} data-testid="rfq-line"><td>{l.lineNo}</td><td>{l.itemCode ? `${l.itemCode} · ` : ''}{l.itemName}{l.spec ? <div className="muted small">{l.spec}</div> : null}</td><td className="num">{fmtQty(l.qty)} {l.uom}</td><td><Link to={`/proc/requisitions?id=${l.prId}`}>{l.prNo}</Link> #{l.prLineNo}</td><td>{fmtDate(l.requiredBy)}</td>{r.canSeeRates && <td className="num">{fmtRs(l.estRate)}</td>}</tr>)}</tbody></table></div>
      <div className="table-scroll"><table className="data-table" data-testid="rfq-vendors"><caption>{t('q.vendors')}</caption><thead><tr><th>{t('q.vendor')}</th><th>{t('q.channel')}</th><th>{t('q.response')}</th><th>{t('q.sent')}</th><th>{t('q.reminders')}</th><th /></tr></thead>
        <tbody>{r.vendors.map((v) => <tr key={v.id} data-testid="rfq-vendor" data-vendor={v.code}><td>{v.name}</td><td>{t(`q.ch.${v.channel}`)}</td><td><StatusBadge status={RESPONSE_TONE[v.responseStatus]} label={t(`q.r.${v.responseStatus}`)} />{v.declineReason ? <div className="muted small">{v.declineReason}</div> : null}</td>
          <td>{v.sentAt ? fmtDate(v.sentAt.slice(0, 10)) : v.sendStatus ? t(`q.send.${v.sendStatus}`) : '—'}</td><td>{v.reminderCount}{v.regretSentAt ? ` · ${t('q.regretDone')}` : ''}</td>
          <td className="no-print">{can.remind && <button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => reissue(v.vendorId)} data-testid="rfq-reissue">{t('q.reissue')}</button>}{can.quote && <> <Link to={`/proc/quotation-entry?rfq=${r.id}&vendor=${v.vendorId}`}>{t('q.enterQuote')}</Link></>}</td></tr>)}</tbody></table></div>
      {r.quotations.length > 0 && <div className="table-scroll"><table className="data-table" data-testid="rfq-quotations"><caption>{t('q.quotations')}</caption><thead><tr><th>{t('q.quotation')}</th><th>{t('q.vendor')}</th><th>{t('q.version')}</th><th>{t('q.validUntil')}</th><th className="num">{t('q.deliveryDays')}</th>{r.canSeeRates && <th className="num">{t('q.totalLanded')}</th>}<th>{t('q.status')}</th></tr></thead>
        <tbody>{r.quotations.map((x) => <tr key={x.id} data-testid="rfq-quotation"><td><Link to={`/proc/quotation-entry?id=${x.id}`}>{x.docNo}</Link></td><td>{x.vendor}</td><td>{x.versionNo}{x.enteredVia === 'PORTAL' ? ` · ${t('q.byVendor')}` : ''}</td><td>{fmtDate(x.validUntil)}</td><td className="num">{x.deliveryDays}</td>{r.canSeeRates && <td className="num">{fmtRs(x.totalLanded)}</td>}<td><StatusBadge status={QUOTE_TONE[x.status]} label={t(`q.qs.${x.status}`)} /></td></tr>)}</tbody></table></div>}
      {cq.data && cq.data.lines.length > 0 && cq.data.vendors.length > 0 && (
        <div className="table-scroll"><table className="data-table" data-testid="rfq-comparison"><caption>{t('q.comparison')} <span className="muted small">{cq.data.gstRecoverable ? t('q.gstOut') : t('q.gstIn')}</span></caption><thead><tr><th>{t('q.item')}</th>{cq.data.vendors.map((v) => <th key={v.vendorId} className="num">{v.name}</th>)}</tr></thead>
          <tbody>{cq.data.lines.map((l) => <tr key={l.rfqLineId} data-testid="rfq-cmp-line"><td>{l.lineNo}. {l.itemCode ? `${l.itemCode} · ` : ''}{l.itemName}</td>{l.cells.map((c) => <td key={c.vendorId} className="num" data-lowest={c.lowest ? '1' : '0'} style={c.lowest ? { fontWeight: 700 } : undefined}>{c.notQuoted ? '—' : <>{fmtRs(c.landedRate)}{c.lowest && <> <StatusBadge status="APPROVED" label={t('q.lowest')} /></>}</>}</td>)}</tr>)}
            <tr><th>{t('q.totalLanded')}</th>{cq.data.vendors.map((v) => <th key={v.vendorId} className="num">{fmtRs(v.totalLanded)}</th>)}</tr></tbody></table></div>)}
      <div className="mdm-panel" data-testid="rfq-clarifications"><h2>{t('q.clarifications')}</h2>
        {r.clarifications.length === 0 && <p className="muted">{t('q.noClarifications')}</p>}
        <ul>{r.clarifications.map((c) => <li key={c.id} data-testid="rfq-clar"><strong>{c.vendor ?? c.askedBy}:</strong> {c.question}{c.answer ? <div className="muted">{c.answer}{c.shareAll ? ` (${t('q.sharedAll')})` : ''}</div> : can.clarify ? <div className="actions-row"><input value={answers[c.id] ?? ''} placeholder={t('q.answer')} onChange={(e) => setAnswers({ ...answers, [c.id]: e.target.value })} style={{ minHeight: 44, flex: 1 }} data-testid="rfq-answer" />
          <button type="button" className="btn" style={{ minHeight: 44 }} disabled={busy || (answers[c.id] ?? '').trim().length < 2} onClick={() => run(() => pc.rfqAnswer(r.id, c.id, { answer: answers[c.id].trim(), shareAll: true }), t('q.answered'))} data-testid="rfq-answer-send">{t('q.answerAll')}</button></div> : null}</li>)}</ul>
        {can.clarify && <div className="actions-row"><input value={question} placeholder={t('q.logQuestion')} onChange={(e) => setQuestion(e.target.value)} style={{ minHeight: 44, flex: 1 }} data-testid="rfq-question" /><button type="button" className="btn" style={{ minHeight: 44 }} onClick={ask} data-testid="rfq-ask">{t('q.log')}</button></div>}</div>
      <div className="actions-row no-print">
        {can.edit && <Link to={`/proc/rfq-new?edit=${r.id}`}>{t('q.edit')}</Link>}
        {can.submit && <button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => run(() => pc.rfqAct(r.id, 'submit'), t('q.justSent'))} data-testid="rfq-submit">{t('q.sendJustification')}</button>}
        {can.issue && <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={issue} data-testid="rfq-issue">{t('q.issue')}</button>}
        {can.remind && <button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={remind} data-testid="rfq-remind">{t('q.remind')}</button>}
        {can.amend && <button type="button" className="btn" style={{ minHeight: 48 }} onClick={amend} data-testid="rfq-amend">{t('q.amend')}</button>}
        {can.close && <button type="button" className="btn" style={{ minHeight: 48 }} onClick={() => why('close', t('q.closed'))} data-testid="rfq-close">{t('q.close')}</button>}
        {(r.status === 'ISSUED' || r.status === 'CLOSED') && can.remind && <button type="button" className="btn" style={{ minHeight: 48 }} onClick={regret} data-testid="rfq-regret">{t('q.regret')}</button>}
        {can.withdraw && <button type="button" className="btn" onClick={() => why('withdraw', t('q.withdrawn'))} data-testid="rfq-withdraw">{t('q.withdraw')}</button>}
        {can.cancel && <button type="button" className="btn" onClick={() => why('cancel', t('q.cancelled'))} data-testid="rfq-cancel">{t('q.cancel')}</button>}
        {can.delete && <button type="button" className="btn" onClick={async () => { if (window.confirm(t('q.deleteAsk')) && await run(() => pc.rfqDelete(r.id))) navigateTo('/proc/rfqs'); }} data-testid="rfq-delete">{t('q.delete')}</button>}
        {can.print && <button type="button" className="btn" onClick={() => download(`/rfqs/${r.id}/print`, `${r.docNo.replaceAll('/', '-')}.pdf`).catch(() => setError({ form: t('q.fileFailed') }))} data-testid="rfq-print">{t('q.print')}</button>}
        {r.workflowInstanceId && <Link to={`/workflow/instance?id=${r.workflowInstanceId}`}>{t('q.approval')}</Link>}
        {['ISSUED', 'CLOSED'].includes(r.status) && r.respondedCount > 0 && <Link to={`/proc/comparative-statements?new=1&rfq=${r.id}`}>{t('c.make')}</Link>}
      </div>
      {r.taskId && (
        <div className="mdm-panel no-print" data-testid="rfq-decide"><h2>{t('q.decide')}</h2>
          <label>{t('q.comment')}<input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} style={{ minHeight: 44 }} data-testid="rfq-comment" /></label>
          <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('approve')} data-testid="rfq-approve">{t('q.approve')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('return')}>{t('q.return')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('reject')}>{t('q.reject')}</button></div>
        </div>
      )}
      {hq.data && (hq.data.approvals.length > 0 || hq.data.audit.length > 0) && (
        <div className="table-scroll"><table className="data-table" data-testid="rfq-history"><caption>{t('q.history')}</caption><thead><tr><th>{t('q.when')}</th><th>{t('q.who')}</th><th>{t('q.what')}</th><th>{t('q.comment')}</th></tr></thead>
          <tbody>{[...hq.data.audit.map((a) => ({ at: a.at, who: a.actor, what: a.action, note: a.reason })), ...hq.data.approvals.map((a) => ({ at: a.at, who: a.actor, what: `${a.event}${a.step_code ? ` (${a.step_code})` : ''}`, note: a.comment }))].sort((x, y) => String(x.at).localeCompare(String(y.at))).map((h, i) => <tr key={i}><td>{String(h.at).slice(0, 16).replace('T', ' ')}</td><td>{h.who}</td><td>{h.what}</td><td>{h.note ?? ''}</td></tr>)}</tbody></table></div>
      )}
    </div>
  );
}

export default function RfqsPage() {
  const t = useT('proc'); usePageTitle(t('q.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession(); const perms = session.data?.permissions ?? [];
  if (id) return <section aria-labelledby="rfq-h" data-testid="proc-rfqs"><Rfq key={id} t={t} id={id} /></section>;
  return (
    <section aria-labelledby="rfqs-h" data-testid="proc-rfqs">
      <PageHeader id="rfqs-h" title={t('q.title')} subtitle={t('q.intro')} />
      <div className="actions-row no-print">{perms.includes('proc.rfq.create') && <Link to="/proc/rfq-new">{t('q.new')}</Link>} {perms.includes('proc.quotation.create') && <Link to="/proc/quotation-entry">{t('q.entry')}</Link>}</div>
      <ListReport listCode="proc.rfqs" endpoint="/proc/rfqs" title={t('q.title')} session={session.data} rowHref={(r) => `/proc/rfqs?id=${r.id}`} onOpen={(r) => navigateTo(`/proc/rfqs?id=${r.id}`)}
        cardFields={['docNo', 'project', 'title', 'dueDate', 'vendors']} statusKey="status" empty={{ title: t('q.emptyTitle'), text: t('q.emptyBody') }} />
    </section>
  );
}
