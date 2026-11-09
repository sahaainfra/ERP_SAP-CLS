import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { writeExport, FORMATS } from '../../platform/export/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { createParameterStore, parameterRegistry } from '../../platform/parameters/index.js';
import { evidenceProviders, workflowOf, workflowResolvers, workflowTypes } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { GIS_CFG_STATUS, GIS_DOC, GIS_LTYPES, HUNDRED, PUNCH_MIN_PEOPLE, esc, json, nowIso, rid, same } from './constants.js';

// GIS, site maps and location intelligence (part 10.07). A project has a map: its sites with their geofences, the location breakdown with coordinates and chainages, custom layers (boundaries, alignments, work fronts, stores, camps, equipment) as GeoJSON,
// georeferenced plan overlays, and points that other modules offer (DPR photos, inspections, NCRs, incidents) through a registry. Layers and overlays are configuration: a change waits as a proposal and goes live only when the project manager (not the maker)
// approves it, and every change is audited. Progress by location and chainage gives the heatmap and the linear strip chart. Punches are shown only as aggregates of at least five people per cell (BR-01). KML and GeoJSON are imported and exported.
for (const [key, dataType, def, description] of [
  ['gis.tile_url', 'string', 'NONE', 'FR-01: the address template of the base-map tiles, such as https://tile.openstreetmap.org/{z}/{x}/{y}.png; NONE (the default) means no base map: the vector layers, overlays and the list still work. The tile host must also be allowed in img-src of the content security policy (02.07), an approved security-settings change.'],
  ['gis.tile_attribution', 'string', 'Map data © OpenStreetMap contributors', 'FR-01: the attribution shown with the base map.'],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType, default: def, scopes: ['system', 'company'], description });

/** FR-03: what the modules that hold located records offer to the map: { code, label, ownerModule, query?: (db, { companyId, projectId }) => [{ id, lat, lng, title, status, date, route }] }. A provider without a query is listed as "not live yet". */
export const pointProviders = /** @type {Array<{ code: string, label: string, ownerModule: string, query?: (db: any, ctx: { companyId: number, projectId: number }) => Array<{ id: string|number, lat: number, lng: number, title: string, status?: string, date?: string, route: string }> }>} */ ([
  { code: 'dpr', label: 'DPR photos', ownerModule: 'site (14.02)' }, { code: 'inspection', label: 'Inspections', ownerModule: 'quality' }, { code: 'ncr', label: 'NCRs', ownerModule: 'quality' }, { code: 'incident', label: 'Incidents', ownerModule: 'hse' }, { code: 'equipment', label: 'Equipment (last known)', ownerModule: 'equipment (17.x)' },
]);

