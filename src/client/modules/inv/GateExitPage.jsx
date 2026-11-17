import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { fmtTime, gt } from './api.js';
import { OfflineNotice, useOnline, useQrScan } from './GateParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Gate Exit verification (part 16.02, FR-05, BR-01), a mobile screen for the guard: scan (or type) the QR code of a gate pass; only an approved pass that has not been used opens the gate. Delivery vehicles that are handed over to stores leave from the same screen.
export default function GateExitPage() {
  const t = useT('inv'); usePageTitle(t('g.exitTitle')); const qc = useQueryClient(); const online = useOnline();
  const [code, setCode] = useState(''); const [vehicle, setVehicle] = useState(''); const [result, setResult] = useState(null); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  const { video, scanning, scan } = useQrScan((c) => { setCode(c); setError(null); }, () => setError({ form: t('g.noCamera') }));
  const wq = useQuery({ queryKey: ['inv', 'ready-to-leave'], queryFn: gt.waiting, retry: false });
  const verify = async () => { setBusy(true); setError(null); setResult(null); try { const r = await gt.verify({ code: code.trim(), ...(vehicle.trim() ? { vehicleNo: vehicle.trim() } : {}) }); setResult(r); setCode(''); setVehicle(''); qc.invalidateQueries({ queryKey: ['inv'] }); qc.invalidateQueries({ queryKey: ['list'] }); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); } };
  const leave = async (id) => { setBusy(true); setError(null); try { await gt.inAct(id, 'exit'); qc.invalidateQueries({ queryKey: ['inv'] }); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); } };
  if (wq.error?.status === 403) return <NoPermission what={t('g.exitTitle')} permission="inv.inward.view" />;
  return (
    <section aria-labelledby="gx-h" data-testid="gate-exit"><PageHeader id="gx-h" title={t('g.exitTitle')} subtitle={t('g.exitHelp')} meta={<Link to="/inv/gate-register">{t('g.registerTitle')}</Link>} />
      <OfflineNotice t={t} on={online} />
      <div className="mdm-panel"><div className="form-grid">
        <Field label={t('g.passCode')} name="code" error={error}><input value={code} onChange={(ev) => setCode(ev.target.value.trim())} autoCapitalize="characters" autoComplete="off" placeholder="GP:…" style={{ minHeight: 52, fontSize: 18 }} data-testid="gx-code" /></Field>
        <Field label={t('g.vehicleNo')} name="vehicleNo" error={error}><input value={vehicle} onChange={(ev) => setVehicle(ev.target.value.toUpperCase())} maxLength={20} style={{ minHeight: 52 }} data-testid="gx-vehicle" /></Field></div>
        {scanning && <video ref={video} className="att-video" playsInline muted aria-label={t('g.cameraLabel')} />}{!scanning && <video ref={video} hidden />}
        <div className="actions-row"><button type="button" className="btn" style={{ minHeight: 52 }} onClick={scan} data-testid="gx-scan">{t('g.scan')}</button><button type="button" className="btn btn-primary" style={{ minHeight: 52 }} disabled={busy || code.length < 6 || !online} onClick={verify} data-testid="gx-verify">{t('g.verify')}</button></div>
        {error?.form && <p className="field-error" role="alert" data-testid="gx-error" style={{ fontSize: 18 }}>⛔ {error.form}</p>}
        {result && <div className="mdm-banner" role="status" data-testid="gx-ok" style={{ fontSize: 18 }}><strong>✅ {t('g.openGate')}</strong><br />{result.docNo} · {result.typeLabel} · {result.destination}{result.expectedReturn ? ` · ${t('g.backBy')} ${result.expectedReturn}` : ''}<ul>{result.items.map((l, i) => <li key={i}>{l.description}: {l.qty} {l.uom}</li>)}</ul></div>}</div>
      <h2>{t('g.readyToLeave')}</h2>
      {wq.isPending ? <Skeleton label={t('g.readyToLeave')} rows={2} /> : wq.isError ? <ErrorState error={wq.error} onRetry={wq.refetch} /> : (wq.data ?? []).length === 0 ? <p className="muted" data-testid="gx-none">{t('g.noneReady')}</p>
        : <ul className="plain-list" data-testid="gx-ready">{wq.data.map((r) => <li key={r.id} className="mdm-panel"><strong>{r.vehicle}</strong> · {r.docNo} · {r.vendor ?? '—'} · {t('g.timeIn')} {fmtTime(r.timeIn)} <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => leave(r.id)} data-testid={`gx-leave-${r.id}`}>{t('g.recordExit')}</button></li>)}</ul>}
    </section>
  );
}
