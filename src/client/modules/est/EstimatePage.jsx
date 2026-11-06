import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { BASES, COMPONENT_TYPES, INDIRECTS, MODES, est, inr, preview, qty } from './api.js';
import { Tabs, useSearch } from './parts.jsx';

// Estimate (part 09.01): one version of an estimate as an object page. Items in BOQ sections, each priced from a released rate analysis, a manual build-up or a typed cost rate, with its markup (FR-02, FR-03);
// the indirect costs sheet (FR-04); the risks, contingency, escalation, HO overhead and GST (FR-05); cost against selling by section (FR-08); the resources (FR-06); the versions and their comparison (FR-07); approvals.
// Every figure is worked out on the server when the grid is saved; the selling rate shown while typing is a preview. Costs, markups and margins are shown only to those allowed to see them (BR-02).
const TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', APPROVED: 'APPROVED', RETURNED: 'RETURNED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED', SUPERSEDED: 'CANCELLED' };
const fromItem = (i) => ({ sectionCode: i.sectionCode, sectionName: i.sectionName ?? '', itemNo: i.itemNo, description: i.description, uom: i.uom, qty: i.qty ?? '0', clientRate: i.clientRate ?? '', workItemId: i.workItemId, mode: i.mode, analysisId: i.analysisId ?? '', costRate: i.mode === 'RATE' ? i.costRate ?? '' : '', markupPct: i.markupPct ?? '0', notes: i.notes ?? '', sellingRate: i.sellingRate, amount: i.amount, stale: i.stale,
  components: (i.components ?? []).map((c) => ({ type: c.type, itemId: c.itemId, description: c.description, uom: c.uom, qty: c.qty, rate: c.origin === 'LIBRARY' ? '' : c.rate ?? '', libraryRate: c.origin === 'LIBRARY' ? c.rate : null })) });
const blankItem = (section = '') => ({ sectionCode: section, sectionName: '', itemNo: '', description: '', uom: '', qty: '0', clientRate: '', workItemId: null, mode: 'RATE', analysisId: '', costRate: '', markupPct: '0', notes: '', components: [] });
const toBody = (r) => ({ sectionCode: r.sectionCode.trim(), sectionName: r.sectionName.trim() || null, itemNo: r.itemNo.trim(), description: r.description.trim(), uom: r.uom.trim(), qty: r.qty === '' ? '0' : String(r.qty), clientRate: r.clientRate === '' ? null : String(r.clientRate), workItemId: r.workItemId || null, mode: r.mode, analysisId: r.mode === 'ANALYSIS' && r.analysisId ? Number(r.analysisId) : null, costRate: r.mode === 'RATE' && r.costRate !== '' ? String(r.costRate) : null, markupPct: r.markupPct === '' ? '0' : String(r.markupPct), notes: r.notes.trim() || null,
  components: r.mode === 'MANUAL' ? r.components.map((c) => ({ type: c.type, itemId: c.itemId || null, description: c.description?.trim() || null, uom: c.uom?.trim() || null, qty: c.qty === '' ? '0' : String(c.qty), rate: c.rate === '' || c.rate == null ? null : String(c.rate) })) : [] });

