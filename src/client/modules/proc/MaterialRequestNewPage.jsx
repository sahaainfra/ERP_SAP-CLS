import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ItemSelector from '../../platform/items/ItemSelector.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { addDays, fmtQty, pc } from './api.js';

// New Material Request (part 15.01, FR-01), a phone screen: the site, the day it is needed, the work authorisation, and the items with their quantity; under each line the free stock at the site, in nearby stores and in the central warehouse.
// It is saved as a draft or sent for approval to the construction manager.
function Stock({ t, projectId, siteId, line }) {
  const q = useQuery({ queryKey: ['proc', 'avail', projectId, siteId, line.itemId], queryFn: () => pc.availability(projectId, siteId, line.itemId), enabled: Boolean(projectId && siteId && line.itemId), retry: false });
  if (!q.data) return <p className="muted small" aria-live="polite">{q.isPending && siteId ? t('p.loadingStock') : t('p.chooseSite')}</p>;
  const a = q.data; const need = Number(line.qty) || 0;
  return (
    <div className="mdm-panel" data-testid="mr-stock" aria-label={t('p.stock')}>
      <strong>{t('p.stock')}</strong>
      {a.stores.length === 0 ? <p className="muted">{t('p.noStock')}</p> : <ul>{a.stores.map((s) => <li key={s.storeCode} data-testid="mr-store">{s.storeName} ({t(`p.rel.${s.relation}`)}): <strong>{fmtQty(s.freeQty)}</strong> {line.uom}</li>)}</ul>}
      {need > 0 && a.controlQty >= need && <p><StatusBadge status="AT_RISK" label={t('p.coversNeed', { n: fmtQty(a.controlQty) })} /></p>}
    </div>
  );
}

