import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, usePageTitle } from '../core/pages/ui.jsx';
import { fmtDate, hse, qs } from './api.js';
import { big } from './HseParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Induction and Toolbox Compliance (part 19.01, FR-04): per site, the workers deployed with and without a valid induction, those expiring, and the toolbox talks held; the sites with no talk this week stand out.
export default function CompliancePage() {
  const t = useT('hse'); usePageTitle(t('cmp.title')); const [projectId, setProjectId] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const q = useQuery({ queryKey: ['hse', 'compliance', projectId, from, to], queryFn: () => hse.get(`/compliance${qs({ projectId, from, to })}`), retry: false });
  const po = useQuery({ queryKey: ['hse', 'plan-options'], queryFn: () => hse.get('/plans/options'), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('cmp.title')} permission="hse.induction.view" />; if (q.isPending) return <Skeleton label={t('cmp.title')} rows={4} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  return (
    <section aria-labelledby="cmp-h" data-testid="hse-compliance"><PageHeader id="cmp-h" title={t('cmp.title')} subtitle={<>{t('cmp.intro')} <Link to="/hse/induction">{t('ind.title')}</Link> · <Link to="/hse/toolbox">{t('tbt.title')}</Link></>} />
      <div className="form-grid no-print"><Field label={t('project')} name="projectId" error={null}><select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={big} data-testid="hse-cmp-project"><option value="">{t('cmp.all')}</option>{(po.data?.projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></Field>
        <Field label={t('cmp.from')} name="from" error={null}><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={big} /></Field><Field label={t('cmp.to')} name="to" error={null}><input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={big} /></Field>
        <button type="button" className="btn" style={big} onClick={() => hse.exportFile(`/compliance/export${qs({ projectId, from, to })}`, 'induction-toolbox-compliance.csv').catch(() => globalThis.alert?.(t('exportFailed')))} data-testid="hse-cmp-export">{t('export')}</button></div>
      <p data-testid="hse-cmp-totals">{t('cmp.totals', { deployed: d.totals.deployed, inducted: d.totals.inducted, not: d.totals.notInducted, expiring: d.totals.expiringSoon, talks: d.totals.talks, overdue: d.totals.sitesWithoutRecentTalk })}</p>
      {d.sites.length === 0 ? <div className="empty-state" data-testid="hse-cmp-empty"><h2>{t('cmp.emptyTitle')}</h2><p>{t('cmp.emptyBody')}</p></div> : (
        <div className="table-scroll"><table className="data-table" data-testid="hse-cmp-table"><thead><tr><th>{t('project')}</th><th>{t('site')}</th><th>{t('cmp.deployed')}</th><th>{t('cmp.inducted')}</th><th>{t('cmp.notInducted')}</th><th>{t('cmp.coverage')}</th><th>{t('cmp.expiring')}</th><th>{t('cmp.talks')}</th><th>{t('cmp.lastTalk')}</th></tr></thead>
          <tbody>{d.sites.map((s) => <tr key={s.siteId} data-testid="hse-cmp-row"><td>{s.project}</td><td>{s.site}</td><td>{s.deployed}</td><td>{s.inducted}</td><td>{s.notInducted}{s.missing.length > 0 && <small> ({s.missing.map((m) => m.name).slice(0, 3).join(', ')})</small>}</td><td>{s.coveragePct == null ? '—' : `${s.coveragePct}%`}</td><td>{s.expiringSoon}</td><td>{s.talks} ({s.talkAttendance})</td><td>{s.lastTalk ? fmtDate(s.lastTalk) : '—'} {s.talkOverdue && <StatusBadge status="REJECTED" label={t('cmp.overdue')} />}</td></tr>)}</tbody></table></div>)}
    </section>
  );
}
