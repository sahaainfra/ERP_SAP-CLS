import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { CS_TONE, download, fmtDate, fmtQty, fmtRs, pc } from './api.js';
import { useSearch } from '../site/parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Comparative statements (part 15.04): the statement generated from the quotations of an RFQ: every line against every vendor with the landed rate, the rank, the technical compliance and the benchmarks; the recommendation (overall L1,
// the L1 of each line with a split award, or a choice by hand); a vendor who is not the L1 needs a reason and goes one level higher; negotiation rounds; approval by value. An approved statement is what the order is made from.
const refresh = (qc) => { qc.invalidateQueries({ queryKey: ['proc'] }); qc.invalidateQueries({ queryKey: ['list'] }); };

function Cs({ t, id }) {
  const qc = useQueryClient(); const q = useQuery({ queryKey: ['proc', 'cs', id], queryFn: () => pc.cs(id), retry: false });
  const hq = useQuery({ queryKey: ['proc', 'cs-history', id, q.data?.status], queryFn: () => pc.csHistory(id), enabled: q.isSuccess, retry: false });
  const [error, setError] = useState(null); const [note, setNote] = useState(null); const [busy, setBusy] = useState(false); const [comment, setComment] = useState(''); const [picks, setPicks] = useState(null); const [just, setJust] = useState(null); const [neg, setNeg] = useState({ vendorId: '', note: '' });
  usePageTitle(t('c.title'));
  if (q.error?.status === 403) return <NoPermission what={t('c.title')} permission="proc.comparative_statement.view" />;
  if (q.isPending) return <Skeleton label={t('c.title')} rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const r = q.data; const can = r.can;
  const run = async (fn, done) => { setError(null); setNote(null); setBusy(true); try { const x = await fn(); if (done) setNote(done); refresh(qc); return x; } catch (e) { setError(errorInfo(e)); return null; } finally { setBusy(false); } };
  const why = (action, msg) => { const x = window.prompt(t('c.why')); if (x) run(() => pc.csAct(r.id, action, { reason: x }), msg).then((d) => { if (d && action === 'amend') navigateTo(`/proc/comparative-statements?id=${d.id}`); }); };
  const decide = (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('c.sayWhy') }); return; } run(() => pc.decide(r.taskId, action, comment.trim() || null), t(`c.done.${action}`)); };
  const form = just ?? { reasonCode: r.reasonCode ?? '', justification: r.justification ?? '' };
  const sel = picks ?? Object.fromEntries(r.lines.flatMap((l) => l.cells.filter((c) => c.quoted).map((c) => [`${l.rfqLineId}:${c.vendorId}`, String(c.selectedQty)])));
  const saveSelection = () => run(() => pc.csUpdate(r.id, { recommendationType: 'CUSTOM', selections: Object.entries(sel).filter(([, v]) => Number(v) > 0).map(([k, v]) => { const [l, vd] = k.split(':'); return { rfqLineId: Number(l), vendorId: Number(vd), qty: Number(v) }; }), rowVersion: r.rowVersion }), t('c.saved')).then(() => setPicks(null));
  const saveJust = () => run(() => pc.csUpdate(r.id, { reasonCode: form.reasonCode || null, justification: form.justification.trim() || null }), t('c.saved')).then(() => setJust(null));
  return (
    <div data-testid="cs-object" data-status={r.status}>
      <PageHeader id="cs-h" title={<>{r.docNo} <StatusBadge status={CS_TONE[r.status]} label={t(`c.s.${r.status}`)} />{r.nonL1 && <> <StatusBadge status="AT_RISK" label={t('c.nonL1')} /></>}</>} meta={<><Link to="/proc/comparative-statements">{t('c.back')}</Link> · <Link to={`/proc/rfqs?id=${r.rfqId}`}>{r.rfqNo}</Link> {r.rfqTitle}</>} />
      <dl className="kv" data-testid="cs-figures"><div><dt>{t('c.project')}</dt><dd>{r.projectCode}</dd></div><div><dt>{t('c.recommendation')}</dt><dd data-testid="cs-type">{t(`c.type.${r.recommendationType}`)}</dd></div><div><dt>{t('c.value')}</dt><dd data-testid="cs-value">{fmtRs(r.totalValue)}</dd></div>
        <div><dt>{t('c.vsEstimate')}</dt><dd data-testid="cs-savings">{fmtRs(r.savingsVsBudget)}</dd></div><div><dt>{t('c.rounds')}</dt><dd>{r.roundNo}</dd></div><div><dt>{t('c.level')}</dt><dd data-testid="cs-level">{t(`c.lvl.${r.approvalLevel}`)}</dd></div></dl>
      {r.warnings.map((w, i) => <p key={i} className="mdm-banner" role="status" data-testid="cs-warning">{w.message}</p>)}
      {error?.form && <p className="field-error" role="alert" data-testid="cs-error">{error.form}</p>}{note && <p className="mdm-banner" role="status" data-testid="cs-note">{note}</p>}
      {can.edit && <div className="actions-row no-print" data-testid="cs-recommend"><span>{t('c.recommend')}:</span>{['OVERALL_L1', 'SPLIT_L1'].map((x) => <button key={x} type="button" className={`btn${r.recommendationType === x ? ' btn-primary' : ''}`} style={{ minHeight: 44 }} disabled={busy} onClick={() => run(() => pc.csUpdate(r.id, { recommendationType: x }), t('c.saved')).then(() => setPicks(null))} data-testid={`cs-rec-${x}`}>{t(`c.type.${x}`)}</button>)}
        <button type="button" className="btn" style={{ minHeight: 44 }} disabled={busy} onClick={() => run(() => pc.csUpdate(r.id, { refresh: true, recommendationType: r.recommendationType }), t('c.refreshed')).then(() => setPicks(null))} data-testid="cs-refresh">{t('c.refresh')}</button></div>}
      <div className="table-scroll"><table className="data-table" data-testid="cs-matrix"><caption>{t('c.matrix')}</caption>
        <thead><tr><th>{t('c.item')}</th><th className="num">{t('c.qty')}</th>{r.vendors.map((v) => <th key={v.vendorId} className="num" data-testid="cs-vendor-head">{v.name}<div className="muted small">{v.quotationNo} v{v.versionNo}</div></th>)}<th className="num">{t('c.lastPo')}</th><th className="num">{t('c.estimate')}</th><th className="num">{t('c.rc')}</th><th className="num">{t('c.selected')}</th></tr></thead>
        <tbody>{r.lines.map((l) => (
          <tr key={l.rfqLineId} data-testid="cs-line"><td>{l.lineNo}. {l.itemCode ? `${l.itemCode} · ` : ''}{l.itemName}</td><td className="num">{fmtQty(l.qty)} {l.uom}</td>
            {l.cells.map((c) => <td key={c.vendorId} className="num" data-testid="cs-cell" data-l1={c.isL1 ? '1' : '0'} data-selected={c.selectedQty > 0 ? '1' : '0'} style={c.selectedQty > 0 ? { background: 'var(--erp-color-status-info-bg)' } : undefined}>
              {!c.quoted ? '—' : <><strong data-testid="cs-landed">{fmtRs(c.landedRate)}</strong> <StatusBadge status={c.isL1 ? 'APPROVED' : 'DRAFT'} label={`L${c.rank}`} />
                <div className="muted small">{fmtQty(c.offeredQty)} {l.uom} · {c.deliveryDays} {t('c.days')}{c.make ? ` · ${c.make}` : ''}</div>
                {c.compliance !== 'YES' && <div className="small"><StatusBadge status={c.compliance === 'NO' ? 'REJECTED' : 'RETURNED'} label={t(`c.comp.${c.compliance}`)} />{c.deviation ? ` ${c.deviation}` : ''}</div>}
                {can.edit ? <div className="actions-row"><input type="number" min="0" step="0.001" value={sel[`${l.rfqLineId}:${c.vendorId}`] ?? '0'} onChange={(ev) => setPicks({ ...sel, [`${l.rfqLineId}:${c.vendorId}`]: ev.target.value })} style={{ minHeight: 40, width: 90 }} aria-label={`${l.itemName} ${t('c.selected')}`} data-testid="cs-pick" />
                  <select value={c.compliance} onChange={(ev) => run(() => pc.csUpdate(r.id, { compliance: [{ rfqLineId: l.rfqLineId, vendorId: c.vendorId, value: ev.target.value }], recommendationType: r.recommendationType }), t('c.saved'))} style={{ minHeight: 40 }} aria-label={t('c.compliance')} data-testid="cs-compliance">{['YES', 'DEVIATION', 'NO'].map((x) => <option key={x} value={x}>{t(`c.comp.${x}`)}</option>)}</select></div>
                  : c.selectedQty > 0 ? <div><strong>{fmtQty(c.selectedQty)}</strong> {t('c.awarded')}</div> : null}
                {c.vsLastPo != null && <div className="muted small">{c.vsLastPo > 0 ? '+' : ''}{c.vsLastPo}% {t('c.vsLastPo')}</div>}</>}</td>)}
            <td className="num">{fmtRs(l.benchmarks.lastPo)}{l.benchmarks.lastProject != null && <div className="muted small">{t('c.project')}: {fmtRs(l.benchmarks.lastProject)}</div>}</td><td className="num">{fmtRs(l.benchmarks.budget)}</td><td className="num">{fmtRs(l.benchmarks.rateContract)}</td><td className="num" data-testid="cs-line-selected">{fmtQty(l.selectedQty)}</td></tr>))}
          <tr><th colSpan={2}>{t('c.vendorTotal')}</th>{r.vendors.map((v) => <th key={v.vendorId} className="num" data-testid="cs-vendor-total">{v.totalLanded == null ? t('c.partial') : fmtRs(v.totalLanded)}{v.overallRank ? <> <StatusBadge status={v.overallRank === 1 ? 'APPROVED' : 'DRAFT'} label={`L${v.overallRank}`} /></> : null}<div className="muted small">{v.paymentTerms ?? ''} · {t('c.validUntil')} {fmtDate(v.validUntil)}</div></th>)}<th colSpan={4} /></tr></tbody></table></div>
      {can.edit && <div className="actions-row no-print"><button type="button" className="btn" style={{ minHeight: 44 }} disabled={busy || picks == null} onClick={saveSelection} data-testid="cs-save-selection">{t('c.saveSelection')}</button></div>}
      {(r.nonL1 || can.edit) && (
        <div className="mdm-panel" data-testid="cs-justification"><h2>{t('c.justification')}</h2><p className="muted">{r.nonL1 ? t('c.nonL1Help') : t('c.nonL1Optional')}</p>
          {can.edit ? <div className="form-grid"><Field label={t('c.reason')} name="reasonCode" error={error}><select value={form.reasonCode} onChange={(ev) => setJust({ ...form, reasonCode: ev.target.value })} style={{ minHeight: 44 }} data-testid="cs-reason"><option value="">{t('c.none')}</option>{['TECHNICAL', 'DELIVERY', 'QUALITY', 'OTHER'].map((x) => <option key={x} value={x}>{t(`c.reasons.${x}`)}</option>)}</select></Field>
            <Field label={t('c.justification')} name="justification" error={error}><textarea rows={3} maxLength={2000} value={form.justification} onChange={(ev) => setJust({ ...form, justification: ev.target.value })} style={{ width: '100%' }} data-testid="cs-justification-text" /></Field><button type="button" className="btn" style={{ minHeight: 44 }} onClick={saveJust} disabled={busy || just == null} data-testid="cs-save-justification">{t('c.saveJustification')}</button></div>
            : <p data-testid="cs-justification-read">{r.reasonCode ? `${t(`c.reasons.${r.reasonCode}`)}: ` : ''}{r.justification}</p>}</div>)}
      <div className="mdm-panel" data-testid="cs-negotiations"><h2>{t('c.negotiation')}</h2>{r.negotiations.length === 0 && <p className="muted">{t('c.noRounds')}</p>}
        <ul>{r.negotiations.map((n) => <li key={n.id} data-testid="cs-round">{t('c.round', { n: n.roundNo })} · <strong>{n.vendor}</strong>: {n.note} <span className="muted small">{n.quotationBefore ? `${n.quotationBefore.doc_no} v${n.quotationBefore.version_no}` : ''}{n.quotationAfter ? ` → ${n.quotationAfter.doc_no} v${n.quotationAfter.version_no}` : ` (${t('c.awaiting')})`}</span></li>)}</ul>
        {can.negotiate && <div className="actions-row"><select value={neg.vendorId} onChange={(ev) => setNeg({ ...neg, vendorId: ev.target.value })} style={{ minHeight: 44 }} aria-label={t('c.vendor')} data-testid="cs-neg-vendor"><option value="">{t('c.vendor')}</option>{r.vendors.map((v) => <option key={v.vendorId} value={v.vendorId}>{v.name}</option>)}</select>
          <input value={neg.note} placeholder={t('c.negNote')} maxLength={1000} onChange={(ev) => setNeg({ ...neg, note: ev.target.value })} style={{ minHeight: 44, flex: 1 }} data-testid="cs-neg-note" /><button type="button" className="btn" style={{ minHeight: 44 }} disabled={busy || !neg.vendorId || neg.note.trim().length < 5} onClick={() => run(() => pc.csAct(r.id, 'negotiations', { vendorId: Number(neg.vendorId), note: neg.note.trim() }), t('c.roundLogged')).then(() => setNeg({ vendorId: '', note: '' }))} data-testid="cs-neg-log">{t('c.logRound')}</button></div>}</div>
      <div className="actions-row no-print">
        {can.submit && <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => run(() => pc.csAct(r.id, 'submit'), t('c.sent'))} data-testid="cs-submit">{t('c.send')}</button>}
        {can.withdraw && <button type="button" className="btn" onClick={() => why('withdraw', t('c.withdrawn'))} data-testid="cs-withdraw">{t('c.withdraw')}</button>}
        {can.amend && <button type="button" className="btn" onClick={() => why('amend')} data-testid="cs-amend">{t('c.amend')}</button>}
        {can.cancel && <button type="button" className="btn" onClick={() => why('cancel', t('c.cancelled'))} data-testid="cs-cancel">{t('c.cancel')}</button>}
        {can.delete && <button type="button" className="btn" onClick={async () => { if (window.confirm(t('c.deleteAsk')) && await run(() => pc.csDelete(r.id))) navigateTo('/proc/comparative-statements'); }} data-testid="cs-delete">{t('c.delete')}</button>}
        {can.print && <button type="button" className="btn" onClick={() => download(`/comparative-statements/${r.id}/print`, `${r.docNo.replaceAll('/', '-')}.pdf`).catch(() => setError({ form: t('c.fileFailed') }))} data-testid="cs-print">{t('c.print')}</button>}
        {r.workflowInstanceId && <Link to={`/workflow/instance?id=${r.workflowInstanceId}`}>{t('c.approval')}</Link>}
      </div>
      {r.taskId && (
        <div className="mdm-panel no-print" data-testid="cs-decide"><h2>{t('c.decide')}</h2>
          <label>{t('c.comment')}<input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} style={{ minHeight: 44 }} data-testid="cs-comment" /></label>
          <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('approve')} data-testid="cs-approve">{t('c.approve')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('return')}>{t('c.return')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('reject')}>{t('c.reject')}</button></div></div>)}
      {hq.data && (hq.data.approvals.length > 0 || hq.data.audit.length > 0) && (
        <div className="table-scroll"><table className="data-table" data-testid="cs-history"><caption>{t('c.history')}</caption><thead><tr><th>{t('c.when')}</th><th>{t('c.who')}</th><th>{t('c.what')}</th><th>{t('c.comment')}</th></tr></thead>
          <tbody>{[...hq.data.audit.map((a) => ({ at: a.at, who: a.actor, what: a.action, note: a.reason })), ...hq.data.approvals.map((a) => ({ at: a.at, who: a.actor, what: `${a.event}${a.step_code ? ` (${a.step_code})` : ''}`, note: a.comment }))].sort((x, y) => String(x.at).localeCompare(String(y.at))).map((h, i) => <tr key={i}><td>{String(h.at).slice(0, 16).replace('T', ' ')}</td><td>{h.who}</td><td>{h.what}</td><td>{h.note ?? ''}</td></tr>)}</tbody></table></div>)}
    </div>
  );
}

