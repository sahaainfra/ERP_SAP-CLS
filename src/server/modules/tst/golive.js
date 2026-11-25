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
import { createParameterStore, parameterRegistry } from '../../platform/parameters/index.js';
import { workflowTypes } from '../../platform/workflow/registry.js';
import { todayIST } from '../../../shared/dates.js';
import { backupsOf } from '../admin/backups.js';
import { checkParity } from './envparity.js';
import { CLIENT_MODULES, OWNER, registeredPages } from './pageaudit.js';
import { MODULE_NAMES } from './manuals.js';

/**
 * Part 30.10: UAT, production cut-over and hypercare.
 *
 *  - FR-01 UAT scripts per module and role, made from the business scenarios the build has: each approval workflow (its document, who submits,
 *    the chain of approvers) and each module's main pages for the roles that open them. Business users run them (PASS, FAIL, BLOCKED); a
 *    failure raises a UAT defect, triaged daily (owner, severity S1-S4, fixed in a commit, re-tested and closed). A module is signed off by
 *    its owner (the owner map of 30.03) through the approval engine, refused while it has an open S1 or S2 defect or a script not passed.
 *  - FR-02 BR-01 The readiness checklist: each criterion is evaluated from the records of the earlier parts (gates G1-G7, security findings,
 *    the load test, backups and restore tests, the accessibility sign-off, the documentation package, the runbooks, the on-call rota,
 *    training ≥ 90 % of active users, UAT signed for every module, no open S1/S2, a dry run inside its window) or confirmed with evidence by
 *    its owner. Go-live needs every mandatory criterion MET and the director's approval.
 *  - FR-03 T-01 The cut-over runbook: a timeline of steps with owners and minutes (announce and freeze, rollback point by a verified backup,
 *    final data migration of 29.05, configuration and environment parity, smoke test, user activation, lift the freeze and announce). The
 *    automatic steps run themselves; the others are done by their owners. A dry run records whether it finished inside its window.
 *  - FR-04 The go/no-go meeting (attendees, minutes, the criteria as they stood) is approved by the programme manager, the CFO and the director;
 *    a GO approved announces the date to every user and opens hypercare.
 *  - FR-05 Hypercare (four weeks by default): the war room, the daily report (defects opened, closed and open by severity, alerts, failed jobs,
 *    help-desk tickets, active users), quick fixes recorded through the pipeline (30.08), and the handover to steady-state support approved
 *    by the director when no S1 or S2 is open.
 */
export const GOLIVE_FLAG = 'ff.qa.p3010';
const SIGNOFF_TYPE = 'uat_module_signoff';
const DECISION_TYPE = 'golive_decision';
const HANDOVER_TYPE = 'golive_hypercare_handover';
export const DECISION_CHAIN = ['PCMGR', 'CFO', 'DIR'];
const HYPERCARE_JOB = 'golive.hypercare.daily';
const P = { training: 'golive.training.min_pct', courses: 'golive.training.course_codes', weeks: 'golive.hypercare.weeks', window: 'golive.cutover.window_minutes' };
const iso = (d = new Date()) => d.toISOString();
const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
export const SEVERITIES = ['S1', 'S2', 'S3', 'S4'];
export const CATEGORIES = ['GATES', 'SECURITY', 'PERFORMANCE', 'OPERATIONS', 'DOCUMENTATION', 'SUPPORT', 'TRAINING', 'UAT', 'CUTOVER'];

for (const [key, dataType, def, min, max, description] of [
  [P.training, 'decimal', 90, 0, 100, 'Part 30.10 FR-02: training completion needed for go-live, in % of active users.'],
  [P.courses, 'string', 'ERP-USER', null, null, 'Part 30.10 FR-02: the training courses (codes, comma separated) that count as ERP user training.'],
  [P.weeks, 'integer', 4, 1, 26, 'Part 30.10 FR-05: the length of hypercare in weeks.'],
  [P.window, 'integer', 720, 30, 4320, 'Part 30.10 FR-03: the cut-over window in minutes; a dry run must finish inside it (T-01).'],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType, default: def, ...(min != null ? { min, max } : {}), scopes: ['system', 'company'], description });
integrityRegistry.register({ statuses: { golive_checklist: ['OPEN', 'NOT_MET', 'MET', 'WAIVED'], uat_scripts: ['NOT_RUN', 'PASS', 'FAIL', 'BLOCKED'], uat_defects: ['OPEN', 'TRIAGED', 'FIXED', 'CLOSED', 'DEFERRED'], uat_signoffs: ['SUBMITTED', 'SIGNED', 'REJECTED', 'SUPERSEDED'], golive_cutover_runs: ['PLANNED', 'RUNNING', 'COMPLETED', 'FAILED', 'ROLLED_BACK'], golive_cutover_steps: ['PENDING', 'RUNNING', 'DONE', 'FAILED', 'SKIPPED'], golive_decisions: ['SUBMITTED', 'APPROVED', 'REJECTED', 'RETURNED'], golive_hypercare: ['ACTIVE', 'HANDOVER_REQUESTED', 'HANDED_OVER'], golive_hypercare_days: ['DRAFT', 'PUBLISHED'] } });
for (const [type, description] of [
  ['golive.uat.defect_raised', 'A UAT or hypercare defect was raised (part 30.10): data { defectId, defectNo, module, severity, phase }.'],
  ['golive.uat.module_signed', 'A module was signed off after UAT by its owner (part 30.10): data { signoffId, module }.'],
  ['golive.cutover.completed', 'A cut-over run finished (part 30.10): data { runId, runNo, kind, status, elapsedMinutes, withinWindow }.'],
  ['golive.decision.approved', 'The go/no-go decision was approved by the director (part 30.10 BR-01): data { decisionId, recommendation, goLiveAt }.'],
  ['golive.hypercare.handed_over', 'Hypercare ended and was handed over to steady-state support (part 30.10): data { hypercareId }.'],
]) if (!eventTypes.get(type)) eventTypes.define({ type, version: 1, schema: { type: 'object' }, owner: 'tst', description });

/** FR-02 the readiness criteria: code, title, category, mandatory, evaluation, owner. */
export const CRITERIA = Object.freeze([
  ...['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'].map((g) => ({ code: `GATE_${g}`, title: `Gate ${g} passed (Programme Gates)`, category: 'GATES', mandatory: true, evaluation: 'AUTO', owner: 'ITADM' })),
  { code: 'SECURITY', title: 'No open critical or high security finding (30.05)', category: 'SECURITY', mandatory: true, evaluation: 'AUTO', owner: 'ITADM' },
  { code: 'PERFORMANCE', title: 'The latest load test meets its SLOs (30.06)', category: 'PERFORMANCE', mandatory: true, evaluation: 'AUTO', owner: 'ITADM' },
  { code: 'BACKUPS', title: 'A verified backup in the last 26 hours and a passed restore test in the last 30 days (29.06)', category: 'OPERATIONS', mandatory: true, evaluation: 'AUTO', owner: 'ITADM' },
  { code: 'RUNBOOKS', title: 'Every operations runbook approved (30.08)', category: 'OPERATIONS', mandatory: true, evaluation: 'AUTO', owner: 'ITADM' },
  { code: 'ONCALL', title: 'L1, L2 and L3 on call for the four weeks after go-live (30.08)', category: 'SUPPORT', mandatory: true, evaluation: 'AUTO', owner: 'ITADM' },
  { code: 'SUPPORT_MODEL', title: 'Support model, help desk and escalation contacts agreed with the business', category: 'SUPPORT', mandatory: true, evaluation: 'MANUAL', owner: 'PCMGR' },
  { code: 'ACCESSIBILITY', title: 'Accessibility and device validation signed off (30.07)', category: 'DOCUMENTATION', mandatory: true, evaluation: 'AUTO', owner: 'SYSADM' },
  { code: 'DOCUMENTATION', title: 'Documentation package of the release approved by its owners (30.09)', category: 'DOCUMENTATION', mandatory: true, evaluation: 'AUTO', owner: 'ITADM' },
  { code: 'TRAINING', title: 'ERP user training completed by at least 90 % of active users', category: 'TRAINING', mandatory: true, evaluation: 'AUTO', owner: 'HRMGR' },
  { code: 'UAT_SIGNED', title: 'UAT signed off for every module', category: 'UAT', mandatory: true, evaluation: 'AUTO', owner: 'PCMGR' },
  { code: 'NO_S1_S2', title: 'No open S1 or S2 defect', category: 'UAT', mandatory: true, evaluation: 'AUTO', owner: 'PCMGR' },
  { code: 'DATA_MIGRATION', title: 'Data migration objects signed off by their owners (29.05)', category: 'CUTOVER', mandatory: true, evaluation: 'AUTO', owner: 'ITADM' },
  { code: 'DRY_RUN', title: 'A cut-over dry run completed inside its window', category: 'CUTOVER', mandatory: true, evaluation: 'AUTO', owner: 'PCMGR' },
  { code: 'COMMUNICATION', title: 'Go-live communication plan agreed (dates, freeze, who to call)', category: 'CUTOVER', mandatory: false, evaluation: 'MANUAL', owner: 'PCMGR' },
]);

