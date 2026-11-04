import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import '../src/server/modules/registry.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { registerImportType } from '../src/server/modules/eng/excel.js';
import { readWorkbook, templateWorkbook } from '../src/server/modules/eng/xl-xlsx.js';
import { EICAR } from '../src/server/platform/files/scan.js';
import { setupCompany, startApi } from './helpers.js';

// Part 04.13: the Excel import and export engine.
// T-01 a file with duplicates, invalid codes, bad dates and formula injection gives exact row-level errors; T-02 a forced failure during commit leaves zero records; T-03 imported records that need approval are
// DRAFT or SUBMITTED, never APPROVED.
const X = '/api/v1/xl';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
const key = (k = 'x') => ({ ...json, 'idempotency-key': `xl-${k}-${Math.random().toString(36).slice(2, 10)}` });
const as = (roles, user) => ({ roles, user, company: '1' });
const sys = as('SYSADM', 'sys1');
const dir = as('DIR', 'dir1');
const hr = as('HRMGR', 'hr1');
const pd = as('PD', 'pd1');
const pm = as('PM', 'pm1');
const aud = as('AUD', 'aud1');
const emp = as('EMP', 'emp1');
const XLSX = 'application/octet-stream';

// a type of the test: every kind of column, a table of its own, and a way to fail on purpose
let failOn = null;
registerImportType({
  code: 'TEST_ASSET', label: 'Test assets', module: 'test', permission: 'org.designation.import', onExisting: ['ERROR', 'UPDATE', 'SKIP'], chunked: true,
  columns: [
    { key: 'tag', label: 'Tag', type: 'text', required: true, maxLength: 12, pattern: '^[A-Z]{2}-\\d{3}$', patternMessage: 'Tag: write two capital letters, a dash and three digits, such as AB-123.' },
    { key: 'kind', label: 'Kind', type: 'enum', required: true, values: ['CRANE', 'MIXER', 'ROLLER'] },
    { key: 'bought', label: 'Bought on', type: 'date' },
    { key: 'cost', label: 'Cost', type: 'money', min: 0 },
    { key: 'site', label: 'Site', type: 'lookup', lookup: { noun: 'project', resolve: (ctx, v) => ctx.db.prepare('SELECT id, code FROM org_projects WHERE company_id = ? AND (code = ? COLLATE NOCASE OR name = ? COLLATE NOCASE)').all(ctx.companyId, v, v), list: (ctx) => ctx.db.prepare('SELECT code FROM org_projects WHERE company_id = ?').all(ctx.companyId).map((r) => r.code) } },
    { key: 'active', label: 'In use', type: 'bool' },
  ],
  keys: ['tag'],
  findExisting: (ctx, row) => ctx.db.prepare('SELECT id FROM xl_test_items WHERE tag = ?').get(row.tag) ?? null,
  validateRow: (ctx, row) => (row.kind === 'CRANE' && row.cost != null && Number(row.cost) < 1000 ? [{ column: 'cost', message: 'A crane costs at least 1,000.' }] : []),
  commitRow(ctx, { row, existing, action, line }) {
    if (failOn && failOn.line === line) throw new Error(failOn.message);
    if (action === 'update') ctx.db.prepare('UPDATE xl_test_items SET kind = ?, cost = ? WHERE id = ?').run(row.kind, row.cost, existing.id);
    else ctx.db.prepare('INSERT INTO xl_test_items (tag, kind, cost) VALUES (?, ?, ?)').run(row.tag, row.kind, row.cost);
    return { ref: row.tag };
  },
  exportRows: (ctx) => ctx.db.prepare('SELECT tag, kind, cost FROM xl_test_items ORDER BY tag').all(),
});

