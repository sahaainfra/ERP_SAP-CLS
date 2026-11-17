import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import Chart from '../../platform/charts/Chart.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, Tile, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { fmtQty, st, today } from './api.js';
import { useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { KpiRow } from '../../platform/design/Kpi.jsx';

// Weather Log (part 14.03, FR-01): one record a site and day, typed or fetched through the integration hub, with the hours lost, the shutdown and the concrete-pour restriction (worked out by the server),
// the delay draft a shutdown raised, and the rainfall by month. A record opens from the list for change; the chart and its table follow the site and the year.
const blank = (siteId = null, date = today()) => ({ siteId, date, rainfallMm: '', tempMin: '', tempMax: '', humidityPct: '', windKmh: '', hoursLost: '', shutdown: false, shutdownReason: '', notes: '' });
const num = (v) => (v === '' || v == null ? null : Number(v));
const fromRecord = (w) => ({ siteId: w.siteId, date: w.date, rainfallMm: w.rainfallMm ?? '', tempMin: w.tempMin ?? '', tempMax: w.tempMax ?? '', humidityPct: w.humidityPct ?? '', windKmh: w.windKmh ?? '', hoursLost: w.hoursLost || '', shutdown: w.shutdown, shutdownReason: w.shutdownReason ?? '', notes: w.notes ?? '' });
const body = (f, withKey) => ({ ...(withKey ? { siteId: f.siteId, date: f.date } : {}), rainfallMm: num(f.rainfallMm), tempMin: num(f.tempMin), tempMax: num(f.tempMax), humidityPct: num(f.humidityPct), windKmh: num(f.windKmh), hoursLost: num(f.hoursLost) ?? 0, shutdown: f.shutdown, shutdownReason: f.shutdown ? f.shutdownReason.trim() || null : null, notes: f.notes.trim() || null });

function Form({ t, sites, editing, onDone }) {
  const [f, setF] = useState(editing ? fromRecord(editing) : blank(sites.length === 1 ? sites[0].id : null));
  const [error, setError] = useState(null); const [busy, setBusy] = useState(false); const [note, setNote] = useState(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const site = sites.find((s) => s.id === f.siteId); const may = editing ? editing.can.edit : site?.canCreate;
  useEffect(() => { if (!editing && sites.length === 1 && !f.siteId) set('siteId', sites[0].id); }, [sites, editing, f.siteId]);
  const run = async (fn, done) => { setError(null); setNote(null); setBusy(true); try { const w = await fn(); setNote(done(w)); onDone(w); return w; } catch (e) { setError(errorInfo(e)); return null; } finally { setBusy(false); } };
  const summary = (w) => `${t('cnd.saved')} ${w.conditionLabel ? `${t('cnd.condition')}: ${w.conditionLabel}.` : ''} ${w.pourRestricted ? t('cnd.pourNo', { r: w.pourReason }) : t('cnd.pourOk')}${w.delay ? ` ${t('cnd.delayMade', { n: w.delay.docNo })}` : w.delayDrafting ? ` ${t('cnd.delayQueued')}` : ''}`;
  const save = (e) => { e.preventDefault(); if (!f.siteId) { setError({ form: t('f.chooseSite'), fields: { siteId: t('f.chooseSite') } }); return; } run(() => (editing ? st.updateWeather(editing.id, { ...body(f, false), rowVersion: editing.rowVersion }) : st.createWeather(body(f, true))), summary); };
  const fetchIt = () => { if (!f.siteId) { setError({ form: t('f.chooseSite'), fields: {} }); return; } run(() => st.fetchWeather({ siteId: f.siteId, date: f.date }), summary).then((w) => { if (w) setF(fromRecord(w)); }); };
  return (
    <form className="mdm-panel" onSubmit={save} aria-label={editing ? t('cnd.wx.edit') : t('cnd.wx.new')} data-testid="wx-form">
      <h2>{editing ? t('cnd.wx.edit') : t('cnd.wx.new')}</h2>
      <div className="form-grid">
        <Field label={t('f.site')} name="siteId" error={error}><select value={f.siteId ?? ''} disabled={Boolean(editing)} onChange={(e) => set('siteId', e.target.value ? Number(e.target.value) : null)} data-testid="wx-site"><option value="">{t('f.chooseSite')}</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.projectCode} · {s.code} {s.name}</option>)}</select></Field>
        <Field label={t('f.date')} name="date" error={error}><input type="date" value={f.date} max={today()} disabled={Boolean(editing)} onChange={(e) => e.target.value && set('date', e.target.value)} data-testid="wx-date" /></Field>
        <Field label={t('cnd.rain')} name="rainfallMm" error={error}><input type="number" min="0" step="0.1" inputMode="decimal" value={f.rainfallMm} onChange={(e) => set('rainfallMm', e.target.value)} data-testid="wx-rain" /></Field>
        <Field label={t('cnd.tempMin')} name="tempMin" error={error}><input type="number" step="0.1" inputMode="decimal" value={f.tempMin} onChange={(e) => set('tempMin', e.target.value)} data-testid="wx-tmin" /></Field>
        <Field label={t('cnd.tempMax')} name="tempMax" error={error}><input type="number" step="0.1" inputMode="decimal" value={f.tempMax} onChange={(e) => set('tempMax', e.target.value)} data-testid="wx-tmax" /></Field>
        <Field label={t('cnd.humidity')} name="humidityPct" error={error}><input type="number" min="0" max="100" step="1" inputMode="numeric" value={f.humidityPct} onChange={(e) => set('humidityPct', e.target.value)} data-testid="wx-hum" /></Field>
        <Field label={t('cnd.wind')} name="windKmh" error={error}><input type="number" min="0" step="0.1" inputMode="decimal" value={f.windKmh} onChange={(e) => set('windKmh', e.target.value)} data-testid="wx-wind" /></Field>
        <Field label={t('cnd.hoursLost')} name="hoursLost" error={error}><input type="number" min="0" max="24" step="0.5" inputMode="decimal" value={f.hoursLost} onChange={(e) => set('hoursLost', e.target.value)} data-testid="wx-hours" /></Field>
      </div>
      <label className="field"><input type="checkbox" checked={f.shutdown} onChange={(e) => set('shutdown', e.target.checked)} data-testid="wx-shutdown" /> <span>{t('cnd.shutdown')}</span></label>
      {f.shutdown && <Field label={t('cnd.shutdownReason')} name="shutdownReason" error={error}><input value={f.shutdownReason} maxLength={500} onChange={(e) => set('shutdownReason', e.target.value)} data-testid="wx-reason" /></Field>}
      <Field label={t('cnd.notes')} name="notes" error={error}><input value={f.notes} maxLength={1000} onChange={(e) => set('notes', e.target.value)} /></Field>
      {error?.form && <p className="field-error" role="alert" data-testid="wx-error">{error.form}{error.correlationId ? ` (${error.correlationId})` : ''}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="wx-note">{note}</p>}
      <div className="actions-row">
        {may !== false && <button type="submit" className="btn btn-primary" disabled={busy} data-testid="wx-save">{t('act.save')}</button>}
        {!editing && site?.canCreate && <button type="button" className="btn" disabled={busy} onClick={fetchIt} data-testid="wx-fetch">{t('cnd.fetch')}</button>}
        {editing?.can.delete && <button type="button" className="btn" disabled={busy} onClick={async () => { if (window.confirm(t('cnd.wx.deleteAsk'))) { setBusy(true); try { await st.removeWeather(editing.id); onDone(null); } catch (e) { setError(errorInfo(e)); } finally { setBusy(false); } } }}>{t('act.delete')}</button>}
        {editing && <button type="button" className="btn" onClick={() => onDone(null)}>{t('cnd.close')}</button>}
      </div>
      {editing && editing.delay && <p className="muted">{t('cnd.delayLink')} <Link to={`/plan/delays?id=${editing.delay.id}`}>{editing.delay.docNo}</Link> ({editing.delay.status})</p>}
    </form>
  );
}

