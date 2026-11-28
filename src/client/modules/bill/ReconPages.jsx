import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from '../site/parts.jsx';
import { bill, fmtDate, qs } from './api.js';
import { ErrorLine, big, useRunner } from './BillParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import { formatINR } from '../../../shared/money.js';

// Quantity reconciliation (part 22.02): the chain of quantities per item and location with the drill-down to the records behind each figure, the forecast (the only typed quantity), and the items approaching their limit.
const nf = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });
const LEVEL_TONE = { OK: 'APPROVED', APPROACHING: 'IN_REVIEW', OVER: 'REJECTED', FORECAST_OVER: 'RETURNED' };
const n = (v) => (v == null ? '—' : nf.format(v));
export function useReconOptions() { return useQuery({ queryKey: ['bill', 'recon-options'], queryFn: () => bill.get('/qty-recon/options'), retry: false }); }
export function LevelBadge({ level }) { const t = useT('bill'); return <StatusBadge status={LEVEL_TONE[level]} label={t(`lv.${level}`)} />; }
const COLS = ['contract', 'revised', 'executed', 'measured', 'certified', 'billed', 'paid', 'balance', 'forecast'];

function Detail({ projectId, code, can, onClose }) {
  const t = useT('bill'); const { error, run, busy, note } = useRunner(); const [f, setF] = useState({ qty: '', basis: '' });
  const q = useQuery({ queryKey: ['bill', 'recon-detail', projectId, code], queryFn: () => bill.get(`/qty-recon/detail${qs({ projectId, code })}`), retry: false });
  if (q.isPending) return <Skeleton label={t('rc.detail')} rows={3} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />; const d = q.data; const it = d.item;
  const save = async () => { const r = await run(() => bill.put('/qty-forecasts', { projectId: Number(projectId), boqLineId: it.boqLineId, forecastQty: Number(f.qty), basis: f.basis }), t('rc.forecastSaved')); if (r) { setF({ qty: '', basis: '' }); q.refetch(); } };
  return (
    <div className="mdm-panel" data-testid="bill-recon-detail"><h2>{it.code} {it.description}</h2><p className="muted">{t('rc.unit')}: {it.uom} · {t('rc.contract')}: {n(it.contract)} · {t('rc.revised')}: {n(it.revised)} · {t('rc.projected')}: {n(it.projected)} ({t(`rc.src.${it.forecastSource}`)})</p>
      <ErrorLine error={error} id="bill-error" />{note && <p className="mdm-banner" role="status" data-testid="bill-note">{note}</p>}
      {can?.forecast && <div className="form-grid no-print" data-testid="bill-forecast-form"><Field label={t('rc.forecast')} name="forecastQty" error={error?.fields?.forecastQty}><input type="number" min="0" step="any" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} style={big} data-testid="bill-forecast-qty" /></Field>
        <Field label={t('rc.basis')} name="basis" error={error?.fields?.basis}><input value={f.basis} onChange={(e) => setF({ ...f, basis: e.target.value })} style={big} maxLength={500} data-testid="bill-forecast-basis" /></Field>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy || f.qty === '' || f.basis.trim().length < 5} onClick={save} data-testid="bill-forecast-save">{t('rc.saveForecast')}</button>{it.forecast != null && <button type="button" className="btn" style={big} disabled={busy} onClick={async () => { if (await run(() => bill.del(`/qty-forecasts${qs({ projectId, code })}`), t('rc.forecastCleared'))) q.refetch(); }} data-testid="bill-forecast-clear">{t('rc.clearForecast')}</button>}</div></div>}
      {it.forecast != null && <p data-testid="bill-forecast-now">{t('rc.forecastNow', { qty: n(it.forecast), basis: it.forecastBasis, on: fmtDate(it.forecastOn) })}</p>}
      <h3>{t('rc.byLocation')}</h3>{d.locations.length === 0 ? <p className="muted">{t('rc.noLocations')}</p> : <div className="table-scroll"><table className="data-table" data-testid="bill-recon-locations"><thead><tr><th>{t('rc.location')}</th><th className="num">{t('rc.executed')}</th><th className="num">{t('rc.measured')}</th><th className="num">{t('rc.certified')}</th><th className="num">{t('rc.billed')}</th></tr></thead><tbody>{d.locations.map((l, i) => <tr key={i}><td>{l.location ?? t('rc.noLocation')}</td><td className="num">{n(l.executed)}</td><td className="num">{n(l.measured)}</td><td className="num">{n(l.certified)}</td><td className="num">{n(l.billed)}</td></tr>)}</tbody></table></div>}
      <h3>{t('rc.entries')}</h3>{d.entries.length === 0 ? <p className="muted">{t('rc.noEntries')}</p> : <div className="table-scroll"><table className="data-table" data-testid="bill-recon-entries"><thead><tr><th>{t('rc.entry')}</th><th>{t('rc.description')}</th><th className="num">{t('rc.measured')}</th><th className="num">{t('rc.certified')}</th><th>{t('rc.status')}</th><th>{t('rc.bill')}</th></tr></thead><tbody>{d.entries.map((e) => <tr key={e.id}><td><Link to={`/bill/mb-entries?id=${e.id}`}>{e.docNo}</Link></td><td>{e.description}</td><td className="num">{n(e.qty)}</td><td className="num">{n(e.certified)}</td><td>{t(`st.${e.status}`)}</td><td>{e.billRef ?? '—'}</td></tr>)}</tbody></table></div>}
      <h3>{t('rc.dpr')}</h3>{d.dpr.length === 0 ? <p className="muted">{t('rc.noDpr')}</p> : <div className="table-scroll"><table className="data-table" data-testid="bill-recon-dpr"><thead><tr><th>{t('rc.report')}</th><th>{t('rc.date')}</th><th className="num">{t('rc.executed')}</th></tr></thead><tbody>{d.dpr.map((w) => <tr key={w.id}><td>{w.dprNo}</td><td>{fmtDate(w.date)}</td><td className="num">{n(w.qty)}</td></tr>)}</tbody></table></div>}
      {d.statements.length > 0 && <><h3>{t('rc.statements')}</h3><ul data-testid="bill-recon-statements">{d.statements.map((s) => <li key={s.id}><Link to={`/bill/deviations?id=${s.id}`}>{s.dsNo}</Link> · {t(`st.${s.status}`)} · {t(`cs.${s.clientState}`)}</li>)}</ul></>}
      <div className="actions-row no-print"><button type="button" className="btn" onClick={onClose} data-testid="bill-recon-close">{t('rc.close')}</button></div></div>
  );
}

