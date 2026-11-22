import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import '../src/server/modules/registry.js';
import { blurRegions, cleanDetections, colourDetect } from '../src/server/modules/ai/vision.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { fill } from './qa-helpers.js';
import { setupCompany, startApi } from './helpers.js';

// Part 28.05: computer vision decision support.
// T-01 suggestions require confirmation, and blurring is applied; FR-01 photographs of a DPR are analysed on upload (the built-in colour
// detector, and a model endpoint through the integration hub); FR-02 suggestions with boxes and confidence become an observation (19.04) or an
// NCR (18.04) only when a person confirms; FR-03 faces and people are blurred, nobody is identified (BR-01: labels outside the allow-list are
// dropped); FR-04 false positives count against the model's precision; section 8 roles; 409 on a stale version.
const A = '/api/v1/ai';
const C = '/api/v1/core';
const sharp = createRequire(import.meta.url)('sharp');
let seq = 0; const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `cv-${Date.now().toString(36)}-${(seq += 1)}` });
const as = (roles, user) => ({ roles, user, company: '1' });
const se = as('SE', 'cv-se'); const hsee = as('HSEE', 'cv-hse'); const qce = as('QCE', 'cv-qce'); const aud = as('AUD', 'cv-aud'); const fin = as('FINEX', 'cv-fin');
const opened = []; after(async () => { for (const c of opened) await c(); });

/** A site photograph: grey ground, a fluorescent-yellow vest, a checkerboard where the model will see a person. */
async function photo() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#6b6b6b"/>
    <rect x="240" y="120" width="80" height="100" fill="#d7ff1a"/>
    ${Array.from({ length: 10 }, (_, i) => Array.from({ length: 10 }, (_, j) => `<rect x="${40 + i * 8}" y="${40 + j * 8}" width="8" height="8" fill="${(i + j) % 2 ? '#000' : '#fff'}"/>`).join('')).join('')}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
/** The spread of grey values in a box (a blurred checkerboard has almost none). */
async function spread(buffer, [x, y, w, h]) {
  const { data, info } = await sharp(buffer).greyscale().raw().toBuffer({ resolveWithObject: true });
  const v = []; for (let j = Math.floor(y * info.height); j < Math.floor((y + h) * info.height); j += 1) for (let i = Math.floor(x * info.width); i < Math.floor((x + w) * info.width); i += 1) v.push(data[j * info.width + i]);
  const m = v.reduce((a, b) => a + b, 0) / v.length; return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
}

test('the colour detector finds the vest; blurring flattens a region and leaves the rest; labels outside the allow-list are dropped', async () => {
  const img = await photo();
  const found = await colourDetect(img);
  assert.equal(found.length, 1, JSON.stringify(found)); const [x, y, w, h] = found[0].box;
  assert.equal(found[0].label, 'VEST'); assert.ok(Math.abs(x - 0.6) < 0.03 && Math.abs(y - 0.4) < 0.03 && Math.abs(w - 0.2) < 0.03 && Math.abs(h - 0.333) < 0.03, JSON.stringify(found[0].box));
  assert.ok(found[0].confidence > 0.5 && found[0].confidence <= 0.75, 'a colour cue is never certain');
  const box = [0.1, 0.133, 0.2, 0.267];
  const before = await spread(img, box); const out = await blurRegions(img, [box]);
  assert.ok(await spread(out, box) < before * 0.3, 'the checkerboard is blurred'); assert.ok(Math.abs((await spread(out, [0.6, 0.4, 0.2, 0.33])) - (await spread(img, [0.6, 0.4, 0.2, 0.33]))) < 1, 'the rest is unchanged');
  assert.deepEqual(cleanDetections([{ label: 'IDENTITY', confidence: 0.9, box: [0, 0, 1, 1], name: 'Ramesh' }, { label: 'no_helmet', confidence: 1.4, box: [0.1, 0.1, 2, 0.2] }, { label: 'CRACK', confidence: 0.6 }]),
    [{ label: 'NO_HELMET', confidence: 1, box: [0.1, 0.1, 1, 0.2] }], 'BR-01: no identities; boxes and confidence clamped; no box, no suggestion');
});

