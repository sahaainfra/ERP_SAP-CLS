import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { normaliseGeo, pointProviders } from '../src/server/modules/proj/gis.js';
import { setupCompany, startApi } from './helpers.js';

// Part 10.07: GIS, site maps and location intelligence. T-01 a GeoJSON import becomes a layer on the map once the project manager approves it, and a marker of a record module (an NCR) carries the route that opens the record. Also: KML import
// and export, the maker-checker approval of layers and overlays (the live content stays until a change is approved), role-restricted layers, the progress heatmap and the chainage strip chart, punches only as aggregates of five people or more (BR-01),
// roles, project isolation, the flag.
const P = '/api/v1/proj';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
let seq = 0;
const key = () => ({ ...json, 'idempotency-key': `gs-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const pm1 = as('PM', 'gpm1'); const pd1 = as('PD', 'gpd1'); const plan1 = as('PLAN', 'gplan1'); const se1 = as('SE', 'gse1'); const qs1 = as('QS', 'gqs1'); const bd = as('BD', 'gbd1');
const opened = [];
after(async () => { for (const a of opened) await a.close(); });
const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const fc = (...features) => ({ type: 'FeatureCollection', features });
const boundary = fc({ type: 'Feature', properties: { name: 'Site boundary' }, geometry: { type: 'Polygon', coordinates: [[[73.85, 18.52], [73.86, 18.52], [73.86, 18.53], [73.85, 18.53], [73.85, 18.52]]] } }, { type: 'Feature', properties: { name: 'Gate' }, geometry: { type: 'Point', coordinates: [73.855, 18.52] } });

async function setup() {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  for (const [n, r] of [['gpm1', ['PM']], ['gpm2', ['PM']], ['gpd1', ['PD']], ['gplan1', ['PLAN']], ['gse1', ['SE']], ['gqs1', ['QS']], ['gbd1', ['BD']]]) api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  const mk = (code, name) => { const id = Number(api.db.prepare('INSERT INTO org_projects (company_id, code, name, type) VALUES (1, ?, ?, ?)').run(code, name, 'ROAD').lastInsertRowid); api.db.prepare("INSERT INTO proj_projects (company_id, project_id, created_by) VALUES (1, ?, 'test')").run(id); return id; };
  const a = mk('GSA', 'Ring road');
  const loc = (code, from, to, lat, lng) => Number(api.db.prepare("INSERT INTO proj_locations (company_id, project_id, loc_type, code, name, chainage_from, chainage_to, lat, lng, created_by) VALUES (1, ?, 'CHAINAGE', ?, ?, ?, ?, ?, ?, 'test')").run(a, code, `Chainage ${code}`, from, to, lat, lng).lastInsertRowid);
  const l1 = loc('CH0', 0, 1000, 18.52, 73.85); const l2 = loc('CH1', 1000, 2000, 18.525, 73.855); const l3 = loc('CH2', 2000, 3000, 18.53, 73.86);
  const call = (who, method, path, body, k = key()) => api.call(method, `${P}${path}`, { ...who, headers: k, body });
  const act = async (who, instanceId, action = 'approve') => {
    const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId); assert.ok(task, `${who.user} has the task of instance ${instanceId}`);
    const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key(), body: { action, comment: 'checked' } }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r;
  };
  const hasTask = async (who, instanceId) => (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.some((x) => x.instance.id === instanceId);
  return { api, call, act, hasTask, a, l1, l2, l3 };
}

test('T-01 a GeoJSON import becomes a layer after the project manager approves it; an NCR marker opens the NCR; KML in and out; the live layer stays until a change is approved', async () => {
  const t = await setup();
  assert.equal(normaliseGeo({ type: 'Point', coordinates: [200, 10] }).problems.length, 1, 'longitude out of range');
  assert.equal(normaliseGeo({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [73.8, 18.5] } }).value.features.length, 1, 'a Feature is wrapped');
  assert.equal((await t.call(bd, 'GET', `/gis/map?projectId=${t.a}`)).status, 403);
  assert.equal((await t.call(qs1, 'POST', '/gis/layers', { projectId: t.a, name: 'X1', ltype: 'CUSTOM', geojson: boundary })).status, 403);
  assert.equal((await t.call(se1, 'POST', '/gis/layers/import', { projectId: t.a, name: 'Site boundary', ltype: 'BOUNDARY', format: 'geojson', content: JSON.stringify(boundary) })).status, 201, 'a GeoJSON file is imported');
  assert.equal((await t.call(se1, 'POST', '/gis/layers', { projectId: t.a, name: 'Broken', ltype: 'BOUNDARY', geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [500, 5] } }] } })).status, 400);
  const c = await t.call(se1, 'POST', '/gis/layers', { projectId: t.a, name: 'site boundary', ltype: 'BOUNDARY', geojson: boundary }); assert.equal(c.status, 409, 'the name is taken by the import above');
  const l = (await t.call(se1, 'POST', '/gis/layers', { projectId: t.a, name: 'Boundary of the site', ltype: 'BOUNDARY', geojson: boundary, style: { color: 'red', weight: 3 } })).json.data;
  assert.deepEqual([l.status, l.live, l.pendingFeatures, l.can.submit], ['DRAFT', false, 2, true]);
  assert.equal((await t.call(plan1, 'GET', `/gis/map?projectId=${t.a}`)).json.data.layers.length, 0, 'a layer that is not approved is not on the map');
  const sub = await t.call(se1, 'POST', `/gis/layers/${l.id}/submit`, {}); assert.equal(sub.status, 202, JSON.stringify(sub.json)); const inst = sub.json.data.workflowInstanceId;
  assert.equal(await t.hasTask(se1, inst), false, 'the maker does not approve'); assert.equal(await t.hasTask(pm1, inst), true);
  assert.equal((await t.call(se1, 'PATCH', `/gis/layers/${l.id}`, { name: 'Changed' })).status, 409, 'locked while waiting');
  await t.act(pm1, inst);
  const m = (await t.call(plan1, 'GET', `/gis/map?projectId=${t.a}`)).json.data; assert.equal(m.layers.length, 1); assert.equal(m.layers[0].geojson.features.length, 2); assert.deepEqual([m.layers[0].revision, m.summary.layers], [1, 1]); assert.ok(m.tile.url.includes('{z}'), 'the base map is a parameter');
  // a change to the live layer: the live content stays until it is approved
  const up = await t.call(se1, 'PATCH', `/gis/layers/${l.id}`, { geojson: fc(boundary.features[0]) }); assert.equal(up.status, 200, JSON.stringify(up.json)); assert.deepEqual([up.json.data.status, up.json.data.features, up.json.data.pendingFeatures], ['DRAFT', 2, 1]);
  assert.equal((await t.call(plan1, 'GET', `/gis/map?projectId=${t.a}`)).json.data.layers[0].geojson.features.length, 2);
  const i2 = (await t.call(se1, 'POST', `/gis/layers/${l.id}/submit`, {})).json.data.workflowInstanceId; await t.act(pm1, i2, 'reject');
  assert.equal((await t.call(plan1, 'GET', `/gis/map?projectId=${t.a}`)).json.data.layers[0].geojson.features.length, 2, 'rejected: the live layer is unchanged');
  const hist = (await t.call(se1, 'GET', `/gis/layers/${l.id}/history`)).json.data; assert.ok(hist.audit.some((a) => a.action === 'propose') && hist.approvals.length > 0);
  // KML in and out
  const kml = '<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Alignment A</name><LineString><coordinates>73.85,18.52,0 73.86,18.53,0</coordinates></LineString></Placemark><Placemark><name>Camp</name><Point><coordinates>73.851,18.521,0</coordinates></Point></Placemark></Document></kml>';
  const ik = await t.call(se1, 'POST', '/gis/layers/import', { projectId: t.a, name: 'Alignment from KML', ltype: 'ALIGNMENT', format: 'kml', content: kml }); assert.equal(ik.status, 201, JSON.stringify(ik.json)); assert.equal(ik.json.data.pendingFeatures, 2);
  assert.equal((await t.call(se1, 'POST', '/gis/layers/import', { projectId: t.a, name: 'Empty KML', ltype: 'ALIGNMENT', format: 'kml', content: '<kml><Document></Document></kml>' })).status, 400);
  assert.equal((await t.call(se1, 'POST', '/gis/layers/import', { projectId: t.a, name: 'Not KML', ltype: 'ALIGNMENT', format: 'kml', content: '<html>nope</html>' })).status, 400);
  await t.act(pm1, (await t.call(se1, 'POST', `/gis/layers/${ik.json.data.id}/submit`, {})).json.data.workflowInstanceId);
  const ex = await t.api.raw('GET', `${P}/gis/layers/${ik.json.data.id}/export?format=kml`, { user: 'gpm1', roles: 'PM' }); assert.equal(ex.status, 200); assert.ok(ex.buffer.toString().includes('<Placemark>') && ex.buffer.toString().includes('Alignment A'), 'the KML is written back');
  assert.equal((await t.api.call('GET', `${P}/gis/layers/${ik.json.data.id}/export?format=geojson`, pm1)).status, 200); assert.equal((await t.api.call('GET', `${P}/gis/layers/${ik.json.data.id}/export?format=kml`, se1)).status, 403, 'export is a right');
  // layers restricted to roles
  const r = (await t.call(pm1, 'POST', '/gis/layers', { projectId: t.a, name: 'Camp (managers only)', ltype: 'CAMP', geojson: fc(boundary.features[1]), visibleRoles: ['PM', 'PD'] })).json.data;
  await t.act(pm1.user === 'gpm1' ? as('PM', 'gpm2') : pm1, (await t.call(pm1, 'POST', `/gis/layers/${r.id}/submit`, {})).json.data.workflowInstanceId);
  assert.equal((await t.call(qs1, 'GET', `/gis/map?projectId=${t.a}`)).json.data.layers.some((x) => x.name.startsWith('Camp')), false, 'hidden from a quantity surveyor');
  assert.equal((await t.call(pm1, 'GET', `/gis/map?projectId=${t.a}`)).json.data.layers.some((x) => x.name.startsWith('Camp')), true);
  // FR-03: a module offers its located records; the marker carries the route that opens the record
  pointProviders.find((p) => p.code === 'ncr').query = (db, { projectId }) => [{ id: 7, lat: 18.521, lng: 73.851, title: 'NCR-0007 honeycombing', status: 'OPEN', date: today(), route: `/quality/ncr?id=7&project=${projectId}` }];
  try {
    const pts = (await t.call(plan1, 'GET', `/gis/map?projectId=${t.a}`)).json.data.points; const ncr = pts.find((p) => p.code === 'ncr'); assert.equal(ncr.live, true); assert.equal(ncr.features[0].route, `/quality/ncr?id=7&project=${t.a}`);
    assert.equal(pts.find((p) => p.code === 'incident').live, false, 'a module that is not live is listed as such');
  } finally { delete pointProviders.find((p) => p.code === 'ncr').query; }
});

test('FR-02 overlays are approved like layers; FR-04 FR-05 the heatmap and the chainage strip chart come from progress; BR-01 punches only as aggregates of five people or more', async () => {
  const t = await setup();
  const tiny = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  assert.equal((await t.call(se1, 'POST', '/gis/overlays', { projectId: t.a, name: 'Plan', imageUrl: 'javascript:alert(1)', bounds: [[18.5, 73.8], [18.6, 73.9]] })).status, 400, 'only safe addresses');
  assert.equal((await t.call(se1, 'POST', '/gis/overlays', { projectId: t.a, name: 'Plan', imageUrl: tiny, bounds: [[18.6, 73.9], [18.5, 73.8]] })).status, 400, 'the corners are the wrong way round');
  const o = await t.call(se1, 'POST', '/gis/overlays', { projectId: t.a, name: 'Site plan rev A', imageUrl: tiny, bounds: [[18.5, 73.8], [18.6, 73.9]], opacity: 60 }); assert.equal(o.status, 201, JSON.stringify(o.json));
  assert.equal((await t.call(plan1, 'GET', `/gis/map?projectId=${t.a}`)).json.data.overlays.length, 0);
  await t.act(pm1, (await t.call(se1, 'POST', `/gis/overlays/${o.json.data.id}/submit`, {})).json.data.workflowInstanceId);
  const ov = (await t.call(plan1, 'GET', `/gis/map?projectId=${t.a}`)).json.data.overlays; assert.deepEqual([ov.length, ov[0].opacity, ov[0].bounds[1][1]], [1, 60, 73.9]);
  assert.equal((await t.call(se1, 'DELETE', `/gis/overlays/${o.json.data.id}`)).status, 422, 'an approved overlay is not deleted');
  // progress, heatmap, strip chart
  assert.equal((await t.call(qs1, 'POST', '/gis/progress', { projectId: t.a, locationId: t.l1, activity: 'Earthwork', pct: 100, asOf: today() })).status, 403);
  assert.equal((await t.call(plan1, 'POST', '/gis/progress', { projectId: t.a, locationId: 99999, activity: 'Earthwork', pct: 50, asOf: today() })).status, 400);
  assert.equal((await t.call(plan1, 'POST', '/gis/progress', { projectId: t.a, locationId: t.l1, activity: 'Earthwork', pct: 120, asOf: today() })).status, 400);
  for (const [loc, pct] of [[t.l1, 100], [t.l2, 50], [t.l3, 0]]) assert.equal((await t.call(plan1, 'POST', '/gis/progress', { projectId: t.a, locationId: loc, activity: 'Earthwork', pct, asOf: '2026-10-01' })).status, 201);
  assert.equal((await t.call(plan1, 'POST', '/gis/progress', { projectId: t.a, locationId: t.l1, activity: 'Pavement', pct: 20, asOf: '2026-10-01' })).status, 201);
  const h = (await t.call(qs1, 'GET', `/gis/heatmap?projectId=${t.a}`)).json.data; const by = Object.fromEntries(h.locations.map((x) => [x.code, x]));
  assert.deepEqual([by.CH0.pct, by.CH0.band, by.CH1.pct, by.CH1.band, by.CH2.pct, by.CH2.band], [60, 'info', 50, 'info', 0, 'danger'], 'CH0 averages earthwork 100 and pavement 20'); assert.equal(h.withProgress, 3);
  const s = (await t.call(qs1, 'GET', `/gis/strip?projectId=${t.a}`)).json.data; const ew = s.rows.find((r) => r.activity === 'Earthwork');
  assert.deepEqual([s.lengthM, s.from, s.to, ew.pct, ew.completeM, s.rows.length], [3000, 0, 3000, 50, 1500, 2]); assert.deepEqual(ew.segments.map((g) => g.pct), [100, 50, 0]);
  await t.call(plan1, 'POST', '/gis/progress', { projectId: t.a, locationId: t.l3, activity: 'Earthwork', pct: 90, asOf: '2026-10-15' });
  assert.equal((await t.call(qs1, 'GET', `/gis/strip?projectId=${t.a}&activity=Earthwork`)).json.data.rows[0].pct, 80, 'the latest reading counts: (100 + 50 + 90) / 3');
  assert.equal((await t.api.call('GET', `${P}/gis/strip/export?projectId=${t.a}&format=xlsx`, qs1)).status, 403); assert.equal((await t.api.call('GET', `${P}/gis/strip/export?projectId=${t.a}&format=xlsx`, pm1)).status, 200); assert.equal((await t.api.call('GET', `${P}/gis/strip/export?projectId=${t.a}&format=csv`, plan1)).status, 200);
  // BR-01: punches
  const site = Number(t.api.db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (1, ?, 'S1', 'Main site', 'ACTIVE')").run(t.a).lastInsertRowid);
  let n = 0; const punch = (person, lat, lng) => t.api.db.prepare("INSERT INTO att_punches (company_id, person_type, person_id, punch_site_id, punch_type, work_date, device_time, server_time, effective_time, lat, lng, method, recorded_by, client_uuid, result, created_by) VALUES (1, 'WORKER', ?, ?, 'IN', ?, '08:00', '08:00', '08:00', ?, ?, 'MOBILE', 'x', ?, 'ACCEPTED', 'x')").run(person, site, today(), lat, lng, `u${(n += 1)}`);
  for (let i = 1; i <= 6; i += 1) punch(i, 18.52041, 73.85041); for (let i = 10; i <= 11; i += 1) punch(i, 18.5301, 73.8601);
  const pa = (await t.call(plan1, 'GET', `/gis/map?projectId=${t.a}`)).json.data.punches; assert.equal(pa.cells.length, 1, 'the cell of two people is not shown'); assert.deepEqual([pa.cells[0].people, pa.cells[0].punches, pa.minPeople], [6, 6, 5]);
  assert.deepEqual(Object.keys(pa.cells[0]).sort(), ['lat', 'lng', 'people', 'punches'], 'no person, time or device in an aggregate');
  assert.ok(!JSON.stringify((await t.call(plan1, 'GET', `/gis/map?projectId=${t.a}`)).json.data).includes('"personId"'));
  // roles and the flag
  assert.equal((await t.call(dir0(), 'GET', `/gis/map?projectId=${t.a}`)).status, 200);
  t.api.db.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.proj.p1007'").run(); assert.equal((await t.call(pm1, 'GET', `/gis/map?projectId=${t.a}`)).status, 404, 'flag off'); t.api.db.prepare("UPDATE core_feature_flags SET enabled = 1 WHERE key = 'ff.proj.p1007'").run();
  void pd1;
});
function dir0() { return as('DIR', 'gdir1'); }
