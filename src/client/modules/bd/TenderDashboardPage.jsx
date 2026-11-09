import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, usePageTitle } from '../core/pages/ui.jsx';
import { inrShort, tdr } from './api.js';

// Tender Dashboard (business development, part 08.02): the live tenders and their value, the submissions this week, the bid / no-bid ratio, the tenders by stage, the deadlines of the next fourteen days, and the person's own approvals, tasks, addenda to read and
// queries without an answer; what needs attention. Every figure links to the records behind it.
const TONE = { RED: 'OVERDUE', AMBER: 'AT_RISK', GREEN: 'ACTIVE' };
export default function TenderDashboardPage() {
  const t = useT('bd');
  usePageTitle(t('tdash.title'));
  const q = useQuery({ queryKey: ['bd', 'tender-dashboard'], queryFn: tdr.dashboard, retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('tdash.title')} permission="bd.tender.view" />;
  const d = q.data;
  return (
    <section aria-labelledby="tdash-title" data-testid="tender-dashboard">
      <h1 id="tdash-title">{t('tdash.title')}</h1>
      {q.isPending ? <Skeleton label={t('tdash.title')} rows={5} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
        <>
          <dl className="op-figures" data-testid="tdash-tiles">
            <div><dt>{t('tdash.live')}</dt><dd><Link to="/bd/tenders?filter[stage][in]=OPEN,BID,READY" ><span data-testid="tile-live">{d.tiles.live}</span></Link> <span className="muted small">{inrShort(d.tiles.liveValue)}</span></dd></div>
            <div><dt>{t('tdash.dueWeek')}</dt><dd data-testid="tile-due">{d.tiles.dueThisWeek}</dd></div>
            <div><dt>{t('tdash.ready')}</dt><dd data-testid="tile-ready">{d.tiles.ready}</dd></div>
            <div><dt>{t('tdash.awaiting')}</dt><dd data-testid="tile-awaiting">{d.tiles.awaitingDecision}</dd></div>
            <div><dt>{t('tdash.bidRatio')}</dt><dd data-testid="tile-ratio">{d.tiles.bidRatio == null ? '—' : `${d.tiles.bidRatio}%`} <span className="muted small">{t('tdash.bidNoBid', { bid: d.tiles.bid, noBid: d.tiles.noBid })}</span></dd></div>
          </dl>
          <h2>{t('tdash.byStage')}</h2>
          <ul className="trn-bars" aria-label={t('tdash.byStage')} data-testid="tdash-stages">{d.byStage.map((s) => <li key={s.stage} data-stage={s.stage}><Link to={`/bd/tenders?filter[stage]=${s.stage}`}>{t(`tstage.${s.stage}`)}</Link><span className="trn-bar" role="img" aria-label={String(s.count)}><span style={{ inlineSize: `${Math.round((s.count / Math.max(1, ...d.byStage.map((x) => x.count))) * 100)}%` }} /></span><span>{s.count} · {inrShort(s.value)}</span></li>)}</ul>
          <h2>{t('tdash.upcoming')}</h2>
          {d.upcoming.length === 0 ? <EmptyState title={t('tdash.noUpcoming')} message={t('tdash.noUpcomingHint')} /> : (
            <ul className="mdm-list" data-testid="tdash-upcoming">{d.upcoming.map((e, i) => <li key={i} data-kind={e.kind}><StatusBadge status={TONE[e.tone]} label={e.daysLeft === 0 ? t('cal.today') : t('td.daysLeft', { n: e.daysLeft })} /> <strong>{t(`ekind.${e.kind}`)}</strong> · {e.date}{e.time ? ` ${e.time}` : ''} · <Link to={`/bd/tender?id=${e.tenderId}`}>{e.docNo}</Link> {e.name}</li>)}</ul>)}
          <h2>{t('dash.mine')}</h2>
          <ul className="mdm-list" data-testid="tdash-mine">
            <li>{t('tdash.approvals')}: <Link to="/inbox" data-testid="tdash-approvals">{d.myActions.approvals}</Link></li>
            <li>{t('tdash.toAck')}: <span data-testid="tdash-ack">{d.myActions.addendaToAcknowledge}</span></li>
            <li>{t('tdash.queries')}: <span data-testid="tdash-queries">{d.myActions.queriesWaiting}</span></li>
            {d.myActions.tasks.map((x) => <li key={x.id} data-testid="tdash-task"><Link to={`/bd/tender?id=${x.tenderId}`}>{x.docNo}</Link> · {x.title} · <span className={x.overdue ? 'field-error' : 'muted'}>{x.dueDate}</span></li>)}
          </ul>
          <h2>{t('dash.alerts')}</h2>
          {d.alerts.length === 0 ? <p className="muted">{t('dash.noAlerts')}</p> : <ul className="mdm-list" data-testid="tdash-alerts">{d.alerts.map((a, i) => <li key={i}><StatusBadge status="AT_RISK" label={t(`talert.${a.kind}`)} /> <Link to={a.route}>{a.text}</Link></li>)}</ul>}
        </>)}
      <p className="small"><Link to="/bd/tenders">{t('tenders.title')}</Link> · <Link to="/bd/tender-calendar">{t('cal.title')}</Link> · <Link to="/bd/bid-decisions">{t('bids.title')}</Link></p>
    </section>
  );
}
