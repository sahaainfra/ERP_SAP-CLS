import { deploymentGuards } from './labour.js';
import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { grantSources, holderSourcesOf } from '../../platform/authz/grant-sources.js';
import { ROLE_TEMPLATES } from '../../platform/authz/templates.js';
import { publishEvent } from '../../platform/events/index.js';
import { HttpError, badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { objectTypes } from '../../platform/objects/index.js';
import { createParameterStore, parameterRegistry } from '../../platform/parameters/index.js';
import { evidenceProviders, workflowOf, workflowResolvers, workflowTypes } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { issueNumber } from '../core/numbering/service.js';
import { employeeRelated } from './employees.js';

// Deployment, crews and the live view of who is where (part 07.03). A deployment puts an employee on a project and site (and a crew) between two dates, as the primary or a secondary posting (BR-01: only
// one primary at a time), with the role on site, the default cost allocation and, when it should give site access, the role the person holds there. It is approved by the project manager, and by the
// project director too when the site has no planned post for the designation or the plan is full (the adapter for 17.08: `hr_site_plans`). An approved deployment is locked; a change is an amendment, a new
// revision approved again, and the approved one stays in force until then. What the rest of the ERP needs is published as `hr.deployment.changed`; site access follows without anyone typing it again: the
// permission engine and the messaging groups read approved deployments through the grant and holder sources (FR-05), so a deployment that starts, ends or is closed changes access at once.
export const DEP_DOC = 'HR_DEPLOYMENT';
export const DEP_STATUS = { DRAFT: 'Draft', SUBMITTED: 'Waiting for approval', APPROVED: 'Approved', RETURNED: 'Returned for correction', REJECTED: 'Rejected', CANCELLED: 'Cancelled', CLOSED: 'Closed', SUPERSEDED: 'Superseded' };
export const PERSON_TYPES = ['EMPLOYEE', 'WORKER'];
const LIVE = ['DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED'];
const nowIso = () => new Date().toISOString();
const dayPlus = (n, from = todayIST()) => new Date(Date.parse(`${from}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const json = (s, d) => { try { return JSON.parse(s ?? ''); } catch { return d; } };
const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
const IST_TODAY = "date('now', '+5 hours', '+30 minutes')";
const ROLE_CODES = new Set(ROLE_TEMPLATES.map((r) => r.code));

for (const [key, dataType, def, description, extra] of [
  ['hr.deployment.grantable_roles', 'json', ['SE', 'WSUP', 'QCE', 'QS', 'PLAN', 'HSEE', 'HSEO'], 'FR-05: the roles an approved deployment may give a person at the site or project (their access follows the deployment and ends with it). A role that is not listed is never given by a deployment.', {}],
  ['hr.transfer.handover_checklist', 'json', [
    { code: 'WORK', title: 'Work in hand and open items handed over' }, { code: 'DOCS', title: 'Drawings, files and documents handed over' }, { code: 'TOOLS', title: 'Tools, equipment and PPE returned' },
    { code: 'ACCESS', title: 'Site access card, gate pass and system access returned' }, { code: 'ADVANCE', title: 'Advances and imprest settled' },
  ], 'FR-02: the handover checklist a transfer starts with; the relieving manager ticks the items.', {}],
  ['hr.deployment.notice_days', 'integer', 7, 'Days ahead of a deployment ending that its end is flagged to the project manager.', { min: 0, max: 60 }],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType, default: def, scopes: ['system', 'company'], description, .../** @type {any} */ (extra) });

const CURRENT_SQL = `CASE WHEN d.status = 'APPROVED' AND d.from_date <= ${IST_TODAY} AND (d.to_date IS NULL OR d.to_date >= ${IST_TODAY}) THEN 'CURRENT' WHEN d.status = 'APPROVED' AND d.from_date > ${IST_TODAY} THEN 'UPCOMING' WHEN d.status IN ('APPROVED', 'CLOSED', 'SUPERSEDED') THEN 'ENDED' ELSE 'OPEN' END`;
export const deploymentList = defineList({
  code: 'hr.deployments', label: 'Deployments', permission: 'hr.deployment.view',
  from: "hr_deployments d LEFT JOIN hr_employees e ON e.id = d.person_id AND d.person_type = 'EMPLOYEE' LEFT JOIN lab_workers lw ON lw.id = d.person_id AND d.person_type = 'WORKER' LEFT JOIN org_designations g ON g.id = e.designation_id LEFT JOIN org_projects p ON p.id = d.dep_project_id LEFT JOIN org_sites s ON s.id = d.dep_site_id LEFT JOIN hr_crews c ON c.id = d.crew_id",
  where: "d.deleted_at IS NULL AND d.status != 'SUPERSEDED'", searchable: ['d.doc_no', 'e.full_name', 'e.emp_code', 'p.name', 's.name'], defaultSort: '-docNo',
  columns: {
    docNo: { sql: 'd.doc_no', type: 'text', label: 'Deployment' }, revision: { sql: 'd.revision_no', type: 'number', label: 'Revision' }, person: { sql: 'COALESCE(e.full_name, lw.name)', type: 'text', label: 'Person' }, code: { sql: 'COALESCE(e.emp_code, lw.worker_code)', type: 'text', label: 'Code' },
    designation: { sql: 'g.name', type: 'text', label: 'Designation' }, project: { sql: 'p.name', type: 'text', label: 'Project' }, site: { sql: 's.name', type: 'text', label: 'Site' }, crew: { sql: 'c.name', type: 'text', label: 'Crew' },
    siteRole: { sql: 'd.site_role', type: 'text', label: 'Role on site' }, fromDate: { sql: 'd.from_date', type: 'date', label: 'From' }, toDate: { sql: 'd.to_date', type: 'date', label: 'To' },
    isPrimary: { sql: 'd.is_primary', type: 'enum', label: 'Posting', options: [['1', 'Primary'], ['0', 'Secondary']] },
    band: { sql: 'd.band', type: 'enum', label: 'Against the plan', options: [['WITHIN_PLAN', 'Within plan'], ['OUTSIDE_PLAN', 'Outside plan']] },
    when: { sql: CURRENT_SQL, type: 'enum', label: 'Now', options: [['CURRENT', 'In force'], ['UPCOMING', 'Starts later'], ['ENDED', 'Ended'], ['OPEN', 'Not approved']] },
    status: { sql: 'd.status', type: 'enum', label: 'Status', options: Object.entries(DEP_STATUS) }, updatedAt: { sql: 'COALESCE(d.updated_at, d.created_at)', type: 'datetime', label: 'Changed' },
  },
});
export const crewList = defineList({
  code: 'hr.crews', label: 'Crews and gangs', permission: 'hr.crew.view',
  from: 'hr_crews c JOIN org_sites s ON s.id = c.crew_site_id LEFT JOIN org_projects p ON p.id = s.org_project_id LEFT JOIN hr_employees sv ON sv.id = c.supervisor_id',
  where: 'c.deleted_at IS NULL', searchable: ['c.code', 'c.name', 'c.trade', 's.name', 'sv.full_name'], defaultSort: 'code',
  columns: {
    code: { sql: 'c.code', type: 'text', label: 'Code' }, name: { sql: 'c.name', type: 'text', label: 'Crew' }, trade: { sql: 'c.trade', type: 'text', label: 'Trade' }, site: { sql: 's.name', type: 'text', label: 'Site' }, project: { sql: 'p.name', type: 'text', label: 'Project' },
    supervisor: { sql: 'sv.full_name', type: 'text', label: 'Supervisor' },
    members: { sql: `(SELECT COUNT(*) FROM hr_crew_members m WHERE m.crew_id = c.id AND m.deleted_at IS NULL AND m.from_date <= ${IST_TODAY} AND (m.to_date IS NULL OR m.to_date >= ${IST_TODAY}))`, type: 'number', label: 'Members' },
    active: { sql: 'c.active', type: 'enum', label: 'Status', options: [['1', 'Active'], ['0', 'Closed']] },
  },
});

export function createDeploymentService({ db }) {
  const authz = authzOf(db);
  const notif = notificationsOf(db);
  /** With a place the right must reach it; without one the person needs it somewhere (the lists then narrow to the places it reaches). */
  const may = (actor, key, scope) => (scope ? authz.check(actor, key, { companyId: actor.companyId, ...scope }) : authz.check(actor, key)).allowed;
  const need = (actor, key, what, scope) => { if (!may(actor, key, scope)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const systemActor = (companyId) => ({ user: 'system', userId: null, companyId, roles: ['SYSADM'] });
  const orgName = (table, id) => (id ? db.prepare(`SELECT name FROM ${table} WHERE id = ?`).get(id)?.name ?? null : null);
  const nextDoc = (actor, docType, table, prefix) => {
    try { return issueNumber(db, { companyId: actor.companyId, docType, actor: actor.user, refType: table }).number; } catch (e) { if (!['DOCUMENT_TYPE_UNKNOWN', 'NUMBER_SERIES_MISSING'].includes(e?.code)) throw e; }
    const n = db.prepare(`SELECT COUNT(DISTINCT doc_no) AS n FROM ${table} WHERE company_id = ?`).get(actor.companyId).n + 1;
    let no = `${prefix}-${String(n).padStart(5, '0')}`;
    for (let k = n + 1; db.prepare(`SELECT 1 FROM ${table} WHERE company_id = ? AND doc_no = ?`).get(actor.companyId, no); k += 1) no = `${prefix}-${String(k).padStart(5, '0')}`;
    return no;
  };
  const tell = (companyId, to, what, ref, title, decision, comment, link) => to && notif.notify({ companyId, templateCode: 'hr.deploy.decided', recipients: [`user:${to}`], data: { what, ref, title, decision, comment: comment ? `: ${comment}` : '' }, link, sourceType: 'hr_deployment', sourceId: ref, eventKey: `hr.deploy.decided:${ref}:${decision}:${Date.now()}` });
  const event = (type, actor, entity, id, companyId, data, projectId = null, siteId = null) => publishEvent(db, { type, entity, entityId: id, actorId: actor.user, companyId, projectId: projectId ?? undefined, siteId: siteId ?? undefined, data });
  const grantable = (companyId) => { const l = createParameterStore(db).get('hr.deployment.grantable_roles', { companyId, date: todayIST() }); return (Array.isArray(l) ? l : []).filter((c) => ROLE_CODES.has(c)); };

  // ---- people ----
  /** The person a deployment is for. Contract workers belong to the labour register of 07.08, which is not installed yet; an employee is the only person that can be named today. */
  function personOf(companyId, type, id) {
    if (type === 'WORKER') {
      const w = db.prepare('SELECT id, name, worker_code AS code, status, worker_status FROM lab_workers WHERE id = ? AND company_id = ? AND root_id = id AND deleted_at IS NULL').get(id, companyId);
      if (!w) return { error: 'That worker does not exist.' };
      if (w.status !== 'APPROVED') return { error: 'The worker is not approved yet.' };
      if (w.worker_status !== 'ACTIVE') return { error: `The worker is ${w.worker_status.toLowerCase()}: nobody is deployed who is blacklisted or has left.` };
      return { id: w.id, type, name: w.name, code: w.code, designationId: null, userId: null };
    }
    const e = db.prepare("SELECT id, full_name, emp_code, designation_id, user_id, employment_status, record_status FROM hr_employees WHERE id = ? AND company_id = ? AND deleted_at IS NULL").get(id, companyId);
    if (!e) return { error: 'That employee does not exist.' };
    if (e.record_status !== 'APPROVED') return { error: 'The employee is not approved yet.' };
    if (!['ACTIVE', 'NOTICE'].includes(e.employment_status)) return { error: 'The employee has left; only an employee in service is deployed.' };
    return { id: e.id, type, name: e.full_name, code: e.emp_code, designationId: e.designation_id, userId: e.user_id };
  }
  const nameOf = (type, id) => (type === 'EMPLOYEE' ? db.prepare('SELECT full_name AS n, emp_code AS c FROM hr_employees WHERE id = ?').get(id) : db.prepare('SELECT name AS n, worker_code AS c FROM lab_workers WHERE id = ?').get(id));
  const usernameOf = (userId) => (userId ? db.prepare('SELECT username FROM iam_users WHERE id = ?').get(userId)?.username ?? null : null);
  const myUserId = (actor) => actor.userId ?? db.prepare('SELECT id FROM iam_users WHERE company_id = ? AND lower(username) = lower(?) AND is_active = 1').get(actor.companyId, actor.user)?.id ?? null;
  const myEmployee = (actor) => { const uid = myUserId(actor); return uid ? db.prepare("SELECT id FROM hr_employees WHERE company_id = ? AND user_id = ? AND deleted_at IS NULL AND record_status = 'APPROVED'").get(actor.companyId, uid)?.id ?? null : null; };

  // ---- the site plan (adapter for 17.08) and the check of a deployment against it ----
  const sitePlans = {
    list(actor, { siteId, projectId } = /** @type {any} */ ({})) {
      need(actor, 'hr.deployment.view', 'see the site manpower plan');
      const where = ['p.company_id = ?', 'p.deleted_at IS NULL']; const args = [actor.companyId];
      if (siteId) { where.push('p.plan_site_id = ?'); args.push(siteId); }
      if (projectId) { where.push('s.org_project_id = ?'); args.push(projectId); }
      return db.prepare(`SELECT p.*, s.name AS site_name, s.org_project_id AS project_id_of, g.name AS designation_name FROM hr_site_plans p JOIN org_sites s ON s.id = p.plan_site_id JOIN org_designations g ON g.id = p.designation_id WHERE ${where.join(' AND ')} ORDER BY s.name, g.name`).all(...args)
        .filter((p) => may(actor, 'hr.deployment.view', { projectId: p.project_id_of, siteId: p.plan_site_id }))
        .map((p) => ({ id: p.id, siteId: p.plan_site_id, site: p.site_name, designationId: p.designation_id, designation: p.designation_name, planned: p.planned, validFrom: p.valid_from, validTo: p.valid_to }));
    },
    set(actor, b) {
      const site = db.prepare('SELECT id, org_project_id AS project_id FROM org_sites WHERE id = ? AND company_id = ?').get(b.siteId, actor.companyId);
      if (!site) throw badRequest('Some fields are not valid.', [{ field: 'siteId', message: 'That site does not exist' }]);
      need(actor, 'hr.siteplan.edit', 'set the site manpower plan', { projectId: site.project_id, siteId: site.id });
      if (!db.prepare('SELECT 1 FROM org_designations WHERE id = ? AND company_id = ?').get(b.designationId, actor.companyId)) throw badRequest('Some fields are not valid.', [{ field: 'designationId', message: 'That designation does not exist' }]);
      return transaction(db, () => {
        const old = db.prepare('SELECT * FROM hr_site_plans WHERE company_id = ? AND plan_site_id = ? AND designation_id = ? AND deleted_at IS NULL AND (valid_to IS NULL OR valid_to >= ?) ORDER BY valid_from DESC LIMIT 1').get(actor.companyId, b.siteId, b.designationId, b.validFrom);
        if (old) db.prepare('UPDATE hr_site_plans SET valid_to = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(dayPlus(-1, b.validFrom), actor.user, nowIso(), old.id);
        const id = Number(db.prepare("INSERT INTO hr_site_plans (company_id, plan_site_id, designation_id, planned, valid_from, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'hr_site_plans')").run(actor.companyId, b.siteId, b.designationId, b.planned, b.validFrom, site.project_id, site.id, actor.user).lastInsertRowid);
        writeAudit(db, { entity: 'hr_site_plans', entityId: id, action: 'set', newValues: { siteId: b.siteId, designationId: b.designationId, planned: b.planned }, actor: actor.user, companyId: actor.companyId });
        return sitePlans.list(actor, { siteId: b.siteId });
      });
    },
  };
  /** People of a designation deployed (approved or waiting) at a site, or anywhere on a project, on a date: the headcount a new deployment is added to. */
  function deployedCount(companyId, { projectId, siteId, designationId, date, exceptRoot = null }) {
    const where = ["d.company_id = ?", 'd.deleted_at IS NULL', "d.status IN ('APPROVED', 'SUBMITTED')", 'd.from_date <= ?', '(d.to_date IS NULL OR d.to_date >= ?)', 'e.designation_id = ?', 'COALESCE(d.root_id, d.id) != ?'];
    const args = [companyId, date, date, designationId, exceptRoot ?? 0];
    if (siteId) { where.push('d.dep_site_id = ?'); args.push(siteId); } else { where.push('d.dep_project_id = ?'); args.push(projectId); }
    return db.prepare(`SELECT COUNT(DISTINCT d.person_id) AS n FROM hr_deployments d JOIN hr_employees e ON e.id = d.person_id AND d.person_type = 'EMPLOYEE' WHERE ${where.join(' AND ')}`).get(...args).n;
  }
  /** What the plan allows at the place on the date. Without a planned post for the designation nothing is approved, so the deployment is outside the plan (it goes to the director too). */
  function planCheck(companyId, { projectId, siteId, designationId, date, exceptRoot = null }) {
    if (!designationId) return { hasPlan: false, planned: 0, deployed: 0, headroom: 0, beyond: true, why: 'The person has no designation to check against the plan' };
    const where = ['p.company_id = ?', 'p.deleted_at IS NULL', 'p.designation_id = ?', 'p.valid_from <= ?', '(p.valid_to IS NULL OR p.valid_to >= ?)']; const args = [companyId, designationId, date, date];
    if (siteId) { where.push('p.plan_site_id = ?'); args.push(siteId); } else { where.push('p.plan_site_id IN (SELECT id FROM org_sites WHERE org_project_id = ?)'); args.push(projectId); }
    const plan = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(p.planned), 0) AS s FROM hr_site_plans p WHERE ${where.join(' AND ')}`).get(...args);
    const deployed = deployedCount(companyId, { projectId, siteId, designationId, date, exceptRoot });
    const hasPlan = plan.n > 0;
    return { hasPlan, planned: plan.s, deployed, headroom: plan.s - deployed, beyond: !hasPlan || deployed + 1 > plan.s, why: !hasPlan ? 'No planned post for this designation here' : deployed + 1 > plan.s ? 'The planned posts are full' : null };
  }

  // ---- BR-01: one primary deployment at a time ----
  function primaryClash(companyId, { personType, personId, from, to, exceptRoot = null, statuses = LIVE }) {
    return db.prepare(`SELECT d.id, d.doc_no, d.from_date, d.to_date, d.status, d.transfer_id FROM hr_deployments d WHERE d.company_id = ? AND d.person_type = ? AND d.person_id = ? AND d.is_primary = 1 AND d.deleted_at IS NULL AND d.status IN (${statuses.map((s) => `'${s}'`).join(', ')})
      AND d.from_date <= ? AND (d.to_date IS NULL OR d.to_date >= ?) AND COALESCE(d.root_id, d.id) != ? ORDER BY d.from_date LIMIT 1`).get(companyId, personType, personId, to ?? '9999-12-31', from, exceptRoot ?? 0);
  }

  // ---- deployments ----
  const root = (r) => r.root_id ?? r.id;
  const scopeOf = (r) => ({ projectId: r.dep_project_id, siteId: r.dep_site_id });
  const maker = (actor, r) => same(r.created_by, actor.user);
  const depRow = (actor, id) => {
    const r = db.prepare('SELECT * FROM hr_deployments WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId);
    const self = r && r.person_type === 'EMPLOYEE' && myEmployee(actor) === r.person_id;
    if (!r || !(may(actor, 'hr.deployment.view', scopeOf(r)) || maker(actor, r) || (self && r.status === 'APPROVED'))) throw notFound('That deployment does not exist.');
    return r;
  };
  function view(actor, r) {
    const p = nameOf(r.person_type, r.person_id);
    const plan = json(r.plan_json, {});
    const scope = scopeOf(r);
    return {
      id: r.id, docNo: r.doc_no, revision: r.revision_no, supersedesId: r.supersedes_id, docDate: r.doc_date, status: r.status, statusLabel: DEP_STATUS[r.status], rowVersion: r.version,
      personType: r.person_type, personId: r.person_id, person: p?.n ?? `Worker ${r.person_id}`, personCode: p?.c ?? null,
      designation: r.person_type === 'EMPLOYEE' ? db.prepare('SELECT g.name FROM hr_employees e LEFT JOIN org_designations g ON g.id = e.designation_id WHERE e.id = ?').get(r.person_id)?.name ?? null : null,
      projectId: r.dep_project_id, project: orgName('org_projects', r.dep_project_id), siteId: r.dep_site_id, site: orgName('org_sites', r.dep_site_id), crewId: r.crew_id, crew: orgName('hr_crews', r.crew_id),
      siteRole: r.site_role, accessRole: r.access_role, fromDate: r.from_date, toDate: r.to_date, isPrimary: r.is_primary === 1, defaultWbsId: r.default_wbs_id, defaultCostCodeId: r.default_cost_code_id,
      defaultCostCode: r.default_cost_code_id ? db.prepare('SELECT code, name FROM fin_cost_codes WHERE id = ?').get(r.default_cost_code_id) ?? null : null,
      band: r.band, plan, workflowInstanceId: r.workflow_instance_id, requestedBy: r.requested_by, createdBy: r.created_by, closedReason: r.closed_reason, transferId: r.transfer_id,
      when: r.status === 'APPROVED' ? (r.from_date > todayIST() ? 'UPCOMING' : r.to_date && r.to_date < todayIST() ? 'ENDED' : 'CURRENT') : ['CLOSED', 'SUPERSEDED'].includes(r.status) ? 'ENDED' : 'OPEN',
      can: {
        edit: ['DRAFT', 'RETURNED'].includes(r.status) && maker(actor, r) && may(actor, 'hr.deployment.edit', scope), submit: ['DRAFT', 'RETURNED'].includes(r.status) && maker(actor, r) && may(actor, 'hr.deployment.submit', scope),
        delete: r.status === 'DRAFT' && maker(actor, r) && may(actor, 'hr.deployment.delete', scope), withdraw: r.status === 'SUBMITTED' && maker(actor, r), cancel: ['SUBMITTED', 'RETURNED', 'APPROVED'].includes(r.status) && may(actor, 'hr.deployment.cancel', scope),
        amend: r.status === 'APPROVED' && may(actor, 'hr.deployment.amend', scope) && !(r.to_date && r.to_date < todayIST()), print: may(actor, 'hr.deployment.print', scope),
      },
    };
  }
  function check(actor, b, problems, { exceptRoot = null } = {}) {
    const person = personOf(actor.companyId, b.personType, b.personId);
    if (person.error) problems.push({ field: 'personId', message: person.error });
    else if (b.personType === 'WORKER') for (const g of deploymentGuards) problems.push(...g(actor.companyId, b));
    const project = db.prepare('SELECT id, status FROM org_projects WHERE id = ? AND company_id = ? AND is_active = 1').get(b.projectId, actor.companyId);
    if (!project) problems.push({ field: 'projectId', message: 'That project does not exist' });
    else if (['COMPLETED', 'CLOSED'].includes(project.status)) problems.push({ field: 'projectId', message: 'That project is closed; nobody is deployed to it' });
    const site = b.siteId ? db.prepare('SELECT id, org_project_id AS pid FROM org_sites WHERE id = ? AND company_id = ? AND is_active = 1').get(b.siteId, actor.companyId) : null;
    if (b.siteId && !site) problems.push({ field: 'siteId', message: 'That site does not exist' });
    else if (site && site.pid !== b.projectId) problems.push({ field: 'siteId', message: 'That site belongs to another project' });
    if (b.crewId) {
      const crew = db.prepare('SELECT id, crew_site_id AS sid, active FROM hr_crews WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(b.crewId, actor.companyId);
      if (!crew) problems.push({ field: 'crewId', message: 'That crew does not exist' });
      else if (!b.siteId || crew.sid !== b.siteId) problems.push({ field: 'crewId', message: 'The crew belongs to another site' });
      else if (!crew.active) problems.push({ field: 'crewId', message: 'That crew is closed' });
    }
    if (b.toDate && b.toDate < b.fromDate) problems.push({ field: 'toDate', message: 'The end date is on or after the start date' });
    if (b.accessRole) {
      if (!grantable(actor.companyId).includes(b.accessRole)) problems.push({ field: 'accessRole', message: `${b.accessRole} cannot be given by a deployment (see the parameter hr.deployment.grantable_roles)` });
      else if (person.type === 'EMPLOYEE' && !person.userId) problems.push({ field: 'accessRole', message: 'The employee has no user account yet, so there is no access to give' });
    }
    if (b.defaultCostCodeId && !db.prepare('SELECT 1 FROM fin_cost_codes WHERE id = ? AND company_id = ?').get(b.defaultCostCodeId, actor.companyId)) problems.push({ field: 'defaultCostCodeId', message: 'That cost code does not exist' });
    if (!problems.length && b.isPrimary) {
      const c = primaryClash(actor.companyId, { personType: b.personType, personId: b.personId, from: b.fromDate, to: b.toDate, exceptRoot });
      if (c) problems.push({ field: 'fromDate', message: `${person.name} already has the primary deployment ${c.doc_no} (${c.status.toLowerCase()}) from ${c.from_date}${c.to_date ? ` to ${c.to_date}` : ''}. End it, or make this a secondary posting.` });
    }
    return person;
  }
  const COLS = ['person_type', 'person_id', 'dep_project_id', 'dep_site_id', 'crew_id', 'site_role', 'access_role', 'from_date', 'to_date', 'is_primary', 'default_wbs_id', 'default_cost_code_id'];
  const colsOf = (b) => [b.personType, b.personId, b.projectId, b.siteId ?? null, b.crewId ?? null, b.siteRole ?? null, b.accessRole ?? null, b.fromDate, b.toDate ?? null, b.isPrimary ? 1 : 0, b.defaultWbsId ?? null, b.defaultCostCodeId ?? null];
  const rowToB = (r) => ({ personType: r.person_type, personId: r.person_id, projectId: r.dep_project_id, siteId: r.dep_site_id, crewId: r.crew_id, siteRole: r.site_role, accessRole: r.access_role, fromDate: r.from_date, toDate: r.to_date, isPrimary: r.is_primary === 1, defaultWbsId: r.default_wbs_id, defaultCostCodeId: r.default_cost_code_id });
  const bandOf = (companyId, r) => {
    const p = personOf(companyId, r.person_type, r.person_id);
    return planCheck(companyId, { projectId: r.dep_project_id, siteId: r.dep_site_id, designationId: p.designationId ?? null, date: r.from_date, exceptRoot: root(r) });
  };
  function history(actor, id) {
    const r = depRow(actor, id);
    const ids = db.prepare('SELECT id, workflow_instance_id FROM hr_deployments WHERE company_id = ? AND doc_no = ?').all(r.company_id, r.doc_no);
    const approvals = ids.flatMap((v) => (v.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(v.workflow_instance_id).map((h) => ({ deploymentId: v.id, ...h })) : []));
    const audit = db.prepare(`SELECT action, actor, reason, created_at AS at, entity_id FROM core_audit_log WHERE entity = 'hr_deployments' AND entity_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`).all(...ids.map((v) => String(v.id)));
    return { approvals, audit: audit.map((x) => ({ deploymentId: Number(x.entity_id), action: x.action, by: x.actor, reason: x.reason, at: x.at })) };
  }
  const deployments = {
    /** The problems a deployment would have, without saving it (the bulk import checks each row with this). */
    validate(actor, b) { const problems = []; check(actor, b, problems); return problems; },
    planCheck(actor, q) {
      need(actor, 'hr.deployment.view', 'see deployments', { projectId: q.projectId, siteId: q.siteId });
      const p = personOf(actor.companyId, 'EMPLOYEE', q.personId);
      return planCheck(actor.companyId, { projectId: q.projectId, siteId: q.siteId ?? null, designationId: p.designationId ?? null, date: q.date ?? todayIST() });
    },
    create(actor, b) {
      need(actor, 'hr.deployment.create', 'create deployments', { projectId: b.projectId, siteId: b.siteId ?? undefined });
      const problems = []; check(actor, b, problems);
      if (problems.length) throw badRequest('Some fields are not valid.', problems);
      return transaction(db, () => {
        const no = nextDoc(actor, 'HR_DEPLOYMENT', 'hr_deployments', 'DEP');
        const id = Number(db.prepare(`INSERT INTO hr_deployments (company_id, doc_no, doc_date, ${COLS.join(', ')}, status, requested_by, project_id, site_id, created_by, source_type, source_id, remarks) VALUES (?, ?, ?, ${COLS.map(() => '?').join(', ')}, 'DRAFT', ?, ?, ?, ?, ?, ?, ?)`)
          .run(actor.companyId, no, todayIST(), ...colsOf(b), actor.user, b.projectId, b.siteId ?? null, actor.user, b.sourceType ?? 'hr_deployment', b.sourceId ?? null, b.remarks ?? null).lastInsertRowid);
        db.prepare('UPDATE hr_deployments SET root_id = id WHERE id = ?').run(id);
        writeAudit(db, { entity: 'hr_deployments', entityId: id, action: 'create', newValues: { docNo: no, personId: b.personId, projectId: b.projectId, siteId: b.siteId ?? null, fromDate: b.fromDate }, actor: actor.user, companyId: actor.companyId });
        return b.submit ? deployments.submit(actor, id, { comment: b.comment }) : view(actor, depRow(actor, id));
      });
    },
    get(actor, id) { return { ...view(actor, depRow(actor, id)), history: history(actor, id) }; },
    update(actor, id, b) {
      const r = depRow(actor, id);
      need(actor, 'hr.deployment.edit', 'change deployments', scopeOf(r));
      if (!['DRAFT', 'RETURNED'].includes(r.status)) throw conflict(`A deployment that is ${DEP_STATUS[r.status].toLowerCase()} is changed by an amendment.`);
      if (!maker(actor, r)) throw forbidden(`Only ${r.created_by}, who raised this deployment, changes it.`);
      if (r.version !== b.version) throw conflict('This deployment was changed by someone else. Reload it and try again.');
      need(actor, 'hr.deployment.edit', 'move a deployment there', { projectId: b.projectId, siteId: b.siteId ?? undefined });
      const problems = []; check(actor, b, problems, { exceptRoot: root(r) });
      if (problems.length) throw badRequest('Some fields are not valid.', problems);
      db.prepare(`UPDATE hr_deployments SET ${COLS.map((c) => `${c} = ?`).join(', ')}, project_id = ?, site_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(...colsOf(b), b.projectId, b.siteId ?? null, actor.user, nowIso(), id);
      writeAudit(db, { entity: 'hr_deployments', entityId: id, action: 'update', newValues: { projectId: b.projectId, siteId: b.siteId ?? null, fromDate: b.fromDate, toDate: b.toDate ?? null }, actor: actor.user, companyId: actor.companyId });
      return view(actor, depRow(actor, id));
    },
    remove(actor, id) {
      const r = depRow(actor, id);
      need(actor, 'hr.deployment.delete', 'delete deployments', scopeOf(r));
      if (r.status !== 'DRAFT') throw new HttpError(409, 'LOCKED', 'Only a draft is deleted; cancel or amend the others.');
      if (!maker(actor, r)) throw forbidden(`Only ${r.created_by} deletes this draft.`);
      db.prepare('UPDATE hr_deployments SET deleted_at = ?, deleted_by = ?, is_active = 0, version = version + 1 WHERE id = ?').run(nowIso(), actor.user, id);
      writeAudit(db, { entity: 'hr_deployments', entityId: id, action: 'delete', actor: actor.user, companyId: actor.companyId });
      return { id, deleted: true };
    },
    submit(actor, id, { comment } = /** @type {any} */ ({})) {
      const r = depRow(actor, id);
      need(actor, 'hr.deployment.submit', 'submit deployments', scopeOf(r));
      if (!['DRAFT', 'RETURNED'].includes(r.status)) throw conflict(`This deployment is ${DEP_STATUS[r.status].toLowerCase()}.`);
      if (!maker(actor, r)) throw forbidden(`Only ${r.created_by}, who raised this deployment, submits it.`);
      return transaction(db, () => {
        // recomputed on the server at submit: the overlap rule (BR-01) and the plan may have moved since the draft
        const problems = []; check(actor, rowToB(r), problems, { exceptRoot: root(r) });
        if (problems.length) throw unprocessable(problems[0].message);
        const plan = bandOf(actor.companyId, r);
        const band = plan.beyond ? 'OUTSIDE_PLAN' : 'WITHIN_PLAN';
        const ctx = { band, projectId: r.dep_project_id, siteId: r.dep_site_id, accessRole: r.access_role ?? null };
        if (r.status === 'RETURNED') workflowOf(db).resubmit(actor, r.workflow_instance_id, { comment: comment ?? 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: DEP_DOC, docId: id, comment: comment ?? 'Deployment', context: ctx, amendsDocId: r.supersedes_id ?? null }); db.prepare('UPDATE hr_deployments SET workflow_instance_id = ? WHERE id = ?').run(inst.id, id); }
        db.prepare("UPDATE hr_deployments SET status = 'SUBMITTED', band = ?, plan_json = ?, requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(band, JSON.stringify(plan), actor.user, actor.user, nowIso(), id);
        writeAudit(db, { entity: 'hr_deployments', entityId: id, action: 'submit', newValues: { band, plan }, reason: comment ?? null, actor: actor.user, companyId: actor.companyId });
        return view(actor, depRow(actor, id));
      });
    },
    withdraw(actor, id, { reason }) {
      const r = depRow(actor, id);
      if (r.status !== 'SUBMITTED') throw unprocessable('Only a deployment in approval is withdrawn.');
      if (!maker(actor, r)) throw forbidden('Only the person who raised it withdraws it.');
      workflowOf(db).withdraw(actor, r.workflow_instance_id, { comment: reason });
      return view(actor, depRow(actor, id));
    },
    /** Cancelling an approved deployment ends it today: access goes with it. A deployment still in approval is abandoned or cancelled through the workflow. */
    cancel(actor, id, { reason }) {
      const r = depRow(actor, id);
      need(actor, 'hr.deployment.cancel', 'cancel deployments', scopeOf(r));
      if (r.status === 'APPROVED') {
        return transaction(db, () => {
          const today = todayIST();
          const endOn = r.from_date > today ? null : today;
          if (endOn) db.prepare("UPDATE hr_deployments SET status = 'CLOSED', to_date = ?, closed_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(endOn, reason, actor.user, nowIso(), id);
          else db.prepare("UPDATE hr_deployments SET status = 'CLOSED', closed_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), id);
          writeAudit(db, { entity: 'hr_deployments', entityId: id, action: 'close', reason, actor: actor.user, companyId: actor.companyId });
          announce(actor, db.prepare('SELECT * FROM hr_deployments WHERE id = ?').get(id), 'CLOSED');
          return view(actor, depRow(actor, id));
        });
      }
      if (!['SUBMITTED', 'RETURNED'].includes(r.status)) throw unprocessable('Only a deployment in approval, returned or approved is cancelled; delete a draft.');
      if (maker(actor, r)) transaction(db, () => { workflowOf(db).abandon(actor.companyId, r.workflow_instance_id, actor.user, 'CANCELLED', reason); decisions.deployment({ docId: r.id, status: 'CANCELLED' }, actor, 'CANCELLED', reason); });
      else workflowOf(db).cancel(actor, r.workflow_instance_id, { reason });
      return view(actor, depRow(actor, id));
    },
    /** An approved deployment is locked: an amendment is a new revision with the same number, approved again; the approved one stays in force until then. `changes` are applied to the new draft. */
    amend(actor, id, { reason, changes = null }) {
      const r = depRow(actor, id);
      need(actor, 'hr.deployment.amend', 'amend deployments', scopeOf(r));
      if (r.status !== 'APPROVED') throw unprocessable('Only an approved deployment is amended.');
      if (db.prepare("SELECT 1 FROM hr_deployments WHERE company_id = ? AND doc_no = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL").get(r.company_id, r.doc_no)) throw new HttpError(409, 'PENDING_CHANGE', `An amendment of ${r.doc_no} is already open.`);
      return transaction(db, () => {
        const b = { ...rowToB(r), ...(changes ?? {}) };
        const problems = []; check(actor, b, problems, { exceptRoot: root(r) });
        if (problems.length) throw badRequest('Some fields are not valid.', problems);
        const rev = db.prepare('SELECT MAX(revision_no) AS v FROM hr_deployments WHERE company_id = ? AND doc_no = ?').get(r.company_id, r.doc_no).v + 1;
        const nid = Number(db.prepare(`INSERT INTO hr_deployments (company_id, doc_no, revision_no, root_id, supersedes_id, doc_date, ${COLS.join(', ')}, status, requested_by, project_id, site_id, created_by, source_type, source_id, remarks, transfer_id) VALUES (?, ?, ?, ?, ?, ?, ${COLS.map(() => '?').join(', ')}, 'DRAFT', ?, ?, ?, ?, 'hr_deployment', ?, ?, ?)`)
          .run(r.company_id, r.doc_no, rev, root(r), r.id, todayIST(), ...colsOf(b), actor.user, b.projectId, b.siteId ?? null, actor.user, String(r.id), reason, r.transfer_id).lastInsertRowid);
        writeAudit(db, { entity: 'hr_deployments', entityId: nid, action: 'amend', newValues: { from: r.id, revision: rev }, reason, actor: actor.user, companyId: actor.companyId });
        return view(actor, depRow(actor, nid));
      });
    },
    /** FR-04, drag on the board: moving a person to another crew of the site is an amendment sent for approval at once; the approved deployment stays in force until it is approved. */
    move(actor, id, { crewId, comment }) {
      const r = depRow(actor, id);
      need(actor, 'hr.deployment.amend', 'reassign people', scopeOf(r));
      return transaction(db, () => {
        const a = deployments.amend(actor, id, { reason: comment ?? 'Reassigned on the deployment board', changes: { crewId: crewId ?? null } });
        return deployments.submit(actor, a.id, { comment: comment ?? 'Reassigned on the deployment board' });
      });
    },
    compare(actor, id) {
      const r = depRow(actor, id);
      if (!r.supersedes_id) throw unprocessable('This is the first revision.');
      const a = view(actor, depRow(actor, r.supersedes_id)); const b = view(actor, r);
      return { from: { id: a.id, revision: a.revision }, to: { id: b.id, revision: b.revision }, rows: [['project', 'Project'], ['site', 'Site'], ['crew', 'Crew'], ['siteRole', 'Role on site'], ['accessRole', 'Site access role'], ['fromDate', 'From'], ['toDate', 'To'], ['isPrimary', 'Primary']].map(([k, label]) => ({ field: k, label, before: a[k], after: b[k], changed: String(a[k]) !== String(b[k]) })) };
    },
    print(actor, id) {
      const r = depRow(actor, id);
      need(actor, 'hr.deployment.print', 'print deployments', scopeOf(r));
      const v = view(actor, r);
      writeAudit(db, { entity: 'hr_deployments', entityId: id, action: 'print', actor: actor.user, companyId: actor.companyId });
      const e = (s) => String(s ?? '—').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
      const rows = [['Person', `${v.person} (${v.personCode ?? ''})`], ['Designation', v.designation], ['Project', v.project], ['Site', v.site], ['Crew', v.crew], ['Role on site', v.siteRole], ['Site access role', v.accessRole], ['From', v.fromDate], ['To', v.toDate ?? 'open'], ['Posting', v.isPrimary ? 'Primary' : 'Secondary'], ['Against the plan', v.band === 'OUTSIDE_PLAN' ? 'Outside plan' : 'Within plan'], ['Status', v.statusLabel]];
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${e(v.docNo)}</title><style>body{font:12px system-ui,sans-serif;margin:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:4px;text-align:left}th{width:30%}</style></head><body><h2>Deployment ${e(v.docNo)} (revision ${v.revision})</h2><table>${rows.map(([k, x]) => `<tr><th>${e(k)}</th><td>${e(x)}</td></tr>`).join('')}</table></body></html>`;
    },
    /** FR-06: everything a person was ever deployed to, newest first, with the transfers behind it. An employee sees their own approved postings. */
    historyOf(actor, personId, personType = 'EMPLOYEE') {
      const self = personType === 'EMPLOYEE' && myEmployee(actor) === personId;
      const rows = db.prepare("SELECT * FROM hr_deployments WHERE company_id = ? AND person_type = ? AND person_id = ? AND deleted_at IS NULL AND status != 'SUPERSEDED' ORDER BY from_date DESC, id DESC").all(actor.companyId, personType, personId)
        .filter((r) => (self ? r.status === 'APPROVED' || may(actor, 'hr.deployment.view', scopeOf(r)) : may(actor, 'hr.deployment.view', scopeOf(r))));
      if (!rows.length && !self && !may(actor, 'hr.deployment.view')) throw forbidden('You may not see deployments (permission hr.deployment.view).');
      return rows.map((r) => { const v = view(actor, r); return { id: v.id, docNo: v.docNo, revision: v.revision, project: v.project, site: v.site, crew: v.crew, siteRole: v.siteRole, isPrimary: v.isPrimary, fromDate: v.fromDate, toDate: v.toDate, status: v.status, statusLabel: v.statusLabel, when: v.when, transferId: v.transferId }; });
    },
  };

  // ---- effects of a decision: the lock, the access and the events ----
  function who(r) { const e = r.person_type === 'EMPLOYEE' ? db.prepare('SELECT full_name, emp_code, user_id FROM hr_employees WHERE id = ?').get(r.person_id) : null; return { name: e?.full_name ?? null, code: e?.emp_code ?? null, userId: e?.user_id ?? null }; }
  /** Publishes hr.deployment.changed (geofence eligibility, site permissions, messaging groups, labour costing, resource planning) and drops the cached access of everyone. */
  function announce(actor, r, change) {
    const p = who(r);
    event('hr.deployment.changed', actor, 'hr_deployment', r.id, r.company_id, {
      change, docNo: r.doc_no, revision: r.revision_no, personType: r.person_type, personId: r.person_id, employeeId: r.person_type === 'EMPLOYEE' ? r.person_id : null, userId: p.userId, projectId: r.dep_project_id, siteId: r.dep_site_id, crewId: r.crew_id,
      siteRole: r.site_role, accessRole: r.access_role, isPrimary: r.is_primary === 1, fromDate: r.from_date, toDate: r.to_date, transferId: r.transfer_id ?? null,
    }, r.dep_project_id, r.dep_site_id);
    authz.invalidate();
    const mark = change === 'STARTED' ? 'activated_at' : change === 'ENDED' || change === 'CLOSED' ? 'ended_event_at' : null;
    if (mark) db.prepare(`UPDATE hr_deployments SET ${mark} = COALESCE(${mark}, ?) WHERE id = ?`).run(nowIso(), r.id);
    const tellTo = usernameOf(p.userId);
    if (tellTo && ['STARTED'].includes(change)) notif.notify({ companyId: r.company_id, templateCode: 'hr.deploy.posted', recipients: [`user:${tellTo}`], data: { place: [orgName('org_sites', r.dep_site_id), orgName('org_projects', r.dep_project_id)].filter(Boolean).join(', '), name: p.name ?? '', from: r.from_date }, link: `/hr/deployments/deployment?id=${r.id}`, sourceType: 'hr_deployment', sourceId: r.doc_no, eventKey: `hr.deploy.posted:${r.doc_no}:${r.revision_no}` });
  }
  const decisions = {
    deployment(instance, actor, outcome, comment) {
      const r = db.prepare('SELECT * FROM hr_deployments WHERE id = ?').get(Number(instance.docId));
      if (!r || !['SUBMITTED', 'RETURNED'].includes(r.status)) return;
      const now = nowIso();
      if (outcome === 'APPROVED') {
        // the primary clash is checked again against what is in force: another deployment may have been approved while this one waited
        if (r.is_primary === 1) {
          const c = primaryClash(r.company_id, { personType: r.person_type, personId: r.person_id, from: r.from_date, to: r.to_date, exceptRoot: root(r), statuses: ['APPROVED'] });
          if (c) throw unprocessable(`The person already has the primary deployment ${c.doc_no} in force from ${c.from_date}${c.to_date ? ` to ${c.to_date}` : ''}: end it first or reject this one.`);
        }
        if (r.supersedes_id) db.prepare("UPDATE hr_deployments SET status = 'SUPERSEDED', version = version + 1 WHERE id = ? AND status = 'APPROVED'").run(r.supersedes_id);
        db.prepare("UPDATE hr_deployments SET status = 'APPROVED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, r.id);
        const fresh = db.prepare('SELECT * FROM hr_deployments WHERE id = ?').get(r.id);
        const started = r.from_date <= todayIST();
        announce(actor, fresh, r.supersedes_id ? 'AMENDED' : started ? 'STARTED' : 'APPROVED');
        if (started) db.prepare('UPDATE hr_deployments SET activated_at = COALESCE(activated_at, ?) WHERE id = ?').run(now, r.id);
      } else {
        const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN';
        db.prepare('UPDATE hr_deployments SET status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED', actor.user, now, r.id);
        if (withdrawn) db.prepare('UPDATE hr_deployments SET workflow_instance_id = NULL WHERE id = ?').run(r.id);
      }
      writeAudit(db, { entity: 'hr_deployments', entityId: r.id, action: outcome.toLowerCase(), reason: comment ?? null, actor: actor.user, companyId: r.company_id });
      tell(r.company_id, r.requested_by ?? r.created_by, 'Deployment', r.doc_no, who(r).name ?? '', outcome === 'RETURNED' ? 'returned for correction' : outcome === 'APPROVED' ? 'approved' : outcome === 'REJECTED' ? 'rejected' : 'cancelled', comment, `/hr/deployments/deployment?id=${r.id}`);
    },
  };

  // ---- crews and gangs (FR-03) ----
  const siteOf = (companyId, id) => db.prepare('SELECT id, org_project_id AS project_id, name FROM org_sites WHERE id = ? AND company_id = ?').get(id, companyId);
  const crewRow = (actor, id) => {
    const c = db.prepare('SELECT * FROM hr_crews WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId);
    const s = c && siteOf(actor.companyId, c.crew_site_id);
    if (!c || !s || !may(actor, 'hr.crew.view', { projectId: s.project_id, siteId: s.id })) throw notFound('That crew does not exist.');
    return c;
  };
  const crewScope = (actor, c) => { const s = siteOf(actor.companyId, c.crew_site_id); return { projectId: s.project_id, siteId: s.id }; };
  /** A site supervisor keeps the members of their own crews; anyone with crew edit keeps any crew within their scope. */
  const mayKeepMembers = (actor, c) => may(actor, 'hr.crew.edit', crewScope(actor, c)) || (may(actor, 'hr.crew.members', crewScope(actor, c)) && c.supervisor_id != null && c.supervisor_id === myEmployee(actor));
  function crewView(actor, c) {
    const s = siteOf(actor.companyId, c.crew_site_id);
    const today = todayIST();
    const members = db.prepare("SELECT m.*, e.full_name, e.emp_code, g.name AS designation FROM hr_crew_members m LEFT JOIN hr_employees e ON e.id = m.person_id AND m.person_type = 'EMPLOYEE' LEFT JOIN org_designations g ON g.id = e.designation_id WHERE m.crew_id = ? AND m.deleted_at IS NULL ORDER BY (m.to_date IS NOT NULL AND m.to_date < ?), e.full_name").all(c.id, today);
    return {
      id: c.id, code: c.code, name: c.name, trade: c.trade, siteId: c.crew_site_id, site: s?.name ?? null, projectId: s?.project_id ?? null, project: orgName('org_projects', s?.project_id), supervisorId: c.supervisor_id, supervisor: nameOf('EMPLOYEE', c.supervisor_id)?.n ?? null,
      labourContractorId: c.labour_contractor_id, active: c.active === 1, rowVersion: c.version,
      members: members.map((m) => ({ id: m.id, personType: m.person_type, personId: m.person_id, name: m.full_name ?? `Worker ${m.person_id}`, code: m.emp_code ?? null, designation: m.designation ?? null, fromDate: m.from_date, toDate: m.to_date, current: m.from_date <= today && (!m.to_date || m.to_date >= today) })),
      can: { edit: may(actor, 'hr.crew.edit', { projectId: s?.project_id, siteId: s?.id }), members: mayKeepMembers(actor, c) },
    };
  }
  function checkCrew(actor, b, problems, exceptId = null) {
    const s = siteOf(actor.companyId, b.siteId);
    if (!s) problems.push({ field: 'siteId', message: 'That site does not exist' });
    if (db.prepare('SELECT 1 FROM hr_crews WHERE company_id = ? AND code = ? AND deleted_at IS NULL AND id != ?').get(actor.companyId, b.code, exceptId ?? 0)) problems.push({ field: 'code', message: `The crew code ${b.code} is already used` });
    if (b.supervisorId) {
      const sv = db.prepare("SELECT 1 FROM hr_employees WHERE id = ? AND company_id = ? AND record_status = 'APPROVED' AND employment_status IN ('ACTIVE', 'NOTICE') AND deleted_at IS NULL").get(b.supervisorId, actor.companyId);
      if (!sv) problems.push({ field: 'supervisorId', message: 'The supervisor must be an employee in service' });
    }
    return s;
  }
  const crews = {
    list(actor, query) {
      need(actor, 'hr.crew.view', 'see crews');
      const scope = authz.scopeFilter(actor, 'hr.crew.view', { project: 's.org_project_id', site: 'c.crew_site_id' }).sql;
      return runList(db, crewList, parseListRequest(crewList, query), { select: 'c.*, s.name AS site_name, p.name AS project_name, sv.full_name AS supervisor_name', scopeSql: `c.company_id = :c AND ${scope}`, params: { c: actor.companyId }, tieBreaker: 'c.id', map: (c) => ({ id: c.id, code: c.code, name: c.name, trade: c.trade, siteId: c.crew_site_id, site: c.site_name, project: c.project_name, supervisor: c.supervisor_name, members: db.prepare(`SELECT COUNT(*) AS n FROM hr_crew_members m WHERE m.crew_id = ? AND m.deleted_at IS NULL AND m.from_date <= ${IST_TODAY} AND (m.to_date IS NULL OR m.to_date >= ${IST_TODAY})`).get(c.id).n, active: c.active === 1 }) });
    },
    get(actor, id) { return crewView(actor, crewRow(actor, id)); },
    create(actor, b) {
      const s = siteOf(actor.companyId, b.siteId);
      need(actor, 'hr.crew.edit', 'keep crews', { projectId: s?.project_id, siteId: s?.id });
      const problems = []; checkCrew(actor, b, problems);
      if (problems.length) throw badRequest('Some fields are not valid.', problems);
      const id = Number(db.prepare("INSERT INTO hr_crews (company_id, crew_site_id, code, name, trade, supervisor_id, labour_contractor_id, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'hr_crew')")
        .run(actor.companyId, b.siteId, b.code, b.name, b.trade ?? null, b.supervisorId ?? null, b.labourContractorId ?? null, s.project_id, s.id, actor.user).lastInsertRowid);
      writeAudit(db, { entity: 'hr_crews', entityId: id, action: 'create', newValues: { code: b.code, siteId: b.siteId, supervisorId: b.supervisorId ?? null }, actor: actor.user, companyId: actor.companyId });
      return crews.get(actor, id);
    },
    update(actor, id, b) {
      const c = crewRow(actor, id);
      need(actor, 'hr.crew.edit', 'keep crews', crewScope(actor, c));
      if (c.version !== b.version) throw conflict('This crew was changed by someone else. Reload it and try again.');
      if (b.siteId !== c.crew_site_id) throw unprocessable('A crew stays at its site; close it and make another.');
      const problems = []; checkCrew(actor, b, problems, id);
      if (problems.length) throw badRequest('Some fields are not valid.', problems);
      db.prepare('UPDATE hr_crews SET code = ?, name = ?, trade = ?, supervisor_id = ?, labour_contractor_id = ?, active = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?')
        .run(b.code, b.name, b.trade ?? null, b.supervisorId ?? null, b.labourContractorId ?? null, b.active === false ? 0 : 1, actor.user, nowIso(), id);
      if (b.active === false) db.prepare('UPDATE hr_crew_members SET to_date = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE crew_id = ? AND deleted_at IS NULL AND (to_date IS NULL OR to_date > ?)').run(todayIST(), actor.user, nowIso(), id, todayIST());
      writeAudit(db, { entity: 'hr_crews', entityId: id, action: 'update', newValues: { name: b.name, supervisorId: b.supervisorId ?? null, active: b.active !== false }, actor: actor.user, companyId: actor.companyId });
      return crews.get(actor, id);
    },
    addMember(actor, id, b) {
      const c = crewRow(actor, id);
      if (!mayKeepMembers(actor, c)) throw forbidden('Only the crew supervisor, or someone who keeps crews, changes its members.');
      if (!c.active) throw unprocessable('That crew is closed.');
      const person = personOf(actor.companyId, b.personType, b.personId);
      if (person.error) throw badRequest('Some fields are not valid.', [{ field: 'personId', message: person.error }]);
      // BR-02: a person is in a crew of a site only while deployed there
      const eligible = deployments.eligibility(actor.companyId, { personType: b.personType, personId: b.personId, siteId: c.crew_site_id, date: b.fromDate });
      if (!eligible.eligible) throw unprocessable(`${person.name} is not deployed at this site on ${b.fromDate}; deploy them first.`);
      const clash = db.prepare("SELECT m.id, c.name FROM hr_crew_members m JOIN hr_crews c ON c.id = m.crew_id WHERE m.company_id = ? AND m.person_type = ? AND m.person_id = ? AND m.deleted_at IS NULL AND m.from_date <= ? AND (m.to_date IS NULL OR m.to_date >= ?) LIMIT 1").get(actor.companyId, b.personType, b.personId, b.toDate ?? '9999-12-31', b.fromDate);
      if (clash) throw unprocessable(`${person.name} is already in the crew ${clash.name} on those dates; end that membership first.`);
      const mid = Number(db.prepare("INSERT INTO hr_crew_members (company_id, crew_id, person_type, person_id, from_date, to_date, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'hr_crew')").run(actor.companyId, id, b.personType, b.personId, b.fromDate, b.toDate ?? null, crewScope(actor, c).projectId, c.crew_site_id, actor.user).lastInsertRowid);
      writeAudit(db, { entity: 'hr_crews', entityId: id, action: 'member.add', newValues: { memberId: mid, personId: b.personId, fromDate: b.fromDate }, actor: actor.user, companyId: actor.companyId });
      return crews.get(actor, id);
    },
    endMember(actor, id, memberId, { toDate }) {
      const c = crewRow(actor, id);
      if (!mayKeepMembers(actor, c)) throw forbidden('Only the crew supervisor, or someone who keeps crews, changes its members.');
      const m = db.prepare('SELECT * FROM hr_crew_members WHERE id = ? AND crew_id = ? AND deleted_at IS NULL').get(memberId, id);
      if (!m) throw notFound('That member is not in this crew.');
      if (toDate < m.from_date) throw badRequest('Some fields are not valid.', [{ field: 'toDate', message: 'The end date is on or after the day the member joined' }]);
      db.prepare('UPDATE hr_crew_members SET to_date = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(toDate, actor.user, nowIso(), memberId);
      writeAudit(db, { entity: 'hr_crews', entityId: id, action: 'member.end', newValues: { memberId, toDate }, actor: actor.user, companyId: actor.companyId });
      return crews.get(actor, id);
    },
    exportSource(actor, req) {
      need(actor, 'hr.deployment.export', 'export crews');
      const scope = authz.scopeFilter(actor, 'hr.crew.view', { project: 's.org_project_id', site: 'c.crew_site_id' }).sql;
      const opts = { select: 'c.*', scopeSql: `c.company_id = :c AND ${scope}`, params: { c: actor.companyId }, tieBreaker: 'c.id' };
      return { title: crewList.label, permission: 'hr.deployment.export', personal: false, columns: Object.entries(crewList.columns).map(([key, c]) => ({ key, label: c.label, type: c.type === 'enum' ? 'text' : c.type })), count: () => countList(db, crewList, req, opts), rows: () => runList(db, crewList, req, { ...opts, limit: null }).data, describe: () => '' };
    },
  };

  // ---- BR-02: attendance needs a deployment that covers the date ----
  deployments.eligibility = (companyId, { personType = 'EMPLOYEE', personId, siteId, date = todayIST() }) => {
    const d = db.prepare("SELECT d.* FROM hr_deployments d WHERE d.company_id = ? AND d.person_type = ? AND d.person_id = ? AND d.status = 'APPROVED' AND d.deleted_at IS NULL AND d.from_date <= ? AND (d.to_date IS NULL OR d.to_date >= ?) AND (d.dep_site_id = ? OR (d.dep_site_id IS NULL AND d.dep_project_id = (SELECT org_project_id FROM org_sites WHERE id = ?))) ORDER BY d.is_primary DESC, d.id LIMIT 1").get(companyId, personType, personId, date, date, siteId, siteId);
    return d ? { eligible: true, deploymentId: d.id, docNo: d.doc_no, isPrimary: d.is_primary === 1, crewId: d.crew_id, reason: null } : { eligible: false, deploymentId: null, reason: 'No approved deployment covers this site on that date (an approved visit is the other way in; visits arrive with attendance, part 07.05).' };
  };
  deployments.eligible = (actor, q) => { need(actor, 'hr.deployment.view', 'check deployments', { siteId: q.siteId }); return deployments.eligibility(actor.companyId, q); };

  // ---- FR-04: the deployment board ----
  const registerScope = (actor) => `d.company_id = :c AND ${authz.scopeFilter(actor, 'hr.deployment.view', { project: 'd.project_id', site: 'd.site_id' }).sql}`;
  const deploymentSelect = 'd.*, e.full_name AS person_name, e.emp_code AS person_code, g.name AS designation_name, p.name AS project_name, s.name AS site_name, c.name AS crew_name';
  const present = () => (d) => ({ id: d.id, docNo: d.doc_no, revision: d.revision_no, person: d.person_name ?? `Worker ${d.person_id}`, code: d.person_code, designation: d.designation_name, project: d.project_name, site: d.site_name, crew: d.crew_name, siteRole: d.site_role, fromDate: d.from_date, toDate: d.to_date, isPrimary: d.is_primary === 1, band: d.band, status: d.status, statusLabel: DEP_STATUS[d.status] });
  const register = {
    list(actor, query) { need(actor, 'hr.deployment.view', 'see deployments'); return runList(db, deploymentList, parseListRequest(deploymentList, query), { select: deploymentSelect, scopeSql: registerScope(actor), params: { c: actor.companyId }, tieBreaker: 'd.id', map: present() }); },
    exportSource(actor, req) {
      need(actor, 'hr.deployment.export', 'export deployments');
      const opts = { select: deploymentSelect, scopeSql: registerScope(actor), params: { c: actor.companyId }, tieBreaker: 'd.id' };
      return { title: deploymentList.label, permission: 'hr.deployment.export', personal: false, columns: Object.entries(deploymentList.columns).map(([key, c]) => ({ key, label: c.label, type: c.type === 'enum' ? 'text' : c.type })), count: () => countList(db, deploymentList, req, opts), rows: () => runList(db, deploymentList, req, { ...opts, limit: null, map: present() }).data, describe: (x) => [x.q ? `search "${x.q}"` : '', ...x.filters.map((f) => `${deploymentList.columns[f.key].label} ${f.op} ${f.raw}`)].filter(Boolean).join('; ') };
    },
  };
  const board = {
    /** Per site: the people in force on the date grouped by crew, and the count of each designation against the plan. A person in two postings shows in both. */
    get(actor, { date = todayIST(), projectId = null, siteId = null } = {}) {
      need(actor, 'hr.deployment.view', 'see the deployment board');
      const scope = authz.scopeFilter(actor, 'hr.deployment.view', { project: 's.org_project_id', site: 's.id' }).sql;
      const where = ['s.company_id = ?', "s.status = 'ACTIVE'", 's.is_active = 1', scope]; const args = [actor.companyId];
      if (projectId) { where.push('s.org_project_id = ?'); args.push(projectId); }
      if (siteId) { where.push('s.id = ?'); args.push(siteId); }
      const sites = db.prepare(`SELECT s.id, s.code, s.name, s.org_project_id AS project_id, p.name AS project FROM org_sites s JOIN org_projects p ON p.id = s.org_project_id WHERE ${where.join(' AND ')} ORDER BY p.name, s.name LIMIT 200`).all(...args);
      return {
        date, canMove: may(actor, 'hr.deployment.amend'), sites: sites.map((s) => {
          const people = db.prepare(`SELECT q.*, c.name AS crew, c.trade FROM (
              SELECT d.id, d.doc_no, d.person_id, d.person_type, d.site_role, d.is_primary, d.from_date, d.to_date, COALESCE(e.full_name, w.name) AS full_name, COALESCE(e.emp_code, w.worker_code) AS emp_code, e.designation_id, g.name AS designation,
                COALESCE(d.crew_id, (SELECT m.crew_id FROM hr_crew_members m JOIN hr_crews k ON k.id = m.crew_id WHERE m.person_type = d.person_type AND m.person_id = d.person_id AND k.crew_site_id = d.dep_site_id AND m.deleted_at IS NULL AND m.from_date <= @d AND (m.to_date IS NULL OR m.to_date >= @d) LIMIT 1)) AS crew_id,
                EXISTS (SELECT 1 FROM hr_deployments x WHERE x.supersedes_id = d.id AND x.status IN ('SUBMITTED', 'DRAFT', 'RETURNED') AND x.deleted_at IS NULL) AS pending
              FROM hr_deployments d LEFT JOIN hr_employees e ON e.id = d.person_id AND d.person_type = 'EMPLOYEE' LEFT JOIN lab_workers w ON w.id = d.person_id AND d.person_type = 'WORKER' LEFT JOIN org_designations g ON g.id = e.designation_id
              WHERE d.company_id = @c AND d.dep_site_id = @s AND d.status = 'APPROVED' AND d.deleted_at IS NULL AND d.from_date <= @d AND (d.to_date IS NULL OR d.to_date >= @d)) q
            LEFT JOIN hr_crews c ON c.id = q.crew_id ORDER BY c.name, q.designation, q.full_name`).all({ c: actor.companyId, s: s.id, d: date });
          const groups = new Map();
          for (const x of people) {
            const key = x.crew_id ?? 0;
            if (!groups.has(key)) groups.set(key, { crewId: x.crew_id, crew: x.crew ?? 'No crew', trade: x.trade ?? null, supervisor: x.crew_id ? nameOf('EMPLOYEE', db.prepare('SELECT supervisor_id FROM hr_crews WHERE id = ?').get(x.crew_id)?.supervisor_id)?.n ?? null : null, people: [] });
            groups.get(key).people.push({ deploymentId: x.id, docNo: x.doc_no, personId: x.person_id, name: x.full_name ?? `Worker ${x.person_id}`, code: x.emp_code, designation: x.designation, siteRole: x.site_role, isPrimary: x.is_primary === 1, fromDate: x.from_date, toDate: x.to_date, pendingChange: x.pending > 0 });
          }
          const planned = db.prepare('SELECT p.designation_id, g.name, p.planned FROM hr_site_plans p JOIN org_designations g ON g.id = p.designation_id WHERE p.company_id = ? AND p.plan_site_id = ? AND p.deleted_at IS NULL AND p.valid_from <= ? AND (p.valid_to IS NULL OR p.valid_to >= ?)').all(actor.companyId, s.id, date, date);
          const byDes = new Map(planned.map((p) => [p.designation_id, { designationId: p.designation_id, designation: p.name, planned: p.planned, deployed: 0 }]));
          for (const x of people) { const k = x.designation_id ?? 0; if (!byDes.has(k)) byDes.set(k, { designationId: x.designation_id, designation: x.designation ?? 'Not set', planned: 0, deployed: 0 }); byDes.get(k).deployed += 1; }
          const counts = [...byDes.values()].map((c) => ({ ...c, gap: c.planned - c.deployed })).sort((a, b) => a.designation.localeCompare(b.designation));
          const waiting = db.prepare("SELECT COUNT(*) AS n FROM hr_deployments WHERE company_id = ? AND dep_site_id = ? AND status = 'SUBMITTED' AND deleted_at IS NULL").get(actor.companyId, s.id).n;
          return { id: s.id, code: s.code, name: s.name, projectId: s.project_id, project: s.project, deployed: people.length, planned: counts.reduce((a, c) => a + c.planned, 0), waiting, counts, groups: [...groups.values()].sort((a, b) => Number(a.crewId == null) - Number(b.crewId == null) || a.crew.localeCompare(b.crew)), crews: db.prepare('SELECT id, code, name FROM hr_crews WHERE crew_site_id = ? AND active = 1 AND deleted_at IS NULL ORDER BY name').all(s.id) };
        }),
      };
    },
    print(actor, q) {
      const b = board.get(actor, q);
      const e = (s) => String(s ?? '—').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
      writeAudit(db, { entity: 'hr_deployments', entityId: 0, action: 'print_board', newValues: { date: b.date }, actor: actor.user, companyId: actor.companyId });
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Deployment board ${e(b.date)}</title><style>body{font:12px system-ui,sans-serif;margin:24px}table{border-collapse:collapse;width:100%;margin-bottom:16px}td,th{border:1px solid #999;padding:4px;text-align:left}</style></head><body><h2>Deployment board as on ${e(b.date)}</h2>${b.sites.map((s) => `<h3>${e(s.project)} / ${e(s.name)}: ${s.deployed} deployed of ${s.planned} planned</h3><table><tr><th>Crew</th><th>Name</th><th>Code</th><th>Designation</th><th>Role on site</th></tr>${s.groups.flatMap((g) => g.people.map((p) => `<tr><td>${e(g.crew)}</td><td>${e(p.name)}</td><td>${e(p.code)}</td><td>${e(p.designation)}</td><td>${e(p.siteRole)}</td></tr>`)).join('')}</table>`).join('')}</body></html>`;
    },
  };

  // ---- the daily cycle: deployments that start or end today change access and messaging groups on their day ----
  function cycle(companyId) {
    const out = { started: 0, ended: 0, endingSoon: 0 };
    const today = todayIST();
    const actor = systemActor(companyId);
    transaction(db, () => {
      for (const r of db.prepare("SELECT * FROM hr_deployments WHERE company_id = ? AND status = 'APPROVED' AND deleted_at IS NULL AND activated_at IS NULL AND from_date <= ?").all(companyId, today)) {
        if (r.to_date && r.to_date < today) { db.prepare('UPDATE hr_deployments SET activated_at = ?, ended_event_at = ? WHERE id = ?').run(nowIso(), nowIso(), r.id); continue; }
        announce(actor, r, 'STARTED'); db.prepare('UPDATE hr_deployments SET activated_at = COALESCE(activated_at, ?) WHERE id = ?').run(nowIso(), r.id); out.started += 1;
      }
      for (const r of db.prepare("SELECT * FROM hr_deployments WHERE company_id = ? AND status IN ('APPROVED', 'CLOSED') AND deleted_at IS NULL AND activated_at IS NOT NULL AND ended_event_at IS NULL AND to_date IS NOT NULL AND to_date < ?").all(companyId, today)) { announce(actor, r, 'ENDED'); out.ended += 1; }
      const days = Number(createParameterStore(db).get('hr.deployment.notice_days', { companyId, date: today }));
      for (const r of db.prepare("SELECT * FROM hr_deployments WHERE company_id = ? AND status = 'APPROVED' AND deleted_at IS NULL AND to_date IS NOT NULL AND to_date >= ? AND to_date <= ?").all(companyId, today, dayPlus(days, today))) {
        const mgr = db.prepare("SELECT u.username FROM org_assignments a JOIN iam_users u ON u.id = a.user_id WHERE a.company_id = ? AND a.entity_type = 'PROJECT' AND a.entity_id = ? AND a.role = 'PROJECT_MANAGER' AND a.applied = 1 AND (a.effective_to IS NULL OR a.effective_to >= ?) LIMIT 1").get(companyId, r.dep_project_id, today)?.username;
        if (mgr) { tell(companyId, mgr, 'Deployment', r.doc_no, `${who(r).name ?? ''} ends on ${r.to_date}`, 'ending soon', null, `/hr/deployments/deployment?id=${r.id}`); out.endingSoon += 1; }
      }
    });
    return out;
  }

  /** Counts for the dashboard widget: people deployed today on the sites the viewer sees, and those waiting for a posting. */
  function widget(actor) {
    if (!may(actor, 'hr.deployment.view')) return { value: 0 };
    const scope = authz.scopeFilter(actor, 'hr.deployment.view', { project: 'd.project_id', site: 'd.site_id' }).sql;
    const n = db.prepare(`SELECT COUNT(DISTINCT d.person_id) AS n FROM hr_deployments d WHERE d.company_id = ? AND d.status = 'APPROVED' AND d.deleted_at IS NULL AND d.from_date <= ? AND (d.to_date IS NULL OR d.to_date >= ?) AND ${scope}`).get(actor.companyId, todayIST(), todayIST()).n;
    return { value: n };
  }

  return { sitePlans, planCheck, deployments, register, board, crews, cycle, decisions, widget, personOf, primaryClash, announce, view, depRow, nextDoc, tell, event, may, need, systemActor, usernameOf, myEmployee, orgName, rowToB, colsOf, COLS, check, root, grantable };
}

const services = new WeakMap();
export const bindDeployments = (db, s) => services.set(db, s);
export const deploymentsOf = (db) => services.get(db) ?? null;

// ---- what an approved deployment gives the rest of the ERP (FR-05) ----
// the permission engine reads a person's holdings through this source: an approved deployment that covers today gives the access role at the site (or the project when it names no site)
grantSources.register('hr.deployment', (db, { companyId, userId, today }) => {
  const rows = db.prepare("SELECT d.id, d.doc_no, d.access_role, d.dep_project_id, d.dep_site_id FROM hr_deployments d JOIN hr_employees e ON e.id = d.person_id AND d.person_type = 'EMPLOYEE' WHERE d.company_id = ? AND e.user_id = ? AND e.deleted_at IS NULL AND e.employment_status IN ('ACTIVE', 'NOTICE') AND d.status = 'APPROVED' AND d.deleted_at IS NULL AND d.access_role IS NOT NULL AND d.from_date <= ? AND (d.to_date IS NULL OR d.to_date >= ?)").all(companyId, userId, today, today);
  return rows.map((d) => ({ roleCode: d.access_role, scopeType: d.dep_site_id ? 'SITE' : 'PROJECT', scopeIds: [d.dep_site_id ?? d.dep_project_id], via: 'deployment', ref: d.doc_no }));
});
// the messaging groups of a site or project ask who holds a role there
holderSourcesOf.register('hr.deployment', (db, { companyId, roles, scope, today }) => {
  if (!roles?.length || !['SITE', 'PROJECT'].includes(scope.type)) return [];
  const where = scope.type === 'SITE' ? '(d.dep_site_id = ? OR (d.dep_site_id IS NULL AND d.dep_project_id = ?))' : 'd.dep_project_id = ?';
  const args = scope.type === 'SITE' ? [scope.id, scope.projectId ?? 0] : [scope.id];
  return db.prepare(`SELECT DISTINCT u.username FROM hr_deployments d JOIN hr_employees e ON e.id = d.person_id AND d.person_type = 'EMPLOYEE' JOIN iam_users u ON u.id = e.user_id WHERE d.company_id = ? AND d.status = 'APPROVED' AND d.deleted_at IS NULL AND d.access_role IN (${roles.map(() => '?').join(',')}) AND d.from_date <= ? AND (d.to_date IS NULL OR d.to_date >= ?) AND e.employment_status IN ('ACTIVE', 'NOTICE') AND u.is_active = 1 AND u.status = 'ACTIVE' AND ${where}`)
    .all(companyId, ...roles, today, today, ...args).map((r) => r.username);
});

const step = (code, name, approvers, when = null) => ({ code, name, type: 'approval', mode: 'single', approvers, slaHours: 48, requireAttachment: false, checklist: [], when, notify: [], action: null });
const role = (...roles) => roles.map((r) => ({ kind: 'role', role: r }));
workflowTypes.register({
  docType: DEP_DOC, label: 'Deployment', processOwner: 'HRMGR', route: (id) => `/hr/deployments/deployment?id=${id}`,
  describe(db, companyId, id) {
    const r = db.prepare('SELECT d.doc_no, d.revision_no, d.requested_by, d.created_by, d.dep_project_id, d.dep_site_id, e.full_name FROM hr_deployments d LEFT JOIN hr_employees e ON e.id = d.person_id AND d.person_type = \'EMPLOYEE\' WHERE d.id = ? AND d.company_id = ?').get(Number(id), companyId);
    return r ? { ref: `${r.doc_no}/r${r.revision_no}`, title: `${r.full_name ?? 'Worker'} deployed`, originator: r.requested_by ?? r.created_by, projectId: r.dep_project_id, siteId: r.dep_site_id } : null;
  },
  summarise(db, _actor, id) {
    const r = db.prepare('SELECT d.*, e.full_name, e.emp_code FROM hr_deployments d LEFT JOIN hr_employees e ON e.id = d.person_id AND d.person_type = \'EMPLOYEE\' WHERE d.id = ?').get(Number(id)); if (!r) return null;
    const n = (t, i) => (i ? db.prepare(`SELECT name FROM ${t} WHERE id = ?`).get(i)?.name ?? '—' : '—');
    return { fields: [{ label: 'Deployment', value: `${r.doc_no} revision ${r.revision_no}` }, { label: 'Person', value: `${r.full_name ?? 'Worker'} (${r.emp_code ?? ''})` }, { label: 'Project / site', value: `${n('org_projects', r.dep_project_id)} / ${n('org_sites', r.dep_site_id)}` }, { label: 'Crew', value: n('hr_crews', r.crew_id) }, { label: 'Role on site', value: r.site_role ?? '—' }, { label: 'Dates', value: `${r.from_date} to ${r.to_date ?? 'open'}` }, { label: 'Site access role', value: r.access_role ?? 'none' }] };
  },
  defaultDefinition: { name: 'Deployment: project manager, and the project director when outside the plan', settings: { resubmit: 'first', distinctApprovers: true, matrix: true }, steps: [step('PM', 'Project manager', role('PM', 'HRMGR')), step('PD', 'Project director (outside the plan)', role('PD'), { field: 'band', op: 'eq', value: 'OUTSIDE_PLAN' })] },
  hooks: {
    onApproved: (db, { instance, actor }) => deploymentsOf(db)?.decisions.deployment(instance, actor, 'APPROVED'),
    onRejected: (db, { instance, actor, comment }) => deploymentsOf(db)?.decisions.deployment(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => deploymentsOf(db)?.decisions.deployment(instance, actor, 'RETURNED', comment),
    onCancelled: (db, { instance, actor, comment }) => deploymentsOf(db)?.decisions.deployment(instance, actor, 'CANCELLED', comment),
  },
});
evidenceProviders.register(DEP_DOC, ({ db, instance }) => {
  const r = db.prepare('SELECT * FROM hr_deployments WHERE id = ?').get(Number(instance.docId)); if (!r) return { sections: [] };
  const p = json(r.plan_json, {});
  const other = db.prepare("SELECT d.doc_no, d.from_date, d.to_date FROM hr_deployments d WHERE d.company_id = ? AND d.person_type = ? AND d.person_id = ? AND d.status = 'APPROVED' AND d.deleted_at IS NULL AND d.id != ? AND d.from_date <= ? AND (d.to_date IS NULL OR d.to_date >= ?) AND COALESCE(d.root_id, d.id) != ?").all(r.company_id, r.person_type, r.person_id, r.id, r.to_date ?? '9999-12-31', r.from_date, r.root_id ?? r.id);
  return { sections: [{ code: 'hr-deployment', title: 'Before approving', kind: 'metrics', items: [
    { label: 'Planned posts / already deployed', value: `${p.planned ?? 'no plan'} / ${p.deployed ?? 0}`, format: 'text', tone: r.band === 'OUTSIDE_PLAN' ? 'warn' : undefined },
    { label: 'Against the plan', value: r.band === 'OUTSIDE_PLAN' ? `Outside plan${p.why ? `: ${p.why}` : ''}` : 'Within plan', format: 'text', tone: r.band === 'OUTSIDE_PLAN' ? 'warn' : undefined },
    { label: 'Other postings in force in these dates', value: other.length ? other.map((o) => `${o.doc_no} (${o.from_date} to ${o.to_date ?? 'open'})`).join(', ') : 'None', format: 'text' },
    { label: 'Site access given', value: r.access_role ? `${r.access_role} at the ${r.dep_site_id ? 'site' : 'project'}` : 'None', format: 'text', tone: r.access_role ? 'warn' : undefined },
  ] }] };
});
objectTypes.register({
  type: 'hr_deployment', label: 'Deployment', permission: 'hr.deployment.view', route: (id) => `/hr/deployments/deployment?id=${id}`,
  access(db, actor, id) { const s = deploymentsOf(db); if (!s) return null; try { const r = s.deployments.get(actor, Number(id)); return { companyId: actor.companyId, projectId: r.projectId ?? null, siteId: r.siteId ?? null, status: r.status }; } catch { return null; } },
  auditEntities: (id) => [{ entity: 'hr_deployments', id }],
  summary(db, actor, id) { const s = deploymentsOf(db); if (!s) return null; try { const r = s.deployments.get(actor, Number(id)); return { label: `${r.docNo} ${r.person}`, status: r.status }; } catch { return null; } },
  search(db, actor, q, limit) { if (!authzOf(db).check(actor, 'hr.deployment.view').allowed) return []; return db.prepare("SELECT d.id FROM hr_deployments d LEFT JOIN hr_employees e ON e.id = d.person_id AND d.person_type = 'EMPLOYEE' WHERE d.company_id = ? AND d.deleted_at IS NULL AND d.status != 'SUPERSEDED' AND (d.doc_no LIKE ? OR e.full_name LIKE ?) ORDER BY d.id DESC LIMIT ?").all(actor.companyId, `%${q}%`, `%${q}%`, limit).map((r) => r.id); },
});
objectTypes.register({
  type: 'hr_crew', label: 'Crew', permission: 'hr.crew.view', route: (id) => `/hr/crews/crew?id=${id}`,
  access(db, actor, id) { const s = deploymentsOf(db); if (!s) return null; try { const c = s.crews.get(actor, Number(id)); return { companyId: actor.companyId, projectId: c.projectId ?? null, siteId: c.siteId ?? null, status: c.active ? 'ACTIVE' : 'CLOSED' }; } catch { return null; } },
  auditEntities: (id) => [{ entity: 'hr_crews', id }],
  summary(db, actor, id) { const s = deploymentsOf(db); if (!s) return null; try { const c = s.crews.get(actor, Number(id)); return { label: `${c.code} ${c.name}`, status: c.active ? 'ACTIVE' : 'CLOSED' }; } catch { return null; } },
  search(db, actor, q, limit) { if (!authzOf(db).check(actor, 'hr.crew.view').allowed) return []; return db.prepare("SELECT id FROM hr_crews WHERE company_id = ? AND deleted_at IS NULL AND (code LIKE ? OR name LIKE ?) ORDER BY id DESC LIMIT ?").all(actor.companyId, `%${q}%`, `%${q}%`, limit).map((r) => r.id); },
});
void workflowResolvers;

// FR-06: the deployment history on Employee 360 (a related tab of the employee master): the postings in force and past, newest first, each opening its deployment.
employeeRelated.register({
  code: 'deployments', label: 'Deployments',
  summary(db, companyId, e) {
    const rows = db.prepare("SELECT d.id, d.doc_no, d.from_date, d.to_date, d.is_primary, p.name AS project, s.name AS site FROM hr_deployments d LEFT JOIN org_projects p ON p.id = d.dep_project_id LEFT JOIN org_sites s ON s.id = d.dep_site_id WHERE d.company_id = ? AND d.person_type = 'EMPLOYEE' AND d.person_id = ? AND d.status = 'APPROVED' AND d.deleted_at IS NULL ORDER BY d.from_date DESC, d.id DESC LIMIT 20").all(companyId, e.id);
    return rows.map((d) => ({ label: `${d.doc_no} · ${[d.project, d.site].filter(Boolean).join(' / ')}${d.is_primary ? '' : ' (secondary)'}`, value: `${d.from_date} to ${d.to_date ?? 'open'}`, route: `/hr/deployments/deployment?id=${d.id}` }));
  },
});
