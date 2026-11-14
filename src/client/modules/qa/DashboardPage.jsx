import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, usePageTitle } from '../core/pages/ui.jsx';
import { fmtDate, qa } from './api.js';
import { sel } from './QaParts.jsx';

// Quality Dashboard (part 18.07, FR-01): the KPI tiles with value, change since the period before, target and colour; the ageing of open requests and NCRs; the exceptions; the person's pending approvals. Every tile opens the list behind it.
const TONE = { green: 'APPROVED', amber: 'RETURNED', red: 'REJECTED', neutral: 'DRAFT' }; const money = (n) => new Intl.NumberFormat('en-IN').format(n);
export default function DashboardPage() {
  const t = useT('qa'); usePageTitle(t('dash.title')); const [f, setF] = useState({ projectId: '', from: '', to: '' }); const oq = useQuery({ queryKey: ['qa', 'projects'], queryFn: () => qa.get('/projects').then((p) => ({ projects: p })), retry: false });
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString(); const q = useQuery({ queryKey: ['qa', 'dashboard', qs], queryFn: () => qa.get(`/dashboard${qs ? `?${qs}` : ''}`), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('dash.title')} permission="qa.dashboard.view" />; if (q.isPending) return <Skeleton label={t('dash.title')} rows={6} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data; const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  return (
    <section aria-labelledby="dash-h" data-testid="qa-dashboard"><h1 id="dash-h">{t('dash.title')}</h1><p className="muted">{t('dash.period', { from: fmtDate(d.period.from), to: fmtDate(d.period.to) })} · <Link to="/qa/control-charts">{t('cc.title')}</Link> · <Link to="/qa/ratings">{t('rt.title')}</Link></p>
      <div className="mdm-panel no-print" data-testid="dash-filters"><div className="form-grid">
        <Field label={t('project')} name="projectId"><select value={f.projectId} onChange={(e) => set('projectId', e.target.value)} style={sel} data-testid="dash-project"><option value="">{t('allProjects')}</option>{(oq.data?.projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></Field>
        <Field label={t('dash.from')} name="from"><input type="date" value={f.from} onChange={(e) => set('from', e.target.value)} style={sel} data-testid="dash-from" /></Field>
        <Field label={t('dash.to')} name="to"><input type="date" value={f.to} onChange={(e) => set('to', e.target.value)} style={sel} data-testid="dash-to" /></Field></div>
        <div className="actions-row"><button type="button" className="btn" onClick={() => qa.exportFile(`/dashboard/export${qs ? `?${qs}` : ''}`, 'quality-kpis.csv').catch(() => globalThis.alert?.(t('exportFailed')))} data-testid="dash-export">{t('export')}</button><button type="button" className="btn" onClick={() => qa.exportFile(`/dashboard/pdf${qs ? `?${qs}` : ''}`, 'quality-dashboard.pdf').catch(() => globalThis.alert?.(t('exportFailed')))} data-testid="dash-pdf">{t('dash.pdf')}</button></div></div>
      <div className="form-grid" data-testid="dash-tiles">{d.kpis.map((k) => (
        <div className="mdm-panel" key={k.key} data-testid={`kpi-${k.key}`} data-status={k.status}><div className="muted">{t(`kpi.${k.key}`)}</div>
          <strong style={{ fontSize: '1.8rem' }} data-testid={`kpi-${k.key}-value`}>{k.masked ? '—' : k.value == null ? '—' : k.key === 'rectCost' ? `Rs ${money(k.value)}` : `${k.value}${k.unit}`}</strong>
          <div><StatusBadge status={TONE[k.status]} label={t(`kst.${k.status}`)} /></div>
          <div className="muted">{k.target != null ? t('dash.target', { n: k.target, u: k.unit.trim() }) : ''}{k.trend != null ? ` · ${k.trend > 0 ? '▲' : k.trend < 0 ? '▼' : '='} ${Math.abs(k.trend)}` : ''}{k.note ? ` · ${k.note}` : ''}{k.n != null ? ` · n=${k.n}` : ''}</div>
          <div><Link to={k.drill}>{t('ira.open')}</Link></div></div>))}</div>
      <div className="mdm-panel" data-testid="dash-exceptions"><h2>{t('dash.exceptions')}</h2>{d.exceptions.length === 0 ? <p className="muted">{t('dash.noExceptions')}</p> : <ul>{d.exceptions.map((e) => <li key={e.key} data-testid="dash-exception" data-tone={e.tone}><Link to={e.drill}>{t(`exc.${e.key}`, { n: e.count })}</Link></li>)}</ul>}
        <p data-testid="dash-pending">{t('dash.pending', { n: d.pending })} <Link to="/approvals">{t('dash.approvals')}</Link></p></div>
      <div className="table-scroll"><table className="data-table" data-testid="dash-ageing"><caption>{t('dash.ageing')}</caption><thead><tr><th>{t('ira.days')}</th><th className="num">{t('dash.irs')}</th></tr></thead><tbody>{d.ageing.ir.map((b) => <tr key={b.label}><td>{b.label}</td><td className="num">{b.count}</td></tr>)}</tbody></table>
        <table className="data-table"><thead><tr><th>{t('ira.days')}</th><th className="num">{t('dash.ncrs')}</th></tr></thead><tbody>{d.ageing.ncr.map((b) => <tr key={b.label}><td>{b.label}</td><td className="num">{b.count}</td></tr>)}</tbody></table></div>
    </section>
  );
}