export default function EstimatePage() {
  const t = useT('est');
  const qc = useQueryClient();
  const id = Number(useSearch().get('id')) || null;
  const q = useQuery({ queryKey: ['est', 'estimate', id], queryFn: () => est.get(id), enabled: Boolean(id), retry: false });
  const e = q.data;
  usePageTitle(e ? e.ref : t('obj.title'));
  const [tab, setTab] = useState('items'); const [error, setError] = useState(null); const [note, setNote] = useState(null);
  if (!id) return <ErrorState error={new Error(t('obj.noId'))} />;
  if (q.error?.status === 403) return <NoPermission what={t('list.title')} permission="est.estimate.view" />;
  if (q.isPending) return <Skeleton label={t('obj.title')} rows={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const run = async (fn, done) => { setError(null); setNote(null); try { const r = await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['est'] }); return r ?? true; } catch (x) { setError(errorInfo(x)); return null; } };
  const why = (fn, done) => { const r = window.prompt(t('act.why')); if (r) run(() => fn(r), done); };
  const go = (r) => { if (r?.id) navigateTo(`/est/estimate?id=${r.id}`, { force: true }); };
  const c = e.costsVisible; const tt = e.totals;
  const tabs = ['items', 'sections', ...(c ? ['indirects', 'risks'] : []), 'versions', 'approvals'];
  return (
    <section aria-labelledby="est-h" data-testid="estimate" data-status={e.status}>
      <header>
        <h1 id="est-h">{e.ref} <StatusBadge status={TONE[e.status]} label={e.statusLabel} /></h1>
        <p className="muted">{e.title} · {e.tender ? <Link to={`/bd/tender?id=${e.tender.id}`}>{e.tender.docNo}</Link> : e.project?.name} · {t('obj.basis', { date: e.basisDate })}{e.region ? ` · ${e.region}` : ''} · {e.currency}</p>
        <dl className="op-figures" data-testid="est-figures">
          <div><dt>{t('fig.selling')}</dt><dd data-testid="est-selling">{inr(tt.selling)}</dd></div>
          {c && <div><dt>{t('fig.cost')}</dt><dd data-testid="est-cost">{inr(tt.totalCost)}</dd></div>}
          {c && <div><dt>{t('fig.margin')}</dt><dd data-testid="est-margin" className={Number(tt.margin) < 0 ? 'field-error' : ''}>{inr(tt.margin)} ({tt.marginPct}%)</dd></div>}
          <div><dt>{t('fig.gst', { pct: e.gstPct })}</dt><dd>{inr(tt.gst)}</dd></div>
          <div><dt>{t('fig.bid')}</dt><dd data-testid="est-bid">{inr(tt.bidValue)}</dd></div>
        </dl>
        {!c && <p className="small muted" data-testid="est-masked">{t('obj.masked')}</p>}
        {e.stale > 0 && <p className="mdm-banner" role="status" data-testid="est-stale">{t('obj.stale', { n: e.stale })} {e.can.edit && <button type="button" className="btn btn-small" onClick={() => run(() => est.reprice(id, { version: e.rowVersion }), t('obj.repriced'))} data-testid="est-reprice">{t('obj.reprice')}</button>}</p>}
        {error?.form && <p className="field-error" role="alert" data-testid="est-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
        {note && <p className="mdm-banner" role="status" data-testid="est-note">{note}</p>}
        <div className="actions-row no-print" data-testid="est-actions">
          {e.can.submit && <button type="button" className="btn btn-primary" onClick={() => run(() => est.act(id, 'submit'), t('obj.sent'))} data-testid="est-submit">{t('act.submit')}</button>}
          {e.can.withdraw && <button type="button" className="btn" onClick={() => why((r) => est.act(id, 'withdraw', { reason: r }), t('obj.withdrawn'))} data-testid="est-withdraw">{t('act.withdraw')}</button>}
          {e.can.edit && <button type="button" className="btn" onClick={() => navigateTo(`/est/import?id=${id}`)} data-testid="est-import">{t('act.import')}</button>}
          {e.can.newVersion && e.status !== 'APPROVED' && <button type="button" className="btn" onClick={async () => go(await run(() => est.act(id, 'versions', {}), t('obj.versioned')))} data-testid="est-new-version">{t('act.newVersion')}</button>}
          {e.can.amend && <button type="button" className="btn" onClick={() => { const r = window.prompt(t('act.why')); if (r) run(() => est.act(id, 'amend', { reason: r }), t('obj.versioned')).then(go); }} data-testid="est-amend">{t('act.amend')}</button>}
          {e.versions.length > 1 && <button type="button" className="btn" onClick={() => navigateTo(`/est/compare?id=${e.versions.find((x) => x.id !== id)?.id}&with=${id}`)} data-testid="est-compare">{t('act.compare')}</button>}
          <button type="button" className="btn" onClick={() => navigateTo(`/est/resources?id=${id}`)} data-testid="est-resources">{t('act.resources')}</button>
          {e.can.cancel && <button type="button" className="btn" onClick={() => why((r) => est.act(id, 'cancel', { reason: r }), t('obj.cancelled'))} data-testid="est-cancel">{t('act.cancel')}</button>}
          {e.can.delete && <button type="button" className="btn" onClick={async () => { if (window.confirm(t('act.confirmDelete'))) { const r = await run(() => est.remove(id)); if (r) navigateTo('/est/estimates', { force: true }); } }} data-testid="est-delete">{t('act.delete')}</button>}
          {e.can.print && <a className="btn" href={`/api/v1/est/estimates/${id}/print`} target="_blank" rel="noreferrer">{t('act.print')}</a>}
        </div>
      </header>
      <Tabs tabs={tabs} active={tab} onChange={setTab} label={t('obj.title')} />
      {tab === 'items' && <ItemsTab e={e} run={run} error={error} />}
      {tab === 'sections' && <SectionsTab e={e} />}
      {tab === 'indirects' && <IndirectsTab e={e} run={run} error={error} />}
      {tab === 'risks' && <RisksTab e={e} run={run} error={error} />}
      {tab === 'versions' && (
        <ul className="mdm-list" data-testid="est-versions">{e.versions.map((x) => <li key={x.id}>{x.id === id ? <strong>v{x.versionNo}</strong> : <Link to={`/est/estimate?id=${x.id}`}>v{x.versionNo}</Link>} · {x.statusLabel} · {inr(x.selling)}{x.marginPct != null ? ` · ${x.marginPct}%` : ''} · {x.createdBy} · <span className="muted small">{String(x.createdAt).slice(0, 10)}</span>{x.id !== id && <> · <Link to={`/est/compare?id=${x.id}&with=${id}`}>{t('act.compare')}</Link></>}</li>)}</ul>)}
      {tab === 'approvals' && <History id={id} rowVersion={e.rowVersion} />}
      <p className="small"><Link to="/est/estimates">{t('list.title')}</Link></p>
    </section>
  );
}

