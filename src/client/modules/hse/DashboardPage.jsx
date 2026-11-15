import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, usePageTitle } from '../core/pages/ui.jsx';
import { fmtDate, hse, qs } from './api.js';
import { ErrorLine, big, today, useRunner } from './HseParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// HSE Dashboard (part 19.08, FR-01 to FR-03): the lagging and leading indicators with value, target and colour, the safe man-hours counter, the trend by month, the comparison of sites, the exceptions and the monthly report. Every tile opens the list behind it.
const TONE = { green: 'APPROVED', amber: 'RETURNED', red: 'REJECTED', neutral: 'DRAFT' }; const nf = new Intl.NumberFormat('en-IN');
const fmt = (n) => (n == null ? '—' : nf.format(n));
function Trend({ rows, field, label }) {
  const vals = rows.map((m) => m[field]); const max = Math.max(1, ...vals.map((v) => v ?? 0)); const w = 480; const h = 120; const bw = w / Math.max(1, rows.length);
  return (
    <figure data-testid={`hse-trend-${field}`}><figcaption>{label}</figcaption>
      <svg viewBox={`0 0 ${w} ${h + 18}`} role="img" aria-label={label} style={{ width: '100%', maxWidth: 560, height: 'auto' }}>
        {rows.map((m, i) => { const v = m[field] ?? 0; const bh = Math.round((v / max) * h); return <g key={m.month}><rect x={i * bw + 3} y={h - bh} width={bw - 6} height={bh} fill="currentColor" opacity="0.65"><title>{`${m.month}: ${m[field] ?? '—'}`}</title></rect><text x={i * bw + bw / 2} y={h + 13} fontSize="9" textAnchor="middle" fill="currentColor">{m.month.slice(5)}</text></g>; })}
      </svg>
    </figure>
  );
}
export default function DashboardPage() {
  const t = useT('hse'); usePageTitle(t('kpi.title')); const { error, run, busy } = useRunner(); const [f, setF] = useState({ projectId: '', siteId: '', from: '', to: '' }); const [month, setMonth] = useState(today().slice(0, 7));
  const query = qs(f); const q = useQuery({ queryKey: ['hse', 'dashboard', query], queryFn: () => hse.get(`/dashboard${query}`), retry: false, placeholderData: (p) => p });
  if (q.error?.status === 403) return <NoPermission what={t('kpi.title')} permission="hse.dashboard.view" />; if (q.isPending) return <Skeleton label={t('kpi.title')} rows={6} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data; const set = (k, v) => setF((s) => ({ ...s, [k]: v, ...(k === 'projectId' ? { siteId: '' } : {}) })); const sites = d.filters.sites.filter((s) => !f.projectId || String(s.projectId) === String(f.projectId));
  const tile = (k) => (
    <div className="mdm-panel" key={k.key} data-testid={`hse-kpi-${k.key}`} data-status={k.status}><div className="muted">{t(`kpi.t.${k.key}`)}</div>
      <strong style={{ fontSize: '1.8rem' }} data-testid={`hse-kpi-${k.key}-value`}>{k.value == null ? '—' : `${nf.format(k.value)}${k.unit}`}</strong>
      <div><StatusBadge status={TONE[k.status]} label={t(`kpi.st.${k.status}`)} /></div>
      <div className="muted">{k.target != null ? t('kpi.target', { n: k.target }) : ''}{k.note ? `${k.target != null ? ' · ' : ''}${t(`kpi.note.${k.note.k}`, { n: k.note.n ?? 0, m: k.note.m ?? 0 })}` : ''}</div>
      {k.drill && <div><Link to={k.drill}>{t('kpi.open')}</Link></div>}</div>
  );
  const report = () => run(() => hse.exportFile(`/dashboard/report${qs({ month, projectId: f.projectId, siteId: f.siteId })}`, `hse-report-${month}.pdf`), null);
  return (
    <section aria-labelledby="hd-h" data-testid="hse-dashboard"><PageHeader id="hd-h" title={t('kpi.title')} /><p className="muted" data-testid="hse-dash-period">{t('kpi.period', { from: fmtDate(d.period.from), to: fmtDate(d.period.to), base: nf.format(d.rateBase) })}</p>
      <ErrorLine error={error} id="hse-error" />
      <div className="mdm-panel no-print" data-testid="hse-dash-filters"><div className="form-grid">
        <Field label={t('project')} name="projectId" error={null}><select value={f.projectId} onChange={(e) => set('projectId', e.target.value)} style={big} data-testid="hse-dash-project"><option value="">{t('kpi.allProjects')}</option>{d.filters.projects.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></Field>
        <Field label={t('site')} name="siteId" error={null}><select value={f.siteId} onChange={(e) => set('siteId', e.target.value)} style={big} data-testid="hse-dash-site"><option value="">{t('kpi.allSites')}</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.code} {s.name}</option>)}</select></Field>
        <Field label={t('cmp.from')} name="from" error={null}><input type="date" value={f.from} onChange={(e) => set('from', e.target.value)} style={big} data-testid="hse-dash-from" /></Field>
        <Field label={t('cmp.to')} name="to" error={null}><input type="date" value={f.to} onChange={(e) => set('to', e.target.value)} style={big} data-testid="hse-dash-to" /></Field></div>
        <div className="actions-row">
          {d.can.export && <button type="button" className="btn" onClick={() => hse.exportFile(`/dashboard/export${qs({ ...f, kind: 'kpis' })}`, 'hse-kpis.csv').catch(() => globalThis.alert?.(t('exportFailed')))} data-testid="hse-dash-export">{t('kpi.export')}</button>}
          {d.can.report && <><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={big} aria-label={t('kpi.reportMonth')} data-testid="hse-dash-month" />
            <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={report} data-testid="hse-dash-report">{t('kpi.report')}</button></>}</div></div>
      <div className="mdm-panel" data-testid="hse-safe-hours"><h2>{t('kpi.safeTitle')}</h2><strong style={{ fontSize: '2.2rem' }} data-testid="hse-safe-value">{fmt(d.lagging.safe.manHours)}</strong> {t('kpi.hours')}
        <p className="muted">{d.lagging.safe.lastLtiDate ? t('kpi.lastLti', { date: fmtDate(d.lagging.safe.lastLtiDate), days: d.lagging.safe.days }) : t('kpi.noLti')}</p></div>
      <h2>{t('kpi.lagging')}</h2><div className="form-grid" data-testid="hse-dash-lagging">{d.tiles.filter((k) => k.group === 'lagging').map(tile)}</div>
      <h2>{t('kpi.leading')}</h2><div className="form-grid" data-testid="hse-dash-leading">{d.tiles.filter((k) => k.group === 'leading').map(tile)}</div>
      <div className="mdm-panel" data-testid="hse-dash-exceptions"><h2>{t('kpi.exceptions')}</h2>{d.exceptions.length === 0 ? <p className="muted">{t('kpi.noExceptions')}</p> : <ul>{d.exceptions.map((e) => <li key={e.key} data-testid="hse-dash-exception" data-tone={e.tone}><Link to={e.drill}>{t(`kpi.exc.${e.key}`, { n: e.count })}</Link></li>)}</ul>}
        <p data-testid="hse-dash-pending">{t('kpi.pending', { n: d.pending })} <Link to="/approvals">{t('kpi.approvals')}</Link></p></div>
      <div className="mdm-panel" data-testid="hse-dash-trend"><h2>{t('kpi.trend')}</h2><div className="form-grid"><Trend rows={d.trend} field="ltifr" label={t('kpi.t.ltifr')} /><Trend rows={d.trend} field="trir" label={t('kpi.t.trir')} /><Trend rows={d.trend} field="manHours" label={t('kpi.t.manHours')} /></div>
        <div className="table-scroll"><table className="data-table" data-testid="hse-trend-table"><caption>{t('kpi.trend')}</caption><thead><tr><th>{t('kpi.month')}</th><th className="num">{t('kpi.t.manHours')}</th><th className="num">{t('kpi.lti')}</th><th className="num">{t('kpi.t.ltifr')}</th><th className="num">{t('kpi.t.trir')}</th></tr></thead><tbody>{d.trend.map((m) => <tr key={m.month}><td>{m.month}</td><td className="num">{fmt(m.manHours)}</td><td className="num">{m.lti}</td><td className="num">{fmt(m.ltifr)}</td><td className="num">{fmt(m.trir)}</td></tr>)}</tbody></table></div></div>
      <div className="table-scroll"><table className="data-table" data-testid="hse-dash-sites"><caption>{t('kpi.sites')}</caption><thead><tr><th>{t('site')}</th><th>{t('project')}</th><th className="num">{t('kpi.t.manHours')}</th><th className="num">{t('kpi.lti')}</th><th className="num">{t('kpi.t.ltifr')}</th><th className="num">{t('kpi.t.trir')}</th><th className="num">{t('kpi.openObs')}</th><th className="num">{t('kpi.permits')}</th></tr></thead>
        <tbody>{d.sites.map((s) => <tr key={s.siteId} data-testid="hse-dash-site-row"><td><Link to={s.drill}>{s.site} {s.siteName}</Link></td><td>{s.project}</td><td className="num">{fmt(s.manHours)}</td><td className="num">{s.lti}</td><td className="num">{fmt(s.ltifr)}</td><td className="num">{fmt(s.trir)}</td><td className="num">{s.openObservations}</td><td className="num">{s.activePermits}</td></tr>)}</tbody></table></div>
    </section>
  );
}