// ---- GeoJSON and KML --------------------------------------------------------------------------------------------------------------------------------------
const GTYPES = new Set(['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon']);
function posOk(p) { return Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number' && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90; }
function coordsOk(t, c) {
  if (t === 'Point') return posOk(c);
  if (t === 'MultiPoint' || t === 'LineString') return Array.isArray(c) && c.length >= (t === 'LineString' ? 2 : 1) && c.every(posOk);
  if (t === 'MultiLineString' || t === 'Polygon') return Array.isArray(c) && c.length >= 1 && c.every((l) => Array.isArray(l) && l.length >= (t === 'Polygon' ? 4 : 2) && l.every(posOk));
  return Array.isArray(c) && c.length >= 1 && c.every((p) => Array.isArray(p) && p.every((l) => Array.isArray(l) && l.length >= 4 && l.every(posOk)));
}
/** A valid FeatureCollection (a Feature or a bare geometry is wrapped); coordinates are [longitude, latitude]. Returns { value, problems }. */
export function normaliseGeo(input) {
  const problems = []; let o = input;
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch { return { value: null, problems: ['The GeoJSON is not valid JSON'] }; } }
  if (!o || typeof o !== 'object') return { value: null, problems: ['The GeoJSON is empty'] };
  let features;
  if (o.type === 'FeatureCollection' && Array.isArray(o.features)) features = o.features;
  else if (o.type === 'Feature') features = [o];
  else if (GTYPES.has(o.type)) features = [{ type: 'Feature', properties: {}, geometry: o }];
  else return { value: null, problems: ['Use a FeatureCollection, a Feature or a geometry'] };
  if (features.length > 2000) problems.push('At most 2000 features');
  const out = features.slice(0, 2000).map((f, i) => {
    const g = f?.geometry;
    if (f?.type !== 'Feature' || !g || !GTYPES.has(g.type)) { problems.push(`Feature ${i + 1}: use a Point, LineString, Polygon or their Multi forms`); return null; }
    if (!coordsOk(g.type, g.coordinates)) { problems.push(`Feature ${i + 1}: the coordinates are [longitude, latitude] within -180..180 and -90..90`); return null; }
    const props = f.properties && typeof f.properties === 'object' ? Object.fromEntries(Object.entries(f.properties).filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v) || v === null).slice(0, 30).map(([k, v]) => [k.slice(0, 60), typeof v === 'string' ? v.slice(0, 300) : v])) : {};
    return { type: 'Feature', properties: props, geometry: { type: g.type, coordinates: g.coordinates } };
  }).filter(Boolean);
  return { value: { type: 'FeatureCollection', features: out }, problems };
}
const num = (s) => Number(String(s).trim());
const ring = (txt) => txt.trim().split(/\s+/).map((t) => t.split(',').map(num)).filter((p) => p.length >= 2 && p.every(Number.isFinite)).map(([lng, lat, alt]) => (alt === undefined ? [lng, lat] : [lng, lat, alt]));
const tagText = (s, tag) => [...s.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi'))].map((m) => m[1]);
const unCdata = (s) => String(s ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();
/** KML (Placemark with Point, LineString, Polygon) to GeoJSON. */
export function kmlToGeo(kml) {
  const feats = [];
  for (const pm of tagText(kml, 'Placemark')) {
    const name = unCdata(tagText(pm, 'name')[0]); const desc = unCdata(tagText(pm, 'description')[0]); const geoms = [];
    for (const p of tagText(pm, 'Point')) { const c = ring(tagText(p, 'coordinates')[0] ?? ''); if (c[0]) geoms.push({ type: 'Point', coordinates: c[0] }); }
    for (const l of tagText(pm, 'LineString')) { const c = ring(tagText(l, 'coordinates')[0] ?? ''); if (c.length >= 2) geoms.push({ type: 'LineString', coordinates: c }); }
    for (const pg of tagText(pm, 'Polygon')) { const rings = [...tagText(pg, 'outerBoundaryIs'), ...tagText(pg, 'innerBoundaryIs')].map((r) => ring(tagText(r, 'coordinates')[0] ?? '')).filter((r) => r.length >= 4); if (rings.length) geoms.push({ type: 'Polygon', coordinates: rings }); }
    const g = geoms.length === 1 ? geoms[0] : geoms.length > 1 ? { type: 'GeometryCollection', geometries: geoms } : null;
    if (!g) continue;
    for (const one of g.type === 'GeometryCollection' ? g.geometries : [g]) feats.push({ type: 'Feature', properties: { name, ...(desc ? { description: desc } : {}) }, geometry: one });
  }
  return { type: 'FeatureCollection', features: feats };
}
export function geoToKml(name, fc) {
  const pos = (p) => `${p[0]},${p[1]}`; const ringK = (r) => r.map(pos).join(' ');
  const geomK = (g) => (g.type === 'Point' ? `<Point><coordinates>${pos(g.coordinates)}</coordinates></Point>`
    : g.type === 'LineString' ? `<LineString><coordinates>${ringK(g.coordinates)}</coordinates></LineString>`
      : g.type === 'Polygon' ? `<Polygon><outerBoundaryIs><LinearRing><coordinates>${ringK(g.coordinates[0])}</coordinates></LinearRing></outerBoundaryIs>${g.coordinates.slice(1).map((r) => `<innerBoundaryIs><LinearRing><coordinates>${ringK(r)}</coordinates></LinearRing></innerBoundaryIs>`).join('')}</Polygon>`
        : g.type === 'MultiPoint' ? g.coordinates.map((c) => geomK({ type: 'Point', coordinates: c })).join('')
          : g.type === 'MultiLineString' ? g.coordinates.map((c) => geomK({ type: 'LineString', coordinates: c })).join('')
            : g.coordinates.map((c) => geomK({ type: 'Polygon', coordinates: c })).join(''));
  const multi = (g) => g.type.startsWith('Multi');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(name)}</name>${fc.features.map((f) => `<Placemark><name>${esc(f.properties?.name ?? '')}</name>${f.properties?.description ? `<description>${esc(f.properties.description)}</description>` : ''}${multi(f.geometry) ? `<MultiGeometry>${geomK(f.geometry)}</MultiGeometry>` : geomK(f.geometry)}</Placemark>`).join('')}</Document></kml>\n`;
}

const services = new WeakMap();
export const bindGis = (db, s) => services.set(db, s);
export const gisOf = (db) => services.get(db) ?? null;
/** @type {Array<[number, number, string]>} */
const BANDS = [[0, 25, 'danger'], [25, 50, 'warning'], [50, 75, 'info'], [75, 100.0001, 'success']];
const bandOf = (pct) => BANDS.find(([a, b]) => pct >= a && pct < b)?.[2] ?? 'muted';

export function createGisService({ db }) {
  const authz = authzOf(db);
  const may = (actor, key, pid = null) => (pid == null ? authz.check(actor, key).allowed : authz.check(actor, key, { companyId: actor.companyId, projectId: pid }).allowed);
  const need = (actor, key, what, pid = null) => { if (!may(actor, key, pid)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const fail = (p) => { if (p.length) throw badRequest('Correct the highlighted fields', p.map((m) => (typeof m === 'string' ? { field: 'geojson', message: m } : m))); };
  const event = (type, actor, entity, id, companyId, projectId, data) => publishEvent(db, { type, entity, entityId: id, actorId: actor.user, companyId, projectId, data });
  const orgOf = (id) => db.prepare('SELECT * FROM org_projects WHERE id = ?').get(id);
  const roles = (actor) => (Array.isArray(actor.roles) ? actor.roles : String(actor.roles ?? '').split(',')).map((r) => String(r).trim()).filter(Boolean);
  function project(actor, projectId, key = 'proj.gis.view') {
    const o = orgOf(Number(projectId));
    if (!o || o.company_id !== actor.companyId || !db.prepare('SELECT 1 FROM proj_projects WHERE project_id = ? AND deleted_at IS NULL').get(o.id) || !may(actor, 'proj.gis.view', o.id)) throw notFound('That project does not exist.');
    if (key !== 'proj.gis.view') need(actor, key, 'do that with the map', o.id);
    return o;
  }

  // ---- layers and overlays: configuration with a proposal and an approval -------------------------------------------------------------------------------
  const KINDS = { L: { table: 'gis_layers', label: 'layer', entity: 'gis_layers' }, O: { table: 'gis_overlays', label: 'overlay', entity: 'gis_overlays' } };
  const rowOf = (k, actor, id, key = 'proj.gis.view') => {
    const r = db.prepare(`SELECT * FROM ${KINDS[k].table} WHERE id = ? AND company_id = ? AND deleted_at IS NULL`).get(rid(id), actor.companyId);
    if (!r || !may(actor, 'proj.gis.view', r.org_project_id)) throw notFound(`That ${KINDS[k].label} does not exist.`);
    if (key !== 'proj.gis.view') need(actor, key, `change a ${KINDS[k].label}`, r.org_project_id);
    return r;
  };
  const fresh = (k, id) => db.prepare(`SELECT * FROM ${KINDS[k].table} WHERE id = ?`).get(id);
  const editable = (r) => ['DRAFT', 'RETURNED', 'REJECTED'].includes(r.cfg_status) || (r.cfg_status === 'APPROVED');
  const layerContent = (r) => ({ geojson: json(r.geojson, { type: 'FeatureCollection', features: [] }), style: json(r.style_json, {}), visibleRoles: json(r.visible_roles_json, []) });
  const layerView = (actor, r) => {
    const pend = r.pending_json ? json(r.pending_json, null) : null; const live = r.has_live === 1; const can = (k) => may(actor, k, r.org_project_id);
    return { id: r.id, projectId: r.org_project_id, name: r.name, ltype: r.ltype, ltypeLabel: GIS_LTYPES[r.ltype], status: r.cfg_status, statusLabel: GIS_CFG_STATUS[r.cfg_status], live, revision: r.revision, effectiveFrom: r.effective_from, approvedAt: r.approved_at, requestedBy: r.requested_by, workflowInstanceId: r.workflow_instance_id, rowVersion: r.version,
      features: live ? layerContent(r).geojson.features.length : 0, pendingFeatures: pend ? pend.geojson.features.length : null, hasPending: Boolean(pend), style: live ? layerContent(r).style : (pend?.style ?? {}), visibleRoles: live ? layerContent(r).visibleRoles : (pend?.visibleRoles ?? []),
      can: { edit: can('proj.gis.edit') && editable(r), submit: can('proj.gis.submit') && ['DRAFT', 'RETURNED', 'REJECTED'].includes(r.cfg_status) && Boolean(pend), withdraw: r.cfg_status === 'SUBMITTED' && same(r.requested_by, actor.user), cancel: can('proj.gis.cancel') && ['DRAFT', 'RETURNED', 'REJECTED', 'SUBMITTED'].includes(r.cfg_status), delete: can('proj.gis.delete') && !live && ['DRAFT', 'RETURNED', 'REJECTED', 'CANCELLED'].includes(r.cfg_status), export: can('proj.gis.export') } };
  };
  const overlayContent = (r) => ({ imageUrl: r.image_url, fileId: r.file_id, bounds: json(r.bounds_json, null), opacity: r.opacity });
  const overlayView = (actor, r) => {
    const pend = r.pending_json ? json(r.pending_json, null) : null; const live = r.has_live === 1; const can = (k) => may(actor, k, r.org_project_id); const c = live ? overlayContent(r) : (pend ?? overlayContent(r));
    return { id: r.id, projectId: r.org_project_id, name: r.name, imageUrl: c.imageUrl, fileId: c.fileId ?? null, bounds: c.bounds, opacity: c.opacity, status: r.cfg_status, statusLabel: GIS_CFG_STATUS[r.cfg_status], live, revision: r.revision, effectiveFrom: r.effective_from, approvedAt: r.approved_at, requestedBy: r.requested_by, workflowInstanceId: r.workflow_instance_id, rowVersion: r.version, hasPending: Boolean(pend),
      can: { edit: can('proj.gis.edit') && editable(r), submit: can('proj.gis.submit') && ['DRAFT', 'RETURNED', 'REJECTED'].includes(r.cfg_status) && Boolean(pend), withdraw: r.cfg_status === 'SUBMITTED' && same(r.requested_by, actor.user), cancel: can('proj.gis.cancel') && ['DRAFT', 'RETURNED', 'REJECTED', 'SUBMITTED'].includes(r.cfg_status), delete: can('proj.gis.delete') && !live && ['DRAFT', 'RETURNED', 'REJECTED', 'CANCELLED'].includes(r.cfg_status) } };
  };
  const view = (k, actor, r) => (k === 'L' ? layerView(actor, r) : overlayView(actor, r));

  function cfgSubmit(k, actor, id) {
    const r = rowOf(k, actor, id, 'proj.gis.submit'); if (!['DRAFT', 'RETURNED', 'REJECTED'].includes(r.cfg_status) || !r.pending_json) throw unprocessable('Only a proposal that is not yet sent is submitted.');
    return transaction(db, () => {
      const docId = `${k}:${r.id}:${r.version}`; const ctx = { projectId: r.org_project_id };
      if (r.cfg_status === 'RETURNED' && r.workflow_instance_id) workflowOf(db).resubmit(actor, r.workflow_instance_id, { comment: 'Corrected', context: ctx });
      else { const inst = workflowOf(db).submit(actor, { docType: GIS_DOC, docId, comment: `${orgOf(r.org_project_id).code} ${KINDS[k].label} ${r.name}`, context: ctx }); db.prepare(`UPDATE ${KINDS[k].table} SET workflow_instance_id = ? WHERE id = ?`).run(inst.id, r.id); }
      db.prepare(`UPDATE ${KINDS[k].table} SET cfg_status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(actor.user, actor.user, nowIso(), r.id);
      writeAudit(db, { entity: KINDS[k].entity, entityId: r.id, action: 'submit', actor: actor.user, companyId: r.company_id });
      return view(k, actor, fresh(k, r.id));
    });
  }
  function cfgWithdraw(k, actor, id, { reason }) { const r = rowOf(k, actor, id); if (r.cfg_status !== 'SUBMITTED') throw unprocessable('Only a proposal waiting for approval is withdrawn.'); if (!same(r.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, r.workflow_instance_id, { comment: reason }); return view(k, actor, fresh(k, r.id)); }
  function cfgCancel(k, actor, id, { reason }) {
    const r = rowOf(k, actor, id, 'proj.gis.cancel'); if (!['DRAFT', 'RETURNED', 'REJECTED', 'SUBMITTED'].includes(r.cfg_status)) throw unprocessable('Only a proposal that is not approved is cancelled.');
    return transaction(db, () => {
      if (r.cfg_status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, r.workflow_instance_id, actor.user, 'CANCELLED', reason);
      const back = r.has_live === 1 ? 'APPROVED' : 'CANCELLED';
      db.prepare(`UPDATE ${KINDS[k].table} SET cfg_status = ?, pending_json = NULL, workflow_instance_id = NULL, remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(back, reason, actor.user, nowIso(), r.id);
      writeAudit(db, { entity: KINDS[k].entity, entityId: r.id, action: 'cancel', reason, actor: actor.user, companyId: r.company_id });
      return view(k, actor, fresh(k, r.id));
    });
  }
  function cfgRemove(k, actor, id) {
    const r = rowOf(k, actor, id, 'proj.gis.delete'); if (r.has_live === 1) throw unprocessable(`An approved ${KINDS[k].label} is not deleted; propose a change or cancel the proposal.`); if (r.cfg_status === 'SUBMITTED') throw unprocessable('A proposal waiting for approval is withdrawn first.');
    db.prepare(`UPDATE ${KINDS[k].table} SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?`).run(nowIso(), actor.user, r.id); writeAudit(db, { entity: KINDS[k].entity, entityId: r.id, action: 'delete', actor: actor.user, companyId: r.company_id }); return { id: r.id, deleted: true };
  }
  function cfgHistory(k, actor, id) { const r = rowOf(k, actor, id); return { approvals: r.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(r.workflow_instance_id) : [], audit: db.prepare('SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = ? AND entity_id = ? ORDER BY id').all(KINDS[k].entity, String(r.id)) }; }
  /** The workflow decided on a proposal: an approval makes the proposal the live content (from today); a rejection or return leaves the live content as it was. */
  function cfgDecide(instance, actor, outcome, comment) {
    const [k, sid] = String(instance.docId).split(':'); if (!KINDS[k]) return; const r = fresh(k, rid(sid)); if (!r || r.cfg_status !== 'SUBMITTED') return;
    const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN'; const now = nowIso();
    if (outcome === 'APPROVED') {
      const p = json(r.pending_json, null); if (!p) return;
      if (k === 'L') db.prepare("UPDATE gis_layers SET geojson = ?, style_json = ?, visible_roles_json = ?, name = ?, ltype = ?, has_live = 1, pending_json = NULL, cfg_status = 'APPROVED', revision = revision + 1, effective_from = ?, approved_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(JSON.stringify(p.geojson), JSON.stringify(p.style), JSON.stringify(p.visibleRoles), p.name ?? r.name, p.ltype ?? r.ltype, todayIST(), now, actor.user, now, r.id);
      else db.prepare("UPDATE gis_overlays SET image_url = ?, file_id = ?, bounds_json = ?, opacity = ?, name = ?, has_live = 1, pending_json = NULL, cfg_status = 'APPROVED', revision = revision + 1, effective_from = ?, approved_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(p.imageUrl, p.fileId ?? null, JSON.stringify(p.bounds), p.opacity, p.name ?? r.name, todayIST(), now, actor.user, now, r.id);
    } else {
      const to = withdrawn ? 'DRAFT' : outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : 'CANCELLED';
      db.prepare(`UPDATE ${KINDS[k].table} SET cfg_status = ?, workflow_instance_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(to, withdrawn ? null : r.workflow_instance_id, actor.user, now, r.id);
    }
    writeAudit(db, { entity: KINDS[k].entity, entityId: r.id, action: outcome.toLowerCase(), reason: comment ?? null, actor: actor.user, companyId: r.company_id });
    if (outcome === 'APPROVED') event('proj.gis.config_approved', actor, KINDS[k].entity, r.id, r.company_id, r.org_project_id, { projectId: r.org_project_id, kind: KINDS[k].label, id: r.id, name: r.name });
  }

  const layers = {
    list(actor, projectId) { const o = project(actor, projectId); return db.prepare('SELECT * FROM gis_layers WHERE org_project_id = ? AND deleted_at IS NULL ORDER BY name').all(o.id).filter((r) => r.has_live === 1 || may(actor, 'proj.gis.edit', o.id)).map((r) => layerView(actor, r)); },
    get(actor, id) { const r = rowOf('L', actor, id); const v = layerView(actor, r); const p = r.pending_json ? json(r.pending_json, null) : null; return { ...v, geojson: layerContent(r).geojson, pendingGeojson: p?.geojson ?? null }; },
    create(actor, b) {
      const o = project(actor, b.projectId, 'proj.gis.create'); const g = normaliseGeo(b.geojson); fail(g.problems);
      if (db.prepare('SELECT 1 FROM gis_layers WHERE org_project_id = ? AND name = ? COLLATE NOCASE AND deleted_at IS NULL').get(o.id, b.name)) throw conflict(`The project has a layer named "${b.name}" already.`);
      return transaction(db, () => {
        const id = Number(db.prepare("INSERT INTO gis_layers (company_id, org_project_id, name, ltype, pending_json, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, 'gis_layers')").run(actor.companyId, o.id, b.name, b.ltype, JSON.stringify({ geojson: g.value, style: b.style, visibleRoles: b.visibleRoles }), o.id, actor.user).lastInsertRowid);
        writeAudit(db, { entity: 'gis_layers', entityId: id, action: 'create', newValues: { name: b.name, ltype: b.ltype, features: g.value.features.length }, actor: actor.user, companyId: actor.companyId });
        return layers.get(actor, id);
      });
    },
    update(actor, id, b) {
      const r = rowOf('L', actor, id, 'proj.gis.edit'); if (!editable(r)) throw conflict('A proposal waiting for approval is not edited; withdraw it first.');
      if (b.rowVersion != null && b.rowVersion !== r.version) throw conflict(`The layer was changed by someone else (version ${r.version}, you had ${b.rowVersion}); reload it.`);
      const base = r.pending_json ? json(r.pending_json, null) : layerContent(r); let geojson = base.geojson;
      if (b.geojson !== undefined) { const g = normaliseGeo(b.geojson); fail(g.problems); geojson = g.value; }
      if (b.name && b.name !== r.name && db.prepare('SELECT 1 FROM gis_layers WHERE org_project_id = ? AND name = ? COLLATE NOCASE AND deleted_at IS NULL AND id <> ?').get(r.org_project_id, b.name, r.id)) throw conflict(`The project has a layer named "${b.name}" already.`);
      const pend = { geojson, style: b.style ?? base.style, visibleRoles: b.visibleRoles ?? base.visibleRoles, name: b.name ?? r.name, ltype: b.ltype ?? r.ltype };
      db.prepare("UPDATE gis_layers SET pending_json = ?, cfg_status = CASE WHEN cfg_status = 'APPROVED' THEN 'DRAFT' ELSE cfg_status END, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(JSON.stringify(pend), actor.user, nowIso(), r.id);
      if (r.has_live !== 1) db.prepare('UPDATE gis_layers SET name = ?, ltype = ? WHERE id = ?').run(pend.name, pend.ltype, r.id);
      writeAudit(db, { entity: 'gis_layers', entityId: r.id, action: 'propose', newValues: { features: geojson.features.length, name: pend.name }, actor: actor.user, companyId: r.company_id });
      return layers.get(actor, r.id);
    },
    remove: (actor, id) => cfgRemove('L', actor, id), submit: (actor, id) => cfgSubmit('L', actor, id), withdraw: (actor, id, b) => cfgWithdraw('L', actor, id, b), cancel: (actor, id, b) => cfgCancel('L', actor, id, b), history: (actor, id) => cfgHistory('L', actor, id),
    /** FR-06: a GeoJSON or KML file becomes the proposed content of a new layer. */
    import(actor, b) {
      let g; if (b.format === 'kml') { if (!/<kml[\s>]/i.test(b.content)) throw badRequest('That is not a KML file', [{ field: 'content', message: 'A KML file starts with <kml>' }]); g = kmlToGeo(b.content); if (!g.features.length) throw badRequest('The KML file has no Placemark with a point, line or polygon', [{ field: 'content', message: 'Nothing to import' }]); } else g = b.content;
      const out = layers.create(actor, { projectId: b.projectId, name: b.name, ltype: b.ltype, geojson: g, style: b.style, visibleRoles: b.visibleRoles });
      writeAudit(db, { entity: 'gis_layers', entityId: out.id, action: 'import', newValues: { format: b.format, features: out.pendingFeatures }, actor: actor.user, companyId: actor.companyId }); return out;
    },
    export(actor, id, format = 'geojson') {
      const r = rowOf('L', actor, id, 'proj.gis.export'); if (r.has_live !== 1) throw unprocessable('Only an approved layer is exported.'); const fc = layerContent(r).geojson;
      writeAudit(db, { entity: 'gis_layers', entityId: r.id, action: 'export', newValues: { format }, actor: actor.user, companyId: r.company_id });
      return format === 'kml' ? { buffer: Buffer.from(geoToKml(r.name, fc)), contentType: 'application/vnd.google-earth.kml+xml', fileName: `${r.name.replace(/[^\w.-]+/g, '_')}.kml` } : { buffer: Buffer.from(JSON.stringify(fc)), contentType: 'application/geo+json', fileName: `${r.name.replace(/[^\w.-]+/g, '_')}.geojson` };
    },
  };
  const overlays = {
    list(actor, projectId) { const o = project(actor, projectId); return db.prepare('SELECT * FROM gis_overlays WHERE org_project_id = ? AND deleted_at IS NULL ORDER BY name').all(o.id).filter((r) => r.has_live === 1 || may(actor, 'proj.gis.edit', o.id)).map((r) => overlayView(actor, r)); },
    get(actor, id) { return overlayView(actor, rowOf('O', actor, id)); },
    create(actor, b) {
      const o = project(actor, b.projectId, 'proj.gis.create'); const [[s, w], [n, e]] = b.bounds; if (!(s < n && w < e)) fail([{ field: 'bounds', message: 'The south-west corner is below and left of the north-east corner' }]);
      if (db.prepare('SELECT 1 FROM gis_overlays WHERE org_project_id = ? AND name = ? COLLATE NOCASE AND deleted_at IS NULL').get(o.id, b.name)) throw conflict(`The project has an overlay named "${b.name}" already.`);
      const id = Number(db.prepare("INSERT INTO gis_overlays (company_id, org_project_id, name, image_url, file_id, bounds_json, opacity, pending_json, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'gis_overlays')").run(actor.companyId, o.id, b.name, b.imageUrl, b.fileId, JSON.stringify(b.bounds), b.opacity, JSON.stringify({ name: b.name, imageUrl: b.imageUrl, fileId: b.fileId, bounds: b.bounds, opacity: b.opacity }), o.id, actor.user).lastInsertRowid);
      writeAudit(db, { entity: 'gis_overlays', entityId: id, action: 'create', newValues: { name: b.name }, actor: actor.user, companyId: actor.companyId }); return overlays.get(actor, id);
    },
    update(actor, id, b) {
      const r = rowOf('O', actor, id, 'proj.gis.edit'); if (!editable(r)) throw conflict('A proposal waiting for approval is not edited; withdraw it first.');
      if (b.rowVersion != null && b.rowVersion !== r.version) throw conflict(`The overlay was changed by someone else (version ${r.version}, you had ${b.rowVersion}); reload it.`);
      const base = r.pending_json ? json(r.pending_json, null) : { name: r.name, ...overlayContent(r) }; const p = { ...base, ...Object.fromEntries(Object.entries(b).filter(([k, v]) => v !== undefined && k !== 'rowVersion')) };
      const [[s, w], [n, e]] = p.bounds; if (!(s < n && w < e)) fail([{ field: 'bounds', message: 'The south-west corner is below and left of the north-east corner' }]);
      db.prepare("UPDATE gis_overlays SET pending_json = ?, cfg_status = CASE WHEN cfg_status = 'APPROVED' THEN 'DRAFT' ELSE cfg_status END, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(JSON.stringify(p), actor.user, nowIso(), r.id);
      if (r.has_live !== 1) db.prepare('UPDATE gis_overlays SET name = ?, image_url = ?, file_id = ?, bounds_json = ?, opacity = ? WHERE id = ?').run(p.name, p.imageUrl, p.fileId ?? null, JSON.stringify(p.bounds), p.opacity, r.id);
      writeAudit(db, { entity: 'gis_overlays', entityId: r.id, action: 'propose', actor: actor.user, companyId: r.company_id }); return overlays.get(actor, r.id);
    },
    remove: (actor, id) => cfgRemove('O', actor, id), submit: (actor, id) => cfgSubmit('O', actor, id), withdraw: (actor, id, b) => cfgWithdraw('O', actor, id, b), cancel: (actor, id, b) => cfgCancel('O', actor, id, b), history: (actor, id) => cfgHistory('O', actor, id),
  };

  // ---- locations, progress, heatmap and strip chart ----------------------------------------------------------------------------------------------------
  const latestProgress = (orgProjectId, activity = null) => {
    const rows = db.prepare(`SELECT p.* FROM gis_progress p WHERE p.org_project_id = ? AND p.deleted_at IS NULL ${activity ? 'AND p.activity = ?' : ''} AND NOT EXISTS (SELECT 1 FROM gis_progress q WHERE q.location_id = p.location_id AND q.activity = p.activity AND q.deleted_at IS NULL AND (q.as_of > p.as_of OR (q.as_of = p.as_of AND q.id > p.id))) ORDER BY p.activity, p.location_id`).all(...(activity ? [orgProjectId, activity] : [orgProjectId]));
    return rows;
  };
  const locRows = (orgProjectId) => db.prepare('SELECT * FROM proj_locations WHERE project_id = ? AND deleted_at IS NULL ORDER BY chainage_from, code').all(orgProjectId);
  function locationsWithProgress(orgProjectId) {
    const prog = latestProgress(orgProjectId); const by = new Map();
    for (const p of prog) { if (!by.has(p.location_id)) by.set(p.location_id, []); by.get(p.location_id).push(p); }
    return locRows(orgProjectId).map((l) => {
      const ps = by.get(l.id) ?? []; const pct = ps.length ? ps.reduce((n, p) => n + p.pct, 0) / ps.length / HUNDRED * 100 : null;
      return { id: l.id, code: l.code, name: l.name, type: l.loc_type, lat: l.lat, lng: l.lng, chainageFrom: l.chainage_from, chainageTo: l.chainage_to, pct: pct == null ? null : Math.round(pct * 100) / 100, band: pct == null ? 'muted' : bandOf(pct), activities: ps.map((p) => ({ activity: p.activity, pct: p.pct / HUNDRED * 100, asOf: p.as_of })) };
    });
  }
  const progress = {
    record(actor, b) {
      const o = project(actor, b.projectId, 'proj.gis.progress'); const l = db.prepare('SELECT id FROM proj_locations WHERE id = ? AND project_id = ? AND deleted_at IS NULL').get(b.locationId, o.id); if (!l) fail([{ field: 'locationId', message: 'Choose a location of this project' }]);
      const pct = Math.round(Number(b.pct) * HUNDRED / 100);
      const id = Number(db.prepare("INSERT INTO gis_progress (company_id, org_project_id, location_id, activity, pct, as_of, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'gis_progress')").run(actor.companyId, o.id, b.locationId, b.activity.trim(), pct, b.asOf, o.id, actor.user).lastInsertRowid);
      writeAudit(db, { entity: 'gis_progress', entityId: id, action: 'record', newValues: { locationId: b.locationId, activity: b.activity, pct: b.pct, asOf: b.asOf }, actor: actor.user, companyId: actor.companyId });
      event('proj.gis.progress_recorded', actor, 'gis_progress', id, actor.companyId, o.id, { projectId: o.id, locationId: b.locationId, activity: b.activity, pct: b.pct });
      return { id, locationId: b.locationId, activity: b.activity.trim(), pct: Number(b.pct), asOf: b.asOf };
    },
    list(actor, projectId) { const o = project(actor, projectId); return latestProgress(o.id).map((p) => ({ id: p.id, locationId: p.location_id, activity: p.activity, pct: p.pct / HUNDRED * 100, asOf: p.as_of, by: p.created_by })); },
  };
  const heatmap = (actor, projectId) => { const o = project(actor, projectId); const ls = locationsWithProgress(o.id); return { projectId: o.id, bands: BANDS.map(([a, b, tone]) => ({ from: a, to: Math.min(100, Math.floor(b)), tone })), locations: ls, withProgress: ls.filter((l) => l.pct != null).length, total: ls.length }; };
  function strip(actor, projectId, activity = null) {
    const o = project(actor, projectId); const locs = locRows(o.id).filter((l) => l.chainage_from != null && l.chainage_to != null);
    const prog = latestProgress(o.id, activity); const acts = [...new Set(latestProgress(o.id).map((p) => p.activity))].sort();
    const rows = (activity ? [activity] : acts).map((a) => ({ activity: a, segments: locs.map((l) => { const p = prog.find((x) => x.activity === a && x.location_id === l.id) ?? (!activity ? latestProgress(o.id, a).find((x) => x.location_id === l.id) : null); return { locationId: l.id, code: l.code, from: l.chainage_from, to: l.chainage_to, pct: p ? p.pct / HUNDRED * 100 : null, asOf: p?.as_of ?? null }; }) }));
    const length = locs.reduce((n, l) => n + (l.chainage_to - l.chainage_from), 0);
    return { projectId: o.id, activities: acts, from: locs.length ? Math.min(...locs.map((l) => l.chainage_from)) : 0, to: locs.length ? Math.max(...locs.map((l) => l.chainage_to)) : 0, lengthM: length,
      rows: rows.map((r) => { const done = r.segments.reduce((n, s) => n + (s.pct == null ? 0 : (s.to - s.from) * s.pct / 100), 0); return { ...r, completeM: Math.round(done * 100) / 100, pct: length ? Math.round(done / length * 10000) / 100 : 0 }; }) };
  }
  function stripExport(actor, projectId, format = 'xlsx', activity = null) {
    need(actor, 'proj.gis.export', 'export the strip chart'); const s = strip(actor, projectId, activity); const o = orgOf(s.projectId);
    const rows = s.rows.flatMap((r) => r.segments.map((g) => ({ activity: r.activity, location: g.code, from: g.from, to: g.to, lengthM: g.to - g.from, pct: g.pct ?? 0, asOf: g.asOf ?? '' })));
    writeAudit(db, { entity: 'gis_progress', entityId: String(o.id), action: 'export', newValues: { format }, actor: actor.user, companyId: actor.companyId });
    return { buffer: writeExport(format, { columns: [{ key: 'activity', label: 'Activity', type: 'text' }, { key: 'location', label: 'Location', type: 'text' }, { key: 'from', label: 'From chainage (m)', type: 'number' }, { key: 'to', label: 'To chainage (m)', type: 'number' }, { key: 'lengthM', label: 'Length (m)', type: 'number' }, { key: 'pct', label: 'Complete (%)', type: 'number' }, { key: 'asOf', label: 'As of', type: 'text' }], rows, footer: s.rows.map((r) => `${r.activity}: ${r.pct}% of ${s.lengthM} m`), title: `Chainage progress ${o.code}`, sheetName: 'Strip chart' }), contentType: FORMATS[format], fileName: `strip-chart-${o.code}.${format}` };
  }

  // ---- BR-01: punches only as aggregates ---------------------------------------------------------------------------------------------------------------
  function punchAggregates(actor, orgProjectId, days = 7) {
    const since = new Date(Date.now() + 5.5 * 3_600_000 - days * 86_400_000).toISOString().slice(0, 10);
    let rows; try {
      rows = db.prepare(`SELECT ROUND(p.lat, 3) AS glat, ROUND(p.lng, 3) AS glng, COUNT(DISTINCT p.person_type || ':' || p.person_id) AS people, COUNT(*) AS punches FROM att_punches p JOIN org_sites s ON s.id = p.punch_site_id WHERE s.org_project_id = ? AND p.company_id = ? AND p.lat IS NOT NULL AND p.lng IS NOT NULL AND p.work_date >= ? AND p.is_active = 1 GROUP BY glat, glng HAVING people >= ?`).all(orgProjectId, actor.companyId, since, PUNCH_MIN_PEOPLE);
    } catch { rows = []; }
    return { minPeople: PUNCH_MIN_PEOPLE, days, cells: rows.map((r) => ({ lat: r.glat, lng: r.glng, people: r.people, punches: r.punches })) };
  }

  // ---- the map -------------------------------------------------------------------------------------------------------------------------------------------
  const map = {
    get(actor, projectId, { days = 7 } = {}) {
      const o = project(actor, projectId); const my = roles(actor); const store = createParameterStore(db); const date = todayIST();
      const sites = db.prepare('SELECT id, code, name, latitude, longitude, geofence_type, geofence_radius_m, geofence_polygon_json FROM org_sites WHERE org_project_id = ? AND is_active = 1').all(o.id)
        .map((s) => ({ id: s.id, code: s.code, name: s.name, lat: s.latitude, lng: s.longitude, geofence: s.geofence_type === 'CIRCLE' ? { type: 'CIRCLE', radiusM: s.geofence_radius_m } : s.geofence_type === 'POLYGON' ? { type: 'POLYGON', polygon: json(s.geofence_polygon_json, null) } : { type: 'NONE' } }));
      const canEdit = may(actor, 'proj.gis.edit', o.id);
      const lyr = db.prepare("SELECT * FROM gis_layers WHERE org_project_id = ? AND deleted_at IS NULL AND has_live = 1 ORDER BY id").all(o.id)
        .filter((r) => { const vis = json(r.visible_roles_json, []); return canEdit || !vis.length || vis.some((v) => my.includes(v)); })
        .map((r) => { const c = layerContent(r); return { id: r.id, name: r.name, ltype: r.ltype, ltypeLabel: GIS_LTYPES[r.ltype], style: c.style, geojson: c.geojson, revision: r.revision }; });
      const ovr = db.prepare("SELECT * FROM gis_overlays WHERE org_project_id = ? AND deleted_at IS NULL AND has_live = 1 ORDER BY id").all(o.id).map((r) => ({ id: r.id, name: r.name, ...overlayContent(r) }));
      const locations = locationsWithProgress(o.id);
      const points = pointProviders.map((p) => {
        if (!p.query) return { code: p.code, label: p.label, ownerModule: p.ownerModule, live: false, features: [] };
        let f; try { f = p.query(db, { companyId: actor.companyId, projectId: o.id }).filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lng)); } catch { f = []; }
        return { code: p.code, label: p.label, ownerModule: p.ownerModule, live: true, features: f };
      });
      const pts = [...locations.filter((l) => l.lat != null && l.lng != null).map((l) => [l.lat, l.lng]), ...sites.filter((s) => s.lat != null && s.lng != null).map((s) => [s.lat, s.lng])];
      const center = pts.length ? [pts.reduce((n, p) => n + p[0], 0) / pts.length, pts.reduce((n, p) => n + p[1], 0) / pts.length] : [20.5937, 78.9629];
      return { projectId: o.id, projectCode: o.code, projectName: o.name, center, zoom: pts.length ? 14 : 5, tile: { url: /^https?:\/\//i.test(String(store.get('gis.tile_url', { companyId: actor.companyId, date }))) ? store.get('gis.tile_url', { companyId: actor.companyId, date }) : null, attribution: store.get('gis.tile_attribution', { companyId: actor.companyId, date }) || '' },
        sites, layers: lyr, overlays: ovr, locations, points, punches: punchAggregates(actor, o.id, days), legend: BANDS.map(([a, b, tone]) => ({ from: a, to: Math.min(100, Math.floor(b)), tone })),
        summary: { sites: sites.length, layers: lyr.length, overlays: ovr.length, locations: locations.length, located: locations.filter((l) => l.lat != null).length, points: points.reduce((n, p) => n + p.features.length, 0) },
        can: { edit: canEdit, export: may(actor, 'proj.gis.export', o.id), progress: may(actor, 'proj.gis.progress', o.id) } };
    },
  };
  return { layers, overlays, progress, heatmap, strip, stripExport, map, decide: cfgDecide };
}

/** The project manager approves a layer or overlay change: the manager of the project (another one when the sender is the manager, else the project director). */
if (!workflowResolvers.get('proj.cfgpm')) workflowResolvers.register('proj.cfgpm', ({ db, companyId, instance }) => {
  const [k, sid] = String(instance.docId).split(':'); const t = k === 'O' ? 'gis_overlays' : 'gis_layers';
  const oid = db.prepare(`SELECT org_project_id AS n FROM ${t} WHERE id = ?`).get(rid(sid))?.n; const x = oid ? db.prepare('SELECT pm_user FROM proj_projects WHERE project_id = ? AND deleted_at IS NULL').get(oid) : null; const me = String(instance.submittedBy ?? '').toLowerCase();
  if (x?.pm_user && x.pm_user.toLowerCase() !== me) return [{ user: x.pm_user }];
  const users = db.prepare('SELECT username, roles_json FROM iam_users WHERE company_id = ? AND is_active = 1').all(companyId).filter((u) => json(u.roles_json, []).includes('PM') && u.username.toLowerCase() !== me).map((u) => ({ user: u.username }));
  return users.length ? users : [{ role: 'PD' }];
});
workflowTypes.register({
  docType: GIS_DOC, label: 'Map layer or overlay change', processOwner: 'PM', route: () => '/proj/gis-config',
  describe(db, companyId, id) { const [k, sid] = String(id).split(':'); const t = k === 'O' ? 'gis_overlays' : 'gis_layers'; const r = db.prepare(`SELECT x.name, x.requested_by, p.code FROM ${t} x JOIN org_projects p ON p.id = x.org_project_id WHERE x.id = ? AND x.company_id = ?`).get(rid(sid), companyId); return r ? { ref: `${r.code} ${r.name}`, title: `${r.code} ${k === 'O' ? 'overlay' : 'layer'} ${r.name}`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) {
    const [k, sid] = String(id).split(':'); const t = k === 'O' ? 'gis_overlays' : 'gis_layers'; const r = db.prepare(`SELECT x.*, p.code FROM ${t} x JOIN org_projects p ON p.id = x.org_project_id WHERE x.id = ?`).get(rid(sid)); if (!r) return null; const pend = json(r.pending_json, {});
    return { fields: [{ label: 'Project', value: r.code }, { label: k === 'O' ? 'Overlay' : 'Layer', value: r.name }, { label: 'Change', value: r.has_live === 1 ? `Revision ${r.revision + 1} replaces the live one` : 'New' }, ...(k === 'L' ? [{ label: 'Type', value: GIS_LTYPES[pend.ltype ?? r.ltype] }, { label: 'Features proposed', value: String(pend.geojson?.features?.length ?? 0) }] : [{ label: 'Opacity', value: `${pend.opacity ?? r.opacity}%` }])], lines: [] };
  },
  defaultDefinition: { name: 'Map configuration: the project manager approves a layer or overlay change', settings: { resubmit: 'first', distinctApprovers: true }, steps: [{ code: 'PM', name: 'Project manager', type: 'approval', mode: 'single', approvers: [{ kind: 'resolver', resolver: 'proj.cfgpm' }], slaHours: 48, requireAttachment: false, checklist: [], when: null, notify: [], action: null }] },
  hooks: { onApproved: (db, { instance, actor }) => gisOf(db)?.decide(instance, actor, 'APPROVED'), onRejected: (db, { instance, actor, comment }) => gisOf(db)?.decide(instance, actor, 'REJECTED', comment), onReturned: (db, { instance, actor, comment }) => gisOf(db)?.decide(instance, actor, 'RETURNED', comment), onCancelled: (db, { instance, actor, comment }) => gisOf(db)?.decide(instance, actor, 'CANCELLED', comment) },
});
evidenceProviders.register(GIS_DOC, ({ db, instance }) => {
  const [k, sid] = String(instance.docId).split(':'); const t = k === 'O' ? 'gis_overlays' : 'gis_layers'; const r = db.prepare(`SELECT * FROM ${t} WHERE id = ?`).get(rid(sid)); if (!r) return { sections: [] }; const p = json(r.pending_json, {});
  return { sections: [{ code: 'proj-gis', title: 'The proposed map change', kind: 'metrics', items: [{ label: k === 'O' ? 'Overlay' : 'Layer', value: r.name, format: 'text' }, { label: 'Live revision', value: String(r.revision), format: 'text' }, ...(k === 'L' ? [{ label: 'Features now', value: String(r.has_live === 1 ? json(r.geojson, { features: [] }).features.length : 0), format: 'text' }, { label: 'Features proposed', value: String(p.geojson?.features?.length ?? 0), format: 'text' }] : [])] }] };
});
