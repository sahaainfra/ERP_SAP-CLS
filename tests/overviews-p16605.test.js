import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { memoryDb, setupCompany, startApi } from './helpers.js';
import { OVERVIEWS, HOME, STANDALONE, allCards, homeLayout } from '../src/server/modules/ui/overviews.js';

// Part 166.5: Home insight cards and the module dashboards as overview pages (ff.ui.p16605, ON in test).
//  - the rows of ui_widgets / ui_dashboards and the card definitions in code agree (the migration is written from them);
//  - T-01 every card shows what the old page's service gives for the same person and filters (the card is a slice of that answer);
//  - T-02 the to-do card's approve goes through the workflow engine and the list behind the card has the card's count;
//  - FR-03 Home shows the cards of the person's role; AC-03 a card is refused to a role that may not see its page.
const opened = [];
after(async () => { for (const a of opened) await a.close(); });
const as = (roles, user, company = '1') => ({ roles, user, company });
const json = { 'content-type': 'application/json' };
const key = (k) => ({ ...json, 'idempotency-key': `ov-${k}-${Math.random().toString(36).slice(2, 10)}` });

test('the seed and the code agree: every card has its widget row (type, size, permission, drill) and every overview a system layout of its cards', () => {
  const db = memoryDb();
  const rows = new Map(db.prepare("SELECT * FROM ui_widgets WHERE code LIKE 'ov.%'").all().map((r) => [r.code, r]));
  const cards = allCards();
  assert.equal(rows.size, cards.length, 'one row per card');
  for (const c of cards) {
    const r = rows.get(c.code);
    assert.ok(r, `${c.code} has a row`);
    assert.equal(r.type, c.type, c.code);
    assert.deepEqual([r.default_w, r.default_h], [c.w, c.h], c.code);
    assert.equal(r.permission_key, c.overview ? c.overview.permission : c.permission, c.code);
    assert.equal(r.drill_route, c.drill, c.code);
  }
  for (const o of [...OVERVIEWS, { code: 'home-insights', cards: STANDALONE }]) {
    const d = db.prepare("SELECT * FROM ui_dashboards WHERE code = ? AND owner_type = 'system'").get(o.code);
    assert.ok(d, `${o.code} has a system layout`);
    assert.deepEqual(JSON.parse(d.layout_json).map((i) => i.widget), o.cards.map((c) => c.code));
  }
  // the CHECK of the type takes the new kinds and still refuses an unknown one
  assert.throws(() => db.prepare("INSERT INTO ui_widgets (code, module, title, type, data_endpoint, permission_key) VALUES ('x.y', 'ui', 'X', 'pie3d', '/x', 'self')").run(), /CHECK/);
  // every card of Home's role layouts exists, KPIs take a quarter of the row and lists half
  for (const [role, codes] of Object.entries(HOME.roles)) {
    const l = homeLayout(codes);
    assert.equal(l.length, codes.length, role);
    for (const i of l) assert.ok(rows.has(i.widget) || db.prepare('SELECT 1 FROM ui_widgets WHERE code = ?').get(i.widget), `${role}: ${i.widget}`);
  }
});

/** The page's service answer for a person, through its own endpoint (what the old page shows). */
const OLD = {
  'ov-qs': ['/api/v1/bill/qs-dashboard', 'DIR'], 'ov-tower': ['/api/v1/bill/control-tower', 'DIR'], 'ov-stores': ['/api/v1/inv/dashboard', 'PM'],
  'ov-hse': ['/api/v1/hse/dashboard', 'DIR'], 'ov-qa': ['/api/v1/qa/dashboard', 'DIR'], 'ov-proc': ['/api/v1/proc/analytics/dashboard', 'DIR'],
  'ov-plant': ['/api/v1/plant/dashboard', 'PLANTMGR'], 'ov-hr': ['/api/v1/hr/employees/overview', 'HRMGR'], 'ov-budget': [null, 'DIR'],
};
/** What a card draws: its figures, without the time it was read, its address and its source (checked on their own). */
const drawn = (d) => Object.fromEntries(Object.entries(d ?? {}).filter(([k]) => !['asOf', 'drill', 'source'].includes(k)));
const strip = (d) => Object.fromEntries(Object.entries(d ?? {}).filter(([k]) => k !== 'asOf'));

