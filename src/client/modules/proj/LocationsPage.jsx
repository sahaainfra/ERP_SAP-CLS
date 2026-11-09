import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { st } from './api.js';
import ProjectPicker from './ProjectPicker.jsx';
import { useSearch } from './parts.jsx';

// Location Breakdown (part 10.03, FR-04): the places of a project: blocks, buildings, floors, zones or flats and rooms for a building project, chainage segments (from-to) and structures such as culverts and bridges for a linear one, each with an
// optional map reference. A tree for buildings and a chainage table for roads; drag a location onto another to move it (the server checks what may sit under what and that chainage segments do not overlap); a location in use is deactivated, not deleted.
const orderedLoc = (nodes) => {
  const kids = new Map(); for (const n of nodes) { const k = n.parentId ?? 0; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(n); }
  const out = []; const walk = (pid) => { for (const n of kids.get(pid) ?? []) { out.push(n); walk(n.id); } }; walk(0); return out;
};
const blank = (parentId = null) => ({ parentId, type: 'BUILDING', code: '', name: '', chainageFrom: '', chainageTo: '', lat: '', lng: '', description: '' });
const km = (m) => (m == null ? '—' : `${Math.floor(m / 1000)}+${String(m % 1000).padStart(3, '0')}`);
export default function LocationsPage() {
  const t = useT('proj');
  usePageTitle(t('loc.title'));
  const qc = useQueryClient();
  const projectId = Number(useSearch().get('projectId')) || null;
  const q = useQuery({ queryKey: ['proj', 'locations', projectId], queryFn: () => st.locations(projectId), enabled: Boolean(projectId), retry: false });
  const [error, setError] = useState(null); const [note, setNote] = useState(null); const [edit, setEdit] = useState(null); const [drag, setDrag] = useState(null); const [view, setView] = useState('tree');
  const head = <><h1 id="loc-h">{t('loc.title')}</h1><p className="muted">{t('loc.intro')}</p><ProjectPicker route="/proj/locations" projectId={projectId} testId="loc-project" /></>;
  if (!projectId) return <section aria-labelledby="loc-h" data-testid="loc-none">{head}</section>;
  if (q.error?.status === 403) return <NoPermission what={t('loc.title')} permission="proj.wbs.view" />;
  if (q.isPending) return <Skeleton label={t('loc.title')} rows={5} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const x = q.data; const rows = orderedLoc(x.nodes); const depth = (n) => { let d = 0; let p = n; while (p?.parentId) { p = x.nodes.find((y) => y.id === p.parentId); d += 1; } return d; };
  const run = async (fn, done) => { setError(null); setNote(null); try { const r = await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['proj'] }); return r ?? true; } catch (e) { setError(errorInfo(e)); return null; } };
  const onDrop = (e, target) => { e.preventDefault(); const id = Number(e.dataTransfer.getData('text/plain')) || drag; setDrag(null); if (id && id !== target) run(() => st.moveLoc(projectId, id, { parentId: target }), t('loc.moved')); };
  const allowed = (parent) => x.rules[parent?.type ?? ''] ?? [];
  return (
    <section aria-labelledby="loc-h" data-testid="locations">
      {head}
      {error?.form && <p className="field-error" role="alert" data-testid="loc-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 6).join('; ')}` : ''}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="loc-note">{note}</p>}
      <div className="actions-row no-print">
        {x.can.manage && <button type="button" className="btn btn-primary" onClick={() => setEdit(blank(null))} data-testid="loc-add-root">{t('loc.addRoot')}</button>}
        <button type="button" className={`btn${view === 'tree' ? ' btn-primary' : ''}`} onClick={() => setView('tree')} aria-pressed={view === 'tree'}>{t('loc.viewTree')}</button>
        <button type="button" className={`btn${view === 'chainage' ? ' btn-primary' : ''}`} onClick={() => setView('chainage')} aria-pressed={view === 'chainage'} data-testid="loc-view-chainage">{t('loc.viewChainage')}</button>
        {x.can.import && <Link to="/import">{t('wbs.import')}</Link>}
      </div>
      {edit && <LocForm x={x} f={edit} projectId={projectId} run={run} error={error} allowed={allowed(x.nodes.find((n) => n.id === edit.parentId))} done={() => setEdit(null)} />}
      {rows.length === 0 ? <div className="mdm-banner" data-testid="loc-empty"><strong>{t('loc.emptyTitle')}</strong> {t('loc.emptyText')}</div> : view === 'tree' ? (
        <div className="table-wrap" data-testid="loc-tree">
          <p className="small muted">{t('loc.legend')}</p>
          <table className="data-table"><caption className="sr-only">{t('loc.title')}</caption>
            <thead><tr><th scope="col">{t('wbs.code')}</th><th scope="col">{t('f.name')}</th><th scope="col">{t('f.type')}</th><th scope="col">{t('loc.chainage')}</th><th scope="col">{t('loc.map')}</th><th scope="col">{t('wbs.used')}</th><th scope="col" className="no-print">{t('wbs.actions')}</th></tr></thead>
            <tbody>{rows.map((n) => (
              <tr key={n.id} data-testid="loc-row" data-code={n.code} draggable={x.can.manage} onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(n.id)); setDrag(n.id); }} onDragOver={(e) => { if (x.can.manage && drag) e.preventDefault(); }} onDrop={(e) => onDrop(e, n.id)} className={n.status === 'INACTIVE' ? 'muted' : ''}>
                <td><span style={{ paddingInlineStart: `${depth(n) * 16}px` }}>{n.code}</span></td><td>{n.name}{n.status === 'INACTIVE' ? ` · ${t('wbs.inactive')}` : ''}</td><td>{n.typeLabel}</td>
                <td>{n.chainageFrom != null ? `${km(n.chainageFrom)}${n.chainageTo != null && n.chainageTo !== n.chainageFrom ? ` → ${km(n.chainageTo)}` : ''}` : '—'}</td>
                <td>{n.lat != null ? `${n.lat}, ${n.lng}` : '—'}</td><td>{n.usage || '—'}</td>
                <td className="no-print">{x.can.manage && <>
                  <button type="button" className="btn" onClick={() => setEdit({ ...n, chainageFrom: n.chainageFrom ?? '', chainageTo: n.chainageTo ?? '', lat: n.lat ?? '', lng: n.lng ?? '', description: n.description ?? '' })} data-testid={`loc-edit-${n.code}`}>{t('act.edit')}</button>
                  <button type="button" className="btn" onClick={() => setEdit(blank(n.id))} disabled={(x.rules[n.type] ?? []).length === 0} data-testid={`loc-child-${n.code}`}>{t('wbs.addChild')}</button>
                  {n.status === 'ACTIVE' ? <button type="button" className="btn" onClick={() => run(() => st.setLocStatus(projectId, n.id, false))}>{t('wbs.deactivate')}</button> : <button type="button" className="btn" onClick={() => run(() => st.setLocStatus(projectId, n.id, true))}>{t('wbs.activate')}</button>}
                  <button type="button" className="btn" onClick={() => { if (window.confirm(t('wbs.confirmDelete', { code: n.code }))) run(() => st.removeLoc(projectId, n.id), t('loc.deleted', { code: n.code })); }} data-testid={`loc-delete-${n.code}`}>{t('act.delete')}</button></>}</td>
              </tr>))}</tbody>
          </table>
          {x.can.manage && drag && <div className="mdm-banner" onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(e, null)}>{t('wbs.dropTop')}</div>}
        </div>
      ) : (
        <div className="table-wrap" data-testid="loc-chainage">
          <table className="data-table"><caption className="sr-only">{t('loc.viewChainage')}</caption>
            <thead><tr><th scope="col">{t('loc.from')}</th><th scope="col">{t('loc.to')}</th><th scope="col">{t('wbs.code')}</th><th scope="col">{t('f.name')}</th><th scope="col">{t('f.type')}</th><th scope="col">{t('loc.map')}</th></tr></thead>
            <tbody>{x.nodes.filter((n) => n.chainageFrom != null).sort((a, b) => a.chainageFrom - b.chainageFrom).map((n) => <tr key={n.id}><td>{km(n.chainageFrom)}</td><td>{km(n.chainageTo)}</td><td>{n.code}</td><td>{n.name}</td><td><StatusBadge status={n.type === 'STRUCTURE' ? 'IN_REVIEW' : 'ACTIVE'} label={n.typeLabel} /></td><td>{n.lat != null ? `${n.lat}, ${n.lng}` : '—'}</td></tr>)}</tbody>
          </table>
          {!x.linear && <p className="muted">{t('loc.noChainage')}</p>}
        </div>
      )}
      <p className="small"><Link to="/proj/wbs">{t('wbs.title')}</Link> · <Link to="/proj/work-packages">{t('wp.title')}</Link></p>
    </section>
  );
}
function LocForm({ x, f, projectId, run, error, allowed, done }) {
  const t = useT('proj'); const isNew = !f.id; const [v, setV] = useState({ ...f, type: isNew ? (allowed[0] ?? 'BUILDING') : f.type }); const set = (k, val) => setV((y) => ({ ...y, [k]: val }));
  const chain = ['CHAINAGE', 'STRUCTURE'].includes(v.type); const nn = (s) => (s === '' || s == null ? null : Number(s));
  const submit = async (e) => {
    e.preventDefault();
    const b = { type: v.type, code: v.code.trim(), name: v.name.trim(), chainageFrom: chain ? nn(v.chainageFrom) : null, chainageTo: chain ? nn(v.chainageTo) : null, lat: nn(v.lat), lng: nn(v.lng), description: String(v.description ?? '').trim() || null };
    if (isNew ? await run(() => st.createLoc(projectId, { parentId: v.parentId ?? null, ...b }), t('loc.created')) : await run(() => st.updateLoc(projectId, f.id, { ...b, version: f.rowVersion }), t('wbs.saved'))) done();
  };
  return (
    <form className="mdm-panel" onSubmit={submit} aria-label={isNew ? t('loc.add') : t('loc.edit')} data-testid="loc-form">
      <h2>{isNew ? t('loc.add') : t('loc.edit')}</h2>
      <div className="form-grid">
        <Field label={t('f.type')} name="type" error={error}><select value={v.type} onChange={(e) => set('type', e.target.value)} disabled={!isNew} data-testid="loc-f-type">{(isNew ? allowed : x.types.map((o) => o.code)).map((k) => <option key={k} value={k}>{x.types.find((o) => o.code === k)?.label ?? k}</option>)}</select></Field>
        <Field label={t('wbs.code')} name="code" error={error}><input value={v.code} onChange={(e) => set('code', e.target.value)} maxLength={40} required data-testid="loc-f-code" /></Field>
        <Field label={t('f.name')} name="name" error={error}><input value={v.name} onChange={(e) => set('name', e.target.value)} maxLength={200} required data-testid="loc-f-name" /></Field>
        {chain && <Field label={t('loc.fromM')} name="chainageFrom" error={error}><input inputMode="numeric" value={v.chainageFrom} onChange={(e) => set('chainageFrom', e.target.value)} data-testid="loc-f-from" /></Field>}
        {chain && <Field label={t('loc.toM')} name="chainageTo" error={error}><input inputMode="numeric" value={v.chainageTo} onChange={(e) => set('chainageTo', e.target.value)} data-testid="loc-f-to" /></Field>}
        <Field label={t('fa.lat')} name="lat" error={error}><input inputMode="decimal" value={v.lat} onChange={(e) => set('lat', e.target.value)} /></Field>
        <Field label={t('fa.lng')} name="lng" error={error}><input inputMode="decimal" value={v.lng} onChange={(e) => set('lng', e.target.value)} /></Field>
      </div>
      {error?.form && <p className="field-error" role="alert">{error.form}</p>}
      <div className="actions"><button type="button" className="btn" onClick={done}>{t('act.close')}</button><button type="submit" className="btn btn-primary" data-testid="loc-f-save">{t('bl.save')}</button></div>
    </form>
  );
}
