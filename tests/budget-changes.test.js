import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { publishEvent } from '../src/server/platform/events/index.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { approve, as, dir, generate, opened, pcm, pd, phased, pm, qs, qs2, se, setup } from './bud-fixture.js';

// Part 12.02: budget revisions, transfers and contingency drawdown. T-01 a transfer that does not net to zero is rejected, and a drawdown above the contingency left is rejected (BR-01). Also: the impact preview, the approval bands by share of the budget
// (BR-02: project control manager and project director, the director above 5 %; a drawdown: project manager and project director), the new approved version in force after approval with its phasing kept whole, the comparison of versions (FR-05),
// a draft revision from an approved variation (FR-04), one change in approval at a time, return and resubmit, withdraw, cancel, raise again, roles, isolation and the flag.
after(async () => { for (const a of opened) await a.close(); });
const pm2 = as('PM', 'bpm2'); const pcm2 = as('PCMGR', 'bpcm2');
async function ready() {
  const t = await setup(); const g = await generate(t); await phased(t, g.id); const b = await approve(t, g.id);
  const opt = (await t.call(pm, 'GET', `/change-options?projectId=${t.pid}`)).json.data;
  const line = (name, wbs) => opt.lines.find((l) => l.resourceName === name && (!wbs || l.wbsCode === wbs));
  return { t, b, opt, line };
}
const rev = (r, over = {}) => ({ projectId: r.t.pid, changeType: 'REVISION', reasonCode: 'RATE_ESCALATION', title: 'Cement price rise', justification: 'Cement rose 15 % since the estimate (supplier letters attached).', lines: [{ lineId: r.line('Cement', 'W2').id, amountDelta: 20000 }], ...over });
const send = async (t, who, id) => { const s = await t.call(who, 'POST', `/changes/${id}/submit`); assert.equal(s.status, 202, JSON.stringify(s.json)); return s.json.data.workflowInstanceId; };
const tasksOf = async (t, who) => (await t.api.call('GET', '/api/v1/workflow/tasks?mine=assigned', who)).json.data.rows;

test('T-01 a transfer must net to zero and a drawdown cannot exceed the contingency left (BR-01)', async () => {
  const r = await ready(); const { t } = r;
  const bad = await t.call(pm, 'POST', '/changes', { projectId: t.pid, changeType: 'TRANSFER', reasonCode: 'TRANSFER', title: 'Mason to excavation', justification: 'Less masonry, more rock excavation found.', lines: [{ lineId: r.line('Mason', 'W2').id, amountDelta: -10000 }, { lineId: r.line('Excavation in soil').id, amountDelta: 9000 }] });
  assert.equal(bad.status, 422); assert.match(bad.json.error.message, /net to zero/);
  const pv = (await t.call(pm, 'POST', '/changes/preview', { projectId: t.pid, changeType: 'TRANSFER', reasonCode: 'TRANSFER', lines: [{ lineId: r.line('Mason', 'W2').id, amountDelta: -10000 }, { lineId: r.line('Excavation in soil').id, amountDelta: 9000 }] })).json.data;
  assert.deepEqual([pv.ok, pv.issues[0].code, pv.impact.net], [false, 'NOT_NET_ZERO', '-1000.00']);
  const over = await t.call(pcm, 'POST', '/changes', { projectId: t.pid, changeType: 'DRAWDOWN', reasonCode: 'RISK_REALISED', riskId: t.risk, title: 'Rock in the foundation', justification: 'The rock found at W2 needs breaking and extra concrete.', lines: [{ lineId: r.line('Cement', 'W2').id, amountDelta: 60000 }] });
  assert.equal(over.status, 422); assert.match(over.json.error.message, /more than the contingency left, ₹ 50000.00/);
  assert.equal((await t.call(pm, 'POST', '/changes', { projectId: t.pid, changeType: 'TRANSFER', reasonCode: 'TRANSFER', title: 'Into contingency', justification: 'Move money into the contingency line.', lines: [{ lineId: r.line('Mason', 'W2').id, amountDelta: -100 }, { lineId: r.opt.lines.find((l) => l.lineKind === 'CONTINGENCY').id, amountDelta: 100 }] })).status, 400, 'contingency is not transferred');
  assert.equal((await t.call(pm, 'POST', '/changes', rev(r, { lines: [{ lineId: r.line('Mason', 'W2').id, amountDelta: -60000 }] }))).status, 400, 'a line does not go below zero');
  // a drawdown waiting for approval holds its money
  const d1 = (await t.call(pcm, 'POST', '/changes', { projectId: t.pid, changeType: 'DRAWDOWN', reasonCode: 'RISK_REALISED', riskId: t.risk, title: 'Rock in the foundation', justification: 'The rock found at W2 needs breaking and extra concrete.', lines: [{ lineId: r.line('Cement', 'W2').id, amountDelta: 30000 }] })).json.data;
  await send(t, pcm, d1.id);
  const d2 = await t.call(pcm, 'POST', '/changes', { projectId: t.pid, changeType: 'DRAWDOWN', reasonCode: 'RISK_REALISED', riskId: t.risk, title: 'More rock', justification: 'A second pocket of rock was found at W1.1.', lines: [{ lineId: r.line('Cement', 'W1.1').id, amountDelta: 25000 }] });
  assert.equal(d2.status, 422, 'only ₹ 20 000 is left once the first drawdown is counted');
  assert.equal((await t.call(pcm, 'POST', '/changes', { projectId: t.pid, changeType: 'DRAWDOWN', reasonCode: 'RISK_REALISED', title: 'No risk', justification: 'A drawdown without its risk.', lines: [{ lineId: r.line('Cement', 'W1.1').id, amountDelta: 100 }] })).status, 400, 'a drawdown names its risk');
  assert.equal((await t.call(pcm, 'POST', '/changes', { projectId: t.pid, changeType: 'DRAWDOWN', reasonCode: 'RISK_REALISED', riskId: t.opp, title: 'An opportunity', justification: 'A drawdown against an opportunity.', lines: [{ lineId: r.line('Cement', 'W1.1').id, amountDelta: 100 }] })).status, 400, 'an opportunity is not a risk');
});

