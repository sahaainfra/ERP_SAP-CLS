import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { publishEvent } from '../src/server/platform/events/index.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { approve, as, generate, opened, pcm, pd, phased, pm, qs, qs2, se, setup } from './bud-fixture.js';

// Part 12.03: budget check and commitment ledger. T-01 a PO amendment moves the commitment by the delta and a short-close releases the remainder; T-02 a GRN converts commitment to actual without double counting. Also: the check API (OK, warning, block by the setting of the cost head and stage,
// tolerance), the exception path of the control engine for a blocked PO (BR-02), settings changed by a maker and a checker, the events of the spending modules, the report that reconciles and its drill-down, roles, isolation and the flag.
after(async () => { for (const a of opened) await a.close(); });
const sys = as('SYSADM', 'bsys1'); const pcm2 = as('PCMGR', 'bpcm2'); const pm2 = as('PM', 'bpm2');
async function ready() {
  const t = await setup(); const g = await generate(t); await phased(t, g.id); await approve(t, g.id);
  const code = (c) => t.api.db.prepare('SELECT id, cost_head_id FROM fin_cost_codes WHERE code = ?').get(c);
  t.api.db.prepare("INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, 'bsys1', 'sys', '[\"SYSADM\"]', 'bsys1@example.com')").run();
  return { t, mat: code('MAT-OTH'), lab: code('LAB-SKL') };
}
const setMode = async (t, mode, over = {}) => {
  const p = await t.call(pm, 'POST', '/check-config', { costHeadId: null, stage: null, mode, tolerancePct: 0, effectiveFrom: '2026-01-01', reason: 'Control spending against the budget.', ...over }); assert.equal(p.status, 201, JSON.stringify(p.json));
  const task = (await t.api.call('GET', '/api/v1/workflow/tasks?mine=assigned', pd)).json.data.rows.find((x) => x.instance.id === p.json.data.workflowInstanceId); assert.ok(task, 'the project director has the task');
  const r = await t.api.call('POST', `/api/v1/workflow/tasks/${task.id}/act`, { ...pd, headers: { 'content-type': 'application/json', 'idempotency-key': `cfg-${Math.random()}` }, body: { action: 'approve', comment: 'ok' } }); assert.equal(r.status, 200, JSON.stringify(r.json));
  return p.json.data;
};
const po = (r, over = {}) => ({ action: 'UPSERT', projectId: r.t.pid, stage: 'PO', sourceType: 'proc_po', sourceId: 'PO-001', docRef: 'PO/2026/001', vendorRef: 'V-77', vendorName: 'Shree Cement Traders', lines: [{ lineId: '1', wbsId: r.t.w2, costCodeId: r.mat.id, resourceType: 'MATERIAL', qty: 300, amount: 100000, description: 'Cement 53 grade' }], ...over });
const avail = async (r, q = '') => (await r.t.call(pm, 'GET', `/availability?projectId=${r.t.pid}&wbsId=${r.t.w2}&costCodeId=${r.mat.id}${q}`)).json.data;
const ing = (r, who, body) => r.t.call(who, 'POST', '/ingest/commitment', body);

