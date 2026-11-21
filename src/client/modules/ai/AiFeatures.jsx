import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../platform/api/index.js';
import Chart from '../../platform/charts/Chart.jsx';
import { Card, CardGrid } from '../../platform/design/Card.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { useFormat, useT } from '../../platform/i18n/index.js';
import { useSession } from '../core/api/index.js';
import { Field, Link, can, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from '../eng/common.js';
import { downloadReport } from '../bi/api.js';

// Part 28.01: AI Features & Enablement (configuration page, UI v3 §3.6) with the AI Usage & Cost dashboard and the AI Log report. Every figure
// comes from /api/v1/ai; enabling a feature goes SYSADM → DIR through the approval inbox, and the kill switch stops every AI call at once.

const read = async (path) => (await api.get(path)).data;
const write = (method, path, body) => api[method](path, body, { headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const qs = (o) => { const p = new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v != null)); const s = p.toString(); return s ? `?${s}` : ''; };
const go = (patch) => {
  const p = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(patch)) { if (v === '' || v == null) p.delete(k); else p.set(k, String(v)); }
  navigateTo(`/ai/features${p.toString() ? `?${p}` : ''}`);
};
const TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', RETURNED: 'RETURNED', APPROVED: 'APPROVED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED', SUPERSEDED: 'CANCELLED' };

function KillSwitch() {
  const t = useT('ai');
  const cache = useQueryClient();
  const q = useQuery({ queryKey: ['ai', 'controls'], queryFn: () => read('/ai/controls'), retry: false });
  const [reason, setReason] = useState('');
  const m = useMutation({ mutationFn: (on) => write('post', '/ai/controls/kill-switch', { on, reason }), onSuccess: () => { setReason(''); cache.invalidateQueries({ queryKey: ['ai'] }); } });
  if (!q.data) return null;
  const c = q.data;
  return <Card title={c.killSwitch ? t('k.off') : t('k.on')} subtitle={c.killSwitch ? t('k.offBody', { by: c.by ?? '—', reason: c.reason ?? '' }) : t('k.onBody')} testid="ai-kill" className={c.killSwitch ? 'ai-killed' : ''}>
    <StatusBadge status={c.killSwitch ? 'REJECTED' : 'APPROVED'} label={c.killSwitch ? t('k.stateOff') : t('k.stateOn')} />
    {c.can.kill && <form className="actions-row" onSubmit={(e) => { e.preventDefault(); m.mutate(!c.killSwitch); }}>
      <Field name="ai-kill-reason" label={t('k.reason')}><input required minLength={5} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <button type="submit" className={`btn${c.killSwitch ? '' : ' btn-danger'}`} disabled={m.isPending || reason.trim().length < 5} data-testid="ai-kill-toggle">{c.killSwitch ? t('k.resume') : t('k.stop')}</button>
    </form>}
    {m.error && <ErrorState error={m.error} />}
  </Card>;
}

