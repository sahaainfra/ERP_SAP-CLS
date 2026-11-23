import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import ItemSelector from '../../platform/items/ItemSelector.jsx';
import { Field, Link, downloadCsv, usePageTitle } from '../core/pages/ui.jsx';
import { ANALYSIS_STATUS, rates } from './api.js';
import { inr } from './RateAnalysesPage.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { KpiRow } from '../../platform/design/Kpi.jsx';

// Rate Change Impact (report, part 06.06, FR-05, T-02): choose a resource (cement, a labour trade, an equipment) and its new rate (or leave it empty for the library's rate in force); every current analysis
// that uses it (released, or a draft or amendment in progress) is recomputed through the calculation engine: old and new unit rate, the difference and the percentage, largest first, with a bar for each
// and the total; each row opens its analysis. Nothing is saved. Export CSV.
export default function RateImpactPage() {
  usePageTitle('Rate Change Impact');
  const [item, setItem] = useState(null);
  const [pick, setPick] = useState(false);
  const [newRate, setNewRate] = useState('');
  const [region, setRegion] = useState('');
  const [run, setRun] = useState(null);
  const q = useQuery({ queryKey: ['mdm', 'rates', 'impact', run], queryFn: () => rates.impact(run), enabled: Boolean(run), retry: false });
  if (q.error?.status === 403) return <NoPermission what="the rate analyses" permission="mdm.analyse.view" />;
  const d = q.data;
  const rows = d ? [...d.rows].sort((a, b) => Math.abs(Number(b.percent ?? 0)) - Math.abs(Number(a.percent ?? 0))) : [];
  const max = Math.max(1, ...rows.map((r) => Math.abs(Number(r.percent ?? 0))));
  const csv = () => downloadCsv('rate-change-impact.csv', ['Analysis,Title,Status,Old item rate,New item rate,Old unit rate,New unit rate,Difference,Percent', ...rows.map((r) => [r.ref, `"${r.title.replace(/"/g, '""')}"`, r.status, r.oldItemRate, r.newItemRate, r.oldUnitRate, r.newUnitRate, r.delta, r.percent ?? ''].join(','))].join('\n'));
  return (
    <section aria-labelledby="ri-title" data-testid="rate-impact" className="fin-page">
      <PageHeader id="ri-title" title={"Rate Change Impact"} />
      {q.isLoading && <Skeleton label={'Loading the impact'} rows={4} />}
      <form className="fin-form" aria-label="What changes" onSubmit={(e) => { e.preventDefault(); if (item) setRun({ itemId: item.id, ...(newRate ? { newRate } : {}), ...(region ? { region } : {}) }); }}>
        <div className="mdm-fields">
          <Field label="Resource (required)" name="itemId"><button type="button" className="btn btn-small" onClick={() => setPick(true)} data-testid="ri-pick">{item ? `${item.code} ${item.name}` : 'Choose a resource'}</button></Field>
          <Field label="New rate (₹; empty for the library rate in force)" name="newRate"><input inputMode="decimal" value={newRate} onChange={(e) => setNewRate(e.target.value)} data-testid="ri-rate" /></Field>
          <Field label="State (empty for all)" name="region"><input value={region} maxLength={3} onChange={(e) => setRegion(e.target.value.toUpperCase())} /></Field>
        </div>
        <div className="actions-row"><button type="submit" className="btn btn-primary btn-small" disabled={!item} data-testid="ri-run">Show the impact</button>{d && rows.length > 0 && <button type="button" className="btn btn-small" onClick={csv}>Export CSV</button>}</div>
      </form>
      <ItemSelector open={pick} multiple={false} onClose={() => setPick(false)} onPick={(list) => { if (list[0]) setItem(list[0]); setPick(false); }} types={['MATERIAL', 'CONSUMABLE', 'SPARE', 'TOOL', 'RETURNABLE', 'LABOUR', 'EQUIPMENT', 'SERVICE', 'SUBCONTRACT']} title="Choose the resource" />
      {q.isError && <ErrorState error={q.error} onRetry={q.refetch} />}
      {!run && <EmptyState title="Choose a resource" message="Every analysis that uses it is recomputed at the new rate; nothing is saved." />}
      {d && (rows.length === 0 ? <EmptyState title="No analysis uses it" message={`No current analysis has ${d.item.code} ${d.item.name} among its components.`} /> : <>
        <KpiRow data-testid="ri-summary"><div className="tile"><div className="tile-label">Analyses affected</div><div className="tile-value" data-testid="ri-count">{d.count}</div></div><div className="tile"><div className="tile-label">Sum of unit rate changes (₹)</div><div className="tile-value">{inr(d.totalDelta)}</div></div><div className="tile"><div className="tile-label">Largest change</div><div className="tile-value">{d.largest ? `${d.largest.percent}%` : '—'}</div></div></KpiRow>
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Affected analyses"><table className="grid"><thead><tr><th>Analysis</th><th>Status</th><th className="num">Item rate</th><th className="num">Unit rate now (₹)</th><th className="num">At the new rate (₹)</th><th className="num">Difference (₹)</th><th>Change</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id} data-testid="ri-row"><th scope="row" data-label="Analysis"><Link to={`/admin/rate-analyses/analysis?id=${r.id}`}>{r.ref}</Link><div className="small">{r.title}</div></th><td data-label="Status"><StatusBadge status={ANALYSIS_STATUS[r.status][0]} label={ANALYSIS_STATUS[r.status][1]} /></td><td className="num" data-label="Item rate">{inr(r.oldItemRate)} → {inr(r.newItemRate)}</td><td className="num" data-label="Unit rate now (₹)">{inr(r.oldUnitRate)}</td><td className="num" data-label="At the new rate (₹)">{inr(r.newUnitRate)}</td><td className="num" data-label="Difference (₹)">{inr(r.delta)}</td>
            <td data-label="Change"><span className="ri-bar" aria-hidden="true"><span style={{ width: `${(Math.abs(Number(r.percent ?? 0)) / max) * 100}%` }} className={Number(r.delta) < 0 ? 'is-down' : ''} /></span> {r.percent ?? '—'}%</td></tr>)}</tbody>
            <tfoot><tr><th scope="row" colSpan={5}>Total</th><td className="num">{inr(d.totalDelta)}</td><td /></tr></tfoot></table></div>
      </>)}
    </section>
  );
}