function ItemsTab({ e, run, error }) {
  const t = useT('est');
  const edit = e.can.edit; const c = e.costsVisible;
  const [rows, setRows] = useState(() => e.items.map(fromItem)); const [open, setOpen] = useState(null);
  useEffect(() => { setRows(e.items.map(fromItem)); }, [e.id, e.rowVersion]);
  const aq = useQuery({ queryKey: ['est', 'analyses'], queryFn: est.analyses, enabled: edit, retry: false });
  const analyses = aq.data?.rows ?? [];
  const set = (i, patch) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const setComp = (i, j, patch) => set(i, { components: rows[i].components.map((x, k) => (k === j ? { ...x, ...patch } : x)) });
  const save = (ev) => { ev.preventDefault(); run(() => est.items(e.id, { items: rows.map(toBody), version: e.rowVersion }), t('items.saved')); };
  if (!edit) {
    return (
      <div className="table-wrap" data-testid="est-items">
        {rows.length === 0 ? <p className="muted">{t('items.none')}</p> : (
          <table className="data-table"><thead><tr><th scope="col">{t('items.section')}</th><th scope="col">{t('items.no')}</th><th scope="col">{t('items.description')}</th><th scope="col">{t('items.uom')}</th><th scope="col">{t('items.qty')}</th><th scope="col">{t('items.mode')}</th>{c && <th scope="col">{t('items.costRate')}</th>}{c && <th scope="col">{t('items.markup')}</th>}<th scope="col">{t('items.rate')}</th><th scope="col">{t('items.amount')}</th></tr></thead>
            <tbody>{e.items.map((i) => <tr key={i.id} data-testid={`est-row-${i.itemNo}`}><td data-label={t('items.section')}>{i.sectionCode}</td><td data-label={t('items.no')}>{i.itemNo}</td><td data-label={t('items.description')}>{i.description}{i.analysis ? <span className="muted small"> · {i.analysis.ref}</span> : null}{i.stale && <span className="field-error small"> · {t('items.stale')}</span>}</td><td data-label={t('items.uom')}>{i.uom}</td><td data-label={t('items.qty')}>{qty(i.qty)}</td><td data-label={t('items.mode')}>{t(`mode.${i.mode}`)}</td>{c && <td data-label={t('items.costRate')}>{inr(i.costRate)}</td>}{c && <td data-label={t('items.markup')}>{i.markupPct}%</td>}<td data-label={t('items.rate')} data-testid={`est-rate-${i.itemNo}`}>{inr(i.sellingRate)}</td><td data-label={t('items.amount')}>{inr(i.amount)}</td></tr>)}</tbody></table>)}
      </div>
    );
  }
  return (
    <form onSubmit={save} aria-label={t('tab.items')} data-testid="est-items">
      <p className="small muted">{t('items.help')}</p>
      <div className="table-wrap">
        <table className="data-table est-grid">
          <thead><tr><th scope="col">{t('items.section')}</th><th scope="col">{t('items.no')}</th><th scope="col">{t('items.description')}</th><th scope="col">{t('items.uom')}</th><th scope="col">{t('items.qty')}</th><th scope="col">{t('items.mode')}</th><th scope="col">{t('items.price')}</th><th scope="col">{t('items.markup')}</th><th scope="col">{t('items.rate')}</th><th scope="col">{t('items.amount')}</th><th scope="col"><span className="sr-only">{t('act.remove')}</span></th></tr></thead>
          <tbody>{rows.map((r, i) => {
            const p = r.mode === 'RATE' ? preview(r.costRate, r.markupPct, r.qty) : null;
            return [
              <tr key={`r${i}`} data-testid={`est-row-${i}`} className={r.stale ? 'row-highlight' : ''}>
                <td data-label={t('items.section')}><input value={r.sectionCode} onChange={(x) => set(i, { sectionCode: x.target.value })} aria-label={t('items.section')} size={4} data-testid={`it-section-${i}`} /></td>
                <td data-label={t('items.no')}><input value={r.itemNo} onChange={(x) => set(i, { itemNo: x.target.value })} aria-label={t('items.no')} size={6} data-testid={`it-no-${i}`} /></td>
                <td data-label={t('items.description')}><input value={r.description} onChange={(x) => set(i, { description: x.target.value })} aria-label={t('items.description')} data-testid={`it-desc-${i}`} /></td>
                <td data-label={t('items.uom')}><input value={r.uom} onChange={(x) => set(i, { uom: x.target.value })} aria-label={t('items.uom')} size={4} data-testid={`it-uom-${i}`} /></td>
                <td data-label={t('items.qty')}><input type="number" min="0" step="0.001" value={r.qty} onChange={(x) => set(i, { qty: x.target.value })} aria-label={t('items.qty')} data-testid={`it-qty-${i}`} /></td>
                <td data-label={t('items.mode')}><select value={r.mode} onChange={(x) => set(i, { mode: x.target.value })} aria-label={t('items.mode')} data-testid={`it-mode-${i}`}>{MODES.map((m) => <option key={m} value={m}>{t(`mode.${m}`)}</option>)}</select></td>
                <td data-label={t('items.price')}>
                  {r.mode === 'RATE' && <input type="number" min="0" step="0.0001" value={r.costRate} onChange={(x) => set(i, { costRate: x.target.value })} aria-label={t('items.costRate')} data-testid={`it-cost-${i}`} />}
                  {r.mode === 'ANALYSIS' && <select value={r.analysisId} onChange={(x) => set(i, { analysisId: x.target.value })} aria-label={t('items.analysis')} data-testid={`it-analysis-${i}`}><option value="">–</option>{analyses.map((a) => <option key={a.id} value={a.id}>{a.ref} · {a.title} ({a.basisUom})</option>)}</select>}
                  {r.mode === 'MANUAL' && <button type="button" className="btn btn-small" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i} data-testid={`it-build-${i}`}>{t('items.buildUp', { n: r.components.length })}</button>}
                  {r.stale && <span className="field-error small"> {t('items.stale')}</span>}
                </td>
                <td data-label={t('items.markup')}><input type="number" min="0" step="0.01" value={r.markupPct} onChange={(x) => set(i, { markupPct: x.target.value })} aria-label={t('items.markup')} size={5} data-testid={`it-markup-${i}`} /></td>
                <td data-label={t('items.rate')} data-testid={`it-rate-${i}`}>{p ? inr(p.rate) : inr(r.sellingRate)}</td>
                <td data-label={t('items.amount')} data-testid={`it-amount-${i}`}>{p ? inr(p.amount) : inr(r.amount)}</td>
                <td><button type="button" className="btn btn-small" onClick={() => setRows(rows.filter((_, k) => k !== i))} aria-label={t('items.removeRow', { no: r.itemNo || i + 1 })}>✕</button></td>
              </tr>,
              r.mode === 'MANUAL' && open === i ? (
                <tr key={`c${i}`}><td colSpan={11}>
                  <div className="mdm-panel" data-testid={`it-components-${i}`}>
                    <h3>{t('items.components', { no: r.itemNo })}</h3>
                    <p className="small muted">{t('items.componentsHelp')}</p>
                    {r.components.map((x, j) => (
                      <div key={j} className="mdm-fields" data-testid={`it-comp-${i}-${j}`}>
                        <Field label={t('comp.type')} name={`c${j}type`}><select value={x.type} onChange={(v) => setComp(i, j, { type: v.target.value })} data-testid={`comp-type-${i}-${j}`}>{COMPONENT_TYPES.map((k) => <option key={k} value={k}>{t(`ctype.${k}`)}</option>)}</select></Field>
                        <LookupField id={`comp-item-${i}-${j}`} label={t('comp.item')} lookup="mdm/items" value={x.itemId} onChange={(v) => setComp(i, j, { itemId: v })} compact />
                        <Field label={t('comp.description')} name={`c${j}desc`}><input value={x.description ?? ''} onChange={(v) => setComp(i, j, { description: v.target.value })} data-testid={`comp-desc-${i}-${j}`} /></Field>
                        <Field label={t('items.uom')} name={`c${j}uom`}><input value={x.uom ?? ''} onChange={(v) => setComp(i, j, { uom: v.target.value })} size={4} data-testid={`comp-uom-${i}-${j}`} /></Field>
                        <Field label={t('comp.qty')} name={`c${j}qty`}><input type="number" min="0" step="0.001" value={x.qty} onChange={(v) => setComp(i, j, { qty: v.target.value })} data-testid={`comp-qty-${i}-${j}`} /></Field>
                        <Field label={t('comp.rate')} name={`c${j}rate`} hint={x.libraryRate ? t('comp.library', { rate: x.libraryRate }) : t('comp.rateHint')}><input type="number" min="0" step="0.0001" value={x.rate ?? ''} onChange={(v) => setComp(i, j, { rate: v.target.value, libraryRate: null })} data-testid={`comp-rate-${i}-${j}`} /></Field>
                        <button type="button" className="btn btn-small" onClick={() => set(i, { components: r.components.filter((_, k) => k !== j) })} aria-label={t('comp.remove')}>✕</button>
                      </div>))}
                    <button type="button" className="btn" onClick={() => set(i, { components: [...r.components, { type: 'MATERIAL', itemId: null, description: '', uom: '', qty: '0', rate: '' }] })} data-testid={`comp-add-${i}`}>{t('comp.add')}</button>
                  </div>
                </td></tr>) : null,
            ];
          })}</tbody>
        </table>
      </div>
      {rows.length === 0 && <p className="muted">{t('items.none')} <Link to={`/est/import?id=${e.id}`}>{t('act.import')}</Link></p>}
      <div className="actions"><button type="button" className="btn" onClick={() => setRows([...rows, blankItem(rows[rows.length - 1]?.sectionCode ?? '')])} data-testid="it-add">{t('items.add')}</button><button type="submit" className="btn btn-primary" data-testid="it-save">{t('items.save')}</button></div>
      {error?.fields && <ul className="field-error small" data-testid="it-problems">{Object.entries(error.fields).slice(0, 20).map(([k, m]) => <li key={k}>{k}: {m}</li>)}</ul>}
    </form>
  );
}