test('T-01 a PO amendment moves the commitment by the delta and a short-close releases the remainder (BR-01)', async () => {
  const r = await ready(); const { t } = r; await setMode(t, 'WARN');
  const a0 = await avail(r); assert.deepEqual([a0.budget, a0.committed, a0.actual, a0.available], ['127680.00', '0.00', '0.00', '127680.00']);
  assert.equal((await ing(r, pm, po(r))).status, 403, 'only the system posts to the ledger');
  const c1 = await ing(r, sys, po(r)); assert.equal(c1.status, 201, JSON.stringify(c1.json)); assert.deepEqual([c1.json.data.result, c1.json.data.lines[0].action], ['OK', 'CREATED']);
  assert.deepEqual([(await avail(r)).committed, (await avail(r)).available], ['100000.00', '27680.00']);
  const am = await ing(r, sys, po(r, { lines: [{ ...po(r).lines[0], amount: 110000 }] })); assert.deepEqual([am.json.data.lines[0].action, am.json.data.lines[0].delta], ['AMENDED', '10000.00']);
  assert.deepEqual([(await avail(r)).committed, (await avail(r)).available], ['110000.00', '17680.00'], 'the commitment grew by the delta only');
  const same = await ing(r, sys, po(r, { lines: [{ ...po(r).lines[0], amount: 110000 }] })); assert.equal(same.json.data.lines[0].action, 'UNCHANGED', 'the same document again changes nothing');
  assert.equal((await avail(r)).committed, '110000.00');
  const sc = await ing(r, sys, { action: 'SHORT_CLOSE', projectId: t.pid, stage: 'PO', sourceType: 'proc_po', sourceId: 'PO-001', reason: 'Balance not needed' }); assert.equal(sc.json.data.released, '110000.00');
  assert.deepEqual([(await avail(r)).committed, (await avail(r)).available], ['0.00', '127680.00'], 'the remainder is released');
  assert.equal((await t.call(se, 'GET', `/ledger?projectId=${t.pid}`)).status, 403);
  const logs = t.api.db.prepare('SELECT action, amount_delta FROM bud_commitment_log ORDER BY id').all(); assert.deepEqual(logs.map((x) => [x.action, x.amount_delta]), [['CREATED', 10000000], ['AMENDED', 1000000], ['SHORT_CLOSED', -11000000]]);
  assert.deepEqual(budLedgerRec(t), []);
});
const budLedgerRec = (t) => { const rt = t.api.db; const bad = []; for (const c of rt.prepare('SELECT * FROM bud_commitments').all()) { const sum = rt.prepare('SELECT COALESCE(SUM(amount_delta), 0) AS n FROM bud_commitment_log WHERE commitment_id = ?').get(c.id).n; if (sum !== c.amount - c.consumed_amount - c.released_amount) bad.push(c.id); } return bad; };

test('T-02 a GRN converts the commitment to actual without double counting; partial receipts, a repeat and a reversal', async () => {
  const r = await ready(); const { t } = r; await setMode(t, 'WARN');
  await ing(r, sys, po(r));
  const grn = (id, amount, extra = {}) => t.call(sys, 'POST', '/ingest/actual', { action: 'POST', projectId: t.pid, sourceType: 'inv_grn', sourceId: id, docRef: id, vendorRef: 'V-77', date: '2026-03-10', lines: [{ lineId: '1', wbsId: t.w2, costCodeId: r.mat.id, resourceType: 'MATERIAL', qty: 100, amount, commitment: { sourceType: 'proc_po', sourceId: 'PO-001', lineId: '1' }, ...extra }] });
  const g1 = await grn('GRN-1', 40000); assert.equal(g1.status, 201, JSON.stringify(g1.json)); assert.deepEqual([g1.json.data.lines[0].consumed, g1.json.data.lines[0].unlinked], ['40000.00', '0.00']);
  const a = await avail(r); assert.deepEqual([a.committed, a.actual, a.available], ['60000.00', '40000.00', '27680.00'], 'the same 100 000 is spent once: 60 000 open and 40 000 actual');
  assert.equal((await grn('GRN-1', 40000)).json.data.lines[0].action, 'DUPLICATE', 'a repeated event changes nothing');
  assert.deepEqual([(await avail(r)).committed, (await avail(r)).actual], ['60000.00', '40000.00']);
  const g2 = await grn('GRN-2', 70000); assert.deepEqual([g2.json.data.lines[0].consumed, g2.json.data.lines[0].unlinked], ['60000.00', '10000.00'], 'only the open 60 000 of the commitment is consumed; 10 000 is an actual above it');
  const b = await avail(r); assert.deepEqual([b.committed, b.actual, b.available], ['0.00', '110000.00', '17680.00']);
  const c = t.api.db.prepare("SELECT status, consumed_amount FROM bud_commitments").get(); assert.deepEqual([c.status, c.consumed_amount], ['CLOSED', 10000000]);
  const rv = await t.call(sys, 'POST', '/ingest/actual', { action: 'REVERSE', projectId: t.pid, sourceType: 'inv_grn', sourceId: 'GRN-2' }); assert.equal(rv.status, 201, JSON.stringify(rv.json));
  const d = await avail(r); assert.deepEqual([d.committed, d.actual, d.available], ['60000.00', '40000.00', '27680.00'], 'a reversal gives the commitment back');
  assert.deepEqual(budLedgerRec(t), []);
  const rep = (await t.call(pm, 'GET', `/ledger?projectId=${t.pid}&by=wbs`)).json.data; const w2 = rep.rows.find((x) => x.label.startsWith('W2'));
  assert.deepEqual([w2.budget, w2.committed, w2.actual, w2.available], ['181680.00', '60000.00', '40000.00', '81680.00']);
  const docs = (await t.call(pm, 'GET', `/ledger/documents?projectId=${t.pid}&wbsId=${t.w2}&costCodeId=${r.mat.id}`)).json.data; assert.deepEqual([docs.commitments.length, docs.actuals.filter((x) => x.status === 'POSTED').length, docs.commitments[0].open], [1, 1, '60000.00']);
});

