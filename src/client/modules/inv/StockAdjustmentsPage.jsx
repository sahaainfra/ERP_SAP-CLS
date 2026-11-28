import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { ADJ_TONE, fmtQty, fmtRs, iv } from './api.js';
import { History, useRunner } from './InvParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Stock adjustments (part 16.01, FR-05): a count correction or a revaluation (a rate corrected after a GRN price correction) is prepared, approved by the store manager (and the accounts manager for a revaluation or a large value) and only then posted to the ledger.
function Adj({ t, id }) {
  const q = useQuery({ queryKey: ['inv', 'adj', id], queryFn: () => iv.adj(id), retry: false }); const hq = useQuery({ queryKey: ['inv', 'adj-history', id, q.data?.status], queryFn: () => iv.adjHistory(id), enabled: q.isSuccess, retry: false });
  const { error, setError, note, busy, run } = useRunner(); const [comment, setComment] = useState('');
  usePageTitle(t('adjTitle'));
  if (q.error?.status === 403 || q.error?.status === 404) return <NoPermission what={t('adjTitle')} permission="inv.adjustment.view" />;
  if (q.isPending) return <Skeleton label={t('adjTitle')} rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const a = q.data; const can = a.can; const why = (action, msg) => { const x = window.prompt(t('why')); if (x) run(() => iv.adjAct(a.id, action, { reason: x }), msg); };
  const decide = (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('sayWhy') }); return; } run(() => iv.decide(a.taskId, action, comment.trim() || null), t(`done.${action}`)); };
  return (
    <div data-testid="ad-object" data-status={a.status}>
      <PageHeader id="ad-h" title={<>{a.docNo} <StatusBadge status={ADJ_TONE[a.status]} label={t(`as.${a.status}`)} /></>} meta={<><Link to="/inv/adjustments">{t('back')}</Link> · {a.store} · {t(`at.${a.type}`)}</>} />
      <dl className="kv"><div><dt>{t('reason')}</dt><dd>{a.reason}</dd></div>{a.valueDelta != null && <div><dt>{t('valueEffect')}</dt><dd data-testid="ad-delta">{fmtRs(a.valueDelta)}</dd></div>}<div><dt>{t('preparedBy')}</dt><dd>{a.requestedBy}</dd></div>{a.approvedBy && <div><dt>{t('approvedBy')}</dt><dd>{a.approvedBy}</dd></div>}</dl>
      {error?.form && <p className="field-error" role="alert" data-testid="ad-error">{error.form}</p>}{note && <p className="mdm-banner" role="status" data-testid="ad-note">{note}</p>}
      <div className="table-scroll"><table className="data-table" data-testid="ad-lines"><caption>{t('lines')}</caption><thead><tr><th>{t('item')}</th>{a.type === 'REVALUATION' ? <><th className="num">{t('onHand')}</th><th className="num">{t('oldRate')}</th><th className="num">{t('newRate')}</th></> : <th className="num">{t('qtyChange')}</th>}<th className="num">{t('valueEffect')}</th></tr></thead>
        <tbody>{a.lines.map((l, i) => <tr key={i}><td>{l.code} {l.item}</td>{a.type === 'REVALUATION' ? <><td className="num">{fmtQty(l.onHand)}</td><td className="num">{fmtRs(l.oldRate)}</td><td className="num">{fmtRs(l.newRate)}</td></> : <td className="num">{fmtQty(l.qtyDelta)}</td>}<td className="num">{fmtRs(l.delta)}</td></tr>)}</tbody></table></div>
      <div className="actions-row no-print">
        {can.submit && <button type="button" className="btn btn-primary" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} onClick={() => run(() => iv.adjAct(a.id, 'submit'), t('submitted'))} data-testid="ad-submit">{t('submit')}</button>}
        {can.withdraw && <button type="button" className="btn" onClick={() => why('withdraw', t('withdrawn'))}>{t('withdraw')}</button>}
        {can.cancel && <button type="button" className="btn" onClick={() => why('cancel', t('cancelled'))} data-testid="ad-cancel">{t('cancel')}</button>}
        {a.workflowInstanceId && <Link to={`/workflow/instance?id=${a.workflowInstanceId}`}>{t('approval')}</Link>}
      </div>
      {a.taskId && <div className="mdm-panel no-print" data-testid="ad-decide"><h2>{t('decide')}</h2><label>{t('comment')}<input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="ad-comment" /></label>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} onClick={() => decide('approve')} data-testid="ad-approve">{t('approvePost')}</button><button type="button" className="btn" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} onClick={() => decide('return')}>{t('return')}</button><button type="button" className="btn" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} onClick={() => decide('reject')}>{t('reject')}</button></div></div>}
      <History t={t} data={hq.data} testId="ad-history" />
    </div>
  );
}

