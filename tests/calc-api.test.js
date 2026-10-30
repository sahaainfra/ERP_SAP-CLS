import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { todayIST } from '../src/shared/dates.js';
import { startApi } from './helpers.js';

const C = '/api/v1/core';
const key = (n) => ({ 'idempotency-key': `calc-${n}-${Math.random().toString(36).slice(2, 10)}` });
const sys = { roles: 'SYSADM', user: 'sysadmin', company: '1' };
const pcmgr = { roles: 'PCMGR', user: 'prakash', company: '1' };
const cfo = { roles: 'CFO', user: 'charu', company: '1' };
const accmgr = { roles: 'ACCMGR', user: 'asha', company: '1' };
const itadm = { roles: 'ITADM', user: 'ishaan', company: '1' };
const pm = { roles: 'PM', user: 'pooja', company: '1' };
const dir = { roles: 'DIR', user: 'dinesh', company: '1' };
const today = todayIST();

const whole = {
  description: 'Line amount rounded to the nearest rupee',
  expression: 'amount = round(quantity * rate, 0)',
  inputs: [{ name: 'quantity', type: 'quantity', min: '0' }, { name: 'rate', type: 'rate', min: '0' }],
  outputs: [{ name: 'amount', type: 'money', label: 'Line amount' }],
  roundingPolicy: 'half_up',
  effectiveFrom: today,
  tests: [{ inputs: { quantity: '12.5', rate: '101.2345' }, expect: { amount: '1265.00' } }, { inputs: { quantity: '3', rate: '0.005' }, expect: { amount: '0.00' } }],
};

/** Draft, check, request and approve a new version through the whole chain. */
async function activate(api, code, body, { chain = [pcmgr, cfo] } = {}) {
  const draft = await api.call('POST', `${C}/formulas/${code}/versions`, { ...sys, headers: key('v'), body: { ...body, reason: 'new rounding rule' } });
  assert.equal(draft.status, 201, JSON.stringify(draft.json));
  const v = draft.json.data.version;
  const req = await api.call('POST', `${C}/formulas/${code}/versions/${v}/activation-requests`, { ...sys, headers: key('r'), body: { reason: 'agreed with finance' } });
  assert.equal(req.status, 201, JSON.stringify(req.json));
  for (const [i, who] of chain.entries()) {
    const act = await api.call('POST', `${C}/change-requests/${req.json.data.id}/act`, { ...who, headers: key(`a${i}`), body: { action: 'approve', comment: 'ok' } });
    assert.equal(act.status, 200, JSON.stringify(act.json));
  }
  return { version: v, requestId: req.json.data.id };
}

test('AC-05 who may use the registry: SYSADM and PCMGR view; only SYSADM changes; nobody else, nobody anonymous', async () => {
  const api = await startApi();
  for (const path of ['/formulas', '/formulas/boq.line_amount', '/uoms', '/uom-conversions', '/formulas/boq.line_amount/versions/1/check']) {
    assert.equal((await api.call('GET', C + path, sys)).status, 200, `SYSADM ${path}`);
    assert.equal((await api.call('GET', C + path, pcmgr)).status, 200, `PCMGR ${path}`);
    for (const who of [pm, itadm, dir, cfo]) assert.equal((await api.call('GET', C + path, who)).status, 403, `${who.roles} ${path}`);
    assert.equal((await api.call('GET', C + path, { user: null })).status, 401, `anonymous ${path}`);
  }
  const attempts = [
    ['POST', '/formulas', { code: 'x.y', ownerModule: 'core', ...whole, reason: 'a new formula' }],
    ['POST', '/formulas/boq.line_amount/versions', { reason: 'a new version' }],
    ['POST', '/uoms', { code: 'BOX', name: 'Box', dimension: 'count', reason: 'a new unit' }],
    ['POST', '/uom-conversions', { from: 'KG', to: 'G', factor: '1000', reason: 'a conversion' }],
  ];
  for (const [method, path, body] of attempts) {
    assert.equal((await api.call(method, C + path, { ...pcmgr, headers: key('x'), body })).status, 403, `PCMGR ${path}`);
    assert.equal((await api.call(method, C + path, { ...itadm, headers: key('x'), body })).status, 403, `ITADM ${path}`);
  }
  await api.close();
});