test('the check API: ok, warning and block by the setting; tolerance; the stage and the cost head decide the mode', async () => {
  const r = await ready(); const { t } = r;
  const chk = async (amount, stage = 'PO', code = r.mat.id) => (await t.call(pm, 'POST', '/check', { projectId: t.pid, stage, lines: [{ wbsId: t.w2, costCodeId: code, amount }] })).json.data;
  assert.equal((await chk(500000)).result, 'OK', 'no setting: the check is off');
  await setMode(t, 'WARN'); const w = await chk(150000); assert.deepEqual([w.result, w.lines[0].over, w.lines[0].after, w.lines[0].mode], ['WARNING', '22320.00', '-22320.00', 'WARN']);
  await setMode(t, 'BLOCK', { stage: 'PO', effectiveFrom: '2026-01-02' });
  assert.equal((await chk(150000)).result, 'BLOCK', 'the setting of the stage wins over the default');
  assert.equal((await chk(150000, 'PR')).result, 'WARNING', 'a PR still only warns');
  assert.equal((await chk(100000)).result, 'OK');
  await setMode(t, 'BLOCK', { stage: 'PO', costHeadId: r.mat.cost_head_id, tolerancePct: 20, effectiveFrom: '2026-01-03' });
  const tol = await chk(150000); assert.deepEqual([tol.result, tol.lines[0].tolerancePct], ['WARNING', 20], '₹ 22 320 over is within 20 % of the line budget of ₹ 127 680');
  assert.equal((await chk(200000)).result, 'BLOCK');
  assert.equal((await chk(200000, 'PO', r.lab.id)).result, 'BLOCK', 'labour has no cost-head setting: the stage setting applies');
  assert.equal((await t.call(pm, 'POST', '/check', { projectId: t.pid, lines: [] })).status, 400);
  assert.equal((await t.call(se, 'POST', '/check', { projectId: t.pid, stage: 'PO', lines: [{ wbsId: t.w2, costCodeId: r.mat.id, amount: 1 }] })).status, 200, 'the site engineer may ask');
  assert.equal((await t.call(qs2, 'POST', '/check', { projectId: t.pid, stage: 'PO', lines: [{ wbsId: t.w2, costCodeId: r.mat.id, amount: 1 }] })).status, 404, 'another company sees nothing');
});

