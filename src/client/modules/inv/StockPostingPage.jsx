import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, usePageTitle } from '../core/pages/ui.jsx';
import { fmtQty, iv, today } from './api.js';
import { useRunner } from './InvParts.jsx';

// Stock posting and opening stock (part 16.01, FR-03, FR-08): a receipt, issue, return, scrap or transfer posted by hand with its reason until the receiving and issuing documents of the later parts post them, and the opening stock loaded from lines (all or nothing, once).
export default function StockPostingPage() {
  const t = useT('inv'); usePageTitle(t('postingTitle')); const sq = useQuery({ queryKey: ['inv', 'stores-pick'], queryFn: iv.stores, retry: false }); const iq = useQuery({ queryKey: ['inv', 'items-pick'], queryFn: () => iv.items(''), retry: false });
  const [f, setF] = useState({ kind: 'RECEIPT', storeId: '', toStoreId: '', itemId: '', qty: '', rate: '', batchNo: '', serialNo: '', date: today(), reason: '' }); const [paste, setPaste] = useState(''); const [out, setOut] = useState(null); const mv = useRunner(); const op = useRunner(); const set = (k, v) => setF({ ...f, [k]: v });
  if (sq.error?.status === 403) return <NoPermission what={t('postingTitle')} permission="inv.stock.post" />;
  if (sq.isPending || iq.isPending) return <Skeleton label={t('postingTitle')} rows={3} />;
  if (sq.isError) return <ErrorState error={sq.error} onRetry={sq.refetch} />;
  const stores = (sq.data?.data ?? []).filter((s) => s.status === 'ACTIVE'); const needsRate = ['RECEIPT', 'RETURN'].includes(f.kind);
  const post = () => mv.run(async () => { const common = { itemId: Number(f.itemId), qty: Number(f.qty), batchNo: f.batchNo || null, serialNo: f.serialNo || null, date: f.date, reason: f.reason }; const r = f.kind === 'TRANSFER' ? await iv.transfer({ ...common, fromStoreId: Number(f.storeId), toStoreId: Number(f.toStoreId) }) : await iv.move({ ...common, storeId: Number(f.storeId), type: f.kind, ...(needsRate ? { rate: Number(f.rate) } : {}) }); setOut(r); return r; }, t('posted'));
  const load = () => { const rows = paste.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [storeCode, itemCode, qty, rate, batchNo, binCode, projectCode] = l.split(',').map((x) => x.trim()); return { storeCode, itemCode, qty: Number(qty), rate: Number(rate), batchNo: batchNo || undefined, binCode: binCode || undefined, projectCode: projectCode || undefined }; }); op.run(() => iv.opening(rows), t('openingLoaded')).then((x) => x && setPaste('')); };
  const entries = out ? (out.entries ?? [...(out.out ?? []), ...(out.in ?? [])]) : [];
  return (
    <section aria-labelledby="po-h" data-testid="inv-po"><h1 id="po-h">{t('postingTitle')}</h1><p className="muted">{t('postingIntro')}</p><p><Link to="/inv/balances">{t('balancesTitle')}</Link> · <Link to="/inv/ledger">{t('ledgerTitle')}</Link></p>
      <div className="mdm-panel" data-testid="po-form"><h2>{t('postMovement')}</h2>{mv.error?.form && <p className="field-error" role="alert" data-testid="po-error">{mv.error.form}</p>}{mv.note && <p className="mdm-banner" role="status" data-testid="po-note">{mv.note}</p>}
        <div className="form-grid">
          <Field label={t('movement')} name="type" error={mv.error}><select value={f.kind} onChange={(ev) => set('kind', ev.target.value)} style={{ minHeight: 44 }} data-testid="po-kind">{['RECEIPT', 'ISSUE', 'RETURN', 'SCRAP', 'TRANSFER'].map((k) => <option key={k} value={k}>{t(`tx.${k === 'TRANSFER' ? 'TRANSFER_OUT' : k}`)}</option>)}</select></Field>
          <Field label={f.kind === 'TRANSFER' ? t('fromStore') : t('store')} name={f.kind === 'TRANSFER' ? 'fromStoreId' : 'storeId'} error={mv.error}><select value={f.storeId} onChange={(ev) => set('storeId', ev.target.value)} style={{ minHeight: 44 }} data-testid="po-store"><option value="">{t('choose')}</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></Field>
          {f.kind === 'TRANSFER' && <Field label={t('toStore')} name="toStoreId" error={mv.error}><select value={f.toStoreId} onChange={(ev) => set('toStoreId', ev.target.value)} style={{ minHeight: 44 }} data-testid="po-to"><option value="">{t('choose')}</option>{stores.filter((s) => String(s.id) !== f.storeId).map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></Field>}
          <Field label={t('item')} name="itemId" error={mv.error}><select value={f.itemId} onChange={(ev) => set('itemId', ev.target.value)} style={{ minHeight: 44 }} data-testid="po-item"><option value="">{t('choose')}</option>{(iq.data ?? []).map((i) => <option key={i.id} value={i.id}>{i.code} · {i.name}</option>)}</select></Field>
          <Field label={t('qty')} name="qty" error={mv.error}><input type="number" min="0" step="0.001" value={f.qty} onChange={(ev) => set('qty', ev.target.value)} style={{ minHeight: 44 }} data-testid="po-qty" /></Field>
          {needsRate && <Field label={t('rateRs')} name="rate" error={mv.error}><input type="number" min="0" step="0.01" value={f.rate} onChange={(ev) => set('rate', ev.target.value)} style={{ minHeight: 44 }} data-testid="po-rate" /></Field>}
          <Field label={t('batch')} name="batchNo" error={mv.error}><input value={f.batchNo} maxLength={40} onChange={(ev) => set('batchNo', ev.target.value)} style={{ minHeight: 44 }} data-testid="po-batch" /></Field>
          <Field label={t('date')} name="date" error={mv.error}><input type="date" max={today()} value={f.date} onChange={(ev) => set('date', ev.target.value)} style={{ minHeight: 44 }} /></Field>
          <Field label={t('reason')} name="reason" error={mv.error}><input value={f.reason} maxLength={1000} onChange={(ev) => set('reason', ev.target.value)} style={{ minHeight: 44 }} data-testid="po-reason" /></Field></div>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={mv.busy || !f.storeId || !f.itemId || !f.qty || f.reason.trim().length < 5 || (needsRate && f.rate === '')} onClick={post} data-testid="po-save">{t('post')}</button></div>
        {entries.length > 0 && <div className="table-scroll"><table className="data-table" data-testid="po-result"><caption>{t('posted')}</caption><thead><tr><th>{t('entry')}</th><th className="num">{t('in')}</th><th className="num">{t('out')}</th><th className="num">{t('balance')}</th></tr></thead><tbody>{entries.map((e) => <tr key={e.id}><td>{e.docNo}</td><td className="num">{e.qtyIn ? fmtQty(e.qtyIn) : ''}</td><td className="num">{e.qtyOut ? fmtQty(e.qtyOut) : ''}</td><td className="num">{fmtQty(e.balanceQty)}</td></tr>)}</tbody></table></div>}</div>
      <div className="mdm-panel" data-testid="po-opening"><h2>{t('openingStock')}</h2><p className="muted">{t('openingHelp')}</p>{op.error?.form && <p className="field-error" role="alert" data-testid="po-op-error">{op.error.form}</p>}{op.note && <p className="mdm-banner" role="status" data-testid="po-op-note">{op.note}</p>}
        <label>{t('openingLines')}<textarea rows={5} value={paste} onChange={(ev) => setPaste(ev.target.value)} placeholder="ST-A, CEM-OPC53, 100, 380, BATCH1" style={{ width: '100%', boxSizing: 'border-box' }} data-testid="po-paste" /></label>
        <div className="actions-row"><button type="button" className="btn" style={{ minHeight: 48 }} disabled={op.busy || !paste.trim()} onClick={load} data-testid="po-load">{t('loadOpening')}</button></div></div>
    </section>
  );
}
