import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { fmtDate, fmtQty, iv } from './api.js';
import { useRunner } from './InvParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Stock balances (part 16.01, FR-04, FR-06): by item, store, bin, batch and owner, with available, reserved, under inspection and in transit; reservations against work authorisations, material requests and transfers.
export default function StockBalancesPage() {
  const t = useT('inv'); usePageTitle(t('balancesTitle')); const session = useSession(); const perms = session.data?.permissions ?? []; const { error, note, busy, run } = useRunner(); const [r, setR] = useState({ storeId: '', itemId: '', qty: '', sourceType: 'WORK_AUTHORISATION', sourceId: '' });
  const rq = useQuery({ queryKey: ['inv', 'reservations'], queryFn: () => iv.reservations({ status: 'ACTIVE' }), retry: false }); const sq = useQuery({ queryKey: ['inv', 'stores-pick'], queryFn: iv.stores, retry: false }); const iq = useQuery({ queryKey: ['inv', 'items-pick'], queryFn: () => iv.items(''), retry: false });
  if (rq.error?.status === 403) return <NoPermission what={t('balancesTitle')} permission="inv.reservation.view" />;
  const canReserve = perms.includes('inv.reservation.reserve');
  return (
    <section aria-labelledby="sb-h" data-testid="inv-sb"><PageHeader id="sb-h" title={t('balancesTitle')} subtitle={t('balancesIntro')} />
      <div className="actions-row no-print"><Link to="/inv/ledger">{t('ledgerTitle')}</Link> <Link to="/inv/dashboard">{t('dashTitle')}</Link> {perms.includes('inv.stock.post') && <Link to="/inv/posting">{t('postingTitle')}</Link>}</div>
      <ListReport listCode="inv.balances" endpoint="/inv/balances" exportEndpoint="/ui/lists/inv.balances/export" title={t('balancesTitle')} session={session.data} rowHref={(x) => `/inv/ledger?itemId=${x.itemId ?? ''}`} onOpen={(x) => navigateTo(`/inv/ledger?itemId=${x.itemId ?? ''}`)} cardFields={['itemCode', 'item', 'store', 'onHand', 'available']} empty={{ title: t('balancesEmptyTitle'), text: t('balancesEmptyBody') }} />
      <h2>{t('reservations')}</h2>
      {rq.isPending ? <Skeleton label={t('reservations')} rows={2} /> : rq.isError ? <ErrorState error={rq.error} onRetry={rq.refetch} /> : (
        <div className="table-scroll"><table className="data-table" data-testid="sb-reservations"><caption>{t('reservations')}</caption><thead><tr><th>{t('reservation')}</th><th>{t('item')}</th><th>{t('store')}</th><th className="num">{t('qty')}</th><th>{t('source')}</th><th>{t('neededBy')}</th><th /></tr></thead>
          <tbody>{rq.data.length === 0 ? <tr><td colSpan={7} className="muted">{t('noReservations')}</td></tr> : rq.data.map((x) => <tr key={x.id} data-testid="sb-res"><td>{x.docNo}</td><td>{x.item.code} {x.item.name}</td><td>{x.store}</td><td className="num">{fmtQty(x.qty)}</td><td>{x.sourceType} {x.sourceId}</td><td>{fmtDate(x.neededBy)}</td><td>{x.can.release && <button type="button" className="btn" style={{ minHeight: 'var(--erp-target-min)' }} disabled={busy} onClick={() => { const why = window.prompt(t('why')); if (why) run(() => iv.release(x.id, why), t('released')); }} data-testid="sb-release">{t('release')}</button>}</td></tr>)}</tbody></table></div>)}
      {error?.form && <p className="field-error" role="alert" data-testid="sb-error">{error.form}</p>}{note && <p className="mdm-banner" role="status" data-testid="sb-note">{note}</p>}
      {canReserve && <div className="mdm-panel no-print" data-testid="sb-reserve"><h2>{t('newReservation')}</h2><div className="form-grid">
        <Field label={t('store')} name="storeId" error={error}><select value={r.storeId} onChange={(ev) => setR({ ...r, storeId: ev.target.value })} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="sb-r-store"><option value="">{t('choose')}</option>{(sq.data ?? []).filter((s) => s.status === 'ACTIVE').map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></Field>
        <Field label={t('item')} name="itemId" error={error}><select value={r.itemId} onChange={(ev) => setR({ ...r, itemId: ev.target.value })} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="sb-r-item"><option value="">{t('choose')}</option>{(iq.data ?? []).map((i) => <option key={i.id} value={i.id}>{i.code} · {i.name}</option>)}</select></Field>
        <Field label={t('qty')} name="qty" error={error}><input type="number" min="0" step="0.001" value={r.qty} onChange={(ev) => setR({ ...r, qty: ev.target.value })} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="sb-r-qty" /></Field>
        <Field label={t('source')} name="sourceType" error={error}><select value={r.sourceType} onChange={(ev) => setR({ ...r, sourceType: ev.target.value })} style={{ minHeight: 'var(--erp-target-min)' }}>{['WORK_AUTHORISATION', 'MATERIAL_REQUEST', 'TRANSFER', 'OTHER'].map((k) => <option key={k} value={k}>{t(`src.${k}`)}</option>)}</select></Field>
        <Field label={t('sourceNo')} name="sourceId" error={error}><input value={r.sourceId} maxLength={60} onChange={(ev) => setR({ ...r, sourceId: ev.target.value })} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="sb-r-source" /></Field></div>
        <div className="actions-row"><button type="button" className="btn" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy || !r.storeId || !r.itemId || !r.qty || !r.sourceId} onClick={() => run(() => iv.reserve({ storeId: Number(r.storeId), itemId: Number(r.itemId), qty: Number(r.qty), sourceType: r.sourceType, sourceId: r.sourceId }), t('reserved')).then((x) => x && setR({ ...r, qty: '', sourceId: '' }))} data-testid="sb-r-save">{t('reserve')}</button></div></div>}
    </section>
  );
}
