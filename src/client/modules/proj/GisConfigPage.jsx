import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { CFG_TONE, GIS_LTYPES, downloadFile, gs } from './api.js';
import ProjectPicker from './ProjectPicker.jsx';
import { useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Layers and Overlays (part 10.07, FR-02, FR-06, AC-04): the custom layers (GeoJSON or KML pasted or typed) and the georeferenced plan overlays of a project. Every new or changed layer and overlay is a proposal: the live map keeps the approved content
// until the project manager, not the maker, approves the change; each change is audited and has its history.
export default function GisConfigPage() {
  const t = useT('proj');
  const qc = useQueryClient();
  const session = useSession(); const perms = session.data?.permissions ?? [];
  const projectId = Number(useSearch().get('projectId')) || null;
  usePageTitle(t('gis.configTitle'));
  const ly = useQuery({ queryKey: ['proj', 'gislayers', projectId], queryFn: () => gs.layers(projectId), enabled: Boolean(projectId), retry: false });
  const ov = useQuery({ queryKey: ['proj', 'gisoverlays', projectId], queryFn: () => gs.overlays(projectId), enabled: Boolean(projectId), retry: false });
  const [error, setError] = useState(null); const [note, setNote] = useState(null);
  const [f, setF] = useState({ name: '', ltype: 'BOUNDARY', format: 'geojson', content: '' });
  const [o, setO] = useState({ name: '', imageUrl: '', s: '', w: '', n: '', e: '', opacity: 70 });
  const run = async (fn, done) => { setError(null); setNote(null); try { await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['proj'] }); return true; } catch (e) { setError(errorInfo(e)); return false; } };
  const why = (fn, done) => { const r = window.prompt(t('act.why')); if (r) run(() => fn(r), done); };
  const head = <header><PageHeader id="gisc-h" title={t('gis.configTitle')} /><div className="actions-row no-print"><ProjectPicker route="/proj/gis-config" projectId={projectId} testId="gisc-project" /><Link to={projectId ? `/proj/map?projectId=${projectId}` : '/proj/map'}>{t('gis.mapTitle')}</Link></div></header>;
  if (!projectId) return <section aria-labelledby="gisc-h" data-testid="gis-config">{head}<p className="muted">{t('gis.chooseProject')}</p></section>;
  if (ly.error?.status === 403) return <NoPermission what={t('gis.configTitle')} permission="proj.gis.view" />;
  if (ly.isPending || ov.isPending) return <Skeleton label={t('gis.configTitle')} rows={5} />;
  if (ly.isError) return <ErrorState error={ly.error} onRetry={ly.refetch} />;
  const addLayer = (e) => { e.preventDefault(); run(async () => { await gs.importLayer({ projectId, name: f.name.trim(), ltype: f.ltype, format: f.format, content: f.content }); setF({ ...f, name: '', content: '' }); }, t('gis.layerProposed')); };
  const addOverlay = (e) => { e.preventDefault(); run(async () => { await gs.createOverlay({ projectId, name: o.name.trim(), imageUrl: o.imageUrl.trim(), bounds: [[Number(o.s), Number(o.w)], [Number(o.n), Number(o.e)]], opacity: Number(o.opacity) }); setO({ ...o, name: '', imageUrl: '' }); }, t('gis.overlayProposed')); };
  const actions = (act, remove, r, base) => (
    <>
      {r.can.submit && <button type="button" className="btn" onClick={() => run(() => act(r.id, 'submit'), t('gis.sent'))} data-testid={`${base}-submit-${r.id}`}>{t('act.submit')}</button>}
      {r.can.withdraw && <button type="button" className="btn" onClick={() => why((w) => act(r.id, 'withdraw', { reason: w }), t('gis.withdrawn'))}>{t('act.withdraw')}</button>}
      {r.can.cancel && <button type="button" className="btn" onClick={() => why((w) => act(r.id, 'cancel', { reason: w }), t('gis.cancelled'))}>{t('act.cancel')}</button>}
      {r.can.delete && <button type="button" className="btn" onClick={() => run(() => remove(r.id))}>{t('act.delete')}</button>}
    </>
  );
  return (
    <section aria-labelledby="gisc-h" data-testid="gis-config">
      {head}
      {error?.form && <p className="field-error" role="alert" data-testid="gisc-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 4).join('; ')}` : ''}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="gisc-note">{note}</p>}
      <p className="muted">{t('gis.configHelp')}</p>
      <div className="mdm-panel" data-testid="gisc-layers"><h2>{t('gis.layers')}</h2>
        {ly.data.length === 0 ? <p className="muted" data-testid="gisc-layers-empty">{t('gis.layersEmpty')}</p> : (
          <table className="data-table"><thead><tr><th scope="col">{t('gis.col.name')}</th><th scope="col">{t('f.type')}</th><th scope="col">{t('gis.col.status')}</th><th scope="col">{t('gis.features', { n: '' })}</th><th scope="col"><span className="sr-only">{t('act.actions')}</span></th></tr></thead>
            <tbody>{ly.data.map((r) => (
              <tr key={r.id} data-testid={`gisc-layer-${r.name}`} data-status={r.status} data-live={r.live ? '1' : '0'}><td>{r.name}{r.hasPending && r.live ? ` · ${t('gis.changePending')}` : ''}</td><td>{r.ltypeLabel}</td><td><StatusBadge status={CFG_TONE[r.status]} label={r.statusLabel} /></td><td>{r.live ? r.features : '—'}{r.pendingFeatures != null ? ` → ${r.pendingFeatures}` : ''}</td>
                <td>{actions(gs.layerAct, gs.removeLayer, r, 'gisc-layer')}{r.can.export && ['geojson', 'kml'].map((fmt) => <button key={fmt} type="button" className="btn" onClick={() => downloadFile(`/gis/layers/${r.id}/export?format=${fmt}`, `${r.name}.${fmt}`)}>{fmt.toUpperCase()}</button>)}</td></tr>
            ))}</tbody></table>
        )}
        {perms.includes('proj.gis.import') && (
          <form aria-label={t('gis.addLayer')} data-testid="gisc-layer-form" onSubmit={addLayer}><h3>{t('gis.addLayer')}</h3>
            <div className="form-grid">
              <Field label={t('gis.col.name')} name="name" error={error}><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={120} data-testid="gisc-f-name" /></Field>
              <Field label={t('f.type')} name="ltype" error={error}><select value={f.ltype} onChange={(e) => setF({ ...f, ltype: e.target.value })} data-testid="gisc-f-type">{GIS_LTYPES.map((k) => <option key={k} value={k}>{t(`gis.lt.${k}`)}</option>)}</select></Field>
              <Field label={t('gis.format')} name="format" error={error}><select value={f.format} onChange={(e) => setF({ ...f, format: e.target.value })} data-testid="gisc-f-format"><option value="geojson">GeoJSON</option><option value="kml">KML</option></select></Field>
              <Field label={t('gis.content')} name="content" error={error}><textarea value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} rows={6} maxLength={45000} required data-testid="gisc-f-content" /></Field>
            </div>
            <div className="actions"><button type="submit" className="btn btn-primary" disabled={f.name.trim().length < 2 || f.content.trim().length < 2} data-testid="gisc-f-save">{t('gis.propose')}</button></div>
          </form>
        )}
      </div>
      <div className="mdm-panel" data-testid="gisc-overlays"><h2>{t('gis.overlays')}</h2>
        {ov.data.length === 0 ? <p className="muted" data-testid="gisc-overlays-empty">{t('gis.overlaysEmpty')}</p> : (
          <table className="data-table"><thead><tr><th scope="col">{t('gis.col.name')}</th><th scope="col">{t('gis.col.status')}</th><th scope="col">{t('gis.opacity')}</th><th scope="col"><span className="sr-only">{t('act.actions')}</span></th></tr></thead>
            <tbody>{ov.data.map((r) => <tr key={r.id} data-testid={`gisc-overlay-${r.name}`} data-status={r.status}><td>{r.name}</td><td><StatusBadge status={CFG_TONE[r.status]} label={r.statusLabel} /></td><td>{r.opacity}%</td><td>{actions(gs.overlayAct, gs.removeOverlay, r, 'gisc-overlay')}</td></tr>)}</tbody></table>
        )}
        {perms.includes('proj.gis.create') && (
          <form aria-label={t('gis.addOverlay')} data-testid="gisc-overlay-form" onSubmit={addOverlay}><h3>{t('gis.addOverlay')}</h3>
            <div className="form-grid">
              <Field label={t('gis.col.name')} name="name" error={error}><input value={o.name} onChange={(e) => setO({ ...o, name: e.target.value })} required maxLength={120} data-testid="gisc-o-name" /></Field>
              <Field label={t('gis.imageUrl')} name="imageUrl" error={error}><input value={o.imageUrl} onChange={(e) => setO({ ...o, imageUrl: e.target.value })} required data-testid="gisc-o-url" /></Field>
              {[['s', 'gis.south'], ['w', 'gis.west'], ['n', 'gis.north'], ['e', 'gis.east']].map(([k, l]) => <Field key={k} label={t(l)} name="bounds" error={error}><input value={o[k]} onChange={(e) => setO({ ...o, [k]: e.target.value })} inputMode="decimal" required data-testid={`gisc-o-${k}`} /></Field>)}
              <Field label={t('gis.opacity')} name="opacity" error={error}><input type="number" min="5" max="100" value={o.opacity} onChange={(e) => setO({ ...o, opacity: e.target.value })} data-testid="gisc-o-opacity" /></Field>
            </div>
            <div className="actions"><button type="submit" className="btn btn-primary" disabled={o.name.trim().length < 2 || !o.imageUrl || [o.s, o.w, o.n, o.e].some((v) => v === '')} data-testid="gisc-o-save">{t('gis.propose')}</button></div>
          </form>
        )}
      </div>
    </section>
  );
}
