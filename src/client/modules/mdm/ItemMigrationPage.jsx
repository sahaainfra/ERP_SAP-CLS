import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import ItemSelector from '../../platform/items/ItemSelector.jsx';
import { Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { items } from './api.js';

// Item Migration (Administration, part 06.03, FR-08): the materials the system held before the item master, as free text: item codes of the calculation engine's conversions and the lines of sample requests
// (description and unit). Each one is mapped to an existing item (chosen with the selector, a likely match suggested) or becomes a new item that keeps its old code; the old records are not rewritten,
// the map links them, so nothing that refers to them breaks.
export default function ItemMigrationPage() {
  usePageTitle('Item Migration');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['mdm', 'items', 'migration'], queryFn: items.migration, retry: false });
  const [pickFor, setPickFor] = useState(null);
  const [error, setError] = useState(null);
  if (q.error?.status === 403) return <NoPermission what="the migration of old materials" permission="mdm.item.migrate" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (q.isPending) return <Skeleton label="Loading the old materials" rows={4} />;
  const map = async (row, itemId) => { setError(null); try { await items.map({ source: row.source, key: row.key, itemId }); qc.invalidateQueries({ queryKey: ['mdm', 'items', 'migration'] }); } catch (e) { setError(errorInfo(e)); } };
  const create = (row) => navigateTo(`/admin/items/new?legacySource=${encodeURIComponent(row.source)}&legacyKey=${encodeURIComponent(row.key)}`);
  return (
    <section aria-labelledby="mig-title" data-testid="item-migration">
      <h1 id="mig-title">Item Migration</h1>
      <p className="muted">{q.data.open} material(s) still to map. Mapping links the old records to an item; nothing in them is rewritten.</p>
      {error?.form && <p className="field-error" role="alert" data-testid="mig-error">{error.form}</p>}
      {q.data.rows.length === 0 ? <EmptyState title="Nothing to migrate" message="No free-text material was found in the conversions or the sample requests." /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Old materials"><table className="grid"><thead><tr><th>Old material</th><th>Found in</th><th className="num">Uses</th><th>Mapped to</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{q.data.rows.map((r) => (
            <tr key={`${r.source}|${r.key}`} data-testid="mig-row">
              <th scope="row" data-label="Old material">{r.label}<div className="muted small">{r.detail}</div></th>
              <td data-label="Found in">{r.source === 'conversion' ? 'Unit conversions' : 'Sample request lines'}</td><td className="num" data-label="Uses">{r.uses}</td>
              <td data-label="Mapped to">{r.mappedTo ? <Link to={`/admin/items/item?id=${r.mappedTo.id}`}>{r.mappedTo.code} {r.mappedTo.name}</Link> : r.pending ? <>Waiting for approval: <Link to={`/admin/items/item?id=${r.pending.id}`}>{r.pending.code}</Link></> : r.suggest ? <span className="muted">Likely {r.suggest.code} {r.suggest.name} ({r.suggest.score}%)</span> : '—'}</td>
              <td>{!r.mappedTo && !r.pending && <>
                {r.suggest && r.source !== 'conversion' && <button type="button" className="btn btn-small btn-primary" onClick={() => map(r, r.suggest.id)} data-testid="mig-accept">Map to {r.suggest.code}</button>}
                {r.source !== 'conversion' && <button type="button" className="btn btn-small" onClick={() => setPickFor(r)} data-testid="mig-choose">Choose an item</button>}
                <button type="button" className="btn btn-small" onClick={() => create(r)} data-testid="mig-create">New item from this</button></>}</td>
            </tr>))}</tbody></table></div>
      )}
      <ItemSelector open={Boolean(pickFor)} multiple={false} onClose={() => setPickFor(null)} onPick={(list) => list[0] && map(pickFor, list[0].id)} title={pickFor ? `Map "${pickFor.label}" to an item` : 'Choose an item'} />
    </section>
  );
}
