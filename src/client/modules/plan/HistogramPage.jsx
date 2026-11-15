import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { CAL_TONE, RES_TYPES, download, fmtDate, pl } from './api.js';
import { SchedulePicker, useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Resource Histogram (part 13.02, FR-03): the labour, plant and material the schedule needs by day, week or month, on the early or the late dates, against what is available (approved deployments of the
// project by crew trade, and availability put in force by a second person); a bucket where a day needs more than is available is over-allocated and shown red. A bar opens the activities behind it.
const fmtN = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }));

function Bars({ t, r, buckets, onPick, picked }) {
  const W = Math.max(320, buckets.length * 26); const H = 200; const pad = { l: 44, b: 26, t: 10 };
  const max = Math.max(1, ...r.buckets.map((b) => Math.max(b.demand, b.available ?? 0))); const y = (v) => H - pad.b - ((H - pad.b - pad.t) * v) / max; const bw = (W - pad.l) / buckets.length;
  const ticks = [0, max / 2, max];
  return (
    <div className="table-scroll" data-testid="ph-chart">
      <svg width={W} height={H} role="img" aria-label={t('h.chartLabel', { r: r.label })}>
        {ticks.map((v) => <g key={v}><line x1={pad.l} x2={W} y1={y(v)} y2={y(v)} stroke="var(--erp-color-border-subtle)" /><text x={pad.l - 4} y={y(v) + 4} fontSize="10" textAnchor="end" fill="var(--erp-color-text-muted)">{fmtN(v)}</text></g>)}
        {r.buckets.map((b, i) => {
          const x = pad.l + i * bw; const label = `${buckets[i].key}: ${t('h.demand')} ${fmtN(b.demand)} ${r.uom}${b.available != null ? `, ${t('h.available')} ${fmtN(b.available)}` : ''}${b.over ? `, ${t('h.overDays', { n: b.overDays })}` : ''}`;
          return (
            <g key={buckets[i].key} role="link" tabIndex={b.demand > 0 ? 0 : -1} aria-label={label} onClick={() => b.demand > 0 && onPick(i)} onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && b.demand > 0) { e.preventDefault(); onPick(i); } }} style={{ cursor: b.demand > 0 ? 'pointer' : 'default' }} data-testid="ph-bar" data-over={b.over ? '1' : '0'}>
              <title>{label}</title>
              <rect x={x + 2} y={y(b.demand)} width={Math.max(2, bw - 4)} height={H - pad.b - y(b.demand)} fill={b.over ? 'var(--erp-color-status-error-solid)' : 'var(--erp-chart-1)'} stroke={picked === i ? 'var(--erp-color-border-focus)' : 'none'} strokeWidth="2" />
              {i % Math.max(1, Math.ceil(buckets.length / 12)) === 0 && <text x={x + 2} y={H - 8} fontSize="9" fill="var(--erp-color-text-muted)">{buckets[i].key.slice(5) || buckets[i].key}</text>}
            </g>
          );
        })}
        {r.tracked && <path d={r.buckets.map((b, i) => `${i ? 'L' : 'M'}${pad.l + i * bw},${y(b.available ?? 0)} H${pad.l + (i + 1) * bw}`).join(' ')} fill="none" stroke="var(--erp-color-status-success-solid)" strokeWidth="2" data-testid="ph-avail-line" />}
      </svg>
    </div>
  );
}