function SectionsTab({ e }) {
  const t = useT('est'); const c = e.costsVisible;
  return (
    <div className="table-wrap" data-testid="est-sections">
      <table className="data-table"><thead><tr><th scope="col">{t('items.section')}</th><th scope="col">{t('sec.items')}</th><th scope="col">{t('fig.selling')}</th>{c && <th scope="col">{t('fig.cost')}</th>}{c && <th scope="col">{t('fig.margin')}</th>}{c && <th scope="col">{t('sec.marginPct')}</th>}</tr></thead>
        <tbody>{e.sections.map((s) => <tr key={s.code} data-testid={`sec-${s.code}`}><th scope="row" data-label={t('items.section')}>{s.code}{s.name ? ` · ${s.name}` : ''}</th><td data-label={t('sec.items')}>{s.items}</td><td data-label={t('fig.selling')}>{inr(s.selling)}</td>{c && <td data-label={t('fig.cost')}>{inr(s.cost)}</td>}{c && <td data-label={t('fig.margin')}>{inr(s.margin)}</td>}{c && <td data-label={t('sec.marginPct')} data-testid={`sec-margin-${s.code}`} className={Number(s.marginPct) < 0 ? 'field-error' : ''}>{s.marginPct}%</td>}</tr>)}</tbody></table>
      {c && (
        <dl className="op-figures" data-testid="est-breakdown">
          {[['directCost', 'fig.direct'], ['indirectCost', 'fig.indirect'], ['overhead', 'fig.overhead'], ['contingency', 'fig.contingency'], ['escalation', 'fig.escalation'], ['totalCost', 'fig.cost'], ['selling', 'fig.selling'], ['margin', 'fig.margin']].map(([k, l]) => <div key={k}><dt>{t(l)}</dt><dd data-testid={`bk-${k}`}>{inr(e.totals[k])}</dd></div>)}
        </dl>)}
    </div>
  );
}

