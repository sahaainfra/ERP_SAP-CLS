import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDate } from '../../platform/format.js';
import { Link, Pager, downloadCsv, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { ANALYSIS_STATUS, SCOPE_LABEL, rates } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Rate Analyses (Administration, part 06.06): the register of analysed unit rates, one row per version, with search and filters (status, scope, latest version only), New (from a template such as M25
// concrete or brickwork, from a work item's bill of resources, or blank) and the CSV export. Each row opens the analysis with its components, add-ons, SOR comparison and versions.
const PAGE = 50;
export const inr = (v) => (v == null ? '—' : Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export default function RateAnalysesPage() {
  usePageTitle('Rate Analyses');
  const [f, setF] = useState({ q: '', status: '', scope: '', current: 'true' });
  const [page, setPage] = useState(1);
  const [tpl, setTpl] = useState('');
  const [error, setError] = useState(null);
  const q = useQuery({ queryKey: ['mdm', 'rates', 'analyses', f, page], queryFn: () => rates.analyses({ ...f, limit: PAGE, offset: (page - 1) * PAGE }), retry: false });
  if (q.error?.status === 403) return <NoPermission what="the rate analyses" permission="mdm.analyse.view" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (q.isPending) return <Skeleton label="Loading the rate analyses" rows={6} />;
  const d = q.data;
  const set = (p) => { setF({ ...f, ...p }); setPage(1); };
  const exportCsv = async () => { setError(null); try { downloadCsv('rate-analyses.csv', await rates.fetchText(`/mdm/analyses/export?${new URLSearchParams(Object.entries(f).filter(([, v]) => v))}`)); } catch (err) { setError(errorInfo(err)); } };
  return (
    <section aria-labelledby="ra-title" data-testid="rate-analyses" className="fin-page">
      <PageHeader id="ra-title" title={"Rate Analyses"} actions={<><div className="actions-row">
          {d.canCreate && <><label className="sr-only" htmlFor="ra-tpl">Start from</label><select id="ra-tpl" value={tpl} onChange={(e) => setTpl(e.target.value)} data-testid="ra-template"><option value="">Blank or from a work item</option>{d.templates.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}</select>
            <button type="button" className="btn btn-primary btn-small" onClick={() => navigateTo(`/admin/rate-analyses/analysis?new=1${tpl ? `&template=${tpl}` : ''}`)} data-testid="ra-new">New analysis</button></>}
          {d.canExport && <button type="button" className="btn btn-small" onClick={exportCsv} data-testid="ra-export">Export CSV</button>}
          <Link to="/admin/rate-analyses/impact">Rate change impact</Link>
        </div></>} />
      {error?.form && <p className="field-error" role="alert">{error.form}</p>}
      <div className="filters" role="search">
        <label>Search <input type="search" value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder="Number, title or work item" data-testid="ra-q" /></label>
        <label>Status <select value={f.status} onChange={(e) => set({ status: e.target.value })} data-testid="ra-status"><option value="">All</option>{Object.entries(ANALYSIS_STATUS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label>Scope <select value={f.scope} onChange={(e) => set({ scope: e.target.value })}><option value="">All</option>{Object.entries(SCOPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label>Versions <select value={f.current} onChange={(e) => set({ current: e.target.value })}><option value="true">Latest only</option><option value="">Every version</option></select></label>
      </div>
      {d.rows.length === 0 ? <EmptyState title="No rate analysis yet" message={d.canCreate ? 'Start one from a template (M25 concrete, brickwork, plaster, reinforcement, earthwork) or from a work item.' : 'The estimator prepares rate analyses.'} /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Rate analyses"><table className="grid"><thead><tr><th>Analysis</th><th>Work item</th><th>Scope</th><th>State</th><th className="num">Unit rate (₹)</th><th>Per</th><th>From</th><th>Status</th></tr></thead>
          <tbody>{d.rows.map((a) => <tr key={a.id} data-testid="ra-row"><th scope="row" data-label="Analysis"><Link to={`/admin/rate-analyses/analysis?id=${a.id}`}>{a.ref}</Link><div className="small">{a.title}</div></th><td data-label="Work item">{a.workItem?.code}</td><td data-label="Scope">{a.scopeLabel}{a.project ? <div className="muted small">{a.project.code}</div> : null}</td><td data-label="State">{a.region ?? 'All'}</td><td className="num" data-label="Unit rate (₹)">{inr(a.unitRate)}</td><td data-label="Per">{a.basisUom}</td><td data-label="From">{formatDate(a.effectiveFrom)}{a.effectiveTo ? <div className="muted small">to {formatDate(a.effectiveTo)}</div> : null}</td><td data-label="Status"><StatusBadge status={ANALYSIS_STATUS[a.status][0]} label={ANALYSIS_STATUS[a.status][1]} /></td></tr>)}</tbody></table></div>)}
      <Pager meta={{ page, pageSize: PAGE, total: d.total, totalPages: Math.max(1, Math.ceil(d.total / PAGE)) }} page={page} setPage={setPage} noun="analyses" />
    </section>
  );
}
