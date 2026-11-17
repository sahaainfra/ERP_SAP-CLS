import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { fmtDate, qs, rmc } from './api.js';
import { DocBar, ErrorLine, Status, big, useRecord, useRunner } from './RmcParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';

// Batching plant costing (part 20.03): the dashboard with the cost per m3 by month, the plant profit and loss and the volume by project; a cost period (collect, enter, close, reopen); the cost per m3 by grade report; the internal transfer rates.
const TONE = { green: 'APPROVED', amber: 'RETURNED', red: 'REJECTED', neutral: 'DRAFT' }; const nf = new Intl.NumberFormat('en-IN'); const money = (n) => (n == null ? '—' : `₹ ${nf.format(n)}`);
const CATS = ['MATERIAL', 'POWER', 'FUEL', 'LABOUR', 'MAINTENANCE', 'DEPRECIATION', 'OVERHEAD']; const MANUAL = CATS.filter((c) => c !== 'MATERIAL');
function Bars({ rows, field, label }) {
  const max = Math.max(1, ...rows.map((m) => Math.abs(m[field] ?? 0))); const w = 480; const h = 110; const bw = w / Math.max(1, rows.length);
  return (<figure data-testid={`rmc-bars-${field}`}><figcaption>{label}</figcaption><svg viewBox={`0 0 ${w} ${h + 18}`} role="img" aria-label={label} style={{ width: '100%', maxWidth: 560, height: 'auto' }}>{rows.map((m, i) => { const bh = Math.round((Math.abs(m[field] ?? 0) / max) * h); return <g key={m.month}><rect x={i * bw + 3} y={h - bh} width={bw - 6} height={bh} fill="currentColor" opacity="0.65"><title>{`${m.month}: ${m[field]}`}</title></rect><text x={i * bw + bw / 2} y={h + 13} fontSize="9" textAnchor="middle" fill="currentColor">{m.month.slice(2)}</text></g>; })}</svg></figure>);
}
function Period({ id }) {
  const t = useT('rmc'); const { q, guard } = useRecord('/cost-periods', id, t('cs.period'), 'rmc.cost.view'); const { error, run, busy, note } = useRunner(); const [line, setLine] = useState({ category: 'LABOUR', amount: '', basis: '' }); usePageTitle(t('cs.period')); if (guard) return guard; const x = q.data; const fe = error?.fields ?? {};
  return (
    <div data-testid="rmc-period-object" data-state={x.state}><PageHeader id="cp-h" title={<>{x.docNo} <StatusBadge status={x.state === 'CLOSED' ? 'APPROVED' : 'DRAFT'} label={t(`cs.state.${x.state}`)} /></>} meta={<><Link to="/rmc/costing">{t('cs.title')}</Link> · {x.plant} · {x.period} · {t('cs.perM3')}: <strong data-testid="rmc-period-perm3">{money(x.perM3)}</strong> · {t('cs.volume')}: {x.volume} m3 · {t('cs.profit')}: <strong data-testid="rmc-period-profit">{money(x.profit)}</strong></>} />
      <ErrorLine error={error} id="rmc-error" />{note && <p className="mdm-banner" role="status" data-testid="rmc-note">{note}</p>}
      {x.blockers?.length > 0 && <div className="mdm-panel" data-testid="rmc-period-blockers"><h2>{t('cs.blockers')}</h2><ul>{x.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul></div>}
      <div className="actions-row no-print">{x.can.collect && <button type="button" className="btn" disabled={busy} onClick={() => run(() => rmc.post(`/cost-periods/${x.id}/collect`), t('cs.collected'))} data-testid="rmc-period-collect">{t('cs.collect')}</button>}{x.can.close && <button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => rmc.post(`/cost-periods/${x.id}/close`), t('cs.closed'))} data-testid="rmc-period-close">{t('cs.close')}</button>}
        {x.can.reopen && <button type="button" className="btn" disabled={busy} onClick={() => { const r = globalThis.prompt(t('why')); if (r) run(() => rmc.post(`/cost-periods/${x.id}/reopen`, { reason: r }), t('cs.reopened')); }} data-testid="rmc-period-reopen">{t('cs.reopen')}</button>}
        <button type="button" className="btn" onClick={() => rmc.exportFile(`/cost-periods/${x.id}/print`, `${x.docNo}.pdf`).catch(() => globalThis.alert?.(t('exportFailed')))} data-testid="rmc-period-print">{t('print')}</button></div>
      <div className="table-scroll"><table className="data-table" data-testid="rmc-period-lines"><caption>{t('cs.lines')}</caption><thead><tr><th>{t('cs.category')}</th><th>{t('mx.grade')}</th><th className="num">{t('cs.amount')}</th><th>{t('cs.basis')}</th><th /></tr></thead>
        <tbody>{x.lines.map((l) => <tr key={l.id} data-origin={l.origin}><td>{t(`cs.c.${l.category}`)}</td><td>{l.grade ?? '—'}</td><td className="num">{money(l.amount)}</td><td>{l.basis}</td><td>{l.origin === 'MANUAL' && x.can.input && <button type="button" className="btn" disabled={busy} onClick={() => run(() => rmc.remove(`/cost-periods/${x.id}/lines/${l.id}`), t('cs.lineRemoved'))}>{t('pl.remove')}</button>}</td></tr>)}</tbody>
        <tfoot><tr><th colSpan={2}>{t('cs.total')}</th><th className="num" data-testid="rmc-period-total">{money(x.total)}</th><th colSpan={2} /></tr></tfoot></table></div>
      {x.can.input && <form className="form-grid no-print" data-testid="rmc-line-form" onSubmit={async (e) => { e.preventDefault(); if (await run(() => rmc.post(`/cost-periods/${x.id}/lines`, { category: line.category, amount: Number(line.amount), basis: line.basis }), t('cs.lineAdded'))) setLine({ ...line, amount: '', basis: '' }); }}>
        <Field label={t('cs.category')} name="category" error={fe.category}><select value={line.category} onChange={(e) => setLine({ ...line, category: e.target.value })} style={big} data-testid="rmc-line-cat">{MANUAL.map((c) => <option key={c} value={c}>{t(`cs.c.${c}`)}</option>)}</select></Field>
        <Field label={t('cs.amount')} name="amount" error={fe.amount}><input type="number" min="0" step="any" value={line.amount} onChange={(e) => setLine({ ...line, amount: e.target.value })} style={big} data-testid="rmc-line-amount" /></Field>
        <Field label={t('cs.basis')} name="basis" error={fe.basis}><input value={line.basis} onChange={(e) => setLine({ ...line, basis: e.target.value })} maxLength={300} style={big} data-testid="rmc-line-basis" /></Field>
        <div className="actions-row"><button className="btn" style={big} disabled={busy || !line.amount || line.basis.length < 3} data-testid="rmc-line-add">{t('cs.addLine')}</button></div></form>}
      {x.grades.length > 0 && <div className="table-scroll"><table className="data-table" data-testid="rmc-period-grades"><caption>{t('cr.title')}</caption><thead><tr><th>{t('mx.grade')}</th><th className="num">m3</th><th className="num">{t('cr.material')}</th><th className="num">{t('cr.conversion')}</th><th className="num">{t('cs.perM3')}</th><th className="num">{t('cr.rate')}</th><th className="num">{t('cr.margin')}</th></tr></thead><tbody>{x.grades.map((g) => <tr key={g.grade}><td>{g.grade}</td><td className="num">{g.volume}</td><td className="num">{money(g.material)}</td><td className="num">{money(g.conversion)}</td><td className="num">{money(g.perM3)}</td><td className="num">{money(g.rate)}</td><td className="num">{money(g.margin)}</td></tr>)}</tbody></table></div>}
      {x.charges.length > 0 && <div className="table-scroll"><table className="data-table" data-testid="rmc-period-charges"><caption>{t('cs.charges')}</caption><thead><tr><th>{t('project')}</th><th>{t('mx.grade')}</th><th className="num">m3</th><th className="num">{t('cr.rate')}</th><th className="num">{t('cs.amount')}</th><th className="num">{t('cs.variance')}</th></tr></thead><tbody>{x.charges.map((c) => <tr key={c.id}><td>{c.project}</td><td>{c.grade}</td><td className="num">{c.volume}</td><td className="num">{money(c.rate)}</td><td className="num">{money(c.amount)}</td><td className="num">{money(c.variance)}</td></tr>)}</tbody></table></div>}
      <div className="table-scroll"><table className="data-table" data-testid="rmc-period-budget"><caption>{t('cs.budget')}</caption><thead><tr><th>{t('cs.category')}</th><th className="num">{t('cs.budgetAmt')}</th><th className="num">{t('cs.actual')}</th><th className="num">%</th></tr></thead><tbody>{x.budget.map((b) => <tr key={b.category}><td>{t(`cs.c.${b.category}`)}</td><td className="num">{b.budget == null ? '—' : money(b.budget)}</td><td className="num">{money(b.actual)}</td><td className="num">{b.variancePct ?? '—'}</td></tr>)}</tbody></table></div>
    </div>
  );
}
export function CostingDashboardPage() {
  const t = useT('rmc'); usePageTitle(t('cs.title')); const sp = useSearch(); const pid = Number(sp.get('period')) || null; const session = useSession(); const { error, run, busy, note } = useRunner(); const [np, setNp] = useState({ plantId: '', period: '' });
  const q = useQuery({ queryKey: ['rmc', 'costing'], queryFn: () => rmc.get('/costing'), retry: false, enabled: !pid }); const po = useQuery({ queryKey: ['rmc', 'period-options'], queryFn: () => rmc.get('/cost-periods/options'), retry: false, enabled: !pid });
  if (pid) return <section aria-labelledby="cp-h"><Period id={pid} /></section>;
  if (q.error?.status === 403) return <NoPermission what={t('cs.title')} permission="rmc.cost.view" />; if (q.isPending) return <Skeleton label={t('cs.title')} rows={5} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />; const d = q.data;
  return (
    <section aria-labelledby="cs-h" data-testid="rmc-costing"><PageHeader id="cs-h" title={t('cs.title')} subtitle={t('cs.intro')} /><ErrorLine error={error} id="rmc-error" />{note && <p className="mdm-banner" role="status">{note}</p>}
      <KpiRow data-testid="rmc-cost-tiles">{d.tiles.map((k) => (<KpiTile label={t(`cs.t.${k.key}`)} value={k.value == null ? '—' : k.key === 'volume' ? `${nf.format(k.value)} m3` : k.key === 'wastage' ? `${k.value}%` : money(k.value)} amount={k.value == null ? null : k.value} kind="money" valueTestid={`rmc-cost-${k.key}-value`} key={k.key} data-testid={`rmc-cost-${k.key}`} data-status={k.status}><div><StatusBadge status={TONE[k.status]} label={t(`cs.st.${k.status}`)} /></div>{k.previous != null && <div className="muted">{t('cs.previous')}: {k.key === 'volume' ? `${nf.format(k.previous)} m3` : money(k.previous)}</div>}<div><Link to={k.drill}>{t('kpi.open')}</Link></div></KpiTile>))}</KpiRow>
      <div className="mdm-panel" data-testid="rmc-cost-exceptions"><h2>{t('kpi.exceptions')}</h2>{d.exceptions.length === 0 ? <p className="muted">{t('kpi.noExceptions')}</p> : <ul>{d.exceptions.map((e, i) => <li key={i} data-tone={e.tone}><Link to={e.drill}>{t(`cs.exc.${e.key}`, { period: e.period ?? '', grade: e.grade ?? '' })}</Link></li>)}</ul>}<p>{t('cs.pendingRates', { n: d.pending })} <Link to="/rmc/transfer-rates">{t('tr.title')}</Link></p></div>
      {d.trend.length > 0 ? <div className="mdm-panel" data-testid="rmc-cost-trend"><h2>{t('cs.trend')}</h2><div className="form-grid"><Bars rows={d.trend} field="perM3" label={t('cs.perM3')} /><Bars rows={d.trend} field="volume" label={t('cs.volume')} /><Bars rows={d.trend} field="profit" label={t('cs.profit')} /></div></div> : <div className="empty-state"><h2>{t('cs.emptyTitle')}</h2><p>{t('cs.emptyBody')}</p></div>}
      {d.byProject.length > 0 && <div className="table-scroll"><table className="data-table" data-testid="rmc-cost-projects"><caption>{t('cs.byProject')}</caption><thead><tr><th>{t('project')}</th><th className="num">m3</th><th className="num">{t('cs.charged')}</th><th className="num">{t('cs.costAlloc')}</th><th className="num">{t('cs.variance')}</th></tr></thead><tbody>{d.byProject.map((p) => <tr key={p.projectId}><td>{p.project}</td><td className="num">{p.volume}</td><td className="num">{money(p.amount)}</td><td className="num">{money(p.cost)}</td><td className="num">{money(p.variance)}</td></tr>)}</tbody></table></div>}
      {po.data && po.data.plants.length > 0 && <form className="form-grid no-print" data-testid="rmc-period-form" onSubmit={async (e) => { e.preventDefault(); const r = await run(() => rmc.post('/cost-periods', { plantId: Number(np.plantId), period: np.period })); if (r) navigateTo(`/rmc/costing?period=${r.id}`); }}><h2>{t('cs.openPeriod')}</h2>
        <Field label={t('mx.plant')} name="plantId" error={null}><select value={np.plantId} onChange={(e) => setNp({ ...np, plantId: e.target.value })} style={big} data-testid="rmc-np-plant"><option value="">—</option>{po.data.plants.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></Field>
        <Field label={t('cs.month')} name="period" error={null}><input type="month" value={np.period} onChange={(e) => setNp({ ...np, period: e.target.value })} style={big} data-testid="rmc-np-month" /></Field><div className="actions-row"><button className="btn btn-primary" style={big} disabled={busy || !np.plantId || !np.period} data-testid="rmc-np-go">{t('cs.openPeriod')}</button></div></form>}
      <ListReport listCode="rmc.cost_periods" endpoint="/rmc/cost-periods" title={t('cs.periods')} session={session.data} rowHref={(r) => `/rmc/costing?period=${r.id}`} onOpen={(r) => navigateTo(`/rmc/costing?period=${r.id}`)} cardFields={['plant', 'period', 'total', 'state']} empty={{ title: t('cs.emptyTitle'), text: t('cs.emptyBody') }} />
    </section>
  );
}
export function CostReportPage() {
  const t = useT('rmc'); usePageTitle(t('cr.title')); const [period, setPeriod] = useState(''); const query = qs({ period }); const q = useQuery({ queryKey: ['rmc', 'cost-report', query], queryFn: () => rmc.get(`/cost-report${query}`), retry: false, placeholderData: (p) => p });
  if (q.error?.status === 403) return <NoPermission what={t('cr.title')} permission="rmc.cost.view" />; if (q.isPending) return <Skeleton label={t('cr.title')} rows={4} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />; const d = q.data;
  return (
    <section aria-labelledby="cr-h" data-testid="rmc-cost-report"><PageHeader id="cr-h" title={t('cr.title')} subtitle={<>{t('cr.intro')} <Link to="/rmc/transfer-rates">{t('tr.title')}</Link></>} />
      <div className="mdm-panel no-print"><div className="form-grid"><Field label={t('cs.month')} name="period" error={null}><input type="month" value={period || d.period || ''} onChange={(e) => setPeriod(e.target.value)} style={big} data-testid="rmc-cr-month" /></Field></div><div className="actions-row"><button type="button" className="btn" onClick={() => rmc.exportFile(`/cost-report/export${query}`, 'cost-per-m3.csv').catch(() => globalThis.alert?.(t('exportFailed')))} data-testid="rmc-cr-export">{t('co.export')}</button></div></div>
      {!d.period || d.rows.length === 0 ? <div className="empty-state"><h2>{t('cr.emptyTitle')}</h2><p>{t('cr.emptyBody')}</p></div> : (<>
        <div className="table-scroll"><table className="data-table" data-testid="rmc-cr-plants"><caption>{t('cr.plants', { period: d.period })}</caption><thead><tr><th>{t('mx.plant')}</th><th className="num">m3</th><th className="num">{t('cs.total')}</th><th className="num">{t('cs.perM3')}</th><th className="num">{t('cs.revenue')}</th><th className="num">{t('cs.profit')}</th></tr></thead><tbody>{d.plants.map((p) => <tr key={p.id} data-testid="rmc-cr-plant"><td><Link to={`/rmc/costing?period=${p.id}`}>{p.plant}</Link></td><td className="num">{p.volume}</td><td className="num">{money(p.total)}</td><td className="num">{money(p.perM3)}</td><td className="num">{money(p.revenue)}</td><td className="num">{money(p.profit)}</td></tr>)}</tbody></table></div>
        <div className="table-scroll"><table className="data-table" data-testid="rmc-cr-grades"><caption>{t('cr.byGrade')}</caption><thead><tr><th>{t('mx.plant')}</th><th>{t('mx.grade')}</th><th className="num">m3</th><th className="num">{t('cr.material')}</th><th className="num">{t('cr.conversion')}</th><th className="num">{t('cs.perM3')}</th><th className="num">{t('cr.rate')}</th><th className="num">{t('cr.margin')}</th><th className="num">%</th></tr></thead><tbody>{d.rows.map((g, i) => <tr key={i} data-testid="rmc-cr-grade" data-loss={g.margin < 0}><td>{g.plant}</td><td>{g.grade}</td><td className="num">{g.volume}</td><td className="num">{money(g.material)}</td><td className="num">{money(g.conversion)}</td><td className="num">{money(g.perM3)}</td><td className="num">{money(g.rate)}</td><td className="num">{money(g.margin)}</td><td className="num">{g.marginPct ?? '—'}</td></tr>)}</tbody></table></div></>)}
    </section>
  );
}
function RateNew() {
  const t = useT('rmc'); const { error, run, busy } = useRunner(); usePageTitle(t('tr.new')); const o = useQuery({ queryKey: ['rmc', 'rate-options'], queryFn: () => rmc.get('/transfer-rates/options'), retry: false }); const [v, setV] = useState({ plantId: '', grade: 'M25', rate: '', effectiveFrom: '' });
  if (o.error?.status === 403) return <NoPermission what={t('tr.title')} permission="rmc.transfer_rate.create" />; if (o.isPending) return <Skeleton label={t('tr.title')} rows={3} />; const d = o.data; const fe = error?.fields ?? {}; const cur = d.current.filter((x) => String(x.plantId) === String(v.plantId) && x.grade === v.grade).at(-1);
  return (
    <section aria-labelledby="trn-h" data-testid="rmc-rate-form"><PageHeader id="trn-h" title={t('tr.new')} meta={<Link to="/rmc/transfer-rates">{t('tr.title')}</Link>} /><ErrorLine error={error} id="rmc-error" />
      <div className="mdm-panel"><div className="form-grid">
        <Field label={t('mx.plant')} name="plantId" error={fe.plantId}><select value={v.plantId} onChange={(e) => setV({ ...v, plantId: e.target.value })} style={big} data-testid="rmc-rate-plant"><option value="">—</option>{d.plants.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></Field>
        <Field label={t('mx.grade')} name="grade" error={fe.grade}><select value={v.grade} onChange={(e) => setV({ ...v, grade: e.target.value })} style={big} data-testid="rmc-rate-grade">{d.grades.map((g) => <option key={g} value={g}>{g}</option>)}</select></Field>
        <Field label={t('tr.rate')} name="rate" error={fe.rate}><input type="number" min="0" step="any" inputMode="decimal" value={v.rate} onChange={(e) => setV({ ...v, rate: e.target.value })} style={big} data-testid="rmc-rate-rate" /></Field>
        <Field label={t('mx.effectiveFrom')} name="effectiveFrom" error={fe.effectiveFrom}><input type="date" value={v.effectiveFrom} onChange={(e) => setV({ ...v, effectiveFrom: e.target.value })} style={big} data-testid="rmc-rate-from" /></Field></div>
        {cur && <p className="muted">{t('tr.current', { rate: money(cur.rate), from: fmtDate(cur.effectiveFrom) })}</p>}
        <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy || !v.plantId || !v.rate || !v.effectiveFrom} onClick={async () => { const r = await run(() => rmc.make('/transfer-rates', { plantId: Number(v.plantId), grade: v.grade, rate: Number(v.rate), effectiveFrom: v.effectiveFrom })); if (r) navigateTo(`/rmc/transfer-rates?id=${r.id}`); }} data-testid="rmc-rate-save">{t('save')}</button></div></div>
    </section>
  );
}
function Rate({ id }) {
  const t = useT('rmc'); const { q, guard } = useRecord('/transfer-rates', id, t('tr.title'), 'rmc.transfer_rate.view'); usePageTitle(t('tr.title')); if (guard) return guard; const x = q.data;
  return (
    <div data-testid="rmc-rate-object" data-status={x.status}><PageHeader id="tr-h" title={<>{x.docNo} <Status x={x} /></>} meta={<><Link to="/rmc/transfer-rates">{t('tr.title')}</Link> · {x.plant} · {x.grade} · <strong data-testid="rmc-rate-value">{money(x.rate)}</strong> {t('tr.perM3')} · {t('mx.effectiveFrom')}: {fmtDate(x.effectiveFrom)}{x.previous != null ? ` · ${t('tr.earlier')}: ${money(x.previous)}` : ''}</>} />
      <DocBar kind="/transfer-rates" x={x} printName={`${x.docNo}.pdf`} />
    </div>
  );
}
export function TransferRatesPage() {
  const t = useT('rmc'); usePageTitle(t('tr.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession();
  if (id) return <section aria-labelledby="tr-h"><Rate id={id} /></section>; if (sp.get('new')) return <RateNew />;
  return (
    <section aria-labelledby="trs-h" data-testid="rmc-rates"><PageHeader id="trs-h" title={t('tr.title')} subtitle={t('tr.intro')} />
      <div className="actions-row no-print"><Link to="/rmc/transfer-rates?new=1" data-testid="rmc-rate-new">{t('tr.new')}</Link> · <Link to="/rmc/cost-report">{t('cr.title')}</Link></div>
      <ListReport listCode="rmc.transfer_rates" endpoint="/rmc/transfer-rates" title={t('tr.title')} session={session.data} rowHref={(r) => `/rmc/transfer-rates?id=${r.id}`} onOpen={(r) => navigateTo(`/rmc/transfer-rates?id=${r.id}`)} cardFields={['plant', 'grade', 'rate', 'status']} statusKey="status" empty={{ title: t('tr.emptyTitle'), text: t('tr.emptyBody') }} />
    </section>
  );
}
