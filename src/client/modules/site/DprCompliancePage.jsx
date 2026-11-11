import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../platform/api/index.js';
import { useT } from '../../platform/i18n/index.js';
import Chart from '../../platform/charts/Chart.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, Tile, usePageTitle } from '../core/pages/ui.jsx';
import { fmtDate, st, today } from './api.js';

// DPR Compliance (part 14.02, section 7.4): the share of the site days for which the report was sent by the cut-off, the late ones and the missing ones by site; every tile and row opens the reports behind it.
const ago = (n) => new Date(Date.parse(`${today()}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
export default function DprCompliancePage() {
  const t = useT('site'); usePageTitle(t('dpr.complianceTitle'));
  const [p, setP] = useState({ from: ago(13), to: today(), siteId: '' });
  const sitesQ = useQuery({ queryKey: ['site', 'dpr-sites'], queryFn: st.dprSites, retry: false });
  const qs = useMemo(() => new URLSearchParams(Object.entries(p).filter(([, v]) => v)).toString(), [p]);
  const q = useQuery({ queryKey: ['site', 'dpr-compliance', qs], queryFn: () => st.dprCompliance(qs), retry: false });
  const wq = useQuery({ queryKey: ['site', 'dpr-waiting'], queryFn: async () => (await api.get('/site/dprs?filter[status]=SUBMITTED&pageSize=10')).data, retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('dpr.complianceTitle')} permission="site.dpr.report" />;
  const c = q.data; const tot = c?.totals;
  return (
    <section aria-labelledby="dc-h" data-testid="site-dpr-compliance">
      <h1 id="dc-h">{t('dpr.complianceTitle')}</h1>
      <form className="mdm-panel no-print" onSubmit={(e) => e.preventDefault()} aria-label={t('dpr.params')}>
        <div className="form-grid">
          <Field label={t('h.from')} name="from"><input type="date" value={p.from} max={p.to} onChange={(e) => e.target.value && setP({ ...p, from: e.target.value })} data-testid="dc-from" /></Field>
          <Field label={t('h.to')} name="to"><input type="date" value={p.to} max={today()} onChange={(e) => e.target.value && setP({ ...p, to: e.target.value })} data-testid="dc-to" /></Field>
          <Field label={t('f.site')} name="siteId"><select value={p.siteId} onChange={(e) => setP({ ...p, siteId: e.target.value })} data-testid="dc-site"><option value="">{t('dpr.allSites')}</option>{(sitesQ.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.projectCode} · {s.code} {s.name}</option>)}</select></Field>
        </div>
      </form>
      {q.isPending && <Skeleton label={t('dpr.complianceTitle')} rows={4} />}
      {q.isError && q.error?.status !== 403 && <ErrorState error={q.error} onRetry={q.refetch} />}
      {c && (
        <>
          <p className="muted">{t('dpr.cutoffIs', { c: c.cutoff })}</p>
          <div className="tiles" data-testid="dc-tiles">
            <Tile label={t('dpr.tOnTime')} value={tot.onTimePct == null ? '—' : `${tot.onTimePct} %`} status={tot.onTimePct == null ? 'neutral' : tot.onTimePct >= 90 ? 'success' : tot.onTimePct >= 70 ? 'warning' : 'danger'} to="/site/dprs" testId="dc-ontime" hint={t('dpr.ofSiteDays', { n: tot.expected })} />
            <Tile label={t('dpr.tSubmitted')} value={tot.submittedPct == null ? '—' : `${tot.submittedPct} %`} testId="dc-submitted" />
            <Tile label={t('dpr.tLate')} value={tot.late} status={tot.late ? 'warning' : 'success'} testId="dc-late" />
            <Tile label={t('dpr.tMissing')} value={tot.missing} status={tot.missing ? 'danger' : 'success'} to="/site/dprs" testId="dc-missing" />
            <Tile label={t('dpr.tSameDay')} value={tot.approvedSameDayPct == null ? '—' : `${tot.approvedSameDayPct} %`} testId="dc-sameday" />
          </div>
          {tot.expected === 0 ? <p className="muted" data-testid="dc-empty">{t('dpr.complianceEmpty')}</p> : (
            <>
              <Chart type="stacked" data={{ categories: c.byDay.map((d) => d.date.slice(5)), series: [{ name: t('dpr.tOnTime'), values: c.byDay.map((d) => d.onTime) }, { name: t('dpr.tLate'), values: c.byDay.map((d) => d.late) }, { name: t('dpr.tMissing'), values: c.byDay.map((d) => d.missing) }] }} title={t('dpr.chartDays')} exportName="dpr-compliance" />
              <div className="mdm-panel" data-testid="dc-sites"><h2>{t('dpr.bySite')}</h2><div className="table-scroll"><table className="data-table"><caption className="sr-only">{t('dpr.bySite')}</caption><thead><tr><th>{t('f.site')}</th><th className="num">{t('dpr.tExpected')}</th><th className="num">{t('dpr.tOnTime')}</th><th className="num">{t('dpr.tLate')}</th><th className="num">{t('dpr.tMissing')}</th><th>{t('dpr.missingDays')}</th></tr></thead>
                <tbody>{c.bySite.map((s) => <tr key={s.siteId} data-testid="dc-site-row" data-missing={s.missing}><td>{s.project} · {s.site} {s.siteName}</td><td className="num">{s.expected}</td><td className="num">{s.onTime}</td><td className="num">{s.late}</td><td className="num">{s.missing}</td><td>{s.missingDates.slice(0, 6).map((d) => <span key={d}><Link to={`/site/dpr-entry?siteId=${s.siteId}&date=${d}`}>{fmtDate(d)}</Link>{' '}</span>)}{s.missingDates.length > 6 ? `+${s.missingDates.length - 6}` : ''}</td></tr>)}</tbody></table></div></div>
            </>
          )}
          <div className="mdm-panel" data-testid="dc-waiting"><h2>{t('dpr.waiting2')}</h2>{(wq.data ?? []).length === 0 ? <p className="muted">{t('dpr.noneWaiting')}</p> : <ul>{wq.data.map((d) => <li key={d.id}><Link to={`/site/dprs?id=${d.id}`}>{d.docNo}</Link> · {d.site} · {fmtDate(d.dprDate)}{d.late === 'Late' ? ` · ${t('dpr.lateShort')}` : ''}</li>)}</ul>}</div>
        </>
      )}
    </section>
  );
}
