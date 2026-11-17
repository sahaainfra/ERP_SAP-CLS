import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, Tile, usePageTitle } from '../core/pages/ui.jsx';
import { an, fmtDate, fmtRs, saveCsv } from './api.js';
import { ParamPanel } from './AnaParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { KpiRow } from '../../platform/design/Kpi.jsx';

// Procurement compliance (part 15.10, FR-01): orders without competition (direct or a single quote), emergency requisitions, awards that were not the lowest quote (non-L1) and the open control exceptions of the procurement controls.
const rs = (paise) => (paise == null ? '' : fmtRs(paise / 100));
function Section({ t, id, title, data, cols }) {
  return (
    <div className="mdm-panel" data-testid={`co-${id}`}><h2>{title} <span className="muted">({data.count}/{data.total} · {data.pct ?? 0}%)</span></h2>
      {data.rows.length === 0 ? <p className="muted">{t('n.noneInPeriod')}</p> : <div className="table-scroll"><table className="data-table"><thead><tr><th>{t('n.record')}</th><th>{t('n.detail')}</th>{cols.map((c) => <th key={c[0]}>{c[1]}</th>)}<th className="num">{t('n.value')}</th></tr></thead>
        <tbody>{data.rows.map((r) => <tr key={r.id} data-testid={`co-${id}-row`}><td><Link to={r.link}>{r.docNo}</Link></td><td>{r.label}</td>{cols.map((c) => <td key={c[0]}>{c[2](r)}</td>)}<td className="num">{rs(r.value)}</td></tr>)}</tbody></table></div>}</div>
  );
}
export default function ProcurementCompliancePage() {
  const t = useT('proc'); usePageTitle(t('n.complianceTitle')); const [f, setF] = useState({ projectId: '', from: '', to: '' });
  const q = useQuery({ queryKey: ['proc', 'an-compliance', f], queryFn: () => an.compliance(f), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('n.complianceTitle')} permission="proc.analytics.view" />;
  if (q.isPending) return <Skeleton label={t('n.complianceTitle')} rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data; const none = d.singleSource.total + d.emergency.total + d.nonL1.total === 0;
  return (
    <section aria-labelledby="co-h" data-testid="proc-co"><PageHeader id="co-h" title={t('n.complianceTitle')} subtitle={<>{t('n.complianceIntro')} {fmtDate(d.period.from)} – {fmtDate(d.period.to)}</>} />
      <ParamPanel t={t} value={f} onChange={setF} />
      {none ? <div data-testid="co-empty"><h2>{t('n.emptyTitle')}</h2><p className="muted">{t('n.emptyBody')}</p></div> : <>
        <KpiRow data-testid="co-tiles"><Tile label={t('n.singleSource')} value={`${d.singleSource.pct ?? 0}%`} hint={`${d.singleSource.count}/${d.singleSource.total}`} testId="co-single" /><Tile label={t('n.emergency')} value={`${d.emergency.pct ?? 0}%`} hint={`${d.emergency.count}/${d.emergency.total}`} testId="co-emergency" /><Tile label={t('n.nonL1')} value={`${d.nonL1.pct ?? 0}%`} hint={`${d.nonL1.count}/${d.nonL1.total}`} testId="co-nonl1" /><Tile label={t('n.exceptions')} value={d.exceptions.visible ? d.exceptions.open : '—'} testId="co-exceptions-count" /></KpiRow>
        <Section t={t} id="single" title={t('n.singleSource')} data={d.singleSource} cols={[['kind', t('n.kind'), (r) => t(`n.k.${r.kind}`)], ['reason', t('n.reason'), (r) => r.reason ?? '']]} />
        <Section t={t} id="emergency" title={t('n.emergency')} data={d.emergency} cols={[['reason', t('n.reason'), (r) => r.reason ?? ''], ['reg', t('n.regularised'), (r) => (r.regularised ? t('x.yes') : t('x.no'))]]} />
        <Section t={t} id="nonl1" title={t('n.nonL1')} data={d.nonL1} cols={[['reason', t('n.reason'), (r) => r.reason ?? '']]} /></>}
      <div className="mdm-panel" data-testid="co-exceptions"><h2>{t('n.exceptions')}</h2>{!d.exceptions.visible ? <p className="muted">{t('n.companyOnly')}</p> : d.exceptions.rows.length === 0 ? <p className="muted">{t('n.noExceptions')}</p>
        : <div className="table-scroll"><table className="data-table"><thead><tr><th>{t('n.record')}</th><th>{t('n.control')}</th><th>{t('n.detail')}</th><th>{t('x.status')}</th><th className="num">{t('n.valueAtRisk')}</th></tr></thead><tbody>{d.exceptions.rows.map((r) => <tr key={r.id}><td>{r.exceptionNo}</td><td>{r.control}</td><td>{r.ref ?? ''} {r.reason}</td><td>{r.status}</td><td className="num">{rs(r.valueAtRisk)}</td></tr>)}</tbody></table></div>}</div>
      <div className="actions-row no-print"><button type="button" className="btn" onClick={() => saveCsv('procurement-compliance.csv', [[t('n.section'), t('n.record'), t('n.detail'), t('n.value')], ...d.singleSource.rows.map((r) => [t('n.singleSource'), r.docNo, r.label, (r.value ?? 0) / 100]), ...d.emergency.rows.map((r) => [t('n.emergency'), r.docNo, r.label, (r.value ?? 0) / 100]), ...d.nonL1.rows.map((r) => [t('n.nonL1'), r.docNo, r.label, (r.value ?? 0) / 100])])} data-testid="co-export">{t('n.exportCsv')}</button></div>
    </section>
  );
}
