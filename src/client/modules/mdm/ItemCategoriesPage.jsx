import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDateTime } from '../../platform/format.js';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { items } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Item Categories & Attribute Templates (Administration, part 06.03, FR-02): the category tree of the company (copied from the system tree the first time) and, for the chosen category, its code, code prefix
// (the series of its item codes), item types, steward role (who approves its new items), default HSN/SAC, GL mapping and the attribute template its items fill in (key, label, text/number/choice, unit,
// required). The procurement manager, the estimator and the system administrator change them with a reason; every change is in the history.
const STEWARDS = [['PROCMGR', 'Procurement manager'], ['STOREMGR', 'Stores manager'], ['EST', 'Estimator'], ['PLANTMGR', 'Plant manager']];
const fresh = (parentId = null) => ({ id: null, parentId, code: '', name: '', nameHi: '', codePrefix: '', itemTypes: [], attributes: [], defaultHsn: '', glCode: '', stewardRole: 'PROCMGR', status: 'ACTIVE', reason: '' });
export default function ItemCategoriesPage() {
  usePageTitle('Item Categories & Attribute Templates');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['mdm', 'items', 'categories'], queryFn: items.categories, retry: false });
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const hist = useQuery({ queryKey: ['mdm', 'items', 'category-history', edit?.id], queryFn: () => items.categoryHistory(edit.id), enabled: Boolean(edit?.id), retry: false });
  if (q.error?.status === 403) return <NoPermission what="the item categories" permission="mdm.record.view" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (q.isPending) return <Skeleton label="Loading the categories" rows={4} />;
  const { rows, types, canEdit } = q.data;
  const open = (c) => { setError(null); setNote(null); setEdit({ ...c, nameHi: c.nameHi ?? '', defaultHsn: c.defaultHsn ?? '', glCode: c.glCode ?? '', reason: '' }); };
  const set = (p) => setEdit((cur) => ({ ...cur, ...p }));
  const setAttr = (i, p) => set({ attributes: edit.attributes.map((a, j) => (j === i ? { ...a, ...p } : a)) });
  const save = async (e) => {
    e.preventDefault(); setError(null);
    try {
      const b = { parentId: edit.parentId ?? null, code: edit.code, name: edit.name, nameHi: edit.nameHi || null, codePrefix: edit.codePrefix, itemTypes: edit.itemTypes, attributes: edit.attributes.map((a) => ({ key: a.key, label: a.label, type: a.type, ...(a.type === 'enum' ? { options: (Array.isArray(a.options) ? a.options : String(a.options ?? '').split(',')).map((o) => o.trim()).filter(Boolean) } : {}), ...(a.unit ? { unit: a.unit } : {}), required: Boolean(a.required) })),
        defaultHsn: edit.defaultHsn || null, glCode: edit.glCode || null, stewardRole: edit.stewardRole, status: edit.status, ...(edit.id ? { version: edit.rowVersion } : {}), reason: edit.reason };
      const out = await items.saveCategory(edit.id, b);
      setNote(`Saved ${out.name}.`); qc.invalidateQueries({ queryKey: ['mdm', 'items'] }); open(out);
    } catch (err) { setError(errorInfo(err)); }
  };
  const tree = (parent, depth) => rows.filter((c) => c.parentId === parent).map((c) => (
    <li key={c.id}><button type="button" className={`btn btn-small item-tree-node${edit?.id === c.id ? ' btn-primary' : ''}`} style={{ marginInlineStart: `${depth}rem` }} onClick={() => open(c)} data-testid="ic-node">{c.name} <span className="muted small">{c.codePrefix} · {c.items}</span>{c.status !== 'ACTIVE' ? ' (not in use)' : ''}</button>
      {rows.some((x) => x.parentId === c.id) && <ul className="item-tree">{tree(c.id, depth + 1)}</ul>}</li>));
  return (
    <section aria-labelledby="ic-title" data-testid="item-categories">
      <PageHeader id="ic-title" title={"Item Categories & Attribute Templates"} />
      <div className="item-master">
        <nav aria-label="Categories" className="item-tree-pane"><ul className="item-tree">{tree(null, 0)}</ul>{canEdit && <button type="button" className="btn btn-small" onClick={() => open(fresh(null))} data-testid="ic-new">New top category</button>}</nav>
        <div className="item-list-pane">
          {!edit ? <EmptyState title="Choose a category" message="Its template, code series and steward show here." /> : (
            <form onSubmit={save} aria-label="Category" data-testid="ic-form">
              <h2>{edit.id ? edit.name : 'New category'}{edit.id && canEdit && <button type="button" className="btn btn-small" style={{ marginInlineStart: '1rem' }} onClick={() => open(fresh(edit.id))} data-testid="ic-sub">Add a sub-category</button>}</h2>
              {note && <p className="mdm-banner" role="status" data-testid="ic-note">{note}</p>}
              <fieldset className="mdm-fields" disabled={!canEdit}>
                <Field label="Code (required)" name="code" error={error}><input value={edit.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} data-testid="ic-code" /></Field>
                <Field label="Name (required)" name="name" error={error}><input value={edit.name} onChange={(e) => set({ name: e.target.value })} data-testid="ic-name" /></Field>
                <Field label="Name (Hindi)" name="nameHi" error={error}><input lang="hi" value={edit.nameHi} onChange={(e) => set({ nameHi: e.target.value })} /></Field>
                <Field label="Code prefix (required)" name="codePrefix" error={error} hint={edit.items ? 'Fixed: the category has items' : 'Item codes are PREFIX-00001'}><input value={edit.codePrefix} disabled={Boolean(edit.items)} onChange={(e) => set({ codePrefix: e.target.value.toUpperCase() })} data-testid="ic-prefix" /></Field>
                <Field label="Under" name="parentId" error={error}><select value={edit.parentId ?? ''} onChange={(e) => set({ parentId: e.target.value ? Number(e.target.value) : null })}><option value="">Top level</option>{rows.filter((c) => c.id !== edit.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
                <Field label="Steward (approves new items)" name="stewardRole" error={error}><select value={edit.stewardRole} onChange={(e) => set({ stewardRole: e.target.value })} data-testid="ic-steward">{STEWARDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
                <Field label="Default HSN/SAC" name="defaultHsn" error={error}><input inputMode="numeric" value={edit.defaultHsn} onChange={(e) => set({ defaultHsn: e.target.value })} /></Field>
                <Field label="GL mapping code" name="glCode" error={error}><input value={edit.glCode} onChange={(e) => set({ glCode: e.target.value })} /></Field>
                <Field label="In use" name="status" error={error}><select value={edit.status} onChange={(e) => set({ status: e.target.value })}><option value="ACTIVE">Yes</option><option value="INACTIVE">No</option></select></Field>
              </fieldset>
              <fieldset disabled={!canEdit}><legend>Item types (required)</legend><div className="actions-row">{types.map((t) => <label key={t.code} className="check"><input type="checkbox" checked={edit.itemTypes.includes(t.code)} onChange={(e) => set({ itemTypes: e.target.checked ? [...edit.itemTypes, t.code] : edit.itemTypes.filter((x) => x !== t.code) })} data-testid={`ic-type-${t.code}`} /> {t.label}</label>)}</div></fieldset>
              <fieldset disabled={!canEdit}><legend>Attribute template</legend>
                <div className="table-wrap" tabIndex={0} role="region" aria-label="Attributes"><table className="grid"><thead><tr><th>Key</th><th>Label</th><th>Kind</th><th>Choices (comma separated)</th><th>Unit</th><th>Required</th><th><span className="sr-only">Remove</span></th></tr></thead>
                  <tbody>{edit.attributes.map((a, i) => <tr key={i} data-testid="ic-attr"><td><input aria-label="Key" value={a.key} onChange={(e) => setAttr(i, { key: e.target.value })} /></td><td><input aria-label="Label" value={a.label} onChange={(e) => setAttr(i, { label: e.target.value })} /></td>
                    <td><select aria-label="Kind" value={a.type} onChange={(e) => setAttr(i, { type: e.target.value })}><option value="text">Text</option><option value="number">Number</option><option value="enum">Choice</option></select></td>
                    <td>{a.type === 'enum' ? <input aria-label="Choices" value={Array.isArray(a.options) ? a.options.join(', ') : a.options ?? ''} onChange={(e) => setAttr(i, { options: e.target.value })} /> : '—'}</td><td><input aria-label="Unit" value={a.unit ?? ''} onChange={(e) => setAttr(i, { unit: e.target.value })} /></td>
                    <td><input type="checkbox" aria-label="Required" checked={Boolean(a.required)} onChange={(e) => setAttr(i, { required: e.target.checked })} /></td><td><button type="button" className="btn btn-small" onClick={() => set({ attributes: edit.attributes.filter((_, j) => j !== i) })}>Remove</button></td></tr>)}</tbody></table></div>
                {canEdit && <button type="button" className="btn btn-small" onClick={() => set({ attributes: [...edit.attributes, { key: '', label: '', type: 'text', required: false }] })} data-testid="ic-attr-add">Add an attribute</button>}
              </fieldset>
              {canEdit && <><Field label="Reason (required)" name="reason" error={error}><input required minLength={5} value={edit.reason} onChange={(e) => set({ reason: e.target.value })} data-testid="ic-reason" /></Field>
                {error?.form && <p className="field-error" role="alert" data-testid="ic-error">{error.form}</p>}
                <div className="actions"><button type="button" className="btn" onClick={() => setEdit(null)}>Cancel</button><button type="submit" className="btn btn-primary" data-testid="ic-save">Save</button></div></>}
              {edit.id && <p className="small"><Link to={`/admin/items?category=${edit.id}`}>Items of this category</Link></p>}
              {hist.data?.rows?.length > 0 && <><h3>History</h3><ul className="mdm-list">{hist.data.rows.map((h, i) => <li key={i}>{formatDateTime(h.at)} · {h.action} · {h.by}{h.reason ? `: ${h.reason}` : ''}</li>)}</ul></>}
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
