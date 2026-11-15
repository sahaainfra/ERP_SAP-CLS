import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, usePageTitle } from '../core/pages/ui.jsx';
import { dayIST, ess } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// My Attendance (HR, part 07.09, FR-01): my days of a month from the register (in, out, late, hours, paid or not) and the punches of today, with the doors to correct a punch. Only my own days are ever read.
const TONE = { PRESENT: 'ACTIVE', ON_DUTY: 'ACTIVE', HALF_DAY: 'AT_RISK', ON_LEAVE: 'IN_REVIEW', ABSENT: 'OVERDUE', MISSING_PUNCH: 'OVERDUE', WEEKLY_OFF: 'CLOSED', HOLIDAY: 'CLOSED', COMP_OFF: 'ACTIVE', HOLIDAY_WORKED: 'ACTIVE', WEEKLY_OFF_WORKED: 'ACTIVE' };
export default function MyAttendancePage() {
  const t = useT('ess');
  usePageTitle(t('att.title'));
  const [month, setMonth] = useState(dayIST(0).slice(0, 7));
  const q = useQuery({ queryKey: ['ess', 'attendance', month], queryFn: () => ess.attendance(month), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('att.title')} permission="hr.ess.view" />;
  const d = q.data;
  return (
    <section aria-labelledby="ma-title" data-testid="my-attendance">
      <PageHeader id="ma-title" title={t('att.title')} />
      <form className="srch-form" aria-label={t('att.month')} onSubmit={(e) => e.preventDefault()}><Field label={t('att.month')} name="month" error={null}><input type="month" value={month} max={dayIST(0).slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} data-testid="ma-month" /></Field></form>
      {q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : q.isPending ? <Skeleton label={t('att.title')} rows={5} /> : (
        <>
          <div className="mdm-panel" data-testid="ma-today"><h2>{t('att.punches')}</h2>
            <p><StatusBadge status={TONE[d.today.status] ?? 'ACTIVE'} label={t(`status.${d.today.status}`)} /></p>
            {d.today.punches.length === 0 ? <p className="muted">{t('home.noPunch')}</p> : <ul className="mdm-list">{d.today.punches.map((p, i) => <li key={i}>{p.type === 'IN' ? t('home.in', { time: new Date(Date.parse(p.at) + 19_800_000).toISOString().slice(11, 16) }) : t('home.out', { time: new Date(Date.parse(p.at) + 19_800_000).toISOString().slice(11, 16) })} ({p.result.toLowerCase()})</li>)}</ul>}
          </div>
          <dl className="op-figures" data-testid="ma-totals"><div><dt>{t('att.paid')}</dt><dd>{d.totals.paidDays}</dd></div><div><dt>{t('att.lop')}</dt><dd>{d.totals.lopDays}</dd></div><div><dt>{t('att.late')}</dt><dd>{d.totals.lateMarks}</dd></div><div><dt>{t('att.ot')}</dt><dd>{d.totals.otMinutes}</dd></div></dl>
          {d.days.length === 0 ? <EmptyState title={t('att.empty')} message="" /> : (
            <div className="table-wrap" tabIndex={0} role="region" aria-label={t('att.legend')}>
              <table className="grid" data-testid="ma-table"><thead><tr><th>{t('team.date')}</th><th>{t('att.title')}</th><th>{t('home.in', { time: '' }).trim()}</th><th>{t('home.out', { time: '' }).trim()}</th></tr></thead>
                <tbody>{d.days.map((x) => (
                  <tr key={x.date} data-testid="ma-row" data-status={x.status}><th scope="row" data-label={t('team.date')}>{x.date}</th><td data-label={t('att.title')}><StatusBadge status={TONE[x.status] ?? 'ACTIVE'} label={t(`status.${x.status}`)} />{x.late ? ` · ${t('home.late')}` : ''}</td><td data-label="In">{x.in ?? '—'}</td><td data-label="Out">{x.out ?? '—'}</td></tr>))}</tbody></table>
            </div>
          )}
          <p className="small"><Link to="/att/regularisation">{t('act.regularise')}</Link> · <Link to="/my-hr">{t('home.title')}</Link></p>
        </>
      )}
    </section>
  );
}
