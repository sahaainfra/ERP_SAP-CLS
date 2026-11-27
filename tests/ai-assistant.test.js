import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { parseQuestion } from '../src/server/modules/ai/assistant.js';
import { setupCompany, startApi } from './helpers.js';
import { todayIST } from '../src/shared/dates.js';

// Part 28.02: the AI assistant and role copilots on the 28.01 gateway.
// T-01 the assistant refuses data outside the person's scope, and drafts are saved as DRAFT records; FR-01 what the panel offers follows the
// enablement; FR-02 a question becomes a governed query, shown with the answer and its citations; BR-01 no data → says so without a model;
// FR-03 drafts saved into their module only on confirmation; FR-04 copilots; FR-05 feedback; the kill switch stops the assistant too.
const A = '/api/v1/ai';
// PACK-W0-01: an RFI's required-by date must be today or later; a fixed '2027-01-15' would fail from 16 January 2027 (and did on the
// year-end clock job), so it is 60 days after the application's today
const REQUIRED_BY = new Date(Date.parse(`${todayIST()}T00:00:00Z`) + 60 * 86_400_000).toISOString().slice(0, 10);
const W = '/api/v1/workflow';
let seq = 0; const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `as-${Date.now().toString(36)}-${(seq += 1)}` });
const as = (roles, user) => ({ roles, user, company: '1' });
const sys = as('SYSADM', 'as-sys'); const dir = as('DIR', 'as-dir'); const pm = as('PM', 'as-pm'); const se = as('SE', 'as-se'); const aud = as('AUD', 'as-aud');
const opened = []; after(async () => { for (const a of opened) await a.close(); });

async function setup() {
  const api = await startApi(); opened.push(api); await setupCompany(api); const { db } = api;
  for (const [n, r] of [['as-sys', 'SYSADM'], ['as-dir', 'DIR'], ['as-pm', 'PM'], ['as-se', 'SE'], ['as-aud', 'AUD']]) db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify([r]), `${n}@example.com`);
  const fl = db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES (?, 1, 'Assistant fixture', 0, 1)");
  for (const code of ['ff.bi.p2701', 'ff.bi.p2702', 'ff.bi.p2703', 'ff.bi.p2708', 'ff.ai.p2801', 'ff.ai.p2802']) fl.run(code);
  db.exec("INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at) VALUES (1,'G1','Platform','PASSED','test',CURRENT_TIMESTAMP),(1,'G2','Workforce','PASSED','test',CURRENT_TIMESTAMP)");
  const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'AS-01', 'Assistant Tower', 'BUILDING', 'ACTIVE')").run().lastInsertRowid);
  db.prepare("INSERT INTO proj_projects (company_id, project_id, status, lifecycle_state, pm_user, contract_value, start_date, scheduled_completion, created_by) VALUES (1, ?, 'APPROVED', 'EXECUTION', 'as-pm', 100000000, '2026-01-01', '2027-12-31', 'test')").run(pid);
  db.prepare("INSERT INTO ctl_facts (company_id, org_project_id, resource_type, budget_qty, budget_cost, earned_cost, actual_qty, actual_cost) VALUES (1, ?, 'MATERIAL', 100000, 10000000, 5000000, 60000, 7000000)").run(pid);
  db.prepare("INSERT INTO core_connectors (company_id, code, name, type, provider, environment, config_json, status) VALUES (1, 'ai.box', 'Sandbox', 'ai', 'sandbox', 'development', ?, 'ENABLED')").run(JSON.stringify({ model: 'sandbox-1' }));
  const call = (who, method, path, body) => api.call(method, path, { ...who, headers: key(), body });
  assert.equal((await call(sys, 'POST', `${A}/providers`, { code: 'box', provider: 'sandbox', model: 'sandbox-1', connector: 'ai.box', priceInPerMTok: 300, priceOutPerMTok: 1500 })).status, 201);
  return { api, db, pid, call };
}
/** Enable a feature the 28.01 way: version, evaluation, SYSADM sends, DIR approves. */
async function enable(t, code, roles = ['PM', 'DIR']) {
  const f = await t.call(sys, 'POST', `${A}/features`, { code, providerCode: 'box', roles, quota: { perUserDaily: 100, monthlyBudget: 1000, alertPct: 80 } });
  assert.equal(f.status, 201, JSON.stringify(f.json));
  const ev = await t.call(sys, 'POST', `${A}/features/${f.json.data.id}/evaluate`); assert.equal(ev.json.data.evaluation?.passed, true, `${code}: ${JSON.stringify(ev.json.data.evaluation ?? ev.json)}`);
  assert.equal((await t.call(sys, 'POST', `${A}/features/${f.json.data.id}/submit`)).status, 200);
  const task = (await t.api.call('GET', `${W}/tasks?mine=assigned`, dir)).json.data.rows.find((x) => x.instance?.docId === String(f.json.data.id) || x.instance?.docRef === f.json.data.docNo) ?? (await t.api.call('GET', `${W}/tasks?mine=assigned`, dir)).json.data.rows[0];
  assert.equal((await t.api.call('POST', `${W}/tasks/${task.id}/act`, { ...dir, headers: key(), body: { action: 'approve', comment: 'ok' } })).status, 200);
}

