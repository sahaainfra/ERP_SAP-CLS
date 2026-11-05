import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { items, mdm } from './api.js';

// New Item (Administration, part 06.03): a wizard. 1 Category and type; 2 the attributes of the category's template (required ones marked, choices offered); 3 name, units (base and item conversions), tax
// codes (the category's HSN/SAC by default, its GST rate on the date) and tracking; 4 review, with the near-identical items of the category found by the server (FR-07) before anything is sent. Sending makes a
// request that the steward of the category approves. A draft of the wizard is kept in this browser until it is sent.
const STEPS = ['Category', 'Specification', 'Units and tax', 'Review'];
const DRAFT_KEY = 'erp.mdm.new-item';
const blank = (category) => ({ categoryId: category ?? '', itemType: '', spec: {}, name: '', nameHi: '', description: '', baseUom: '', uoms: [], hsnSac: '', gstRate: '', stockTracked: false, batchTracked: false, serialTracked: false, shelfLifeDays: '', reorderLevel: '', reorderQuantity: '', standardRate: '', preferredBrands: '', justification: '' });
export default function NewItemPage() {
  usePageTitle('New Item');
  const cats = useQuery({ queryKey: ['mdm', 'items', 'categories'], queryFn: items.categories, retry: false });
  const units = useQuery({ queryKey: ['mdm', 'common', 'uom', 'all'], queryFn: () => mdm.common('uom', { limit: 200, offset: 0 }), retry: false, staleTime: 300_000 });
  const [step, setStep] = useState(0);
  const sp = new URLSearchParams(window.location.search);
  // from Item Migration: the old material the new item replaces (a conversion keeps its code; a sample request line gives the name and the unit)
  const legacy = sp.get('legacySource') ? { source: sp.get('legacySource'), key: sp.get('legacyKey') ?? '' } : null;
  const [v, setV] = useState(() => {
    if (legacy) { const [desc, unit] = legacy.source === 'sample-request-line' ? legacy.key.split('|') : ['', '']; return { ...blank(Number(sp.get('category')) || ''), name: desc ?? '', baseUom: unit ?? '' }; }
    try { const d = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null'); if (d) return d; } catch { /* no draft */ }
    return blank(Number(sp.get('category')) || '');
  });
  const [check, setCheck] = useState(null);
  const [ack, setAck] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (legacy) return; try { localStorage.setItem(DRAFT_KEY, JSON.stringify(v)); } catch { /* storage off */ } }, [v, legacy]);
  if (cats.error?.status === 403) return <NoPermission what="the item catalogue" permission="mdm.record.view" />;
  if (cats.isError) return <ErrorState error={cats.error} onRetry={cats.refetch} />;
  if (cats.isPending) return <Skeleton label="Loading the categories" rows={4} />;
  const cat = cats.data.rows.find((c) => c.id === Number(v.categoryId));
  const set = (p) => setV({ ...v, ...p });
  const body = () => ({ categoryId: Number(v.categoryId), itemType: v.itemType, name: v.name, nameHi: v.nameHi || null, description: v.description || null, spec: Object.fromEntries(Object.entries(v.spec).filter(([, x]) => x !== '')), baseUom: v.baseUom,
    hsnSac: v.hsnSac || null, gstRate: v.gstRate || null, stockTracked: v.stockTracked, batchTracked: v.batchTracked, serialTracked: v.serialTracked, shelfLifeDays: v.shelfLifeDays ? Number(v.shelfLifeDays) : null,
    reorderLevel: v.reorderLevel || undefined, reorderQuantity: v.reorderQuantity || undefined, standardRate: v.standardRate || undefined, preferredBrands: v.preferredBrands.split(',').map((b) => b.trim()).filter(Boolean), uoms: v.uoms.filter((u) => u.uom && u.factorToBase) });
  const next = async () => {
    setError(null);
    if (step === 0 && (!cat || !v.itemType)) { setError({ form: 'Choose a category and the type of item.', fields: { categoryId: cat ? null : 'required', itemType: v.itemType ? null : 'required' } }); return; }
    if (step === 1) { const missing = cat.attributes.filter((a) => a.required && !String(v.spec[a.key] ?? '').trim()); if (missing.length) { setError({ form: `Fill in ${missing.map((a) => a.label).join(', ')}.`, fields: Object.fromEntries(missing.map((a) => [`spec.${a.key}`, 'required'])) }); return; } }
    if (step === 2) {
      if (!v.name.trim() || !v.baseUom) { setError({ form: 'Give the item a name and its base unit.', fields: { name: v.name.trim() ? null : 'required', baseUom: v.baseUom ? null : 'required' } }); return; }
      try { const c = await items.check(body()); setCheck(c); if (c.errors.length) { setError({ form: 'Some fields are not valid.', fields: Object.fromEntries(c.errors.map((e) => [e.field, e.message])) }); return; } } catch (e) { setError(errorInfo(e)); return; }
    }
    setStep(step + 1);
  };
  const send = async () => {
    setBusy(true); setError(null);
    try {
      const r = await items.create({ ...body(), justification: v.justification || undefined, acknowledgeDuplicates: ack, ...(legacy ? { legacy: { ...legacy, ...(legacy.source === 'conversion' ? { code: legacy.key } : {}) } } : {}) });
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* storage off */ }
      navigateTo(`/admin/items/item?id=${r.item.id}&sent=1`, { force: true });
    } catch (e) { setError(e.code === 'DUPLICATE_WARNING' ? { ...errorInfo(e), form: e.message } : errorInfo(e)); } finally { setBusy(false); }
  };
  const fe = (k) => error?.fields?.[k];
  return (
    <section aria-labelledby="ni-title" data-testid="new-item">
      <h1 id="ni-title">New Item</h1>
      {legacy && <p className="mdm-banner" role="note" data-testid="ni-legacy">Replaces the old material “{legacy.key.replace('|', ', unit ')}”{legacy.source === 'conversion' ? `; the item keeps the code ${legacy.key} and its conversions` : ''}. Once approved, the old records are linked to it.</p>}
      <ol className="wizard-steps" aria-label="Steps">{STEPS.map((s, i) => <li key={s} aria-current={i === step ? 'step' : undefined} className={i === step ? 'is-current' : i < step ? 'is-done' : ''}>{i + 1}. {s}</li>)}</ol>
      {error?.form && <p className="field-error" role="alert" data-testid="ni-error">{error.form}</p>}
      {step === 0 && (
        <fieldset className="mdm-fields"><legend>Category and type</legend>
          <Field label="Category (required)" name="categoryId" error={error}><select value={v.categoryId} onChange={(e) => set({ categoryId: e.target.value, itemType: '', spec: {} })} aria-invalid={Boolean(fe('categoryId'))} data-testid="ni-category"><option value="">Choose</option>{cats.data.rows.filter((c) => c.status === 'ACTIVE').map((c) => <option key={c.id} value={c.id}>{cats.data.rows.find((p) => p.id === c.parentId)?.name ? `${cats.data.rows.find((p) => p.id === c.parentId).name} › ` : ''}{c.name}</option>)}</select></Field>
          <Field label="Type (required)" name="itemType" error={error}><select value={v.itemType} onChange={(e) => set({ itemType: e.target.value })} disabled={!cat} aria-invalid={Boolean(fe('itemType'))} data-testid="ni-type"><option value="">Choose</option>{(cat?.itemTypes.length ? cat.itemTypes : cats.data.types.map((t) => t.code)).map((t) => <option key={t} value={t}>{cats.data.types.find((x) => x.code === t)?.label ?? t}</option>)}</select></Field>
          {cat && <p className="muted small">Approved by the {cat.stewardRole === 'PROCMGR' ? 'procurement manager' : cat.stewardRole === 'STOREMGR' ? 'stores manager' : cat.stewardRole === 'EST' ? 'estimator' : 'plant manager'}. Code from the series {cat.codePrefix}-nnnnn.</p>}
        </fieldset>
      )}
      {step === 1 && (
        <fieldset className="mdm-fields"><legend>Specification of {cat.name}</legend>
          {cat.attributes.length === 0 && <p className="muted">This category has no attribute template; describe the item on the next step.</p>}
          {cat.attributes.map((a) => (
            <Field key={a.key} label={`${a.label}${a.unit ? ` (${a.unit})` : ''}${a.required ? ' (required)' : ''}`} name={`spec.${a.key}`} error={error}>
              {a.type === 'enum' ? <select value={v.spec[a.key] ?? ''} onChange={(e) => set({ spec: { ...v.spec, [a.key]: e.target.value } })} data-testid={`ni-spec-${a.key}`}><option value="">Choose</option>{a.options.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                : <input inputMode={a.type === 'number' ? 'decimal' : undefined} value={v.spec[a.key] ?? ''} onChange={(e) => set({ spec: { ...v.spec, [a.key]: e.target.value } })} data-testid={`ni-spec-${a.key}`} />}
            </Field>))}
        </fieldset>
      )}
      {step === 2 && (
        <fieldset className="mdm-fields"><legend>Name, units and tax</legend>
          <Field label="Name (required)" name="name" error={error}><input value={v.name} maxLength={160} onChange={(e) => set({ name: e.target.value })} data-testid="ni-name" /></Field>
          <Field label="Name (Hindi)" name="nameHi" error={error}><input lang="hi" value={v.nameHi} maxLength={160} onChange={(e) => set({ nameHi: e.target.value })} /></Field>
          <Field label="Description" name="description" error={error}><textarea rows="2" value={v.description} maxLength={1000} onChange={(e) => set({ description: e.target.value })} /></Field>
          <Field label="Base unit (required)" name="baseUom" error={error} hint="The unit stock and rates are kept in"><select value={v.baseUom} onChange={(e) => set({ baseUom: e.target.value })} data-testid="ni-uom"><option value="">Choose</option>{(units.data?.rows ?? []).map((u) => <option key={u.id} value={u.code}>{u.code} {u.name}</option>)}</select></Field>
          <div className="mdm-card"><h3 className="small">Other units of this item</h3>
            {v.uoms.map((u, i) => <div key={i} className="actions-row"><Field label="Unit" name={`uom-${i}`} error={null}><select value={u.uom} onChange={(e) => set({ uoms: v.uoms.map((x, j) => (j === i ? { ...x, uom: e.target.value } : x)) })} data-testid="ni-alt-uom"><option value="">Choose</option>{(units.data?.rows ?? []).map((x) => <option key={x.id} value={x.code}>{x.code}</option>)}</select></Field><Field label={`1 ${u.uom || 'unit'} = how many ${v.baseUom || 'base units'}`} name={`f-${i}`} error={null}><input inputMode="decimal" value={u.factorToBase} onChange={(e) => set({ uoms: v.uoms.map((x, j) => (j === i ? { ...x, factorToBase: e.target.value } : x)) })} data-testid="ni-alt-factor" /></Field><button type="button" className="btn btn-small" onClick={() => set({ uoms: v.uoms.filter((_, j) => j !== i) })}>Remove</button></div>)}
            <button type="button" className="btn btn-small" onClick={() => set({ uoms: [...v.uoms, { uom: '', factorToBase: '' }] })} data-testid="ni-add-uom">Add a unit</button></div>
          <Field label="HSN/SAC" name="hsnSac" error={error} hint={cat?.defaultHsn ? `Empty: the category's ${cat.defaultHsn}` : null}><input inputMode="numeric" value={v.hsnSac} maxLength={8} onChange={(e) => set({ hsnSac: e.target.value })} /></Field>
          <Field label="GST rate" name="gstRate" error={error} hint="Empty: the default rate of the HSN/SAC"><input value={v.gstRate} maxLength={12} onChange={(e) => set({ gstRate: e.target.value.toUpperCase() })} /></Field>
          <Field label="Standard rate (₹ per base unit)" name="standardRate" error={error}><input inputMode="decimal" value={v.standardRate} onChange={(e) => set({ standardRate: e.target.value })} data-testid="ni-rate" /></Field>
          <label className="check"><input type="checkbox" checked={v.stockTracked} onChange={(e) => set({ stockTracked: e.target.checked })} /> Kept in stock</label>
          <label className="check"><input type="checkbox" checked={v.batchTracked} disabled={!v.stockTracked} onChange={(e) => set({ batchTracked: e.target.checked })} /> Batch tracked</label>
          <label className="check"><input type="checkbox" checked={v.serialTracked} disabled={!v.stockTracked} onChange={(e) => set({ serialTracked: e.target.checked })} /> Serial numbers</label>
          {v.batchTracked && <Field label="Shelf life (days)" name="shelfLifeDays" error={error}><input inputMode="numeric" value={v.shelfLifeDays} onChange={(e) => set({ shelfLifeDays: e.target.value })} /></Field>}
          {v.stockTracked && <><Field label="Reorder level" name="reorderLevel" error={error}><input inputMode="decimal" value={v.reorderLevel} onChange={(e) => set({ reorderLevel: e.target.value })} /></Field><Field label="Reorder quantity" name="reorderQuantity" error={error}><input inputMode="decimal" value={v.reorderQuantity} onChange={(e) => set({ reorderQuantity: e.target.value })} /></Field></>}
          <Field label="Preferred brands (comma separated)" name="preferredBrands" error={error}><input value={v.preferredBrands} onChange={(e) => set({ preferredBrands: e.target.value })} /></Field>
        </fieldset>
      )}
      {step === 3 && (
        <div data-testid="ni-review">
          <dl className="kv-list"><div className="kv"><dt>Category</dt><dd>{cat.name}</dd></div><div className="kv"><dt>Type</dt><dd>{cats.data.types.find((t) => t.code === v.itemType)?.label}</dd></div><div className="kv"><dt>Name</dt><dd>{v.name}</dd></div>
            <div className="kv"><dt>Specification</dt><dd>{Object.entries(v.spec).filter(([, x]) => x).map(([k, x]) => `${cat.attributes.find((a) => a.key === k)?.label ?? k}: ${x}`).join(' · ') || '—'}</dd></div><div className="kv"><dt>Units</dt><dd>{v.baseUom}{v.uoms.filter((u) => u.uom).map((u) => `, 1 ${u.uom} = ${u.factorToBase} ${v.baseUom}`).join('')}</dd></div></dl>
          {check?.duplicates?.length ? <div className="mdm-check" role="status" data-testid="ni-duplicates"><p><strong>This looks like:</strong></p><ul>{check.duplicates.map((d) => <li key={d.id}><a href={`/admin/items/item?id=${d.id}`} onClick={(e) => { e.preventDefault(); navigateTo(`/admin/items/item?id=${d.id}`); }}>{d.code} {d.name}</a> · {d.rule}</li>)}</ul><label className="check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="ni-ack" /> I checked: this is a different item</label></div> : <p className="muted" data-testid="ni-no-duplicates">No item of this category has the same specification.</p>}
          <Field label="Why is this item needed?" name="justification" error={error}><textarea rows="2" value={v.justification} maxLength={500} onChange={(e) => set({ justification: e.target.value })} data-testid="ni-why" /></Field>
        </div>
      )}
      <div className="actions">
        <button type="button" className="btn" onClick={() => { if (window.confirm('Throw this draft away?')) { setV(blank(null)); setStep(0); try { localStorage.removeItem(DRAFT_KEY); } catch { /* storage off */ } } }}>Cancel</button>
        {step > 0 && <button type="button" className="btn" onClick={() => setStep(step - 1)}>Back</button>}
        {step < 3 ? <button type="button" className="btn btn-primary" onClick={next} data-testid="ni-next">Next</button> : <button type="button" className="btn btn-primary" disabled={busy || (check?.duplicates?.length > 0 && !ack)} onClick={send} data-testid="ni-send">{busy ? 'Sending...' : 'Send for approval'}</button>}
      </div>
    </section>
  );
}
