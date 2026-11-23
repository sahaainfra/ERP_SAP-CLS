import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../platform/api/index.js';
import Chart from '../../platform/charts/Chart.jsx';
import { Card, CardGrid, Section } from '../../platform/design/Card.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { useFormat, useT } from '../../platform/i18n/index.js';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from '../eng/common.js';
import { downloadReport } from './api.js';

// Part 27.05: the morning management report (analytical report, UI v3 §3.5). The report is drawn from its stored snapshot (BR-01): the summary,
// the exceptions, then a card for each section with its key figures and the records behind them (cards on a phone). Pill tabs give the archive
// and the settings (maker-checker). Every figure comes from GET /bi/morning-reports.

const TABS = ['report', 'archive', 'settings'];
const SECTION_ORDER = ['tower', 'progress', 'attendance', 'stock', 'receivables', 'payables', 'approvals', 'tasks', 'risks', 'incidents'];
const read = async (path) => (await api.get(path)).data;
const write = (path, body) => api.post(path, body, { headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const go = (patch, base = '/bi/morning-report') => {
  const p = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(patch)) { if (v === '' || v == null) p.delete(k); else p.set(k, String(v)); }
  navigateTo(`${base}${p.toString() ? `?${p}` : ''}`);
};

function Table({ columns, rows, testid }) {
  if (!rows?.length) return null;
  return <div className="table-scroll"><table className="data-table" data-testid={testid}>
    <thead><tr>{columns.map(([, label]) => <th key={label}>{label}</th>)}</tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i}>{columns.map(([render, label], ci) => <td key={label} data-label={label}>{ci === 0 && r.route ? <Link to={r.route}>{render(r)}</Link> : render(r)}</td>)}</tr>)}</tbody>
  </table></div>;
}

