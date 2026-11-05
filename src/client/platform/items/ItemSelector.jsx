import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/index.js';

// The Item Selector (part 06.03, FR-06): one dialog every line grid uses to pick items. Search by code, name, specification or category (typed words all have to match), filter by type and category,
// the person's favourites and recent items, multi-select; it shows the unit, the category, the specification, and the standard and last rates where the person may see them. Stock is shown once the
// stores module (M16) reports it. Picking an item notes it as recent. Usage:
//   <ItemSelector open={open} onClose={() => setOpen(false)} onPick={(items) => ...} types={['MATERIAL']} multiple />
const TABS = [['all', 'Search'], ['favourites', 'Favourites'], ['recent', 'Recent']];
const unwrap = async (p) => (await p).data;
const qs = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
export default function ItemSelector({ open, onClose, onPick, types = null, multiple = true, title = 'Choose items' }) {
  const ref = useRef(null);
  const titleId = useId();
  const [tab, setTab] = useState('all');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [category, setCategory] = useState('');
  const [picked, setPicked] = useState(new Map());
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) { setPicked(new Map()); d.showModal(); } if (!open && d.open) d.close(); }, [open]);
  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 250); return () => clearTimeout(t); }, [text]);
  const cats = useQuery({ queryKey: ['mdm', 'items', 'categories'], queryFn: () => unwrap(api.get('/mdm/item-categories')), enabled: open, staleTime: 300_000, retry: false });
  const params = { q: tab === 'all' ? q : undefined, type: type || (types ? types.join(',') : undefined), category: category || undefined, only: tab === 'all' ? undefined : tab, limit: 30 };
  const res = useQuery({ queryKey: ['mdm', 'items', 'search', params], queryFn: () => unwrap(api.get(`/mdm/items/search?${qs(params)}`)), enabled: open, retry: false, placeholderData: (p) => p });
  const toggle = (it) => { const next = new Map(multiple ? picked : []); if (next.has(it.id)) next.delete(it.id); else next.set(it.id, it); setPicked(next); };
  const fav = async (it) => { await api.post(`/mdm/items/${it.id}/mark`, { mark: 'FAVOURITE', on: !it.favourite }); res.refetch(); };
  const done = async () => {
    const list = [...picked.values()];
    for (const it of list) api.post(`/mdm/items/${it.id}/mark`, { mark: 'RECENT' }).catch(() => {});
    onPick(list);
    onClose();
  };
  const spec = (s) => Object.values(s ?? {}).join(' · ');
  return (
    <dialog ref={ref} className="dialog dialog-wide item-selector" aria-labelledby={titleId} onClose={onClose} data-testid="item-selector">
      <h2 id={titleId}>{title}</h2>
      <div role="tablist" aria-label="Where to look" className="seg">{TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`btn btn-small ${tab === k ? 'btn-primary' : ''}`} onClick={() => setTab(k)} data-testid={`is-tab-${k}`}>{l}</button>)}</div>
      <div className="srch-form">
        {tab === 'all' && <label className="field srch-q"><span>Code, name or specification</span><input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="For example: opc 53, CEM-0, 12 mm" autoFocus data-testid="is-q" /></label>}
        {!types && <label className="field"><span>Type</span><select value={type} onChange={(e) => setType(e.target.value)} data-testid="is-type"><option value="">All</option>{(cats.data?.types ?? []).map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}</select></label>}
        <label className="field"><span>Category</span><select value={category} onChange={(e) => setCategory(e.target.value)} data-testid="is-category"><option value="">All</option>{(cats.data?.rows ?? []).filter((c) => c.status === 'ACTIVE').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      </div>
      {res.isError ? <p className="field-error" role="alert">{res.error?.message ?? 'The items could not be loaded.'}</p> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Items found" aria-busy={res.isFetching}>
          <table className="grid"><thead><tr><th><span className="sr-only">Choose</span></th><th>Code</th><th>Name</th><th>Unit</th><th>Category</th>{!res.data?.ratesMasked && <th className="num">Rate (₹)</th>}<th><span className="sr-only">Favourite</span></th></tr></thead>
            <tbody>{(res.data?.rows ?? []).map((it) => (
              <tr key={it.id} className={picked.has(it.id) ? 'is-selected' : ''} data-testid="is-row">
                <td><input type={multiple ? 'checkbox' : 'radio'} name="item-pick" aria-label={`Choose ${it.code} ${it.name}`} checked={picked.has(it.id)} onChange={() => toggle(it)} data-testid="is-pick" /></td>
                <th scope="row" data-label="Code">{it.code}</th>
                <td data-label="Name">{it.name}<div className="muted small">{spec(it.spec)}</div></td>
                <td data-label="Unit">{it.uom}{it.uoms.length > 1 ? <span className="muted small"> ({it.uoms.slice(1).join(', ')})</span> : null}</td>
                <td data-label="Category">{it.category}</td>
                {!res.data?.ratesMasked && <td className="num" data-label="Rate">{it.standardRate ?? '—'}{it.lastRate ? <div className="muted small">last {it.lastRate}</div> : null}</td>}
                <td><button type="button" className="btn btn-small" aria-pressed={it.favourite} aria-label={`${it.favourite ? 'Remove' : 'Add'} ${it.code} ${it.favourite ? 'from' : 'to'} favourites`} onClick={() => fav(it)}>{it.favourite ? '★' : '☆'}</button></td>
              </tr>))}</tbody></table>
          {res.data && res.data.rows.length === 0 && <p className="muted" data-testid="is-empty">{tab === 'all' ? (q ? 'No item matches. Check the spelling, or ask for a new item.' : 'Type to search the catalogue.') : `No ${tab === 'favourites' ? 'favourite' : 'recent'} item yet.`}</p>}
        </div>
      )}
      <div className="actions"><span className="muted small" aria-live="polite">{picked.size} chosen</span><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn btn-primary" disabled={!picked.size} onClick={done} data-testid="is-done">Add {picked.size || ''} item{picked.size === 1 ? '' : 's'}</button></div>
    </dialog>
  );
}