function FeatureDetail({ id }) {
  const t = useT('ai');
  const { dateTime } = useFormat();
  const cache = useQueryClient();
  const q = useQuery({ queryKey: ['ai', 'feature', id], queryFn: () => read(`/ai/features/${id}`), retry: false });
  const providers = useQuery({ queryKey: ['ai', 'providers'], queryFn: () => read('/ai/providers'), retry: false });
  const [form, setForm] = useState(null);
  const [why, setWhy] = useState('');
  const refresh = () => cache.invalidateQueries({ queryKey: ['ai'] });
  const act = useMutation({ mutationFn: ({ path, body, method = 'post' }) => write(method, `/ai/features/${id}${path}`, body), onSuccess: (res) => { setForm(null); setWhy(''); refresh(); if (res.data?.id && String(res.data.id) !== String(id)) go({ id: res.data.id }); } });
  if (q.isPending) return <Skeleton label={t('f.detail')} rows={6} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const f = q.data;
  const ev = f.evaluation;
  return <Card title={`${f.label} · v${f.versionNo}`} subtitle={`${f.docNo} · ${f.code}`} testid="ai-feature" menu={<button type="button" className="btn" onClick={() => go({ id: '' })}>{t('back')}</button>}>
    <div className="actions-row"><StatusBadge status={TONE[f.status]} label={t(`st.${f.status}`)} />{f.live && <StatusBadge status="APPROVED" label={t('live')} />}{f.status === 'APPROVED' && !f.enabled && <StatusBadge status="CANCELLED" label={t('switchedOff')} />}</div>
    <dl className="kv" data-testid="ai-feature-settings">
      <dt>{t('f.provider')}</dt><dd>{f.providerCode}</dd>
      <dt>{t('f.prompt')}</dt><dd>{f.promptVersion}</dd>
      <dt>{t('f.tools')}</dt><dd>{f.tools.join(', ') || '—'} <span className="muted small">({t('f.readOnly')})</span></dd>
      <dt>{t('f.roles')}</dt><dd>{f.scope.roles.join(', ') || '—'}</dd>
      <dt>{t('f.projects')}</dt><dd>{f.scope.projects === 'ALL' ? t('f.allProjects') : f.scope.projects.join(', ')}</dd>
      <dt>{t('f.quota')}</dt><dd>{t('f.quotaText', { calls: f.quota.perUserDaily ?? '—', budget: f.quota.monthlyBudget ?? '—', alert: f.quota.alertPct ?? '—' })}</dd>
      {f.approvedBy && <><dt>{t('f.approved')}</dt><dd>{f.approvedBy} · {dateTime(f.approvedAt)}</dd></>}
    </dl>
    {f.can.edit && !form && <button type="button" className="btn" onClick={() => setForm({ providerCode: f.providerCode, roles: f.scope.roles.join(', '), perUserDaily: String(f.quota.perUserDaily ?? 50), monthlyBudget: String(f.quota.monthlyBudget ?? 5000), alertPct: String(f.quota.alertPct ?? 80) })} data-testid="ai-edit">{t('edit')}</button>}
    {form && <form data-testid="ai-feature-form" onSubmit={(e) => { e.preventDefault(); act.mutate({ method: 'patch', path: '', body: { providerCode: form.providerCode, roles: form.roles.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean),
      quota: { perUserDaily: Number(form.perUserDaily), monthlyBudget: Number(form.monthlyBudget), alertPct: Number(form.alertPct) }, rowVersion: f.rowVersion } }); }}>
      <Field name="ai-provider" label={`${t('f.provider')} *`}><select required value={form.providerCode} onChange={(e) => setForm({ ...form, providerCode: e.target.value })}>{(providers.data ?? []).map((p) => <option key={p.code} value={p.code}>{p.code} · {p.model}</option>)}</select></Field>
      <Field name="ai-roles" label={`${t('f.roles')} *`} hint={t('f.rolesHint')}><input required value={form.roles} onChange={(e) => setForm({ ...form, roles: e.target.value })} /></Field>
      <Field name="ai-calls" label={t('f.perUserDaily')}><input type="number" inputMode="numeric" min={0} value={form.perUserDaily} onChange={(e) => setForm({ ...form, perUserDaily: e.target.value })} /></Field>
      <Field name="ai-budget" label={t('f.monthlyBudget')}><input type="number" inputMode="decimal" min={0} value={form.monthlyBudget} onChange={(e) => setForm({ ...form, monthlyBudget: e.target.value })} /></Field>
      <Field name="ai-alert" label={t('f.alertPct')}><input type="number" inputMode="numeric" min={1} max={100} value={form.alertPct} onChange={(e) => setForm({ ...form, alertPct: e.target.value })} /></Field>
      <div className="actions-row"><button type="submit" className="btn btn-primary" disabled={act.isPending}>{t('save')}</button><button type="button" className="btn" onClick={() => setForm(null)}>{t('cancel')}</button></div>
    </form>}
    <h3>{t('e.title')}</h3>
    {!ev ? <p className="muted">{t('e.none')}</p> : <ul className="wd-todo" data-testid="ai-eval">{ev.cases.map((c) => <li key={c.name}><StatusBadge status={c.passed ? 'APPROVED' : 'REJECTED'} label={c.passed ? t('e.pass') : t('e.fail')} size="sm" /> {c.name} — <span className="muted small">{c.detail}</span></li>)}</ul>}
    {ev && <p className="muted small">{t('e.ranAs', { role: ev.asRole ?? '—', at: dateTime(ev.at), by: ev.by })}</p>}
    <div className="actions-row">
      {f.can.evaluate && <button type="button" className="btn" onClick={() => act.mutate({ path: '/evaluate' })} disabled={act.isPending} data-testid="ai-evaluate">{t('e.run')}</button>}
      {f.can.submit && <button type="button" className="btn btn-primary" onClick={() => act.mutate({ path: '/submit' })} disabled={act.isPending || !ev?.passed} data-testid="ai-submit">{t('submit')}</button>}
      {f.approval?.taskId && <Link to={`/workflow/tasks?task=${f.approval.taskId}`}>{t('approvalTask')}</Link>}
    </div>
    {(f.can.disable || f.can.amend || f.can.withdraw) && <form className="actions-row" onSubmit={(e) => e.preventDefault()}>
      <Field name="ai-why" label={t('reason')}><input minLength={5} maxLength={500} value={why} onChange={(e) => setWhy(e.target.value)} /></Field>
      {f.can.disable && <button type="button" className="btn btn-danger" disabled={why.trim().length < 5 || act.isPending} onClick={() => act.mutate({ path: '/disable', body: { reason: why } })} data-testid="ai-disable">{t('disable')}</button>}
      {f.can.amend && <button type="button" className="btn" disabled={why.trim().length < 5 || act.isPending} onClick={() => act.mutate({ path: '/amend', body: { reason: why } })}>{t('amend')}</button>}
      {f.can.withdraw && <button type="button" className="btn" disabled={why.trim().length < 5 || act.isPending} onClick={() => act.mutate({ path: '/withdraw', body: { reason: why } })}>{t('withdraw')}</button>}
    </form>}
    {act.error && <ErrorState error={act.error} />}
  </Card>;
}

