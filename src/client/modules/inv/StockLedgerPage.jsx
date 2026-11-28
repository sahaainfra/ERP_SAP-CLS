import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from '../site/parts.jsx';
import { fmtDate, fmtQty, fmtRs, iv, saveCsv } from './api.js';
import { useRunner } from './InvParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Stock ledger / item card (part 16.01, FR-03): every movement of an item with the running balance; an entry is never changed, a wrong one is corrected by a reversing entry.
export default function StockLedgerPage() {
  const t = useT('inv'); usePageTitle(t('ledgerTitle')); const sp = useSearch(); const [f, setF] = useState({ itemId: sp.get('itemId') ?? '', storeId: '', from: '', to: '' }); const { error, note, busy, run } = useRunner();
  const iq = useQuery({ queryKey: ['inv', 'items-pick'], queryFn: () => iv.items(''), retry: false }); const sq = useQuery({ queryKey: ['inv', 'stores-pick'], queryFn: iv.stores, retry: false });
  const q = useQuery({ queryKey: ['inv', 'card', f], queryFn: () => iv.card(f), enabled: Boolean(f.itemId), retry: false });
  if (iq.error?.status === 403) return <NoPermission what={t('ledgerTitle')} permission="inv.stock.view" />;
  const d = q.data; const set = (k, v) => setF({ ...f, [k]: v });
  return (
    <section aria-labelledby="lg-h" data-testid="inv-lg"><PageHeader id="lg-h" title={t('ledgerTitle')} subtitle={t('ledgerIntro')} />
      <div className="mdm-panel no-print" data-testid="lg-params"><div className="form-grid">
        <label>{t('item')}<select value={f.itemId} onChange={(ev) => set('itemId', ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="lg-item"><option value="">{t('choose')}</option>{(iq.data ?? []).map((i) => <option key={i.id} value={i.id}>{i.code} · {i.name}</option>)}</select></label>
        <label>{t('store')}<select value={f.storeId} onChange={(ev) => set('storeId', ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="lg-store"><option value="">{t('allStores')}</option>{(sq.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</select></label>
        <label>{t('from')}<input type="date" value={f.from} onChange={(ev) => set('from', ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="lg-from" /></label>
        <label>{t('to')}<input type="date" value={f.to} onChange={(ev) => set('to', ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="lg-to" /></label></div></div>
      {!f.itemId ? <p className="muted" data-testid="lg-pick">{t('pickItem')}</p> : q.isPending ? <Skeleton label={t('ledgerTitle')} rows={4} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} />
        : <>
          {error?.form && <p className="field-error" role="alert" data-testid="lg-error">{error.form}</p>}{note && <p className="mdm-banner" role="status" data-testid="lg-note">{note}</p>}
          <h2>{d.item.code} {d.item.name} <span className="muted">({d.item.uom})</span></h2>
          {d.rows.length === 0 ? <div data-testid="lg-empty"><p className="muted">{t('ledgerEmpty')}</p><Link to="/inv/posting">{t('postingTitle')}</Link></div>
            : <div className="table-scroll"><table className="data-table" data-testid="lg-table"><caption>{t('ledgerTitle')}</caption><thead><tr><th>{t('entry')}</th><th>{t('date')}</th><th>{t('store')}</th><th>{t('bin')}</th><th>{t('batch')}</th><th>{t('type')}</th><th className="num">{t('in')}</th><th className="num">{t('out')}</th><th className="num">{t('rate')}</th><th className="num">{t('value')}</th><th className="num">{t('balance')}</th><th className="num">{t('balanceValue')}</th><th /></tr></thead>
              <tbody>{f.storeId && f.from && <tr><td colSpan={10}>{t('opening')}</td><td className="num">{fmtQty(d.opening.qty)}</td><td className="num">{fmtRs(d.opening.value)}</td><td /></tr>}
                {d.rows.map((l) => <tr key={l.id} data-testid="lg-row" data-type={l.type}><td>{l.docNo}</td><td>{fmtDate(l.date)}</td><td>{l.store}</td><td>{l.bin}</td><td>{l.batch}{l.serial}</td><td>{t(`tx.${l.type}`)}{l.reversed && <span className="muted"> · {t('reversed')}</span>}</td><td className="num">{l.qtyIn ? fmtQty(l.qtyIn) : ''}</td><td className="num">{l.qtyOut ? fmtQty(l.qtyOut) : ''}</td><td className="num">{fmtRs(l.rate)}</td><td className="num">{fmtRs(l.value)}</td><td className="num" data-testid="lg-balance">{fmtQty(l.balanceQty)}</td><td className="num">{fmtRs(l.balanceValue)}</td>
                  <td>{d.canReverse && l.type !== 'REVERSAL' && !l.reversed && <button type="button" className="btn" style={{ minHeight: 'var(--erp-target-min)' }} disabled={busy} onClick={() => { const why = window.prompt(t('why')); if (why) run(() => iv.reverse(l.id, why), t('reversedDone')); }} data-testid="lg-reverse">{t('reverse')}</button>}</td></tr>)}</tbody></table></div>}
          {d.truncated && <p className="muted">{t('truncated')}</p>}
          <div className="actions-row no-print"><button type="button" className="btn" onClick={() => saveCsv(`stock-ledger-${d.item.code}.csv`, [[t('entry'), t('date'), t('store'), t('type'), t('in'), t('out'), t('rate'), t('value'), t('balance')], ...d.rows.map((l) => [l.docNo, l.date, l.store, l.type, l.qtyIn, l.qtyOut, l.rate == null ? '' : l.rate / 100, l.value == null ? '' : l.value / 100, l.balanceQty])])} data-testid="lg-export">{t('exportCsv')}</button></div></>}
    </section>
  );
}