test('AC-01 the registry lists every business calculation with its versions; the test bench shows result and trace', async () => {
  const api = await startApi();
  const list = (await api.call('GET', `${C}/formulas`, sys)).json;
  assert.deepEqual(list.data.map((f) => [f.code, f.ownerModule, f.currentVersion, f.latestVersion, f.financial]), [
    ['billing.net_payable', 'billing', 1, 1, true], ['boq.line_amount', 'boq', 1, 1, true], ['stock.weighted_average', 'stores', 1, 1, true], ['tax.gst_split', 'tax', 1, 1, true],
  ]);
  assert.equal((await api.call('GET', `${C}/formulas?filter[owner_module]=tax`, sys)).json.data.length, 1);
  assert.equal((await api.call('GET', `${C}/formulas?q=stock`, sys)).json.data[0].code, 'stock.weighted_average');
  const detail = (await api.call('GET', `${C}/formulas/tax.gst_split`, pcmgr)).json.data;
  assert.deepEqual([detail.approvalChain, detail.versions.length, detail.versions[0].state, detail.versions[0].inputs.length, detail.versions[0].tests.length >= 3], [['ACCMGR', 'CFO'], 1, 'current', 3, true]);
  assert.equal((await api.call('GET', `${C}/formulas/nope.nothing`, sys)).status, 404);
  assert.equal((await api.call('GET', `${C}/formulas/Bad Code`, sys)).status, 400);

  const bench = await api.call('POST', `${C}/formulas/tax.gst_split/test`, { ...pcmgr, body: { inputs: { taxable: '1265.43', gst_percent: '18', supply: 'intra' } } });
  assert.equal(bench.status, 200);
  assert.deepEqual(bench.json.data.result, { cgst: '113.89', sgst: '113.89', igst: '0.00', tax_total: '227.78', total: '1493.21' });
  assert.deepEqual(bench.json.data.trace.steps.map((s) => s.name), ['half', 'cgst', 'sgst', 'igst', 'tax_total', 'total']);
  assert.equal(bench.json.data.trace.formula.version, 1);
  const bad = await api.call('POST', `${C}/formulas/tax.gst_split/test`, { ...pcmgr, body: { inputs: { taxable: '1.234', gst_percent: '18', supply: 'intra' } } });
  assert.equal(bad.status, 422);
  assert.match(bad.json.error.message, /at most 2 decimal places/);
  assert.equal(api.db.prepare('SELECT COUNT(*) AS n FROM core_calc_traces').get().n, 0, 'the bench keeps nothing');

  const unsaved = await api.call('POST', `${C}/formulas/x.try/test`, { ...sys, body: { inputs: { n: '5' }, draft: { expression: 'double = n * 2', inputs: [{ name: 'n', type: 'integer' }], outputs: [{ name: 'double', type: 'integer' }], roundingPolicy: 'half_up' } } });
  assert.equal(unsaved.json.data.result.double, '10');
  const broken = await api.call('POST', `${C}/formulas/x.try/test`, { ...sys, body: { inputs: {}, draft: { expression: 'r = z', inputs: [], outputs: [{ name: 'r', type: 'integer' }], roundingPolicy: 'half_up' } } });
  assert.equal(broken.status, 400);
  assert.match(broken.json.error.message, /Unknown name: z/);
  await api.close();
});

