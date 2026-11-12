import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { fmtDate, fmtQty, tr } from './api.js';
import { OfflineNotice, PhotoButton, filePhoto, useOnline } from './GateParts.jsx';

// Receive Transfer (part 16.05, FR-03), a mobile screen for the storekeeper of the destination: what came and in what state, photos of any damage, and whether this is everything (the rest is then recorded as short).
function Receive({ t, id }) {
  const online = useOnline(); const qc = useQueryClient(); const q = useQuery({ queryKey: ['inv', 'transfer', id], queryFn: () => tr.transfer(id), retry: false }); const [v, setV] = useState({}); const [final, setFinal] = useState(false); const [photo, setPhoto] = useState(null); const [error, setError] = useState(null); const [busy, setBusy] = useState(false); usePageTitle(t('tr.receiveTitle'));
  if (q.error?.status === 403 || q.error?.status === 404) return <NoPermission what={t('tr.receiveTitle')} permission="inv.transfer.receive" />; if (q.isPending) return <Skeleton label={t('tr.receiveTitle')} rows={3} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const x = q.data; const rows = x.lines.filter((l) => l.inTransitQty > 0);
  const send = async () => { setError(null); setBusy(true); try { let d = await tr.act(x.id, 'receive', { final, lines: rows.map((l) => ({ lineId: l.id, receivedQty: Number(v[l.id]?.rec || 0), damagedQty: Number(v[l.id]?.dam || 0), note: v[l.id]?.note || undefined })).filter((l) => l.receivedQty > 0 || l.damagedQty > 0 || final) }); if (photo) { const up = await filePhoto(photo, 'inv_transfer', x.id); d = await tr.act(x.id, 'photos', { fileId: up.id, kind: 'DAMAGE' }); } qc.setQueryData(['inv', 'transfer', d.id], d); qc.invalidateQueries({ queryKey: ['inv'] }); navigateTo(`/inv/transfers?id=${d.id}`); } catch (e) { setError(errorInfo(e)); } finally { setBusy(false); } };
  const any = rows.some((l) => Number(v[l.id]?.rec) > 0 || Number(v[l.id]?.dam) > 0) || final;
  return (
    <section aria-labelledby="rc-h" data-testid="transfer-receive-form"><h1 id="rc-h">{x.docNo}</h1><p className="muted">{x.from} → {x.to} · {t('tr.dispatched')} {x.dispatchDate ? fmtDate(x.dispatchDate) : ''} · {x.vehicleNo ?? ''}</p><p><Link to="/inv/transfer-receive">{t('tr.receiveTitle')}</Link></p><OfflineNotice t={t} on={online} />
      {rows.length === 0 ? <p className="muted" data-testid="rc-none">{t('tr.nothingToReceive')}</p> : (<div className="mdm-panel">
        {rows.map((l) => <div key={l.id} className="mdm-panel" data-testid={`rc-line-${l.lineNo}`}><h3>{l.item}</h3><p className="muted">{t('tr.onTheRoad')}: {fmtQty(l.inTransitQty)} {l.uom}</p>
          <div className="form-grid"><Field label={t('tr.receivedQty')} name={`l.${l.id}.rec`} error={error}><input type="number" inputMode="decimal" min="0" step="0.001" max={l.inTransitQty} value={v[l.id]?.rec ?? ''} onChange={(ev) => setV({ ...v, [l.id]: { ...v[l.id], rec: ev.target.value } })} style={{ minHeight: 48, fontSize: 18 }} data-testid={`rc-rec-${l.lineNo}`} /></Field>
            <Field label={t('tr.damagedQty')} name={`l.${l.id}.dam`} error={error}><input type="number" inputMode="decimal" min="0" step="0.001" max={l.inTransitQty} value={v[l.id]?.dam ?? ''} onChange={(ev) => setV({ ...v, [l.id]: { ...v[l.id], dam: ev.target.value } })} style={{ minHeight: 48, fontSize: 18 }} data-testid={`rc-dam-${l.lineNo}`} /></Field>
            <Field label={t('tr.note')} name={`l.${l.id}.note`} error={error}><input value={v[l.id]?.note ?? ''} maxLength={300} onChange={(ev) => setV({ ...v, [l.id]: { ...v[l.id], note: ev.target.value } })} style={{ minHeight: 48 }} /></Field></div></div>)}
        <label className="check"><input type="checkbox" checked={final} onChange={(ev) => setFinal(ev.target.checked)} data-testid="rc-final" /> {t('tr.finalReceipt')}</label>
        <div className="actions-row"><PhotoButton label={t('tr.photoDamage')} done={Boolean(photo)} onPick={setPhoto} testId="rc-photo" /></div>
        {error?.form && <p className="field-error" role="alert" data-testid="rc-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
        <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 52 }} disabled={busy || !any || !online} onClick={send} data-testid="rc-send">{t('tr.recordReceipt')}</button></div></div>)}</section>
  );
}
export default function TransferReceivePage() {
  const t = useT('inv'); usePageTitle(t('tr.receiveTitle')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession(); const perms = session.data?.permissions ?? [];
  const lq = useQuery({ queryKey: ['inv', 'transfers-incoming'], queryFn: tr.incoming, retry: false, enabled: !id });
  if (session.isSuccess && !perms.includes('inv.transfer.receive')) return <NoPermission what={t('tr.receiveTitle')} permission="inv.transfer.receive" />;
  if (id) return <Receive key={id} t={t} id={id} />;
  return (
    <section aria-labelledby="rcs-h" data-testid="transfer-receive"><h1 id="rcs-h">{t('tr.receiveTitle')}</h1><p className="muted">{t('tr.receiveHelp')}</p><p><Link to="/inv/transfers">{t('tr.title')}</Link></p>
      {lq.isPending ? <Skeleton label={t('tr.receiveTitle')} rows={2} /> : lq.isError ? <ErrorState error={lq.error} onRetry={lq.refetch} /> : (lq.data ?? []).filter((x) => x.can.receive).length === 0 ? <p className="muted" data-testid="rc-empty">{t('tr.nothingIncoming')}</p>
        : <ul className="plain-list" data-testid="rc-list">{lq.data.filter((x) => x.can.receive).map((x) => <li key={x.id} className="mdm-panel"><strong>{x.docNo}</strong> · {x.from} → {x.to} · {x.vehicleNo ?? ''} <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} onClick={() => navigateTo(`/inv/transfer-receive?id=${x.id}`)} data-testid={`rc-open-${x.id}`}>{t('tr.receive')}</button></li>)}</ul>}</section>
  );
}