export function QtyReconPage() {
  const t = useT('bill'); usePageTitle(t('rc.title')); const sp = useSearch(); const o = useReconOptions(); const [f, setF] = useState({ projectId: sp.get('projectId') ?? '', by: 'item', level: '', deviatingOnly: false }); const [code, setCode] = useState(sp.get('code') ?? ''); const { run } = useRunner();
  const projects = o.data?.projects ?? []; const pid = f.projectId || (projects.length === 1 ? String(projects[0].id) : '');
  const query = qs({ projectId: pid, by: f.by, level: f.level, deviatingOnly: f.deviatingOnly ? 'true' : '' });
  const q = useQuery({ queryKey: ['bill', 'recon', query], queryFn: () => bill.get(`/qty-recon${query}`), enabled: Boolean(pid), retry: false, placeholderData: (p) => p });
  if (o.error?.status === 403) return <NoPermission what={t('rc.title')} permission="bill.qty_recon.view" />; if (o.isPending) return <Skeleton label={t('rc.title')} rows={5} />; const d = q.data; const loc = f.by === 'location';
  return (
    <section aria-labelledby="rc-h" data-testid="bill-recon"><PageHeader id="rc-h" title={t('rc.title')} subtitle={t('rc.intro')} />
      <div className="form-grid no-print"><Field label={t('project')} name="projectId" error={null}><select value={pid} onChange={(e) => { setF({ ...f, projectId: e.target.value }); setCode(''); }} style={big} data-testid="bill-recon-project"><option value="">—</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></Field>
        <Field label={t('rc.view')} name="by" error={null}><select value={f.by} onChange={(e) => setF({ ...f, by: e.target.value })} style={big} data-testid="bill-recon-by"><option value="item">{t('rc.byItem')}</option><option value="location">{t('rc.byLoc')}</option></select></Field>
        <Field label={t('rc.level')} name="level" error={null}><select value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })} style={big} data-testid="bill-recon-level"><option value="">{t('rc.allLevels')}</option>{['APPROACHING', 'OVER', 'FORECAST_OVER'].map((l) => <option key={l} value={l}>{t(`lv.${l}`)}</option>)}</select></Field>
        <label style={{ minHeight: 'var(--erp-target-large)', alignSelf: 'end' }}><input type="checkbox" checked={f.deviatingOnly} onChange={(e) => setF({ ...f, deviatingOnly: e.target.checked })} data-testid="bill-recon-deviating" /> {t('rc.deviatingOnly')}</label></div>
      <div className="actions-row no-print">{d?.can?.export && <button type="button" className="btn" onClick={() => run(() => bill.exportFile(`/qty-recon/export${query}`, `quantity-reconciliation-${d.project}.csv`))} data-testid="bill-recon-export">{t('rc.export')}</button>}{d?.can?.prepare && <Link to={`/bill/deviations?new=1&projectId=${pid}`} data-testid="bill-recon-prepare">{t('rc.prepare')}</Link>} <Link to="/bill/qty-limits">{t('lim.title')}</Link></div>
      {q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : !d ? <p className="muted">{t('rc.pick')}</p> : (<>
        <KpiRow data-testid="bill-recon-counts">{[['items', d.counts.items], ['over', d.counts.over], ['approaching', d.counts.approaching], ['forecastOver', d.counts.forecastOver]].map(([k, v, amt, kd]) => <KpiTile label={t(`rc.c.${k}`)} value={v} amount={amt} kind={kd ?? (amt !== undefined ? 'money' : /day/i.test(k) ? 'time' : 'count')} key={k} data-testid={`bill-recon-count-${k}`} />)}</KpiRow>
        {d.rows.length === 0 ? <div className="empty-state"><h2>{t('rc.emptyTitle')}</h2><p>{t('rc.emptyBody')}</p></div> : (
          <div className="table-scroll"><table className="data-table" data-testid="bill-recon-table"><thead><tr><th>{t('rc.item')}</th><th>{t('rc.description')}</th><th>{t('rc.unit')}</th>{loc && <th>{t('rc.location')}</th>}{COLS.filter((c) => !loc || ['executed', 'measured', 'certified', 'billed', 'paid'].includes(c)).map((c) => <th className="num" key={c}>{t(`rc.${c}`)}</th>)}{!loc && <><th className="num">{t('rc.dev')}</th><th>{t('rc.level')}</th></>}</tr></thead>
            <tbody>{d.rows.map((r, i) => <tr key={i} data-testid="bill-recon-row" data-code={r.code} data-level={r.level ?? ''}><td><button type="button" className="btn" onClick={() => setCode(r.code)} data-testid="bill-recon-open">{r.code}</button></td><td>{r.description}</td><td>{r.uom}</td>{loc && <td>{r.location ?? t('rc.noLocation')}</td>}
              {COLS.filter((c) => !loc || ['executed', 'measured', 'certified', 'billed', 'paid'].includes(c)).map((c) => <td className="num" key={c} data-col={c}>{n(r[c])}</td>)}{!loc && <><td className="num">{r.deviationPct == null ? '—' : `${r.deviationPct > 0 ? '+' : ''}${r.deviationPct}%`}</td><td><LevelBadge level={r.level} /></td></>}</tr>)}</tbody>
            <tfoot>{d.totals.map((tt) => <tr key={tt.uom} data-testid="bill-recon-total"><th colSpan={loc ? 4 : 3}>{t('rc.total')} {tt.uom}</th>{COLS.filter((c) => !loc || ['executed', 'measured', 'certified', 'billed', 'paid'].includes(c)).map((c) => <th className="num" key={c}>{c === 'forecast' ? '' : n(tt[c])}</th>)}{!loc && <><th /><th /></>}</tr>)}</tfoot></table></div>)}
        {d.money && !loc && <MoneyPanel m={d.money} />}
        {code && <Detail projectId={pid} code={code} can={d.can} onClose={() => setCode('')} />}</>)}
    </section>
  );
}