test('a revision up to 5 % goes to the project control manager and the project director; approved, it is a new version in force with whole phasing; the versions compare', async () => {
  const r = await ready(); const { t } = r;
  assert.equal((await t.call(qs, 'POST', '/changes', rev(r))).status, 403, 'the quantity surveyor does not request changes');
  const pv = (await t.call(pm, 'POST', '/changes/preview', rev(r))).json.data;
  assert.deepEqual([pv.ok, pv.impact.totalBefore, pv.impact.totalAfter, pv.impact.totalDelta, pv.impact.pctOfBudget, pv.impact.chain, pv.impact.marginBefore, pv.impact.marginAfter], [true, '664200.00', '684200.00', '20000.00', 3.0111, ['PCMGR', 'PD'], '9365800.00', '9345800.00']);
  const c = (await t.call(pm, 'POST', '/changes', rev(r))).json.data;
  assert.deepEqual([c.status, c.changeType, c.lines[0].amountBefore, c.lines[0].amountDelta, c.lines[0].amountAfter], ['DRAFT', 'REVISION', '127680.00', '20000.00', '147680.00']);
  const inst = await send(t, pm, c.id);
  assert.ok(!(await tasksOf(t, pm)).some((x) => x.instance.id === inst), 'the requester never signs');
  assert.equal((await t.call(pm, 'POST', '/changes', rev(r, { title: 'Second' }))).status, 201);
  const second = (await t.call(pm, 'GET', '/changes')).json.data.find((x) => x.title === 'Second');
  assert.equal((await t.call(pm, 'POST', `/changes/${second.id}/submit`)).status, 409, 'one change of a project in approval at a time');
  await t.act(pcm, inst); await t.act(pd, inst);
  const done = (await t.call(pm, 'GET', `/changes/${c.id}`)).json.data; assert.deepEqual([done.status, done.resultBudget.versionNo], ['APPROVED', 2]);
  const v2 = (await t.call(qs, 'GET', `/budgets/${done.resultBudget.id}`)).json.data; assert.deepEqual([v2.status, v2.vtype, v2.totalAmount, v2.locked], ['APPROVED', 'REVISED', '684200.00', true]);
  assert.equal((await t.call(qs, 'GET', `/budgets/${r.b.id}`)).json.data.status, 'SUPERSEDED');
  const ph = (await t.call(qs, 'GET', `/budgets/${v2.id}/phasing`)).json.data; assert.deepEqual([ph.reconciled, ph.phasedTotal], [true, '684200.00'], 'the phasing of the changed line follows it');
  const ev = JSON.parse(t.api.db.prepare("SELECT payload FROM core_outbox WHERE event_type = 'bud.budget.revised' ORDER BY id DESC").get().payload).data;
  assert.deepEqual([ev.source, ev.changeId, ev.previousBudgetId, ev.delta, ev.changeType], ['CHANGE', c.id, r.b.id, '20000.00', 'REVISION']);
  const cmp = (await t.call(qs, 'GET', `/compare?projectId=${t.pid}`)).json.data;
  assert.deepEqual([cmp.from.versionNo, cmp.to.versionNo, cmp.totalDelta, cmp.changedRows, cmp.rows[0].delta], [1, 2, '20000.00', 1, '20000.00']);
  assert.equal(cmp.versions.find((v) => v.versionNo === 2).change.docNo, c.docNo, 'each version names the change that made it');
  const byHead = (await t.call(qs, 'GET', `/compare?projectId=${t.pid}&by=cost_head`)).json.data; assert.equal(byHead.changedRows, 1);
  const csv = await t.api.raw('GET', `/api/v1/bud/compare/export?projectId=${t.pid}`, qs); assert.equal(csv.status, 200); assert.match(csv.buffer.toString(), /"Total","664200.00","684200.00","20000.00"/);
  assert.equal((await t.call(pm, 'POST', `/changes/${second.id}/submit`)).status, 409, 'drafted against the old budget: given again');
  assert.equal((await t.call(pm, 'PATCH', `/changes/${second.id}`, { lines: [{ lineId: (await t.call(pm, 'GET', `/change-options?projectId=${t.pid}`)).json.data.lines.find((l) => l.resourceName === 'Cement' && l.wbsCode === 'W2').id, amountDelta: 1000 }] })).status, 200);
  assert.equal((await t.call(pm, 'POST', `/changes/${second.id}/submit`)).status, 202, 're-based on the budget in force');
});