export default function MaterialRequestNewPage() {
  const t = useT('proc'); usePageTitle(t('p.mrNew'));
  const pq = useQuery({ queryKey: ['proc', 'projects'], queryFn: pc.projects, retry: false });
  const [f, setF] = useState({ projectId: '', siteId: '', requiredBy: addDays(3), priority: 'NORMAL', waId: '', purpose: '' }); const [lines, setLines] = useState([]); const [picking, setPicking] = useState(false); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  const projects = (pq.data ?? []).filter((p) => p.canRaiseMr); const projectId = f.projectId || (projects[0] ? String(projects[0].id) : '');
  const oq = useQuery({ queryKey: ['proc', 'mr-options', projectId], queryFn: () => pc.mrOptions(projectId), enabled: Boolean(projectId), retry: false });
  const o = oq.data; const siteId = f.siteId || (o?.sites?.length === 1 ? String(o.sites[0].id) : '');
  if (pq.error?.status === 403) return <NoPermission what={t('p.mrNew')} permission="proc.material_request.create" />;
  if (pq.isPending) return <Skeleton label={t('p.mrNew')} rows={4} />;
  const set = (k, v) => setF({ ...f, [k]: v }); const setLine = (i, k, v) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const pick = (items) => setLines([...lines, ...items.filter((it) => !lines.some((l) => l.itemId === it.id)).map((it) => ({ itemId: it.id, code: it.code, name: it.name, uoms: it.uoms ?? [it.uom], uom: it.uom, qty: '', wbsId: '', costCodeId: '' }))]);
  const body = () => ({ projectId: Number(projectId), siteId: Number(siteId), requiredBy: f.requiredBy, priority: f.priority, waId: f.waId ? Number(f.waId) : null, purpose: f.purpose.trim() || null, lines: lines.map((l) => ({ itemId: l.itemId, qty: Number(l.qty), uom: l.uom, wbsId: l.wbsId ? Number(l.wbsId) : null, costCodeId: l.costCodeId ? Number(l.costCodeId) : null })) });
  const save = async (send) => {
    setError(null); setBusy(true);
    try { const d = await pc.mrCreate(body()); if (send) await pc.mrAct(d.id, 'submit'); navigateTo(`/proc/material-requests?id=${d.id}`); } catch (e) { setError(errorInfo(e)); } finally { setBusy(false); }
  };
  const was = (o?.was ?? []).filter((w) => !siteId || String(w.siteId) === String(siteId));
  return (
    <section aria-labelledby="mrn-h" data-testid="proc-mr-new">
      <h1 id="mrn-h">{t('p.mrNew')}</h1><p className="muted">{t('p.mrNewHelp')}</p>
      {projects.length === 0 && <div className="mdm-panel" data-testid="mrn-none"><h2>{t('p.noProject')}</h2><p className="muted">{t('p.noProjectBody')}</p></div>}
      <form className="mdm-panel" onSubmit={(e) => { e.preventDefault(); save(false); }} noValidate>
        <div className="form-grid">
          <Field label={t('p.project')} name="projectId" error={error}><select value={projectId} onChange={(e) => setF({ ...f, projectId: e.target.value, siteId: '', waId: '' })} style={{ minHeight: 44 }} data-testid="mrn-project">{projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></Field>
          <Field label={t('p.site')} name="siteId" error={error}><select value={siteId} onChange={(e) => setF({ ...f, siteId: e.target.value, waId: '' })} style={{ minHeight: 44 }} data-testid="mrn-site"><option value="">{t('p.choose')}</option>{(o?.sites ?? []).map((s) => <option key={s.id} value={s.id}>{s.code} {s.name}</option>)}</select></Field>
          <Field label={t('p.requiredBy')} name="requiredBy" error={error}><input type="date" value={f.requiredBy} min={o?.today} onChange={(e) => set('requiredBy', e.target.value)} style={{ minHeight: 44 }} data-testid="mrn-required" /></Field>
          <Field label={t('p.priority')} name="priority" error={error}><select value={f.priority} onChange={(e) => set('priority', e.target.value)} style={{ minHeight: 44 }} data-testid="mrn-priority">{['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((x) => <option key={x} value={x}>{t(`p.pri.${x}`)}</option>)}</select></Field>
          <Field label={t('p.wa')} name="waId" error={error}><select value={f.waId} onChange={(e) => set('waId', e.target.value)} style={{ minHeight: 44 }} data-testid="mrn-wa"><option value="">{t('p.noWa')}</option>{was.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}</select></Field>
          <Field label={t('p.purpose')} name="purpose" error={error}><input value={f.purpose} maxLength={500} onChange={(e) => set('purpose', e.target.value)} style={{ minHeight: 44 }} data-testid="mrn-purpose" /></Field>
        </div>
        <h2>{t('p.lines')}</h2>
        {lines.length === 0 && <p className="muted" data-testid="mrn-no-lines">{t('p.noLines')}</p>}
        {lines.map((l, i) => (
          <div key={l.itemId} className="mdm-panel" data-testid="mrn-line">
            <strong>{l.code} · {l.name}</strong>
            <div className="form-grid">
              <Field label={t('p.qty')} name={`lines.${i}.qty`} error={error}><input type="number" inputMode="decimal" min="0" step="0.001" value={l.qty} onChange={(e) => setLine(i, 'qty', e.target.value)} style={{ minHeight: 44 }} data-testid="mrn-qty" /></Field>
              <Field label={t('p.uom')} name={`lines.${i}.uom`} error={error}><select value={l.uom} onChange={(e) => setLine(i, 'uom', e.target.value)} style={{ minHeight: 44 }} data-testid="mrn-uom">{l.uoms.map((u) => <option key={u} value={u}>{u}</option>)}</select></Field>
              <Field label={t('p.wbs')} name={`lines.${i}.wbsId`} error={error}><select value={l.wbsId} onChange={(e) => setLine(i, 'wbsId', e.target.value)} style={{ minHeight: 44 }} data-testid="mrn-wbs"><option value="">{t('p.none')}</option>{(o?.wbs ?? []).map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}</select></Field>
              <Field label={t('p.costCode')} name={`lines.${i}.costCodeId`} error={error}><select value={l.costCodeId} onChange={(e) => setLine(i, 'costCodeId', e.target.value)} style={{ minHeight: 44 }} data-testid="mrn-code"><option value="">{t('p.none')}</option>{(o?.costCodes ?? []).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></Field>
            </div>
            <Stock t={t} projectId={projectId} siteId={siteId} line={l} />
            <button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => setLines(lines.filter((_, j) => j !== i))} data-testid="mrn-remove">{t('p.removeLine')}</button>
          </div>
        ))}
        <button type="button" className="btn" style={{ minHeight: 48 }} onClick={() => setPicking(true)} data-testid="mrn-add">{t('p.addItems')}</button>
        <ItemSelector open={picking} onClose={() => setPicking(false)} onPick={pick} types={['MATERIAL', 'CONSUMABLE', 'SPARE', 'TOOL', 'RETURNABLE']} title={t('p.addItems')} />
        {error?.form && <p className="field-error" role="alert" data-testid="mrn-error">{error.form}</p>}
        <div className="actions-row">
          <button type="submit" className="btn" style={{ minHeight: 48 }} disabled={busy || !projectId || !siteId || lines.length === 0} data-testid="mrn-save">{t('p.saveDraft')}</button>
          <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy || !projectId || !siteId || lines.length === 0} onClick={() => save(true)} data-testid="mrn-send">{t('p.send')}</button>
        </div>
      </form>
    </section>
  );
}