test('FR-01 / BR-02 a new formula and its versions are drafts that can be edited until they leave draft', async () => {
  const api = await startApi();
  const create = await api.call('POST', `${C}/formulas`, { ...sys, headers: key(1), body: { code: 'core.demo_double', ownerModule: 'core', financial: false, ...whole, reason: 'a demo formula' } });
  assert.equal(create.status, 201);
  assert.deepEqual([create.json.data.version, create.json.data.status, create.json.data.editable], [1, 'DRAFT', true]);
  assert.equal((await api.call('POST', `${C}/formulas`, { ...sys, headers: key(2), body: { code: 'core.demo_double', ownerModule: 'core', ...whole, reason: 'again' } })).status, 409);
  assert.equal((await api.call('POST', `${C}/formulas`, { ...sys, headers: key(3), body: { code: 'core.bad', ownerModule: 'core', ...whole, expression: 'amount = nope * 2', reason: 'broken' } })).status, 400);
  const upd = await api.call('PATCH', `${C}/formulas/core.demo_double/versions/1`, { ...sys, headers: key(4), body: { version: 1, expression: 'amount = round(quantity * rate, 1)', reason: 'try one place' } });
  assert.equal(upd.status, 200);
  assert.equal(upd.json.data.rowVersion, 2);
  assert.equal((await api.call('PATCH', `${C}/formulas/core.demo_double/versions/1`, { ...sys, headers: key(5), body: { version: 1, description: 'a stale edit again', reason: 'stale' } })).status, 409, 'optimistic locking');
  assert.equal((await api.call('PATCH', `${C}/formulas/core.demo_double/versions/1`, { ...sys, headers: key(6), body: { version: 2, expression: 'amount = (', reason: 'broken edit' } })).status, 400);
  const sneaky = await api.call('PATCH', `${C}/formulas/core.demo_double/versions/1`, { ...sys, headers: key(7), body: { version: 2, status: 'ACTIVE', reason: 'try to activate directly' } });
  assert.equal(sneaky.json.data.status, 'DRAFT', 'there is no way to set a status except through the approved request');
  const check = (await api.call('GET', `${C}/formulas/core.demo_double/versions/1/check`, sys)).json.data;
  assert.equal(check.problems.length, 0);
  assert.deepEqual(check.tests.map((t) => t.ok), [false, true], 'the first stored test no longer matches the edited expression');
  assert.equal((await api.call('POST', `${C}/formulas/core.demo_double/versions`, { ...sys, headers: key(8), body: { reason: 'second draft' } })).status, 409, 'one draft at a time');
  assert.equal((await api.call('GET', `${C}/formulas/core.demo_double`, sys)).json.data.approvalChain.join(), 'ITADM', 'a non-financial formula owned by core is approved by the IT Administrator');
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'core.formula.version_created'").get().n, 1);
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'core_formulas' AND action = 'update'").get().n, 2, 'the real edit and the one that tried to set a status');
  await api.close();
});

