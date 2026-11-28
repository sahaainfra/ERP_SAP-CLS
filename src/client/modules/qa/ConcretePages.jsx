import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, usePageTitle } from '../core/pages/ui.jsx';
import { fmtDate, qa } from './api.js';
import { sel } from './QaParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Concrete Strength Acceptance and Concrete Traceability (part 18.05): the groups of four 28-day results by grade against the IS 456 mean and individual limits; and the chain from a batch, truck, sample or pour to the cubes and their results.
export function AcceptancePage() {
  const t = useT('qa'); usePageTitle(t('ca.title')); const [projectId, setProjectId] = useState(''); const oq = useQuery({ queryKey: ['qa', 'projects'], queryFn: () => qa.get('/projects').then((p) => ({ projects: p })), retry: false });
  const q = useQuery({ queryKey: ['qa', 'acceptance', projectId], queryFn: () => qa.get(`/concrete-acceptance${projectId ? `?projectId=${projectId}` : ''}`), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('ca.title')} permission="qa.pour_card.view" />; if (q.isPending) return <Skeleton label={t('ca.title')} rows={4} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const a = q.data;
  return (
    <section aria-labelledby="ca-h" data-testid="qa-acceptance"><PageHeader id="ca-h" title={t('ca.title')} subtitle={<>{t('ca.rule', { m: a.margin, d: a.drop })} · {t('ca.failedGroups', { n: a.failedGroups })}</>} />
      <div className="mdm-panel no-print"><label>{t('project')}<select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={sel} data-testid="ca-project"><option value="">{t('allProjects')}</option>{(oq.data?.projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></label><button type="button" className="btn" style={{ minHeight: 'var(--erp-target-min)' }} onClick={() => qa.exportFile('/concrete-acceptance/export', 'concrete-acceptance.csv').catch(() => globalThis.alert?.(t('exportFailed')))} data-testid="ca-export">{t('export')}</button></div>
      {a.rows.length === 0 ? <EmptyState title={t('ca.emptyTitle')} message={t('ca.emptyBody')} /> : a.rows.map((g) => (
        <div className="table-scroll" key={`${g.projectId}-${g.grade}`}><table className="data-table" data-testid="ca-table"><caption>{g.project} · {g.grade}</caption><thead><tr><th>{t('ca.group')}</th><th>{t('ca.samples')}</th><th className="num">{t('cube.mean')}</th><th className="num">{t('ca.required')}</th><th className="num">{t('ca.lowest')}</th><th>{t('ins.verdict')}</th></tr></thead>
          <tbody>{g.groups.map((x) => <tr key={x.groupNo} data-testid="ca-group" data-accepted={String(x.accepted)}><td>{x.groupNo}</td><td>{x.samples.map((s) => <Link key={s.sampleId} to={`/qa/cubes?id=${s.sampleId}`}>{s.sampleNo} </Link>)}</td><td className="num">{x.mean}</td><td className="num">{x.required}</td><td className="num">{x.lowest ?? '—'}</td><td>{x.complete ? <StatusBadge status={x.accepted ? 'APPROVED' : 'REJECTED'} label={x.accepted ? t('ca.accepted') : !x.meanOk ? t('ca.meanShort') : t('ca.individualLow')} /> : <StatusBadge status="DRAFT" label={t('ca.needMore', { n: x.needMore })} />}</td></tr>)}</tbody></table></div>))}
    </section>
  );
}
export function TraceabilityPage() {
  const t = useT('qa'); usePageTitle(t('ct.title')); const [text, setText] = useState(''); const [key, setKey] = useState('');
  const q = useQuery({ queryKey: ['qa', 'trace', key], queryFn: () => qa.get(`/concrete-traceability?q=${encodeURIComponent(key)}`), enabled: Boolean(key), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('ct.title')} permission="qa.pour_card.view" />;
  return (
    <section aria-labelledby="ct-h" data-testid="qa-trace"><PageHeader id="ct-h" title={t('ct.title')} subtitle={t('ct.intro')} />
      <form className="mdm-panel no-print" onSubmit={(e) => { e.preventDefault(); setKey(text.trim()); }}><Field label={t('ct.search')} name="q"><input value={text} onChange={(e) => setText(e.target.value)} maxLength={80} style={sel} data-testid="ct-q" /></Field><button type="submit" className="btn btn-primary" style={{ minHeight: 'var(--erp-target-min)' }} data-testid="ct-go">{t('ct.go')}</button></form>
      {q.isFetching && <Skeleton label={t('ct.title')} rows={3} />}{q.isError && q.error?.status !== 403 && <ErrorState error={q.error} onRetry={q.refetch} />}
      {q.data && q.data.pours.length === 0 && <EmptyState title={t('ct.emptyTitle')} message={t('ct.emptyBody')} />}
      {q.data?.pours.map((p) => (
        <div className="mdm-panel" key={p.pourCardId} data-testid="ct-pour"><h2><Link to={`/qa/pour-cards?id=${p.pourCardId}`}>{p.docNo}</Link> · {p.element} · {p.grade}</h2><p className="muted">{p.project} · {t(`pour.${p.pourStatus}`)} · {p.actualVolume} m³{p.pourStart ? ` · ${fmtDate(p.pourStart.slice(0, 10))}` : ''}</p>
          <div className="table-scroll"><table className="data-table" data-testid="ct-tickets"><thead><tr><th>{t('pc.ticketNo')}</th><th>{t('pc.batch')}</th><th>{t('pc.truck')}</th><th className="num">{t('pc.qty')}</th><th>{t('pc.samples')}</th></tr></thead><tbody>{p.tickets.map((k) => <tr key={k.id} data-testid="ct-ticket"><td>{k.ticketNo}</td><td>{k.batchRef ?? '—'}</td><td>{k.truckNo ?? '—'}</td><td className="num">{k.qty}</td><td>{k.samples.join(', ') || '—'}</td></tr>)}</tbody></table></div>
          <div className="table-scroll"><table className="data-table" data-testid="ct-samples"><thead><tr><th>{t('cube.sample')}</th><th>{t('pc.castDate')}</th><th>{t('cube.results')}</th></tr></thead><tbody>{p.samples.map((s) => <tr key={s.id} data-testid="ct-sample"><td><Link to={`/qa/cubes?id=${s.id}`}>{s.sampleNo}</Link></td><td>{fmtDate(s.castDate)}</td><td>{s.results.map((r) => `${r.ageDays}d: ${r.mean} (${t(`acc.${r.acceptance}`)})`).join(' · ') || '—'}</td></tr>)}</tbody></table></div></div>))}
    </section>
  );
}
