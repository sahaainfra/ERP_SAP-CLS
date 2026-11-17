import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { createUomService } from '../src/server/platform/calc/uom.js';
import { itemsOf, specKey } from '../src/server/modules/mdm/items.js';
import { setupCompany, startApi } from './helpers.js';

// Part 06.03: the item master. T-01 an item conversion (bags to tonnes for cement) through the calculation engine; T-02 a near-identical specification is reported; T-03 the selector answers under 300 ms
// with 100 000 items. Also: a new item is approved by its category's steward (never the requester), its code comes from the category series, an item used in a transaction keeps its base unit (BR-01, new
// version instead), bills of resources refuse a cycle (BR-02), rates are hidden from people who may not see them, the old free-text materials are migrated without breaking their references (FR-08).
const M = '/api/v1/mdm';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
const key = (k = 'i') => ({ ...json, 'idempotency-key': `it-${k}-${Math.random().toString(36).slice(2, 10)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const proc = as('PROCMGR', 'proc1');
const proc2 = as('PROCMGR', 'proc2');
const est = as('EST', 'est1');
const est2 = as('EST', 'est2');
const plant = as('PLANTMGR', 'plant1');
const se = as('SE', 'se1');
const day = (n) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
const opened = [];
after(async () => { for (const a of opened) await a.close(); });
const user = (api, name, roles) => api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(name, `${name.toUpperCase()} Nair`, JSON.stringify(roles), `${name}@example.com`);
const act = async (api, who, instanceId, action = 'approve', comment = 'checked the specification') => {
  const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId);
  assert.ok(task, `${who.user} has the task of instance ${instanceId}`);
  const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key('a'), body: { action, comment } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
};
const setup = async () => {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  for (const [n, r] of [['proc1', ['PROCMGR']], ['proc2', ['PROCMGR']], ['est1', ['EST']], ['est2', ['EST']], ['plant1', ['PLANTMGR']], ['se1', ['SE']], ['sys1', ['SYSADM']]]) user(api, n, r);
  const call = (who, method, path, body, k) => api.call(method, `${M}${path}`, { ...who, headers: key(k), body });
  const cats = (await call(proc, 'GET', '/item-categories')).json.data.rows;
  const cat = (code) => cats.find((c) => c.code === code).id;
  /** A request and its approval by another steward of the category. */
  const item = async (body, who = proc, approver = proc2) => {
    const r = await call(who, 'POST', '/items', { justification: 'Needed for the Alpha project', ...body });
    assert.equal(r.status, 202, JSON.stringify(r.json));
    await act(api, approver, r.json.data.workflow.id);
    return r.json.data.item;
  };
  const cement = { categoryId: cat('CEMENT'), itemType: 'MATERIAL', name: 'OPC 53 grade cement', baseUom: 'MT', spec: { grade: 'OPC 53', standard: 'IS 269', packing: '50 kg bag' }, stockTracked: true, standardRate: '7200', uoms: [{ uom: 'BAG', factorToBase: '0.05' }] };
  return { api, call, cats, cat, item, cement };
};

test('the specification key ignores case, spaces, units and the brand, and keeps every other attribute', () => {
  assert.equal(specKey('STEEL', { grade: 'Fe 500D', dia: '12 mm', brand: 'Tata' }), specKey('STEEL', { dia: '12MM', grade: 'fe500d', brand: 'JSW' }));
  assert.notEqual(specKey('STEEL', { grade: 'Fe 500D', dia: '12' }), specKey('STEEL', { grade: 'Fe 500D', dia: '16' }));
});

test('T-01 FR-01 FR-03 BR-03 a new item is approved by the steward of its category; its code comes from the category series; bags of cement convert to tonnes through the calculation engine', async () => {
  const t = await setup();
  const r = await t.call(se, 'POST', '/items', { ...t.cement, justification: 'Cement for the culverts' });
  assert.equal(r.status, 202, 'anyone who sees the catalogue may ask for an item');
  assert.equal(r.json.data.item.code, 'CEM-00001');
  assert.equal(r.json.data.item.hsnSac, '2523', 'the category default HSN');
  assert.equal(r.json.data.item.gstRate, 'GST18', 'the GST rate of the HSN on the date (06.02): cement is 18 % from 22-09-2025 (part 166.8)');
  assert.equal(r.json.data.item.standardRate, null, 'a site engineer does not see rates');
  assert.equal((await t.call(se, 'GET', '/items/search?q=opc')).json.data.rows.length, 0, 'not in the selector before approval');
  assert.equal((await t.api.call('GET', `${W}/tasks?mine=assigned`, est)).json.data.rows.filter((x) => x.instance.id === r.json.data.workflow.id).length, 0, 'an estimator is not the steward of cement');
  await act(t.api, proc, r.json.data.workflow.id);
  const id = r.json.data.item.id;
  const got = (await t.call(proc, 'GET', `/items/${id}`)).json.data;
  assert.equal(got.status, 'ACTIVE');
  assert.equal(got.standardRate, '7200');
  assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM ntf_notifications WHERE template_code = 'mdm.item.decided' AND user_ref = 'se1'").get().n, 1);
  // T-01: 20 bags = 1 MT = 1000 KG, through the item's own row and then the generic MT -> KG
  const c = await t.call(se, 'GET', `/items/${id}/convert?quantity=20&from=BAG&to=MT`);
  assert.equal(c.status, 200, JSON.stringify(c.json));
  assert.equal(c.json.data.result, '1.000');
  assert.equal((await t.call(se, 'GET', `/items/${id}/convert?quantity=20&from=BAG&to=KG`)).json.data.result, '1000.000');
  assert.equal(createUomService({ db: t.api.db }).convert('3', 'BAG', 'KG', { itemCode: 'CEM-00001@1' }).result, '150.000', 'the calculation engine itself converts per item');
  // the requester never approves: a steward's own request goes to another steward
  const own = await t.call(proc, 'POST', '/items', { ...t.cement, name: 'PPC cement', spec: { grade: 'PPC', standard: 'IS 1489', packing: '50 kg bag' }, justification: 'Cement for plaster' });
  assert.equal(own.status, 202);
  assert.equal(own.json.data.item.code, 'CEM-00002', 'the next number of the series');
  assert.equal((await t.api.call('GET', `${W}/tasks?mine=assigned`, proc)).json.data.rows.filter((x) => x.instance.id === own.json.data.workflow.id).length, 0);
  await act(t.api, proc2, own.json.data.workflow.id, 'reject', 'We buy only OPC');
  assert.equal((await t.call(proc, 'GET', `/items/${own.json.data.item.id}`)).json.data.status, 'REJECTED');
  // a category holds only its types; the specification follows the template
  assert.equal((await t.call(se, 'POST', '/items', { ...t.cement, itemType: 'LABOUR' })).status, 400);
  const bad = await t.call(se, 'POST', '/items', { ...t.cement, spec: { grade: 'OPC 99' } });
  assert.equal(bad.status, 400);
  assert.ok(bad.json.error.details.some((d) => d.field === 'spec.grade'));
  assert.ok(bad.json.error.details.some((d) => d.field === 'spec.standard'), 'a required attribute');
});

test('T-02 FR-07 a near-identical specification is reported before the request is sent', async () => {
  const t = await setup();
  await t.item(t.cement);
  const near = { ...t.cement, name: 'Cement OPC-53 (50 kg)', spec: { grade: 'opc 53', standard: 'IS269', packing: '50 KG bag', brand: 'UltraTech' } };
  const chk = (await t.call(se, 'POST', '/items/check', near)).json.data;
  assert.equal(chk.duplicates.length, 1);
  assert.equal(chk.duplicates[0].code, 'CEM-00001');
  assert.equal(chk.duplicates[0].rule, 'same specification');
  const r = await t.call(se, 'POST', '/items', { ...near, justification: 'Branded cement' });
  assert.equal(r.status, 409);
  assert.equal(r.json.error.code, 'DUPLICATE_WARNING');
  assert.match(r.json.error.message, /CEM-00001/);
  const ok = await t.call(se, 'POST', '/items', { ...near, justification: 'Branded cement asked by the client', acknowledgeDuplicates: true });
  assert.equal(ok.status, 202);
  const other = (await t.call(se, 'POST', '/items/check', { ...t.cement, name: 'Sulphate resisting cement', spec: { grade: 'SRC', standard: 'IS 12330', packing: '50 kg bag' } })).json.data;
  assert.equal(other.duplicates.length, 0, 'another grade is a different item');
});

test('FR-04 BR-02 a bill of resources for a work item; a cycle is refused; its cost per unit from the components', async () => {
  const t = await setup();
  const cem = await t.item(t.cement);
  const sand = await t.item({ categoryId: t.cat('AGGREGATE'), itemType: 'MATERIAL', name: 'River sand', baseUom: 'CUM', spec: { kind: 'River sand' }, standardRate: '1800' });
  const mason = await t.item({ categoryId: t.cat('LABOUR'), itemType: 'LABOUR', name: 'Mason', baseUom: 'DAY', spec: { skill: 'Skilled' }, standardRate: '900' }, est, est2);
  const pcc = await t.item({ categoryId: t.cat('WORKS'), itemType: 'WORK_ITEM', name: 'PCC 1:4:8 in foundations', baseUom: 'CUM', spec: { mix: '1:4:8', standard: 'DSR 4.1.8' } }, est, est2);
  assert.equal((await t.call(proc, 'PUT', `/items/${pcc.id}/resources`, { lines: [], version: pcc.rowVersion })).status, 403, 'the estimator keeps work items');
  const cur = (await t.call(est, 'GET', `/items/${pcc.id}`)).json.data;
  const save = await t.call(est, 'PUT', `/items/${pcc.id}/resources`, { lines: [{ componentId: cem.id, quantity: '3.4', uom: 'BAG', wastagePct: '2' }, { componentId: sand.id, quantity: '0.47', uom: 'CUM', wastagePct: '5' }, { componentId: mason.id, quantity: '0.1', uom: 'DAY' }], version: cur.rowVersion, reason: 'From DSR 4.1.8' });
  assert.equal(save.status, 200, JSON.stringify(save.json));
  assert.equal(save.json.data.resources.length, 3);
  // 3.4 bags x 1.02 = 3.468 bags = 0.1734 MT x 7200 = 1248.48; 0.47 x 1.05 x 1800 = 888.30; 0.1 x 900 = 90 -> 2226.78
  assert.equal(save.json.data.resourceCost, '2226.78');
  assert.equal((await t.call(se, 'GET', `/items/${pcc.id}`)).json.data.resourceCost, null, 'no cost for a person who may not see rates');
  // a composite inside a composite, then the cycle
  const plaster = await t.item({ categoryId: t.cat('WORKS'), itemType: 'COMPOSITE', name: 'Foundation package', baseUom: 'CUM', spec: { mix: 'PCC and plaster' } }, est, est2);
  const p1 = (await t.call(est, 'GET', `/items/${plaster.id}`)).json.data;
  assert.equal((await t.call(est, 'PUT', `/items/${plaster.id}/resources`, { lines: [{ componentId: pcc.id, quantity: '1', uom: 'CUM' }], version: p1.rowVersion })).status, 200);
  const p2 = (await t.call(est, 'GET', `/items/${pcc.id}`)).json.data;
  const cyc = await t.call(est, 'PUT', `/items/${pcc.id}/resources`, { lines: [{ componentId: cem.id, quantity: '3.4', uom: 'BAG' }, { componentId: plaster.id, quantity: '1', uom: 'CUM' }], version: p2.rowVersion });
  assert.equal(cyc.status, 400);
  assert.match(JSON.stringify(cyc.json), /cycle/);
  assert.equal((await t.call(est, 'PUT', `/items/${pcc.id}/resources`, { lines: [{ componentId: cem.id, quantity: '1', uom: 'LTR' }], version: p2.rowVersion })).status, 400, 'a unit the component is not counted in');
  assert.equal((await t.call(proc, 'PUT', `/items/${cem.id}/resources`, { lines: [], version: cem.rowVersion })).status, 422, 'a material has no bill of resources');
  // where used: the cement is in the PCC
  const used = (await t.call(se, 'GET', `/items/${cem.id}/where-used`)).json.data.rows;
  assert.ok(used.some((u) => u.source === 'Bill of resources' && u.label.startsWith(pcc.code)));
  assert.equal((await t.call(proc, 'POST', `/items/${cem.id}/status`, { status: 'INACTIVE', reason: 'Replaced by PPC', version: (await t.call(proc, 'GET', `/items/${cem.id}`)).json.data.rowVersion })).status, 422, 'a resource of an active item stays in use');
});

test('BR-01 FR-05 an item used in a transaction keeps its base unit; a new version from a date replaces it on approval; makes need a second steward', async () => {
  const t = await setup();
  const cem = await t.item(t.cement);
  const project = Number(t.api.db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, 'ALPHA', 'Alpha', 'ROAD', 'ACTIVE', 't', 't')").run().lastInsertRowid);
  const req = Number(t.api.db.prepare("INSERT INTO ui_sample_requests (company_id, doc_date, title, project_id, requested_by, required_by, created_by, source_type) VALUES (1, ?, 'Cement for culverts', ?, 'se1', ?, 't', 't')").run(day(0), project, day(5)).lastInsertRowid);
  t.api.db.prepare("INSERT INTO ui_sample_request_lines (company_id, request_id, line_no, description, uom, quantity, unit_rate, line_amount, created_by, source_type) VALUES (1, ?, 1, ?, 'BAG', 100, 40000, 4000000, 't', 't')").run(req, `${cem.code} OPC 53 grade cement`);
  const used = (await t.call(proc, 'GET', `/items/${cem.id}/where-used`)).json.data;
  assert.equal(used.transactions, 1);
  const cur = (await t.call(proc, 'GET', `/items/${cem.id}`)).json.data;
  const ch = await t.call(proc, 'PUT', `/items/${cem.id}`, { baseUom: 'KG', version: cur.rowVersion });
  assert.equal(ch.status, 422);
  assert.match(ch.json.error.message, /new version/);
  assert.equal((await t.call(plant, 'PUT', `/items/${cem.id}`, { standardRate: '7300', version: cur.rowVersion })).status, 403, 'not the steward of cement');
  const rate = await t.call(proc, 'PUT', `/items/${cem.id}`, { standardRate: '7350', version: cur.rowVersion, reason: 'New rate contract' });
  assert.equal(rate.status, 200, JSON.stringify(rate.json));
  assert.equal((await t.call(proc, 'GET', `/items/${cem.id}`)).json.data.priceHistory[0].rate, '7350');
  const v = await t.call(proc, 'POST', `/items/${cem.id}/versions`, { baseUom: 'KG', effectiveFrom: day(1), justification: 'Stores count cement in kilograms from next month', uoms: undefined });
  assert.equal(v.status, 202, JSON.stringify(v.json));
  assert.equal(v.json.data.item.versionNo, 2);
  assert.equal(v.json.data.item.code, cem.code);
  await act(t.api, proc2, v.json.data.workflow.id);
  const old = (await t.call(proc, 'GET', `/items/${cem.id}`)).json.data;
  assert.equal(old.status, 'SUPERSEDED');
  assert.equal(old.versions.length, 2);
  const search = (await t.call(se, 'GET', '/items/search?q=opc')).json.data.rows;
  assert.equal(search.length, 1, 'only the version in force is offered');
  assert.equal(search[0].uom, 'KG');
  // makes
  const m = await t.call(proc, 'POST', `/items/${v.json.data.item.id}/makes`, { make: 'UltraTech', model: 'OPC 53' });
  assert.equal(m.status, 201);
  assert.equal((await t.call(proc, 'POST', `/items/${v.json.data.item.id}/makes/${m.json.data.id}`, { approved: true })).status, 403, 'not by the person who proposed it');
  assert.equal((await t.call(proc2, 'POST', `/items/${v.json.data.item.id}/makes/${m.json.data.id}`, { approved: true })).status, 200);
  assert.equal((await t.call(se, 'GET', `/items/${v.json.data.item.id}`)).json.data.makes[0].approved, true);
});

test('FR-06 the selector: search by code, name, specification or category, favourites and recent items, rates masked', async () => {
  const t = await setup();
  const cem = await t.item(t.cement);
  await t.item({ categoryId: t.cat('STEEL'), itemType: 'MATERIAL', name: 'TMT bar Fe 500D 12 mm', baseUom: 'MT', spec: { grade: 'Fe 500D', dia: '12', length: '12' }, standardRate: '62000', uoms: [{ uom: 'NOS', factorToBase: '0.01066' }] });
  const s1 = (await t.call(se, 'GET', '/items/search?q=fe500d')).json.data;
  assert.equal(s1.rows.length, 0, 'the search text is the words as written');
  assert.equal((await t.call(se, 'GET', '/items/search?q=500D 12')).json.data.rows[0].code, 'STL-00001');
  assert.equal((await t.call(se, 'GET', '/items/search?q=cem-0')).json.data.rows[0].code, 'CEM-00001', 'by code');
  assert.equal((await t.call(se, 'GET', `/items/search?category=${t.cat('CIVIL')}`)).json.data.rows.length, 2, 'a category includes its sub-categories');
  assert.equal((await t.call(se, 'GET', '/items/search?q=steel')).json.data.rows[0].code, 'STL-00001', 'by category name');
  assert.equal((await t.call(se, 'GET', '/items/search?q=cement')).json.data.rows[0].standardRate, null);
  assert.equal((await t.call(proc, 'GET', '/items/search?q=cement')).json.data.rows[0].standardRate, '7200');
  await t.call(se, 'POST', `/items/${cem.id}/mark`, { mark: 'FAVOURITE' });
  await t.call(se, 'POST', `/items/${cem.id}/mark`, { mark: 'RECENT' });
  assert.deepEqual((await t.call(se, 'GET', '/items/search?only=favourites')).json.data.rows.map((r) => r.code), ['CEM-00001']);
  assert.deepEqual((await t.call(se, 'GET', '/items/search?only=recent')).json.data.rows.map((r) => r.code), ['CEM-00001']);
  const look = await t.api.call('GET', `${M}/lookups/items?q=tmt`, se);
  assert.equal(look.status, 200, JSON.stringify(look.json));
  assert.equal(look.json.data[0].code, 'STL-00001');
  // the Item Master register (List Report): filters, export with the rate hidden from a site engineer
  const reg = await t.api.call('GET', `${M}/items/register?q=cement&filter[type]=MATERIAL&sort=code`, se);
  assert.equal(reg.status, 200, JSON.stringify(reg.json));
  assert.equal(reg.json.data[0].code, 'CEM-00001');
  assert.equal(reg.json.data[0].standardRate, undefined);
  assert.equal((await t.api.call('GET', `${M}/items/register?sort=-standardRate`, se)).status, 400, 'a hidden column is not sorted');
  assert.equal((await t.api.call('GET', '/api/v1/ui/lists/mdm.items', se)).json.data.columns.find((c) => c.key === 'standardRate').masked, true);
  const csv = await t.api.raw('GET', `${M}/items/register/export?format=csv&q=tmt`, se);
  assert.equal(csv.status, 200);
  const text = csv.buffer.toString('utf8');
  assert.match(text, /STL-00001/);
  assert.doesNotMatch(text, /62000/, 'no rate in the export of a person who may not see it');
  const csv2 = (await t.api.raw('GET', `${M}/items/register/export?format=csv&q=tmt`, proc)).buffer.toString('utf8');
  assert.match(csv2, /62000/);
  // another company sees nothing
  assert.equal((await t.api.call('GET', `${M}/items/search?q=cement`, as('PROCMGR', 'p9', '2'))).json.data?.rows?.length ?? 0, 0);
});

test('T-03 the selector answers under 300 ms with 100 000 items', async () => {
  const t = await setup();
  const db = t.api.db;
  itemsOf(db).ensureTree(1);
  const cat = db.prepare("SELECT id FROM mdm_item_categories WHERE company_id = 1 AND code = 'CONSUMABLE'").get().id;
  const ins = db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, spec_json, spec_key, search_text, base_uom, item_status, effective_from, created_by, source_type) VALUES (1, ?, ?, 'CONSUMABLE', ?, '{}', '', ?, 'NOS', 'ACTIVE', '2026-01-01', 'load', 'load')");
  const words = ['binding wire', 'cover block', 'shuttering oil', 'curing compound', 'welding rod', 'cutting disc', 'grinding wheel', 'nails', 'anchor bolt', 'safety helmet'];
  db.exec('BEGIN');
  for (let i = 1; i <= 100_000; i += 1) { const name = `${words[i % 10]} type ${i % 997} size ${i % 89}`; ins.run(`CON-${String(i).padStart(6, '0')}`, name, cat, `${name} consumables`); }
  db.exec('COMMIT');
  const actor = { user: 'se1', roles: ['SE'], companyId: 1 };
  const s = itemsOf(db);
  s.items.search(actor, { q: 'warm', limit: 20 });
  const timings = [];
  for (const q of ['curing compound', 'CON-0450', 'anchor bolt type 12', 'helmet size 7', 'zzz-nothing']) {
    const start = process.hrtime.bigint();
    const out = s.items.search(actor, { q, limit: 20 });
    timings.push(Number(process.hrtime.bigint() - start) / 1e6);
    assert.ok(Array.isArray(out.rows));
  }
  const api0 = Date.now();
  const r = await t.call(se, 'GET', '/items/search?q=welding%20rod&limit=20');
  const apiMs = Date.now() - api0;
  assert.equal(r.status, 200);
  assert.equal(r.json.data.rows.length, 20);
  assert.ok(Math.max(...timings) < 300, `service timings ${timings.map((x) => x.toFixed(1)).join(', ')} ms`);
  assert.ok(apiMs < 300, `API ${apiMs} ms`);
});

test('FR-08 AC-01 the old free-text materials are migrated: a conversion code becomes an item with the same code, its conversions keep working', async () => {
  const t = await setup();
  t.api.db.prepare("INSERT INTO core_uom_conversions (item_code, from_uom, to_uom, factor, created_by, source_type) VALUES ('CEMENT-OPC53', 'BAG', 'KG', '50', 'old', 'calc')").run();
  assert.equal((await t.call(se, 'GET', '/items/migration')).status, 403);
  const cand = (await t.call(proc, 'GET', '/items/migration')).json.data;
  const row = cand.rows.find((r) => r.key === 'CEMENT-OPC53');
  assert.ok(row && !row.mappedTo);
  assert.equal((await t.call(se, 'POST', '/items', { ...t.cement, baseUom: 'KG', uoms: [], legacy: { source: 'conversion', key: 'CEMENT-OPC53', code: 'CEMENT-OPC53' } })).status, 403, 'only a migrator gives a manual code (BR-03)');
  const r = await t.call(proc, 'POST', '/items', { ...t.cement, baseUom: 'KG', uoms: [], legacy: { source: 'conversion', key: 'CEMENT-OPC53', code: 'CEMENT-OPC53' }, justification: 'Migration of the old cement code' });
  assert.equal(r.status, 202, JSON.stringify(r.json));
  assert.equal(r.json.data.item.code, 'CEMENT-OPC53');
  assert.equal((await t.call(proc, 'GET', '/items/migration')).json.data.rows.find((x) => x.key === 'CEMENT-OPC53').pending.code, 'CEMENT-OPC53');
  await act(t.api, proc2, r.json.data.workflow.id);
  const after = (await t.call(proc, 'GET', '/items/migration')).json.data.rows.find((x) => x.key === 'CEMENT-OPC53');
  assert.equal(after.mappedTo.code, 'CEMENT-OPC53');
  const it = (await t.call(proc, 'GET', `/items/${r.json.data.item.id}`)).json.data;
  assert.deepEqual(it.uoms.map((u) => [u.uom, u.factorToBase]), [['BAG', '50']], 'the old conversion became the item conversion');
  assert.equal(createUomService({ db: t.api.db }).convert('2', 'BAG', 'KG', { itemCode: 'CEMENT-OPC53' }).result, '100.000', 'the old reference still converts');
  assert.equal((await t.call(se, 'GET', `/items/${it.id}/convert?quantity=2&from=BAG&to=MT`)).json.data.result, '0.100');
  assert.equal((await t.call(proc, 'POST', '/items/migration/map', { source: 'conversion', key: 'CEMENT-OPC53', itemId: it.id })).status, 409);
});
