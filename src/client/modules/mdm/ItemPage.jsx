import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DiscussionTab, TimelineTab } from '../../platform/collab/CollabTabs.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDate, formatDateTime } from '../../platform/format.js';
import ItemSelector from '../../platform/items/ItemSelector.jsx';
import { api } from '../../platform/api/index.js';
import { AttachmentList, FileUploader } from '../core/components/Attachments.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { ITEM_STATUS, items, mdm } from './api.js';

// Item (Administration, part 06.03): the object page of one item. The header: code and version, status, type, category, base unit, rates where the person may see them, and the actions their role allows on
// this status (change, new version, out of use). Tabs: Details · Units · Specification · Bill of resources (work items and composites) · Makes and alternates · Documents · Usage (where used) · Price history
// · Approvals · Timeline · Discussion. A steward of the category changes the item; everyone reads it.
const TABS = [['details', 'Details'], ['uoms', 'Units'], ['spec', 'Specification'], ['resources', 'Bill of resources'], ['makes', 'Makes and alternates'], ['documents', 'Documents'], ['usage', 'Usage'], ['prices', 'Price history'], ['approvals', 'Approvals'], ['timeline', 'Timeline'], ['discussion', 'Discussion']];
const idFromUrl = () => Number(new URLSearchParams(window.location.search).get('id')) || null;
export default function ItemPage() {
  const id = idFromUrl();
  const q = useQuery({ queryKey: ['mdm', 'item', id], queryFn: () => items.get(id), enabled: Boolean(id), retry: false });
  usePageTitle(q.data ? `${q.data.code} ${q.data.name}` : 'Item');
  const [tab, setTab] = useState(() => new URLSearchParams(window.location.search).get('tab') ?? 'details');
  if (!id) return <ErrorState title="No item chosen" error={{ message: 'Open an item from the Item Master.' }} />;
  if (q.error?.status === 403) return <NoPermission what="the item catalogue" permission="mdm.record.view" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (q.isPending) return <Skeleton label="Loading the item" rows={6} />;
  const r = q.data;
  const tabs = TABS.filter(([k]) => k !== 'resources' || r.hasResources);
  const onKey = (e) => { const i = tabs.findIndex(([k]) => k === tab); const n = e.key === 'ArrowRight' ? tabs[(i + 1) % tabs.length] : e.key === 'ArrowLeft' ? tabs[(i - 1 + tabs.length) % tabs.length] : null; if (n) { e.preventDefault(); setTab(n[0]); document.getElementById(`it-tab-${n[0]}`)?.focus(); } };
  const sent = new URLSearchParams(window.location.search).get('sent');
  return (
    <section aria-labelledby="it-title" data-testid="item-page">
      <p><Link to="/admin/items">← Item Master</Link></p>
      {sent && r.status === 'SUBMITTED' && <p className="mdm-banner" role="status" data-testid="it-sent">Sent: the steward of {r.category?.name} ({r.category?.stewardRole}) approves it. It can be chosen once approved.</p>}
      <header className="op-header">
        <div className="page-head"><h1 id="it-title">{r.code}{r.versionNo > 1 ? ` v${r.versionNo}` : ''} · {r.name}</h1><StatusBadge status={ITEM_STATUS[r.status][0]} label={ITEM_STATUS[r.status][1]} /></div>
        <dl className="op-figures">
          <div><dt>Type</dt><dd>{r.typeLabel}</dd></div><div><dt>Category</dt><dd>{r.category?.name}</dd></div><div><dt>Base unit</dt><dd data-testid="it-uom">{r.baseUom}</dd></div><div><dt>HSN/SAC · GST</dt><dd>{r.hsnSac ?? '—'} · {r.gstRate ?? '—'}</dd></div>
          {!r.ratesMasked && <div><dt>Standard rate</dt><dd className="num" data-testid="it-rate">₹{r.standardRate ?? '0'}</dd></div>}
          {!r.ratesMasked && <div><dt>Last purchase rate</dt><dd className="num">{r.lastPurchaseRate ? `₹${r.lastPurchaseRate}` : 'none yet (from procurement)'}</dd></div>}
          {r.hasResources && r.resourceCost != null && <div><dt>Resources per {r.baseUom}</dt><dd className="num" data-testid="it-cost">₹{r.resourceCost}</dd></div>}
          <div><dt>Applies</dt><dd>{formatDate(r.effectiveFrom)}{r.effectiveTo ? ` to ${formatDate(r.effectiveTo)}` : ' onwards'}</dd></div>
        </dl>
        <Actions r={r} />
      </header>
      <div role="tablist" aria-label="Item sections" className="op-tabs" onKeyDown={onKey}>
        {tabs.map(([k, l]) => <button key={k} type="button" role="tab" id={`it-tab-${k}`} aria-selected={tab === k} aria-controls={`it-panel-${k}`} tabIndex={tab === k ? 0 : -1} className={`op-tab${tab === k ? ' is-active' : ''}`} onClick={() => setTab(k)} data-testid={`it-tab-${k}`}>{l}</button>)}
      </div>
      <div role="tabpanel" id={`it-panel-${tab}`} aria-labelledby={`it-tab-${tab}`} className="op-panel" tabIndex={0}>
        {tab === 'details' && <Details r={r} />}
        {tab === 'uoms' && <Uoms r={r} />}
        {tab === 'spec' && <dl className="kv-list" data-testid="it-spec">{r.attributes.map((a) => <div className="kv" key={a.key}><dt>{a.label}{a.unit ? ` (${a.unit})` : ''}</dt><dd>{r.spec[a.key] ?? '—'}</dd></div>)}{Object.keys(r.spec).filter((k) => !r.attributes.some((a) => a.key === k)).map((k) => <div className="kv" key={k}><dt>{k}</dt><dd>{r.spec[k]}</dd></div>)}</dl>}
        {tab === 'resources' && <Resources r={r} />}
        {tab === 'makes' && <Makes r={r} />}
        {tab === 'documents' && <div data-testid="it-docs"><AttachmentList entity="mdm_item" entityId={r.id} canEdit={r.canEdit} />{r.canEdit && <FileUploader entity="mdm_item" entityId={r.id} />}</div>}
        {tab === 'usage' && (r.whereUsed.length === 0 ? <p className="muted">Not used yet.</p> : <ul className="mdm-list" data-testid="it-usage">{r.whereUsed.map((u, i) => <li key={i}>{u.source}: {u.route ? <Link to={u.route}>{u.label}</Link> : u.label}{u.transaction ? <span className="muted small"> · transaction</span> : null}</li>)}</ul>)}
        {tab === 'prices' && (r.ratesMasked ? <p className="muted">Rates are not shown for your role.</p> : r.priceHistory.length === 0 ? <p className="muted">No rate change yet.</p> : <div className="table-wrap" tabIndex={0} role="region" aria-label="Price history"><table className="grid"><thead><tr><th>When</th><th>By</th><th className="num">Before (₹)</th><th className="num">Rate (₹)</th></tr></thead><tbody>{r.priceHistory.map((p, i) => <tr key={i} data-testid="it-price"><td data-label="When">{formatDateTime(p.at)}</td><td data-label="By">{p.by}</td><td className="num" data-label="Before">{p.before ?? '—'}</td><td className="num" data-label="Rate">{p.rate}</td></tr>)}</tbody></table></div>)}
        {tab === 'approvals' && <Approvals r={r} />}
        {tab === 'timeline' && <TimelineTab entity="mdm_item" id={r.id} />}
        {tab === 'discussion' && <DiscussionTab entity="mdm_item" id={r.id} />}
      </div>
    </section>
  );
}

