import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { fmtDate, fmtQty, fmtRs, pc } from './api.js';
import { useSearch } from '../site/parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Purchase order amendment (part 15.05, FR-07): change quantity, rate, discount, delivery dates or terms; the server works the new version out and keeps the before and after; the comparison is shown; the amendment is sent for approval by the size
// of the change (a rate increase always with the project manager) and applied only when approved. The commitment follows.
const refresh = (qc) => { qc.invalidateQueries({ queryKey: ['proc'] }); qc.invalidateQueries({ queryKey: ['list'] }); };

function Compare({ t, a, po }) {
  const qc = useQueryClient(); const [error, setError] = useState(null); const [busy, setBusy] = useState(false); const [note, setNote] = useState(null); const [comment, setComment] = useState('');
  const run = async (fn, done) => { setError(null); setBusy(true); try { const x = await fn(); if (done) setNote(done); refresh(qc); return x; } catch (e) { setError(errorInfo(e)); return null; } finally { setBusy(false); } };
  const decide = (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('o.sayWhy') }); return; } run(() => pc.decide(a.taskId, action, comment.trim() || null), t(`o.done.${action}`)); };
  return (
    <div data-testid="amend-compare" data-status={a.status}>
      <PageHeader id="am-h" title={<>{a.poNo} · {t('o.amendment')} {a.amendmentNo} <StatusBadge status={a.status === 'APPROVED' ? 'APPROVED' : a.status === 'SUBMITTED' ? 'IN_REVIEW' : 'DRAFT'} label={t(`o.as.${a.status}`)} /></>} meta={<><Link to={`/proc/purchase-orders?id=${a.poId}`}>{a.poNo}</Link> · {a.reason}</>} />
      <dl className="kv"><div><dt>{t('o.delta')}</dt><dd data-testid="amend-delta">{fmtRs(a.deltaAmount)}</dd></div><div><dt>{t('o.newTotal')}</dt><dd>{fmtRs(a.newTotal)}</dd></div><div><dt>{t('o.rateIncrease')}</dt><dd>{a.rateIncrease ? t('o.yes') : t('o.no')}</dd></div></dl>
      {error?.form && <p className="field-error" role="alert" data-testid="amend-error">{error.form}{error.code === 'EXCEPTION_REQUIRED' && <> <Link to="/controls/exceptions">{t('o.raiseException')}</Link></>}</p>}{note && <p className="mdm-banner" role="status" data-testid="amend-note">{note}</p>}
      <div className="table-scroll"><table className="data-table" data-testid="amend-changes"><caption>{t('o.changes')}</caption><thead><tr><th>{t('o.line')}</th><th>{t('o.field')}</th><th>{t('o.before')}</th><th>{t('o.after')}</th></tr></thead><tbody>{a.changes.map((c, i) => <tr key={i} data-testid="amend-change"><td>{c.lineNo ?? t('o.header')}</td><td>{c.field}</td><td>{String(c.before ?? '—')}</td><td><strong>{String(c.after ?? '—')}</strong></td></tr>)}</tbody></table></div>
      {a.before && a.after && <div className="table-scroll"><table className="data-table" data-testid="amend-lines"><caption>{t('o.linesCompared')}</caption><thead><tr><th>#</th><th>{t('o.item')}</th><th className="num">{t('o.qtyBefore')}</th><th className="num">{t('o.qtyAfter')}</th><th className="num">{t('o.rateBefore')}</th><th className="num">{t('o.rateAfter')}</th><th className="num">{t('o.amountBefore')}</th><th className="num">{t('o.amountAfter')}</th></tr></thead>
        <tbody>{a.after.lines.map((l, i) => { const b = a.before.lines[i]; return <tr key={l.id}><td>{l.lineNo}</td><td>{l.description}</td><td className="num">{fmtQty(b.qty)}</td><td className="num">{fmtQty(l.qty)}</td><td className="num">{fmtRs(b.rate)}</td><td className="num">{fmtRs(l.rate)}</td><td className="num">{fmtRs(b.amount)}</td><td className="num">{fmtRs(l.amount)}</td></tr>; })}</tbody></table></div>}
      <div className="actions-row no-print">
        {a.can.submit && <button type="button" className="btn btn-primary" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} onClick={() => run(() => pc.amendAct(a.poId, a.id, 'submit'), t('o.submitted'))} data-testid="amend-submit">{t('o.submitAmend')}</button>}
        {a.can.discard && <button type="button" className="btn" disabled={busy} onClick={() => { const x = window.prompt(t('o.why')); if (x) run(() => pc.amendAct(a.poId, a.id, 'discard', { reason: x }), t('o.discarded')); }} data-testid="amend-discard">{t('o.discard')}</button>}
        {a.can.withdraw && <button type="button" className="btn" disabled={busy} onClick={() => { const x = window.prompt(t('o.why')); if (x) run(() => pc.amendAct(a.poId, a.id, 'withdraw', { reason: x }), t('o.withdrawn')); }}>{t('o.withdraw')}</button>}
      </div>
      {a.taskId && <div className="mdm-panel no-print" data-testid="amend-decide"><h2>{t('o.decide')}</h2><label>{t('o.comment')}<input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} style={{ minHeight: 'var(--erp-target-min)' }} /></label>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} onClick={() => decide('approve')} data-testid="amend-approve">{t('o.approve')}</button><button type="button" className="btn" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} onClick={() => decide('return')}>{t('o.return')}</button><button type="button" className="btn" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} onClick={() => decide('reject')}>{t('o.reject')}</button></div></div>}
      <p className="muted small">{po ? '' : ''}</p>
    </div>
  );
}

