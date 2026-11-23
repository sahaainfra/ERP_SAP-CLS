import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';
import { enableFlags } from './tst-fixtures.js';
import { loadConfig } from '../src/server/platform/config/index.js';
import { integrationsOf } from '../src/server/platform/integrations/index.js';
import { loadVapid } from '../src/server/platform/push/index.js';
import { assertOutboundAllowed, sandboxOf } from '../src/server/platform/sandbox/index.js';
import { PACKS } from '../src/server/modules/tst/sandbox.js';

// Part 30.04 FR-03 FR-04 FR-05 BR-01 T-01: the simulation sandbox. The synthetic company with twelve months of transactions and referential
// integrity, the one-click reset, the three scenario packs executed through the API with their expected KPI values, and the isolation
// (nothing leaves a sandbox; a real installation refuses all of it).
const T = '/api/v1/tst';
const opened = []; after(async () => { for (const a of opened) await a.close(); });
let seq = 0; const key = () => ({ 'idempotency-key': `sbx-${Date.now().toString(36)}-${(seq += 1)}` });
const qa = { roles: 'ITADM', user: 'qa1' }; const trainer = { roles: 'HRMGR', user: 'trainer1' }; const pm = { roles: 'PM', user: 'pm1' }; const aud = { roles: 'AUD', user: 'aud1' }; const sys = { roles: 'SYSADM', user: 'sys1' };
async function boot(overrides = { ERP_SANDBOX: 'true' }) {
  const api = await startApi(overrides); opened.push(api); await setupCompany(api);
  enableFlags(api.db, 1, ['ff.qa.p3004']);
  const call = (who, method, path, body) => api.call(method, `${T}${path}`, { ...who, headers: key(), body });
  return { api, call, d: api.db };
}
const sandboxCompanies = (d) => d.prepare("SELECT id, code FROM org_companies WHERE code LIKE 'SBX-%' ORDER BY id").all();