function NewCs({ t, rfqId }) {
  const q = useQuery({ queryKey: ['proc', 'cs-rfqs'], queryFn: pc.csRfqs, retry: false }); const [f, setF] = useState({ rfqId: rfqId ? String(rfqId) : '', type: 'OVERALL_L1' }); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  usePageTitle(t('c.make'));
  if (q.error?.status === 403) return <NoPermission what={t('c.make')} permission="proc.comparative_statement.create" />;
  if (q.isPending) return <Skeleton label={t('c.make')} rows={3} />;
  const go = async (ev) => { ev.preventDefault(); setBusy(true); setError(null); try { const d = await pc.csCreate({ rfqId: Number(f.rfqId), recommendationType: f.type }); navigateTo(`/proc/comparative-statements?id=${d.id}`); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); } };
  return (
    <section aria-labelledby="csn-h" data-testid="proc-cs-new"><PageHeader id="csn-h" title={t('c.make')} subtitle={t('c.makeHelp')} meta={<Link to="/proc/comparative-statements">{t('c.back')}</Link>} />
      <form className="mdm-panel" onSubmit={go} noValidate><div className="form-grid">
        <Field label={t('c.rfq')} name="rfqId" error={error}><select value={f.rfqId} onChange={(ev) => setF({ ...f, rfqId: ev.target.value })} style={{ minHeight: 44 }} data-testid="csn-rfq"><option value="">{t('c.choose')}</option>{q.data.map((x) => <option key={x.id} value={x.id}>{x.docNo} · {x.title} ({x.quotations})</option>)}</select></Field>
        <Field label={t('c.recommendation')} name="recommendationType" error={error}><select value={f.type} onChange={(ev) => setF({ ...f, type: ev.target.value })} style={{ minHeight: 44 }} data-testid="csn-type"><option value="OVERALL_L1">{t('c.type.OVERALL_L1')}</option><option value="SPLIT_L1">{t('c.type.SPLIT_L1')}</option></select></Field></div>
        {q.data.length === 0 && <p className="muted" data-testid="csn-none">{t('c.noRfqs')}</p>}
        {error?.form && <p className="field-error" role="alert" data-testid="csn-error">{error.form}</p>}<div className="actions-row"><button type="submit" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy || !f.rfqId} data-testid="csn-go">{t('c.generate')}</button></div></form></section>
  );
}