function Sections({ sections }) {
  const t = useT('mr');
  const { money, number, dateTime } = useFormat();
  const inr = (v) => money(String(v ?? 0));
  const n = (v) => number(String(v ?? 0), { decimals: Number.isInteger(v) ? 0 : 1 });
  const cards = {
    tower: (s) => <><KpiRow><KpiTile label={t('k.red')} kind="risk" value={n(s.red.length)} tone={s.red.length ? 'error' : 'success'} to="/bi/control-tower?tab=matrix&rag=RED" />
      <KpiTile label={t('k.alerts')} kind="risk" value={n(s.openAlerts)} tone={s.criticalAlerts ? 'error' : s.openAlerts ? 'warning' : 'success'} to="/bi/control-tower?tab=alerts" /></KpiRow>
      <Table testid="mr-tower" columns={[[(r) => r.alertNo, t('c.doc')], [(r) => r.project ?? '—', t('c.project')], [(r) => r.message, t('c.status')]]} rows={s.alerts} /></>,
    progress: (s) => <><KpiRow><KpiTile label={t('k.submitted')} kind="count" value={`${n(s.submitted)} / ${n(s.sites)}`} to={s.route} /><KpiTile label={t('k.missing')} kind="count" value={n(s.missing.length)} tone={s.missing.length ? 'warning' : 'success'} to={s.route} /></KpiRow>
      <Table testid="mr-progress" columns={[[(r) => r.site, t('c.site')], [(r) => r.project, t('c.project')], [(r) => r.status ?? t('k.missing'), t('c.status')]]} rows={[...s.missing.map((m) => ({ ...m, status: null })), ...s.rows]} /></>,
    attendance: (s) => <KpiRow><KpiTile label={t('k.present')} kind="people" value={n(s.present)} to={s.route} /><KpiTile label={t('k.absent')} kind="people" value={n(s.absent)} to={s.route} /><KpiTile label={t('k.manHours')} kind="time" value={n(s.manHours)} to={s.route} /></KpiRow>,
    stock: (s) => <><KpiRow><KpiTile label={t('k.stockOuts')} kind="quantity" value={n(s.stockOuts)} tone={s.stockOuts ? 'error' : 'success'} to={s.route} /><KpiTile label={t('k.belowMin')} kind="quantity" value={n(s.belowMinimum)} tone={s.belowMinimum ? 'warning' : 'success'} to={s.route} /></KpiRow>
      <Table testid="mr-stock" columns={[[(r) => r.item, t('c.item')], [(r) => r.store, t('c.store')], [(r) => `${r.available} ${r.uom}`, t('c.available')], [(r) => `${r.minQty} ${r.uom}`, t('c.min')]]} rows={s.rows} /></>,
    receivables: (s) => <><KpiRow><KpiTile label={t('k.outstanding')} kind="money" amount={s.outstanding} value={inr(s.outstanding)} to={s.route} /><KpiTile label={t('k.overdue')} kind="money" amount={s.overdue} value={inr(s.overdue)} tone={s.overdue ? 'warning' : 'neutral'} to={s.route} />
      <KpiTile label={t('k.dueToday')} kind="money" amount={s.dueToday} value={inr(s.dueToday)} to={s.route} /></KpiRow>
      <Table testid="mr-receivables" columns={[[(r) => r.docNo, t('c.doc')], [(r) => r.client ?? '—', t('c.client')], [(r) => inr(r.amount), t('c.amount')]]} rows={s.dueRows} /></>,
    payables: (s) => <KpiRow><KpiTile label={t('k.outstanding')} kind="money" amount={s.outstanding} value={inr(s.outstanding)} to={s.route} /><KpiTile label={t('k.dueToday')} kind="money" amount={s.dueToday} value={inr(s.dueToday)} to={s.route} />
      <KpiTile label={t('k.msme')} kind="money" amount={s.msmeDue} value={inr(s.msmeDue)} tone={s.msmeDue ? 'warning' : 'neutral'} to={s.route} /></KpiRow>,
    approvals: (s) => <><KpiRow><KpiTile label={t('k.pending')} kind="count" value={n(s.pending)} to={s.route} /><KpiTile label={t('k.overdue')} kind="count" value={n(s.overdue)} tone={s.overdue ? 'warning' : 'success'} to={s.route} /></KpiRow>
      <Table testid="mr-approvals" columns={[[(r) => `${r.docType} ${r.docRef ?? ''}`, t('c.doc')], [(r) => r.step, t('c.step')], [(r) => (r.dueAt ? dateTime(r.dueAt) : '—'), t('c.due')]]} rows={s.rows} /></>,
    tasks: (s) => <><KpiRow><KpiTile label={t('k.critical')} kind="count" value={n(s.critical)} to={s.route} /><KpiTile label={t('k.overdue')} kind="count" value={n(s.overdue)} tone={s.overdue ? 'warning' : 'success'} to={s.route} /></KpiRow>
      <Table testid="mr-tasks" columns={[[(r) => `${r.taskNo} ${r.title}`, t('c.task')], [(r) => r.priority, t('c.priority')], [(r) => r.dueDate ?? '—', t('c.due')]]} rows={s.rows} /></>,
    risks: (s) => <><KpiRow><KpiTile label={t('k.critical')} kind="risk" value={n(s.critical)} tone={s.critical ? 'error' : 'success'} to={s.route} /><KpiTile label={t('k.high')} kind="risk" value={n(s.high)} tone={s.high ? 'warning' : 'success'} to={s.route} /></KpiRow>
      <Table testid="mr-risks" columns={[[(r) => `${r.docNo} ${r.title}`, t('c.risk')], [(r) => r.project, t('c.project')], [(r) => r.level, t('c.level')]]} rows={s.rows} /></>,
    incidents: (s) => <><KpiRow><KpiTile label={t('k.count')} kind="safety" value={n(s.count)} to={s.route} /><KpiTile label={t('k.lostTime')} kind="safety" value={n(s.lostTime)} tone={s.lostTime ? 'error' : 'success'} to={s.route} /></KpiRow>
      <Table testid="mr-incidents" columns={[[(r) => r.docNo, t('c.incident')], [(r) => r.project, t('c.project')], [(r) => r.classification, t('c.class')]]} rows={s.rows} /></>,
  };
  return <CardGrid testid="mr-sections">{SECTION_ORDER.filter((k) => sections[k]).map((k) => <Card key={k} title={t(`s.${k}`)} viewAll={sections[k].route} viewAllLabel={t('viewAll')} testid={`mr-section-${k}`}>{cards[k](sections[k])}</Card>)}</CardGrid>;
}