function Actions({ r }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({});
  const refresh = () => qc.invalidateQueries({ queryKey: ['mdm'] });
  const run = async (fn) => { setError(null); try { await fn(); setMode(null); refresh(); } catch (e) { setError(errorInfo(e)); } };
  if (!r.canEdit) return r.versions.length > 1 ? <p className="muted small">Versions: {r.versions.map((v) => <a key={v.id} href={`?id=${v.id}`} onClick={(e) => { e.preventDefault(); navigateTo(`/admin/items/item?id=${v.id}`); window.location.reload(); }}>v{v.versionNo} ({v.status.toLowerCase()}) </a>)}</p> : null;
  return (
    <div className="actions-row" data-testid="it-actions">
      <button type="button" className="btn btn-primary" onClick={() => { setForm({ name: r.name, description: r.description ?? '', standardRate: r.standardRate ?? '', reason: '' }); setMode('edit'); }} data-testid="it-edit">Change</button>
      <button type="button" className="btn" onClick={() => { setForm({ baseUom: r.baseUom, effectiveFrom: '', justification: '' }); setMode('version'); }} data-testid="it-version">New version</button>
      <button type="button" className="btn" onClick={() => { setForm({ reason: '' }); setMode('status'); }} data-testid="it-status">{r.status === 'ACTIVE' ? 'Out of use' : 'Back in use'}</button>
      {mode === 'edit' && <form className="mdm-panel" onSubmit={(e) => { e.preventDefault(); run(() => items.update(r.id, { name: form.name, description: form.description || null, standardRate: form.standardRate || undefined, version: r.rowVersion, reason: form.reason || undefined })); }}>
        <Field label="Name" name="name" error={error}><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="it-edit-name" /></Field>
        <Field label="Description" name="description" error={error}><textarea rows="2" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        {!r.ratesMasked && <Field label="Standard rate (₹)" name="standardRate" error={error}><input inputMode="decimal" value={form.standardRate} onChange={(e) => setForm({ ...form, standardRate: e.target.value })} data-testid="it-edit-rate" /></Field>}
        <Field label="Reason" name="reason" error={error}><input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
        {error?.form && <p className="field-error" role="alert">{error.form}</p>}
        <div className="actions"><button type="button" className="btn" onClick={() => setMode(null)}>Cancel</button><button type="submit" className="btn btn-primary" data-testid="it-edit-save">Save</button></div></form>}
      {mode === 'version' && <form className="mdm-panel" onSubmit={(e) => { e.preventDefault(); run(() => items.newVersion(r.id, { baseUom: form.baseUom, effectiveFrom: form.effectiveFrom, justification: form.justification })); }}>
        <p className="muted small">{r.usedInTransactions ? `${r.code} is used in ${r.usedInTransactions} transaction(s): a change of its base unit is a new version (BR-01).` : 'A new version from a date, approved like a new item.'}</p>
        <Field label="Base unit" name="baseUom" error={error}><input value={form.baseUom} onChange={(e) => setForm({ ...form, baseUom: e.target.value.toUpperCase() })} data-testid="it-v-uom" /></Field>
        <Field label="Applies from" name="effectiveFrom" error={error}><input type="date" required value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} /></Field>
        <Field label="Why (required)" name="justification" error={error}><textarea rows="2" required minLength={10} value={form.justification} onChange={(e) => setForm({ ...form, justification: e.target.value })} /></Field>
        {error?.form && <p className="field-error" role="alert">{error.form}</p>}
        <div className="actions"><button type="button" className="btn" onClick={() => setMode(null)}>Cancel</button><button type="submit" className="btn btn-primary">Send for approval</button></div></form>}
      {mode === 'status' && <form className="mdm-panel" onSubmit={(e) => { e.preventDefault(); run(() => items.setStatus(r.id, { status: r.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE', reason: form.reason, version: r.rowVersion })); }}>
        <Field label="Reason (required)" name="reason" error={error}><input required minLength={5} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
        {error?.form && <p className="field-error" role="alert">{error.form}</p>}
        <div className="actions"><button type="button" className="btn" onClick={() => setMode(null)}>Cancel</button><button type="submit" className="btn btn-primary">Confirm</button></div></form>}
    </div>
  );
}

function Details({ r }) {
  return (
    <dl className="kv-list" data-testid="it-details">
      {[['Code', `${r.code}${r.versionNo > 1 ? ` (version ${r.versionNo})` : ''}`], ['Name', r.name], ['Name (Hindi)', r.nameHi], ['Description', r.description], ['Type', r.typeLabel], ['Category', r.category?.name], ['Stock tracked', r.stockTracked ? 'Yes' : 'No'], ['Batch tracked', r.batchTracked ? 'Yes' : 'No'], ['Serial numbers', r.serialTracked ? 'Yes' : 'No'], ['Shelf life', r.shelfLifeDays ? `${r.shelfLifeDays} days` : null], ['Reorder level', r.stockTracked ? `${r.reorderLevel} ${r.baseUom}` : null], ['Reorder quantity', r.stockTracked ? `${r.reorderQuantity} ${r.baseUom}` : null], ['Preferred brands', r.preferredBrands.join(', ')], ['Migrated from', r.legacyCode], ['Requested by', r.requestedBy]]
        .map(([k, v]) => <div className="kv" key={k}><dt>{k}</dt><dd>{v || '—'}</dd></div>)}
      {r.versions.length > 1 && <div className="kv"><dt>Versions</dt><dd>{r.versions.map((v) => <span key={v.id}><Link to={`/admin/items/item?id=${v.id}`}>v{v.versionNo}</Link> {v.status.toLowerCase()} from {formatDate(v.effectiveFrom)} ({v.baseUom}); </span>)}</dd></div>}
    </dl>
  );
}

function Uoms({ r }) {
  const qc = useQueryClient();
  const units = useQuery({ queryKey: ['mdm', 'common', 'uom', 'all'], queryFn: () => mdm.common('uom', { limit: 200, offset: 0 }), retry: false, staleTime: 300_000 });
  const [rows, setRows] = useState(r.uoms.map((u) => ({ uom: u.uom, factorToBase: u.factorToBase })));
  const [conv, setConv] = useState({ quantity: '1', from: r.uoms[0]?.uom ?? r.baseUom, to: r.baseUom, result: null });
  const [error, setError] = useState(null);
  const save = async () => { setError(null); try { await items.saveUoms(r.id, { uoms: rows.filter((x) => x.uom), version: r.rowVersion }); qc.invalidateQueries({ queryKey: ['mdm', 'item', r.id] }); } catch (e) { setError(errorInfo(e)); } };
  const test = async () => { setError(null); try { const o = await items.convert(r.id, { quantity: conv.quantity, from: conv.from, to: conv.to }); setConv({ ...conv, result: o.result }); } catch (e) { setError(errorInfo(e)); } };
  return (
    <div data-testid="it-uoms">
      <p>Base unit: <strong>{r.baseUom}</strong>. Item units are written into the calculation engine, so every module converts this item the same way.</p>
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Units"><table className="grid"><thead><tr><th>Unit</th><th>1 unit = … {r.baseUom}</th>{r.canEdit && <th><span className="sr-only">Remove</span></th>}</tr></thead>
        <tbody>{rows.map((u, i) => <tr key={i} data-testid="it-uom-row"><td data-label="Unit">{r.canEdit ? <select aria-label="Unit" value={u.uom} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, uom: e.target.value } : x)))}><option value="">Choose</option>{(units.data?.rows ?? []).map((x) => <option key={x.id} value={x.code}>{x.code}</option>)}</select> : u.uom}</td>
          <td data-label="Factor">{r.canEdit ? <input aria-label={`Factor of ${u.uom}`} inputMode="decimal" value={u.factorToBase} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, factorToBase: e.target.value } : x)))} /> : u.factorToBase}</td>{r.canEdit && <td><button type="button" className="btn btn-small" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button></td>}</tr>)}</tbody></table></div>
      {r.canEdit && <div className="actions-row"><button type="button" className="btn btn-small" onClick={() => setRows([...rows, { uom: '', factorToBase: '' }])}>Add a unit</button><button type="button" className="btn btn-primary btn-small" onClick={save} data-testid="it-uom-save">Save units</button></div>}
      <div className="actions-row" aria-label="Try a conversion"><Field label="Quantity" name="q" error={null}><input inputMode="decimal" value={conv.quantity} onChange={(e) => setConv({ ...conv, quantity: e.target.value, result: null })} data-testid="it-conv-q" /></Field>
        <Field label="From" name="from" error={null}><input value={conv.from} onChange={(e) => setConv({ ...conv, from: e.target.value.toUpperCase(), result: null })} data-testid="it-conv-from" /></Field><Field label="To" name="to" error={null}><input value={conv.to} onChange={(e) => setConv({ ...conv, to: e.target.value.toUpperCase(), result: null })} data-testid="it-conv-to" /></Field>
        <button type="button" className="btn" onClick={test} data-testid="it-conv-go">Convert</button>{conv.result != null && <output data-testid="it-conv-result">{conv.quantity} {conv.from} = {conv.result} {conv.to}</output>}</div>
      {error?.form && <p className="field-error" role="alert">{error.form}</p>}
    </div>
  );
}

