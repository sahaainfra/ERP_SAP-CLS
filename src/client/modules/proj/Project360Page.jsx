import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { RAG_TONE, dayIST, downloadFile, inr, p3 } from './api.js';
import ProjectPicker from './ProjectPicker.jsx';
import { Tabs, useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Project 360 (part 10.08): the header of the project, its health (time, cost, quality, safety, cash, risk), and the widgets of every module on eight tabs. A widget shows the figures of the module that owns them, each opening its list or record;
// a slot whose module is not live yet says which part will supply it; a widget of a module the person has no right to is not shown. The period selector sets the month of the period figures; the snapshot is exported as PDF, XLSX or CSV.
const TONE = { green: 'ACTIVE', amber: 'AT_RISK', red: 'REJECTED' };
const fmt = (f) => (f.value == null ? '—' : f.format === 'money' ? inr(f.value) : typeof f.value === 'number' ? f.value.toLocaleString('en-IN') : String(f.value));
function Widget({ w, t }) {
  return (
    <article className="mdm-panel p3-widget" data-testid={`p3-widget-${w.code}`} data-status={w.status} aria-labelledby={`p3w-${w.code}`}>
      <h3 id={`p3w-${w.code}`}>{w.title}{w.drill && <> · <Link to={w.drill}>{t('p3.open')}</Link></>}</h3>
      {w.status === 'NOT_LIVE' && <p className="muted" data-testid={`p3-empty-${w.code}`}><StatusBadge status="DRAFT" label={t('p3.notLive', { part: w.ownerPart })} /> {w.emptyText}</p>}
      {w.status === 'ERROR' && <p className="field-error" role="alert">{w.emptyText}</p>}
      {w.status === 'LIVE' && (
        <>
          <dl className="p3-figures">
            {w.figures.map((f) => (
              <div key={f.key} data-testid={`p3-fig-${w.code}-${f.key}`}>
                <dt>{f.label}</dt>
                <dd>{f.tone ? <StatusBadge status={TONE[f.tone]} label={fmt(f)} /> : fmt(f)}{f.drill && <> <Link to={f.drill} aria-label={t('p3.drillTo', { what: f.label })}>›</Link></>}</dd>
              </div>
            ))}
          </dl>
          {w.rows.length > 0 && <ul className="p3-rows">{w.rows.map((r, i) => <li key={i}>{r.drill ? <Link to={r.drill}>{r.title}</Link> : r.title}{r.subtitle ? <span className="muted"> · {r.subtitle}</span> : null}</li>)}</ul>}
          {w.note && <p className="muted">{w.note}</p>}
        </>
      )}
    </article>
  );
}
export default function Project360Page() {
  const t = useT('proj');
  const q = useSearch(); const projectId = Number(q.get('projectId')) || null; const period = q.get('period') || dayIST().slice(0, 7); const tab = q.get('tab') || 'overview';
  usePageTitle(t('p3.title'));
  const d = useQuery({ queryKey: ['proj', 'p360', projectId, period], queryFn: () => p3.get(projectId, period), enabled: Boolean(projectId), retry: false });
  const go = (patch) => { const n = new URLSearchParams({ projectId: String(projectId), period, tab, ...patch }); navigateTo(`/proj/project-360?${n}`); };
  const head = <header><PageHeader id="p3-h" title={d.data ? `${d.data.code} · ${d.data.name}` : t('p3.title')} /><div className="actions-row no-print"><ProjectPicker route="/proj/project-360" projectId={projectId} testId="p3-project" /><Link to="/proj/portfolio">{t('p3.portfolio')}</Link></div></header>;
  if (!projectId) return <section aria-labelledby="p3-h" data-testid="project-360">{head}<p className="muted">{t('p3.choose')}</p></section>;
  if (d.error?.status === 403) return <NoPermission what={t('p3.title')} permission="proj.p360.view" />;
  if (d.isPending) return <Skeleton label={t('p3.title')} rows={8} />;
  if (d.isError) return <ErrorState error={d.error} onRetry={d.refetch} />;
  const x = d.data; const cur = x.tabs.find((k) => k.key === tab) ?? x.tabs[0];
  return (
    <section aria-labelledby="p3-h" data-testid="project-360" data-health={x.health}>
      {head}
      <div className="mdm-panel" data-testid="p3-header">
        <p><StatusBadge status={RAG_TONE[x.health]} label={t(`p3.health.${x.health}`)} /> <StatusBadge status="IN_REVIEW" label={x.lifecycleLabel} /> {x.client && <span>{t('p3.client')}: <strong>{x.client}</strong></span>} · {t('p3.pm')}: <strong>{x.pm ?? '—'}</strong></p>
        <dl className="p3-figures">
          <div><dt>{t('p3.contractValue')}</dt><dd data-testid="p3-value">{x.valueHidden ? t('p3.hidden') : inr(x.contractValue)}</dd></div>
          {!x.valueHidden && x.originalContractValue && x.originalContractValue !== x.contractValue && <div><dt>{t('p3.originalValue')}</dt><dd>{inr(x.originalContractValue)}</dd></div>}
          <div><dt>{t('p3.start')}</dt><dd>{x.startDate ?? '—'}</dd></div><div><dt>{t('p3.scheduled')}</dt><dd>{x.scheduledCompletion ?? '—'}</dd></div><div><dt>{t('p3.forecast')}</dt><dd>{x.forecastCompletion ?? t('p3.noForecast')}</dd></div>
        </dl>
        <ul className="p3-health" aria-label={t('p3.healthTitle')} data-testid="p3-health" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, listStyle: 'none', padding: 0 }}>
          {x.healthItems.map((h) => <li key={h.code} className="mdm-panel" data-testid={`p3-health-${h.code}`} data-level={h.level} style={{ minWidth: 150 }}><strong>{h.label}</strong><br /><StatusBadge status={RAG_TONE[h.level]} label={h.level === 'NONE' ? t('p3.noData') : t(`p3.health.${h.level}`)} /><br /><span className="muted small">{h.detail}</span></li>)}
        </ul>
      </div>
      <div className="actions-row no-print">
        <Field label={t('p3.period')} name="period"><input type="month" value={period} onChange={(e) => e.target.value && go({ period: e.target.value })} data-testid="p3-period" /></Field>
        {x.can.export && ['pdf', 'xlsx', 'csv'].map((f) => <button key={f} type="button" className="btn" onClick={() => downloadFile(`/project-360/export?projectId=${projectId}&period=${period}&format=${f}`, `project-360-${x.code}.${f}`)} data-testid={`p3-export-${f}`}>{f.toUpperCase()}</button>)}
      </div>
      <Tabs tabs={x.tabs.map((k) => k.key)} active={cur.key} onChange={(k) => go({ tab: k })} label={t('p3.title')} labelOf={(k) => t(`p3.tab.${k}`)} />
      <div role="tabpanel" aria-labelledby={`ptab-${cur.key}`} data-testid={`p3-tab-${cur.key}`} className="p3-grid" style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        {cur.widgets.length === 0 ? <p className="muted">{t('p3.emptyTab')}</p> : cur.widgets.map((w) => <Widget key={w.code} w={w} t={t} />)}
      </div>
    </section>
  );
}