async function setup({ detections = [] } = {}) {
  const model = createServer((req, res) => { let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => { const j = JSON.parse(body || '{}'); res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ model: 'ppe-defect-v3', detections: j.image ? detections : [] })); }); });
  await new Promise((r) => model.listen(0, '127.0.0.1', r));
  const storage = mkdtempSync(join(tmpdir(), 'erp-cv-'));
  const api = await startApi({}, { storagePath: storage });
  opened.push(async () => { await api.close(); model.close(); rmSync(storage, { recursive: true, force: true }); });
  await setupCompany(api); const db = api.db;
  for (const [n, r] of [['cv-se', 'SE'], ['cv-hse', 'HSEE'], ['cv-qce', 'QCE'], ['cv-aud', 'AUD'], ['cv-fin', 'FINEX']]) db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify([r]), `${n}@example.com`);
  db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES ('ff.ai.p2805', 1, 'Vision fixture', 0, 1)").run();
  db.exec("INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at) VALUES (1,'G1','Platform','PASSED','test',CURRENT_TIMESTAMP),(1,'G2','Workforce','PASSED','test',CURRENT_TIMESTAMP)");
  const project = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'CV-1', 'Metro depot', 'BUILDING', 'ACTIVE')").run().lastInsertRowid);
  const site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name) VALUES (1, ?, 'CV-S1', 'Depot site')").run(project).lastInsertRowid);
  db.prepare("INSERT INTO proj_projects (company_id, project_id, status, lifecycle_state, pm_user, contract_value, start_date, scheduled_completion, created_by) VALUES (1, ?, 'APPROVED', 'EXECUTION', 'pm', 100000000, '2026-01-01', '2027-12-31', 'test')").run(project);
  db.exec('PRAGMA foreign_keys = OFF');
  const dpr = fill(db, 'site_dprs', { company_id: 1, org_project_id: project, dpr_site_id: site, dpr_date: '2026-11-20', status: 'DRAFT', requested_by: 'cv-se' });
  db.exec('PRAGMA foreign_keys = ON');
  db.prepare("INSERT INTO core_connectors (company_id, code, name, type, provider, environment, config_json, status) VALUES (1, 'ai.vision', 'PPE and defect model', 'ai', 'vision_http', 'development', ?, 'ENABLED')").run(JSON.stringify({ baseUrl: `http://127.0.0.1:${model.address().port}`, model: 'ppe-defect-v3' }));
  const setParam = (k, value, type = 'string') => { db.prepare('DELETE FROM core_parameters WHERE key = ? AND company_id = 1').run(k); db.prepare("INSERT INTO core_parameters (company_id, key, value, data_type, scope_type, scope_id, effective_from, created_by, source_type) VALUES (1, ?, ?, ?, 'company', 1, '2020-01-01', 'test', 'test')").run(k, String(value), type); };
  const call = (who, method, path, body) => api.call(method, path, { ...who, headers: key(), body });
  const drain = async () => { for (let i = 0; i < 4; i += 1) { await runtimeOf(db).jobs.drain(); runtimeOf(db).bus.drain(); } await runtimeOf(db).jobs.drain(); };
  const upload = async (bytes, name = 'pier-p12.png') => {
    const fd = new FormData(); fd.append('entity', 'site_dpr'); fd.append('entityId', String(dpr)); fd.append('file', new Blob([bytes]), name);
    const f = await api.raw('POST', `${C}/files`, { ...se, body: fd }); assert.equal(f.status, 201, JSON.stringify(f.json)); await drain(); return f.json.data;
  };
  const result = (fileId) => db.prepare('SELECT * FROM cv_results WHERE file_id = ?').get(fileId);
  return { api, db, call, project, site, dpr, setParam, upload, result };
}

