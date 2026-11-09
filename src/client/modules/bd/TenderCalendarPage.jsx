import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, usePageTitle } from '../core/pages/ui.jsx';
import { dayIST, tdr } from './api.js';

// Tender Calendar (business development, part 08.02, FR-07): the pre-bid meetings, submissions, openings and the team's task dates of the tenders in the person's scope, by month; a day with an event is listed below the month as well, so that a phone reads it as an agenda.
// The owner and the team are reminded by the daily job on the days before each date.
const TONE = { RED: 'OVERDUE', AMBER: 'AT_RISK', GREEN: 'ACTIVE' };
const monthStart = (d) => `${d.slice(0, 7)}-01`;
const addMonth = (d, n) => { const x = new Date(`${monthStart(d)}T00:00:00Z`); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
const lastDay = (d) => { const x = new Date(`${addMonth(d, 1)}T00:00:00Z`); x.setUTCDate(0); return x.toISOString().slice(0, 10); };
export default function TenderCalendarPage() {
  const t = useT('bd');
  usePageTitle(t('cal.title'));
  const [month, setMonth] = useState(monthStart(dayIST(0)));
  const from = month; const to = lastDay(month);
  const q = useQuery({ queryKey: ['bd', 'calendar', from], queryFn: () => tdr.calendar({ from, to }), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('cal.title')} permission="bd.tender.view" />;
  const events = q.data?.events ?? [];
  const byDay = new Map(); for (const e of events) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
  const lead = (new Date(`${from}T00:00:00Z`).getUTCDay() + 6) % 7; const days = Number(to.slice(8, 10));
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${from.slice(0, 8)}${String(i + 1).padStart(2, '0')}`)];
  const label = new Date(`${from}T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return (
    <section aria-labelledby="cal-title" data-testid="tender-calendar">
      <h1 id="cal-title">{t('cal.title')}</h1>
      <div className="actions-row no-print">
        <button type="button" className="btn" onClick={() => setMonth(addMonth(month, -1))} data-testid="cal-prev" aria-label={t('cal.prev')}>‹</button>
        <strong data-testid="cal-month" aria-live="polite">{label}</strong>
        <button type="button" className="btn" onClick={() => setMonth(addMonth(month, 1))} data-testid="cal-next" aria-label={t('cal.next')}>›</button>
        <button type="button" className="btn" onClick={() => setMonth(monthStart(dayIST(0)))}>{t('cal.today')}</button>
      </div>
      {q.isPending ? <Skeleton label={t('cal.title')} rows={5} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
        <>
          <div className="table-wrap" tabIndex={0} role="region" aria-label={label}>
            <table className="grid cal-grid" data-testid="cal-grid"><thead><tr>{['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((k) => <th key={k} scope="col">{t(`cal.${k}`)}</th>)}</tr></thead>
              <tbody>{Array.from({ length: Math.ceil(cells.length / 7) }, (_, w) => (
                <tr key={w}>{cells.slice(w * 7, w * 7 + 7).concat(Array(7).fill(null)).slice(0, 7).map((c, i) => (
                  <td key={i} data-label={c ?? ''} data-day={c ?? ''} data-events={c ? (byDay.get(c)?.length ?? 0) : 0} className={c === dayIST(0) ? 'is-today' : ''}>
                    {c && <><span className="muted small">{Number(c.slice(8))}</span>{(byDay.get(c) ?? []).map((e, k) => <div key={k} className="small" data-kind={e.kind}><Link to={`/bd/tender?id=${e.tenderId}`}>{t(`ekind.${e.kind}`)}: {e.docNo}</Link></div>)}</>}
                  </td>))}</tr>))}</tbody></table>
          </div>
          <h2>{t('cal.agenda')}</h2>
          {events.length === 0 ? <EmptyState title={t('cal.none')} message={t('cal.noneHint')} /> : (
            <ul className="mdm-list" data-testid="cal-agenda">{events.map((e, i) => <li key={i} data-kind={e.kind} data-date={e.date}><StatusBadge status={TONE[e.tone]} label={e.daysLeft < 0 ? t('cal.late', { n: -e.daysLeft }) : e.daysLeft === 0 ? t('cal.today') : t('td.daysLeft', { n: e.daysLeft })} /> <strong>{t(`ekind.${e.kind}`)}</strong> · {e.date}{e.time ? ` ${e.time}` : ''} · <Link to={`/bd/tender?id=${e.tenderId}`}>{e.docNo}</Link> {e.name}</li>)}</ul>)}
        </>)}
      <p className="small"><Link to="/bd/tender-dashboard">{t('tdash.title')}</Link> · <Link to="/bd/tenders">{t('tenders.title')}</Link></p>
    </section>
  );
}
