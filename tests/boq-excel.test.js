import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import '../src/server/modules/registry.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { templateWorkbook } from '../src/server/modules/eng/xl-xlsx.js';
import { setupCompany, startApi } from './helpers.js';
import { fill } from './ctr-helpers.js';

// PACK-18: the BOQ through the Excel engine (04.13, import type PROJ_BOQ_LINE). With ff.bill.pack18 on, what the commit would refuse — a
// quantity or rate that is not a number, a missing unit, a code twice in the file or already in the version, a frozen version — is a row
// error of the preview with its line and column, and nothing is written; the corrected file commits and its total equals the source.
const X = '/api/v1/xl';
const XLSX = 'application/octet-stream';
// QS has proj.boq.import but not xl.import.use (D-870): the test person holds both through a second role, as an administrator would grant
const qs = { roles: 'QS,HRMGR', user: 'xqs1', company: '1' };
const dirs = []; const apis = [];
after(async () => { for (const a of apis) await a.close(); for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

async function setup() {
  const storage = mkdtempSync(join(tmpdir(), 'erp-boqxl-')); dirs.push(storage);
  const api = await startApi({}, { storagePath: storage }); apis.push(api); await setupCompany(api); const d = api.db;
  d.prepare("INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, 'xqs1', 'XQS1', '[\"QS\",\"HRMGR\"]', 'xqs1@example.com')").run();
  const pj = Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'BX', 'Boq Excel road', 'ROAD', 'ACTIVE')").run().lastInsertRowid); d.prepare("INSERT INTO proj_projects (company_id, project_id, created_by) VALUES (1, ?, 'test')").run(pj);
  const draft = fill(d, 'proj_boq_versions', { company_id: 1, org_project_id: pj, doc_no: 'BOQ-X-1', vtype: 'TENDER', version_no: 1, name: 'Tender BOQ', status: 'DRAFT' });
  fill(d, 'proj_boq_versions', { company_id: 1, org_project_id: pj, doc_no: 'BOQ-X-2', vtype: 'CONTRACT', version_no: 2, name: 'Contract BOQ', status: 'APPROVED', frozen_at: '2026-03-30' });
  fill(d, 'proj_boq_lines', { company_id: 1, version_id: draft, line_kind: 'ITEM', item_code: '1.1', description: 'Clearing and grubbing', uom: 'sqm', qty: 1_000_000, rate: 120_000, amount: 0 });
  const runtime = runtimeOf(d); const drain = async () => { for (let i = 0; i < 6; i += 1) { runtime.bus.drain(); await runtime.jobs.drain(); } };
  const tq = await api.call('GET', `${X}/templates`, qs); if (!tq.json?.data) throw new Error(`templates ${tq.status} ${JSON.stringify(tq.json).slice(0, 300)}`); const cols = tq.json.data.types.find((x) => x.code === 'PROJ_BOQ_LINE').columns;
  const book = (rows) => templateWorkbook({ importType: 'PROJ_BOQ_LINE', version: 0, title: 'BOQ', columns: cols.map((c) => ({ key: c.key, label: c.label, required: c.required, type: c.type })), instructions: ['x'], rowsRaw: true, rows: rows.map((r) => cols.map((c) => r[c.key] ?? null)) });
  const run = async (rows) => { const r = await api.raw('POST', `${X}/jobs?type=PROJ_BOQ_LINE&fileName=boq.xlsx`, { ...qs, headers: { 'content-type': XLSX, 'idempotency-key': `bx-${Math.random().toString(36).slice(2, 10)}` }, body: await book(rows) }); assert.equal(r.status, 202, r.buffer.toString()); await drain(); return (await api.call('GET', `${X}/jobs/${r.json.data.id}`, qs)).json.data; };
  const errors = async (id) => (await api.call('GET', `${X}/jobs/${id}/errors?limit=500`, qs)).json.data;
  const commit = async (id) => { const r = await api.call('POST', `${X}/jobs/${id}/commit`, { ...qs, headers: { 'content-type': 'application/json', 'idempotency-key': `bxc-${Math.random().toString(36).slice(2, 10)}` }, body: {} }); if (r.status === 202) await drain(); return r; };
  return { api, d, draft, run, errors, commit, on: () => d.prepare("INSERT OR IGNORE INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES ('ff.bill.pack18', 1, 'test', 0, 1)").run() };
}
const good = [{ versionNo: 'BOQ-X-1', bill: 'Bill 1', section: 'Site clearance', itemCode: '1.2', description: 'Dismantling of culverts', uom: 'cum', qty: '45.5', rate: '1,250.75' }, { versionNo: 'BOQ-X-1', bill: 'Bill 2', section: 'Earthwork', itemCode: '2.1', description: 'Excavation in soil', uom: 'cum', qty: '12000', rate: '180' }];
const bad = [
  { ...good[0], qty: 'forty' }, // line 2: quantity not a number
  { ...good[1], uom: '' }, // line 3: the unit is missing
  { ...good[1], itemCode: '1.1' }, // line 4: already in the version
  { ...good[0], itemCode: '3.1', rate: '-5' }, // line 5: rate not a number of zero or more
  { ...good[0], itemCode: '3.2', versionNo: 'BOQ-X-2' }, // line 6: frozen version
  { ...good[0], itemCode: '3.3', versionNo: 'BOQ-X-9' }, // line 7: no such version
];

test('PACK-18 BOQ Excel import: the errors of each row are in the preview with line and column; nothing is written; the corrected file commits to the source total', async () => {
  const t = await setup(); const before = t.d.prepare('SELECT COUNT(*) AS n FROM proj_boq_lines').get().n;
  const off = await t.run(bad); assert.equal(off.status, 'PREVIEW'); assert.equal(off.errorRows ?? 0, 1, 'flag off: only the required unit is caught before the commit');
  t.on(); const j = await t.run(bad); assert.equal(j.errorRows, bad.length, JSON.stringify(j));
  const e = await t.errors(j.id); const rows = e.rows ?? e; const at = (line) => rows.filter((x) => x.row === line).map((x) => `${x.columnKey}:${x.message}`).join(' | ');
  assert.match(at(2), /^qty:.*"forty" is not a number/); assert.match(at(3), /uom:/); assert.match(at(4), /itemCode:The item code 1\.1 is in this BOQ already/); assert.match(at(5), /rate:.*"-5" is not a number of zero or more/); assert.match(at(6), /versionNo:.*frozen/); assert.match(at(7), /versionNo:.*BOQ-X-9 does not exist/);
  assert.notEqual((await t.commit(j.id)).status, 202, 'a file with errors is not committed'); assert.equal(t.d.prepare('SELECT COUNT(*) AS n FROM proj_boq_lines').get().n, before);
  const ok = await t.run(good); assert.deepEqual([ok.status, ok.errorRows, ok.createRows], ['PREVIEW', 0, 2]); assert.equal((await t.commit(ok.id)).status, 202);
  const made = t.d.prepare("SELECT item_code, qty, rate, amount FROM proj_boq_lines WHERE version_id = ? AND item_code IN ('1.2', '2.1') ORDER BY item_code").all(t.draft);
  assert.deepEqual(made.map((x) => [x.item_code, x.qty, x.rate]), [['1.2', 45_500, 12_507_500], ['2.1', 12_000_000, 1_800_000]]);
  assert.equal(made.reduce((n, x) => n + x.amount, 0), Math.round(45.5 * 1250.75 * 100) + 12000 * 180 * 100, 'Rs 56,909.13 + Rs 21,60,000 = the source total, to the paisa');
});
