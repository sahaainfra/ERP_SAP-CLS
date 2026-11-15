import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { OfflineNotice, PhotoButton, filePhoto, useOnline } from '../inv/GateParts.jsx';
import { fmtQty, fu } from './api.js';
import { useRunner } from './PlantParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Fuel issue (part 17.04, FR-02, mobile): the fuel attendant picks the tank and the machine, types the meter and the litres, names who received the fuel, and files the photograph of the meter and the pump. The server holds the issue to the capacity of the machine and to a meter that advances.
// What is typed is kept on the device until it is saved, so a lost signal does not lose it.
const now = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 16); const KEEP = 'erp.plant.fueldraft'; const num = (v) => (v === '' || v == null ? 0 : Number(v));
const blank = () => ({ tankId: '', equipmentId: '', issueAt: now(), meterReading: '', litres: '', fullTank: true, receivedBy: '', noAdvanceReason: '' });
const keepGet = () => { try { return { ...blank(), ...JSON.parse(globalThis.localStorage?.getItem(KEEP) ?? '{}') }; } catch { return blank(); } }; const keepSet = (v) => { try { globalThis.localStorage?.setItem(KEEP, JSON.stringify(v)); } catch { /* the device keeps nothing: the page still works */ } };
export default function FuelIssuePage() {
  const t = useT('plant'); usePageTitle(t('f.issueTitle')); const online = useOnline(); const [f, setF] = useState(keepGet); const [issue, setIssue] = useState(null); const { error, run, busy, note: ok } = useRunner(); const set = (k, v) => setF((s) => { const n = { ...s, [k]: v }; keepSet(n); return n; });
  const oq = useQuery({ queryKey: ['plant', 'fuel-options'], queryFn: fu.options, retry: false });
  useEffect(() => { const m = oq.data?.equipment.find((x) => String(x.id) === String(f.equipmentId)); if (m && m.lastMeter != null && f.meterReading === '') setF((s) => ({ ...s, meterReading: String(m.lastMeter) })); }, [oq.data, f.equipmentId, f.meterReading]);
  if (oq.error?.status === 403) return <NoPermission what={t('f.issueTitle')} permission="plant.issue.create" />; if (oq.isPending) return <Skeleton label={t('f.issueTitle')} rows={5} />; if (oq.isError) return <ErrorState error={oq.error} onRetry={oq.refetch} />;
  const o = oq.data; const m = o.equipment.find((x) => String(x.id) === String(f.equipmentId)); const tank = o.tanks.find((x) => String(x.id) === String(f.tankId)); const req = <span aria-hidden="true" className="muted"> *</span>;
  const equalMeter = m && m.lastMeter != null && f.meterReading !== '' && Number(f.meterReading) === Number(m.lastMeter);
  const body = () => ({ tankId: Number(f.tankId), equipmentId: Number(f.equipmentId), issueAt: f.issueAt, meterReading: num(f.meterReading), litres: num(f.litres), fullTank: f.fullTank, receivedBy: f.receivedBy, noAdvanceReason: f.noAdvanceReason || null });
  const save = async () => { const d = await run(() => (issue ? fu.update(issue.id, { ...body(), rowVersion: issue.version }) : fu.create(body())), t('f.saved')); if (d) setIssue(d); };
  const photo = (file) => run(async () => { const up = await filePhoto(file, 'plt_fuel_issues', issue.id); return fu.attach(issue.id, up.id); }, t('f.photoAdded')).then((d) => d && setIssue(d));
  const send = async () => { const d = await run(() => fu.act(issue.id, 'submit'), t('submitted')); if (d) { keepSet(blank()); navigateTo(`/plant/fuel-issues?id=${d.id}`); } };
  const sel = (k, label, list, extra = {}) => <Field label={label} name={k} error={error}><select value={f[k]} onChange={(ev) => set(k, ev.target.value)} style={{ minHeight: 48 }} data-testid={`fi-${k}`} {...extra}><option value="">—</option>{list}</select></Field>;
  const inp = (k, label, extra = {}) => <Field label={label} name={k} error={error}><input value={f[k]} onChange={(ev) => set(k, ev.target.value)} style={{ minHeight: 48 }} data-testid={`fi-${k}`} inputMode={extra.type === 'number' ? 'decimal' : undefined} {...extra} /></Field>;
  return (
    <section aria-labelledby="fi-h" data-testid="plant-fuel-issue"><PageHeader id="fi-h" title={t('f.issueTitle')} subtitle={<>{t('f.issueIntro')} <Link to="/plant/fuel-issues">{t('f.issuesTitle')}</Link></>} />
      <OfflineNotice t={() => t('f.offline')} on={online} />{error?.form && <p className="field-error" role="alert" data-testid="fi-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}{ok && <p className="mdm-banner" role="status" data-testid="fi-note">{ok}</p>}
      {o.tanks.length === 0 ? <div className="mdm-panel" data-testid="fi-empty"><h2>{t('f.noTanksTitle')}</h2><p className="muted">{t('f.noTanksBody')}</p></div> : <>
        <div className="mdm-panel"><h2>{t('f.secWhat')}</h2>
          {sel('tankId', <>{t('f.tank')}{req}</>, o.tanks.map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name} · {fmtQty(x.bookLitres)} l</option>), { 'aria-required': 'true', disabled: Boolean(issue) })}
          {sel('equipmentId', <>{t('f.machine')}{req}</>, o.equipment.filter((x) => !tank || x.fuel === tank.fuel).map((x) => <option key={x.id} value={x.id}>{x.assetCode}</option>), { 'aria-required': 'true', disabled: Boolean(issue) })}
          {m && <p className="muted small" data-testid="fi-machine">{t('f.machineInfo', { cap: fmtQty(m.tankCapacity), norm: fmtQty(m.norm), unit: m.normUnit, last: m.lastMeter == null ? '—' : fmtQty(m.lastMeter) })}</p>}</div>
        <div className="mdm-panel"><h2>{t('f.secFuel')}</h2><div className="form-grid">{inp('issueAt', <>{t('f.when')}{req}</>, { type: 'datetime-local', max: now() })}{inp('meterReading', <>{t('f.meter')}{req}</>, { type: 'number', step: 'any', min: 0 })}{inp('litres', <>{t('f.litres')}{req}</>, { type: 'number', step: 'any', min: 0 })}</div>
          {m && Number(f.litres) > m.tankCapacity && m.tankCapacity > 0 && <p className="field-error" data-testid="fi-over">{t('f.overCapacity', { cap: fmtQty(m.tankCapacity) })}</p>}
          {equalMeter && inp('noAdvanceReason', <>{t('f.noAdvance')}{req}</>, { maxLength: 200 })}
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}><input type="checkbox" checked={f.fullTank} onChange={(ev) => set('fullTank', ev.target.checked)} data-testid="fi-full" style={{ minWidth: 24, minHeight: 24 }} />{t('f.fullTank')}</label>
          {inp('receivedBy', <>{t('f.receivedBy')}{req}</>, { maxLength: 80 })}</div>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 56 }} disabled={busy || !online || !f.tankId || !f.equipmentId || f.meterReading === '' || f.litres === ''} onClick={save} data-testid="fi-save">{issue ? t('f.update') : t('f.save')}</button></div>
        {issue && <div className="mdm-panel" data-testid="fi-review"><h2>{t('f.review')} {issue.docNo}</h2>
          <p className="muted" data-testid="fi-calc">{issue.consumption == null ? t('f.firstIssue') : t('f.consumption', { c: fmtQty(issue.consumption), n: issue.norm == null ? '—' : fmtQty(issue.norm), u: issue.normUnit, d: issue.deviationPct ?? '—' })}</p>
          <p><PhotoButton label={t('f.photo')} onPick={photo} testId="fi-photo" done={Boolean(issue.photoFileId)} /></p>
          <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 56 }} disabled={busy || !online || !issue.photoFileId} onClick={send} data-testid="fi-send">{t('f.send')}</button></div></div>}</>}
    </section>
  );
}