async function sameAsOld(api, o, who, filters = {}, oldQuery = '') {
  const [path] = OLD[o.code];
  const old = path ? await api.call('GET', `${path}${oldQuery}`, who) : null;
  if (old) assert.equal(old.status, 200, `${o.code}: ${JSON.stringify(old.json)}`);
  for (const c of o.cards) {
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString();
    const card = await api.call('GET', `/api/v1/ui/widgets/${c.code}/data${qs ? `?${qs}` : ''}`, who);
    assert.equal(card.status, 200, `${c.code}: ${JSON.stringify(card.json)}`);
    const expected = c.map(old ? old.json.data : null, { filters });
    const got = strip(card.json.data.data);
    assert.equal(got.source, o.source, `${c.code} names its source`);
    // the card is the old answer's figures: compare what the card draws
    assert.deepEqual(drawn(got), JSON.parse(JSON.stringify(drawn(expected))), `${c.code} shows the figures of ${path ?? o.code}`);
  }
}

test('T-01 every card of every overview page shows the figures of the service the old page reads, for the same person and filters', async () => {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  // the same period for both: the framework's filter bar starts at this financial year, the HSE and quality pages at the last twelve months
  const period = { from: '2026-04-01', to: '2027-03-31' };
  for (const o of OVERVIEWS) {
    const [, role] = OLD[o.code];
    const takesPeriod = ['ov-hse', 'ov-qa', 'ov-proc', 'ov-hr'].includes(o.code);
    await sameAsOld(api, o, as(role, `ov-${role.toLowerCase()}`), takesPeriod ? period : {}, takesPeriod ? `?from=${period.from}&to=${period.to}` : '');
  }
  // the budget ledger is read for one project: with the project chosen the cards are the ledger's figures
  const project = api.db.prepare('SELECT id FROM org_projects WHERE company_id = 1 ORDER BY id LIMIT 1').get();
  if (project) {
    const budget = OVERVIEWS.find((o) => o.code === 'ov-budget');
    const old = await api.call('GET', `/api/v1/bud/ledger?projectId=${project.id}`, as('DIR', 'ov-dir'));
    if (old.status === 200) {
      for (const c of budget.cards) {
        const card = await api.call('GET', `/api/v1/ui/widgets/${c.code}/data?projectId=${project.id}`, as('DIR', 'ov-dir'));
        assert.equal(card.status, 200, JSON.stringify(card.json));
        assert.deepEqual(drawn(card.json.data.data), JSON.parse(JSON.stringify(drawn(c.map(old.json.data, { filters: { projectId: project.id } })))), c.code);
      }
    }
  }
});