function Resources({ r }) {
  const qc = useQueryClient();
  const [rows, setRows] = useState(r.resources.map((x) => ({ componentId: x.componentId, code: x.code, name: x.name, typeLabel: x.typeLabel, quantity: x.quantity, uom: x.uom, uoms: [x.baseUom], wastagePct: x.wastagePct, rate: x.rate })));
  const [pick, setPick] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);
  const add = (list) => setRows([...rows, ...list.filter((it) => !rows.some((x) => x.componentId === it.id)).map((it) => ({ componentId: it.id, code: it.code, name: it.name, typeLabel: it.typeLabel, quantity: '', uom: it.uom, uoms: it.uoms, wastagePct: '0', rate: it.standardRate }))]);
  const save = async () => { setError(null); try { const o = await items.saveResources(r.id, { lines: rows.map((x) => ({ componentId: x.componentId, quantity: String(x.quantity), uom: x.uom, wastagePct: String(x.wastagePct || '0') })), version: r.rowVersion }); setSaved(o.resourceCost); qc.invalidateQueries({ queryKey: ['mdm', 'item', r.id] }); } catch (e) { setError(errorInfo(e)); } };
  return (
    <div data-testid="it-resources">
      <p className="muted">What one {r.baseUom} of {r.name} takes: materials, labour and equipment, with wastage. Used by rate analysis (06.06) and material take-off.</p>
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Bill of resources"><table className="grid"><thead><tr><th>Component</th><th>Type</th><th className="num">Quantity</th><th>Unit</th><th className="num">Wastage %</th>{!r.ratesMasked && <th className="num">Rate (₹)</th>}{r.canEdit && <th><span className="sr-only">Remove</span></th>}</tr></thead>
        <tbody>{rows.map((x, i) => <tr key={x.componentId} data-testid="it-res-row"><th scope="row" data-label="Component"><Link to={`/admin/items/item?id=${x.componentId}`}>{x.code}</Link> {x.name}</th><td data-label="Type">{x.typeLabel}</td>
          <td className="num" data-label="Quantity">{r.canEdit ? <input aria-label={`Quantity of ${x.code}`} inputMode="decimal" value={x.quantity} onChange={(e) => setRows(rows.map((y, j) => (j === i ? { ...y, quantity: e.target.value } : y)))} data-testid="it-res-qty" /> : x.quantity}</td>
          <td data-label="Unit">{r.canEdit && x.uoms?.length > 1 ? <select aria-label={`Unit of ${x.code}`} value={x.uom} onChange={(e) => setRows(rows.map((y, j) => (j === i ? { ...y, uom: e.target.value } : y)))}>{x.uoms.map((u) => <option key={u}>{u}</option>)}</select> : x.uom}</td>
          <td className="num" data-label="Wastage">{r.canEdit ? <input aria-label={`Wastage of ${x.code}`} inputMode="decimal" value={x.wastagePct} onChange={(e) => setRows(rows.map((y, j) => (j === i ? { ...y, wastagePct: e.target.value } : y)))} /> : x.wastagePct}</td>
          {!r.ratesMasked && <td className="num" data-label="Rate">{x.rate ?? '—'}</td>}{r.canEdit && <td><button type="button" className="btn btn-small" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button></td>}</tr>)}</tbody></table></div>
      {rows.length === 0 && <p className="muted">No component yet.</p>}
      {r.canEdit && <div className="actions-row"><button type="button" className="btn btn-small" onClick={() => setPick(true)} data-testid="it-res-add">Add components</button><button type="button" className="btn btn-primary btn-small" onClick={save} data-testid="it-res-save">Save the bill of resources</button></div>}
      {saved != null && <p role="status" data-testid="it-res-saved">Saved. Resources per {r.baseUom}: ₹{saved}</p>}
      {error && <p className="field-error" role="alert" data-testid="it-res-error">{error.form}{Object.values(error.fields ?? {}).length ? `: ${Object.values(error.fields).join('; ')}` : ''}</p>}
      <ItemSelector open={pick} onClose={() => setPick(false)} onPick={add} title="Choose components" />
    </div>
  );
}

