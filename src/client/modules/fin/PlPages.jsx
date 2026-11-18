import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import Chart from '../../platform/charts/Chart.jsx';
import { EmptyState } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from '../site/parts.jsx';
import { JN_TONE, gl, money, pl } from './api.js';
import { GlError, useGlRunner } from './JournalsPage.jsx';
import { Decide, Pills, Rows, big, fyStartOf, guardOf, istToday, lastMonth, pct } from './finparts.jsx';

// Part 23.12: the project P&L (the month, the year, to date, budget and forecast side by side; margins; drill-down to the journal lines; the snapshot of
// the month and its freeze) and the profitability overview (KPIs, the ranking, sector, region and client, the loss-making projects).
const amt = (v, t) => (v == null ? t('pl.masked') : money(v));

function Snapshot({ id }) {
  const t = useT('pl'); const q = useQuery({ queryKey: ['gl', 'pls', id], queryFn: () => pl.snapshot(id), retry: false }); const { error, note, busy, run } = useGlRunner(); usePageTitle(t('pl.snapshot'));
  const g = guardOf(q, t('pl.snapshot'), 'fin.pl_snapshot.view'); if (g) return g; const x = q.data; const c = x.can;
  return (<section aria-labelledby="pls-h" data-testid="pl-snapshot" data-status={x.status}>
    <PageHeader id="pls-h" title={`${x.docNo} · ${x.project}`} subtitle={`${t('pl.month')} ${x.period}`} meta={<StatusBadge status={JN_TONE[x.status] ?? 'CANCELLED'} label={x.frozenAt ? t('pl.frozen') : t(`pl.st.${x.status}`)} />} />
    <p><Link to={`/finance/project-pl?projectId=${x.projectId}&period=${x.period}`}>{t('pl.back')}</Link></p>
    <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
    <KpiRow label={t('pl.snapshot')}><KpiTile label={t('pl.revenue')} value={money(x.revenue)} amount={x.revenue} kind="money" /><KpiTile label={t('pl.grossProfit')} value={money(x.grossProfit)} amount={x.grossProfit} kind="money" /><KpiTile label={t('pl.operatingProfit')} value={amt(x.operatingProfit, t)} /><KpiTile label={t('pl.reconciled')} value={x.reconciled ? t('pl.equal') : t('pl.notEqual')} valueTestid="pl-snap-recon" /></KpiRow>
    <ul className="lp-list">{x.lines.map((l) => <li key={l.code} className="mdm-panel" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: 12, margin: '6px 0', flexWrap: 'wrap', fontWeight: l.subtotal ? 700 : 400 }}><span>{l.name}</span><span className="num">{amt(l.amount, t)}{l.pct != null ? ` · ${pct(l.pct)}` : ''} · {t('pl.toDate')} {amt(l.cumulative, t)}</span></li>)}</ul>
    <Decide x={x} run={run} busy={busy} t={t} p="pl" testid="pl-decide" />
    <div className="actions-row ff-actionbar">
      {c.recompute && <button type="button" className="btn" style={big} disabled={busy} onClick={() => run(() => pl.act(x.id, 'recompute'), t('pl.recomputed'))}>{t('pl.recompute')}</button>}
      {c.submit && <button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => pl.act(x.id, 'submit'), t('pl.sent'))} data-testid="pl-submit">{t('pl.submit')}</button>}
      <button type="button" className="btn" style={big} onClick={() => gl.file(`/pl-snapshots/${x.id}/print`, `${x.docNo.replaceAll('/', '-')}.pdf`).catch(() => globalThis.alert?.(t('pl.fileFailed')))}>{t('pl.print')}</button>
    </div>
    {x.history?.approvals?.length > 0 && <div className="mdm-panel"><h2>{t('pl.history')}</h2><ul className="lp-list">{x.history.approvals.map((h, i) => <li key={i} style={{ minHeight: 44 }}>{String(h.at).slice(0, 16).replace('T', ' ')} · {h.event}{h.step_code ? ` (${h.step_code})` : ''} · {h.actor}</li>)}</ul></div>}
  </section>);
}
function Drill({ projectId, line, period, onClose }) {
  const t = useT('pl'); const from = fyStartOf(`${period}-01`); const to = `${period}-${String(new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`; const q = useQuery({ queryKey: ['gl', 'pl-drill', projectId, line, period], queryFn: () => pl.drill({ projectId, line, from, to }), retry: false });
  const g = guardOf(q, t('pl.drill'), 'fin.pl.view');
  return (<div className="mdm-panel" data-testid="pl-drill"><h2>{t('pl.drillOf', { line: q.data?.name ?? line })}</h2>{g ?? (q.data.rows.length === 0 ? <EmptyState compact title={t('pl.noLines')} message={t('pl.noLinesBody')} /> : <ul className="lp-list">{q.data.rows.map((r, i) => <li key={i} style={{ display: 'grid', gap: 2, minHeight: 44 }}><span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}><strong>{r.voucherNo} · {r.date}</strong><span className="num">{r.debit ? `Dr ${money(r.debit)}` : `Cr ${money(r.credit)}`}</span></span><span className="muted small">{r.account} · {r.narration}{r.source ? ` · ${r.source}` : ''}</span></li>)}</ul>)}<div className="ff-actionbar"><button type="button" className="btn" style={big} onClick={onClose}>{t('pl.close')}</button></div></div>);
}
export function ProjectPlPage() {
  const t = useT('pl'); usePageTitle(t('pl.title')); const sp = useSearch(); const snap = Number(sp.get('snapshot')) || null;
  const [projectId, setProjectId] = useState(sp.get('projectId') ?? ''); const [period, setPeriod] = useState(sp.get('period') ?? lastMonth()); const [col, setCol] = useState('month'); const [drill, setDrill] = useState(null); const { error, note, busy, run } = useGlRunner();
  const pq = useQuery({ queryKey: ['gl', 'pl-projects'], queryFn: pl.projects, retry: false, enabled: !snap }); const q = useQuery({ queryKey: ['gl', 'pl', projectId, period], queryFn: () => pl.project({ projectId, period }), retry: false, enabled: Boolean(projectId) && !snap });
  if (snap) return <Snapshot id={snap} />;
  const x = q.data; const cols = x ? [['month', t('pl.c.month'), x.month], ['ytd', t('pl.c.ytd'), x.ytd], ['cumulative', t('pl.c.cumulative'), x.cumulative], ...(x.budget ? [['budget', t('pl.c.budget'), x.budget.lines]] : []), ...(x.forecast ? [['forecast', t('pl.c.forecast'), x.forecast.lines]] : [])] : []; const lines = cols.find((c) => c[0] === col)?.[2] ?? x?.month ?? [];
  return (<section aria-labelledby="pl-h" data-testid="pl-page"><PageHeader id="pl-h" title={t('pl.title')} subtitle={t('pl.intro')} meta={<Link to="/finance/profitability">{t('pf.title')}</Link>} />
    <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
    <div className="form-grid"><Field label={t('pl.project')} name="project" error={null}><select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={big} data-testid="pl-project"><option value="">{t('pl.choose')}</option>{(pq.data ?? []).map((p) => <option key={p.projectId} value={p.projectId}>{p.project}</option>)}</select></Field>
      <Field label={t('pl.month')} name="period" error={null}><input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} style={big} data-testid="pl-period" /></Field></div>
    {!projectId ? <EmptyState compact title={t('pl.choose')} message={t('pl.chooseBody')} /> : guardOf(q, t('pl.title'), 'fin.pl.view') ?? <>
      <div className="mdm-panel"><Chart type="bar" data={{ categories: x.trend.map((r) => r.period), series: [{ name: t('pl.revenue'), values: x.trend.map((r) => Math.round(r.revenue)) }, { name: t('pl.grossProfit'), values: x.trend.map((r) => Math.round(r.grossProfit)) }], unit: '₹' }} title={t('pl.trend')} exportName={`pl-${period}`} tableSwitch /></div>
      <KpiRow label={t('pl.title')}><KpiTile label={t('pl.revenue')} value={money(x.month.find((l) => l.type === 'REVENUE')?.amount ?? 0)} amount={x.month.find((l) => l.type === 'REVENUE')?.amount ?? 0} kind="money" valueTestid="pl-revenue" /><KpiTile label={t('pl.grossMargin')} value={pct(x.month.find((l) => l.type === 'GROSS_PROFIT')?.pct)} /><KpiTile label={t('pl.reconciled')} value={x.reconciled.equal ? t('pl.equal') : t('pl.notEqual')} valueTestid="pl-recon" /><KpiTile label={t('pl.snapshot')} value={x.snapshot ? (x.snapshot.frozenAt ? t('pl.frozen') : t(`pl.st.${x.snapshot.status}`)) : t('pl.none')} /></KpiRow>
      {x.overheadsMasked && <p className="muted small">{t('pl.maskedNote')}</p>}
      <Pills tabs={cols.map(([k, l]) => [k, l])} tab={col} setTab={setCol} label={t('pl.columns')} prefix="pl-col" />
      {(col === 'budget' || col === 'forecast') && <p className="muted small">{col === 'budget' ? x.budget?.ref : x.forecast?.ref}</p>}
      <ul className="lp-list" aria-label={t('pl.lines')} data-testid="pl-lines">{lines.map((l) => <li key={l.code} className="mdm-panel" style={{ padding: 12, margin: '6px 0' }}><button type="button" className="btn-link" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, width: '100%', minHeight: 44, alignItems: 'center', flexWrap: 'wrap', fontWeight: l.subtotal ? 700 : 400, background: 'none', border: 0, color: 'inherit', textAlign: 'left' }} disabled={l.subtotal || l.masked || !['month', 'ytd', 'cumulative'].includes(col)} onClick={() => setDrill(l.code)}>
        <span>{l.name}</span><span className="num">{amt(l.amount, t)}{l.pct != null ? ` · ${pct(l.pct)}` : ''}</span></button></li>)}</ul>
      {drill && <Drill projectId={projectId} line={drill} period={period} onClose={() => setDrill(null)} />}
      <div className="ff-actionbar">{x.snapshot ? <Link to={`/finance/project-pl?snapshot=${x.snapshot.id}`}>{x.snapshot.docNo}</Link> : x.canSnapshot && period < istToday().slice(0, 7) && <button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => pl.createSnapshot({ projectId: Number(projectId), period }), t('pl.snapMade')).then((r) => r && navigateTo(`/finance/project-pl?snapshot=${r.id}`))} data-testid="pl-snap">{t('pl.makeSnapshot')}</button>}</div>
    </>}
  </section>);
}

