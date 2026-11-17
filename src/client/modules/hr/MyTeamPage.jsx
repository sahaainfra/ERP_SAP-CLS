import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, usePageTitle } from '../core/pages/ui.jsx';
import { dayIST, ess } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// My Team (HR, part 07.09, FR-02): for a manager, the people who report to them, directly or through others: who is in, on leave, absent or not in yet on a day, what waits for the manager's decision (leave, regularisation, overtime, letters
// and the rest), who is away in the next 14 days. A team member shows name, post, place and today only: no bank, ID, salary or address. Works on a phone, in English or Hindi.
const TONE = { WORKING: 'ACTIVE', PRESENT: 'ACTIVE', ON_DUTY: 'ACTIVE', HALF_DAY: 'AT_RISK', NOT_IN: 'AT_RISK', ON_LEAVE: 'IN_REVIEW', ABSENT: 'OVERDUE', MISSING_PUNCH: 'OVERDUE', WEEKLY_OFF: 'CLOSED', HOLIDAY: 'CLOSED', COMP_OFF: 'ACTIVE' };
const WHERE = { leave: '/leave/approvals', regularisation: '/att/approvals', overtime: '/att/approvals', manual: '/att/approvals', letter: '/work/approvals', worker: '/work/approvals', visit: '/work/approvals' };
export default function MyTeamPage() {
  const t = useT('ess');
  usePageTitle(t('team.title'));
  const [date, setDate] = useState(dayIST(0));
  const q = useQuery({ queryKey: ['ess', 'team', date], queryFn: () => ess.team(date), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('team.title')} permission="hr.ess.team" />;
  const d = q.data;
  return (
    <section aria-labelledby="mt-title" data-testid="my-team">
      <PageHeader id="mt-title" title={t('team.title')} />
      <form className="srch-form" aria-label={t('team.date')} onSubmit={(e) => e.preventDefault()}><Field label={t('team.date')} name="date" error={null}><input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} data-testid="mt-date" /></Field></form>
      {q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : q.isPending ? <Skeleton label={t('team.title')} rows={5} /> : d.members.length === 0 ? <EmptyState title={t('team.none')} message="" /> : (
        <>
          <dl className="op-figures" data-testid="mt-summary">{[['total', d.summary.total], ['present', d.summary.present], ['onLeave', d.summary.onLeave], ['absent', d.summary.absent], ['notIn', d.summary.notIn], ['late', d.summary.late]].map(([k, n]) => <div key={k}><dt>{t(`team.${k}`)}</dt><dd data-testid={`mt-${k}`}>{n}</dd></div>)}</dl>
          <h2>{t('team.approvals')}</h2>
          {d.approvalsTotal === 0 ? <p className="muted">{t('pending.none')}</p> : <ul className="mdm-list" data-testid="mt-approvals">{Object.entries(d.approvals).map(([k, n]) => <li key={k}><Link to={WHERE[k] ?? '/work/approvals'}>{t(`team.kind.${k}`)}: {n}</Link></li>)}</ul>}
          <h2>{t('team.away')}</h2>
          {d.away.length === 0 ? <p className="muted">{t('team.nobodyAway')}</p> : <ul className="mdm-list" data-testid="mt-away">{d.away.map((a) => <li key={a.id}>{a.name}: {a.from}{a.to !== a.from ? ` – ${a.to}` : ''} ({a.type}{a.waiting ? `, ${t('team.waiting')}` : ''})</li>)}</ul>}
          <h2>{t('team.members')}</h2>
          <div className="table-wrap" tabIndex={0} role="region" aria-label={t('team.members')}>
            <table className="grid" data-testid="mt-table"><thead><tr><th>{t('team.members')}</th><th>{t('att.title')}</th><th>{t('home.in', { time: '' }).trim()}</th><th>{t('home.out', { time: '' }).trim()}</th></tr></thead>
              <tbody>{d.members.map((m) => (
                <tr key={m.id} data-testid="mt-row" data-code={m.code} data-status={m.status}>
                  <th scope="row" data-label={t('team.members')}>{m.name} <span className="muted small">{m.code}{m.designation ? ` · ${m.designation}` : ''}{m.direct ? '' : ` · ${t('team.indirect')}`}</span></th>
                  <td data-label={t('att.title')}><StatusBadge status={TONE[m.status] ?? 'ACTIVE'} label={m.leaveType && m.status === 'ON_LEAVE' ? `${t('status.ON_LEAVE')}: ${m.leaveType}` : t(`status.${m.status}`)} />{m.late ? ` · ${t('home.late')}` : ''}</td><td data-label="In">{m.inTime ?? '—'}</td><td data-label="Out">{m.outTime ?? '—'}</td>
                </tr>))}</tbody></table>
          </div>
          <p className="small"><Link to="/leave/calendar">{t('act.myleave')}</Link> · <Link to="/my-hr">{t('home.title')}</Link></p>
        </>
      )}
    </section>
  );
}
