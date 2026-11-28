import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { formatDate, formatDateTime } from '../../platform/format.js';
import ItemSelector from '../../platform/items/ItemSelector.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { ADDON_LABELS, ANALYSIS_STATUS, COMPONENTS, SCOPE_LABEL, rates, todayIST } from './api.js';
import { inr } from './RateAnalysesPage.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { useFlagOn } from '../../platform/shell/api.js';
import { useT } from '../../platform/i18n/index.js';
import { useCalcTraces } from '../core/api/index.js';
import { TraceView } from '../core/components/TraceView.jsx';

// Rate Analysis (object page, part 06.06, FR-03 to FR-06): one version of the analysed unit rate of a work item. The component grid (kind, item or typed description, unit, quantity per basis, wastage %,
// rate from the library or typed, amount), the add-ons (water and electricity, overhead, profit, contingency, insurance, escalation, GST added or not) and the unit rate, the comparison with its schedule of
// rates item (above or below, %), the versions with a side-by-side comparison, and the history. A draft or a returned analysis is changed and saved (the server prices it through the calculation engine:
// nothing is calculated in the browser), recalculated from the library, submitted; a released version is locked and amended into a new version (BR-02). New: from a template or a work item's bill of
// resources (?new=1&template=CONCRETE_M25).
const TABS = [['components', 'Components'], ['sor', 'Schedule of rates'], ['versions', 'Versions'], ['history', 'History']];
const blankAddons = { water: '0', overhead: '0', profit: '0', contingency: '0', insurance: '0', escalation: '0', gst: '0' };
const toDraft = (a) => ({ workItem: a.workItem, title: a.title, scope: a.scope, projectId: a.projectId ?? '', region: a.region ?? '', basisQty: a.basisQty, basisUom: a.basisUom, gstTreatment: a.gstTreatment, addons: { ...blankAddons, ...a.addons }, sorItemId: a.sor?.item.id ?? '', effectiveFrom: a.effectiveFrom, templateCode: a.templateCode ?? undefined, lines: a.lines.map((l) => ({ itemId: l.itemId, itemCode: l.itemCode, type: l.type, description: l.description, uom: l.uom, qty: l.qty, wastagePct: l.wastagePct, rate: l.rate, priceOrigin: l.priceOrigin })) });
const bodyOf = (dr) => ({ workItemId: dr.workItem?.id ?? 0, title: dr.title || undefined, scope: dr.scope, projectId: dr.scope === 'STANDARD' ? null : Number(dr.projectId) || null, region: dr.region || null, basisQty: dr.basisQty, basisUom: dr.basisUom || undefined, gstTreatment: dr.gstTreatment, addons: dr.addons, sorItemId: Number(dr.sorItemId) || null, effectiveFrom: dr.effectiveFrom, ...(dr.templateCode ? { templateCode: dr.templateCode } : {}),
  lines: dr.lines.map((l) => ({ ...(l.itemId ? { itemId: l.itemId } : {}), type: l.type, description: l.description || undefined, uom: l.uom, qty: l.qty || '0', wastagePct: l.wastagePct || '0', ...(l.priceOrigin === 'LIBRARY' && l.itemId ? {} : { rate: l.rate === '' || l.rate == null ? null : l.rate }) })) });

