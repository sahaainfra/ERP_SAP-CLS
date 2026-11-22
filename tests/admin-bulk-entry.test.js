import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';

// Part 29.04: template packs and the bulk data entry workspace.
// T-01 a bulk batch with errors highlights the cells; an approved batch imports atomically. FR-01 packs per module; FR-02 grid check, draft
// batch, submit as a batch; FR-03 pack documentation and version control; BR-01 the same validation and approval as single records;
// section 9 preparer → module approver.
const B = '/api/v1/admin/bulk';
let seq = 0; const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `bulk-${Date.now().toString(36)}-${(seq += 1)}` });
const as = (roles, user) => ({ roles, user, company: '1' });
const hr1 = as('HRMGR', 'bk-hr1'); const hr2 = as('HRMGR', 'bk-hr2'); const it = as('ITADM', 'bk-it'); const aud = as('AUD', 'bk-aud'); const se = as('SE', 'bk-se');
const opened = []; after(async () => { for (const c of opened) await c(); });

async function setup() {
  const api = await startApi(); opened.push(() => api.close()); await setupCompany(api); const db = api.db;
  for (const u of [hr1, hr2, it, aud, se]) db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(u.user, u.user, JSON.stringify([u.roles]), `${u.user}@example.com`);
  db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES ('ff.admin.p2904', 1, 'Bulk fixture', 0, 1)").run();
  const call = (who, method, path, body) => api.call(method, path, { ...who, headers: key(), body });
  const designations = () => db.prepare("SELECT code FROM org_designations WHERE company_id = 1 AND code LIKE 'BK-%' ORDER BY code").all().map((r) => r.code);
  return { api, db, call, designations };
}
const row = (code, name, level = '3', grade = 'G3') => ({ code, name, grade, level });