function IndirectsTab({ e, run, error }) {
  const t = useT('est'); const edit = e.can.edit;
  const from = () => (e.indirects ?? []).map((x) => ({ category: x.category, description: x.description, basis: x.basis, qty: x.qty ?? '', rate: x.rate ?? '', percent: x.percent ?? '', amount: x.basis === 'LUMP_SUM' ? x.amount : '', shown: x.amount }));
  const [rows, setRows] = useState(from);
  useEffect(() => { setRows(from()); }, [e.id, e.rowVersion]);
  const set = (i, patch) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const save = (ev) => { ev.preventDefault(); run(() => est.indirects(e.id, { lines: rows.map((r) => ({ category: r.category, description: r.description.trim(), basis: r.basis, ...(r.basis === 'LUMP_SUM' ? { amount: String(r.amount || '0') } : r.basis === 'QTY_RATE' ? { qty: String(r.qty || '0'), rate: String(r.rate || '0') } : { percent: String(r.percent || '0') }) })), version: e.rowVersion }), t('ind.saved')); };
  return (
    <form onSubmit={save} aria-label={t('tab.indirects')} data-testid="est-indirects">
      <fieldset disabled={!edit} className="mdm-fields">
        {rows.map((r, i) => (
          <div key={i} className="mdm-panel mdm-fields" data-testid={`ind-${i}`}>
            <Field label={t('ind.category')} name={`i${i}cat`}><select value={r.category} onChange={(x) => set(i, { category: x.target.value })} data-testid={`ind-cat-${i}`}>{INDIRECTS.map((k) => <option key={k} value={k}>{t(`ind.${k}`)}</option>)}</select></Field>
            <Field label={t('comp.description')} name={`i${i}desc`}><input value={r.description} onChange={(x) => set(i, { description: x.target.value })} data-testid={`ind-desc-${i}`} /></Field>
            <Field label={t('ind.basis')} name={`i${i}basis`}><select value={r.basis} onChange={(x) => set(i, { basis: x.target.value })} data-testid={`ind-basis-${i}`}>{BASES.map((k) => <option key={k} value={k}>{t(`basis.${k}`)}</option>)}</select></Field>
            {r.basis === 'LUMP_SUM' && <Field label={t('ind.amount')} name={`i${i}amt`}><input type="number" min="0" step="0.01" value={r.amount} onChange={(x) => set(i, { amount: x.target.value })} data-testid={`ind-amount-${i}`} /></Field>}
            {r.basis === 'QTY_RATE' && <><Field label={t('ind.qty')} name={`i${i}q`}><input type="number" min="0" step="0.001" value={r.qty} onChange={(x) => set(i, { qty: x.target.value })} data-testid={`ind-qty-${i}`} /></Field><Field label={t('ind.rate')} name={`i${i}r`}><input type="number" min="0" step="0.01" value={r.rate} onChange={(x) => set(i, { rate: x.target.value })} data-testid={`ind-rate-${i}`} /></Field></>}
            {r.basis === 'PERCENT' && <Field label={t('ind.percent')} name={`i${i}p`}><input type="number" min="0" max="100" step="0.01" value={r.percent} onChange={(x) => set(i, { percent: x.target.value })} data-testid={`ind-percent-${i}`} /></Field>}
            <p className="small">{t('ind.worked', { amount: inr(r.shown) })}</p>
            {edit && <button type="button" className="btn btn-small" onClick={() => setRows(rows.filter((_, k) => k !== i))} aria-label={t('act.remove')}>✕</button>}
          </div>))}
        {rows.length === 0 && <p className="muted">{t('ind.none')}</p>}
        {edit && <div className="actions"><button type="button" className="btn" onClick={() => setRows([...rows, { category: 'SITE_ESTABLISHMENT', description: '', basis: 'LUMP_SUM', qty: '', rate: '', percent: '', amount: '', shown: null }])} data-testid="ind-add">{t('ind.add')}</button><button type="submit" className="btn btn-primary" data-testid="ind-save">{t('act.save')}</button></div>}
      </fieldset>
      <p data-testid="ind-total"><strong>{t('fig.indirect')}: {inr(e.totals.indirectCost)}</strong></p>
      {error?.fields && <p className="field-error small">{Object.values(error.fields).join('; ')}</p>}
    </form>
  );
}

