import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, usePageTitle } from '../core/pages/ui.jsx';
import { dayIST, trn } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Mandatory Training Compliance (HR, part 07.10, FR-02 and FR-06): for every mandatory course, who has done it, whose is due within 30 days, whose has lapsed and who has never done it, for a site and a course, with the sessions that
// will close each gap; and the cost of training by project and department for a period. A figure opens the people behind it; the tables export to CSV; the page prints.
const TONE = { COMPLIANT: 'COMPLETED', DUE_SOON: 'AT_RISK', OVERDUE: 'OVERDUE', NOT_DONE: 'REJECTED' };
const inr = (n) => (n == null ? '—' : `₹ ${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const saveCsv = (name, lines) => {
  const blob = new Blob([lines.map((l) => l.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href);
};
export default function ComplianceReportPage() {
  const t = useT('trn');
  usePageTitle(t('comp.title'));
  const [tab, setTab] = useState('compliance');
  const [f, setF] = useState({ siteId: '', courseId: '', status: '' });
  const [range, setRange] = useState({ from: `${dayIST(0).slice(0, 4)}-04-01`, to: dayIST(0) });
  const courses = useQuery({ queryKey: ['trn', 'courses'], queryFn: trn.courses, retry: false });
  const q = useQuery({ queryKey: ['trn', 'compliance', f], queryFn: () => trn.compliance({ siteId: f.siteId || undefined, courseId: f.courseId || undefined, status: f.status || undefined, limit: 500 }), retry: false });
  const cost = useQuery({ queryKey: ['trn', 'costs', range], queryFn: () => trn.costs(range), enabled: tab === 'cost', retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('comp.title')} permission="hr.training.report" />;
  const d = q.data;
  const tile = (k, v) => <div key={k}><dt>{t(`comp.${k}`)}</dt><dd data-testid={`cp-${k}`}>{v}</dd></div>;
  return (
    <section aria-labelledby="cp-title" data-testid="compliance">
      <PageHeader id="cp-title" title={t('comp.title')} />
      <div className="actions-row no-print">
        <div role="tablist" aria-label={t('comp.title')} style={{ display: 'contents' }}>
        <button type="button" role="tab" aria-selected={tab === 'compliance'} className={`btn${tab === 'compliance' ? ' btn-primary' : ''}`} onClick={() => setTab('compliance')} data-testid="cp-tab-compliance">{t('comp.tabCompliance')}</button>
        <button type="button" role="tab" aria-selected={tab === 'cost'} className={`btn${tab === 'cost' ? ' btn-primary' : ''}`} onClick={() => setTab('cost')} data-testid="cp-tab-cost">{t('comp.tabCost')}</button></div>
        <button type="button" className="btn" onClick={() => window.print()}>{t('cal.print')}</button>
      </div>
      {tab === 'compliance' ? (
        <>
          <form className="srch-form mdm-fields no-print" aria-label={t('skill.filters')} onSubmit={(e) => e.preventDefault()}>
            <LookupField id="cp-site" label={t('s.site')} lookup="iam/sites" value={f.siteId} onChange={(x) => setF({ ...f, siteId: x })} />
            <Field label={t('s.course')} name="courseId" error={null}><select value={f.courseId} onChange={(e) => setF({ ...f, courseId: e.target.value })} data-testid="cp-course"><option value="">{t('comp.allCourses')}</option>{(courses.data ?? []).filter((c) => Object.keys(c.mandatoryFor ?? {}).length).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></Field>
            <Field label={t('s.status')} name="status" error={null}><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} data-testid="cp-status"><option value="">{t('comp.allStatus')}</option>{Object.keys(TONE).map((k) => <option key={k} value={k}>{t(`comp.st.${k}`)}</option>)}</select></Field>
          </form>
          {q.isPending ? <Skeleton label={t('comp.title')} rows={5} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
            <>
              <dl className="op-figures" data-testid="cp-summary">{tile('required', d.summary.required)}{tile('compliant', d.summary.compliant)}{tile('dueSoon', d.summary.dueSoon)}{tile('overdue', d.summary.overdue)}{tile('notDone', d.summary.notDone)}</dl>
              {d.byCourse.length > 0 && <ul className="trn-bars" aria-label={t('comp.byCourse')} data-testid="cp-bars">{d.byCourse.map((c) => <li key={c.courseId}><span>{c.course}</span><span className="trn-bar" role="img" aria-label={`${c.pct ?? 0}%`}><span style={{ inlineSize: `${c.pct ?? 0}%` }} /></span><span>{c.compliant}/{c.required}</span></li>)}</ul>}
              <div className="actions-row no-print"><button type="button" className="btn" onClick={() => saveCsv('mandatory-training.csv', [[t('skill.person'), t('skill.code'), t('s.course'), t('comp.doneOn'), t('comp.dueOn'), t('s.status'), t('comp.next')], ...d.rows.map((r) => [r.person, r.code, r.course, r.doneOn, r.dueOn, r.status, r.nextSession])])} data-testid="cp-export">{t('act.csv')}</button></div>
              {d.rows.length === 0 ? <EmptyState title={t('comp.none')} message={t('comp.noneHint')} /> : (
                <div className="table-wrap" tabIndex={0} role="region" aria-label={t('comp.title')}>
                  <table className="grid" data-testid="cp-table"><thead><tr><th>{t('skill.person')}</th><th>{t('s.course')}</th><th>{t('comp.doneOn')}</th><th>{t('comp.dueOn')}</th><th>{t('s.status')}</th><th>{t('comp.next')}</th></tr></thead>
                    <tbody>{d.rows.map((r) => (
                      <tr key={`${r.personType}${r.personId}${r.courseId}`} data-testid="cp-row" data-status={r.status}>
                        <th scope="row" data-label={t('skill.person')}>{r.person} <span className="muted small">{r.code}</span></th><td data-label={t('s.course')}>{r.course}</td><td data-label={t('comp.doneOn')}>{r.doneOn ?? '—'}</td><td data-label={t('comp.dueOn')}>{r.dueOn ?? '—'}</td>
                        <td data-label={t('s.status')}><StatusBadge status={TONE[r.status]} label={t(`comp.st.${r.status}`)} /></td><td data-label={t('comp.next')}>{r.nextSession ? r.nextSession.replace('T', ' ') : '—'}</td>
                      </tr>))}</tbody></table>
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <form className="srch-form mdm-fields no-print" aria-label={t('comp.period')} onSubmit={(e) => e.preventDefault()}>
            <Field label={t('comp.from')} name="from" error={null}><input type="date" value={range.from} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} data-testid="cc-from" /></Field>
            <Field label={t('comp.to')} name="to" error={null}><input type="date" value={range.to} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} data-testid="cc-to" /></Field>
          </form>
          {cost.isPending ? <Skeleton label={t('comp.tabCost')} rows={3} /> : cost.isError ? <ErrorState error={cost.error} onRetry={cost.refetch} /> : (
            <>
              <dl className="op-figures" data-testid="cc-summary"><div><dt>{t('comp.total')}</dt><dd data-testid="cc-total">{inr(cost.data.total)}</dd></div><div><dt>{t('comp.sessions')}</dt><dd>{cost.data.sessions}</dd></div><div><dt>{t('comp.attended')}</dt><dd>{cost.data.attended}</dd></div></dl>
              {[['byProject', 'comp.byProject'], ['byDepartment', 'comp.byDepartment']].map(([k, label]) => (
                <div key={k}><h2>{t(label)}</h2>
                  {cost.data[k].length === 0 ? <p className="muted">{t('comp.noCost')}</p> : (
                    <div className="table-wrap" tabIndex={0} role="region" aria-label={t(label)}><table className="grid" data-testid={`cc-${k}`}><thead><tr><th>{t(label)}</th><th>{t('comp.sessions')}</th><th>{t('comp.attended')}</th><th>{t('comp.total')}</th><th>{t('comp.perHead')}</th></tr></thead>
                      <tbody>{cost.data[k].map((g) => <tr key={g.id ?? 'none'}><th scope="row" data-label={t(label)}>{g.name}</th><td data-label={t('comp.sessions')}>{g.sessions}</td><td data-label={t('comp.attended')}>{g.attended}</td><td data-label={t('comp.total')}>{inr(g.cost)}</td><td data-label={t('comp.perHead')}>{inr(g.perHead)}</td></tr>)}</tbody></table></div>
                  )}
                </div>))}
              <div className="actions-row no-print"><button type="button" className="btn" onClick={() => saveCsv('training-cost.csv', [['Group', 'Name', 'Sessions', 'Attended', 'Cost', 'Per head'], ...cost.data.byProject.map((g) => ['Project', g.name, g.sessions, g.attended, g.cost, g.perHead]), ...cost.data.byDepartment.map((g) => ['Department', g.name, g.sessions, g.attended, g.cost, g.perHead])])}>{t('act.csv')}</button></div>
            </>
          )}
        </>
      )}
      <p className="small"><Link to="/training">{t('cal.title')}</Link> · <Link to="/training/certifications">{t('cert.title')}</Link></p>
    </section>
  );
}