test('AC-06 a version becomes active only through its approval chain; tests, date and chain are enforced', async () => {
  const api = await startApi();
  const draft = (await api.call('POST', `${C}/formulas/boq.line_amount/versions`, { ...sys, headers: key(1), body: { ...whole, reason: 'whole rupees' } })).json.data;
  const url = `${C}/formulas/boq.line_amount/versions/${draft.version}/activation-requests`;
  assert.equal((await api.call('POST', url, { ...sys, body: { reason: 'no idempotency key' } })).status, 400, 'an Idempotency-Key is required');
  assert.equal((await api.call('POST', url, { ...pcmgr, headers: key(2), body: { reason: 'not mine' } })).status, 403, 'only the System Administrator asks');

  const noTests = (await api.call('POST', `${C}/formulas/boq.line_amount/versions`, { ...sys, headers: key(3), body: { reason: 'another draft please' } })).status;
  assert.equal(noTests, 409, 'a draft already exists');
  await api.call('PATCH', `${C}/formulas/boq.line_amount/versions/${draft.version}`, { ...sys, headers: key(4), body: { version: draft.rowVersion, tests: [], reason: 'remove the tests' } });
  const none = await api.call('POST', url, { ...sys, headers: key(5), body: { reason: 'without tests' } });
  assert.equal(none.status, 422);
  assert.match(none.json.error.message, /at least one test case/);
  await api.call('PATCH', `${C}/formulas/boq.line_amount/versions/${draft.version}`, { ...sys, headers: key(6), body: { version: draft.rowVersion + 1, tests: [{ inputs: { quantity: '1', rate: '1' }, expect: { amount: '9.00' } }], reason: 'a wrong test' } });
  const failing = await api.call('POST', url, { ...sys, headers: key(7), body: { reason: 'failing test' } });
  assert.equal(failing.status, 422);
  assert.match(failing.json.error.message, /own tests fail/);
  await api.call('PATCH', `${C}/formulas/boq.line_amount/versions/${draft.version}`, { ...sys, headers: key(8), body: { version: draft.rowVersion + 2, tests: whole.tests, effectiveFrom: '2020-01-01', reason: 'a date in the past' } });
  assert.equal((await api.call('POST', url, { ...sys, headers: key(9), body: { reason: 'past date' } })).status, 422);
  await api.call('PATCH', `${C}/formulas/boq.line_amount/versions/${draft.version}`, { ...sys, headers: key(10), body: { version: draft.rowVersion + 3, effectiveFrom: today, reason: 'effective today' } });

  const req = await api.call('POST', url, { ...sys, headers: key(11), body: { reason: 'agreed with the project controls manager' } });
  assert.equal(req.status, 201, JSON.stringify(req.json));
  assert.deepEqual(req.json.data.chain, ['PCMGR', 'CFO']);
  assert.equal((await api.call('POST', url, { ...sys, headers: key(12), body: { reason: 'second request' } })).status, 409, 'one open request');
  const state = () => api.call('GET', `${C}/formulas/boq.line_amount`, sys).then((r) => r.json.data.versions.map((v) => [v.version, v.state]));
  assert.deepEqual(await state(), [[2, 'draft'], [1, 'current']], 'nothing changes before approval');
  const act = (who, n) => api.call('POST', `${C}/change-requests/${req.json.data.id}/act`, { ...who, headers: key(n), body: { action: 'approve', comment: 'ok' } });
  assert.equal((await act(sys, 13)).status, 403, 'the requester is not in the chain');
  assert.equal((await act(cfo, 14)).status, 403, 'the CFO cannot go before the project controls manager');
  assert.equal((await act(pcmgr, 15)).status, 200);
  assert.deepEqual(await state(), [[2, 'draft'], [1, 'current']], 'one approval of two is not enough');
  assert.equal((await act(cfo, 16)).status, 200);
  assert.deepEqual(await state(), [[2, 'current'], [1, 'past']], 'the new version is in force and the old one ends the day before');
  const detail = (await api.call('GET', `${C}/formulas/boq.line_amount`, sys)).json.data.versions;
  assert.deepEqual([detail[0].effectiveFrom, detail[1].effectiveTo, detail[0].activatedBy], [today, new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10), 'charu']);
  assert.equal((await api.call('POST', `${C}/formulas/boq.line_amount/test`, { ...sys, body: { inputs: { quantity: '12.5', rate: '101.2345' } } })).json.data.result.amount, '1265.00', 'calculations now use version 2');
  assert.equal((await api.call('PATCH', `${C}/formulas/boq.line_amount/versions/2`, { ...sys, headers: key(17), body: { version: 9, expression: 'amount = 1', reason: 'change after activation' } })).status, 409, 'an active version cannot be edited');
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'core_formulas' AND action = 'activate'").get().n, 1);
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'core.formula.activated'").get().n, 1);
  await api.close();
});

test('the approval chain follows the owning module: ACCMGR then CFO for tax, ITADM alone for a core formula that is not financial', async () => {
  const api = await startApi();
  const gst = (await api.call('GET', `${C}/formulas/tax.gst_split`, sys)).json.data.versions[0];
  const { version } = await activate(api, 'tax.gst_split', { description: gst.description, expression: gst.expression, inputs: gst.inputs, outputs: gst.outputs, roundingPolicy: 'half_up', effectiveFrom: today, tests: gst.tests }, { chain: [accmgr, cfo] });
  assert.equal(version, 2);
  await api.call('POST', `${C}/formulas`, { ...sys, headers: key('c'), body: { code: 'core.demo_double', ownerModule: 'core', financial: false, ...whole, reason: 'a demo formula' } });
  const req = await api.call('POST', `${C}/formulas/core.demo_double/versions/1/activation-requests`, { ...sys, headers: key('d'), body: { reason: 'activate the demo' } });
  assert.equal(req.status, 201, JSON.stringify(req.json));
  assert.deepEqual(req.json.data.chain, ['ITADM']);
  assert.equal((await api.call('POST', `${C}/change-requests/${req.json.data.id}/act`, { ...itadm, headers: key('e'), body: { action: 'approve', comment: 'ok' } })).status, 200);
  assert.equal((await api.call('GET', `${C}/formulas/core.demo_double`, sys)).json.data.versions[0].state, 'current');
  await api.close();
});