test('T-01 FR-03 FR-04 the generator builds a company with twelve months of transactions and integrity; each scenario pack gives its expected KPI values through the API', async () => {
  const t = await boot();
  const g = await t.call(qa, 'POST', '/sandbox/generate', { months: 12 }); assert.equal(g.status, 201, JSON.stringify(g.json));
  const run = g.json.data; assert.deepEqual([run.kind, run.status, run.counts.projects, run.counts.dprs, run.counts.movements, run.counts.integrity], ['GENERATE', 'DONE', 4, 48, 96, 0], JSON.stringify(run));
  const co = run.counts.companyId; assert.equal(sandboxCompanies(t.d).length, 1);
  assert.equal(t.d.prepare("SELECT COUNT(DISTINCT substr(dpr_date, 1, 7)) AS n FROM site_dprs WHERE company_id = ?").get(co).n >= 12, true, 'twelve months of reports');
  assert.equal(t.d.prepare('SELECT COUNT(*) AS n FROM inv_stock_ledger WHERE company_id = ?').get(co).n, 96, 'the movements went through the stock engine');
  assert.ok(t.d.prepare('SELECT COUNT(*) AS n FROM prs_activity_progress WHERE company_id = ?').get(co).n >= 48, 'the progress engine took every report');
  for (const table of ['org_projects', 'proj_boq_lines', 'bud_lines', 'plan_activities', 'plan_baselines', 'iam_users', 'mdm_items']) assert.ok(t.d.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE company_id = ?`).get(co).n > 0, table);
  assert.equal(t.d.prepare('PRAGMA foreign_key_check').all().length, 0, 'referential integrity');
  for (const [pack, p] of Object.entries(PACKS)) {
    const r = await t.call(pack === 'HIGH_WASTAGE' ? qa : trainer, 'POST', '/sandbox/scenarios', { pack }); assert.equal(r.status, 201, JSON.stringify(r.json));
    const s = r.json.data; assert.deepEqual([s.kind, s.status, s.result, s.error], ['SCENARIO', 'DONE', 'PASS', null], JSON.stringify(s));
    for (const [k, v] of Object.entries(p.kpis)) assert.equal(s.actual[k], v, `${pack} ${k}`);
    assert.ok(s.actual.checks.every((c) => c.pass));
  }
  // the thread really ran through the modules: periods approved by the PM, a reconciliation drafted by the QS
  assert.equal(t.d.prepare("SELECT COUNT(*) AS n FROM prs_periods WHERE company_id = ? AND status = 'APPROVED' AND closed_by = ?").get(co, `sbx${co}.pm`).n, 2);
  assert.equal(t.d.prepare('SELECT COUNT(*) AS n FROM mrc_reconciliations WHERE company_id = ?').get(co).n, 1);
  const st = (await t.call(trainer, 'GET', '/sandbox')).json.data;
  assert.deepEqual([st.sandbox, st.runnerReady, st.companies.length, st.packs.map((x) => [x.code, x.last?.result])], [true, true, 1, [['DELAYED', 'PASS'], ['LOSS_MAKING', 'PASS'], ['HIGH_WASTAGE', 'PASS']]]);
  assert.ok(st.runs.length >= 4); assert.ok(t.d.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'tst_sandbox_runs' AND action = 'scenario'").get(), 'audited');
});

test('FR-03 one-click reset removes every synthetic company with all its rows and generates a fresh one; the real company is untouched', async () => {
  const t = await boot();
  await t.call(qa, 'POST', '/sandbox/generate', { months: 2 });
  const first = sandboxCompanies(t.d)[0];
  assert.equal((await t.call(qa, 'POST', '/sandbox/reset', {})).status, 400, 'the reset is confirmed');
  const r = await t.call(qa, 'POST', '/sandbox/reset', { confirm: 'RESET' }); assert.equal(r.status, 201, JSON.stringify(r.json));
  const out = r.json.data; assert.deepEqual([out.kind, out.status, out.error], ['RESET', 'DONE', null]); assert.equal(out.counts.removed.companies, 1); assert.ok(out.counts.removed.rows > 100);
  const now = sandboxCompanies(t.d); assert.equal(now.length, 1); assert.notEqual(now[0].id, first.id);
  for (const table of ['org_projects', 'site_dprs', 'inv_stock_ledger', 'iam_users', 'core_feature_flags']) assert.equal(t.d.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE company_id = ?`).get(first.id).n, 0, `${table} of the old company is gone`);
  assert.equal(t.d.prepare('PRAGMA foreign_key_check').all().length, 0);
  assert.ok(t.d.prepare("SELECT 1 FROM core_feature_flags WHERE company_id = 1 AND key = 'ff.qa.p3004' AND enabled = 1").get(), 'the real company is untouched');
  assert.ok(t.d.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'tst_sandbox_runs' AND action = 'reset'").get(), 'the reset is in the trail');
});