function Features() {
  const t = useT('ai');
  const cache = useQueryClient();
  const id = useSearch().get('id');
  const q = useQuery({ queryKey: ['ai', 'features'], queryFn: () => read('/ai/features'), retry: false });
  const providers = useQuery({ queryKey: ['ai', 'providers'], queryFn: () => read('/ai/providers'), retry: false });
  const create = useMutation({ mutationFn: (code) => write('post', '/ai/features', { code, providerCode: providers.data?.[0]?.code ?? 'sandbox', roles: [] }), onSuccess: (res) => { cache.invalidateQueries({ queryKey: ['ai'] }); go({ id: res.data.id }); } });
  if (q.isPending) return <Skeleton label={t('tab.features')} rows={5} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (id) return <FeatureDetail id={id} />;
  return <>
    <KillSwitch />
    <p className="muted small">{t('labelNote', { label: q.data.label })}</p>
    {create.error && <ErrorState error={create.error} />}
    <CardGrid testid="ai-features">
      {q.data.features.map((f) => <Card key={f.code} title={f.label} subtitle={f.description} testid="ai-feature-card">
        <div className="actions-row">{f.live ? <StatusBadge status="APPROVED" label={t('liveFor', { v: f.live.version, roles: f.live.roles.join(', ') })} /> : <StatusBadge status="DRAFT" label={t('notLive')} />}</div>
        <p className="muted small">{t('f.prompt')}: {f.promptVersion} · {t('f.tools')}: {f.tools.map((x) => `${x.name} (${x.mode})`).join(', ') || '—'} · {t('e.cases', { n: f.cases })}</p>
        <ul className="wd-todo">{f.versions.map((v) => <li key={v.id}><Link to={`/ai/features?id=${v.id}`}>{v.docNo} · v{v.version}</Link> <StatusBadge status={TONE[v.status]} label={t(`st.${v.status}`)} size="sm" /></li>)}</ul>
        {q.data.can.create && !f.versions.some((v) => ['DRAFT', 'SUBMITTED', 'RETURNED'].includes(v.status)) && <button type="button" className="btn" onClick={() => create.mutate(f.code)} disabled={create.isPending || !providers.data?.length} data-testid="ai-new-version">{t('newVersion')}</button>}
        {!providers.data?.length && <p className="muted small">{t('needProvider')}</p>}
      </Card>)}
    </CardGrid>
  </>;
}

