import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { startApi } from './helpers.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';

// Part 03.03: the List Report contract on the reference register (sample material requests), saved views, exports and bulk actions.
const U = '/api/v1/ui';
const json = { 'content-type': 'application/json' };
const key = (k) => ({ ...json, 'idempotency-key': `list-${k}-${Math.random().toString(36).slice(2, 10)}` });
const pm = { roles: 'PM', user: 'pm1' };
const sys = { roles: 'SYSADM', user: 'sys1' };

/** Requests straight into the table (a register with history) on two projects. Request i is worth i rupees (i * 100 paise). */
function seed(api, n, { company = 1 } = {}) {
  const db = api.db;
  const project = (code, name) => Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (?, ?, ?, 'ROAD', 'ACTIVE', 't', 'test')").run(company, code, name).lastInsertRowid);
  const p1 = project(`NH${company}`, 'NH-48 Widening');
  const p2 = project(`MB${company}`, 'Mithi bridge');
  const ins = db.prepare("INSERT INTO ui_sample_requests (company_id, doc_no, doc_date, status, title, project_id, requested_by, required_by, priority, total_amount, line_count, created_by, created_at, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 't', ?, 'sample_request')");
  const statuses = ['DRAFT', 'SUBMITTED', 'CANCELLED'];
  db.exec('BEGIN');
  for (let i = 1; i <= n; i += 1) {
    const status = statuses[i % 3];
    const month = (i % 12) + 1;
    const date = `${month >= 4 ? 2026 : 2027}-${String(month).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`;
    ins.run(company, status === 'DRAFT' ? null : `MR/${company}/${String(i).padStart(6, '0')}`, date, status, i % 7 === 0 ? `Shuttering plates lot ${i}` : `Cement lot ${i}`, i % 2 ? p1 : p2, i % 5 === 0 ? 'pm1' : 'pm2', date, i % 10 === 0 ? 'URGENT' : 'NORMAL', i * 100, (i % 4) + 1, new Date(Date.UTC(2026, 9, 1) + i * 1000).toISOString());
  }
  db.exec('COMMIT');
  return { p1, p2 };
}
const sumTo = (n) => (n * (n + 1)) / 2;

