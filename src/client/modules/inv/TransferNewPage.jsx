import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { fmtQty, iv, today, tr } from './api.js';
import { ScanInput } from './ScanParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Transfer Request (part 16.05, FR-01): from store, to store, items, quantities and the date it is wanted. The request is approved by the construction manager of the source; between projects the project managers of both approve too.
export default function TransferNewPage() {
  const t = useT('inv'); usePageTitle(t('tr.newTitle')); const sp = useSearch(); const mrId = Number(sp.get('mr')) || null; const session = useSession(); const perms = session.data?.permissions ?? [];
  const [f, setF] = useState({ fromStoreId: '', toStoreId: '', requiredBy: '', interState: false, reason: '', lines: [{ itemId: '', qty: '' }] }); const [error, setError] = useState(null); const [busy, setBusy] = useState(false); const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const oq = useQuery({ queryKey: ['inv', 'transfer-options'], queryFn: tr.options, retry: false }); const iq = useQuery({ queryKey: ['inv', 'items-pick'], queryFn: () => iv.items(''), retry: false });
  const pf = useQuery({ queryKey: ['inv', 'transfer-prefill', mrId], queryFn: async () => { const d = await tr.prefill({ mrId }); setF((x) => ({ ...x, requiredBy: d.requiredBy ?? '', lines: d.lines.map((l) => ({ itemId: String(l.itemId), qty: String(l.qty) })) })); return d; }, enabled: Boolean(mrId), retry: false });
  if (oq.error?.status === 403 || (session.isSuccess && !perms.includes('inv.transfer.create'))) return <NoPermission what={t('tr.newTitle')} permission="inv.transfer.create" />;
  if (oq.isPending || iq.isPending) return <Skeleton label={t('tr.newTitle')} rows={4} />; if (oq.isError) return <ErrorState error={oq.error} onRetry={oq.refetch} />;
  const stores = oq.data.stores; const from = stores.find((s) => String(s.id) === f.fromStoreId); const to = stores.find((s) => String(s.id) === f.toStoreId); const inter = from && to && (from.projectId ?? 0) !== (to.projectId ?? 0);
  const line = (i, k, v) => setF((x) => ({ ...x, lines: x.lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }));
  const body = () => ({ fromStoreId: Number(f.fromStoreId), toStoreId: Number(f.toStoreId), requiredBy: f.requiredBy || null, interState: f.interState, reason: f.reason || null, ...(mrId ? { mrId } : {}), lines: f.lines.filter((l) => l.itemId && Number(l.qty) > 0).map((l) => ({ itemId: Number(l.itemId), qty: Number(l.qty) })) });
  const save = async (send) => { setError(null); setBusy(true); try { let d = await tr.create(body()); if (send) d = await tr.act(d.id, 'submit'); navigateTo(`/inv/transfers?id=${d.id}`); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); } };
  const bad = !f.fromStoreId || !f.toStoreId || f.fromStoreId === f.toStoreId || !f.lines.some((l) => l.itemId && Number(l.qty) > 0);
  return (
    <section aria-labelledby="tn-h" data-testid="transfer-new"><PageHeader id="tn-h" title={t('tr.newTitle')} subtitle={t('tr.newHelp')} meta={<><Link to="/inv/transfers">{t('tr.title')}</Link>{pf.data ? ` · ${pf.data.mrNo}` : ''}</>} />
      <ScanInput t={t} testId="tn-scan" onResult={(r) => { if (r.itemId) setF((x) => { const i = x.lines.findIndex((l) => !l.itemId); return i >= 0 ? { ...x, lines: x.lines.map((l, j) => (j === i ? { ...l, itemId: String(r.itemId) } : l)) } : { ...x, lines: [...x.lines, { itemId: String(r.itemId), qty: '' }] }; }); }} />
      <form className="mdm-panel" onSubmit={(ev) => { ev.preventDefault(); save(false); }} noValidate><div className="form-grid">
        <Field label={t('tr.from')} name="fromStoreId" error={error}><select value={f.fromStoreId} onChange={(ev) => set('fromStoreId', ev.target.value)} style={{ minHeight: 48 }} data-testid="tn-from"><option value="">{t('choose')}</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}{s.project ? ` (${s.project})` : ''}</option>)}</select></Field>
        <Field label={t('tr.to')} name="toStoreId" error={error}><select value={f.toStoreId} onChange={(ev) => set('toStoreId', ev.target.value)} style={{ minHeight: 48 }} data-testid="tn-to"><option value="">{t('choose')}</option>{stores.filter((s) => String(s.id) !== f.fromStoreId).map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}{s.project ? ` (${s.project})` : ''}</option>)}</select></Field>
        <Field label={t('tr.requiredBy')} name="requiredBy" error={error}><input type="date" min={today()} value={f.requiredBy} onChange={(ev) => set('requiredBy', ev.target.value)} style={{ minHeight: 48 }} data-testid="tn-required" /></Field>
        <Field label={t('reason')} name="reason" error={error}><input value={f.reason} maxLength={500} onChange={(ev) => set('reason', ev.target.value)} style={{ minHeight: 48 }} data-testid="tn-reason" /></Field></div>
        {inter && <p className="mdm-banner" role="status" data-testid="tn-inter">{t('tr.interNote')}</p>}
        <label className="check"><input type="checkbox" checked={f.interState} onChange={(ev) => set('interState', ev.target.checked)} data-testid="tn-state" /> {t('tr.interState')}</label>
        <div className="table-scroll"><table className="data-table" data-testid="tn-lines"><caption>{t('r.lines')}</caption><thead><tr><th>{t('item')}</th><th className="num">{t('i.qty')}</th><th /></tr></thead><tbody>{f.lines.map((l, i) => <tr key={i}><td data-label={t('item')}><select aria-label={t('item')} value={l.itemId} onChange={(ev) => line(i, 'itemId', ev.target.value)} style={{ minHeight: 44 }} data-testid={`tn-item-${i}`}><option value="">{t('choose')}</option>{(iq.data ?? []).map((it) => <option key={it.id} value={it.id}>{it.code} · {it.name}</option>)}</select></td><td data-label={t('i.qty')}><input aria-label={t('i.qty')} type="number" inputMode="decimal" min="0" step="0.001" value={l.qty} onChange={(ev) => line(i, 'qty', ev.target.value)} style={{ minHeight: 44, width: 110 }} data-testid={`tn-qty-${i}`} />{l.qty ? ` ${fmtQty(Number(l.qty))}` : ''}</td><td>{f.lines.length > 1 && <button type="button" className="btn" onClick={() => setF((x) => ({ ...x, lines: x.lines.filter((_, j) => j !== i) }))}>{t('remove')}</button>}</td></tr>)}</tbody></table></div>
        <button type="button" className="btn" onClick={() => setF((x) => ({ ...x, lines: [...x.lines, { itemId: '', qty: '' }] }))} data-testid="tn-add">{t('g.addItem')}</button>
        {error?.form && <p className="field-error" role="alert" data-testid="tn-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
        <div className="actions-row"><button type="submit" className="btn" style={{ minHeight: 48 }} disabled={busy || bad} data-testid="tn-save">{t('saveDraft')}</button><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy || bad} onClick={() => save(true)} data-testid="tn-send">{t('sendForApproval')}</button></div></form></section>
  );
}