test('above 5 % the director signs too; a transfer keeps the total; return, resubmit, reject and raise again', async () => {
  const r = await ready(); const { t } = r;
  const big = (await t.call(pm, 'POST', '/changes', rev(r, { reasonCode: 'SCOPE_CHANGE', title: 'Extra basement', lines: [{ lineId: r.line('Cement', 'W2').id, amountDelta: 30000 }, { lineWbs: undefined, lineKind: 'DIRECT', wbsId: t.w2, costCodeId: t.api.db.prepare("SELECT id FROM fin_cost_codes WHERE code = 'PLT-HIRE'").get().id, resourceType: 'EQUIPMENT', resourceName: 'Dewatering pumps', uom: 'day', qtyDelta: 40, amountDelta: 20000 }].map(({ lineWbs, ...x }) => (void lineWbs, x)) }))).json;
  assert.equal(big.data?.status, 'DRAFT', JSON.stringify(big)); assert.equal(big.data.lines.filter((l) => l.isNew).length, 1);
  const inst = await send(t, pm, big.data.id);
  await t.act(pcm, inst, 'return'); assert.equal((await t.call(pm, 'GET', `/changes/${big.data.id}`)).json.data.status, 'RETURNED');
  await send(t, pm, big.data.id); await t.act(pcm, inst); await t.act(pd, inst);
  assert.equal((await t.call(pm, 'GET', `/changes/${big.data.id}`)).json.data.status, 'SUBMITTED', 'waits for the director (7.5 %)');
  await t.act(dir, inst);
  const done = (await t.call(pm, 'GET', `/changes/${big.data.id}`)).json.data; assert.equal(done.status, 'APPROVED');
  const v2 = (await t.call(qs, 'GET', `/budgets/${done.resultBudget.id}`)).json.data; assert.equal(v2.totalAmount, '714200.00');
  const pump = v2.lines.find((l) => l.resourceName === 'Dewatering pumps'); assert.deepEqual([pump.qty, pump.rate, pump.amount, pump.origin], [40, 500, '20000.00', 'MANUAL']);
  // a transfer keeps the total
  const o2 = (await t.call(pm, 'GET', `/change-options?projectId=${t.pid}`)).json.data; const L = (n, w) => o2.lines.find((l) => l.resourceName === n && (!w || l.wbsCode === w));
  const tr = (await t.call(pcm, 'POST', '/changes', { projectId: t.pid, changeType: 'TRANSFER', reasonCode: 'TRANSFER', title: 'Mason to excavation', justification: 'Less masonry, more rock excavation found.', lines: [{ lineId: L('Mason', 'W2').id, amountDelta: -10000 }, { lineId: L('Excavation in soil').id, amountDelta: 10000 }] })).json.data;
  assert.deepEqual([tr.totalDelta, tr.moved], ['0.00', '10000.00']);
  const ti = await send(t, pcm, tr.id);
  assert.ok(!(await tasksOf(t, pcm)).some((x) => x.instance.id === ti), 'the project control manager who asked does not sign');
  await t.act(pcm2, ti); await t.act(pd, ti, 'reject');
  assert.equal((await t.call(pcm, 'GET', `/changes/${tr.id}`)).json.data.status, 'REJECTED');
  const again = await t.call(pcm, 'POST', `/changes/${tr.id}/amend`, { reason: 'With the site measurement attached' }); assert.equal(again.status, 201, JSON.stringify(again.json));
  assert.deepEqual([again.json.data.status, again.json.data.amendsChangeId, again.json.data.lines.length], ['DRAFT', tr.id, 2]);
  const ai = await send(t, pcm, again.json.data.id); await t.act(pcm2, ai); await t.act(pd, ai);
  const v3 = (await t.call(qs, 'GET', `/budgets/${(await t.call(pcm, 'GET', `/changes/${again.json.data.id}`)).json.data.resultBudget.id}`)).json.data; assert.deepEqual([v3.versionNo, v3.totalAmount], [3, '714200.00']);
});

