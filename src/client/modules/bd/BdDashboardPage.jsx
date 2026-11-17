import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, usePageTitle } from '../core/pages/ui.jsx';
import { REGIONS, SECTORS, bd, inr, inrShort } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Business Development Dashboard (part 08.01, FR-05, FR-06): the open pipeline and its weighted forecast (value times probability), the win rate, the pipeline by stage and the forecast by month, the top opportunities, the person's follow-ups and approvals and what needs
// attention. Every figure links to the records behind it. Filters: sector, region, owner and the period of the expected award date.
export default function BdDashboardPage() {
  const t = useT('bd');
  usePageTitle(t('dash.title'));
  const [f, setF] = useState({ sector: '', region: '', owner: '', from: '', to: '' });
  const q = useQuery({ queryKey: ['bd', 'dashboard', f], queryFn: () => bd.dashboard(f), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('dash.title')} permission="bd.forecast.view" />;
  const d = q.data;
  const drill = (extra = '') => `/bd/opportunities?${[f.sector && `filter[sector]=${f.sector}`, f.region && `filter[region]=${f.region}`, f.owner && `filter[owner]=${encodeURIComponent(f.owner)}`, extra].filter(Boolean).join('&')}`;
  const max = d ? Math.max(1, ...d.byStage.map((s) => s.value)) : 1; const maxM = d ? Math.max(1, ...d.byMonth.map((s) => s.weighted)) : 1;
  return (
    <section aria-labelledby="bd-title" data-testid="bd-dashboard">
      <PageHeader id="bd-title" title={t('dash.title')} />
      <form className="srch-form mdm-fields no-print" aria-label={t('pipe.filters')} onSubmit={(e) => e.preventDefault()}>
        <Field label={t('lead.sector')} name="sector" error={null}><select value={f.sector} onChange={(e) => setF({ ...f, sector: e.target.value })} data-testid="bd-sector"><option value="">{t('filter.all')}</option>{SECTORS.map((k) => <option key={k} value={k}>{t(`sector.${k}`)}</option>)}</select></Field>
        <Field label={t('lead.region')} name="region" error={null}><select value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })} data-testid="bd-region"><option value="">{t('filter.all')}</option>{REGIONS.map((k) => <option key={k} value={k}>{t(`region.${k}`)}</option>)}</select></Field>
        <LookupField id="bd-owner" label={t('lead.owner')} lookup="bd/owners" valueKey="code" value={f.owner} onChange={(x) => setF({ ...f, owner: x })} />
        <Field label={t('dash.from')} name="from" error={null}><input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} data-testid="bd-from" /></Field>
        <Field label={t('dash.to')} name="to" error={null}><input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} data-testid="bd-to" /></Field>
      </form>
      {q.isPending ? <Skeleton label={t('dash.title')} rows={5} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
        <>
          <dl className="op-figures" data-testid="bd-tiles">
            <div><dt>{t('dash.open')}</dt><dd data-testid="tile-open"><Link to={drill()}>{d.tiles.openCount}</Link></dd></div>
            <div><dt>{t('dash.pipeline')}</dt><dd data-testid="tile-pipeline" title={inr(d.tiles.pipeline)}>{inrShort(d.tiles.pipeline)}</dd></div>
            <div><dt>{t('dash.weighted')}</dt><dd data-testid="tile-weighted" title={inr(d.tiles.weighted)}>{inrShort(d.tiles.weighted)}</dd></div>
            <div><dt>{t('dash.winRate')}</dt><dd data-testid="tile-winrate">{d.tiles.winRate == null ? '—' : `${d.tiles.winRate}%`} <span className="muted small">{t('dash.wonLost', { won: d.tiles.won.count, lost: d.tiles.lost.count })}</span></dd></div>
            <div><dt>{t('dash.approvals')}</dt><dd data-testid="tile-approvals"><Link to="/inbox">{d.myActions.approvals}</Link></dd></div>
          </dl>
          <h2>{t('dash.byStage')}</h2>
          {d.tiles.openCount === 0 ? <EmptyState title={t('dash.emptyTitle')} message={t('dash.emptyText')} /> : (
            <ul className="trn-bars" aria-label={t('dash.byStage')} data-testid="bd-by-stage">{d.byStage.map((s) => <li key={s.stage} data-stage={s.stage}><Link to={drill(`filter[stage]=${s.stage}`)}>{t(`stage.${s.stage}`)}</Link><span className="trn-bar" role="img" aria-label={inrShort(s.value)}><span style={{ inlineSize: `${Math.round((s.value / max) * 100)}%` }} /></span><span>{s.count} · {inrShort(s.value)}</span></li>)}</ul>)}
          <h2>{t('dash.byMonth')}</h2>
          {d.byMonth.length === 0 ? <p className="muted">{t('dash.noForecast')}</p> : <ul className="trn-bars" aria-label={t('dash.byMonth')} data-testid="bd-by-month">{d.byMonth.map((m) => <li key={m.key}><span>{m.label}</span><span className="trn-bar" role="img" aria-label={inrShort(m.weighted)}><span style={{ inlineSize: `${Math.round((m.weighted / maxM) * 100)}%` }} /></span><span>{inrShort(m.weighted)}</span></li>)}</ul>}
          <h2>{t('dash.top')}</h2>
          {d.top.length === 0 ? <p className="muted">{t('dash.none')}</p> : (
            <div className="table-wrap" tabIndex={0} role="region" aria-label={t('dash.top')}>
              <table className="grid" data-testid="bd-top"><thead><tr><th>{t('opp.title')}</th><th>{t('opp.client')}</th><th>{t('opp.stage')}</th><th>{t('lead.estValue')}</th><th>{t('opp.probability')}</th><th>{t('opp.weighted')}</th></tr></thead>
                <tbody>{d.top.map((o) => <tr key={o.id} data-testid="bd-top-row"><th scope="row" data-label={t('opp.title')}><Link to={`/bd/opportunity?id=${o.id}`}>{o.name}</Link></th><td data-label={t('opp.client')}>{o.client}</td><td data-label={t('opp.stage')}>{o.stageLabel}</td><td data-label={t('lead.estValue')}>{inrShort(o.estValue)}</td><td data-label={t('opp.probability')}>{o.probability}%</td><td data-label={t('opp.weighted')}>{inrShort(o.weighted)}</td></tr>)}</tbody></table>
            </div>)}
          <h2>{t('dash.mine')}</h2>
          {d.myActions.followUps.length === 0 ? <p className="muted" data-testid="bd-no-followups">{t('dash.noFollowUps')}</p> : <ul className="mdm-list" data-testid="bd-followups">{d.myActions.followUps.map((x) => <li key={x.id}><Link to={x.entity === 'LEAD' ? `/bd/lead?id=${x.entityId}` : x.entity === 'OPPORTUNITY' ? `/bd/opportunity?id=${x.entityId}` : `/bd/client?id=${x.entityId}`}>{x.subject.d}</Link> · {x.nextAction} · <span className={x.overdue ? 'field-error' : 'muted'}>{x.nextActionDate}</span></li>)}</ul>}
          <h2>{t('dash.alerts')}</h2>
          {d.alerts.length === 0 ? <p className="muted">{t('dash.noAlerts')}</p> : <ul className="mdm-list" data-testid="bd-alerts">{d.alerts.map((a, i) => <li key={i}><StatusBadge status="AT_RISK" label={t(`alert.${a.kind}`)} /> <Link to={a.route}>{a.text}</Link></li>)}</ul>}
          <h2>{t('dash.winLoss')}</h2>
          {d.winLoss.reasons.length === 0 ? <p className="muted">{t('dash.noLosses')}</p> : <ul className="mdm-list" data-testid="bd-reasons">{d.winLoss.reasons.map((r) => <li key={r.code}>{r.label}: {r.count} · {inrShort(r.value)}</li>)}</ul>}
        </>)}
      <p className="small"><Link to="/bd/pipeline">{t('pipe.title')}</Link> · <Link to="/bd/leads">{t('leads.title')}</Link> · <Link to="/bd/clients">{t('clients.title')}</Link></p>
    </section>
  );
}
