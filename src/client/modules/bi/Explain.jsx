import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../platform/api/index.js';
import { Card } from '../../platform/design/Card.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { useFormat, useT } from '../../platform/i18n/index.js';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from '../eng/common.js';
import { downloadReport } from './api.js';
import DrillBreadcrumb, { drillHref } from './DrillBreadcrumb.jsx';

// Part 27.08: the Variance Explainer (UI v3 dashboard page). "Why?" shows the deterministic decomposition of a project's cost, schedule or
// margin variance as a waterfall and a contributors table whose rows add up, with the residual shown, to the total (BR-01); every component
// links to its records. "Drill-down" walks company → project → site / WBS → activity → BOQ → transaction → document → audit with the breadcrumb.

const read = async (path) => (await api.get(path)).data;
const qs = (o) => { const p = new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v != null)); const s = p.toString(); return s ? `?${s}` : ''; };
const go = (patch, reset = false) => {
  const p = new URLSearchParams(reset ? '' : window.location.search);
  for (const [k, v] of Object.entries(patch)) { if (v === '' || v == null) p.delete(k); else p.set(k, String(v)); }
  navigateTo(`/bi/explain${p.toString() ? `?${p}` : ''}`);
};
const KPIS = ['cost', 'schedule', 'margin'];

/** A horizontal waterfall: one row per step, a bar from the running total before it to the running total after it (fits a phone). */
function Waterfall({ steps, total, inr }) {
  const t = useT('why');
  let run = 0;
  const rows = steps.map((s) => { const from = run; run = Math.round((run + s.amount) * 100) / 100; return { ...s, from, to: run }; });
  const all = [0, total, ...rows.flatMap((r) => [r.from, r.to])];
  const lo = Math.min(...all); const hi = Math.max(...all); const span = hi - lo || 1;
  const pct = (v) => ((v - lo) / span) * 100;
  const bar = (a, b, tone, key, label, amount, testid) => <li key={key} className="wf-row" data-testid={testid} data-tone={tone}>
    <span className="wf-label" title={label}>{label}</span>
    <span className="wf-track" aria-hidden="true"><span className="wf-zero" style={{ left: `${pct(0)}%` }} /><span className={`wf-bar wf-${tone}`} style={{ left: `${pct(Math.min(a, b))}%`, width: `${Math.max(0.6, pct(Math.max(a, b)) - pct(Math.min(a, b)))}%` }} /></span>
    <span className="wf-value num">{inr(amount)}</span>
  </li>;
  return <ol className="wf" aria-label={t('c.waterfall')} data-testid="why-waterfall">
    {rows.map((r) => bar(r.from, r.to, r.residual ? 'neutral' : r.amount < 0 ? 'bad' : 'good', r.key, r.label, r.amount, r.residual ? 'wf-residual' : 'wf-step'))}
    {bar(0, total, 'total', '__total', t('c.totalRow'), total, 'wf-total')}
  </ol>;
}