function RisksTab({ e, run, error }) {
  const t = useT('est'); const edit = e.can.edit;
  const [h, setH] = useState({ hoOverheadPct: e.hoOverheadPct, contingencyPct: e.contingencyPct, escalationPct: e.escalationPct, gstPct: e.gstPct });
  const [rows, setRows] = useState(() => (e.risks ?? []).map((x) => ({ description: x.description, impact: x.impact, probabilityPct: x.probabilityPct, exposure: x.exposure })));
  useEffect(() => { setH({ hoOverheadPct: e.hoOverheadPct, contingencyPct: e.contingencyPct, escalationPct: e.escalationPct, gstPct: e.gstPct }); setRows((e.risks ?? []).map((x) => ({ description: x.description, impact: x.impact, probabilityPct: x.probabilityPct, exposure: x.exposure }))); }, [e.id, e.rowVersion]);
  const set = (i, patch) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  return (
    <div data-testid="est-risks">
      <form className="mdm-panel mdm-fields" onSubmit={(x) => { x.preventDefault(); run(() => est.update(e.id, { ...Object.fromEntries(Object.entries(h).map(([k, v]) => [k, String(v || '0')])), version: e.rowVersion }), t('risk.headSaved')); }} aria-label={t('risk.percentages')}>
        <h2>{t('risk.percentages')}</h2>
        <fieldset disabled={!edit} className="mdm-fields">
          {[['hoOverheadPct', 'head.overhead'], ['contingencyPct', 'head.contingency'], ['escalationPct', 'head.escalation'], ['gstPct', 'head.gst']].map(([k, l]) => <Field key={k} label={t(l)} name={k} error={error}><input type="number" min="0" max="100" step="0.01" value={h[k] ?? ''} onChange={(x) => setH({ ...h, [k]: x.target.value })} data-testid={`risk-${k}`} /></Field>)}
          {edit && <div className="actions"><button type="submit" className="btn" data-testid="risk-head-save">{t('act.save')}</button></div>}
        </fieldset>
      </form>
      <form className="mdm-panel" onSubmit={(x) => { x.preventDefault(); run(() => est.risks(e.id, { lines: rows.map((r) => ({ description: r.description.trim(), impact: String(r.impact || '0'), probabilityPct: String(r.probabilityPct || '0') })), version: e.rowVersion }), t('risk.saved')); }} aria-label={t('risk.title')}>
        <h2>{t('risk.title')}</h2>
        <p className="small muted">{t('risk.help')}</p>
        <fieldset disabled={!edit}>
          <div className="table-wrap"><table className="data-table"><thead><tr><th scope="col">{t('risk.description')}</th><th scope="col">{t('risk.impact')}</th><th scope="col">{t('risk.probability')}</th><th scope="col">{t('risk.exposure')}</th><th scope="col"><span className="sr-only">{t('act.remove')}</span></th></tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i} data-testid={`risk-${i}`}><td data-label={t('risk.description')}><input value={r.description} onChange={(x) => set(i, { description: x.target.value })} aria-label={t('risk.description')} data-testid={`risk-desc-${i}`} /></td><td data-label={t('risk.impact')}><input type="number" min="0" step="0.01" value={r.impact} onChange={(x) => set(i, { impact: x.target.value })} aria-label={t('risk.impact')} data-testid={`risk-impact-${i}`} /></td><td data-label={t('risk.probability')}><input type="number" min="0" max="100" step="0.01" value={r.probabilityPct} onChange={(x) => set(i, { probabilityPct: x.target.value })} aria-label={t('risk.probability')} data-testid={`risk-prob-${i}`} /></td><td data-label={t('risk.exposure')}>{inr(r.exposure)}</td><td>{edit && <button type="button" className="btn btn-small" onClick={() => setRows(rows.filter((_, k) => k !== i))} aria-label={t('act.remove')}>✕</button>}</td></tr>)}</tbody></table></div>
          {edit && <div className="actions"><button type="button" className="btn" onClick={() => setRows([...rows, { description: '', impact: '', probabilityPct: '', exposure: null }])} data-testid="risk-add">{t('risk.add')}</button><button type="submit" className="btn btn-primary" data-testid="risk-save">{t('act.save')}</button></div>}
        </fieldset>
        <p data-testid="risk-total">{t('risk.total', { risk: inr(e.totals.risk), contingency: inr(e.totals.contingency) })}</p>
      </form>
    </div>
  );
}

function History({ id, rowVersion }) {
  const t = useT('est');
  const q = useQuery({ queryKey: ['est', 'history', id, rowVersion], queryFn: () => est.history(id), retry: false });
  if (q.isPending) return <Skeleton label={t('tab.approvals')} rows={3} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  return (
    <div data-testid="est-history">
      <h2>{t('tab.approvals')}</h2>
      {q.data.approvals.length === 0 ? <p className="muted">{t('hist.none')}</p> : <ul className="mdm-list">{q.data.approvals.map((a, i) => <li key={i}><strong>{a.event}</strong> · {a.actor}{a.step_code ? ` · ${a.step_code}` : ''} · <span className="muted small">{String(a.at).slice(0, 16).replace('T', ' ')}</span>{a.comment ? <><br />{a.comment}</> : null}</li>)}</ul>}
      <h2>{t('hist.audit')}</h2>
      <ul className="mdm-list">{q.data.audit.map((a, i) => <li key={i}>{a.action} · {a.actor} · <span className="muted small">{String(a.at).slice(0, 16).replace('T', ' ')}</span>{a.reason ? ` · ${a.reason}` : ''}</li>)}</ul>
    </div>
  );
}