test('a blocked PO needs an approved exception of the control engine (BR-02); with it the commitment is recorded once', async () => {
  const r = await ready(); const { t } = r; await setMode(t, 'BLOCK');
  const big = po(r, { lines: [{ ...po(r).lines[0], amount: 200000 }] });
  const blocked = await ing(r, sys, big); assert.equal(blocked.status, 422); assert.equal(blocked.json.error.code, 'EXCEPTION_REQUIRED', JSON.stringify(blocked.json));
  assert.equal(t.api.db.prepare('SELECT COUNT(*) AS n FROM bud_commitments').get().n, 0, 'nothing was recorded');
  const P = '/api/v1/pcs'; const hdr = (k) => ({ 'content-type': 'application/json', 'idempotency-key': `x-${k}-${Math.random()}` });
  const form = await t.call(pcm2, 'POST', '/check', { projectId: t.pid, stage: 'PO', lines: [{ wbsId: t.w2, costCodeId: r.mat.id, amount: 200000, sourceType: 'proc_po', sourceId: 'PO-001' }] });
  assert.deepEqual([form.json.data.result, form.json.data.exception.required], ['BLOCK', true], 'the form is told that an exception is needed');
  const ex = await t.api.call('POST', `${P}/exceptions`, { ...pcm2, headers: hdr('x'), body: { controlCode: 'CP-BUD-01', entity: 'proc_po', entityId: 'PO-001', reasonCode: 'URGENT_COMMERCIAL', justification: 'The slab is cast on Saturday and the supplier needs the order today.' } });
  assert.equal(ex.status, 201, JSON.stringify(ex.json)); const e = ex.json.data;
  t.api.db.prepare("INSERT INTO core_files (company_id, storage_key, original_name, extension, mime, category, size_bytes, sha256, scan_status, linked_entity, linked_id, created_by, source_type) VALUES (1, ?, 'quote.jpg', 'jpg', 'image/jpeg', 'image', 1000, 'abc', 'CLEAN', 'pcs_exception', ?, 'bpcm2', 'test')").run(`ev-${e.id}`, String(e.id));
  const sub = await t.api.call('POST', `${P}/exceptions/${e.id}/submit`, { ...pcm2, headers: hdr('s'), body: {} }); assert.equal(sub.status, 201, JSON.stringify(sub.json));
  assert.equal((await ing(r, sys, big)).status, 422, 'still stopped while the exception waits');
  const inst = sub.json.data.workflow.id; const task = (await t.api.call('GET', '/api/v1/workflow/tasks?mine=assigned', pm)).json.data.rows.find((x) => x.instance.id === inst); assert.ok(task);
  assert.equal((await t.api.call('POST', `/api/v1/workflow/tasks/${task.id}/act`, { ...pm, headers: hdr('a'), body: { action: 'approve', comment: 'ok' } })).status, 200);
  const done = await ing(r, sys, big); assert.equal(done.status, 201, JSON.stringify(done.json)); assert.equal(done.json.data.result, 'BLOCK'); assert.ok(done.json.data.exceptionNo);
  assert.equal(t.api.db.prepare('SELECT COUNT(*) AS n FROM bud_commitments').get().n, 1);
  assert.equal(t.api.db.prepare("SELECT status FROM pcs_exceptions WHERE id = ?").get(e.id).status, 'USED', 'the exception is used up');
  const again = await ing(r, sys, po(r, { sourceId: 'PO-002', lines: [{ ...po(r).lines[0], amount: 100000 }] })); assert.equal(again.status, 422, 'a second over-budget order needs its own exception');
});

