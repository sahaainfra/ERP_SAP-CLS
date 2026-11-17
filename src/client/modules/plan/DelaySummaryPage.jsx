import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, usePageTitle } from '../core/pages/ui.jsx';
import { CAUSES, RESPONSIBILITIES, download, fmtDate, pl } from './api.js';
import { useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Delay Summary (part 13.05, FR-05): the delays by cause and responsibility, in delay days and in impact on completion (the shift found by each delay's time-impact analysis), with the excusable and
// compensable totals the claims (21.06) start from. A cell opens the delays behind it. Every figure comes from the server.
export default function DelaySummaryPage() {
  const t = useT('plan');
  usePageTitle(t('ds.title'));
  const sp = useSearch();
  const [p, setP] = useState({ projectId: sp.get('projectId') ?? '', status: 'APPROVED', from: '', to: '' }); const [drill, setDrill] = useState(null); const [failed, setFailed] = useState(false);
  const pq = useQuery({ queryKey: ['plan', 'projects'], queryFn: pl.projects, retry: false });
  const qs = new URLSearchParams(Object.entries(p).filter(([, v]) => v)).toString(); const dqs = drill ? `${qs}&${new URLSearchParams(drill)}` : null;
  const q = useQuery({ queryKey: ['plan', 'delay-summary', qs], queryFn: () => pl.delaySummary(qs), retry: false });
  const dq = useQuery({ queryKey: ['plan', 'delay-summary', dqs], queryFn: () => pl.delaySummary(dqs), enabled: Boolean(dqs), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('ds.title')} permission="plan.delay.view" />;
  const s = q.data; const cell = (c, r) => s?.cells.find((x) => x.cause === c && x.responsibility === r);
  const max = Math.max(1, ...(s?.byResponsibility ?? []).map((x) => x.impactDays));
  return (
    <section aria-labelledby="ds-h" data-testid="plan-delay-summary">
      <PageHeader id="ds-h" title={t('ds.title')} />
      <form className="mdm-panel no-print" onSubmit={(e) => e.preventDefault()} aria-label={t('pr.params')}>
        <div className="form-grid">
          <Field label={t('f.project')} name="projectId"><select value={p.projectId} onChange={(e) => { setP({ ...p, projectId: e.target.value }); setDrill(null); }} data-testid="ds-project"><option value="">{t('ds.allProjects')}</option>{(pq.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}</select></Field>
          <Field label={t('f.status')} name="status"><select value={p.status} onChange={(e) => { setP({ ...p, status: e.target.value }); setDrill(null); }} data-testid="ds-status">{['APPROVED', 'SUBMITTED', 'DRAFT', 'all'].map((k) => <option key={k} value={k}>{t(`ds.st.${k}`)}</option>)}</select></Field>
          <Field label={t('h.from')} name="from"><input type="date" value={p.from} onChange={(e) => setP({ ...p, from: e.target.value })} data-testid="ds-from" /></Field>
          <Field label={t('h.to')} name="to"><input type="date" value={p.to} onChange={(e) => setP({ ...p, to: e.target.value })} data-testid="ds-to" /></Field>
        </div>
        {s?.can.export && <div className="actions">{['xlsx', 'pdf', 'csv'].map((f) => <button key={f} type="button" className="btn" onClick={() => { setFailed(false); download(`/delays/summary/export?${qs}&format=${f}`, `delay-summary.${f}`).catch(() => setFailed(true)); }} data-testid={`ds-export-${f}`}>{t('var.export', { f: f.toUpperCase() })}</button>)}</div>}
        {failed && <p className="field-error" role="alert">{t('bl.fileFailed')}</p>}
      </form>
      {q.isPending && <Skeleton label={t('ds.title')} rows={5} />}
      {q.isError && q.error?.status !== 403 && <ErrorState error={q.error} onRetry={q.refetch} />}
      {s && (
        <>
          <dl className="kv" data-testid="ds-totals">
            <div><dt>{t('ds.delays')}</dt><dd data-testid="ds-count">{s.totals.count}</dd></div><div><dt>{t('dl.delayDays')}</dt><dd>{s.totals.delayDays}</dd></div><div><dt>{t('dl.impact')}</dt><dd>{s.totals.impactDays}</dd></div>
            <div><dt>{t('ds.excusable')}</dt><dd data-testid="ds-excusable">{s.totals.excusable}</dd></div><div><dt>{t('ds.compensable')}</dt><dd data-testid="ds-compensable">{s.totals.compensable}</dd></div><div><dt>{t('ds.nonExcusable')}</dt><dd data-testid="ds-non">{s.totals.nonExcusable}</dd></div>
          </dl>
          {s.totals.count === 0 ? <p className="muted" data-testid="ds-empty">{t('ds.empty')} <Link to="/plan/delays">{t('dl.title')}</Link></p> : (
            <>
              <h2>{t('ds.byResp')}</h2>
              <svg width={520} height={RESPONSIBILITIES.length * 28} role="img" aria-label={t('ds.chart')} style={{ maxWidth: '100%' }} data-testid="ds-chart">
                {s.byResponsibility.map((r, i) => <g key={r.code}><title>{`${t(`dr.${r.code}`)}: ${r.impactDays}`}</title><text x={110} y={i * 28 + 18} fontSize="12" textAnchor="end" fill="var(--erp-color-text-secondary)">{t(`dr.${r.code}`)}</text><rect x={118} y={i * 28 + 6} width={Math.max(r.impactDays ? 3 : 0, (340 * r.impactDays) / max)} height={14} rx="3" fill="var(--erp-chart-1)" /><text x={124 + (340 * r.impactDays) / max} y={i * 28 + 18} fontSize="12" fill="var(--erp-color-text-primary)">{r.impactDays} · {r.count}</text></g>)}
              </svg>
              <div className="table-scroll"><table className="data-table" data-testid="ds-matrix"><caption>{t('ds.matrix')}</caption>
                <thead><tr><th>{t('dl.cause')}</th>{RESPONSIBILITIES.map((r) => <th key={r} className="num">{t(`dr.${r}`)}</th>)}<th className="num">{t('f.total')}</th></tr></thead>
                <tbody>{CAUSES.filter((c) => s.byCause.some((x) => x.code === c)).map((c) => <tr key={c} data-testid="ds-row"><th scope="row">{t(`dc.${c}`)}</th>{RESPONSIBILITIES.map((r) => { const x = cell(c, r); return <td key={r} className="num">{x ? <button type="button" className="link" onClick={() => setDrill({ cause: c, responsibility: r })} data-testid="ds-cell" aria-label={t('ds.open', { c: t(`dc.${c}`), r: t(`dr.${r}`) })}>{x.impactDays} / {x.delayDays} ({x.count})</button> : ''}</td>; })}<td className="num">{(() => { const x = s.byCause.find((y) => y.code === c); return `${x.impactDays} / ${x.delayDays} (${x.count})`; })()}</td></tr>)}</tbody>
                <tfoot><tr><th>{t('f.total')}</th>{s.byResponsibility.map((r) => <td key={r.code} className="num"><button type="button" className="link" onClick={() => setDrill({ responsibility: r.code })}>{r.impactDays} / {r.delayDays} ({r.count})</button></td>)}<td className="num">{s.totals.impactDays} / {s.totals.delayDays} ({s.totals.count})</td></tr></tfoot>
              </table></div>
              <p className="muted">{t('ds.legend')}</p>
            </>
          )}
          {drill && (
            <div className="mdm-panel" data-testid="ds-drill">
              <h2>{[drill.cause && t(`dc.${drill.cause}`), drill.responsibility && t(`dr.${drill.responsibility}`)].filter(Boolean).join(' · ')}</h2>
              {dq.isPending ? <Skeleton label={t('ds.title')} rows={2} /> : (
                <div className="table-scroll"><table className="data-table"><caption className="sr-only">{t('dl.title')}</caption><thead><tr><th>{t('dl.docNo')}</th><th>{t('dl.event')}</th><th>{t('f.project')}</th><th>{t('h.from')}</th><th>{t('h.to')}</th><th className="num">{t('dl.delayDays')}</th><th className="num">{t('dl.impact')}</th></tr></thead>
                  <tbody>{(dq.data?.drill ?? []).map((x) => <tr key={x.id} data-testid="ds-drill-row"><td><Link to={`/plan/delays?id=${x.id}`}>{x.docNo}</Link></td><td>{x.title}</td><td>{x.project}</td><td>{fmtDate(x.startDate)}</td><td>{fmtDate(x.endDate)}</td><td className="num">{x.delayDays}</td><td className="num">{x.impactDays ?? '—'}</td></tr>)}</tbody></table></div>
              )}
              <button type="button" className="btn" onClick={() => setDrill(null)}>{t('con.close')}</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
