import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { at, ro } from './api.js';
import { useRunner } from './InvParts.jsx';
import { ScanInput } from './ScanParts.jsx';

// Issue or return by QR with the receiver's code (part 16.09, FR-02, mobile): the keeper scans the tag, chooses the person and issues; the person gets a code on their own phone and confirms it here or reads it out. Employees see their tools and confirm what is waiting.
const CONDS = ['GOOD', 'FAIR', 'REPAIRABLE', 'DAMAGED', 'SCRAP'];
function Mine({ t }) {
  const q = useQuery({ queryKey: ['inv', 'asset-mine'], queryFn: at.mine, retry: false }); const { error, note, busy, run } = useRunner(); const [codes, setCodes] = useState({});
  if (q.isPending) return <Skeleton label={t('at.mine')} rows={2} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  return (
    <div className="mdm-panel" data-testid="asset-mine"><h2>{t('at.mine')}</h2>{error?.form && <p className="field-error" role="alert" data-testid="mine-error">{error.form}</p>}{note && <p className="mdm-banner" role="status" data-testid="mine-note">{note}</p>}
      {q.data.length === 0 ? <p className="muted" data-testid="mine-empty">{t('at.mineEmpty')}</p> : <ul className="card-list">{q.data.map((a) => <li key={a.id} className="mdm-panel" data-testid={`mine-${a.tag}`}><strong>{a.tag}</strong> · {a.item}<div className="muted">{a.pendingLogId ? t('at.waitingForYou') : t('at.withYou')}</div>
        {a.pendingLogId && <div className="actions-row"><input inputMode="numeric" maxLength={6} aria-label={t('at.code')} placeholder={t('at.code')} value={codes[a.id] ?? ''} onChange={(ev) => setCodes({ ...codes, [a.id]: ev.target.value })} style={{ minHeight: 52, fontSize: 20, width: 140 }} data-testid={`mine-code-${a.tag}`} /><button type="button" className="btn btn-primary" style={{ minHeight: 52 }} disabled={busy || !/^\d{6}$/.test(codes[a.id] ?? '')} onClick={() => run(() => at.act(a.id, 'acknowledge', { method: 'OTP', otp: codes[a.id] }), t('at.acknowledged'))} data-testid={`mine-confirm-${a.tag}`}>{t('at.confirmCode')}</button></div>}</li>)}</ul>}</div>
  );
}
function Tool({ t, tag, perms, onClear }) {
  const q = useQuery({ queryKey: ['inv', 'asset-scan', tag], queryFn: async () => { const r = await ro.scan(`ERP:A:${tag}`); return at.asset(r.assetId); }, retry: false }); const oq = useQuery({ queryKey: ['inv', 'asset-options'], queryFn: at.options, retry: false });
  const { error, note, busy, run } = useRunner(); const [who, setWho] = useState(''); const [otp, setOtp] = useState(''); const [cond, setCond] = useState('GOOD'); const [signed, setSigned] = useState('');
  if (q.isPending) return <Skeleton label={t('at.scanTitle')} rows={2} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const x = q.data; const can = x.can; const act = (action, body, msg) => run(() => at.act(x.id, action, body), msg);
  return (
    <div className="mdm-panel" data-testid="scan-tool" data-state={x.state}><h2>{x.tag} <button type="button" className="btn" onClick={onClear}>×</button></h2><p>{x.item} · <span data-testid="scan-state">{t(`at.st.${x.state}`)}</span> · {x.custodian ?? '—'}</p><p><Link to={`/inv/small-assets?id=${x.id}`}>{t('at.openAsset')}</Link></p>
      {error?.form && <p className="field-error" role="alert" data-testid="scan-error">{error.form}</p>}{note && <p className="mdm-banner" role="status" data-testid="scan-note">{note}</p>}{x.calibrationState === 'OVERDUE' && <p className="mdm-banner" role="alert" data-testid="scan-cal-overdue">{t('at.calOverdueShort')}</p>}
      {can.issue && <><Field label={t('at.custodian')} name="who" error={error}><select value={who} onChange={(ev) => setWho(ev.target.value)} style={{ minHeight: 52 }} data-testid="scan-who"><option value="">—</option>{(oq.data?.employees ?? []).map((e) => <option key={e.id} value={e.id}>{e.code} · {e.name}</option>)}</select></Field><div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 56 }} disabled={busy || !who} onClick={() => act('issue', { custodianType: 'EMPLOYEE', custodianId: Number(who) }, t('at.codeSent'))} data-testid="scan-issue">{t('at.issueAndSend')}</button></div></>}
      {can.acknowledge && <><Field label={t('at.code')} name="otp" error={error}><input inputMode="numeric" maxLength={6} value={otp} onChange={(ev) => setOtp(ev.target.value)} style={{ minHeight: 56, fontSize: 22 }} data-testid="scan-otp" autoComplete="one-time-code" /></Field><div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 56 }} disabled={busy || !/^\d{6}$/.test(otp)} onClick={() => act('acknowledge', { method: 'OTP', otp }, t('at.acknowledged'))} data-testid="scan-confirm">{t('at.confirmCode')}</button>{can.cancelIssue && <button type="button" className="btn" style={{ minHeight: 56 }} disabled={busy} onClick={() => act('cancel-handover', { reason: 'Cancelled at the scan screen' }, t('at.handoverCancelled'))} data-testid="scan-cancel">{t('at.cancelHandover')}</button>}</div>
        {perms.includes('inv.small_asset.custody') && <div className="actions-row"><input aria-label={t('at.signedBy')} placeholder={t('at.signedBy')} value={signed} onChange={(ev) => setSigned(ev.target.value)} style={{ minHeight: 52 }} data-testid="scan-signed" /><button type="button" className="btn" style={{ minHeight: 52 }} disabled={busy || !signed.trim()} onClick={() => act('acknowledge', { method: 'SIGNATURE', signedBy: signed }, t('at.acknowledged'))} data-testid="scan-sign">{t('at.recordSignature')}</button></div>}</>}
      {can.return && <><Field label={t('at.condition')} name="condition" error={error}><select value={cond} onChange={(ev) => setCond(ev.target.value)} style={{ minHeight: 52 }} data-testid="scan-cond">{CONDS.map((c) => <option key={c} value={c}>{t(`at.c.${c}`)}</option>)}</select></Field><div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 56 }} disabled={busy} onClick={() => act('return', { condition: cond }, t('at.returned'))} data-testid="scan-return">{t('at.return')}</button></div></>}
    </div>
  );
}
export default function AssetScanPage() {
  const t = useT('inv'); usePageTitle(t('at.scanTitle')); const sp = useSearch(); const session = useSession(); const perms = session.data?.permissions ?? []; const [tag, setTag] = useState(sp.get('tag') ?? '');
  if (session.isSuccess && !perms.includes('inv.small_asset.view') && !perms.includes('inv.small_asset.acknowledge')) return <NoPermission what={t('at.scanTitle')} permission="inv.small_asset.view" />;
  return (
    <section aria-labelledby="sc-h" data-testid="asset-scan"><h1 id="sc-h">{t('at.scanTitle')}</h1><p className="muted">{t('at.scanHelp')}</p>
      {perms.includes('inv.small_asset.view') && <ScanInput t={t} testId="asset-scan-input" onResult={(r) => { if (r.type === 'ASSET') setTag(r.tag); }} />}
      {tag && perms.includes('inv.small_asset.view') && <Tool key={tag} t={t} tag={tag} perms={perms} onClear={() => setTag('')} />}
      {perms.includes('inv.small_asset.acknowledge') && <Mine t={t} />}
    </section>
  );
}