function Providers() {
  const t = useT('ai');
  const { money } = useFormat();
  const session = useSession();
  const cache = useQueryClient();
  const q = useQuery({ queryKey: ['ai', 'providers'], queryFn: () => read('/ai/providers'), retry: false });
  const [form, setForm] = useState({ code: '', provider: 'anthropic', model: '', connector: '', priceInPerMTok: '', priceOutPerMTok: '' });
  const add = useMutation({ mutationFn: () => write('post', '/ai/providers', { ...form, priceInPerMTok: Number(form.priceInPerMTok), priceOutPerMTok: Number(form.priceOutPerMTok) }), onSuccess: () => cache.invalidateQueries({ queryKey: ['ai'] }) });
  if (q.isPending) return <Skeleton label={t('tab.providers')} rows={4} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  return <>
    <p className="muted">{t('p.note')} <Link to="/admin/integrations">{t('p.hub')}</Link></p>
    {!q.data.length ? <EmptyState compact title={t('p.empty')} /> : <div className="table-scroll"><table className="data-table" data-testid="ai-providers">
      <thead><tr><th>{t('p.code')}</th><th>{t('p.provider')}</th><th>{t('p.model')}</th><th>{t('p.connector')}</th><th className="num">{t('p.priceIn')}</th><th className="num">{t('p.priceOut')}</th><th>{t('p.status')}</th></tr></thead>
      <tbody>{q.data.map((p) => <tr key={p.id}><td data-label={t('p.code')}>{p.code}</td><td data-label={t('p.provider')}>{t(`prov.${p.provider}`)}</td><td data-label={t('p.model')}>{p.model}</td>
        <td data-label={t('p.connector')}>{p.connector} <StatusBadge status={p.connectorStatus === 'ENABLED' ? 'APPROVED' : 'REJECTED'} label={p.connectorStatus} size="sm" /></td>
        <td data-label={t('p.priceIn')} className="num">{money(String(p.priceInPerMTok))}</td><td data-label={t('p.priceOut')} className="num">{money(String(p.priceOutPerMTok))}</td><td data-label={t('p.status')}>{p.status}</td></tr>)}</tbody>
    </table></div>}
    {can(session.data, 'ai.provider.manage') && <Card title={t('p.add')} testid="ai-provider-form"><form onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
      <Field name="ai-p-code" label={`${t('p.code')} *`}><input required pattern="[a-z][a-z0-9_-]{1,39}" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
      <Field name="ai-p-provider" label={`${t('p.provider')} *`}><select value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>{['anthropic', 'openai_compatible', 'sandbox'].map((p) => <option key={p} value={p}>{t(`prov.${p}`)}</option>)}</select></Field>
      <Field name="ai-p-model" label={`${t('p.model')} *`}><input required value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} /></Field>
      <Field name="ai-p-connector" label={`${t('p.connector')} *`} hint={t('p.connectorHint')}><input required value={form.connector} onChange={(e) => setForm({ ...form, connector: e.target.value })} /></Field>
      <Field name="ai-p-in" label={`${t('p.priceIn')} *`}><input required type="number" inputMode="decimal" min={0} step="any" value={form.priceInPerMTok} onChange={(e) => setForm({ ...form, priceInPerMTok: e.target.value })} /></Field>
      <Field name="ai-p-out" label={`${t('p.priceOut')} *`}><input required type="number" inputMode="decimal" min={0} step="any" value={form.priceOutPerMTok} onChange={(e) => setForm({ ...form, priceOutPerMTok: e.target.value })} /></Field>
      <button type="submit" className="btn btn-primary" disabled={add.isPending}>{t('p.save')}</button>{add.error && <ErrorState error={add.error} />}
    </form></Card>}
  </>;
}

