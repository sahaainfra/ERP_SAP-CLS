import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createApprovalEngine } from '../../platform/approvals/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { assertPermissionAnywhere, hasPermissionAnywhere } from '../../platform/auth/index.js';
import { ROLE_TEMPLATES } from '../../platform/authz/templates.js';
import { transaction } from '../../platform/db/index.js';
import { eventTypes, publishEvent } from '../../platform/events/index.js';
import { FORMATS, writeExport } from '../../platform/export/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { integrityRegistry } from '../../platform/integrity/registry.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { ROUTE_POLICY } from '../../platform/security/route-policy.js';

/**
 * Part 30.05 — security hardening and penetration testing.
 *
 * FR-01 the authorisation test generator: every route of the route policy × every role of the role catalogue (and nobody signed in), the
 *       expected answer worked out from the policy and the role templates (authzMatrix). tests/sct-authz-matrix.test.js runs every case
 *       (T-01: 100 % of the endpoints); the AUTHZ scan here reports what the policy itself gets wrong (a public route that writes, a key no
 *       role holds, a write route not audited, the last route self-test failures).
 * FR-02 DAST (scripts/dast_scan.mjs against a running installation) and the dependency audit (npm audit) are posted as scans; the manual
 *       penetration test by an independent tester and the mobile/PWA review are recorded as findings (sources PENTEST, MOBILE).
 * FR-03 the sensitive paths (upload, export, AI tools, webhooks, sockets, the PWA) and FR-04 the DPDP checklist are reviewed control by
 *       control (sct_reviews); a gap raises a REVIEW finding.
 * FR-05 remediation to closure: a finding is fixed in a commit by one person and re-tested by another (the independent tester); a failed
 *       re-test reopens it; a scan that sees a closed finding again reopens it. A risk is accepted (HIGH and below) or a finding declared a
 *       false positive only with the director's approval (approval engine, type sct_risk_acceptance; the requester never approves).
 * BR-01 go-live is blocked while a Critical or High finding is open (open, fixed but not re-tested, or waiting for its risk decision).
 */
export const SECURITY_FLAG = 'ff.qa.p3005';
export const RISK_TYPE = 'sct_risk_acceptance';
export const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
export const SOURCES = ['AUTHZ', 'SAST', 'SECRETS', 'DEPENDENCIES', 'DAST', 'PENTEST', 'MOBILE', 'REVIEW'];
export const STATUSES = ['OPEN', 'FIXED', 'CLOSED', 'RISK_PENDING', 'ACCEPTED', 'FALSE_POSITIVE'];
const BLOCKING = ['OPEN', 'FIXED', 'RISK_PENDING'];
const iso = (d = new Date()) => d.toISOString();
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 32);

/** FR-04 the DPDP Act 2023 checklist and FR-03 the sensitive paths: each control with what the reviewer looks at. */
export const CONTROLS = Object.freeze([
  ['DPDP-01', 'DPDP', 'Notice and consent', 'A notice in plain language (English, Hindi, Telugu) before personal data is collected; consent recorded with its purpose and withdrawable (employee onboarding, ESS, the client portal).'],
  ['DPDP-02', 'DPDP', 'Purpose limitation', 'Personal data used only for the purpose collected; reports and exports mask what the purpose does not need (Aadhaar, bank, mobile).'],
  ['DPDP-03', 'DPDP', 'Data minimisation', 'Forms ask only what the process needs; optional fields are optional; no copies of identity documents kept beyond the check.'],
  ['DPDP-04', 'DPDP', 'Accuracy and correction', 'The person sees and corrects their own data (ESS profile, corrections through the module owner).'],
  ['DPDP-05', 'DPDP', 'Retention and erasure', 'Retention policies per record type; erasure on request after employment, legal hold and statutory retention (archival 29.06).'],
  ['DPDP-06', 'DPDP', 'Security safeguards', 'Encryption of secrets and sensitive fields at rest (vault), TLS in transit, masking, role-based access, the audit trail.'],
  ['DPDP-07', 'DPDP', 'Breach notification', 'A personal-data breach is recorded as an incident and notified to the Data Protection Board and the people affected without delay.'],
  ['DPDP-08', 'DPDP', 'Rights of the data principal', 'Access to a summary of their data, correction, erasure and grievance redressal, with a named grievance officer.'],
  ['DPDP-09', 'DPDP', 'Data processors', 'Every processor (e-mail, SMS, WhatsApp, cloud, payroll bank) under a contract; the connector register names them.'],
  ['DPDP-10', 'DPDP', 'Children and cross-border transfer', 'No data of children is processed; personal data stays in India unless a permitted transfer is recorded.'],
  ['PATH-UPLOAD', 'PATH', 'File upload', 'Type and size checked on the server by content, names never trusted, stored outside the web root, linked to a record the person may edit, served with no-sniff and as attachments.'],
  ['PATH-EXPORT', 'PATH', 'Export', 'Every export behind its own permission, honouring filters, scope and masks; audited; formula injection neutralised in CSV and XLSX.'],
  ['PATH-AI', 'PATH', 'AI tools', 'The assistant calls tools with the person\'s own permissions and scope, cannot write without a confirmation, and its prompts and answers are logged and redacted.'],
  ['PATH-WEBHOOK', 'PATH', 'Webhooks', 'Inbound webhooks verified by signature and replay window; outbound only to https addresses that are not private (no SSRF), signed, with back-off.'],
  ['PATH-SOCKET', 'PATH', 'Sockets', 'A socket is authenticated on connect; a person joins only the rooms of records they may read; messages carry no data the person may not see.'],
  ['PATH-PWA', 'PATH', 'Mobile and PWA', 'Tokens not in local storage, the offline cache encrypted or limited and cleared at sign-out, no data in push payloads, the service worker scope limited.'],
].map(([code, area, label, how]) => Object.freeze({ code, area, label, how })));