/** PACK-18: the money of the chain, tied to the approved client bills (shown when the server sends it: flag ff.bill.pack18). */
function MoneyPanel({ m }) {
  const t = useT('bill'); const rs = (v) => formatINR(v);
  return (
    <div className="mdm-panel" data-testid="bill-recon-money"><h2>{t('rc.money.title')}</h2><p className="muted">{t('rc.money.intro')}</p>
      <p role="status" className="mdm-banner" data-testid="bill-recon-tie" data-ties={m.tie.ties ? 'yes' : 'no'}>{m.tie.ties ? t('rc.money.tieOk', { bills: m.bills.length, gross: rs(m.tie.billsGross) }) : t('rc.money.tieBad', { gross: rs(m.tie.billsGross), items: rs(m.tie.itemsAmount + m.tie.milestones), diff: rs(m.tie.differencePaise / 100) })}</p>
      <div className="table-scroll"><table className="data-table" data-testid="bill-recon-money-table"><caption className="sr-only">{t('rc.money.title')}</caption><thead><tr><th>{t('rc.item')}</th><th className="num">{t('rc.money.rate')}</th><th className="num">{t('rc.certified')}</th><th className="num">{t('rc.money.certifiedAmt')}</th><th className="num">{t('rc.money.billedQty')}</th><th className="num">{t('rc.money.billedAmt')}</th><th className="num">{t('rc.money.unbilled')}</th><th>{t('rc.money.variances')}</th></tr></thead>
        <tbody>{m.items.map((x) => <tr key={x.code} data-testid="bill-recon-money-row" data-code={x.code}><td>{x.code}</td><td className="num">{rs(x.rate)}</td><td className="num">{n(x.certifiedQty)}</td><td className="num">{rs(x.certifiedAmount)}</td><td className="num">{n(x.billedQty)}</td><td className="num">{rs(x.billedAmount)}</td><td className="num">{rs(x.unbilledAmount)}</td><td>{x.variances.length ? x.variances.map((v) => <StatusBadge key={v} status={v === 'CERTIFIED_NOT_BILLED' ? 'IN_REVIEW' : 'REJECTED'} label={t(`rc.var.${v}`)} />) : '—'}</td></tr>)}</tbody></table></div>
    </div>
  );
}

