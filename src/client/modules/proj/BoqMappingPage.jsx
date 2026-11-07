import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { MAP_TONE, NORM_TYPES, bq, st } from './api.js';
import { useSearch } from './parts.jsx';

// WBS and Location Mapping (part 10.04, FR-04, FR-05, BR-01): map each BOQ item to WBS nodes and locations with a split of its quantity (the splits sum to the item quantity), assign the whole quantity of many items to one node at once, and keep the
// resource norms of each item (typed, or taken from its rate analysis). In a frozen version a change is raised as a request approved by QS and the project manager.
export default function BoqMappingPage() {
  const t = useT('proj');
  const qc = useQueryClient();
  const versionId = Number(useSearch().get('versionId')) || null;
  usePageTitle(t('map.title'));
  const q = useQuery({ queryKey: ['proj', 'boq', versionId], queryFn: () => bq.lines(versionId), enabled: Boolean(versionId), retry: false });
  const pid = q.data?.version.projectId;
  const wq = useQuery({ queryKey: ['proj', 'wbs', pid], queryFn: () => st.tree(pid), enabled: Boolean(pid), retry: false });
  const lq = useQuery({ queryKey: ['proj', 'locations', pid], queryFn: () => st.locations(pid), enabled: Boolean(pid), retry: false });
  const [sel, setSel] = useState([]); const [open, setOpen] = useState(null); const [bulk, setBulk] = useState({ wbsId: '', locationId: '' }); const [only, setOnly] = useState(false); const [error, setError] = useState(null); const [note, setNote] = useState(null);
  if (!versionId) return <section aria-labelledby="map-h" data-testid="map-none"><h1 id="map-h">{t('map.title')}</h1><p className="muted">{t('bq.noId')} <Link to="/proj/versions">{t('bq.listTitle')}</Link></p></section>;
  if (q.error?.status === 403) return <NoPermission what={t('map.title')} permission="proj.version.view" />;
  if (q.isPending || wq.isPending || lq.isPending) return <Skeleton label={t('map.title')} rows={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const v = q.data.version; const leaves = q.data.lines.filter((l) => l.leaf && (!only || ['UNMAPPED', 'PARTIAL'].includes(l.mapped)));
  const wbsLeaf = (wq.data?.nodes ?? []).filter((n) => n.status === 'ACTIVE' && n.children === 0); const locLeaf = (lq.data?.nodes ?? []).filter((n) => n.status === 'ACTIVE' && n.children === 0);
  const run = async (fn, done) => { setError(null); setNote(null); try { const r = await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['proj'] }); return r ?? true; } catch (e) { setError(errorInfo(e)); return null; } };
  const frozen = v.status === 'APPROVED'; const can = v.can.map || v.can.amend;
  return (
    <section aria-labelledby="map-h" data-testid="boq-mapping">
      <h1 id="map-h">{t('map.title')}</h1>
      <p className="muted">{v.docNo} · {v.name} · {v.statusLabel}. {frozen ? t('map.frozenHelp') : t('map.help')}</p>
      {error?.form && <p className="field-error" role="alert" data-testid="map-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 6).join('; ')}` : ''}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="map-note">{note}</p>}
      {wbsLeaf.length === 0 && <div className="mdm-banner" data-testid="map-no-wbs"><strong>{t('map.noWbsTitle')}</strong> {t('map.noWbsText')} <Link to={`/proj/wbs?projectId=${pid}`}>{t('wbs.title')}</Link></div>}
      {v.can.map && wbsLeaf.length > 0 && (
        <div className="mdm-panel no-print" data-testid="map-bulk">
          <h2>{t('map.bulk', { n: sel.length })}</h2>
          <div className="form-grid">
            <Field label={t('map.wbsNode')} name="wbsId"><select value={bulk.wbsId} onChange={(e) => setBulk((b) => ({ ...b, wbsId: e.target.value }))} data-testid="map-bulk-wbs"><option value="">—</option>{wbsLeaf.map((n) => <option key={n.id} value={n.id}>{n.code} {n.name}</option>)}</select></Field>
            <Field label={t('map.location')} name="locationId"><select value={bulk.locationId} onChange={(e) => setBulk((b) => ({ ...b, locationId: e.target.value }))} data-testid="map-bulk-loc"><option value="">—</option>{locLeaf.map((n) => <option key={n.id} value={n.id}>{n.code} {n.name}</option>)}</select></Field>
          </div>
          <button type="button" className="btn btn-primary" disabled={!sel.length || !bulk.wbsId} onClick={async () => { if (await run(() => bq.bulkMap(versionId, { lineIds: sel, wbsId: Number(bulk.wbsId), ...(bulk.locationId ? { locationId: Number(bulk.locationId) } : {}) }), t('map.bulkDone', { n: sel.length }))) setSel([]); }} data-testid="map-bulk-apply">{t('wbs.apply')}</button>
        </div>
      )}
      <label className="small"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} data-testid="map-only" /> {t('bq.unmappedOnly')}</label>
      {leaves.length === 0 ? <div className="mdm-banner" data-testid="map-empty"><strong>{t('map.emptyTitle')}</strong> {t('map.emptyText')}</div> : (
        <div className="table-wrap" data-testid="map-grid"><table className="data-table"><caption className="sr-only">{t('map.title')}</caption>
          <thead><tr><th scope="col" /><th scope="col">{t('bq.code')}</th><th scope="col">{t('bl.description')}</th><th scope="col" className="num">{t('bl.qty')}</th><th scope="col">{t('bq.mapping')}</th><th scope="col">{t('bq.norms')}</th><th scope="col" className="no-print">{t('wbs.actions')}</th></tr></thead>
          <tbody>{leaves.map((l) => (
            <tr key={l.id} data-testid="map-row" data-code={l.code} data-mapped={l.mapped}>
              <td>{v.can.map && <input type="checkbox" checked={sel.includes(l.id)} onChange={() => setSel((s) => (s.includes(l.id) ? s.filter((i) => i !== l.id) : [...s, l.id]))} aria-label={t('wbs.select', { code: l.code })} />}</td>
              <td>{l.code}</td><td>{l.description}</td><td className="num">{l.qty} {l.uom}</td><td><StatusBadge status={MAP_TONE[l.mapped]} label={t(`bq.map.${l.mapped}`)} />{l.splits ? ` · ${l.splits}` : ''}</td><td>{l.norms || '—'}</td>
              <td className="no-print"><button type="button" className="btn" onClick={() => setOpen({ id: l.id, what: 'splits' })} data-testid={`map-splits-${l.code}`}>{t('map.splits')}</button><button type="button" className="btn" onClick={() => setOpen({ id: l.id, what: 'norms' })} data-testid={`map-norms-${l.code}`}>{t('bq.norms')}</button></td>
            </tr>))}</tbody></table></div>
      )}
      {open?.what === 'splits' && <Splits lineId={open.id} frozen={frozen} can={can} wbsLeaf={wbsLeaf} locLeaf={locLeaf} versionId={versionId} run={run} done={() => setOpen(null)} error={error} />}
      {open?.what === 'norms' && <Norms lineId={open.id} frozen={frozen} can={can} versionId={versionId} run={run} done={() => setOpen(null)} error={error} />}
      <p className="small"><Link to={`/proj/version?id=${versionId}`}>{v.docNo}</Link> · <Link to={`/proj/boq-reports?versionId=${versionId}`}>{t('bq.reports')}</Link></p>
    </section>
  );
}
function Splits({ lineId, frozen, can, wbsLeaf, locLeaf, versionId, run, done, error }) {
  const t = useT('proj'); const q = useQuery({ queryKey: ['proj', 'boq-map', lineId], queryFn: () => bq.mapping(lineId), retry: false }); const [rows, setRows] = useState(null); const [reason, setReason] = useState('');
  if (q.isPending) return <Skeleton label={t('map.splits')} rows={2} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data; const cur = rows ?? d.splits.map((s) => ({ wbsId: String(s.wbsId), locationId: s.locationId ? String(s.locationId) : '', qty: s.qty }));
  const total = cur.reduce((s, r) => s + (Number(r.qty) || 0), 0); const want = Number(d.line.qty); const ok = Math.abs(total - want) < 0.0005 || cur.length === 0;
  const body = () => cur.filter((r) => r.wbsId).map((r) => ({ wbsId: Number(r.wbsId), ...(r.locationId ? { locationId: Number(r.locationId) } : {}), qty: String(r.qty) }));
  const upd = (i, k, v) => setRows(cur.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <form className="mdm-panel" aria-label={t('map.splits')} data-testid="map-splits-form" onSubmit={async (e) => { e.preventDefault(); const r = frozen ? await run(() => bq.amend(versionId, { reason, ops: [{ lineId, splits: body() }] }), t('map.changeSent')) : await run(() => bq.setMapping(lineId, body()), t('map.saved')); if (r) done(); }}>
      <h2>{t('map.splitsOf', { code: d.line.code })} · {d.line.qty} {d.line.uom}</h2>
      {cur.map((r, i) => (
        <div key={i} className="form-grid">
          <Field label={t('map.wbsNode')} name={`splits.${i}.wbsId`} error={error}><select value={r.wbsId} onChange={(e) => upd(i, 'wbsId', e.target.value)} disabled={!can} data-testid={`split-wbs-${i}`}><option value="">—</option>{wbsLeaf.map((n) => <option key={n.id} value={n.id}>{n.code} {n.name}</option>)}</select></Field>
          <Field label={t('map.location')} name={`splits.${i}.locationId`} error={error}><select value={r.locationId} onChange={(e) => upd(i, 'locationId', e.target.value)} disabled={!can}><option value="">—</option>{locLeaf.map((n) => <option key={n.id} value={n.id}>{n.code} {n.name}</option>)}</select></Field>
          <Field label={t('bl.qty')} name={`splits.${i}.qty`} error={error}><input inputMode="decimal" value={r.qty} onChange={(e) => upd(i, 'qty', e.target.value)} disabled={!can} data-testid={`split-qty-${i}`} /></Field>
          {can && <button type="button" className="btn" onClick={() => setRows(cur.filter((_, j) => j !== i))}>{t('bl.removeRow')}</button>}
        </div>
      ))}
      <p className={ok ? 'muted' : 'field-error'} role="status" data-testid="split-sum">{t('map.sum', { sum: String(total), qty: d.line.qty })}</p>
      {can && <button type="button" className="btn" onClick={() => setRows([...cur, { wbsId: '', locationId: '', qty: '' }])} data-testid="split-add">{t('map.addSplit')}</button>}
      {frozen && can && <Field label={t('wbs.reason')} name="reason" error={error}><textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={5} data-testid="split-reason" /></Field>}
      {error?.form && <p className="field-error" role="alert">{error.form}</p>}
      <div className="actions"><button type="button" className="btn" onClick={done}>{t('act.close')}</button>{can && <button type="submit" className="btn btn-primary" disabled={!ok} data-testid="split-save">{frozen ? t('map.raise') : t('bl.save')}</button>}</div>
    </form>
  );
}
function Norms({ lineId, frozen, can, versionId, run, done, error }) {
  const t = useT('proj'); const q = useQuery({ queryKey: ['proj', 'boq-norms', lineId], queryFn: () => bq.norms(lineId), retry: false }); const [rows, setRows] = useState(null); const [reason, setReason] = useState('');
  if (q.isPending) return <Skeleton label={t('bq.norms')} rows={2} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data; const cur = rows ?? d.norms.map((n) => ({ type: n.type, resourceItemId: n.resourceItemId, description: n.description, uom: n.uom, qtyPerUnit: n.qtyPerUnit, wastagePct: n.wastagePct }));
  const upd = (i, k, v) => setRows(cur.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const body = () => cur.filter((r) => r.description?.trim()).map((r) => ({ type: r.type, ...(r.resourceItemId ? { resourceItemId: r.resourceItemId } : {}), description: r.description.trim(), uom: r.uom, qtyPerUnit: String(r.qtyPerUnit || '0'), wastagePct: String(r.wastagePct || '0') }));
  return (
    <form className="mdm-panel" aria-label={t('bq.norms')} data-testid="map-norms-form" onSubmit={async (e) => { e.preventDefault(); const r = frozen ? await run(() => bq.amend(versionId, { reason, ops: [{ lineId, norms: body() }] }), t('map.changeSent')) : await run(() => bq.setNorms(lineId, body()), t('map.saved')); if (r) done(); }}>
      <h2>{t('map.normsOf', { code: d.line.code })} · {t('map.perUnit', { uom: d.line.uom })}</h2>
      {cur.map((r, i) => (
        <div key={i} className="form-grid">
          <Field label={t('f.type')} name={`norms.${i}.type`} error={error}><select value={r.type} onChange={(e) => upd(i, 'type', e.target.value)} disabled={!can}>{NORM_TYPES.map((k) => <option key={k} value={k}>{t(`bq.norm.${k}`)}</option>)}</select></Field>
          <Field label={t('bq.resource')} name={`norms.${i}.description`} error={error}><input value={r.description} onChange={(e) => upd(i, 'description', e.target.value)} disabled={!can} data-testid={`norm-desc-${i}`} /></Field>
          <Field label={t('bl.uom')} name={`norms.${i}.uom`} error={error}><input value={r.uom} onChange={(e) => upd(i, 'uom', e.target.value)} disabled={!can} /></Field>
          <Field label={t('bq.qtyPerUnit')} name={`norms.${i}.qtyPerUnit`} error={error}><input inputMode="decimal" value={r.qtyPerUnit} onChange={(e) => upd(i, 'qtyPerUnit', e.target.value)} disabled={!can} data-testid={`norm-qty-${i}`} /></Field>
          <Field label={t('bq.wastage')} name={`norms.${i}.wastagePct`} error={error}><input inputMode="decimal" value={r.wastagePct} onChange={(e) => upd(i, 'wastagePct', e.target.value)} disabled={!can} /></Field>
          {can && <button type="button" className="btn" onClick={() => setRows(cur.filter((_, j) => j !== i))}>{t('bl.removeRow')}</button>}
        </div>
      ))}
      {can && <div className="actions-row"><button type="button" className="btn" onClick={() => setRows([...cur, { type: 'MATERIAL', description: '', uom: '', qtyPerUnit: '', wastagePct: '' }])} data-testid="norm-add">{t('bq.addNorm')}</button>{!frozen && d.line.analysisId && <button type="button" className="btn" onClick={async () => { if (await run(() => bq.normsFromAnalysis(lineId), t('map.fromAnalysisDone'))) { setRows(null); done(); } }} data-testid="norm-from-analysis">{t('bq.fromAnalysis')}</button>}</div>}
      {frozen && can && <Field label={t('wbs.reason')} name="reason" error={error}><textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={5} /></Field>}
      {error?.form && <p className="field-error" role="alert">{error.form}</p>}
      <div className="actions"><button type="button" className="btn" onClick={done}>{t('act.close')}</button>{can && <button type="submit" className="btn btn-primary" data-testid="norm-save">{frozen ? t('map.raise') : t('bl.save')}</button>}</div>
    </form>
  );
}
