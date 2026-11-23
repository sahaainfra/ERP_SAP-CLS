import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { createApprovalEngine } from '../../platform/approvals/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { assertPermissionAnywhere, hasPermissionAnywhere } from '../../platform/auth/index.js';
import { transaction } from '../../platform/db/index.js';
import { eventTypes, publishEvent } from '../../platform/events/index.js';
import { FORMATS, writeExport } from '../../platform/export/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { integrityRegistry } from '../../platform/integrity/registry.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { createParameterStore, parameterRegistry } from '../../platform/parameters/index.js';
import { todayIST } from '../../../shared/dates.js';
import { checkParity, parseEnv } from './envparity.js';

/**
 * Part 30.08 — DevOps, environments, deployment and operations runbooks.
 *
 * FR-01 the environments are code (infra/environments/<env>.env, infra/ansible, docker-compose.yml, Dockerfile); the inventory reads them and
 *       their parity (envparity.js), with each environment's active build and slot from its deployments.
 * FR-02 deployments are blue-green (scripts/lib/bluegreen.mjs): every deploy, rollback and zero-downtime rehearsal is recorded here by the
 *       pipeline or the rehearsal script. BR-01: production changes only through the pipeline — a production deploy or rollback is accepted
 *       only from the pipeline's service account (`pipeline:<name>`), naming its pipeline run and the artefact's SHA-256.
 * FR-03 alerts (01.07, `core.alert.fired`) page the on-call engineer of the rota (L1 for warnings, L2 for critical alerts) in the app, by SMS
 *       and by e-mail; a page not acknowledged within `ops.oncall.ack_minutes` escalates to the next level (L1 → L2 → L3).
 * FR-04 FR-05 the runbooks (docs/erp/runbooks/*.md, the support model and SLAs among them) are versioned by their content: a changed file
 *       becomes a new draft, submitted by DevOps (ITADM) and approved by the system administrator (approval engine `ops_runbook_approval`,
 *       the submitter never approves).
 */
export const OPS_FLAG = 'ff.qa.p3008';
export const RUNBOOK_TYPE = 'ops_runbook_approval';
export const ENV_CODES = ['dev', 'test', 'staging', 'production', 'sandbox'];
const ACK_KEY = 'ops.oncall.ack_minutes';
if (!parameterRegistry.get(ACK_KEY)) parameterRegistry.define({ key: ACK_KEY, dataType: 'integer', default: 15, min: 1, max: 1440, scopes: ['system', 'company'], description: 'Part 30.08 FR-03: minutes an on-call page may wait for its acknowledgement before it escalates to the next support level.' });
integrityRegistry.register({ statuses: { ops_environments: ['PLANNED', 'PROVISIONED', 'RETIRED'], ops_deployments: ['SUCCEEDED', 'FAILED', 'ROLLED_BACK'], ops_runbooks: ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'SUPERSEDED'], ops_oncall: ['ACTIVE', 'CANCELLED'], ops_pages: ['SENT', 'ACKNOWLEDGED', 'ESCALATED', 'UNCOVERED'] } });
for (const [type, description] of [
  ['ops.deployment.recorded', 'A deploy, rollback or rehearsal of an environment was recorded (part 30.08): data { deploymentId, environment, kind, status, buildId }.'],
  ['ops.runbook.approved', 'A version of a runbook was approved (part 30.08): data { runbookId, code, versionNo }.'],
  ['ops.oncall.paged', 'An on-call engineer was paged for an alert (part 30.08): data { pageId, alertId, level, username }.'],
]) if (!eventTypes.get(type)) eventTypes.define({ type, version: 1, schema: { type: 'object' }, owner: 'tst', description });

const iso = (d = new Date()) => d.toISOString();
const sha = (s) => createHash('sha256').update(s).digest('hex');
const NEXT = { L1: 'L2', L2: 'L3', L3: null };

