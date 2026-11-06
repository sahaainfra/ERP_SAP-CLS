import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import Chart from '../../platform/charts/Chart.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, usePageTitle } from '../core/pages/ui.jsx';
import { mto, qty } from './api.js';
import { useSearch } from './parts.jsx';

// BBS Summary by Diameter (part 09.02, FR-02): the reinforcement steel of the released bar bending schedules of a project (or of one schedule) by diameter: bar marks, bars, total length, weight in kg and tonnes, for the
// procurement of steel; each schedule links back.
export default function BbsSummaryPage() {
  const t = useT('est');
  usePageTitle(t('bbs.summary'));
  const sp = useSearch(); const bbsId = Number(sp.get('bbsId')) || null;
  const [projectId, setProjectId] = useState(Number(sp.get('projectId')) || null);
  const q = useQuery({ queryKey: ['est', 'bbs-summary', projectId, bbsId], queryFn: () => mto.summary({ projectId, bbsId }), retry: false });
  const r = q.data;
  const chart = r && r.rows.length > 0 && { categories: r.rows.map((x) => `${x.dia} mm`), series: [{ name: t('bbs.weightKg'), values: r.rows.map((x) => Number(x.weightKg)) }] };
  return (
    <section aria-labelledby="bsum-h" data-testid="bbs-summary">
      <h1 id="bsum-h">{t('bbs.summary')}</h1>
      {!bbsId && <form className="filters" onSubmit={(e) => e.preventDefault()} aria-label={t('cmp.params')}><LookupField id="bsum-project" label={t('new.project')} lookup="iam/projects" value={projectId} onChange={setProjectId} compact /></form>}
      <p className="small muted">{bbsId ? t('bbs.oneSchedule') : t('bbs.releasedOnly')}</p>
      {q.isPending ? <Skeleton label={t('bbs.summary')} rows={4} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : r.rows.length === 0 ? <p className="muted">{t('bbs.noSummary')}</p> : (<>
        <dl className="op-figures"><div><dt>{t('bbs.weight')}</dt><dd data-testid="bsum-total">{qty(r.totalKg)} kg · {r.totalMt} MT</dd></div><div><dt>{t('bbs.schedules')}</dt><dd>{r.schedules.length}</dd></div></dl>
        {chart && <Chart type="bar" data={chart} title={t('bbs.chart')} exportName="bbs-by-diameter" />}
        <div className="table-wrap"><table className="data-table" data-testid="bsum-table"><thead><tr><th scope="col">{t('bbs.dia')}</th><th scope="col">{t('bbs.marks')}</th><th scope="col">{t('bbs.nos')}</th><th scope="col">{t('bbs.total')}</th><th scope="col">{t('bbs.weightKg')}</th><th scope="col">MT</th></tr></thead>
          <tbody>{r.rows.map((d) => <tr key={d.dia} data-testid={`bsum-${d.dia}`}><th scope="row" data-label={t('bbs.dia')}>{d.dia} mm</th><td data-label={t('bbs.marks')}>{d.marks}</td><td data-label={t('bbs.nos')}>{d.bars}</td><td data-label={t('bbs.total')}>{qty(d.totalLength)}</td><td data-label={t('bbs.weightKg')}>{qty(d.weightKg)}</td><td data-label="MT">{d.weightMt}</td></tr>)}</tbody>
          <tfoot><tr><th scope="row">{t('bbs.totalRow')}</th><td colSpan={3} /><td>{qty(r.totalKg)}</td><td>{r.totalMt}</td></tr></tfoot></table></div>
        <ul className="mdm-list">{r.schedules.map((x) => <li key={x.id}><Link to={`/est/bbs/sheet?id=${x.id}`}>{x.ref}</Link> · {x.member} · {qty(x.weightKg)} kg</li>)}</ul>
      </>)}
    </section>
  );
}