test('the question parser turns plain words into governed queries', () => {
  assert.deepEqual(parseQuestion('What is the cement stock at Site A?'), { intent: 'STOCK', item: 'cement', place: 'site a' });
  assert.deepEqual(parseQuestion('How much TMT steel is left in MTR store?'), { intent: 'STOCK', item: 'tmt steel', place: 'mtr store' });
  assert.deepEqual(parseQuestion('What is the SPI of AS-01?', ['AS-01']), { intent: 'METRIC', metric: 'spi', project: 'AS-01' });
  assert.deepEqual(parseQuestion('Why is AS-01 over budget', ['AS-01']), { intent: 'VARIANCE', project: 'AS-01', kpi: 'cost' });
  assert.equal(parseQuestion('Show the status of all projects').intent, 'PROJECT_STATUS');
  assert.equal(parseQuestion('Tell me a joke').intent, 'UNKNOWN');
});

test('T-01 FR-01 FR-02 BR-01 FR-05 governed answers with the query and citations; refuses out of scope; no data → no model; feedback; kill switch', async () => {
  const t = await setup();
  await enable(t, 'ai.assistant');
  const me = (await t.call(pm, 'GET', `${A}/assistant/me`)).json.data; assert.deepEqual([me.ask, me.draft, me.killSwitch], [true, false, false]);
  assert.equal((await t.call(se, 'GET', `${A}/assistant/me`)).json.data.ask, false, 'the panel offers nothing the role is not enabled for');
  const ans = await t.call(pm, 'POST', `${A}/assistant/ask`, { question: 'What is the status of the projects?' });
  assert.equal(ans.status, 200, JSON.stringify(ans.json));
  assert.equal(ans.json.data.meta.query, 'dataset(project-status).fields(code,name,state,status,health)', 'FR-02: the generated query is shown');
  assert.ok(ans.json.data.sources.some((s) => /AS-01/.test(s.label)), 'the answer cites the records'); assert.equal(ans.json.data.label, 'AI-generated — verify');
  const why = await t.call(pm, 'POST', `${A}/assistant/ask`, { question: 'Why is AS-01 over budget?' });
  assert.equal(why.status, 200); assert.equal(why.json.data.meta.query, 'why(cost).project(AS-01)'); assert.match(why.json.data.text, /total/);
  // T-01: a project the person may not see is refused before any lookup, and logged
  const out = await t.call(pm, 'POST', `${A}/assistant/ask`, { question: 'Why is ZZ-999 over budget?' });
  assert.equal(out.status, 404); assert.equal(out.json.error.code, 'AI_CONTEXT_REFUSED');
  assert.equal((await t.call(pm, 'POST', `${A}/assistant/ask`, { question: 'What is the SPI?', projectId: 987654 })).status, 404);
  // BR-01: no data → says so, no model call
  const unk = await t.call(pm, 'POST', `${A}/assistant/ask`, { question: 'Who will win the cricket match?' });
  assert.equal(unk.status, 200); assert.equal(unk.json.data.unsure, true); assert.equal(unk.json.data.tokens.in, 0);
  assert.equal(t.db.prepare('SELECT block_reason FROM ai_logs WHERE id = ?').get(unk.json.data.logId).block_reason, 'NO_DATA');
  // FR-05: thumbs on one's own answers only
  assert.equal((await t.call(pm, 'POST', `${A}/feedback`, { logId: ans.json.data.logId, rating: 1, comment: 'Clear' })).status, 200);
  assert.equal((await t.call(pm, 'POST', `${A}/feedback`, { logId: why.json.data.logId, rating: -1 })).status, 200);
  assert.equal((await t.call(dir, 'POST', `${A}/feedback`, { logId: ans.json.data.logId, rating: 1 })).status, 403);
  const fb = (await t.call(aud, 'GET', `${A}/feedback`)).json.data; assert.deepEqual([fb[0].feature, fb[0].up, fb[0].down], ['ai.assistant', 1, 1]);
  // the kill switch stops the assistant too
  assert.equal((await t.call(dir, 'POST', `${A}/controls/kill-switch`, { on: true, reason: 'Testing the stop' })).status, 200);
  assert.equal((await t.call(pm, 'POST', `${A}/assistant/ask`, { question: 'What is the status of the projects?' })).status, 423);
  assert.equal((await t.call(pm, 'GET', `${A}/assistant/me`)).json.data.killSwitch, true);
});