test('a contingency drawdown names its risk and goes to the project manager and the project director; the contingency falls by what it gives', async () => {
  const r = await ready(); const { t } = r;
  const d = (await t.call(pcm, 'POST', '/changes', { projectId: t.pid, changeType: 'DRAWDOWN', reasonCode: 'RISK_REALISED', riskId: t.risk, title: 'Rock in the foundation', justification: 'The rock found at W2 needs breaking and extra concrete.', lines: [{ lineId: r.line('Cement', 'W2').id, amountDelta: 20000 }] })).json.data;
  assert.deepEqual([d.risk.docNo, d.totalDelta, d.moved, d.lines.length, d.lines.find((l) => l.lineKind === 'CONTINGENCY').amountDelta], ['RSK/1', '0.00', '20000.00', 2, '-20000.00']);
  const inst = await send(t, pcm, d.id); assert.equal((await t.call(pcm, 'GET', `/changes/${d.id}`)).json.data.status, 'SUBMITTED');
  assert.ok((await tasksOf(t, pm)).some((x) => x.instance.id === inst), 'the project manager signs first');
  await t.act(pm, inst); await t.act(pd, inst);
  const v2 = (await t.call(qs, 'GET', `/budgets/${(await t.call(pcm, 'GET', `/changes/${d.id}`)).json.data.resultBudget.id}`)).json.data;
  assert.deepEqual([v2.contingencyTotal, v2.directTotal, v2.totalAmount], ['30000.00', '504200.00', '664200.00']);
  assert.equal((await t.call(pm, 'GET', `/change-options?projectId=${t.pid}`)).json.data.budget.contingencyAvailable, '30000.00');
  assert.ok(t.api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'bud.change.approved'").get());
});

test('an approved variation drafts a budget revision by itself, once (FR-04)', async () => {
  const r = await ready(); const { t } = r; const rt = runtimeOf(t.api.db);
  const code = t.api.db.prepare("SELECT id FROM fin_cost_codes WHERE code = 'SUB-CIV'").get().id;
  const pub = () => publishEvent(t.api.db, { type: 'ctr.variation.approved', entity: 'ctr_variation', entityId: 77, actorId: 'bcm1', companyId: 1, projectId: t.pid, data: { projectId: t.pid, variationId: 77, variationNo: 'VO-03', title: 'Extra basement waterproofing', amount: '45000.00', lines: [{ wbsId: t.w2, costCodeId: code, resourceType: 'SUBCONTRACT', resourceName: 'Basement waterproofing', amount: 45000 }] } });
  pub(); for (let i = 0; i < 4; i += 1) rt.bus.drain();
  const l = (await t.call(pm, 'GET', '/changes')).json.data; assert.equal(l.length, 1); assert.deepEqual([l[0].changeType, l[0].status, l[0].totalDelta], ['VARIATION', 'DRAFT', '45000.00']);
  const c = (await t.call(pm, 'GET', `/changes/${l[0].id}`)).json.data; assert.deepEqual([c.variationRef, c.lines[0].resourceName, c.sourceType], ['VO-03', 'Basement waterproofing', 'ctr_variation']);
  assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM ntf_notifications WHERE template_code = 'bud.change.variation_draft' AND user_ref = 'bpm1'").get().n, 1, 'the project manager is told');
  pub(); for (let i = 0; i < 4; i += 1) rt.bus.drain(); assert.equal((await t.call(pm, 'GET', '/changes')).json.data.length, 1, 'once per variation');
  const inst = await send(t, pm, c.id); await t.act(pcm, inst); await t.act(pd, inst); await t.act(dir, inst);
  assert.equal((await t.call(pm, 'GET', `/changes/${c.id}`)).json.data.status, 'APPROVED', 'a 6.8 % variation needs the director');
});

test('roles, isolation, withdraw, cancel, delete, export, print and the flag', async () => {
  const r = await ready(); const { t } = r;
  assert.equal((await t.call(se, 'GET', '/changes')).status, 403);
  assert.equal((await t.call(qs, 'GET', '/changes')).status, 200, 'the quantity surveyor reads');
  const c = (await t.call(pm, 'POST', '/changes', rev(r))).json.data;
  assert.equal((await t.call(qs2, 'GET', `/changes/${c.id}`)).status, 404, 'another company sees nothing');
  assert.equal((await t.call(pm2, 'PATCH', `/changes/${c.id}`, { title: 'Cement price rise, revised' })).status, 200, 'another project manager of the company edits a draft');
  assert.equal((await t.call(pm, 'PATCH', `/changes/${c.id}`, { title: 'x', rowVersion: 1 })).status, 400);
  assert.equal((await t.call(pm, 'PATCH', `/changes/${c.id}`, { title: 'Old version', rowVersion: 1 })).status, 409, 'optimistic lock');
  await send(t, pm, c.id);
  assert.equal((await t.call(pm, 'PATCH', `/changes/${c.id}`, { title: 'While waiting' })).status, 409);
  assert.equal((await t.call(pcm, 'POST', `/changes/${c.id}/withdraw`, { reason: 'not mine to withdraw' })).status, 403);
  assert.equal((await t.call(pm, 'POST', `/changes/${c.id}/withdraw`, { reason: 'Need the supplier letter' })).json.data.status, 'DRAFT');
  assert.equal((await t.call(qs, 'POST', `/budgets/${r.b.id}/amend`, { reason: 'Start a revision of the budget' })).status, 201);
  assert.equal((await t.call(pm, 'POST', `/changes/${c.id}/submit`)).status, 409, 'not while the budget itself is being revised');
  const cx = await t.call(pm, 'POST', `/changes/${c.id}/cancel`, { reason: 'Replaced by the revision' }); assert.equal(cx.json.data.status, 'CANCELLED');
  const ex = await t.api.raw('GET', '/api/v1/bud/changes/export?format=csv', pm); assert.equal(ex.status, 200);
  const pr = await t.api.raw('GET', `/api/v1/bud/changes/${c.id}/print`, pm); assert.match(pr.buffer.toString(), /NOT AN APPROVED CHANGE/);
  const h = (await t.call(pm, 'GET', `/changes/${c.id}/history`)).json.data; assert.ok(h.audit.some((a) => a.action === 'cancel'));
  const d = (await t.call(pm, 'POST', '/changes/import', { rows: [{ ...rev(r), title: 'Imported revision' }, { ...rev(r), lines: [{ lineId: 999999, amountDelta: 1 }] }] })).json.data; assert.deepEqual([d.created, d.errors.length], [1, 1]);
  assert.equal((await t.call(pm, 'DELETE', `/changes/${d.rows[0].id}`)).status, 200);
  t.api.db.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.bud.p1202'").run();
  assert.equal((await t.call(pm, 'GET', '/changes')).status, 404, 'the flag is off');
  assert.equal((await t.call(qs, 'GET', '/budgets')).status, 200, 'the budget of 12.01 stays');
});
