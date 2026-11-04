import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { alertDatasets, matches, isDue, checkRule } from '../src/server/platform/alerts/index.js';
import { tasksOf } from '../src/server/platform/tasks/index.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { workflowOf } from '../src/server/platform/workflow/index.js';
import { setupCompany, startApi } from './helpers.js';

// Part 04.09: the automation and alert rules engine.
// T-01 a scheduled expiry rule raises one alert for each record within the throttle window; T-02 the dry-run shows what the run then does.
const A = '/api/v1/alr';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
const key = (k = 'a') => ({ ...json, 'idempotency-key': `al-${k}-${Math.random().toString(36).slice(2, 10)}` });
const as = (roles, user) => ({ roles, user, company: '1' });
const sys = as('SYSADM', 'sys1');
const pm = as('PM', 'pm1');
const dir = as('DIR', 'dir1');
const emp = as('EMP', 'emp1');
const emp2 = as('EMP', 'emp2');

// a dataset of insurance policies, as the finance module will offer one; the tests change the rows
let policies = [];
alertDatasets.register({
  code: 'test.insurance', label: 'Insurance policies (test)', ownerModule: 'finance', entity: 'policy',
  fields: [{ key: 'policy', label: 'Policy', type: 'text' }, { key: 'daysToExpiry', label: 'Days to expiry', type: 'number' }],
  query: () => policies.map((p) => ({ id: p.id, label: p.policy, route: '/alerts', projectId: p.projectId ?? null, owners: p.owners, fields: { policy: p.policy, daysToExpiry: p.days } })),
});

const user = (api, name, roles) => api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(name, name.toUpperCase(), JSON.stringify(roles), `${name}@example.com`);
const setup = async () => {
  policies = [];
  const api = await startApi();
  await setupCompany(api);
  api.db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (1, 'MAIN', 'Main Infra Pvt Ltd', 'Main', 't', 'test')").run();
  for (const [n, r] of [['pm1', ['PM']], ['dir1', ['DIR']], ['sys1', ['SYSADM']], ['emp1', ['EMP']], ['emp2', ['EMP']], ['pd1', ['PD']]]) user(api, n, r);
  const project = Number(api.db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, 'P1', 'Ring Road', 'ROAD', 'ACTIVE', 't', 'test')").run().lastInsertRowid);
  return { api, project, engine: workflowOf(api.db), runtime: runtimeOf(api.db), core: tasksOf(api.db) };
};
const drain = (runtime) => { for (let i = 0; i < 6; i += 1) runtime.bus.drain(); };
const rule = (over = {}) => ({
  code: 'insurance.expiry', name: 'Insurance expiry', triggerType: 'SCHEDULE', schedule: 'DAILY@06', dataset: 'test.insurance', condition: { all: [{ field: 'daysToExpiry', op: 'lte', value: 30 }] },
  actions: [{ type: 'notify', to: ['owner'] }, { type: 'task', title: 'Renew {{policy}}', assignee: 'owner', dueDays: 14 }], messageTemplate: 'Insurance {{policy}} expires in {{daysToExpiry}} day(s).', throttleMinutes: 1440, severity: 'WARNING',
  ownerModule: 'finance', enabled: true, reason: 'Insurance must not lapse', ...over,
});
const post = (api, who, path, body, k = 'p') => api.call('POST', `${A}${path}`, { ...who, headers: key(k), body });
const alerts = async (api, who, q = '') => (await api.call('GET', `${A}/alerts${q}`, who)).json.data;