test('FR-05 BR-01 a sandbox runs only on its own database, never in production; nothing leaves it; the shell is told it is a sandbox', async () => {
  const base = { NODE_ENV: 'development', AUTH_MODE: 'dev-headers', ERP_SANDBOX: 'true' };
  assert.throws(() => loadConfig({ ...base, DATABASE_PATH: 'data/erp.sqlite' }), /database of its own/);
  assert.throws(() => loadConfig({ ...base, NODE_ENV: 'production', DATABASE_PATH: 'data/sandbox.sqlite' }), /not allowed when NODE_ENV=production/);
  assert.equal(loadConfig({ ...base, DATABASE_PATH: 'data/sandbox.sqlite' }).sandbox, true);
  assert.equal(loadConfig({ NODE_ENV: 'development', DATABASE_PATH: 'data/erp.sqlite' }).sandbox, false);
  assert.equal(loadVapid({ config: { sandbox: true, push: { publicKey: 'x', privateKey: 'y', subject: 'mailto:a@b.c' } }, dir: '/nonexistent' }), null, 'no web push');

  const t = await boot();
  const s = sandboxOf(t.d); assert.deepEqual([s.on, s.wired.sort()], [true, ['identity', 'integrations', 'push', 'webhooks']]);
  assert.equal((await t.api.call('GET', '/api/v1/core/session', sys)).json.data.sandbox, true, 'the banner');
  // an integration (e-mail, SMS, bank, GPS …) cannot reach its provider: the hub's fetch is refused and counted
  t.d.prepare("INSERT INTO core_connectors (company_id, code, name, type, provider, environment, config_json, status) VALUES (1, 'gps.fleet', 'Fleet GPS', 'maps', 'telematics_http', 'development', ?, 'ENABLED')").run(JSON.stringify({ baseUrl: 'http://127.0.0.1:9' }));
  await assert.rejects(integrationsOf(t.d).hub.call('gps.fleet', 'readings', { since: '2026-01-01T00:00:00Z' }, { companyId: 1 }));
  assert.ok(s.blocked.http >= 1, JSON.stringify(s.blocked)); assert.match(s.last[0].target, /127\.0\.0\.1/);
  assert.throws(() => assertOutboundAllowed(t.d, 'webhooks', 'https://client.example.com/hook'), (e) => e.code === 'SANDBOX_BLOCKED'); assert.equal(s.blocked.webhooks, 1);
  const st = (await t.call(qa, 'GET', '/sandbox')).json.data; assert.ok(st.blocked.http >= 1); assert.equal(st.blocked.webhooks, 1);

  // a real installation: no banner, nothing generated, reset or run (409); nothing is blocked
  const real = await boot({});
  assert.equal(sandboxOf(real.d), null); assert.equal((await real.api.call('GET', '/api/v1/core/session', sys)).json.data.sandbox, undefined);
  assert.doesNotThrow(() => assertOutboundAllowed(real.d, 'webhooks', 'https://client.example.com/hook'));
  for (const [path, body] of [['/sandbox/generate', {}], ['/sandbox/reset', { confirm: 'RESET' }], ['/sandbox/scenarios', { pack: 'DELAYED' }]]) {
    const r = await real.call(qa, 'POST', path, body); assert.equal(r.status, 409, path); assert.match(r.json.error.message, /not a sandbox/);
  }
  assert.equal((await real.call(qa, 'GET', '/sandbox')).json.data.sandbox, false);
  assert.equal(sandboxCompanies(real.d).length, 0);
  // the runner acts as the synthetic people, so a sandbox without development headers cannot run it
  const sso = await boot({ ERP_SANDBOX: 'true', AUTH_MODE: 'dev-headers' }); assert.equal((await sso.call(qa, 'GET', '/sandbox')).json.data.runnerReady, true);
});

test('AC-03 roles: QA and trainers run the sandbox; the auditor reads the catalogue only; others are refused; the flag hides it', async () => {
  const t = await boot();
  assert.equal((await t.call(pm, 'GET', '/sandbox')).status, 403);
  assert.equal((await t.call(aud, 'GET', '/sandbox')).status, 403);
  assert.equal((await t.call(aud, 'GET', '/tests')).status, 200);
  assert.equal((await t.call(trainer, 'GET', '/sandbox')).status, 200);
  assert.equal((await t.call(trainer, 'POST', '/tests/sync', {})).status, 403, 'trainers do not change the catalogue');
  assert.equal((await t.call(pm, 'POST', '/sandbox/scenarios', { pack: 'DELAYED' })).status, 403);
  assert.equal((await t.call(qa, 'POST', '/sandbox/scenarios', { pack: 'NOPE' })).status, 400);
  assert.equal((await t.call(qa, 'POST', '/sandbox/generate', { months: 30 })).status, 400);
  t.d.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.qa.p3004'").run();
  assert.equal((await t.call(qa, 'GET', '/sandbox')).status, 404); assert.equal((await t.call(qa, 'GET', '/tests')).status, 404);
});