function Why({ search, projects }) {
  const t = useT('why');
  const { money, number, date: fmtDate } = useFormat();
  const inr = (v) => (v == null ? '—' : money(String(v)));
  const projectId = search.get('projectId') ?? '';
  const kpi = KPIS.includes(search.get('kpi')) ? search.get('kpi') : 'cost';
  const period = search.get('period') ?? '';
  const params = { projectId, kpi, period };
  const q = useQuery({ queryKey: ['bi', 'why', params], queryFn: () => read(`/bi/explain/why${qs(params)}`), enabled: Boolean(projectId), retry: false });
  const [format, setFormat] = useState('xlsx');
  const download = useMutation({ mutationFn: () => downloadReport(`/api/v1/bi/explain/why/export${qs({ ...params, format })}`, `why-${kpi}.${format}`) });
  const filters = <div className="actions-row" data-testid="why-filters">
    <Field name="why-project" label={t('f.project')}><select value={projectId} onChange={(e) => go({ projectId: e.target.value })}><option value="">{t('f.choose')}</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></Field>
    <Field name="why-period" label={t('f.period')}><input type="month" value={period} onChange={(e) => go({ period: e.target.value })} /></Field>
  </div>;
  const kpiTabs = <div role="tablist" aria-label={t('t.total')} className="tabs" data-testid="why-kpis">
    {KPIS.map((k) => <button key={k} type="button" role="tab" aria-selected={kpi === k} className={`btn${kpi === k ? ' btn-primary' : ''}`} data-kpi={k} onClick={() => go({ kpi: k === 'cost' ? '' : k })}>{t(`kpi.${k}`)}</button>)}
  </div>;
  if (!projectId) return <>{filters}<EmptyState title={t('f.choose')} message={t('chooseBody')} /></>;
  let body;
  if (q.isPending) body = <Skeleton label={t('c.contributors')} rows={6} />;
  else if (q.error?.status === 403) body = <EmptyState title={t('hidden')} message={q.error.message} />;
  else if (q.error) body = <ErrorState error={q.error} onRetry={q.refetch} />;
  else {
    const w = q.data;
    const steps = [...w.components, ...(w.residual ? [{ key: '__residual', label: t('c.residualRow'), amount: w.residual, residual: true }] : [])];
    const share = (a) => (w.total ? `${number(String(Math.round((a / w.total) * 1000) / 10), { decimals: 1 })}%` : '—');
    body = <>
      <KpiRow testid="why-tiles" label={w.label}>
        <KpiTile testid="why-total" valueTestid="why-total-value" label={w.label} kind="money" amount={w.total} value={inr(w.total)} tone={w.total < 0 ? 'error' : w.total > 0 ? 'success' : 'neutral'} to={w.source?.route}>{w.sign}</KpiTile>
        <KpiTile label={t('t.explained')} kind="money" amount={w.explained} value={inr(w.explained)} />
        <KpiTile testid="why-residual" label={t('t.residual')} kind="money" amount={w.residual} value={inr(w.residual)} tone={w.residual ? 'warning' : 'success'}>{w.residualNote ?? null}</KpiTile>
      </KpiRow>
      <p className="muted small" data-testid="why-method"><strong>{t('t.method')}:</strong> {t(`method.${w.method}`)}. {t('noNarrative')} {w.source && <>{t('source')}: <Link to={w.source.route}>{w.source.name}</Link>.</>}</p>
      {w.empty || (!w.components.length && !w.residual) ? <EmptyState title={t('empty')} message={w.empty ?? t('emptyBody')} action={w.source ? <Link to={w.source.route}>{w.source.name}</Link> : null} /> : <>
        <Card title={t('c.waterfall')} subtitle={t('c.waterfallSub')} testid="why-card-waterfall"><Waterfall steps={steps} total={w.total} inr={inr} /></Card>
        <Card title={t('c.contributors')} count={{ shown: w.components.length, total: w.components.length }} testid="why-card-contributors"
          menu={w.can?.export !== false && <span className="actions-row"><label className="sr-only" htmlFor="why-format">{t('format')}</label>
            <select id="why-format" value={format} onChange={(e) => setFormat(e.target.value)}>{['xlsx', 'csv', 'pdf'].map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}</select>
            <button type="button" className="btn" onClick={() => download.mutate()} disabled={download.isPending} data-testid="why-export">{t('export')}</button></span>}>
          {download.error && <ErrorState error={download.error} />}
          <div className="table-scroll"><table className="data-table" data-testid="why-contributors">
            <thead><tr><th>{t('c.group')}</th><th>{t('c.component')}</th><th className="num">{t('c.amount')}</th><th className="num">{t('c.share')}</th><th>{t('t.method')}</th><th>{t('c.drill')}</th></tr></thead>
            <tbody>{w.components.map((c) => <tr key={c.key} data-testid="why-row" data-key={c.key}>
              <td data-label={t('c.group')}>{c.group}</td><td data-label={t('c.component')}>{c.label}</td>
              <td data-label={t('c.amount')} className={`num${c.amount < 0 ? ' why-neg' : ''}`}>{inr(c.amount)}</td><td data-label={t('c.share')} className="num">{share(c.amount)}</td>
              <td data-label={t('t.method')} className="small muted">{c.method}</td><td data-label={t('c.drill')}>{c.drill ? <Link to={c.drill}>{t('c.open')}</Link> : '—'}</td>
            </tr>)}</tbody>
            <tfoot>
              <tr data-testid="why-residual-row"><th scope="row" colSpan={2}>{t('c.residualRow')}</th><td data-label={t('c.amount')} className="num">{inr(w.residual)}</td><td data-label={t('c.share')} className="num">{share(w.residual)}</td><td data-label={t('t.method')} className="small muted">{t('c.residualMethod')}</td><td /></tr>
              <tr data-testid="why-total-row"><th scope="row" colSpan={2}>{t('c.totalRow')}</th><td data-label={t('c.amount')} className="num"><strong>{inr(w.total)}</strong></td><td data-label={t('c.share')} className="num">100%</td><td colSpan={2} className="small">{w.check.balanced ? t('c.balanced') : t('c.unbalanced')}</td></tr>
            </tfoot>
          </table></div>
        </Card>
      </>}
      <p className="muted small">{t('sign')} {t('subtitle', { date: fmtDate(w.asOf) })}</p>
    </>;
  }
  return <>{filters}{kpiTabs}{body}</>;
}