test('T-01 FR-01 BR-01 a scheduled expiry rule raises one alert for each record and does not repeat it within the throttle window; after the window it repeats; after a resolution it starts afresh', async () => {
  const { api, engine, core } = await setup();
  policies = [{ id: 'p1', policy: 'CAR-77', days: 12, owners: ['emp1'] }, { id: 'p2', policy: 'WC-12', days: 25, owners: ['emp2'] }, { id: 'p3', policy: 'FIRE-3', days: 200, owners: ['emp1'] }];
  const made = await post(api, pm, '/rules', rule());
  assert.equal(made.status, 201, JSON.stringify(made.json));
  assert.deepEqual([made.json.data.status, made.json.data.version], ['ACTIVE', 1]);
  const first = await post(api, pm, '/rules/insurance.expiry/run', {});
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.deepEqual([first.json.data.matched, first.json.data.created, first.json.data.throttled, first.json.data.errors], [2, 2, 0, 0]);
  let list = await alerts(api, emp);
  assert.equal(list.total, 1, 'each person sees their own alert only');
  assert.match(list.rows[0].message, /CAR-77 expires in 12 day/);
  assert.equal((await alerts(api, emp2)).rows[0].label, 'WC-12');
  assert.ok(api.db.prepare("SELECT 1 FROM ntf_notifications WHERE template_code = 'alr.alert' AND user_ref = 'emp1'").get(), 'the owner is notified');
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM tsk_tasks WHERE origin = 'auto' AND title LIKE 'Renew %'").get().n, 2, 'the task action made a task for each');
  // within the window nothing repeats
  const again = await post(api, pm, '/rules/insurance.expiry/run', {});
  assert.deepEqual([again.json.data.matched, again.json.data.created, again.json.data.throttled], [2, 0, 2]);
  assert.equal(api.db.prepare('SELECT COUNT(*) AS n FROM alr_alerts').get().n, 2);
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM ntf_notifications WHERE template_code = 'alr.alert' AND user_ref = 'emp1'").get().n, 1);
  // after the window an open alert repeats (same alert, counted again, the owner told again; the task is not made twice)
  const base = Date.parse(`${core.today()}T06:00:00.000Z`);
  engine.setClock(() => new Date(base + 2 * 86_400_000));
  const later = await post(api, pm, '/rules/insurance.expiry/run', {});
  assert.deepEqual([later.json.data.created, later.json.data.repeated, later.json.data.throttled], [0, 2, 0]);
  assert.equal(api.db.prepare('SELECT occurrences FROM alr_alerts WHERE entity_id = ?').get('p1').occurrences, 2);
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM tsk_tasks WHERE origin = 'auto' AND title LIKE 'Renew %'").get().n, 2);
  // resolved: the next time is a new alert
  const id = (await alerts(api, emp)).rows[0].id;
  assert.equal((await post(api, emp, `/alerts/${id}/resolve`, { note: 'Renewed' })).json.data.status, 'RESOLVED');
  engine.setClock(() => new Date(base + 4 * 86_400_000));
  const fresh = await post(api, pm, '/rules/insurance.expiry/run', {});
  assert.deepEqual([fresh.json.data.created, fresh.json.data.repeated], [1, 1]);
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM alr_alerts WHERE entity_id = 'p1'").get().n, 2);
  // the run log
  const runs = (await api.call('GET', `${A}/runs?code=insurance.expiry`, sys)).json.data;
  assert.equal(runs.total, 4);
  assert.deepEqual(runs.rows.map((r) => r.created), [1, 0, 0, 2]);
  assert.ok(runs.rows.every((r) => r.errors === 0 && r.trigger === 'manual'));
  await api.close();
});

test('T-02 FR-05 the dry-run shows exactly what the run then does, and writes nothing', async () => {
  const { api } = await setup();
  policies = [{ id: 'p1', policy: 'CAR-77', days: 12, owners: ['emp1'] }, { id: 'p2', policy: 'WC-12', days: 25, owners: ['emp2'] }, { id: 'p3', policy: 'FIRE-3', days: 200, owners: ['emp1'] }];
  await post(api, pm, '/rules', rule());
  const dry = await post(api, pm, '/rules/insurance.expiry/dry-run', {}, 'd');
  assert.equal(dry.status, 200, JSON.stringify(dry.json));
  const d = dry.json.data;
  assert.deepEqual([d.looked, d.matched, d.wouldCreate, d.throttled], [3, 2, 2, 0]);
  assert.deepEqual(d.items.map((i) => i.entityId).sort(), ['p1', 'p2']);
  assert.match(d.items[0].actions.join(' '), /tell emp1/);
  assert.match(d.items[0].actions.join(' '), /make the task "Renew CAR-77" for emp1/);
  assert.equal(api.db.prepare('SELECT COUNT(*) AS n FROM alr_alerts').get().n, 0, 'nothing was written');
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM tsk_tasks WHERE origin = 'auto'").get().n, 0);
  const run = (await post(api, pm, '/rules/insurance.expiry/run', {})).json.data;
  assert.deepEqual([run.matched, run.created], [d.matched, d.wouldCreate]);
  assert.deepEqual(api.db.prepare('SELECT entity_id FROM alr_alerts ORDER BY entity_id').all().map((r) => r.entity_id), d.items.map((i) => i.entityId).sort());
  // with the alerts in place the dry-run says they would be throttled
  const second = (await post(api, pm, '/rules/insurance.expiry/dry-run', {}, 'd2')).json.data;
  assert.deepEqual([second.wouldCreate, second.throttled], [0, 2]);
  const run2 = (await post(api, pm, '/rules/insurance.expiry/run', {})).json.data;
  assert.deepEqual([run2.created, run2.throttled], [0, 2]);
  // a draft from the builder is tried before it is saved
  const draft = rule({ code: 'insurance.soon', condition: { all: [{ field: 'daysToExpiry', op: 'lte', value: 15 }] } });
  delete draft.reason;
  const preview = await post(api, pm, '/rules/dry-run', draft, 'd3');
  assert.equal(preview.status, 200, JSON.stringify(preview.json));
  assert.deepEqual(preview.json.data.items.map((i) => i.entityId), ['p1']);
  assert.equal((await post(api, pm, '/rules/dry-run', { ...draft, condition: { all: [{ field: 'nothing', op: 'eq', value: 1 }] } }, 'd4')).status, 400);
  await api.close();
});