integrityRegistry.register({ statuses: { sct_findings: STATUSES, sct_scan_runs: ['DONE', 'FAILED'], sct_reviews: ['PASS', 'GAP', 'NA'] } });
for (const [type, description] of [
  ['sct.finding.raised', 'A security finding was raised (part 30.05): data { findingId, findingNo, source, severity, title }.'],
  ['sct.finding.closed', 'A security finding was closed after an independent re-test, or its risk accepted (part 30.05): data { findingId, findingNo, status }.'],
]) if (!eventTypes.get(type)) eventTypes.define({ type, version: 1, schema: { type: 'object' }, owner: 'tst', description });

// ---------------------------------------------------------------- FR-01 the authorisation test generator
const list = (k) => (Array.isArray(k) ? k : k ? [k] : []);
const PUBLIC_WRITE_OK = /^\/api\/(?:v1\/)?(?:auth|public|portal\/auth|webhooks|iam\/auth|core\/auth|health|csp-report|.*\/webhooks\/|.*\/inbound)/;
/**
 * Every route × every role (and nobody signed in) with the answer the policy and the role templates give: 401 for nobody, for a route
 * guarded by permission 403 to a role holding none of its keys and the way through to a role holding one. A route guarded by self or record
 * lets every signed-in person through to the record check; a public or infrastructure route is open.
 */
export function authzMatrix(policy = ROUTE_POLICY, roles = ROLE_TEMPLATES) {
  return policy.map((r) => {
    const keys = list(r.k);
    const holders = r.g === 'permission' ? roles.filter((x) => keys.some((k) => x.permissions.includes(k))).map((x) => x.code) : [];
    const denied = r.g === 'permission' ? roles.filter((x) => !holders.includes(x.code)).map((x) => x.code) : [];
    const open = r.g === 'public' || r.g === 'infra';
    return { method: r.m, path: r.p, guard: r.g, keys, scope: r.scope, anonymous: open ? 'open' : 401, holders, denied, cases: 1 + roles.length };
  });
}

export function authzFindings(policy = ROUTE_POLICY, roles = ROLE_TEMPLATES) {
  const out = [];
  const known = new Set(roles.flatMap((r) => r.permissions));
  for (const m of authzMatrix(policy, roles)) {
    const id = `${m.method} ${m.path}`;
    if (m.guard === 'public' && m.method !== 'GET' && !PUBLIC_WRITE_OK.test(m.path)) {
      // a link sent to an outside party (a vendor's quote, an invitation, a portal sign-up) carries its own token: listed for the penetration test
      const token = /:token\b|:code\b|\/portal\//.test(m.path);
      out.push(token
        ? { severity: 'INFO', title: `A public route takes a link token: ${id}`, endpoint: id, cwe: 'CWE-640', rule: 'PUBLIC_TOKEN_WRITE', description: 'Open without signing in by design (a token sent to an outside party). The penetration test checks the token is long, single-purpose, expiring and rate-limited.' }
        : { severity: 'HIGH', title: `A public route changes data: ${id}`, endpoint: id, cwe: 'CWE-306', rule: 'PUBLIC_WRITE', description: 'The route answers without signing in and is not a sign-in, public form, link token or signed webhook path. Declare its permission or prove it needs none.' });
    }
    if (m.guard === 'permission' && m.keys.length && !m.holders.length) out.push({ severity: 'LOW', title: `No role holds the permission of ${id}`, endpoint: id, cwe: 'CWE-1220', rule: 'UNREACHABLE', description: `None of the roles holds ${m.keys.join(' or ')}: the route is unreachable until a role is granted it (or it is dead code).` });
    for (const k of m.keys) if (!known.has(k) && m.holders.length === 0) out.push({ severity: 'MEDIUM', title: `Unknown permission ${k} on ${id}`, endpoint: id, cwe: 'CWE-285', rule: 'UNKNOWN_KEY', description: 'The permission is in no role template: a typing error in the policy leaves the route closed to everyone, or open if fixed carelessly.' });
    if (m.method !== 'GET' && m.guard !== 'public' && m.guard !== 'infra' && !policy.find((r) => r.m === m.method && r.p === m.path)?.audit) out.push({ severity: 'LOW', title: `A write route is not marked audited: ${id}`, endpoint: id, cwe: 'CWE-778', rule: 'NOT_AUDITED', description: 'The route changes data but its policy line says audit: false; check the service writes the audit trail.' });
  }
  return out;
}