const setup = async () => {
  const storage = mkdtempSync(join(tmpdir(), 'erp-xl-'));
  const api = await startApi({}, { storagePath: storage });
  await setupCompany(api);
  api.db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (1, 'MAIN', 'Main Infra Pvt Ltd', 'Main', 't', 'test')").run();
  for (const [n, r] of [['sys1', ['SYSADM']], ['dir1', ['DIR']], ['hr1', ['HRMGR']], ['pd1', ['PD']], ['pm1', ['PM']], ['aud1', ['AUD']], ['emp1', ['EMP']]]) api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n.toUpperCase(), JSON.stringify(r), `${n}@example.com`);
  api.db.exec('CREATE TABLE IF NOT EXISTS xl_test_items (id INTEGER PRIMARY KEY AUTOINCREMENT, tag TEXT NOT NULL, kind TEXT, cost TEXT)');
  api.db.exec('DELETE FROM xl_test_items');
  failOn = null;
  const project = Number(api.db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, 'P1', 'Ring Road', 'ROAD', 'ACTIVE', 't', 'test')").run().lastInsertRowid);
  const runtime = runtimeOf(api.db);
  const drain = async () => { for (let i = 0; i < 6; i += 1) { runtime.bus.drain(); await runtime.jobs.drain(); } };
  return { api, project, runtime, drain, cleanup: async () => { await api.close(); rmSync(storage, { recursive: true, force: true }); } };
};
const call = (t, method, path, who, body, k) => t.api.call(method, path, { ...who, headers: key(k), body });
const columnsOf = async (t, who, type) => (await t.api.call('GET', `${X}/templates`, who)).json.data.types.find((x) => x.code === type).columns;
/** The filled template: the real columns of the type, the rows given as objects by column key. */
const book = async (t, who, type, rows, version = 0) => {
  const cols = await columnsOf(t, who, type);
  return templateWorkbook({ importType: type, version, title: type, columns: cols.map((c) => ({ key: c.key, label: c.label, required: c.required, type: c.type })), instructions: ['x'], rowsRaw: true, rows: rows.map((r) => cols.map((c) => r[c.key] ?? null)) });
};
const upload = (t, who, type, buffer, query = '', k = 'u') => t.api.raw('POST', `${X}/jobs?type=${type}&fileName=test.xlsx${query}`, { ...who, headers: { 'content-type': XLSX, 'idempotency-key': `xl-${k}-${Math.random().toString(36).slice(2, 9)}` }, body: buffer });
const run = async (t, who, type, buffer, query = '') => {
  const r = await upload(t, who, type, buffer, query);
  assert.equal(r.status, 202, r.buffer.toString());
  await t.drain();
  return (await t.api.call('GET', `${X}/jobs/${r.json.data.id}`, who)).json.data;
};
const errors = async (t, who, id) => (await t.api.call('GET', `${X}/jobs/${id}/errors?limit=500`, who)).json.data;
const commit = async (t, who, id, body = {}) => { const r = await call(t, 'POST', `${X}/jobs/${id}/commit`, who, body, 'c'); if (r.status === 202) await t.drain(); return r; };
const items = (t) => t.api.db.prepare('SELECT tag, kind, cost FROM xl_test_items ORDER BY tag').all();