export default function ComparativeStatementsPage() {
  const t = useT('proc'); usePageTitle(t('c.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession(); const perms = session.data?.permissions ?? [];
  if (sp.get('new') === '1') return <NewCs t={t} rfqId={Number(sp.get('rfq')) || null} />;
  if (id) return <section aria-labelledby="cs-h" data-testid="proc-cs"><Cs key={id} t={t} id={id} /></section>;
  return (
    <section aria-labelledby="css-h" data-testid="proc-cs">
      <PageHeader id="css-h" title={t('c.title')} subtitle={t('c.intro')} />
      <div className="actions-row no-print">{perms.includes('proc.comparative_statement.create') && <Link to="/proc/comparative-statements?new=1">{t('c.make')}</Link>} <Link to="/proc/rfqs">{t('q.title')}</Link></div>
      <ListReport listCode="proc.comparative_statements" endpoint="/proc/comparative-statements" title={t('c.title')} session={session.data} rowHref={(r) => `/proc/comparative-statements?id=${r.id}`} onOpen={(r) => navigateTo(`/proc/comparative-statements?id=${r.id}`)}
        cardFields={['docNo', 'rfq', 'project', 'value', 'nonL1']} statusKey="status" empty={{ title: t('c.emptyTitle'), text: t('c.emptyBody') }} />
    </section>
  );
}
