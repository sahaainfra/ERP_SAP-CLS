import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { fmtDate, hse, qs } from './api.js';
import { ErrorLine, ProjectSite, big, useRunner } from './HseParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Part 19.05: the ESG dashboard, the monthly data entry (phone friendly), the waste register, the carbon emissions report, environmental consents and the emission factors (activated by a second person).
const thisMonth = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 7); const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10); const num = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN'));
function Period({ from, to, setFrom, setTo }) { const t = useT('hse'); return <div className="form-grid no-print"><Field label={t('cmp.from')} name="from" error={null}><input type="month" value={from} onChange={(e) => setFrom(e.target.value)} style={big} data-testid="hse-esg-from" /></Field><Field label={t('cmp.to')} name="to" error={null}><input type="month" value={to} onChange={(e) => setTo(e.target.value)} style={big} data-testid="hse-esg-to" /></Field></div>; }
function Tile({ label, value, unit, id }) { return <div className="mdm-panel" data-testid={id}><p className="muted" style={{ margin: 0 }}>{label}</p><p style={{ fontSize: '1.6rem', margin: '4px 0' }}><b>{value}</b> <small>{unit}</small></p></div>; }
export function EsgDashboardPage() {
  const t = useT('hse'); usePageTitle(t('esg.dashboard')); const [from, setFrom] = useState(`${thisMonth().slice(0, 4)}-01`); const [to, setTo] = useState(thisMonth());
  const q = useQuery({ queryKey: ['hse', 'esg-dashboard', from, to], queryFn: () => hse.get(`/esg/dashboard${qs({ from, to })}`), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('esg.dashboard')} permission="hse.esg.view" />; if (q.isPending) return <Skeleton label={t('esg.dashboard')} rows={4} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />; const d = q.data;
  return (
    <section aria-labelledby="esg-h" data-testid="hse-esg-dashboard"><PageHeader id="esg-h" title={t('esg.dashboard')} subtitle={<>{t('esg.intro')} <Link to="/hse/esg-entry">{t('esg.entry')}</Link> · <Link to="/hse/carbon">{t('esg.carbon')}</Link> · <Link to="/hse/waste">{t('esg.waste')}</Link></>} /><Period from={from} to={to} setFrom={setFrom} setTo={setTo} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <Tile id="hse-esg-t-elec" label={t('esg.electricity')} value={num(d.electricityKwh)} unit="kWh" /><Tile id="hse-esg-t-diesel" label={t('esg.diesel')} value={num(d.dieselLitres)} unit="L" /><Tile id="hse-esg-t-water" label={t('esg.water')} value={num(d.waterKl)} unit="kL" />
        <Tile id="hse-esg-t-co2" label={t('esg.emissions')} value={num(d.emissions.totalTonnes)} unit="tCO2e" /><Tile id="hse-esg-t-waste" label={t('esg.wasteDiverted')} value={d.waste.divertedPct == null ? '—' : `${d.waste.divertedPct}%`} unit="" /></div>
      {d.emissions.missingFactors.length > 0 && <p className="field-error" role="alert" data-testid="hse-esg-missing">{t('esg.missingFactors', { m: d.emissions.missingFactors.join(', ') })} <Link to="/hse/emission-factors">{t('esg.factors')}</Link></p>}
      <h2>{t('esg.monitoring')}</h2><div className="table-scroll"><table className="data-table" data-testid="hse-esg-monitoring"><thead><tr><th>{t('esg.metric')}</th><th>{t('esg.limit')}</th><th>{t('esg.readings')}</th><th>{t('esg.breaches')}</th></tr></thead><tbody>{d.monitoring.map((m) => <tr key={m.metric}><td>{m.label}</td><td>{m.limit} {m.uom}</td><td>{m.readings}</td><td>{m.breaches > 0 ? <StatusBadge status="REJECTED" label={String(m.breaches)} /> : 0}</td></tr>)}</tbody></table></div>
      <h2>{t('esg.consents')}</h2><p data-testid="hse-esg-consents">{t('esg.consentLine', { n: d.consents.items.length, exp: d.consents.expiring, gone: d.consents.expired })} <Link to="/hse/consents">{t('esg.consents')}</Link></p>
      {d.breaches.length > 0 && <div className="table-scroll"><table className="data-table" data-testid="hse-esg-breaches"><caption>{t('esg.recentBreaches')}</caption><tbody>{d.breaches.map((b) => <tr key={b.id}><td>{fmtDate(b.date)}</td><td>{b.metricLabel}</td><td>{b.value} {b.uom}</td><td>{t('esg.limit')} {b.limit}</td></tr>)}</tbody></table></div>}
      <h2>{t('esg.wasteByCategory')}</h2><ul>{d.waste.byCategory.map((c) => <li key={c.category}>{c.label}: {num(c.kg)} kg</li>)}</ul>
    </section>
  );
}
export function EsgEntryPage() {
  const t = useT('hse'); usePageTitle(t('esg.entry')); const session = useSession(); const { error, run, busy, note } = useRunner(); const [v, setV] = useState({ projectId: '', siteId: '' }); const [date, setDate] = useState(today()); const [vals, setVals] = useState({});
  const oq = useQuery({ queryKey: ['hse', 'esg-options'], queryFn: () => hse.get('/esg/readings/options'), retry: false });
  if (oq.error?.status === 403) return <NoPermission what={t('esg.entry')} permission="hse.esg.record" />; if (oq.isPending) return <Skeleton label={t('esg.entry')} rows={4} />; const o = oq.data; const filled = Object.entries(vals).filter(([, x]) => x !== '' && Number(x) >= 0);
  return (
    <section aria-labelledby="ese-h" data-testid="hse-esg-entry"><PageHeader id="ese-h" title={t('esg.entry')} subtitle={t('esg.entryHint')} /><ErrorLine error={error} id="hse-esg-error" />{note && <p className="mdm-banner" role="status" data-testid="hse-esg-note">{note}</p>}
      <div className="mdm-panel"><div className="form-grid"><ProjectSite o={o} v={v} set={setV} error={error} /><Field label={t('esg.date')} name="readingDate" error={error}><input type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value)} style={big} data-testid="hse-esg-date" /></Field></div>
        <div className="form-grid">{o.metrics.map((m) => <Field key={m.id} label={`${m.label} (${m.uom})${m.limit ? ` · ${t('esg.limit')} ${m.limit}` : ''}`} name={m.id} error={error}><input type="number" min="0" step="any" inputMode="decimal" value={vals[m.id] ?? ''} onChange={(e) => setVals({ ...vals, [m.id]: e.target.value })} style={big} data-testid={`hse-esg-v-${m.id}`} /></Field>)}</div>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy || !v.siteId || filled.length === 0} onClick={async () => { if (await run(() => hse.make('/esg/readings/bulk', { projectId: Number(v.projectId), siteId: Number(v.siteId), readingDate: date, readings: filled.map(([metric, value]) => ({ metric, value: Number(value) })) }), t('esg.saved'))) setVals({}); }} data-testid="hse-esg-save">{t('save')}</button>
          <button type="button" className="btn" style={big} disabled={busy || !v.projectId} onClick={() => run(() => hse.post('/esg/readings/pull', { projectId: Number(v.projectId), period: date.slice(0, 7) }), t('esg.pulled'))} data-testid="hse-esg-pull">{t('esg.pull')}</button></div></div>
      <ListReport listCode="hse.esg_readings" endpoint="/hse/esg/readings" exportEndpoint="/ui/lists/hse.esg_readings/export" title={t('esg.readings')} session={session.data} cardFields={['date', 'metric', 'value', 'breached']} dateKey="date" empty={{ title: t('esg.emptyTitle'), text: t('esg.emptyBody') }} />
    </section>
  );
}
export function WastePage() {
  const t = useT('hse'); usePageTitle(t('esg.waste')); const session = useSession(); const { error, run, busy, note } = useRunner(); const [v, setV] = useState({ projectId: '', siteId: '' }); const [f, setF] = useState({ wasteDate: today(), category: 'CONCRETE', qtyKg: '', disposalMethod: 'RECYCLED', vendorId: '', manifestNo: '' });
  const oq = useQuery({ queryKey: ['hse', 'waste-options'], queryFn: () => hse.get('/esg/waste/options'), retry: false });
  return (
    <section aria-labelledby="ws-h" data-testid="hse-waste"><PageHeader id="ws-h" title={t('esg.waste')} subtitle={t('esg.wasteIntro')} />
      {oq.data && <details className="mdm-panel no-print" data-testid="hse-waste-form"><summary>{t('esg.newWaste')}</summary><ErrorLine error={error} id="hse-waste-error" />{note && <p className="mdm-banner" role="status" data-testid="hse-waste-note">{note}</p>}
        <div className="form-grid"><ProjectSite o={oq.data} v={v} set={setV} error={error} /><Field label={t('esg.date')} name="wasteDate" error={error}><input type="date" max={today()} value={f.wasteDate} onChange={(e) => setF({ ...f, wasteDate: e.target.value })} style={big} /></Field>
          <Field label={t('esg.category')} name="category" error={error}><select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} style={big} data-testid="hse-waste-category">{oq.data.categories.map((c) => <option key={c.id} value={c.id}>{t(`wc.${c.id}`)}</option>)}</select></Field>
          <Field label={t('esg.qtyKg')} name="qtyKg" error={error}><input type="number" min="0" step="any" inputMode="decimal" value={f.qtyKg} onChange={(e) => setF({ ...f, qtyKg: e.target.value })} style={big} data-testid="hse-waste-qty" /></Field>
          <Field label={t('esg.disposal')} name="disposalMethod" error={error}><select value={f.disposalMethod} onChange={(e) => setF({ ...f, disposalMethod: e.target.value })} style={big} data-testid="hse-waste-disposal">{oq.data.disposals.map((c) => <option key={c.id} value={c.id}>{t(`wd.${c.id}`)}</option>)}</select></Field>
          <Field label={t('esg.vendor')} name="vendorId" error={error}><select value={f.vendorId} onChange={(e) => setF({ ...f, vendorId: e.target.value })} style={big} data-testid="hse-waste-vendor"><option value="">—</option>{oq.data.vendors.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
          <Field label={t('esg.manifest')} name="manifestNo" error={error}><input value={f.manifestNo} onChange={(e) => setF({ ...f, manifestNo: e.target.value })} style={big} data-testid="hse-waste-manifest" /></Field></div>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy || !v.siteId || !f.qtyKg} onClick={() => run(() => hse.make('/esg/waste', { projectId: Number(v.projectId), siteId: Number(v.siteId), wasteDate: f.wasteDate, category: f.category, qtyKg: Number(f.qtyKg), disposalMethod: f.disposalMethod, vendorId: f.vendorId ? Number(f.vendorId) : null, manifestNo: f.manifestNo || null }), t('esg.wasteSaved'))} data-testid="hse-waste-save">{t('save')}</button></div></details>}
      <ListReport listCode="hse.esg_waste" endpoint="/hse/esg/waste" exportEndpoint="/ui/lists/hse.esg_waste/export" title={t('esg.waste')} session={session.data} cardFields={['date', 'category', 'qty', 'disposal']} dateKey="date" empty={{ title: t('esg.wasteEmptyTitle'), text: t('esg.wasteEmptyBody') }} />
    </section>
  );
}
export function CarbonPage() {
  const t = useT('hse'); usePageTitle(t('esg.carbon')); const [from, setFrom] = useState(`${thisMonth().slice(0, 4)}-01`); const [to, setTo] = useState(thisMonth());
  const q = useQuery({ queryKey: ['hse', 'esg-carbon', from, to], queryFn: () => hse.get(`/esg/carbon${qs({ from, to })}`), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('esg.carbon')} permission="hse.esg.view" />; if (q.isPending) return <Skeleton label={t('esg.carbon')} rows={4} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />; const d = q.data;
  return (
    <section aria-labelledby="cb-h" data-testid="hse-carbon"><PageHeader id="cb-h" title={t('esg.carbon')} subtitle={t('esg.carbonIntro')} /><Period from={from} to={to} setFrom={setFrom} setTo={setTo} />
      <div className="actions-row no-print"><button type="button" className="btn" onClick={() => hse.exportFile(`/esg/carbon/export${qs({ from, to })}`, 'carbon.csv').catch(() => globalThis.alert?.(t('exportFailed')))} data-testid="hse-carbon-csv">{t('export')}</button><button type="button" className="btn" onClick={() => hse.exportFile(`/esg/carbon/pdf${qs({ from, to })}`, 'carbon.pdf').catch(() => globalThis.alert?.(t('exportFailed')))}>{t('print')}</button></div>
      <p data-testid="hse-carbon-total">{t('esg.totalLine', { t: d.totalTonnes, s1: d.byScope[0].tonnes, s2: d.byScope[1].tonnes, s3: d.byScope[2].tonnes })}</p>{d.missingFactors.length > 0 && <p className="field-error" role="alert">{t('esg.missingFactors', { m: d.missingFactors.join(', ') })}</p>}
      {d.lines.length === 0 ? <div className="empty-state" data-testid="hse-carbon-empty"><h2>{t('esg.emptyTitle')}</h2><p>{t('esg.emptyBody')}</p></div> : <div className="table-scroll"><table className="data-table" data-testid="hse-carbon-table"><thead><tr><th>{t('esg.metric')}</th><th>{t('esg.month')}</th><th>{t('esg.activity')}</th><th>{t('esg.scope')}</th><th>{t('esg.factor')}</th><th>kg CO2e</th></tr></thead><tbody>{d.lines.map((l, i) => <tr key={i} data-testid="hse-carbon-row"><td>{l.label}</td><td>{l.period}</td><td>{num(l.activity)} {l.uom}</td><td>{l.scope}</td><td>{l.factor == null ? <StatusBadge status="REJECTED" label={t('esg.noFactor')} /> : `${l.factor} (v${l.factorVersion})`}</td><td>{num(l.kgCo2e)}</td></tr>)}</tbody></table></div>}
    </section>
  );
}
export function ConsentsPage() {
  const t = useT('hse'); usePageTitle(t('esg.consents')); const session = useSession(); const { error, run, busy, note } = useRunner(); const [v, setV] = useState({ projectId: '', siteId: '' }); const [f, setF] = useState({ permitType: 'CTE', permitNo: '', authority: '', validFrom: today(), validUntil: '' });
  const oq = useQuery({ queryKey: ['hse', 'esg-options'], queryFn: () => hse.get('/esg/readings/options'), retry: false });
  return (
    <section aria-labelledby="cn-h" data-testid="hse-consents"><PageHeader id="cn-h" title={t('esg.consents')} subtitle={t('esg.consentIntro')} />
      {oq.data && <details className="mdm-panel no-print" data-testid="hse-consent-form"><summary>{t('esg.newConsent')}</summary><ErrorLine error={error} id="hse-consent-error" />{note && <p className="mdm-banner" role="status" data-testid="hse-consent-note">{note}</p>}
        <div className="form-grid"><ProjectSite o={oq.data} v={v} set={setV} error={error} siteOptional /><Field label={t('esg.consentType')} name="permitType" error={error}><select value={f.permitType} onChange={(e) => setF({ ...f, permitType: e.target.value })} style={big}>{['CTE', 'CTO', 'HAZARDOUS_WASTE', 'GROUNDWATER', 'OTHER'].map((x) => <option key={x} value={x}>{t(`cons.${x}`)}</option>)}</select></Field>
          <Field label={t('esg.number')} name="permitNo" error={error}><input value={f.permitNo} onChange={(e) => setF({ ...f, permitNo: e.target.value })} style={big} data-testid="hse-consent-no" /></Field><Field label={t('esg.authority')} name="authority" error={error}><input value={f.authority} onChange={(e) => setF({ ...f, authority: e.target.value })} style={big} data-testid="hse-consent-authority" /></Field>
          <Field label={t('esg.validFrom')} name="validFrom" error={error}><input type="date" value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} style={big} /></Field><Field label={t('esg.validUntil')} name="validUntil" error={error}><input type="date" value={f.validUntil} onChange={(e) => setF({ ...f, validUntil: e.target.value })} style={big} data-testid="hse-consent-until" /></Field></div>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy || !v.projectId || !f.permitNo || !f.authority || !f.validUntil} onClick={() => run(() => hse.make('/esg/consents', { projectId: Number(v.projectId), siteId: v.siteId ? Number(v.siteId) : null, permitType: f.permitType, permitNo: f.permitNo, authority: f.authority, validFrom: f.validFrom, validUntil: f.validUntil }), t('esg.consentSaved'))} data-testid="hse-consent-save">{t('save')}</button></div></details>}
      <ListReport listCode="hse.esg_consents" endpoint="/hse/esg/consents" exportEndpoint="/ui/lists/hse.esg_consents/export" title={t('esg.consents')} session={session.data} cardFields={['type', 'number', 'validUntil', 'status']} dateKey="validUntil" empty={{ title: t('esg.consentEmptyTitle'), text: t('esg.consentEmptyBody') }} />
    </section>
  );
}
export function FactorsPage() {
  const t = useT('hse'); usePageTitle(t('esg.factors')); const session = useSession(); const { error, run, busy, note } = useRunner(); const [f, setF] = useState({ metric: 'ELECTRICITY', scope: 2, factor: '', unit: '', source: '', effectiveFrom: today() });
  const act = (kind) => (r) => (kind === 'activate' ? r.can?.activate : r.can?.retire) ? [{ key: kind, label: t(`esg.${kind}`), onSelect: () => run(() => hse.post(`/esg/factors/${r.id}/${kind}`, {}), t(`esg.${kind}d`)) }] : [];
  return (
    <section aria-labelledby="fc-h" data-testid="hse-factors"><PageHeader id="fc-h" title={t('esg.factors')} subtitle={t('esg.factorIntro')} /><ErrorLine error={error} id="hse-factor-error" />{note && <p className="mdm-banner" role="status" data-testid="hse-factor-note">{note}</p>}
      <details className="mdm-panel no-print" data-testid="hse-factor-form"><summary>{t('esg.newFactor')}</summary><div className="form-grid"><Field label={t('esg.metric')} name="metric" error={error}><select value={f.metric} onChange={(e) => setF({ ...f, metric: e.target.value })} style={big} data-testid="hse-factor-metric">{['ELECTRICITY', 'FUEL_DIESEL', 'WATER', 'CEMENT', 'STEEL'].map((m) => <option key={m} value={m}>{t(`esgm.${m}`)}</option>)}</select></Field>
        <Field label={t('esg.scope')} name="scope" error={error}><select value={f.scope} onChange={(e) => setF({ ...f, scope: Number(e.target.value) })} style={big}>{[1, 2, 3].map((s) => <option key={s} value={s}>{s}</option>)}</select></Field><Field label={t('esg.factor')} name="factor" error={error}><input type="number" min="0" step="any" value={f.factor} onChange={(e) => setF({ ...f, factor: e.target.value })} style={big} data-testid="hse-factor-value" /></Field>
        <Field label={t('esg.unit')} name="unit" error={error}><input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder="kgCO2e/kWh" style={big} data-testid="hse-factor-unit" /></Field><Field label={t('esg.source')} name="source" error={error}><input value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} style={big} data-testid="hse-factor-source" /></Field><Field label={t('esg.effectiveFrom')} name="effectiveFrom" error={error}><input type="date" value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} style={big} /></Field></div>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy || f.factor === '' || !f.unit || f.source.length < 3} onClick={() => run(() => hse.make('/esg/factors', { ...f, factor: Number(f.factor) }), t('esg.factorSaved'))} data-testid="hse-factor-save">{t('save')}</button></div></details>
      <ListReport listCode="hse.esg_factors" endpoint="/hse/esg/factors" exportEndpoint="/ui/lists/hse.esg_factors/export" title={t('esg.factors')} session={session.data} cardFields={['metric', 'factor', 'version', 'status']} statusKey="status" rowActions={(r) => [...act('activate')(r), ...act('retire')(r)]} empty={{ title: t('esg.factorEmptyTitle'), text: t('esg.factorEmptyBody') }} />
    </section>
  );
}
