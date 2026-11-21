import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { HttpError, badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { countList, defineList, parseListRequest, runList, whereOf } from '../../platform/list/index.js';
import { createParameterStore, parameterRegistry } from '../../platform/parameters/index.js';
import { fileEntities } from '../../platform/files/entities.js';
import { evidenceProviders, workflowOf, workflowResolvers, workflowTypes } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { createNumberingService } from '../core/numbering/service.js';
import { documentsOf } from '../eng/documents.js';
import { createOrgService, applyProjectStatus, activationGuards } from '../iam/org/service.js';
import { ACTIVATION_DOC, CHANGE_DOC, CHECKLISTS, CONTRACT_TYPES, MILESTONE_STATUS, ORG_STATUS, SETTINGS_DEFAULTS, STATES, STATUS, TRANSITIONS, TRANSITION_DOC, esc, json, keyOf, money, nowIso, num, rid, same, units } from './constants.js';

// The project master, its lifecycle and the setup wizard (part 10.01). A project of the organisation master (02.02: code, name, type, branch, sites with geofences) is enriched by a 1:1 project master: the client, the consultant and the
// funding agency from the partner master (06.04), the contract summary (type, value, dates, defect liability, retention, mobilisation advance, liquidated damages), the team, the settings and the lifecycle state. The wizard makes the whole
// of it in one transaction (the project, its sites, the numbering series and the document folders from templates, the key dates); the project is then sent for activation (project director, then the director) and moves through Setup,
// Mobilisation, Execution, Suspended, Substantially complete, Defect liability period, Closed and Archived with a checklist at each move; a suspension and a closure go through the chain (project manager, project director, director). After
// activation the contract terms change only by an approved amendment (until the contract module of 21.01 takes over, BR-02). The key dates and milestones register and the health of the portfolio come from this part and the parts that follow.
for (const [key, dataType, def, description] of [
  ['proj.numbering_templates', 'json', [{ code: 'DMS', name: 'Controlled documents', docType: 'DMS_DOC', prefix: 'DOC', format: '{PROJECT}/{PREFIX}/{SEQ:4}', resetRule: 'never' }], 'FR-01: the numbering series made for each new project, as [{ code, name, docType, prefix, format, resetRule }]; the wizard lets the creator leave some out.'],
  ['proj.folder_template', 'string', 'PROJECT_STANDARD', 'FR-05: the code of the folder template of the document service (04.10) applied to each new project.'],
  ['proj.settings_defaults', 'json', SETTINGS_DEFAULTS, 'FR-03: the default settings of a new project (units, calendar, working days, cost code and WBS templates, enabled modules, approval overrides).'],
  ['proj.lifecycle_checklists', 'json', CHECKLISTS, 'FR-02: the checklist of each move of the lifecycle, as { "FROM>TO": [items], ACTIVATE: [items] }; every item is ticked before the move.'],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType, default: def, scopes: ['system', 'company'], description });
/** BR-01: what a later part adds to the checks before a move: (db, projectRow, { to }) => [{ code, text, ok, blocking }]; the budget (12.01) and the baseline schedule (13.03) register theirs when they are live. */
export const readinessProviders = /** @type {Array<(db: any, p: any, ctx: { to: string }) => Array<{ code: string, text: string, ok: boolean, blocking: boolean }>>} */ ([]);
/** FR-06: what a later part adds to the health of the portfolio: (db, projectRow) => { code, label, level: 'GREEN' | 'AMBER' | 'RED' } | null. */
export const healthProviders = /** @type {Array<(db: any, p: any) => { code: string, label: string, level: string } | null>} */ ([]);
const LIVE = ['MOBILISATION', 'EXECUTION', 'SUSPENDED', 'SUBSTANTIALLY_COMPLETE', 'DLP'];
const LOCKED_AFTER = ['contractValue', 'contractType', 'contractNo', 'startDate', 'scheduledCompletion', 'dlpMonths', 'retentionPct', 'mobAdvancePct', 'clientPartnerId'];
const WORST = { RED: 3, AMBER: 2, GREEN: 1, NONE: 0 };

export const projectList = defineList({
  code: 'proj.projects', label: 'Project portfolio', permission: 'proj.project.view',
  from: 'proj_projects x JOIN org_projects p ON p.id = x.project_id LEFT JOIN mdm_partners c ON c.id = x.client_partner_id', where: 'x.deleted_at IS NULL', searchable: ['p.code', 'p.name', 'c.legal_name', 'x.contract_no', 'x.location'], defaultSort: 'code',
  columns: {
    code: { sql: 'p.code', type: 'text', label: 'Code' }, name: { sql: 'p.name', type: 'text', label: 'Project' }, type: { sql: 'p.type', type: 'text', label: 'Type' }, client: { sql: 'c.legal_name', type: 'text', label: 'Client' }, location: { sql: 'x.location', type: 'text', label: 'Location' },
    contractType: { sql: 'x.contract_type', type: 'enum', label: 'Contract type', options: Object.entries(CONTRACT_TYPES) }, contractValue: { sql: '(x.contract_value / 100.0)', type: 'money', label: 'Contract value (₹)' },
    startDate: { sql: 'x.start_date', type: 'date', label: 'Start' }, scheduledCompletion: { sql: 'x.scheduled_completion', type: 'date', label: 'Scheduled completion' },
    health: { sql: "(CASE WHEN x.lifecycle_state NOT IN ('MOBILISATION', 'EXECUTION', 'SUSPENDED', 'SUBSTANTIALLY_COMPLETE', 'DLP') THEN 'NONE' WHEN (x.lifecycle_state IN ('MOBILISATION', 'EXECUTION') AND COALESCE(x.revised_completion, x.scheduled_completion) < date('now', '+330 minutes')) OR EXISTS (SELECT 1 FROM proj_milestones m WHERE m.project_id = x.project_id AND m.deleted_at IS NULL AND m.milestone_status = 'PLANNED' AND m.planned_date < date('now', '-30 days', '+330 minutes')) THEN 'RED' WHEN EXISTS (SELECT 1 FROM proj_milestones m WHERE m.project_id = x.project_id AND m.deleted_at IS NULL AND m.milestone_status = 'PLANNED' AND m.planned_date < date('now', '+330 minutes')) THEN 'AMBER' ELSE 'GREEN' END)", type: 'enum', label: 'Health', options: [['GREEN', 'On track'], ['AMBER', 'Watch'], ['RED', 'At risk'], ['NONE', 'Not started']] },
    state: { sql: 'x.lifecycle_state', type: 'enum', label: 'Lifecycle', options: Object.entries(STATES) }, status: { sql: 'x.status', type: 'enum', label: 'Approval', options: Object.entries(STATUS) }, pm: { sql: 'x.pm_user', type: 'text', label: 'Project manager' },
  },
});

export function createProjectService({ db }) {
  const authz = authzOf(db);
  const org = createOrgService({ db, approvals: null, clock: () => new Date() });
  const may = (actor, key, projectId = null) => (projectId == null ? authz.check(actor, key).allowed : authz.check(actor, key, { companyId: actor.companyId, projectId }).allowed);
  const need = (actor, key, what, projectId = null) => { if (!may(actor, key, projectId)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const fail = (p) => { if (p.length) throw badRequest('Correct the highlighted fields', p); };
  const param = (companyId, key) => createParameterStore(db).get(key, { companyId, date: todayIST() });
  const event = (type, actor, id, companyId, projectId, data) => publishEvent(db, { type, entity: 'project', entityId: id, actorId: actor.user, companyId, projectId, data });
  /** The setup is made on the person's authority (proj.project.create) in the organisation, numbering and document services, which check their own rights: it is done as the same person with the roles those services ask for. */
  const elevated = (actor, companyId = actor.companyId) => ({ user: actor.user, userId: null, companyId, roles: ['SYSADM', 'PCMGR', 'DOC'] });
  const scopeSql = (actor) => { const f = authz.scopeFilter(actor, 'proj.project.view', { project: 'x.project_id' }); return { sql: `x.company_id = :c AND ${f.sql}`, params: { c: actor.companyId, ...(f.params ?? {}) } }; };
  const userOf = (companyId, username) => db.prepare('SELECT id, username, display_name FROM iam_users WHERE company_id = ? AND lower(username) = lower(?) AND is_active = 1').get(companyId, username);
  const partnerOf = (companyId, id, role) => (id ? db.prepare(`SELECT p.id, p.code, p.legal_name, p.partner_status FROM mdm_partners p WHERE p.id = ? AND p.company_id = ? AND p.deleted_at IS NULL${role ? " AND EXISTS (SELECT 1 FROM mdm_partner_roles r WHERE r.partner_id = p.id AND r.partner_role = ? AND r.deleted_at IS NULL)" : ''}`).get(...[id, companyId, ...(role ? [role] : [])]) ?? null : null);
  const orgOf = (id) => db.prepare('SELECT * FROM org_projects WHERE id = ?').get(id);
  const checklistOf = (companyId, key) => { const c = param(companyId, 'proj.lifecycle_checklists') ?? CHECKLISTS; return Array.isArray(c[key]) ? c[key] : CHECKLISTS[key] ?? []; };

  // ---- reading -------------------------------------------------------------------------------------------------------------------------------------
  const row = (actor, id, key = 'proj.project.view') => {
    const x = db.prepare('SELECT x.* FROM proj_projects x WHERE x.id = ? AND x.company_id = ? AND x.deleted_at IS NULL').get(rid(id), actor.companyId);
    if (!x || !may(actor, key, x.project_id)) throw notFound('That project does not exist or is not yours to see.');
    return x;
  };
  const fresh = (id) => db.prepare('SELECT * FROM proj_projects WHERE id = ?').get(id);
  const sitesOf = (projectId) => db.prepare('SELECT id, code, name, site_type, status, address, latitude, longitude, geofence_type, geofence_radius_m FROM org_sites WHERE org_project_id = ? AND is_active = 1 ORDER BY code').all(projectId)
    .map((s) => ({ id: s.id, code: s.code, name: s.name, type: s.site_type, status: s.status, address: s.address, latitude: s.latitude, longitude: s.longitude, geofence: s.geofence_type, radiusM: s.geofence_radius_m }));
  const milestonesOf = (projectId) => db.prepare('SELECT * FROM proj_milestones WHERE project_id = ? AND deleted_at IS NULL ORDER BY planned_date, sort_order, id').all(projectId).map((m) => milestoneView(m));
  function milestoneView(m) {
    const overdue = m.milestone_status === 'PLANNED' && m.planned_date < todayIST();
    const late = m.milestone_status === 'ACHIEVED' && m.actual_date > m.planned_date;
    return { id: m.id, code: m.code, name: m.name, plannedDate: m.planned_date, actualDate: m.actual_date, contractual: Boolean(m.contractual), paymentLinked: Boolean(m.payment_linked), status: m.milestone_status, statusLabel: MILESTONE_STATUS[m.milestone_status], overdue, daysLate: overdue ? daysBetween(m.planned_date, todayIST()) : late ? daysBetween(m.planned_date, m.actual_date) : 0, rowVersion: m.version };
  }
  const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
  /** FR-06: the health of a project: the schedule from its milestones and its dates (from this part), and what the later parts add (budget, progress, safety). */
  function healthOf(x) {
    const items = [];
    if (LIVE.includes(x.lifecycle_state)) {
      const ms = db.prepare("SELECT * FROM proj_milestones WHERE project_id = ? AND deleted_at IS NULL AND milestone_status = 'PLANNED' AND planned_date < ?").all(x.project_id, todayIST());
      const worstLate = ms.reduce((m, r) => Math.max(m, daysBetween(r.planned_date, todayIST())), 0);
      const end = x.revised_completion ?? x.scheduled_completion; const pastEnd = end && ['MOBILISATION', 'EXECUTION'].includes(x.lifecycle_state) && end < todayIST();
      items.push({ code: 'SCHEDULE', label: 'Key dates', level: pastEnd || worstLate > 30 ? 'RED' : ms.length || (end && daysBetween(todayIST(), end) <= 30 && x.lifecycle_state !== 'DLP' && x.lifecycle_state !== 'SUBSTANTIALLY_COMPLETE') ? 'AMBER' : 'GREEN' });
    }
    for (const p of healthProviders) { const h = p(db, x); if (h) items.push(h); }
    const level = items.reduce((w, h) => (WORST[h.level] > WORST[w] ? h.level : w), 'NONE');
    const start = x.start_date; const end = x.revised_completion ?? x.scheduled_completion;
    const elapsed = start && end && end > start && LIVE.includes(x.lifecycle_state) ? Math.max(0, Math.min(100, Math.round((daysBetween(start, todayIST()) / daysBetween(start, end)) * 100))) : null;
    return { level, items, timeElapsedPct: elapsed };
  }
  function view(actor, x, { detail = false } = {}) {
    const p = orgOf(x.project_id); const c = partnerOf(x.company_id, x.client_partner_id); const h = healthOf(x);
    const base = {
      id: x.id, projectId: x.project_id, code: p.code, name: p.name, type: p.type, branchId: p.branch_id, sector: x.sector, location: x.location, client: c ? { id: c.id, code: c.code, name: c.legal_name } : null, status: x.status, statusLabel: STATUS[x.status], state: x.lifecycle_state, stateLabel: STATES[x.lifecycle_state],
      orgStatus: p.status, contractType: x.contract_type, contractTypeLabel: CONTRACT_TYPES[x.contract_type], contractNo: x.contract_no, contractValue: money(x.contract_value), startDate: x.start_date, scheduledCompletion: x.scheduled_completion, revisedCompletion: x.revised_completion,
      dlpMonths: x.dlp_months, retentionPct: num(x.retention_pct, 'percent'), mobAdvancePct: num(x.mob_advance_pct, 'percent'), pm: x.pm_user, director: x.director_user, health: h.level, healthItems: h.items, timeElapsedPct: h.timeElapsedPct,
      rowVersion: x.version, orgVersion: p.version, requestedBy: x.requested_by, createdBy: x.created_by, activatedAt: x.activated_at, workflowInstanceId: x.workflow_instance_id,
    };
    if (!detail) return base;
    const cons = partnerOf(x.company_id, x.consultant_partner_id); const fund = partnerOf(x.company_id, x.funder_partner_id);
    const tender = x.tender_id ? db.prepare('SELECT id, doc_no, name_of_work FROM tdr_tenders WHERE id = ?').get(x.tender_id) : null;
    const log = db.prepare('SELECT * FROM proj_lifecycle_log WHERE project_id = ? AND deleted_at IS NULL ORDER BY id DESC').all(x.project_id).map(logView);
    const open = log.find((l) => l.status === 'REQUESTED') ?? null;
    const editable = ['DRAFT', 'RETURNED'].includes(x.status) && x.lifecycle_state === 'SETUP';
    return {
      ...base, consultant: cons ? { id: cons.id, code: cons.code, name: cons.legal_name } : null, funder: fund ? { id: fund.id, code: fund.code, name: fund.legal_name } : null, tender: tender ? { id: tender.id, docNo: tender.doc_no, nameOfWork: tender.name_of_work } : null, ldSummary: x.ld_summary,
      settings: { ...SETTINGS_DEFAULTS, ...(json(x.settings_json, {}) ?? {}) }, setup: json(x.setup_json, {}), sites: sitesOf(x.project_id), milestones: milestonesOf(x.project_id), log, openRequest: open, pending: json(x.pending_json, null),
      transitions: transitionOptions(actor, x), readiness: readinessOf(x, x.lifecycle_state === 'SETUP' ? 'MOBILISATION' : null), controlledFields: LOCKED_AFTER,
      can: {
        edit: editable && may(actor, 'proj.project.edit', x.project_id), editLive: !editable && !['CLOSED', 'ARCHIVED'].includes(x.lifecycle_state) && may(actor, 'proj.project.edit', x.project_id), delete: x.status === 'DRAFT' && x.lifecycle_state === 'SETUP' && !x.workflow_instance_id && may(actor, 'proj.project.delete', x.project_id),
        submit: editable && may(actor, 'proj.project.submit', x.project_id), withdraw: x.status === 'SUBMITTED' && same(x.requested_by, actor.user), cancel: x.lifecycle_state === 'SETUP' && ['DRAFT', 'RETURNED', 'SUBMITTED'].includes(x.status) && may(actor, 'proj.project.cancel', x.project_id),
        amend: x.status === 'APPROVED' && !['CLOSED', 'ARCHIVED'].includes(x.lifecycle_state) && !open && may(actor, 'proj.project.amend', x.project_id), milestones: may(actor, 'proj.milestone.manage', x.project_id) && !['CLOSED', 'ARCHIVED'].includes(x.lifecycle_state) && x.status !== 'CANCELLED', print: may(actor, 'proj.project.print', x.project_id), export: may(actor, 'proj.project.export'),
      },
    };
  }
  const logView = (l) => ({ id: l.id, kind: l.kind, from: l.from_state, to: l.to_state, fromLabel: STATES[l.from_state] ?? null, toLabel: STATES[l.to_state] ?? null, status: l.log_status, checklist: json(l.checklist_json, []), warnings: json(l.warnings_json, []), changes: json(l.changes_json, null), reason: l.reason, by: l.by_user, at: l.created_at, decidedAt: l.decided_at, workflowInstanceId: l.workflow_instance_id });

  // ---- readiness (BR-01) and the moves of the lifecycle (FR-02) -------------------------------------------------------------------------------------
  /** The checks before a move: the contract and the people (blocking), and what the budget and the baseline say (warnings until those parts are live). */
  function readinessOf(x, to) {
    if (!to) return [];
    const out = [];
    const sites = db.prepare("SELECT COUNT(*) AS n FROM org_sites WHERE org_project_id = ? AND is_active = 1 AND status != 'INACTIVE'").get(x.project_id).n;
    const need2 = (code, text, ok) => out.push({ code, text, ok, blocking: true });
    if (to === 'MOBILISATION') {
      need2('CLIENT', 'The client is named', Boolean(x.client_partner_id));
      need2('CONTRACT_VALUE', 'The contract value is given (a cost-plus contract may have none)', x.contract_value > 0 || x.contract_type === 'COST_PLUS');
      need2('DATES', 'The start date and the scheduled completion are given', Boolean(x.start_date && x.scheduled_completion));
      need2('SITES', 'At least one site is set up', sites > 0);
      need2('TEAM', 'The project manager and the project director are named', Boolean(x.pm_user && x.director_user));
    }
    if (to === 'EXECUTION') {
      need2('SITES', 'At least one site is active', db.prepare("SELECT COUNT(*) AS n FROM org_sites WHERE org_project_id = ? AND is_active = 1 AND status = 'ACTIVE'").get(x.project_id).n > 0);
      need2('TEAM', 'The project manager is named', Boolean(x.pm_user));
      const hasBudget = readinessProviders.some((p) => p(db, x, { to }).some((r) => r.code === 'BUDGET'));
      const hasBaseline = readinessProviders.some((p) => p(db, x, { to }).some((r) => r.code === 'BASELINE'));
      if (!hasBudget) out.push({ code: 'BUDGET', text: 'An approved budget (12.01): the budget is not live yet, so it is not checked', ok: false, blocking: false });
      if (!hasBaseline) out.push({ code: 'BASELINE', text: 'A baseline schedule (13.03): the schedule is not live yet, so it is not checked', ok: false, blocking: false });
    }
    if (['CLOSED'].includes(to)) {
      const open = db.prepare("SELECT COUNT(*) AS n FROM proj_milestones WHERE project_id = ? AND deleted_at IS NULL AND contractual = 1 AND milestone_status = 'PLANNED'").get(x.project_id).n;
      out.push({ code: 'MILESTONES', text: 'Contractual milestones are achieved or waived', ok: open === 0, blocking: false });
    }
    for (const p of readinessProviders) out.push(...p(db, x, { to }));
    return out;
  }
  function transitionOptions(actor, x) {
    if (x.status !== 'APPROVED' || x.lifecycle_state === 'SETUP') return [];
    const open = db.prepare("SELECT 1 FROM proj_lifecycle_log WHERE project_id = ? AND log_status = 'REQUESTED' AND deleted_at IS NULL").get(x.project_id);
    return TRANSITIONS.filter((t) => t.from === x.lifecycle_state).map((t) => ({ to: t.to, toLabel: STATES[t.to], approval: t.approval, checklist: checklistOf(x.company_id, keyOf(t.from, t.to)), readiness: readinessOf(x, t.to), allowed: !open && may(actor, 'proj.project.transition', x.project_id) }));
  }
  const ticked = (list, picks) => { const all = list.map((_, i) => i); const given = [...new Set((picks ?? []).map(Number))]; const missing = all.filter((i) => !given.includes(i)); return { missing: missing.map((i) => list[i]), items: list.map((text, i) => ({ text, ticked: given.includes(i) })) }; };
  /** Applies a move: the state, the project of the organisation master (and its sites on activation), the log, the event. */
  function applyState(actor, x, to, { logId, reason }) {
    const from = x.lifecycle_state;
    db.prepare('UPDATE proj_projects SET lifecycle_state = ?, closed_at = CASE WHEN ? = \'CLOSED\' THEN ? ELSE closed_at END, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, to, nowIso(), actor.user, nowIso(), x.id);
    applyProjectStatus(db, actor, x.project_id, ORG_STATUS[to], { reason, activateSites: to === 'MOBILISATION' });
    if (logId) db.prepare("UPDATE proj_lifecycle_log SET log_status = 'EFFECTIVE', decided_at = ?, updated_at = ? WHERE id = ?").run(nowIso(), nowIso(), logId);
    writeAudit(db, { entity: 'proj_projects', entityId: x.id, action: 'state', oldValues: { state: from }, newValues: { state: to }, reason: reason ?? null, actor: actor.user, companyId: x.company_id });
    event('proj.project.state_changed', actor, x.id, x.company_id, x.project_id, { projectId: x.project_id, code: orgOf(x.project_id).code, from, to });
  }
  const transitions = {
    /** A move that needs no approval is made at once with its checklist; one that needs approval is requested (project manager, project director, director). */
    move(actor, id, { to, ticked: picks, reason, version }) {
      const x = row(actor, id); need(actor, 'proj.project.transition', 'move projects through their lifecycle', x.project_id);
      if (version != null && version !== x.version) throw conflict(`The project was changed by someone else (version ${x.version}, you had ${version}); reload it.`);
      if (x.status !== 'APPROVED') throw unprocessable('The project is activated first: only an approved project moves through the lifecycle.');
      const t = TRANSITIONS.find((y) => y.from === x.lifecycle_state && y.to === to);
      if (!t) throw unprocessable(`A project in ${STATES[x.lifecycle_state]} cannot go to ${STATES[to] ?? to}.`);
      if (db.prepare("SELECT 1 FROM proj_lifecycle_log WHERE project_id = ? AND log_status = 'REQUESTED' AND deleted_at IS NULL").get(x.project_id)) throw conflict('Another request for this project is waiting for approval.');
      const list = checklistOf(x.company_id, keyOf(t.from, t.to)); const tk = ticked(list, picks);
      const problems = [];
      if (tk.missing.length) problems.push(...tk.missing.map((m) => ({ field: 'ticked', message: `Tick: ${m}` })));
      if (t.approval && String(reason ?? '').trim().length < 10) problems.push({ field: 'reason', message: 'Say why (at least 10 characters)' });
      const checks = readinessOf(x, to); const blockers = checks.filter((c) => c.blocking && !c.ok);
      if (blockers.length) problems.push(...blockers.map((b) => ({ field: 'readiness', message: b.text })));
      if (problems.length) throw unprocessable('The move is not ready.', problems);
      const warnings = checks.filter((c) => !c.blocking && !c.ok).map((c) => c.text);
      return transaction(db, () => {
        const lid = Number(db.prepare("INSERT INTO proj_lifecycle_log (company_id, project_id, kind, from_state, to_state, log_status, checklist_json, warnings_json, reason, by_user, created_by, source_type, source_id) VALUES (?, ?, 'TRANSITION', ?, ?, ?, ?, ?, ?, ?, ?, 'proj_project', ?)")
          .run(x.company_id, x.project_id, t.from, t.to, t.approval ? 'REQUESTED' : 'EFFECTIVE', JSON.stringify(tk.items), JSON.stringify(warnings), reason?.trim() || null, actor.user, actor.user, String(x.id)).lastInsertRowid);
        if (t.approval) {
          const inst = workflowOf(db).submit(actor, { docType: TRANSITION_DOC, docId: String(lid), comment: `${orgOf(x.project_id).code}: ${STATES[t.from]} to ${STATES[t.to]}`, context: { projectId: x.project_id, to: t.to } });
          db.prepare('UPDATE proj_lifecycle_log SET workflow_instance_id = ? WHERE id = ?').run(inst.id, lid);
          writeAudit(db, { entity: 'proj_projects', entityId: x.id, action: 'transition_requested', newValues: { to: t.to }, reason, actor: actor.user, companyId: x.company_id });
        } else applyState(actor, x, t.to, { logId: lid, reason });
        return projects.get(actor, x.id);
      });
    },
    withdraw(actor, id, { reason }) {
      const x = row(actor, id); const l = db.prepare("SELECT * FROM proj_lifecycle_log WHERE project_id = ? AND log_status = 'REQUESTED' AND deleted_at IS NULL ORDER BY id DESC").get(x.project_id);
      if (!l) throw unprocessable('There is no request waiting for approval.'); if (!same(l.by_user, actor.user)) throw forbidden('Only the person who made the request withdraws it.');
      workflowOf(db).withdraw(actor, l.workflow_instance_id, { comment: reason }); return projects.get(actor, x.id);
    },
  };
  /** The decision of the chain on a move, an activation or an amendment. */
  function decideLog(instance, actor, outcome, comment) {
    const l = db.prepare('SELECT * FROM proj_lifecycle_log WHERE id = ?').get(rid(instance.docId)); if (!l || l.log_status !== 'REQUESTED') return;
    const x = db.prepare('SELECT * FROM proj_projects WHERE project_id = ? AND deleted_at IS NULL').get(l.project_id); if (!x) return;
    if (outcome === 'APPROVED') {
      if (l.kind === 'TRANSITION') { if (x.lifecycle_state !== l.from_state) { db.prepare("UPDATE proj_lifecycle_log SET log_status = 'CANCELLED', decided_at = ?, reason = COALESCE(reason, '') || ' (the project had moved on)' WHERE id = ?").run(nowIso(), l.id); return; } applyState(actor, x, l.to_state, { logId: l.id, reason: l.reason }); }
      else if (l.kind === 'AMENDMENT') applyChanges(actor, x, json(l.changes_json, {}), l);
      return;
    }
    const to = outcome === 'REJECTED' ? 'REJECTED' : outcome === 'RETURNED' ? 'RETURNED' : 'CANCELLED';
    db.prepare('UPDATE proj_lifecycle_log SET log_status = ?, decided_at = ?, updated_at = ? WHERE id = ?').run(to, nowIso(), nowIso(), l.id);
    if (l.kind === 'AMENDMENT') db.prepare('UPDATE proj_projects SET pending_json = NULL WHERE id = ?').run(x.id);
    writeAudit(db, { entity: 'proj_projects', entityId: x.id, action: `${l.kind.toLowerCase()}_${to.toLowerCase()}`, reason: comment ?? null, actor: actor.user, companyId: x.company_id });
  }

  // ---- the wizard (FR-01) and the project master ---------------------------------------------------------------------------------------------------
  const partnerProblems = (companyId, b) => {
    const p = [];
    const client = partnerOf(companyId, b.clientPartnerId, 'CLIENT'); if (!client) p.push({ field: 'clientPartnerId', message: 'Choose a client of the partner master' }); else if (!['PROSPECT', 'PENDING', 'ACTIVE'].includes(client.partner_status)) p.push({ field: 'clientPartnerId', message: 'That client is on hold, blacklisted or inactive' });
    if (b.consultantPartnerId && !partnerOf(companyId, b.consultantPartnerId, 'CONSULTANT')) p.push({ field: 'consultantPartnerId', message: 'Choose a consultant of the partner master' });
    if (b.funderPartnerId && !partnerOf(companyId, b.funderPartnerId, null)) p.push({ field: 'funderPartnerId', message: 'Choose a funding agency of the partner master' });
    return p;
  };
  const contractProblems = (c) => {
    const p = [];
    if (c.startDate && c.scheduledCompletion && c.scheduledCompletion < c.startDate) p.push({ field: 'scheduledCompletion', message: 'The completion date is on or after the start date' });
    if (c.revisedCompletion && c.scheduledCompletion && c.revisedCompletion < c.scheduledCompletion) p.push({ field: 'revisedCompletion', message: 'A revised completion is on or after the scheduled one' });
    if (c.contractType === 'COST_PLUS' && Number(c.contractValue ?? 0) < 0) p.push({ field: 'contractValue', message: 'The contract value is zero or more' });
    return p;
  };
  const teamProblems = (companyId, b) => { const p = []; for (const [f, u] of [['pmUser', b.pmUser], ['directorUser', b.directorUser]]) if (u && !userOf(companyId, u)) p.push({ field: f, message: 'That user does not exist, is disabled or belongs to another company' }); return p; };
  const templatesOf = (companyId) => { const t = param(companyId, 'proj.numbering_templates'); return Array.isArray(t) ? t : []; };
  const folderTemplates = (companyId) => db.prepare("SELECT code, name FROM doc_folder_templates WHERE (company_id = ? OR company_id IS NULL) AND status = 'ACTIVE' AND is_active = 1 ORDER BY code").all(companyId);
  const columnsFrom = (b) => ({ sector: b.sector ?? null, location: b.location?.trim() || null, client_partner_id: b.clientPartnerId ?? null, consultant_partner_id: b.consultantPartnerId ?? null, funder_partner_id: b.funderPartnerId ?? null, contract_type: b.contractType ?? 'ITEM_RATE', contract_no: b.contractNo?.trim() || null, contract_value: units(b.contractValue ?? '0', 'money'), start_date: b.startDate ?? null, scheduled_completion: b.scheduledCompletion ?? null, dlp_months: b.dlpMonths ?? 0, retention_pct: units(b.retentionPct ?? '0', 'percent'), mob_advance_pct: units(b.mobAdvancePct ?? '0', 'percent'), ld_summary: b.ldSummary?.trim() || null, pm_user: b.pmUser ?? null, director_user: b.directorUser ?? null });
  /** The prefill of the wizard from an awarded tender (08.03): the authority, the name of work, the place, the value, the period. */
  function prefill(actor, tenderId) {
    need(actor, 'proj.project.create', 'set projects up');
    const t = db.prepare('SELECT t.*, a.awarded_value_minor, a.loa_no, a.loa_date FROM tdr_tenders t LEFT JOIN tdr_awards a ON a.tender_id = t.id AND a.outcome = \'WON\' AND a.status = \'APPROVED\' AND a.deleted_at IS NULL WHERE t.id = ? AND t.company_id = ?').get(Number(tenderId), actor.companyId);
    if (!t || t.stage !== 'AWARDED') throw unprocessable('Only an awarded tender prefills a project.');
    if (db.prepare('SELECT 1 FROM proj_projects WHERE tender_id = ? AND deleted_at IS NULL').get(t.id)) throw conflict('A project has been set up for this tender already.');
    return { tenderId: t.id, tenderNo: t.doc_no, name: t.name_of_work, location: t.location, clientPartnerId: t.client_partner_id, contractNo: t.loa_no ?? null, contractValue: t.awarded_value_minor == null ? null : money(t.awarded_value_minor), contractType: ({ ITEM_RATE: 'ITEM_RATE', PERCENTAGE: 'ITEM_RATE', LUMP_SUM: 'LUMP_SUM', EPC: 'EPC', HAM: 'HAM' })[t.bid_type] ?? 'ITEM_RATE', periodMonths: t.period_months };
  }
  const projects = {
    list(actor, query) {
      need(actor, 'proj.project.view', 'see projects'); const s = scopeSql(actor);
      return runList(db, projectList, parseListRequest(projectList, query), { select: 'x.*', scopeSql: s.sql, params: s.params, tieBreaker: 'x.id', map: (x) => { const v = view(actor, x); return { id: v.id, projectId: v.projectId, code: v.code, name: v.name, type: v.type, client: v.client?.name ?? null, location: v.location, contractType: v.contractTypeLabel, contractValue: v.contractValue, startDate: v.startDate, scheduledCompletion: v.scheduledCompletion, state: v.state, stateLabel: v.stateLabel, status: v.status, statusLabel: v.statusLabel, pm: v.pm, health: v.health, timeElapsedPct: v.timeElapsedPct }; } });
    },
    statusCounts(actor, query, dimension, projectId = null) {
      need(actor, 'proj.project.view', 'see projects');
      if (!['state', 'status'].includes(dimension)) throw badRequest('Select lifecycle or approval status.');
      const { sql, params } = scopeSql(actor);
      const selected = projectId == null ? { scopeSql: sql, params } : {
        scopeSql: `(${sql}) AND x.project_id = :metricProjectId`, params: { ...params, metricProjectId: projectId },
      };
      const where = whereOf(projectList, parseListRequest(projectList, query), selected);
      const column = projectList.columns[dimension];
      const rows = db.prepare(`SELECT ${column.sql} AS code, COUNT(*) AS count
        FROM ${projectList.from} WHERE ${where.sql} GROUP BY ${column.sql}`).all(where.params);
      const counts = new Map(rows.map(({ code, count }) => [code, count]));
      return column.options.flatMap(([code, label]) => counts.has(code) ? [{ code, label, count: counts.get(code) }] : []);
    },
    // The analytics worker captures only identifiers and lifecycle, using the same register predicates.
    snapshotLifecycle(companyId) {
      return db.prepare(`SELECT x.id AS sourceId, x.project_id AS projectId, x.lifecycle_state AS state
        FROM ${projectList.from} WHERE ${projectList.where} AND x.company_id = ?`).iterate(companyId);
    },
    /** @param {any} actor @param {any} req @param {{ project?: (view: any) => any, scopedExport?: boolean }} [options] */
    exportSource(actor, req, { project = (v) => ({ code: v.code, name: v.name, type: v.type, client: v.client?.name ?? '', location: v.location ?? '', contractType: v.contractTypeLabel, contractValue: v.contractValue, startDate: v.startDate ?? '', scheduledCompletion: v.scheduledCompletion ?? '', state: v.stateLabel, status: v.statusLabel, pm: v.pm ?? '', health: v.health }), scopedExport = false } = {}) {
      need(actor, 'proj.project.export', 'export projects');
      const s = scopeSql(actor);
      const exportScope = scopedExport ? authz.scopeFilter(actor, 'proj.project.export', { project: 'x.project_id' }) : null;
      const opts = { select: 'x.*', scopeSql: exportScope ? `${s.sql} AND (${exportScope.sql})` : s.sql, params: s.params, tieBreaker: 'x.id' };
      return { title: projectList.label, permission: 'proj.project.export', personal: false, columns: [...Object.entries(projectList.columns).map(([key, c]) => ({ key, label: c.label, type: c.type === 'enum' ? 'text' : c.type })), { key: 'health', label: 'Health', type: 'text' }], count: () => countList(db, projectList, req, opts),
        rows: () => runList(db, projectList, req, { ...opts, limit: null, map: (x) => project(view(actor, x)) }).data, describe: (r) => [r.q ? `search "${r.q}"` : '', ...r.filters.map((f) => `${projectList.columns[f.key]?.label ?? f.key} ${f.op} ${f.raw}`)].filter(Boolean) };
    },
    options(actor) { need(actor, 'proj.project.view', 'see projects'); return { numbering: templatesOf(actor.companyId).map((t) => ({ code: t.code, name: t.name, docType: t.docType, format: t.format })), folderTemplates: folderTemplates(actor.companyId), folderDefault: param(actor.companyId, 'proj.folder_template'), settingsDefaults: { ...SETTINGS_DEFAULTS, ...(param(actor.companyId, 'proj.settings_defaults') ?? {}) }, checklists: { ACTIVATE: checklistOf(actor.companyId, 'ACTIVATE') }, contractTypes: Object.entries(CONTRACT_TYPES).map(([code, label]) => ({ code, label })), states: Object.entries(STATES).map(([code, label]) => ({ code, label })) }; },
    prefill,
    get(actor, id) { need(actor, 'proj.project.view', 'see projects'); return view(actor, row(actor, id), { detail: true }); },
    /** FR-01, T-01: the wizard: everything in one transaction; when `submit` is given the project also goes for activation, and nothing is made if that is refused. */
    create(actor, b) {
      need(actor, 'proj.project.create', 'set projects up');
      const p = [...partnerProblems(actor.companyId, b.contract), ...contractProblems(b.contract), ...teamProblems(actor.companyId, b.team)];
      if (b.tenderId) { const t = db.prepare('SELECT id, stage FROM tdr_tenders WHERE id = ? AND company_id = ?').get(b.tenderId, actor.companyId); if (!t || t.stage !== 'AWARDED') p.push({ field: 'tenderId', message: 'Choose an awarded tender of your company' }); else if (db.prepare('SELECT 1 FROM proj_projects WHERE tender_id = ? AND deleted_at IS NULL').get(t.id)) p.push({ field: 'tenderId', message: 'A project has been set up for this tender already' }); }
      const tpls = templatesOf(actor.companyId); const picked = b.setup.numbering ?? tpls.map((t) => t.code);
      for (const c of picked) if (!tpls.some((t) => t.code === c)) p.push({ field: 'setup.numbering', message: `${c} is not a numbering template of this company` });
      const folder = b.setup.folderTemplate === undefined ? param(actor.companyId, 'proj.folder_template') : b.setup.folderTemplate;
      if (folder && !folderTemplates(actor.companyId).some((t) => t.code === folder)) p.push({ field: 'setup.folderTemplate', message: 'That folder template does not exist' });
      const codes = new Set(); for (const [i, s] of b.sites.entries()) { if (codes.has(s.code.toLowerCase())) p.push({ field: `sites.${i}.code`, message: `Site ${s.code} is listed twice` }); codes.add(s.code.toLowerCase()); }
      const ms = new Set(); for (const [i, m] of b.milestones.entries()) { if (ms.has(m.code.toLowerCase())) p.push({ field: `milestones.${i}.code`, message: `Milestone ${m.code} is listed twice` }); ms.add(m.code.toLowerCase()); }
      fail(p);
      const el = elevated(actor);
      return transaction(db, () => {
        const client = partnerOf(actor.companyId, b.contract.clientPartnerId, 'CLIENT'); const pmU = b.team.pmUser ? userOf(actor.companyId, b.team.pmUser) : null;
        const o = org.create(el, 'projects', { code: b.basics.code, name: b.basics.name, type: b.basics.type, branchId: b.basics.branchId ?? undefined, clientName: client.legal_name, startDate: b.contract.startDate ?? undefined, endDate: b.contract.scheduledCompletion ?? undefined, ...(pmU ? { pmUserId: pmU.id } : {}) }, {});
        const projectId = o.id;
        for (const s of b.sites) org.create(el, 'sites', { projectId, code: s.code, name: s.name, siteType: s.siteType ?? 'SITE', address: s.address ?? undefined, latitude: s.latitude ?? undefined, longitude: s.longitude ?? undefined, geofenceType: s.geofenceType ?? 'NONE', geofenceRadiusM: s.geofenceRadiusM ?? undefined, geofencePolygon: s.geofencePolygon ?? undefined }, {});
        const settings = { ...SETTINGS_DEFAULTS, ...(param(actor.companyId, 'proj.settings_defaults') ?? {}), ...(b.setup.settings ?? {}) };
        const cols = columnsFrom({ ...b.contract, ...b.basics, ...b.team });
        const names = Object.keys(cols);
        const xid = Number(db.prepare(`INSERT INTO proj_projects (company_id, project_id, tender_id, ${names.join(', ')}, settings_json, status, lifecycle_state, created_by, source_type, source_id) VALUES (?, ?, ?, ${names.map(() => '?').join(', ')}, ?, 'DRAFT', 'SETUP', ?, ?, ?)`)
          .run(actor.companyId, projectId, b.tenderId ?? null, ...names.map((n) => cols[n]), JSON.stringify(settings), actor.user, b.tenderId ? 'tdr_tender' : 'org_project', String(b.tenderId ?? projectId)).lastInsertRowid);
        // the numbering series and the document folders from templates (FR-01, FR-05)
        const numbering = createNumberingService({ db, approvals: null }); const series = [];
        for (const t of tpls.filter((y) => picked.includes(y.code))) series.push(numbering.createSeries(el, { docType: t.docType, name: `${b.basics.code} ${t.name}`, prefix: t.prefix, format: t.format, gapFree: false, resetRule: t.resetRule ?? 'never', seqStart: 1, projectId, branchCode: null, reason: `Series of project ${b.basics.code}` }, null).id);
        let folders = 0; if (folder) folders = documentsOf(db).folders.applyTemplate(el, projectId, folder).folders;
        db.prepare('UPDATE proj_projects SET setup_json = ? WHERE id = ?').run(JSON.stringify({ numbering: picked, series, folderTemplate: folder ?? null, folders }), xid);
        b.milestones.forEach((m, i) => db.prepare("INSERT INTO proj_milestones (company_id, project_id, code, name, planned_date, contractual, payment_linked, sort_order, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'proj_project', ?)").run(actor.companyId, projectId, m.code.trim(), m.name.trim(), m.plannedDate, m.contractual ? 1 : 0, m.paymentLinked ? 1 : 0, i + 1, actor.user, String(xid)));
        db.prepare("INSERT INTO proj_lifecycle_log (company_id, project_id, kind, from_state, to_state, log_status, reason, by_user, created_by, source_type, source_id) VALUES (?, ?, 'TRANSITION', NULL, 'SETUP', 'EFFECTIVE', 'Set up with the wizard', ?, ?, 'proj_project', ?)").run(actor.companyId, projectId, actor.user, actor.user, String(xid));
        writeAudit(db, { entity: 'proj_projects', entityId: xid, action: 'create', newValues: { code: b.basics.code, sites: b.sites.length, series: series.length, folders }, actor: actor.user, companyId: actor.companyId });
        event('proj.project.created', actor, xid, actor.companyId, projectId, { projectId, code: b.basics.code, tenderId: b.tenderId ?? null, sites: b.sites.length, series: series.length, folders });
        if (b.submit) projects.submit(actor, xid, { ticked: b.ticked });
        return projects.get(actor, xid);
      });
    },
    update(actor, id, b) {
      const x = row(actor, id); need(actor, 'proj.project.edit', 'change projects', x.project_id);
      if (b.version != null && b.version !== x.version) throw conflict(`The project was changed by someone else (version ${x.version}, you had ${b.version}); reload it.`);
      const setup = ['DRAFT', 'RETURNED'].includes(x.status) && x.lifecycle_state === 'SETUP';
      if (!setup && ['CLOSED', 'ARCHIVED'].includes(x.lifecycle_state)) throw new HttpError(409, 'LOCKED', 'A closed project is not changed.');
      if (x.status === 'SUBMITTED') throw new HttpError(409, 'LOCKED', 'The project is waiting for approval; withdraw it first.');
      const locked = LOCKED_AFTER.filter((f) => b[f] !== undefined);
      if (!setup && locked.length) throw unprocessable(`${locked.join(', ')} change only by an approved amendment (the contract module of 21.01 takes the contract over later). Raise one with Amend.`);
      const p = []; if (b.clientPartnerId !== undefined || b.consultantPartnerId !== undefined || b.funderPartnerId !== undefined) p.push(...partnerProblems(actor.companyId, { clientPartnerId: b.clientPartnerId ?? x.client_partner_id, consultantPartnerId: b.consultantPartnerId, funderPartnerId: b.funderPartnerId }));
      p.push(...contractProblems({ startDate: b.startDate ?? x.start_date, scheduledCompletion: b.scheduledCompletion ?? x.scheduled_completion, contractType: b.contractType ?? x.contract_type, contractValue: b.contractValue }), ...teamProblems(actor.companyId, b)); fail(p);
      return transaction(db, () => {
        const map = { sector: 'sector', location: 'location', clientPartnerId: 'client_partner_id', consultantPartnerId: 'consultant_partner_id', funderPartnerId: 'funder_partner_id', contractType: 'contract_type', contractNo: 'contract_no', startDate: 'start_date', scheduledCompletion: 'scheduled_completion', revisedCompletion: 'revised_completion', ldSummary: 'ld_summary', dlpMonths: 'dlp_months', pmUser: 'pm_user', directorUser: 'director_user' };
        const sets = []; const vals = [];
        for (const [k, col] of Object.entries(map)) if (b[k] !== undefined) { sets.push(`${col} = ?`); vals.push(typeof b[k] === 'string' ? b[k].trim() || null : b[k]); }
        for (const [k, col, kind] of [['contractValue', 'contract_value', 'money'], ['retentionPct', 'retention_pct', 'percent'], ['mobAdvancePct', 'mob_advance_pct', 'percent']]) if (b[k] !== undefined) { sets.push(`${col} = ?`); vals.push(units(b[k], kind)); }
        if (b.settings) { sets.push('settings_json = ?'); vals.push(JSON.stringify({ ...SETTINGS_DEFAULTS, ...json(x.settings_json, {}), ...b.settings })); }
        if (sets.length) db.prepare(`UPDATE proj_projects SET ${sets.join(', ')}, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(...vals, actor.user, nowIso(), x.id);
        else db.prepare('UPDATE proj_projects SET updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(actor.user, nowIso(), x.id);
        // the project of the organisation master follows: the name, the client, the dates and the project manager
        const o = orgOf(x.project_id); const oc = {};
        if (b.name !== undefined && b.name !== o.name) oc.name = b.name.trim();
        if (b.clientPartnerId !== undefined) oc.clientName = partnerOf(actor.companyId, b.clientPartnerId, 'CLIENT').legal_name;
        if (b.startDate !== undefined) oc.startDate = b.startDate; if (b.scheduledCompletion !== undefined) oc.endDate = b.scheduledCompletion;
        if (b.pmUser) { const u = userOf(actor.companyId, b.pmUser); if (u) oc.pmUserId = u.id; }
        if (Object.keys(oc).length && o.status !== 'CLOSED') org.update(elevated(actor), 'projects', x.project_id, { ...oc, version: o.version, reason: 'Project master change' }, {});
        writeAudit(db, { entity: 'proj_projects', entityId: x.id, action: 'update', newValues: b, actor: actor.user, companyId: actor.companyId });
        return projects.get(actor, x.id);
      });
    },
    remove(actor, id) {
      const x = row(actor, id); need(actor, 'proj.project.delete', 'delete projects', x.project_id);
      if (x.status !== 'DRAFT' || x.workflow_instance_id) throw unprocessable('Only a draft project that was never sent for approval is deleted; cancel any other.');
      return transaction(db, () => { const now = nowIso(); db.prepare('UPDATE proj_projects SET deleted_at = ?, deleted_by = ? WHERE id = ?').run(now, actor.user, x.id); db.prepare('UPDATE proj_milestones SET deleted_at = ?, deleted_by = ? WHERE project_id = ? AND deleted_at IS NULL').run(now, actor.user, x.project_id); applyProjectStatus(db, actor, x.project_id, 'CLOSED', { reason: 'The draft project was deleted' }); writeAudit(db, { entity: 'proj_projects', entityId: x.id, action: 'delete', actor: actor.user, companyId: actor.companyId }); return { id: x.id, deleted: true }; });
    },
    /** The activation: the checklist ticked and the contract, the sites and the team in place; then the project director and the director approve (FR-01, AC-01). */
    submit(actor, id, { ticked: picks } = /** @type {any} */ ({})) {
      const x = row(actor, id); need(actor, 'proj.project.submit', 'send projects for activation', x.project_id);
      if (x.lifecycle_state !== 'SETUP' || !['DRAFT', 'RETURNED'].includes(x.status)) throw unprocessable('Only a project in setup, as a draft or returned, is sent for activation.');
      const tk = ticked(checklistOf(x.company_id, 'ACTIVATE'), picks); const checks = readinessOf(x, 'MOBILISATION'); const p = [];
      p.push(...tk.missing.map((m) => ({ field: 'ticked', message: `Tick: ${m}` })), ...checks.filter((c) => c.blocking && !c.ok).map((c) => ({ field: 'readiness', message: c.text })));
      if (p.length) throw unprocessable('The project is not ready for activation.', p);
      return transaction(db, () => {
        const ctx = { projectId: x.project_id, valueMinor: x.contract_value };
        if (x.status === 'RETURNED') workflowOf(db).resubmit(actor, x.workflow_instance_id, { comment: 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: ACTIVATION_DOC, docId: String(x.id), comment: orgOf(x.project_id).code, context: ctx }); db.prepare('UPDATE proj_projects SET workflow_instance_id = ? WHERE id = ?').run(inst.id, x.id); }
        db.prepare("UPDATE proj_projects SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), x.id);
        db.prepare("INSERT INTO proj_lifecycle_log (company_id, project_id, kind, from_state, to_state, log_status, checklist_json, reason, workflow_instance_id, by_user, created_by, source_type, source_id) VALUES (?, ?, 'ACTIVATION', 'SETUP', 'MOBILISATION', 'REQUESTED', ?, 'Sent for activation', (SELECT workflow_instance_id FROM proj_projects WHERE id = ?), ?, ?, 'proj_project', ?)").run(x.company_id, x.project_id, JSON.stringify(tk.items), x.id, actor.user, actor.user, String(x.id));
        writeAudit(db, { entity: 'proj_projects', entityId: x.id, action: 'submit', actor: actor.user, companyId: x.company_id });
        return projects.get(actor, x.id);
      });
    },
    withdraw(actor, id, { reason }) { const x = row(actor, id); if (x.status !== 'SUBMITTED') throw unprocessable('Only a project waiting for approval is withdrawn.'); if (!same(x.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, x.workflow_instance_id, { comment: reason }); return projects.get(actor, x.id); },
    cancel(actor, id, { reason }) {
      const x = row(actor, id); need(actor, 'proj.project.cancel', 'cancel projects', x.project_id);
      if (x.lifecycle_state !== 'SETUP' || !['DRAFT', 'RETURNED', 'SUBMITTED'].includes(x.status)) throw unprocessable('Only a project that is still in setup is cancelled; a live project is suspended or closed.');
      return transaction(db, () => { if (x.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, x.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare("UPDATE proj_projects SET status = 'CANCELLED', remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), x.id); applyProjectStatus(db, actor, x.project_id, 'CLOSED', { reason }); writeAudit(db, { entity: 'proj_projects', entityId: x.id, action: 'cancel', reason, actor: actor.user, companyId: actor.companyId }); return projects.get(actor, x.id); });
    },
    /** BR-02: once the project is live the contract terms change only by an approved amendment (project director, then the director). */
    amend(actor, id, { changes, reason }) {
      const x = row(actor, id); need(actor, 'proj.project.amend', 'amend projects', x.project_id);
      if (x.status !== 'APPROVED' || ['CLOSED', 'ARCHIVED'].includes(x.lifecycle_state)) throw unprocessable('Only an active project is amended.');
      if (db.prepare("SELECT 1 FROM proj_lifecycle_log WHERE project_id = ? AND log_status = 'REQUESTED' AND deleted_at IS NULL").get(x.project_id)) throw conflict('Another request for this project is waiting for approval.');
      const keys = Object.keys(changes).filter((k) => changes[k] !== undefined); if (!keys.length) throw badRequest('Correct the highlighted fields', [{ field: 'changes', message: 'Give at least one change' }]);
      const p = []; if (changes.clientPartnerId) p.push(...partnerProblems(actor.companyId, { clientPartnerId: changes.clientPartnerId }));
      p.push(...contractProblems({ startDate: changes.startDate ?? x.start_date, scheduledCompletion: changes.scheduledCompletion ?? x.scheduled_completion, revisedCompletion: changes.revisedCompletion ?? x.revised_completion, contractType: changes.contractType ?? x.contract_type })); fail(p);
      const before = Object.fromEntries(keys.map((k) => [k, ({ contractValue: money(x.contract_value), contractType: x.contract_type, contractNo: x.contract_no, startDate: x.start_date, scheduledCompletion: x.scheduled_completion, revisedCompletion: x.revised_completion, dlpMonths: x.dlp_months, retentionPct: num(x.retention_pct, 'percent'), mobAdvancePct: num(x.mob_advance_pct, 'percent'), clientPartnerId: x.client_partner_id })[k] ?? null]));
      return transaction(db, () => {
        const lid = Number(db.prepare("INSERT INTO proj_lifecycle_log (company_id, project_id, kind, from_state, to_state, log_status, changes_json, reason, by_user, created_by, source_type, source_id) VALUES (?, ?, 'AMENDMENT', ?, ?, 'REQUESTED', ?, ?, ?, ?, 'proj_project', ?)").run(x.company_id, x.project_id, x.lifecycle_state, x.lifecycle_state, JSON.stringify({ after: Object.fromEntries(keys.map((k) => [k, changes[k]])), before }), reason.trim(), actor.user, actor.user, String(x.id)).lastInsertRowid);
        const inst = workflowOf(db).submit(actor, { docType: CHANGE_DOC, docId: String(lid), comment: `${orgOf(x.project_id).code}: ${keys.join(', ')}`, context: { projectId: x.project_id, valueMinor: x.contract_value } });
        db.prepare('UPDATE proj_lifecycle_log SET workflow_instance_id = ? WHERE id = ?').run(inst.id, lid); db.prepare('UPDATE proj_projects SET pending_json = ? WHERE id = ?').run(JSON.stringify({ logId: lid, keys }), x.id);
        writeAudit(db, { entity: 'proj_projects', entityId: x.id, action: 'amend_requested', newValues: { keys }, reason, actor: actor.user, companyId: x.company_id });
        return projects.get(actor, x.id);
      });
    },
    history(actor, id) {
      const x = row(actor, id); const ids = db.prepare('SELECT workflow_instance_id AS i FROM proj_lifecycle_log WHERE project_id = ? AND workflow_instance_id IS NOT NULL').all(x.project_id).map((r) => r.i);
      const approvals = ids.flatMap((i) => db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(i));
      return { approvals, audit: db.prepare('SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = ? AND entity_id = ? ORDER BY id').all('proj_projects', String(x.id)) };
    },
    print(actor, id) {
      need(actor, 'proj.project.print', 'print projects'); const v = projects.get(actor, id);
      writeAudit(db, { entity: 'proj_projects', entityId: v.id, action: 'print', actor: actor.user, companyId: actor.companyId });
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(v.code)}</title><style>body{font:13px sans-serif;margin:24px}td,th{border:1px solid #888;padding:4px 6px;text-align:left}table{border-collapse:collapse;width:100%;margin-bottom:12px}</style></head><body><h1>Project ${esc(v.code)} · ${esc(v.name)}</h1><p>${esc(v.stateLabel)} · ${esc(v.statusLabel)} · client ${esc(v.client?.name ?? '–')}${v.consultant ? ` · consultant ${esc(v.consultant.name)}` : ''}${v.funder ? ` · funder ${esc(v.funder.name)}` : ''}</p><table><tbody><tr><th>Contract</th><td>${esc(v.contractTypeLabel)} ${esc(v.contractNo ?? '')}</td><th>Value</th><td>₹ ${esc(v.contractValue)}</td></tr><tr><th>Start</th><td>${esc(v.startDate ?? '')}</td><th>Scheduled completion</th><td>${esc(v.scheduledCompletion ?? '')}${v.revisedCompletion ? ` (revised ${esc(v.revisedCompletion)})` : ''}</td></tr><tr><th>Defect liability</th><td>${esc(v.dlpMonths)} months</td><th>Retention / mobilisation advance</th><td>${esc(v.retentionPct)}% / ${esc(v.mobAdvancePct)}%</td></tr><tr><th>Liquidated damages</th><td colspan="3">${esc(v.ldSummary ?? '')}</td></tr></tbody></table><h2>Sites</h2><ul>${v.sites.map((s) => `<li>${esc(s.code)} ${esc(s.name)} (${esc(s.status)})</li>`).join('')}</ul><h2>Milestones</h2><table><thead><tr><th>Code</th><th>Milestone</th><th>Planned</th><th>Actual</th><th>Status</th></tr></thead><tbody>${v.milestones.map((m) => `<tr><td>${esc(m.code)}</td><td>${esc(m.name)}</td><td>${esc(m.plannedDate)}</td><td>${esc(m.actualDate ?? '')}</td><td>${esc(m.statusLabel)}</td></tr>`).join('')}</tbody></table></body></html>`;
    },
  };
  /** An approved amendment applied to the project master and the organisation master (dates, client). */
  function applyChanges(actor, x, ch, l) {
    const a = ch.after ?? {}; const sets = []; const vals = [];
    const map = { contractType: 'contract_type', contractNo: 'contract_no', startDate: 'start_date', scheduledCompletion: 'scheduled_completion', revisedCompletion: 'revised_completion', dlpMonths: 'dlp_months', clientPartnerId: 'client_partner_id' };
    for (const [k, col] of Object.entries(map)) if (a[k] !== undefined) { sets.push(`${col} = ?`); vals.push(a[k]); }
    for (const [k, col, kind] of [['contractValue', 'contract_value', 'money'], ['retentionPct', 'retention_pct', 'percent'], ['mobAdvancePct', 'mob_advance_pct', 'percent']]) if (a[k] !== undefined) { sets.push(`${col} = ?`); vals.push(units(a[k], kind)); }
    db.prepare(`UPDATE proj_projects SET ${sets.join(', ')}${sets.length ? ',' : ''} pending_json = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(...vals, actor.user, nowIso(), x.id);
    const o = orgOf(x.project_id); const oc = {};
    if (a.startDate !== undefined) oc.startDate = a.startDate; if (a.scheduledCompletion !== undefined) oc.endDate = a.scheduledCompletion; if (a.clientPartnerId !== undefined) oc.clientName = partnerOf(x.company_id, a.clientPartnerId, null)?.legal_name;
    if (Object.keys(oc).length && o.status !== 'CLOSED') org.update(elevated(actor, x.company_id), 'projects', x.project_id, { ...oc, version: o.version, reason: 'Approved amendment of the project master' }, {});
    db.prepare("UPDATE proj_lifecycle_log SET log_status = 'EFFECTIVE', decided_at = ? WHERE id = ?").run(nowIso(), l.id);
    writeAudit(db, { entity: 'proj_projects', entityId: x.id, action: 'amended', oldValues: ch.before, newValues: a, reason: l.reason, actor: actor.user, companyId: x.company_id });
    event('proj.project.amended', actor, x.id, x.company_id, x.project_id, { projectId: x.project_id, code: o.code, changes: a });
  }
  function decideActivation(instance, actor, outcome, comment) {
    const x = db.prepare('SELECT * FROM proj_projects WHERE id = ?').get(rid(instance.docId)); if (!x || !['SUBMITTED', 'RETURNED'].includes(x.status)) return;
    const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN';
    const to = outcome === 'APPROVED' ? 'APPROVED' : outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED';
    db.prepare('UPDATE proj_projects SET status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, actor.user, nowIso(), x.id);
    if (withdrawn) db.prepare('UPDATE proj_projects SET workflow_instance_id = NULL WHERE id = ?').run(x.id);
    db.prepare("UPDATE proj_lifecycle_log SET log_status = ?, decided_at = ? WHERE project_id = ? AND kind = 'ACTIVATION' AND log_status = 'REQUESTED'").run(to === 'APPROVED' ? 'EFFECTIVE' : to === 'DRAFT' ? 'CANCELLED' : to, nowIso(), x.project_id);
    writeAudit(db, { entity: 'proj_projects', entityId: x.id, action: outcome.toLowerCase(), reason: comment ?? null, actor: actor.user, companyId: x.company_id });
    if (to !== 'APPROVED') return;
    const fx = fresh(x.id); db.prepare('UPDATE proj_projects SET activated_at = ?, activated_by = ? WHERE id = ?').run(nowIso(), actor.user, x.id);
    applyState(actor, { ...fx, lifecycle_state: 'SETUP' }, 'MOBILISATION', { logId: null, reason: 'Activated' });
    const o = orgOf(x.project_id);
    event('proj.project.activated', actor, x.id, x.company_id, x.project_id, { projectId: x.project_id, code: o.code, name: o.name, clientPartnerId: x.client_partner_id, contractValue: money(x.contract_value), startDate: x.start_date, scheduledCompletion: x.scheduled_completion, pm: x.pm_user, director: x.director_user, sites: sitesOf(x.project_id).map((s) => s.code), setup: json(x.setup_json, {}) });
  }

  // ---- key dates and milestones (FR-04) ----------------------------------------------------------------------------------------------------------------
  const mrow = (actor, id) => { const m = db.prepare('SELECT * FROM proj_milestones WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!m || !may(actor, 'proj.project.view', m.project_id)) throw notFound('That milestone does not exist.'); return m; };
  const mayMilestone = (actor, x) => { need(actor, 'proj.milestone.manage', 'keep milestones', x.project_id); if (['CLOSED', 'ARCHIVED'].includes(x.lifecycle_state) || x.status === 'CANCELLED') throw new HttpError(409, 'LOCKED', 'The milestones of a closed or cancelled project are not changed.'); };
  const milestones = {
    list(actor, id) { const x = row(actor, id); return milestonesOf(x.project_id); },
    create(actor, id, b) {
      const x = row(actor, id); mayMilestone(actor, x);
      if (db.prepare('SELECT 1 FROM proj_milestones WHERE project_id = ? AND code = ? COLLATE NOCASE AND deleted_at IS NULL').get(x.project_id, b.code.trim())) throw conflict(`Milestone ${b.code} exists already.`);
      const n = db.prepare('INSERT INTO proj_milestones (company_id, project_id, code, name, planned_date, contractual, payment_linked, sort_order, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM proj_milestones WHERE project_id = ?), ?, \'proj_project\', ?)').run(x.company_id, x.project_id, b.code.trim(), b.name.trim(), b.plannedDate, b.contractual ? 1 : 0, b.paymentLinked ? 1 : 0, x.project_id, actor.user, String(x.id));
      writeAudit(db, { entity: 'proj_milestones', entityId: Number(n.lastInsertRowid), action: 'create', newValues: b, actor: actor.user, companyId: x.company_id });
      return milestonesOf(x.project_id);
    },
    update(actor, mid, b) {
      const m = mrow(actor, mid); const x = db.prepare('SELECT * FROM proj_projects WHERE project_id = ? AND deleted_at IS NULL').get(m.project_id); mayMilestone(actor, x);
      if (b.version != null && b.version !== m.version) throw conflict('The milestone was changed by someone else; reload it.');
      if (m.contractual && x.status === 'APPROVED' && (b.plannedDate !== undefined && b.plannedDate !== m.planned_date)) throw unprocessable('The planned date of a contractual milestone of a live project changes only by an approved amendment of the contract.');
      const status = b.status ?? m.milestone_status; const actual = status === 'ACHIEVED' ? (b.actualDate ?? m.actual_date ?? todayIST()) : null;
      if (status === 'ACHIEVED' && actual > todayIST()) throw badRequest('Correct the highlighted fields', [{ field: 'actualDate', message: 'A milestone is achieved on or before today' }]);
      db.prepare('UPDATE proj_milestones SET name = ?, planned_date = ?, contractual = ?, payment_linked = ?, milestone_status = ?, actual_date = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.name?.trim() ?? m.name, b.plannedDate ?? m.planned_date, b.contractual === undefined ? m.contractual : b.contractual ? 1 : 0, b.paymentLinked === undefined ? m.payment_linked : b.paymentLinked ? 1 : 0, status, actual, actor.user, nowIso(), m.id);
      writeAudit(db, { entity: 'proj_milestones', entityId: m.id, action: status === 'ACHIEVED' && m.milestone_status !== 'ACHIEVED' ? 'achieved' : 'update', newValues: b, actor: actor.user, companyId: m.company_id });
      if (status === 'ACHIEVED' && m.milestone_status !== 'ACHIEVED') event('proj.milestone.achieved', actor, m.id, m.company_id, m.project_id, { projectId: m.project_id, code: m.code, name: m.name, plannedDate: m.planned_date, actualDate: actual, contractual: Boolean(m.contractual), paymentLinked: Boolean(m.payment_linked) });
      return milestonesOf(m.project_id);
    },
    remove(actor, mid) { const m = mrow(actor, mid); const x = db.prepare('SELECT * FROM proj_projects WHERE project_id = ? AND deleted_at IS NULL').get(m.project_id); mayMilestone(actor, x); if (m.milestone_status === 'ACHIEVED') throw unprocessable('An achieved milestone is not deleted.'); db.prepare('UPDATE proj_milestones SET deleted_at = ?, deleted_by = ? WHERE id = ?').run(nowIso(), actor.user, m.id); writeAudit(db, { entity: 'proj_milestones', entityId: m.id, action: 'delete', actor: actor.user, companyId: m.company_id }); return milestonesOf(m.project_id); },
    /** One row of the Excel import (04.13). */
    importRow(actor, { projectCode, row: r }) {
      const o = db.prepare('SELECT id FROM org_projects WHERE company_id = ? AND code = ? COLLATE NOCASE AND is_active = 1').get(actor.companyId, projectCode); if (!o) throw unprocessable(`Project ${projectCode} does not exist`);
      const x = db.prepare('SELECT * FROM proj_projects WHERE project_id = ? AND deleted_at IS NULL').get(o.id); if (!x) throw unprocessable(`Project ${projectCode} has no project master`);
      milestones.create(actor, x.id, r); return { id: x.id, ref: `${projectCode} ${r.code}` };
    },
  };
  const access = (actor, id) => { const x = db.prepare('SELECT * FROM proj_projects WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); return x && may(actor, 'proj.project.view', x.project_id) ? x : null; };
  /** For the parts that follow: the project master of an organisation project (id), its state and its settings. */
  const ofOrg = (companyId, projectId) => { const x = db.prepare('SELECT * FROM proj_projects WHERE company_id = ? AND project_id = ? AND deleted_at IS NULL').get(companyId, projectId); return x ? { id: x.id, projectId: x.project_id, state: x.lifecycle_state, status: x.status, contractValue: money(x.contract_value), settings: { ...SETTINGS_DEFAULTS, ...json(x.settings_json, {}) } } : null; };
  return { projects, transitions, milestones, decideLog, decideActivation, access, ofOrg, healthOf };
}

const services = new WeakMap();
export const bindProjects = (db, s) => services.set(db, s);
export const projectsOf = (db) => services.get(db) ?? null;

// A project with a project master is activated only by its own approval (BR-01; AC-04): the plain activation request of the organisation master is refused for it.
activationGuards.push((db, r) => (db.prepare('SELECT 1 FROM proj_projects WHERE project_id = ? AND deleted_at IS NULL').get(r.id) ? 'This project has a project master: it is activated from its page under Project Master (project director, then the director).' : null));

const userRoles = (u) => json(u.roles_json, []);
/** The project director step: a project director other than the maker (the director when there is none). */
if (!workflowResolvers.get('proj.director')) workflowResolvers.register('proj.director', ({ db, companyId, instance }) => {
  const x = instance.docType === ACTIVATION_DOC ? db.prepare('SELECT created_by FROM proj_projects WHERE id = ?').get(rid(instance.docId)) : db.prepare('SELECT by_user AS created_by FROM proj_lifecycle_log WHERE id = ?').get(rid(instance.docId));
  const out = new Set([instance.submittedBy, x?.created_by].filter(Boolean).map((v) => String(v).toLowerCase()));
  const users = db.prepare('SELECT username, roles_json FROM iam_users WHERE company_id = ? AND is_active = 1').all(companyId).filter((u) => userRoles(u).includes('PD') && !out.has(u.username.toLowerCase())).map((u) => ({ user: u.username }));
  return users.length ? users : [{ role: 'DIR' }];
});
/** The project manager step of a move: the manager of the project (a project manager other than the requester when they are the manager). */
if (!workflowResolvers.get('proj.pm')) workflowResolvers.register('proj.pm', ({ db, companyId, instance }) => {
  const l = db.prepare('SELECT project_id FROM proj_lifecycle_log WHERE id = ?').get(rid(instance.docId)); const x = l ? db.prepare('SELECT pm_user FROM proj_projects WHERE project_id = ? AND deleted_at IS NULL').get(l.project_id) : null;
  const me = String(instance.submittedBy ?? '').toLowerCase();
  if (x?.pm_user && x.pm_user.toLowerCase() !== me) return [{ user: x.pm_user }];
  const users = db.prepare('SELECT username, roles_json FROM iam_users WHERE company_id = ? AND is_active = 1').all(companyId).filter((u) => userRoles(u).includes('PM') && u.username.toLowerCase() !== me).map((u) => ({ user: u.username }));
  return users.length ? users : [{ role: 'PD' }];
});
const step = (code, name, approvers) => ({ code, name, type: 'approval', mode: 'single', approvers, slaHours: 48, requireAttachment: false, checklist: [], when: null, notify: [], action: null });
const hooks = (k) => ({
  onApproved: (db, { instance, actor }) => projectsOf(db)?.[k](instance, actor, 'APPROVED'),
  onRejected: (db, { instance, actor, comment }) => projectsOf(db)?.[k](instance, actor, 'REJECTED', comment),
  onReturned: (db, { instance, actor, comment }) => projectsOf(db)?.[k](instance, actor, 'RETURNED', comment),
  onCancelled: (db, { instance, actor, comment }) => projectsOf(db)?.[k](instance, actor, 'CANCELLED', comment),
});
const projLine = (db, id) => db.prepare('SELECT x.*, p.code, p.name FROM proj_projects x JOIN org_projects p ON p.id = x.project_id WHERE x.id = ?').get(id);
workflowTypes.register({
  docType: ACTIVATION_DOC, label: 'Project activation', processOwner: 'PD', route: (id) => `/proj/project?id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT x.requested_by, p.code, p.name FROM proj_projects x JOIN org_projects p ON p.id = x.project_id WHERE x.id = ? AND x.company_id = ?').get(rid(id), companyId); return r ? { ref: r.code, title: r.name, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = projLine(db, rid(id)); if (!r) return null; return { fields: [{ label: 'Project', value: `${r.code} ${r.name}` }, { label: 'Contract', value: `${CONTRACT_TYPES[r.contract_type]} · ₹ ${money(r.contract_value)}` }, { label: 'Period', value: `${r.start_date ?? '–'} to ${r.scheduled_completion ?? '–'}` }, { label: 'Project manager', value: r.pm_user ?? '–' }] }; },
  defaultDefinition: { name: 'Project activation: the project director, then the director', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('PD', 'Project director', [{ kind: 'resolver', resolver: 'proj.director' }]), step('DIR', 'Director', [{ kind: 'role', role: 'DIR' }])] },
  hooks: hooks('decideActivation'),
});
for (const [docType, label, name] of [[TRANSITION_DOC, 'Project lifecycle move (suspension, closure)', 'Suspension or closure: the project manager, the project director, then the director'], [CHANGE_DOC, 'Amendment of the project master', 'Amendment of the contract terms: the project director, then the director']]) {
  workflowTypes.register({
    docType, label, processOwner: 'PD', route: (id) => { return `/proj/project?log=${id}`; },
    describe(db, companyId, id) { const r = db.prepare('SELECT l.*, p.code, p.name FROM proj_lifecycle_log l JOIN org_projects p ON p.id = l.project_id WHERE l.id = ? AND l.company_id = ?').get(rid(id), companyId); return r ? { ref: `${r.code} ${r.kind === 'AMENDMENT' ? 'amendment' : `${STATES[r.from_state]} to ${STATES[r.to_state]}`}`, title: r.name, originator: r.by_user } : null; },
    summarise(db, _actor, id) { const r = db.prepare('SELECT l.*, p.code, p.name FROM proj_lifecycle_log l JOIN org_projects p ON p.id = l.project_id WHERE l.id = ?').get(rid(id)); if (!r) return null; const ch = json(r.changes_json, null); return { fields: [{ label: 'Project', value: `${r.code} ${r.name}` }, ...(r.kind === 'AMENDMENT' ? [{ label: 'Changes', value: Object.entries(ch?.after ?? {}).map(([k, v]) => `${k}: ${ch?.before?.[k] ?? '–'} → ${v}`).join('; ') }] : [{ label: 'Move', value: `${STATES[r.from_state]} to ${STATES[r.to_state]}` }]), { label: 'Why', value: r.reason ?? '' }] }; },
    defaultDefinition: { name, settings: { resubmit: 'first', distinctApprovers: true }, steps: [...(docType === TRANSITION_DOC ? [step('PM', 'Project manager', [{ kind: 'resolver', resolver: 'proj.pm' }])] : []), step('PD', 'Project director', [{ kind: 'resolver', resolver: 'proj.director' }]), step('DIR', 'Director', [{ kind: 'role', role: 'DIR' }])] },
    hooks: hooks('decideLog'),
  });
  evidenceProviders.register(docType, ({ db, instance }) => {
    const l = db.prepare('SELECT * FROM proj_lifecycle_log WHERE id = ?').get(rid(instance.docId)); if (!l) return { sections: [] };
    const items = json(l.checklist_json, []); const warn = json(l.warnings_json, []);
    return { sections: [{ code: 'proj-move', title: 'Before approving', kind: 'metrics', items: [{ label: 'Checklist', value: `${items.filter((i) => i.ticked).length} of ${items.length} ticked`, format: 'text' }, { label: 'Warnings', value: warn.length ? warn.join('; ') : 'none', format: 'text' }] }] };
  });
}
evidenceProviders.register(ACTIVATION_DOC, ({ db, instance }) => {
  const x = db.prepare('SELECT * FROM proj_projects WHERE id = ?').get(rid(instance.docId)); if (!x) return { sections: [] };
  const sites = db.prepare('SELECT COUNT(*) AS n FROM org_sites WHERE org_project_id = ? AND is_active = 1').get(x.project_id).n; const s = json(x.setup_json, {});
  return { sections: [{ code: 'proj-activation', title: 'Before approving the activation', kind: 'metrics', items: [{ label: 'Sites', value: String(sites), format: 'text' }, { label: 'Numbering series and folders made', value: `${(s.series ?? []).length} series, ${s.folders ?? 0} folders`, format: 'text' }, { label: 'Contract value', value: `₹ ${money(x.contract_value)}`, format: 'text' }] }] };
});

// The contract, the drawings handed over and the papers of a project are attached to the project (the id is the project of the organisation master).
fileEntities.register({ entity: 'proj_project', label: 'Project papers (contract, letters, handover)', resolve(db, actor, id) {
  const x = db.prepare('SELECT * FROM proj_projects WHERE project_id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!x) return null;
  const check = (key) => authzOf(db).check(actor, key, { companyId: actor.companyId, projectId: x.project_id }).allowed;
  return { companyId: x.company_id, projectId: x.project_id, siteId: null, canView: check('proj.project.view'), canEdit: check('proj.project.edit') && !['CLOSED', 'ARCHIVED'].includes(x.lifecycle_state), locked: ['CLOSED', 'ARCHIVED'].includes(x.lifecycle_state) };
} });
