import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { publishEvent } from '../src/server/platform/events/index.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { budOf } from '../src/server/modules/bud/budgets.js';
import { allocateByWeights, poolsOverlap, sharesOf } from '../src/server/modules/bud/alloc.js';
import { setupCompany, startApi } from './helpers.js';

// Part 12.04: head-office and department overhead budgets. T-01 an allocation distributes the pool exactly across projects (the rounding residual goes to the largest share). Also: the budget by account and month with the totals worked out by the server,
// the chain department head > CFO > director with the creator never approving, locking and the version compared with the one in force, actuals from the ledger (events and the ingest endpoint, each source once), the report with drill-down, the
// allocation rules drafted by one person and put in force by another, the runs and what part 23.10 reads, roles, department isolation, the other company and the flag.
const B = '/api/v1/bud'; const W = '/api/v1/workflow';
const opened = []; after(async () => { for (const a of opened) await a.close(); });
let seq = 0; const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `dp-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const prep = as('HRMGR', 'dprep1'); const head = as('HRMGR', 'dhead1'); const head2 = as('HRMGR', 'dhead2'); const cfo = as('CFO', 'dcfo1'); const dir = as('DIR', 'ddir1'); const sys = as('SYSADM', 'dsys1');
const acc = as('ACCMGR', 'dacc1'); const acc2 = as('ACCMGR', 'dacc2'); const aud = as('AUD', 'daud1'); const se = as('SE', 'dse1'); const other = as('CFO', 'dcfo9', '2');
const R = (p) => (p / 100).toFixed(2);

async function boot() {
  const api = await startApi(); opened.push(api); await setupCompany(api); const d = api.db;
  for (const [n, r] of [['dprep1', ['HRMGR']], ['dprep2', ['HRMGR']], ['dhead1', ['HRMGR']], ['dhead2', ['HRMGR']], ['dcfo1', ['CFO']], ['dcfo2', ['CFO']], ['ddir1', ['DIR']], ['dsys1', ['SYSADM']], ['dacc1', ['ACCMGR']], ['dacc2', ['ACCMGR']], ['daud1', ['AUD']], ['dse1', ['SE']]]) d.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  const uid = (n) => Number(d.prepare('SELECT id FROM iam_users WHERE username = ?').get(n).id);
  const dept = (code, name, parent = null) => Number(d.prepare("INSERT INTO org_departments (company_id, parent_id, kind, code, name, created_by, source_type) VALUES (1, ?, 'DEPARTMENT', ?, ?, 't', 't')").run(parent, code, name).lastInsertRowid);
  const hr = dept('HR', 'Human resources'); const adm = dept('ADM', 'Administration');
  const headOf = (dep, user) => d.prepare("INSERT INTO org_assignments (company_id, entity_type, entity_id, role, user_id, effective_from, created_by, source_type) VALUES (1, 'DEPARTMENT', ?, 'HEAD', ?, '2026-01-01', 't', 't')").run(dep, uid(user));
  headOf(hr, 'dhead1'); headOf(adm, 'dhead2');
  const cc = (code, name, link = null) => Number(d.prepare("INSERT INTO org_cost_centres (company_id, code, name, type, linked_type, linked_id, created_by, source_type) VALUES (1, ?, ?, 'COST', ?, ?, 't', 't')").run(code, name, link ? 'DEPARTMENT' : null, link).lastInsertRowid);
  const ccHr = cc('CC-HR', 'HR cost centre', hr); const ccAdm = cc('CC-ADM', 'Administration cost centre', adm); const ccHo = cc('CC-HO', 'Head office (no department)');
  const ccProj = Number(d.prepare("INSERT INTO org_cost_centres (company_id, code, name, type, linked_type, linked_id, created_by, source_type) VALUES (1, 'CC-PRJ', 'A project', 'COST', 'PROJECT', 1, 't', 't')").run().lastInsertRowid);
  const accounts = d.prepare("SELECT a.id, a.code FROM fin_accounts a JOIN fin_account_groups g ON g.id = a.group_id WHERE a.company_id IS NULL AND g.nature = 'EXPENSE' AND a.is_control = 0 AND a.account_status = 'ACTIVE' ORDER BY a.code").all();
  const fy = d.prepare('SELECT * FROM core_financial_years WHERE company_id = 1').get(); const periods = d.prepare('SELECT * FROM core_periods WHERE fy_id = ? ORDER BY period_no').all(fy.id);
  const proj = (code, cv, status = 'ACTIVE') => { const id = Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, ?, ?, 'BUILDING', ?)").run(code, `Project ${code}`, status).lastInsertRowid); d.prepare("INSERT INTO proj_projects (company_id, project_id, pm_user, contract_value, start_date, scheduled_completion, created_by) VALUES (1, ?, 'x', ?, '2026-04-01', '2027-03-31', 'test')").run(id, cv); return id; };
  const p1 = proj('PA', 600_000_000); const p2 = proj('PB', 300_000_000); const p3 = proj('PC', 100_000_000); const pDraft = proj('PX', 900_000_000, 'DRAFT');
  const call = (who, method, path, body, k = key()) => api.call(method, `${B}${path}`, { ...who, headers: k, body });
  const act = async (who, instanceId, action = 'approve') => {
    const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId); assert.ok(task, `${who.user} has the task of instance ${instanceId}`);
    const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key(), body: { action, comment: 'checked' } }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r;
  };
  const months = (v) => (Array.isArray(v) ? v : Array(12).fill(v));
  const line = (i, v, note) => ({ accountId: accounts[i].id, months: months(v), ...(note ? { note } : {}) });
  const create = async (who, over = {}) => { const r = await call(who, 'POST', '/dept-budgets', { fyId: fy.id, costCentreId: ccHr, lines: [line(0, 1000), line(1, 500)], ...over }); return r; };
  const approve = async (id, { who = prep } = {}) => {
    const s = await call(who, 'POST', `/dept-budgets/${id}/submit`); assert.equal(s.status, 202, JSON.stringify(s.json)); const inst = s.json.data.workflowInstanceId;
    await act(head, inst); await act(cfo, inst); await act(dir, inst); return (await call(prep, 'GET', `/dept-budgets/${id}`)).json.data;
  };
  return { api, d, call, act, create, approve, line, months, fy, periods, accounts, ccHr, ccAdm, ccHo, ccProj, hr, adm, p1, p2, p3, pDraft, uid };
}

test('T-01 the allocation distributes the pool exactly across projects, the rounding residual to the largest share (BR-01)', async () => {
  // the arithmetic itself
  assert.deepEqual(allocateByWeights(10000, [1, 1, 1]), { parts: [3334, 3333, 3333], residual: 1, residualIndex: 0, total: 10000 }, 'a tie: the first of the largest');
  const a = allocateByWeights(100, [1, 5, 4]); assert.deepEqual(a.parts, [10, 50, 40]); assert.equal(a.residual, 0);
  const b = allocateByWeights(10_000_001, [333, 333, 334]); assert.equal(b.total, 10_000_001); assert.equal(b.residualIndex, 2, 'the residual goes to the largest weight'); assert.ok(b.residual > 0 && b.residual < 3);
  const z = allocateByWeights(0, [5, 5]); assert.deepEqual(z.parts, [0, 0]);
  assert.throws(() => allocateByWeights(100, [0, 0]), /zero/); assert.throws(() => allocateByWeights(100, []), /nothing/); assert.throws(() => allocateByWeights(-1, [1]), /whole number/); assert.throws(() => allocateByWeights(10.5, [1]), /whole number/); assert.throws(() => allocateByWeights(10, [1, -1]), /weight/);
  let s = 1234567; const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s; };
  for (let i = 0; i < 500; i += 1) { const w = Array.from({ length: 1 + (rnd() % 9) }, () => 1 + (rnd() % 1_000_000_000)); const pool = rnd() * 7; const r = allocateByWeights(pool, w); assert.equal(r.total, pool, `pool ${pool} over ${w.join(',')}`); assert.ok(r.residual >= 0 && r.residual < w.length); assert.ok(r.parts.every((x) => x >= 0)); }
  assert.deepEqual(sharesOf([1, 1, 1]), [333333, 333333, 333333]); assert.equal(sharesOf([1, 3]).reduce((x, y) => x + y, 0), 1_000_000);
  assert.equal(poolsOverlap({ costCentreIds: [1, 2] }, { costCentreIds: [2, 3], accountIds: [] }), true); assert.equal(poolsOverlap({ costCentreIds: [1], accountIds: [5] }, { costCentreIds: [1], accountIds: [6] }), false); assert.equal(poolsOverlap({ costCentreIds: [1] }, { costCentreIds: [2] }), false);

  // through the API: three projects by contract value, a pool that does not divide
  const t = await boot();
  assert.equal((await t.create(prep, { lines: [t.line(0, [10000.01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])] })).status, 201);
  const id = (await t.call(prep, 'GET', '/dept-budgets')).json.data[0].id; await t.approve(id);
  const rule = await t.call(acc, 'POST', '/alloc-rules', { fyId: t.fy.id, name: 'Head office by revenue', basis: 'REVENUE', pool: { costCentreIds: [t.ccHr], accountIds: [] }, projectIds: [], fixed: [], reason: 'Share head-office cost by contract value' }); assert.equal(rule.status, 201, JSON.stringify(rule.json));
  assert.equal((await t.call(acc, 'POST', `/alloc-rules/${rule.json.data.id}/activate`)).status, 403, 'the person who drafted it does not put it in force');
  const act = await t.call(cfo, 'POST', `/alloc-rules/${rule.json.data.id}/activate`); assert.equal(act.status, 200, JSON.stringify(act.json));
  const pv = await t.call(acc, 'POST', '/alloc/preview', { ruleId: rule.json.data.id, fromPeriodNo: 1, toPeriodNo: 12, poolSource: 'BUDGET' }); assert.equal(pv.status, 200, JSON.stringify(pv.json));
  const v = pv.json.data; assert.equal(v.pool, '10000.01'); assert.equal(v.lines.length, 3, 'the draft project is not in the allocation'); assert.equal(v.balanced, true);
  const paise = v.lines.map((l) => Math.round(Number(l.amount) * 100)); assert.equal(paise.reduce((x, y) => x + y, 0), 1_000_001, 'the shares add up to the pool exactly');
  assert.deepEqual(v.lines.map((l) => l.amount), ['6000.01', '3000.00', '1000.00'], '60 % / 30 % / 10 %: the residual paisa goes to the largest');
  assert.equal(v.lines.find((l) => l.residual !== '0.00').project.startsWith('PA'), true);
});

test('the department budget: amounts by account and month, totals worked out by the server, and the validation', async () => {
  const t = await boot();
  const o = (await t.call(prep, 'GET', '/dept-options')).json.data; assert.equal(o.fys[0].periods.length, 12); assert.ok(o.accounts.length >= 3);
  assert.deepEqual(o.costCentres.map((c) => c.code), ['CC-ADM', 'CC-HO', 'CC-HR'], 'the cost centre of a project is not offered');
  const sp = await t.call(prep, 'POST', '/dept-budgets/spread', { total: 100000.01, profile: 'SCURVE' }); assert.equal(sp.status, 200); assert.equal(sp.json.data.months.length, 12); assert.equal(sp.json.data.months.reduce((x, y) => x + Math.round(Number(y) * 100), 0), 10_000_001, 'the months add up to the total exactly');
  assert.ok(Number(sp.json.data.months[0]) < Number(sp.json.data.months[6]), 'an S-curve starts slow');
  const lo = (await t.call(prep, 'POST', '/dept-budgets/spread', { total: 120000, profile: 'LINEAR' })).json.data.months; assert.deepEqual(lo, Array(12).fill('10000.00'));
  const c = await t.create(prep, { lines: [t.line(0, 1000.5, 'Staff'), t.line(1, [0, 0, 100, 0, 0, 0, 0, 0, 0, 0, 0, 200])], total: 12306 }); assert.equal(c.status, 201, JSON.stringify(c.json));
  const b = c.json.data; assert.equal(b.status, 'DRAFT'); assert.equal(b.total, '12306.00'); assert.equal(b.linesCount, 2); assert.equal(b.versionNo, 1); assert.match(b.docNo, /^DEB\//); assert.equal(b.lines[0].total, '12006.00'); assert.equal(b.monthTotals[2], '1100.50'); assert.equal(b.departmentId, t.hr);
  assert.equal(b.can.edit, true); assert.equal(b.can.submit, true); assert.equal(b.can.amend, false);
  // validation
    const r1 = await t.create(prep); assert.equal(r1.status, 409, 'the open budget of the cost centre'); await t.call(prep, 'DELETE', `/dept-budgets/${b.id}`);
  assert.equal((await t.create(prep, { total: 1 })).status, 400, 'a total that differs is refused'); assert.match(JSON.stringify((await t.create(prep, { total: 1 })).json), /worked out by the server/);
  const dup = await t.create(prep, { lines: [t.line(0, 1), t.line(0, 2)] }); assert.equal(dup.status, 400); assert.match(JSON.stringify(dup.json), /twice/);
  const asset = t.d.prepare("SELECT a.id FROM fin_accounts a JOIN fin_account_groups g ON g.id = a.group_id WHERE g.nature = 'ASSET' LIMIT 1").get();
  assert.equal((await t.create(prep, { lines: [{ accountId: asset.id, months: t.months(1) }] })).status, 400, 'only expense accounts');
  assert.equal((await t.create(prep, { lines: [{ accountId: t.accounts[0].id, months: [1, 2, 3] }] })).status, 400, 'twelve months');
  assert.equal((await t.create(prep, { lines: [{ accountId: t.accounts[0].id, months: t.months(-1) }] })).status, 400, 'no negative amount');
  assert.equal((await t.create(prep, { lines: [{ accountId: t.accounts[0].id, months: t.months(1.005) }] })).status, 400, 'two decimals at most');
  assert.equal((await t.create(prep, { costCentreId: t.ccProj })).status, 400, 'a cost centre of a project has no head-office budget');
  assert.equal((await t.create(prep, { fyId: 999 })).status, 400);
  // edit, optimistic lock, a draft that is deleted
  const c2 = (await t.create(prep, { costCentreId: t.ccHo })).json.data;
  const u = await t.call(prep, 'PATCH', `/dept-budgets/${c2.id}`, { lines: [t.line(0, 2000)], rowVersion: c2.rowVersion }); assert.equal(u.status, 200, JSON.stringify(u.json)); assert.equal(u.json.data.total, '24000.00'); assert.equal(u.json.data.linesCount, 1);
  assert.equal((await t.call(prep, 'PATCH', `/dept-budgets/${c2.id}`, { name: 'Late', rowVersion: c2.rowVersion })).status, 409, 'someone changed it');
  assert.equal((await t.call(prep, 'DELETE', `/dept-budgets/${c2.id}`)).status, 200); assert.equal((await t.call(prep, 'GET', `/dept-budgets/${c2.id}`)).status, 404);
  // lines of a budget that has no amount are not sent
  const z = (await t.create(prep, { costCentreId: t.ccHo, lines: [t.line(0, 0)] })).json.data; assert.equal(z.can.submit, false); assert.equal((await t.call(prep, 'POST', `/dept-budgets/${z.id}/submit`)).status, 422);
  assert.equal((await t.api.call('POST', `${B}/dept-budgets/${z.id}/submit`, { ...prep, headers: { 'content-type': 'application/json' } })).status, 400, 'an idempotency key is required to submit');
});

test('the chain department head > CFO > director: nobody approves their own, return and resubmit, reject, cancel, locking', async () => {
  const t = await boot();
  const b = (await t.create(prep)).json.data;
  assert.equal((await t.call(cfo, 'POST', '/dept-budgets', { fyId: t.fy.id, costCentreId: t.ccAdm, lines: [t.line(0, 1)] })).status, 403, 'the CFO approves, does not prepare');
  assert.equal((await t.call(se, 'GET', `/dept-budgets/${b.id}`)).status, 403);
  const s1 = await t.call(prep, 'POST', `/dept-budgets/${b.id}/submit`); assert.equal(s1.status, 202, JSON.stringify(s1.json)); const inst = s1.json.data.workflowInstanceId; assert.equal(s1.json.data.status, 'SUBMITTED');
  assert.equal((await t.call(prep, 'PATCH', `/dept-budgets/${b.id}`, { name: 'Edited while waiting' })).status, 409, 'locked while it waits');
  const wf = (await t.api.call('GET', `${W}/instances/${inst}`, prep)).json?.data; const tasks = wf?.tasks ?? []; assert.equal(tasks[0]?.assigneeUser, 'dhead1', 'the first step is the head of the department of the cost centre');
  assert.equal((await t.api.call('GET', `${W}/tasks?mine=assigned`, cfo)).json.data.rows.some((x) => x.instance.id === inst), false, 'the CFO has nothing yet');
  // the head returns it; the preparer corrects and sends again
  const task = (await t.api.call('GET', `${W}/tasks?mine=assigned`, head)).json.data.rows.find((x) => x.instance.id === inst);
  { const rr = await t.api.call('POST', `${W}/tasks/${task.id}/act`, { ...head, headers: key(), body: { action: 'return', comment: 'Salary line is too low' } }); assert.equal(rr.status, 200, JSON.stringify(rr.json)); }
  const ret = (await t.call(prep, 'GET', `/dept-budgets/${b.id}`)).json.data; assert.equal(ret.status, 'RETURNED'); assert.equal(ret.can.edit, true);
  assert.equal((await t.call(prep, 'PATCH', `/dept-budgets/${b.id}`, { lines: [t.line(0, 1200), t.line(1, 500)] })).status, 200);
  const s2 = await t.call(prep, 'POST', `/dept-budgets/${b.id}/submit`); assert.equal(s2.status, 202, JSON.stringify(s2.json));
  await t.act(head, inst); assert.equal((await t.call(prep, 'GET', `/dept-budgets/${b.id}`)).json.data.status, 'SUBMITTED', 'two more steps');
  await t.act(cfo, inst); await t.act(dir, inst);
  const ok = (await t.call(prep, 'GET', `/dept-budgets/${b.id}`)).json.data; assert.equal(ok.status, 'APPROVED'); assert.equal(ok.total, '20400.00'); assert.ok(ok.approvedBy && ok.lockedAt); assert.equal(ok.inForce, true);
  // locked: no edit, no delete, no cancel
  assert.equal((await t.call(prep, 'PATCH', `/dept-budgets/${b.id}`, { name: 'Edit' })).status, 409); assert.equal((await t.call(prep, 'DELETE', `/dept-budgets/${b.id}`)).status, 422); assert.equal((await t.call(prep, 'POST', `/dept-budgets/${b.id}/cancel`, { reason: 'not wanted any more' })).status, 422);
  assert.equal((await t.create(prep)).status, 409, 'a new budget for a year that is approved: use a new version');
  const rows = t.d.prepare("SELECT event_type FROM core_outbox WHERE event_type LIKE 'bud.dept_budget.%'").all().map((x) => x.event_type); assert.ok(rows.includes('bud.dept_budget.approved'));
  // the head prepares his own: he is not the one who approves it
  const h = (await t.call(head, 'POST', '/dept-budgets', { fyId: t.fy.id, costCentreId: t.ccAdm, lines: [t.line(0, 100)] })); assert.equal(h.status, 201, JSON.stringify(h.json));
  const hs = await t.call(head, 'POST', `/dept-budgets/${h.json.data.id}/submit`); assert.equal(hs.status, 202);
  const adminTasks = (await t.api.call('GET', `${W}/instances/${hs.json.data.workflowInstanceId}`, head)).json.data.tasks; assert.notEqual(adminTasks[0].assigneeUser, 'dhead1'); assert.ok(adminTasks[0].assigneeUser === 'dhead2' || adminTasks[0].status === 'ADMIN_QUEUE', 'the head of the department of ADM is dhead2 (not the sender)');
  // reject, cancel, withdraw
  const r = (await t.create(prep, { costCentreId: t.ccHo })).json.data; const rs = (await t.call(prep, 'POST', `/dept-budgets/${r.id}/submit`)).json.data;
  assert.equal((await t.call(se, 'POST', `/dept-budgets/${r.id}/withdraw`, { reason: 'not mine to withdraw' })).status, 403);
  const wd = await t.call(prep, 'POST', `/dept-budgets/${r.id}/withdraw`, { reason: 'Sent too early' }); assert.equal(wd.status, 200, JSON.stringify(wd.json)); assert.equal(wd.json.data.status, 'DRAFT');
  assert.equal((await t.call(prep, 'POST', `/dept-budgets/${r.id}/cancel`, { reason: 'Replaced by another plan' })).json.data.status, 'CANCELLED');
  const again = await t.call(prep, 'POST', `/dept-budgets/${r.id}/amend`, { reason: 'Raised again with a new plan' }); assert.equal(again.status, 201, JSON.stringify(again.json)); assert.equal(again.json.data.versionNo, 2); assert.equal(again.json.data.vtype, 'ORIGINAL');
  const as2 = (await t.call(prep, 'POST', `/dept-budgets/${again.json.data.id}/submit`)).json.data; assert.ok(rs.workflowInstanceId);
  // company-level cost centre: no head to find, the step waits for an administrator; the CFO and director are not the first step
  const tasks2 = (await t.api.call('GET', `${W}/instances/${as2.workflowInstanceId}`, prep)).json.data.tasks; assert.equal(tasks2[0].status, 'ADMIN_QUEUE');
  const adminRow = (await t.api.call('GET', `${W}/tasks?mine=admin`, sys)).json.data.rows.find((x) => x.instance.id === as2.workflowInstanceId); assert.ok(adminRow, 'the workflow administrator has it');
  assert.equal((await t.call(prep, 'POST', `/dept-budgets/${again.json.data.id}/cancel`, { reason: 'No plan for this cost centre' })).json.data.status, 'CANCELLED', 'a budget that waits is cancelled by its maker');
  const rj = h.json.data; const rjs = hs.json.data;
  const rtask = (await t.api.call('GET', `${W}/tasks?mine=assigned`, head2)).json.data.rows.find((x) => x.instance.id === rjs.workflowInstanceId); assert.ok(rtask, 'the head of the administration department has it');
  assert.equal((await t.api.call('GET', `${W}/tasks?mine=assigned`, head)).json.data.rows.some((x) => x.instance.id === rjs.workflowInstanceId), false, 'the head of another department has not');
  assert.equal((await t.api.call('POST', `${W}/tasks/${rtask.id}/act`, { ...head2, headers: key(), body: { action: 'reject', comment: 'Too high for this year' } })).status, 200);
  assert.equal((await t.call(prep, 'GET', `/dept-budgets/${rj.id}`)).json.data.status, 'REJECTED');
  const h3 = await t.call(prep, 'GET', `/dept-budgets/${rj.id}/history`); assert.ok(h3.json.data.audit.some((x) => x.action === 'rejected')); assert.ok(h3.json.data.approvals.length > 0);
});

test('a new version of an approved budget is compared with the one in force and replaces it when approved (FR-02)', async () => {
  const t = await boot(); const b = (await t.create(prep)).json.data; await t.approve(b.id);
  assert.equal((await t.call(se, 'POST', `/dept-budgets/${b.id}/amend`, { reason: 'Rents go up in July' })).status, 403);
  const am = await t.call(prep, 'POST', `/dept-budgets/${b.id}/amend`, { reason: 'Rents go up in July' }); assert.equal(am.status, 201, JSON.stringify(am.json)); const v2 = am.json.data;
  assert.deepEqual([v2.versionNo, v2.vtype, v2.status, v2.total, v2.parent.docNo], [2, 'REVISED', 'DRAFT', '18000.00', b.docNo], 'a draft copy of the lines');
  assert.equal((await t.call(prep, 'POST', `/dept-budgets/${b.id}/amend`, { reason: 'Again, before the first is done' })).status, 409, 'one open version at a time');
  assert.equal((await t.call(prep, 'GET', `/dept-budgets/${b.id}`)).json.data.status, 'APPROVED', 'the approved version stays in force meanwhile');
  const up = await t.call(prep, 'PATCH', `/dept-budgets/${v2.id}`, { lines: [t.line(0, 1000), t.line(1, [500, 500, 500, 500, 500, 500, 900, 900, 900, 900, 900, 900]), t.line(2, 100)] }); assert.equal(up.status, 200, JSON.stringify(up.json));
  const cmp = (await t.call(prep, 'GET', `/dept-budgets/${v2.id}/compare`)).json.data;
  assert.deepEqual([cmp.from.docNo, cmp.totalBefore, cmp.totalAfter, cmp.totalDelta, cmp.changedRows], [b.docNo, '18000.00', '21600.00', '3600.00', 2]);
  const changed = cmp.rows.filter((x) => x.changed).map((x) => [x.code, x.delta]); assert.deepEqual(changed, [[t.accounts[1].code, '2400.00'], [t.accounts[2].code, '1200.00']].sort()); assert.equal(cmp.rows.find((x) => x.code === t.accounts[1].code).months[6].delta, '400.00');
  await t.approve(v2.id);
  assert.deepEqual([(await t.call(prep, 'GET', `/dept-budgets/${b.id}`)).json.data.status, (await t.call(prep, 'GET', `/dept-budgets/${v2.id}`)).json.data.status], ['SUPERSEDED', 'APPROVED']);
  assert.equal(t.d.prepare("SELECT COUNT(*) AS n FROM bud_dept_budgets WHERE status = 'APPROVED'").get().n, 1, 'one version is in force');
  const ev = t.d.prepare("SELECT payload FROM core_outbox WHERE event_type = 'bud.dept_budget.approved' ORDER BY id DESC").get(); assert.match(ev.payload, /previousBudgetId/);
  assert.equal((await t.call(prep, 'GET', `/dept-budgets/${b.id}/compare?with=${v2.id}`)).status, 200); assert.equal((await t.call(prep, 'GET', `/dept-budgets/${b.id}/compare?with=99999`)).status, 404);
  // list, filters, export, print, import
  const list = (await t.call(prep, 'GET', '/dept-budgets')).json; assert.equal(list.data.length, 2);
  const pr = await t.api.call('GET', `${B}/dept-budgets/${v2.id}/print`, prep); assert.equal(pr.status, 200); assert.equal((await t.api.call('GET', `${B}/dept-budgets/${v2.id}/print`, aud)).status, 403, 'the auditor reads but does not print');
  assert.equal((await t.api.call('GET', `${B}/dept-budgets/export?format=csv`, prep)).status, 200); assert.equal((await t.api.call('GET', `${B}/dept-budgets/export?format=csv`, se)).status, 403);
  const imp = await t.call(prep, 'POST', '/dept-budgets/import', { rows: [{ fyId: t.fy.id, costCentreId: t.ccAdm, name: 'Imported', lines: [t.line(0, 300)] }, { fyId: t.fy.id, costCentreId: t.ccProj, lines: [t.line(0, 300)] }] }); assert.equal(imp.status, 201); assert.deepEqual([imp.json.data.created, imp.json.data.errors.length], [1, 1]);
  assert.equal((await t.call(aud, 'POST', '/dept-budgets', { fyId: t.fy.id, costCentreId: t.ccHo, lines: [t.line(0, 1)] })).status, 403); assert.equal((await t.call(aud, 'GET', `/dept-budgets/${v2.id}`)).status, 200);
});

test('actuals from the ledger: events and the ingest endpoint, each source line once; budget against actual by cost centre, account and month (FR-03, AC-01)', async () => {
  const t = await boot(); const rt = runtimeOf(t.d);
  const b = (await t.create(prep, { lines: [t.line(0, 1000), t.line(1, 500)] })).json.data; await t.approve(b.id);
  const rep = async (q = '', who = cfo) => (await t.call(who, 'GET', `/dept-report?fyId=${t.fy.id}${q}`)).json.data;
  let r = await rep(); assert.equal(r.actualsLive, false, 'finance is not live yet'); assert.deepEqual([r.totals.budget, r.totals.actual, r.totals.variance], ['18000.00', '0.00', '18000.00']); assert.equal(r.rows.length, 1);
  const gl = (id, lines, date = '2026-04-10') => ({ action: 'POST', sourceType: 'fin_journal', sourceId: id, docRef: `JV/${id}`, date, lines });
  const l1 = { lineId: '1', costCentreId: t.ccHr, accountId: t.accounts[0].id, amount: 1200, narration: 'April salaries' }; const l2 = { lineId: '2', costCentreId: t.ccHr, accountId: t.accounts[1].id, amount: 300 };
  assert.equal((await t.call(prep, 'POST', '/dept-actuals', gl('J1', [l1, l2]))).status, 403, 'only the system posts what the ledger holds');
  const p1 = await t.call(sys, 'POST', '/dept-actuals', gl('J1', [l1, l2])); assert.equal(p1.status, 201, JSON.stringify(p1.json)); assert.deepEqual(p1.json.data.lines.map((x) => x.action), ['POSTED', 'POSTED']);
  assert.deepEqual((await t.call(sys, 'POST', '/dept-actuals', gl('J1', [l1, l2]))).json.data.lines.map((x) => x.action), ['DUPLICATE', 'DUPLICATE'], 'the same document again changes nothing');
  assert.equal((await t.call(sys, 'POST', '/dept-actuals', gl('J1', [{ ...l1, amount: 1300 }]))).status, 409, 'another amount for a recorded line');
  r = await rep(); assert.equal(r.actualsLive, true); assert.deepEqual([r.totals.budget, r.totals.actual, r.totals.variance, r.totals.usedPct], ['18000.00', '1500.00', '16500.00', 8.3]);
  // by the events of the ledger (part 23), a July salary above the monthly budget, a credit note, a reversal
  const pub = (type, data) => { publishEvent(t.d, { type, entity: 'x', entityId: 1, actorId: 'sys', companyId: 1, data }); for (let i = 0; i < 4; i += 1) rt.bus.drain(); };
  pub('fin.gl.posted', { sourceType: 'fin_journal', sourceId: 'J2', docRef: 'JV/J2', date: '2026-07-15', lines: [{ lineId: '1', costCentreId: t.ccHr, accountId: t.accounts[0].id, amount: 1500 }, { lineId: '2', costCentreId: t.ccHr, accountId: t.accounts[0].id, amount: -100 }] });
  pub('fin.gl.posted', { sourceType: 'fin_journal', sourceId: 'J2', docRef: 'JV/J2', date: '2026-07-15', lines: [{ lineId: '1', costCentreId: t.ccHr, accountId: t.accounts[0].id, amount: 1500 }] });
  const byMonth = (await rep('&by=month')).rows; assert.equal(byMonth.length, 12); const jul = byMonth.find((x) => x.label.startsWith('Jul')); assert.deepEqual([jul.budget, jul.actual, jul.variance, jul.over], ['1500.00', '1400.00', '100.00', false]);
  const apr = byMonth.find((x) => x.label.startsWith('Apr')); assert.deepEqual([apr.budget, apr.actual], ['1500.00', '1500.00']);
  const byAcc = (await rep('&by=account')).rows; const sal = byAcc.find((x) => x.label.startsWith(t.accounts[0].code)); assert.deepEqual([sal.budget, sal.actual, sal.over], ['12000.00', '2600.00', false]);
  pub('fin.gl.reversed', { sourceType: 'fin_journal', sourceId: 'J2' }); assert.equal((await rep()).totals.actual, '1500.00', 'a reversal removes the document');
  pub('fin.gl.reversed', { sourceType: 'fin_journal', sourceId: 'J2' }); assert.equal((await rep()).totals.actual, '1500.00', 'and again changes nothing');
  assert.equal((await t.call(sys, 'POST', '/dept-actuals', { action: 'REVERSE', sourceType: 'fin_journal', sourceId: 'NONE' })).status, 404);
  // up to a month: budget and actual both to that month; spending with no budget is shown
  assert.deepEqual([(await rep('&upTo=3')).totals.budget, (await rep('&upTo=3')).totals.actual], ['4500.00', '1500.00']);
  await t.call(sys, 'POST', '/dept-actuals', gl('J3', [{ lineId: '1', costCentreId: t.ccAdm, accountId: t.accounts[2].id, amount: 777.77 }], '2026-05-02'));
  r = await rep(); const adm = r.rows.find((x) => x.label.startsWith('CC-ADM')); assert.deepEqual([adm.budget, adm.actual, adm.unbudgeted, adm.over], ['0.00', '777.77', true, true]); assert.equal(r.noBudget, 1);
  // drill down to the documents behind a row, the CSV, a period outside the company's years
  const docs = (await t.call(cfo, 'GET', `/dept-report/documents?fyId=${t.fy.id}&costCentreId=${t.ccHr}&accountId=${t.accounts[0].id}`)).json.data; assert.deepEqual([docs.budget.length > 0, docs.actuals.map((x) => x.docRef)], [true, ['JV/J1']]);
  const csv = await t.api.call('GET', `${B}/dept-report/export?fyId=${t.fy.id}`, cfo); assert.equal(csv.status, 200); assert.equal((await t.api.call('GET', `${B}/dept-report/export?fyId=${t.fy.id}`, aud)).status, 403);
  assert.equal((await t.call(sys, 'POST', '/dept-actuals', gl('J9', [l1], '2031-01-01'))).status, 422, 'no financial period covers that date');
  assert.equal((await t.call(sys, 'POST', '/dept-actuals', gl('J9', [{ ...l1, costCentreId: 9999 }]))).status, 400);
  assert.equal((await t.call(se, 'GET', `/dept-report?fyId=${t.fy.id}`)).status, 403); assert.equal((await t.call(other, 'GET', `/dept-report?fyId=${t.fy.id}`)).status, 404, 'the financial year of another company');
  // a formula in a text that reaches an export is neutralised
  t.d.prepare("UPDATE org_cost_centres SET name = '=HYPERLINK(\"http://x\")' WHERE id = ?").run(t.ccHr); const cv = await t.call(cfo, 'GET', `/dept-report/export?fyId=${t.fy.id}`); assert.ok(cv.status === 200);
});

test('the allocation rules: drafted by one person, put in force by another; fixed percentages add up to 100; no two rules take the same money (FR-04)', async () => {
  const t = await boot(); const body = (over = {}) => ({ fyId: t.fy.id, name: 'Admin by direct cost', basis: 'DIRECT_COST', pool: { costCentreIds: [t.ccHr], accountIds: [] }, projectIds: [], fixed: [], reason: 'Share administration by direct cost', ...over });
  assert.equal((await t.call(prep, 'POST', '/alloc-rules', body())).status, 403, 'a department head prepares budgets, not allocation rules');
  assert.equal((await t.call(cfo, 'POST', '/alloc-rules', body())).status, 403, 'the CFO checks, the accounts manager drafts');
  const fx = await t.call(acc, 'POST', '/alloc-rules', body({ name: 'Fixed', basis: 'FIXED_PCT', fixed: [{ projectId: t.p1, pct: 50 }, { projectId: t.p2, pct: 30 }] })); assert.equal(fx.status, 400); assert.match(JSON.stringify(fx.json), /must add up to 100/);
  assert.equal((await t.call(acc, 'POST', '/alloc-rules', body({ basis: 'FIXED_PCT', fixed: [{ projectId: t.p1, pct: 50 }, { projectId: t.p1, pct: 50 }] }))).status, 400, 'a project twice');
  assert.equal((await t.call(acc, 'POST', '/alloc-rules', body({ fixed: [{ projectId: t.p1, pct: 100 }] }))).status, 400, 'percentages belong to the fixed basis');
  assert.equal((await t.call(acc, 'POST', '/alloc-rules', body({ pool: { costCentreIds: [t.ccProj], accountIds: [] } }))).status, 400, 'the cost centre of a project is no pool');
  assert.equal((await t.call(acc, 'POST', '/alloc-rules', body({ projectIds: [9999] }))).status, 400);
  const ok = await t.call(acc, 'POST', '/alloc-rules', body({ name: 'Fixed', basis: 'FIXED_PCT', pool: { costCentreIds: [t.ccHr], accountIds: [t.accounts[0].id] }, fixed: [{ projectId: t.p1, pct: 50 }, { projectId: t.p2, pct: 33.3333 }, { projectId: t.p3, pct: 16.6667 }] })); assert.equal(ok.status, 201, JSON.stringify(ok.json));
  const rule = ok.json.data; assert.deepEqual([rule.status, rule.can.activate, rule.can.edit], ['DRAFT', false, true]);
  const upd = await t.call(acc, 'PATCH', `/alloc-rules/${rule.id}`, { reason: 'Corrected the split', fixed: [{ projectId: t.p1, pct: 40 }, { projectId: t.p2, pct: 30 }] }); assert.equal(upd.status, 400, 'still 70 %');
  assert.equal((await t.call(acc, 'PATCH', `/alloc-rules/${rule.id}`, { fixed: [{ projectId: t.p1, pct: 40 }, { projectId: t.p2, pct: 30 }, { projectId: t.p3, pct: 30 }] })).status, 200);
  assert.equal((await t.call(acc, 'POST', `/alloc-rules/${rule.id}/activate`)).status, 403, 'not the maker'); assert.equal((await t.call(acc2, 'POST', `/alloc-rules/${rule.id}/activate`)).status, 403, 'an accounts manager does not check');
  const on = await t.call(cfo, 'POST', `/alloc-rules/${rule.id}/activate`); assert.equal(on.status, 200); assert.deepEqual([on.json.data.status, on.json.data.approvedBy], ['ACTIVE', 'dcfo1']);
  assert.equal((await t.call(acc, 'PATCH', `/alloc-rules/${rule.id}`, { name: 'Renamed' })).status, 409, 'a rule in force is locked');
  // the same money is not shared twice
  const dup = (await t.call(acc, 'POST', '/alloc-rules', body({ name: 'Overlap', pool: { costCentreIds: [t.ccHr], accountIds: [] } }))).json.data; const clash = await t.call(cfo, 'POST', `/alloc-rules/${dup.id}/activate`); assert.equal(clash.status, 409); assert.match(JSON.stringify(clash.json), /twice/);
  const other2 = (await t.call(acc, 'POST', '/alloc-rules', body({ name: 'Other pool', pool: { costCentreIds: [t.ccAdm], accountIds: [] } }))).json.data; assert.equal((await t.call(cfo, 'POST', `/alloc-rules/${other2.id}/activate`)).status, 200);
  assert.equal((await t.call(acc, 'POST', '/alloc-rules', body({ name: 'Other pool' }))).status, 409, 'a name is used once');
  const list = (await t.call(aud, 'GET', `/alloc-rules?fyId=${t.fy.id}`)).json.data; assert.equal(list.inForce, 2); assert.equal(list.rows.length, 3);
  assert.equal((await t.call(se, 'GET', '/alloc-rules')).status, 403); assert.equal((await t.call(other, 'GET', `/alloc-rules/${rule.id}`)).status, 404);
  const hist = (await t.call(cfo, 'GET', `/alloc-rules/${rule.id}/history`)).json.data; assert.deepEqual(hist.audit.map((x) => x.action), ['create', 'update', 'activate']);
  assert.equal((await t.api.call('GET', `${B}/alloc-rules/export`, cfo)).status, 200);
  const cx = await t.call(cfo, 'POST', `/alloc-rules/${other2.id}/cancel`, { reason: 'Not needed this year' }); assert.equal(cx.status, 200); assert.equal(cx.json.data.status, 'CANCELLED');
  assert.equal((await t.call(acc, 'POST', `/alloc-rules/${dup.id}/cancel`, { reason: 'Overlaps another rule' })).json.data.status, 'CANCELLED');
});

test('an allocation run: preview, post once, the shares equal the pool, reverse, and what part 23.10 reads', async () => {
  const t = await boot(); const rt = runtimeOf(t.d);
  const b = (await t.create(prep, { lines: [t.line(0, 1000.01), t.line(1, 333.33)] })).json.data; await t.approve(b.id);
  const mk = async (over) => { const r = (await t.call(acc, 'POST', '/alloc-rules', { fyId: t.fy.id, name: 'Rule', basis: 'FIXED_PCT', pool: { costCentreIds: [t.ccHr], accountIds: [] }, projectIds: [], fixed: [{ projectId: t.p1, pct: 33.3333 }, { projectId: t.p2, pct: 33.3333 }, { projectId: t.p3, pct: 33.3334 }], reason: 'Share evenly', ...over })).json.data; assert.equal((await t.call(cfo, 'POST', `/alloc-rules/${r.id}/activate`)).status, 200); return r; };
  const rule = await mk({}); const run = { ruleId: rule.id, fromPeriodNo: 1, toPeriodNo: 3, poolSource: 'BUDGET' };
  assert.equal((await t.call(acc, 'POST', '/alloc/runs', run)).status, 201);
  const first = t.d.prepare('SELECT * FROM bud_alloc_runs').get(); assert.equal(first.pool_amount, first.allocated_amount); assert.equal(first.pool_amount, Math.round((1000.01 + 333.33) * 3 * 100));
  const lines = t.d.prepare('SELECT * FROM bud_alloc_lines ORDER BY org_project_id').all(); assert.equal(lines.reduce((x, y) => x + y.amount, 0), first.pool_amount, 'BR-01'); assert.equal(lines.length, 3); const big = lines.reduce((m, l) => (l.basis_value > m.basis_value ? l : m)); assert.ok(big.residual >= 0);
  assert.equal((await t.call(acc, 'POST', '/alloc/runs', run)).status, 409, 'the same pool for the same months is allocated once');
  const detail = (await t.call(cfo, 'GET', `/alloc/runs/${first.id}`)).json.data; assert.deepEqual([detail.status, detail.balanced, detail.pool, detail.lines.length, detail.breakdown.length], ['POSTED', true, R(first.pool_amount), 3, 1]);
  const ev = t.d.prepare("SELECT payload FROM core_outbox WHERE event_type = 'bud.overhead.allocated'").all(); assert.equal(ev.length, 1); const pl = JSON.parse(ev[0].payload); const sum = (pl.data ?? pl).allocations.reduce((s, a) => s + Math.round(Number(a.amount) * 100), 0); assert.equal(sum, first.pool_amount, 'the event carries shares that add up to the pool');
  const pool = (await t.call(cfo, 'GET', `/alloc/pool?projectId=${t.p1}`)).json.data; assert.equal(pool.rows.length, 1); assert.equal(pool.total, pool.rows[0].amount); assert.equal(pool.rows[0].from.startsWith('Apr'), true); assert.equal((await t.call(cfo, 'GET', '/alloc/pool?projectId=999999')).status, 404);
  // a stale preview, a pool of nothing, a rule not in force, no permission
  const rule2 = await mk({ name: 'Admin pool', pool: { costCentreIds: [t.ccAdm], accountIds: [] } });
  assert.equal((await t.call(acc, 'POST', '/alloc/runs', { ...run, ruleId: rule2.id })).status, 422, 'nothing in the pool');
  const pv = await t.call(acc, 'POST', '/alloc/preview', { ...run, toPeriodNo: 12 }); assert.equal(pv.status, 200); assert.equal((await t.call(acc, 'POST', '/alloc/runs', { ...run, toPeriodNo: 12, expectedPool: 1 })).status, 409, 'the pool is not what was previewed');
  assert.equal((await t.call(acc, 'POST', '/alloc/runs', { ...run, toPeriodNo: 12, expectedPool: Number(pv.json.data.pool) })).status, 201);
  assert.equal((await t.call(cfo, 'POST', `/alloc-rules/${rule.id}/cancel`, { reason: 'Rule is wrong' })).status, 422, 'a rule with posted allocations is not withdrawn');
  assert.equal((await t.call(prep, 'POST', '/alloc/runs', run)).status, 403); assert.equal((await t.call(dir, 'POST', '/alloc/runs', { ...run, fromPeriodNo: 2 })).status, 403, 'the director checks rules, does not run them');
  assert.equal((await t.call(acc, 'POST', '/alloc/preview', { ...run, fromPeriodNo: 5, toPeriodNo: 2 })).status, 400);
  // reverse and run again
  assert.equal((await t.call(se, 'POST', `/alloc/runs/${first.id}/reverse`, { reason: 'Wrong months used' })).status, 403);
  const rv = await t.call(acc, 'POST', `/alloc/runs/${first.id}/reverse`, { reason: 'Wrong months used' }); assert.equal(rv.status, 200, JSON.stringify(rv.json)); assert.equal(rv.json.data.status, 'REVERSED');
  assert.equal((await t.call(acc, 'POST', `/alloc/runs/${first.id}/reverse`, { reason: 'Wrong months used' })).status, 422); assert.equal((await t.call(cfo, 'GET', `/alloc/pool?projectId=${t.p1}`)).json.data.rows.length, 1, 'the reversed run is not in the pool');
  assert.equal((await t.call(acc, 'POST', '/alloc/runs', run)).status, 201, 'after a reversal the pool is allocated again'); assert.equal(t.d.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'bud.overhead.allocation_reversed'").get().n, 1);
  assert.ok((await t.call(cfo, 'GET', `/alloc/runs?fyId=${t.fy.id}`)).json.data.rows.length >= 3);
  // by actual cost of the ledger, in proportion to the direct cost posted to the projects
  await rt.bus.drain();
  const act = await t.call(sys, 'POST', '/dept-actuals', { action: 'POST', sourceType: 'fin_journal', sourceId: 'JA', date: '2026-05-05', lines: [{ lineId: '1', costCentreId: t.ccHo, accountId: t.accounts[0].id, amount: 1000 }] }); assert.equal(act.status, 201);
  const rule3 = await mk({ name: 'By direct cost', basis: 'DIRECT_COST', pool: { costCentreIds: [t.ccHo], accountIds: [t.accounts[0].id] }, fixed: [] });
  assert.equal((await t.call(acc, 'POST', '/alloc/preview', { ruleId: rule3.id, fromPeriodNo: 1, toPeriodNo: 12, poolSource: 'ACTUAL' })).status, 422, 'no project has a direct cost yet: the budget of a project is not there either');
  t.d.prepare("INSERT INTO bud_actuals (company_id, org_project_id, doc_ref, amount, actual_date, status, src_type, src_id, project_id, created_by) VALUES (1, ?, 'GRN-1', 7000000, '2026-05-10', 'POSTED', 'inv_grn', 'G1', ?, 't'), (1, ?, 'GRN-2', 3000000, '2026-05-12', 'POSTED', 'inv_grn', 'G2', ?, 't')").run(t.p1, t.p1, t.p2, t.p2);
  const dc = (await t.call(acc, 'POST', '/alloc/preview', { ruleId: rule3.id, fromPeriodNo: 1, toPeriodNo: 12, poolSource: 'ACTUAL' })).json.data; assert.deepEqual([dc.pool, dc.basisSource, dc.lines.map((l) => l.amount)], ['1000.00', 'ACTUAL_DIRECT_COST', ['700.00', '300.00']]);
});

test('roles, department scope, the other company and the flag (AC-03, AC-04)', async () => {
  const t = await boot(); const svc = budOf(t.d);
  const hrB = (await t.create(prep, { costCentreId: t.ccHr })).json.data; const adB = (await t.create(prep, { costCentreId: t.ccAdm })).json.data; const hoB = (await t.create(prep, { costCentreId: t.ccHo })).json.data;
  // a person who prepares for the HR department only (an assignment scoped to the department)
  const uid = Number(t.d.prepare("INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, 'dscoped', 'dscoped', '[]', 'dscoped@example.com')").run().lastInsertRowid);
  t.d.prepare("INSERT INTO iam_assignments (company_id, user_id, role_id, scope_type, scope_ids_json, status, created_by) VALUES (1, ?, (SELECT id FROM iam_roles WHERE code = 'HRMGR'), 'DEPARTMENT', ?, 'ACTIVE', 'test')").run(uid, JSON.stringify([t.hr]));
  const sc = { user: 'dscoped', userId: uid, companyId: 1, roles: [] };
  assert.deepEqual(svc.dept.budgets.list(sc, {}).data.map((x) => x.id), [hrB.id], 'only the budgets of the department');
  assert.equal(svc.dept.budgets.get(sc, hrB.id).costCentreCode, 'CC-HR'); assert.throws(() => svc.dept.budgets.get(sc, adB.id), /does not exist/); assert.throws(() => svc.dept.budgets.get(sc, hoB.id), /does not exist/, 'a cost centre without a department is company-level');
  assert.throws(() => svc.dept.budgets.create(sc, { fyId: t.fy.id, costCentreId: t.ccAdm, lines: [t.line(0, 1)] }), /may not/); assert.throws(() => svc.dept.budgets.update(sc, adB.id, { name: 'Take over' }), /does not exist/);
  assert.deepEqual(svc.dept.budgets.options(sc).costCentres.map((c) => c.code), ['CC-HR']);
  const rep = svc.dept.report(sc, { fyId: t.fy.id, by: 'cost_centre', upTo: 12 }); assert.deepEqual(rep.rows.map((x) => x.label.split(' ')[0]), []);
  // company roles
  assert.equal((await t.call(aud, 'GET', '/dept-budgets')).json.data.length, 3, 'the auditor reads everything'); assert.equal((await t.call(se, 'GET', '/dept-budgets')).status, 403);
  assert.equal((await t.call(other, 'GET', `/dept-budgets/${hrB.id}`)).status, 404, 'another company'); assert.equal((await t.call(other, 'GET', '/dept-budgets')).json.data.length, 0);
  assert.equal((await t.call(as('HRMGR', 'x9', '2'), 'POST', '/dept-budgets', { fyId: t.fy.id, costCentreId: t.ccHr, lines: [] })).status, 400, 'the financial year and cost centre of another company are not found');
  assert.equal((await t.call(prep, 'POST', `/dept-budgets/${hrB.id}/submit`, undefined, { 'content-type': 'application/json' })).status, 400);
  // nothing reaches an approval without the chain: an import, a patch of the status and a direct status change are all refused
  assert.equal((await t.call(prep, 'PATCH', `/dept-budgets/${hrB.id}`, { status: 'APPROVED' })).status, 400); assert.equal(t.d.prepare('SELECT status FROM bud_dept_budgets WHERE id = ?').get(hrB.id).status, 'DRAFT');
  const imp = await t.call(prep, 'POST', '/dept-budgets/import', { rows: [{ fyId: t.fy.id, costCentreId: t.ccHr, lines: [t.line(0, 1)], status: 'APPROVED' }] }); assert.equal(imp.status, 400);
  assert.equal((await t.call(se, 'POST', '/alloc/preview', { ruleId: 1, fromPeriodNo: 1, toPeriodNo: 1 })).status, 403);
  // the flag
  t.d.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.bud.p1204'").run(); assert.equal((await t.call(prep, 'GET', '/dept-budgets')).status, 404, 'flag off'); assert.equal((await t.call(cfo, 'GET', '/alloc-rules')).status, 404); assert.equal((await t.call(pcmOk(), 'GET', '/budgets')).status !== 404, true, 'the project budget is untouched');
  t.d.prepare("UPDATE core_feature_flags SET enabled = 1 WHERE key = 'ff.bud.p1204'").run();
  function pcmOk() { return as('PCMGR', 'bpcm1'); }
  // the tables of the part follow the rules of the schema: no negative budget amount, one version in force, a posted run balances
  assert.throws(() => t.d.prepare('INSERT INTO bud_dept_lines (company_id, budget_id, account_id, period_id, amount) VALUES (1, ?, ?, ?, -1)').run(hrB.id, t.accounts[3].id, t.periods[0].id), /CHECK/);
  assert.throws(() => t.d.prepare("INSERT INTO bud_alloc_runs (company_id, doc_no, fy_id, rule_id, basis, from_period_id, to_period_id, pool_source, pool_amount, allocated_amount) VALUES (1, 'X', ?, 1, 'FIXED_PCT', ?, ?, 'BUDGET', 100, 99)").run(t.fy.id, t.periods[0].id, t.periods[1].id), /CHECK|FOREIGN/);
});

test('the Excel import of 04.13: a workbook of account lines goes into the open draft through the service; approved and waiting budgets are refused; the export has the same shape', async () => {
  const { templateWorkbook } = await import('../src/server/modules/eng/xl-xlsx.js');
  const t = await boot(); const rt = runtimeOf(t.d); const X = '/api/v1/xl';
  const drain = async () => { for (let i = 0; i < 8; i += 1) { rt.bus.drain(); await rt.jobs.drain(); } };
  const type = (await t.api.call('GET', `${X}/templates`, prep)).json.data.types.find((x) => x.code === 'BUD_DEPT_BUDGET'); assert.ok(type, 'the department head may import');
  { const r = await t.api.call('GET', `${X}/templates`, se); assert.equal(r.status === 200 && r.json.data.types.some((x) => x.code === 'BUD_DEPT_BUDGET'), false, 'a site engineer may not'); }
  const tpl = await t.api.raw('GET', `${X}/templates/BUD_DEPT_BUDGET/download`, prep); assert.equal(tpl.status, 200); assert.ok(tpl.buffer.length > 1000);
  // an approved budget of ADM and a draft waiting for approval of HO, so that their rows are refused
  const adm = (await t.create(prep, { costCentreId: t.ccAdm })).json.data; const sub = await t.call(prep, 'POST', `/dept-budgets/${adm.id}/submit`); await t.act(head2, sub.json.data.workflowInstanceId); await t.act(cfo, sub.json.data.workflowInstanceId); await t.act(dir, sub.json.data.workflowInstanceId);
  const ho = (await t.create(prep, { costCentreId: t.ccHo })).json.data; await t.call(prep, 'POST', `/dept-budgets/${ho.id}/submit`);
  const cc = (id) => t.d.prepare('SELECT code FROM org_cost_centres WHERE id = ?').get(id).code; const fy = t.fy.code; const a = (i) => t.accounts[i].code;
  const rows = [
    { fy, costCentre: cc(t.ccHr), account: a(0), m1: '1000', m2: '1000', m12: '2000.50', note: 'Staff' },
    { fy, costCentre: cc(t.ccHr), account: a(1), m1: '300' },
    { fy, costCentre: cc(t.ccAdm), account: a(0), m1: '5' },
    { fy, costCentre: cc(t.ccHo), account: a(0), m1: '5' },
    { fy, costCentre: 'CC-PRJ', account: a(0), m1: '5' },
    { fy, costCentre: cc(t.ccHr), account: a(2), m1: '=SUM(A1)' },
  ];
  const wb = templateWorkbook({ importType: 'BUD_DEPT_BUDGET', version: 0, title: 'BUD_DEPT_BUDGET', columns: type.columns.map((c) => ({ key: c.key, label: c.label, required: c.required, type: c.type })), instructions: ['x'], rowsRaw: true, rows: rows.map((r) => type.columns.map((c) => r[c.key] ?? '')) });
  const up = await t.api.raw('POST', `${X}/jobs?type=BUD_DEPT_BUDGET&fileName=budget.xlsx`, { ...prep, headers: { 'content-type': 'application/octet-stream', 'idempotency-key': `xl-${Math.random().toString(36).slice(2, 10)}` }, body: wb });
  assert.equal(up.status, 202, up.buffer.toString().slice(0, 300)); await drain();
  const errors = (await t.api.call('GET', `${X}/jobs/${up.json.data.id}/errors?limit=50`, prep)).json; const bad = new Set((errors.data.rows ?? errors.data ?? []).map((e) => e.line ?? e.row ?? e.rowNo));
  assert.equal(bad.size, 4, `the approved, the waiting, the project cost centre and the formula: ${JSON.stringify(errors).slice(0, 800)}`);
  const commit = await t.api.call('POST', `${X}/jobs/${up.json.data.id}/commit`, { ...prep, headers: key(), body: { skipInvalid: true } }); assert.ok([200, 202].includes(commit.status), JSON.stringify(commit.json).slice(0, 300)); await drain();
  const job = t.d.prepare('SELECT status, last_error FROM xl_jobs WHERE id = ?').get(up.json.data.id); assert.equal(job.status, 'COMMITTED', job.last_error);
  const hr = t.d.prepare("SELECT * FROM bud_dept_budgets WHERE cost_centre_id = ? AND status = 'DRAFT'").get(t.ccHr); assert.ok(hr, 'a draft was made for HR');
  const v = (await t.call(prep, 'GET', `/dept-budgets/${hr.id}`)).json.data; assert.deepEqual([v.total, v.linesCount, v.status, v.lines[0].note], ['4300.50', 2, 'DRAFT', 'Staff'], 'two accounts, totals by the server, nothing sent for approval');
  // the same file again replaces the accounts, it does not add them twice
  const again = await t.api.raw('POST', `${X}/jobs?type=BUD_DEPT_BUDGET&fileName=budget2.xlsx`, { ...prep, headers: { 'content-type': 'application/octet-stream', 'idempotency-key': `xl-${Math.random().toString(36).slice(2, 10)}` }, body: templateWorkbook({ importType: 'BUD_DEPT_BUDGET', version: 0, title: 'BUD_DEPT_BUDGET', columns: type.columns.map((c) => ({ key: c.key, label: c.label, required: c.required, type: c.type })), instructions: ['x'], rowsRaw: true, rows: [type.columns.map((c) => ({ fy, costCentre: cc(t.ccHr), account: a(1), m1: '700' })[c.key] ?? '')] }) });
  await drain(); await t.api.call('POST', `${X}/jobs/${again.json.data.id}/commit`, { ...prep, headers: key(), body: { skipInvalid: true } }); await drain();
  assert.deepEqual([(await t.call(prep, 'GET', `/dept-budgets/${hr.id}`)).json.data.total, (await t.call(prep, 'GET', `/dept-budgets/${hr.id}`)).json.data.linesCount], ['4700.50', 2]);
  assert.deepEqual([t.d.prepare('SELECT status FROM bud_dept_budgets WHERE id = ?').get(adm.id).status, t.d.prepare('SELECT total_amount FROM bud_dept_budgets WHERE id = ?').get(adm.id).total_amount], ['APPROVED', 1_800_000], 'the approved budget is untouched');
  const ex = await t.api.raw('GET', `${X}/templates/BUD_DEPT_BUDGET/export`, prep); assert.equal(ex.status, 200); assert.equal((await t.api.raw('GET', `${X}/templates/BUD_DEPT_BUDGET/export`, se)).status, 403);
});