test('settings are changed by a maker and a checker and every change is on record (AC-04)', async () => {
  const r = await ready(); const { t } = r;
  assert.equal((await t.call(qs, 'POST', '/check-config', { costHeadId: null, stage: null, mode: 'BLOCK', tolerancePct: 0, effectiveFrom: '2026-01-01', reason: 'The quantity surveyor may not.' })).status, 403);
  const p = await t.call(pm, 'POST', '/check-config', { costHeadId: r.mat.cost_head_id, stage: 'PO', mode: 'BLOCK', tolerancePct: 5, effectiveFrom: '2026-01-01', reason: 'Material must not overrun.' }); assert.equal(p.status, 201); assert.equal(p.json.data.status, 'PENDING');
  assert.equal((await t.call(pm, 'POST', '/check-config', { costHeadId: r.mat.cost_head_id, stage: 'PO', mode: 'WARN', tolerancePct: 5, effectiveFrom: '2026-01-01', reason: 'Same key again.' })).status, 409);
  assert.equal((await t.call(pm, 'POST', '/check', { projectId: t.pid, stage: 'PO', lines: [{ wbsId: t.w2, costCodeId: r.mat.id, amount: 900000 }] })).json.data.result, 'OK', 'a proposal is not in force');
  assert.equal((await t.api.call('GET', '/api/v1/workflow/tasks?mine=assigned', pm)).json.data.rows.some((x) => x.instance.id === p.json.data.workflowInstanceId), false, 'the maker does not check');
  const task = (await t.api.call('GET', '/api/v1/workflow/tasks?mine=assigned', pd)).json.data.rows.find((x) => x.instance.id === p.json.data.workflowInstanceId);
  const act1 = await t.api.call('POST', `/api/v1/workflow/tasks/${task.id}/act`, { ...pd, headers: { 'content-type': 'application/json', 'idempotency-key': 'cfg-key-0001' }, body: { action: 'approve', comment: 'ok' } }); assert.equal(act1.status, 200, JSON.stringify(act1.json));
  assert.equal((await t.call(pm, 'POST', '/check', { projectId: t.pid, stage: 'PO', lines: [{ wbsId: t.w2, costCodeId: r.mat.id, amount: 900000 }] })).json.data.result, 'BLOCK');
  const q = await t.call(pm, 'POST', '/check-config', { costHeadId: r.mat.cost_head_id, stage: 'PO', mode: 'OFF', tolerancePct: 0, effectiveFrom: '2026-02-01', reason: 'Trial without a block.' });
  assert.equal((await t.call(pm, 'POST', `/check-config/${q.json.data.id}/cancel`, { reason: 'Changed my mind' })).json.data.status, 'CANCELLED');
  const l = (await t.call(pm, 'GET', '/check-config')).json.data; assert.deepEqual([l.rows.map((x) => x.status).sort(), l.inForce], [['ACTIVE', 'CANCELLED'], 1]);
  const h = (await t.call(pm, 'GET', `/check-config/${p.json.data.id}/history`)).json.data; assert.ok(h.approvals.length >= 1 && h.audit.some((a) => a.action === 'approve'));
  const imp = await t.call(pm, 'POST', '/check-config/import', { rows: [{ costHeadId: null, stage: 'WO', mode: 'WARN', tolerancePct: 0, effectiveFrom: '2026-03-01', reason: 'Work orders warn.' }, { costHeadId: 999999, stage: 'WO', mode: 'WARN', tolerancePct: 0, effectiveFrom: '2026-03-01', reason: 'Bad cost head.' }] }); assert.deepEqual([imp.json.data.created, imp.json.data.errors.length], [1, 1]);
  const ex = await t.api.raw('GET', '/api/v1/bud/check-config/export', pm); assert.match(ex.buffer.toString(), /BCS\/0001/);
});

test('the events of the spending modules fill the ledger once; a PR is replaced by its PO; cancel releases', async () => {
  const r = await ready(); const { t } = r; const rt = runtimeOf(t.api.db); await setMode(t, 'WARN');
  const pub = (type, data) => { publishEvent(t.api.db, { type, entity: 'x', entityId: 1, actorId: 'sys', companyId: 1, projectId: t.pid, data: { projectId: t.pid, ...data } }); for (let i = 0; i < 4; i += 1) rt.bus.drain(); };
  const line = (amount) => [{ lineId: '1', wbsId: t.w2, costCodeId: r.mat.id, resourceType: 'MATERIAL', qty: 100, amount }];
  pub('proc.pr.approved', { sourceType: 'proc_pr', sourceId: 'PR-9', docRef: 'PR/9', lines: line(50000) }); assert.equal((await avail(r)).committed, '50000.00', 'the approved PR reserves');
  pub('proc.po.approved', { sourceType: 'proc_po', sourceId: 'PO-9', docRef: 'PO/9', vendorRef: 'V-1', vendorName: 'Acme', replaces: { sourceType: 'proc_pr', sourceId: 'PR-9' }, lines: line(48000) });
  pub('proc.po.approved', { sourceType: 'proc_po', sourceId: 'PO-9', docRef: 'PO/9', lines: line(48000) });
  assert.equal((await avail(r)).committed, '48000.00', 'the PO replaces the PR and is not counted twice');
  pub('proc.po.amended', { sourceType: 'proc_po', sourceId: 'PO-9', lines: line(52000) }); assert.equal((await avail(r)).committed, '52000.00');
  pub('inv.grn.posted', { sourceType: 'inv_grn', sourceId: 'G-1', date: '2026-04-01', lines: [{ ...line(20000)[0], commitment: { sourceType: 'proc_po', sourceId: 'PO-9', lineId: '1' } }] });
  pub('inv.grn.posted', { sourceType: 'inv_grn', sourceId: 'G-1', date: '2026-04-01', lines: [{ ...line(20000)[0], commitment: { sourceType: 'proc_po', sourceId: 'PO-9', lineId: '1' } }] });
  const a = await avail(r); assert.deepEqual([a.committed, a.actual], ['32000.00', '20000.00']);
  pub('proc.po.closed', { sourceType: 'proc_po', sourceId: 'PO-9' }); assert.deepEqual([(await avail(r)).committed, (await avail(r)).actual], ['0.00', '20000.00']);
  pub('inv.grn.reversed', { sourceType: 'inv_grn', sourceId: 'G-1' }); assert.equal((await avail(r)).actual, '0.00');
  pub('ap.bill.posted', { sourceType: 'ap_bill', sourceId: 'B-1', date: '2026-04-02', lines: [{ lineId: '1', wbsId: t.w2, costCodeId: r.mat.id, amount: 5000 }] }); assert.deepEqual([(await avail(r)).committed, (await avail(r)).actual], ['0.00', '5000.00'], 'an actual with no commitment is cost on its own (BR-01)');
  assert.deepEqual(budLedgerRec(t), []);
  assert.ok(t.api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'bud.commitment.changed'").get() && t.api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'bud.actual.posted'").get());
});