test('T-03 / FR-05 shadow mode: the candidate runs beside the active version on real calculations and the report shows every difference', async () => {
  const api = await startApi();
  const draft = (await api.call('POST', `${C}/formulas/boq.line_amount/versions`, { ...sys, headers: key(1), body: { ...whole, reason: 'whole rupees' } })).json.data;
  const shadowUrl = `${C}/formulas/boq.line_amount/versions/${draft.version}/shadow`;
  assert.equal((await api.call('POST', shadowUrl, { ...pcmgr, headers: key(2), body: { reason: 'compare first' } })).status, 403);
  const started = await api.call('POST', shadowUrl, { ...sys, headers: key(3), body: { reason: 'compare before switching' } });
  assert.equal(started.status, 200, JSON.stringify(started.json));
  assert.deepEqual([started.json.data.status, started.json.data.editable], ['SHADOW', false]);
  assert.equal((await api.call('POST', shadowUrl, { ...sys, headers: key(4), body: { reason: 'again' } })).status, 409);
  assert.equal((await api.call('PATCH', `${C}/formulas/boq.line_amount/versions/${draft.version}`, { ...sys, headers: key(5), body: { version: 9, expression: 'amount = 1', reason: 'edit it now' } })).status, 409);

  const bill = async (quantity, unitRate) => api.call('POST', `${C}/sample-bills`, { ...pm, headers: key('b'), body: { title: 'Shadow bill', quantity, unitRate, gstPercent: '18', supply: 'intra' } });
  for (const [q, r] of [['10', '100'], ['12.5', '101.2345'], ['3', '0.0050'], ['7', '2.5']]) assert.equal((await bill(q, r)).status, 201);
  const summary = (await api.call('GET', `${C}/formulas/boq.line_amount/shadow-summary?candidate=${draft.version}`, sys)).json.data;
  assert.deepEqual([summary.runs, summary.differing, summary.errors], [4, 3, 0]);
  assert.deepEqual(summary.latestDifferences[0].baseline, { amount: '17.50' });
  assert.deepEqual(summary.latestDifferences[0].candidate, { amount: '18.00' });
  const bills = (await api.call('GET', `${C}/sample-bills`, pm)).json.data;
  assert.equal(bills.find((b) => b.title === 'Shadow bill' && b.quantity === '7.000').taxableAmount, '17.50', 'the active version still decides the bill');

  const cmp = await api.call('POST', `${C}/formulas/boq.line_amount/compare`, { ...pcmgr, body: { baselineVersion: 1, candidateVersion: draft.version, cases: [{ quantity: '10', rate: '100' }, { quantity: '12.5', rate: '101.2345' }, { quantity: '99', rate: '0.0050' }, { quantity: '-1', rate: '1' }], useRecent: 10 } });
  assert.equal(cmp.status, 200);
  const d = cmp.json.data;
  assert.deepEqual([d.summary.cases, d.summary.differing, d.summary.identical, d.summary.errors, d.summary.maxDifference], [8, 5, 3, 1, '0.50']);
  assert.deepEqual(d.results[1].differences, [{ field: 'amount', baseline: '1265.43', candidate: '1265.00', difference: '0.43' }]);
  assert.equal(d.results[0].differs, false);
  assert.match(d.results[3].baselineError, /at least 0/);
  assert.equal((await api.call('POST', `${C}/formulas/boq.line_amount/compare`, { ...pcmgr, body: { baselineVersion: 1, candidateVersion: 1, cases: [{}] } })).status, 400, 'two different versions');
  assert.equal((await api.call('POST', `${C}/formulas/boq.line_amount/compare`, { ...pcmgr, body: { baselineVersion: 1, candidateVersion: draft.version } })).status, 400, 'at least one case');
  assert.equal((await api.call('POST', `${C}/formulas/boq.line_amount/compare`, { ...pm, body: { baselineVersion: 1, candidateVersion: 2, cases: [{}] } })).status, 403);

  const stopped = await api.call('POST', `${shadowUrl}/stop`, { ...sys, headers: key(6), body: { reason: 'enough data' } });
  assert.equal(stopped.json.data.status, 'RETIRED');
  const after = await bill('1', '1');
  assert.equal(after.status, 201);
  assert.equal((await api.call('GET', `${C}/formulas/boq.line_amount/shadow-summary`, sys)).json.data.runs, 4, 'a stopped shadow records nothing more');
  await api.close();
});

