import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import ListReport from '../../platform/list/ListReport.jsx';
import { useSession } from '../core/api/index.js';
import { Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { items } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Item Master (Administration, part 06.03): the category tree beside the List Report of items (search, filters by type, category and status, sort, saved views, column chooser, 25/50/100 a page, export
// XLSX/CSV/PDF with the rate hidden from people who may not see it). A category narrows the list to itself and its sub-categories. "New item" opens the wizard; bulk entry goes through the Import Center.
export default function ItemMasterPage() {
  usePageTitle('Item Master');
  const session = useSession();
  const cats = useQuery({ queryKey: ['mdm', 'items', 'categories'], queryFn: items.categories, retry: false });
  const [cat, setCat] = useState(() => Number(new URLSearchParams(window.location.search).get('category')) || null);
  const rows = cats.data?.rows ?? [];
  const below = (id) => { const out = [id]; for (let i = 0; i < out.length; i += 1) for (const c of rows) if (c.parentId === out[i]) out.push(c.id); return out; };
  const tree = (parent, depth) => rows.filter((c) => c.parentId === parent).map((c) => (
    <li key={c.id}>
      <button type="button" className={`btn btn-small item-tree-node${cat === c.id ? ' btn-primary' : ''}`} style={{ marginInlineStart: `${depth}rem` }} aria-pressed={cat === c.id} onClick={() => setCat(cat === c.id ? null : c.id)} data-testid="im-cat">{c.name} <span className="muted small">({c.items})</span></button>
      {rows.some((x) => x.parentId === c.id) && <ul className="item-tree">{tree(c.id, depth + 1)}</ul>}
    </li>
  ));
  return (
    <section aria-labelledby="im-title" data-testid="item-master">
      <PageHeader id="im-title" srOnly title={"Item Master"} />
      <div className="item-master">
        <nav aria-label="Categories" className="item-tree-pane">
          <h2 className="small">Categories</h2>
          <button type="button" className={`btn btn-small${cat == null ? ' btn-primary' : ''}`} aria-pressed={cat == null} onClick={() => setCat(null)}>All categories</button>
          <ul className="item-tree">{tree(null, 0)}</ul>
          <p className="small"><Link to="/admin/items/categories">Categories & attribute templates</Link> · <Link to="/import">Import or export</Link>{cats.data && session.data?.permissions?.includes('mdm.item.migrate') ? <> · <Link to="/admin/items/migration">Item migration</Link></> : null}</p>
        </nav>
        <div className="item-list-pane">
          <ListReport listCode="mdm.items" endpoint="/mdm/items/register" title="Item Master" session={session.data}
            rowHref={(r) => `/admin/items/item?id=${r.id}`} onOpen={(r) => navigateTo(`/admin/items/item?id=${r.id}`)}
            cardFields={['code', 'name', 'type', 'status', 'baseUom']} statusKey="status" dateKey="updatedAt"
            contextFilters={cat ? [{ key: 'categoryId', op: 'in', value: below(cat).join(',') }] : []}
            newAction={{ label: 'New item', onClick: () => navigateTo(`/admin/items/new${cat ? `?category=${cat}` : ''}`) }}
            empty={{ title: 'No item here yet', text: 'Ask for a new item with the wizard, or import a list of items through the Import Center.' }} />
        </div>
      </div>
    </section>
  );
}