export function QtyLimitsPage() {
  const t = useT('bill'); usePageTitle(t('lim.title')); const o = useReconOptions(); const [pj, setPj] = useState('');
  const projects = o.data?.projects ?? []; const pid = pj || (projects.length === 1 ? String(projects[0].id) : '');
  const q = useQuery({ queryKey: ['bill', 'limits', pid], queryFn: () => bill.get(`/qty-limits${qs({ projectId: pid })}`), enabled: Boolean(pid), retry: false, placeholderData: (p) => p });
  if (o.error?.status === 403) return <NoPermission what={t('lim.title')} permission="bill.qty_recon.view" />; if (o.isPending) return <Skeleton label={t('lim.title')} rows={4} />; const d = q.data;
  return (
    <section aria-labelledby="lim-h" data-testid="bill-limits"><PageHeader id="lim-h" title={t('lim.title')} subtitle={t('lim.intro', { pct: d?.alertPct ?? 90 })} />
      <div className="form-grid no-print"><Field label={t('project')} name="projectId" error={null}><select value={pid} onChange={(e) => setPj(e.target.value)} style={big} data-testid="bill-limits-project"><option value="">—</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></Field></div>
      {q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : !d ? <p className="muted">{t('rc.pick')}</p> : d.rows.length === 0 ? <div className="empty-state"><h2>{t('lim.emptyTitle')}</h2><p>{t('lim.emptyBody')}</p><Link to="/bill/qty-recon">{t('rc.title')}</Link></div> : (<>
        <p data-testid="bill-limits-counts">{t('lim.counts', { over: d.counts.over, approaching: d.counts.approaching, forecast: d.counts.forecastOver })}</p>
        <div className="table-scroll"><table className="data-table" data-testid="bill-limits-table"><thead><tr><th>{t('rc.item')}</th><th>{t('rc.description')}</th><th className="num">{t('rc.revised')}</th><th className="num">{t('rc.measured')}</th><th className="num">{t('rc.executed')}</th><th className="num">%</th><th className="num">{t('rc.forecast')}</th><th>{t('rc.level')}</th></tr></thead>
          <tbody>{d.rows.map((r) => <tr key={r.code} data-testid="bill-limits-row" data-level={r.level}><td><Link to={`/bill/qty-recon?projectId=${pid}&code=${encodeURIComponent(r.code)}`}>{r.code}</Link></td><td>{r.description}</td><td className="num">{n(r.revised)} {r.uom}</td><td className="num">{n(r.measured)}</td><td className="num">{n(r.executed)}</td><td className="num">{r.usedPct == null ? '—' : `${r.usedPct}%`}</td><td className="num">{n(r.forecast)}</td><td><LevelBadge level={r.level} /></td></tr>)}</tbody></table></div></>)}
    </section>
  );
}