test('FR-01 FR-02 FR-09 the list describes its columns, searches, filters with operators, sorts, pages and totals the whole filtered set', async () => {
  const api = await startApi();
  seed(api, 300);
  const d = await api.call('GET', `${U}/lists/ui.sample_requests`, pm);
  assert.equal(d.status, 200, JSON.stringify(d.json));
  assert.deepEqual(d.json.data.columns.map((c) => c.key), ['docNo', 'docDate', 'title', 'projectCode', 'siteCode', 'status', 'priority', 'requiredBy', 'lineCount', 'total', 'requestedBy', 'createdAt']);
  assert.deepEqual(d.json.data.columns.find((c) => c.key === 'total').operators, ['eq', 'ne', 'gte', 'lte', 'between', 'empty', 'notempty']);
  const get = (qs, who = pm) => api.call('GET', `${U}/sample-requests?${qs}`, who);
  const all = await get('pageSize=25');
  assert.deepEqual([all.json.meta.total, all.json.meta.totalPages, all.json.data.length], [300, 12, 25]);
  assert.equal(all.json.meta.totals.total, sumTo(300).toFixed(2));
  // filters: in, gte on money in rupees, between on a date, contains, empty; the totals follow the filter
  const sub = await get('filter[status][in]=SUBMITTED,CANCELLED&pageSize=50');
  assert.equal(sub.json.meta.total, 200);
  assert.ok(sub.json.data.every((r) => r.status !== 'DRAFT'));
  const big = await get('filter[total][gte]=250');
  assert.equal(big.json.meta.total, 51);
  assert.equal(big.json.meta.totals.total, (sumTo(300) - sumTo(249)).toFixed(2));
  const q1 = await get('filter[docDate][between]=2026-04-01,2026-06-30');
  assert.ok(q1.json.data.every((r) => r.docDate >= '2026-04-01' && r.docDate <= '2026-06-30'));
  assert.equal((await get('filter[title][contains]=shuttering')).json.meta.total, Math.floor(300 / 7));
  assert.equal((await get('filter[docNo][empty]=1')).json.meta.total, 100, 'drafts have no number');
  assert.equal((await get('q=MB1')).json.meta.total, 150, 'search covers the project code');
  // sort and pages
  const sorted = await get('sort=-total&pageSize=10&page=2');
  assert.deepEqual(sorted.json.data.map((r) => r.total), Array.from({ length: 10 }, (_, i) => (290 - i).toFixed(2)));
  const two = await get('sort=priority,-docDate&pageSize=200');
  assert.equal(two.json.data[0].priority, 'NORMAL');
  // refusals name the parameter
  for (const [qs, field] of [['pageSize=30', 'pageSize'], ['sort=secret', 'sort'], ['filter[nope]=1', 'filter[nope]'], ['filter[total][contains]=1', 'filter[total][contains]'], ['filter[total][gte]=abc', 'filter[total]'], ['filter[status]=LOST', 'filter[status]'], ['filter[docDate][between]=2026-01-01', 'filter[docDate][between]'], ['bogus=1', 'bogus']]) {
    const r = await get(qs);
    assert.equal(r.status, 400, qs);
    assert.equal(r.json.error.details[0].field, field, qs);
  }
  // another company sees none of it; a role without core.sample.use is refused
  assert.equal((await get('pageSize=25', { ...pm, company: '2' })).json.meta.total, 0);
  assert.equal((await get('pageSize=25', { roles: 'EMP', user: 'e1' })).status, 403);
  assert.equal((await api.call('GET', `${U}/lists/ui.sample_requests`, { roles: 'EMP', user: 'e1' })).status, 403);
  assert.equal((await api.call('GET', `${U}/lists/nope.list`, pm)).status, 404);
  await api.close();
});

test('T-01 filter, sort and pagination on 100,000 rows give the right page, count and totals within the list target', async () => {
  const api = await startApi();
  seed(api, 100_000);
  const times = [];
  const timed = async (qs) => {
    const t0 = performance.now();
    const r = await api.call('GET', `${U}/sample-requests?${qs}`, pm);
    times.push(performance.now() - t0);
    assert.equal(r.status, 200, qs);
    return r.json;
  };
  const all = await timed('pageSize=100');
  assert.equal(all.meta.total, 100_000);
  assert.equal(all.meta.totals.total, sumTo(100_000).toFixed(2));
  const urgent = await timed('filter[priority]=URGENT&filter[status]=SUBMITTED&sort=-total&pageSize=50&page=3');
  // URGENT is i % 10 == 0, SUBMITTED is i % 3 == 1: i = 10, 40, 70, ... (i % 30 == 10)
  const expected = Array.from({ length: 3334 }, (_, k) => 10 + 30 * k).filter((i) => i <= 100_000);
  assert.equal(urgent.meta.total, expected.length);
  assert.equal(urgent.meta.totals.total, expected.reduce((a, b) => a + b, 0).toFixed(2));
  assert.deepEqual(urgent.data.map((r) => Number(r.total)), expected.slice().reverse().slice(100, 150));
  const range = await timed('filter[total][between]=1000,1999&sort=total&pageSize=200');
  assert.equal(range.meta.total, 1000);
  assert.equal(range.data[0].total, '1000.00');
  await timed('q=Shuttering&pageSize=25');
  await timed('filter[docDate][between]=2026-04-01,2027-03-31&sort=-docDate&pageSize=25&page=40');
  times.sort((a, b) => a - b);
  assert.ok(times[times.length - 1] < 1500, `slowest list request ${times[times.length - 1].toFixed(0)} ms (all ${times.map((t) => t.toFixed(0)).join(', ')})`);
  assert.ok(times[Math.floor(times.length / 2)] < 500, `median ${times[Math.floor(times.length / 2)].toFixed(0)} ms`);
  await api.close();
});