function Report({ search }) {
  const t = useT('mr');
  const { date, dateTime } = useFormat();
  const id = search.get('id');
  const day = search.get('date');
  const q = useQuery({ queryKey: ['bi', 'morning', id, day], queryFn: () => read(id ? `/bi/morning-reports/${id}` : `/bi/morning-reports/current${day ? `?date=${day}` : ''}`), retry: false });
  const verify = useMutation({ mutationFn: () => read(`/bi/morning-reports/${q.data.id}/verify`) });
  const [format, setFormat] = useState('pdf');
  const download = useMutation({ mutationFn: () => downloadReport(`/api/v1/bi/morning-reports/${q.data.id}/export?format=${format}`, `morning-report.${format}`) });
  if (q.error?.status === 403) return <NoPermission what={t('noPermission')} permission="bi.morning_report.view" />;
  if (q.isPending) return <Skeleton label={t('title')} rows={6} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const r = q.data; const s = r.snapshot;
  const counts = ['CRITICAL', 'WARNING', 'INFO'].map((sev) => s.exceptions.filter((e) => e.severity === sev).length);
  return <>
    <p className="muted" data-testid="mr-asat">{t('asAt', { cutoff: s.cutoff, date: date(s.reportDate), data: date(s.dataDate), no: r.reportNo })} · {dateTime(r.generatedAt)}</p>
    <div className="actions-row">
      <Field name="mr-date" label={t('date')}><input type="date" value={day ?? s.reportDate} onChange={(e) => go({ date: e.target.value, id: '' })} /></Field>
      <label className="sr-only" htmlFor="mr-format">{t('format')}</label>
      <select id="mr-format" value={format} onChange={(e) => setFormat(e.target.value)}>{['pdf', 'xlsx', 'csv'].map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}</select>
      <button type="button" className="btn" onClick={() => download.mutate()} disabled={download.isPending} data-testid="mr-export">{t('export')}</button>
      <button type="button" className="btn" onClick={() => verify.mutate()} disabled={verify.isPending} data-testid="mr-verify">{t('verify')}</button>
    </div>
    {verify.data && <p role="status" data-testid="mr-verified">{verify.data.identical ? t('verified', { hash: verify.data.hash.slice(0, 12) }) : t('notVerified')}</p>}
    {(download.error || verify.error) && <ErrorState error={download.error ?? verify.error} />}
    <KpiRow testid="mr-kpis">
      <KpiTile label={t('exceptions')} kind="risk" value={String(s.exceptions.length)} tone={counts[0] ? 'error' : counts[1] ? 'warning' : 'success'} />
      {['CRITICAL', 'WARNING', 'INFO'].map((sev, i) => <KpiTile key={sev} label={t(`sev.${sev}`)} kind="risk" value={String(counts[i])} />)}
    </KpiRow>
    <CardGrid>
      <Card title={t('summary')} subtitle={t('summaryKind')} testid="mr-summary">
        <ul data-testid="mr-summary-lines">{s.summary.lines.map((line) => <li key={line}>{line}</li>)}</ul>
      </Card>
      <Card title={t('exceptions')} count={{ shown: Math.min(10, s.exceptions.length), total: s.exceptions.length }} testid="mr-exceptions">
        {s.exceptions.length > 0 && <Chart type="bar" title={t('exceptions')} exportName="morning-exceptions"
          data={{ categories: ['CRITICAL', 'WARNING', 'INFO'].map((sev) => t(`sev.${sev}`)), series: [{ name: t('exceptions'), values: counts }] }} />}
        {s.exceptions.length === 0 ? <EmptyState compact title={t('noExceptions')} />
          : <ul className="wd-todo">{s.exceptions.slice(0, 10).map((e) => <li key={e.text} data-kind={e.kind}><StatusBadge status={e.severity} label={t(`sev.${e.severity}`)} size="sm" /> <Link to={e.route}>{e.text}</Link></li>)}</ul>}
      </Card>
    </CardGrid>
    {Object.keys(s.sections).length ? <Sections sections={s.sections} /> : <EmptyState title={t('none')} />}
  </>;
}

