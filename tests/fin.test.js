import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { accountPostings, finOf, REQUIRED_CONTROLS, SCHEDULE3 } from '../src/server/modules/fin/service.js';
import { setupCompany, startApi } from './helpers.js';

// Part 06.05: the chart of accounts, cost heads and cost codes, financial dimensions. T-01 a posting to an account that needs a project, without one, is rejected; T-02 the Schedule III mapping gives the
// complete list of groups; AC-01 every item category is mapped. Also: BR-01 a control account takes only the posting engine's lines; BR-02 an account with postings is not deleted and keeps its nature;
// changes are approved by the CFO (the accounts manager first for project controls' cost codes) and applied then; the import from Tally and its mapping report; isolation between companies.
const F = '/api/v1/fin';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
const key = (k = 'f') => ({ ...json, 'idempotency-key': `fin-${k}-${Math.random().toString(36).slice(2, 10)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const acc = as('ACCMGR', 'facc1');
const pcm = as('PCMGR', 'fpcm1');
const cfo = as('CFO', 'fcfo1');
const pm = as('PM', 'fpm1');
const se = as('SE', 'fse1');
const opened = [];
after(async () => { for (const a of opened) await a.close(); });
const act = async (api, who, instanceId, action = 'approve', comment = 'checked against the chart and Schedule III') => {
  const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId);
  assert.ok(task, `${who.user} has the task of instance ${instanceId}`);
  const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key('a'), body: { action, comment } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
};
const setup = async () => {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  for (const [n, r] of [['facc1', ['ACCMGR']], ['fpcm1', ['PCMGR']], ['fcfo1', ['CFO']], ['fpm1', ['PM']], ['fse1', ['SE']]]) api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, `${n} Rao`, JSON.stringify(r), `${n}@example.com`);
  const call = (who, method, path, body) => api.call(method, `${F}${path}`, { ...who, headers: key(), body });
  const project = Number(api.db.prepare("INSERT INTO org_projects (company_id, code, name, type) VALUES (1, 'PA', 'Alpha road', 'ROAD')").run().lastInsertRowid);
  const other = Number(api.db.prepare("INSERT INTO org_projects (company_id, code, name, type) VALUES (1, 'PB', 'Beta bridge', 'BRIDGE')").run().lastInsertRowid);
  const site = Number(api.db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name) VALUES (1, ?, 'S1', 'Km 0-10')").run(project).lastInsertRowid);
  const chart = async (who = acc) => (await call(who, 'GET', '/accounts')).json.data;
  const accountId = async (code) => (await chart()).accounts.find((a) => a.code === code).id;
  return { api, call, project, other, site, chart, accountId };
};

test('the company gets the template chart: five primary groups, control accounts, cost heads 1 to 6, rights by role, and the flag', async () => {
  const { api, call, chart } = await setup();
  const c = await chart();
  assert.deepEqual(c.groups.filter((g) => !g.parentId).map((g) => g.name), ['Assets', 'Liabilities', 'Equity', 'Income', 'Expenses']);
  assert.deepEqual(c.missingControls, [], 'every control account of FR-01 is there');
  for (const k of REQUIRED_CONTROLS) assert.ok(c.accounts.some((a) => a.controlKind === k && a.isControl && !a.manualPosting), k);
  assert.equal(c.canEdit, true);
  const tree = (await call(pcm, 'GET', '/cost-heads')).json.data;
  assert.deepEqual(tree.heads.filter((h) => !h.parentId).map((h) => `${h.code} ${h.name}`), ['1 Material', '2 Labour', '3 Plant and machinery', '4 Subcontract', '5 Site overheads', '6 Head office overheads']);
  assert.equal(tree.heads.find((h) => h.code === '1.1').name, 'Cement');
  assert.ok(tree.heads.filter((h) => !h.parentId).every((h) => h.account), 'every top cost head maps to an account (FR-03)');
  assert.equal(tree.canEdit, true, 'project controls proposes cost codes');
  assert.equal((await chart(pm)).canEdit, false, 'a project manager sees the chart but does not change it');
  assert.equal((await call(se, 'GET', '/accounts')).status, 403, 'a site engineer does not see the chart');
  assert.equal((await call(pm, 'POST', '/accounts', { code: '560099', name: 'Other site costs', groupId: c.groups[0].id, type: 'EXPENSE', normalBalance: 'DR', reason: 'a new account for site costs' })).status, 403);
  assert.equal((await call(pcm, 'POST', '/accounts', { code: '560099', name: 'Other site costs', groupId: c.groups[0].id, type: 'EXPENSE', normalBalance: 'DR', reason: 'a new account for site costs' })).status, 403, 'project controls does not open accounts');
  api.db.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.mdm.p0605'").run();
  assert.equal((await call(acc, 'GET', '/accounts')).status, 404, 'flag off: not there');
  api.db.prepare("UPDATE core_feature_flags SET enabled = 1 WHERE key = 'ff.mdm.p0605'").run();
  // another company has its own copy
  api.db.prepare("INSERT INTO org_companies (id, code, legal_name, short_name, created_by, source_type) SELECT 2, 'TWO', 'Two Infra Pvt Ltd', 'Two', 't', 'test' WHERE NOT EXISTS (SELECT 1 FROM org_companies WHERE id = 2)").run();
  const ids1 = new Set(c.accounts.map((a) => a.id));
  const r2 = await api.call('GET', `${F}/accounts`, as('ACCMGR', 'facc1', '2'));
  assert.equal(r2.status, 200, JSON.stringify(r2.json));
  const c2 = r2.json.data;
  assert.ok(c2.accounts.length === c.accounts.length && c2.accounts.every((a) => !ids1.has(a.id)), 'company 2 has its own accounts');
  assert.equal((await call(as('ACCMGR', 'facc1', '2'), 'GET', `/accounts/${c.accounts[0].id}`)).status, 404, 'an account of another company is not found');
});

test('T-01 a posting to an account that needs a project is refused without one; dimension values are checked; BR-01 control accounts take engine postings only', async () => {
  const { api, call, project, other, site, accountId } = await setup();
  const materials = await accountId('510001');
  const check = async (body) => (await call(acc, 'POST', '/postings/check', body)).json.data;
  const none = await check({ accountId: materials, source: 'ENGINE', dimensions: {} });
  assert.equal(none.ok, false);
  assert.deepEqual(none.errors.map((e) => [e.dimension, e.code]), [['PROJECT', 'DIMENSION_REQUIRED']]);
  assert.match(none.errors[0].message, /needs a project/);
  assert.equal((await check({ accountId: materials, source: 'ENGINE', dimensions: { PROJECT: project, SITE: site, WBS: 'PA.1.2' } })).ok, true);
  assert.deepEqual((await check({ accountId: materials, source: 'ENGINE', dimensions: { PROJECT: other, SITE: site } })).errors.map((e) => e.code), ['SITE_NOT_IN_PROJECT']);
  assert.deepEqual((await check({ accountId: materials, source: 'ENGINE', dimensions: { PROJECT: 9999 } })).errors.map((e) => e.code), ['DIMENSION_VALUE']);
  assert.deepEqual((await check({ accountCode: '540001', source: 'MANUAL', dimensions: { PROJECT: project } })).errors.map((e) => e.code), ['DIMENSION_NOT_ALLOWED'], 'interest is not charged to a project');
  // BR-01: the AP control account
  const ap = await accountId('220001');
  const manual = await check({ accountId: ap, source: 'MANUAL', dimensions: {} });
  assert.deepEqual(manual.errors.map((e) => e.code), ['CONTROL_ACCOUNT']);
  assert.match(manual.errors[0].message, /control account/);
  assert.equal((await check({ accountId: ap, source: 'ENGINE', dimensions: {} })).ok, true, 'the posting engine posts to it');
  // the service the posting engine calls says the same
  assert.equal(finOf(api.db).validatePosting(1, { accountId: materials, source: 'ENGINE', dimensions: {} }).ok, false);
  // explicitly allowed: an approved change opens the control account to manual adjustments
  const a = (await call(acc, 'GET', `/accounts/${ap}`)).json.data;
  const ch = await call(acc, 'PUT', `/accounts/${ap}`, { manualPosting: true, reason: 'year-end reclassification journals', version: a.rowVersion });
  assert.equal(ch.status, 202, JSON.stringify(ch.json));
  assert.equal((await check({ accountId: ap, source: 'MANUAL', dimensions: {} })).ok, false, 'nothing changes before approval');
  await act(api, cfo, ch.json.data.instanceId);
  assert.equal((await check({ accountId: ap, source: 'MANUAL', dimensions: {} })).ok, true, 'allowed after the CFO approved it');
});

test('T-02 the Schedule III mapping gives the complete list of groups; a group off Schedule III makes it incomplete until mapped', async () => {
  const { api, call, chart } = await setup();
  const s3 = (await call(cfo, 'GET', '/schedule-iii')).json.data;
  assert.equal(s3.complete, true, JSON.stringify({ a: s3.unmappedAccounts, g: s3.unmappedGroups, w: s3.wrongNature, e: s3.linesWithoutGroup }));
  assert.deepEqual(s3.lines.map((l) => l.code), SCHEDULE3.map((l) => l.code), 'every line of Schedule III, in order');
  assert.ok(s3.lines.every((l) => l.groups.length > 0), 'each line has its groups');
  const c = await chart();
  const nonPrimary = c.groups.filter((g) => g.parentId);
  assert.equal(s3.lines.reduce((n, l) => n + l.groups.length, 0), nonPrimary.length, 'every group is on exactly one line');
  assert.equal(s3.lines.reduce((n, l) => n + l.accounts.length, 0), c.accounts.length, 'every account is on a line');
  // a new group without a line
  const assets = c.groups.find((g) => g.code === '1700');
  const g = await call(acc, 'POST', '/account-groups', { code: '1750', name: 'Site deposits', parentId: assets.parentId, nature: 'ASSET', reason: 'deposits given to site landlords' });
  assert.equal(g.status, 202, JSON.stringify(g.json));
  assert.equal((await call(acc, 'POST', '/account-groups', { code: '1750', name: 'Duplicate', parentId: assets.parentId, nature: 'ASSET', reason: 'the same code proposed twice' })).status, 400, 'the same new code is waiting already');
  assert.equal((await call(acc, 'POST', '/account-groups', { code: '1760', name: 'Wrong nature', parentId: assets.parentId, nature: 'INCOME', reason: 'an income group under assets' })).status, 400);
  await act(api, cfo, g.json.data.instanceId);
  const after = (await call(cfo, 'GET', '/schedule-iii')).json.data;
  assert.equal(after.complete, false);
  assert.deepEqual(after.unmappedGroups.map((x) => x.code), ['1750']);
  const ng = (await chart()).groups.find((x) => x.code === '1750');
  const m = await call(acc, 'PUT', `/account-groups/${ng.id}`, { schedule3: 'BS_LT_LOANS_ADVANCES', reason: 'deposits are long-term loans and advances', version: ng.rowVersion });
  assert.equal(m.status, 202, JSON.stringify(m.json));
  await act(api, cfo, m.json.data.instanceId);
  assert.equal((await call(cfo, 'GET', '/schedule-iii')).json.data.complete, true);
});

test('changes are approved before they apply: the CFO approves the accounts manager; the accounts manager checks project controls first; return, resubmit, withdraw, reject', async () => {
  const { api, call, chart, accountId } = await setup();
  const c = await chart();
  const other = c.groups.find((g) => g.code === '5600');
  const body = { code: '560010', name: 'Site security services', groupId: other.id, type: 'EXPENSE', normalBalance: 'DR', dimensions: { PROJECT: 'MANDATORY', SITE: 'OPTIONAL' }, reason: 'security guards at sites' };
  assert.equal((await call(acc, 'POST', '/accounts', { ...body, type: 'REVENUE' })).status, 400, 'a revenue account is not in an expense group');
  assert.equal((await call(acc, 'POST', '/accounts', { ...body, normalBalance: 'CR' })).status, 400, 'an expense account is debit unless a contra reason is given');
  assert.equal((await call(acc, 'POST', '/accounts', { ...body, isControl: true, controlKind: 'AP' })).status, 400, 'an AP control account is a payable');
  const r = await call(acc, 'POST', '/accounts', body);
  assert.equal(r.status, 202, JSON.stringify(r.json));
  assert.equal(r.json.data.status, 'PENDING');
  assert.equal(r.json.data.makerRole, 'ACCMGR');
  assert.ok(!(await chart()).accounts.some((a) => a.code === '560010'), 'not in the chart before approval');
  assert.equal((await api.call('GET', `${W}/tasks?mine=assigned`, as('ACCMGR', 'facc1'))).json.data.rows.filter((t) => t.instance.id === r.json.data.instanceId).length, 0, 'the maker does not approve their own change');
  await act(api, cfo, r.json.data.instanceId, 'return', 'add the cost centre rule please');
  assert.equal((await call(acc, 'GET', `/changes/${r.json.data.id}`)).json.data.status, 'RETURNED');
  const again = await call(acc, 'POST', `/changes/${r.json.data.id}/resubmit`, { reason: 'the rule is fine as it is, see note' });
  assert.equal(again.status, 202, JSON.stringify(again.json));
  await act(api, cfo, r.json.data.instanceId);
  const added = (await chart()).accounts.find((a) => a.code === '560010');
  assert.deepEqual(added.dimensions, { PROJECT: 'MANDATORY', SITE: 'OPTIONAL' });
  const detail = (await call(pm, 'GET', `/accounts/${added.id}`)).json.data;
  assert.equal(detail.group.code, '5600');
  assert.equal(detail.changes[0].status, 'APPLIED');
  // project controls proposes a cost code: accounts manager, then CFO
  const head = (await call(pcm, 'GET', '/cost-heads')).json.data.heads.find((h) => h.code === '1.1');
  const cc = await call(pcm, 'POST', '/cost-codes', { code: 'MAT-CEM-PPC', name: 'Cement PPC', costHeadId: head.id, uom: 'MT', reason: 'PPC cement tracked apart from OPC' });
  assert.equal(cc.status, 202, JSON.stringify(cc.json));
  assert.equal(cc.json.data.makerRole, 'PCMGR');
  await act(api, as('ACCMGR', 'facc1'), cc.json.data.instanceId);
  assert.ok(!(await call(pcm, 'GET', '/cost-codes')).json.data.codes.some((x) => x.code === 'MAT-CEM-PPC'), 'still waits for the CFO');
  await act(api, cfo, cc.json.data.instanceId);
  assert.ok((await call(pcm, 'GET', '/cost-codes')).json.data.codes.some((x) => x.code === 'MAT-CEM-PPC'));
  const subHead = await call(pcm, 'POST', '/cost-heads', { code: '1.9', name: 'Waterproofing', parentId: (await call(pcm, 'GET', '/cost-heads')).json.data.heads.find((h) => h.code === '1').id, reason: 'waterproofing materials apart' });
  assert.equal(subHead.status, 202, JSON.stringify(subHead.json));
  assert.equal((await call(pcm, 'POST', '/cost-heads', { code: '7', name: 'Insurance', reason: 'a top head without account' })).status, 400, 'a top cost head needs an account');
  // withdraw before anyone acted; reject
  const wd = await call(acc, 'POST', '/accounts', { ...body, code: '560011', name: 'Site housekeeping' });
  assert.equal((await call(acc, 'POST', `/changes/${wd.json.data.id}/withdraw`, { reason: 'proposed by mistake today' })).json.data.status, 'CANCELLED');
  const rj = await call(acc, 'POST', '/accounts', { ...body, code: '560012', name: 'Site entertainment' });
  await act(api, cfo, rj.json.data.instanceId, 'reject', 'use site overheads');
  assert.equal((await call(acc, 'GET', `/changes/${rj.json.data.id}`)).json.data.status, 'REJECTED');
  assert.ok(!(await chart()).accounts.some((a) => ['560011', '560012'].includes(a.code)));
  // one change of an account at a time
  const fuel = await accountId('560003');
  const f = (await call(acc, 'GET', `/accounts/${fuel}`)).json.data;
  assert.equal((await call(acc, 'POST', `/accounts/${fuel}/block`, { block: true, reason: 'fuel is costed through plant now' })).status, 202);
  assert.equal((await call(acc, 'PUT', `/accounts/${fuel}`, { name: 'Fuel', reason: 'shorter name for reports', version: f.rowVersion })).status, 409);
});

test('BR-02 an account with postings is not deleted and keeps its nature; it can be blocked, and a blocked account takes no postings', async () => {
  const { api, call, chart, accountId, project } = await setup();
  const c = await chart();
  const g = c.groups.find((x) => x.code === '5600');
  const r = await call(acc, 'POST', '/accounts', { code: '560020', name: 'Testing charges', groupId: g.id, type: 'EXPENSE', normalBalance: 'DR', dimensions: { PROJECT: 'MANDATORY' }, reason: 'lab testing of materials' });
  await act(api, cfo, r.json.data.instanceId);
  const id = await accountId('560020');
  const posted = new Set([id]);
  accountPostings.register({ code: 'test-gl', count: (_db, _c, accountId) => (posted.has(accountId) ? 3 : 0) });
  try {
    const a = (await call(acc, 'GET', `/accounts/${id}`)).json.data;
    assert.equal(a.postings, 3);
    assert.equal(a.canDelete, false);
    const del = await call(acc, 'DELETE', `/accounts/${id}`, { reason: 'opened by mistake last week' });
    assert.equal(del.status, 422);
    assert.match(del.json.error.message, /cannot be deleted, only blocked/);
    const income = c.groups.find((x) => x.code === '4200');
    const nature = await call(acc, 'PUT', `/accounts/${id}`, { groupId: income.id, type: 'REVENUE', normalBalance: 'CR', reason: 'it is really a recovery from clients', version: a.rowVersion });
    assert.equal(nature.status, 400);
    assert.match(JSON.stringify(nature.json), /nature, type, normal balance and control setting cannot change/);
    assert.equal((await call(acc, 'PUT', `/accounts/${id}`, { name: 'Material testing charges', reason: 'clearer name for the reports', version: a.rowVersion })).status, 202, 'its name may change');
    const pending = (await call(acc, 'GET', '/changes?status=PENDING')).json.data.rows.find((x) => x.entityId === id);
    await act(api, cfo, pending.instanceId);
    const b = await call(acc, 'POST', `/accounts/${id}/block`, { block: true, reason: 'testing is charged to subcontract now' });
    assert.equal(b.status, 202);
    await act(api, cfo, b.json.data.instanceId);
    const blocked = (await call(acc, 'GET', `/accounts/${id}`)).json.data;
    assert.equal(blocked.status, 'BLOCKED');
    assert.equal(blocked.name, 'Material testing charges');
    assert.deepEqual((await call(acc, 'POST', '/postings/check', { accountId: id, source: 'ENGINE', dimensions: { PROJECT: project } })).json.data.errors.map((e) => e.code), ['ACCOUNT_BLOCKED']);
    // an unused account is deleted
    posted.clear();
    const fresh = await call(acc, 'POST', '/accounts', { code: '560021', name: 'Unused account', groupId: g.id, type: 'EXPENSE', normalBalance: 'DR', reason: 'to be deleted again' });
    await act(api, cfo, fresh.json.data.instanceId);
    const fid = await accountId('560021');
    assert.equal((await call(acc, 'DELETE', `/accounts/${fid}`, { reason: 'opened by mistake today' })).status, 200);
    assert.equal((await call(acc, 'GET', `/accounts/${fid}`)).status, 404);
    assert.equal((await call(acc, 'DELETE', `/accounts/${await accountId('220001')}`, { reason: 'trying to delete a control account' })).status, 422, 'a control account is never deleted');
    assert.ok(api.db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'fin_accounts' AND entity_id = ? AND action = 'delete'").get(String(fid)) || api.db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'fin_accounts' AND action = 'delete'").get());
  } finally { accountPostings.unregister('test-gl'); }
});

test('AC-01 every item category is mapped to accounts and a cost code; a new category shows as missing until a mapping is approved; the posting engine resolves through the parent', async () => {
  const { api, call } = await setup();
  const m = (await call(acc, 'GET', '/category-mappings')).json.data;
  assert.ok(m.total >= 13, `categories: ${m.total}`);
  assert.equal(m.complete, true, JSON.stringify(m.missing));
  const cement = m.rows.find((r) => r.code === 'CEMENT');
  assert.equal(cement.mapping.costCode.code, 'MAT-CEM');
  assert.equal(cement.mapping.inventory.code, '130001');
  assert.equal(cement.mapping.expense.code, '510001');
  // a new category in the item master
  const civil = m.rows.find((r) => r.code === 'CIVIL');
  const top = Number(api.db.prepare("INSERT INTO mdm_item_categories (company_id, parent_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (1, NULL, 'WATERPROOF', 'Waterproofing', 'WPF', '[\"MATERIAL\"]', '[]', 'PROCMGR', 'ACTIVE')").run().lastInsertRowid);
  const child = Number(api.db.prepare("INSERT INTO mdm_item_categories (company_id, parent_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (1, ?, 'ADMIX', 'Admixtures', 'ADM', '[\"MATERIAL\"]', '[]', 'PROCMGR', 'ACTIVE')").run(civil.categoryId).lastInsertRowid);
  const m2 = (await call(acc, 'GET', '/category-mappings')).json.data;
  assert.equal(m2.complete, false);
  assert.deepEqual(m2.missing.map((x) => x.code), ['WATERPROOF']);
  const admix = m2.rows.find((r) => r.categoryId === child);
  assert.equal(admix.inherited, true, 'a child category uses its parent mapping');
  assert.equal(admix.inheritedFrom, 'CIVIL');
  assert.equal(finOf(api.db).resolveCategory(1, child).costCodeId, civil.mapping.costCode.id);
  // the accounts manager maps it; nothing changes until the CFO approves
  const codes = (await call(acc, 'GET', '/cost-codes')).json.data.codes;
  const chart = (await call(acc, 'GET', '/accounts')).json.data.accounts;
  const row = { categoryId: top, inventoryAccountId: chart.find((a) => a.code === '130001').id, expenseAccountId: chart.find((a) => a.code === '510001').id, costCodeId: codes.find((x) => x.code === 'MAT-OTH').id };
  assert.equal((await call(acc, 'POST', '/category-mappings', { rows: [{ ...row, inventoryAccountId: chart.find((a) => a.code === '220001').id }], reason: 'map waterproofing materials' })).status, 400, 'a payable is not a stock account');
  assert.equal((await call(acc, 'POST', '/category-mappings', { rows: [{ ...row, expenseAccountId: chart.find((a) => a.code === '410001').id }], reason: 'map waterproofing materials' })).status, 400, 'revenue is not a consumption account');
  assert.equal((await call(pm, 'POST', '/category-mappings', { rows: [row], reason: 'map waterproofing materials' })).status, 403);
  const r = await call(acc, 'POST', '/category-mappings', { rows: [row], reason: 'map waterproofing materials' });
  assert.equal(r.status, 202, JSON.stringify(r.json));
  assert.equal((await call(acc, 'GET', '/category-mappings')).json.data.rows.find((x) => x.categoryId === top).pendingChangeId, r.json.data.id);
  assert.equal((await call(acc, 'POST', '/category-mappings', { rows: [row], reason: 'map waterproofing materials again' })).status, 409, 'one change of a category at a time');
  await act(api, cfo, r.json.data.instanceId);
  const m3 = (await call(acc, 'GET', '/category-mappings')).json.data;
  assert.equal(m3.complete, true);
  assert.equal(m3.mapped, m3.total);
  // a later change retires the earlier mapping from its date
  const next = await call(acc, 'POST', '/category-mappings', { rows: [{ ...row, costCodeId: codes.find((x) => x.code === 'SUB-CIV').id, inventoryAccountId: null, expenseAccountId: chart.find((a) => a.code === '560001').id }], effectiveFrom: '2027-04-01', reason: 'waterproofing is subcontracted from next year' });
  await act(api, cfo, next.json.data.instanceId);
  assert.equal(finOf(api.db).resolveCategory(1, top, '2027-03-31').expenseAccountId, row.expenseAccountId, 'the old mapping holds until the day before');
  assert.equal(finOf(api.db).resolveCategory(1, top, '2027-04-01').expenseAccountId, chart.find((a) => a.code === '560001').id);
});

test('FR-06 the import from Tally: the mapping report places each ledger, ledgers whose group is unknown are listed, the mapped ones become one change for the CFO; the export', async () => {
  const { api, call, chart } = await setup();
  const rows = [
    { name: 'Ultratech Cement Ltd', parent: 'Sundry Creditors' }, { name: 'HDFC Bank CA 0042', parent: 'Bank Accounts' }, { name: 'Output CGST 9%', parent: 'Duties & Taxes' },
    { name: 'Site Petty Cash Pune', parent: 'Cash-in-Hand' }, { name: 'Freight Inward', parent: 'Direct Expenses' }, { name: 'Suspense', parent: 'Suspense A/c' }, { name: 'Interest on FD', parent: 'Other income' },
  ];
  assert.equal((await call(pm, 'POST', '/import/preview', { format: 'TALLY', rows })).status, 403);
  const rep = (await call(acc, 'POST', '/import/preview', { format: 'TALLY', rows })).json.data;
  assert.equal(rep.total, 7);
  assert.equal(rep.mapped, 6);
  assert.deepEqual(rep.unknownGroups, ['Suspense A/c']);
  const by = Object.fromEntries(rep.rows.map((r) => [r.name, r]));
  assert.equal(by['Ultratech Cement Ltd'].group, '2200 Trade payables');
  assert.equal(by['Ultratech Cement Ltd'].controlKind, 'AP');
  assert.equal(by['HDFC Bank CA 0042'].type, 'BANK');
  assert.equal(by['Interest on FD'].mappedBy, 'group of this chart');
  assert.match(by.Suspense.problems[0], /not known/);
  const before = (await chart()).accounts.length;
  const sub = await call(acc, 'POST', '/import', { format: 'TALLY', rows, reason: 'opening chart from Tally for FY 2026-27' });
  assert.equal(sub.status, 202, JSON.stringify(sub.json));
  assert.match(sub.json.data.change.what, /Import of 6 accounts from Tally/);
  assert.equal((await chart()).accounts.length, before, 'nothing is added before approval');
  await act(api, cfo, sub.json.data.change.instanceId);
  const after = await chart();
  assert.equal(after.accounts.length, before + 6);
  assert.ok(after.accounts.find((a) => a.name === 'Ultratech Cement Ltd').isControl);
  const again = (await call(acc, 'POST', '/import/preview', { format: 'TALLY', rows: rows.slice(0, 1) })).json.data;
  assert.match(again.rows[0].problems.join(), /already exists/);
  // the export of the chart (CSV, audited)
  const ex = await api.raw('GET', `${F}/accounts/export`, acc);
  assert.equal(ex.status, 200);
  assert.match(ex.buffer.toString('utf8'), /Code,Name,Group,Nature,Schedule III line/);
  assert.match(ex.buffer.toString('utf8'), /Ultratech Cement Ltd/);
});