export default function WeatherPage() {
  const t = useT('site'); usePageTitle(t('cnd.wx.title'));
  const sp = useSearch(); const id = Number(sp.get('id')) || null; const qc = useQueryClient(); const session = useSession(); const perms = session.data?.permissions ?? [];
  const sitesQ = useQuery({ queryKey: ['site', 'wx-sites'], queryFn: st.wxSites, retry: false });
  const [year, setYear] = useState(Number(today().slice(0, 4))); const [siteId, setSiteId] = useState('');
  const qs = useMemo(() => new URLSearchParams({ year: String(year), ...(siteId ? { siteId } : {}) }).toString(), [year, siteId]);
  const mq = useQuery({ queryKey: ['site', 'wx-monthly', qs], queryFn: () => st.wxMonthly(qs), retry: false });
  const rq = useQuery({ queryKey: ['site', 'wx', id], queryFn: () => st.weather(id), enabled: Boolean(id), retry: false });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['site'] }); qc.invalidateQueries({ queryKey: ['list'] }); };
  if (sitesQ.error?.status === 403 || mq.error?.status === 403) return <NoPermission what={t('cnd.wx.title')} permission="site.weather.view" />;
  if (sitesQ.isPending) return <Skeleton label={t('cnd.wx.title')} rows={5} />;
  if (sitesQ.isError) return <ErrorState error={sitesQ.error} onRetry={sitesQ.refetch} />;
  const sites = sitesQ.data; const m = mq.data; const canCreate = perms.includes('site.weather.create');
  return (
    <section aria-labelledby="wx-h" data-testid="site-weather">
      <PageHeader id="wx-h" title={t('cnd.wx.title')} subtitle={t('cnd.wx.intro')} />
      {id && rq.isPending && <Skeleton label={t('cnd.wx.edit')} rows={3} />}
      {id && rq.isError && <ErrorState error={rq.error} onRetry={rq.refetch} />}
      {(canCreate || rq.data) && (!id || rq.data) && <Form key={rq.data ? `e${rq.data.id}-${rq.data.rowVersion}` : 'new'} t={t} sites={sites} editing={rq.data ?? null} onDone={(w) => { refresh(); if (!w || rq.data) navigateTo('/site/weather'); }} />}
      <div className="mdm-panel" data-testid="wx-chart-panel">
        <h2>{t('cnd.wx.byMonth')}</h2>
        <div className="form-grid no-print">
          <Field label={t('f.site')} name="chartSite"><select value={siteId} onChange={(e) => setSiteId(e.target.value)} data-testid="wx-chart-site"><option value="">{t('dpr.allSites')}</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.projectCode} · {s.code}</option>)}</select></Field>
          <Field label={t('cnd.year')} name="year"><input type="number" min="2000" max="2100" value={year} onChange={(e) => e.target.value && setYear(Number(e.target.value))} data-testid="wx-year" /></Field>
        </div>
        {mq.isPending && <Skeleton label={t('cnd.wx.byMonth')} rows={3} />}
        {mq.isError && mq.error?.status !== 403 && <ErrorState error={mq.error} onRetry={mq.refetch} />}
        {m && (
          <>
            <KpiRow data-testid="wx-tiles">
              <Tile label={t('cnd.totalRain')} value={`${fmtQty(m.totals.rainfallMm)} mm`} testId="wx-total-rain" /><Tile label={t('cnd.daysRecorded')} value={m.totals.days} testId="wx-total-days" />
              <Tile label={t('cnd.shutdownDays')} value={m.totals.shutdownDays} status={m.totals.shutdownDays ? 'warning' : 'success'} testId="wx-total-shut" /><Tile label={t('cnd.totalHoursLost')} value={fmtQty(m.totals.hoursLost)} status={m.totals.hoursLost ? 'warning' : 'success'} testId="wx-total-lost" />
            </KpiRow>
            {m.totals.days === 0 ? <p className="muted" data-testid="wx-chart-empty">{t('cnd.wx.noData', { y: year })}</p> : (
              <Chart type="bar" data={{ categories: m.months.map((x) => x.month.slice(5)), series: [{ name: t('cnd.rain'), values: m.months.map((x) => x.rainfallMm) }] }} title={t('cnd.wx.byMonth')} />
            )}
            <div className="table-scroll"><table className="data-table" data-testid="wx-month-table"><caption className="sr-only">{t('cnd.wx.byMonth')}</caption>
              <thead><tr><th>{t('cnd.month')}</th><th className="num">{t('cnd.rain')}</th><th className="num">{t('cnd.rainyDays')}</th><th className="num">{t('cnd.hoursLost')}</th><th className="num">{t('cnd.shutdownDays')}</th><th className="num">{t('cnd.pourDays')}</th></tr></thead>
              <tbody>{m.months.map((x) => <tr key={x.month} data-testid="wx-month-row"><td>{x.month}</td><td className="num">{fmtQty(x.rainfallMm)}</td><td className="num">{x.rainyDays}</td><td className="num">{fmtQty(x.hoursLost)}</td><td className="num">{x.shutdownDays}</td><td className="num">{x.pourRestrictedDays}</td></tr>)}</tbody></table></div>
          </>
        )}
      </div>
      <ListReport listCode="site.weather" endpoint="/site/weather" title={t('cnd.wx.title')} session={session.data} rowHref={(r) => `/site/weather?id=${r.id}`} onOpen={(r) => navigateTo(`/site/weather?id=${r.id}`)}
        cardFields={['date', 'site', 'rainfall', 'shutdown']}
        empty={{ title: t('cnd.wx.emptyTitle'), text: t('cnd.wx.emptyBody') }} />
      <p className="muted small">{t('cnd.links')} <Link to="/site/hindrances">{t('cnd.hin.title')}</Link> · <Link to="/site/diary">{t('cnd.diary.title')}</Link> · <Link to="/site/dprs">{t('dpr.register')}</Link></p>
    </section>
  );
}
