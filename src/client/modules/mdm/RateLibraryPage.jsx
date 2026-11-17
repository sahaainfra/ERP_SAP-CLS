import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDate } from '../../platform/format.js';
import ItemSelector from '../../platform/items/ItemSelector.jsx';
import { Field, Link, Pager, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { rates, todayIST } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Resource Rate Library (Administration, part 06.06, FR-01): the rates of materials, labour trades, equipment and transport by region (state), project and date, with their source (quotation, market survey,
// DSR, last PO). Filters for item, region, source and "in force on"; the estimator adds a rate from a date (the rate in force for the same item, region and project ends the day before) or retires one; the
// Excel import (Import or export, type "Resource rates") loads many at once. Rate analyses price their components from here.
const PAGE = 50;
export default function RateLibraryPage() {
  usePageTitle('Resource Rate Library');
  const qc = useQueryClient();
  const [f, setF] = useState({ q: '', region: '', basis: '', asOf: '', status: 'ACTIVE' });
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['mdm', 'rates', 'library', f, page], queryFn: () => rates.library({ ...f, limit: PAGE, offset: (page - 1) * PAGE }), retry: false });
  const [form, setForm] = useState(null);
  const [pick, setPick] = useState(false);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  if (q.error?.status === 403) return <NoPermission what="the rate library" permission="mdm.analyse.view" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (q.isPending) return <Skeleton label="Loading the rate library" rows={6} />;
  const d = q.data;
  const set = (p) => { setF({ ...f, ...p }); setPage(1); };
  const save = async (e) => {
    e.preventDefault(); setError(null);
    try { const r = await rates.addRate({ itemId: form.item?.id ?? 0, region: form.region || null, rate: form.rate, uom: form.uom, basis: form.basis, basisRef: form.basisRef || null, effectiveFrom: form.effectiveFrom }); setNote(`Added ${r.itemCode} at ${r.rate} per ${r.uom} from ${formatDate(r.effectiveFrom)}.`); setForm(null); qc.invalidateQueries({ queryKey: ['mdm', 'rates'] }); } catch (err) { setError(errorInfo(err)); }
  };
  const retire = async (r) => { setError(null); try { await rates.retireRate(r.id, 'Retired from the rate library'); qc.invalidateQueries({ queryKey: ['mdm', 'rates'] }); } catch (err) { setError(errorInfo(err)); } };
  return (
    <section aria-labelledby="rl-title" data-testid="rate-library" className="fin-page">
      <PageHeader id="rl-title" title={"Resource Rate Library"} actions={<>{d.canEdit && <div className="actions-row"><button type="button" className="btn btn-primary btn-small" onClick={() => { setError(null); setForm({ item: null, region: '', rate: '', uom: '', basis: 'MARKET_SURVEY', basisRef: '', effectiveFrom: todayIST() }); }} data-testid="rl-new">New rate</button><Link to="/import">Import from Excel</Link></div>}</>} />
      {note && <p className="mdm-banner" role="status" data-testid="rl-note">{note}</p>}
      {error?.form && !form && <p className="field-error" role="alert">{error.form}</p>}
      {form && (
        <form onSubmit={save} aria-label="New rate" className="fin-form" data-testid="rl-form">
          <div className="mdm-fields">
            <Field label="Item (required)" name="itemId" error={error}><button type="button" className="btn btn-small" onClick={() => setPick(true)} data-testid="rl-pick">{form.item ? `${form.item.code} ${form.item.name}` : 'Choose an item'}</button></Field>
            <Field label="Unit (required)" name="uom" error={error}>{form.item?.uoms?.length ? <select value={form.uom} onChange={(e) => setForm({ ...form, uom: e.target.value })} data-testid="rl-uom">{[form.item.uom, ...form.item.uoms.map((u) => u.uom ?? u)].filter((v, i, a) => v && a.indexOf(v) === i).map((u) => <option key={u} value={u}>{u}</option>)}</select> : <input value={form.uom} onChange={(e) => setForm({ ...form, uom: e.target.value.toUpperCase() })} data-testid="rl-uom" />}</Field>
            <Field label="Rate (₹, required)" name="rate" error={error}><input inputMode="decimal" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} data-testid="rl-rate" /></Field>
            <Field label="State (empty for every region)" name="region" error={error} hint="For example MH"><input value={form.region} maxLength={3} onChange={(e) => setForm({ ...form, region: e.target.value.toUpperCase() })} data-testid="rl-region" /></Field>
            <Field label="Source" name="basis" error={error}><select value={form.basis} onChange={(e) => setForm({ ...form, basis: e.target.value })}>{d.bases.map((b) => <option key={b.code} value={b.code}>{b.label}</option>)}</select></Field>
            <Field label="Source reference" name="basisRef" error={error} hint="Quotation number, survey, DSR item, PO"><input value={form.basisRef} onChange={(e) => setForm({ ...form, basisRef: e.target.value })} /></Field>
            <Field label="From (required)" name="effectiveFrom" error={error}><input type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} data-testid="rl-from" /></Field>
          </div>
          {error?.form && <p className="field-error" role="alert" data-testid="rl-error">{error.form}</p>}
          <div className="actions"><button type="button" className="btn" onClick={() => setForm(null)}>Cancel</button><button type="submit" className="btn btn-primary" data-testid="rl-save">Add the rate</button></div>
          <ItemSelector open={pick} multiple={false} onClose={() => setPick(false)} onPick={(list) => { const it = list[0]; if (it) setForm({ ...form, item: it, uom: it.uom ?? form.uom }); setPick(false); }} types={['MATERIAL', 'CONSUMABLE', 'SPARE', 'TOOL', 'RETURNABLE', 'LABOUR', 'EQUIPMENT', 'SERVICE', 'SUBCONTRACT']} title="Choose the item" />
        </form>
      )}
      <div className="filters" role="search">
        <label>Search <input type="search" value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder="Item code or name" data-testid="rl-q" /></label>
        <label>State <input value={f.region} maxLength={3} onChange={(e) => set({ region: e.target.value.toUpperCase() })} placeholder="All" data-testid="rl-f-region" /></label>
        <label>Source <select value={f.basis} onChange={(e) => set({ basis: e.target.value })}><option value="">All</option>{d.bases.map((b) => <option key={b.code} value={b.code}>{b.label}</option>)}</select></label>
        <label>In force on <input type="date" value={f.asOf} onChange={(e) => set({ asOf: e.target.value })} data-testid="rl-asof" /></label>
        <label>Status <select value={f.status} onChange={(e) => set({ status: e.target.value })}><option value="">All</option><option value="ACTIVE">Active</option><option value="RETIRED">Retired</option></select></label>
      </div>
      {d.rows.length === 0 ? <EmptyState title="No rate yet" message={d.canEdit ? 'Add the rates of materials, labour and equipment, or import them from Excel.' : 'The estimator keeps the rate library.'} /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Rates"><table className="grid"><thead><tr><th>Item</th><th>State</th><th>Project</th><th className="num">Rate (₹)</th><th>Per</th><th>Source</th><th>From</th><th>To</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{d.rows.map((r) => <tr key={r.id} data-testid="rl-row"><th scope="row" data-label="Item">{r.itemCode} {r.itemName}</th><td data-label="State">{r.region ?? 'All'}</td><td data-label="Project">{r.project ?? '—'}</td><td className="num" data-label="Rate (₹)">{Number(r.rate).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</td><td data-label="Per">{r.uom}</td><td data-label="Source">{r.basisLabel}{r.basisRef ? <div className="muted small">{r.basisRef}</div> : null}</td><td data-label="From">{formatDate(r.effectiveFrom)}</td><td data-label="To">{r.effectiveTo ? formatDate(r.effectiveTo) : '—'}</td><td data-label="Status"><StatusBadge status={r.status === 'ACTIVE' ? 'ACTIVE' : 'ARCHIVED'} label={r.status === 'ACTIVE' ? 'Active' : 'Retired'} /></td><td>{d.canEdit && r.status === 'ACTIVE' && <button type="button" className="btn btn-small" onClick={() => retire(r)}>Retire</button>}</td></tr>)}</tbody></table></div>)}
      <Pager meta={{ page, pageSize: PAGE, total: d.total, totalPages: Math.max(1, Math.ceil(d.total / PAGE)) }} page={page} setPage={setPage} noun="rates" />
    </section>
  );
}
