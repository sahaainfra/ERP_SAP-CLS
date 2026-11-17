import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { fmtQty, ra, today } from './api.js';
import { ScanInput } from './ScanParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Issue or return assets (part 16.08, FR-03, mobile): one form for the issue to a work front or subcontractor, the return by condition, a receipt, a transfer, a hire-in or hire-out and a repair.
const TYPES = ['ISSUE', 'RETURN', 'RECEIPT', 'TRANSFER', 'HIRE_IN', 'HIRE_OUT', 'REPAIR_OUT', 'REPAIR_IN'];
const FROM = ['ISSUE', 'TRANSFER', 'HIRE_OUT', 'REPAIR_OUT', 'REPAIR_IN']; const TO = ['RECEIPT', 'TRANSFER', 'HIRE_IN', 'RETURN'];
export default function RtaIssuePage() {
  const t = useT('inv'); usePageTitle(t('ra.issueTitle')); const session = useSession(); const perms = session.data?.permissions ?? [];
  const [f, setF] = useState({ type: 'ISSUE', itemId: '', qty: '', fromStoreId: '', toStoreId: '', partyId: '', workFront: '', projectId: '', expectedReturn: '', movementDate: today(), ownership: 'OWNED', hireId: '', holdingId: '', qtyGood: '', qtyRepairable: '', qtyScrap: '', qtyLost: '', vendorId: '', hireRate: '', hireBasis: 'DAY', orderRef: '', reason: '' });
  const [error, setError] = useState(null); const [busy, setBusy] = useState(false); const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const oq = useQuery({ queryKey: ['inv', 'rta-options'], queryFn: ra.options, retry: false }); const hq = useQuery({ queryKey: ['inv', 'rta-holdings', f.itemId], queryFn: () => ra.holdings(f.itemId), retry: false, enabled: f.type === 'RETURN' && !!f.itemId });
  if (oq.error?.status === 403 || (session.isSuccess && !perms.includes('inv.movement.create'))) return <NoPermission what={t('ra.issueTitle')} permission="inv.movement.create" />;
  if (oq.isPending) return <Skeleton label={t('ra.issueTitle')} rows={4} />; if (oq.isError) return <ErrorState error={oq.error} onRetry={oq.refetch} />;
  const o = oq.data; const T = f.type; const n = (v) => (v === '' ? undefined : Number(v));
  const body = () => ({ type: T, itemId: Number(f.itemId), movementDate: f.movementDate, reason: f.reason || null,
    ...(T === 'RETURN' ? { holdingId: Number(f.holdingId), toStoreId: Number(f.toStoreId), qtyGood: n(f.qtyGood) ?? 0, qtyRepairable: n(f.qtyRepairable) ?? 0, qtyScrap: n(f.qtyScrap) ?? 0, qtyLost: n(f.qtyLost) ?? 0 } : { qty: Number(f.qty) }),
    ...(FROM.includes(T) ? { fromStoreId: Number(f.fromStoreId) } : {}), ...(TO.includes(T) && T !== 'RETURN' ? { toStoreId: Number(f.toStoreId) } : {}),
    ...(T === 'ISSUE' ? { ...(f.partyId ? { partyId: Number(f.partyId) } : {}), ...(f.workFront ? { workFront: f.workFront } : {}), projectId: Number(f.projectId), expectedReturn: f.expectedReturn || undefined, ownership: f.ownership, ...(f.ownership === 'HIRED' ? { hireId: Number(f.hireId) } : {}) } : {}),
    ...(T === 'HIRE_IN' ? { vendorId: Number(f.vendorId), hireRate: Number(f.hireRate), hireBasis: f.hireBasis, ...(f.orderRef ? { orderRef: f.orderRef } : {}) } : {}), ...(T === 'HIRE_OUT' ? { hireId: Number(f.hireId) } : {}) });
  const save = async (send) => { setError(null); setBusy(true); try { let d = await ra.create(body()); if (send) d = await ra.act(d.id, 'submit'); navigateTo(`/inv/rta-movements?id=${d.id}`); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); } };
  const items = o.items; const hires = o.hires.filter((h) => !f.itemId || String(h.itemId) === f.itemId); const holds = hq.data ?? [];
  const sel = (k, list, label, testid, empty = '—') => <select value={f[k]} onChange={(ev) => set(k, ev.target.value)} style={{ minHeight: 48 }} data-testid={testid}><option value="">{empty}</option>{list.map((x) => <option key={x.id} value={x.id}>{label(x)}</option>)}</select>;
  const qtyIn = (k, label, testid) => <Field label={label} name={k} error={error}><input type="number" inputMode="decimal" min="0" step="any" value={f[k]} onChange={(ev) => set(k, ev.target.value)} style={{ minHeight: 48, fontSize: 18 }} data-testid={testid} /></Field>;
  return (
    <section aria-labelledby="ri-h" data-testid="rta-issue"><PageHeader id="ri-h" title={t('ra.issueTitle')} subtitle={t('ra.issueHelp')} meta={<Link to="/inv/rta-movements">{t('ra.movementsTitle')}</Link>} />
      <ScanInput t={t} testId="ri-scan" onResult={(r) => { if (r.itemId && items.some((i) => i.id === r.itemId)) set('itemId', String(r.itemId)); }} />
      <form className="mdm-panel" onSubmit={(ev) => { ev.preventDefault(); save(false); }} noValidate>
        {error?.form && <p className="field-error" role="alert" data-testid="ri-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
        <div className="form-grid">
          <Field label={t('ra.what')} name="type" error={error}><select value={T} onChange={(ev) => setF({ ...f, type: ev.target.value, holdingId: '' })} style={{ minHeight: 48 }} data-testid="ri-type">{TYPES.map((x) => <option key={x} value={x}>{t(`ra.mt.${x}`)}</option>)}</select></Field>
          <Field label={t('item')} name="itemId" error={error}>{sel('itemId', items, (i) => `${i.code} · ${i.name}`, 'ri-item')}</Field>
          {FROM.includes(T) && <Field label={t('ra.fromStore')} name="fromStoreId" error={error}>{sel('fromStoreId', o.stores, (s) => `${s.code} · ${s.name}`, 'ri-from')}</Field>}
          {TO.includes(T) && <Field label={t('ra.toStore')} name="toStoreId" error={error}>{sel('toStoreId', o.stores, (s) => `${s.code} · ${s.name}`, 'ri-to')}</Field>}
          {T === 'RETURN' ? <Field label={t('ra.holding')} name="holdingId" error={error}><select value={f.holdingId} onChange={(ev) => set('holdingId', ev.target.value)} style={{ minHeight: 48 }} data-testid="ri-holding"><option value="">{f.itemId ? '—' : t('ra.pickItemFirst')}</option>{holds.map((h) => <option key={h.id} value={h.id}>{h.party ?? h.workFront} · {fmtQty(h.qty)}{h.overdue ? ` · ${t('ra.overdue')}` : ''}</option>)}</select></Field>
            : T !== 'RETURN' && qtyIn('qty', t('i.qty'), 'ri-qty')}
          {T === 'RETURN' && <>{qtyIn('qtyGood', t('ra.qtyGood'), 'ri-good')}{qtyIn('qtyRepairable', t('ra.qtyRepairable'), 'ri-repairable')}{qtyIn('qtyScrap', t('ra.qtyScrap'), 'ri-scrap')}{qtyIn('qtyLost', t('ra.qtyLost'), 'ri-lost')}</>}
          {T === 'ISSUE' && <>
            <Field label={t('ra.party')} name="partyId" error={error}>{sel('partyId', o.parties, (p) => p.name, 'ri-party', t('ra.noParty'))}</Field>
            <Field label={t('ra.workFront')} name="workFront" error={error}><input value={f.workFront} onChange={(ev) => set('workFront', ev.target.value)} maxLength={80} style={{ minHeight: 48 }} data-testid="ri-front" /></Field>
            <Field label={t('ra.project')} name="projectId" error={error}>{sel('projectId', o.projects, (p) => `${p.code} · ${p.name}`, 'ri-project')}</Field>
            <Field label={t('ra.expected')} name="expectedReturn" error={error}><input type="date" value={f.expectedReturn} onChange={(ev) => set('expectedReturn', ev.target.value)} style={{ minHeight: 48 }} data-testid="ri-expected" /></Field>
            <Field label={t('ra.ownership')} name="ownership" error={error}><select value={f.ownership} onChange={(ev) => set('ownership', ev.target.value)} style={{ minHeight: 48 }} data-testid="ri-ownership"><option value="OWNED">{t('ra.own')}</option><option value="HIRED">{t('ra.hired')}</option></select></Field></>}
          {(T === 'HIRE_OUT' || (T === 'ISSUE' && f.ownership === 'HIRED')) && <Field label={t('ra.hire')} name="hireId" error={error}>{sel('hireId', hires, (h) => `${h.label} · ${fmtQty(h.qty)}`, 'ri-hire')}</Field>}
          {T === 'HIRE_IN' && <><Field label={t('ra.vendor')} name="vendorId" error={error}>{sel('vendorId', o.parties, (p) => p.name, 'ri-vendor')}</Field>{qtyIn('hireRate', t('ra.hireRate'), 'ri-rate')}
            <Field label={t('ra.basis')} name="hireBasis" error={error}><select value={f.hireBasis} onChange={(ev) => set('hireBasis', ev.target.value)} style={{ minHeight: 48 }} data-testid="ri-basis"><option value="DAY">{t('ra.b.DAY')}</option><option value="MONTH">{t('ra.b.MONTH')}</option></select></Field>
            <Field label={t('ra.orderRef')} name="orderRef" error={error}><input value={f.orderRef} onChange={(ev) => set('orderRef', ev.target.value)} maxLength={60} style={{ minHeight: 48 }} data-testid="ri-order" /></Field></>}
          <Field label={t('r.date')} name="movementDate" error={error}><input type="date" max={today()} value={f.movementDate} onChange={(ev) => set('movementDate', ev.target.value)} style={{ minHeight: 48 }} data-testid="ri-date" /></Field>
          <Field label={t('cn.reason')} name="reason" error={error}><input value={f.reason} onChange={(ev) => set('reason', ev.target.value)} maxLength={500} style={{ minHeight: 48 }} data-testid="ri-reason" /></Field></div>
        <div className="actions-row"><button type="submit" className="btn" style={{ minHeight: 52 }} disabled={busy || !f.itemId} data-testid="ri-draft">{t('saveDraft')}</button><button type="button" className="btn btn-primary" style={{ minHeight: 52 }} disabled={busy || !f.itemId} onClick={() => save(true)} data-testid="ri-send">{t('sendForApproval')}</button></div></form>
    </section>
  );
}
