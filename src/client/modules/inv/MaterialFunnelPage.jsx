import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, usePageTitle } from '../core/pages/ui.jsx';
import { Bars } from '../proc/AnaParts.jsx';
import { fmtDate, fmtQty, mm } from './api.js';
import { ExportButton, FilterPanel, RecordTable } from './MmdParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Material lifecycle funnel (part 16.11, FR-02): for each material the quantity required (MRP, or the approved material requests where there is no MRP run), requisitioned, ordered, delivered, accepted, issued and consumed in the period,
// with the share that reaches each stage; every figure opens the documents behind it.
export default function MaterialFunnelPage() {
  const t = useT('inv'); usePageTitle(t('md.funnelTitle')); const [f, setF] = useState({ projectId: '', from: '', to: '', categoryId: '', q: '' }); const [pick, setPick] = useState(null);
  const cq = useQuery({ queryKey: ['inv', 'mm-cats'], queryFn: mm.categories, retry: false });
  const q = useQuery({ queryKey: ['inv', 'mm-funnel', f], queryFn: () => mm.funnel(f), retry: false });
  const sq = useQuery({ queryKey: ['inv', 'mm-stage', f, pick], queryFn: () => mm.stage({ projectId: f.projectId, from: f.from, to: f.to, itemId: pick.itemId, stage: pick.stage }), enabled: Boolean(pick), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('md.funnelTitle')} permission="inv.dashboard.view" />;
  if (q.isPending) return <Skeleton label={t('md.funnelTitle')} rows={5} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data; const one = d.rows.length === 1 ? d.rows[0] : (pick ? d.rows.find((r) => r.itemId === pick.itemId) : null);
  return (
    <section aria-labelledby="mf-h" data-testid="inv-mf"><PageHeader id="mf-h" title={<>{t('md.funnelTitle')}{d.project ? ` · ${d.project.code}` : ''}</>} subtitle={<>{t('md.funnelIntro')} {fmtDate(d.period.from)} – {fmtDate(d.period.to)}</>} />
      <FilterPanel value={f} onChange={(v) => { setF(v); setPick(null); }} testId="mf-filters">
        <label>{t('md.category')}<select value={f.categoryId} onChange={(ev) => { setF({ ...f, categoryId: ev.target.value }); setPick(null); }} style={{ minHeight: 44 }} data-testid="mf-category"><option value="">{t('md.allCategories')}</option>{(cq.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>{t('md.search')}<input type="search" value={f.q} onChange={(ev) => { setF({ ...f, q: ev.target.value }); setPick(null); }} style={{ minHeight: 44 }} data-testid="mf-search" /></label></FilterPanel>
      <div className="actions-row no-print"><Link to="/inv/materials-dashboard">{t('md.title')}</Link><ExportButton query={{ projectId: f.projectId, from: f.from, to: f.to, categoryId: f.categoryId, q: f.q, kind: 'funnel' }} name="material-lifecycle-funnel.csv" testId="mf-export" /></div>
      {d.rows.length === 0 ? <div className="mdm-panel" data-testid="mf-empty"><h2>{t('md.funnelEmptyTitle')}</h2><p className="muted">{t('md.funnelEmptyBody')}</p><Link to="/proc/material-requests/new">{t('md.newMr')}</Link></div> : <>
        <div className="mdm-panel"><h2>{t('md.itemsReaching')}</h2><Bars rows={d.itemsReaching.map((s) => ({ key: s.key, label: s.label, value: s.items }))} format={(n) => String(n)} testId="mf-bars" label={t('md.itemsReaching')} /></div>
        <div className="table-scroll"><table className="data-table" data-testid="mf-table"><caption>{t('md.funnelCaption', { n: d.total })}</caption><thead><tr><th>{t('md.item')}</th>{d.stages.map((s) => <th key={s.key} className="num">{s.label}</th>)}<th>{t('md.widestGap')}</th></tr></thead>
          <tbody>{d.rows.map((r) => <tr key={r.itemId} data-testid="mf-row"><td><Link to={`/inv/ledger?itemId=${r.itemId}`}>{r.code}</Link> {r.name}<span className="muted small"> · {r.uom}{r.requiredSource === 'MR' ? ` · ${t('md.fromMr')}` : ''}</span></td>
            {r.stages.map((s) => <td key={s.key} className="num">{s.qty > 0 ? <button type="button" className="link-button" onClick={() => setPick({ itemId: r.itemId, stage: s.key })} data-testid={`mf-cell-${s.key}`}>{fmtQty(s.qty)}</button> : '0'}{s.pctOfPrevious != null ? <span className="muted small"> {s.pctOfPrevious}%</span> : null}</td>)}
            <td>{r.widestGap ? `${r.widestGap.label} ${r.widestGap.pctOfPrevious}%` : '—'}</td></tr>)}</tbody></table></div>
        {one && <div className="mdm-panel" data-testid="mf-item"><h2>{one.code} {one.name}</h2><Bars rows={one.stages.map((s) => ({ key: s.key, label: s.label, value: s.qty }))} format={(n) => `${fmtQty(n)} ${one.uom}`} testId="mf-item-bars" label={one.name} /></div>}
        {pick && <div className="mdm-panel" data-testid="mf-records"><h2>{sq.data ? `${sq.data.item.code} · ${sq.data.label}` : t('md.records')}</h2>{sq.isPending ? <Skeleton label={t('md.records')} rows={3} /> : sq.isError ? <ErrorState error={sq.error} onRetry={sq.refetch} /> : <RecordTable rows={sq.data.rows} testId="mf-records-table" />}</div>}</>}
    </section>
  );
}
