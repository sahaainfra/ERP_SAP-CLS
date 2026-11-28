import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { GATE_TONE, download, fmtQty, fmtTime, gt, iv, today } from './api.js';
import { Flags, OfflineNotice, PhotoButton, filePhoto, useOnline } from './GateParts.jsx';
import { History, useRunner } from './InvParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Gate Entry (part 16.02, FR-01 to FR-04), a mobile screen for the guard and the storekeeper: the vehicle, the driver, the vendor and the purchase order (checked at once), the photos, then the weighbridge, the unloading store and the handover.
const PHOTOS = [['VEHICLE', 'g.photoVehicle'], ['CHALLAN', 'g.photoChallan']];

function NewEntry({ t }) {
  const online = useOnline(); const opt = useQuery({ queryKey: ['inv', 'gate-options'], queryFn: gt.options, retry: false }); const ap = useQuery({ queryKey: ['inv', 'gate-appts'], queryFn: gt.appointments, retry: false });
  const [f, setF] = useState({ siteId: '', appointmentId: '', vendorId: '', poId: '', vehicleNo: '', driverName: '', driverPhone: '', transporter: '', challanNo: '', challanDate: today(), challanKg: '', ewayBillNo: '', materialDesc: '' }); const [q, setQ] = useState(''); const [photos, setPhotos] = useState({}); const [error, setError] = useState(null); const [busy, setBusy] = useState(false); const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const vq = useQuery({ queryKey: ['inv', 'gate-vendors', q], queryFn: () => gt.vendors(q), retry: false }); const pq = useQuery({ queryKey: ['inv', 'gate-pos', f.vendorId], queryFn: () => gt.pos({ vendorId: f.vendorId }), enabled: Boolean(f.vendorId), retry: false });
  const ck = useQuery({ queryKey: ['inv', 'gate-check', f.siteId, f.poId, f.vendorId, f.challanNo], queryFn: () => gt.check({ siteId: Number(f.siteId), poId: f.poId ? Number(f.poId) : null, vendorId: f.vendorId ? Number(f.vendorId) : null, challanNo: f.challanNo || null }), enabled: Boolean(f.siteId), retry: false });
  usePageTitle(t('g.entryTitle'));
  if (opt.error?.status === 403) return <NoPermission what={t('g.entryTitle')} permission="inv.inward.view" />;
  if (opt.isPending) return <Skeleton label={t('g.entryTitle')} rows={4} />;
  if (opt.isError) return <ErrorState error={opt.error} onRetry={opt.refetch} />;
  const sites = opt.data.sites; const chosenPo = (pq.data ?? []).find((p) => String(p.id) === f.poId);
  const fromAppt = (id) => { set('appointmentId', id); const a = (ap.data ?? []).find((x) => String(x.id) === id); if (a) setF((x) => ({ ...x, appointmentId: id, siteId: String(a.siteId), vendorId: a.vendorId ? String(a.vendorId) : x.vendorId, poId: a.poId ? String(a.poId) : x.poId, vehicleNo: a.vehicleNo ?? x.vehicleNo, driverName: a.driverName ?? x.driverName, materialDesc: a.materialDesc ?? x.materialDesc })); };
  const body = () => ({ siteId: Number(f.siteId), vehicleNo: f.vehicleNo, driverName: f.driverName, driverPhone: f.driverPhone || null, transporter: f.transporter || null, vendorId: f.vendorId ? Number(f.vendorId) : null, poId: f.poId ? Number(f.poId) : null, appointmentId: f.appointmentId ? Number(f.appointmentId) : null, challanNo: f.challanNo || null, challanDate: f.challanNo ? f.challanDate || null : null, challanKg: f.challanKg ? Number(f.challanKg) : null, ewayBillNo: f.ewayBillNo || null, materialDesc: f.materialDesc });
  const save = async (send) => {
    setError(null); setBusy(true);
    try {
      let d = await gt.inCreate(body()); for (const [kind, file] of Object.entries(photos)) { const up = await filePhoto(file, 'inv_gate_inward', d.id); d = await gt.inAct(d.id, 'photos', { fileId: up.id, kind }); }
      if (send) d = await gt.inAct(d.id, 'submit'); navigateTo(`/inv/gate-entry?id=${d.id}`);
    } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); }
  };
  const need = !f.siteId || f.vehicleNo.trim().length < 4 || f.driverName.trim().length < 2 || f.materialDesc.trim().length < 3;
  return (
    <section aria-labelledby="ge-h" data-testid="gate-entry-new"><PageHeader id="ge-h" title={t('g.entryTitle')} subtitle={t('g.entryHelp')} meta={<Link to="/inv/gate-register">{t('g.registerTitle')}</Link>} />
      <OfflineNotice t={t} on={online} />
      <form className="mdm-panel" onSubmit={(ev) => { ev.preventDefault(); save(false); }} noValidate><div className="form-grid">
        <Field label={t('g.site')} name="siteId" error={error}><select value={f.siteId} onChange={(ev) => set('siteId', ev.target.value)} style={{ minHeight: 'var(--erp-target-large)' }} data-testid="ge-site"><option value="">{t('choose')}</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.project} · {s.name}</option>)}</select></Field>
        {(ap.data ?? []).length > 0 && <Field label={t('g.expected')} name="appointmentId" error={error}><select value={f.appointmentId} onChange={(ev) => fromAppt(ev.target.value)} style={{ minHeight: 'var(--erp-target-large)' }} data-testid="ge-appt"><option value="">{t('g.none')}</option>{ap.data.map((a) => <option key={a.id} value={a.id}>{a.docNo} · {a.vendor ?? ''} · {a.expectedOn}</option>)}</select></Field>}
        <Field label={t('g.vehicleNo')} name="vehicleNo" error={error}><input value={f.vehicleNo} onChange={(ev) => set('vehicleNo', ev.target.value.toUpperCase())} maxLength={20} autoCapitalize="characters" style={{ minHeight: 'var(--erp-target-large)', fontSize: 18 }} data-testid="ge-vehicle" /></Field>
        <Field label={t('g.driver')} name="driverName" error={error}><input value={f.driverName} onChange={(ev) => set('driverName', ev.target.value)} maxLength={80} style={{ minHeight: 'var(--erp-target-large)' }} data-testid="ge-driver" /></Field>
        <Field label={t('g.driverPhone')} name="driverPhone" error={error}><input type="tel" inputMode="tel" value={f.driverPhone} onChange={(ev) => set('driverPhone', ev.target.value)} maxLength={15} style={{ minHeight: 'var(--erp-target-large)' }} data-testid="ge-phone" /></Field>
        <Field label={t('g.transporter')} name="transporter" error={error}><input value={f.transporter} onChange={(ev) => set('transporter', ev.target.value)} maxLength={120} style={{ minHeight: 'var(--erp-target-large)' }} /></Field>
        <Field label={t('g.vendorSearch')} name="vendorQ" error={null}><input value={q} onChange={(ev) => setQ(ev.target.value)} placeholder={t('g.typeToSearch')} style={{ minHeight: 'var(--erp-target-large)' }} data-testid="ge-vendor-q" /></Field>
        <Field label={t('g.vendor')} name="vendorId" error={error}><select value={f.vendorId} onChange={(ev) => setF((x) => ({ ...x, vendorId: ev.target.value, poId: '' }))} style={{ minHeight: 'var(--erp-target-large)' }} data-testid="ge-vendor"><option value="">{t('g.none')}</option>{(vq.data ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
        <Field label={t('g.po')} name="poId" error={error}><select value={f.poId} onChange={(ev) => set('poId', ev.target.value)} style={{ minHeight: 'var(--erp-target-large)' }} data-testid="ge-po"><option value="">{t('g.noPo')}</option>{(pq.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.docNo} · {p.project}</option>)}</select></Field>
        <Field label={t('g.challanNo')} name="challanNo" error={error}><input value={f.challanNo} onChange={(ev) => set('challanNo', ev.target.value)} maxLength={40} style={{ minHeight: 'var(--erp-target-large)' }} data-testid="ge-challan" /></Field>
        <Field label={t('g.challanKg')} name="challanKg" error={error}><input type="number" inputMode="decimal" min="0" step="0.001" value={f.challanKg} onChange={(ev) => set('challanKg', ev.target.value)} style={{ minHeight: 'var(--erp-target-large)' }} data-testid="ge-challan-kg" /></Field>
        <Field label={t('g.eway')} name="ewayBillNo" error={error}><input value={f.ewayBillNo} onChange={(ev) => set('ewayBillNo', ev.target.value)} maxLength={20} style={{ minHeight: 'var(--erp-target-large)' }} /></Field>
        <Field label={t('g.material')} name="materialDesc" error={error}><input value={f.materialDesc} onChange={(ev) => set('materialDesc', ev.target.value)} maxLength={300} style={{ minHeight: 'var(--erp-target-large)' }} data-testid="ge-material" /></Field></div>
        {chosenPo && <div className="table-scroll"><table className="data-table" data-testid="ge-po-lines"><caption>{t('g.poLines')}</caption><thead><tr><th>{t('item')}</th><th className="num">{t('g.balance')}</th><th>{t('uom')}</th></tr></thead><tbody>{chosenPo.lines.map((l) => <tr key={l.id}><td>{l.description}</td><td className="num">{fmtQty(l.balance)}</td><td>{l.uom}</td></tr>)}</tbody></table></div>}
        <div data-testid="ge-check" aria-live="polite">{ck.data?.flags?.length ? <Flags t={t} flags={ck.data.flags} testId="ge-flags" /> : ck.data ? <p className="mdm-banner" role="status" data-testid="ge-expected">{t('g.expectedOk')}</p> : null}</div>
        <div className="actions-row">{PHOTOS.map(([kind, key]) => <PhotoButton key={kind} label={t(key)} done={Boolean(photos[kind])} onPick={(file) => setPhotos((x) => ({ ...x, [kind]: file }))} testId={`ge-photo-${kind.toLowerCase()}`} />)}</div>
        {error?.form && <p className="field-error" role="alert" data-testid="ge-error">{error.form}</p>}
        <div className="actions-row"><button type="submit" className="btn" style={{ minHeight: 52 }} disabled={busy || need} data-testid="ge-save">{t('saveDraft')}</button><button type="button" className="btn btn-primary" style={{ minHeight: 52 }} disabled={busy || need || !online} onClick={() => save(true)} data-testid="ge-send">{t('g.recordEntry')}</button></div></form></section>
  );
}

