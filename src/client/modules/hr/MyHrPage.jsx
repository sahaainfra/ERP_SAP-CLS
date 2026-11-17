import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, usePageTitle } from '../core/pages/ui.jsx';
import { ess } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// My HR (HR, part 07.09, FR-01 and FR-04): the home of an employee on a phone or a computer, in English or Hindi: where I stand today (in, out, late), the month so far, my leave balances, what is waiting (my requests in approval,
// what was returned to me, what waits for my decision, policies to acknowledge) and the doors to what I do most: punch, apply for leave, correct a punch, ask for a letter, change my details. Everything on it is my own.
const TONE = { WORKING: 'ACTIVE', PRESENT: 'ACTIVE', ON_DUTY: 'ACTIVE', HALF_DAY: 'AT_RISK', NOT_IN: 'AT_RISK', ON_LEAVE: 'IN_REVIEW', ABSENT: 'OVERDUE', MISSING_PUNCH: 'OVERDUE', WEEKLY_OFF: 'CLOSED', HOLIDAY: 'CLOSED', COMP_OFF: 'ACTIVE' };
export default function MyHrPage() {
  const t = useT('ess');
  usePageTitle(t('home.title'));
  const q = useQuery({ queryKey: ['ess', 'home'], queryFn: ess.home, retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('home.title')} permission="hr.ess.view" />;
  if (q.isPending) return <Skeleton label={t('home.title')} rows={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const h = q.data;
  const pend = [['leave', '/leave/my'], ['regularisations', '/att/regularisation'], ['overtime', '/att/overtime'], ['letters', '/my-hr/letters'], ['profile', '/my-hr/profile']].filter(([k]) => h.pending[k] > 0);
  const stat = (k, v) => <div key={k}><dt>{t(`month.${k}`)}</dt><dd data-testid={`mh-month-${k}`}>{v}</dd></div>;
  return (
    <section aria-labelledby="mh-title" data-testid="my-hr">
      <PageHeader id="mh-title" title={t('home.title')} />
      <p data-testid="mh-who"><strong>{h.employee.name}</strong> <span className="muted small">{h.employee.code}{h.employee.designation ? ` · ${h.employee.designation}` : ''}{h.employee.site ? ` · ${h.employee.site}` : ''}</span></p>
      <div className="mdm-panel" data-testid="mh-today">
        <h2>{t('home.today')}</h2>
        <p><StatusBadge status={TONE[h.today.status] ?? 'ACTIVE'} label={t(`status.${h.today.status}`)} /> {h.today.late && <StatusBadge status="AT_RISK" label={t('home.late')} />}</p>
        <p className="muted" data-testid="mh-times">{h.today.inTime ? t('home.in', { time: h.today.inTime }) : t('home.noPunch')}{h.today.outTime ? ` · ${t('home.out', { time: h.today.outTime })}` : ''}</p>
      </div>
      <h2>{t('home.month')}</h2>
      <dl className="op-figures" data-testid="mh-month">{stat('present', h.month.present)}{stat('absent', h.month.absent)}{stat('late', h.month.late)}{stat('leave', h.month.leave)}{stat('missing', h.month.missing)}</dl>
      {h.balances.length > 0 && <><h2>{t('home.balances')}</h2><dl className="op-figures" data-testid="mh-balances">{h.balances.map((b) => <div key={b.code}><dt>{b.name}</dt><dd data-code={b.code}>{b.remaining}</dd></div>)}</dl></>}
      <h2>{t('home.pending')}</h2>
      <ul className="mdm-list" data-testid="mh-pending">
        {h.waitingForMe > 0 && <li><Link to="/work/approvals">{t('pending.waiting')}: {h.waitingForMe}</Link></li>}
        {h.pending.returned > 0 && <li>{t('pending.returned')}: {h.pending.returned}</li>}
        {pend.map(([k, to]) => <li key={k}><Link to={to}>{t(`pending.${k}`)}: {h.pending[k]}</Link></li>)}
        {h.policies?.toAcknowledge > 0 && <li><Link to="/collab/my-policies">{t('pending.policies')}: {h.policies.toAcknowledge}</Link></li>}
        {!h.waitingForMe && !h.pending.returned && pend.length === 0 && !(h.policies?.toAcknowledge > 0) && <li className="muted">{t('pending.none')}</li>}
      </ul>
      <h2>{t('home.actions')}</h2>
      <div className="actions-row" data-testid="mh-actions">
        <Link to="/att/punch" className="btn btn-primary">{t('act.punch')}</Link>
        {h.can.leave && <Link to="/leave/apply" className="btn">{t('act.leave')}</Link>}
        {h.can.regularise && <Link to="/att/regularisation" className="btn">{t('act.regularise')}</Link>}
        {h.can.letter && <Link to="/my-hr/letters" className="btn">{t('act.letter')}</Link>}
        <Link to="/my-hr/profile" className="btn">{t('act.profile')}</Link>
        <Link to="/my-hr/attendance" className="btn">{t('act.attendance')}</Link>
        {h.can.leave && <Link to="/leave/my" className="btn">{t('act.myleave')}</Link>}
        {h.isManager && <Link to="/my-team" className="btn" data-testid="mh-team">{t('act.team')}</Link>}
      </div>
    </section>
  );
}