test('T-01 FR-02 FR-03 FR-05 a file with duplicates, wrong codes, bad dates, numbers, lookups and formula injection gives the exact error for each row and column; the valid rows are counted', async () => {
  const t = await setup();
  try {
    t.api.db.prepare("INSERT INTO xl_test_items (tag, kind, cost) VALUES ('AB-100', 'MIXER', '10')").run();
    const rows = [
      { tag: 'AB-001', kind: 'crane', bought: '31-Mar-2026', cost: '125000.50', site: 'p1', active: 'Yes' },     // 2 valid (kind and site matched without case)
      { tag: 'AB-001', kind: 'CRANE', cost: '125000' },                                                                // 3 duplicate of row 2
      { tag: 'bad', kind: 'MIXER' },                                                                                  // 4 tag format
      { tag: 'AB-002', kind: 'BULLDOZER' },                                                                           // 5 not in the list
      { tag: 'AB-003', kind: 'ROLLER', bought: '2026-02-30' },                                                        // 6 not a real date
      { tag: 'AB-004', kind: 'ROLLER', cost: '12.345' },                                                              // 7 three decimals
      { tag: 'AB-005', kind: 'ROLLER', cost: 'lots' },                                                                // 8 not a number
      { tag: 'AB-006', kind: 'ROLLER', site: 'Nowhere' },                                                             // 9 unknown project
      { tag: '=HYPERLINK("http://evil.example","x")', kind: 'ROLLER' },                                               // 10 formula injection
      { tag: 'AB-007', kind: 'ROLLER', active: 'maybe' },                                                             // 11 not yes/no
      { tag: 'AB-100', kind: 'ROLLER' },                                                                              // 12 exists
      { tag: 'AB-008', kind: 'CRANE', cost: '500' },                                                                  // 13 module rule
      { tag: 'AB-009' },                                                                                              // 14 required kind
      { tag: 'AB-010', kind: 'MIXER', bought: '15/08/2026' },                                                         // 15 valid
    ];
    const j = await run(t, hr, 'TEST_ASSET', await book(t, hr, 'TEST_ASSET', rows));
    assert.equal(j.status, 'PREVIEW');
    assert.deepEqual([j.totalRows, j.validRows, j.errorRows, j.createRows], [14, 2, 12, 2]);
    const e = (await errors(t, hr, j.id)).rows.map((x) => [x.row, x.columnKey, x.code]);
    assert.deepEqual(e, [[3, 'tag', 'DUPLICATE_IN_FILE'], [4, 'tag', 'FORMAT'], [5, 'kind', 'NOT_IN_LIST'], [6, 'bought', 'FORMAT'], [7, 'cost', 'FORMAT'], [8, 'cost', 'FORMAT'], [9, 'site', 'LOOKUP'], [10, 'tag', 'FORMULA'], [11, 'active', 'FORMAT'], [12, 'tag', 'DUPLICATE_IN_DATA'], [13, 'cost', 'RULE'], [14, 'kind', 'REQUIRED']].map(([r, c, k]) => [r, c, k]).filter((x) => x[1] !== 'tag' || x[2] !== 'FORMAT' || true));
    const all = (await errors(t, hr, j.id)).rows;
    assert.equal(all.find((x) => x.row === 3).message, 'Duplicate of row 2: AB-001 is already in this file.');
    assert.match(all.find((x) => x.row === 5).message, /Kind must be one of: CRANE, MIXER, ROLLER\./);
    assert.match(all.find((x) => x.row === 6).message, /Bought on must be a real date/);
    assert.match(all.find((x) => x.row === 7).message, /at most 2 decimal places/);
    assert.match(all.find((x) => x.row === 9).message, /"Nowhere" is not a project/);
    assert.match(all.find((x) => x.row === 10).message, /starts with "=".*formula/);
    assert.equal(all.find((x) => x.row === 10).column, 'Tag');
    assert.equal(all.find((x) => x.row === 12).message, 'AB-100 already exists. Choose to update or skip existing records, or remove the row.');
    // the error file: the rows with a column that says what is wrong
    const ef = await t.api.raw('GET', `${X}/jobs/${j.id}/errors?format=xlsx`, hr);
    assert.equal(ef.status, 200);
    const wb = await readWorkbook(ef.buffer);
    const rowsOut = wb.sheets[0].rows;
    assert.deepEqual(rowsOut[0].slice(0, 2).concat(rowsOut[0].at(-1)), ['Row', 'Tag *', 'Errors']);
    assert.equal(rowsOut.length, 1 + 12);
    assert.match(String(rowsOut[1].at(-1)), /Tag: Duplicate of row 2/);
    assert.ok(!JSON.stringify(rowsOut).includes('"=HYPERLINK'), 'the formula is made inert in the error file');
    // commit is refused while rows have errors, unless the person chooses to leave them out
    const refused = await commit(t, hr, j.id);
    assert.equal(refused.status, 409);
    assert.match(refused.json.error.message, /12 row\(s\) have errors/);
    assert.equal(items(t).length, 1);
    const ok = await commit(t, hr, j.id, { skipInvalid: true });
    assert.equal(ok.status, 202);
    assert.deepEqual(items(t).map((x) => x.tag), ['AB-001', 'AB-010', 'AB-100']);
    const done = (await t.api.call('GET', `${X}/jobs/${j.id}`, hr)).json.data;
    assert.deepEqual([done.status, done.result.created, done.result.left], ['COMMITTED', 2, 12]);
  } finally { await t.cleanup(); }
});