test('T-03 the commercial total is masked for a system administrator in rows, totals and every export, and cannot be sorted or filtered', async () => {
  const api = await startApi();
  seed(api, 30);
  const shown = await api.call('GET', `${U}/sample-requests?sort=-total`, pm);
  assert.equal(shown.json.data[0].total, '30.00');
  const masked = await api.call('GET', `${U}/sample-requests`, sys);
  assert.equal(masked.status, 200, JSON.stringify(masked.json));
  assert.ok(masked.json.data.every((r) => r.total === '•••'));
  assert.equal(masked.json.meta.totals.total, '•••');
  assert.equal(masked.json.meta.totals.lineCount, api.db.prepare('SELECT SUM(line_count) AS s FROM ui_sample_requests').get().s, 'other totals stay');
  const d = await api.call('GET', `${U}/lists/ui.sample_requests`, sys);
  assert.deepEqual(['sortable', 'filterable', 'masked'].map((k) => d.json.data.columns.find((c) => c.key === 'total')[k]), [false, false, true]);
  for (const qs of ['sort=-total', 'filter[total][gte]=10']) assert.equal((await api.call('GET', `${U}/sample-requests?${qs}`, sys)).status, 400, `${qs}: the order or a range would give the value away`);
  const csv = await api.raw('GET', `${U}/sample-requests/export?format=csv`, sys);
  assert.equal(csv.status, 200);
  const text = csv.buffer.toString('utf8');
  assert.match(text, /Total \(₹\)/);
  assert.ok(text.split('\r\n').slice(1, 31).every((l) => l.includes('•••')), 'every row masked');
  assert.doesNotMatch(text, /,30\.00,/);
  assert.match(text, /Generated by sys1 at \d{4}-\d{2}-\d{2} \d{2}:\d{2} \(IST\)/);
  const pdf = await api.raw('GET', `${U}/sample-requests/export?format=pdf`, sys);
  assert.equal(pdf.buffer.subarray(0, 5).toString(), '%PDF-');
  assert.doesNotMatch(pdf.buffer.toString('latin1'), /\(30\.00\)/);
  await api.close();
});

/** The text of the first worksheet of an XLSX file (stored or deflated entries). */
function sheetXml(buf) {
  let i = 0;
  while (i < buf.length - 30 && buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8);
    const size = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extra = buf.readUInt16LE(i + 28);
    const name = buf.subarray(i + 30, i + 30 + nameLen).toString();
    const data = buf.subarray(i + 30 + nameLen + extra, i + 30 + nameLen + extra + size);
    if (name === 'xl/worksheets/sheet1.xml') return (method === 8 ? inflateRawSync(data) : data).toString('utf8');
    i += 30 + nameLen + extra + size;
  }
  return null;
}