test('shadow mode needs a sound draft with passing tests and an active version to compare with', async () => {
  const api = await startApi();
  const draft = (await api.call('POST', `${C}/formulas/boq.line_amount/versions`, { ...sys, headers: key(1), body: { ...whole, tests: [], reason: 'no tests yet' } })).json.data;
  const r = await api.call('POST', `${C}/formulas/boq.line_amount/versions/${draft.version}/shadow`, { ...sys, headers: key(2), body: { reason: 'try shadow' } });
  assert.equal(r.status, 422);
  assert.match(r.json.error.message, /at least one test case/);
  await api.call('POST', `${C}/formulas`, { ...sys, headers: key(3), body: { code: 'core.lonely', ownerModule: 'core', ...whole, reason: 'a formula with nothing active' } });
  const lonely = await api.call('POST', `${C}/formulas/core.lonely/versions/1/shadow`, { ...sys, headers: key(4), body: { reason: 'nothing to compare with' } });
  assert.equal(lonely.status, 422);
  assert.match(lonely.json.error.message, /no active version/);
  await api.close();
});

test('BR-01 a draft bill follows the formula in force; a submitted bill keeps the versions it was calculated with', async () => {
  const api = await startApi();
  const make = async (title) => (await api.call('POST', `${C}/sample-bills`, { ...pm, headers: key('b'), body: { title, quantity: '12.5', unitRate: '101.2345', gstPercent: '18', supply: 'intra', totalAmount: 1 } })).json.data;
  const draft = await make('Draft bill');
  const frozen = await make('Frozen bill');
  assert.deepEqual([draft.taxableAmount, draft.cgstAmount, draft.sgstAmount, draft.igstAmount, draft.totalAmount], ['1265.43', '113.89', '113.89', '0.00', '1493.21'], 'a total sent by the client is ignored: the server calculates');
  assert.deepEqual(draft.formulaPins, { 'boq.line_amount': 1, 'tax.gst_split': 1 });
  assert.equal((await api.call('POST', `${C}/sample-bills/${frozen.id}/submit`, { ...pm, body: { version: frozen.version } })).status, 400, 'submitting needs an Idempotency-Key');
  const submitted = await api.call('POST', `${C}/sample-bills/${frozen.id}/submit`, { ...pm, headers: key('s'), body: { version: frozen.version } });
  assert.equal(submitted.json.data.status, 'SUBMITTED');
  assert.equal((await api.call('POST', `${C}/sample-bills/${frozen.id}/submit`, { ...pm, headers: key('s2'), body: { version: submitted.json.data.version } })).status, 422);
  assert.equal((await api.call('PATCH', `${C}/sample-bills/${frozen.id}`, { ...pm, headers: key('u'), body: { version: submitted.json.data.version, quantity: '1' } })).status, 422, 'a submitted bill cannot change');

  await activate(api, 'boq.line_amount', whole);
  const again = (await api.call('POST', `${C}/sample-bills/${draft.id}/recalculate`, { ...pm, headers: key('r1'), body: {} })).json.data;
  assert.deepEqual([again.taxableAmount, again.totalAmount, again.formulaPins['boq.line_amount'], again.recalculation], ['1265.00', '1492.70', 2, { changed: true, usedPinnedVersions: false }], 'the draft moves to version 2');
  const kept = (await api.call('POST', `${C}/sample-bills/${frozen.id}/recalculate`, { ...pm, headers: key('r2'), body: {} })).json.data;
  assert.deepEqual([kept.taxableAmount, kept.totalAmount, kept.formulaPins['boq.line_amount'], kept.recalculation], ['1265.43', '1493.21', 1, { changed: false, usedPinnedVersions: true }], 'the approved bill keeps version 1');
  const edited = (await api.call('PATCH', `${C}/sample-bills/${draft.id}`, { ...pm, headers: key('u2'), body: { version: again.version, quantity: '20', supply: 'inter' } })).json.data;
  assert.deepEqual([edited.taxableAmount, edited.igstAmount, edited.cgstAmount, edited.totalAmount], ['2025.00', '364.50', '0.00', '2389.50']);
  assert.equal((await api.call('PATCH', `${C}/sample-bills/${draft.id}`, { ...pm, headers: key('u3'), body: { version: 1, quantity: '21' } })).status, 409, 'optimistic locking');
  assert.equal((await api.call('POST', `${C}/sample-bills`, { ...pm, headers: key('b2'), body: { title: 'x', quantity: '1.2345', unitRate: '1', gstPercent: '18', supply: 'intra' } })).status, 400);
  await api.close();
});