test('T-01 FR-02 BR-01 cells in error are reported; a batch is submitted whole, approved by the module approver and imported all or nothing', async () => {
  const t = await setup();
  const cols = (await t.call(hr1, 'GET', `${B}/templates/ORG_DESIGNATION`)).json.data;
  assert.deepEqual(cols.columns.map((c) => c.key), ['code', 'name', 'grade', 'level']); assert.equal(cols.needsApproval, true); assert.equal(cols.approver, 'HRMGR');
  assert.equal((await t.call(se, 'GET', `${B}/templates/ORG_DESIGNATION`)).status, 403, 'SE may not import designations');
  // T-01: each cell in error is named by row and column
  const rows = [row('BK-SE', 'Site Engineer'), row('bad code!', 'Bad'), row('BK-PM', 'Project Manager', '99'), row('BK-SE', 'Duplicate'), row('', 'No code')];
  const chk = (await t.call(hr1, 'POST', `${B}/check`, { templateCode: 'ORG_DESIGNATION', rows })).json.data.results;
  const cells = chk.flatMap((r) => r.errors.map((e) => `${r.line}:${e.column}:${e.code}`));
  assert.deepEqual(cells, ['2:code:FORMAT', '3:level:RANGE', '4:code:DUPLICATE_IN_FILE', '5:code:REQUIRED']); assert.equal(chk[0].action, 'CREATE');
  const saved = await t.call(hr1, 'POST', `${B}/batches`, { templateCode: 'ORG_DESIGNATION', packCode: 'masters', title: 'New site designations', rows: [...rows, row('', '', '', '')] });
  assert.equal(saved.status, 201, JSON.stringify(saved.json)); const b = saved.json.data;
  assert.deepEqual([b.status, b.rows, b.errors], ['DRAFT', 5, 4], 'empty rows are dropped; the errors are kept');
  const refused = await t.call(hr1, 'POST', `${B}/batches/${b.id}/submit`, { reason: 'Designations for the new region' });
  assert.equal(refused.status, 422); assert.ok(refused.json.error.details.some((d) => d.field === 'rows.3.level'));
  // corrected, submitted as a whole: nothing exists until the module approver approves
  const fixed = await t.call(hr1, 'PUT', `${B}/batches/${b.id}`, { templateCode: 'ORG_DESIGNATION', title: 'New site designations', rows: [row('BK-SE', 'Site Engineer'), row('BK-PM', 'Project Manager', '8'), row('BK-QS', 'Quantity Surveyor')], version: (await t.call(hr1, 'GET', `${B}/batches/${b.id}`)).json.data.rowVersion });
  assert.equal(fixed.status, 200, JSON.stringify(fixed.json)); assert.equal(fixed.json.data.errors, 0);
  const sub = (await t.call(hr1, 'POST', `${B}/batches/${b.id}/submit`, { reason: 'Designations for the new region' })).json.data;
  assert.deepEqual([sub.status, sub.approver], ['SUBMITTED', 'HRMGR']); assert.deepEqual(t.designations(), []);
  assert.equal((await t.call(hr1, 'PUT', `${B}/batches/${b.id}`, { templateCode: 'ORG_DESIGNATION', title: 'x y z', rows: [row('BK-X', 'X')] })).status, 409, 'locked once submitted');
  assert.notEqual((await t.call(hr1, 'POST', `${B}/batches/${b.id}/act`, { action: 'approve' })).status, 200, 'the preparer never approves');
  assert.equal((await t.call(hr2, 'GET', `${B}/batches?scope=approve`)).json.data.rows[0].canApprove, true);
  const ok = await t.call(hr2, 'POST', `${B}/batches/${b.id}/act`, { action: 'approve', comment: 'Checked against the org chart' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json)); assert.deepEqual([ok.json.data.status, ok.json.data.result.created], ['IMPORTED', 3]);
  assert.deepEqual(t.designations(), ['BK-PM', 'BK-QS', 'BK-SE'], 'created through the organisation service as the preparer');
  assert.ok(t.db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'org_designations' AND actor = 'bk-hr1'").get());
  // T-01 atomic: the data changes after the check; the approved batch saves nothing and is marked FAILED with the reason
  const b2 = (await t.call(hr1, 'POST', `${B}/batches`, { templateCode: 'ORG_DESIGNATION', title: 'Second wave', rows: [row('BK-CM', 'Construction Manager'), row('BK-HSE', 'Safety Officer')] })).json.data;
  await t.call(hr1, 'POST', `${B}/batches/${b2.id}/submit`, { reason: 'Second wave of designations' });
  t.db.prepare("INSERT INTO org_designations (company_id, code, name) VALUES (1, 'BK-HSE', 'Created meanwhile')").run();
  const failed = (await t.call(hr2, 'POST', `${B}/batches/${b2.id}/act`, { action: 'approve' })).json.data;
  assert.equal(failed.status, 'FAILED'); assert.deepEqual(t.designations(), ['BK-HSE', 'BK-PM', 'BK-QS', 'BK-SE'], 'BK-CM was not saved: all or nothing');
  const again = (await t.call(hr1, 'GET', `${B}/batches/${b2.id}`)).json.data; assert.match(JSON.stringify(again.rowErrors), /already exists/); assert.equal(again.canEdit, true);
  // return for correction, then resubmit
  const b3 = (await t.call(hr1, 'POST', `${B}/batches`, { templateCode: 'ORG_DESIGNATION', title: 'Third wave', rows: [row('BK-AE', 'Assistant Engineer')] })).json.data;
  await t.call(hr1, 'POST', `${B}/batches/${b3.id}/submit`, { reason: 'Third wave of designations' });
  assert.equal((await t.call(hr2, 'POST', `${B}/batches/${b3.id}/act`, { action: 'return', comment: 'Add the grade' })).json.data.status, 'RETURNED');
  await t.call(hr1, 'PUT', `${B}/batches/${b3.id}`, { templateCode: 'ORG_DESIGNATION', title: 'Third wave', rows: [row('BK-AE', 'Assistant Engineer', '2', 'G2')] });
  assert.equal((await t.call(hr1, 'POST', `${B}/batches/${b3.id}/submit`, { reason: 'Grade added as asked' })).json.data.status, 'SUBMITTED');
  // roles and lists
  assert.equal((await t.call(se, 'GET', `${B}/batches/${b.id}`)).status, 404, 'another person\'s batch is not visible');
  assert.equal((await t.call(aud, 'GET', `${B}/batches?scope=all`)).json.data.total, 3);
  assert.equal((await t.call(aud, 'POST', `${B}/batches/${b3.id}/act`, { action: 'approve' })).status !== 200, true);
});

test('FR-01 FR-03 packs per module, the zip with README, instructions and templates, and a new version with history', async () => {
  const t = await setup();
  const list = (await t.call(hr1, 'GET', `${B}/packs`)).json.data;
  assert.deepEqual(list.rows.map((p) => p.code), ['masters', 'workforce', 'project', 'rates', 'bd']); assert.equal(list.canManage, false);
  const masters = list.rows.find((p) => p.code === 'masters');
  assert.ok(masters.templates.some((x) => x.code === 'ORG_DESIGNATION' && x.canImport && x.approver === 'HRMGR'));
  assert.ok(masters.templates.some((x) => x.code === 'MDM_ITEM' && !x.needsApproval), 'item requests follow their own approval');
  const zip = await t.api.raw('GET', `${B}/packs/masters/download`, hr1);
  assert.equal(zip.status, 200); assert.match(zip.headers.get('content-disposition'), /masters-pack-v1\.zip/);
  const files = unzipSync(new Uint8Array(zip.buffer)); const names = Object.keys(files);
  assert.ok(names.includes('README.txt')); assert.ok(names.includes('00-masters-instructions.xlsx')); assert.ok(names.some((n) => /org_designation-template/.test(n)), names.join(','));
  assert.ok(!names.some((n) => /mdm_currency/.test(n)), 'templates the person may not import are left out');
  assert.match(strFromU8(files['README.txt']), /Designations \(ORG_DESIGNATION\) — approved by HRMGR/);
  assert.equal((await t.call(hr1, 'POST', `${B}/packs/masters/versions`, { notes: 'Not allowed for HR' })).status, 403);
  const v2 = await t.call(it, 'POST', `${B}/packs/masters/versions`, { instructions: 'Use the codes of the group chart.\nOne designation a row.', examples: { ORG_DESIGNATION: { code: 'SE-1', name: 'Site Engineer', grade: 'G3', level: '3' } }, templates: ['ORG_DESIGNATION', 'MDM_ITEM'], notes: 'Examples for the group chart' });
  assert.equal(v2.status, 201, JSON.stringify(v2.json)); assert.deepEqual([v2.json.data.version, v2.json.data.templates.length, v2.json.data.history.length], [2, 2, 2]);
  assert.equal(v2.json.data.templates[0].example.code, 'SE-1');
  assert.equal((await t.call(it, 'POST', `${B}/packs/masters/versions`, { examples: { ORG_DESIGNATION: { code: '=HYPERLINK("x")' } }, notes: 'Formula example' })).status, 422);
  assert.equal((await t.call(it, 'POST', `${B}/packs/masters/versions`, { templates: ['NOT_A_TYPE'], notes: 'Unknown template' })).status, 422);
  const readme = strFromU8(unzipSync(new Uint8Array((await t.api.raw('GET', `${B}/packs/masters/download`, hr1)).buffer))['README.txt']);
  assert.match(readme, /version 2/); assert.match(readme, /group chart/); assert.match(readme, /v1 retired/);
  // volume: 100,000 batches list fast
  t.db.exec('BEGIN'); const ins = t.db.prepare("INSERT INTO xl_bulk_batches (company_id, doc_no, title, template_code, rows_json, row_count, status, actor_json, created_by) VALUES (1, ?, 'Load', 'ORG_DESIGNATION', '[]', 0, 'IMPORTED', '{}', 'bk-hr1')");
  for (let i = 0; i < 100_000; i += 1) ins.run(`V-${i}`); t.db.exec('COMMIT');
  const t0 = performance.now(); const l = await t.call(hr1, 'GET', `${B}/batches?pageSize=25`); assert.equal(l.status, 200); assert.equal(l.json.data.total, 100_000); assert.ok(performance.now() - t0 < 500);
});