function Usage() {
  const t = useT('ai');
  const { money, number } = useFormat();
  const days = Number(useSearch().get('days') ?? 30);
  const q = useQuery({ queryKey: ['ai', 'usage', days], queryFn: () => read(`/ai/usage?days=${days}`), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('u.title')} permission="ai.usage.view" />;
  if (q.isPending) return <Skeleton label={t('u.title')} rows={5} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const u = q.data; const T = u.totals; const n = (v) => number(String(v), { decimals: 0 });
  return <>
    <div className="actions-row"><Field name="ai-days" label={t('u.days')}><select value={days} onChange={(e) => go({ days: e.target.value })}>{[7, 30, 90].map((d) => <option key={d} value={d}>{d}</option>)}</select></Field></div>
    <KpiRow testid="ai-usage-tiles" label={t('u.title')}>
      <KpiTile testid="ai-cost" label={t('u.cost')} kind="money" amount={T.cost} value={money(String(T.cost))} to="/ai/features?tab=log" />
      <KpiTile label={t('u.calls')} kind="count" value={n(T.calls)} to="/ai/features?tab=log" />
      <KpiTile label={t('u.blocked')} kind="risk" value={n(T.blocked)} tone={T.blocked ? 'warning' : 'success'} to="/ai/features?tab=log&outcome=BLOCKED" />
      <KpiTile label={t('u.errors')} kind="risk" value={n(T.errors)} tone={T.errors ? 'error' : 'success'} to="/ai/features?tab=log&outcome=ERROR" />
      <KpiTile label={t('u.tokens')} kind="count" value={n(T.tokensIn + T.tokensOut)} />
      <KpiTile label={t('u.users')} kind="people" value={n(T.users)} />
    </KpiRow>
    <CardGrid>
      <Card title={t('u.byDay')} testid="ai-usage-day">{u.byDay.length ? <Chart type="line" title={t('u.byDay')} exportName="ai-cost-by-day" data={{ categories: u.byDay.map((d) => d.day.slice(5)), unit: '₹', series: [{ name: t('u.cost'), values: u.byDay.map((d) => d.cost) }] }} /> : <EmptyState compact title={t('u.none')} />}</Card>
      <Card title={t('u.byFeature')} testid="ai-usage-feature">{u.byFeature.length ? <Chart type="bar" title={t('u.byFeature')} exportName="ai-cost-by-feature" data={{ categories: u.byFeature.map((f) => f.label), unit: '₹', series: [{ name: t('u.cost'), values: u.byFeature.map((f) => f.cost), drill: u.byFeature.map((f) => `/ai/features?tab=log&feature=${f.code}`) }] }} onDrill={(to) => navigateTo(to)} /> : <EmptyState compact title={t('u.none')} />}</Card>
      <Card title={t('u.budgets')} testid="ai-budgets">{!u.budgets.length ? <EmptyState compact title={t('u.noLive')} /> : <ul className="wd-topn">{u.budgets.map((b) => <li key={b.code} className="wd-topn-row"><span className="wd-topn-label">{b.label}</span><span className="wd-topn-value">{money(String(b.spent))} / {b.budget == null ? '—' : money(String(b.budget))}{b.pct != null ? ` (${b.pct}%)` : ''}</span></li>)}</ul>}</Card>
    </CardGrid>
  </>;
}

function Log() {
  const t = useT('ai');
  const { money, dateTime } = useFormat();
  const search = useSearch();
  const session = useSession();
  const filters = { feature: search.get('feature') ?? '', outcome: search.get('outcome') ?? '', user: search.get('user') ?? '' };
  const id = search.get('log');
  const q = useQuery({ queryKey: ['ai', 'logs', filters], queryFn: () => read(`/ai/logs${qs({ ...filters, pageSize: 50 })}`), retry: false, enabled: !id });
  const one = useQuery({ queryKey: ['ai', 'log', id], queryFn: () => read(`/ai/logs/${id}`), retry: false, enabled: Boolean(id) });
  const [format, setFormat] = useState('xlsx');
  const download = useMutation({ mutationFn: () => downloadReport(`/api/v1/ai/logs/export${qs({ ...filters, format })}`, `ai-log.${format}`) });
  if (q.error?.status === 403 || one.error?.status === 403) return <NoPermission what={t('l.title')} permission="ai.log.view" />;
  if (id) {
    if (one.isPending) return <Skeleton label={t('l.title')} rows={5} />;
    if (one.error) return <ErrorState error={one.error} />;
    const l = one.data;
    return <Card title={`${l.label} · ${dateTime(l.at)}`} subtitle={`${l.user} · ${l.outcome}${l.reason ? ` · ${l.reason}` : ''}`} testid="ai-log-entry" menu={<button type="button" className="btn" onClick={() => go({ log: '' })}>{t('back')}</button>}>
      <dl className="kv"><dt>{t('l.model')}</dt><dd>{l.model ?? '—'}</dd><dt>{t('l.tokens')}</dt><dd>{l.tokensIn} / {l.tokensOut}</dd><dt>{t('l.cost')}</dt><dd>{money(String(l.cost))}</dd><dt>{t('l.redactions')}</dt><dd>{l.redactions}</dd>
        <dt>{t('l.refs')}</dt><dd>{l.contextRefs.map((r) => (r.route ? <Link key={r.id} to={r.route}>{r.label}</Link> : r.label))}</dd><dt>{t('l.request')}</dt><dd className="small">{l.requestRef}</dd></dl>
      <h3>{t('l.prompt')}</h3><pre className="ai-pre" data-testid="ai-log-prompt">{l.prompt ?? '—'}</pre>
      <h3>{t('l.response')} <StatusBadge status="AT_RISK" label={l.aiLabel} size="sm" /></h3><pre className="ai-pre">{l.response ?? '—'}</pre>
    </Card>;
  }
  return <>
    <div className="actions-row" data-testid="ai-log-filters">
      <Field name="ai-l-outcome" label={t('l.outcome')}><select value={filters.outcome} onChange={(e) => go({ outcome: e.target.value })}><option value="">{t('all')}</option>{['OK', 'BLOCKED', 'ERROR'].map((o) => <option key={o} value={o}>{t(`o.${o}`)}</option>)}</select></Field>
      <Field name="ai-l-user" label={t('l.user')}><input value={filters.user} onChange={(e) => go({ user: e.target.value })} /></Field>
      {can(session.data, 'ai.log.export') && <span className="actions-row"><label className="sr-only" htmlFor="ai-format">{t('format')}</label><select id="ai-format" value={format} onChange={(e) => setFormat(e.target.value)}>{['xlsx', 'csv', 'pdf'].map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}</select>
        <button type="button" className="btn" onClick={() => download.mutate()} disabled={download.isPending} data-testid="ai-log-export">{t('export')}</button></span>}
    </div>
    {q.isPending ? <Skeleton label={t('l.title')} rows={6} /> : q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !q.data.rows.length ? <EmptyState title={t('l.empty')} /> :
      <div className="table-scroll"><table className="data-table" data-testid="ai-log">
        <thead><tr><th>{t('l.at')}</th><th>{t('l.feature')}</th><th>{t('l.user')}</th><th>{t('l.outcome')}</th><th className="num">{t('l.tokens')}</th><th className="num">{t('l.cost')}</th></tr></thead>
        <tbody>{q.data.rows.map((l) => <tr key={l.id} data-testid="ai-log-row" data-outcome={l.outcome}><td data-label={t('l.at')}><Link to={`/ai/features?tab=log&log=${l.id}`}>{dateTime(l.at)}</Link></td><td data-label={t('l.feature')}>{l.label}</td><td data-label={t('l.user')}>{l.user}</td>
          <td data-label={t('l.outcome')}><StatusBadge status={l.outcome === 'OK' ? 'APPROVED' : l.outcome === 'BLOCKED' ? 'AT_RISK' : 'REJECTED'} label={t(`o.${l.outcome}`)} size="sm" />{l.reason ? <><br /><span className="muted small">{l.reason}</span></> : null}</td>
          <td data-label={t('l.tokens')} className="num">{l.tokensIn + l.tokensOut}</td><td data-label={t('l.cost')} className="num">{money(String(l.cost))}</td></tr>)}</tbody>
      </table></div>}
  </>;
}

export function AiFeatures() {
  const t = useT('ai');
  const session = useSession();
  const search = useSearch();
  usePageTitle(t('title'));
  const tabs = ['features', 'providers', ...(can(session.data, 'ai.usage.view') ? ['usage'] : []), ...(can(session.data, 'ai.log.view') ? ['log'] : [])];
  const tab = tabs.includes(search.get('tab')) ? search.get('tab') : 'features';
  return <section aria-labelledby="ai-h" data-testid="ai-page">
    <PageHeader id="ai-h" title={t('title')} subtitle={t('subtitle')} />
    <div role="tablist" aria-label={t('title')} className="tabs" data-testid="ai-tabs">
      {tabs.map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} data-tab={k} className={`btn${tab === k ? ' btn-primary' : ''}`} onClick={() => go({ tab: k === 'features' ? '' : k, id: '', log: '' })}>{t(`tab.${k}`)}</button>)}
    </div>
    {tab === 'features' && <Features />}
    {tab === 'providers' && <Providers />}
    {tab === 'usage' && <Usage />}
    {tab === 'log' && <Log />}
  </section>;
}
