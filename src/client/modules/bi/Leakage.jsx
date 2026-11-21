import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../platform/api/index.js';
import Chart from '../../platform/charts/Chart.jsx';
import { Card, CardGrid } from '../../platform/design/Card.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { useFormat, useT } from '../../platform/i18n/index.js';
import { useSession } from '../core/api/index.js';
import { Field, Link, Pager, can, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from '../eng/common.js';
import { downloadReport } from './api.js';

// Part 27.09: the Leakage & Controls Tower (overview page, UI v3 §3.4) with the findings worklist and the detection rules (configuration).
// Every figure comes from GET /bi/leakage, /bi/findings and /bi/detection-rules. Findings are advisory: a closure always records an outcome,
// and a false positive goes to the internal auditor through the approval inbox.

const read = async (path) => (await api.get(path)).data;
const write = (path, body) => api.post(path, body, { headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const qs = (o) => { const p = new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v != null)); const s = p.toString(); return s ? `?${s}` : ''; };
const go = (patch, reset = false) => {
  const p = new URLSearchParams(reset ? '' : window.location.search);
  for (const [k, v] of Object.entries(patch)) { if (v === '' || v == null) p.delete(k); else p.set(k, String(v)); }
  navigateTo(`/bi/leakage${p.toString() ? `?${p}` : ''}`);
};
const SEV = { CRITICAL: 'REJECTED', WARNING: 'AT_RISK', INFO: 'DRAFT' };
const ST = { OPEN: 'SUBMITTED', IN_REVIEW: 'IN_REVIEW', PENDING_FP: 'AT_RISK', CLOSED: 'APPROVED' };

function useInr() { const { money } = useFormat(); return (v) => (v == null ? '—' : money(String(v))); }

function Tower({ search }) {
  const t = useT('lk');
  const inr = useInr();
  const { number } = useFormat();
  const projectId = search.get('projectId') ?? '';
  const q = useQuery({ queryKey: ['bi', 'leakage', projectId], queryFn: () => read(`/bi/leakage${qs({ projectId })}`), retry: false, placeholderData: (p) => p });
  if (q.isPending) return <Skeleton label={t('tab.tower')} rows={6} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data; const T = d.tiles;
  const fl = (extra) => `/bi/leakage?tab=findings${projectId ? `&projectId=${projectId}` : ''}${extra}`;
  const byRule = { categories: d.byRule.map((r) => r.rule), series: [{ name: t('c.value'), values: d.byRule.map((r) => r.valueAtRisk), drill: d.byRule.map((r) => r.drill) }], unit: '₹' };
  const trend = { categories: d.trend.categories, series: [{ name: t('c.findings'), values: d.trend.findings }, { name: t('c.exceptions'), values: d.trend.exceptions }] };
  return <>
    <div className="actions-row" data-testid="lk-filters">
      <Field name="lk-project" label={t('f.project')}><select value={projectId} onChange={(e) => go({ projectId: e.target.value })}><option value="">{t('f.all')}</option>{d.projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></Field>
    </div>
    <KpiRow testid="lk-tiles" label={t('tab.tower')}>
      <KpiTile testid="lk-tile-risk" valueTestid="lk-risk" label={t('t.risk')} kind="money" amount={T.valueAtRisk} value={inr(T.valueAtRisk)} tone={T.valueAtRisk ? 'warning' : 'success'} to={fl('&status=ACTIVE&sort=value')}>{t('t.openCount', { n: T.open })}</KpiTile>
      <KpiTile testid="lk-tile-overdue" label={t('t.overdue')} kind="risk" value={number(String(T.overdue), { decimals: 0 })} tone={T.overdue ? 'error' : 'success'} to={fl('&overdue=1')} />
      <KpiTile label={t('t.loss')} kind="money" amount={T.confirmedLoss} value={inr(T.confirmedLoss)} tone={T.confirmedLoss ? 'error' : 'neutral'} to={fl('&outcome=CONFIRMED_LOSS&status=CLOSED')} />
      <KpiTile label={t('t.prevented')} kind="count" value={number(String(T.prevented), { decimals: 0 })} to={fl('&outcome=PREVENTED&status=CLOSED')} />
      <KpiTile label={t('t.fpRate')} kind="percent" value={T.falsePositiveRate == null ? '—' : `${number(String(T.falsePositiveRate), { decimals: 1 })}%`} to={fl('&outcome=FALSE_POSITIVE&status=CLOSED')}>{t('t.closed', { n: T.closed })}</KpiTile>
      <KpiTile label={t('t.pendingFp')} kind="count" value={number(String(T.pendingFalsePositive), { decimals: 0 })} to={fl('&status=PENDING_FP')} />
    </KpiRow>
    <CardGrid testid="lk-cards">
      <Card title={t('c.pending')} testid="lk-card-pending" viewAll={fl('&mine=1&status=ACTIVE')} viewAllLabel={t('viewAll')}>
        <ul className="wd-todo">
          <li><Link to={fl('&mine=1&status=ACTIVE')}>{t('c.mine', { n: d.pending.mine })}</Link></li>
          <li><Link to="/workflow/tasks">{t('c.approvals', { n: d.pending.approvals })}</Link></li>
        </ul>
      </Card>
      <Card title={t('c.byRule')} subtitle={t('c.byRuleSub')} testid="lk-card-rules" viewAll={fl('&status=ACTIVE')} viewAllLabel={t('viewAll')}>
        {d.byRule.length ? <Chart type="bar" data={byRule} title={t('c.byRule')} onDrill={(to) => navigateTo(to)} exportName="leakage-by-rule" /> : <EmptyState compact title={t('empty')} />}
      </Card>
      <Card title={t('c.trend')} subtitle={t('c.trendSub')} testid="lk-card-trend">
        {d.trend.categories.length ? <Chart type="line" data={trend} title={t('c.trend')} exportName="leakage-trend" /> : <EmptyState compact title={t('empty')} />}
      </Card>
      <Card title={t('c.controls')} subtitle={t('c.controlsSub')} testid="lk-card-controls" viewAll={d.controls?.route} viewAllLabel={t('viewAll')}>
        {!d.controls ? <EmptyState compact title={t('c.noControls')} /> : <>
          <div className="actions-row" data-testid="lk-modes">{['ENFORCE', 'WARN', 'OBSERVE', 'OFF'].map((m) => <StatusBadge key={m} status={m === 'ENFORCE' ? 'APPROVED' : m === 'OBSERVE' ? 'IN_REVIEW' : m === 'WARN' ? 'AT_RISK' : 'DRAFT'} label={`${t(`mode.${m}`)}: ${d.controls.modes[m]}`} size="sm" />)}</div>
          <ul className="wd-topn">{d.controls.list.slice(0, 6).map((c) => <li key={c.code} className="wd-topn-row"><span className="wd-topn-label">{c.code} · {c.description}</span><span className="wd-topn-value">{t(`mode.${c.mode}`)}</span></li>)}</ul>
        </>}
      </Card>
      <Card title={t('c.byProject')} testid="lk-card-projects" viewAll={fl('&status=ACTIVE')} viewAllLabel={t('viewAll')}>
        {!d.byProject.length ? <EmptyState compact title={t('empty')} /> : <ul className="wd-topn">{d.byProject.map((p) => <li key={p.projectId ?? 0} className="wd-topn-row"><span className="wd-topn-label"><Link to={p.drill}>{p.project}</Link> · {t('t.openCount', { n: p.count })}</span><span className="wd-topn-value">{inr(p.valueAtRisk)}</span></li>)}</ul>}
      </Card>
      <Card title={t('c.top')} testid="lk-card-top" viewAll={fl('&status=ACTIVE&sort=value')} viewAllLabel={t('viewAll')}>
        {!d.top.length ? <EmptyState compact title={t('empty')} /> : <ul className="wd-topn">{d.top.map((f) => <li key={f.id} className="wd-topn-row"><span className="wd-topn-label"><Link to={`/bi/leakage?tab=findings&id=${f.id}`}>{f.docNo}</Link> {f.title}</span><span className="wd-topn-value">{inr(f.valueAtRisk)}</span></li>)}</ul>}
      </Card>
    </CardGrid>
  </>;
}

function FindingDetail({ id }) {
  const t = useT('lk');
  const inr = useInr();
  const { dateTime } = useFormat();
  const cache = useQueryClient();
  const q = useQuery({ queryKey: ['bi', 'finding', id], queryFn: () => read(`/bi/findings/${id}`), retry: false });
  const [outcome, setOutcome] = useState('');
  const [resolution, setResolution] = useState('');
  const [loss, setLoss] = useState('');
  const refresh = () => cache.invalidateQueries({ queryKey: ['bi'] });
  const review = useMutation({ mutationFn: () => write(`/bi/findings/${id}/review`, { rowVersion: q.data.rowVersion }), onSuccess: refresh });
  const close = useMutation({ mutationFn: () => write(`/bi/findings/${id}/close`, { outcome, resolution, rowVersion: q.data.rowVersion, ...(outcome === 'CONFIRMED_LOSS' ? { lossAmount: Number(loss) } : {}) }),
    onSuccess: () => { setOutcome(''); setResolution(''); setLoss(''); return refresh(); } });
  if (q.isPending) return <Skeleton label={t('d.title')} rows={5} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const f = q.data; const ev = f.evidence ?? {};
  const fields = Object.entries(ev).filter(([k, v]) => k !== 'route' && v != null && typeof v !== 'object');
  return <Card title={`${f.docNo} · ${f.rule}`} subtitle={f.title} testid="lk-finding"
    menu={<button type="button" className="btn" onClick={() => go({ id: '' })}>{t('d.back')}</button>}>
    <div className="actions-row"><StatusBadge status={ST[f.status]} label={t(`st.${f.status}`)} /><StatusBadge status={SEV[f.severity]} label={t(`sev.${f.severity}`)} />{f.outcome && <StatusBadge status={f.outcome === 'FALSE_POSITIVE' ? 'DRAFT' : f.outcome === 'PREVENTED' ? 'APPROVED' : 'REJECTED'} label={t(`oc.${f.outcome}`)} />}</div>
    <KpiRow>
      <KpiTile label={t('t.valueAtRisk')} kind="money" amount={f.valueAtRisk} value={inr(f.valueAtRisk)} to={ev.route} />
      {f.lossAmount != null && <KpiTile label={t('t.loss')} kind="money" amount={f.lossAmount} value={inr(f.lossAmount)} />}
    </KpiRow>
    <dl className="kv" data-testid="lk-evidence">
      <dt>{t('d.owner')}</dt><dd>{f.owner ?? f.ownerRole ?? '—'} <span className="muted small">({f.ownerBasis})</span></dd>
      <dt>{t('d.project')}</dt><dd>{f.project ?? t('d.company')}</dd>
      <dt>{t('d.detected')}</dt><dd>{dateTime(f.detectedAt)} · {t('d.seen', { n: f.occurrences })}</dd>
      <dt>{t('d.due')}</dt><dd className={f.overdue ? 'why-neg' : ''}>{dateTime(f.dueAt)}{f.escalatedAt ? ` · ${t('d.escalated')}` : ''}</dd>
      {fields.map(([k, v]) => <Fragment key={k}><dt>{t(`ev.${k}`)}</dt><dd>{String(v)}</dd></Fragment>)}
      <dt>{t('d.method')}</dt><dd className="small muted">{f.method}</dd>
      {f.resolution && <><dt>{t('d.resolution')}</dt><dd>{f.resolution}</dd></>}
    </dl>
    <div className="actions-row">
      {ev.route && <Link to={ev.route}>{t('d.record')}</Link>}
      {(ev.orders ?? []).map((o) => <Link key={o.docNo} to={o.route}>{o.docNo}</Link>)}
      {ev.first?.route && <Link to={ev.first.route}>{ev.first.docNo}</Link>}
      {f.approvalTaskId && <Link to={`/workflow/tasks?task=${f.approvalTaskId}`}>{t('d.approvalTask')}</Link>}
      {f.can.start && <button type="button" className="btn" onClick={() => review.mutate()} disabled={review.isPending} data-testid="lk-review">{t('d.review')}</button>}
    </div>
    {review.error && <ErrorState error={review.error} />}
    {f.can.close && <form data-testid="lk-close" onSubmit={(e) => { e.preventDefault(); close.mutate(); }}>
      <p className="muted small">{t('d.advisory')}</p>
      <Field name="lk-outcome" label={t('d.outcome')}><select required value={outcome} onChange={(e) => setOutcome(e.target.value)}><option value="">{t('d.choose')}</option>{['CONFIRMED_LOSS', 'PREVENTED', 'FALSE_POSITIVE'].map((o) => <option key={o} value={o}>{t(`oc.${o}`)}</option>)}</select></Field>
      {outcome === 'CONFIRMED_LOSS' && <Field name="lk-loss" label={t('d.loss')}><input type="number" inputMode="decimal" min={0} step="any" required value={loss} onChange={(e) => setLoss(e.target.value)} /></Field>}
      <Field name="lk-resolution" label={outcome === 'FALSE_POSITIVE' ? t('d.fpReason') : t('d.resolution')} hint={outcome === 'FALSE_POSITIVE' ? t('d.fpHint') : undefined}><textarea required minLength={outcome === 'FALSE_POSITIVE' ? 10 : 5} maxLength={1000} value={resolution} onChange={(e) => setResolution(e.target.value)} /></Field>
      <button type="submit" className="btn btn-primary" disabled={close.isPending || !outcome} data-testid="lk-close-submit">{outcome === 'FALSE_POSITIVE' ? t('d.sendFp') : t('d.close')}</button>
      {close.error && <ErrorState error={close.error} />}
    </form>}
  </Card>;
}

function Findings({ search, canExport }) {
  const t = useT('lk');
  const inr = useInr();
  const { date } = useFormat();
  const id = search.get('id');
  const filters = { status: search.get('status') ?? 'ACTIVE', ruleCode: search.get('ruleCode') ?? '', projectId: search.get('projectId') ?? '', outcome: search.get('outcome') ?? '', mine: search.get('mine') ?? '', overdue: search.get('overdue') ?? '', sort: search.get('sort') ?? '' };
  const page = Number(search.get('page') ?? 1);
  const q = useQuery({ queryKey: ['bi', 'findings', filters, page], queryFn: () => read(`/bi/findings${qs({ ...filters, page, pageSize: 25 })}`), retry: false, placeholderData: (p) => p, enabled: !id });
  const rules = useQuery({ queryKey: ['bi', 'det-rule-names'], queryFn: () => read('/bi/detection-rules').catch(() => ({ rules: [] })), retry: false });
  const [format, setFormat] = useState('xlsx');
  const download = useMutation({ mutationFn: () => downloadReport(`/api/v1/bi/findings/export${qs({ ...filters, format })}`, `leakage-findings.${format}`) });
  if (id) return <FindingDetail id={id} />;
  return <>
    <div className="actions-row" data-testid="lk-finding-filters">
      <Field name="lk-status" label={t('f.status')}><select value={filters.status} onChange={(e) => go({ status: e.target.value, page: '' })}>{['ACTIVE', 'OPEN', 'IN_REVIEW', 'PENDING_FP', 'CLOSED'].map((s) => <option key={s} value={s}>{t(`st.${s}`)}</option>)}</select></Field>
      <Field name="lk-rule" label={t('f.rule')}><select value={filters.ruleCode} onChange={(e) => go({ ruleCode: e.target.value, page: '' })}><option value="">{t('f.all')}</option>{(rules.data?.rules ?? []).map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}</select></Field>
      <Field name="lk-mine" label={t('f.mine')}><select value={filters.mine} onChange={(e) => go({ mine: e.target.value, page: '' })}><option value="">{t('f.all')}</option><option value="1">{t('f.onlyMine')}</option></select></Field>
      {canExport && <span className="actions-row"><label className="sr-only" htmlFor="lk-format">{t('format')}</label><select id="lk-format" value={format} onChange={(e) => setFormat(e.target.value)}>{['xlsx', 'csv', 'pdf'].map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}</select>
        <button type="button" className="btn" onClick={() => download.mutate()} disabled={download.isPending} data-testid="lk-export">{t('export')}</button></span>}
    </div>
    {download.error && <ErrorState error={download.error} />}
    {q.isPending ? <Skeleton label={t('tab.findings')} rows={6} /> : q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !q.data.rows.length
      ? <EmptyState title={t('emptyFindings')} message={t('emptyFindingsBody')} />
      : <>
        <p className="muted small" data-testid="lk-total">{t('f.total', { n: q.data.total })} · {inr(q.data.valueAtRisk)}</p>
        <div className="table-scroll"><table className="data-table" data-testid="lk-findings">
          <thead><tr><th>{t('d.no')}</th><th>{t('d.finding')}</th><th>{t('d.project')}</th><th className="num">{t('t.valueAtRisk')}</th><th>{t('d.owner')}</th><th>{t('f.status')}</th><th>{t('d.detected')}</th></tr></thead>
          <tbody>{q.data.rows.map((f) => <tr key={f.id} data-testid="lk-finding-row" data-rule={f.ruleCode} data-status={f.status}>
            <td data-label={t('d.no')}><Link to={`/bi/leakage?tab=findings&id=${f.id}`}>{f.docNo}</Link><br /><span className="muted small">{f.rule}</span></td>
            <td data-label={t('d.finding')}>{f.title}</td>
            <td data-label={t('d.project')}>{f.project ?? t('d.company')}</td>
            <td data-label={t('t.valueAtRisk')} className="num">{inr(f.valueAtRisk)}</td>
            <td data-label={t('d.owner')}>{f.owner ?? f.ownerRole ?? '—'}{f.mine ? ` · ${t('d.you')}` : ''}</td>
            <td data-label={t('f.status')}><StatusBadge status={ST[f.status]} label={t(`st.${f.status}`)} size="sm" />{f.overdue ? <> <StatusBadge status="REJECTED" label={t('t.overdue')} size="sm" /></> : null}{f.outcome ? <><br /><span className="muted small">{t(`oc.${f.outcome}`)}</span></> : null}</td>
            <td data-label={t('d.detected')}>{date(f.detectedAt.slice(0, 10))}</td>
          </tr>)}</tbody>
        </table></div>
        <Pager meta={{ page: q.data.page, pageSize: q.data.pageSize, total: q.data.total }} page={page} setPage={(n) => go({ page: n })} noun={t('tab.findings')} />
      </>}
  </>;
}

function Rules() {
  const t = useT('lk');
  const { dateTime } = useFormat();
  const session = useSession();
  const cache = useQueryClient();
  const q = useQuery({ queryKey: ['bi', 'det-rules'], queryFn: () => read('/bi/detection-rules'), retry: false });
  const [form, setForm] = useState(null);
  const [comment, setComment] = useState('');
  const refresh = () => cache.invalidateQueries({ queryKey: ['bi'] });
  const propose = useMutation({ mutationFn: (b) => write(`/bi/detection-rules/${b.code}/changes`, { thresholds: b.thresholds, severity: b.severity, active: b.active, reason: b.reason }), onSuccess: () => { setForm(null); return refresh(); } });
  const decide = useMutation({ mutationFn: ({ id, action, version }) => write(`/bi/detection-rules/changes/${id}/act`, { action, version, ...(comment ? { comment } : {}) }), onSuccess: () => { setComment(''); return refresh(); } });
  const run = useMutation({ mutationFn: () => write('/bi/detection/runs', {}) });
  if (q.isPending) return <Skeleton label={t('tab.rules')} rows={6} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const { rules, requests } = q.data; const c = q.data.can;
  const me = session.data?.user;
  const pending = requests.filter((r) => r.status === 'SUBMITTED');
  return <>
    <p className="muted">{t('r.makerChecker')}</p>
    {c.run && <div className="actions-row"><button type="button" className="btn" onClick={() => run.mutate()} disabled={run.isPending} data-testid="lk-run">{t('r.run')}</button>{run.isSuccess && <span role="status">{t('r.queued')}</span>}</div>}
    {run.error && <ErrorState error={run.error} />}
    <div className="table-scroll"><table className="data-table" data-testid="lk-rules">
      <thead><tr><th>{t('r.rule')}</th><th>{t('r.thresholds')}</th><th>{t('r.severity')}</th><th className="num">{t('r.open')}</th><th className="num">{t('r.fp')}</th><th>{t('r.version')}</th>{c.configure && <th />}</tr></thead>
      <tbody>{rules.map((r) => <tr key={r.code} data-code={r.code}>
        <td data-label={t('r.rule')}><strong>{r.name}</strong>{r.active ? '' : ` · ${t('r.inactive')}`}<br /><span className="muted small">{r.queryRef}</span></td>
        <td data-label={t('r.thresholds')}>{Object.entries(r.thresholds).map(([k, v]) => `${t(`th.${k}`)} ${v}`).join(' · ')}</td>
        <td data-label={t('r.severity')}><StatusBadge status={SEV[r.severity]} label={t(`sev.${r.severity}`)} size="sm" /></td>
        <td data-label={t('r.open')} className="num"><Link to={`/bi/leakage?tab=findings&ruleCode=${r.code}`}>{r.open}</Link></td>
        <td data-label={t('r.fp')} className="num">{r.falsePositiveRate == null ? '—' : `${r.falsePositiveRate}%`}</td>
        <td data-label={t('r.version')}>{r.version ? `${r.version} · ${r.approvedBy}` : t('r.default')}</td>
        {c.configure && <td><button type="button" className="btn" onClick={() => setForm({ code: r.code, name: r.name, thresholds: Object.fromEntries(Object.entries(r.thresholds).map(([k, v]) => [k, String(v)])), bounds: r.bounds, severity: r.severity, active: r.active, reason: '' })}>{t('r.change')}</button></td>}
      </tr>)}</tbody>
    </table></div>
    {form && <Card title={`${t('r.change')}: ${form.name}`} testid="lk-rule-form">
      <form onSubmit={(e) => { e.preventDefault(); propose.mutate({ ...form, thresholds: Object.fromEntries(Object.entries(form.thresholds).map(([k, v]) => [k, Number(v)])) }); }}>
        {Object.entries(form.thresholds).map(([k, v]) => <Field key={k} name={`lk-th-${k}`} label={t(`th.${k}`)} hint={`${form.bounds[k].min} – ${form.bounds[k].max}`}>
          <input type="number" inputMode="decimal" step="any" min={form.bounds[k].min} max={form.bounds[k].max} required value={v} onChange={(e) => setForm({ ...form, thresholds: { ...form.thresholds, [k]: e.target.value } })} /></Field>)}
        <Field name="lk-r-severity" label={t('r.severity')}><select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>{['CRITICAL', 'WARNING', 'INFO'].map((s) => <option key={s} value={s}>{t(`sev.${s}`)}</option>)}</select></Field>
        <Field name="lk-r-active" label={t('r.active')}><select value={form.active ? '1' : '0'} onChange={(e) => setForm({ ...form, active: e.target.value === '1' })}><option value="1">{t('r.yes')}</option><option value="0">{t('r.no')}</option></select></Field>
        <Field name="lk-r-reason" label={t('r.reason')}><textarea required minLength={5} maxLength={500} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
        <div className="actions-row"><button type="submit" className="btn btn-primary" disabled={propose.isPending}>{t('r.submit')}</button><button type="button" className="btn" onClick={() => setForm(null)}>{t('r.cancel')}</button></div>
        {propose.error && <ErrorState error={propose.error} />}
      </form>
    </Card>}
    {propose.isSuccess && <p role="status">{t('r.submitted')}</p>}
    {c.decide && <Card title={t('r.pending')} testid="lk-rule-requests">
      {!pending.length ? <p className="muted">{t('r.noPending')}</p> : pending.map((r) => <div key={r.id} className="drill-item">
        <span className="drill-kind small muted">{r.requestedBy} · {dateTime(r.requestedAt)}</span>
        <span className="drill-name"><strong>{r.title}</strong>: {JSON.stringify(r.payload.from.thresholds)} → {JSON.stringify(r.payload.thresholds)} · {r.payload.severity}{r.payload.active ? '' : ` · ${t('r.inactive')}`}<br />{r.reason}</span>
        {me !== r.requestedBy && (r.chain[r.currentStep - 1] ?? '').split('|').some((role) => can(session.data, 'bi.finding.approve') || session.data?.roles?.includes(role)) && <span className="drill-meta">
          <Field name={`lk-r-comment-${r.id}`} label={t('r.comment')}><textarea maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
          {['approve', 'reject', 'return'].map((action) => <button key={action} type="button" className={`btn${action === 'approve' ? ' btn-primary' : ''}`} disabled={decide.isPending || (action !== 'approve' && comment.trim().length < 5)} onClick={() => decide.mutate({ id: r.id, action, version: r.version })}>{t(`r.${action}`)}</button>)}
        </span>}
      </div>)}
      {decide.error && <ErrorState error={decide.error} />}
    </Card>}
  </>;
}

export function LeakageTower() {
  const t = useT('lk');
  const search = useSearch();
  const session = useSession();
  const tower = can(session.data, 'bi.leakage.view');
  const ruleView = can(session.data, 'bi.det_rule.view');
  const requested = search.get('tab');
  const tab = requested === 'findings' || !tower ? (requested === 'rules' && ruleView ? 'rules' : 'findings') : requested === 'rules' && ruleView ? 'rules' : 'tower';
  usePageTitle(t('title'));
  const tabs = [...(tower ? ['tower'] : []), 'findings', ...(ruleView ? ['rules'] : [])];
  return <section aria-labelledby="lk-h" data-testid="bi-leakage">
    <PageHeader id="lk-h" title={t('title')} subtitle={t('subtitle')} />
    <div role="tablist" aria-label={t('title')} className="tabs" data-testid="lk-tabs">
      {tabs.map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} data-tab={k} className={`btn${tab === k ? ' btn-primary' : ''}`} onClick={() => go({ tab: k === 'tower' ? '' : k, id: '', page: '' })}>{t(`tab.${k}`)}</button>)}
    </div>
    {tab === 'tower' && <Tower search={search} />}
    {tab === 'findings' && <Findings search={search} canExport={can(session.data, 'bi.finding.export')} />}
    {tab === 'rules' && <Rules />}
  </section>;
}