/** FR-03 the cut-over runbook: code, title, owner, minutes, automatic or not. */
export const CUTOVER_STEPS = Object.freeze([
  { code: 'ANNOUNCE_FREEZE', title: 'Announce the freeze window to every user', owner: 'PCMGR', minutes: 15, mode: 'AUTO' },
  { code: 'ROLLBACK_POINT', title: 'Take the rollback point: a full backup, verified', owner: 'ITADM', minutes: 30, mode: 'AUTO' },
  { code: 'FREEZE_LEGACY', title: 'Freeze the legacy system and take the final extracts', owner: 'ITADM', minutes: 60, mode: 'MANUAL' },
  { code: 'FINAL_MIGRATION', title: 'Final data migration loaded and reconciled (29.05)', owner: 'ITADM', minutes: 240, mode: 'AUTO' },
  { code: 'CONFIGURATION', title: 'Configuration and environment parity checked', owner: 'ITADM', minutes: 30, mode: 'AUTO' },
  { code: 'SMOKE_TEST', title: 'Smoke test: database integrity, jobs, notifications', owner: 'ITADM', minutes: 30, mode: 'AUTO' },
  { code: 'BUSINESS_CHECK', title: 'Business owners check their key figures against the legacy reports', owner: 'PCMGR', minutes: 120, mode: 'MANUAL' },
  { code: 'USER_ACTIVATION', title: 'Users activated with their roles', owner: 'ITADM', minutes: 30, mode: 'AUTO' },
  { code: 'LIFT_FREEZE', title: 'Lift the freeze and announce go-live', owner: 'PCMGR', minutes: 15, mode: 'AUTO' },
]);

