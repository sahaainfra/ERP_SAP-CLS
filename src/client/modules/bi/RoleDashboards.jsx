import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../platform/api/index.js';
import Chart from '../../platform/charts/Chart.jsx';
import DashboardView from '../../platform/dashboard/DashboardView.jsx';
import { Card } from '../../platform/design/Card.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { useFormat, useT } from '../../platform/i18n/index.js';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from '../eng/common.js';
import { downloadReport } from './api.js';

// Part 27.10: the role dashboard (the default dashboard of each role, on the 03.07 framework: a person's own copy, then the role default approved
// in the Dashboard Designer, then the layout of the role) and the Dashboard Inventory (technical console report: every widget with its source,
// use and status, the dashboards, the role coverage and the scan for hard-coded figures).

const read = async (path) => (await api.get(path)).data;
const qs = (o) => { const p = new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v != null)); const s = p.toString(); return s ? `?${s}` : ''; };

export function RoleDashboard() {
  const t = useT('rd');
  usePageTitle(t('title'));
  const q = useQuery({ queryKey: ['bi', 'role-dashboard'], queryFn: () => read('/bi/role-dashboard'), retry: false });
  const roles = q.data?.roles ?? [];
  return <section aria-labelledby="rd-h" data-testid="bi-role-dashboard">
    <PageHeader id="rd-h" title={t('title')} subtitle={roles.length ? t('for', { roles: roles.map((r) => r.name).join(', ') }) : t('subtitle')} />
    {q.error && q.error.status !== 404 && <ErrorState error={q.error} onRetry={q.refetch} />}
    <DashboardView code="role-dashboard" embedded />
  </section>;
}

const STATUS_TONE = { OK: 'APPROVED', REVIEW: 'AT_RISK', RETIRED: 'DRAFT', NO_PROVIDER: 'REJECTED' };
const go = (patch) => {
  const p = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(patch)) { if (v === '' || v == null) p.delete(k); else p.set(k, String(v)); }
  navigateTo(`/bi/dashboard-inventory${p.toString() ? `?${p}` : ''}`);
};