test('T-01 T-02 HR with people: the cards follow the overview; the to-do card lists the approval for the second HR manager only, approving it from the card moves the headcount', async () => {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  for (const [n, r] of [['ovhr1', ['HRMGR']], ['ovhr2', ['HRMGR']]]) api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, `${n.toUpperCase()} Person`, JSON.stringify(r), `${n}@example.test`);
  const dept = Number(api.db.prepare("INSERT INTO org_departments (company_id, code, name, created_by, source_type) VALUES (1, 'OVD', 'Overview Department', 't', 'test')").run().lastInsertRowid);
  const desig = Number(api.db.prepare("INSERT INTO org_designations (company_id, code, name, grade, level, created_by, source_type) VALUES (1, 'OVE', 'Overview Engineer', 'G3', 3, 't', 'test')").run().lastInsertRowid);
  const hr1 = as('HRMGR', 'ovhr1');
  const hr2 = as('HRMGR', 'ovhr2');
  const person = (i) => ({
    firstName: 'Test', lastName: `Person ${i}`, gender: 'MALE', dob: '1990-01-01', mobile: `90000000${String(i).padStart(2, '0')}`, email: `test.person.${i}@example.test`,
    permanentAddress: { line: '1 Test Street', city: 'Pune', stateCode: 'MH', pin: '411001' }, currentAddress: null,
    departmentId: dept, designationId: desig, employmentType: 'PERMANENT', doj: '2026-04-01', locationType: 'HO', salaryPaymentMode: 'BANK_TRANSFER',
    contacts: [{ type: 'EMERGENCY', name: 'Test Contact', relation: 'Spouse', phone: '9000000099' }],
    statutory: { pan: `AAAPT${String(1000 + i)}A`, aadhaar: null, uan: null, esicIp: null, pfApplicable: false, esiApplicable: false, ptState: 'MH', lwfState: 'MH' },
    bank: { accountNo: `00001111222${i}`, ifsc: 'TEST0000001', accountName: `Test Person ${i}` },
  });
  const made = [];
  for (const i of [1, 2]) {
    const r = await api.call('POST', '/api/v1/hr/employees', { ...hr1, headers: key(`e${i}`), body: { ...person(i), submit: true } });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    made.push(r.json.data);
  }
  const hrOv = OVERVIEWS.find((o) => o.code === 'ov-hr');
  const per = { from: '2026-04-01', to: '2027-03-31' };
  const perQ = `?from=${per.from}&to=${per.to}`;
  await sameAsOld(api, hrOv, hr2, per, perQ);
  const pending = (await api.call('GET', '/api/v1/ui/widgets/ov.hr.pending/data', hr2)).json.data.data;
  assert.ok(pending.value >= 2, `two employees wait for approval: ${JSON.stringify(pending)}`);
  const head0 = (await api.call('GET', '/api/v1/ui/widgets/ov.hr.headcount/data', hr2)).json.data.data.value;

  // the to-do card: the second HR manager has the two approvals, the person who entered them has none of them (the maker never approves)
  const todo2 = (await api.call('GET', '/api/v1/ui/widgets/ov.todo.mine/data', hr2)).json.data.data;
  assert.ok(todo2.rows.length >= 2, JSON.stringify(todo2));
  assert.equal(todo2.source, 'My open approvals and tasks');
  const todo1 = (await api.call('GET', '/api/v1/ui/widgets/ov.todo.mine/data', hr1)).json.data.data;
  const mine = new Set(todo2.rows.map((r) => r.taskId));
  assert.ok(todo1.rows.every((r) => !mine.has(r.taskId)), 'the maker does not see them');
  // T-02: the list behind the card ("View all" opens the inbox) has the card's count
  const inbox = (await api.call('GET', '/api/v1/workflow/tasks?mine=assigned', hr2)).json.data;
  assert.equal(inbox.total, todo2.total);
  // the maker cannot approve from the card either: the server refuses
  const refused = await api.call('POST', `/api/v1/workflow/tasks/${todo2.rows[0].taskId}/act`, { ...hr1, headers: key('x'), body: { action: 'approve' } });
  assert.ok([403, 409, 422].includes(refused.status), `the maker is refused: ${refused.status}`);
  // approve from the card as the checker: the same call the card makes
  const ok = await api.call('POST', `/api/v1/workflow/tasks/${todo2.rows[0].taskId}/act`, { ...hr2, headers: key('a'), body: { action: 'approve', comment: 'checked from the card' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const head1 = (await api.call('GET', '/api/v1/ui/widgets/ov.hr.headcount/data', hr2)).json.data.data.value;
  assert.equal(head1, head0 + 1, 'the headcount card moves with the approval');
  await sameAsOld(api, hrOv, hr2, per, perQ);
});

test('FR-03 Home insights: each role starts from its own cards, a role without a layout sees its approvals; AC-03 a card is refused to a role that may not see its page', async () => {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  const layoutOf = async (role, user = `home-${role.toLowerCase()}`) => {
    const r = await api.call('GET', '/api/v1/ui/dashboards/home-insights', as(role, user));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json.data;
  };
  for (const role of ['PM', 'QS', 'SK', 'HRMGR', 'DIR']) {
    const d = await layoutOf(role);
    assert.equal(d.source, 'role', role);
    assert.equal(d.roleCode, role);
    assert.deepEqual(d.layout.map((i) => i.widget), HOME.roles[role].filter((c) => d.layout.some((i) => i.widget === c)), `${role}: the role's cards in order`);
    assert.ok(d.layout.length >= 3, `${role} has insight cards: ${d.layout.map((i) => i.widget)}`);
    assert.equal(d.layout[0].widget, 'ov.todo.mine');
  }
  const se = await layoutOf('SE');
  assert.equal(se.source, 'system');
  assert.deepEqual(se.layout.map((i) => i.widget), ['ov.todo.mine', 'ov.feed.notifications'], 'no figures without a role layout, never invented ones');
  // the server, not the page, decides: a site engineer may not read the QS or HR cards
  for (const code of ['ov.qs.unbilled_wip', 'ov.hr.headcount', 'ov.tower.margin', 'ov.stores.value']) {
    const r = await api.call('GET', `/api/v1/ui/widgets/${code}/data`, as('SE', 'home-se'));
    assert.equal(r.status, 403, `${code}: ${r.status}`);
  }
  // a person may save their own Home layout; the role layout comes back after a reset
  const pm = as('PM', 'home-pm-own');
  const mineLayout = [{ id: 'h1', widget: 'ov.todo.mine', w: 12, h: 2 }, { id: 'h2', widget: 'ov.qs.unbilled_wip', w: 6, h: 1 }];
  const saved = await api.call('PUT', '/api/v1/ui/dashboards/home-insights/personal', { ...pm, headers: key('p'), body: { layout: mineLayout, filters: {} } });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal((await layoutOf('PM', 'home-pm-other')).source, 'role', 'another PM still has the role layout');
  const own = (await api.call('GET', '/api/v1/ui/dashboards/home-insights', pm)).json.data;
  assert.equal(own.source, 'personal');
  assert.deepEqual(own.layout.map((i) => [i.widget, i.w]), [['ov.todo.mine', 12], ['ov.qs.unbilled_wip', 6]]);
});