test('FR-06 BR-02 exports use the screen\'s query: CSV, XLSX and PDF carry the same rows, a generated-by footer, and formulas made inert; each is audited', async () => {
  const api = await startApi();
  seed(api, 40);
  api.db.prepare("UPDATE ui_sample_requests SET title = '=HYPERLINK(\"http://evil\")' WHERE id = 3").run(); // request 3 is a draft
  const qs = 'filter[status]=DRAFT&sort=-total';
  const csv = await api.raw('GET', `${U}/sample-requests/export?format=csv&${qs}`, pm);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.headers.get('content-disposition'), /attachment; filename="ui-sample_requests-\d{8}-\d{4}\.csv"/);
  const lines = csv.buffer.toString('utf8').replace(/^\uFEFF/, '').split('\r\n');
  const screen = await api.call('GET', `${U}/sample-requests?${qs}&pageSize=200`, pm);
  assert.equal(Number(csv.headers.get('x-export-rows')), screen.json.meta.total);
  assert.match(lines.find((l) => l.includes('HYPERLINK')) ?? '', /'=HYPERLINK/, 'a formula is made inert');
  assert.match(csv.buffer.toString('utf8'), /Filters: Status eq DRAFT/);
  const xlsx = await api.raw('GET', `${U}/sample-requests/export?format=xlsx&${qs}`, pm);
  assert.equal(xlsx.buffer.readUInt32LE(0), 0x04034b50, 'a zip container');
  const sheet = sheetXml(xlsx.buffer);
  assert.ok(sheet, 'has a worksheet');
  assert.equal((sheet.match(/<row /g) ?? []).length, screen.json.meta.total + 1 + 3, 'header, the rows, three footer lines');
  assert.match(sheet, /<v>39<\/v>/, 'the highest draft total as a number: request 39 is a draft worth 39 rupees');
  assert.match(sheet, /Generated by pm1/);
  const pdf = await api.raw('GET', `${U}/sample-requests/export?format=pdf&${qs}`, pm);
  assert.match(pdf.buffer.toString('latin1'), /^%PDF-1\.4[\s\S]*%%EOF\n$/);
  assert.match(pdf.buffer.toString('latin1'), /Generated by pm1/);
  assert.equal((await api.raw('GET', `${U}/sample-requests/export?format=doc`, pm)).status, 400);
  const audit = api.db.prepare("SELECT new_values FROM core_audit_log WHERE entity = 'report' AND entity_id = 'ui.sample_requests' AND action = 'export'").all().map((a) => JSON.parse(a.new_values).format);
  assert.deepEqual(audit, ['csv', 'xlsx', 'pdf']);
  assert.equal((await api.raw('GET', `${U}/sample-requests/export?format=csv`, { roles: 'EMP', user: 'e1' })).status, 403);
  await api.close();
});

test('FR-06 an export larger than a direct download runs as a job; the file is for the person who asked, and is listed under My Exports', async () => {
  const api = await startApi();
  seed(api, 1200);
  api.db.prepare("INSERT INTO core_parameters (company_id, key, value, data_type, scope_type, scope_id, effective_from, created_by, source_type) VALUES (1, 'core.export.max_rows', '1000', 'integer', 'company', 1, '2020-01-01', 't', 'test')").run();
  const r = await api.call('GET', `${U}/sample-requests/export?format=xlsx`, pm);
  assert.equal(r.status, 202, JSON.stringify(r.json));
  assert.equal(r.json.data.status, 'QUEUED');
  assert.equal(r.json.data.rows, 1200);
  const id = r.json.data.id;
  assert.equal((await api.raw('GET', `${U}/exports/${id}/download`, pm)).status, 422, 'not ready yet');
  const rt = runtimeOf(api.db);
  for (let i = 0; i < 5; i += 1) await rt.jobs.runNext();
  const mine = await api.call('GET', `${U}/exports`, pm);
  assert.equal(mine.json.data[0].status, 'DONE', JSON.stringify(mine.json.data[0]));
  assert.equal(mine.json.data[0].rows, 1200);
  const file = await api.raw('GET', `${U}/exports/${id}/download`, pm);
  assert.equal(file.status, 200);
  assert.equal((sheetXml(file.buffer).match(/<row /g) ?? []).length, 1200 + 1 + 3);
  assert.equal((await api.raw('GET', `${U}/exports/${id}/download`, { roles: 'PM', user: 'pm2' })).status, 404, 'another person cannot take it');
  assert.equal((await api.call('GET', `${U}/exports`, { roles: 'PM', user: 'pm2' })).json.data.length, 0);
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'ui.export.completed'").get().n, 1);
  await api.close();
});