/** @param {any} context @param {{ root?: string, jobs?: any, scheduler?: any }} [options] */
export function createGoLiveService(context, { root = process.cwd(), jobs, scheduler } = {}) {
  const { db } = context;
  const guard = (actor, key) => {
    if (!Number.isSafeInteger(actor?.companyId) || actor.companyId < 1 || !context.flags.isOn(actor, GOLIVE_FLAG)) throw notFound('Go-live readiness is not enabled for this company.');
    if (key) assertPermissionAnywhere(actor, key);
  };
  const param = (companyId, key) => createParameterStore(db).get(key, { companyId, date: todayIST() });
  const has = (table) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
  const audit = (actor, entity, id, action, values) => writeAudit(db, { companyId: actor.companyId, entity, entityId: id, action, newValues: values, actor: actor.user });
  const notify = (n) => { try { notificationsOf(db)?.notify(n); } catch { /* no notification service in a bare test */ } };
  const nextNo = (table, col, companyId, prefix) => `${prefix}-${String((db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE company_id = ?`).get(companyId).n ?? 0) + 1).padStart(5, '0')}`;
  let inventory = null; const pages = () => (inventory ??= registeredPages(root).filter((p) => !p.onboardingOnly && !p.route.includes(':')));

  // ---------------------------------------------------------------- FR-02 the readiness checklist
  function ensureChecklist(companyId) {
    for (const c of CRITERIA) db.prepare("INSERT OR IGNORE INTO golive_checklist (company_id, criterion, title, category, mandatory, evaluation, owner_role, status, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', 'system', 'golive')").run(companyId, c.code, c.title, c.category, c.mandatory ? 1 : 0, c.evaluation, c.owner);
  }
  /** What the records say about one automatic criterion: { met, detail, measured?, target? }. */
  function measure(companyId, code) {
    const now = Date.now();
    if (code.startsWith('GATE_')) {
      const g = code.slice(5);
      const row = has('hr_gates') ? db.prepare('SELECT status, passed_at FROM hr_gates WHERE company_id = ? AND code = ?').get(companyId, g) : null;
      return row ? { met: row.status === 'PASSED', detail: row.status === 'PASSED' ? `Passed ${String(row.passed_at ?? '').slice(0, 10)}` : `Gate ${g} is ${row.status.toLowerCase()} on Programme Gates.` } : { met: false, detail: `Gate ${g} has no record on Programme Gates.` };
    }
    if (code === 'SECURITY') {
      const n = has('sct_findings') ? db.prepare("SELECT COUNT(*) AS n FROM sct_findings WHERE company_id = ? AND severity IN ('CRITICAL', 'HIGH') AND status IN ('OPEN', 'FIXED', 'RISK_PENDING') AND deleted_at IS NULL").get(companyId).n : null;
      return n === null ? { met: false, detail: 'Security findings (30.05) are not installed.' } : { met: n === 0, detail: n ? `${n} critical or high findings are open or not re-tested.` : 'No critical or high finding open.', measured: n, target: 0 };
    }
    if (code === 'PERFORMANCE') {
      const r = has('tst_perf_runs') ? db.prepare("SELECT result_status, finished_at FROM tst_perf_runs WHERE company_id = ? AND profile = 'LOAD' AND deleted_at IS NULL ORDER BY finished_at DESC LIMIT 1").get(companyId) : null;
      return r ? { met: r.result_status === 'PASS', detail: `The load test of ${r.finished_at.slice(0, 10)} ${r.result_status === 'PASS' ? 'meets' : 'misses'} its SLOs.` } : { met: false, detail: 'No load test recorded (30.06).' };
    }
    if (code === 'BACKUPS') {
      const b = has('ops_backups') ? db.prepare("SELECT finished_at FROM ops_backups WHERE status = 'VERIFIED' ORDER BY finished_at DESC LIMIT 1").get() : null;
      const t = has('ops_restore_tests') ? db.prepare("SELECT finished_at FROM ops_restore_tests WHERE status = 'PASSED' ORDER BY finished_at DESC LIMIT 1").get() : null;
      const fresh = b && now - Date.parse(b.finished_at) <= 26 * 3_600_000; const tested = t && now - Date.parse(t.finished_at) <= 30 * 86_400_000;
      return { met: Boolean(fresh && tested), detail: `${b ? `Last verified backup ${b.finished_at.slice(0, 16).replace('T', ' ')}` : 'No verified backup'}; ${t ? `last passed restore test ${t.finished_at.slice(0, 10)}` : 'no passed restore test'}.` };
    }
    if (code === 'RUNBOOKS') {
      if (!has('ops_runbooks')) return { met: false, detail: 'Operations runbooks (30.08) are not installed.' };
      const codes = db.prepare('SELECT DISTINCT code FROM ops_runbooks WHERE company_id = ? AND deleted_at IS NULL').all(companyId).map((r) => r.code);
      const approved = codes.filter((c) => db.prepare("SELECT 1 FROM ops_runbooks WHERE company_id = ? AND code = ? AND status = 'APPROVED' AND deleted_at IS NULL").get(companyId, c));
      return { met: codes.length > 0 && approved.length === codes.length, detail: codes.length ? `${approved.length} of ${codes.length} runbooks approved.` : 'No runbook synced yet.', measured: approved.length, target: codes.length };
    }
    if (code === 'ONCALL') {
      if (!has('ops_oncall')) return { met: false, detail: 'The on-call rota (30.08) is not installed.' };
      const until = now + 28 * 86_400_000; const gaps = [];
      for (const level of ['L1', 'L2', 'L3']) {
        let covered = now;
        for (const s of db.prepare("SELECT from_at, to_at FROM ops_oncall WHERE company_id = ? AND support_level = ? AND status = 'ACTIVE' AND deleted_at IS NULL AND to_at > ? ORDER BY from_at").all(companyId, level, iso(new Date(now)))) {
          if (Date.parse(s.from_at) > covered) break;
          covered = Math.max(covered, Date.parse(s.to_at));
        }
        if (covered < until) gaps.push(`${level} from ${iso(new Date(covered)).slice(0, 16).replace('T', ' ')}`);
      }
      return { met: !gaps.length, detail: gaps.length ? `Nobody on call: ${gaps.join('; ')}.` : 'Every level covered for 28 days.' };
    }
    if (code === 'ACCESSIBILITY') {
      const r = db.prepare("SELECT status FROM core_change_requests WHERE company_id = ? AND type = 'tst_a11y_signoff' ORDER BY id DESC LIMIT 1").get(companyId);
      return { met: r?.status === 'APPROVED', detail: r ? `The latest sign-off request is ${r.status.toLowerCase()}.` : 'No sign-off requested (30.07).' };
    }
    if (code === 'DOCUMENTATION') {
      const p = has('man_packages') ? db.prepare("SELECT package_no, status FROM man_packages WHERE company_id = ? AND status IN ('READY', 'APPROVED') AND deleted_at IS NULL ORDER BY id DESC LIMIT 1").get(companyId) : null;
      return p ? { met: p.status === 'APPROVED', detail: `Package ${p.package_no} is ${p.status === 'APPROVED' ? 'approved' : 'waiting for its owners'}.` } : { met: false, detail: 'No documentation package generated (30.09).' };
    }
    if (code === 'TRAINING') {
      const min = Number(param(companyId, P.training)); const courses = String(param(companyId, P.courses)).split(',').map((s) => s.trim()).filter(Boolean);
      const active = db.prepare("SELECT COUNT(*) AS n FROM iam_users WHERE company_id = ? AND status = 'ACTIVE'").get(companyId).n;
      if (!active) return { met: false, detail: 'No active user.', measured: 0, target: min };
      const trained = has('trn_attendance') && courses.length ? db.prepare(`SELECT COUNT(DISTINCT u.id) AS n FROM iam_users u JOIN hr_employees e ON e.user_id = u.id AND e.company_id = u.company_id JOIN trn_attendance a ON a.person_type = 'EMPLOYEE' AND a.person_id = e.id AND a.attendance = 'ATTENDED' AND COALESCE(a.passed, 1) = 1 JOIN trn_sessions s ON s.id = a.session_id JOIN trn_courses c ON c.id = s.course_id
        WHERE u.company_id = ? AND u.status = 'ACTIVE' AND c.code IN (${courses.map(() => '?').join(', ')})`).get(companyId, ...courses).n : 0;
      const pct = Math.round((trained * 10000) / active) / 100;
      return { met: pct >= min, detail: `${trained} of ${active} active users trained (${pct} %; needed ${min} %), courses ${courses.join(', ')}.`, measured: pct, target: min };
    }
    if (code === 'UAT_SIGNED') {
      const mods = db.prepare('SELECT DISTINCT module FROM uat_scripts WHERE company_id = ? AND deleted_at IS NULL').all(companyId).map((r) => r.module);
      const signed = mods.filter((m) => db.prepare("SELECT 1 FROM uat_signoffs WHERE company_id = ? AND module = ? AND status = 'SIGNED' AND deleted_at IS NULL").get(companyId, m));
      return { met: mods.length > 0 && signed.length === mods.length, detail: mods.length ? `${signed.length} of ${mods.length} modules signed.` : 'No UAT scripts generated yet.', measured: signed.length, target: mods.length };
    }
    if (code === 'NO_S1_S2') {
      const n = db.prepare("SELECT COUNT(*) AS n FROM uat_defects WHERE company_id = ? AND severity IN ('S1', 'S2') AND status IN ('OPEN', 'TRIAGED', 'FIXED') AND deleted_at IS NULL").get(companyId).n;
      return { met: n === 0, detail: n ? `${n} S1/S2 defects open.` : 'No S1 or S2 defect open.', measured: n, target: 0 };
    }
    if (code === 'DATA_MIGRATION') {
      if (!has('mig_objects')) return { met: false, detail: 'The data migration cockpit (29.05) is not installed.' };
      const all = db.prepare('SELECT status FROM mig_objects WHERE company_id = ? AND deleted_at IS NULL').all(companyId);
      const ready = all.filter((o) => ['SIGNED_OFF', 'LOADED'].includes(o.status)).length;
      return { met: all.length > 0 && ready === all.length, detail: all.length ? `${ready} of ${all.length} migration objects signed off or loaded.` : 'No migration object planned.', measured: ready, target: all.length };
    }
    if (code === 'DRY_RUN') {
      const r = db.prepare("SELECT run_no, status, within_window, elapsed_minutes, window_minutes FROM golive_cutover_runs WHERE company_id = ? AND kind = 'DRY_RUN' AND deleted_at IS NULL ORDER BY id DESC LIMIT 1").get(companyId);
      return r ? { met: r.status === 'COMPLETED' && r.within_window === 1, detail: `Dry run ${r.run_no}: ${r.status.toLowerCase()}${r.elapsed_minutes != null ? `, ${r.elapsed_minutes} of ${r.window_minutes} minutes` : ''}.` } : { met: false, detail: 'No dry run yet.' };
    }
    return null;
  }
  /** Evaluate every automatic criterion now (the board's refresh, the decision and a daily job). A manual criterion keeps its owner's word. */
  function evaluate(actor) {
    ensureChecklist(actor.companyId);
    return transaction(db, () => {
      for (const c of db.prepare("SELECT * FROM golive_checklist WHERE company_id = ? AND evaluation = 'AUTO' AND deleted_at IS NULL").all(actor.companyId)) {
        if (c.status === 'WAIVED') continue;
        const m = measure(actor.companyId, c.criterion); if (!m) continue;
        const status = m.met ? 'MET' : 'NOT_MET';
        if (status !== c.status || m.detail !== c.detail) db.prepare('UPDATE golive_checklist SET status = ?, detail = ?, measured_value = ?, target_value = ?, checked_by = ?, checked_at = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(status, m.detail, m.measured ?? null, m.target ?? null, 'system', iso(), iso(), c.id);
      }
      return checklist(actor);
    });
  }
  const itemView = (c) => ({ id: c.id, criterion: c.criterion, title: c.title, category: c.category, mandatory: c.mandatory === 1, evaluation: c.evaluation, ownerRole: c.owner_role, ownerId: c.owner_id, evidence: parse(c.evidence_links, []), status: c.status, detail: c.detail, measured: c.measured_value, target: c.target_value, checkedBy: c.checked_by, checkedAt: c.checked_at, waiverReason: c.waiver_reason, version: c.version });
  function checklist(actor) {
    ensureChecklist(actor.companyId);
    const rows = db.prepare('SELECT * FROM golive_checklist WHERE company_id = ? AND deleted_at IS NULL ORDER BY id').all(actor.companyId).map(itemView);
    const mandatoryOpen = rows.filter((r) => r.mandatory && r.status !== 'MET');
    return { items: rows, ready: mandatoryOpen.length === 0, mandatoryOpen: mandatoryOpen.map((r) => r.criterion) };
  }
  /** A manual criterion: its owner (or the programme manager) confirms it with evidence or marks it not met; an optional one may be waived. */
  function setItem(actor, id, { status, evidence = [], note, ownerId, version }) {
    guard(actor);
    const c = db.prepare('SELECT * FROM golive_checklist WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId);
    if (!c) throw notFound('That criterion does not exist.');
    if (!(actor.roles ?? []).includes(c.owner_role) && !hasPermissionAnywhere(actor, 'golive.manage')) throw forbidden(`This criterion belongs to ${c.owner_role}.`);
    if (version !== undefined && version !== c.version) throw conflict('This criterion was changed by someone else. Refresh and try again.');
    if (c.evaluation === 'AUTO' && status !== 'WAIVED' && ownerId === undefined) throw unprocessable('This criterion is evaluated from the records; refresh the board instead.');
    if (status === 'MET' && !evidence.length && !parse(c.evidence_links, []).length) throw badRequest('Give the evidence (a link to the record or document) when you mark a criterion met.', [{ field: 'evidence', message: 'at least one link' }]);
    if (status === 'WAIVED' && c.mandatory) throw unprocessable('A mandatory criterion cannot be waived (BR-01).');
    if (status === 'WAIVED' && (!note || note.trim().length < 10)) throw badRequest('Say why the criterion is waived (at least 10 characters).', [{ field: 'note', message: 'required' }]);
    const links = [...new Set([...parse(c.evidence_links, []), ...evidence])].slice(0, 20);
    return transaction(db, () => {
      if (c.evaluation === 'AUTO' && status !== 'WAIVED') db.prepare('UPDATE golive_checklist SET owner_id = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?').run(ownerId ?? c.owner_id, iso(), actor.user, c.id);
      else db.prepare('UPDATE golive_checklist SET status = ?, evidence_links = ?, detail = COALESCE(?, detail), waiver_reason = ?, owner_id = COALESCE(?, owner_id), checked_by = ?, checked_at = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?')
        .run(status, JSON.stringify(links), note ?? null, status === 'WAIVED' ? note : null, ownerId ?? null, actor.user, iso(), iso(), actor.user, c.id);
      audit(actor, 'golive_checklist', c.id, 'set', { criterion: c.criterion, from: c.status, to: c.evaluation === 'AUTO' && status !== 'WAIVED' ? c.status : status, evidence: links.length, ownerId: ownerId ?? null });
      return itemView(db.prepare('SELECT * FROM golive_checklist WHERE id = ?').get(c.id));
    });
  }

  // ---------------------------------------------------------------- FR-01 UAT scripts, defects and sign-off
  /** The module of a workflow type: the module of the page its documents open in. */
  const moduleOfRoute = (route) => { if (!route) return null; const path = route.split('?')[0]; return pages().filter((p) => path === p.route || path.startsWith(`${p.route}/`)).sort((a, b) => b.route.length - a.route.length)[0]?.module ?? null; };
  /** FR-01 the scripts from the business scenarios of the build: one per approval workflow, and the main pages of each module per role. */
  function generateScripts(actor) {
    guard(actor, 'golive.manage');
    const out = [];
    for (const w of workflowTypes.list()) {
      let route; try { route = w.route?.(1) ?? null; } catch { route = null; }
      const module = moduleOfRoute(route); if (!module) continue;
      const steps = (w.defaultDefinition?.steps ?? []).filter((s) => s.type !== 'system');
      const approvers = steps.map((s) => (s.approvers ?? []).map((a) => (a.kind === 'role' ? a.role : a.kind)).join(' or '));
      const page = pages().find((p) => route && (route.split('?')[0] === p.route || route.startsWith(`${p.route}?`))) ?? pages().find((p) => p.module === module);
      const submitter = ROLE_TEMPLATES.find((r) => page?.permission && r.permissions.includes(page.permission) && !['SYSADM', 'ITADM', 'DIR', 'AUD', 'SUPADM'].includes(r.code))?.code ?? w.processOwner ?? 'SYSADM';
      out.push({ code: `wf.${w.docType}`, module, role: submitter, title: `${w.label ?? w.docType}: create, submit and approve`, source: 'WORKFLOW',
        steps: [`Sign in as ${submitter} and open ${page?.label ?? module}.`, `Create a ${w.label ?? w.docType} with real data of your project.`, 'Attach the supporting document and submit it.', ...approvers.map((a, i) => `Step ${i + 1} (${steps[i].name}): sign in as ${a}, check the decision evidence and approve; return it once with a comment and resubmit.`), 'Check the history, the notifications and the record in the reports that use it.'],
        expected: `The ${w.label ?? w.docType} moves through ${approvers.length} approval step(s) and is approved; the creator cannot approve it; every step is in its history.` });
    }
    for (const m of CLIENT_MODULES) {
      const list = pages().filter((p) => p.module === m && p.permission);
      for (const p of list.slice(0, 6)) {
        const role = ROLE_TEMPLATES.find((r) => r.permissions.includes(p.permission) && !['SYSADM', 'ITADM', 'DIR', 'AUD', 'SUPADM'].includes(r.code))?.code;
        if (!role) continue;
        out.push({ code: `page.${p.route.replace(/^\//, '').replace(/\//g, '.')}`, module: m, role, title: `${p.label}: daily use`, source: 'PAGE',
          steps: [`Sign in as ${role} on a phone and on a desktop.`, `Open ${p.label} from the menu.`, 'Filter, search and open a record of your own project; export the list.', 'Do the page\'s main action with real data and check the result where it is used next.'],
          expected: `${p.label} shows only your projects' data, its main action works, and the export holds what the screen shows.` });
      }
    }
    return transaction(db, () => {
      let added = 0;
      for (const s of out) {
        const r = db.prepare("INSERT OR IGNORE INTO uat_scripts (company_id, code, module, role_code, title, scenario_source, steps_json, expected, status, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'NOT_RUN', ?, 'golive')")
          .run(actor.companyId, s.code, s.module, s.role, s.title.slice(0, 200), s.source, JSON.stringify(s.steps), s.expected, actor.user);
        added += Number(r.changes);
      }
      audit(actor, 'uat_scripts', 'generate', 'generate', { scenarios: out.length, added });
      return { scenarios: out.length, added };
    });
  }
  const scriptView = (s) => ({ id: s.id, code: s.code, module: s.module, role: s.role_code, title: s.title, source: s.scenario_source, steps: parse(s.steps_json, []), expected: s.expected, status: s.status, executedBy: s.executed_by, executedAt: s.executed_at, notes: s.notes, version: s.version });
  const defectView = (d) => ({ id: d.id, defectNo: d.defect_no, phase: d.phase, module: d.module, scriptId: d.script_id, title: d.title, description: d.description, severity: d.severity, status: d.status, ownerId: d.owner_id, reportedBy: d.reported_by, reportedAt: d.reported_at, triagedBy: d.triaged_by, fixedIn: d.fixed_in, closedAt: d.closed_at, deferredReason: d.deferred_reason, version: d.version });
  function raiseDefect(actor, b, phase) {
    return transaction(db, () => {
      const no = nextNo('uat_defects', 'defect_no', actor.companyId, phase === 'UAT' ? 'UAT' : 'HC');
      const id = Number(db.prepare("INSERT INTO uat_defects (company_id, defect_no, phase, module, script_id, title, description, severity, status, reported_by, reported_at, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, 'golive')")
        .run(actor.companyId, no, phase, b.module, b.scriptId ?? null, b.title, b.description ?? null, b.severity, actor.user, iso(), actor.user).lastInsertRowid);
      audit(actor, 'uat_defects', id, 'raise', { defectNo: no, module: b.module, severity: b.severity, phase });
      publishEvent(db, { type: 'golive.uat.defect_raised', entity: 'uat_defects', entityId: id, actorId: actor.user, companyId: actor.companyId, data: { defectId: id, defectNo: no, module: b.module, severity: b.severity, phase } });
      if (['S1', 'S2'].includes(b.severity)) notify({ companyId: actor.companyId, templateCode: 'golive.hypercare.daily', recipients: ['permission:uat.triage'], channels: ['IN_APP'], priority: 'HIGH', data: { date: todayIST(), open: 1, opened: 1, closed: 0, s1: b.severity === 'S1' ? 1 : 0, s2: b.severity === 'S2' ? 1 : 0 }, link: '/admin/go-live?tab=uat', sourceType: 'uat_defects', sourceId: String(id) });
      return defectView(db.prepare('SELECT * FROM uat_defects WHERE id = ?').get(id));
    });
  }
  /** A business user runs a script: PASS, FAIL (with the defect it raises) or BLOCKED. */
  function runScript(actor, id, { result, notes, defect, version }) {
    guard(actor, 'uat.execute');
    const s = db.prepare('SELECT * FROM uat_scripts WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId);
    if (!s) throw notFound('That UAT script does not exist.');
    if (version !== undefined && version !== s.version) throw conflict('This script was run by someone else meanwhile. Refresh it.');
    if (db.prepare("SELECT 1 FROM uat_signoffs WHERE company_id = ? AND module = ? AND status IN ('SUBMITTED', 'SIGNED') AND deleted_at IS NULL").get(actor.companyId, s.module)) throw conflict('The module is signed off or waiting for its sign-off; its scripts are locked.');
    if (result === 'FAIL' && !defect) throw badRequest('A failed script raises a defect: give its title and severity.', [{ field: 'defect', message: 'required when the result is FAIL' }]);
    return transaction(db, () => {
      db.prepare('UPDATE uat_scripts SET status = ?, executed_by = ?, executed_at = ?, notes = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?').run(result, actor.user, iso(), notes ?? null, iso(), actor.user, s.id);
      audit(actor, 'uat_scripts', s.id, 'run', { result });
      const raised = result === 'FAIL' ? raiseDefect(actor, { module: s.module, scriptId: s.id, title: defect.title, description: defect.description, severity: defect.severity }, 'UAT') : null;
      return { script: scriptView(db.prepare('SELECT * FROM uat_scripts WHERE id = ?').get(s.id)), defect: raised };
    });
  }
  /** Daily triage: owner and severity, fixed in a commit, re-tested and closed, or deferred with a reason (never an S1). */
  function triage(actor, id, { action, severity, ownerId, fixedIn, reason, version }) {
    // the reporter re-tests and closes; every other action is the triagers'
    guard(actor, action === 'close' ? 'uat.execute' : 'uat.triage');
    const d = db.prepare('SELECT * FROM uat_defects WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId);
    if (!d) throw notFound('That defect does not exist.');
    if (version !== undefined && version !== d.version) throw conflict('This defect was changed by someone else. Refresh it.');
    const next = { triage: 'TRIAGED', fix: 'FIXED', close: 'CLOSED', defer: 'DEFERRED', reopen: 'OPEN' }[action];
    const allowed = { triage: ['OPEN', 'TRIAGED'], fix: ['OPEN', 'TRIAGED'], close: ['FIXED'], defer: ['OPEN', 'TRIAGED'], reopen: ['FIXED', 'CLOSED', 'DEFERRED'] }[action];
    if (!allowed.includes(d.status)) throw conflict(`A ${d.status.toLowerCase()} defect cannot be ${action === 'fix' ? 'fixed' : `${action}d`}.`);
    if (action === 'fix' && !/^[0-9a-f]{7,40}$/.test(fixedIn ?? '')) throw badRequest('Name the commit that fixes it (it reaches production only through the pipeline).', [{ field: 'fixedIn', message: 'a commit hash' }]);
    if (action === 'close' && d.reported_by !== actor.user && !hasPermissionAnywhere(actor, 'golive.manage')) throw forbidden('The person who reported the defect (or the programme manager) re-tests and closes it.');
    const sev = severity ?? d.severity;
    if (action === 'defer' && (sev === 'S1' || !reason || reason.trim().length < 10)) throw unprocessable(sev === 'S1' ? 'An S1 defect cannot be deferred.' : 'Say why it is deferred (at least 10 characters).');
    return transaction(db, () => {
      db.prepare(`UPDATE uat_defects SET status = ?, severity = ?, owner_id = COALESCE(?, owner_id), triaged_by = CASE WHEN ? = 'triage' THEN ? ELSE triaged_by END, triaged_at = CASE WHEN ? = 'triage' THEN ? ELSE triaged_at END,
        fixed_in = COALESCE(?, fixed_in), fixed_at = CASE WHEN ? = 'fix' THEN ? ELSE fixed_at END, closed_by = CASE WHEN ? = 'close' THEN ? ELSE closed_by END, closed_at = CASE WHEN ? = 'close' THEN ? ELSE closed_at END,
        deferred_reason = CASE WHEN ? = 'defer' THEN ? ELSE deferred_reason END, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?`)
        .run(next, sev, ownerId ?? null, action, actor.user, action, iso(), fixedIn ?? null, action, iso(), action, actor.user, action, iso(), action, reason ?? null, iso(), actor.user, d.id);
      audit(actor, 'uat_defects', d.id, action, { from: d.status, to: next, severity: sev, fixedIn: fixedIn ?? null });
      return defectView(db.prepare('SELECT * FROM uat_defects WHERE id = ?').get(d.id));
    });
  }
  const engine = createApprovalEngine({ db, handlers: {
    [SIGNOFF_TYPE]: {
      authorize(_db, actor, r) { if (actor.companyId !== r.company_id) throw forbidden('Another company\'s request.'); },
      apply(_db, request, actor) {
        const s = db.prepare('SELECT * FROM uat_signoffs WHERE id = ?').get(Number(request.targetId));
        db.prepare("UPDATE uat_signoffs SET status = 'SIGNED', signed_by = ?, signed_at = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, iso(), iso(), s.id);
        writeAudit(db, { companyId: s.company_id, entity: 'uat_signoffs', entityId: s.id, action: 'sign', newValues: { module: s.module }, actor: actor.user });
        publishEvent(db, { type: 'golive.uat.module_signed', entity: 'uat_signoffs', entityId: s.id, actorId: actor.user, companyId: s.company_id, data: { signoffId: s.id, module: s.module } });
      },
    },
    [DECISION_TYPE]: {
      authorize(_db, actor, r) { if (actor.companyId !== r.company_id) throw forbidden('Another company\'s request.'); },
      apply(_db, request, actor) { approveDecision(Number(request.targetId), actor); },
    },
    [HANDOVER_TYPE]: {
      authorize(_db, actor, r) { if (actor.companyId !== r.company_id) throw forbidden('Another company\'s request.'); },
      apply(_db, request, actor) {
        const h = db.prepare('SELECT * FROM golive_hypercare WHERE id = ?').get(Number(request.targetId));
        db.prepare("UPDATE golive_hypercare SET status = 'HANDED_OVER', handed_over_by = ?, handed_over_at = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, iso(), iso(), h.id);
        writeAudit(db, { companyId: h.company_id, entity: 'golive_hypercare', entityId: h.id, action: 'hand_over', newValues: { notes: h.handover_notes }, actor: actor.user });
        publishEvent(db, { type: 'golive.hypercare.handed_over', entity: 'golive_hypercare', entityId: h.id, actorId: actor.user, companyId: h.company_id, data: { hypercareId: h.id } });
      },
    },
  } });
  const moduleCounts = (companyId, module) => {
    const s = db.prepare("SELECT COUNT(*) AS total, SUM(status = 'PASS') AS passed FROM uat_scripts WHERE company_id = ? AND module = ? AND deleted_at IS NULL").get(companyId, module);
    const open = db.prepare("SELECT COUNT(*) AS n FROM uat_defects WHERE company_id = ? AND module = ? AND status IN ('OPEN', 'TRIAGED', 'FIXED') AND deleted_at IS NULL").get(companyId, module).n;
    const blocking = db.prepare("SELECT COUNT(*) AS n FROM uat_defects WHERE company_id = ? AND module = ? AND severity IN ('S1', 'S2') AND status IN ('OPEN', 'TRIAGED', 'FIXED') AND deleted_at IS NULL").get(companyId, module).n;
    return { total: s.total, passed: s.passed ?? 0, open, blocking };
  };
  /** The programme manager asks the module's owner to sign: every script passed, no open S1/S2. */
  function requestSignoff(actor, module, { reason }) {
    guard(actor, 'golive.manage');
    const c = moduleCounts(actor.companyId, module);
    if (!c.total) throw notFound('That module has no UAT scripts.');
    if (c.passed < c.total) throw unprocessable(`${c.total - c.passed} of ${c.total} scripts of the module have not passed.`);
    if (c.blocking) throw unprocessable(`${c.blocking} S1/S2 defects of the module are open.`);
    if (db.prepare("SELECT 1 FROM uat_signoffs WHERE company_id = ? AND module = ? AND status IN ('SUBMITTED', 'SIGNED') AND deleted_at IS NULL").get(actor.companyId, module)) throw conflict('The module is already signed or waiting for its owner.');
    const owner = OWNER[module] ?? 'SYSADM';
    return transaction(db, () => {
      const id = Number(db.prepare("INSERT INTO uat_signoffs (company_id, module, owner_role, status, scripts_total, scripts_passed, open_defects, requested_by, requested_at, created_by, source_type) VALUES (?, ?, ?, 'SUBMITTED', ?, ?, ?, ?, ?, ?, 'golive')").run(actor.companyId, module, owner, c.total, c.passed, c.open, actor.user, iso(), actor.user).lastInsertRowid);
      const req = engine.submit(actor, { type: SIGNOFF_TYPE, title: `UAT sign-off of ${MODULE_NAMES[module]?.[0] ?? module}`, targetType: 'uat_signoffs', targetId: String(id), payload: { module, ...c }, reason, chain: [owner] });
      db.prepare('UPDATE uat_signoffs SET request_id = ? WHERE id = ?').run(req.id, id);
      notify({ companyId: actor.companyId, templateCode: 'man.manual.review', recipients: [`role:${owner}`], channels: ['IN_APP'], priority: 'NORMAL', data: { title: `UAT sign-off of ${MODULE_NAMES[module]?.[0] ?? module}`, build: '' }, link: '/admin/go-live?tab=uat', sourceType: 'uat_signoffs', sourceId: String(id) });
      return { id, module, owner, request: { id: req.id, status: req.status } };
    });
  }
  function decide(actor, requestId, body) {
    guard(actor);
    const r = db.prepare(`SELECT * FROM core_change_requests WHERE id = ? AND company_id = ? AND type IN ('${SIGNOFF_TYPE}', '${DECISION_TYPE}', '${HANDOVER_TYPE}')`).get(Number(requestId), actor.companyId);
    if (!r) throw notFound('That request does not exist.');
    const out = engine.act(actor, r.id, body);
    if (out.status === 'REJECTED' || out.status === 'RETURNED') {
      if (r.type === SIGNOFF_TYPE) db.prepare("UPDATE uat_signoffs SET status = 'REJECTED', updated_at = ?, version = version + 1 WHERE id = ?").run(iso(), Number(r.target_id));
      if (r.type === DECISION_TYPE) db.prepare('UPDATE golive_decisions SET status = ?, decided_at = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(out.status, iso(), iso(), Number(r.target_id));
      if (r.type === HANDOVER_TYPE) db.prepare("UPDATE golive_hypercare SET status = 'ACTIVE', updated_at = ?, version = version + 1 WHERE id = ?").run(iso(), Number(r.target_id));
    }
    return { id: out.id, status: out.status };
  }

  // ---------------------------------------------------------------- FR-03 T-01 the cut-over runbook and its dry run
  const runView = (r) => r && ({ id: r.id, runNo: r.run_no, kind: r.kind, windowMinutes: r.window_minutes, plannedStart: r.planned_start, status: r.status, rollbackPoint: r.rollback_point, decisionId: r.decision_id, startedAt: r.started_at, finishedAt: r.finished_at, elapsedMinutes: r.elapsed_minutes, withinWindow: r.within_window == null ? null : r.within_window === 1, startedBy: r.started_by,
    steps: db.prepare('SELECT * FROM golive_cutover_steps WHERE run_id = ? ORDER BY seq').all(r.id).map((s) => ({ id: s.id, seq: s.seq, code: s.code, title: s.title, ownerRole: s.owner_role, mode: s.mode, plannedMinutes: s.planned_minutes, status: s.status, startedAt: s.started_at, finishedAt: s.finished_at, doneBy: s.done_by, detail: s.detail })) });
  /** Plan a run: a dry run any time; the production run only after the director approved GO (BR-01). */
  function planRun(actor, { kind, windowMinutes, plannedStart }) {
    guard(actor, 'golive.manage');
    let decision = null;
    if (kind === 'PRODUCTION') {
      decision = db.prepare("SELECT * FROM golive_decisions WHERE company_id = ? AND status = 'APPROVED' AND recommendation = 'GO' AND deleted_at IS NULL ORDER BY id DESC LIMIT 1").get(actor.companyId);
      if (!decision) throw unprocessable('The production cut-over needs a GO decision approved by the director (BR-01).');
    }
    if (db.prepare("SELECT 1 FROM golive_cutover_runs WHERE company_id = ? AND status IN ('PLANNED', 'RUNNING') AND deleted_at IS NULL").get(actor.companyId)) throw conflict('A cut-over run is already planned or running.');
    const minutes = windowMinutes ?? Number(param(actor.companyId, P.window));
    return transaction(db, () => {
      const id = Number(db.prepare("INSERT INTO golive_cutover_runs (company_id, run_no, kind, window_minutes, planned_start, status, decision_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, 'PLANNED', ?, ?, 'golive')").run(actor.companyId, nextNo('golive_cutover_runs', 'run_no', actor.companyId, kind === 'DRY_RUN' ? 'DRY' : 'CUT'), kind, minutes, plannedStart ?? null, decision?.id ?? null, actor.user).lastInsertRowid);
      CUTOVER_STEPS.forEach((s, i) => db.prepare("INSERT INTO golive_cutover_steps (company_id, run_id, seq, code, title, owner_role, mode, planned_minutes, status, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, 'golive')").run(actor.companyId, id, i + 1, s.code, s.title, s.owner, s.mode, s.minutes, actor.user));
      audit(actor, 'golive_cutover_runs', id, 'plan', { kind, windowMinutes: minutes });
      return runView(db.prepare('SELECT * FROM golive_cutover_runs WHERE id = ?').get(id));
    });
  }
  const systemActor = (companyId, runNo) => ({ user: `cutover:${runNo}`, roles: ['ITADM'], companyId });
  /** What an automatic step does. Returns { ok, detail, rollbackPoint? }. */
  async function doStep(run, step) {
    const c = run.company_id; const dry = run.kind === 'DRY_RUN';
    switch (step.code) {
      case 'ANNOUNCE_FREEZE':
      case 'LIFT_FREEZE': {
        if (!dry) notify({ companyId: c, templateCode: 'golive.announcement', recipients: ['permission:hd.ticket.raise'], channels: ['IN_APP', 'EMAIL'], priority: 'HIGH', data: { goLiveAt: (db.prepare('SELECT go_live_at FROM golive_decisions WHERE id = ?').get(run.decision_id)?.go_live_at ?? '').slice(0, 10), message: step.code === 'ANNOUNCE_FREEZE' ? 'The legacy systems are frozen for the cut-over; do not enter transactions until the go-live announcement.' : 'The ERP is live. Start working in it; your manuals are in Help.' }, link: '/help/documentation', sourceType: 'golive_cutover_runs', sourceId: String(run.id) });
        return { ok: true, detail: dry ? 'Dry run: the announcement is prepared, not sent.' : 'Announced to every user (in-app and e-mail).' };
      }
      case 'ROLLBACK_POINT': {
        const svc = backupsOf(db);
        if (!svc) return { ok: false, detail: 'The backup service (29.06) is not mounted.' };
        try { const b = svc.backupNow(systemActor(c, run.run_no), { type: 'FULL' }); return { ok: b?.status === 'VERIFIED', detail: `Backup ${b?.name} ${String(b?.status ?? '').toLowerCase()}.`, rollbackPoint: b?.name ?? null }; } catch (err) { return { ok: false, detail: `Backup failed: ${err.message}` }; }
      }
      case 'FINAL_MIGRATION': {
        if (!has('mig_objects')) return { ok: false, detail: 'The data migration cockpit (29.05) is not installed.' };
        const all = db.prepare('SELECT status FROM mig_objects WHERE company_id = ? AND deleted_at IS NULL').all(c);
        const ready = all.filter((o) => (dry ? ['SIGNED_OFF', 'LOADED'] : ['LOADED']).includes(o.status)).length;
        return { ok: all.length === 0 ? dry : ready === all.length, detail: all.length ? `${ready} of ${all.length} migration objects ${dry ? 'signed off or loaded' : 'loaded and reconciled'}.` : dry ? 'Dry run: no migration object planned yet.' : 'No migration object planned.' };
      }
      case 'CONFIGURATION': {
        const p = checkParity(root);
        return { ok: p.problems.length === 0, detail: p.problems.length ? `Parity problems: ${p.problems.slice(0, 3).join('; ')}` : `${p.environments.length} environments in parity, ${p.keys.length} settings.` };
      }
      case 'SMOKE_TEST': {
        const integrity = db.prepare('PRAGMA quick_check').get(); const ok = Object.values(integrity)[0] === 'ok';
        const failed = db.prepare("SELECT COUNT(*) AS n FROM core_jobs WHERE status = 'FAILED' AND finished_at > ?").get(iso(new Date(Date.now() - 86_400_000))).n;
        return { ok, detail: `Database quick check ${ok ? 'ok' : 'failed'}; ${failed} jobs failed in the last 24 hours.` };
      }
      case 'USER_ACTIVATION': {
        const active = db.prepare("SELECT COUNT(*) AS n FROM iam_users WHERE company_id = ? AND status = 'ACTIVE'").get(c).n;
        const roleless = db.prepare("SELECT COUNT(*) AS n FROM iam_users WHERE company_id = ? AND status = 'ACTIVE' AND (roles_json IS NULL OR roles_json IN ('', '[]'))").get(c).n;
        return { ok: active > 0 && roleless === 0, detail: `${active} active users; ${roleless} without a role.` };
      }
      default: return { ok: false, detail: 'Not an automatic step.' };
    }
  }
  /** Run the automatic steps in order until one needs a person; a failed step fails the run (the rollback point stays). */
  async function advance(runId) {
    const run = db.prepare('SELECT * FROM golive_cutover_runs WHERE id = ?').get(runId);
    if (!run || run.status !== 'RUNNING') return runView(run);
    for (const step of db.prepare("SELECT * FROM golive_cutover_steps WHERE run_id = ? AND status IN ('PENDING', 'RUNNING') ORDER BY seq").all(run.id)) {
      if (step.mode === 'MANUAL') { db.prepare("UPDATE golive_cutover_steps SET status = 'RUNNING', started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?").run(iso(), iso(), step.id); return runView(db.prepare('SELECT * FROM golive_cutover_runs WHERE id = ?').get(run.id)); }
      db.prepare("UPDATE golive_cutover_steps SET status = 'RUNNING', started_at = ?, updated_at = ? WHERE id = ?").run(iso(), iso(), step.id);
      const r = await doStep(run, step);
      db.prepare('UPDATE golive_cutover_steps SET status = ?, finished_at = ?, done_by = ?, detail = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(r.ok ? 'DONE' : 'FAILED', iso(), 'system', r.detail.slice(0, 500), iso(), step.id);
      if (r.rollbackPoint) db.prepare('UPDATE golive_cutover_runs SET rollback_point = ? WHERE id = ?').run(r.rollbackPoint, run.id);
      if (!r.ok) return finish(run, 'FAILED');
    }
    return finish(run, 'COMPLETED');
  }
  function finish(run, status) {
    const started = Date.parse(run.started_at); const elapsed = Math.round(((Date.now() - started) / 60_000) * 100) / 100;
    const within = status === 'COMPLETED' && elapsed <= run.window_minutes ? 1 : 0;
    db.prepare('UPDATE golive_cutover_runs SET status = ?, finished_at = ?, elapsed_minutes = ?, within_window = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(status, iso(), elapsed, within, iso(), run.id);
    writeAudit(db, { companyId: run.company_id, entity: 'golive_cutover_runs', entityId: run.id, action: status.toLowerCase(), newValues: { elapsedMinutes: elapsed, withinWindow: Boolean(within) }, actor: run.started_by ?? 'system' });
    publishEvent(db, { type: 'golive.cutover.completed', entity: 'golive_cutover_runs', entityId: run.id, actorId: run.started_by ?? 'system', companyId: run.company_id, data: { runId: run.id, runNo: run.run_no, kind: run.kind, status, elapsedMinutes: elapsed, withinWindow: Boolean(within) } });
    if (run.kind === 'PRODUCTION' && status === 'COMPLETED') openHypercare(run);
    return runView(db.prepare('SELECT * FROM golive_cutover_runs WHERE id = ?').get(run.id));
  }
  async function startRun(actor, id) {
    guard(actor, 'golive.manage');
    const run = db.prepare('SELECT * FROM golive_cutover_runs WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId);
    if (!run) throw notFound('That cut-over run does not exist.');
    if (run.status !== 'PLANNED') throw conflict(`The run is ${run.status.toLowerCase()}.`);
    db.prepare("UPDATE golive_cutover_runs SET status = 'RUNNING', started_at = ?, started_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(iso(), actor.user, iso(), run.id);
    audit(actor, 'golive_cutover_runs', run.id, 'start', { kind: run.kind });
    return advance(run.id);
  }
  /** A person completes the manual step they own (or marks it failed); the run then goes on. */
  async function completeStep(actor, stepId, { result, detail }) {
    guard(actor);
    const s = db.prepare('SELECT * FROM golive_cutover_steps WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(stepId), actor.companyId);
    if (!s) throw notFound('That step does not exist.');
    if (s.mode !== 'MANUAL' || s.status !== 'RUNNING') throw conflict('Only the manual step the run is waiting for can be completed.');
    if (!(actor.roles ?? []).includes(s.owner_role) && !hasPermissionAnywhere(actor, 'golive.manage')) throw forbidden(`This step belongs to ${s.owner_role}.`);
    db.prepare('UPDATE golive_cutover_steps SET status = ?, finished_at = ?, done_by = ?, detail = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(result === 'DONE' ? 'DONE' : 'FAILED', iso(), actor.user, detail, iso(), s.id);
    audit(actor, 'golive_cutover_steps', s.id, result.toLowerCase(), { code: s.code });
    const run = db.prepare('SELECT * FROM golive_cutover_runs WHERE id = ?').get(s.run_id);
    return result === 'DONE' ? advance(run.id) : finish(run, 'FAILED');
  }
  /** Roll back a failed production run to its rollback point: recorded here; the restore itself is the approved restore of 29.06. */
  function rollBack(actor, id, { reason }) {
    guard(actor, 'golive.manage');
    const run = db.prepare('SELECT * FROM golive_cutover_runs WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId);
    if (!run) throw notFound('That cut-over run does not exist.');
    if (!['FAILED', 'RUNNING'].includes(run.status)) throw conflict(`A ${run.status.toLowerCase()} run is not rolled back.`);
    db.prepare("UPDATE golive_cutover_runs SET status = 'ROLLED_BACK', finished_at = COALESCE(finished_at, ?), remarks = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(iso(), reason, iso(), run.id);
    audit(actor, 'golive_cutover_runs', run.id, 'roll_back', { rollbackPoint: run.rollback_point, reason });
    return { ...runView(db.prepare('SELECT * FROM golive_cutover_runs WHERE id = ?').get(run.id)), restore: run.rollback_point ? `Request the production restore of ${run.rollback_point} on Backup & Recovery (ITADM then DIR).` : 'No rollback point was taken.' };
  }

  // ---------------------------------------------------------------- FR-04 BR-01 the go/no-go decision
  const decisionView = (d) => d && ({ id: d.id, decisionNo: d.decision_no, meetingAt: d.meeting_at, attendees: parse(d.attendees_json, []), recommendation: d.recommendation, goLiveAt: d.go_live_at, criteria: parse(d.criteria_json, []), minutes: d.minutes, status: d.status, requestId: d.request_id, decidedAt: d.decided_at, communicatedAt: d.communicated_at, createdBy: d.created_by });
  function submitDecision(actor, { meetingAt, attendees, recommendation, goLiveAt, minutes }) {
    guard(actor, 'golive.manage');
    const c = evaluate(actor);
    if (recommendation === 'GO' && !c.ready) throw unprocessable(`Go-live needs every mandatory criterion met (BR-01); not met: ${c.mandatoryOpen.join(', ')}.`);
    if (recommendation === 'GO' && !goLiveAt) throw badRequest('Give the go-live date.', [{ field: 'goLiveAt', message: 'required for GO' }]);
    if (db.prepare("SELECT 1 FROM golive_decisions WHERE company_id = ? AND status = 'SUBMITTED' AND deleted_at IS NULL").get(actor.companyId)) throw conflict('A decision is already waiting for approval.');
    return transaction(db, () => {
      const no = nextNo('golive_decisions', 'decision_no', actor.companyId, 'GNG');
      const id = Number(db.prepare("INSERT INTO golive_decisions (company_id, decision_no, meeting_at, attendees_json, recommendation, go_live_at, criteria_json, minutes, status, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', ?, 'golive')")
        .run(actor.companyId, no, meetingAt, JSON.stringify(attendees), recommendation, goLiveAt ?? null, JSON.stringify(c.items.map((i) => ({ criterion: i.criterion, status: i.status, detail: i.detail }))), minutes, actor.user).lastInsertRowid);
      const req = engine.submit(actor, { type: DECISION_TYPE, title: `Go/no-go ${no}: ${recommendation}${goLiveAt ? ` on ${goLiveAt.slice(0, 10)}` : ''}`, targetType: 'golive_decisions', targetId: String(id), payload: { recommendation, goLiveAt, ready: c.ready }, reason: minutes.slice(0, 500), chain: DECISION_CHAIN });
      db.prepare('UPDATE golive_decisions SET request_id = ? WHERE id = ?').run(req.id, id);
      audit(actor, 'golive_decisions', id, 'submit', { recommendation, goLiveAt, attendees: attendees.length });
      return decisionView(db.prepare('SELECT * FROM golive_decisions WHERE id = ?').get(id));
    });
  }
  /** The director's approval: BR-01 checked again (a criterion may have changed meanwhile); a GO announces the date to every user. */
  function approveDecision(id, actor) {
    const d = db.prepare('SELECT * FROM golive_decisions WHERE id = ?').get(id);
    if (d.recommendation === 'GO') { const c = evaluate({ ...actor, companyId: d.company_id }); if (!c.ready) throw unprocessable(`Not every mandatory criterion is met any more (BR-01): ${c.mandatoryOpen.join(', ')}.`); }
    db.prepare("UPDATE golive_decisions SET status = 'APPROVED', decided_at = ?, communicated_at = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(iso(), d.recommendation === 'GO' ? iso() : null, iso(), d.id);
    writeAudit(db, { companyId: d.company_id, entity: 'golive_decisions', entityId: d.id, action: 'approve', newValues: { recommendation: d.recommendation, goLiveAt: d.go_live_at }, actor: actor.user });
    publishEvent(db, { type: 'golive.decision.approved', entity: 'golive_decisions', entityId: d.id, actorId: actor.user, companyId: d.company_id, data: { decisionId: d.id, recommendation: d.recommendation, goLiveAt: d.go_live_at } });
    if (d.recommendation === 'GO') notify({ companyId: d.company_id, templateCode: 'golive.announcement', recipients: ['permission:hd.ticket.raise'], channels: ['IN_APP', 'EMAIL'], priority: 'HIGH', data: { goLiveAt: String(d.go_live_at).slice(0, 10), message: `The ERP goes live on ${String(d.go_live_at).slice(0, 10)}. Training, manuals and the help desk are ready; the legacy systems freeze the evening before.` }, link: '/help/documentation', sourceType: 'golive_decisions', sourceId: String(d.id) });
  }

  // ---------------------------------------------------------------- FR-05 hypercare
  const hypercareView = (h) => h && ({ id: h.id, decisionId: h.decision_id, startDate: h.start_date, endDate: h.end_date, status: h.status, warRoom: parse(h.war_room_json, []), handoverNotes: h.handover_notes, handoverRequestId: h.handover_request_id, handedOverBy: h.handed_over_by, handedOverAt: h.handed_over_at });
  function openHypercare(run) {
    if (db.prepare("SELECT 1 FROM golive_hypercare WHERE company_id = ? AND status <> 'HANDED_OVER' AND deleted_at IS NULL").get(run.company_id)) return;
    const weeks = Number(param(run.company_id, P.weeks)); const start = todayIST(); const end = new Date(Date.parse(`${start}T00:00:00Z`) + weeks * 7 * 86_400_000).toISOString().slice(0, 10);
    db.prepare("INSERT INTO golive_hypercare (company_id, decision_id, start_date, end_date, status, war_room_json, created_by, source_type) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, 'golive')").run(run.company_id, run.decision_id, start, end, JSON.stringify(['PCMGR', 'ITADM', ...new Set(Object.values(OWNER))]), run.started_by ?? 'system');
  }
  /** Start hypercare by hand (when the production cut-over was done outside this page, or for a pilot company). */
  function startHypercare(actor, { startDate, warRoom }) {
    guard(actor, 'golive.manage');
    if (db.prepare("SELECT 1 FROM golive_hypercare WHERE company_id = ? AND status <> 'HANDED_OVER' AND deleted_at IS NULL").get(actor.companyId)) throw conflict('Hypercare is already running.');
    const d = db.prepare("SELECT * FROM golive_decisions WHERE company_id = ? AND status = 'APPROVED' AND recommendation = 'GO' AND deleted_at IS NULL ORDER BY id DESC LIMIT 1").get(actor.companyId);
    if (!d) throw unprocessable('Hypercare starts after the director approved GO (BR-01).');
    const weeks = Number(param(actor.companyId, P.weeks)); const start = startDate ?? todayIST();
    const end = new Date(Date.parse(`${start}T00:00:00Z`) + weeks * 7 * 86_400_000).toISOString().slice(0, 10);
    const id = Number(db.prepare("INSERT INTO golive_hypercare (company_id, decision_id, start_date, end_date, status, war_room_json, created_by, source_type) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, 'golive')").run(actor.companyId, d.id, start, end, JSON.stringify(warRoom ?? ['PCMGR', 'ITADM']), actor.user).lastInsertRowid);
    audit(actor, 'golive_hypercare', id, 'start', { start, end });
    return hypercareView(db.prepare('SELECT * FROM golive_hypercare WHERE id = ?').get(id));
  }
  const activeHypercare = (companyId) => db.prepare("SELECT * FROM golive_hypercare WHERE company_id = ? AND status <> 'HANDED_OVER' AND deleted_at IS NULL ORDER BY id DESC LIMIT 1").get(companyId);
  /** The figures of one day: defects, alerts, failed jobs, help-desk tickets, active users. */
  function dayFigures(companyId, date) {
    // the day in India Standard Time, as UTC instants (the records keep UTC)
    const from = new Date(`${date}T00:00:00+05:30`).toISOString(); const to = new Date(Date.parse(from) + 86_400_000 - 1).toISOString();
    const count = (sql, ...a) => { try { return db.prepare(sql).get(...a)?.n ?? 0; } catch { return null; } };
    const openBy = Object.fromEntries(SEVERITIES.map((s) => [s, count("SELECT COUNT(*) AS n FROM uat_defects WHERE company_id = ? AND severity = ? AND status IN ('OPEN', 'TRIAGED', 'FIXED') AND deleted_at IS NULL", companyId, s)]));
    return {
      opened: count('SELECT COUNT(*) AS n FROM uat_defects WHERE company_id = ? AND reported_at BETWEEN ? AND ? AND deleted_at IS NULL', companyId, from, to),
      closed: count('SELECT COUNT(*) AS n FROM uat_defects WHERE company_id = ? AND closed_at BETWEEN ? AND ? AND deleted_at IS NULL', companyId, from, to),
      openBy,
      kpis: {
        alerts: count('SELECT COUNT(*) AS n FROM core_alerts WHERE fired_at BETWEEN ? AND ?', from, to),
        failedJobs: count("SELECT COUNT(*) AS n FROM core_jobs WHERE status = 'FAILED' AND finished_at BETWEEN ? AND ?", from, to),
        ticketsOpened: count('SELECT COUNT(*) AS n FROM hd_tickets WHERE company_id = ? AND created_at BETWEEN ? AND ?', companyId, from, to),
        ticketsOpen: count("SELECT COUNT(*) AS n FROM hd_tickets WHERE company_id = ? AND status NOT IN ('RESOLVED', 'CLOSED') AND deleted_at IS NULL", companyId),
        activeUsers: count('SELECT COUNT(DISTINCT user_id) AS n FROM iam_sessions WHERE company_id = ? AND last_seen_at BETWEEN ? AND ?', companyId, from, to),
        deployments: count("SELECT COUNT(*) AS n FROM ops_deployments WHERE company_id = ? AND kind IN ('DEPLOY', 'ROLLBACK') AND finished_at BETWEEN ? AND ?", companyId, from, to),
      },
    };
  }
  const dayView = (r) => r && ({ id: r.id, date: r.report_date, opened: r.opened_count, closed: r.closed_count, openBy: parse(r.open_by_severity_json, {}), kpis: parse(r.kpis_json, {}), triageNotes: r.triage_notes, status: r.status, publishedBy: r.published_by, publishedAt: r.published_at });
  /** Build (or rebuild) the report of a day; the daily job does this at the end of each day of hypercare. */
  function buildDay(companyId, date, by = 'system') {
    const h = activeHypercare(companyId); if (!h) return null;
    const f = dayFigures(companyId, date);
    const cur = db.prepare('SELECT * FROM golive_hypercare_days WHERE hypercare_id = ? AND report_date = ?').get(h.id, date);
    if (cur?.status === 'PUBLISHED') return dayView(cur);
    if (cur) db.prepare('UPDATE golive_hypercare_days SET opened_count = ?, closed_count = ?, open_by_severity_json = ?, kpis_json = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?').run(f.opened ?? 0, f.closed ?? 0, JSON.stringify(f.openBy), JSON.stringify(f.kpis), iso(), by, cur.id);
    else db.prepare("INSERT INTO golive_hypercare_days (company_id, hypercare_id, report_date, opened_count, closed_count, open_by_severity_json, kpis_json, status, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, 'golive')").run(companyId, h.id, date, f.opened ?? 0, f.closed ?? 0, JSON.stringify(f.openBy), JSON.stringify(f.kpis), by);
    return dayView(db.prepare('SELECT * FROM golive_hypercare_days WHERE hypercare_id = ? AND report_date = ?').get(h.id, date));
  }
  /** The war room publishes the day's report with its triage notes; the war room and the triagers are notified. */
  function publishDay(actor, date, { triageNotes }) {
    guard(actor, 'uat.triage');
    const day = buildDay(actor.companyId, date, actor.user);
    if (!day) throw unprocessable('Hypercare is not running.');
    if (day.status === 'PUBLISHED') throw conflict('That day is already published.');
    db.prepare("UPDATE golive_hypercare_days SET status = 'PUBLISHED', triage_notes = ?, published_by = ?, published_at = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(triageNotes, actor.user, iso(), iso(), day.id);
    audit(actor, 'golive_hypercare_days', day.id, 'publish', { date });
    const open = Object.values(day.openBy).reduce((a, n) => a + (n ?? 0), 0);
    notify({ companyId: actor.companyId, templateCode: 'golive.hypercare.daily', recipients: ['permission:uat.triage', 'permission:golive.manage'], channels: ['IN_APP'], priority: day.openBy.S1 ? 'HIGH' : 'NORMAL', data: { date, open, opened: day.opened, closed: day.closed, s1: day.openBy.S1 ?? 0, s2: day.openBy.S2 ?? 0 }, link: `/admin/go-live?tab=hypercare&date=${date}`, sourceType: 'golive_hypercare_days', sourceId: String(day.id) });
    return dayView(db.prepare('SELECT * FROM golive_hypercare_days WHERE id = ?').get(day.id));
  }
  /** Handover to steady-state support: after the hypercare period, no S1/S2 open; approved by the director. */
  function requestHandover(actor, { notes }) {
    guard(actor, 'golive.manage');
    const h = activeHypercare(actor.companyId);
    if (!h || h.status !== 'ACTIVE') throw unprocessable('No hypercare is running.');
    if (todayIST() < h.end_date) throw unprocessable(`Hypercare runs until ${h.end_date}.`);
    const blocking = db.prepare("SELECT COUNT(*) AS n FROM uat_defects WHERE company_id = ? AND severity IN ('S1', 'S2') AND status IN ('OPEN', 'TRIAGED', 'FIXED') AND deleted_at IS NULL").get(actor.companyId).n;
    if (blocking) throw unprocessable(`${blocking} S1/S2 defects are open; they are closed before the handover.`);
    return transaction(db, () => {
      const req = engine.submit(actor, { type: HANDOVER_TYPE, title: 'Hypercare handover to steady-state support', targetType: 'golive_hypercare', targetId: String(h.id), payload: { startDate: h.start_date, endDate: h.end_date }, reason: notes.slice(0, 500), chain: ['DIR'] });
      db.prepare("UPDATE golive_hypercare SET status = 'HANDOVER_REQUESTED', handover_notes = ?, handover_request_id = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(notes, req.id, iso(), h.id);
      audit(actor, 'golive_hypercare', h.id, 'request_handover', { notes: notes.slice(0, 200) });
      return hypercareView(db.prepare('SELECT * FROM golive_hypercare WHERE id = ?').get(h.id));
    });
  }
  if (jobs) {
    jobs.register(HYPERCARE_JOB, () => {
      let n = 0;
      for (const h of db.prepare("SELECT DISTINCT company_id FROM golive_hypercare WHERE status <> 'HANDED_OVER' AND deleted_at IS NULL").all()) { if (buildDay(h.company_id, todayIST())) n += 1; }
      return { reports: n };
    }, { maxAttempts: 2, description: 'Hypercare daily report (part 30.10): defects, alerts, failed jobs, tickets, active users.' });
    scheduler?.define({ code: HYPERCARE_JOB, cron: '30 12 * * *', jobType: HYPERCARE_JOB, description: 'The hypercare daily report at 18:00 IST (part 30.10).' });
  }

  // ---------------------------------------------------------------- the page
  function overview(actor, q = {}) {
    guard(actor, 'golive.view');
    const c = evaluate(actor);
    const mods = db.prepare('SELECT module, COUNT(*) AS total, SUM(status = \'PASS\') AS passed, SUM(status = \'FAIL\') AS failed, SUM(status = \'BLOCKED\') AS blocked, SUM(status = \'NOT_RUN\') AS notRun FROM uat_scripts WHERE company_id = ? AND deleted_at IS NULL GROUP BY module ORDER BY module').all(actor.companyId)
      .map((m) => { const s = db.prepare('SELECT * FROM uat_signoffs WHERE company_id = ? AND module = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1').get(actor.companyId, m.module); const k = moduleCounts(actor.companyId, m.module); return { module: m.module, name: MODULE_NAMES[m.module]?.[0] ?? m.module, total: m.total, passed: m.passed ?? 0, failed: m.failed ?? 0, blocked: m.blocked ?? 0, notRun: m.notRun ?? 0, openDefects: k.open, blocking: k.blocking, owner: OWNER[m.module] ?? 'SYSADM', signoff: s ? { id: s.id, status: s.status, signedBy: s.signed_by, signedAt: s.signed_at, requestId: s.request_id } : null }; });
    const awaiting = new Map(engine.awaiting(actor).map((r) => [`${r.type}:${r.targetId}`, r.id]));
    const scriptWhere = ['company_id = ?', 'deleted_at IS NULL']; const sa = [actor.companyId];
    if (q.module) { scriptWhere.push('module = ?'); sa.push(q.module); }
    if (q.status) { scriptWhere.push('status = ?'); sa.push(q.status); }
    if (q.mine) { scriptWhere.push('role_code IN (' + (actor.roles ?? ['-']).map(() => '?').join(', ') + ')'); sa.push(...(actor.roles ?? ['-'])); }
    const page = q.page ?? 1; const pageSize = q.pageSize ?? 25;
    const totalScripts = db.prepare(`SELECT COUNT(*) AS n FROM uat_scripts WHERE ${scriptWhere.join(' AND ')}`).get(...sa).n;
    const scripts = db.prepare(`SELECT * FROM uat_scripts WHERE ${scriptWhere.join(' AND ')} ORDER BY module, code LIMIT ? OFFSET ?`).all(...sa, pageSize, (page - 1) * pageSize).map(scriptView);
    const defects = db.prepare("SELECT * FROM uat_defects WHERE company_id = ? AND deleted_at IS NULL ORDER BY CASE WHEN status IN ('OPEN', 'TRIAGED', 'FIXED') THEN 0 ELSE 1 END, severity, id DESC LIMIT 50").all(actor.companyId).map(defectView);
    const run = db.prepare('SELECT * FROM golive_cutover_runs WHERE company_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1').get(actor.companyId);
    const runs = db.prepare('SELECT id, run_no, kind, status, elapsed_minutes, window_minutes, within_window, finished_at FROM golive_cutover_runs WHERE company_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 10').all(actor.companyId).map((r) => ({ id: r.id, runNo: r.run_no, kind: r.kind, status: r.status, elapsedMinutes: r.elapsed_minutes, windowMinutes: r.window_minutes, withinWindow: r.within_window == null ? null : r.within_window === 1, finishedAt: r.finished_at }));
    const decision = db.prepare('SELECT * FROM golive_decisions WHERE company_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1').get(actor.companyId);
    const h = db.prepare('SELECT * FROM golive_hypercare WHERE company_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1').get(actor.companyId);
    if (h && h.status !== 'HANDED_OVER') buildDay(actor.companyId, todayIST());
    const days = h ? db.prepare('SELECT * FROM golive_hypercare_days WHERE hypercare_id = ? ORDER BY report_date DESC LIMIT 31').all(h.id).map(dayView) : [];
    return {
      checklist: c, uat: { modules: mods, scripts: { rows: scripts, total: totalScripts, page, pageSize }, defects, openBySeverity: Object.fromEntries(SEVERITIES.map((s) => [s, defects.filter((d) => d.severity === s && ['OPEN', 'TRIAGED', 'FIXED'].includes(d.status)).length])) },
      cutover: { current: runView(run), runs, steps: CUTOVER_STEPS },
      decision: decision ? { ...decisionView(decision), awaitingMe: awaiting.get(`${DECISION_TYPE}:${decision.id}`) ?? null, chain: DECISION_CHAIN } : null,
      hypercare: h ? { ...hypercareView(h), days, awaitingMe: awaiting.get(`${HANDOVER_TYPE}:${h.id}`) ?? null } : null,
      signoffsAwaitingMe: Object.fromEntries([...awaiting].filter(([k]) => k.startsWith(`${SIGNOFF_TYPE}:`)).map(([k, v]) => [k.split(':')[1], v])),
      can: { manage: hasPermissionAnywhere(actor, 'golive.manage'), execute: hasPermissionAnywhere(actor, 'uat.execute'), triage: hasPermissionAnywhere(actor, 'uat.triage'), export: hasPermissionAnywhere(actor, 'golive.export') },
    };
  }
  function exportReport(actor, { kind }, format) {
    guard(actor, 'golive.export');
    const o = overview(actor, { pageSize: 200 });
    const spec = {
      checklist: { title: 'Go-live readiness checklist', columns: [{ key: 'criterion', label: 'Criterion' }, { key: 'title', label: 'Title' }, { key: 'category', label: 'Category' }, { key: 'mandatory', label: 'Mandatory' }, { key: 'owner', label: 'Owner' }, { key: 'status', label: 'Status' }, { key: 'detail', label: 'Detail' }], rows: o.checklist.items.map((i) => ({ criterion: i.criterion, title: i.title, category: i.category, mandatory: i.mandatory ? 'Yes' : 'No', owner: i.ownerRole, status: i.status, detail: i.detail ?? '' })), footer: `${o.checklist.ready ? 'Ready' : 'Not ready'}: ${o.checklist.mandatoryOpen.length} mandatory criteria not met` },
      uat: { title: 'UAT status by module', columns: [{ key: 'name', label: 'Module' }, { key: 'total', label: 'Scripts', type: 'number' }, { key: 'passed', label: 'Passed', type: 'number' }, { key: 'failed', label: 'Failed', type: 'number' }, { key: 'openDefects', label: 'Open defects', type: 'number' }, { key: 'owner', label: 'Owner' }, { key: 'signoff', label: 'Sign-off' }], rows: o.uat.modules.map((m) => ({ ...m, signoff: m.signoff?.status ?? 'Not requested' })), footer: `${o.uat.modules.length} modules` },
      hypercare: { title: 'Hypercare daily report', columns: [{ key: 'date', label: 'Date' }, { key: 'opened', label: 'Opened', type: 'number' }, { key: 'closed', label: 'Closed', type: 'number' }, { key: 's1', label: 'Open S1', type: 'number' }, { key: 's2', label: 'Open S2', type: 'number' }, { key: 'alerts', label: 'Alerts', type: 'number' }, { key: 'tickets', label: 'Tickets opened', type: 'number' }, { key: 'status', label: 'Status' }], rows: (o.hypercare?.days ?? []).map((d) => ({ date: d.date, opened: d.opened, closed: d.closed, s1: d.openBy.S1 ?? 0, s2: d.openBy.S2 ?? 0, alerts: d.kpis.alerts ?? 0, tickets: d.kpis.ticketsOpened ?? 0, status: d.status })), footer: o.hypercare ? `Hypercare ${o.hypercare.startDate} to ${o.hypercare.endDate}, ${o.hypercare.status}` : 'Hypercare not started' },
    }[kind];
    const buffer = writeExport(format, { columns: spec.columns, rows: spec.rows, title: spec.title, sheetName: kind, footer: [spec.footer] });
    audit(actor, 'report', `golive.${kind}`, 'export', { format, rows: spec.rows.length });
    return { buffer, contentType: FORMATS[format], fileName: `go-live-${kind}.${format}` };
  }
  return { evaluate, checklist, setItem, generateScripts, runScript, triage, raiseDefect: (actor, b) => { guard(actor, 'uat.execute'); return raiseDefect(actor, b, activeHypercare(actor.companyId) ? 'HYPERCARE' : 'UAT'); }, requestSignoff, decide, planRun, startRun, completeStep, rollBack, submitDecision, startHypercare, buildDay, publishDay, requestHandover, overview, exportReport, measure };
}