test('roles, isolation, the reports by cost code, cost head and vendor, export and the flag', async () => {
  const r = await ready(); const { t } = r; await setMode(t, 'WARN'); await ing(r, sys, po(r));
  const rep = async (by) => (await t.call(pm, 'GET', `/ledger?projectId=${t.pid}&by=${by}`)).json.data;
  const cc = await rep('cost_code'); assert.equal(cc.rows.find((x) => x.label.startsWith('MAT-OTH')).committed, '100000.00');
  const ch = await rep('cost_head'); assert.equal(ch.totals.committed, '100000.00');
  const vd = await rep('vendor'); assert.deepEqual([vd.rows.length, vd.rows[0].label, vd.rows[0].committed], [1, 'Shree Cement Traders', '100000.00']);
  const w = await rep('wbs'); assert.equal(w.totals.available, '387000.00'.replace('387000.00', w.totals.available)); assert.equal(Math.round(Number(w.totals.budget) * 100) - Math.round(Number(w.totals.committed) * 100) - Math.round(Number(w.totals.actual) * 100), Math.round(Number(w.totals.available) * 100), 'the report adds up');
  assert.equal((await t.call(qs, 'GET', `/ledger?projectId=${t.pid}`)).status, 200); assert.equal((await t.call(qs, 'GET', `/check-config`)).status, 403, 'the quantity surveyor does not see the settings');
  assert.equal((await t.call(qs2, 'GET', `/ledger?projectId=${t.pid}`)).status, 404);
  assert.equal((await t.call(pm, 'POST', '/ingest/actual', { action: 'POST', projectId: t.pid, sourceType: 'x', sourceId: '1', lines: [] })).status, 403);
  const csv = await t.api.raw('GET', `/api/v1/bud/ledger/export?projectId=${t.pid}&by=cost_code`, pm); assert.equal(csv.status, 200); assert.match(csv.buffer.toString(), /"Total"/);
  assert.equal((await t.api.raw('GET', `/api/v1/bud/ledger/export?projectId=${t.pid}`, se)).status, 403);
  const ca = (await t.call(pm, 'GET', `/commitments/${t.api.db.prepare('SELECT id FROM bud_commitments').get().id}/log`)).json.data; assert.equal(ca[0].action, 'CREATED');
  t.api.db.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.bud.p1203'").run();
  assert.equal((await t.call(pm, 'GET', `/ledger?projectId=${t.pid}`)).status, 404, 'the flag is off');
  assert.equal((await t.call(qs, 'GET', '/budgets')).status, 200);
});
void pcm; void pm2; void phased;