function Entry({ t, id }) {
  const online = useOnline(); const q = useQuery({ queryKey: ['inv', 'inward', id], queryFn: () => gt.inward(id), retry: false });
  const hq = useQuery({ queryKey: ['inv', 'inward-history', id, q.data?.status], queryFn: () => gt.inHistory(id), enabled: q.isSuccess, retry: false }); const sq = useQuery({ queryKey: ['inv', 'stores-pick'], queryFn: iv.stores, enabled: q.isSuccess && q.data.can.unload, retry: false });
  const { error, setError, note, busy, run } = useRunner(); const [w, setW] = useState({ grossKg: '', tareKg: '', deviceRef: '' }); const [slip, setSlip] = useState(null); const [storeId, setStoreId] = useState(''); const [comment, setComment] = useState('');
  usePageTitle(t('g.entryTitle'));
  if (q.error?.status === 403 || q.error?.status === 404) return <NoPermission what={t('g.entryTitle')} permission="inv.inward.view" />;
  if (q.isPending) return <Skeleton label={t('g.entryTitle')} rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const e = q.data; const can = e.can; const wm = e.weighment; const why = (action, msg) => { const x = window.prompt(t('why')); if (x) run(() => gt.inAct(e.id, action, { reason: x }), msg); };
  const weigh = () => run(async () => { let slipFileId; if (slip) slipFileId = (await filePhoto(slip, 'inv_gate_inward', e.id)).id; const b = { ...(w.grossKg ? { grossKg: Number(w.grossKg) } : {}), ...(w.tareKg ? { tareKg: Number(w.tareKg) } : {}), ...(w.deviceRef ? { source: 'DEVICE', deviceRef: w.deviceRef } : {}), ...(slipFileId ? { slipFileId } : {}) }; const d = await gt.inAct(e.id, 'weighment', b); setW({ grossKg: '', tareKg: '', deviceRef: '' }); setSlip(null); return d; }, t('g.weighed'));
  const addPhoto = (kind, file) => run(async () => { const up = await filePhoto(file, 'inv_gate_inward', e.id); return gt.inAct(e.id, 'photos', { fileId: up.id, kind }); }, t('g.photoAdded'));
  const decide = (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('sayWhy') }); return; } run(() => iv.decide(e.taskId, action, comment.trim() || null), t(`done.${action}`)); };
  return (
    <div data-testid="ge-object" data-status={e.status}>
      <PageHeader id="ge-h" title={<>{e.docNo} <StatusBadge status={GATE_TONE[e.status]} label={t(`gs.${e.status}`)} /></>} meta={<><Link to="/inv/gate-register">{t('g.registerTitle')}</Link> · {e.site} · {e.vehicleNo}</>} />
      <OfflineNotice t={t} on={online} /><Flags t={t} flags={e.flags} />
      {error?.form && <p className="field-error" role="alert" data-testid="ge-error">{error.form}</p>}{note && <p className="mdm-banner" role="status" data-testid="ge-note">{note}</p>}
      <dl className="kv"><div><dt>{t('g.driver')}</dt><dd>{e.driverName} {e.driverPhone ?? ''}</dd></div><div><dt>{t('g.transporter')}</dt><dd>{e.transporter ?? '—'}</dd></div><div><dt>{t('g.vendor')}</dt><dd>{e.vendor ?? '—'}</dd></div><div><dt>{t('g.po')}</dt><dd>{e.poNo ?? t('g.noPo')}</dd></div><div><dt>{t('g.challanNo')}</dt><dd>{e.challanNo ?? '—'} {e.challanKg != null ? `(${fmtQty(e.challanKg)} kg)` : ''}</dd></div><div><dt>{t('g.eway')}</dt><dd>{e.ewayBillNo ?? '—'}</dd></div><div><dt>{t('g.material')}</dt><dd>{e.materialDesc}</dd></div><div><dt>{t('g.timeIn')}</dt><dd>{fmtTime(e.timeIn)}</dd></div><div><dt>{t('g.timeOut')}</dt><dd>{fmtTime(e.timeOut)}</dd></div>{e.turnaroundMin != null && <div><dt>{t('g.turnaround')}</dt><dd data-testid="ge-turnaround">{e.turnaroundMin} {t('g.min')}</dd></div>}{e.unloadingStore && <div><dt>{t('g.store')}</dt><dd>{e.unloadingStore.code} {e.unloadingStore.name}</dd></div>}</dl>
      <div className="mdm-panel" data-testid="ge-photos"><h2>{t('g.photos')}</h2>{e.photos.length === 0 ? <p className="muted">{t('g.noPhotos')}</p> : <ul>{e.photos.map((p) => <li key={p.fileId}><a href={`/api/v1/core/files/${p.fileId}/download`} target="_blank" rel="noreferrer">{t(`g.kind.${p.kind}`)}: {p.name}</a></li>)}</ul>}
        {can.photo && !['CANCELLED', 'REJECTED', 'EXITED'].includes(e.status) && <div className="actions-row">{PHOTOS.map(([kind, key]) => <PhotoButton key={kind} label={t(key)} onPick={(file) => addPhoto(kind, file)} testId={`ge-add-${kind.toLowerCase()}`} />)}</div>}</div>
      <div className="mdm-panel" data-testid="ge-weigh"><h2>{t('g.weighbridge')}</h2>
        {wm ? <dl className="kv" data-testid="ge-weighment"><div><dt>{t('g.gross')}</dt><dd>{fmtQty(wm.grossKg)} kg</dd></div><div><dt>{t('g.tare')}</dt><dd>{fmtQty(wm.tareKg)} kg</dd></div><div><dt>{t('g.net')}</dt><dd data-testid="ge-net">{fmtQty(wm.netKg)} kg</dd></div><div><dt>{t('g.variance')}</dt><dd data-testid="ge-variance">{wm.variancePct == null ? '—' : `${wm.variancePct.toFixed(2)} % (${t('g.tolerance')} ${wm.tolerancePct.toFixed(2)} %)`} {wm.flagged && <strong>{t('g.beyond')}</strong>}</dd></div><div><dt>{t('g.source')}</dt><dd>{t(`g.src.${wm.source}`)}</dd></div></dl> : <p className="muted">{t('g.notWeighed')}</p>}
        {can.weigh && <div className="form-grid"><Field label={t('g.gross')} name="grossKg" error={error}><input type="number" inputMode="decimal" min="0" step="0.001" value={w.grossKg} onChange={(ev) => setW({ ...w, grossKg: ev.target.value })} style={{ minHeight: 'var(--erp-target-large)' }} data-testid="ge-gross" /></Field><Field label={t('g.tare')} name="tareKg" error={error}><input type="number" inputMode="decimal" min="0" step="0.001" value={w.tareKg} onChange={(ev) => setW({ ...w, tareKg: ev.target.value })} style={{ minHeight: 'var(--erp-target-large)' }} data-testid="ge-tare" /></Field><Field label={t('g.deviceRef')} name="deviceRef" error={error}><input value={w.deviceRef} onChange={(ev) => setW({ ...w, deviceRef: ev.target.value })} maxLength={60} style={{ minHeight: 'var(--erp-target-large)' }} /></Field></div>}
        {can.weigh && <div className="actions-row"><PhotoButton label={t('g.photoSlip')} done={Boolean(slip)} onPick={setSlip} testId="ge-slip" /><button type="button" className="btn btn-primary" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy || (!w.grossKg && !w.tareKg)} onClick={weigh} data-testid="ge-weigh-save">{t('g.saveWeight')}</button></div>}</div>
      {can.unload && <div className="mdm-panel" data-testid="ge-unload"><h2>{t('g.unloading')}</h2><Field label={t('g.store')} name="storeId" error={error}><select value={storeId} onChange={(ev) => setStoreId(ev.target.value)} style={{ minHeight: 'var(--erp-target-large)' }} data-testid="ge-store"><option value="">{t('choose')}</option>{(sq.data ?? []).filter((s) => s.status === 'ACTIVE').map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></Field>
        <div className="actions-row"><button type="button" className="btn" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy || !storeId} onClick={() => run(() => gt.inAct(e.id, 'unloading', { storeId: Number(storeId) }), t('g.storeAssigned'))} data-testid="ge-assign">{t('g.assignStore')}</button></div></div>}
      <div className="actions-row no-print">
        {can.submit && <button type="button" className="btn btn-primary" style={{ minHeight: 52 }} disabled={busy || !online} onClick={() => run(() => gt.inAct(e.id, 'submit'), t('submitted'))} data-testid="ge-submit">{t('g.recordEntry')}</button>}
        {can.handover && <button type="button" className="btn btn-primary" style={{ minHeight: 52 }} disabled={busy} onClick={() => run(() => gt.inAct(e.id, 'handover'), t('g.handedOver'))} data-testid="ge-handover">{t('g.handover')}</button>}
        {can.exit && <button type="button" className="btn btn-primary" style={{ minHeight: 52 }} disabled={busy} onClick={() => run(() => gt.inAct(e.id, 'exit'), t('g.left'))} data-testid="ge-exit">{t('g.recordExit')}</button>}
        {can.withdraw && <button type="button" className="btn" onClick={() => why('withdraw', t('withdrawn'))}>{t('withdraw')}</button>}
        {can.amend && <button type="button" className="btn" onClick={() => why('amend', t('g.amended'))} data-testid="ge-amend">{t('g.amend')}</button>}
        {can.cancel && <button type="button" className="btn" onClick={() => why('cancel', t('cancelled'))} data-testid="ge-cancel">{t('cancel')}</button>}
        {e.can.edit && <Link to={`/inv/gate-entry?edit=${e.id}`}>{t('g.edit')}</Link>}
        <button type="button" className="btn" onClick={() => download(`/inward/${e.id}/print`, `${e.docNo.replaceAll('/', '-')}.pdf`).catch(() => setError({ form: t('g.fileFailed') }))} data-testid="ge-print">{t('g.print')}</button>
        {e.workflowInstanceId && <Link to={`/workflow/instance?id=${e.workflowInstanceId}`}>{t('approval')}</Link>}
      </div>
      {e.taskId && <div className="mdm-panel no-print" data-testid="ge-decide"><h2>{t('decide')}</h2><label>{t('comment')}<input value={comment} onChange={(ev) => setComment(ev.target.value)} maxLength={500} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="ge-comment" /></label>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} onClick={() => decide('approve')} data-testid="ge-accept">{t('g.accept')}</button><button type="button" className="btn" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} onClick={() => decide('return')}>{t('return')}</button><button type="button" className="btn" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} onClick={() => decide('reject')} data-testid="ge-refuse">{t('g.refuse')}</button></div></div>}
      <History t={t} data={hq.data} testId="ge-history" />
    </div>
  );
}