function AdjForm({ t }) {
  const sq = useQuery({ queryKey: ['inv', 'stores-pick'], queryFn: iv.stores, retry: false }); const iq = useQuery({ queryKey: ['inv', 'items-pick'], queryFn: () => iv.items(''), retry: false });
  const [f, setF] = useState({ storeId: '', type: 'QUANTITY', reason: '', itemId: '', qtyDelta: '', rate: '', newRate: '' }); const [error, setError] = useState(null); const [busy, setBusy] = useState(false); const set = (k, v) => setF({ ...f, [k]: v });
  usePageTitle(t('newAdj'));
  if (sq.error?.status === 403) return <NoPermission what={t('newAdj')} permission="inv.adjustment.create" />;
  if (sq.isPending || iq.isPending) return <Skeleton label={t('newAdj')} rows={3} />;
  const line = () => (f.type === 'REVALUATION' ? { itemId: Number(f.itemId), newRate: Number(f.newRate) } : { itemId: Number(f.itemId), qtyDelta: Number(f.qtyDelta), ...(f.rate ? { rate: Number(f.rate) } : {}) });
  const save = async (send) => { setError(null); setBusy(true); try { let d = await iv.adjCreate({ storeId: Number(f.storeId), type: f.type, reason: f.reason, lines: [line()] }); if (send) d = await iv.adjAct(d.id, 'submit'); navigateTo(`/inv/adjustments?id=${d.id}`); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); } };
  return (
    <section aria-labelledby="adn-h" data-testid="inv-ad-form"><PageHeader id="adn-h" title={t('newAdj')} subtitle={t('newAdjHelp')} meta={<Link to="/inv/adjustments">{t('back')}</Link>} />
      <form className="mdm-panel" onSubmit={(ev) => { ev.preventDefault(); save(false); }} noValidate><div className="form-grid">
        <Field label={t('store')} name="storeId" error={error}><select value={f.storeId} onChange={(ev) => set('storeId', ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="adn-store"><option value="">{t('choose')}</option>{(sq.data ?? []).filter((s) => s.status === 'ACTIVE').map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></Field>
        <Field label={t('type')} name="type" error={error}><select value={f.type} onChange={(ev) => set('type', ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="adn-type"><option value="QUANTITY">{t('at.QUANTITY')}</option><option value="REVALUATION">{t('at.REVALUATION')}</option></select></Field>
        <Field label={t('item')} name="itemId" error={error}><select value={f.itemId} onChange={(ev) => set('itemId', ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="adn-item"><option value="">{t('choose')}</option>{(iq.data ?? []).map((i) => <option key={i.id} value={i.id}>{i.code} · {i.name}</option>)}</select></Field>
        {f.type === 'QUANTITY' ? <><Field label={t('qtyChangeHelp')} name="qtyDelta" error={error}><input type="number" step="0.001" value={f.qtyDelta} onChange={(ev) => set('qtyDelta', ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="adn-qty" /></Field><Field label={t('rateIfGain')} name="rate" error={error}><input type="number" min="0" step="0.01" value={f.rate} onChange={(ev) => set('rate', ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} /></Field></>
          : <Field label={t('newRateHelp')} name="newRate" error={error}><input type="number" min="0" step="0.01" value={f.newRate} onChange={(ev) => set('newRate', ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="adn-rate" /></Field>}
        <Field label={t('reason')} name="reason" error={error}><input value={f.reason} maxLength={1000} onChange={(ev) => set('reason', ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="adn-reason" /></Field></div>
        {error?.form && <p className="field-error" role="alert" data-testid="adn-error">{error.form}</p>}
        <div className="actions-row"><button type="submit" className="btn" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy || !f.storeId || !f.itemId} data-testid="adn-save">{t('saveDraft')}</button><button type="button" className="btn btn-primary" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy || !f.storeId || !f.itemId} onClick={() => save(true)} data-testid="adn-send">{t('sendForApproval')}</button></div></form></section>
  );
}

export default function StockAdjustmentsPage() {
  const t = useT('inv'); usePageTitle(t('adjTitle')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession(); const perms = session.data?.permissions ?? [];
  if (sp.get('new') === '1') return <AdjForm t={t} />;
  if (id) return <section aria-labelledby="ad-h" data-testid="inv-ad"><Adj key={id} t={t} id={id} /></section>;
  return (
    <section aria-labelledby="ads-h" data-testid="inv-ad"><PageHeader id="ads-h" title={t('adjTitle')} subtitle={t('adjIntro')} />
      <div className="actions-row no-print">{perms.includes('inv.adjustment.create') && <Link to="/inv/adjustments?new=1">{t('newAdj')}</Link>} <Link to="/inv/dashboard">{t('dashTitle')}</Link></div>
      <ListReport listCode="inv.adjustments" endpoint="/inv/adjustments" exportEndpoint="/ui/lists/inv.adjustments/export" title={t('adjTitle')} session={session.data} rowHref={(r) => `/inv/adjustments?id=${r.id}`} onOpen={(r) => navigateTo(`/inv/adjustments?id=${r.id}`)} cardFields={['docNo', 'store', 'date', 'type']} statusKey="status" empty={{ title: t('adjEmptyTitle'), text: t('adjEmptyBody') }} /></section>
  );
}
