import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';
import { enableFlags } from './tst-fixtures.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { publishEvent } from '../src/server/platform/events/index.js';
import { tstOf } from '../src/server/modules/tst/index.js';
import { checkParity } from '../src/server/modules/tst/envparity.js';

// Part 30.08: environments as code and their parity, deployments (BR-01 production only through the pipeline), the zero-downtime rehearsal
// record, runbooks versioned by content and approved by another person, the on-call rota paged by alerts with escalation, roles, export.
const T = '/api/v1/tst/ops';
const opened = []; after(async () => { for (const a of opened) await a.close(); });
let seq = 0; const key = () => ({ 'idempotency-key': `ops-${Date.now().toString(36)}-${(seq += 1)}` });
const devops = { roles: 'ITADM', user: 'devops1' }; const sys = { roles: 'SYSADM', user: 'sys1' }; const aud = { roles: 'AUD', user: 'aud1' }; const pm = { roles: 'PM', user: 'pm1' };
const pipeline = { roles: 'ITADM', user: 'pipeline:release' };
async function boot() {
  const api = await startApi(); opened.push(api); await setupCompany(api); enableFlags(api.db, 1, ['ff.qa.p3008']);
  for (const [u, r] of [['devops1', 'ITADM'], ['sys1', 'SYSADM'], ['l1-anita', 'ITADM'], ['l2-ravi', 'ITADM'], ['l3-vendor', 'ITADM']]) api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(u, u, JSON.stringify([r]), `${u}@example.com`);
  return { api, d: api.db, call: (who, method, path, body) => api.call(method, `${T}${path}`, { ...who, headers: key(), body }) };
}
const t0 = () => new Date(Date.now() - 60_000).toISOString(); const t1 = () => new Date().toISOString();
const SHA = 'a'.repeat(64);

test('FR-01 the environments are code: five environment files with the same keys, no secret, accepted by the application; compose and alerts are valid', () => {
  const p = checkParity();
  assert.deepEqual(p.environments, ['dev', 'production', 'sandbox', 'staging', 'test']); assert.deepEqual(p.problems, []);
  for (const e of Object.values(p.envs)) for (const k of ['AUTH_SECRET', 'VAULT_KEY', 'FILE_URL_SECRET']) assert.equal(k in e, false);
  assert.equal(p.envs.sandbox.ERP_SANDBOX, 'true'); assert.match(p.envs.sandbox.DATABASE_PATH, /sandbox/); assert.equal(p.envs.production.AUTH_MODE, 'iam');
  const docker = readFileSync('Dockerfile', 'utf8'); assert.match(docker, /HEALTHCHECK/); assert.match(docker, /USER node/);
  const alerts = readFileSync('infra/monitoring/alerts.yml', 'utf8');
  // every metric an alert uses is exported by the application's /metrics (or by the blackbox prober, named as such)
  const used = [...new Set(alerts.match(/\berp_[a-z_]+/g))];
  const app = readFileSync('src/server/app.js', 'utf8') + readFileSync('src/server/platform/observability/metrics.js', 'utf8');
  assert.deepEqual(used.filter((m) => !app.includes(m.replace(/_bucket$/, ''))), []);
  let compose = true; try { execFileSync('docker', ['--version'], { stdio: 'ignore' }); } catch { compose = false; }
  if (compose) {
    const env = { ...process.env, ERP_ENV: 'staging', AUTH_SECRET: 'x', VAULT_KEY: 'y', FILE_URL_SECRET: 'z', HEALTH_TOKEN: 'h' };
    execFileSync('docker', ['compose', '-f', 'docker-compose.yml', 'config', '--quiet'], { env, stdio: 'pipe' });
    const noVault = { ...env }; delete noVault.AUTH_SECRET;
    assert.throws(() => execFileSync('docker', ['compose', '-f', 'docker-compose.yml', 'config', '--quiet'], { env: noVault, stdio: 'pipe' }), 'without the vault\'s secrets the stack does not start');
  }
});