test('T-01 FR-01 FR-02 FR-03 BR-01 a DPR photograph is analysed on upload; faces are blurred; suggestions become an observation and an NCR only on confirmation', async () => {
  const t = await setup({ detections: [
    { label: 'PERSON', confidence: 0.94, box: [0.1, 0.133, 0.2, 0.8] }, { label: 'FACE', confidence: 0.9, box: [0.1, 0.133, 0.2, 0.267] },
    { label: 'NO_HELMET', confidence: 0.81, box: [0.1, 0.133, 0.2, 0.267] }, { label: 'CRACK', confidence: 0.66, box: [0.55, 0.7, 0.3, 0.1] },
    { label: 'SLAB_CAST', confidence: 0.72, box: [0, 0.5, 1, 0.5] }, { label: 'IDENTITY', confidence: 0.99, box: [0.1, 0.1, 0.2, 0.2], name: 'Worker 17' }] });
  t.setParam('ai.cv.detector', 'ai.vision');
  const img = await photo();
  const f = await t.upload(img);
  const r = t.result(f.id); assert.ok(r, 'analysed on upload'); assert.equal(r.model, 'ai.vision/ppe-defect-v3'); assert.equal(r.status, 'PENDING');
  const labels = JSON.parse(r.labels_json); assert.deepEqual(labels.map((l) => [l.label, l.status]), [['PERSON', 'INFO'], ['FACE', 'INFO'], ['NO_HELMET', 'PENDING'], ['CRACK', 'PENDING'], ['SLAB_CAST', 'PENDING']]);
  assert.ok(!r.labels_json.includes('Worker 17') && !r.labels_json.includes('IDENTITY'), 'BR-01: nobody identified');
  // FR-03, T-01: the blurred copy hides the face; the original is kept for its record but the queue shows the copy
  assert.ok(r.blurred_file_id); const blurred = await (await import('../src/server/platform/files/registry.js')).filesOf(t.db).bytesOf(r.blurred_file_id);
  assert.ok(await spread(blurred.buffer, [0.1, 0.133, 0.2, 0.267]) < (await spread(img, [0.1, 0.133, 0.2, 0.267])) * 0.3, 'the face is blurred');
  assert.equal(t.db.prepare('SELECT source_type FROM core_files WHERE id = ?').get(r.blurred_file_id).source_type, 'cv_blur');
  assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM cv_results').get().n, 1, 'the blurred copy is not analysed again');
  // T-01: nothing created before a person confirms
  assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM hse_observations').get().n, 0); assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM qa_ncrs').get().n, 0);
  // section 8
  assert.equal((await t.call(fin, 'GET', `${A}/vision`)).status, 403);
  const q = (await t.call(hsee, 'GET', `${A}/vision`)).json.data; assert.equal(q.total, 1); assert.equal(q.rows[0].sla, 'ON_TIME'); assert.equal(q.rows[0].pending, 3);
  const g = (await t.call(hsee, 'GET', `${A}/vision/${r.id}`)).json.data; assert.equal(g.imageFileId, r.blurred_file_id, 'the blurred copy is shown'); assert.match(g.image, /\/content\?/);
  assert.equal((await t.call(aud, 'POST', `${A}/vision/${r.id}/labels/2/confirm`, { rowVersion: g.rowVersion })).status, 403, 'the auditor reads only');
  assert.equal((await t.call(hsee, 'POST', `${A}/vision/${r.id}/labels/2/confirm`, { rowVersion: g.rowVersion + 9 })).status, 409);
  // the HSE engineer confirms the PPE suggestion into a safety observation that names nobody, with the blurred photograph attached
  const obs = await t.call(hsee, 'POST', `${A}/vision/${r.id}/labels/2/confirm`, { rowVersion: g.rowVersion, severity: 'MEDIUM' });
  assert.equal(obs.status, 200, JSON.stringify(obs.json));
  const made = obs.json.data.labels[2].created; assert.equal(made.entity, 'hse_observations');
  const o = t.db.prepare('SELECT * FROM hse_observations WHERE id = ?').get(made.id); assert.equal(o.obs_type, 'UNSAFE_CONDITION'); assert.equal(o.responsible_id ?? null, null, 'no person named');
  assert.equal(t.db.prepare("SELECT source_id FROM core_files WHERE linked_entity = 'hse_observations' AND linked_id = ?").get(made.id)?.source_id, String(r.blurred_file_id), 'the blurred copy is the evidence');
  // the quality engineer confirms the crack into an NCR; the slab-cast cue is a false positive (FR-04)
  const g2 = (await t.call(qce, 'GET', `${A}/vision/${r.id}`)).json.data;
  const ncr = await t.call(qce, 'POST', `${A}/vision/${r.id}/labels/3/confirm`, { rowVersion: g2.rowVersion, severity: 'MINOR' });
  assert.equal(ncr.status, 200, JSON.stringify(ncr.json)); const n = t.db.prepare('SELECT * FROM qa_ncrs WHERE id = ?').get(ncr.json.data.labels[3].created.id); assert.equal(n.origin_kind, 'OTHER', 'a DPR photograph is not an inspection'); assert.match(JSON.stringify(n), /vision CVR\//, 'the NCR names the vision result');
  assert.equal((await t.call(qce, 'POST', `${A}/vision/${r.id}/labels/3/confirm`, { rowVersion: ncr.json.data.rowVersion })).status, 422, 'decided once');
  const fp = await t.call(qce, 'POST', `${A}/vision/${r.id}/labels/4/false-positive`, { reason: 'Formwork only; not cast yet', rowVersion: ncr.json.data.rowVersion });
  assert.equal(fp.status, 200); assert.equal(fp.json.data.status, 'REVIEWED');
  const perf = (await t.call(qce, 'GET', `${A}/vision/performance`)).json.data;
  const by = Object.fromEntries(perf.map((p) => [p.label, p])); assert.equal(by.NO_HELMET.precisionPct, 100); assert.equal(by.SLAB_CAST.precisionPct, 0); assert.equal(by.SLAB_CAST.falsePositive, 1);
  // the reviewer blurs more (a number plate, say): a new copy replaces the shown one
  const more = await t.call(hsee, 'POST', `${A}/vision/${r.id}/blur`, { boxes: [[0.6, 0.4, 0.2, 0.33]] });
  assert.equal(more.status, 200); assert.notEqual(more.json.data.imageFileId, r.blurred_file_id);
  assert.ok(t.db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'cv_results' AND action = 'confirm'").get());
});