test('BR-02 FR-06 a rule switched off keeps its alerts and stops running; an error is counted in the run log', async () => {
  const { api } = await setup();
  policies = [{ id: 'p1', policy: 'CAR-77', days: 12, owners: ['emp1'] }];
  await post(api, pm, '/rules', rule());
  await post(api, pm, '/rules/insurance.expiry/run', {});
  assert.equal((await post(api, pm, '/rules/insurance.expiry/enabled', { enabled: false, reason: 'Paused for the audit' }, 'e')).json.data.active.enabled, false);
  assert.equal((await alerts(api, emp)).total, 1, 'the alert stays');
  assert.equal((await post(api, pm, '/rules/insurance.expiry/run', {})).status, 422, 'a rule that is off does not run');
  assert.ok(api.db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'alr_rules' AND action = 'disable'").get());
  assert.equal((await post(api, pm, '/rules/insurance.expiry/enabled', { enabled: true }, 'e')).json.data.active.enabled, true);
  // an error in a dataset is counted and does not stop the engine
  const bad = alertDatasets.get('test.insurance').query;
  alertDatasets.get('test.insurance').query = () => { throw new Error('The finance module is not answering'); };
  const out = (await post(api, pm, '/rules/insurance.expiry/run', {})).json.data;
  assert.equal(out.errors, 1);
  assert.match(out.error, /not answering/);
  alertDatasets.get('test.insurance').query = bad;
  const runs = (await api.call('GET', `${A}/runs?onlyErrors=1`, sys)).json.data;
  assert.equal(runs.total, 1);
  await api.close();
});

test('FR-02 the library: the standard rules are there; a company adopts one when its module is live; one that waits for a module cannot be switched on', async () => {
  const { api, core, project } = await setup();
  const lib = (await api.call('GET', `${A}/rules`, sys)).json.data;
  assert.ok(lib.library.length >= 17);
  const codes = lib.library.map((r) => r.code);
  for (const c of ['approval.overdue', 'doc.expiry', 'bg.expiry', 'insurance.expiry', 'licence.expiry', 'stock.below_reorder', 'payment.due', 'payment.overdue', 'receivable.overdue', 'task.overdue', 'claim.notice_deadline', 'budget.variance', 'ncr.overdue', 'incident.reported', 'equipment.certificate_expiry', 'attendance.anomaly', 'dpr.not_submitted']) assert.ok(codes.includes(c), c);
  assert.equal(lib.library.find((r) => r.code === 'task.overdue').ready, true);
  assert.equal(lib.library.find((r) => r.code === 'stock.below_reorder').awaiting, 'stores');
  // three that can work on today's data
  for (const code of ['task.overdue', 'approval.overdue', 'exception.regularise_due']) {
    const r = await post(api, pm, `/rules/library/${code}/adopt`, { reason: 'Use the standard rule' }, 'ad');
    assert.equal(r.status, 201, JSON.stringify(r.json));
  }
  assert.equal((await post(api, pm, '/rules/library/task.overdue/adopt', { reason: 'Again please' }, 'ad')).status, 409);
  // a rule for a module not live is adopted but off, and cannot be switched on
  const waiting = await post(api, pm, '/rules/library/stock.below_reorder/adopt', { reason: 'For when stores is live' }, 'ad');
  assert.equal(waiting.status, 201);
  assert.equal((await api.call('GET', `${A}/rules/stock.below_reorder`, pm)).json.data.active.enabled, false);
  const on = await post(api, pm, '/rules/stock.below_reorder/enabled', { enabled: true }, 'e');
  assert.equal(on.status, 400);
  assert.match(on.json.error.message, /not live|no module offers/);
  // the standard task rule on sample data: two tasks, one late
  core.create({ companyId: 1, title: 'Late formwork check', assignees: ['emp1'], assigner: 'pd1', actor: 'pd1', dueDate: '2020-01-01', projectId: project, notify: false });
  core.create({ companyId: 1, title: 'Future check', assignees: ['emp1'], assigner: 'pd1', actor: 'pd1', dueDate: '2099-01-01', notify: false });
  const run = (await post(api, pm, '/rules/task.overdue/run', {})).json.data;
  assert.deepEqual([run.matched, run.created], [1, 1]);
  const mine = await alerts(api, emp);
  assert.match(mine.rows[0].message, /Late formwork check is \d+ day\(s\) late/);
  assert.equal(mine.rows[0].route, '/tasks/task?id=1');
  assert.equal(mine.rows[0].projectId, project);
  await api.close();
});

test('FR-01 an event rule: an event of the bus raises an alert when its data matches the conditions', async () => {
  const { api, runtime, core } = await setup();
  const made = await post(api, pm, '/rules', { code: 'task.blocked', name: 'Task blocked', triggerType: 'EVENT', eventType: 'tsk.task.blocked', condition: { all: [{ field: 'reason', op: 'contains', value: 'rain' }] }, actions: [{ type: 'notify', to: ['role:PM'] }, { type: 'flag', flag: 'needs_attention' }], messageTemplate: '{{taskNo}} is blocked: {{reason}}', throttleMinutes: 60, severity: 'CRITICAL', ownerModule: 'tasks', enabled: true, reason: 'Blocked work is a risk' });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  drain(runtime);
  const t = core.create({ companyId: 1, title: 'Pour the slab', assignees: ['emp1'], assigner: 'pm1', actor: 'pm1', dueDate: '2099-01-01', notify: false });
  core.act('emp1', t.id, 'start');
  core.act('emp1', t.id, 'block', { reason: 'Heavy rain on site' });
  drain(runtime);
  const list = await alerts(api, pm);
  assert.equal(list.total, 1);
  assert.equal(list.rows[0].severity, 'CRITICAL');
  assert.match(list.rows[0].message, /is blocked: Heavy rain on site/);
  const u = core.create({ companyId: 1, title: 'Fix the gate', assignees: ['emp1'], assigner: 'pm1', actor: 'pm1', dueDate: '2099-01-01', notify: false });
  core.act('emp1', u.id, 'block', { reason: 'Waiting for the welder' });
  drain(runtime);
  assert.equal((await alerts(api, pm)).total, 1, 'the other reason does not match');
  assert.ok(api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'alr.flag.set'").get(), 'the flag action published its event');
  // the dry-run of an event rule looks at the recent events
  const dry = (await post(api, pm, '/rules/task.blocked/dry-run', {}, 'd')).json.data;
  assert.deepEqual([dry.matched, dry.throttled], [1, 1]);
  await api.close();
});

test('AC-04 a rule that sends something outside waits for the process owner and the system administrator, and does not run before; the creator cannot approve it', async () => {
  const { api, core } = await setup();
  api.db.prepare("INSERT INTO core_connectors (company_id, code, name, type, provider, status, config_json, created_by, source_type) VALUES (1, 'hook.ops', 'Ops hook', 'email', 'sandbox', 'ENABLED', '{}', 't', 't')").run();
  policies = [{ id: 'p1', policy: 'CAR-77', days: 12, owners: ['emp1'] }];
  const body = rule({ code: 'insurance.external', actions: [{ type: 'notify', to: ['owner'], channels: ['SMS'] }, { type: 'webhook', connector: 'hook.ops', path: '/alerts' }] });
  assert.equal((await post(api, pm, '/rules', { ...body, actions: [{ type: 'webhook', connector: 'nothing', path: '/x' }] })).status, 400, 'the connector must exist');
  const r = await post(api, pm, '/rules', body);
  assert.equal(r.status, 202, JSON.stringify(r.json));
  assert.deepEqual([r.json.data.status, r.json.data.workflow.status !== undefined], ['PENDING', true]);
  assert.equal((await post(api, pm, '/rules', body)).status, 409, 'one change at a time');
  const view = (await api.call('GET', `${A}/rules/insurance.external`, pm)).json.data;
  assert.equal(view.active, null);
  assert.equal(view.pending.external, true);
  assert.equal((await post(api, pm, '/rules/insurance.external/run', {})).status, 404, 'a rule waiting for approval does not run');
  // the creator cannot approve; the process owner, then the system administrator do
  const mine = (await api.call('GET', `${W}/tasks?mine=assigned`, pm)).json.data.rows.find((t) => JSON.stringify(t).includes('ALR_RULE'));
  assert.equal(mine, undefined, 'the creator has no task');
  const t1 = (await api.call('GET', `${W}/tasks?mine=assigned`, dir)).json.data.rows.find((t) => JSON.stringify(t).includes('ALR_RULE'));
  assert.ok(t1, 'the process owner has the first step');
  assert.equal((await api.call('POST', `${W}/tasks/${t1.id}/act`, { ...dir, headers: key('a'), body: { action: 'approve', comment: 'ok' } })).status, 200);
  const t2 = (await api.call('GET', `${W}/tasks?mine=assigned`, sys)).json.data.rows.find((t) => JSON.stringify(t).includes('ALR_RULE'));
  assert.ok(t2, 'the system administrator has the second');
  assert.equal((await api.call('POST', `${W}/tasks/${t2.id}/act`, { ...sys, headers: key('a'), body: { action: 'approve', comment: 'ok' } })).status, 200);
  assert.equal((await api.call('GET', `${A}/rules/insurance.external`, pm)).json.data.active.version, 1);
  const out = (await post(api, pm, '/rules/insurance.external/run', {})).json.data;
  assert.equal(out.created, 1);
  assert.ok(api.db.prepare("SELECT 1 FROM core_jobs WHERE type = 'alr.webhook' AND status = 'QUEUED'").get() ?? api.db.prepare("SELECT 1 FROM core_jobs WHERE type = 'alr.webhook'").get(), 'the webhook is a job');
  void core;
  await api.close();
});

test('FR-03 FR-04 AC-03 the alert centre: my alerts and the project alerts, critical first; acknowledge and resolve by those it concerns; a stranger sees nothing; permissions of the rules', async () => {
  const { api, project } = await setup();
  policies = [{ id: 'p1', policy: 'CAR-77', days: 12, owners: ['emp1'], projectId: project }, { id: 'p2', policy: 'WC-12', days: 5, owners: ['emp2'] }];
  await post(api, pm, '/rules', rule());
  await post(api, pm, '/rules', rule({ code: 'insurance.critical', name: 'Insurance critical', condition: { all: [{ field: 'daysToExpiry', op: 'lte', value: 7 }] }, severity: 'CRITICAL', actions: [{ type: 'notify', to: ['owner'] }] }));
  await post(api, pm, '/rules/insurance.expiry/run', {});
  await post(api, pm, '/rules/insurance.critical/run', {});
  const mine = await alerts(api, emp2);
  assert.deepEqual(mine.rows.map((a) => a.severity), ['CRITICAL', 'WARNING'], 'critical first');
  const first = mine.rows[0];
  assert.equal((await api.call('GET', `${A}/alerts/${first.id}`, emp)).status, 404, 'another person does not see it');
  assert.equal((await post(api, emp, `/alerts/${first.id}/ack`, {})).status, 404);
  const ack = await post(api, emp2, `/alerts/${first.id}/ack`, {});
  assert.deepEqual([ack.json.data.status, ack.json.data.acknowledgedBy], ['ACKNOWLEDGED', 'emp2']);
  assert.equal((await post(api, emp2, `/alerts/${first.id}/ack`, {})).status, 409);
  assert.equal((await post(api, emp2, `/alerts/${first.id}/resolve`, {})).status, 400, 'a resolution needs words');
  assert.equal((await post(api, emp2, `/alerts/${first.id}/resolve`, { note: 'Renewed until 2027' })).json.data.status, 'RESOLVED');
  assert.equal((await post(api, emp2, `/alerts/${first.id}/resolve`, { note: 'Again' })).status, 409);
  // the project alerts: those who manage the project see them, those who do not, do not
  const proj = await alerts(api, pm, '?view=project');
  assert.ok(proj.total >= 1);
  assert.equal((await api.call('GET', `${A}/alerts?view=project`, emp)).status, 403);
  const bulk = await post(api, pm, '/alerts/bulk', { ids: proj.rows.map((a) => a.id), action: 'ack' }, 'b');
  assert.equal(bulk.status, 200);
  assert.ok(bulk.json.data.done.length >= 1);
  const sum = (await api.call('GET', `${A}/alerts/summary`, emp)).json.data;
  assert.deepEqual([sum.mine, sum.canViewProject], [1, false]);
  assert.equal((await api.call('GET', `${A}/alerts/export?format=csv`, emp)).status, 200);
  // the rules: who may see, who may change
  for (const [who, rulesStatus, edit] of [[sys, 200, 201], [pm, 200, 201], [as('ITADM', 'it1'), 200, 403], [emp, 403, 403], [{ user: null }, 401, 401]]) {
    assert.equal((await api.call('GET', `${A}/rules`, who)).status, rulesStatus, `view ${who.roles}`);
    assert.equal((await api.call('POST', `${A}/rules`, { ...who, headers: key('x'), body: rule({ code: `x.${who.user ?? 'anon'}` }) })).status, edit, `edit ${who.roles}`);
  }
  assert.equal((await api.call('POST', `${A}/rules`, { ...pm, body: rule({ code: 'x.nokey' }) })).status, 400, 'Idempotency-Key is required');
  assert.equal((await post(api, pm, '/rules', rule({ code: 'bad.rule', actions: [{ type: 'task', assignee: 'owner' }] }))).status, 400);
  assert.equal((await post(api, pm, '/rules', rule({ code: 'bad.dataset', dataset: 'nothing.here' }))).status, 400);
  // a change is a new version; a stale version is refused
  const v2 = await post(api, pm, '/rules', rule({ throttleMinutes: 60, version: 1, reason: 'Repeat sooner' }));
  assert.equal(v2.status, 201, JSON.stringify(v2.json));
  assert.equal(v2.json.data.version, 2);
  assert.equal((await post(api, pm, '/rules', rule({ throttleMinutes: 30, version: 1, reason: 'Stale edit' }))).status, 409);
  assert.deepEqual((await api.call('GET', `${A}/rules/insurance.expiry`, sys)).json.data.versions.map((v) => [v.version, v.status]), [[2, 'ACTIVE'], [1, 'RETIRED']]);
  await api.close();
});

test('units: conditions, schedules and rule checks', () => {
  assert.equal(matches({ all: [{ field: 'd', op: 'gte', value: 3 }, { field: 's', op: 'in', value: ['a', 'b'] }] }, { d: 5, s: 'b' }), true);
  assert.equal(matches({ all: [{ field: 'd', op: 'gte', value: 3 }] }, { d: 2 }), false);
  assert.equal(matches({ any: [{ field: 'x', op: 'eq', value: 1 }, { field: 'y', op: 'contains', value: 'rain' }] }, { x: 0, y: 'Heavy RAIN' }), true);
  assert.equal(matches({ all: [{ field: 'e', op: 'empty' }] }, { e: '' }), true);
  assert.equal(matches({ all: [{ field: 'dueDate', op: 'lt', value: '2026-11-03' }] }, { dueDate: '2026-10-01' }), true, 'dates compare as text');
  assert.equal(matches({}, {}), true);
  const at = (h) => new Date(`2026-11-03T${String(h).padStart(2, '0')}:00:00.000Z`); // 5.5 hours later in India
  assert.equal(isDue('HOURLY', null, at(3)), true);
  assert.equal(isDue('HOURLY', at(3).toISOString(), new Date(at(3).getTime() + 30 * 60_000)), false);
  assert.equal(isDue('DAILY@07', null, at(0)), false, 'it is 05:30 in India');
  assert.equal(isDue('DAILY@07', null, at(2)), true, 'it is 07:30');
  assert.equal(isDue('DAILY@07', at(2).toISOString(), at(4)), false, 'once a day');
  assert.ok(checkRule({ triggerType: 'SCHEDULE', schedule: 'EVERY5', dataset: 'x', actions: [], severity: 'LOW', messageTemplate: '' }).length >= 4);
});