function Makes({ r }) {
  const qc = useQueryClient();
  const [make, setMake] = useState({ make: '', model: '' });
  const [pick, setPick] = useState(false);
  const [error, setError] = useState(null);
  const run = async (fn) => { setError(null); try { await fn(); qc.invalidateQueries({ queryKey: ['mdm', 'item', r.id] }); } catch (e) { setError(errorInfo(e)); } };
  return (
    <div data-testid="it-makes">
      <h3>Makes</h3>
      {r.makes.length === 0 ? <p className="muted">No make listed.</p> : <ul className="mdm-list">{r.makes.map((m) => <li key={m.id} data-testid="it-make">{m.make}{m.model ? ` ${m.model}` : ''} · {m.approved ? <strong>approved by {m.approvedBy}</strong> : <span className="muted">proposed by {m.addedBy}</span>}
        {r.canEdit && !m.approved && <> <button type="button" className="btn btn-small" onClick={() => run(() => items.decideMake(r.id, m.id, { approved: true }))} data-testid="it-make-approve">Approve</button> <button type="button" className="btn btn-small" onClick={() => run(() => items.decideMake(r.id, m.id, { approved: false }))}>Remove</button></>}</li>)}</ul>}
      {r.canEdit && <form className="actions-row" onSubmit={(e) => { e.preventDefault(); run(() => items.addMake(r.id, { make: make.make, model: make.model || null })).then(() => setMake({ make: '', model: '' })); }}><Field label="Make" name="make" error={error}><input required value={make.make} onChange={(e) => setMake({ ...make, make: e.target.value })} data-testid="it-make-name" /></Field><Field label="Model" name="model" error={null}><input value={make.model} onChange={(e) => setMake({ ...make, model: e.target.value })} /></Field><button type="submit" className="btn btn-small" data-testid="it-make-add">Propose a make</button></form>}
      <h3>Alternate items</h3>
      {r.alternates.length === 0 ? <p className="muted">No alternate.</p> : <ul className="mdm-list">{r.alternates.map((a) => <li key={a.id}><Link to={`/admin/items/item?id=${a.id}`}>{a.code}</Link> {a.name}{r.canEdit && <> <button type="button" className="btn btn-small" onClick={() => run(() => items.alternate(r.id, { alternateId: a.id, on: false }))}>Remove</button></>}</li>)}</ul>}
      {r.canEdit && <button type="button" className="btn btn-small" onClick={() => setPick(true)}>Add an alternate</button>}
      {error?.form && <p className="field-error" role="alert">{error.form}</p>}
      <ItemSelector open={pick} onClose={() => setPick(false)} onPick={(list) => list.forEach((it) => run(() => items.alternate(r.id, { alternateId: it.id })))} title="Choose alternates" />
    </div>
  );
}