/** @param {any} context @param {{ root?: string, jobs?: any, scheduler?: any, bus?: any }} [options] */
export function createOpsService(context, { root = process.cwd(), jobs, scheduler, bus } = {}) {
  const { db } = context;
  const guard = (actor, key) => {
    if (!Number.isSafeInteger(actor?.companyId) || actor.companyId < 1 || !context.flags.isOn(actor, OPS_FLAG)) throw notFound('Operations runbooks and environments are not enabled for this company.');
    if (key) assertPermissionAnywhere(actor, key);
  };
  const param = (companyId, key) => Number(createParameterStore(db).get(key, { companyId, date: todayIST() }));
  const envFile = (code) => { const f = join(root, 'infra', 'environments', `${code}.env`); return existsSync(f) ? parseEnv(readFileSync(f, 'utf8')) : null; };

  // ---------------------------------------------------------------- FR-01 the inventory (seeded from the environment files)
  function ensureEnvironments(companyId) {
    for (const code of ENV_CODES) {
      if (db.prepare('SELECT 1 FROM ops_environments WHERE company_id = ? AND code = ?').get(companyId, code)) continue;
      const e = envFile(code);
      db.prepare("INSERT INTO ops_environments (company_id, code, name, url, status, created_by, source_type) VALUES (?, ?, ?, ?, 'PLANNED', 'system', 'infra')").run(companyId, code, code[0].toUpperCase() + code.slice(1), e?.PUBLIC_URL ?? null);
    }
  }
  const envRow = (companyId, code) => { ensureEnvironments(companyId); return db.prepare('SELECT * FROM ops_environments WHERE company_id = ? AND code = ?').get(companyId, code); };
  const deployView = (d) => ({ id: d.id, deployNo: d.deploy_no, environment: db.prepare('SELECT code FROM ops_environments WHERE id = ?').get(d.environment_id)?.code, kind: d.kind, method: d.method, buildId: d.build_id, version: d.version_label, commitRef: d.commit_ref, artifactSha256: d.artifact_sha256, pipelineRun: d.pipeline_run, status: d.status, startedAt: d.started_at, finishedAt: d.finished_at, durationMs: d.duration_ms, requests: d.requests_count, failedRequests: d.failed_requests, steps: (() => { try { return JSON.parse(d.steps_json ?? 'null'); } catch { return null; } })(), reason: d.reason, requestedBy: d.requested_by });

  // ---------------------------------------------------------------- FR-02 BR-01 deployments, rollbacks and rehearsals
  function recordDeployment(actor, b) {
    guard(actor, 'ops.deploy.record');
    const env = envRow(actor.companyId, b.environment);
    if (b.environment === 'production' && b.kind !== 'REHEARSAL') {
      // BR-01: only the pipeline changes production, with the run and the artefact it deployed
      if (!/^pipeline[:@-]/.test(actor.user)) throw forbidden('Production is changed only through the pipeline: this record must come from the pipeline\'s service account (BR-01).');
      if (!b.pipelineRun || !b.artifactSha256) throw unprocessable('A production deploy names its pipeline run and the SHA-256 of the artefact it deployed (BR-01).');
    }
    if (Date.parse(b.finishedAt) < Date.parse(b.startedAt)) throw badRequest('The deployment finishes before it starts.', [{ field: 'finishedAt', message: 'After startedAt' }]);
    return transaction(db, () => {
      const n = (db.prepare('SELECT COUNT(*) AS n FROM ops_deployments WHERE company_id = ?').get(actor.companyId).n ?? 0) + 1;
      const no = `DEP-${String(n).padStart(5, '0')}`;
      const id = Number(db.prepare("INSERT INTO ops_deployments (company_id, deploy_no, environment_id, kind, method, build_id, version_label, commit_ref, artifact_sha256, pipeline_run, status, started_at, finished_at, duration_ms, requests_count, failed_requests, steps_json, reason, requested_by, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pipeline')")
        .run(actor.companyId, no, env.id, b.kind, b.method ?? 'BLUE_GREEN', b.buildId ?? null, b.version ?? null, b.commitRef ?? null, b.artifactSha256 ?? null, b.pipelineRun ?? null, b.status, b.startedAt, b.finishedAt, Math.max(0, Date.parse(b.finishedAt) - Date.parse(b.startedAt)), b.requests ?? null, b.failedRequests ?? null, b.steps ? JSON.stringify(b.steps.slice(0, 40)) : null, b.reason ?? null, actor.user, actor.user).lastInsertRowid);
      if (b.kind !== 'REHEARSAL' && b.status === 'SUCCEEDED') db.prepare("UPDATE ops_environments SET status = 'PROVISIONED', active_build = ?, active_slot = ?, last_deploy_at = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?").run(b.buildId ?? null, b.slot ?? null, b.finishedAt, iso(), actor.user, env.id);
      writeAudit(db, { companyId: actor.companyId, entity: 'ops_deployments', entityId: id, action: b.kind.toLowerCase(), newValues: { environment: b.environment, buildId: b.buildId, status: b.status, pipelineRun: b.pipelineRun ?? null }, actor: actor.user });
      publishEvent(db, { type: 'ops.deployment.recorded', entity: 'ops_deployments', entityId: id, actorId: actor.user, companyId: actor.companyId, data: { deploymentId: id, environment: b.environment, kind: b.kind, status: b.status, buildId: b.buildId ?? null } });
      return deployView(db.prepare('SELECT * FROM ops_deployments WHERE id = ?').get(id));
    });
  }
  /** The zero-downtime rehearsal script's report (scripts/rehearse_zero_downtime.mjs --post). */
  function recordRehearsal(actor, b) {
    const now = iso();
    return recordDeployment(actor, { environment: b.environment, kind: 'REHEARSAL', method: 'BLUE_GREEN', status: b.ok ? 'SUCCEEDED' : 'FAILED', startedAt: new Date(Date.now() - b.steps.reduce((a, s) => a + s.ms, 0)).toISOString(), finishedAt: now, requests: b.requests, failedRequests: b.failed, steps: b.steps.map((s) => ({ step: s.name, result: s.ok ? 'PASS' : 'FAIL', ms: s.ms, note: s.detail })) });
  }

  // ---------------------------------------------------------------- FR-04 FR-05 runbooks and their approval
  const runbookDir = join(root, 'docs', 'erp', 'runbooks');
  const files = () => (existsSync(runbookDir) ? readdirSync(runbookDir).filter((f) => f.endsWith('.md')).sort() : []);
  const titleOf = (text, code) => (/^#\s+(.+)$/m.exec(text)?.[1] ?? code).trim().slice(0, 200);
  const latest = (companyId, code) => db.prepare('SELECT * FROM ops_runbooks WHERE company_id = ? AND code = ? AND deleted_at IS NULL ORDER BY version_no DESC LIMIT 1').get(companyId, code);
  const approvedOf = (companyId, code) => db.prepare("SELECT * FROM ops_runbooks WHERE company_id = ? AND code = ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY version_no DESC LIMIT 1").get(companyId, code);
  /** A runbook whose file changed (or is new) becomes a new draft version; unchanged ones stay as they are. */
  function syncRunbooks(actor) {
    guard(actor, 'ops.runbook.manage');
    return transaction(db, () => {
      let added = 0;
      for (const f of files()) {
        const code = f.replace(/\.md$/, ''); const text = readFileSync(join(runbookDir, f), 'utf8'); const hash = sha(text);
        const cur = latest(actor.companyId, code);
        if (cur?.content_hash === hash) continue;
        if (cur && ['DRAFT', 'REJECTED'].includes(cur.status)) { db.prepare('UPDATE ops_runbooks SET content_hash = ?, title = ?, status = \'DRAFT\', request_id = NULL, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?').run(hash, titleOf(text, code), iso(), actor.user, cur.id); added += 1; continue; }
        if (cur?.status === 'SUBMITTED') continue; // changed while waiting: the reviewer sees the file as it is now; a later sync makes the next draft
        db.prepare("INSERT INTO ops_runbooks (company_id, code, title, path, content_hash, version_no, status, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?, 'repository')").run(actor.companyId, code, titleOf(text, code), `docs/erp/runbooks/${f}`, hash, (cur?.version_no ?? 0) + 1, actor.user);
        added += 1;
      }
      writeAudit(db, { companyId: actor.companyId, entity: 'ops_runbooks', entityId: 'sync', action: 'sync', newValues: { files: files().length, drafts: added }, actor: actor.user });
      return { files: files().length, drafts: added };
    });
  }
  const engine = createApprovalEngine({ db, handlers: { [RUNBOOK_TYPE]: {
    authorize(_db, actor, r) { if (actor.companyId !== r.company_id) throw forbidden('Another company\'s request.'); },
    apply(_db, request, actor) {
      const rb = db.prepare('SELECT * FROM ops_runbooks WHERE id = ?').get(Number(request.targetId));
      db.prepare("UPDATE ops_runbooks SET status = 'SUPERSEDED', updated_at = ?, version = version + 1 WHERE company_id = ? AND code = ? AND status = 'APPROVED' AND id <> ?").run(iso(), rb.company_id, rb.code, rb.id);
      db.prepare("UPDATE ops_runbooks SET status = 'APPROVED', approved_by = ?, approved_at = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, iso(), iso(), rb.id);
      writeAudit(db, { companyId: rb.company_id, entity: 'ops_runbooks', entityId: rb.id, action: 'approve', newValues: { code: rb.code, versionNo: rb.version_no, hash: rb.content_hash }, actor: actor.user });
      publishEvent(db, { type: 'ops.runbook.approved', entity: 'ops_runbooks', entityId: rb.id, actorId: actor.user, companyId: rb.company_id, data: { runbookId: rb.id, code: rb.code, versionNo: rb.version_no } });
    },
  } } });
  function submitRunbook(actor, code, { reason }) {
    guard(actor, 'ops.runbook.manage');
    const rb = latest(actor.companyId, code);
    if (!rb) throw notFound('That runbook is not registered; sync the runbooks first.');
    if (rb.status !== 'DRAFT' && rb.status !== 'REJECTED') throw conflict(`Version ${rb.version_no} is ${rb.status.toLowerCase()}; only a draft is submitted.`);
    const text = existsSync(join(root, rb.path)) ? readFileSync(join(root, rb.path), 'utf8') : null;
    if (!text || sha(text) !== rb.content_hash) throw conflict('The file changed since it was synced; sync again before submitting.');
    return transaction(db, () => {
      const req = engine.submit(actor, { type: RUNBOOK_TYPE, title: `Runbook ${rb.title} version ${rb.version_no}`, targetType: 'ops_runbooks', targetId: String(rb.id), payload: { code: rb.code, versionNo: rb.version_no, hash: rb.content_hash }, reason, chain: ['SYSADM'] });
      db.prepare("UPDATE ops_runbooks SET status = 'SUBMITTED', request_id = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?").run(req.id, iso(), actor.user, rb.id);
      return { id: rb.id, code: rb.code, versionNo: rb.version_no, request: { id: req.id, status: req.status } };
    });
  }
  function decideRunbook(actor, requestId, body) {
    guard(actor, 'ops.runbook.view');
    const r = db.prepare('SELECT * FROM core_change_requests WHERE id = ? AND company_id = ? AND type = ?').get(Number(requestId), actor.companyId, RUNBOOK_TYPE);
    if (!r) throw notFound('That request does not exist.');
    const out = engine.act(actor, r.id, body);
    if (out.status === 'REJECTED' || out.status === 'RETURNED') db.prepare("UPDATE ops_runbooks SET status = 'REJECTED', updated_at = ?, version = version + 1 WHERE id = ?").run(iso(), Number(r.target_id));
    return { id: out.id, status: out.status };
  }
  function runbook(actor, code) {
    guard(actor, 'ops.runbook.view');
    const rb = latest(actor.companyId, code); if (!rb) throw notFound('That runbook is not registered.');
    const text = existsSync(join(root, rb.path)) ? readFileSync(join(root, rb.path), 'utf8') : '';
    const approved = approvedOf(actor.companyId, code);
    const awaiting = rb.request_id ? engine.awaiting(actor).some((x) => x.id === rb.request_id) : false;
    return { code: rb.code, title: rb.title, path: rb.path, versionNo: rb.version_no, status: rb.status, requestId: rb.request_id, awaitingMe: awaiting, approved: approved ? { versionNo: approved.version_no, by: approved.approved_by, at: approved.approved_at } : null, changedSinceApproved: Boolean(approved) && sha(text) !== approved.content_hash, text };
  }

  // ---------------------------------------------------------------- FR-03 the on-call rota and its pages
  function addShift(actor, b) {
    guard(actor, 'ops.oncall.manage');
    if (Date.parse(b.toAt) <= Date.parse(b.fromAt)) throw badRequest('A shift ends after it starts.', [{ field: 'toAt', message: 'After fromAt' }]);
    if (!db.prepare('SELECT 1 FROM iam_users WHERE company_id = ? AND lower(username) = lower(?) AND is_active = 1').get(actor.companyId, b.username)) throw badRequest('That person has no account in this company.', [{ field: 'username', message: 'Unknown' }]);
    const id = Number(db.prepare("INSERT INTO ops_oncall (company_id, username, support_level, from_at, to_at, status, created_by, source_type) VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, 'rota')").run(actor.companyId, b.username, b.level, b.fromAt, b.toAt, actor.user).lastInsertRowid);
    writeAudit(db, { companyId: actor.companyId, entity: 'ops_oncall', entityId: id, action: 'create', newValues: b, actor: actor.user });
    return { id, ...b };
  }
  function cancelShift(actor, id) {
    guard(actor, 'ops.oncall.manage');
    const s = db.prepare("SELECT * FROM ops_oncall WHERE id = ? AND company_id = ? AND status = 'ACTIVE'").get(Number(id), actor.companyId);
    if (!s) throw notFound('That shift does not exist.');
    db.prepare("UPDATE ops_oncall SET status = 'CANCELLED', updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?").run(iso(), actor.user, s.id);
    writeAudit(db, { companyId: actor.companyId, entity: 'ops_oncall', entityId: s.id, action: 'cancel', actor: actor.user });
    return { id: s.id, status: 'CANCELLED' };
  }
  const onShift = (companyId, level, at = iso()) => db.prepare("SELECT username FROM ops_oncall WHERE company_id = ? AND support_level = ? AND status = 'ACTIVE' AND from_at <= ? AND to_at > ? AND deleted_at IS NULL ORDER BY from_at DESC LIMIT 1").get(companyId, level, at, at)?.username ?? null;
  function page(companyId, alert, level) {
    const who = onShift(companyId, level);
    const id = Number(db.prepare("INSERT OR IGNORE INTO ops_pages (company_id, alert_id, rule_code, severity, message, username, support_level, status, paged_at, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'system', 'core_alerts')")
      .run(companyId, alert.id, alert.rule, alert.severity, String(alert.message).slice(0, 500), who, level, who ? 'SENT' : 'UNCOVERED', iso()).lastInsertRowid);
    if (!id) return null;
    if (who) {
      try { notificationsOf(db).notify({ companyId, templateCode: 'ops.oncall.page', recipients: [`user:${who}`], channels: level === 'L1' ? ['IN_APP'] : ['IN_APP', 'SMS', 'EMAIL'], priority: 'HIGH', category: 'alerts', data: { rule: alert.rule, severity: alert.severity, message: String(alert.message).slice(0, 200) }, link: '/admin/operations?tab=oncall', sourceType: 'ops_pages', sourceId: id }); } catch { /* the page stands; the escalation catches an undelivered one */ }
    } else writeAudit(db, { companyId, entity: 'ops_pages', entityId: id, action: 'uncovered', newValues: { level, rule: alert.rule }, actor: 'system:on-call' });
    publishEvent(db, { type: 'ops.oncall.paged', entity: 'ops_pages', entityId: id, actorId: 'system:on-call', companyId, data: { pageId: id, alertId: alert.id, level, username: who } });
    return id;
  }
  /** The consumer of `core.alert.fired`: every company running operations pages its on-call engineer. */
  function onAlert(event) {
    const d = event.data ?? {};
    const alert = { id: Number(event.entityId ?? event.entity_id), rule: d.rule, severity: d.severity, message: d.message };
    const level = alert.severity === 'critical' ? 'L2' : 'L1';
    const companies = db.prepare("SELECT DISTINCT company_id AS c FROM ops_environments").all().map((r) => r.c).filter((c) => context.flags.isOn({ companyId: c, user: 'system:on-call', roles: [] }, OPS_FLAG));
    for (const c of companies) transaction(db, () => page(c, alert, level));
  }
  /** Pages not acknowledged in time go to the next level (the job runs every five minutes). */
  function escalate(now = Date.now()) {
    let n = 0;
    for (const p of db.prepare("SELECT * FROM ops_pages WHERE status IN ('SENT', 'UNCOVERED') AND deleted_at IS NULL").all()) {
      const limit = param(p.company_id, ACK_KEY) * 60_000;
      if (now - Date.parse(p.paged_at) < limit || !NEXT[p.support_level]) continue;
      transaction(db, () => {
        const next = page(p.company_id, { id: p.alert_id, rule: p.rule_code, severity: p.severity, message: p.message }, NEXT[p.support_level]);
        db.prepare("UPDATE ops_pages SET status = 'ESCALATED', escalated_page_id = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(next, iso(), p.id);
        n += 1;
      });
    }
    return n;
  }
  function acknowledge(actor, id) {
    guard(actor, 'ops.page.ack');
    const p = db.prepare('SELECT * FROM ops_pages WHERE id = ? AND company_id = ?').get(Number(id), actor.companyId);
    if (!p) throw notFound('That page does not exist.');
    if (p.status === 'ACKNOWLEDGED') throw conflict('Already acknowledged.');
    return transaction(db, () => {
      db.prepare("UPDATE ops_pages SET status = 'ACKNOWLEDGED', acknowledged_at = ?, acknowledged_by = ?, updated_at = ?, version = version + 1 WHERE company_id = ? AND alert_id = ? AND status IN ('SENT', 'ESCALATED', 'UNCOVERED')").run(iso(), actor.user, iso(), actor.companyId, p.alert_id);
      db.prepare('UPDATE core_alerts SET acknowledged_by = ?, acknowledged_at = ? WHERE id = ? AND acknowledged_at IS NULL').run(actor.user, iso(), p.alert_id);
      writeAudit(db, { companyId: actor.companyId, entity: 'ops_pages', entityId: p.id, action: 'acknowledge', actor: actor.user });
      return { id: p.id, status: 'ACKNOWLEDGED' };
    });
  }

  // ---------------------------------------------------------------- the page
  function overview(actor, q = {}) {
    guard(actor, 'ops.runbook.view');
    const c = actor.companyId; ensureEnvironments(c);
    const parity = checkParity(root);
    const envs = db.prepare('SELECT * FROM ops_environments WHERE company_id = ? ORDER BY CASE code WHEN \'production\' THEN 0 WHEN \'staging\' THEN 1 WHEN \'test\' THEN 2 WHEN \'sandbox\' THEN 3 ELSE 4 END').all(c).map((e) => {
      const last = db.prepare('SELECT * FROM ops_deployments WHERE environment_id = ? ORDER BY id DESC LIMIT 1').get(e.id);
      const problems = parity.problems.filter((p) => p.startsWith(`${e.code}:`));
      return { code: e.code, name: e.name, url: e.url, status: e.status, activeBuild: e.active_build, activeSlot: e.active_slot, lastDeployAt: e.last_deploy_at, inCode: Boolean(envFile(e.code)), parity: problems.length ? 'DRIFT' : envFile(e.code) ? 'OK' : 'MISSING', parityProblems: problems, last: last ? deployView(last) : null };
    });
    // the chart: deployments of the last twelve weeks per environment and outcome
    const since = new Date(Date.now() - 84 * 86_400_000).toISOString();
    const byEnv = db.prepare("SELECT e.code, d.status, COUNT(*) AS n FROM ops_deployments d JOIN ops_environments e ON e.id = d.environment_id WHERE d.company_id = ? AND d.started_at >= ? AND d.deleted_at IS NULL GROUP BY e.code, d.status").all(c, since);
    const where = ['d.company_id = ?', 'd.deleted_at IS NULL']; const p = [c];
    if (q.environment) { where.push('e.code = ?'); p.push(q.environment); }
    if (q.kind) { where.push('d.kind = ?'); p.push(q.kind); }
    if (q.status) { where.push('d.status = ?'); p.push(q.status); }
    const pageSize = q.pageSize ?? 20; const pg = q.page ?? 1;
    const total = db.prepare(`SELECT COUNT(*) AS n FROM ops_deployments d JOIN ops_environments e ON e.id = d.environment_id WHERE ${where.join(' AND ')}`).get(...p).n;
    const rows = db.prepare(`SELECT d.* FROM ops_deployments d JOIN ops_environments e ON e.id = d.environment_id WHERE ${where.join(' AND ')} ORDER BY d.id DESC LIMIT ? OFFSET ?`).all(...p, pageSize, (pg - 1) * pageSize).map(deployView);
    const awaiting = new Set(engine.awaiting(actor).map((x) => x.id));
    const runbooks = files().map((f) => {
      const code = f.replace(/\.md$/, ''); const rb = latest(c, code); const ap = approvedOf(c, code);
      const text = readFileSync(join(runbookDir, f), 'utf8');
      return { code, title: rb?.title ?? titleOf(text, code), path: `docs/erp/runbooks/${f}`, versionNo: rb?.version_no ?? null, status: rb ? rb.status : 'NOT_SYNCED', approvedVersion: ap?.version_no ?? null, approvedBy: ap?.approved_by ?? null, approvedAt: ap?.approved_at ?? null, changed: rb ? rb.content_hash !== sha(text) : true, requestId: rb?.request_id ?? null, awaitingMe: Boolean(rb?.request_id && awaiting.has(rb.request_id)) };
    });
    const now = iso();
    const rota = db.prepare("SELECT * FROM ops_oncall WHERE company_id = ? AND status = 'ACTIVE' AND to_at > ? AND deleted_at IS NULL ORDER BY from_at LIMIT 30").all(c, now).map((s) => ({ id: s.id, username: s.username, level: s.support_level, fromAt: s.from_at, toAt: s.to_at, onNow: s.from_at <= now }));
    const pages = db.prepare('SELECT * FROM ops_pages WHERE company_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 20').all(c).map((x) => ({ id: x.id, alertId: x.alert_id, rule: x.rule_code, severity: x.severity, message: x.message, username: x.username, level: x.support_level, status: x.status, pagedAt: x.paged_at, acknowledgedAt: x.acknowledged_at, acknowledgedBy: x.acknowledged_by }));
    const rehearsal = db.prepare("SELECT d.* FROM ops_deployments d WHERE d.company_id = ? AND d.kind = 'REHEARSAL' ORDER BY d.id DESC LIMIT 1").get(c);
    return {
      environments: envs, parity: { ok: parity.problems.length === 0, keys: parity.keys.length, problems: parity.problems },
      byEnv: ENV_CODES.map((code) => ({ code, succeeded: byEnv.find((x) => x.code === code && x.status === 'SUCCEEDED')?.n ?? 0, failed: byEnv.find((x) => x.code === code && x.status === 'FAILED')?.n ?? 0, rolledBack: byEnv.find((x) => x.code === code && x.status === 'ROLLED_BACK')?.n ?? 0 })),
      deployments: { rows, total, page: pg, pageSize }, lastRehearsal: rehearsal ? deployView(rehearsal) : null,
      runbooks, runbooksApproved: runbooks.filter((r) => r.approvedVersion && !r.changed).length,
      oncall: { now: Object.fromEntries(['L1', 'L2', 'L3'].map((l) => [l, onShift(c, l)])), rota, pages, openPages: pages.filter((x) => x.status === 'SENT' || x.status === 'UNCOVERED').length, ackMinutes: param(c, ACK_KEY) },
      can: { record: hasPermissionAnywhere(actor, 'ops.deploy.record'), manage: hasPermissionAnywhere(actor, 'ops.runbook.manage'), oncall: hasPermissionAnywhere(actor, 'ops.oncall.manage'), ack: hasPermissionAnywhere(actor, 'ops.page.ack'), export: hasPermissionAnywhere(actor, 'ops.runbook.view') },
    };
  }
  function exportDeployments(actor, q, format) {
    guard(actor, 'ops.runbook.view');
    const o = overview(actor, { ...q, page: 1, pageSize: 100000 });
    const rows = o.deployments.rows.map((d) => ({ no: d.deployNo, env: d.environment, kind: d.kind, build: d.buildId ?? '', status: d.status, run: d.pipelineRun ?? '', at: d.finishedAt, ms: d.durationMs, req: d.requests ?? '', failed: d.failedRequests ?? '', by: d.requestedBy }));
    const columns = [['no', 'Deployment'], ['env', 'Environment'], ['kind', 'Kind'], ['build', 'Build'], ['status', 'Result'], ['run', 'Pipeline run'], ['at', 'Finished'], ['ms', 'Duration (ms)'], ['req', 'Requests'], ['failed', 'Failed requests'], ['by', 'By']].map(([key, label]) => ({ key, label }));
    const buffer = writeExport(format, { columns, rows, title: 'Deployments and rehearsals', sheetName: 'Deployments', footer: [`${rows.length} records · runbooks approved ${o.runbooksApproved} of ${o.runbooks.length} · parity ${o.parity.ok ? 'OK' : 'drift'}`] });
    writeAudit(db, { companyId: actor.companyId, entity: 'report', entityId: 'ops.deployments', action: 'export', newValues: { format, rows: rows.length }, actor: actor.user });
    return { buffer, contentType: FORMATS[format], fileName: `deployments.${format}` };
  }

  bus?.subscribe?.('core.alert.fired', (event) => onAlert(event), { consumer: 'ops.oncall', maxAttempts: 3 });
  jobs?.register?.('ops.oncall.escalate', () => ({ escalated: escalate() }));
  scheduler?.define?.({ code: 'ops.oncall.escalate', cron: '*/5 * * * *', jobType: 'ops.oncall.escalate', description: 'Part 30.08: escalate on-call pages not acknowledged in time.' });
  return { recordDeployment, recordRehearsal, syncRunbooks, submitRunbook, decideRunbook, runbook, addShift, cancelShift, acknowledge, onAlert, escalate, overview, exportDeployments, engine };
}