function Drill({ search }) {
  const t = useT('why');
  const { money, number, dateTime } = useFormat();
  const inr = (v) => (v == null ? '—' : money(String(v)));
  const params = { level: search.get('level') ?? 'company', id: search.get('id') ?? '', projectId: search.get('projectId') ?? '', entity: search.get('entity') ?? '', txnId: search.get('txnId') ?? '' };
  const q = useQuery({ queryKey: ['bi', 'drill', params], queryFn: () => read(`/bi/explain/drill${qs(params)}`), retry: false, placeholderData: (p) => p });
  if (q.isPending) return <Skeleton label={t('d.title')} rows={6} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  const txnId = d.level === 'txn' ? d.id : params.txnId || undefined;
  const fig = (f) => {
    if (!f) return null;
    if (f.masked) return <span className="muted small">{t('hidden')}</span>;
    return <span className="drill-figs small">{f.budget != null && <span>{t('d.budget')} {inr(f.budget)}</span>}{f.earned != null && <span>{t('d.earned')} {inr(f.earned)}</span>}{f.actual != null && <span>{t('d.actual')} {inr(f.actual)}</span>}
      {f.costVariance != null && <span className={f.costVariance < 0 ? 'why-neg' : ''}>{t('d.cv')} {inr(f.costVariance)}</span>}{f.amount != null && <span>{t('d.amount')} {inr(f.amount)}</span>}{f.qty ? <span>{number(String(f.qty), { decimals: 3 })}</span> : null}</span>;
  };
  return <>
    <DrillBreadcrumb trail={d.breadcrumb} txnId={txnId} />
    <Card title={d.title ?? t(`lvl.${d.level}`)} subtitle={t('d.children')} testid="drill-card"
      menu={<>{d.route && <Link to={d.route}>{t('d.openRecord')}</Link>}{d.level === 'project' && <> <Link to={`/bi/explain?projectId=${d.id}`}>{t('d.why')}</Link></>}</>}>
      {d.figures && <p>{fig(d.figures)}</p>}
      {d.children.length === 0 ? <EmptyState compact title={t('d.none')} /> : <ul className="drill-list" data-testid="drill-children">
        {d.children.map((c, i) => {
          const leaf = c.level === 'event' || c.restricted;
          const href = drillHref(c, ['document', 'audit'].includes(c.level) ? { txnId } : {});
          return <li key={`${c.level}-${c.id ?? i}`} className="drill-item" data-testid="drill-child" data-level={c.level}>
            <span className="drill-kind small muted">{c.kind ?? t(`lvl.${c.level}`)}</span>
            <span className="drill-name">{leaf ? <span>{c.restricted ? t('d.restricted') : c.label}</span> : <Link to={href}>{c.label}</Link>}</span>
            <span className="drill-meta small">{c.detail && <span className="muted">{c.detail} </span>}{c.date && <span className="muted">{c.date} </span>}{c.at && <span className="muted">{dateTime(c.at)} {c.actor ?? ''}</span>}{fig(c.figures)}{c.why && <> <Link to={c.why}>{t('d.why')}</Link></>}{c.route && !c.restricted && <> <Link to={c.route}>{t('c.open')}</Link></>}</span>
          </li>;
        })}
      </ul>}
    </Card>
  </>;
}

export function VarianceExplainer() {
  const t = useT('why');
  const search = useSearch();
  const tab = search.get('tab') === 'drill' ? 'drill' : 'why';
  usePageTitle(t('title'));
  // the projects in scope come from the top of the drill-down (the same scope as every figure)
  const top = useQuery({ queryKey: ['bi', 'drill', 'projects'], queryFn: () => read('/bi/explain/drill?level=company'), retry: false });
  if (top.error?.status === 403) return <NoPermission what={t('noPermission')} permission="bi.explain.view" />;
  if (top.isPending) return <section><PageHeader title={t('title')} /><Skeleton label={t('title')} rows={6} /></section>;
  if (top.error) return <section><PageHeader title={t('title')} /><ErrorState error={top.error} onRetry={top.refetch} /></section>;
  const projects = top.data.children.filter((c) => c.level === 'project');
  return <section aria-labelledby="why-h" data-testid="bi-explain">
    <PageHeader id="why-h" title={t('title')} subtitle={t('method.DETERMINISTIC')} />
    <div role="tablist" aria-label={t('title')} className="tabs" data-testid="why-tabs">
      {['why', 'drill'].map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`btn${tab === k ? ' btn-primary' : ''}`} data-tab={k}
        onClick={() => go(k === 'why' ? { tab: '', level: '', id: '', entity: '', txnId: '' } : { tab: 'drill', level: search.get('projectId') ? 'project' : '', id: search.get('projectId') ?? '' })}>{t(`tab.${k}`)}</button>)}
    </div>
    {tab === 'why' ? <Why search={search} projects={projects} /> : <Drill search={search} />}
  </section>;
}
