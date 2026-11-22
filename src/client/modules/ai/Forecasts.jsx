import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../platform/api/index.js';
import Chart from '../../platform/charts/Chart.jsx';
import { Card } from '../../platform/design/Card.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { useFormat, useT } from '../../platform/i18n/index.js';
import { useSession } from '../core/api/index.js';
import { Field, Link, can, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from '../eng/common.js';
import { downloadReport } from '../bi/api.js';

// Part 28.03: Forecasts & Anomalies (overview page, UI v3 §3.4) with the Model Back-testing report. Forecasts come from /api/v1/ai/forecasts
// with their range, drivers and the label of every point (actual, calculated, forecast — BR-01); an official forecast needs a model version
// approved by the CFO or the project controls manager; anomalies are statistical outliers for a person to confirm or dismiss.

const read = async (path) => (await api.get(path)).data;
const write = (method, path, body) => api[method](path, body, { headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const qs = (o) => { const p = new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v != null)); const s = p.toString(); return s ? `?${s}` : ''; };
const go = (patch) => {
  const p = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(patch)) { if (v === '' || v == null) p.delete(k); else p.set(k, String(v)); }
  navigateTo(`/ai/forecasts${p.toString() ? `?${p}` : ''}`);
};
const TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', RETURNED: 'RETURNED', APPROVED: 'APPROVED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED', SUPERSEDED: 'CANCELLED', BASELINE: 'DRAFT' };
const KIND_TONE = { ACTUAL: 'APPROVED', CALCULATED: 'IN_REVIEW', FORECAST: 'AT_RISK' };
const USE_CASES = ['RATE', 'COLLECTIONS', 'PRODUCTIVITY', 'COMPLETION'];
/** The formatter takes decimals as text (exact); forecasts and metrics are computed numbers, so they go through as strings. */
function useNum() {
  const f = useFormat();
  return { ...f, number: (v, o) => f.number(typeof v === 'number' && !Number.isInteger(v) ? String(v) : v, o) };
}