function EditEntry({ t, id }) {
  const q = useQuery({ queryKey: ['inv', 'inward', id], queryFn: () => gt.inward(id), retry: false }); const [f, setF] = useState(null); const [error, setError] = useState(null); const [busy, setBusy] = useState(false); usePageTitle(t('g.entryTitle'));
  if (q.isPending) return <Skeleton label={t('g.entryTitle')} rows={3} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const e = q.data; const v = f ?? { vehicleNo: e.vehicleNo, driverName: e.driverName, driverPhone: e.driverPhone ?? '', transporter: e.transporter ?? '', challanNo: e.challanNo ?? '', materialDesc: e.materialDesc }; const set = (k, x) => setF({ ...v, [k]: x });
  const save = async () => { setBusy(true); setError(null); try { await gt.inUpdate(e.id, { vehicleNo: v.vehicleNo, driverName: v.driverName, driverPhone: v.driverPhone || null, transporter: v.transporter || null, challanNo: v.challanNo || null, materialDesc: v.materialDesc, rowVersion: e.rowVersion }); navigateTo(`/inv/gate-entry?id=${e.id}`); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); } };
  return (
    <section aria-labelledby="ge-h" data-testid="gate-entry-edit"><PageHeader id="ge-h" title={e.docNo} meta={<Link to={`/inv/gate-entry?id=${e.id}`}>{t('back')}</Link>} />
      <form className="mdm-panel" onSubmit={(ev) => { ev.preventDefault(); save(); }} noValidate><div className="form-grid">
        {[['vehicleNo', 'g.vehicleNo'], ['driverName', 'g.driver'], ['driverPhone', 'g.driverPhone'], ['transporter', 'g.transporter'], ['challanNo', 'g.challanNo'], ['materialDesc', 'g.material']].map(([k, key]) => <Field key={k} label={t(key)} name={k} error={error}><input value={v[k]} onChange={(ev) => set(k, ev.target.value)} style={{ minHeight: 'var(--erp-target-large)' }} data-testid={`gee-${k}`} /></Field>)}</div>
        {error?.form && <p className="field-error" role="alert" data-testid="gee-error">{error.form}</p>}<div className="actions-row"><button type="submit" className="btn btn-primary" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} data-testid="gee-save">{t('save')}</button></div></form></section>
  );
}

export default function GateEntryPage() {
  const t = useT('inv'); const sp = useSearch(); const id = Number(sp.get('id')) || null; const edit = Number(sp.get('edit')) || null; const session = useSession(); const perms = session.data?.permissions ?? [];
  if (edit) return <EditEntry key={edit} t={t} id={edit} />;
  if (id) return <section aria-labelledby="ge-h" data-testid="gate-entry"><Entry key={id} t={t} id={id} /></section>;
  if (session.isSuccess && !perms.includes('inv.inward.create')) return <NoPermission what={t('g.entryTitle')} permission="inv.inward.create" />;
  return <NewEntry t={t} />;
}