test('T-01 FR-03 FR-04 drafts become DRAFT records only on confirmation; copilots answer from the person\'s figures', async () => {
  const t = await setup();
  await enable(t, 'ai.draft_document', ['PM', 'DIR', 'SE']); await enable(t, 'ai.copilot_finance');
  // the save runs with the person's own module rights: a PM may not raise RFIs, a site engineer may
  const pmDraft = await t.call(pm, 'POST', `${A}/drafts`, { kind: 'RFI', projectId: t.pid, brief: 'Ask the consultant to confirm the cover to raft reinforcement.' });
  assert.equal((await t.call(pm, 'POST', `${A}/drafts/${pmDraft.json.data.draftId}/save`, { subject: 'Cover to raft', discipline: 'STRUCTURAL', requiredBy: REQUIRED_BY })).status, 403, 'the module refuses the PM (engg.rfi.create)');
  const d = await t.call(se, 'POST', `${A}/drafts`, { kind: 'RFI', projectId: t.pid, brief: 'Ask the structural consultant to confirm the lap length of the raft reinforcement.' });
  assert.equal(d.status, 201, JSON.stringify(d.json)); assert.equal(d.json.data.canSave, true); assert.equal(d.json.data.label, 'AI-generated — verify');
  assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM engg_rfis').get().n, 0, 'nothing is created before the person confirms');
  assert.equal((await t.call(dir, 'POST', `${A}/drafts/${d.json.data.draftId}/save`, { subject: 'Lap length', discipline: 'STRUCTURAL', requiredBy: REQUIRED_BY })).status, 404, 'only the person who asked saves it');
  const saved = await t.call(se, 'POST', `${A}/drafts/${d.json.data.draftId}/save`, { subject: 'Lap length of raft reinforcement', discipline: 'STRUCTURAL', requiredBy: REQUIRED_BY });
  assert.equal(saved.status, 201, JSON.stringify(saved.json)); assert.equal(saved.json.data.status, 'DRAFT');
  assert.equal(t.db.prepare('SELECT status FROM engg_rfis WHERE id = ?').get(saved.json.data.id).status, 'DRAFT', 'T-01: saved as a DRAFT of the module');
  assert.equal((await t.call(se, 'POST', `${A}/drafts/${d.json.data.draftId}/save`, { subject: 'Again' })).status, 422, 'once only');
  const rfq = await t.call(pm, 'POST', `${A}/drafts`, { kind: 'RFQ', projectId: t.pid, brief: 'Quotation for 200 t of TMT bars Fe500D delivered to site.' });
  assert.equal((await t.call(pm, 'POST', `${A}/drafts/${rfq.json.data.draftId}/save`, { subject: 'TMT bars' })).status, 422, 'kinds without a module target stay text');
  assert.equal((await t.call(pm, 'POST', `${A}/drafts/${rfq.json.data.draftId}/discard`)).status, 200);
  assert.deepEqual((await t.call(pm, 'GET', `${A}/drafts`)).json.data.map((x) => x.status).sort(), ['DISCARDED', 'PROPOSED']);
  assert.deepEqual((await t.call(se, 'GET', `${A}/drafts`)).json.data.map((x) => x.status), ['APPLIED']);
  assert.equal((await t.call(pm, 'POST', `${A}/drafts`, { kind: 'RFI', projectId: 987654, brief: 'Outside my projects entirely, please draft.' })).status, 404);
  // FR-04: the finance copilot reads the Why? as the person; a role not enabled gets nothing
  const fin = await t.call(dir, 'POST', `${A}/copilots/finance`, { projectId: t.pid });
  assert.equal(fin.status, 200, JSON.stringify(fin.json)); assert.match(fin.json.data.text, /costVariance/); assert.equal(fin.json.data.sources[0].type, 'bi.explain');
  assert.equal((await t.call(se, 'POST', `${A}/copilots/finance`, { projectId: t.pid })).status, 403);
  assert.equal((await t.call(pm, 'POST', `${A}/copilots/qs`, { projectId: t.pid })).status, 403, 'a copilot not enabled');
});