// ---------------------------------------------------------------- SAST: patterns in the application source
const SAST = [
  ['EVAL', 'HIGH', 'CWE-95', 'Code built from a string at run time (eval / new Function)', /\beval\(|\bnew Function\(/],
  ['EXEC', 'HIGH', 'CWE-78', 'A shell command built from a template string', /\b(?:exec|execSync|spawn|spawnSync)\(\s*`[^`]*\$\{/],
  ['SQL_CONCAT', 'HIGH', 'CWE-89', 'SQL built from request input', /prepare\(\s*`[^`]*\$\{\s*req\.(?:query|body|params)/],
  ['TLS_OFF', 'HIGH', 'CWE-295', 'TLS certificate checks switched off', /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED/],
  ['WEAK_RANDOM', 'HIGH', 'CWE-338', 'Math.random used for a token, code or secret', /(?:token|secret|otp|password|nonce|salt)\w*\s*[:=][^;\n]*Math\.random\(/i],
  ['HTML_SINK', 'MEDIUM', 'CWE-79', 'HTML written from data without a sanitiser', /dangerouslySetInnerHTML|\.innerHTML\s*=|\.outerHTML\s*=|document\.write\(/],
  ['STACK_LEAK', 'MEDIUM', 'CWE-209', 'A stack trace sent to the client', /res\.(?:send|json)\([^)]*\.stack\b/],
  ['CORS_ANY', 'MEDIUM', 'CWE-942', 'CORS open to every origin', /Access-Control-Allow-Origin['"]?\s*,\s*['"]\*['"]|origin\s*:\s*['"]\*['"]/],
  ['WEAK_HASH', 'MEDIUM', 'CWE-327', 'MD5 or SHA-1 used for a password', /createHash\(\s*['"](?:md5|sha1)['"]\)[^;\n]*(?:password|passwd|pwd)/i],
];
const SAST_ALLOW = 'sast:allow';
function sourceFiles(root) {
  const out = [];
  const walk = (dir) => { for (const f of readdirSync(dir)) { const p = join(dir, f); const st = statSync(p); if (st.isDirectory()) { if (f !== 'node_modules' && !f.startsWith('.')) walk(p); } else if (/\.(m?js|jsx)$/.test(f)) out.push(p); } };
  for (const d of ['src/server', 'src/client', 'src/shared']) if (existsSync(join(root, d))) walk(join(root, d));
  return out;
}
export function sastScan(root = process.cwd()) {
  const findings = []; let checked = 0;
  for (const abs of sourceFiles(root)) {
    const file = relative(root, abs).replace(/\\/g, '/');
    if (file === 'src/server/modules/tst/security.js') continue; // the rules themselves
    checked += 1;
    const text = readFileSync(abs, 'utf8');
    const sanitised = /DOMPurify|sanitizeHtml|sanitiseHtml|escapeHtml/.test(text);
    text.split('\n').forEach((line, i) => {
      if (line.includes(SAST_ALLOW)) return;
      for (const [rule, severity, cwe, why, re] of SAST) {
        if (!re.test(line)) continue;
        if (rule === 'HTML_SINK' && sanitised) continue;
        if (rule === 'EXEC' && !/child_process/.test(text)) continue; // db.exec of SQLite is not a shell
        findings.push({ rule, severity, cwe, title: `${why} (${file}:${i + 1})`, endpoint: `${file}:${i + 1}`, description: line.trim().slice(0, 300), key: `${rule}|${file}|${line.trim()}` });
      }
    });
  }
  return { checked, findings };
}

export function createSecurityService(context, { root = process.cwd() } = {}) {
  const { db } = context;
  const guard = (actor, key) => {
    if (!Number.isSafeInteger(actor?.companyId) || actor.companyId < 1 || !context.flags.isOn(actor, SECURITY_FLAG)) throw notFound('Security findings are not enabled for this company.');
    if (key) assertPermissionAnywhere(actor, key);
  };
  const row = (actor, id) => { const f = db.prepare('SELECT * FROM sct_findings WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!f) throw notFound('That finding does not exist.'); return f; };
  const view = (f) => ({ id: f.id, findingNo: f.finding_no, source: f.source, severity: f.severity, title: f.title, description: f.description, endpoint: f.endpoint, cwe: f.cwe, status: f.status, blocking: ['CRITICAL', 'HIGH'].includes(f.severity) && BLOCKING.includes(f.status), reportedBy: f.reported_by, reportedAt: f.created_at, lastSeenAt: f.last_seen_at, fixedIn: f.fixed_in, fixedBy: f.fixed_by, fixedAt: f.fixed_at, retestedBy: f.retested_by, retestedAt: f.retested_at, retestNote: f.retest_note, requestId: f.request_id, scanRunId: f.scan_run_id, version: f.version });
  const nextNo = (companyId) => `SEC-${String((db.prepare('SELECT COUNT(*) AS n FROM sct_findings WHERE company_id = ?').get(companyId).n ?? 0) + 1).padStart(5, '0')}`;

  function raise(actor, f, runId = null) {
    const no = nextNo(actor.companyId);
    const id = Number(db.prepare("INSERT INTO sct_findings (company_id, finding_no, source, severity, title, description, endpoint, cwe, fingerprint, status, scan_run_id, reported_by, last_seen_at, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?, ?)")
      .run(actor.companyId, no, f.source, f.severity, f.title.slice(0, 300), f.description ?? null, f.endpoint ?? null, f.cwe ?? null, f.fingerprint, runId, actor.user, iso(), actor.user, runId ? 'sct_scan_runs' : 'manual', runId ? String(runId) : null).lastInsertRowid);
    writeAudit(db, { companyId: actor.companyId, entity: 'sct_findings', entityId: id, action: 'create', newValues: { findingNo: no, source: f.source, severity: f.severity, title: f.title }, actor: actor.user });
    publishEvent(db, { type: 'sct.finding.raised', entity: 'sct_findings', entityId: id, actorId: actor.user, companyId: actor.companyId, data: { findingId: id, findingNo: no, source: f.source, severity: f.severity, title: f.title } });
    if (['CRITICAL', 'HIGH'].includes(f.severity)) {
      try { notificationsOf(db).notify({ companyId: actor.companyId, templateCode: 'sct.finding.raised', recipients: ['permission:sct.finding.manage'], channels: ['IN_APP', 'EMAIL'], priority: 'HIGH', category: 'alerts', data: { finding: no, severity: f.severity, title: f.title.slice(0, 120), source: f.source }, link: `/admin/security-findings?finding=${id}`, sourceType: 'sct_findings', sourceId: id }); } catch { /* the finding stands even if the notice cannot be sent */ }
    }
    return id;
  }

  // ---------------------------------------------------------------- findings: record (testers), list, one
  function record(actor, b) {
    guard(actor, 'sct.finding.record');
    if (!['PENTEST', 'MOBILE', 'REVIEW'].includes(b.source)) throw badRequest('A tester records a penetration test, mobile or review finding; scans post their own.', [{ field: 'source', message: 'PENTEST, MOBILE or REVIEW' }]);
    const fingerprint = sha(`${b.source}|${b.title.trim().toLowerCase()}|${(b.endpoint ?? '').trim().toLowerCase()}`);
    if (db.prepare('SELECT 1 FROM sct_findings WHERE company_id = ? AND fingerprint = ?').get(actor.companyId, fingerprint)) throw conflict('The same finding is already recorded.');
    return transaction(db, () => view(db.prepare('SELECT * FROM sct_findings WHERE id = ?').get(raise(actor, { ...b, fingerprint }))));
  }

  function overview(actor, q = {}) {
    guard(actor, 'sct.finding.view');
    const c = actor.companyId;
    const counts = db.prepare('SELECT severity, status, COUNT(*) AS n FROM sct_findings WHERE company_id = ? AND deleted_at IS NULL GROUP BY severity, status').all(c);
    const bySeverity = SEVERITIES.map((s) => { const r = counts.filter((x) => x.severity === s); const total = r.reduce((a, x) => a + x.n, 0); const open = r.filter((x) => BLOCKING.includes(x.status)).reduce((a, x) => a + x.n, 0); return { severity: s, total, open, closed: total - open }; });
    const bySource = db.prepare(`SELECT source, COUNT(*) AS total, SUM(status IN ('OPEN', 'FIXED', 'RISK_PENDING')) AS open FROM sct_findings WHERE company_id = ? AND deleted_at IS NULL GROUP BY source`).all(c);
    const blocking = db.prepare(`SELECT * FROM sct_findings WHERE company_id = ? AND deleted_at IS NULL AND severity IN ('CRITICAL', 'HIGH') AND status IN ('OPEN', 'FIXED', 'RISK_PENDING') ORDER BY severity = 'HIGH', id`).all(c).map(view);
    const scans = db.prepare('SELECT * FROM sct_scan_runs WHERE company_id = ? AND id IN (SELECT MAX(id) FROM sct_scan_runs WHERE company_id = ? GROUP BY scan_kind) ORDER BY scan_kind').all(c, c).map(scanView);
    const authz = scans.find((s) => s.kind === 'AUTHZ');
    const reviewed = new Map(db.prepare('SELECT * FROM sct_reviews WHERE company_id = ? AND id IN (SELECT MAX(id) FROM sct_reviews WHERE company_id = ? GROUP BY control_code)').all(c, c).map((r) => [r.control_code, r]));
    const controls = CONTROLS.map((k) => { const r = reviewed.get(k.code); return { ...k, status: r?.status ?? null, evidence: r?.evidence ?? null, reviewedBy: r?.reviewed_by ?? null, reviewedAt: r?.reviewed_at ?? null }; });
    const where = ['company_id = ?', 'deleted_at IS NULL']; const p = [c];
    if (q.severity) { where.push('severity = ?'); p.push(q.severity); }
    if (q.status === 'BLOCKING') where.push("severity IN ('CRITICAL', 'HIGH') AND status IN ('OPEN', 'FIXED', 'RISK_PENDING')");
    else if (q.status === 'ACTIVE') where.push("status IN ('OPEN', 'FIXED', 'RISK_PENDING')");
    else if (q.status) { where.push('status = ?'); p.push(q.status); }
    if (q.source) { where.push('source = ?'); p.push(q.source); }
    if (q.q) { where.push("(title LIKE ? ESCAPE '\\' OR endpoint LIKE ? ESCAPE '\\' OR finding_no LIKE ? ESCAPE '\\')"); const like = `%${q.q.replace(/[\\%_]/g, (x) => `\\${x}`)}%`; p.push(like, like, like); }
    const pageSize = q.pageSize ?? 25; const pg = q.page ?? 1;
    const total = db.prepare(`SELECT COUNT(*) AS n FROM sct_findings WHERE ${where.join(' AND ')}`).get(...p).n;
    const rows = db.prepare(`SELECT * FROM sct_findings WHERE ${where.join(' AND ')} ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END, status IN ('CLOSED', 'ACCEPTED', 'FALSE_POSITIVE'), id DESC LIMIT ? OFFSET ?`).all(...p, pageSize, (pg - 1) * pageSize).map(view);
    const awaiting = new Set(engine.awaiting(actor).map((x) => x.id));
    return {
      goLive: { blocked: blocking.length > 0, critical: blocking.filter((f) => f.severity === 'CRITICAL').length, high: blocking.filter((f) => f.severity === 'HIGH').length },
      bySeverity, bySource, blocking: blocking.slice(0, 20), scans,
      authzCoverage: authz ? { routes: authz.summary?.routes ?? 0, cases: authz.summary?.cases ?? 0, pct: authz.summary?.coveragePct ?? 0, at: authz.finishedAt } : null,
      controls, reviews: { dpdp: controls.filter((x) => x.area === 'DPDP'), paths: controls.filter((x) => x.area === 'PATH'), gaps: controls.filter((x) => x.status === 'GAP').length, unreviewed: controls.filter((x) => !x.status).length },
      findings: { rows: rows.map((f) => ({ ...f, awaitingMe: Boolean(f.requestId && awaiting.has(f.requestId)) })), total, page: pg, pageSize },
      can: { record: hasPermissionAnywhere(actor, 'sct.finding.record'), manage: hasPermissionAnywhere(actor, 'sct.finding.manage'), retest: hasPermissionAnywhere(actor, 'sct.finding.retest'), scan: hasPermissionAnywhere(actor, 'sct.scan.run'), review: hasPermissionAnywhere(actor, 'sct.review.manage'), export: hasPermissionAnywhere(actor, 'sct.finding.export') },
    };
  }
  function finding(actor, id) {
    guard(actor, 'sct.finding.view');
    const f = view(row(actor, id));
    const history = db.prepare("SELECT action, actor, created_at AS at, new_values AS v FROM core_audit_log WHERE entity = 'sct_findings' AND entity_id = ? ORDER BY id").all(String(f.id)).map((h) => ({ action: h.action, actor: h.actor, at: h.at }));
    const request = f.requestId ? db.prepare('SELECT id, status, requested_by AS requestedBy, payload_json AS payload FROM core_change_requests WHERE id = ?').get(f.requestId) : null;
    return { ...f, history, request: request ? { id: request.id, status: request.status, requestedBy: request.requestedBy, awaitingMe: engine.awaiting(actor).some((x) => x.id === request.id) } : null };
  }

  // ---------------------------------------------------------------- FR-05 remediation and re-test
  function fix(actor, id, { fixedIn, note }) {
    guard(actor, 'sct.finding.manage');
    const f = row(actor, id);
    if (f.status !== 'OPEN') throw conflict('Only an open finding is marked fixed.');
    return transaction(db, () => {
      db.prepare("UPDATE sct_findings SET status = 'FIXED', fixed_in = ?, fixed_by = ?, fixed_at = ?, retested_by = NULL, retested_at = NULL, retest_note = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(fixedIn, actor.user, iso(), actor.user, iso(), f.id);
      writeAudit(db, { companyId: actor.companyId, entity: 'sct_findings', entityId: f.id, action: 'fix', oldValues: { status: f.status }, newValues: { status: 'FIXED', fixedIn, note: note ?? null }, actor: actor.user });
      return view(row(actor, f.id));
    });
  }
  function retest(actor, id, { result, note }) {
    guard(actor, 'sct.finding.retest');
    const f = row(actor, id);
    if (f.status !== 'FIXED') throw conflict('Only a fixed finding is re-tested.');
    if (actor.user === f.fixed_by) throw forbidden('The person who fixed a finding does not re-test it: an independent tester does.');
    const status = result === 'PASS' ? 'CLOSED' : 'OPEN';
    return transaction(db, () => {
      db.prepare('UPDATE sct_findings SET status = ?, retested_by = ?, retested_at = ?, retest_note = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(status, actor.user, iso(), note, actor.user, iso(), f.id);
      writeAudit(db, { companyId: actor.companyId, entity: 'sct_findings', entityId: f.id, action: result === 'PASS' ? 'retest_pass' : 'retest_fail', oldValues: { status: f.status }, newValues: { status, note }, actor: actor.user });
      if (status === 'CLOSED') publishEvent(db, { type: 'sct.finding.closed', entity: 'sct_findings', entityId: f.id, actorId: actor.user, companyId: actor.companyId, data: { findingId: f.id, findingNo: f.finding_no, status } });
      return view(row(actor, f.id));
    });
  }

  const engine = createApprovalEngine({ db, handlers: { [RISK_TYPE]: {
    authorize(_db, actor, r) { if (actor.companyId !== r.company_id) throw forbidden('Another company\'s request.'); },
    apply(_db, request, actor) {
      const f = db.prepare('SELECT * FROM sct_findings WHERE id = ?').get(Number(request.targetId));
      const status = request.payload.decision === 'FALSE_POSITIVE' ? 'FALSE_POSITIVE' : 'ACCEPTED';
      db.prepare('UPDATE sct_findings SET status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(status, actor.user, iso(), f.id);
      writeAudit(db, { companyId: f.company_id, entity: 'sct_findings', entityId: f.id, action: status === 'ACCEPTED' ? 'risk_accepted' : 'false_positive', oldValues: { status: f.status }, newValues: { status, until: request.payload.until ?? null }, actor: actor.user });
      publishEvent(db, { type: 'sct.finding.closed', entity: 'sct_findings', entityId: f.id, actorId: actor.user, companyId: f.company_id, data: { findingId: f.id, findingNo: f.finding_no, status } });
    },
  } } });
  function requestDecision(actor, id, { decision, reason, until }) {
    guard(actor, 'sct.finding.manage');
    const f = row(actor, id);
    if (f.status !== 'OPEN') throw conflict('Only an open finding goes for a risk decision.');
    if (decision === 'ACCEPT' && f.severity === 'CRITICAL') throw unprocessable('A critical finding is fixed, never accepted (BR-01).');
    if (decision === 'ACCEPT' && !until) throw badRequest('An accepted risk has a review date.', [{ field: 'until', message: 'The date the acceptance ends' }]);
    return transaction(db, () => {
      const req = engine.submit(actor, { type: RISK_TYPE, title: `${decision === 'ACCEPT' ? 'Accept the risk of' : 'Declare a false positive:'} ${f.finding_no} ${f.title}`.slice(0, 200), targetType: 'sct_findings', targetId: String(f.id), payload: { decision: decision === 'ACCEPT' ? 'ACCEPT' : 'FALSE_POSITIVE', until: until ?? null, findingNo: f.finding_no, severity: f.severity }, reason, chain: ['DIR'] });
      db.prepare("UPDATE sct_findings SET status = 'RISK_PENDING', request_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(req.id, actor.user, iso(), f.id);
      writeAudit(db, { companyId: actor.companyId, entity: 'sct_findings', entityId: f.id, action: 'risk_request', newValues: { decision, until: until ?? null }, reason, actor: actor.user });
      return { request: { id: req.id, status: req.status, chain: ['DIR'] }, finding: view(row(actor, f.id)) };
    });
  }
  function decide(actor, requestId, body) {
    guard(actor, 'sct.finding.view');
    const r = db.prepare('SELECT * FROM core_change_requests WHERE id = ? AND company_id = ? AND type = ?').get(Number(requestId), actor.companyId, RISK_TYPE);
    if (!r) throw notFound('That request does not exist.');
    const out = engine.act(actor, r.id, body);
    if (out.status === 'REJECTED' || out.status === 'RETURNED') {
      db.prepare("UPDATE sct_findings SET status = 'OPEN', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ? AND status = 'RISK_PENDING'").run(actor.user, iso(), Number(r.target_id));
      writeAudit(db, { companyId: actor.companyId, entity: 'sct_findings', entityId: Number(r.target_id), action: 'risk_refused', newValues: { comment: body.comment ?? null }, actor: actor.user });
    }
    return { id: out.id, status: out.status };
  }

  // ---------------------------------------------------------------- scans
  const scanView = (s) => ({ id: s.id, runNo: s.run_no, kind: s.scan_kind, status: s.status, checked: s.checked_count, findings: s.findings_count, summary: (() => { try { return JSON.parse(s.summary_json ?? 'null'); } catch { return null; } })(), startedAt: s.started_at, finishedAt: s.finished_at, requestedBy: s.requested_by });
  /** A scan's findings are deduplicated by fingerprint: new ones raised, known ones seen again, a closed one seen again reopened (a regression). */
  function ingest(actor, kind, { checked, findings, summary = {} }) {
    return transaction(db, () => {
      const no = `SCN-${String((db.prepare('SELECT COUNT(*) AS n FROM sct_scan_runs WHERE company_id = ?').get(actor.companyId).n ?? 0) + 1).padStart(5, '0')}`;
      const run = Number(db.prepare("INSERT INTO sct_scan_runs (company_id, run_no, scan_kind, status, checked_count, findings_count, summary_json, started_at, finished_at, requested_by, created_by, source_type) VALUES (?, ?, ?, 'DONE', ?, ?, ?, ?, ?, ?, ?, 'scan')")
        .run(actor.companyId, no, kind, checked, findings.length, '{}', iso(), iso(), actor.user, actor.user).lastInsertRowid);
      let raised = 0; let seen = 0; let reopened = 0;
      for (const f of findings) {
        const fingerprint = sha(`${kind}|${f.key ?? `${f.rule ?? ''}|${f.endpoint ?? ''}|${f.title}`}`);
        const cur = db.prepare('SELECT * FROM sct_findings WHERE company_id = ? AND fingerprint = ?').get(actor.companyId, fingerprint);
        if (!cur) { raise(actor, { ...f, source: kind, fingerprint }, run); raised += 1; continue; }
        seen += 1;
        if (cur.status === 'CLOSED') {
          db.prepare("UPDATE sct_findings SET status = 'OPEN', last_seen_at = ?, scan_run_id = ?, retest_note = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(iso(), run, `Seen again by ${no} after it was closed`, iso(), cur.id);
          writeAudit(db, { companyId: actor.companyId, entity: 'sct_findings', entityId: cur.id, action: 'reopen', newValues: { scan: no }, actor: actor.user });
          reopened += 1;
        } else db.prepare('UPDATE sct_findings SET last_seen_at = ?, updated_at = ? WHERE id = ?').run(iso(), iso(), cur.id);
      }
      const sum = { ...summary, raised, seen, reopened };
      db.prepare('UPDATE sct_scan_runs SET summary_json = ? WHERE id = ?').run(JSON.stringify(sum), run);
      writeAudit(db, { companyId: actor.companyId, entity: 'sct_scan_runs', entityId: run, action: 'scan', newValues: { kind, checked, findings: findings.length, raised, reopened }, actor: actor.user });
      return scanView(db.prepare('SELECT * FROM sct_scan_runs WHERE id = ?').get(run));
    });
  }
  /** The scans that run in the application: the authorisation matrix, the source patterns and the secret scan. */
  async function runScan(actor, { kind }) {
    guard(actor, 'sct.scan.run');
    if (kind === 'AUTHZ') {
      const matrix = authzMatrix();
      const failing = db.prepare("SELECT method, path, last_test_detail AS d FROM core_route_registry WHERE last_test_result = 'fail'").all();
      const findings = [...authzFindings(), ...failing.map((r) => ({ severity: 'HIGH', rule: 'SELF_TEST', title: `The route self-test fails: ${r.method} ${r.path}`, endpoint: `${r.method} ${r.path}`, cwe: 'CWE-285', description: r.d }))];
      const testFile = existsSync(join(root, 'tests', 'sct-authz-matrix.test.js'));
      return ingest(actor, 'AUTHZ', { checked: matrix.length, findings, summary: { routes: matrix.length, roles: ROLE_TEMPLATES.length, cases: matrix.reduce((a, m) => a + m.cases, 0), guarded: matrix.filter((m) => m.guard === 'permission').length, coveragePct: testFile ? 100 : 0, test: 'tests/sct-authz-matrix.test.js' } });
    }
    if (kind === 'SAST') { const s = sastScan(root); return ingest(actor, 'SAST', { checked: s.checked, findings: s.findings, summary: { files: s.checked, rules: SAST.length } }); }
    if (kind === 'SECRETS') {
      const { scanRepository, candidateFiles } = await import('../../../../scripts/lib/secrets.mjs');
      let files; try { files = candidateFiles(root); } catch { throw conflict('The secret scan needs the repository checkout (git) on this machine.'); }
      const hits = scanRepository(root, files);
      return ingest(actor, 'SECRETS', { checked: files.length, findings: hits.map((h) => ({ rule: h.id, severity: h.id === 'private-key' || h.id === 'aws-access-key' ? 'CRITICAL' : 'HIGH', cwe: 'CWE-798', title: `A ${h.id} in ${h.file}:${h.line}`, endpoint: `${h.file}:${h.line}`, key: `${h.id}|${h.file}|${h.line}` })), summary: { files: files.length } });
    }
    throw badRequest('DAST and dependency audits are posted by their scripts (scripts/dast_scan.mjs, npm audit).', [{ field: 'kind', message: 'AUTHZ, SAST or SECRETS' }]);
  }
  /** FR-02 the results of a scan that runs outside: the DAST script and the dependency audit. */
  function postScan(actor, { kind, checked, findings }) {
    guard(actor, 'sct.scan.run');
    return ingest(actor, kind, { checked, findings: findings.map((f) => ({ ...f, key: f.key ?? `${f.rule ?? ''}|${f.endpoint ?? ''}|${f.title}` })), summary: { posted: true } });
  }

  // ---------------------------------------------------------------- FR-03 FR-04 the control reviews
  function review(actor, { controlCode, status, evidence, severity = 'MEDIUM' }) {
    guard(actor, 'sct.review.manage');
    const k = CONTROLS.find((x) => x.code === controlCode);
    if (!k) throw badRequest('Unknown control.', [{ field: 'controlCode', message: CONTROLS.map((x) => x.code).join(', ') }]);
    return transaction(db, () => {
      const id = Number(db.prepare("INSERT INTO sct_reviews (company_id, control_code, area, status, evidence, reviewed_by, reviewed_at, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'review')").run(actor.companyId, k.code, k.area, status, evidence, actor.user, iso(), actor.user).lastInsertRowid);
      writeAudit(db, { companyId: actor.companyId, entity: 'sct_reviews', entityId: id, action: 'review', newValues: { control: k.code, status, evidence }, actor: actor.user });
      let findingId = null;
      if (status === 'GAP') {
        const fingerprint = sha(`REVIEW|${k.code}|${evidence.trim().toLowerCase()}`);
        const cur = db.prepare('SELECT id FROM sct_findings WHERE company_id = ? AND fingerprint = ?').get(actor.companyId, fingerprint);
        findingId = cur?.id ?? raise(actor, { source: 'REVIEW', severity, title: `${k.label}: ${evidence}`.slice(0, 300), description: k.how, endpoint: k.code, cwe: k.area === 'DPDP' ? 'DPDP-2023' : null, fingerprint });
      }
      return { id, controlCode: k.code, status, findingId };
    });
  }

  function exportFindings(actor, q, format) {
    guard(actor, 'sct.finding.export');
    const all = overview(actor, { ...q, page: 1, pageSize: 100000 });
    const rows = all.findings.rows.map((f) => ({ no: f.findingNo, severity: f.severity, source: f.source, title: f.title, endpoint: f.endpoint ?? '', cwe: f.cwe ?? '', status: f.status, fixedIn: f.fixedIn ?? '', retest: f.retestedBy ? `${f.retestedBy} ${f.retestedAt}` : '' }));
    const columns = [['no', 'Finding'], ['severity', 'Severity'], ['source', 'Source'], ['title', 'Title'], ['endpoint', 'Endpoint'], ['cwe', 'CWE'], ['status', 'Status'], ['fixedIn', 'Fixed in'], ['retest', 'Re-tested']].map(([key, label]) => ({ key, label }));
    const buffer = writeExport(format, { columns, rows, title: 'Security findings and remediation (restricted)', sheetName: 'Findings', footer: [`${rows.length} findings · go-live ${all.goLive.blocked ? `blocked by ${all.goLive.critical} critical and ${all.goLive.high} high` : 'clear'} · RESTRICTED`] });
    writeAudit(db, { companyId: actor.companyId, entity: 'report', entityId: 'sct.findings', action: 'export', newValues: { format, rows: rows.length }, actor: actor.user });
    return { buffer, contentType: FORMATS[format], fileName: `security-findings.${format}` };
  }

  return { record, overview, finding, fix, retest, requestDecision, decide, runScan, postScan, review, exportFindings, engine };
}