function Capacity({ t, projectId, perms }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['plan', 'capacity', projectId], queryFn: () => pl.capacity(projectId), enabled: Boolean(projectId), retry: false });
  const [f, setF] = useState({ type: 'PLANT', itemId: '', trade: '', uom: '', qtyPerDay: '', from: '', to: '', reason: '' }); const [error, setError] = useState(null); const [note, setNote] = useState(null);
  const oq = useQuery({ queryKey: ['plan', 'resource-options', projectId, f.type, ''], queryFn: () => pl.resourceOptions(projectId, f.type, ''), enabled: Boolean(projectId), retry: false });
  if (!projectId) return null;
  const run = async (fn, done) => { setError(null); setNote(null); try { await fn(); setNote(done); qc.invalidateQueries({ queryKey: ['plan'] }); return true; } catch (x) { setError(errorInfo(x)); return false; } };
  const submit = async (e) => { e.preventDefault(); if (await run(() => pl.createCapacity({ projectId, type: f.type, itemId: f.itemId ? Number(f.itemId) : null, trade: f.trade.trim() || null, uom: f.uom.trim() || null, qtyPerDay: Number(f.qtyPerDay), from: f.from, to: f.to, reason: f.reason.trim() }), t('h.capDrafted'))) setF({ ...f, qtyPerDay: '', reason: '' }); };
  return (
    <div className="mdm-panel" data-testid="ph-capacity" role="region" aria-label={t('h.capacity')}>
      <h2>{t('h.capacity')}</h2>
      <p className="muted">{t('h.capIntro')}</p>
      {note && <p className="mdm-banner" role="status" data-testid="ph-cap-note">{note}</p>}
      {error?.form && <p className="field-error" role="alert" data-testid="ph-cap-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 3).join('; ')}` : ''}</p>}
      {q.isPending ? <Skeleton label={t('h.capacity')} rows={2} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : q.data.rows.length === 0 ? <p className="muted" data-testid="ph-cap-empty">{t('h.capEmpty')}</p> : (
        <div className="table-scroll"><table className="data-table" data-testid="ph-cap-table"><caption className="sr-only">{t('h.capacity')}</caption>
          <thead><tr><th>{t('f.type')}</th><th>{t('f.resource')}</th><th className="num">{t('r.perDay')}</th><th>{t('f.uom')}</th><th>{t('h.from')}</th><th>{t('h.to')}</th><th>{t('f.status')}</th><th>{t('cal.by')}</th><th /></tr></thead>
          <tbody>{q.data.rows.map((c) => (
            <tr key={c.id} data-testid="ph-cap-row" data-status={c.status}><td>{t(`r.type.${c.type}`)}</td><td>{c.label}</td><td className="num">{fmtN(c.qtyPerDay)}</td><td>{c.uom}</td><td>{fmtDate(c.from)}</td><td>{fmtDate(c.to)}</td><td><StatusBadge status={CAL_TONE[c.status]} label={t(`cst.${c.status}`)} /></td><td>{c.requestedBy}{c.approvedBy ? ` → ${c.approvedBy}` : ''}</td>
              <td>{c.can.activate && <button type="button" className="btn btn-primary" onClick={() => run(() => pl.capacityAct(c.id, 'activate'), t('h.capActivated'))} data-testid="ph-cap-activate">{t('cal.activate')}</button>}{c.can.cancel && <button type="button" className="btn" onClick={() => { const x = window.prompt(t('act.why')); if (x) run(() => pl.capacityAct(c.id, 'cancel', { reason: x }), t('h.capCancelled')); }} data-testid="ph-cap-cancel">{t('act.cancel')}</button>}</td></tr>))}</tbody></table></div>
      )}
      {perms.includes('plan.capacity.manage') && (
        <form onSubmit={submit} aria-label={t('h.capDraft')} data-testid="ph-cap-form">
          <h3>{t('h.capDraft')}</h3>
          <div className="form-grid">
            <Field label={t('f.type')} name="type"><select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value, itemId: '' })} data-testid="ph-cap-type">{RES_TYPES.map((k) => <option key={k} value={k}>{t(`r.type.${k}`)}</option>)}</select></Field>
            <Field label={t('r.item')} name="itemId"><select value={f.itemId} onChange={(e) => { const it = oq.data?.items.find((x) => x.id === Number(e.target.value)); setF({ ...f, itemId: e.target.value, uom: it?.uom ?? f.uom }); }} data-testid="ph-cap-item"><option value="">{f.type === 'LABOUR' ? t('r.byTrade') : '—'}</option>{(oq.data?.items ?? []).map((x) => <option key={x.id} value={x.id}>{x.code} {x.name}</option>)}</select></Field>
            {(f.type === 'LABOUR' || !f.itemId) && <Field label={f.type === 'LABOUR' ? t('r.trade') : t('r.class')} name="trade"><input value={f.trade} onChange={(e) => setF({ ...f, trade: e.target.value })} list="ph-trades" maxLength={80} data-testid="ph-cap-trade" /><datalist id="ph-trades">{(oq.data?.trades ?? []).map((x) => <option key={x} value={x} />)}</datalist></Field>}
            <Field label={t('r.perDay')} name="qtyPerDay"><input type="number" min="0" step="0.001" value={f.qtyPerDay} onChange={(e) => setF({ ...f, qtyPerDay: e.target.value })} required data-testid="ph-cap-qty" /></Field>
            <Field label={t('f.uom')} name="uom"><input value={f.uom} onChange={(e) => setF({ ...f, uom: e.target.value })} maxLength={20} data-testid="ph-cap-uom" /></Field>
            <Field label={t('h.from')} name="from"><input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} required data-testid="ph-cap-from" /></Field>
            <Field label={t('h.to')} name="to"><input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} required data-testid="ph-cap-to" /></Field>
            <Field label={t('f.reason')} name="reason"><input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} required minLength={5} maxLength={1000} data-testid="ph-cap-reason" /></Field>
          </div>
          <div className="actions"><button type="submit" className="btn btn-primary" disabled={!(Number(f.qtyPerDay) > 0) || !f.from || !f.to || f.reason.trim().length < 5 || (!f.itemId && !f.trade.trim())} data-testid="ph-cap-save">{t('cal.saveDraft')}</button></div>
        </form>
      )}
    </div>
  );
}

