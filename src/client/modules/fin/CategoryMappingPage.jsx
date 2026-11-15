import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { fin } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Item Category → GL / Cost Code Mapping (Finance, configuration, part 06.05, FR-05, AC-01): for every item category of the item master, the stock account (for stocked items), the consumption account and the
// cost code a purchase, issue or consumption of its items is posted to. A category without its own mapping uses its parent's; a category with neither is listed as missing (the mapping must be complete). The
// accounts manager changes rows and sends them, with a date from which they apply, to the CFO (maker-checker); the earlier mapping holds until the day before.
export default function CategoryMappingPage() {
  usePageTitle('Item Category → GL / Cost Code Mapping');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['fin', 'mappings'], queryFn: fin.mappings, retry: false });
  const chart = useQuery({ queryKey: ['fin', 'chart', {}], queryFn: () => fin.chart({}), retry: false });
  const costs = useQuery({ queryKey: ['fin', 'costs'], queryFn: fin.costs, retry: false });
  const [edits, setEdits] = useState({});
  const [reason, setReason] = useState('');
  const [from, setFrom] = useState('');
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  if (q.error?.status === 403) return <NoPermission what="the item category mapping" permission="fin.coa.view" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (q.isPending) return <Skeleton label="Loading the mapping" rows={6} />;
  const m = q.data;
  const accounts = (chart.data?.accounts ?? []).filter((a) => a.status === 'ACTIVE');
  const stock = accounts.filter((a) => ['INVENTORY', 'WIP'].includes(a.type));
  const consumption = accounts.filter((a) => !a.isControl && ['EXPENSE', 'FIXED_ASSET', 'WIP'].includes(a.type));
  const codes = (costs.data?.codes ?? []).filter((c) => c.status === 'ACTIVE');
  const cur = (r) => edits[r.categoryId] ?? { inventoryAccountId: r.inherited ? '' : r.mapping?.inventory?.id ?? '', expenseAccountId: r.inherited ? '' : r.mapping?.expense?.id ?? '', costCodeId: r.inherited ? '' : r.mapping?.costCode?.id ?? '' };
  const set = (r, p) => setEdits({ ...edits, [r.categoryId]: { ...cur(r), ...p } });
  const changed = Object.keys(edits).length;
  const send = async (e) => {
    e.preventDefault(); setError(null);
    try {
      const rows = Object.entries(edits).map(([categoryId, x]) => ({ categoryId: Number(categoryId), inventoryAccountId: x.inventoryAccountId ? Number(x.inventoryAccountId) : null, expenseAccountId: Number(x.expenseAccountId), costCodeId: x.costCodeId ? Number(x.costCodeId) : null }));
      const out = await fin.saveMappings({ rows, ...(from ? { effectiveFrom: from } : {}), reason });
      setNote(`${out.what} was sent to the CFO for approval (change #${out.id}).`); setEdits({}); setReason(''); qc.invalidateQueries({ queryKey: ['fin'] });
    } catch (err) { setError(errorInfo(err)); }
  };
  const fieldErr = (i, k) => error?.fields?.[`rows.${i}.${k}`];
  const order = Object.keys(edits).map(Number);
  return (
    <section aria-labelledby="cm-title" data-testid="category-mapping" className="fin-page">
      <PageHeader id="cm-title" title={"Item Category → GL / Cost Code Mapping"} />
      <p className={`mdm-banner ${m.complete ? '' : 'is-warning'}`} role="status" data-testid="cm-status">{m.complete ? `Complete: all ${m.total} active categories post to an account and a cost code.` : `${m.missing.length} of ${m.total} active categories have no mapping: ${m.missing.map((x) => x.name).join(', ')}.`}</p>
      {note && <p className="mdm-banner" role="status" data-testid="cm-note">{note}</p>}
      <form onSubmit={send} aria-label="Mapping">
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Categories"><table className="grid"><thead><tr><th>Category</th><th>Stock account</th><th>Consumption account</th><th>Cost code</th><th>Status</th></tr></thead>
          <tbody>{m.rows.map((r) => { const x = cur(r); const i = order.indexOf(r.categoryId); const edit = m.canEdit && !r.pendingChangeId; return (
            <tr key={r.categoryId} className={!r.mapping && r.status === 'ACTIVE' ? 'is-overdue' : ''} data-testid="cm-row">
              <th scope="row" data-label="Category" style={{ paddingInlineStart: r.parentId ? '1.5rem' : undefined }}>{r.code} {r.name}{r.status !== 'ACTIVE' && <div className="muted small">not in use</div>}</th>
              <td data-label="Stock account">{edit ? <select aria-label={`Stock account of ${r.name}`} value={x.inventoryAccountId} onChange={(e) => set(r, { inventoryAccountId: e.target.value })}><option value="">{r.inherited ? `${r.mapping?.inventory?.code ?? 'none'} (from ${r.inheritedFrom})` : 'Not stocked'}</option>{stock.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</select> : r.mapping?.inventory ? `${r.mapping.inventory.code} ${r.mapping.inventory.name}` : '—'}{i >= 0 && fieldErr(i, 'inventoryAccountId') && <div className="field-error">{fieldErr(i, 'inventoryAccountId')}</div>}</td>
              <td data-label="Consumption account">{edit ? <select aria-label={`Consumption account of ${r.name}`} value={x.expenseAccountId} onChange={(e) => set(r, { expenseAccountId: e.target.value })} data-testid="cm-expense"><option value="">{r.inherited ? `${r.mapping?.expense?.code} (from ${r.inheritedFrom})` : 'Choose'}</option>{consumption.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</select> : r.mapping?.expense ? `${r.mapping.expense.code} ${r.mapping.expense.name}` : '—'}{i >= 0 && fieldErr(i, 'expenseAccountId') && <div className="field-error">{fieldErr(i, 'expenseAccountId')}</div>}</td>
              <td data-label="Cost code">{edit ? <select aria-label={`Cost code of ${r.name}`} value={x.costCodeId} onChange={(e) => set(r, { costCodeId: e.target.value })} data-testid="cm-costcode"><option value="">{r.inherited ? `${r.mapping?.costCode?.code ?? 'none'} (from ${r.inheritedFrom})` : 'None'}</option>{codes.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</select> : r.mapping?.costCode ? `${r.mapping.costCode.code} ${r.mapping.costCode.name}` : '—'}</td>
              <td data-label="Status">{r.pendingChangeId ? `Change #${r.pendingChangeId} waiting` : r.mapping ? (r.inherited ? `From ${r.inheritedFrom}` : `Since ${r.mapping.effectiveFrom}`) : <strong>Missing</strong>}{edits[r.categoryId] ? <div className="small">changed</div> : null}</td>
            </tr>); })}</tbody></table></div>
        {m.canEdit && changed > 0 && <div className="mdm-fields" data-testid="cm-send">
          <Field label="Applies from (today when empty)" name="effectiveFrom" error={error}><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Reason (required)" name="reason" error={error}><input value={reason} onChange={(e) => setReason(e.target.value)} data-testid="cm-reason" /></Field>
          {error?.form && <p className="field-error" role="alert" data-testid="cm-error">{error.form}</p>}
          <div className="actions"><button type="button" className="btn" onClick={() => setEdits({})}>Discard</button><button type="submit" className="btn btn-primary" data-testid="cm-save">Send {changed} categor{changed === 1 ? 'y' : 'ies'} for approval</button></div>
        </div>}
      </form>
      <p className="small"><Link to="/admin/items/categories">Item categories</Link> · <Link to="/finance/chart-of-accounts?tab=changes">Changes waiting for approval</Link></p>
    </section>
  );
}