test('AC-03 "Show calculation": every computed field has a trace of its inputs, steps and formula version, behind the record\'s own permission', async () => {
  const api = await startApi();
  const bill = (await api.call('POST', `${C}/sample-bills`, { ...pm, headers: key('b'), body: { title: 'Traced', quantity: '12.5', unitRate: '101.2345', gstPercent: '18', supply: 'intra' } })).json.data;
  assert.deepEqual(bill.calculations.taxableAmount, { formula: 'boq.line_amount', version: 1, output: 'amount' });
  assert.deepEqual(bill.calculations.cgstAmount, { formula: 'tax.gst_split', version: 1, output: 'cgst' });
  const t = await api.call('GET', `${C}/calc-traces?entity=sample_bill&entityId=${bill.id}`, pm);
  assert.equal(t.status, 200);
  assert.deepEqual(t.json.data.map((x) => x.formula.code), ['boq.line_amount', 'tax.gst_split']);
  const gst = t.json.data[1];
  assert.deepEqual([gst.inputs, gst.outputs.cgst, gst.steps.map((s) => s.name), gst.rounding.length, gst.formula.version, gst.computedBy], [{ taxable: '1265.43', gst_percent: '18', supply: 'intra' }, '113.89', ['half', 'cgst', 'sgst', 'igst', 'tax_total', 'total'], 0, 1, 'pooja']);
  assert.deepEqual([gst.steps[0].value, gst.steps[1].value, gst.steps[1].formula], ['9', '113.89', "if(supply == 'intra', round(taxable * half / 100, 2), 0)"], 'each step shows its formula and its value');
  await api.call('POST', `${C}/sample-bills/${bill.id}/recalculate`, { ...pm, headers: key('r'), body: {} });
  assert.equal((await api.call('GET', `${C}/calc-traces?entity=sample_bill&entityId=${bill.id}`, pm)).json.data.length, 2, 'the latest trace of each formula only');

  assert.equal((await api.call('GET', `${C}/calc-traces?entity=sample_bill&entityId=${bill.id}`, dir)).status, 403, 'no view permission on the record');
  assert.equal((await api.call('GET', `${C}/calc-traces?entity=sample_bill&entityId=${bill.id}`, { ...pm, company: '2' })).status, 404, 'another company');
  assert.equal((await api.call('GET', `${C}/calc-traces?entity=sample_bill&entityId=99999`, pm)).status, 404);
  assert.equal((await api.call('GET', `${C}/calc-traces?entity=invoice&entityId=1`, pm)).status, 422);
  assert.equal((await api.call('GET', `${C}/calc-traces?entity=sample_bill`, pm)).status, 400);
  assert.equal((await api.call('GET', `${C}/calc-traces?entity=sample_bill&entityId=${bill.id}`, { user: null })).status, 401);
  assert.equal((await api.call('GET', `${C}/sample-bills/${bill.id}`, { ...pm, company: '2' })).status, 404);
  assert.equal((await api.call('GET', `${C}/sample-bills`, dir)).status, 403);
  await api.close();
});