function Approvals({ r }) {
  const inst = useQuery({ queryKey: ['workflow', 'instance', r.instanceId], queryFn: async () => (await api.get(`/workflow/instances/${r.instanceId}`)).data, enabled: Boolean(r.instanceId), retry: false });
  if (!r.instanceId) return <p className="muted">No approval: the item was created before approvals existed.</p>;
  if (inst.isPending) return <Skeleton label="Loading the approval" rows={2} />;
  if (inst.isError) return <ErrorState error={inst.error} onRetry={inst.refetch} />;
  const i = inst.data;
  const events = i.history ?? i.events ?? [];
  return (
    <div data-testid="it-approvals">
      <p>Approval {i.status?.toLowerCase()} · requested by {r.requestedBy}{i.submittedAt ? ` on ${formatDateTime(i.submittedAt)}` : ''}.</p>
      {events.length > 0 && <ol className="mdm-list">{events.map((e, k) => <li key={k}>{formatDateTime(e.at ?? e.createdAt)} · {String(e.event ?? e.action ?? '').toLowerCase().replace(/_/g, ' ')} · {e.actor ?? e.by ?? ''}{e.comment ? `: ${e.comment}` : ''}</li>)}</ol>}
      {r.status === 'SUBMITTED' && <p><Link to="/approvals">Open My Approvals</Link> to decide, if it waits for you.</p>}
    </div>
  );
}