test('FR-03 T-02 saved views: personal ones stay with their owner; a shared view reaches its target role only; one default; 409 on a stale change', async () => {
  const api = await startApi();
  seed(api, 10);
  const cfg = { columns: ['docNo', 'title', 'total'], hidden: ['siteCode'], widths: { title: 320 }, filters: [{ key: 'status', op: 'in', value: 'DRAFT' }], sort: '-total', pageSize: 50, q: '' };
  const post = (who, body) => api.call('POST', `${U}/saved-views`, { ...who, headers: json, body: { list: 'ui.sample_requests', config: cfg, ...body } });
  const list = (who) => api.call('GET', `${U}/saved-views?list=ui.sample_requests`, who);
  const mine = await post({ roles: 'PM', user: 'pm2' }, { name: 'My drafts', isDefault: true });
  assert.equal(mine.status, 201, JSON.stringify(mine.json));
  assert.deepEqual(mine.json.data.config, cfg);
  assert.equal(mine.json.data.isDefault, true);
  // sharing needs ui.view.share: a site engineer cannot, a project manager can, aimed at the accounts role only
  assert.equal((await post({ roles: 'SE', user: 'se1' }, { name: 'Shared by SE', isShared: true })).status, 403);
  const shared = await post({ roles: 'PM', user: 'pm2' }, { name: 'Urgent for accounts', isShared: true, shareScope: { roles: ['ACCMGR'] } });
  assert.equal(shared.status, 201, JSON.stringify(shared.json));
  assert.deepEqual((await list({ roles: 'ACCMGR', user: 'acc1' })).json.data.map((v) => [v.name, v.mine]), [['Urgent for accounts', false]], 'the accounts manager sees the shared view, not the personal one');
  assert.deepEqual((await list({ roles: 'PCMGR', user: 'pc1' })).json.data, [], 'another role does not see it');
  assert.deepEqual((await list({ roles: 'ACCMGR', user: 'acc1', company: '2' })).json.data, [], 'nor another company');
  assert.equal((await list({ roles: 'PM', user: 'pm2' })).json.data.length, 2);
  // only the owner changes or deletes; a second default replaces the first; a stale version is refused
  assert.equal((await api.call('PATCH', `${U}/saved-views/${shared.json.data.id}`, { roles: 'ACCMGR', user: 'acc1', headers: json, body: { name: 'Mine now', version: 1 } })).status, 403);
  const second = await post({ roles: 'PM', user: 'pm2' }, { name: 'All submitted', isDefault: true });
  assert.deepEqual((await list({ roles: 'PM', user: 'pm2' })).json.data.filter((v) => v.isDefault).map((v) => v.name), ['All submitted']);
  assert.equal((await api.call('PATCH', `${U}/saved-views/${second.json.data.id}`, { roles: 'PM', user: 'pm2', headers: json, body: { name: 'All submitted', version: 9 } })).status, 409);
  assert.equal((await post({ roles: 'PM', user: 'pm2' }, { name: 'All submitted' })).status, 409, 'names are unique per person and list');
  // a view must name real columns of a real list
  assert.equal((await post({ roles: 'PM', user: 'pm2' }, { name: 'Bad', config: { ...cfg, hidden: ['salary'] } })).status, 400);
  assert.equal((await api.call('POST', `${U}/saved-views`, { roles: 'PM', user: 'pm2', headers: json, body: { list: 'nope.list', name: 'x', config: cfg } })).status, 400);
  const del = await api.call('DELETE', `${U}/saved-views/${mine.json.data.id}`, { roles: 'PM', user: 'pm2', headers: json, body: { version: 1 } });
  assert.equal(del.status, 200, JSON.stringify(del.json));
  assert.deepEqual(api.db.prepare("SELECT action FROM core_audit_log WHERE entity = 'ui_saved_views' ORDER BY id").all().map((a) => a.action), ['create', 'create', 'create', 'delete']);
  // column choices are kept per person (table settings, FR-04)
  const pref = await api.call('PATCH', `${U}/preferences`, { roles: 'PM', user: 'pm2', headers: json, body: { tableSettings: { 'ui.sample_requests': { pageSize: 50, columns: ['title', 'docNo'], hidden: ['siteCode'], widths: { title: 300 } } } } });
  assert.equal(pref.status, 200, JSON.stringify(pref.json));
  assert.deepEqual(pref.json.data.tableSettings['ui.sample_requests'].widths, { title: 300 });
  await api.close();
});