export function DashboardInventory() {
  const t = useT('rd');
  const { number, dateTime } = useFormat();
  const search = useSearch();
  const cache = useQueryClient();
  usePageTitle(t('inv.title'));
  const filters = { module: search.get('module') ?? '', status: search.get('status') ?? '', source: search.get('source') ?? '' };
  const view = search.get('view') === 'roles' ? 'roles' : search.get('view') === 'dashboards' ? 'dashboards' : 'widgets';
  const q = useQuery({ queryKey: ['bi', 'inventory', filters], queryFn: () => read(`/bi/dashboard-inventory${qs(filters)}`), retry: false, placeholderData: (p) => p });
  const [format, setFormat] = useState('xlsx');
  const download = useMutation({ mutationFn: () => downloadReport(`/api/v1/bi/dashboard-inventory/export${qs({ ...filters, format })}`, `dashboard-inventory.${format}`) });
  const scan = useMutation({ mutationFn: () => api.post('/bi/dashboard-inventory/scans', {}, { headers: { 'idempotency-key': globalThis.crypto.randomUUID() } }), onSuccess: () => cache.invalidateQueries({ queryKey: ['bi', 'inventory'] }) });
  if (q.error?.status === 403) return <NoPermission what={t('inv.noPermission')} permission="bi.dashboard_inventory.view" />;
  if (q.isPending) return <section><PageHeader title={t('inv.title')} /><Skeleton label={t('inv.title')} rows={8} /></section>;
  if (q.error) return <section><PageHeader title={t('inv.title')} /><ErrorState error={q.error} onRetry={q.refetch} /></section>;
  const d = q.data; const T = d.totals;
  const n = (v) => number(String(v), { decimals: 0 });
  const chart = { categories: d.byModule.map((m) => m.module), series: [{ name: t('inv.widgets'), values: d.byModule.map((m) => m.count), drill: d.byModule.map((m) => `/bi/dashboard-inventory?module=${m.module}`) }] };
  return <section aria-labelledby="inv-h" data-testid="bi-dashboard-inventory">
    <PageHeader id="inv-h" title={t('inv.title')} subtitle={t('inv.subtitle', { at: dateTime(d.asOf) })}
      actions={<span className="actions-row"><label className="sr-only" htmlFor="inv-format">{t('format')}</label><select id="inv-format" value={format} onChange={(e) => setFormat(e.target.value)}>{['xlsx', 'csv', 'pdf'].map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}</select>
        <button type="button" className="btn" onClick={() => download.mutate()} disabled={download.isPending} data-testid="inv-export">{t('export')}</button></span>} />
    {download.error && <ErrorState error={download.error} />}
    <div className="actions-row" data-testid="inv-params">
      <Field name="inv-module" label={t('inv.module')}><select value={filters.module} onChange={(e) => go({ module: e.target.value })}><option value="">{t('all')}</option>{d.byModule.map((m) => <option key={m.module} value={m.module}>{m.module}</option>)}</select></Field>
      <Field name="inv-status" label={t('inv.status')}><select value={filters.status} onChange={(e) => go({ status: e.target.value })}><option value="">{t('all')}</option>{['OK', 'REVIEW', 'RETIRED', 'NO_PROVIDER'].map((s) => <option key={s} value={s}>{t(`st.${s}`)}</option>)}</select></Field>
      <Field name="inv-source" label={t('inv.source')}><select value={filters.source} onChange={(e) => go({ source: e.target.value })}><option value="">{t('all')}</option>{['CERTIFIED_METRIC', 'OVERVIEW_SERVICE', 'OWNER_SERVICE', 'FRAMEWORK'].map((s) => <option key={s} value={s}>{t(`src.${s}`)}</option>)}</select></Field>
    </div>
    <Card title={t('inv.byModule')} testid="inv-chart"><Chart type="bar" data={chart} title={t('inv.byModule')} onDrill={(to) => navigateTo(to)} exportName="widgets-by-module" /></Card>
    <KpiRow testid="inv-tiles" label={t('inv.title')}>
      <KpiTile testid="inv-total" label={t('inv.widgets')} kind="count" value={n(T.widgets)} to="/bi/dashboard-inventory" />
      <KpiTile label={t('st.OK')} kind="count" value={n(T.ok)} tone="success" to="/bi/dashboard-inventory?status=OK" />
      <KpiTile label={t('st.REVIEW')} kind="count" value={n(T.review)} tone={T.review ? 'warning' : 'success'} to="/bi/dashboard-inventory?status=REVIEW" />
      <KpiTile label={t('st.RETIRED')} kind="count" value={n(T.retired)} to="/bi/dashboard-inventory?status=RETIRED" />
      <KpiTile label={t('src.CERTIFIED_METRIC')} kind="count" value={n(T.certified)} to="/bi/dashboard-inventory?source=CERTIFIED_METRIC" />
      <KpiTile testid="inv-roles" label={t('inv.rolesCovered')} kind="people" value={`${n(T.rolesCovered)} / ${n(T.roles)}`} tone={T.rolesCovered === T.roles ? 'success' : 'warning'} to="/bi/dashboard-inventory?view=roles" />
      <KpiTile testid="inv-scan" label={t('inv.scan')} kind="risk" value={n(d.scan.findings.length)} tone={d.scan.findings.length ? 'error' : 'success'}>{d.scan.available ? t('inv.scanFiles', { n: d.scan.files }) : t('inv.scanNone')}</KpiTile>
    </KpiRow>
    <div role="tablist" aria-label={t('inv.title')} className="tabs" data-testid="inv-views">
      {['widgets', 'roles', 'dashboards'].map((k) => <button key={k} type="button" role="tab" aria-selected={view === k} data-view={k} className={`btn${view === k ? ' btn-primary' : ''}`} onClick={() => go({ view: k === 'widgets' ? '' : k })}>{t(`view.${k}`)}</button>)}
    </div>
    {view === 'widgets' && (!d.widgets.length ? <EmptyState title={t('inv.empty')} /> : <div className="table-scroll"><table className="data-table" data-testid="inv-widgets">
      <thead><tr><th>{t('inv.widget')}</th><th>{t('inv.module')}</th><th>{t('inv.source')}</th><th>{t('inv.permission')}</th><th>{t('inv.usedIn')}</th><th>{t('inv.status')}</th></tr></thead>
      <tbody>{d.widgets.map((w) => <tr key={w.code} data-testid="inv-widget-row" data-code={w.code} data-status={w.status}>
        <td data-label={t('inv.widget')}><strong>{w.title}</strong><br /><span className="muted small">{w.code} · {w.type}</span></td>
        <td data-label={t('inv.module')}>{w.module}</td>
        <td data-label={t('inv.source')}>{t(`src.${w.source}`)}{w.sourceRef ? <><br /><span className="muted small">{w.sourceRef}</span></> : null}</td>
        <td data-label={t('inv.permission')} className="small">{w.permission}</td>
        <td data-label={t('inv.usedIn')} className="small">{w.dashboards.join(', ') || '—'}{w.roles.length ? <><br /><span className="muted">{t('inv.rolesN', { n: w.roles.length })}</span></> : null}</td>
        <td data-label={t('inv.status')}><StatusBadge status={STATUS_TONE[w.status]} label={t(`st.${w.status}`)} size="sm" />{w.supersededBy ? <><br /><span className="muted small">{t('inv.by', { code: w.supersededBy })}</span></> : null}{w.issues.length && w.status !== 'RETIRED' ? <><br /><span className="muted small">{w.issues.map((i) => t(`issue.${i}`)).join(', ')}</span></> : null}{w.drill ? <><br /><Link to={w.drill}>{t('inv.drill')}</Link></> : null}</td>
      </tr>)}</tbody>
      <tfoot><tr><th scope="row" colSpan={5}>{t('inv.total')}</th><td data-label={t('inv.total')}>{n(d.widgets.length)}</td></tr></tfoot>
    </table></div>)}
    {view === 'roles' && <div className="table-scroll"><table className="data-table" data-testid="inv-role-table">
      <thead><tr><th>{t('inv.role')}</th><th className="num">{t('inv.cards')}</th><th className="num">{t('inv.visible')}</th><th>{t('inv.hidden')}</th></tr></thead>
      <tbody>{d.roles.map((r) => <tr key={r.role} data-testid="inv-role-row" data-role={r.role}>
        <td data-label={t('inv.role')}><strong>{r.role}</strong> {r.name}</td><td data-label={t('inv.cards')} className="num">{r.widgets}</td>
        <td data-label={t('inv.visible')} className="num">{r.visible}</td><td data-label={t('inv.hidden')} className="small">{r.hidden.join(', ') || '—'}</td>
      </tr>)}</tbody>
    </table></div>}
    {view === 'dashboards' && <div className="table-scroll"><table className="data-table" data-testid="inv-dashboards">
      <thead><tr><th>{t('inv.dashboard')}</th><th className="num">{t('inv.layouts')}</th><th className="num">{t('inv.roleDefaults')}</th><th className="num">{t('inv.personal')}</th></tr></thead>
      <tbody>{d.dashboards.map((x) => <tr key={x.code}><td data-label={t('inv.dashboard')}><strong>{x.name}</strong><br /><span className="muted small">{x.code}</span></td><td data-label={t('inv.layouts')} className="num">{x.layouts}</td><td data-label={t('inv.roleDefaults')} className="num">{x.roleDefaults}</td><td data-label={t('inv.personal')} className="num">{x.personal}</td></tr>)}</tbody>
    </table></div>}
    <Card title={t('inv.scanTitle')} subtitle={d.scan.scannedAt ? t('inv.scannedAt', { at: dateTime(d.scan.scannedAt) }) : undefined} testid="inv-scan-card"
      menu={<button type="button" className="btn" onClick={() => scan.mutate()} disabled={scan.isPending} data-testid="inv-rescan">{t('inv.rescan')}</button>}>
      {scan.error && <ErrorState error={scan.error} />}
      {!d.scan.findings.length ? <EmptyState compact title={t('inv.clean')} message={t('inv.cleanBody')} /> : <ul className="wd-todo">{d.scan.findings.map((f) => <li key={`${f.file}:${f.line}:${f.rule}`}>{f.why}: <code>{f.file}:{f.line}</code></li>)}</ul>}
    </Card>
  </section>;
}