function Archive({ search }) {
  const t = useT('mr');
  const { date, dateTime } = useFormat();
  const filters = { from: search.get('from') ?? '', to: search.get('to') ?? '', page: search.get('page') ?? '' };
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
  const q = useQuery({ queryKey: ['bi', 'morning-archive', filters], queryFn: () => read(`/bi/morning-reports${qs ? `?${qs}` : ''}`), retry: false, placeholderData: (p) => p });
  const base = window.location.pathname;
  if (q.error?.status === 403) return <NoPermission what={t('noPermission')} permission="bi.morning_report.view" />;
  return <>
    <div className="actions-row">
      <Field name="mr-from" label={t('a.from')}><input type="date" value={filters.from} onChange={(e) => go({ from: e.target.value, page: '' }, base)} /></Field>
      <Field name="mr-to" label={t('a.to')}><input type="date" value={filters.to} onChange={(e) => go({ to: e.target.value, page: '' }, base)} /></Field>
    </div>
    {q.isPending && <Skeleton label={t('archiveTitle')} rows={4} />}
    {q.error && <ErrorState error={q.error} onRetry={q.refetch} />}
    {q.data && (q.data.total === 0 ? <EmptyState title={t('a.empty')} message={t('a.emptyBody')} action={<Link to="/bi/morning-report">{t('title')}</Link>} />
      : <div className="table-scroll"><table className="data-table" data-testid="mr-archive">
        <thead><tr><th>{t('a.no')}</th><th>{t('a.date')}</th><th>{t('a.generated')}</th><th>{t('a.delivered')}</th><th className="num">{t('a.exceptions')}</th></tr></thead>
        <tbody>{q.data.rows.map((r) => <tr key={r.id} data-testid="mr-archive-row">
          <td data-label={t('a.no')}><Link to={`/bi/morning-report?id=${r.id}`}>{r.reportNo}</Link></td>
          <td data-label={t('a.date')}>{date(r.reportDate)}</td>
          <td data-label={t('a.generated')}>{dateTime(r.generatedAt)}</td>
          <td data-label={t('a.delivered')}>{r.deliveredAt ? `${dateTime(r.deliveredAt)} · ${r.channels.map((c) => t(`ch.${c}`)).join(', ')}` : t('a.notDelivered')}</td>
          <td data-label={t('a.exceptions')} className="num">{r.exceptions}</td>
        </tr>)}</tbody>
      </table></div>)}
    {q.data && q.data.total > q.data.pageSize && <div className="pager"><span>{t('a.page', { page: q.data.page, pages: Math.ceil(q.data.total / q.data.pageSize), total: q.data.total })}</span>
      <button type="button" className="btn" disabled={q.data.page <= 1} onClick={() => go({ page: q.data.page - 1 }, base)}>{t('prev')}</button>
      <button type="button" className="btn" disabled={q.data.page * q.data.pageSize >= q.data.total} onClick={() => go({ page: q.data.page + 1 }, base)}>{t('next')}</button></div>}
  </>;
}