function Form({ t, po }) {
  const [reason, setReason] = useState(''); const [ch, setCh] = useState({}); const [terms, setTerms] = useState({}); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  const set = (id, k, v) => setCh({ ...ch, [id]: { ...(ch[id] ?? {}), [k]: v } });
  const go = async (ev) => {
    ev.preventDefault(); setBusy(true); setError(null);
    try {
      const lines = po.lines.map((l) => { const c = ch[l.id] ?? {}; const o = { lineId: l.id }; if (c.qty !== undefined && c.qty !== '' && Number(c.qty) !== l.qty) o.qty = Number(c.qty); if (c.rate !== undefined && c.rate !== '' && Number(c.rate) !== l.rate) o.rate = Number(c.rate); if (c.discountPct !== undefined && c.discountPct !== '' && Number(c.discountPct) !== l.discountPct) o.discountPct = Number(c.discountPct); if (c.dueDate && c.dueDate !== l.schedule[0]?.dueDate) o.schedule = [{ dueDate: c.dueDate, qty: o.qty ?? l.qty }]; return o; }).filter((o) => Object.keys(o).length > 1);
      const d = await pc.poAct(po.id, 'amend', { reason: reason.trim(), lines, ...(Object.keys(terms).length ? { terms } : {}) }); navigateTo(`/proc/po-amend?id=${po.id}&aid=${d.id}`);
    } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); }
  };
  return (
    <form className="mdm-panel" onSubmit={go} noValidate data-testid="amend-form"><h2>{t('o.whatChanges')}</h2><p className="muted">{t('o.amendHelp')}</p>
      {po.lines.map((l) => <div key={l.id} className="mdm-panel" data-testid="amend-line"><strong>{l.lineNo}. {l.description}</strong> <span className="muted small">{fmtQty(l.qty)} {l.uom} · {fmtRs(l.rate)} · {t('o.received')} {fmtQty(l.receivedQty)}</span>
        <div className="form-grid">
          <Field label={t('o.qty')} name="qty" error={error}><input type="number" min="0" step="0.001" placeholder={String(l.qty)} value={ch[l.id]?.qty ?? ''} onChange={(ev) => set(l.id, 'qty', ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="amend-qty" /></Field>
          {po.canSeeRates && <Field label={t('o.rate')} name="rate" error={error}><input type="number" min="0" step="0.01" placeholder={String(l.rate)} value={ch[l.id]?.rate ?? ''} onChange={(ev) => set(l.id, 'rate', ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="amend-rate" /></Field>}
          <Field label={t('o.discount')} name="discountPct" error={error}><input type="number" min="0" max="100" step="0.01" placeholder={String(l.discountPct)} value={ch[l.id]?.discountPct ?? ''} onChange={(ev) => set(l.id, 'discountPct', ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} /></Field>
          <Field label={t('o.dueDate')} name="schedule" error={error}><input type="date" value={ch[l.id]?.dueDate ?? l.schedule[0]?.dueDate ?? ''} onChange={(ev) => set(l.id, 'dueDate', ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="amend-date" /></Field></div></div>)}
      <div className="form-grid"><Field label={t('o.payment')} name="terms.paymentTerms" error={error}><input defaultValue={po.terms.paymentTerms ?? ''} maxLength={500} onChange={(ev) => setTerms({ ...terms, paymentTerms: ev.target.value })} style={{ minHeight: 'var(--erp-target-min)' }} /></Field>
        <Field label={t('o.reason')} name="reason" error={error}><input value={reason} maxLength={1000} onChange={(ev) => setReason(ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="amend-reason" /></Field></div>
      {error?.form && <p className="field-error" role="alert" data-testid="amend-error">{error.form}</p>}
      <div className="actions-row"><button type="submit" className="btn btn-primary" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy || reason.trim().length < 5} data-testid="amend-compare-go">{t('o.compare')}</button></div></form>
  );
}

export default function PoAmendPage() {
  const t = useT('proc'); usePageTitle(t('o.amendTitle')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const aid = Number(sp.get('aid')) || null;
  const pq = useQuery({ queryKey: ['proc', 'po', id], queryFn: () => pc.po(id), enabled: Boolean(id), retry: false });
  const aq = useQuery({ queryKey: ['proc', 'po-amend', id, aid], queryFn: () => pc.amend(id, aid), enabled: Boolean(id && aid), retry: false });
  if (!id) return <section data-testid="proc-po-amend"><PageHeader title={t('o.amendTitle')} subtitle={t('o.pickOrder')} /><Link to="/proc/purchase-orders">{t('o.title')}</Link></section>;
  if (pq.error?.status === 403 || aq.error?.status === 403) return <NoPermission what={t('o.amendTitle')} permission="proc.purchase_order.amend" />;
  if (pq.isPending || (aid && aq.isPending)) return <Skeleton label={t('o.amendTitle')} rows={4} />;
  if (pq.isError) return <ErrorState error={pq.error} onRetry={pq.refetch} />; if (aq.isError) return <ErrorState error={aq.error} onRetry={aq.refetch} />;
  return <section aria-labelledby="am-h" data-testid="proc-po-amend">{aid ? <Compare t={t} a={aq.data} po={pq.data} /> : <><PageHeader id="am-h" title={<>{t('o.amendTitle')}: {pq.data.docNo}</>} meta={<><Link to={`/proc/purchase-orders?id=${id}`}>{t('o.back')}</Link> · {fmtDate(pq.data.date)}</>} />{pq.data.can.amend ? <Form t={t} po={pq.data} /> : <p className="mdm-banner" role="status">{t('o.noAmend')}</p>}</>}</section>;
}