test('FR-03 units and conversion factors: item rows beat generic ones through the API, with duplicates and unknown units refused', async () => {
  const api = await startApi();
  const units = (await api.call('GET', `${C}/uoms`, sys)).json.data;
  assert.ok(units.some((u) => u.code === 'BAG' && u.dimension === 'count') && units.some((u) => u.code === 'MT'));
  const conv = (body, n, who = sys) => api.call('POST', `${C}/uom-conversions`, { ...who, headers: key(n), body: { reason: 'master data', ...body } });
  assert.equal((await conv({ from: 'BAG', to: 'KG', factor: '50', itemCode: 'CEMENT_OPC53' }, 1)).status, 201);
  assert.equal((await conv({ from: 'BAG', to: 'KG', factor: '50', itemCode: 'CEMENT_OPC53' }, 2)).status, 409, 'the same pair twice');
  assert.equal((await conv({ from: 'BAG', to: 'ZZZ', factor: '5' }, 3)).status, 404);
  assert.equal((await conv({ from: 'KG', to: 'KG', factor: '1' }, 4)).status, 400);
  assert.equal((await conv({ from: 'KG', to: 'G', factor: '0' }, 5)).status, 400);
  assert.equal((await conv({ from: 'KG', to: 'G', factor: 'abc' }, 6)).status, 400);
  const convert = (body, who = pcmgr) => api.call('POST', `${C}/calc/convert`, { ...who, body });
  assert.equal((await convert({ quantity: '100', from: 'BAG', to: 'MT', itemCode: 'CEMENT_OPC53' })).json.data.result, '5.000');
  assert.equal((await convert({ quantity: '2', from: 'MT', to: 'KG' })).json.data.result, '2000.000');
  const clash = await conv({ from: 'MT', to: 'KG', factor: '990', itemCode: 'ODD_ITEM' }, 7);
  assert.equal(clash.status, 201);
  assert.equal((await convert({ quantity: '2', from: 'MT', to: 'KG', itemCode: 'ODD_ITEM' })).json.data.result, '1980.000', 'T-02 the item factor wins');
  assert.equal((await convert({ quantity: '2', from: 'MT', to: 'KG' })).json.data.result, '2000.000');
  assert.equal((await convert({ quantity: '1', from: 'BAG', to: 'KG' })).status, 422, 'no factor without the item');
  assert.equal((await convert({ quantity: '1', from: 'Q', to: 'KG' })).status, 404);
  assert.equal((await convert({ quantity: '1', from: 'KG', to: 'G' }, pm)).status, 403);
  const list = (await api.call('GET', `${C}/uom-conversions?itemCode=CEMENT_OPC53`, sys)).json.data;
  assert.ok(list.some((c) => c.scope === 'item' && c.itemCode === 'CEMENT_OPC53') && list.some((c) => c.scope === 'generic'));
  assert.equal((await api.call('DELETE', `${C}/uom-conversions/${clash.json.data.id}`, { ...sys, headers: key(8), body: {} })).status, 200);
  assert.equal((await convert({ quantity: '2', from: 'MT', to: 'KG', itemCode: 'ODD_ITEM' })).json.data.result, '2000.000', 'after the item row is removed the generic one applies again');
  assert.equal((await api.call('POST', `${C}/uoms`, { ...sys, headers: key(9), body: { code: 'bx', name: 'Box', dimension: 'count', reason: 'new unit' } })).status, 201);
  assert.equal((await api.call('POST', `${C}/uoms`, { ...sys, headers: key(10), body: { code: 'BX', name: 'Box', dimension: 'count', reason: 'again' } })).status, 409);
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity IN ('core_uoms', 'core_uom_conversions')").get().n, 4);
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'core.uom_conversion.changed'").get().n, 3);
  await api.close();
});

test('the whole calculation engine is hidden while ff.core.p0106 is OFF for the company', async () => {
  const api = await startApi();
  await api.call('PATCH', `${C}/feature-flags/ff.core.p0106`, { ...sys, headers: key(1), body: { scope: { level: 'company', companyId: 1 }, enabled: false, reason: 'switching the engine off' } });
  for (const path of ['/formulas', '/uoms', '/sample-bills', '/calc-traces?entity=sample_bill&entityId=1']) assert.equal((await api.call('GET', C + path, sys)).status, 404, path);
  assert.equal((await api.call('GET', `${C}/financial-years`, sys)).status, 200, 'other parts are unaffected');
  assert.equal((await api.call('GET', `${C}/formulas`, { ...sys, company: '2' })).status, 200, 'another company still has it');
  await api.close();
});