export default function RateAnalysisPage() {
  const params = new URLSearchParams(window.location.search);
  const id = Number(params.get('id'));
  const isNew = params.get('new') === '1';
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['mdm', 'rates', 'analysis', id], queryFn: () => rates.analysis(id), enabled: id > 0, retry: false });
  usePageTitle(q.data ? `${q.data.ref} ${q.data.title}` : isNew ? 'New Rate Analysis' : 'Rate Analysis');
  const [tab, setTab] = useState('components');
  // PACK-19 (ff.est.pack19): the calculation traces stored when the analysis was priced, step by step
  const te = useT('est'); const pack19 = useFlagOn('ff.est.pack19'); const traces = useCalcTraces('ra_analysis', id, pack19 && tab === 'calc' && id > 0);
  const tabs = pack19 ? [...TABS.slice(0, 1), ['calc', te('ra.calc.tab')], ...TABS.slice(1)] : TABS;
  const [draft, setDraft] = useState(null);
  const [pick, setPick] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [cmpWith, setCmpWith] = useState(null);
  const cmp = useQuery({ queryKey: ['mdm', 'rates', 'compare', id, cmpWith], queryFn: () => rates.compare(cmpWith, id), enabled: Boolean(cmpWith && id), retry: false });
  const hist = useQuery({ queryKey: ['mdm', 'rates', 'history', id], queryFn: () => rates.history(id), enabled: tab === 'history' && id > 0, retry: false });
  // a new analysis starts from a template (matched to the company's items and priced from the library) or blank until a work item is chosen
  useEffect(() => {
    if (!isNew || draft) return;
    const template = params.get('template');
    const base = { workItem: null, title: '', scope: 'STANDARD', projectId: '', region: '', basisQty: '1', basisUom: '', gstTreatment: 'EXCLUDED', addons: { ...blankAddons, water: '1', overhead: '7.5', profit: '7.5' }, sorItemId: '', effectiveFrom: todayIST(), lines: [] };
    if (!template) { setDraft(base); return; }
    rates.start({ templateCode: template, effectiveFrom: base.effectiveFrom }).then((s) => setDraft({ ...base, title: s.title, basisQty: s.basisQty, basisUom: s.basisUom, addons: { ...blankAddons, ...s.addons }, templateCode: s.templateCode, lines: s.lines.map((l) => ({ ...l, rate: l.rate ?? '' })) })).catch((err) => { setError(errorInfo(err)); setDraft(base); });
  }, [isNew]);
  if (!isNew && !(id > 0)) return <EmptyState title="No analysis chosen" message="Open an analysis from the register." />;
  if (q.error?.status === 403) return <NoPermission what="the rate analyses" permission="mdm.analyse.view" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (!isNew && q.isPending) return <Skeleton label="Loading the analysis" rows={6} />;
  if (isNew && !draft) return <Skeleton label="Starting the analysis" rows={6} />;
  const a = q.data ?? null;
  const editing = Boolean(draft);
  const set = (p) => setDraft((cur) => ({ ...cur, ...p }));
  const setLine = (i, p) => set({ lines: draft.lines.map((l, j) => (j === i ? { ...l, ...p } : l)) });
  const fieldErr = (k) => error?.fields?.[k];
  const done = (out, msg) => { setNote(msg); setDraft(null); setError(null); qc.invalidateQueries({ queryKey: ['mdm', 'rates'] }); if (out?.id && out.id !== id) navigateTo(`/admin/rate-analyses/analysis?id=${out.id}`); };
  const go = async (fn, msg) => { setBusy(true); setError(null); try { const out = await fn(); done(out, typeof msg === 'function' ? msg(out) : msg); } catch (err) { setError(errorInfo(err)); } finally { setBusy(false); } };
  const save = (e) => { e.preventDefault(); go(() => (a ? rates.update(a.id, { ...bodyOf(draft), version: a.rowVersion }) : rates.create(bodyOf(draft))), (out) => `Saved ${out.ref}: ${inr(out.unitRate)} per ${out.basisUom}.`); };
  const fromWorkItem = async (wi) => {
    setPick(null);
    if (!wi) return;
    try { const s = await rates.start({ workItemId: wi.id, region: draft.region || null, effectiveFrom: draft.effectiveFrom }); set({ workItem: { id: wi.id, code: wi.code, name: wi.name, uom: wi.uom }, title: draft.title || s.title, basisUom: draft.basisUom || s.basisUom, lines: draft.lines.length ? draft.lines : s.lines.map((l) => ({ ...l, rate: l.rate ?? '' })) }); } catch (err) { setError(errorInfo(err)); }
  };
  const addComponents = (list) => { setPick(null); set({ lines: [...draft.lines, ...list.map((it) => ({ itemId: it.id, itemCode: it.code, type: { LABOUR: 'LABOUR', EQUIPMENT: 'EQUIPMENT', SUBCONTRACT: 'SUBCONTRACT', SERVICE: 'TRANSPORT' }[it.type] ?? 'MATERIAL', description: it.name, uom: it.uom, qty: '', wastagePct: '0', rate: '', priceOrigin: 'LIBRARY' }))] }); };

  if (editing) {
    return (
      <section aria-labelledby="rad-title" data-testid="rate-analysis-edit" className="fin-page">
        <p className="small"><Link to="/admin/rate-analyses">Rate analyses</Link></p>
        <PageHeader id="rad-title" title={a ? `Change ${a.ref}` : 'New rate analysis'} />
        <form onSubmit={save} aria-label="Rate analysis" data-testid="rad-form">
          <div className="mdm-fields">
            <Field label="Work item (required)" name="workItemId" error={error}><button type="button" className="btn btn-small" disabled={Boolean(a && a.versionNo > 1)} onClick={() => setPick('work')} data-testid="rad-work">{draft.workItem ? `${draft.workItem.code} ${draft.workItem.name}` : 'Choose the work item'}</button></Field>
            <Field label="Title" name="title" error={error}><input value={draft.title} onChange={(e) => set({ title: e.target.value })} data-testid="rad-title-in" /></Field>
            <Field label="Scope" name="scope" error={error}><select value={draft.scope} onChange={(e) => set({ scope: e.target.value })} data-testid="rad-scope">{Object.entries(SCOPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            {draft.scope !== 'STANDARD' && <LookupField id="rad-project" label="Project (required)" lookup="iam/projects" value={draft.projectId} onChange={(v) => set({ projectId: v })} error={fieldErr('projectId')} />}
            <Field label="State (empty for every region)" name="region" error={error}><input value={draft.region} maxLength={3} onChange={(e) => set({ region: e.target.value.toUpperCase() })} data-testid="rad-region" /></Field>
            <Field label="Per (basis quantity, required)" name="basisQty" error={error}><input inputMode="decimal" value={draft.basisQty} onChange={(e) => set({ basisQty: e.target.value })} data-testid="rad-basis" /></Field>
            <Field label="Unit" name="basisUom" error={error}><input value={draft.basisUom} onChange={(e) => set({ basisUom: e.target.value.toUpperCase() })} /></Field>
            <Field label="From" name="effectiveFrom" error={error}><input type="date" value={draft.effectiveFrom} onChange={(e) => set({ effectiveFrom: e.target.value })} data-testid="rad-from" /></Field>
            <LookupField id="rad-sor" label="Schedule of rates item" lookup="mdm/sor-items" value={draft.sorItemId} onChange={(v) => set({ sorItemId: v })} error={fieldErr('sorItemId')} />
          </div>
          <h2>Components</h2>
          <p className="small muted">An item's rate comes from the resource rate library for the state and date unless you type one. The amounts are calculated by the server when you save.</p>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Components"><table className="grid ra-grid"><thead><tr><th>Kind</th><th>Component</th><th>Unit</th><th>Qty per basis</th><th>Wastage %</th><th>Rate (₹)</th><th><span className="sr-only">Remove</span></th></tr></thead>
            <tbody>{draft.lines.map((l, i) => (
              <tr key={i} data-testid="rad-line">
                <td data-label="Kind"><select aria-label="Kind" value={l.type} onChange={(e) => setLine(i, { type: e.target.value })}>{COMPONENTS.map(([k, x]) => <option key={k} value={k}>{x}</option>)}</select></td>
                <td data-label="Component">{l.itemId ? <span>{l.itemCode} {l.description}</span> : <input aria-label="Description" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />}{fieldErr(`lines.${i}.itemId`) && <div className="field-error">{fieldErr(`lines.${i}.itemId`)}</div>}</td>
                <td data-label="Unit"><input aria-label="Unit" value={l.uom} onChange={(e) => setLine(i, { uom: e.target.value.toUpperCase() })} size={5} />{fieldErr(`lines.${i}.uom`) && <div className="field-error">{fieldErr(`lines.${i}.uom`)}</div>}</td>
                <td data-label="Qty per basis"><input aria-label="Quantity per basis" inputMode="decimal" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} size={8} data-testid="rad-qty" />{fieldErr(`lines.${i}.qty`) && <div className="field-error">{fieldErr(`lines.${i}.qty`)}</div>}</td>
                <td data-label="Wastage %"><input aria-label="Wastage %" inputMode="decimal" value={l.wastagePct} onChange={(e) => setLine(i, { wastagePct: e.target.value })} size={5} /></td>
                <td data-label="Rate (₹)"><input aria-label="Rate" inputMode="decimal" value={l.rate ?? ''} placeholder={l.itemId ? 'library' : ''} onChange={(e) => setLine(i, { rate: e.target.value, priceOrigin: e.target.value === '' && l.itemId ? 'LIBRARY' : 'MANUAL' })} size={9} data-testid="rad-rate" />{l.itemId && <div className="muted small">{l.priceOrigin === 'LIBRARY' ? 'from the library' : 'typed'}</div>}{fieldErr(`lines.${i}.rate`) && <div className="field-error" data-testid="rad-rate-error">{fieldErr(`lines.${i}.rate`)}</div>}</td>
                <td><button type="button" className="btn btn-small" onClick={() => set({ lines: draft.lines.filter((_, j) => j !== i) })}>Remove</button></td>
              </tr>))}</tbody></table></div>
          <div className="actions-row"><button type="button" className="btn btn-small" onClick={() => setPick('components')} data-testid="rad-add-item">Add items</button><button type="button" className="btn btn-small" onClick={() => set({ lines: [...draft.lines, { itemId: null, type: 'OTHER', description: '', uom: '', qty: '', wastagePct: '0', rate: '', priceOrigin: 'MANUAL' }] })} data-testid="rad-add-line">Add a typed line</button></div>
          {fieldErr('lines') && <p className="field-error">{fieldErr('lines')}</p>}
          <h2>Add-ons (%)</h2>
          <div className="mdm-fields">
            {ADDON_LABELS.map(([k, l]) => <Field key={k} label={l} name={`addons.${k}`} error={error}><input inputMode="decimal" value={draft.addons[k]} onChange={(e) => set({ addons: { ...draft.addons, [k]: e.target.value } })} data-testid={`rad-addon-${k}`} /></Field>)}
            <Field label="GST" name="gstTreatment" error={error}><select value={draft.gstTreatment} onChange={(e) => set({ gstTreatment: e.target.value })}><option value="EXCLUDED">Rate excludes GST</option><option value="ADDED">Add GST to the rate</option></select></Field>
            {draft.gstTreatment === 'ADDED' && <Field label="GST %" name="addons.gst" error={error}><input inputMode="decimal" value={draft.addons.gst} onChange={(e) => set({ addons: { ...draft.addons, gst: e.target.value } })} /></Field>}
          </div>
          {error?.form && <p className="field-error" role="alert" data-testid="rad-error">{error.form}</p>}
          <div className="actions"><button type="button" className="btn" onClick={() => (a ? setDraft(null) : navigateTo('/admin/rate-analyses'))}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy} data-testid="rad-save">Save and calculate</button></div>
        </form>
        {pick === 'work' && <ItemSelector open multiple={false} onClose={() => setPick(null)} onPick={(list) => fromWorkItem(list[0])} types={['WORK_ITEM', 'COMPOSITE', 'SUBCONTRACT']} title="Choose the work item" />}
        {pick === 'components' && <ItemSelector open onClose={() => setPick(null)} onPick={addComponents} types={['MATERIAL', 'CONSUMABLE', 'SPARE', 'TOOL', 'RETURNABLE', 'LABOUR', 'EQUIPMENT', 'SERVICE', 'SUBCONTRACT']} title="Choose components" />}
      </section>
    );
  }

  const st = ANALYSIS_STATUS[a.status];
  const b = a.breakdown ?? {};
  return (
    <section aria-labelledby="ra1-title" data-testid="rate-analysis" className="fin-page">
      <p className="small"><Link to="/admin/rate-analyses">Rate analyses</Link></p>
      <PageHeader id="ra1-title" title={<>{a.ref} {a.title}</>} status={<StatusBadge status={st[0]} label={st[1]} />} />
      <dl className="mdm-dl" data-testid="ra-head">
        <dt>Work item</dt><dd>{a.workItem?.code} {a.workItem?.name}</dd><dt>Scope</dt><dd>{a.scopeLabel}{a.project ? `: ${a.project.code} ${a.project.name}` : ''}</dd>
        <dt>State</dt><dd>{a.region ?? 'Every region'}</dd><dt>In force</dt><dd>{formatDate(a.effectiveFrom)}{a.effectiveTo ? ` to ${formatDate(a.effectiveTo)}` : ''}</dd>
        <dt>Unit rate</dt><dd><strong data-testid="ra-unit-rate">₹ {inr(a.unitRate)}</strong> per {a.basisUom}{a.gstTreatment === 'ADDED' ? ` (₹ ${inr(a.unitRateGross)} with GST)` : ''}</dd>
        {a.releasedBy && <><dt>Released</dt><dd>{a.releasedBy}, {formatDateTime(a.releasedAt)}</dd></>}
      </dl>
      {note && <p className="mdm-banner" role="status" data-testid="ra-note">{note}</p>}
      {['APPROVED', 'SUPERSEDED'].includes(a.status) && <p className="mdm-banner" data-testid="ra-locked">This version is released and locked{a.status === 'SUPERSEDED' ? ' (superseded by a later version)' : ''}. A change is a new version (amend).</p>}
      {a.openAmendmentId && a.openAmendmentId !== a.id && <p className="mdm-banner">An amendment is open: <Link to={`/admin/rate-analyses/analysis?id=${a.openAmendmentId}`}>open it</Link>.</p>}
      <div className="actions-row" data-testid="ra-actions">
        {a.can.edit && <button type="button" className="btn btn-small" onClick={() => { setError(null); setDraft(toDraft(a)); }} data-testid="ra-edit">Change</button>}
        {a.can.recalculate && <button type="button" className="btn btn-small" disabled={busy} onClick={() => go(() => rates.recalculate(a.id), (o) => `Recalculated from the library: ${inr(o.unitRate)} per ${o.basisUom}.`)} data-testid="ra-recalc">Recalculate from the library</button>}
        {a.can.submit && <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => go(() => rates.submit(a.id), (o) => `${o.ref} was sent for release (${{ STANDARD: 'the director', PROJECT: 'the project manager', VARIATION: 'the commercial manager' }[o.scope]}).`)} data-testid="ra-submit">Submit for release</button>}
        {a.can.withdraw && <button type="button" className="btn btn-small" disabled={busy} onClick={() => go(() => rates.withdraw(a.id, 'Withdrawn to change it'), 'Withdrawn: it is a draft again.')} data-testid="ra-withdraw">Withdraw</button>}
        {a.can.amend && <button type="button" className="btn btn-small" disabled={busy || !reason} onClick={() => go(() => rates.amend(a.id, { reason }), (o) => `Version ${o.versionNo} is a draft; change it and submit it.`)} data-testid="ra-amend">Amend (new version)</button>}
        {a.can.delete && <button type="button" className="btn btn-small" disabled={busy} onClick={async () => { try { await rates.remove(a.id, 'Draft no longer needed'); qc.invalidateQueries({ queryKey: ['mdm', 'rates'] }); navigateTo('/admin/rate-analyses'); } catch (err) { setError(errorInfo(err)); } }} data-testid="ra-delete">Delete draft</button>}
        {a.can.cancel && <button type="button" className="btn btn-small" disabled={busy || !reason} onClick={() => go(() => rates.cancel(a.id, reason), 'Cancelled.')}>Cancel</button>}
        {a.can.print && <button type="button" className="btn btn-small" onClick={async () => { try { const html = await rates.fetchText(`/mdm/analyses/${a.id}/print`); const w = window.open('', '_blank'); if (w) { w.document.write(html); w.document.close(); w.print(); } } catch (err) { setError(errorInfo(err)); } }} data-testid="ra-print">Print</button>}
      </div>
      {(a.can.amend || a.can.cancel) && <Field label="Reason (for amend or cancel)" name="reason" error={error}><input value={reason} onChange={(e) => setReason(e.target.value)} data-testid="ra-reason" /></Field>}
      {error?.form && <p className="field-error" role="alert" data-testid="ra-error">{error.form}</p>}
      <div className="seg" role="tablist" aria-label="Sections">{tabs.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`btn btn-small ${tab === k ? 'btn-primary' : ''}`} onClick={() => setTab(k)} data-testid={`ra-tab-${k}`}>{l}</button>)}</div>
      {tab === 'components' && (
        <div data-testid="ra-components">
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Components"><table className="grid"><thead><tr><th>#</th><th>Kind</th><th>Component</th><th>Unit</th><th className="num">Qty</th><th className="num">Wastage %</th><th className="num">Rate (₹)</th><th className="num">Amount (₹)</th></tr></thead>
            <tbody>{a.lines.map((l) => <tr key={l.id} data-testid="ra-line"><td data-label="#">{l.lineNo}</td><td data-label="Kind">{COMPONENTS.find(([k]) => k === l.type)?.[1]}</td><th scope="row" data-label="Component">{l.itemCode ? `${l.itemCode} ` : ''}{l.description}{l.priceOrigin === 'MANUAL' && l.itemId ? <div className="muted small">rate typed</div> : null}</th><td data-label="Unit">{l.uom}</td><td className="num" data-label="Qty">{l.qty}</td><td className="num" data-label="Wastage %">{l.wastagePct}</td><td className="num" data-label="Rate (₹)">{Number(l.rate).toLocaleString('en-IN', { maximumFractionDigits: 4 })}</td><td className="num" data-label="Amount (₹)">{inr(l.amount)}</td></tr>)}</tbody>
            <tfoot>
              <tr><th scope="row" colSpan={7}>Direct cost</th><td className="num" data-testid="ra-direct">{inr(a.directCost)}</td></tr>
              {ADDON_LABELS.filter(([k]) => Number(a.addons[k])).map(([k, l]) => <tr key={k}><td colSpan={7}>{l} @ {a.addons[k]}%</td><td className="num">{inr(b[k])}</td></tr>)}
              <tr><th scope="row" colSpan={7}>Total for {a.basisQty} {a.basisUom}</th><td className="num">{inr(b.total)}</td></tr>
              <tr><th scope="row" colSpan={7}>Unit rate per {a.basisUom}</th><td className="num"><strong>{inr(a.unitRate)}</strong></td></tr>
              {a.gstTreatment === 'ADDED' && <tr><td colSpan={7}>GST @ {a.addons.gst}% → with GST</td><td className="num">{inr(a.unitRateGross)}</td></tr>}
            </tfoot></table></div>
          <p className="muted small">By kind: {Object.entries(b.byType ?? {}).map(([k, v]) => `${COMPONENTS.find(([x]) => x === k)?.[1] ?? k} ₹ ${inr(v)}`).join(' · ')}. Calculated by the engine with ra.line_amount v{a.formulas['ra.line_amount']} and ra.unit_rate v{a.formulas['ra.unit_rate']}{a.calculatedAt ? `, ${formatDateTime(a.calculatedAt)}` : ''}.</p>
        </div>)}
      {tab === 'calc' && pack19 && (traces.isPending ? <Skeleton label={te('ra.calc.loading')} rows={3} /> : traces.isError ? <ErrorState error={traces.error} onRetry={traces.refetch} /> : (
        <div data-testid="ra-calc"><p className="muted">{te('ra.calc.intro')}</p>
          {(traces.data ?? []).length === 0 ? <EmptyState title={te('ra.calc.none')} message={te('ra.calc.noneHint')} /> : [...traces.data].sort((x, y) => (x.formula.code === 'ra.unit_rate' ? -1 : y.formula.code === 'ra.unit_rate' ? 1 : 0)).map((tr) => <section key={tr.formula.code} className="mdm-panel" data-testid="ra-calc-trace" data-code={tr.formula.code}><h3>{te(tr.formula.code === 'ra.unit_rate' ? 'ra.calc.unit' : 'ra.calc.line')}</h3><TraceView trace={tr} /><p className="muted small">{te('ra.calc.when', { when: formatDateTime(tr.computedAt), who: tr.computedBy ?? '—' })}</p></section>)}
        </div>))}
      {tab === 'sor' && (a.sor ? (
        <div data-testid="ra-sor"><dl className="mdm-dl"><dt>Schedule item</dt><dd>{a.sor.item.book} · {a.sor.item.itemCode} {a.sor.item.description}</dd><dt>Schedule rate</dt><dd>₹ {inr(a.sor.sorRate)} per {a.sor.item.uom ?? '—'}</dd><dt>Analysed rate</dt><dd>₹ {inr(a.sor.analysedRate)} per {a.basisUom}</dd>
          <dt>Difference</dt><dd data-testid="ra-sor-diff"><strong>{a.sor.percent}% {a.sor.position}</strong> (₹ {inr(a.sor.difference)})</dd></dl>{!a.sor.uomMatches && <p className="mdm-banner is-warning">The schedule item is per {a.sor.item.uom}, the analysis per {a.basisUom}: compare with care.</p>}</div>
      ) : <EmptyState title="Not linked to a schedule" message={a.can.edit ? 'Change the analysis and choose a schedule of rates item to compare its rate.' : 'This analysis has no schedule of rates item.'} />)}
      {tab === 'versions' && (
        <div data-testid="ra-versions">
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Versions"><table className="grid"><thead><tr><th>Version</th><th>Status</th><th className="num">Unit rate (₹)</th><th>From</th><th>To</th><th><span className="sr-only">Compare</span></th></tr></thead>
            <tbody>{a.versions.map((v) => <tr key={v.id} data-testid="ra-version"><th scope="row" data-label="Version">{v.id === a.id ? `v${v.versionNo} (this)` : <Link to={`/admin/rate-analyses/analysis?id=${v.id}`}>v{v.versionNo}</Link>}</th><td data-label="Status"><StatusBadge status={ANALYSIS_STATUS[v.status][0]} label={ANALYSIS_STATUS[v.status][1]} /></td><td className="num" data-label="Unit rate (₹)">{inr(v.unitRate)}</td><td data-label="From">{formatDate(v.effectiveFrom)}</td><td data-label="To">{v.effectiveTo ? formatDate(v.effectiveTo) : '—'}</td><td>{v.id !== a.id && <button type="button" className="btn btn-small" onClick={() => setCmpWith(v.id)} data-testid="ra-compare">Compare with this</button>}</td></tr>)}</tbody></table></div>
          {cmp.data && (
            <div data-testid="ra-compare-result"><h2>{cmp.data.from.ref} → {cmp.data.to.ref}: unit rate {Number(cmp.data.unitRateDelta) >= 0 ? '+' : ''}{inr(cmp.data.unitRateDelta)}</h2>
              <div className="table-wrap" tabIndex={0} role="region" aria-label="Differences"><table className="grid"><thead><tr><th>Component</th><th>Change</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Amount change (₹)</th></tr></thead>
                <tbody>{cmp.data.lines.filter((l) => l.change !== 'same').map((l, i) => <tr key={i}><th scope="row" data-label="Component">{l.description}</th><td data-label="Change">{l.change}</td><td className="num" data-label="Qty">{l.from?.qty ?? '—'} → {l.to?.qty ?? '—'}</td><td className="num" data-label="Rate">{l.from?.rate ?? '—'} → {l.to?.rate ?? '—'}</td><td className="num" data-label="Amount change (₹)">{inr(l.amountDelta)}</td></tr>)}
                  {cmp.data.header.filter((h) => h.changed).map((h) => <tr key={h.field}><th scope="row">{h.field}</th><td>changed</td><td colSpan={2} className="num">{h.from} → {h.to}</td><td /></tr>)}</tbody></table></div></div>)}
        </div>)}
      {tab === 'history' && (hist.isPending ? <Skeleton label="Loading the history" rows={3} /> : hist.isError ? <ErrorState error={hist.error} onRetry={hist.refetch} /> : (
        <ul className="mdm-list" data-testid="ra-history">{[...hist.data.audit.map((x) => ({ at: x.at, text: `${x.action} by ${x.by}${x.reason ? `: ${x.reason}` : ''}` })), ...hist.data.approvals.map((x) => ({ at: x.at, text: `${x.event.toLowerCase()} by ${x.actor}${x.comment ? `: ${x.comment}` : ''}` }))].sort((x, y) => (x.at < y.at ? 1 : -1)).map((x, i) => <li key={i}>{formatDateTime(x.at)} · {x.text}</li>)}</ul>))}
    </section>
  );
}