test('FR-05 bulk submit and cancel run each request on its own and report successes and failures', async () => {
  const api = await startApi();
  const { p1 } = seed(api, 6);
  await api.call('PUT', '/api/v1/core/company-settings', { roles: 'SYSADM', user: 'sys1', headers: key('cs'), body: { legalName: 'Company 1 Pvt Ltd', reason: 'initial set-up' } });
  await api.call('POST', '/api/v1/core/financial-years', { roles: 'SYSADM', user: 'sys1', headers: key('fy'), body: { startDate: '2026-04-01' } });
  await api.call('POST', '/api/v1/core/number-series', { roles: 'SYSADM', user: 'sys1', headers: key('ns'), body: { docType: 'SAMPLE_MR', name: 'Sample material requests', prefix: 'MR', format: '{PREFIX}/{FY}/{SEQ:4}', resetRule: 'financial_year', reason: 'initial set-up' } });
  api.db.prepare("UPDATE ui_sample_requests SET requested_by = 'pm1'").run(); // a bulk action works on one's own requests
  const drafts = api.db.prepare("SELECT id FROM ui_sample_requests WHERE status = 'DRAFT' ORDER BY id").all().map((r) => r.id);
  const submitted = api.db.prepare("SELECT id FROM ui_sample_requests WHERE status = 'SUBMITTED' ORDER BY id").all().map((r) => r.id);
  const out = await api.call('POST', `${U}/sample-requests/bulk`, { ...pm, headers: key('b1'), body: { action: 'submit', ids: [...drafts, submitted[0], 99999] } });
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.equal(out.json.data.done, drafts.length);
  assert.equal(out.json.data.failed, 2);
  assert.match(out.json.data.results.find((r) => r.id === submitted[0]).message, /Only a draft can be submitted/);
  assert.match(out.json.data.results.find((r) => r.id === 99999).message, /does not exist/);
  assert.ok(out.json.data.results.filter((r) => r.ok).every((r) => /^Submitted as MR\/2026-27\/\d{4}$/.test(r.message)));
  assert.equal((await api.call('POST', `${U}/sample-requests/bulk`, { ...pm, headers: key('b2'), body: { action: 'cancel', ids: [submitted[0]] } })).status, 400, 'a cancel needs a reason');
  const cancelled = await api.call('POST', `${U}/sample-requests/bulk`, { ...pm, headers: key('b3'), body: { action: 'cancel', ids: [submitted[0]], reasonCode: 'DUPLICATE', reason: 'Duplicate of an earlier request' } });
  assert.equal(cancelled.json.data.done, 1);
  assert.equal((await api.call('POST', `${U}/sample-requests/bulk`, { ...pm, headers: json, body: { action: 'submit', ids: [1] } })).status, 400, 'bulk needs an idempotency key');
  assert.equal((await api.call('POST', `${U}/sample-requests/bulk`, { roles: 'EMP', user: 'e1', headers: key('b4'), body: { action: 'submit', ids: [1] } })).status, 403);
  assert.ok(p1);
  await api.close();
});

test('the List Report additions are hidden while ff.ui.p0303 is OFF; the register itself still lists', async () => {
  const api = await startApi();
  seed(api, 3);
  api.db.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.ui.p0303'").run();
  for (const p of [`${U}/lists/ui.sample_requests`, `${U}/saved-views?list=ui.sample_requests`, `${U}/exports`, `${U}/sample-requests/export?format=csv`]) assert.equal((await api.call('GET', p, pm)).status, 404, p);
  assert.equal((await api.call('GET', `${U}/sample-requests`, pm)).status, 200);
  await api.close();
});