test('FR-02 BR-01 deployments: production only from the pipeline with its run and artefact; the inventory follows; a rehearsal is recorded', async () => {
  const t = await boot();
  let o = (await t.call(aud, 'GET', '')).json.data;
  assert.deepEqual(o.environments.map((e) => [e.code, e.parity, e.status]), [['production', 'OK', 'PLANNED'], ['staging', 'OK', 'PLANNED'], ['test', 'OK', 'PLANNED'], ['sandbox', 'OK', 'PLANNED'], ['dev', 'OK', 'PLANNED']]);
  const base = { environment: 'production', kind: 'DEPLOY', buildId: 'b-101', version: '1.4.0', commitRef: 'abc1234', status: 'SUCCEEDED', slot: 'green', startedAt: t0(), finishedAt: t1() };
  assert.equal((await t.call(devops, 'POST', '/deployments', { ...base, pipelineRun: 'gh:run/42', artifactSha256: SHA })).status, 403, 'a person does not change production');
  assert.equal((await t.call(pipeline, 'POST', '/deployments', base)).status, 422, 'the run and the artefact are named');
  const ok = await t.call(pipeline, 'POST', '/deployments', { ...base, pipelineRun: 'gh:run/42', artifactSha256: SHA, steps: [{ step: 'migrate', result: 'PASS', ms: 900 }, { step: 'switch', result: 'PASS', ms: 40 }] });
  assert.equal(ok.status, 201, JSON.stringify(ok.json)); assert.deepEqual([ok.json.data.deployNo, ok.json.data.status, ok.json.data.durationMs > 0], ['DEP-00001', 'SUCCEEDED', true]);
  assert.equal((await t.call(devops, 'POST', '/deployments', { ...base, environment: 'staging' })).status, 201, 'staging from DevOps is fine');
  const rh = await t.call(devops, 'POST', '/rehearsals', { environment: 'staging', kind: 'ZERO_DOWNTIME', ok: true, requests: 3352, failed: 0, steps: [{ name: 'deploy B under traffic', ok: true, ms: 8440, detail: '0 failed' }, { name: 'roll back under traffic', ok: true, ms: 1461, detail: 'down-migrations' }] });
  assert.equal(rh.status, 201, JSON.stringify(rh.json)); assert.deepEqual([rh.json.data.kind, rh.json.data.requests, rh.json.data.failedRequests], ['REHEARSAL', 3352, 0]);
  o = (await t.call(devops, 'GET', '')).json.data;
  const prod = o.environments.find((e) => e.code === 'production'); assert.deepEqual([prod.status, prod.activeBuild, prod.activeSlot], ['PROVISIONED', 'b-101', 'green']);
  assert.equal(o.lastRehearsal.requests, 3352); assert.equal(o.byEnv.find((x) => x.code === 'production').succeeded, 1);
  assert.equal((await t.call(devops, 'GET', '?environment=production')).json.data.deployments.total, 1);
  assert.ok(t.d.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'ops.deployment.recorded'").get());
  const x = await t.api.raw('GET', `${T}/export?format=csv`, aud); assert.equal(x.status, 200); assert.match(x.buffer.toString('utf8'), /gh:run\/42/);
});

test('FR-04 FR-05 AC-01 runbooks: every file synced as a version; submitted by DevOps, approved by the system administrator; an unchanged file makes no new version', async () => {
  const t = await boot();
  const s = await t.call(devops, 'POST', '/runbooks/sync', {}); assert.equal(s.status, 201); assert.ok(s.json.data.files >= 11); assert.equal(s.json.data.drafts, s.json.data.files);
  assert.equal((await t.call(devops, 'POST', '/runbooks/sync', {})).json.data.drafts, 0, 'nothing changed');
  for (const code of ['deploy', 'rollback', 'restore', 'scale', 'rotate-secrets', 'certificate-renewal', 'incident-response', 'period-end-support', 'payroll-day-support', 'support-model', 'environments']) {
    const sub = await t.call(devops, 'POST', `/runbooks/${code}/submit`, { reason: 'Reviewed with the operations team' }); assert.equal(sub.status, 201, `${code}: ${JSON.stringify(sub.json)}`);
    assert.equal((await t.call(devops, 'POST', `/runbook-requests/${sub.json.data.request.id}/act`, { action: 'approve' })).status, 403, 'the submitter never approves');
    assert.equal((await t.call(sys, 'POST', `/runbook-requests/${sub.json.data.request.id}/act`, { action: 'approve', comment: 'Approved' })).json.data.status, 'APPROVED');
  }
  const rb = (await t.call(aud, 'GET', '/runbooks/deploy')).json.data; assert.deepEqual([rb.status, rb.versionNo, rb.approved.by, rb.changedSinceApproved], ['APPROVED', 1, 'sys1', false]); assert.match(rb.text, /blue-green/);
  const o = (await t.call(aud, 'GET', '')).json.data; assert.equal(o.runbooksApproved, o.runbooks.length);
  assert.equal((await t.call(devops, 'POST', '/runbooks/deploy/submit', { reason: 'Again please' })).status, 409, 'only a draft is submitted');
  assert.equal((await t.call(devops, 'POST', '/runbooks/nothing-here/submit', { reason: 'Not a runbook' })).status, 404);
  assert.equal((await t.call(sys, 'POST', '/runbooks/sync', {})).status, 403, 'SYSADM approves; does not author');
  assert.ok(t.d.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'ops.runbook.approved'").get());
});

test('FR-03 alerts page the on-call engineer; an unacknowledged page escalates; acknowledgement stops it and acknowledges the alert', async () => {
  const t = await boot();
  const now = Date.now(); const iso = (ms) => new Date(now + ms).toISOString();
  assert.equal((await t.call(devops, 'POST', '/oncall', { username: 'l2-ravi', level: 'L2', fromAt: iso(-3600e3), toAt: iso(8 * 3600e3) })).status, 201);
  assert.equal((await t.call(devops, 'POST', '/oncall', { username: 'l3-vendor', level: 'L3', fromAt: iso(-3600e3), toAt: iso(8 * 3600e3) })).status, 201);
  assert.equal((await t.call(devops, 'POST', '/oncall', { username: 'nobody-here', level: 'L1', fromAt: iso(0), toAt: iso(3600e3) })).status, 400);
  assert.equal((await t.call(devops, 'POST', '/oncall', { username: 'l1-anita', level: 'L1', fromAt: iso(3600e3), toAt: iso(0) })).status, 400);
  await t.call(devops, 'GET', ''); // the inventory exists for this company
  const alertId = Number(t.d.prepare("INSERT INTO core_alerts (rule_code, dedupe_key, severity, message, value, threshold, status, fired_at, notified_json) VALUES ('error_rate', 'k1', 'critical', '5xx above 2 %', 4, '2', 'OPEN', ?, '[]')").run(new Date().toISOString()).lastInsertRowid);
  publishEvent(t.d, { type: 'core.alert.fired', entity: 'alert', entityId: alertId, actorId: 'system', data: { rule: 'error_rate', severity: 'critical', message: '5xx above 2 %', channels: ['email'] } });
  await runtimeOf(t.d).bus.drain();
  let o = (await t.call(devops, 'GET', '')).json.data;
  assert.deepEqual(o.oncall.pages.map((p) => [p.level, p.username, p.status]), [['L2', 'l2-ravi', 'SENT']]); assert.equal(o.oncall.now.L2, 'l2-ravi');
  assert.ok(t.d.prepare("SELECT 1 FROM ntf_notifications WHERE template_code = 'ops.oncall.page'").get() || t.d.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'ops.oncall.paged'").get());
  // fifteen minutes later with no acknowledgement: L3
  const ops = tstOf(t.d).ops;
  assert.equal(ops.escalate(now + 5 * 60_000), 0, 'not yet');
  assert.equal(ops.escalate(now + 16 * 60_000), 1);
  o = (await t.call(devops, 'GET', '')).json.data; assert.deepEqual(o.oncall.pages.map((p) => [p.level, p.status]), [['L3', 'SENT'], ['L2', 'ESCALATED']]);
  // a warning with no L1 on shift is recorded as uncovered (and escalates to L2)
  const w = Number(t.d.prepare("INSERT INTO core_alerts (rule_code, dedupe_key, severity, message, value, threshold, status, fired_at, notified_json) VALUES ('disk_free', 'k2', 'warning', 'disk 14 %', 14, '15', 'OPEN', ?, '[]')").run(new Date().toISOString()).lastInsertRowid);
  ops.onAlert({ entityId: w, data: { rule: 'disk_free', severity: 'warning', message: 'disk 14 %' } });
  assert.equal(t.d.prepare('SELECT status FROM ops_pages WHERE alert_id = ?').get(w).status, 'UNCOVERED');
  const l3 = o.oncall.pages[0];
  assert.equal((await t.call(pm, 'POST', `/pages/${l3.id}/acknowledge`, {})).status, 403);
  assert.equal((await t.call(sys, 'POST', `/pages/${l3.id}/acknowledge`, {})).json.data.status, 'ACKNOWLEDGED');
  assert.equal(t.d.prepare('SELECT acknowledged_by FROM core_alerts WHERE id = ?').get(alertId).acknowledged_by, 'sys1');
  assert.equal((await t.call(sys, 'POST', `/pages/${l3.id}/acknowledge`, {})).status, 409);
  assert.equal(ops.escalate(now + 60 * 60_000), 1, 'only the uncovered warning still escalates');
});

test('AC-03 roles: DevOps manages; SYSADM approves and acknowledges; the auditor reads; others are refused; the flag hides it', async () => {
  const t = await boot();
  assert.equal((await t.call(pm, 'GET', '')).status, 403);
  assert.deepEqual((await t.call(aud, 'GET', '')).json.data.can, { record: false, manage: false, oncall: false, ack: false, export: true });
  assert.deepEqual((await t.call(devops, 'GET', '')).json.data.can, { record: true, manage: true, oncall: true, ack: true, export: true });
  assert.equal((await t.call(sys, 'POST', '/oncall', { username: 'l2-ravi', level: 'L2', fromAt: t0(), toAt: t1() })).status, 403);
  assert.equal((await t.call(aud, 'POST', '/deployments', { environment: 'test', kind: 'DEPLOY', status: 'SUCCEEDED', startedAt: t0(), finishedAt: t1() })).status, 403);
  assert.equal((await t.call({ ...devops, company: '2' }, 'GET', '')).status, 404);
});
