import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { fmtQty, gr, gt, iv, today } from './api.js';
import { OfflineNotice, PhotoButton, filePhoto, useOnline } from './GateParts.jsx';

// Create GRN (part 16.03, FR-01, FR-07), a mobile screen for the storekeeper: pick the vehicle that was unloaded at the gate (or an order), count what came, say what is accepted, take the batch or heat number and the photos, and send for approval.
const blankLine = (l) => ({ poLineId: l.poLineId, itemId: l.itemId, item: l.item, uom: l.uom, balanceQty: l.balanceQty, batchTracked: l.batchTracked, stockTracked: l.stockTracked, receivedQty: '', acceptedQty: '', challanQty: '', batchNo: '', heatNo: '', mfgDate: '', inspectionRequired: l.inspectionRequired, wbsId: l.wbsId ?? null, costCodeId: l.costCodeId ?? null });
export default function GrnNewPage() {
  const t = useT('inv'); usePageTitle(t('r.newTitle')); const online = useOnline(); const sp = useSearch(); const session = useSession(); const perms = session.data?.permissions ?? [];
  const [src, setSrc] = useState({ gateInwardId: Number(sp.get('gate')) || null, poId: Number(sp.get('po')) || null }); const [q, setQ] = useState(''); const [f, setF] = useState(null); const [photos, setPhotos] = useState({}); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  const rd = useQuery({ queryKey: ['inv', 'grn-ready'], queryFn: gr.ready, retry: false }); const sq = useQuery({ queryKey: ['inv', 'stores-pick'], queryFn: iv.stores, retry: false });
  const pq = useQuery({ queryKey: ['inv', 'grn-po-search', q], queryFn: () => gt.pos({ q }), enabled: q.length >= 2, retry: false });
  const pf = useQuery({ queryKey: ['inv', 'grn-prefill', src.gateInwardId, src.poId], queryFn: async () => { const d = await gr.prefill(src.gateInwardId ? { gateInwardId: src.gateInwardId } : { poId: src.poId }); setF({ storeId: d.storeId ? String(d.storeId) : '', challanNo: d.challanNo ?? '', challanDate: d.challanDate ?? '', invoiceNo: '', gateInwardId: d.gateInwardId, poId: d.poId, lines: d.lines.map(blankLine) }); return d; }, enabled: Boolean(src.gateInwardId || src.poId), retry: false });
  if (rd.error?.status === 403 || (session.isSuccess && !perms.includes('inv.grn.create'))) return <NoPermission what={t('r.newTitle')} permission="inv.grn.create" />;
  const set = (k, v) => setF((x) => ({ ...x, [k]: v })); const line = (i, k, v) => setF((x) => ({ ...x, lines: x.lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }));
  const body = () => ({ storeId: Number(f.storeId), ...(f.gateInwardId ? { gateInwardId: f.gateInwardId } : {}), ...(f.poId ? { poId: f.poId } : {}), challanNo: f.challanNo || null, challanDate: f.challanNo ? f.challanDate || null : null, invoiceNo: f.invoiceNo || null,
    lines: f.lines.filter((l) => Number(l.receivedQty) > 0).map((l) => ({ poLineId: l.poLineId, challanQty: l.challanQty ? Number(l.challanQty) : undefined, receivedQty: Number(l.receivedQty), acceptedQty: l.acceptedQty === '' ? undefined : Number(l.acceptedQty), batchNo: l.batchNo || null, heatNo: l.heatNo || null, mfgDate: l.mfgDate || null, inspectionRequired: l.stockTracked ? l.inspectionRequired : undefined, wbsId: l.wbsId, costCodeId: l.costCodeId })) });
  const save = async (send) => { setError(null); setBusy(true); try { let d = await gr.create(body()); for (const [kind, file] of Object.entries(photos)) { const up = await filePhoto(file, 'inv_grn', d.id); d = await gr.act(d.id, 'photos', { fileId: up.id, kind }); } if (send) d = await gr.act(d.id, 'submit'); navigateTo(`/inv/grns?id=${d.id}`); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); } };
  const bad = !f || !f.storeId || !f.lines.some((l) => Number(l.receivedQty) > 0);
  return (
    <section aria-labelledby="gn-h" data-testid="grn-new"><h1 id="gn-h">{t('r.newTitle')}</h1><p className="muted">{t('r.newHelp')}</p><p><Link to="/inv/grns">{t('r.grnTitle')}</Link></p><OfflineNotice t={t} on={online} />
      {!f && <div className="mdm-panel" data-testid="gn-source"><h2>{t('r.pickSource')}</h2>
        {rd.isPending ? <Skeleton label={t('r.pickSource')} rows={2} /> : rd.isError ? <ErrorState error={rd.error} onRetry={rd.refetch} /> : (rd.data ?? []).length === 0 ? <p className="muted" data-testid="gn-none">{t('r.noGate')}</p>
          : <ul className="plain-list">{rd.data.map((e) => <li key={e.id} className="mdm-panel"><strong>{e.vehicleNo}</strong> · {e.docNo} · {e.material} · {e.poNo ?? t('g.noPo')} · {e.store} <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} onClick={() => setSrc({ gateInwardId: e.id, poId: null })} data-testid={`gn-pick-${e.id}`}>{t('r.makeGrn')}</button></li>)}</ul>}
        <Field label={t('r.orSearchPo')} name="q" error={null}><input value={q} onChange={(ev) => setQ(ev.target.value)} style={{ minHeight: 48 }} placeholder={t('g.typeToSearch')} data-testid="gn-po-q" /></Field>
        {(pq.data ?? []).map((p) => <button key={p.id} type="button" className="btn" style={{ minHeight: 48 }} onClick={() => setSrc({ gateInwardId: null, poId: p.id })} data-testid={`gn-po-${p.id}`}>{p.docNo} · {p.vendor}</button>)}</div>}
      {src.gateInwardId || src.poId ? pf.isPending ? <Skeleton label={t('r.newTitle')} rows={4} /> : pf.isError ? <ErrorState error={pf.error} onRetry={pf.refetch} /> : f && (
        <form className="mdm-panel" onSubmit={(ev) => { ev.preventDefault(); save(false); }} noValidate>
          <p><strong>{pf.data.vendor}</strong> · {pf.data.poNo ?? t('g.noPo')}{pf.data.gateNo ? ` · ${pf.data.gateNo}` : ''}{pf.data.netKg != null ? ` · ${t('g.net')} ${fmtQty(pf.data.netKg)} kg` : ''}</p>
          <div className="form-grid"><Field label={t('g.store')} name="storeId" error={error}><select value={f.storeId} onChange={(ev) => set('storeId', ev.target.value)} style={{ minHeight: 48 }} data-testid="gn-store"><option value="">{t('choose')}</option>{(sq.data ?? []).filter((s) => s.status === 'ACTIVE').map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></Field>
            <Field label={t('g.challanNo')} name="challanNo" error={error}><input value={f.challanNo} onChange={(ev) => set('challanNo', ev.target.value)} maxLength={40} style={{ minHeight: 48 }} data-testid="gn-challan" /></Field>
            <Field label={t('r.invoiceNo')} name="invoiceNo" error={error}><input value={f.invoiceNo} onChange={(ev) => set('invoiceNo', ev.target.value)} maxLength={40} style={{ minHeight: 48 }} /></Field></div>
          {f.lines.length === 0 && <p className="field-error" role="alert">{t('r.noOpenLines')}</p>}
          {f.lines.map((l, i) => (
            <div key={l.poLineId} className="mdm-panel" data-testid={`gn-line-${i}`}><h3>{l.item}</h3><p className="muted">{t('r.ordered')}: {fmtQty(l.balanceQty)} {l.uom} ({t('g.balance')})</p>
              <div className="form-grid">
                <Field label={t('r.challanQty')} name={`lines.${i}.challanQty`} error={error}><input type="number" inputMode="decimal" min="0" step="0.001" value={l.challanQty} onChange={(ev) => line(i, 'challanQty', ev.target.value)} style={{ minHeight: 48 }} /></Field>
                <Field label={t('r.receivedQty')} name={`lines.${i}.receivedQty`} error={error}><input type="number" inputMode="decimal" min="0" step="0.001" value={l.receivedQty} onChange={(ev) => setF((x) => ({ ...x, lines: x.lines.map((m, j) => (j === i ? { ...m, receivedQty: ev.target.value, acceptedQty: ev.target.value } : m)) }))} style={{ minHeight: 48, fontSize: 18 }} data-testid={`gn-received-${i}`} /></Field>
                <Field label={t('r.acceptedQty')} name={`lines.${i}.acceptedQty`} error={error}><input type="number" inputMode="decimal" min="0" step="0.001" value={l.acceptedQty} onChange={(ev) => line(i, 'acceptedQty', ev.target.value)} style={{ minHeight: 48, fontSize: 18 }} data-testid={`gn-accepted-${i}`} /></Field>
                <Field label={t('r.rejectedQty')} name="rej" error={null}><output style={{ minHeight: 48, display: 'block', paddingTop: 12 }} data-testid={`gn-rejected-${i}`}>{fmtQty(Math.max(0, (Number(l.receivedQty) || 0) - (Number(l.acceptedQty === '' ? l.receivedQty : l.acceptedQty) || 0)))}</output></Field>
                <Field label={t('r.batchNo')} name={`lines.${i}.batchNo`} error={error}><input value={l.batchNo} onChange={(ev) => line(i, 'batchNo', ev.target.value)} maxLength={40} style={{ minHeight: 48 }} data-testid={`gn-batch-${i}`} /></Field>
                <Field label={t('r.heatNo')} name={`lines.${i}.heatNo`} error={error}><input value={l.heatNo} onChange={(ev) => line(i, 'heatNo', ev.target.value)} maxLength={40} style={{ minHeight: 48 }} /></Field>
                <Field label={t('r.mfgDate')} name={`lines.${i}.mfgDate`} error={error}><input type="date" max={today()} value={l.mfgDate} onChange={(ev) => line(i, 'mfgDate', ev.target.value)} style={{ minHeight: 48 }} /></Field></div>
              {l.stockTracked && <label className="check"><input type="checkbox" checked={l.inspectionRequired} onChange={(ev) => line(i, 'inspectionRequired', ev.target.checked)} data-testid={`gn-insp-${i}`} /> {t('r.inspectionRequired')}</label>}
              {!l.stockTracked && <p className="muted">{t('r.directCharge')}</p>}</div>))}
          <div className="actions-row">{[['MATERIAL', 'r.photoMaterial'], ['CHALLAN', 'g.photoChallan']].map(([kind, key]) => <PhotoButton key={kind} label={t(key)} done={Boolean(photos[kind])} onPick={(file) => setPhotos((x) => ({ ...x, [kind]: file }))} testId={`gn-photo-${kind.toLowerCase()}`} />)}</div>
          {error?.form && <p className="field-error" role="alert" data-testid="gn-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
          <div className="actions-row"><button type="submit" className="btn" style={{ minHeight: 52 }} disabled={busy || bad} data-testid="gn-save">{t('saveDraft')}</button><button type="button" className="btn btn-primary" style={{ minHeight: 52 }} disabled={busy || bad || !online} onClick={() => save(true)} data-testid="gn-send">{t('sendForApproval')}</button></div></form>) : null}
    </section>
  );
}