/** The subject pickers of a use case (item and region, project, project and activity), shared by the forecast and the back-test. */
function SubjectPicker({ useCase, value, onChange, prefix }) {
  const t = useT('af');
  const opts = useQuery({ queryKey: ['af', 'options', value.projectId ?? ''], queryFn: () => read(`/ai/forecasts/options${qs({ projectId: value.projectId })}`), retry: false });
  const o = opts.data;
  if (!o) return opts.error ? <ErrorState error={opts.error} /> : null;
  const set = (patch) => onChange({ ...value, ...patch });
  if (useCase === 'RATE') return <>
    <Field name={`${prefix}-item`} label={`${t('f.item')} *`}><select value={value.itemId ?? ''} onChange={(e) => set({ itemId: e.target.value })}><option value="">{t('f.choose')}</option>{o.items.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}</select></Field>
    <Field name={`${prefix}-region`} label={t('f.region')}><select value={value.region ?? ''} onChange={(e) => set({ region: e.target.value })}><option value="">{t('f.allRegions')}</option>{o.regions.map((r) => <option key={r} value={r}>{r}</option>)}</select></Field>
  </>;
  const projects = o.projects[useCase] ?? [];
  return <>
    <Field name={`${prefix}-project`} label={`${t('f.project')}${useCase === 'COLLECTIONS' ? '' : ' *'}`}><select value={value.projectId ?? ''} onChange={(e) => set({ projectId: e.target.value, activityId: '' })}>
      <option value="">{useCase === 'COLLECTIONS' ? t('f.allProjects') : t('f.choose')}</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></Field>
    {useCase === 'PRODUCTIVITY' && <Field name={`${prefix}-activity`} label={`${t('f.activity')} *`}><select value={value.activityId ?? ''} onChange={(e) => set({ activityId: e.target.value })} disabled={!value.projectId}>
      <option value="">{t('f.choose')}</option>{o.activities.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></Field>}
  </>;
}
const ready = (useCase, s) => (useCase === 'RATE' ? Boolean(s.itemId) : useCase === 'PRODUCTIVITY' ? Boolean(s.projectId && s.activityId) : useCase === 'COMPLETION' ? Boolean(s.projectId) : true);

function ForecastView({ search }) {
  const t = useT('af');
  const { number, date } = useNum();
  const useCase = USE_CASES.includes(search.get('useCase')) ? search.get('useCase') : 'RATE';
  const subject = { itemId: search.get('itemId') ?? '', region: search.get('region') ?? '', projectId: search.get('projectId') ?? '', activityId: search.get('activityId') ?? '' };
  const params = { useCase, ...subject };
  const on = ready(useCase, subject);
  const q = useQuery({ queryKey: ['af', 'forecast', params], queryFn: () => read(`/ai/forecasts${qs(params)}`), enabled: on, retry: false });
  const val = (v) => (v == null ? '—' : number(v, { decimals: useCase === 'COMPLETION' ? 1 : 2 }));
  const picker = <div className="toolbar" data-testid="af-filters">
    <div role="group" aria-label={t('f.useCase')} className="tabs" data-testid="af-use-cases">
      {USE_CASES.map((u) => <button key={u} type="button" aria-pressed={useCase === u} className={`btn${useCase === u ? ' btn-primary' : ''}`} onClick={() => go({ useCase: u === 'RATE' ? '' : u, itemId: '', region: '', activityId: '' })}>{t(`uc.${u}`)}</button>)}
    </div>
    <div className="form-grid"><SubjectPicker useCase={useCase} value={subject} prefix="af" onChange={(v) => go({ itemId: v.itemId, region: v.region, projectId: v.projectId, activityId: v.activityId })} /></div>
  </div>;
  if (!on) return <>{picker}<EmptyState title={t('pick')} message={t(`pickBody.${useCase}`)} /></>;
  if (q.isPending) return <>{picker}<Skeleton label={t('title')} rows={6} /></>;
  if (q.error?.status === 403) return <>{picker}<EmptyState title={t('hidden')} message={q.error.message} /></>;
  if (q.error) return <>{picker}<ErrorState error={q.error} onRetry={q.refetch} /></>;
  const f = q.data;
  const hist = f.history; const fc = f.points.filter((p) => p.kind === 'FORECAST');
  const cats = f.points.map((p) => p.period);
  const lastI = hist.length - 1;
  const chart = { categories: cats, unit: f.unit, series: [
    { name: t('k.history'), values: f.points.map((p, i) => (i <= lastI ? p.value : null)) },
    { name: t('k.FORECAST'), values: f.points.map((p, i) => (i === lastI ? p.value : i > lastI ? p.value : null)) },
    { name: t('low'), values: f.points.map((p, i) => (i > lastI ? p.low : null)) },
    { name: t('high'), values: f.points.map((p, i) => (i > lastI ? p.high : null)) },
  ] };
  return <>
    {picker}
    <div className="actions-row" data-testid="af-label">
      <StatusBadge status="AT_RISK" label={f.label} />
      {f.official ? <StatusBadge status="APPROVED" label={t('official', { model: `${f.model.code} v${f.model.version}` })} /> : <StatusBadge status="DRAFT" label={t('preview', { method: f.model.methodLabel })} />}
    </div>
    {f.empty ? <EmptyState title={t('notEnough')} message={f.empty} /> : <>
      <KpiRow testid="af-tiles" label={f.subject.label}>
        <KpiTile testid="af-next" label={t('t.next', { period: f.next?.period ?? '—' })} value={val(f.next?.value)}>{f.next ? t('t.range', { low: val(f.next.low), high: val(f.next.high) }) : null}</KpiTile>
        <KpiTile label={t('t.last', { period: hist.at(-1)?.period ?? '—' })} value={val(hist.at(-1)?.value)}>{t(`k.${hist.at(-1)?.kind ?? 'ACTUAL'}`)}</KpiTile>
        <KpiTile testid="af-mape" label={t('t.mape')} value={f.backtest?.mape != null ? `${number(f.backtest.mape, { decimals: 1 })}%` : '—'} tone={f.backtest?.mape == null ? 'neutral' : f.backtest.mape <= 10 ? 'success' : 'warning'}>{f.backtest ? t('t.backtestNote', { n: f.backtest.n, cover: f.backtest.coverage ?? '—' }) : t('t.noBacktest')}</KpiTile>
        {f.completion?.date !== undefined && <KpiTile testid="af-completion" label={useCase === 'COMPLETION' ? t('t.completion') : t('t.finishRemaining', { qty: val(f.completion.remainingQty) })} value={f.completion.date ? date(f.completion.date) : '—'}>
          {useCase === 'COMPLETION' ? (f.completion.beyond ?? t('t.completionRange', { early: f.completion.early ? date(f.completion.early) : '—', late: f.completion.late ? date(f.completion.late) : t('t.beyond'), sched: f.completion.scheduled ? date(f.completion.scheduled) : '—' })) : t('t.weeksLeft', { n: f.completion.weeksLeft ?? '—' })}</KpiTile>}
      </KpiRow>
      <Card title={t('c.chart', { unit: f.unit })} subtitle={f.subject.label} testid="af-card-chart"><Chart type="line" title={t('c.chart', { unit: f.unit })} data={chart} exportName={`forecast-${useCase.toLowerCase()}`} tableSwitch /></Card>
      <Card title={t('c.drivers')} subtitle={`${f.model.methodLabel} · ${f.useCaseLabel}`} testid="af-card-drivers">
        <ul className="af-drivers" data-testid="af-drivers">{f.drivers.map((d) => <li key={d.name}><span>{d.name}</span>{d.value != null && <strong>{number(d.value, { decimals: 2 })}</strong>}</li>)}</ul>
        <p className="muted small">{t('sources')}: {f.sources.map((s, i) => <span key={s.label}>{i ? ' · ' : ''}<Link to={s.route}>{s.label}</Link></span>)}</p>
      </Card>
      <Card title={t('c.points')} count={{ shown: Math.min(6, hist.length) + fc.length, total: f.points.length }} testid="af-card-points">
        <div className="table-scroll"><table className="data-table" data-testid="af-points">
          <thead><tr><th>{t('c.period')}</th><th>{t('c.kind')}</th><th className="num">{t('c.value')}</th><th className="num">{t('low')}</th><th className="num">{t('high')}</th></tr></thead>
          <tbody>{[...hist.slice(-6), ...fc].map((p) => <tr key={`${p.kind}-${p.period}`} data-kind={p.kind}>
            <td data-label={t('c.period')}>{p.period}</td><td data-label={t('c.kind')}><StatusBadge status={KIND_TONE[p.kind]} label={t(`k.${p.kind}`)} size="sm" /></td>
            <td data-label={t('c.value')} className="num">{val(p.value)}</td><td data-label={t('low')} className="num">{p.low == null ? '—' : val(p.low)}</td><td data-label={t('high')} className="num">{p.high == null ? '—' : val(p.high)}</td>
          </tr>)}</tbody>
        </table></div>
        <p className="muted small">{t('neverActual')}</p>
      </Card>
    </>}
  </>;
}

function Anomalies({ search }) {
  const t = useT('af');
  const { number } = useNum();
  const cache = useQueryClient();
  const status = search.get('status') ?? 'OPEN'; const kind = search.get('kind') ?? ''; const projectId = search.get('projectId') ?? '';
  const q = useQuery({ queryKey: ['af', 'anomalies', status, kind, projectId], queryFn: () => read(`/ai/anomalies${qs({ status, kind, projectId })}`), retry: false });
  const [review, setReview] = useState(null);
  const run = useMutation({ mutationFn: () => write('post', '/ai/anomalies/run'), onSuccess: () => cache.invalidateQueries({ queryKey: ['af', 'anomalies'] }) });
  const act = useMutation({ mutationFn: ({ id, outcome, note }) => write('post', `/ai/anomalies/${id}/review`, { outcome, note }), onSuccess: () => { setReview(null); cache.invalidateQueries({ queryKey: ['af', 'anomalies'] }); } });
  if (q.isPending) return <Skeleton label={t('tab.anomalies')} rows={6} />;
  if (q.error?.status === 403) return <NoPermission message={q.error.message} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  return <>
    <KpiRow testid="af-anomaly-tiles" label={t('tab.anomalies')}>
      {d.kinds.map((k) => <KpiTile key={k.code} label={t(`ak.${k.code}`)} value={number(d.open[k.code] ?? 0)} tone={d.open[k.code] ? 'warning' : 'success'} to={`/ai/forecasts?tab=anomalies&kind=${k.code}`}>{t('open')}</KpiTile>)}
    </KpiRow>
    <div className="toolbar">
      <Field name="af-status" label={t('f.status')}><select value={status} onChange={(e) => go({ status: e.target.value === 'OPEN' ? '' : e.target.value })}>{['OPEN', 'CONFIRMED', 'DISMISSED', 'ALL'].map((s) => <option key={s} value={s}>{t(`as.${s}`)}</option>)}</select></Field>
      <Field name="af-kind" label={t('f.kind')}><select value={kind} onChange={(e) => go({ kind: e.target.value })}><option value="">{t('f.allKinds')}</option>{d.kinds.map((k) => <option key={k.code} value={k.code}>{t(`ak.${k.code}`)}</option>)}</select></Field>
      {d.canRun && <button type="button" className="btn" onClick={() => run.mutate()} disabled={run.isPending} data-testid="af-run">{run.isPending ? t('running') : t('run')}</button>}
    </div>
    {run.data && <p className="muted small" role="status" data-testid="af-run-result">{t('ran', { n: run.data.data.flagged, c: run.data.data.candidates })}</p>}
    {run.error && <ErrorState error={run.error} />}
    <p className="muted small">{t('threshold', { z: d.threshold })}</p>
    {!d.rows.length ? <EmptyState title={t('noAnomalies')} message={t('noAnomaliesBody')} action={d.canRun ? <button type="button" className="btn" onClick={() => run.mutate()}>{t('run')}</button> : null} /> :
      <Card title={t('tab.anomalies')} count={{ shown: d.rows.length, total: d.total }} testid="af-card-anomalies">
        <div className="table-scroll"><table className="data-table" data-testid="af-anomalies">
          <thead><tr><th>{t('c.kind')}</th><th>{t('c.subject')}</th><th>{t('c.detail')}</th><th className="num">{t('c.score')}</th><th>{t('f.status')}</th><th>{t('c.action')}</th></tr></thead>
          <tbody>{d.rows.map((a) => <tr key={a.id} data-testid="af-anomaly" data-kind={a.kind}>
            <td data-label={t('c.kind')}>{t(`ak.${a.kind}`)}</td><td data-label={t('c.subject')}>{a.route ? <Link to={a.route}>{a.subject}</Link> : a.subject}</td><td data-label={t('c.detail')} className="small">{a.detail}</td>
            <td data-label={t('c.score')} className="num">{a.score == null ? '—' : number(a.score, { decimals: 1 })}</td>
            <td data-label={t('f.status')}><StatusBadge status={a.status === 'OPEN' ? 'AT_RISK' : a.status === 'CONFIRMED' ? 'REJECTED' : 'CANCELLED'} label={t(`as.${a.status}`)} size="sm" />{a.reviewedBy && <div className="muted small">{a.reviewedBy}: {a.note}</div>}</td>
            <td data-label={t('c.action')}>{a.status === 'OPEN' && d.canReview && (review?.id === a.id ? <form className="af-review" onSubmit={(e) => { e.preventDefault(); act.mutate(review); }}>
              <Field name={`af-note-${a.id}`} label={`${t('note')} *`}><input required minLength={5} value={review.note} onChange={(e) => setReview({ ...review, note: e.target.value })} /></Field>
              <div className="actions-row"><button type="submit" className="btn btn-primary btn-small" disabled={act.isPending}>{t(review.outcome === 'CONFIRMED' ? 'confirm' : 'dismiss')}</button><button type="button" className="btn btn-small" onClick={() => setReview(null)}>{t('cancel')}</button></div>
              {act.error && <ErrorState error={act.error} />}
            </form> : <div className="actions-row">
              <button type="button" className="btn btn-small" onClick={() => setReview({ id: a.id, outcome: 'CONFIRMED', note: '' })} data-testid="af-confirm">{t('confirm')}</button>
              <button type="button" className="btn btn-small" onClick={() => setReview({ id: a.id, outcome: 'DISMISSED', note: '' })}>{t('dismiss')}</button>
            </div>)}</td>
          </tr>)}</tbody>
        </table></div>
      </Card>}
  </>;
}

function ModelDetail({ id }) {
  const t = useT('af');
  const { number, dateTime } = useNum();
  const cache = useQueryClient();
  const q = useQuery({ queryKey: ['af', 'model', id], queryFn: () => read(`/ai/models/${id}`), retry: false });
  const [subject, setSubject] = useState({});
  const [why, setWhy] = useState('');
  const [format, setFormat] = useState('xlsx');
  const act = useMutation({ mutationFn: ({ path, body }) => write('post', `/ai/models/${id}${path}`, body), onSuccess: (res) => { setWhy(''); cache.invalidateQueries({ queryKey: ['af'] }); if (res.data?.id && String(res.data.id) !== String(id)) go({ id: res.data.id }); } });
  const download = useMutation({ mutationFn: () => downloadReport(`/api/v1/ai/models/${id}/backtest/export?format=${format}`, `backtest.${format}`) });
  if (q.isPending) return <Skeleton label={t('m.detail')} rows={6} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const m = q.data; const bt = m.backtest;
  const body = (s) => Object.fromEntries(Object.entries(s).filter(([, v]) => v !== '' && v != null).map(([k, v]) => [k, k === 'region' ? v : Number(v)]));
  return <Card title={`${m.name} · v${m.version}`} subtitle={`${m.docNo} · ${m.code} · ${m.useCaseLabel}`} testid="af-model" menu={<button type="button" className="btn" onClick={() => go({ id: '' })}>{t('back')}</button>}>
    <div className="actions-row"><StatusBadge status={TONE[m.status]} label={t(`st.${m.status}`)} />{m.official && <StatusBadge status="APPROVED" label={t('m.official')} />}</div>
    <dl className="kv"><dt>{t('m.method')}</dt><dd>{m.methodLabel}</dd><dt>{t('m.params')}</dt><dd><code>{JSON.stringify(m.params)}</code></dd><dt>{t('m.horizon')}</dt><dd>{m.horizon}</dd>
      {m.approvedBy && <><dt>{t('m.approved')}</dt><dd>{m.approvedBy} · {dateTime(m.approvedAt)}</dd></>}</dl>
    <h3>{t('b.title')}</h3>
    {m.can.backtest && <form className="form-grid" data-testid="af-backtest-form" onSubmit={(e) => { e.preventDefault(); act.mutate({ path: '/backtest', body: body(subject) }); }}>
      <SubjectPicker useCase={m.useCase} value={subject} prefix="af-bt" onChange={setSubject} />
      <div className="actions-row"><button type="submit" className="btn" disabled={act.isPending || !ready(m.useCase, subject)} data-testid="af-backtest">{t('b.run')}</button></div>
    </form>}
    {!bt ? <p className="muted">{t('b.none')}</p> : <>
      <KpiRow testid="af-backtest-tiles" label={t('b.title')}>
        <KpiTile label="MAE" value={number(bt.mae, { decimals: 2 })}>{t('b.naive', { v: bt.naive?.mae ?? '—' })}</KpiTile>
        <KpiTile testid="af-bt-mape" label="MAPE" value={bt.mape == null ? '—' : `${number(bt.mape, { decimals: 1 })}%`} tone={bt.mape != null && bt.mape <= 10 ? 'success' : 'warning'}>{t('b.points', { n: bt.n })}</KpiTile>
        <KpiTile label="RMSE" value={number(bt.rmse, { decimals: 2 })}>{t('b.bias', { v: bt.bias })}</KpiTile>
        <KpiTile label={t('b.coverage')} value={bt.coverage == null ? '—' : `${number(bt.coverage, { decimals: 1 })}%`}>{t('b.skill', { v: bt.skill == null ? '—' : `${Math.round(bt.skill * 100)}%` })}</KpiTile>
      </KpiRow>
      <p className="muted small">{t('b.on', { subject: bt.subject, at: dateTime(bt.at) })}</p>
      <div className="table-scroll"><table className="data-table" data-testid="af-backtest-rows">
        <thead><tr><th>{t('c.period')}</th><th className="num">{t('k.ACTUAL')}</th><th className="num">{t('b.oneStep')}</th><th className="num">{t('b.error')}</th><th className="num">{t('low')}</th><th className="num">{t('high')}</th></tr></thead>
        <tbody>{bt.rows.map((r) => <tr key={r.period}><td data-label={t('c.period')}>{r.period}</td><td data-label={t('k.ACTUAL')} className="num">{number(r.actual, { decimals: 2 })}</td><td data-label={t('b.oneStep')} className="num">{number(r.forecast, { decimals: 2 })}</td>
          <td data-label={t('b.error')} className="num">{number(r.error, { decimals: 2 })}</td><td data-label={t('low')} className="num">{r.low == null ? '—' : number(r.low, { decimals: 2 })}</td><td data-label={t('high')} className="num">{r.high == null ? '—' : number(r.high, { decimals: 2 })}</td></tr>)}</tbody>
      </table></div>
      <div className="actions-row"><label className="sr-only" htmlFor="af-format">{t('format')}</label><select id="af-format" value={format} onChange={(e) => setFormat(e.target.value)}>{['xlsx', 'csv', 'pdf'].map((x) => <option key={x} value={x}>{x.toUpperCase()}</option>)}</select>
        <button type="button" className="btn" onClick={() => download.mutate()} disabled={download.isPending} data-testid="af-bt-export">{t('export')}</button></div>
      {download.error && <ErrorState error={download.error} />}
    </>}
    {act.error && <ErrorState error={act.error} />}
    <div className="actions-row">
      {m.can.submit && <button type="button" className="btn btn-primary" onClick={() => act.mutate({ path: '/submit' })} disabled={act.isPending || !bt} data-testid="af-submit">{t('m.submit')}</button>}
      {m.approval?.taskId && <Link to={`/workflow/tasks?task=${m.approval.taskId}`}>{t('m.openTask')}</Link>}
    </div>
    {(m.can.retire || m.can.amend) && <div className="form-grid">
      <Field name="af-why" label={t('m.reason')}><input value={why} minLength={5} onChange={(e) => setWhy(e.target.value)} /></Field>
      <div className="actions-row">
        {m.can.retire && <button type="button" className="btn" disabled={why.trim().length < 5 || act.isPending} onClick={() => act.mutate({ path: '/retire', body: { reason: why } })}>{t('m.retire')}</button>}
        {m.can.amend && <button type="button" className="btn" disabled={why.trim().length < 5 || act.isPending} onClick={() => act.mutate({ path: '/amend', body: { reason: why } })} data-testid="af-amend">{t('m.amend')}</button>}
      </div>
    </div>}
  </Card>;
}

function Models({ search }) {
  const t = useT('af');
  const { number } = useNum();
  const cache = useQueryClient();
  const q = useQuery({ queryKey: ['af', 'models'], queryFn: () => read('/ai/models'), retry: false });
  const [form, setForm] = useState(null);
  const create = useMutation({ mutationFn: (b) => write('post', '/ai/models', b), onSuccess: (res) => { setForm(null); cache.invalidateQueries({ queryKey: ['af'] }); go({ id: res.data.id }); } });
  const id = search.get('id');
  if (id) return <ModelDetail id={id} />;
  if (q.isPending) return <Skeleton label={t('tab.models')} rows={5} />;
  if (q.error?.status === 403) return <NoPermission message={q.error.message} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  const method = d.methods.find((x) => x.code === form?.method);
  return <>
    {d.canCreate && !form && <button type="button" className="btn btn-primary" onClick={() => setForm({ code: '', name: '', useCase: 'RATE', method: 'REGRESSION', params: {}, horizon: '6' })} data-testid="af-new-model">{t('m.new')}</button>}
    {form && <Card title={t('m.new')} testid="af-model-form"><form className="form-grid" onSubmit={(e) => { e.preventDefault(); create.mutate({ code: form.code.toUpperCase(), name: form.name, useCase: form.useCase, method: form.method, horizon: Number(form.horizon),
      params: Object.fromEntries(Object.entries(form.params).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)])) }); }}>
      <Field name="af-code" label={`${t('m.code')} *`} hint={t('m.codeHint')}><input required pattern="[A-Za-z][A-Za-z0-9_]{1,39}" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
      <Field name="af-name" label={`${t('m.name')} *`}><input required minLength={3} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      <Field name="af-uc" label={`${t('f.useCase')} *`}><select value={form.useCase} onChange={(e) => setForm({ ...form, useCase: e.target.value })}>{USE_CASES.map((u) => <option key={u} value={u}>{t(`uc.${u}`)}</option>)}</select></Field>
      <Field name="af-method" label={`${t('m.method')} *`}><select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value, params: {} })}>{d.methods.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}</select></Field>
      {Object.entries(method?.params ?? {}).map(([k, [def, min, max]]) => <Field key={k} name={`af-p-${k}`} label={t(`p.${k}`)} hint={t('m.between', { min, max, def })}>
        <input type="number" inputMode="decimal" step="any" min={min} max={max} placeholder={String(def)} value={form.params[k] ?? ''} onChange={(e) => setForm({ ...form, params: { ...form.params, [k]: e.target.value } })} /></Field>)}
      <Field name="af-horizon" label={t('m.horizon')}><input type="number" inputMode="numeric" min={1} max={24} value={form.horizon} onChange={(e) => setForm({ ...form, horizon: e.target.value })} /></Field>
      <div className="actions-row"><button type="submit" className="btn btn-primary" disabled={create.isPending}>{t('save')}</button><button type="button" className="btn" onClick={() => setForm(null)}>{t('cancel')}</button></div>
      {create.error && <ErrorState error={create.error} />}
    </form></Card>}
    {!d.rows.length ? <EmptyState title={t('m.none')} message={t('m.noneBody')} /> : <Card title={t('tab.models')} count={{ shown: d.rows.length, total: d.rows.length }} testid="af-card-models">
      <div className="table-scroll"><table className="data-table" data-testid="af-models">
        <thead><tr><th>{t('m.code')}</th><th>{t('f.useCase')}</th><th>{t('m.method')}</th><th>{t('f.status')}</th><th className="num">MAPE</th></tr></thead>
        <tbody>{d.rows.map((m) => <tr key={m.id} data-testid="af-model-row"><td data-label={t('m.code')}><Link to={`/ai/forecasts?tab=models&id=${m.id}`}>{m.code} v{m.version}</Link></td><td data-label={t('f.useCase')}>{t(`uc.${m.useCase}`)}</td>
          <td data-label={t('m.method')}>{m.methodLabel}</td><td data-label={t('f.status')}><StatusBadge status={TONE[m.status]} label={m.official ? t('m.official') : t(`st.${m.status}`)} size="sm" /></td>
          <td data-label="MAPE" className="num">{m.backtest?.mape == null ? '—' : `${number(m.backtest.mape, { decimals: 1 })}%`}</td></tr>)}</tbody>
      </table></div>
    </Card>}
  </>;
}

export function ForecastsPage() {
  const t = useT('af');
  const session = useSession();
  const search = useSearch();
  usePageTitle(t('title'));
  const tabs = ['forecasts', ...(can(session.data, 'ai.anomaly.view') ? ['anomalies'] : []), ...(can(session.data, 'ai.model.view') ? ['models'] : [])];
  const tab = tabs.includes(search.get('tab')) ? search.get('tab') : 'forecasts';
  return <section aria-labelledby="af-h" data-testid="af-page">
    <PageHeader id="af-h" title={t('title')} subtitle={t('subtitle')} />
    <div role="tablist" aria-label={t('title')} className="tabs" data-testid="af-tabs">
      {tabs.map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} data-tab={k} className={`btn${tab === k ? ' btn-primary' : ''}`} onClick={() => go({ tab: k === 'forecasts' ? '' : k, id: '', status: '', kind: '' })}>{t(`tab.${k}`)}</button>)}
    </div>
    {tab === 'forecasts' && <ForecastView search={search} />}
    {tab === 'anomalies' && <Anomalies search={search} />}
    {tab === 'models' && <Models search={search} />}
  </section>;
}
