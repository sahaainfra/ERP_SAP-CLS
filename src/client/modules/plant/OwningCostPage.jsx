import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, usePageTitle } from '../core/pages/ui.jsx';
import { Bars } from '../proc/AnaParts.jsx';
import { fmtQty, fmtRs, fl } from './api.js';
import { ExportButton, useRunner } from './PlantParts.jsx';

// Owning and operating cost (part 17.07, FR-01): per machine or class for a period, owning (depreciation or loan instalment, insurance, permits) and operating (fuel, maintenance, hire, operator) cost, the cost an hour, and the entry of cost items; the month is closed into snapshots.
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10); const back = (n) => new Date(Date.parse(`${today()}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10); const TYPES = ['DEPRECIATION', 'EMI', 'INSURANCE', 'PERMIT', 'OPERATOR', 'OTHER'];
function Items({ equipmentId, assetCode }) {
  const t = useT('plant'); const q = useQuery({ queryKey: ['plant', 'cost-items', equipmentId], queryFn: () => fl.items(equipmentId), retry: false }); const { error, run, busy, note } = useRunner(); const [f, setF] = useState({ type: 'INSURANCE', monthlyAmount: '', from: back(30), to: '' });
  return (
    <div className="mdm-panel" data-testid="oc-items"><h2>{t('t.itemsTitle', { a: assetCode })}</h2>{note && <p className="mdm-banner" role="status" data-testid="oc-note">{note}</p>}{error?.form && <p className="field-error" role="alert" data-testid="oc-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
      {q.data && (q.data.length === 0 ? <p className="muted">{t('t.itemsNone')}</p> : <div className="table-scroll"><table className="data-table"><thead><tr><th>{t('t.type')}</th><th className="num">{t('t.monthly')}</th><th>{t('h.from')}</th><th>{t('h.to')}</th></tr></thead><tbody>{q.data.map((i) => <tr key={i.id}><td>{t(`t.ct.${i.type}`)}</td><td className="num">{fmtRs(i.monthlyAmount)}</td><td>{i.from}</td><td>{i.to ?? '—'}</td></tr>)}</tbody></table></div>)}
      <div className="form-grid"><Field label={t('t.type')} name="type" error={error}><select value={f.type} onChange={(ev) => setF({ ...f, type: ev.target.value })} style={{ minHeight: 44 }} data-testid="oc-type">{TYPES.map((k) => <option key={k} value={k}>{t(`t.ct.${k}`)}</option>)}</select></Field><Field label={t('t.monthly')} name="monthlyAmount" error={error}><input type="number" step="any" min="0" value={f.monthlyAmount} onChange={(ev) => setF({ ...f, monthlyAmount: ev.target.value })} style={{ minHeight: 44 }} data-testid="oc-amount" /></Field><Field label={t('h.from')} name="from" error={error}><input type="date" value={f.from} onChange={(ev) => setF({ ...f, from: ev.target.value })} style={{ minHeight: 44 }} /></Field></div>
      <div className="actions-row"><button type="button" className="btn" style={{ minHeight: 44 }} disabled={busy || f.monthlyAmount === ''} onClick={() => run(() => fl.itemAdd(equipmentId, { type: f.type, monthlyAmount: Number(f.monthlyAmount), from: f.from, to: f.to || null }), t('t.itemAdded'))} data-testid="oc-add">{t('t.addItem')}</button></div></div>
  );
}
export default function OwningCostPage() {
  const t = useT('plant'); usePageTitle(t('t.costTitle')); const [f, setF] = useState({ from: back(89), to: today(), groupBy: 'equipment' }); const [pick, setPick] = useState(null); const q = useQuery({ queryKey: ['plant', 'fleet-costs', f.from, f.to, f.groupBy], queryFn: () => fl.costs(f), retry: false }); const { run, busy, note, error } = useRunner(); const [month, setMonth] = useState(back(35).slice(0, 7));
  if (q.error?.status === 403) return <NoPermission what={t('t.costTitle')} permission="plant.fleet.costs" />; if (q.isPending) return <Skeleton label={t('t.costTitle')} rows={5} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data; const rs = (v) => (v == null ? '—' : fmtRs(v));
  return (
    <section aria-labelledby="oc-h" data-testid="plant-owning-cost"><h1 id="oc-h">{t('t.costTitle')}</h1><p className="muted">{t('t.costIntro')} <Link to="/plant/fleet-tower">{t('t.towerTitle')}</Link></p>
      {note && <p className="mdm-banner" role="status" data-testid="oc-snap-note">{note}</p>}{error?.form && <p className="field-error" role="alert">{error.form}</p>}
      <div className="mdm-panel no-print" data-testid="oc-params"><div className="form-grid"><label>{t('h.from')}<input type="date" value={f.from} max={f.to} onChange={(ev) => setF({ ...f, from: ev.target.value })} style={{ minHeight: 44 }} data-testid="oc-from" /></label><label>{t('h.to')}<input type="date" value={f.to} max={today()} onChange={(ev) => setF({ ...f, to: ev.target.value })} style={{ minHeight: 44 }} data-testid="oc-to" /></label><label>{t('f.groupBy')}<select value={f.groupBy} onChange={(ev) => setF({ ...f, groupBy: ev.target.value })} style={{ minHeight: 44 }} data-testid="oc-group">{['equipment', 'class'].map((g) => <option key={g} value={g}>{t(`f.gb.${g}`)}</option>)}</select></label></div>
        <div className="actions-row"><ExportButton query={{ kind: 'costs', from: f.from, to: f.to, groupBy: f.groupBy }} name="owning-operating-cost.csv" path="/fleet/export" testId="oc-export" /><label>{t('t.month')}<input type="month" value={month} onChange={(ev) => setMonth(ev.target.value)} style={{ minHeight: 44 }} data-testid="oc-month" /></label><button type="button" className="btn" style={{ minHeight: 44 }} disabled={busy} onClick={() => run(() => fl.snapshot({ month }), t('t.snapshotDone'))} data-testid="oc-snapshot">{t('t.snapshot')}</button></div></div>
      <p data-testid="oc-total">{t('t.costTotal', { hours: fmtQty(d.total.hours), total: rs(d.total.totalCost), perHour: rs(d.total.costPerHour) })}</p>
      {d.chart.length > 0 && <div className="mdm-panel"><h2>{t('t.rankCost')}</h2><Bars rows={d.chart} format={(n) => fmtRs(n)} testId="oc-bars" label={t('t.rankCost')} /></div>}
      {d.rows.length === 0 ? <div className="mdm-panel" data-testid="oc-empty"><h2>{t('t.costEmptyTitle')}</h2><p className="muted">{t('t.costEmptyBody')}</p></div> : <div className="table-scroll"><table className="data-table" data-testid="oc-table"><thead><tr><th>{t(`f.gb.${d.groupBy}`)}</th><th className="num">{t('h.working')}</th><th className="num">{t('t.owning')}</th><th className="num">{t('t.operating')}</th><th className="num">{t('f.cost')}</th><th className="num">{t('t.perHour')}</th></tr></thead>
        <tbody>{d.rows.map((r) => <tr key={r.equipmentId ?? r.key} data-testid="oc-row"><td>{r.equipmentId ? <button type="button" className="btn" onClick={() => setPick({ id: r.equipmentId, code: r.assetCode })} data-testid="oc-pick">{r.assetCode}</button> : r.assetCode}</td><td className="num">{fmtQty(r.hours)}</td><td className="num">{rs(r.owningCost)}</td><td className="num">{rs(r.operatingCost)}</td><td className="num">{rs(r.totalCost)}</td><td className="num">{rs(r.costPerHour)}</td></tr>)}</tbody></table></div>}
      {pick && <Items equipmentId={pick.id} assetCode={pick.code} />}
    </section>
  );
}