test('the built-in colour detector by default; no actionable suggestion means no review; volume of the queue', async () => {
  const t = await setup();
  const f = await t.upload(await photo(), 'vest.png');
  const r = t.result(f.id); assert.equal(r.model, 'builtin.colour/1'); assert.equal(r.status, 'NO_FINDINGS', 'a vest worn needs no action');
  assert.equal(JSON.parse(r.labels_json)[0].label, 'VEST'); assert.equal(r.blurred_file_id, null, 'no face, no copy');
  assert.equal((await t.call(se, 'POST', `${A}/vision/run`, { fileId: f.id })).status, 403, 'the site engineer may not run analyses');
  const fid = Number(t.db.prepare("INSERT INTO core_files (company_id, storage_key, original_name, extension, mime, category, size_bytes, sha256, scan_status, linked_entity, linked_id) VALUES (1, 'k/y', 'y.png', 'png', 'image/png', 'image', 1, 'h', 'CLEAN', 'site_dpr', ?)").run(t.dpr).lastInsertRowid);
  t.db.exec('PRAGMA foreign_keys = OFF'); t.db.exec('BEGIN');
  const ins = t.db.prepare("INSERT INTO cv_results (company_id, doc_no, file_id, file_name, model, labels_json, status, analysed_at, project_id, site_id) VALUES (1, ?, ?, 'p.png', 'builtin.colour/1', '[]', ?, '2026-11-20T00:00:00Z', ?, ?)");
  for (let i = 0; i < 100_000; i += 1) ins.run(`C/${i}`, fid + 1 + i, i % 3 ? 'PENDING' : 'REVIEWED', t.project, t.site);
  t.db.exec('COMMIT'); t.db.exec('PRAGMA foreign_keys = ON');
  const t0 = performance.now(); const l = await t.call(hsee, 'GET', `${A}/vision?pageSize=25`); const ms = performance.now() - t0;
  assert.equal(l.status, 200); assert.equal(l.json.data.rows.length, 25); assert.ok(ms < 500, `${ms} ms`);
  assert.match(t.db.prepare("EXPLAIN QUERY PLAN SELECT * FROM cv_results r WHERE r.company_id = 1 AND r.status = 'PENDING' ORDER BY r.analysed_at").all().map((x) => x.detail).join(' '), /ix_cv_results_queue/);
});
