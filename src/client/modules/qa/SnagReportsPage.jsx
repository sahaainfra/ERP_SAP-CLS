import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, usePageTitle } from '../core/pages/ui.jsx';
import { qa } from './api.js';
import { sel } from './QaParts.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Snag Status by Area and Party, and the Unit Snag Report (part 18.06, FR-04, FR-05): the share closed by area and party, the punch classes still open (class A blocks handover), and the snags of one unit with a PDF.
const Group = ({ rows, label, testId, t }) => <div className="table-scroll"><table className="data-table" data-testid={testId}><caption>{label}</caption><thead><tr><th>{t('nca.group')}</th><th className="num">{t('ss.total')}</th><th className="num">{t('ss.open')}</th><th className="num">{t('ss.rectified')}</th><th className="num">{t('ss.closed')}</th><th className="num">{t('ss.overdue')}</th><th className="num">{t('ss.closedPct')}</th></tr></thead><tbody>{rows.map((g) => <tr key={g.key} data-testid={`${testId}-row`}><td>{g.label}</td><td className="num">{g.total}</td><td className="num">{g.open}</td><td className="num">{g.rectified}</td><td className="num">{g.closed}</td><td className="num">{g.overdue}</td><td className="num">{g.closedPct} %</td></tr>)}</tbody></table></div>;
export function SnagStatusPage() {
  const t = useT('qa'); usePageTitle(t('ss.title')); const [projectId, setProjectId] = useState(''); const oq = useQuery({ queryKey: ['qa', 'snag-options'], queryFn: () => qa.get('/snags/options'), retry: false });
  const q = useQuery({ queryKey: ['qa', 'snag-status', projectId], queryFn: () => qa.get(`/snag-status${projectId ? `?projectId=${projectId}` : ''}`), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('ss.title')} permission="qa.snag.view" />; if (q.isPending) return <Skeleton label={t('ss.title')} rows={4} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const s = q.data; const tile = (k, v) => <KpiTile key={k} label={t(`ss.${k}`)} value={v} testid={`ss-${k}`} />;
  return (
    <section aria-labelledby="ss-h" data-testid="qa-snag-status"><PageHeader id="ss-h" title={t('ss.title')} subtitle={<><Link to="/qa/snags">{t('snag.title')}</Link> · {s.handoverBlocked ? <StatusBadge status="REJECTED" label={t('ss.blocked', { n: s.openByClass.A })} /> : <StatusBadge status="APPROVED" label={t('ss.clear')} />}</>} />
      <div className="mdm-panel no-print"><label>{t('project')}<select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={sel} data-testid="ss-project"><option value="">{t('allProjects')}</option>{(oq.data?.projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></label></div>
      <KpiRow>{tile('total', s.total)}{tile('open', s.open)}{tile('rectified', s.rectified)}{tile('closed', s.closed)}{tile('overdue', s.overdue)}{tile('closedPct', s.closedPct == null ? '—' : `${s.closedPct} %`)}</KpiRow>
      <p data-testid="ss-classes">{t('ss.openByClass', { a: s.openByClass.A, b: s.openByClass.B, c: s.openByClass.C })}</p>
      {s.total === 0 ? <EmptyState title={t('snag.emptyTitle')} message={t('snag.emptyBody')} /> : <><Group rows={s.byArea} label={t('ss.byArea')} testId="ss-area" t={t} /><Group rows={s.byParty} label={t('ss.byParty')} testId="ss-party" t={t} /><Group rows={s.byCategory} label={t('ss.byCategory')} testId="ss-category" t={t} /></>}
    </section>
  );
}
export function SnagReportPage() {
  const t = useT('qa'); usePageTitle(t('sr.title')); const [projectId, setProjectId] = useState(''); const [locationId, setLocationId] = useState(''); const oq = useQuery({ queryKey: ['qa', 'snag-options', projectId], queryFn: () => qa.get(`/snags/options${projectId ? `?projectId=${projectId}` : ''}`), retry: false });
  const q = useQuery({ queryKey: ['qa', 'snag-report', locationId], queryFn: () => qa.get(`/snag-report?locationId=${locationId}`), enabled: Boolean(locationId), retry: false });
  if (oq.error?.status === 403) return <NoPermission what={t('sr.title')} permission="qa.snag.view" />;
  return (
    <section aria-labelledby="sr-h" data-testid="qa-snag-report"><PageHeader id="sr-h" title={t('sr.title')} subtitle={<><Link to="/qa/snags">{t('snag.title')}</Link> · {t('sr.intro')}</>} />
      <div className="mdm-panel no-print"><div className="form-grid">
        <Field label={t('project')} name="projectId"><select value={projectId} onChange={(e) => { setProjectId(e.target.value); setLocationId(''); }} style={sel} data-testid="sr-project"><option value="">—</option>{(oq.data?.projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></Field>
        <Field label={t('sr.unit')} name="locationId"><select value={locationId} onChange={(e) => setLocationId(e.target.value)} style={sel} data-testid="sr-location"><option value="">—</option>{(oq.data?.locations ?? []).map((l) => <option key={l.id} value={l.id}>{l.code} {l.name}</option>)}</select></Field></div>
        <button type="button" className="btn btn-primary" style={{ minHeight: 44 }} disabled={!locationId} onClick={() => qa.exportFile(`/snag-report/pdf?locationId=${locationId}`, 'unit-snag-report.pdf').catch(() => globalThis.alert?.(t('exportFailed')))} data-testid="sr-pdf">{t('sr.pdf')}</button></div>
      {q.isFetching && <Skeleton label={t('sr.title')} rows={3} />}{q.isError && <ErrorState error={q.error} onRetry={q.refetch} />}
      {q.data && (q.data.snags.length === 0 ? <EmptyState title={t('sr.emptyTitle')} message={t('sr.emptyBody')} /> : (
        <div className="table-scroll"><table className="data-table" data-testid="sr-table"><caption>{q.data.project} · {q.data.location} · {t('sr.counts', { total: q.data.total, open: q.data.open, closed: q.data.closed })}</caption><thead><tr><th>{t('snag.title')}</th><th>{t('snag.description')}</th><th>{t('snag.punch')}</th><th>{t('ncr.responsible')}</th><th>{t('snag.due')}</th><th>{t('tc.status')}</th></tr></thead>
          <tbody>{q.data.snags.map((s) => <tr key={s.id} data-testid="sr-row"><td><Link to={`/qa/snags?id=${s.id}`}>{s.docNo}</Link></td><td>{s.description}</td><td>{s.punchClass}</td><td>{s.responsible ?? t(`resp.${s.responsibleType}`)}</td><td>{s.dueDate ?? '—'}</td><td>{t(`snags.${s.status}`)}</td></tr>)}</tbody></table></div>))}
    </section>
  );
}