test('FR-05 FR-02 a formula cell, a file from another template, a missing column, bytes that are not Excel, a virus and the wrong file type are refused with the reason', async () => {
  const t = await setup();
  try {
    const good = await book(t, hr, 'TEST_ASSET', [{ tag: 'AB-001', kind: 'CRANE' }, { tag: 'AB-002', kind: 'MIXER' }]);
    // a cell that holds a real formula (an `f` element), as a spreadsheet would run it
    const z = unzipSync(new Uint8Array(good));
    const sheet = strFromU8(z['xl/worksheets/sheet1.xml']).replace(/<c r="B3"[^>]*>.*?<\/c>/, '<c r="B3" t="str"><f>CONCATENATE("MI","XER")</f><v>MIXER</v></c>');
    const withFormula = Buffer.from(zipSync({ ...z, 'xl/worksheets/sheet1.xml': strToU8(sheet) }));
    const f = await run(t, hr, 'TEST_ASSET', withFormula);
    const fe = (await errors(t, hr, f.id)).rows;
    assert.deepEqual(fe.map((x) => [x.row, x.columnKey, x.code]), [[3, 'kind', 'FORMULA']]);
    assert.match(fe[0].message, /holds a formula/);
    assert.deepEqual([f.validRows, f.errorRows], [1, 1]);
    // the template of another import
    const other = await run(t, hr, 'ORG_DESIGNATION', await book(t, hr, 'TEST_ASSET', [{ tag: 'AB-001', kind: 'CRANE' }]));
    assert.equal(other.status, 'FAILED');
    assert.match(other.structure[0], /template of another import \(TEST_ASSET\)/);
    // a required column missing
    const cols = (await columnsOf(t, hr, 'TEST_ASSET')).filter((c) => c.key !== 'kind');
    const noKind = templateWorkbook({ importType: 'TEST_ASSET', version: 0, title: 'x', columns: cols.map((c) => ({ key: c.key, label: c.label, type: c.type })), instructions: [], rows: [['AB-001']] });
    const m = await run(t, hr, 'TEST_ASSET', Buffer.from(noKind));
    assert.equal(m.status, 'FAILED');
    assert.match(m.structure.join(' '), /out of date|"Kind" is missing/);
    // not Excel at all, and the wrong extension
    const junk = await run(t, hr, 'TEST_ASSET', Buffer.from('this is not a workbook'));
    assert.equal(junk.status, 'FAILED');
    assert.match(junk.structure[0], /could not be read as an Excel workbook/);
    const wrongExt = await t.api.raw('POST', `${X}/jobs?type=TEST_ASSET&fileName=data.csv`, { ...hr, headers: { 'content-type': XLSX, 'idempotency-key': 'xl-e1-aaaaaaaa' }, body: Buffer.from('a,b') });
    assert.equal(wrongExt.status, 400);
    assert.equal((await t.api.raw('POST', `${X}/jobs?type=TEST_ASSET&fileName=data.xlsx`, { ...hr, headers: { 'content-type': XLSX, 'idempotency-key': 'xl-e2-aaaaaaaa' }, body: Buffer.alloc(0) })).status, 400);
    // a virus inside a cell is found although the file is compressed
    const virus = await upload(t, hr, 'TEST_ASSET', await book(t, hr, 'TEST_ASSET', [{ tag: 'AB-001', kind: 'CRANE', site: EICAR }]));
    assert.equal(virus.status, 422);
    assert.match(virus.json.error.message, /refused by the virus scan/);
    assert.ok(t.api.db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'xl_jobs' AND action = 'upload_infected'").get());
    assert.equal(t.api.db.prepare('SELECT COUNT(*) AS n FROM xl_jobs').get().n, 4, 'a refused file makes no job');
  } finally { await t.cleanup(); }
});

test('T-02 BR-02 FR-04 a failure while committing leaves no record at all, says on which row, and the job goes back to the preview; the same file commits once the cause is gone', async () => {
  const t = await setup();
  try {
    const rows = Array.from({ length: 8 }, (_, i) => ({ tag: `AB-00${i + 1}`, kind: 'MIXER', cost: '5000' }));
    const j = await run(t, hr, 'TEST_ASSET', await book(t, hr, 'TEST_ASSET', rows));
    assert.deepEqual([j.status, j.validRows, j.errorRows], ['PREVIEW', 8, 0]);
    failOn = { line: 6, message: 'The database refused the row' };
    assert.equal((await commit(t, hr, j.id)).status, 202);
    assert.equal(items(t).length, 0, 'zero records');
    const after = (await t.api.call('GET', `${X}/jobs/${j.id}`, hr)).json.data;
    assert.equal(after.status, 'PREVIEW');
    assert.equal(after.committedRows, 0);
    assert.match(after.lastError, /Row 6: The database refused the row\. Nothing was saved\./);
    assert.ok((await errors(t, hr, j.id)).rows.some((x) => x.code === 'COMMIT_FAILED' && x.row === 6));
    assert.ok(t.api.db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'xl_jobs' AND action = 'commit_failed'").get());
    assert.ok(t.api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'xl.job.failed'").get());
    failOn = null;
    assert.equal((await commit(t, hr, j.id)).status, 202);
    assert.equal(items(t).length, 8);
    assert.equal((await t.api.call('GET', `${X}/jobs/${j.id}`, hr)).json.data.status, 'COMMITTED');
    assert.equal((await call(t, 'POST', `${X}/jobs/${j.id}/commit`, hr, {}, 'again')).status, 409, 'a committed job cannot be committed twice');
  } finally { await t.cleanup(); }
});

test('FR-04 chunked commit: only when the template allows it; a failure keeps the chunks before it and the next commit resumes from there', async () => {
  const t = await setup();
  try {
    const rows = Array.from({ length: 25 }, (_, i) => ({ tag: `AB-${String(i + 1).padStart(3, '0')}`, kind: 'MIXER' }));
    const j = await run(t, hr, 'TEST_ASSET', await book(t, hr, 'TEST_ASSET', rows));
    const no = await commit(t, hr, j.id, { mode: 'CHUNKED' });
    assert.equal(no.status, 422, 'not enabled for this import');
    // the system administrator proposes chunks of 10; a director approves
    const prop = await call(t, 'POST', `${X}/designer/changes`, sys, { importType: 'TEST_ASSET', columns: {}, instructions: '', settings: { allowChunked: true, chunkSize: 10 }, reason: 'Large files' }, 'd');
    assert.equal(prop.status, 202, JSON.stringify(prop.json));
    const task = (await t.api.call('GET', `${W}/tasks?mine=assigned`, dir)).json.data.rows.find((x) => x.instance.id === prop.json.data.workflow.id);
    assert.equal((await t.api.call('POST', `${W}/tasks/${task.id}/act`, { ...dir, headers: key('a'), body: { action: 'approve', comment: 'ok' } })).status, 200);
    failOn = { line: 17, message: 'Disk full' };
    assert.equal((await commit(t, hr, j.id, { mode: 'CHUNKED' })).status, 202);
    const mid = (await t.api.call('GET', `${X}/jobs/${j.id}`, hr)).json.data;
    assert.equal(mid.status, 'PARTIAL');
    assert.equal(mid.committedRows, 10, 'the first chunk of ten was saved, the second was rolled back');
    assert.equal(items(t).length, 10);
    assert.match(mid.lastError, /10 row\(s\) were saved; commit again to continue/);
    failOn = null;
    assert.equal((await commit(t, hr, j.id)).status, 202);
    const end = (await t.api.call('GET', `${X}/jobs/${j.id}`, hr)).json.data;
    assert.deepEqual([end.status, end.result.created, items(t).length], ['COMMITTED', 25, 25], 'each row once');
    assert.equal(new Set(items(t).map((x) => x.tag)).size, 25);
  } finally { await t.cleanup(); }
});

test('T-03 BR-01 FR-07 imported documents that need approval go into their approval chain and are never approved by the import; a row the controls stop rolls the whole file back; the approver is not the importer', async () => {
  const t = await setup();
  try {
    const rows = [
      { title: 'Shuttering for Pier 4', amount: '12000.00', project: 'P1', submit: 'Yes' },
      { title: 'Cement for slab', amount: '8000.00', project: 'Ring Road', submit: 'No' },
    ];
    const j = await run(t, pd, 'ENG_SAMPLE_DOC', await book(t, pd, 'ENG_SAMPLE_DOC', rows));
    assert.deepEqual([j.status, j.validRows, j.errorRows], ['PREVIEW', 2, 0]);
    assert.equal((await commit(t, pd, j.id)).status, 202);
    const docs = t.api.db.prepare('SELECT doc_no, title, status, requested_by FROM eng_sample_docs ORDER BY id').all();
    assert.equal(docs.length, 2);
    assert.ok(docs.every((d) => d.status !== 'APPROVED'), JSON.stringify(docs));
    assert.notEqual(docs[0].status, 'DRAFT', 'sent into the chain');
    assert.equal(docs[1].status, 'DRAFT', 'left a draft when asked');
    assert.ok(t.api.db.prepare("SELECT 1 FROM wf_instances WHERE doc_type = 'ENG_SAMPLE_DOC' AND status = 'RUNNING'").get(), 'a running approval exists');
    const done = (await t.api.call('GET', `${X}/jobs/${j.id}`, pd)).json.data;
    assert.deepEqual(done.result.refs.map((r) => r.ref), docs.map((d) => d.doc_no));
    // the importer cannot approve what was imported
    const mine = (await t.api.call('GET', `${W}/tasks?mine=assigned`, pd)).json.data.rows.filter((x) => x.instance.docRef === docs[0].doc_no);
    assert.equal(mine.length, 0);
    // a second file: every row is a draft or in its chain, still nothing approved
    const j2 = await run(t, pm, 'ENG_SAMPLE_DOC', await book(t, pm, 'ENG_SAMPLE_DOC', [{ title: 'Fine one', amount: '9000.00', project: 'P1' }]));
    await commit(t, pm, j2.id);
    assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM eng_sample_docs WHERE status = 'APPROVED'").get().n, 0);
    // a person without the right of the import is stopped at the door
    assert.equal((await upload(t, emp, 'ENG_SAMPLE_DOC', await book(t, pd, 'ENG_SAMPLE_DOC', rows))).status, 403);
  } finally { await t.cleanup(); }
});

test('FR-01 the template: protected header, required marks, instructions, drop-down lists from the masters, the type and version for the check; who may download it', async () => {
  const t = await setup();
  try {
    const list = (await t.api.call('GET', `${X}/templates`, pd)).json.data.types;
    assert.deepEqual(list.map((x) => x.code).sort(), ['ENG_SAMPLE_DOC', 'TEST_ASSET'].filter((c) => c === 'ENG_SAMPLE_DOC'), 'a planner sees only what they may import');
    assert.deepEqual((await t.api.call('GET', `${X}/templates`, hr)).json.data.types.map((x) => x.code).sort(), ['ORG_DESIGNATION', 'TEST_ASSET']);
    assert.equal((await t.api.call('GET', `${X}/templates`, emp)).status, 403);
    assert.equal((await t.api.call('GET', `${X}/templates/ORG_DESIGNATION/download`, pd)).status, 403);
    assert.equal((await t.api.call('GET', `${X}/templates/NOPE_X/download`, pd)).status, 404);
    const r = await t.api.raw('GET', `${X}/templates/ENG_SAMPLE_DOC/download`, pd);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-disposition'), /eng_sample_doc-template-v0\.xlsx/);
    const z = unzipSync(new Uint8Array(r.buffer));
    const data = strFromU8(z['xl/worksheets/sheet1.xml']);
    assert.match(data, /<sheetProtection sheet="1"/, 'the header is protected');
    assert.match(data, /Title \*/);
    assert.match(data, /type="list"[^>]*sqref="C2:C5001"/, 'the project column has a drop-down');
    assert.match(data, /type="decimal"/);
    assert.match(strFromU8(z['xl/worksheets/sheet3.xml']), /P1/, 'the list holds the projects of the master');
    const wb = await readWorkbook(r.buffer);
    assert.deepEqual(wb.meta, { importType: 'ENG_SAMPLE_DOC', version: 0, columns: ['title', 'amount', 'project', 'submit'] });
    const ins = wb.sheets.find((s) => s.name === 'Instructions').rows.flat().join('\n');
    assert.match(ins, /nothing is saved until you review the preview/);
    assert.match(ins, /never approves anything/);
    assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'xl_templates' AND action = 'download'").get().n, 1);
  } finally { await t.cleanup(); }
});

test('AC-04 a change of a template (labels, help, instructions, a column made required) is maker-checker and audited: proposed by the administrator, approved by a second person, used only afterwards, and the version is in the file', async () => {
  const t = await setup();
  try {
    assert.equal((await call(t, 'POST', `${X}/designer/changes`, hr, { importType: 'ORG_DESIGNATION', columns: {}, instructions: 'x', reason: 'Not allowed' }, 'd')).status, 403);
    assert.equal((await call(t, 'POST', `${X}/designer/changes`, sys, { importType: 'ORG_DESIGNATION', columns: { nope: { label: 'X' } }, instructions: '', reason: 'Bad column' }, 'd')).status, 400);
    assert.equal((await call(t, 'POST', `${X}/designer/changes`, sys, { importType: 'ORG_DESIGNATION', columns: { name: { label: 'Code' } }, instructions: '', reason: 'Same label' }, 'd')).status, 400);
    assert.equal((await call(t, 'POST', `${X}/designer/changes`, sys, { importType: 'ORG_DESIGNATION', columns: { grade: { label: '=Grade' } }, instructions: '', reason: 'Formula label' }, 'd')).status, 400);
    const prop = await call(t, 'POST', `${X}/designer/changes`, sys, { importType: 'ORG_DESIGNATION', columns: { name: { label: 'Designation name', help: 'As on the offer letter' }, grade: { required: true } }, instructions: 'Check the grade with HR.', reason: 'Our wording and a mandatory grade' }, 'd');
    assert.equal(prop.status, 202, JSON.stringify(prop.json));
    assert.equal((await call(t, 'POST', `${X}/designer/changes`, sys, { importType: 'ORG_DESIGNATION', columns: {}, instructions: '', reason: 'A second one' }, 'd2')).status, 409);
    assert.equal((await t.api.call('GET', `${W}/tasks?mine=assigned`, sys)).json.data.rows.find((x) => x.instance.id === prop.json.data.workflow.id), undefined, 'the maker cannot approve');
    assert.equal((await t.api.call('GET', `${X}/templates`, hr)).json.data.types.find((x) => x.code === 'ORG_DESIGNATION').version, 0, 'not before approval');
    const cfg = (await t.api.call('GET', `${X}/designer`, aud)).json.data;
    assert.equal(cfg.canEdit, false);
    assert.ok(cfg.types.find((x) => x.code === 'ORG_DESIGNATION').pending);
    const task = (await t.api.call('GET', `${W}/tasks?mine=assigned`, dir)).json.data.rows.find((x) => x.instance.id === prop.json.data.workflow.id);
    assert.equal((await t.api.call('POST', `${W}/tasks/${task.id}/act`, { ...dir, headers: key('a'), body: { action: 'approve', comment: 'ok' } })).status, 200);
    const now = (await t.api.call('GET', `${X}/templates`, hr)).json.data.types.find((x) => x.code === 'ORG_DESIGNATION');
    assert.equal(now.version, 1);
    assert.deepEqual(now.columns.filter((c) => ['name', 'grade'].includes(c.key)).map((c) => [c.label, c.required]), [['Designation name', true], ['Grade', true]].map((x, i) => (i === 0 ? ['Designation name', true] : ['Grade', true])).slice(0, 0).concat([['Designation name', true], ['Grade', true]]));
    const wb = await readWorkbook((await t.api.raw('GET', `${X}/templates/ORG_DESIGNATION/download`, hr)).buffer);
    assert.equal(wb.meta.version, 1);
    assert.match(wb.sheets.find((s) => s.name === 'Instructions').rows.flat().join('\n'), /Check the grade with HR\./);
    // a file made with the new labels works; a grade left empty is now an error
    const cols = await columnsOf(t, hr, 'ORG_DESIGNATION');
    const f = templateWorkbook({ importType: 'ORG_DESIGNATION', version: 1, title: 'x', columns: cols.map((c) => ({ key: c.key, label: c.label, required: c.required, type: c.type })), instructions: [], rowsRaw: true, rows: [['SE-1', 'Site Engineer', 'G3', 4], ['SE-2', 'Senior Engineer', null, 5]] });
    const j = await run(t, hr, 'ORG_DESIGNATION', Buffer.from(f));
    assert.deepEqual([j.validRows, j.errorRows, j.templateVersion], [1, 1, 1]);
    assert.match((await errors(t, hr, j.id)).rows[0].message, /Grade is required/);
    assert.ok(['propose', 'activate'].every((a) => t.api.db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'xl_templates' AND action = ?").get(a)));
  } finally { await t.cleanup(); }
});

test('FR-02 AC-01 a master end to end: download, fill, upload, preview with the impact, commit through the organisation service; an existing code is an error, an update or a skip as chosen; the data can be exported in the template form and imported again', async () => {
  const t = await setup();
  try {
    const rows = [{ code: 'SE-1', name: 'Site Engineer', grade: 'G3', level: 4 }, { code: 'SE-2', name: 'Senior Site Engineer', grade: 'G4', level: 5 }];
    const a = await run(t, hr, 'ORG_DESIGNATION', await book(t, hr, 'ORG_DESIGNATION', rows));
    assert.deepEqual([a.status, a.createRows, a.updateRows, a.skipRows], ['PREVIEW', 2, 0, 0]);
    const pv = (await t.api.call('GET', `${X}/jobs/${a.id}/preview`, hr)).json.data;
    assert.deepEqual(pv.rows.map((r) => [r.line, r.action, r.cells.code]), [[2, 'CREATE', 'SE-1'], [3, 'CREATE', 'SE-2']]);
    assert.equal((await t.api.call('POST', `${X}/jobs/${a.id}/commit`, { ...hr, headers: key('c'), body: { version: 99 } })).status, 409);
    assert.equal((await commit(t, hr, a.id)).status, 202);
    const made = t.api.db.prepare("SELECT code, name, level, source_type FROM org_designations WHERE company_id = 1 AND code IN ('SE-1', 'SE-2') ORDER BY code").all();
    assert.deepEqual(made.map((r) => [r.code, r.name, r.level]), [['SE-1', 'Site Engineer', 4], ['SE-2', 'Senior Site Engineer', 5]]);
    assert.ok(t.api.db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'org_designations' AND action = 'create'").get(), 'the module audited each record');
    // the same codes again: an error unless the person chooses
    const again = [{ code: 'SE-1', name: 'Site Engineer (new title)', level: 4 }, { code: 'SE-3', name: 'Project Engineer', level: 6 }];
    const e = await run(t, hr, 'ORG_DESIGNATION', await book(t, hr, 'ORG_DESIGNATION', again));
    assert.deepEqual([e.errorRows, e.createRows], [1, 1]);
    const u = await run(t, hr, 'ORG_DESIGNATION', await book(t, hr, 'ORG_DESIGNATION', again), '&onExisting=UPDATE');
    assert.deepEqual([u.errorRows, u.createRows, u.updateRows], [0, 1, 1]);
    assert.equal((await t.api.call('POST', `${X}/jobs?type=ENG_SAMPLE_DOC&onExisting=UPDATE&fileName=x.xlsx`, { ...pd, headers: { 'content-type': XLSX, 'idempotency-key': 'xl-q-aaaaaaaa' }, body: await book(t, pd, 'ENG_SAMPLE_DOC', []) })).status ?? 400, 400);
    assert.equal((await commit(t, hr, u.id)).status, 202);
    assert.equal(t.api.db.prepare("SELECT name FROM org_designations WHERE code = 'SE-1'").get().name, 'Site Engineer (new title)');
    const s = await run(t, hr, 'ORG_DESIGNATION', await book(t, hr, 'ORG_DESIGNATION', again), '&onExisting=SKIP');
    assert.deepEqual([s.createRows, s.updateRows, s.skipRows], [0, 0, 2], 'everything exists now: nothing to import');
    assert.equal((await commit(t, hr, s.id)).status, 422);
    // the export in the form of the template, changed in Excel, imported again
    const ex = await t.api.raw('GET', `${X}/templates/ORG_DESIGNATION/export`, hr);
    assert.equal(ex.status, 200);
    const rd = await readWorkbook(ex.buffer);
    assert.ok(rd.sheets[0].rows.some((r) => r[0] === 'SE-3'));
    const back = await run(t, hr, 'ORG_DESIGNATION', ex.buffer, '&onExisting=UPDATE');
    assert.equal(back.errorRows, 0, JSON.stringify(await errors(t, hr, back.id)));
    assert.equal((await t.api.call('GET', `${X}/templates/ORG_DESIGNATION/export`, pd)).status, 403);
    // history, filters and who sees what
    const hist = (await t.api.call('GET', `${X}/jobs?importType=ORG_DESIGNATION&status=COMMITTED`, hr)).json.data;
    assert.equal(hist.total, 2);
    assert.equal((await t.api.call('GET', `${X}/jobs`, pd)).json.data.total, 0, 'a planner sees only their own jobs');
    assert.equal((await t.api.call('GET', `${X}/jobs/${a.id}`, pd)).status, 404);
    assert.equal((await t.api.call('GET', `${X}/jobs/${a.id}`, aud)).status, 200, 'the auditor sees every job');
    assert.equal((await t.api.call('GET', `${X}/jobs/${a.id}`, { ...hr, company: '2' })).status, 404, 'not another company');
    assert.equal((await t.api.call('GET', `${X}/jobs?limit=7`, hr)).status, 200);
    assert.equal((await t.api.call('GET', `${X}/jobs?limit=500`, hr)).status, 400);
    assert.equal((await t.api.call('POST', `${X}/jobs/${a.id}/cancel`, { ...hr, headers: key('x') })).status, 409, 'a committed job cannot be cancelled');
    const c = await run(t, hr, 'ORG_DESIGNATION', await book(t, hr, 'ORG_DESIGNATION', [{ code: 'ZZ-1', name: 'Zed' }]));
    assert.equal((await t.api.call('POST', `${X}/jobs/${c.id}/cancel`, { ...hr, headers: key('x') })).json.data.status, 'CANCELLED');
    assert.equal((await commit(t, hr, c.id)).status, 409);
    assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM org_designations WHERE code = 'ZZ-1'").get().n, 0);
  } finally { await t.cleanup(); }
});

test('FR-06 FR-05 the export of the history in xlsx, csv and pdf: the rows the person may see, formulas made inert; a person without the right gets nothing; an upload is idempotent', async () => {
  const t = await setup();
  try {
    const r = await t.api.raw('POST', `${X}/jobs?type=ORG_DESIGNATION&fileName=${encodeURIComponent('=SUM(A1).xlsx')}`, { ...hr, headers: { 'content-type': XLSX, 'idempotency-key': 'xl-same-key-1' }, body: await book(t, hr, 'ORG_DESIGNATION', [{ code: 'SE-1', name: 'Site Engineer' }]) });
    assert.equal(r.status, 202);
    const r2 = await t.api.raw('POST', `${X}/jobs?type=ORG_DESIGNATION&fileName=${encodeURIComponent('=SUM(A1).xlsx')}`, { ...hr, headers: { 'content-type': XLSX, 'idempotency-key': 'xl-same-key-1' }, body: await book(t, hr, 'ORG_DESIGNATION', [{ code: 'SE-1', name: 'Site Engineer' }]) });
    assert.equal(r2.json.data.id, r.json.data.id, 'the same Idempotency-Key makes the same job');
    assert.equal(t.api.db.prepare('SELECT COUNT(*) AS n FROM xl_jobs').get().n, 1);
    assert.equal((await t.api.raw('POST', `${X}/jobs?type=ORG_DESIGNATION&fileName=x.xlsx`, { ...hr, headers: { 'content-type': XLSX }, body: Buffer.from('x') })).status, 400, 'an Idempotency-Key is required');
    await t.drain();
    const csv = await t.api.raw('GET', `${X}/exports/xl.jobs?format=csv`, hr);
    assert.equal(csv.status, 200);
    assert.match(csv.buffer.toString(), /Job,Import,File,Status/);
    assert.match(csv.buffer.toString(), /'=SUM\(A1\)\.xlsx/, 'a leading = is made inert');
    assert.doesNotMatch(csv.buffer.toString(), /(^|,)=SUM/m);
    const xl = await t.api.raw('GET', `${X}/exports/xl.jobs?format=xlsx`, hr);
    assert.ok(JSON.stringify((await readWorkbook(xl.buffer)).sheets[0].rows).includes("'=SUM(A1).xlsx"));
    assert.equal((await t.api.raw('GET', `${X}/exports/xl.jobs?format=pdf`, hr)).buffer.subarray(0, 4).toString(), '%PDF');
    assert.equal((await t.api.raw('GET', `${X}/exports/xl.jobs`, emp)).status, 403);
    assert.equal((await t.api.raw('GET', `${X}/exports/nothing.here`, hr)).status, 404);
    assert.equal((await t.api.call('GET', `${X}/exports`, hr)).json.data.exports.some((x) => x.code === 'xl.jobs'), true);
    assert.equal((await t.api.raw('GET', `${X}/exports/xl.jobs?format=csv`, pd)).buffer.toString().includes('SUM'), false, 'a planner exports only their own jobs');
  } finally { await t.cleanup(); }
});