function Settings({ session }) {
  const t = useT('mr');
  const cache = useQueryClient();
  const q = useQuery({ queryKey: ['bi', 'morning-settings'], queryFn: () => read('/bi/morning-report-settings'), retry: false });
  const [form, setForm] = useState(null);
  const [comment, setComment] = useState('');
  const refresh = () => cache.invalidateQueries({ queryKey: ['bi', 'morning-settings'] });
  const submit = useMutation({ mutationFn: (body) => write('/bi/morning-report-settings/requests', body), onSuccess: () => { setForm(null); return refresh(); } });
  const decide = useMutation({ mutationFn: ({ id, action, version }) => write(`/bi/morning-report-settings/requests/${id}/act`, { action, version, ...(comment ? { comment } : {}) }), onSuccess: () => { setComment(''); return refresh(); } });
  const deliver = useMutation({ mutationFn: () => write('/bi/morning-reports/deliveries', {}) });
  if (q.isPending) return <Skeleton label={t('tab.settings')} rows={4} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  const describe = (c) => `${c.sections.map((s) => t(`s.${s}`)).join(', ')} · ${t('st.cutoff')} ${c.cutoff} · ${t('st.time')} ${c.time} · ${(c.channels ?? []).map((ch) => t(`ch.${ch}`)).join(', ')}`;
  const pending = d.requests.filter((r) => r.status === 'SUBMITTED');
  const mayDecide = (r) => session?.user !== r.requestedBy && (r.chain[r.currentStep - 1] ?? '').split('|').some((role) => session?.roles?.includes(role));
  const toggle = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return <>
    <Section title={t('st.mine')} testid="mr-settings-mine"><p>{d.mine.scopeType === 'DEFAULT' ? t('st.default') : `${d.mine.scopeType === 'ROLE' ? t('st.role') : t('st.user')} ${d.mine.scopeRef} · ${t('st.version')} ${d.mine.version}`}</p><p className="muted">{describe(d.mine)}</p></Section>
    <Section title={t('st.configs')} testid="mr-settings-configs" actions={d.can.configure && <><button type="button" className="btn" onClick={() => setForm({ scopeType: 'ROLE', scopeRef: '', sections: [...d.sections], cutoff: '06:00', time: '06:30', channels: ['IN_APP'], pdf: true, active: true, reason: '' })}>{t('st.propose')}</button>
      <button type="button" className="btn" onClick={() => deliver.mutate()} disabled={deliver.isPending}>{t('st.deliverNow')}</button></>}>
      <p className="muted">{t('st.makerChecker')}</p>
      {deliver.isSuccess && <p role="status">{t('st.queued')}</p>}
      {d.configs.length === 0 ? <p className="muted">{t('st.noConfigs')}</p> : <div className="table-scroll"><table className="data-table">
        <thead><tr><th>{t('st.scope')}</th><th>{t('st.sections')}</th><th>{t('st.active')}</th><th>{t('st.version')}</th></tr></thead>
        <tbody>{d.configs.map((c) => <tr key={`${c.scopeType}:${c.scopeRef}`}><td data-label={t('st.scope')}>{c.scopeType === 'ROLE' ? t('st.role') : t('st.user')} {c.scopeRef}</td><td data-label={t('st.sections')}>{describe(c)}</td>
          <td data-label={t('st.active')}>{c.active ? t('st.yes') : t('st.no')}</td><td data-label={t('st.version')}>{c.version} · {c.approvedBy}{d.can.configure && <> <button type="button" className="btn" onClick={() => setForm({ ...c, reason: '' })}>{t('st.propose')}</button></>}</td></tr>)}</tbody>
      </table></div>}
    </Section>
    {form && <Section title={t('st.propose')} testid="mr-settings-form">
      <form onSubmit={(e) => { e.preventDefault(); submit.mutate({ scopeType: form.scopeType, scopeRef: form.scopeRef, sections: form.sections, cutoff: form.cutoff, time: form.time, channels: form.channels, pdf: form.pdf, active: form.active, reason: form.reason }); }}>
        <Field name="mr-s-scope" label={t('st.scope')}><select value={form.scopeType} onChange={(e) => setForm({ ...form, scopeType: e.target.value })}><option value="ROLE">{t('st.role')}</option><option value="USER">{t('st.user')}</option></select></Field>
        <Field name="mr-s-ref" label={t('st.ref')}><input required value={form.scopeRef} onChange={(e) => setForm({ ...form, scopeRef: e.target.value })} /></Field>
        <fieldset><legend>{t('st.sections')}</legend>{d.sections.map((s) => <label key={s} className="actions-row"><input type="checkbox" checked={form.sections.includes(s)} onChange={() => setForm({ ...form, sections: toggle(form.sections, s) })} /> {t(`s.${s}`)}</label>)}</fieldset>
        <Field name="mr-s-cutoff" label={t('st.cutoff')}><input type="time" required value={form.cutoff} onChange={(e) => setForm({ ...form, cutoff: e.target.value })} /></Field>
        <Field name="mr-s-time" label={t('st.time')}><input type="time" required value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} /></Field>
        <fieldset><legend>{t('st.channels')}</legend>{d.channels.map((c) => <label key={c} className="actions-row"><input type="checkbox" disabled={c === 'IN_APP'} checked={form.channels.includes(c)} onChange={() => setForm({ ...form, channels: toggle(form.channels, c) })} /> {t(`ch.${c}`)}</label>)}</fieldset>
        <label className="actions-row"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> {t('st.active')}</label>
        <Field name="mr-s-reason" label={t('st.reason')}><textarea required minLength={5} maxLength={500} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
        <div className="actions-row"><button type="submit" className="btn btn-primary" disabled={submit.isPending}>{t('st.submit')}</button><button type="button" className="btn" onClick={() => setForm(null)}>{t('st.cancel')}</button></div>
        {submit.error && <ErrorState error={submit.error} />}
      </form>
    </Section>}
    {submit.isSuccess && <p role="status">{t('st.submitted')}</p>}
    {d.can.configure && <Section title={t('st.pending')} testid="mr-settings-pending">
      {!pending.length ? <p className="muted">{t('st.noPending')}</p> : pending.map((r) => <Card key={r.id} title={r.title} subtitle={r.requestedBy}>
        <p>{describe(r.payload)}</p><p>{r.reason}</p>
        {mayDecide(r) && <><Field name={`mr-c-${r.id}`} label={t('st.comment')}><textarea maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
          <div className="actions-row">{['approve', 'reject', 'return'].map((action) => <button key={action} type="button" className={`btn${action === 'approve' ? ' btn-primary' : ''}`}
            disabled={decide.isPending || (action !== 'approve' && comment.trim().length < 5)} onClick={() => decide.mutate({ id: r.id, action, version: r.version })}>{t(`st.${action}`)}</button>)}</div></>}
      </Card>)}
      {decide.error && <ErrorState error={decide.error} />}
    </Section>}
  </>;
}

export function MorningReport({ session, initialTab = 'report' }) {
  const t = useT('mr');
  const search = useSearch();
  const tab = TABS.includes(search.get('tab')) ? search.get('tab') : initialTab;
  usePageTitle(tab === 'archive' ? t('archiveTitle') : t('title'));
  return <section aria-labelledby="mr-h" data-testid="bi-morning-report">
    <PageHeader id="mr-h" title={tab === 'archive' ? t('archiveTitle') : t('title')} />
    <div role="tablist" aria-label={t('title')} className="tabs" data-testid="mr-tabs">
      {TABS.map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`btn${tab === k ? ' btn-primary' : ''}`}
        onClick={() => navigateTo(k === 'archive' ? '/bi/morning-reports' : `/bi/morning-report${k === 'report' ? '' : `?tab=${k}`}`)}>{t(`tab.${k}`)}</button>)}
    </div>
    {tab === 'report' && <Report search={search} />}
    {tab === 'archive' && <Archive search={search} />}
    {tab === 'settings' && <Settings session={session} />}
  </section>;
}

export function ReportArchive({ session }) {
  return <MorningReport session={session} initialTab="archive" />;
}