export default function HistogramPage() {
  const t = useT('plan');
  usePageTitle(t('h.title'));
  const session = useSession(); const perms = session.data?.permissions ?? []; const sp = useSearch();
  const [projectId, setProjectId] = useState(null); const [scheduleId, setScheduleId] = useState(Number(sp.get('scheduleId')) || null);
  const [p, setP] = useState({ type: '', bucket: 'week', dates: 'early', from: '', to: '' }); const [key, setKey] = useState(null); const [pick, setPick] = useState(null);
  const sq = useQuery({ queryKey: ['plan', 'schedule', scheduleId], queryFn: () => pl.schedule(scheduleId), enabled: Boolean(scheduleId), retry: false });
  const qs = new URLSearchParams(Object.entries(p).filter(([, v]) => v)).toString();
  const hq = useQuery({ queryKey: ['plan', 'histogram', scheduleId, qs], queryFn: () => pl.histogram(scheduleId, qs), enabled: Boolean(scheduleId), retry: false, placeholderData: (x) => x });
  const h = hq.data; const r = h ? (h.resources.find((x) => x.key === key && (!p.type || x.type === p.type)) ?? h.resources[0]) : null;
  const dq = useQuery({ queryKey: ['plan', 'drill', scheduleId, r?.type, r?.key, pick, p.dates, qs], queryFn: () => pl.drill(scheduleId, new URLSearchParams({ type: r.type, key: r.key, from: h.buckets[pick].from, to: h.buckets[pick].to, dates: p.dates }).toString()), enabled: Boolean(r && pick != null && h?.buckets[pick]), retry: false });
  if (hq.error?.status === 403) return <NoPermission what={t('h.title')} permission="plan.resource.view" />;
  const pid = projectId ?? sq.data?.projectId ?? null;
  return (
    <section aria-labelledby="ph-h" data-testid="plan-histogram">
      <PageHeader id="ph-h" title={t('h.title')} />
      <form className="mdm-panel no-print" onSubmit={(e) => e.preventDefault()} aria-label={t('h.params')}>
        <SchedulePicker projectId={pid} scheduleId={scheduleId} onProject={(v) => { setProjectId(v); setScheduleId(null); setPick(null); }} onSchedule={(v) => { setScheduleId(v); setPick(null); setKey(null); }} testId="ph" />
        <div className="form-grid">
          <Field label={t('f.type')} name="type"><select value={p.type} onChange={(e) => { setP({ ...p, type: e.target.value }); setPick(null); setKey(null); }} data-testid="ph-type"><option value="">{t('h.allTypes')}</option>{RES_TYPES.map((k) => <option key={k} value={k}>{t(`r.type.${k}`)}</option>)}</select></Field>
          <Field label={t('h.bucket')} name="bucket"><select value={p.bucket} onChange={(e) => { setP({ ...p, bucket: e.target.value }); setPick(null); }} data-testid="ph-bucket">{['day', 'week', 'month'].map((k) => <option key={k} value={k}>{t(`h.bucket.${k}`)}</option>)}</select></Field>
          <Field label={t('h.dates')} name="dates"><select value={p.dates} onChange={(e) => { setP({ ...p, dates: e.target.value }); setPick(null); }} data-testid="ph-dates"><option value="early">{t('h.early')}</option><option value="late">{t('h.late')}</option></select></Field>
          <Field label={t('h.from')} name="from"><input type="date" value={p.from} onChange={(e) => { setP({ ...p, from: e.target.value }); setPick(null); }} data-testid="ph-from" /></Field>
          <Field label={t('h.to')} name="to"><input type="date" value={p.to} onChange={(e) => { setP({ ...p, to: e.target.value }); setPick(null); }} data-testid="ph-to" /></Field>
        </div>
        {h && perms.includes('plan.schedule.export') && <div className="actions">{['xlsx', 'pdf', 'csv'].map((f) => <button key={f} type="button" className="btn" onClick={() => download(`/schedules/${scheduleId}/histogram/export?${qs}${qs ? '&' : ''}format=${f}`, `resource-histogram-${h.docNo.replace(/[^A-Za-z0-9_-]+/g, '-')}.${f}`).catch(() => null)} data-testid={f === 'csv' ? 'ph-export' : `ph-export-${f}`}>{t(`h.export.${f}`)}</button>)}</div>}
      </form>
      {!scheduleId && <p className="muted" data-testid="ph-choose">{t('h.choose')}</p>}
      {scheduleId && hq.isPending && <Skeleton label={t('h.title')} rows={4} />}
      {hq.isError && hq.error?.status !== 403 && <ErrorState error={hq.error} onRetry={hq.refetch} />}
      {h && (
        <>
          {h.needsCalc && <p className="mdm-banner" role="status" data-testid="ph-stale">{t('act.needsCalc')}</p>}
          <dl className="kv" data-testid="ph-totals">{h.totals.map((x) => <div key={x.type}><dt>{t(`r.type.${x.type}`)}</dt><dd>{t('h.totalLine', { n: x.resources, o: x.over })}</dd></div>)}<div><dt>{t('h.window')}</dt><dd>{fmtDate(h.from)} – {fmtDate(h.to)}</dd></div></dl>
          {h.resources.length === 0 ? <p className="muted" data-testid="ph-empty">{t('h.empty')} <Link to={`/plan/gantt?scheduleId=${scheduleId}`}>{t('g.title')}</Link></p> : (
            <>
              <div className="table-scroll"><table className="data-table" data-testid="ph-resources"><caption className="sr-only">{t('h.resources')}</caption>
                <thead><tr><th>{t('f.type')}</th><th>{t('f.resource')}</th><th>{t('f.uom')}</th><th className="num">{t('h.total')}</th><th className="num">{t('h.peak')}</th><th>{t('h.peakDate')}</th><th className="num">{t('h.overDaysCol')}</th><th>{t('h.availability')}</th><th className="num">{t('f.activities')}</th></tr></thead>
                <tbody>{h.resources.map((x) => (
                  <tr key={`${x.type}${x.key}`} aria-selected={r === x} data-testid="ph-res-row" data-over={x.overDays ? '1' : '0'} className={r === x ? 'is-selected' : ''}>
                    <td>{t(`r.type.${x.type}`)}</td><td><button type="button" className="btn-link" onClick={() => { setKey(x.key); setPick(null); }} data-testid="ph-res-pick">{x.label}</button></td><td>{x.uom}</td><td className="num">{fmtN(x.total)}</td><td className="num">{fmtN(x.peak)}</td><td>{fmtDate(x.peakDate)}</td>
                    <td className={`num${x.overDays ? ' field-error' : ''}`}>{x.overDays}</td><td>{x.tracked ? t('h.tracked') : t('h.untracked')}</td><td className="num">{x.activities}</td>
                  </tr>))}</tbody>
                <tfoot><tr><th colSpan={3}>{t('h.totalRow', { n: h.resources.length })}</th><td /><td /><td /><td className="num">{h.resources.reduce((a, x) => a + x.overDays, 0)}</td><td /><td /></tr></tfoot>
              </table></div>
              {r && (
                <div className="mdm-panel" data-testid="ph-detail">
                  <h2>{r.label} <span className="muted">({r.uom})</span></h2>
                  <p className="muted" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}><span><span aria-hidden="true" style={{ display: 'inline-block', width: 12, height: 10, background: 'var(--erp-chart-1)' }} /> {t('h.demand')}</span><span><span aria-hidden="true" style={{ display: 'inline-block', width: 12, height: 10, background: 'var(--erp-color-status-error-solid)' }} /> {t('h.over')}</span>{r.tracked && <span><span aria-hidden="true" style={{ display: 'inline-block', width: 14, height: 2, background: 'var(--erp-color-status-success-solid)', verticalAlign: 'middle' }} /> {t('h.available')}</span>}</p>
                  <Bars t={t} r={r} buckets={h.buckets} onPick={setPick} picked={pick} />
                  <div className="table-scroll"><table className="data-table" data-testid="ph-buckets"><caption className="sr-only">{r.label}</caption>
                    <thead><tr><th>{t(`h.bucket.${h.bucket}`)}</th><th className="num">{t('h.demand')}</th><th className="num">{t('h.available')}</th><th className="num">{t('h.peak')}</th><th className="num">{t('h.overDaysCol')}</th><th /></tr></thead>
                    <tbody>{r.buckets.map((b, i) => (b.demand || b.available ? <tr key={h.buckets[i].key} className={b.over ? 'field-error' : ''}><td>{h.buckets[i].key}</td><td className="num">{fmtN(b.demand)}</td><td className="num">{fmtN(b.available)}</td><td className="num">{fmtN(b.peak)}</td><td className="num">{b.overDays}</td><td>{b.demand > 0 && <button type="button" className="btn-link" onClick={() => setPick(i)} data-testid="ph-drill">{t('h.activities')}</button>}</td></tr> : null))}</tbody>
                    <tfoot><tr><th>{t('f.total')}</th><td className="num">{fmtN(r.total)}</td><td className="num">{r.tracked ? fmtN(r.buckets.reduce((a, b) => a + (b.available ?? 0), 0)) : '—'}</td><td className="num">{fmtN(r.peak)}</td><td className="num">{r.overDays}</td><td /></tr></tfoot>
                  </table></div>
                  {pick != null && (dq.isPending ? <Skeleton label={t('h.activities')} rows={2} /> : dq.isError ? <ErrorState error={dq.error} onRetry={dq.refetch} /> : (
                    <div data-testid="ph-drill-result">
                      <h3>{t('h.drillTitle', { r: r.label, a: fmtDate(h.buckets[pick].from), b: fmtDate(h.buckets[pick].to) })}</h3>
                      <div className="table-scroll"><table className="data-table"><caption className="sr-only">{t('h.activities')}</caption><thead><tr><th>{t('f.code')}</th><th>{t('f.activity')}</th><th>{t('f.start')}</th><th>{t('f.finish')}</th><th className="num">{t('r.perDay')}</th><th className="num">{t('h.inBucket')}</th></tr></thead>
                        <tbody>{dq.data.rows.map((x) => <tr key={x.activityId} data-testid="ph-drill-row"><td><Link to={`/plan/gantt?scheduleId=${scheduleId}&activityId=${x.activityId}`}>{x.code}</Link></td><td>{x.name}</td><td>{fmtDate(x.start)}</td><td>{fmtDate(x.finish)}</td><td className="num">{fmtN(x.perDay)}</td><td className="num">{fmtN(x.qty)}</td></tr>)}</tbody>
                        <tfoot><tr><th colSpan={5}>{t('f.total')}</th><td className="num">{fmtN(dq.data.total)}</td></tr></tfoot></table></div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          <Capacity t={t} projectId={h.projectId} perms={perms} />
        </>
      )}
    </section>
  );
}
