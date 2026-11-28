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

test('T-01 filter, sort and pagination on 100,000 rows give the right page, count and totals within the list target', async (t) => {
  const api = await startApi();
  t.after(() => api.close());
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

test('a background export that fails on its last attempt keeps no file, gives its approval back once, and does not run again on a retry', async () => {
  const api = await startApi();
  seed(api, 30);
  api.db.prepare("INSERT INTO core_parameters (company_id, key, value, data_type, scope_type, scope_id, effective_from, created_by, source_type) VALUES (1, 'core.export.max_rows', '10', 'integer', 'company', 1, '2020-01-01', 't', 'test')").run();
  const r = await api.call('GET', `${U}/sample-requests/export?format=csv`, pm);
  assert.equal(r.status, 202, JSON.stringify(r.json));
  const row = api.db.prepare('SELECT * FROM ui_export_jobs WHERE id = ?').get(r.json.data.id);
  // as if it had been let through on approval 77, and its list can no longer be built
  api.db.prepare("UPDATE ui_export_jobs SET list_code = 'no-such-list', actor_json = ? WHERE id = ?").run(JSON.stringify({ ...JSON.parse(row.actor_json), approvalId: 77 }), row.id);
  const rt = runtimeOf(api.db);
  const job = () => api.db.prepare('SELECT * FROM core_jobs WHERE id = ?').get(row.job_id);
  await rt.jobs.runNext();
  const released = () => api.db.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'export_grant' AND entity_id = '77' AND action = 'released'").get().n;
  assert.equal(released(), 0, 'a first failed attempt keeps the approval: the job tries again');
  api.db.prepare("UPDATE core_jobs SET run_after = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(row.job_id);
  await rt.jobs.runNext();
  assert.equal(job().status, 'FAILED');
  assert.equal(released(), 1, 'the last attempt failed: the approval is given back');
  const after = api.db.prepare('SELECT * FROM ui_export_jobs WHERE id = ?').get(row.id);
  assert.deepEqual([after.status, after.storage_key, JSON.parse(after.actor_json).approvalReleased], ['FAILED', null, true]);
  // a retried job does not make a file on the approval it gave back
  api.db.prepare("UPDATE ui_export_jobs SET list_code = 'sample-requests' WHERE id = ?").run(row.id);
  const fresh = rt.jobs.retry(row.job_id, { actor: 'it1', reason: 'try again' });
  await rt.jobs.runNext();
  const rerun = api.db.prepare('SELECT * FROM core_jobs WHERE job_id = ?').get(fresh.jobId);
  assert.notEqual(rerun.status, 'SUCCEEDED');
  assert.match(api.db.prepare('SELECT error FROM ui_export_jobs WHERE id = ?').get(row.id).error, /given back/);
  assert.equal(released(), 1, 'given back once');
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

test('PACK-10 bulk preview: per row, whether this person may act and why not; the run then does exactly the allowed rows, each audited', async () => {
  const api = await startApi();
  seed(api, 6);
  await api.call('PUT', '/api/v1/core/company-settings', { roles: 'SYSADM', user: 'sys1', headers: key('cs'), body: { legalName: 'Company 1 Pvt Ltd', reason: 'initial set-up' } });
  await api.call('POST', '/api/v1/core/financial-years', { roles: 'SYSADM', user: 'sys1', headers: key('fy'), body: { startDate: '2026-04-01' } });
  await api.call('POST', '/api/v1/core/number-series', { roles: 'SYSADM', user: 'sys1', headers: key('ns'), body: { docType: 'SAMPLE_MR', name: 'Sample material requests', prefix: 'MR', format: '{PREFIX}/{FY}/{SEQ:4}', resetRule: 'financial_year', reason: 'initial set-up' } });
  const other = await api.call('POST', '/api/v1/iam/org/companies', { roles: 'SYSADM', user: 'sys1', headers: key('c2'), body: { code: 'BLK2', legalName: 'Other Infra Pvt Ltd', shortName: 'BLK2' } });
  assert.equal(other.status, 201, JSON.stringify(other.json));
  seed(api, 3, { company: other.json.data.id });
  const foreign = api.db.prepare('SELECT id FROM ui_sample_requests WHERE company_id = ? ORDER BY id LIMIT 1').get(other.json.data.id).id;
  const drafts = api.db.prepare("SELECT id FROM ui_sample_requests WHERE company_id = 1 AND status = 'DRAFT' ORDER BY id").all().map((r) => r.id);
  const submitted = api.db.prepare("SELECT id FROM ui_sample_requests WHERE company_id = 1 AND status = 'SUBMITTED' ORDER BY id").all().map((r) => r.id);
  assert.ok(drafts.length >= 2 && submitted.length >= 1);
  api.db.prepare("UPDATE ui_sample_requests SET requested_by = 'pm1' WHERE company_id = 1").run();
  api.db.prepare("UPDATE ui_sample_requests SET requested_by = 'pm2' WHERE id = ?").run(drafts[1]); // someone else's draft: a forbidden row
  const ids = [drafts[0], drafts[1], submitted[0], foreign, 99999];
  const auditBefore = api.db.prepare('SELECT COUNT(*) AS n FROM core_audit_log').get().n;

  // success: one row per id, in order, with the reason for each refusal; nothing changes
  const pv = await api.call('POST', `${U}/sample-requests/bulk/preview`, { ...pm, headers: json, body: { action: 'submit', ids } });
  assert.equal(pv.status, 200, JSON.stringify(pv.json));
  assert.deepEqual(pv.json.data.rows.map((r) => [r.id, r.ok]), [[drafts[0], true], [drafts[1], false], [submitted[0], false], [foreign, false], [99999, false]]);
  assert.equal(pv.json.data.allowed, 1);
  assert.equal(pv.json.data.refused, 4);
  assert.match(pv.json.data.rows[1].message, /Only pm2, who raised this request/);
  assert.match(pv.json.data.rows[2].message, /submitted; it cannot be submitted/);
  assert.match(pv.json.data.rows[3].message, /does not exist/, "another company's request is not even named");
  assert.equal(pv.json.data.rows[3].label, `#${foreign}`);
  // read-only: asked twice, the same answer, no audit row, no status changed (so no idempotency key and no version are needed)
  const again = await api.call('POST', `${U}/sample-requests/bulk/preview`, { ...pm, headers: json, body: { action: 'submit', ids } });
  assert.deepEqual(again.json.data, pv.json.data);
  assert.equal(api.db.prepare('SELECT COUNT(*) AS n FROM core_audit_log').get().n, auditBefore);
  assert.equal(api.db.prepare('SELECT status FROM ui_sample_requests WHERE id = ?').get(drafts[0]).status, 'DRAFT');
  // cancel: someone else's draft is refused, one's own submitted request may be cancelled
  const pc = await api.call('POST', `${U}/sample-requests/bulk/preview`, { ...pm, headers: json, body: { action: 'cancel', ids: [drafts[1], submitted[0]] } });
  assert.deepEqual(pc.json.data.rows.map((r) => r.ok), [false, true]);

  // validation, permission
  for (const body of [{ action: 'submit', ids: [] }, { action: 'approve', ids: [1] }, { action: 'submit', ids: Array.from({ length: 201 }, (_, i) => i + 1) }, { action: 'submit', ids: [1], extra: true }]) {
    assert.equal((await api.call('POST', `${U}/sample-requests/bulk/preview`, { ...pm, headers: json, body })).status, 400, JSON.stringify(body).slice(0, 60));
  }
  assert.equal((await api.call('POST', `${U}/sample-requests/bulk/preview`, { roles: 'EMP', user: 'e1', headers: json, body: { action: 'submit', ids } })).status, 403);

  // the run agrees with the preview: the allowed row is submitted, the refused ones are reported, and each submitted row is audited
  const runKey = key('pv-run');
  const run = await api.call('POST', `${U}/sample-requests/bulk`, { ...pm, headers: runKey, body: { action: 'submit', ids } });
  assert.equal(run.status, 200, JSON.stringify(run.json));
  assert.deepEqual(run.json.data.results.map((r) => [r.id, r.ok]), pv.json.data.rows.map((r) => [r.id, r.ok]));
  assert.ok(api.db.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'ui_sample_requests' AND entity_id = ? AND action = 'submit'").get(String(drafts[0])).n >= 1);
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'ui_sample_requests' AND entity_id = ? AND action = 'submit'").get(String(drafts[1])).n, 0);
  // replaying the run with the same key gives the same answer and does nothing twice
  const replay = await api.call('POST', `${U}/sample-requests/bulk`, { ...pm, headers: runKey, body: { action: 'submit', ids } });
  assert.deepEqual(replay.json.data, run.json.data);
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

test('a list whose module has no export route of its own exports through the List Report route by its code; the description says whether it can', async () => {
  const api = await startApi();
  const store = { roles: 'STOREMGR', user: 'sm1' };
  const r = await api.raw('GET', `${U}/lists/inv.stores/export?format=csv`, store);
  assert.equal(r.status, 200, r.buffer.toString().slice(0, 300));
  assert.match(r.buffer.toString('utf8'), /Generated by sm1/);
  assert.equal((await api.raw('GET', '/api/v1/inv/stores/export?format=csv', store)).status >= 400, true, 'the module itself has no export route (why the List Report uses this one)');
  assert.equal((await api.raw('GET', `${U}/lists/inv.stores/export?format=csv`, { roles: 'SE', user: 'se1' })).status, 403, 'the list export permission still applies');
  assert.equal((await api.raw('GET', `${U}/lists/no.such_list/export?format=csv`, store)).status, 404);
  assert.equal((await api.call('GET', `${U}/lists/inv.stores`, store)).json.data.exportable, true);
  await api.close();
});

test('Part 10: rows chosen across pages of a filtered register export exactly; a chosen row outside the filter never does; the selection is checked', async () => {
  const api = await startApi();
  seed(api, 600);
  const qs = 'filter[status]=DRAFT&sort=-total';
  const page = async (n) => (await api.call('GET', `${U}/sample-requests?${qs}&page=${n}&pageSize=25`, pm)).json;
  const p1 = await page(1); const p5 = await page(5);
  assert.equal(p1.meta.total, 200, 'the filter keeps 200 of the 600');
  const chosen = [...p1.data.slice(0, 3), ...p5.data.slice(10, 12)].map((r) => r.id);
  const outside = Number(api.db.prepare("SELECT id FROM ui_sample_requests WHERE status = 'SUBMITTED' ORDER BY id LIMIT 1").get().id);
  // the list itself, narrowed to the choice: the five drafts, not the submitted one
  const screen = await api.call('GET', `${U}/sample-requests?${qs}&ids=${[...chosen, outside].join(',')}&pageSize=25`, pm);
  assert.equal(screen.status, 200, JSON.stringify(screen.json));
  assert.deepEqual(screen.json.data.map((r) => r.id).sort((a, b) => a - b), [...chosen].sort((a, b) => a - b));
  assert.equal(screen.json.meta.total, 5);
  // the export of the choice carries those rows, and says how many
  const csv = await api.raw('GET', `${U}/sample-requests/export?format=csv&${qs}&ids=${[...chosen, outside].join(',')}`, pm);
  assert.equal(csv.status, 200);
  assert.equal(Number(csv.headers.get('x-export-rows')), 5, 'reconciles with the choice inside the filter');
  const titles = new Set(api.db.prepare(`SELECT title FROM ui_sample_requests WHERE id IN (${chosen.join(',')})`).all().map((r) => r.title));
  const body = csv.buffer.toString('utf8');
  for (const t of titles) assert.ok(body.includes(t), `${t} is in the file`);
  assert.equal(body.replace(/^\uFEFF/, '').trim().split('\r\n').filter((l) => /lot \d+/.test(l)).length, 5, 'five data rows: the submitted one is not in the file');
  // the choice is checked
  for (const bad of ['', 'a,b', '0', '-3', '1.5']) assert.equal((await api.call('GET', `${U}/sample-requests?ids=${bad}`, pm)).status, 400, `ids=${bad}`);
  assert.equal((await api.call('GET', `${U}/sample-requests?ids=${Array.from({ length: 1001 }, (_, i) => i + 1).join(',')}`, pm)).status, 400, 'at most 1,000');
  await api.close();
});