export function ProfitabilityPage() {
  const t = useT('pl'); usePageTitle(t('pf.title')); const [f, setF] = useState({ from: fyStartOf(istToday()), to: istToday() }); const [seg, setSeg] = useState('sector');
  const q = useQuery({ queryKey: ['gl', 'pf', f], queryFn: () => pl.portfolio(f), retry: false }); const g = guardOf(q, t('pf.title'), 'fin.pl.view'); const x = q.data;
  return (<section aria-labelledby="pf-h" data-testid="pf-page"><PageHeader id="pf-h" title={t('pf.title')} subtitle={t('pf.intro')} meta={<Link to="/finance/project-pl">{t('pl.title')}</Link>} />
    <div className="form-grid"><Field label={t('pf.from')} name="from" error={null}><input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} style={big} /></Field><Field label={t('pf.to')} name="to" error={null}><input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} style={big} /></Field></div>
    {g ?? (x.rows.length === 0 ? <EmptyState compact title={t('pf.none')} message={t('pf.noneBody')} /> : <>
      <KpiRow label={t('pf.title')}><KpiTile label={t('pl.revenue')} value={money(x.kpis.revenue)} amount={x.kpis.revenue} kind="money" valueTestid="pf-revenue" /><KpiTile label={t('pl.grossMargin')} value={pct(x.kpis.grossMarginPct)} /><KpiTile label={t('pl.operatingProfit')} value={amt(x.kpis.operatingProfit, t)} /><KpiTile label={t('pf.lossMaking')} value={String(x.kpis.lossMaking)} /></KpiRow>
      <div className="mdm-panel"><Chart type="bar" data={{ categories: x.rows.slice(0, 12).map((r) => r.project.split(' ')[0]), series: [{ name: t('pl.grossMargin'), values: x.rows.slice(0, 12).map((r) => r.grossMarginPct ?? 0) }], unit: '%' }} title={t('pf.ranking')} exportName="profitability-ranking" tableSwitch /><p><Link to="/finance/project-pl">{t('pf.viewAll')}</Link></p></div>
      <div className="mdm-panel"><h2>{t('pf.segments')}</h2><Pills tabs={[['sector', t('pf.s.sector')], ['region', t('pf.s.region')], ['client', t('pf.s.client')]]} tab={seg} setTab={setSeg} label={t('pf.segments')} prefix="pf-seg" />
        <ul className="lp-list" data-testid="pf-segments">{x.segments[seg].map((s) => <li key={s.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, minHeight: 44, alignItems: 'center', flexWrap: 'wrap' }}><span>{s.name} · {t('pf.projectsN', { n: s.projects })}</span><span className="num">{money(s.revenue)} · {pct(s.grossMarginPct)}</span></li>)}</ul></div>
      {x.exceptions.length > 0 && <div className="mdm-panel" data-testid="pf-exceptions"><h2>{t('pf.exceptions')}</h2><ul className="lp-list">{x.exceptions.map((r) => <li key={r.projectId}><Link to={`/finance/project-pl?projectId=${r.projectId}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, minHeight: 44, alignItems: 'center', flexWrap: 'wrap' }}><span>{r.project}</span><span className="num">{money(r.grossProfit)}</span></Link></li>)}</ul></div>}
      {x.kpis.snapshotsWaiting > 0 && <div className="mdm-panel"><h2>{t('pf.pending')}</h2><p>{t('pf.waiting', { n: x.kpis.snapshotsWaiting })}</p></div>}
      <div className="mdm-panel"><h2>{t('pf.projects')}</h2><ul className="lp-list">{x.rows.map((r) => <li key={r.projectId}><Link to={`/finance/project-pl?projectId=${r.projectId}`} style={{ display: 'grid', gap: 2, minHeight: 44 }}><strong>{r.project}</strong><span className="muted small">{r.sector} · {r.region} · {r.client} · {t('pl.revenue')} {money(r.revenue)} · {t('pl.grossMargin')} {pct(r.grossMarginPct)}</span></Link></li>)}</ul></div>
      {x.overheadsMasked && <p className="muted small">{t('pl.maskedNote')}</p>}
      <Rows rows={[[t('pf.period'), `${x.from} – ${x.to}`]]} /></>)}
  </section>);
}
