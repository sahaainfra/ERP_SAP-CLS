import { createHash, randomBytes } from 'node:crypto';
import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { fileEntities } from '../../platform/files/entities.js';
import { HttpError, badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { createVault } from '../../platform/integrations/vault.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { FORMATS, mask, nameKey } from '../../platform/mdm/index.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { objectTypes } from '../../platform/objects/index.js';
import { createParameterStore, parameterRegistry } from '../../platform/parameters/index.js';
import { tasksOf } from '../../platform/tasks/index.js';
import { evidenceProviders, workflowOf, workflowTypes } from '../../platform/workflow/index.js';
import { fromUnits, toUnits } from '../../../shared/money.js';
import { todayIST } from '../../../shared/dates.js';
import { issueNumber } from '../core/numbering/service.js';
import { employeesOf } from './employees.js';

// Recruitment, manpower requisition and onboarding (part 07.02). A manpower requisition (hiring manager) is checked against the approved headcount plan (the adapter for 17.08: `hr_headcount_plans`) and approved by
// the department or project head, then the HR manager, and the director when it is beyond the plan (BR-01). Candidates move through the pipeline (Applied, Screened, Interview, Selected, Offered, Accepted, Joined,
// Rejected) with the source tracked; interviews have a panel whose members give scored feedback. An offer has its CTC breakup computed here (once, on the server), goes to the HR manager and, above the requisition's
// range or for a senior grade, the director (BR-02); it is sent as a link the candidate accepts, and the same link takes the pre-joining details (FR-05). A joined candidate becomes an employee through the
// employee master (07.01), prefilled with everything captured, sent for its own approval (FR-07), and the joining checklist is given to the departments as tasks (04.08). The personal data of a rejected
// candidate is removed after the retention period (BR-03).
export const REQ_DOC = 'HR_REQUISITION';
export const OFFER_DOC = 'HR_OFFER';
export const STAGE_LABELS = { APPLIED: 'Applied', SCREENED: 'Screened', INTERVIEW: 'Interview', SELECTED: 'Selected', OFFERED: 'Offered', ACCEPTED: 'Accepted', JOINED: 'Joined', REJECTED: 'Rejected' };
export const SOURCE_LABELS = { REFERRAL: 'Referral', PORTAL: 'Job portal', AGENCY: 'Agency', WALK_IN: 'Walk-in' };
export const REQ_STATUS = { DRAFT: 'Draft', SUBMITTED: 'Waiting for approval', APPROVED: 'Approved', RETURNED: 'Returned for correction', REJECTED: 'Rejected', CANCELLED: 'Cancelled', CLOSED: 'Closed', SUPERSEDED: 'Superseded' };
const FORWARD = { APPLIED: ['SCREENED'], SCREENED: ['INTERVIEW'], INTERVIEW: ['SELECTED'], SELECTED: [], OFFERED: [], ACCEPTED: [], JOINED: [], REJECTED: [] };
const BACK = { SCREENED: 'APPLIED', INTERVIEW: 'SCREENED', SELECTED: 'INTERVIEW' };
const nowIso = () => new Date().toISOString();
const dayPlus = (n, from = todayIST()) => new Date(Date.parse(`${from}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const json = (s, d) => { try { return JSON.parse(s ?? ''); } catch { return d; } };
const sha = (v) => createHash('sha256').update(v).digest('hex');
const rs = (u) => (u == null ? null : fromUnits(u, 'money').toFixed(2));
const units = (v) => (v == null ? null : toUnits(v, 'money'));

for (const [key, dataType, def, description, extra] of [
  ['hr.candidate.retention_months', 'integer', 12, 'BR-03: months a rejected candidate\'s personal data is kept before it is removed (DPDP Act purpose limitation).', { min: 1, max: 60 }],
  ['hr.offer.validity_days', 'integer', 7, 'Days an offer link stays open when the offer does not say.', { min: 1, max: 60 }],
  ['hr.offer.breakup', 'json', { basicPct: 40, hraPctOfBasic: 50, pfEmployerPct: 12, pfWageCapMonthly: 15000, gratuityPct: 4.81 }, 'FR-04: how a CTC is broken up: basic as a percentage of CTC, HRA as a percentage of basic, the employer PF and its monthly wage cap, gratuity as a percentage of basic; the rest is the special allowance.', {}],
  ['hr.onboarding.checklist', 'json', [
    { code: 'IT_ACCESS', title: 'IT access and e-mail', role: 'ITADM', dueDays: -1 }, { code: 'ID_CARD', title: 'ID card', role: 'HRMGR', dueDays: 0 }, { code: 'PPE_ISSUE', title: 'PPE issue', role: 'HSEO', dueDays: 0 },
    { code: 'INDUCTION', title: 'Induction and safety briefing', role: 'HSEO', dueDays: 2 }, { code: 'BANK_DETAILS', title: 'Bank details for salary', role: 'PAY', dueDays: 3 }, { code: 'STATUTORY_FORMS', title: 'Statutory forms (PF, ESI, nomination)', role: 'HRMGR', dueDays: 3 }], 'FR-06: the joining checklist: each task, the role that does it and its due date in days from the date of joining.', {}],
  ['hr.onboarding.require_clearance', 'boolean', true, 'Whether a candidate joins only when the background verification is clear and the medical fitness is fit.', {}],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType, default: def, scopes: ['system', 'company'], description, .../** @type {any} */ (extra) });

export const requisitionList = defineList({
  code: 'hr.requisitions', label: 'Manpower requisitions', permission: 'hr.requisition.view',
  from: 'hr_requisitions r LEFT JOIN org_departments d ON d.id = r.department_id LEFT JOIN org_designations g ON g.id = r.designation_id LEFT JOIN org_projects p ON p.id = r.project_id',
  where: "r.deleted_at IS NULL AND r.status != 'SUPERSEDED'", searchable: ['r.doc_no', 'd.name', 'g.name'], defaultSort: '-docNo',
  columns: {
    docNo: { sql: 'r.doc_no', type: 'text', label: 'Requisition' }, revision: { sql: 'r.revision_no', type: 'number', label: 'Revision' }, department: { sql: 'd.name', type: 'text', label: 'Department' }, designation: { sql: 'g.name', type: 'text', label: 'Designation' }, project: { sql: 'p.name', type: 'text', label: 'Project' },
    positions: { sql: 'r.positions', type: 'number', label: 'Positions' }, filled: { sql: "(SELECT COUNT(*) FROM hr_candidates c WHERE c.requisition_id = COALESCE(r.root_id, r.id) AND c.stage = 'JOINED' AND c.deleted_at IS NULL)", type: 'number', label: 'Joined', sortable: false },
    reason: { sql: 'r.reason', type: 'enum', label: 'Reason', options: [['NEW', 'New position'], ['REPLACEMENT', 'Replacement']] }, ctcMin: { sql: 'r.ctc_min', type: 'number', label: 'CTC from', sensitive: true }, ctcMax: { sql: 'r.ctc_max', type: 'number', label: 'CTC to', sensitive: true },
    requiredBy: { sql: 'r.required_by', type: 'date', label: 'Required by' }, band: { sql: 'r.band', type: 'enum', label: 'Against the plan', options: [['WITHIN_PLAN', 'Within plan'], ['BEYOND_PLAN', 'Beyond plan']] },
    status: { sql: 'r.status', type: 'enum', label: 'Status', options: Object.entries(REQ_STATUS) }, requestedBy: { sql: 'COALESCE(r.requested_by, r.created_by)', type: 'text', label: 'Raised by' }, updatedAt: { sql: 'COALESCE(r.updated_at, r.created_at)', type: 'datetime', label: 'Changed' },
  },
});
export const offerList = defineList({
  code: 'hr.offers', label: 'Offers', permission: 'hr.offer.view',
  from: 'hr_offers o JOIN hr_candidates c ON c.id = o.candidate_id LEFT JOIN org_designations g ON g.id = o.designation_id', where: "o.deleted_at IS NULL AND o.status != 'SUPERSEDED'", searchable: ['o.doc_no', 'c.full_name'], defaultSort: '-docNo',
  columns: {
    docNo: { sql: 'o.doc_no', type: 'text', label: 'Offer' }, candidate: { sql: 'c.full_name', type: 'text', label: 'Candidate' }, designation: { sql: 'g.name', type: 'text', label: 'Designation' }, grade: { sql: 'o.grade', type: 'text', label: 'Grade' },
    ctcAnnual: { sql: 'o.ctc_annual', type: 'number', label: 'CTC a year', sensitive: true }, dojProposed: { sql: 'o.doj_proposed', type: 'date', label: 'Joining' }, band: { sql: 'o.band', type: 'enum', label: 'Approval', options: [['STANDARD', 'HR manager'], ['DIR', 'HR manager and director']] },
    status: { sql: 'o.status', type: 'enum', label: 'Status', options: Object.entries(REQ_STATUS) }, response: { sql: 'o.response', type: 'enum', label: 'Candidate', options: [['NONE', 'No answer'], ['ACCEPTED', 'Accepted'], ['DECLINED', 'Declined'], ['EXPIRED', 'Expired']] },
    updatedAt: { sql: 'COALESCE(o.updated_at, o.created_at)', type: 'datetime', label: 'Changed' },
  },
});

export function createRecruitmentService({ db, vaultKey, baseUrl }) {
  const authz = authzOf(db);
  const notif = notificationsOf(db);
  const vault = createVault({ secret: vaultKey ?? undefined });
  const param = (key, companyId) => createParameterStore(db).get(key, { companyId, date: todayIST() });
  const may = (actor, key) => authz.check(actor, key).allowed;
  const need = (actor, key, what) => { if (!may(actor, key)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
  const systemActor = (companyId) => ({ user: 'system', userId: null, companyId, roles: ['SYSADM'] });
  const slot = (companyId, id) => `hr_candidate/${companyId}/${id}`;
  const orgName = (table, id) => (id ? db.prepare(`SELECT name FROM ${table} WHERE id = ?`).get(id)?.name ?? null : null);
  const nextDoc = (actor, docType, table, prefix) => {
    try { return issueNumber(db, { companyId: actor.companyId, docType, actor: actor.user, refType: table }).number; } catch (e) { if (!['DOCUMENT_TYPE_UNKNOWN', 'NUMBER_SERIES_MISSING'].includes(e?.code)) throw e; }
    const n = db.prepare(`SELECT COUNT(DISTINCT doc_no) AS n FROM ${table} WHERE company_id = ?`).get(actor.companyId).n + 1;
    let no = `${prefix}-${String(n).padStart(5, '0')}`;
    for (let k = n + 1; db.prepare(`SELECT 1 FROM ${table} WHERE company_id = ? AND doc_no = ?`).get(actor.companyId, no); k += 1) no = `${prefix}-${String(k).padStart(5, '0')}`;
    return no;
  };
  const tell = (companyId, to, what, ref, title, decision, comment, link) => to && notif.notify({ companyId, templateCode: 'hr.recruit.decided', recipients: [`user:${to}`], data: { what, ref, title, decision, comment: comment ? `: ${comment}` : '' }, link, sourceType: 'hr_recruit', sourceId: ref, eventKey: `hr.recruit.decided:${ref}:${decision}:${Date.now()}` });
  const event = (type, actor, entity, id, companyId, data, projectId = null) => publishEvent(db, { type, entity, entityId: id, actorId: actor.user, companyId, projectId: projectId ?? undefined, data });

  // ---- the headcount plan (adapter for 17.08) and the check of a requisition against it (BR-01) ----
  const plans = {
    list(actor) { need(actor, 'hr.requisition.view_all', 'see the headcount plan'); return db.prepare("SELECT p.*, d.name AS department, g.name AS designation FROM hr_headcount_plans p JOIN org_departments d ON d.id = p.department_id LEFT JOIN org_designations g ON g.id = p.designation_id WHERE p.company_id = ? AND p.deleted_at IS NULL ORDER BY d.name, g.name").all(actor.companyId).map((p) => ({ id: p.id, departmentId: p.department_id, department: p.department, designationId: p.designation_id, designation: p.designation, projectId: p.project_id, approvedPositions: p.approved_positions, validFrom: p.valid_from, validTo: p.valid_to })); },
    set(actor, b) {
      need(actor, 'hr.plan.edit', 'set the headcount plan');
      if (!db.prepare('SELECT 1 FROM org_departments WHERE id = ? AND company_id = ?').get(b.departmentId, actor.companyId)) throw badRequest('Some fields are not valid.', [{ field: 'departmentId', message: 'Choose a department of your company' }]);
      if (b.designationId && !db.prepare('SELECT 1 FROM org_designations WHERE id = ? AND company_id = ?').get(b.designationId, actor.companyId)) throw badRequest('Some fields are not valid.', [{ field: 'designationId', message: 'Choose a designation of your company' }]);
      return transaction(db, () => {
        const old = db.prepare('SELECT * FROM hr_headcount_plans WHERE company_id = ? AND department_id = ? AND COALESCE(designation_id, 0) = ? AND COALESCE(project_id, 0) = ? AND deleted_at IS NULL AND valid_to IS NULL').get(actor.companyId, b.departmentId, b.designationId ?? 0, b.projectId ?? 0);
        if (old) db.prepare('UPDATE hr_headcount_plans SET valid_to = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(dayPlus(-1, b.validFrom), actor.user, nowIso(), old.id);
        const id = Number(db.prepare("INSERT INTO hr_headcount_plans (company_id, department_id, designation_id, project_id, approved_positions, valid_from, valid_to, created_by, remarks, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'hr_plan')").run(actor.companyId, b.departmentId, b.designationId ?? null, b.projectId ?? null, b.approvedPositions, b.validFrom, b.validTo ?? null, actor.user, b.reason).lastInsertRowid);
        writeAudit(db, { entity: 'hr_headcount_plans', entityId: id, action: 'set', newValues: { departmentId: b.departmentId, designationId: b.designationId, approvedPositions: b.approvedPositions }, oldValues: old ? { approvedPositions: old.approved_positions } : null, reason: b.reason, actor: actor.user, companyId: actor.companyId });
        return plans.list(actor);
      });
    },
  };
  /** What the plan allows and what is already used: the people in post, the open positions of other requisitions and this one (BR-01). Without a plan for the department nothing is approved, so it is beyond the plan. */
  function planCheck(companyId, { departmentId, designationId, projectId = null, positions, exceptRoot = null }) {
    const today = todayIST();
    const live = "p.company_id = ? AND p.department_id = ? AND p.deleted_at IS NULL AND p.valid_from <= ? AND (p.valid_to IS NULL OR p.valid_to >= ?) AND (p.project_id IS NULL OR p.project_id = ?)";
    const args = [companyId, departmentId, today, today, projectId ?? 0];
    const specific = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(p.approved_positions), 0) AS s FROM hr_headcount_plans p WHERE ${live} AND p.designation_id = ?`).get(...args, designationId);
    const general = db.prepare(`SELECT COALESCE(SUM(p.approved_positions), 0) AS s, COUNT(*) AS n FROM hr_headcount_plans p WHERE ${live} AND p.designation_id IS NULL`).get(...args);
    const hasPlan = specific.n > 0 || general.n > 0;
    const planned = specific.n > 0 ? specific.s : general.s;
    const scopeSql = specific.n > 0 ? 'AND designation_id = ?' : '';
    const filled = db.prepare(`SELECT COUNT(*) AS n FROM hr_employees WHERE company_id = ? AND department_id = ? ${scopeSql} AND record_status IN ('APPROVED', 'SUBMITTED') AND employment_status IN ('ACTIVE', 'NOTICE') AND deleted_at IS NULL`).get(...[companyId, departmentId, ...(specific.n > 0 ? [designationId] : [])]).n;
    const open = db.prepare(`SELECT r.id, r.positions, COALESCE(r.root_id, r.id) AS root FROM hr_requisitions r WHERE r.company_id = ? AND r.department_id = ? ${specific.n > 0 ? 'AND r.designation_id = ?' : ''} AND r.status IN ('APPROVED', 'SUBMITTED') AND r.deleted_at IS NULL`).all(...[companyId, departmentId, ...(specific.n > 0 ? [designationId] : [])])
      .filter((r) => r.root !== exceptRoot).reduce((a, r) => a + Math.max(0, r.positions - db.prepare("SELECT COUNT(*) AS n FROM hr_candidates WHERE requisition_id = ? AND stage = 'JOINED' AND deleted_at IS NULL").get(r.root).n), 0);
    const used = filled + open;
    return { hasPlan, planned, filled, open, requested: positions, headroom: planned - used, beyond: !hasPlan || used + positions > planned };
  }

  // ---- manpower requisitions (FR-01) ----
  const root = (r) => r.root_id ?? r.id;
  const joinedOf = (r) => db.prepare("SELECT COUNT(*) AS n FROM hr_candidates WHERE requisition_id = ? AND stage = 'JOINED' AND deleted_at IS NULL").get(root(r)).n;
  const canSeeAllReq = (actor) => may(actor, 'hr.requisition.view_all');
  const reqRow = (actor, id) => {
    const r = db.prepare('SELECT * FROM hr_requisitions WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId);
    if (!r || !(canSeeAllReq(actor) || same(r.created_by, actor.user) || same(r.requested_by, actor.user)) || !may(actor, 'hr.requisition.view')) throw notFound('That requisition does not exist.');
    return r;
  };
  const maker = (actor, r) => same(r.created_by, actor.user);
  function reqView(actor, r) {
    const joined = joinedOf(r);
    const all = canSeeAllReq(actor) || maker(actor, r);
    const stages = Object.fromEntries(db.prepare("SELECT stage, COUNT(*) AS n FROM hr_candidates WHERE requisition_id = ? AND deleted_at IS NULL GROUP BY stage").all(root(r)).map((x) => [x.stage, x.n]));
    return { id: r.id, rootId: root(r), docNo: r.doc_no, revision: r.revision_no, docDate: r.doc_date, departmentId: r.department_id, department: orgName('org_departments', r.department_id), designationId: r.designation_id, designation: orgName('org_designations', r.designation_id), projectId: r.project_id, project: orgName('org_projects', r.project_id),
      siteId: r.site_id, positions: r.positions, joined, open: Math.max(0, r.positions - joined), reason: r.reason, replacesEmployeeId: r.replaces_employee_id, employmentType: r.employment_type, locationType: r.location_type, managerId: r.manager_id, manager: r.manager_id ? db.prepare('SELECT emp_code, full_name FROM hr_employees WHERE id = ?').get(r.manager_id) : null,
      ctcMin: all ? rs(r.ctc_min) : null, ctcMax: all ? rs(r.ctc_max) : null, requiredBy: r.required_by, justification: r.justification, plan: json(r.plan_json, {}), band: r.band, status: r.status, statusLabel: REQ_STATUS[r.status], instanceId: r.workflow_instance_id, requestedBy: r.requested_by ?? r.created_by, createdBy: r.created_by, rowVersion: r.version, candidates: stages,
      supersedes: r.supersedes_id, canEdit: ['DRAFT', 'RETURNED'].includes(r.status) && may(actor, 'hr.requisition.edit') && maker(actor, r), canSubmit: ['DRAFT', 'RETURNED'].includes(r.status) && may(actor, 'hr.requisition.submit') && maker(actor, r), canDelete: r.status === 'DRAFT' && may(actor, 'hr.requisition.delete') && maker(actor, r),
      canWithdraw: r.status === 'SUBMITTED' && maker(actor, r), canCancel: ['SUBMITTED', 'RETURNED', 'APPROVED'].includes(r.status) && may(actor, 'hr.requisition.cancel'), canAmend: r.status === 'APPROVED' && may(actor, 'hr.requisition.amend'), canPrint: may(actor, 'hr.requisition.print') };
  }
  function checkReq(actor, b, problems) {
    const own = (t, v, f, what) => { if (v != null && !db.prepare(`SELECT 1 FROM ${t} WHERE id = ? AND company_id = ? AND is_active = 1`).get(v, actor.companyId)) problems.push({ field: f, message: `${what} does not exist in your company` }); };
    own('org_departments', b.departmentId, 'departmentId', 'That department'); own('org_designations', b.designationId, 'designationId', 'That designation'); own('org_projects', b.projectId, 'projectId', 'That project'); own('org_sites', b.siteId, 'siteId', 'That site');
    if (b.managerId != null && !db.prepare("SELECT 1 FROM hr_employees WHERE id = ? AND company_id = ? AND record_status = 'APPROVED' AND deleted_at IS NULL").get(b.managerId, actor.companyId)) problems.push({ field: 'managerId', message: 'The manager must be an approved employee' });
    if (b.reason === 'REPLACEMENT' && !b.replacesEmployeeId) problems.push({ field: 'replacesEmployeeId', message: 'Name the employee who is replaced' });
    if (b.replacesEmployeeId && !db.prepare("SELECT 1 FROM hr_employees WHERE id = ? AND company_id = ? AND deleted_at IS NULL").get(b.replacesEmployeeId, actor.companyId)) problems.push({ field: 'replacesEmployeeId', message: 'That employee does not exist' });
    if (b.reason === 'NEW' && b.replacesEmployeeId) problems.push({ field: 'replacesEmployeeId', message: 'Only a replacement names the employee replaced' });
    if (Number(b.ctcMax) < Number(b.ctcMin)) problems.push({ field: 'ctcMax', message: 'The upper end of the CTC range is not below the lower end' });
    if (b.requiredBy < todayIST()) problems.push({ field: 'requiredBy', message: 'The required date is today or later' });
    if (b.locationType === 'SITE' && !b.siteId && !b.projectId) problems.push({ field: 'siteId', message: 'Choose the site or the project of a site position' });
  }
  const reqCols = (b) => [b.departmentId, b.designationId, b.projectId ?? null, b.siteId ?? null, b.positions, b.reason, b.replacesEmployeeId ?? null, b.employmentType, b.locationType, b.managerId ?? null, units(b.ctcMin), units(b.ctcMax), b.requiredBy, b.justification ?? null];
  const REQ_SET = 'department_id = ?, designation_id = ?, project_id = ?, site_id = ?, positions = ?, reason = ?, replaces_employee_id = ?, employment_type = ?, location_type = ?, manager_id = ?, ctc_min = ?, ctc_max = ?, required_by = ?, justification = ?';
  const requisitions = {
    planCheck(actor, q) { need(actor, 'hr.requisition.view', 'see requisitions'); return planCheck(actor.companyId, { ...q, exceptRoot: q.requisitionId ? root(reqRow(actor, q.requisitionId)) : null }); },
    create(actor, b) {
      need(actor, 'hr.requisition.create', 'raise requisitions');
      const problems = []; checkReq(actor, b, problems);
      if (problems.length) throw badRequest('Some fields are not valid.', problems);
      return transaction(db, () => {
        const no = nextDoc(actor, 'HR_REQUISITION', 'hr_requisitions', 'REQ');
        const id = Number(db.prepare(`INSERT INTO hr_requisitions (company_id, doc_no, doc_date, ${REQ_SET.replace(/ = \?/g, '')}, status, requested_by, created_by, source_type) VALUES (?, ?, ?, ${reqCols(b).map(() => '?').join(', ')}, 'DRAFT', ?, ?, 'hr_requisition')`).run(actor.companyId, no, todayIST(), ...reqCols(b), actor.user, actor.user).lastInsertRowid);
        writeAudit(db, { entity: 'hr_requisitions', entityId: id, action: 'create', newValues: { docNo: no, departmentId: b.departmentId, designationId: b.designationId, positions: b.positions }, actor: actor.user, companyId: actor.companyId });
        return b.submit ? requisitions.submit(actor, id, { comment: b.comment }) : reqView(actor, reqRow(actor, id));
      });
    },
    get(actor, id) { return { ...reqView(actor, reqRow(actor, id)), history: reqHistory(actor, id) }; },
    update(actor, id, b) {
      need(actor, 'hr.requisition.edit', 'change requisitions');
      const r = reqRow(actor, id);
      if (!['DRAFT', 'RETURNED'].includes(r.status)) throw conflict(`A requisition that is ${REQ_STATUS[r.status].toLowerCase()} is changed by an amendment.`);
      if (!maker(actor, r)) throw forbidden(`Only ${r.created_by}, who raised this requisition, changes it.`);
      if (r.version !== b.version) throw conflict('This requisition was changed by someone else. Reload it and try again.');
      const problems = []; checkReq(actor, b, problems);
      if (problems.length) throw badRequest('Some fields are not valid.', problems);
      db.prepare(`UPDATE hr_requisitions SET ${REQ_SET}, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(...reqCols(b), actor.user, nowIso(), id);
      writeAudit(db, { entity: 'hr_requisitions', entityId: id, action: 'update', newValues: { positions: b.positions }, actor: actor.user, companyId: actor.companyId });
      return reqView(actor, reqRow(actor, id));
    },
    remove(actor, id) {
      need(actor, 'hr.requisition.delete', 'delete requisitions');
      const r = reqRow(actor, id);
      if (r.status !== 'DRAFT') throw new HttpError(409, 'LOCKED', 'Only a draft is deleted; cancel or amend the others.');
      if (!maker(actor, r)) throw forbidden(`Only ${r.created_by} deletes this draft.`);
      db.prepare('UPDATE hr_requisitions SET deleted_at = ?, deleted_by = ?, is_active = 0, version = version + 1 WHERE id = ?').run(nowIso(), actor.user, id);
      writeAudit(db, { entity: 'hr_requisitions', entityId: id, action: 'delete', actor: actor.user, companyId: actor.companyId });
      return { id, deleted: true };
    },
    submit(actor, id, { comment } = /** @type {any} */ ({})) {
      need(actor, 'hr.requisition.submit', 'submit requisitions');
      const r = reqRow(actor, id);
      if (!['DRAFT', 'RETURNED'].includes(r.status)) throw conflict(`This requisition is ${REQ_STATUS[r.status].toLowerCase()}.`);
      if (!maker(actor, r)) throw forbidden(`Only ${r.created_by}, who raised this requisition, submits it.`);
      return transaction(db, () => {
        // recomputed on the server at submit (BR-01): the plan may have moved since the draft
        const plan = planCheck(actor.companyId, { departmentId: r.department_id, designationId: r.designation_id, projectId: r.project_id, positions: r.positions, exceptRoot: root(r) });
        const band = plan.beyond ? 'BEYOND_PLAN' : 'WITHIN_PLAN';
        const ctx = { band, projectId: r.project_id };
        if (r.status === 'RETURNED') workflowOf(db).resubmit(actor, r.workflow_instance_id, { comment: comment ?? 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: REQ_DOC, docId: id, comment: comment ?? 'Manpower requisition', context: ctx, amendsDocId: r.supersedes_id ?? null }); db.prepare('UPDATE hr_requisitions SET workflow_instance_id = ? WHERE id = ?').run(inst?.id ?? null, id); }
        db.prepare("UPDATE hr_requisitions SET status = 'SUBMITTED', band = ?, plan_json = ?, requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(band, JSON.stringify(plan), actor.user, actor.user, nowIso(), id);
        writeAudit(db, { entity: 'hr_requisitions', entityId: id, action: 'submit', newValues: { band, plan }, reason: comment ?? null, actor: actor.user, companyId: actor.companyId });
        return reqView(actor, reqRow(actor, id));
      });
    },
    withdraw(actor, id, { reason }) {
      const r = reqRow(actor, id);
      if (r.status !== 'SUBMITTED') throw unprocessable('Only a requisition in approval is withdrawn.');
      if (!maker(actor, r)) throw forbidden('Only the person who raised it withdraws it.');
      workflowOf(db).withdraw(actor, r.workflow_instance_id, { comment: reason });
      return reqView(actor, reqRow(actor, id));
    },
    cancel(actor, id, { reason }) {
      need(actor, 'hr.requisition.cancel', 'cancel requisitions');
      const r = reqRow(actor, id);
      if (r.status === 'APPROVED') {
        if (db.prepare("SELECT 1 FROM hr_candidates WHERE requisition_id = ? AND stage IN ('OFFERED', 'ACCEPTED') AND deleted_at IS NULL").get(root(r))) throw unprocessable('Candidates hold offers against this requisition: withdraw the offers first.');
        db.prepare("UPDATE hr_requisitions SET status = 'CLOSED', closed_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), id);
        writeAudit(db, { entity: 'hr_requisitions', entityId: id, action: 'close', reason, actor: actor.user, companyId: actor.companyId });
        return reqView(actor, reqRow(actor, id));
      }
      if (!['SUBMITTED', 'RETURNED'].includes(r.status)) throw unprocessable('Only a requisition in approval, returned or approved is cancelled; delete a draft.');
      if (maker(actor, r)) transaction(db, () => { workflowOf(db).abandon(actor.companyId, r.workflow_instance_id, actor.user, 'CANCELLED', reason); decisions.requisition({ docId: r.id, status: 'CANCELLED' }, actor, 'CANCELLED', reason); });
      else workflowOf(db).cancel(actor, r.workflow_instance_id, { reason });
      return reqView(actor, reqRow(actor, id));
    },
    /** An approved requisition is locked: an amendment is a new revision with the same number, approved again; the approved one stays in force until then. */
    amend(actor, id, { reason }) {
      need(actor, 'hr.requisition.amend', 'amend requisitions');
      const r = reqRow(actor, id);
      if (r.status !== 'APPROVED') throw unprocessable('Only an approved requisition is amended.');
      if (db.prepare("SELECT 1 FROM hr_requisitions WHERE company_id = ? AND doc_no = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL").get(r.company_id, r.doc_no)) throw new HttpError(409, 'PENDING_CHANGE', `An amendment of ${r.doc_no} is already open.`);
      return transaction(db, () => {
        const rev = db.prepare('SELECT MAX(revision_no) AS v FROM hr_requisitions WHERE company_id = ? AND doc_no = ?').get(r.company_id, r.doc_no).v + 1;
        const nid = Number(db.prepare(`INSERT INTO hr_requisitions (company_id, doc_no, revision_no, root_id, supersedes_id, doc_date, ${REQ_SET.replace(/ = \?/g, '')}, status, requested_by, created_by, source_type, source_id, remarks) VALUES (?, ?, ?, ?, ?, ?, ${reqCols(rowToB(r)).map(() => '?').join(', ')}, 'DRAFT', ?, ?, 'hr_requisition', ?, ?)`)
          .run(r.company_id, r.doc_no, rev, root(r), r.id, todayIST(), ...reqCols(rowToB(r)), actor.user, actor.user, String(r.id), reason).lastInsertRowid);
        writeAudit(db, { entity: 'hr_requisitions', entityId: nid, action: 'amend', newValues: { from: r.id, revision: rev }, reason, actor: actor.user, companyId: actor.companyId });
        return reqView(actor, reqRow(actor, nid));
      });
    },
    compare(actor, id) {
      const r = reqRow(actor, id);
      if (!r.supersedes_id) throw unprocessable('This is the first revision.');
      const a = reqView(actor, reqRow(actor, r.supersedes_id)); const b = reqView(actor, r);
      return { from: { id: a.id, revision: a.revision }, to: { id: b.id, revision: b.revision }, rows: [['positions', 'Positions'], ['designation', 'Designation'], ['department', 'Department'], ['ctcMin', 'CTC from'], ['ctcMax', 'CTC to'], ['requiredBy', 'Required by'], ['reason', 'Reason']].map(([k, l]) => ({ field: l, from: a[k], to: b[k], changed: String(a[k]) !== String(b[k]) })) };
    },
    print(actor, id) {
      need(actor, 'hr.requisition.print', 'print requisitions');
      const v = reqView(actor, reqRow(actor, id));
      writeAudit(db, { entity: 'hr_requisitions', entityId: id, action: 'print', actor: actor.user, companyId: actor.companyId });
      const e = (s) => String(s ?? '—').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${e(v.docNo)}</title><style>body{font:12px system-ui,sans-serif;margin:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:4px;text-align:left}th{width:30%;background:#f3f5f7}</style></head><body><h1>Manpower requisition ${e(v.docNo)} (revision ${e(v.revision)})</h1><p>${e(v.statusLabel)}</p><table>${[['Department', v.department], ['Designation', v.designation], ['Project', v.project], ['Positions', v.positions], ['Reason', v.reason], ['Employment type', v.employmentType], ['CTC range (a year)', v.ctcMin ? `${v.ctcMin} to ${v.ctcMax}` : null], ['Required by', v.requiredBy], ['Against the plan', `${v.band === 'BEYOND_PLAN' ? 'beyond' : 'within'} (planned ${v.plan.planned ?? '—'}, in post ${v.plan.filled ?? '—'}, open ${v.plan.open ?? '—'})`], ['Justification', v.justification], ['Raised by', v.requestedBy]].map(([k, x]) => `<tr><th>${e(k)}</th><td>${e(x)}</td></tr>`).join('')}</table><p>Printed ${e(nowIso())} by ${e(actor.user)}.</p></body></html>`;
    },
  };
  const rowToB = (r) => ({ departmentId: r.department_id, designationId: r.designation_id, projectId: r.project_id, siteId: r.site_id, positions: r.positions, reason: r.reason, replacesEmployeeId: r.replaces_employee_id, employmentType: r.employment_type, locationType: r.location_type, managerId: r.manager_id, ctcMin: rs(r.ctc_min), ctcMax: rs(r.ctc_max), requiredBy: r.required_by, justification: r.justification });
  function reqHistory(actor, id) {
    const r = reqRow(actor, id);
    const ids = db.prepare('SELECT id, workflow_instance_id FROM hr_requisitions WHERE company_id = ? AND doc_no = ?').all(r.company_id, r.doc_no);
    const approvals = ids.flatMap((v) => (v.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(v.workflow_instance_id).map((h) => ({ requisitionId: v.id, ...h })) : []));
    const audit = db.prepare(`SELECT action, actor, reason, created_at AS at, entity_id FROM core_audit_log WHERE entity = 'hr_requisitions' AND entity_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`).all(...ids.map((v) => String(v.id)));
    return { approvals, audit: audit.map((x) => ({ requisitionId: Number(x.entity_id), action: x.action, by: x.actor, reason: x.reason, at: x.at })) };
  }
  const reqScope = (actor) => (canSeeAllReq(actor) ? { scopeSql: 'r.company_id = :c', params: { c: actor.companyId } } : { scopeSql: 'r.company_id = :c AND (lower(r.created_by) = lower(:u) OR lower(r.requested_by) = lower(:u))', params: { c: actor.companyId, u: actor.user } });
  const reqPresent = (actor) => { const all = canSeeAllReq(actor); return (r) => ({ id: r.id, docNo: r.doc_no, revision: r.revision_no, department: r.department_name, designation: r.designation_name, project: r.project_name, positions: r.positions, filled: r.filled_n, reason: r.reason, ctcMin: all ? rs(r.ctc_min) : null, ctcMax: all ? rs(r.ctc_max) : null, requiredBy: r.required_by, band: r.band, status: r.status, requestedBy: r.requested_by ?? r.created_by, updatedAt: r.updated_at ?? r.created_at }); };
  const reqSelect = `r.*, d.name AS department_name, g.name AS designation_name, p.name AS project_name, ${requisitionList.columns.filled.sql} AS filled_n`;
  const reqRegister = {
    list(actor, query) { need(actor, 'hr.requisition.view', 'see requisitions'); return runList(db, requisitionList, parseListRequest(requisitionList, query), { select: reqSelect, ...reqScope(actor), tieBreaker: 'r.id', map: reqPresent(actor) }); },
    exportSource(actor, req) {
      need(actor, 'hr.requisition.export', 'export requisitions');
      return { title: requisitionList.label, permission: 'hr.requisition.export', personal: false, columns: Object.entries(requisitionList.columns).map(([key, c]) => ({ key, label: c.label, type: c.type === 'enum' ? 'text' : c.type })), count: () => countList(db, requisitionList, req, reqScope(actor)),
        rows: () => runList(db, requisitionList, req, { select: reqSelect, ...reqScope(actor), tieBreaker: 'r.id', limit: null, map: reqPresent(actor) }).data, describe: (x) => [x.q ? `search "${x.q}"` : '', ...x.filters.map((f) => `${requisitionList.columns[f.key].label} ${f.op} ${f.raw}`)].filter(Boolean).join('; ') };
    },
  };

  // ---- candidates and the pipeline (FR-02) ----
  const candRow = (actor, id) => {
    const c = db.prepare('SELECT * FROM hr_candidates WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId);
    if (!c) throw notFound('That candidate does not exist.');
    const level = candLevel(actor, c);
    if (!level) throw notFound('That candidate does not exist.');
    return c;
  };
  /** HR sees everything; a panel member sees the candidates they interview, and the hiring manager those of their requisition: basic data, no pay. */
  function candLevel(actor, c) {
    if (may(actor, 'hr.candidate.view')) return 'full';
    if (db.prepare("SELECT 1 FROM hr_interviews i WHERE i.candidate_id = ? AND i.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(i.panel_json) j WHERE lower(j.value) = lower(?))").get(c.id, actor.user)) return 'panel';
    const r = db.prepare('SELECT created_by FROM hr_requisitions WHERE id = ?').get(c.requisition_id);
    if (r && same(r.created_by, actor.user) && may(actor, 'hr.requisition.view')) return 'panel';
    return null;
  }
  const interviewView = (i, actor) => ({ id: i.id, round: i.round_no, scheduledAt: i.scheduled_at, mode: i.mode, panel: json(i.panel_json, []), feedback: json(i.feedback_json, []).map((f) => ({ ...f, mine: same(f.by, actor.user) })), score: i.score != null ? i.score / 100 : null, result: i.result, canGive: i.result === 'PENDING' && json(i.panel_json, []).some((p) => same(p, actor.user)) && !json(i.feedback_json, []).some((f) => same(f.by, actor.user)) && may(actor, 'hr.interview.give') });
  function candView(actor, c, { full = false } = {}) {
    const level = candLevel(actor, c);
    const hr = level === 'full';
    const r = db.prepare('SELECT doc_no, designation_id, department_id FROM hr_requisitions WHERE id = ?').get(c.requisition_id);
    const base = { id: c.id, name: c.full_name, mobile: hr ? c.mobile : mask(c.mobile), email: hr ? c.email : null, source: c.source, sourceLabel: SOURCE_LABELS[c.source], sourceDetail: hr ? c.source_detail : null, requisitionId: c.requisition_id, requisition: r?.doc_no, designation: orgName('org_designations', r?.designation_id), department: orgName('org_departments', r?.department_id),
      stage: c.stage, stageLabel: STAGE_LABELS[c.stage], stageAt: c.stage_at, daysInStage: Math.floor((Date.parse(`${todayIST()}T00:00:00Z`) - Date.parse(`${(c.stage_at ?? c.created_at).slice(0, 10)}T00:00:00Z`)) / 86_400_000), currentCtc: hr ? rs(c.current_ctc) : null, expectedCtc: hr ? rs(c.expected_ctc) : null, noticeDays: c.notice_days, resumeFileId: c.resume_file_id,
      bgvStatus: c.bgv_status, medicalStatus: c.medical_status, employeeId: c.employee_id, joinedOn: c.joined_on, rejectReason: hr ? c.reject_reason : null, retentionUntil: hr ? c.retention_until : null, anonymised: Boolean(c.anonymised_at), rowVersion: c.version, accessLevel: level, createdBy: c.created_by };
    const ivs = db.prepare('SELECT * FROM hr_interviews WHERE candidate_id = ? AND deleted_at IS NULL ORDER BY round_no, id').all(c.id).map((i) => interviewView(i, actor));
    const lastResult = ivs.filter((i) => i.result !== 'CANCELLED').at(-1)?.result ?? null;
    base.interviews = ivs; base.lastInterview = lastResult; base.interviewCount = ivs.length;
    if (!full) return base;
    const profile = json(c.profile_json, {});
    const sens = hr && c.sensitive_enc ? json(vault.decrypt(c.sensitive_enc, slot(c.company_id, c.id)), {}) : null;
    const offers = hr || may(actor, 'hr.offer.view') ? db.prepare('SELECT * FROM hr_offers WHERE candidate_id = ? AND deleted_at IS NULL ORDER BY revision_no DESC, id DESC').all(c.id).map((o) => offerView(actor, o)) : [];
    return { ...base, profile: hr ? profile : null, prejoiningDone: Boolean(c.profile_json && c.profile_json !== '{}'), sensitive: sens ? { pan: sens.statutory?.pan ? `••••••${sens.statutory.pan.slice(-4)}` : null, aadhaar: sens.statutory?.aadhaar ? `•••• ${sens.statutory.aadhaar.slice(-4)}` : null, bank: sens.bank ? `••••••${sens.bank.accountNo.slice(-4)} · ${sens.bank.ifsc}` : null } : null,
      offers, tasks: db.prepare('SELECT * FROM hr_onboarding_tasks WHERE candidate_id = ? AND deleted_at IS NULL ORDER BY due_date, id').all(c.id).map(taskView), canEdit: hr && may(actor, 'hr.candidate.edit'), canGiveFeedback: may(actor, 'hr.interview.give'),
      allowedNext: hr && may(actor, 'hr.candidate.edit') ? [...(FORWARD[c.stage] ?? []), ...(c.stage !== 'REJECTED' && c.stage !== 'JOINED' ? ['REJECTED'] : [])] : [], canUndo: hr && Boolean(BACK[c.stage]) };
  }
  const candidates = {
    create(actor, b) {
      need(actor, 'hr.candidate.edit', 'enter candidates');
      const problems = [];
      const r = db.prepare("SELECT * FROM hr_requisitions WHERE id = ? AND company_id = ? AND status = 'APPROVED' AND deleted_at IS NULL").get(b.requisitionId, actor.companyId);
      if (!r) problems.push({ field: 'requisitionId', message: 'Choose an approved requisition' });
      const mobile = String(b.mobile).replace(/[\s-]/g, '').replace(/^(\+91|0)/, '');
      if (!FORMATS.MOBILE.test(mobile)) problems.push({ field: 'mobile', message: `Mobile is not valid (${FORMATS.MOBILE.hint})` });
      if (b.email && !FORMATS.EMAIL.test(b.email)) problems.push({ field: 'email', message: 'E-mail is not valid' });
      if (b.resumeFileId && !db.prepare("SELECT 1 FROM core_files WHERE id = ? AND company_id = ? AND linked_entity = 'hr_candidate'").get(b.resumeFileId, actor.companyId)) problems.push({ field: 'resumeFileId', message: 'Upload the resume to a candidate first' });
      if (problems.length) throw badRequest('Some fields are not valid.', problems);
      const rroot = root(r);
      const live = "stage != 'REJECTED' AND deleted_at IS NULL AND anonymised_at IS NULL";
      const dup = db.prepare(`SELECT id, full_name, requisition_id FROM hr_candidates WHERE company_id = ? AND (mobile = ? OR (? IS NOT NULL AND lower(email) = ?)) AND ${live}`).all(actor.companyId, mobile, b.email, b.email);
      const block = dup.filter((d) => d.requisition_id === rroot);
      if (block.length) throw new HttpError(409, 'DUPLICATE', `${block[0].full_name} is already a candidate for this requisition.`, [{ field: 'mobile', message: 'already in this pipeline', candidateId: block[0].id }]);
      if (dup.length && !b.acknowledgeDuplicates) throw new HttpError(409, 'DUPLICATE_WARNING', `${dup[0].full_name} with the same mobile or e-mail is a candidate for another requisition. Check it, then confirm.`, [{ field: 'mobile', message: 'same person in another pipeline', candidateId: dup[0].id }]);
      return transaction(db, () => {
        const id = Number(db.prepare("INSERT INTO hr_candidates (company_id, full_name, mobile, email, source, source_detail, requisition_id, resume_file_id, current_ctc, expected_ctc, notice_days, stage, stage_at, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'APPLIED', ?, ?, 'hr_candidate')")
          .run(actor.companyId, b.fullName.trim(), mobile, b.email, b.source, b.sourceDetail, rroot, b.resumeFileId, units(b.currentCtc), units(b.expectedCtc), b.noticeDays, nowIso(), actor.user).lastInsertRowid);
        writeAudit(db, { entity: 'hr_candidates', entityId: id, action: 'create', newValues: { requisition: r.doc_no, source: b.source }, actor: actor.user, companyId: actor.companyId });
        return candView(actor, candRow(actor, id), { full: true });
      });
    },
    get(actor, id) { return candView(actor, candRow(actor, id), { full: true }); },
    list(actor, { q, requisitionId, stage, limit, offset }) {
      need(actor, 'hr.candidate.view', 'see candidates');
      const where = ['c.company_id = ?', 'c.deleted_at IS NULL']; const args = [actor.companyId];
      if (q) { where.push('(c.full_name LIKE ? OR c.mobile LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
      if (requisitionId) { where.push('c.requisition_id = ?'); args.push(root(db.prepare('SELECT id, root_id FROM hr_requisitions WHERE id = ?').get(requisitionId) ?? { id: requisitionId })); }
      if (stage) { where.push('c.stage = ?'); args.push(stage); }
      const total = db.prepare(`SELECT COUNT(*) AS n FROM hr_candidates c WHERE ${where.join(' AND ')}`).get(...args).n;
      const rows = db.prepare(`SELECT c.* FROM hr_candidates c WHERE ${where.join(' AND ')} ORDER BY c.id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset).map((c) => candView(actor, c));
      return { rows, total };
    },
    /** The board: the candidates of the pipeline in a column per stage (FR-02). */
    board(actor, { requisitionId, q }) {
      need(actor, 'hr.candidate.view', 'see the pipeline');
      const where = ['c.company_id = ?', 'c.deleted_at IS NULL']; const args = [actor.companyId];
      if (requisitionId) { const r = db.prepare('SELECT id, root_id FROM hr_requisitions WHERE id = ? AND company_id = ?').get(requisitionId, actor.companyId); where.push('c.requisition_id = ?'); args.push(r ? root(r) : -1); }
      if (q) { where.push('c.full_name LIKE ?'); args.push(`%${q}%`); }
      const rows = db.prepare(`SELECT c.* FROM hr_candidates c WHERE ${where.join(' AND ')} ORDER BY c.stage_at DESC, c.id DESC LIMIT 1000`).all(...args).map((c) => candView(actor, c));
      const requisitions = db.prepare("SELECT r.id, r.doc_no, g.name AS designation, r.positions, r.status FROM hr_requisitions r LEFT JOIN org_designations g ON g.id = r.designation_id WHERE r.company_id = ? AND r.status IN ('APPROVED', 'CLOSED') AND r.deleted_at IS NULL ORDER BY r.id DESC LIMIT 100").all(actor.companyId).map((r) => ({ id: r.id, docNo: r.doc_no, designation: r.designation, positions: r.positions, status: r.status }));
      const sources = {}; for (const c of rows) sources[c.source] = (sources[c.source] ?? 0) + 1;
      return { stages: Object.entries(STAGE_LABELS).map(([k, label]) => ({ stage: k, label, candidates: rows.filter((c) => c.stage === k) })), requisitions, sources, total: rows.length };
    },
    /** A move on the board, checked here: only one step forward from Applied to Interview, Selected needs a passed interview, Offered, Accepted and Joined come from their own steps; Rejected needs a reason; one step back undoes (FR-02). */
    setStage(actor, id, { stage, reason, version, undo }) {
      need(actor, 'hr.candidate.edit', 'move candidates');
      const c = candRow(actor, id);
      if (c.version !== version) throw conflict('This candidate was moved by someone else. Reload the board.');
      if (c.stage === stage) throw conflict(`The candidate is already ${STAGE_LABELS[stage].toLowerCase()}.`);
      if (stage === 'REJECTED') {
        if (['JOINED', 'REJECTED'].includes(c.stage)) throw conflict(`A candidate who is ${STAGE_LABELS[c.stage].toLowerCase()} is not rejected.`);
        if (!reason || reason.length < 5) throw badRequest('Say why (at least 5 characters).', [{ field: 'reason', message: 'Say why the candidate is rejected' }]);
        if (c.stage === 'OFFERED' || c.stage === 'ACCEPTED') db.prepare("UPDATE hr_offers SET token_hash = NULL, response = CASE response WHEN 'NONE' THEN 'DECLINED' ELSE response END WHERE candidate_id = ? AND status = 'APPROVED'").run(id);
        db.prepare("UPDATE hr_candidates SET stage = 'REJECTED', rejected_from = ?, reject_reason = ?, stage_at = ?, retention_until = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(c.stage, reason, nowIso(), dayPlus(Math.round((param('hr.candidate.retention_months', c.company_id) ?? 12) * 30.4375)), actor.user, nowIso(), id);
      } else if (undo) {
        if (BACK[c.stage] !== stage) throw unprocessable(`A candidate who is ${STAGE_LABELS[c.stage].toLowerCase()} goes back only to ${STAGE_LABELS[BACK[c.stage] ?? 'APPLIED'].toLowerCase()}.`);
        db.prepare('UPDATE hr_candidates SET stage = ?, stage_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(stage, nowIso(), actor.user, nowIso(), id);
      } else {
        if (c.stage === 'REJECTED' && stage === 'APPLIED') {
          if (c.anonymised_at) throw unprocessable('The data of this candidate was removed after the retention period; enter the candidate again.');
          db.prepare("UPDATE hr_candidates SET stage = 'APPLIED', reject_reason = NULL, retention_until = NULL, stage_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(nowIso(), actor.user, nowIso(), id);
        } else {
          if (!(FORWARD[c.stage] ?? []).includes(stage)) throw unprocessable(`A candidate who is ${STAGE_LABELS[c.stage].toLowerCase()} cannot be moved to ${STAGE_LABELS[stage].toLowerCase()} here${['OFFERED', 'ACCEPTED', 'JOINED'].includes(stage) ? ': that step comes from the offer and the joining' : ''}.`);
          if (stage === 'INTERVIEW' && !db.prepare("SELECT 1 FROM hr_interviews WHERE candidate_id = ? AND deleted_at IS NULL AND result != 'CANCELLED'").get(id)) { /* scheduling an interview also moves the candidate; moving without one is allowed for screening calls */ }
          if (stage === 'SELECTED') {
            const done = db.prepare("SELECT result FROM hr_interviews WHERE candidate_id = ? AND deleted_at IS NULL AND result != 'CANCELLED' ORDER BY round_no, id").all(id).map((x) => x.result);
            if (!done.length) throw unprocessable('A candidate is selected after at least one interview.');
            if (done.includes('PENDING')) throw unprocessable('An interview of this candidate is waiting for feedback.');
            if (done.includes('FAIL') || done.at(-1) !== 'PASS') throw unprocessable('The last interview must be passed and none failed before the candidate is selected.');
          }
          db.prepare('UPDATE hr_candidates SET stage = ?, stage_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(stage, nowIso(), actor.user, nowIso(), id);
        }
      }
      writeAudit(db, { entity: 'hr_candidates', entityId: id, action: 'stage', oldValues: { stage: c.stage }, newValues: { stage }, reason: reason ?? null, actor: actor.user, companyId: actor.companyId });
      event('hr.candidate.stage_changed', actor, 'hr_candidate', id, c.company_id, { from: c.stage, to: stage });
      return candView(actor, candRow(actor, id), { full: true });
    },
    checks(actor, id, b) {
      need(actor, 'hr.candidate.edit', 'record verification');
      const c = candRow(actor, id);
      if (['REJECTED', 'JOINED'].includes(c.stage)) throw conflict('The candidate is not in the pipeline.');
      db.prepare('UPDATE hr_candidates SET bgv_status = COALESCE(?, bgv_status), medical_status = COALESCE(?, medical_status), updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.bgvStatus ?? null, b.medicalStatus ?? null, actor.user, nowIso(), id);
      writeAudit(db, { entity: 'hr_candidates', entityId: id, action: 'checks', newValues: { bgv: b.bgvStatus, medical: b.medicalStatus }, reason: b.note ?? null, actor: actor.user, companyId: actor.companyId });
      return candView(actor, candRow(actor, id), { full: true });
    },
    /** FR-05: the pre-joining details, from HR or from the candidate's own link; the sensitive part is encrypted. */
    savePrejoining(actor, id, b) {
      const c = candRow(actor, id);
      if (!may(actor, 'hr.candidate.edit')) throw forbidden('You may not enter the pre-joining details (permission hr.candidate.edit).');
      return storePrejoining(c, b, actor.user);
    },
    addDocument(actor, id, { fileId, label }) {
      need(actor, 'hr.candidate.edit', 'record documents');
      candRow(actor, id);
      if (!db.prepare("SELECT 1 FROM core_files WHERE id = ? AND company_id = ? AND linked_entity = 'hr_candidate' AND linked_id = ?").get(fileId, actor.companyId, id)) throw badRequest('Some fields are not valid.', [{ field: 'fileId', message: 'Upload the file to this candidate first' }]);
      writeAudit(db, { entity: 'hr_candidates', entityId: id, action: 'document', newValues: { fileId, label }, actor: actor.user, companyId: actor.companyId });
      return { fileId, label };
    },
    /** FR-07 (T-01): the joined candidate becomes an employee through the employee master, with everything captured, and the joining checklist is given out. */
    join(actor, id, { doj, comment }) {
      need(actor, 'hr.candidate.edit', 'convert candidates');
      const c = candRow(actor, id);
      if (c.stage !== 'ACCEPTED') throw conflict(`Only a candidate who accepted the offer joins (this one is ${STAGE_LABELS[c.stage].toLowerCase()}).`);
      if (param('hr.onboarding.require_clearance', c.company_id) !== false) {
        const p = [];
        if (c.bgv_status !== 'CLEAR') p.push({ field: 'bgvStatus', message: 'The background verification is not clear' });
        if (c.medical_status !== 'FIT') p.push({ field: 'medicalStatus', message: 'The medical fitness is not recorded as fit' });
        if (p.length) throw unprocessable(`The candidate cannot join yet: ${p.map((x) => x.message).join('; ')}.`);
      }
      const profile = json(c.profile_json, {});
      if (!profile.firstName) throw unprocessable('The pre-joining details are not in yet: ask the candidate to fill them through the offer link, or enter them on the candidate.');
      const offer = db.prepare("SELECT * FROM hr_offers WHERE candidate_id = ? AND status = 'APPROVED' AND response = 'ACCEPTED' AND deleted_at IS NULL ORDER BY revision_no DESC LIMIT 1").get(id);
      if (!offer) throw unprocessable('There is no accepted offer.');
      const req = db.prepare('SELECT * FROM hr_requisitions WHERE id = (SELECT MAX(id) FROM hr_requisitions WHERE company_id = ? AND COALESCE(root_id, id) = ? AND status IN (\'APPROVED\', \'CLOSED\'))').get(c.company_id, c.requisition_id) ?? db.prepare('SELECT * FROM hr_requisitions WHERE id = ?').get(c.requisition_id);
      const sens = c.sensitive_enc ? json(vault.decrypt(c.sensitive_enc, slot(c.company_id, c.id)), {}) : {};
      const joinOn = doj ?? offer.doj_proposed;
      const body = {
        firstName: profile.firstName, lastName: profile.lastName ?? null, gender: profile.gender, dob: profile.dob, bloodGroup: profile.bloodGroup ?? null, maritalStatus: profile.maritalStatus ?? null, mobile: c.mobile, email: c.email,
        permanentAddress: profile.permanentAddress ?? null, currentAddress: profile.currentAddress ?? null, branchId: null, departmentId: req.department_id, designationId: offer.designation_id, grade: offer.grade, employmentType: offer.employment_type, doj: joinOn, confirmationDate: null,
        managerId: req.manager_id ?? null, costCentreId: null, locationType: req.location_type, projectId: req.project_id ?? null, siteId: req.site_id ?? null, salaryPaymentMode: sens.bank ? 'BANK_TRANSFER' : 'CASH', languages: [], skills: [],
        contacts: profile.contacts ?? [], education: profile.education ?? [], experience: profile.experience ?? [], statutory: sens.statutory ?? null, bank: sens.bank ?? null, acknowledgeDuplicates: true, submit: true, comment: comment ?? `Joined from candidate ${c.full_name}`,
      };
      const emp = employeesOf(db);
      if (!emp) throw unprocessable('The employee master is not running.');
      return transaction(db, () => {
        const out = emp.registration.create(actor, body);
        db.prepare("UPDATE hr_employees SET source_type = 'hr_candidate', source_id = ? WHERE id = ?").run(String(c.id), out.id);
        db.prepare("UPDATE hr_candidates SET stage = 'JOINED', stage_at = ?, employee_id = ?, joined_on = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(nowIso(), out.id, joinOn, actor.user, nowIso(), id);
        const made = makeTasks(actor, c, out.id, joinOn);
        const rroot = c.requisition_id;
        const rq = db.prepare('SELECT id, positions FROM hr_requisitions WHERE company_id = ? AND COALESCE(root_id, id) = ? AND status = \'APPROVED\'').get(c.company_id, rroot);
        if (rq && joinedOf({ id: rroot, root_id: null }) >= rq.positions) { db.prepare("UPDATE hr_requisitions SET status = 'CLOSED', closed_reason = 'All positions filled', updated_at = ?, version = version + 1 WHERE id = ?").run(nowIso(), rq.id); writeAudit(db, { entity: 'hr_requisitions', entityId: rq.id, action: 'close', reason: 'All positions filled', actor: actor.user, companyId: c.company_id }); }
        writeAudit(db, { entity: 'hr_candidates', entityId: id, action: 'join', newValues: { employeeId: out.id, code: out.code, doj: joinOn, tasks: made }, actor: actor.user, companyId: actor.companyId });
        event('hr.candidate.joined', actor, 'hr_candidate', id, c.company_id, { employeeId: out.id, code: out.code, doj: joinOn, requisitionId: rroot });
        return { candidate: candView(actor, candRow(actor, id), { full: true }), employee: { id: out.id, code: out.code, status: out.status, instanceId: out.workflow?.id ?? out.instanceId }, tasks: made };
      });
    },
  };
  function storePrejoining(c, b, by) {
    if (['REJECTED', 'JOINED'].includes(c.stage) || !['SELECTED', 'OFFERED', 'ACCEPTED'].includes(c.stage)) throw conflict('The pre-joining details are taken for a selected candidate who has an offer to answer.');
    const problems = [];
    if (b.statutory?.pan && !FORMATS.PAN.test(b.statutory.pan)) problems.push({ field: 'statutory.pan', message: `PAN is not valid (${FORMATS.PAN.hint})` });
    if (b.bank && !FORMATS.BANK_ACCOUNT.test(b.bank.accountNo)) problems.push({ field: 'bank.accountNo', message: `An account number has ${FORMATS.BANK_ACCOUNT.hint}` });
    if (b.bank && !FORMATS.IFSC.test(b.bank.ifsc)) problems.push({ field: 'bank.ifsc', message: `IFSC is not valid (${FORMATS.IFSC.hint})` });
    for (const [i, x] of b.contacts.entries()) if (x.phone && !FORMATS.MOBILE.test(x.phone)) problems.push({ field: `contacts.${i}.phone`, message: `Phone is not valid (${FORMATS.MOBILE.hint})` });
    if (problems.length) throw badRequest('Some fields are not valid.', problems);
    const { statutory, bank, ...profile } = b;
    db.prepare('UPDATE hr_candidates SET profile_json = ?, sensitive_enc = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(profile), vault.encrypt(JSON.stringify({ statutory, bank }), slot(c.company_id, c.id)), by, nowIso(), c.id);
    writeAudit(db, { entity: 'hr_candidates', entityId: c.id, action: 'prejoining', newValues: { by, hasStatutory: Boolean(statutory), hasBank: Boolean(bank) }, actor: by, companyId: c.company_id });
    return { saved: true };
  }

  // ---- interviews (FR-03) ----
  const interviews = {
    schedule(actor, candidateId, b) {
      need(actor, 'hr.candidate.edit', 'schedule interviews');
      const c = candRow(actor, candidateId);
      if (['REJECTED', 'JOINED', 'OFFERED', 'ACCEPTED'].includes(c.stage)) throw conflict('The candidate is not in the interview stages.');
      const panel = [...new Set(b.panel.map((p) => p.trim()))];
      for (const u of panel) if (!db.prepare("SELECT 1 FROM iam_users WHERE company_id = ? AND lower(username) = lower(?) AND is_active = 1").get(actor.companyId, u)) throw badRequest('Some fields are not valid.', [{ field: 'panel', message: `${u} is not a user of your company` }]);
      return transaction(db, () => {
        const round = b.round ?? (db.prepare('SELECT COALESCE(MAX(round_no), 0) AS n FROM hr_interviews WHERE candidate_id = ? AND deleted_at IS NULL').get(candidateId).n + 1);
        const id = Number(db.prepare("INSERT INTO hr_interviews (company_id, candidate_id, round_no, scheduled_at, mode, panel_json, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, 'hr_interview')").run(actor.companyId, candidateId, round, b.scheduledAt, b.mode, JSON.stringify(panel), actor.user).lastInsertRowid);
        if (['APPLIED', 'SCREENED'].includes(c.stage)) db.prepare("UPDATE hr_candidates SET stage = 'INTERVIEW', stage_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(nowIso(), actor.user, nowIso(), candidateId);
        for (const u of panel) notif.notify({ companyId: actor.companyId, templateCode: 'hr.recruit.decided', recipients: [`user:${u}`], data: { what: 'Interview', ref: `round ${round}`, title: `${c.full_name} on ${b.scheduledAt.replace('T', ' ')}`, decision: 'scheduled for you', comment: '' }, link: `/hr/recruitment/candidate?id=${candidateId}`, sourceType: 'hr_interview', sourceId: String(id), eventKey: `hr.interview.scheduled:${id}:${u}` });
        writeAudit(db, { entity: 'hr_interviews', entityId: id, action: 'schedule', newValues: { candidateId, round, panel, scheduledAt: b.scheduledAt }, actor: actor.user, companyId: actor.companyId });
        return interviewView(db.prepare('SELECT * FROM hr_interviews WHERE id = ?').get(id), actor);
      });
    },
    cancel(actor, id, { reason }) {
      need(actor, 'hr.candidate.edit', 'cancel interviews');
      const i = db.prepare('SELECT * FROM hr_interviews WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId);
      if (!i) throw notFound('That interview does not exist.');
      if (i.result !== 'PENDING') throw conflict('Only an interview that has not been decided is cancelled.');
      db.prepare("UPDATE hr_interviews SET result = 'CANCELLED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), id);
      writeAudit(db, { entity: 'hr_interviews', entityId: id, action: 'cancel', reason, actor: actor.user, companyId: actor.companyId });
      return interviewView(db.prepare('SELECT * FROM hr_interviews WHERE id = ?').get(id), actor);
    },
    /** The feedback of one panel member: scores 1 to 5 per criterion, a comment and a recommendation. When every member has given theirs the interview has its score (the average) and its result (a fail from anyone fails it). */
    feedback(actor, id, b) {
      need(actor, 'hr.interview.give', 'give interview feedback');
      const i = db.prepare('SELECT * FROM hr_interviews WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId);
      if (!i) throw notFound('That interview does not exist.');
      const panel = json(i.panel_json, []);
      if (!panel.some((p) => same(p, actor.user))) throw forbidden('Only a member of the panel gives feedback on this interview.');
      if (i.result === 'CANCELLED') throw conflict('This interview was cancelled.');
      const given = json(i.feedback_json, []);
      if (given.some((f) => same(f.by, actor.user))) throw conflict('You have already given your feedback; it is not changed.');
      const vals = Object.values(b.scores);
      const avg = Math.round((vals.reduce((a, x) => a + x, 0) / vals.length) * 100);
      const all = [...given, { by: actor.user, scores: b.scores, average: avg / 100, comments: b.comments ?? '', recommendation: b.recommendation, at: nowIso() }];
      const complete = panel.every((p) => all.some((f) => same(f.by, p)));
      const score = complete ? Math.round(all.reduce((a, f) => a + f.average * 100, 0) / all.length) : null;
      const result = !complete ? 'PENDING' : all.some((f) => f.recommendation === 'FAIL') ? 'FAIL' : all.every((f) => f.recommendation === 'PASS') ? 'PASS' : 'HOLD';
      db.prepare('UPDATE hr_interviews SET feedback_json = ?, score = ?, result = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(all), score, result, actor.user, nowIso(), id);
      writeAudit(db, { entity: 'hr_interviews', entityId: id, action: 'feedback', newValues: { by: actor.user, average: avg / 100, recommendation: b.recommendation, result }, actor: actor.user, companyId: actor.companyId });
      return interviewView(db.prepare('SELECT * FROM hr_interviews WHERE id = ?').get(id), actor);
    },
    mine(actor) {
      return db.prepare("SELECT i.*, c.full_name FROM hr_interviews i JOIN hr_candidates c ON c.id = i.candidate_id WHERE i.company_id = ? AND i.deleted_at IS NULL AND i.result = 'PENDING' AND EXISTS (SELECT 1 FROM json_each(i.panel_json) j WHERE lower(j.value) = lower(?)) ORDER BY i.scheduled_at").all(actor.companyId, actor.user)
        .filter((i) => !json(i.feedback_json, []).some((f) => same(f.by, actor.user))).map((i) => ({ ...interviewView(i, actor), candidateId: i.candidate_id, candidate: i.full_name }));
    },
  };

  // ---- offers with the CTC breakup (FR-04, BR-02) ----
  /** The CTC broken up, once, here: basic, HRA, employer PF (capped), gratuity, and the special allowance as what is left, in whole paise; the parts always add up to the CTC. */
  function breakup(companyId, ctcAnnual) {
    const cfg = param('hr.offer.breakup', companyId) ?? {};
    const ctc = units(ctcAnnual);
    const basic = Math.round((ctc * cfg.basicPct) / 100);
    const hra = Math.round((basic * cfg.hraPctOfBasic) / 100);
    const pf = Math.round((Math.min(basic / 12, cfg.pfWageCapMonthly * 100) * 12 * cfg.pfEmployerPct) / 100);
    const gratuity = Math.round((basic * cfg.gratuityPct) / 100);
    const special = ctc - basic - hra - pf - gratuity;
    if (special < 0) throw unprocessable('The CTC is too low for the breakup rules (the fixed parts exceed it).');
    const line = (code, label, annual, kind) => ({ code, label, kind, annual: rs(annual), monthly: rs(Math.round(annual / 12)) });
    const lines = [line('BASIC', 'Basic salary', basic, 'EARNING'), line('HRA', 'House rent allowance', hra, 'EARNING'), line('SPECIAL', 'Special allowance', special, 'EARNING'), line('PF_EMPLOYER', 'Employer provident fund', pf, 'EMPLOYER'), line('GRATUITY', 'Gratuity', gratuity, 'EMPLOYER')];
    return { ctcAnnual: rs(ctc), ctcMonthly: rs(Math.round(ctc / 12)), grossMonthly: rs(Math.round((basic + hra + special) / 12)), lines, rules: cfg };
  }
  const offerRow = (actor, id) => {
    const o = db.prepare('SELECT * FROM hr_offers WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId);
    if (!o || !may(actor, 'hr.offer.view')) throw notFound('That offer does not exist.');
    return o;
  };
  const offerMaker = (actor, o) => same(o.created_by, actor.user);
  function offerView(actor, o) {
    const c = db.prepare('SELECT full_name, requisition_id, stage FROM hr_candidates WHERE id = ?').get(o.candidate_id);
    const r = c && db.prepare('SELECT doc_no, ctc_min, ctc_max FROM hr_requisitions WHERE id = ?').get(c.requisition_id);
    const see = may(actor, 'hr.offer.view');
    return { id: o.id, docNo: o.doc_no, revision: o.revision_no, candidateId: o.candidate_id, candidate: c?.full_name, requisition: r?.doc_no, designationId: o.designation_id, designation: orgName('org_designations', o.designation_id), grade: o.grade, employmentType: o.employment_type, ctcAnnual: see ? rs(o.ctc_annual) : null, breakup: see ? json(o.breakup_json, {}) : null,
      range: see && r ? { min: rs(r.ctc_min), max: rs(r.ctc_max) } : null, dojProposed: o.doj_proposed, validDays: o.valid_days, band: o.band, bandReason: o.band_reason, status: o.status, statusLabel: REQ_STATUS[o.status], response: o.response, sentAt: o.sent_at, validUntil: o.valid_until, respondedAt: o.responded_at, responseNote: o.response_note, instanceId: o.workflow_instance_id,
      requestedBy: o.requested_by ?? o.created_by, rowVersion: o.version, canEdit: ['DRAFT', 'RETURNED'].includes(o.status) && may(actor, 'hr.offer.edit') && offerMaker(actor, o), canSubmit: ['DRAFT', 'RETURNED'].includes(o.status) && may(actor, 'hr.offer.submit') && offerMaker(actor, o), canDelete: o.status === 'DRAFT' && may(actor, 'hr.offer.delete') && offerMaker(actor, o),
      canWithdraw: o.status === 'SUBMITTED' && offerMaker(actor, o), canCancel: ['SUBMITTED', 'RETURNED', 'APPROVED'].includes(o.status) && may(actor, 'hr.offer.cancel') && o.response === 'NONE', canAmend: o.status === 'APPROVED' && o.response === 'NONE' && may(actor, 'hr.offer.amend'), canSend: o.status === 'APPROVED' && o.response === 'NONE' && may(actor, 'hr.offer.create'), canRecordAcceptance: o.status === 'APPROVED' && o.response === 'NONE' && Boolean(o.sent_at) && may(actor, 'hr.offer.create'), canPrint: may(actor, 'hr.offer.print') };
  }
  /** BR-02: the approval chain follows the pay and the grade: above the requisition's range, or a senior grade, the director also approves. */
  function offerBand(actor, o, cand) {
    const r = db.prepare('SELECT * FROM hr_requisitions WHERE id = (SELECT MAX(id) FROM hr_requisitions WHERE company_id = ? AND COALESCE(root_id, id) = ? AND status IN (\'APPROVED\', \'CLOSED\'))').get(actor.companyId, cand.requisition_id) ?? db.prepare('SELECT * FROM hr_requisitions WHERE id = ?').get(cand.requisition_id);
    const level = db.prepare('SELECT level FROM org_designations WHERE id = ?').get(o.designation_id)?.level ?? 0;
    const senior = param('hr.employee.senior_level', actor.companyId) ?? 8;
    if (r && o.ctc_annual > r.ctc_max) return { band: 'DIR', reason: `The CTC is above the requisition range (up to ${rs(r.ctc_max)})` };
    if (level >= senior) return { band: 'DIR', reason: 'A senior grade' };
    return { band: 'STANDARD', reason: null };
  }
  function checkOffer(actor, b, problems, current = null) {
    const c = db.prepare('SELECT * FROM hr_candidates WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(b.candidateId, actor.companyId);
    if (!c) { problems.push({ field: 'candidateId', message: 'That candidate does not exist' }); return null; }
    if (c.stage !== 'SELECTED' && !(current && ['OFFERED', 'SELECTED'].includes(c.stage))) problems.push({ field: 'candidateId', message: `An offer is made to a selected candidate (this one is ${STAGE_LABELS[c.stage].toLowerCase()})` });
    if (!db.prepare('SELECT 1 FROM org_designations WHERE id = ? AND company_id = ?').get(b.designationId, actor.companyId)) problems.push({ field: 'designationId', message: 'That designation does not exist' });
    if (b.dojProposed < todayIST()) problems.push({ field: 'dojProposed', message: 'The date of joining is today or later' });
    if (Number(b.ctcAnnual) <= 0) problems.push({ field: 'ctcAnnual', message: 'The CTC is above zero' });
    if (!current && db.prepare("SELECT 1 FROM hr_offers WHERE candidate_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED') AND response != 'DECLINED' AND deleted_at IS NULL").get(b.candidateId)) problems.push({ field: 'candidateId', message: 'This candidate already has an offer: amend it instead' });
    return c;
  }
  const offers = {
    preview(actor, { ctcAnnual, candidateId, designationId }) {
      need(actor, 'hr.offer.create', 'build offers');
      const out = breakup(actor.companyId, ctcAnnual);
      const c = candidateId ? db.prepare('SELECT * FROM hr_candidates WHERE id = ? AND company_id = ?').get(candidateId, actor.companyId) : null;
      const o = { ctc_annual: units(ctcAnnual), designation_id: designationId ?? 0 };
      const band = c && designationId ? offerBand(actor, o, c) : null;
      const r = c && db.prepare('SELECT ctc_min, ctc_max FROM hr_requisitions WHERE id = ?').get(c.requisition_id);
      return { ...out, band: band?.band ?? null, bandReason: band?.reason ?? null, range: r ? { min: rs(r.ctc_min), max: rs(r.ctc_max) } : null, expected: c ? rs(c.expected_ctc) : null };
    },
    create(actor, b) {
      need(actor, 'hr.offer.create', 'make offers');
      const problems = []; const c = checkOffer(actor, b, problems);
      if (problems.length) throw badRequest('Some fields are not valid.', problems);
      const grade = b.grade ?? db.prepare('SELECT grade FROM org_designations WHERE id = ?').get(b.designationId)?.grade ?? null;
      const bk = breakup(actor.companyId, b.ctcAnnual);
      return transaction(db, () => {
        const no = nextDoc(actor, 'HR_OFFER', 'hr_offers', 'OFR');
        const id = Number(db.prepare("INSERT INTO hr_offers (company_id, doc_no, doc_date, candidate_id, designation_id, grade, employment_type, ctc_annual, breakup_json, doj_proposed, valid_days, status, requested_by, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, 'hr_candidate', ?)")
          .run(actor.companyId, no, todayIST(), b.candidateId, b.designationId, grade, b.employmentType, units(b.ctcAnnual), JSON.stringify(bk), b.dojProposed, b.validDays, actor.user, actor.user, String(c.id)).lastInsertRowid);
        writeAudit(db, { entity: 'hr_offers', entityId: id, action: 'create', newValues: { docNo: no, candidateId: b.candidateId, ctcAnnual: bk.ctcAnnual }, actor: actor.user, companyId: actor.companyId });
        return b.submit ? offers.submit(actor, id, { comment: b.comment }) : offerView(actor, offerRow(actor, id));
      });
    },
    get(actor, id) { return { ...offerView(actor, offerRow(actor, id)), history: offerHistory(actor, id) }; },
    update(actor, id, b) {
      need(actor, 'hr.offer.edit', 'change offers');
      const o = offerRow(actor, id);
      if (!['DRAFT', 'RETURNED'].includes(o.status)) throw conflict(`An offer that is ${REQ_STATUS[o.status].toLowerCase()} is changed by an amendment.`);
      if (!offerMaker(actor, o)) throw forbidden(`Only ${o.created_by}, who made this offer, changes it.`);
      if (o.version !== b.version) throw conflict('This offer was changed by someone else. Reload it and try again.');
      const problems = []; checkOffer(actor, { ...b, candidateId: o.candidate_id }, problems, o);
      if (problems.length) throw badRequest('Some fields are not valid.', problems);
      const grade = b.grade ?? db.prepare('SELECT grade FROM org_designations WHERE id = ?').get(b.designationId)?.grade ?? null;
      db.prepare('UPDATE hr_offers SET designation_id = ?, grade = ?, employment_type = ?, ctc_annual = ?, breakup_json = ?, doj_proposed = ?, valid_days = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.designationId, grade, b.employmentType, units(b.ctcAnnual), JSON.stringify(breakup(actor.companyId, b.ctcAnnual)), b.dojProposed, b.validDays, actor.user, nowIso(), id);
      writeAudit(db, { entity: 'hr_offers', entityId: id, action: 'update', newValues: { ctcAnnual: b.ctcAnnual }, actor: actor.user, companyId: actor.companyId });
      return offerView(actor, offerRow(actor, id));
    },
    remove(actor, id) {
      need(actor, 'hr.offer.delete', 'delete offers');
      const o = offerRow(actor, id);
      if (o.status !== 'DRAFT') throw new HttpError(409, 'LOCKED', 'Only a draft is deleted; cancel or amend the others.');
      if (!offerMaker(actor, o)) throw forbidden(`Only ${o.created_by} deletes this draft.`);
      db.prepare('UPDATE hr_offers SET deleted_at = ?, deleted_by = ?, is_active = 0, version = version + 1 WHERE id = ?').run(nowIso(), actor.user, id);
      writeAudit(db, { entity: 'hr_offers', entityId: id, action: 'delete', actor: actor.user, companyId: actor.companyId });
      return { id, deleted: true };
    },
    submit(actor, id, { comment } = /** @type {any} */ ({})) {
      need(actor, 'hr.offer.submit', 'submit offers');
      const o = offerRow(actor, id);
      if (!['DRAFT', 'RETURNED'].includes(o.status)) throw conflict(`This offer is ${REQ_STATUS[o.status].toLowerCase()}.`);
      if (!offerMaker(actor, o)) throw forbidden(`Only ${o.created_by}, who made this offer, submits it.`);
      const c = db.prepare('SELECT * FROM hr_candidates WHERE id = ?').get(o.candidate_id);
      return transaction(db, () => {
        const bk = breakup(actor.companyId, rs(o.ctc_annual)); // recomputed on the server (the rules may have changed since the draft)
        const { band, reason } = offerBand(actor, o, c);
        const ctx = { band, bandReason: reason };
        if (o.status === 'RETURNED') workflowOf(db).resubmit(actor, o.workflow_instance_id, { comment: comment ?? 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: OFFER_DOC, docId: id, comment: comment ?? 'Offer', context: ctx, amendsDocId: o.supersedes_id ?? null }); db.prepare('UPDATE hr_offers SET workflow_instance_id = ? WHERE id = ?').run(inst?.id ?? null, id); }
        db.prepare("UPDATE hr_offers SET status = 'SUBMITTED', band = ?, band_reason = ?, breakup_json = ?, requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(band, reason, JSON.stringify(bk), actor.user, actor.user, nowIso(), id);
        writeAudit(db, { entity: 'hr_offers', entityId: id, action: 'submit', newValues: { band, reason }, reason: comment ?? null, actor: actor.user, companyId: actor.companyId });
        return offerView(actor, offerRow(actor, id));
      });
    },
    withdraw(actor, id, { reason }) {
      const o = offerRow(actor, id);
      if (o.status !== 'SUBMITTED') throw unprocessable('Only an offer in approval is withdrawn.');
      if (!offerMaker(actor, o)) throw forbidden('Only the person who made it withdraws it.');
      workflowOf(db).withdraw(actor, o.workflow_instance_id, { comment: reason });
      return offerView(actor, offerRow(actor, id));
    },
    cancel(actor, id, { reason }) {
      need(actor, 'hr.offer.cancel', 'cancel offers');
      const o = offerRow(actor, id);
      if (o.response !== 'NONE') throw unprocessable('The candidate has answered this offer.');
      if (o.status === 'APPROVED') {
        db.prepare("UPDATE hr_offers SET status = 'CANCELLED', token_hash = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), id);
        db.prepare("UPDATE hr_candidates SET stage = 'SELECTED', stage_at = ?, version = version + 1 WHERE id = ? AND stage = 'OFFERED'").run(nowIso(), o.candidate_id);
        writeAudit(db, { entity: 'hr_offers', entityId: id, action: 'cancel', reason, actor: actor.user, companyId: actor.companyId });
        return offerView(actor, offerRow(actor, id));
      }
      if (!['SUBMITTED', 'RETURNED'].includes(o.status)) throw unprocessable('Only an offer in approval, returned or approved is cancelled; delete a draft.');
      if (offerMaker(actor, o)) transaction(db, () => { workflowOf(db).abandon(actor.companyId, o.workflow_instance_id, actor.user, 'CANCELLED', reason); decisions.offer({ docId: o.id, status: 'CANCELLED' }, actor, 'CANCELLED', reason); });
      else workflowOf(db).cancel(actor, o.workflow_instance_id, { reason });
      return offerView(actor, offerRow(actor, id));
    },
    amend(actor, id, { reason }) {
      need(actor, 'hr.offer.amend', 'amend offers');
      const o = offerRow(actor, id);
      if (o.status !== 'APPROVED' || o.response !== 'NONE') throw unprocessable('Only an approved offer that the candidate has not answered is amended.');
      if (db.prepare("SELECT 1 FROM hr_offers WHERE company_id = ? AND doc_no = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL").get(o.company_id, o.doc_no)) throw new HttpError(409, 'PENDING_CHANGE', `An amendment of ${o.doc_no} is already open.`);
      return transaction(db, () => {
        const rev = db.prepare('SELECT MAX(revision_no) AS v FROM hr_offers WHERE company_id = ? AND doc_no = ?').get(o.company_id, o.doc_no).v + 1;
        const nid = Number(db.prepare("INSERT INTO hr_offers (company_id, doc_no, revision_no, supersedes_id, doc_date, candidate_id, designation_id, grade, employment_type, ctc_annual, breakup_json, doj_proposed, valid_days, status, requested_by, created_by, source_type, source_id, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, 'hr_candidate', ?, ?)")
          .run(o.company_id, o.doc_no, rev, o.id, todayIST(), o.candidate_id, o.designation_id, o.grade, o.employment_type, o.ctc_annual, o.breakup_json, o.doj_proposed, o.valid_days, actor.user, actor.user, String(o.candidate_id), reason).lastInsertRowid);
        writeAudit(db, { entity: 'hr_offers', entityId: nid, action: 'amend', newValues: { from: o.id, revision: rev }, reason, actor: actor.user, companyId: actor.companyId });
        return offerView(actor, offerRow(actor, nid));
      });
    },
    compare(actor, id) {
      const o = offerRow(actor, id);
      if (!o.supersedes_id) throw unprocessable('This is the first revision.');
      const a = offerView(actor, offerRow(actor, o.supersedes_id)); const b = offerView(actor, o);
      return { from: { id: a.id, revision: a.revision }, to: { id: b.id, revision: b.revision }, rows: [['ctcAnnual', 'CTC a year'], ['designation', 'Designation'], ['grade', 'Grade'], ['dojProposed', 'Joining'], ['employmentType', 'Type']].map(([k, l]) => ({ field: l, from: a[k], to: b[k], changed: String(a[k]) !== String(b[k]) })) };
    },
    /** The offer goes to the candidate as a link: the link carries a secret that is stored only as its hash; it is shown once, to HR. */
    send(actor, id) {
      need(actor, 'hr.offer.create', 'send offers');
      const o = offerRow(actor, id);
      if (o.status !== 'APPROVED') throw conflict('Only an approved offer is sent.');
      if (o.response !== 'NONE') throw conflict('The candidate has answered this offer.');
      const token = randomBytes(24).toString('base64url');
      const until = dayPlus(o.valid_days ?? param('hr.offer.validity_days', o.company_id) ?? 7);
      return transaction(db, () => {
        db.prepare('UPDATE hr_offers SET token_hash = ?, sent_at = ?, valid_until = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(sha(token), nowIso(), until, actor.user, nowIso(), id);
        db.prepare("UPDATE hr_candidates SET stage = 'OFFERED', stage_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ? AND stage = 'SELECTED'").run(nowIso(), actor.user, nowIso(), o.candidate_id);
        writeAudit(db, { entity: 'hr_offers', entityId: id, action: 'send', newValues: { validUntil: until }, actor: actor.user, companyId: actor.companyId });
        event('hr.candidate.stage_changed', actor, 'hr_candidate', o.candidate_id, o.company_id, { from: 'SELECTED', to: 'OFFERED' });
        return { link: `${baseUrl()}/offer-response?token=${token}`, validUntil: until, offer: offerView(actor, offerRow(actor, id)) };
      });
    },
    /** HR records an acceptance that came another way (a signed letter, a call): the note says how. */
    recordAcceptance(actor, id, { note }) {
      need(actor, 'hr.offer.create', 'record acceptances');
      const o = offerRow(actor, id);
      if (o.status !== 'APPROVED' || !o.sent_at || o.response !== 'NONE') throw conflict('Only a sent offer that is waiting for an answer is accepted.');
      return transaction(db, () => { markResponse(o, 'ACCEPTED', `${note} (recorded by ${actor.user})`, actor); return offerView(actor, offerRow(actor, id)); });
    },
    print(actor, id) {
      need(actor, 'hr.offer.print', 'print offers');
      const o = offerRow(actor, id);
      const v = offerView(actor, o);
      const c = db.prepare('SELECT full_name FROM hr_candidates WHERE id = ?').get(o.candidate_id);
      const co = db.prepare('SELECT legal_name FROM org_companies WHERE id = ?').get(o.company_id);
      writeAudit(db, { entity: 'hr_offers', entityId: id, action: 'print', actor: actor.user, companyId: actor.companyId });
      const e = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
      const rows = (v.breakup?.lines ?? []).map((l) => `<tr><td>${e(l.label)}</td><td class="n">${e(l.monthly)}</td><td class="n">${e(l.annual)}</td></tr>`).join('');
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${e(v.docNo)}</title><style>body{font:13px system-ui,sans-serif;margin:32px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:5px;text-align:left}.n{text-align:right}</style></head><body>
<h1>${e(co?.legal_name)}</h1><h2>Offer of employment ${e(v.docNo)}${v.revision > 1 ? ` (revision ${v.revision})` : ''}</h2><p>Dear ${e(c?.full_name)},</p><p>We are pleased to offer you the position of <strong>${e(v.designation)}</strong>${v.grade ? ` (grade ${e(v.grade)})` : ''} as a ${e(String(v.employmentType).toLowerCase())} employee, to join on <strong>${e(v.dojProposed)}</strong>, at a cost to company of <strong>₹${e(v.ctcAnnual)}</strong> a year.</p>
<table><thead><tr><th>Component</th><th>Monthly (₹)</th><th>Yearly (₹)</th></tr></thead><tbody>${rows}<tr><th>Cost to company</th><th class="n">${e(v.breakup?.ctcMonthly)}</th><th class="n">${e(v.breakup?.ctcAnnual)}</th></tr></tbody></table>
<p>${v.status === 'APPROVED' ? 'Approved' : 'Not yet approved'}${v.validUntil ? `; this offer is open until ${e(v.validUntil)}` : ''}.</p><p>Printed ${e(nowIso())} by ${e(actor.user)}.</p></body></html>`;
    },
  };
  function offerHistory(actor, id) {
    const o = offerRow(actor, id);
    const ids = db.prepare('SELECT id, workflow_instance_id FROM hr_offers WHERE company_id = ? AND doc_no = ?').all(o.company_id, o.doc_no);
    const approvals = ids.flatMap((v) => (v.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(v.workflow_instance_id).map((h) => ({ offerId: v.id, ...h })) : []));
    const audit = db.prepare(`SELECT action, actor, reason, created_at AS at, entity_id FROM core_audit_log WHERE entity = 'hr_offers' AND entity_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`).all(...ids.map((v) => String(v.id)));
    return { approvals, audit: audit.map((x) => ({ offerId: Number(x.entity_id), action: x.action, by: x.actor, reason: x.reason, at: x.at })) };
  }
  const offerScope = () => ({ scopeSql: 'o.company_id = :c', params: {} });
  const offerPresent = () => (o) => ({ id: o.id, docNo: o.doc_no, candidate: o.candidate_name, designation: o.designation_name, grade: o.grade, ctcAnnual: rs(o.ctc_annual), dojProposed: o.doj_proposed, band: o.band, status: o.status, response: o.response, updatedAt: o.updated_at ?? o.created_at });
  const offerSelect = 'o.*, c.full_name AS candidate_name, g.name AS designation_name';
  const offerRegister = {
    list(actor, query) { need(actor, 'hr.offer.view', 'see offers'); return runList(db, offerList, parseListRequest(offerList, query), { select: offerSelect, scopeSql: 'o.company_id = :c', params: { c: actor.companyId }, tieBreaker: 'o.id', map: offerPresent() }); },
    exportSource(actor, req) {
      need(actor, 'hr.offer.export', 'export offers');
      return { title: offerList.label, permission: 'hr.offer.export', personal: true, columns: Object.entries(offerList.columns).map(([key, c]) => ({ key, label: c.label, type: c.type === 'enum' ? 'text' : c.type })), count: () => countList(db, offerList, req, { scopeSql: 'o.company_id = :c', params: { c: actor.companyId } }),
        rows: () => runList(db, offerList, req, { select: offerSelect, scopeSql: 'o.company_id = :c', params: { c: actor.companyId }, tieBreaker: 'o.id', limit: null, map: offerPresent() }).data, describe: (x) => [x.q ? `search "${x.q}"` : '', ...x.filters.map((f) => `${offerList.columns[f.key].label} ${f.op} ${f.raw}`)].filter(Boolean).join('; ') };
    },
  };
  void offerScope;

  /** The candidate answers (or HR records it): the offer is accepted or declined, the pipeline moves and HR is told. */
  function markResponse(o, response, note, actor) {
    const now = nowIso();
    db.prepare('UPDATE hr_offers SET response = ?, responded_at = ?, response_note = ?, token_hash = CASE WHEN ? = \'DECLINED\' THEN NULL ELSE token_hash END, version = version + 1 WHERE id = ?').run(response, now, note ?? null, response, o.id);
    const c = db.prepare('SELECT * FROM hr_candidates WHERE id = ?').get(o.candidate_id);
    if (response === 'ACCEPTED') db.prepare("UPDATE hr_candidates SET stage = 'ACCEPTED', stage_at = ?, version = version + 1 WHERE id = ? AND stage = 'OFFERED'").run(now, c.id);
    else db.prepare("UPDATE hr_candidates SET stage = 'REJECTED', rejected_from = ?, reject_reason = ?, stage_at = ?, retention_until = ?, version = version + 1 WHERE id = ?").run(c.stage, `The candidate ${response === 'DECLINED' ? 'declined' : 'did not answer'} the offer`, now, dayPlus(Math.round((param('hr.candidate.retention_months', c.company_id) ?? 12) * 30.4375)), c.id);
    writeAudit(db, { entity: 'hr_offers', entityId: o.id, action: response.toLowerCase(), reason: note ?? null, actor: actor?.user ?? 'candidate', companyId: o.company_id });
    event(response === 'ACCEPTED' ? 'hr.offer.accepted' : 'hr.offer.declined', actor ?? { user: 'candidate' }, 'hr_offer', o.id, o.company_id, { docNo: o.doc_no, candidateId: c.id, response });
    const hrs = tasksOf(db).holders(o.company_id, ['HRMGR']);
    if (hrs.length) notif.notify({ companyId: o.company_id, templateCode: 'hr.recruit.offer_response', recipients: hrs.map((u) => `user:${u}`), data: { name: c.full_name, ref: o.doc_no, response: response.toLowerCase(), comment: note ? `: ${note}` : '' }, link: `/hr/recruitment/candidate?id=${c.id}`, sourceType: 'hr_offer', sourceId: String(o.id), eventKey: `hr.offer.response:${o.id}:${response}` });
  }
  const byToken = (token) => {
    const o = db.prepare("SELECT * FROM hr_offers WHERE token_hash = ? AND status = 'APPROVED' AND deleted_at IS NULL").get(sha(token));
    if (!o) throw notFound('This offer link is not valid any more. Ask the HR team for a new one.');
    return o;
  };
  /** The candidate's side, with no sign-in: the link is the proof (an unguessable secret stored only as a hash). */
  const link = {
    info(token) { return infoOf(byToken(token)); },
    respond(token, { action, comment }) {
      const o = byToken(token);
      if (o.response !== 'NONE') throw conflict('This offer has been answered already.');
      if (o.valid_until && o.valid_until < todayIST()) throw new HttpError(410, 'EXPIRED', `This offer was open until ${o.valid_until}. Ask the HR team for a new one.`);
      transaction(db, () => markResponse(o, action === 'ACCEPT' ? 'ACCEPTED' : 'DECLINED', comment ?? null, null));
      return infoOf(db.prepare('SELECT * FROM hr_offers WHERE id = ?').get(o.id));
    },
    prejoining(token, b) {
      const o = byToken(token);
      const c = db.prepare('SELECT * FROM hr_candidates WHERE id = ?').get(o.candidate_id);
      if (o.response !== 'ACCEPTED' || c.stage !== 'ACCEPTED') throw conflict('Accept the offer first; the details are asked for after that.');
      return transaction(db, () => storePrejoining(c, b, 'candidate'));
    },
  };
  function infoOf(o) {
    {
      const c = db.prepare('SELECT * FROM hr_candidates WHERE id = ?').get(o.candidate_id);
      const co = db.prepare('SELECT legal_name FROM org_companies WHERE id = ?').get(o.company_id);
      const expired = o.response === 'NONE' && o.valid_until && o.valid_until < todayIST();
      return { company: co?.legal_name, candidate: c.full_name, designation: orgName('org_designations', o.designation_id), grade: o.grade, employmentType: o.employment_type, dojProposed: o.doj_proposed, ctcAnnual: rs(o.ctc_annual), breakup: json(o.breakup_json, {}), validUntil: o.valid_until, response: expired ? 'EXPIRED' : o.response, canRespond: o.response === 'NONE' && !expired, canFillDetails: o.response === 'ACCEPTED' && c.stage === 'ACCEPTED', detailsDone: Boolean(c.profile_json && c.profile_json !== '{}'), docNo: o.doc_no };
    }
  }

  // ---- the joining checklist (FR-06) ----
  const taskView = (t) => ({ id: t.id, candidateId: t.candidate_id, employeeId: t.employee_id, code: t.task_code, title: t.title, role: t.assigned_role, departmentId: t.assigned_department_id, dueDate: t.due_date, status: t.task_status, completedAt: t.completed_at, completedBy: t.completed_by, note: t.note });
  function makeTasks(actor, c, employeeId, doj) {
    const list = param('hr.onboarding.checklist', c.company_id) ?? [];
    const made = [];
    for (const t of list) {
      const due = dayPlus(t.dueDays ?? 0, doj);
      const id = Number(db.prepare("INSERT INTO hr_onboarding_tasks (company_id, candidate_id, employee_id, task_code, title, assigned_role, due_date, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'hr_candidate', ?)").run(c.company_id, c.id, employeeId, t.code, t.title, t.role, due, actor.user, String(c.id)).lastInsertRowid);
      const holders = tasksOf(db).holders(c.company_id, [t.role]);
      try {
        const task = tasksOf(db).create({ companyId: c.company_id, title: `${t.title}: ${c.full_name} (joining ${doj})`, assignees: holders.slice(0, 3), dueDate: due, entity: 'hr_onboarding_task', entityId: id, origin: 'auto', source: { type: 'hr_onboarding_task', id }, actor: actor.user });
        if (task?.id) db.prepare('UPDATE hr_onboarding_tasks SET task_id = ? WHERE id = ?').run(task.id, id);
      } catch { /* the task engine could not route it (nobody holds the role): the checklist row stays and shows in the worklist */ }
      if (holders.length) notif.notify({ companyId: c.company_id, templateCode: 'hr.recruit.onboarding_due', recipients: holders.map((u) => `user:${u}`), data: { title: t.title, name: c.full_name, doj, due }, link: '/hr/onboarding', sourceType: 'hr_onboarding_task', sourceId: String(id), eventKey: `hr.recruit.onboarding_due:${id}` });
      made.push(id);
    }
    return made;
  }
  const rolesOf = (actor) => (Array.isArray(actor.roles) ? actor.roles : String(actor.roles ?? '').split(',')).map((r) => String(r).trim().toUpperCase());
  const mineTask = (actor, t) => may(actor, 'hr.candidate.edit') || rolesOf(actor).includes(t.assigned_role);
  const onboarding = {
    list(actor, { status, candidateId } = /** @type {any} */ ({})) {
      need(actor, 'hr.onboarding.view', 'see the joining checklist');
      const where = ['t.company_id = ?', 't.deleted_at IS NULL']; const args = [actor.companyId];
      if (status) { where.push('t.task_status = ?'); args.push(status); }
      if (candidateId) { where.push('t.candidate_id = ?'); args.push(candidateId); }
      const today = todayIST();
      const rows = db.prepare(`SELECT t.*, c.full_name, c.joined_on, e.emp_code, e.record_status AS emp_status, e.user_id FROM hr_onboarding_tasks t JOIN hr_candidates c ON c.id = t.candidate_id LEFT JOIN hr_employees e ON e.id = t.employee_id WHERE ${where.join(' AND ')} ORDER BY t.task_status, t.due_date, t.id LIMIT 500`).all(...args)
        .filter((t) => mineTask(actor, t)).map((t) => ({ ...taskView(t), candidate: t.full_name, joinedOn: t.joined_on, employeeCode: t.emp_code, employeeApproved: t.emp_status === 'APPROVED', hasUser: Boolean(t.user_id), overdue: t.task_status === 'OPEN' && t.due_date < today, daysLate: t.task_status === 'OPEN' && t.due_date < today ? Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${t.due_date}T00:00:00Z`)) / 86_400_000) : 0, tone: t.task_status !== 'OPEN' ? 'neutral' : t.due_date < today ? 'error' : t.due_date === today ? 'warning' : 'neutral', canComplete: t.task_status === 'OPEN' && may(actor, 'hr.onboarding.complete') }));
      const counts = { open: rows.filter((r) => r.status === 'OPEN').length, overdue: rows.filter((r) => r.overdue).length, done: rows.filter((r) => r.status !== 'OPEN').length };
      return { rows, counts };
    },
    complete(actor, id, { note, waive }) {
      need(actor, 'hr.onboarding.complete', 'complete joining tasks');
      const t = db.prepare('SELECT * FROM hr_onboarding_tasks WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId);
      if (!t || !mineTask(actor, t)) throw notFound('That task does not exist.');
      if (t.task_status !== 'OPEN') throw conflict('This task is already closed.');
      if (waive && !may(actor, 'hr.candidate.edit')) throw forbidden('Only HR waives a task.');
      if (waive && (!note || note.length < 5)) throw badRequest('Say why (at least 5 characters).', [{ field: 'note', message: 'Say why the task is waived' }]);
      db.prepare('UPDATE hr_onboarding_tasks SET task_status = ?, completed_at = ?, completed_by = ?, note = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(waive ? 'WAIVED' : 'DONE', nowIso(), actor.user, note ?? null, actor.user, nowIso(), id);
      if (t.task_id && !waive) { try { tasksOf(db).act(actor, t.task_id, 'complete', { reason: note ?? 'Done' }); } catch { /* the linked task was closed another way */ } }
      writeAudit(db, { entity: 'hr_onboarding_tasks', entityId: id, action: waive ? 'waive' : 'complete', reason: note ?? null, actor: actor.user, companyId: actor.companyId });
      return taskView(db.prepare('SELECT * FROM hr_onboarding_tasks WHERE id = ?').get(id));
    },
  };

  // ---- the daily cycle: offers that lapsed, rejected candidates past the retention (BR-03) ----
  function cycle(companyId, { today = todayIST() } = {}) {
    const out = { offersExpired: 0, anonymised: 0 };
    for (const o of db.prepare("SELECT * FROM hr_offers WHERE company_id = ? AND status = 'APPROVED' AND response = 'NONE' AND sent_at IS NOT NULL AND valid_until < ? AND deleted_at IS NULL").all(companyId, today)) {
      transaction(db, () => {
        db.prepare("UPDATE hr_offers SET response = 'EXPIRED', token_hash = NULL, responded_at = ?, version = version + 1 WHERE id = ?").run(nowIso(), o.id);
        db.prepare("UPDATE hr_candidates SET stage = 'SELECTED', stage_at = ?, version = version + 1 WHERE id = ? AND stage = 'OFFERED'").run(nowIso(), o.candidate_id);
        writeAudit(db, { entity: 'hr_offers', entityId: o.id, action: 'expire', actor: 'system', companyId });
      });
      out.offersExpired += 1;
    }
    for (const c of db.prepare("SELECT * FROM hr_candidates WHERE company_id = ? AND stage = 'REJECTED' AND retention_until IS NOT NULL AND retention_until < ? AND anonymised_at IS NULL AND deleted_at IS NULL").all(companyId, today)) {
      db.prepare("UPDATE hr_candidates SET full_name = 'Removed after the retention period', mobile = '0000000000', email = NULL, source_detail = NULL, resume_file_id = NULL, current_ctc = NULL, expected_ctc = NULL, profile_json = '{}', sensitive_enc = NULL, reject_reason = NULL, anonymised_at = ?, updated_by = 'system', updated_at = ?, version = version + 1 WHERE id = ?").run(nowIso(), nowIso(), c.id);
      writeAudit(db, { entity: 'hr_candidates', entityId: c.id, action: 'anonymise', reason: `Retention period ended on ${c.retention_until}`, actor: 'system', companyId });
      out.anonymised += 1;
    }
    return out;
  }

  // ---- approval decisions ----
  const decisions = {
    requisition(instance, actor, outcome, comment) {
      const r = db.prepare('SELECT * FROM hr_requisitions WHERE id = ?').get(Number(instance.docId));
      if (!r || !['SUBMITTED', 'RETURNED'].includes(r.status)) return;
      const now = nowIso();
      if (outcome === 'APPROVED') {
        if (r.supersedes_id) db.prepare("UPDATE hr_requisitions SET status = 'SUPERSEDED', updated_at = ?, version = version + 1 WHERE id = ? AND status = 'APPROVED'").run(now, r.supersedes_id);
        db.prepare("UPDATE hr_requisitions SET status = 'APPROVED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, r.id);
        event('hr.requisition.approved', actor, 'hr_requisition', r.id, r.company_id, { docNo: r.doc_no, revision: r.revision_no, positions: r.positions, departmentId: r.department_id, designationId: r.designation_id, band: r.band }, r.project_id);
      } else {
        const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN';
        db.prepare('UPDATE hr_requisitions SET status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED', actor.user, now, r.id);
        if (withdrawn) db.prepare('UPDATE hr_requisitions SET workflow_instance_id = NULL WHERE id = ?').run(r.id);
      }
      writeAudit(db, { entity: 'hr_requisitions', entityId: r.id, action: outcome.toLowerCase(), reason: comment ?? null, actor: actor.user, companyId: r.company_id });
      tell(r.company_id, r.requested_by ?? r.created_by, 'Requisition', r.doc_no, orgName('org_designations', r.designation_id) ?? '', outcome === 'RETURNED' ? 'returned for correction' : outcome === 'APPROVED' ? 'approved' : outcome === 'REJECTED' ? 'rejected' : 'cancelled', comment, `/hr/requisitions/requisition?id=${r.id}`);
    },
    offer(instance, actor, outcome, comment) {
      const o = db.prepare('SELECT * FROM hr_offers WHERE id = ?').get(Number(instance.docId));
      if (!o || !['SUBMITTED', 'RETURNED'].includes(o.status)) return;
      const now = nowIso();
      if (outcome === 'APPROVED') {
        if (o.supersedes_id) db.prepare("UPDATE hr_offers SET status = 'SUPERSEDED', token_hash = NULL, version = version + 1 WHERE id = ? AND status = 'APPROVED'").run(o.supersedes_id);
        db.prepare("UPDATE hr_offers SET status = 'APPROVED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, o.id);
        event('hr.offer.approved', actor, 'hr_offer', o.id, o.company_id, { docNo: o.doc_no, candidateId: o.candidate_id, band: o.band });
      } else {
        const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN';
        db.prepare('UPDATE hr_offers SET status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED', actor.user, now, o.id);
        if (withdrawn) db.prepare('UPDATE hr_offers SET workflow_instance_id = NULL WHERE id = ?').run(o.id);
      }
      writeAudit(db, { entity: 'hr_offers', entityId: o.id, action: outcome.toLowerCase(), reason: comment ?? null, actor: actor.user, companyId: o.company_id });
      tell(o.company_id, o.requested_by ?? o.created_by, 'Offer', o.doc_no, db.prepare('SELECT full_name FROM hr_candidates WHERE id = ?').get(o.candidate_id)?.full_name ?? '', outcome === 'RETURNED' ? 'returned for correction' : outcome === 'APPROVED' ? 'approved' : outcome === 'REJECTED' ? 'rejected' : 'cancelled', comment, `/hr/offers/offer?id=${o.id}`);
    },
  };

  return { plans, planCheck, requisitions, reqRegister, candidates, interviews, offers, offerRegister, link, onboarding, decisions, cycle, breakup, systemActor };
}

const services = new WeakMap();
export const bindRecruitment = (db, s) => services.set(db, s);
export const recruitmentOf = (db) => services.get(db) ?? null;

const step = (code, name, roles, when = null) => ({ code, name, type: 'approval', mode: 'single', approvers: roles.map((role) => ({ kind: 'role', role })), slaHours: 48, requireAttachment: false, checklist: [], when, notify: [], action: null });
const hooks = (fn) => ({
  onApproved: (db, { instance, actor }) => recruitmentOf(db)?.decisions[fn](instance, actor, 'APPROVED'),
  onRejected: (db, { instance, actor, comment }) => recruitmentOf(db)?.decisions[fn](instance, actor, 'REJECTED', comment),
  onReturned: (db, { instance, actor, comment }) => recruitmentOf(db)?.decisions[fn](instance, actor, 'RETURNED', comment),
  onCancelled: (db, { instance, actor, comment }) => recruitmentOf(db)?.decisions[fn](instance, actor, 'CANCELLED', comment),
});
workflowTypes.register({
  docType: REQ_DOC, label: 'Manpower requisition', processOwner: 'HRMGR', route: (id) => `/hr/requisitions/requisition?id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT doc_no, revision_no, designation_id, requested_by, created_by, project_id FROM hr_requisitions WHERE id = ? AND company_id = ?').get(Number(id), companyId); return r ? { ref: `${r.doc_no}/r${r.revision_no}`, title: db.prepare('SELECT name FROM org_designations WHERE id = ?').get(r.designation_id)?.name ?? '', originator: r.requested_by ?? r.created_by, projectId: r.project_id ?? null } : null; },
  summarise(db, _actor, id) {
    const r = db.prepare('SELECT * FROM hr_requisitions WHERE id = ?').get(Number(id)); if (!r) return null;
    const plan = json(r.plan_json, {});
    return { fields: [{ label: 'Requisition', value: `${r.doc_no} revision ${r.revision_no}` }, { label: 'Department', value: db.prepare('SELECT name FROM org_departments WHERE id = ?').get(r.department_id)?.name ?? '—' }, { label: 'Designation', value: db.prepare('SELECT name FROM org_designations WHERE id = ?').get(r.designation_id)?.name ?? '—' }, { label: 'Positions', value: `${r.positions} (${r.reason === 'NEW' ? 'new' : 'replacement'})` }, { label: 'CTC range', value: `${rs(r.ctc_min)} to ${rs(r.ctc_max)} a year` }, { label: 'Required by', value: r.required_by }, { label: 'Against the plan', value: `${r.band === 'BEYOND_PLAN' ? 'beyond' : 'within'} (planned ${plan.planned ?? '—'}, in post ${plan.filled ?? '—'}, open ${plan.open ?? '—'})` }, { label: 'Why', value: r.justification ?? '—' }] };
  },
  defaultDefinition: { name: 'Requisition: department or project head, HR manager, the director beyond the plan', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('HEAD', 'Department or project head', ['PM', 'PD']), step('HRMGR', 'HR manager', ['HRMGR']), step('DIR', 'Director (beyond the headcount plan)', ['DIR'], { field: 'band', op: 'eq', value: 'BEYOND_PLAN' })] },
  hooks: hooks('requisition'),
});
workflowTypes.register({
  docType: OFFER_DOC, label: 'Offer', processOwner: 'HRMGR', route: (id) => `/hr/offers/offer?id=${id}`,
  describe(db, companyId, id) { const o = db.prepare('SELECT o.doc_no, o.revision_no, o.requested_by, o.created_by, c.full_name FROM hr_offers o JOIN hr_candidates c ON c.id = o.candidate_id WHERE o.id = ? AND o.company_id = ?').get(Number(id), companyId); return o ? { ref: `${o.doc_no}/r${o.revision_no}`, title: o.full_name, originator: o.requested_by ?? o.created_by } : null; },
  summarise(db, _actor, id) {
    const o = db.prepare('SELECT o.*, c.full_name, c.requisition_id, c.expected_ctc FROM hr_offers o JOIN hr_candidates c ON c.id = o.candidate_id WHERE o.id = ?').get(Number(id)); if (!o) return null;
    const r = db.prepare('SELECT doc_no, ctc_min, ctc_max FROM hr_requisitions WHERE id = ?').get(o.requisition_id);
    return { fields: [{ label: 'Offer', value: `${o.doc_no} revision ${o.revision_no}` }, { label: 'Candidate', value: o.full_name }, { label: 'Designation', value: `${db.prepare('SELECT name FROM org_designations WHERE id = ?').get(o.designation_id)?.name ?? '—'}${o.grade ? ` (${o.grade})` : ''}` }, { label: 'CTC a year', value: rs(o.ctc_annual) }, { label: 'Requisition range', value: r ? `${r.doc_no}: ${rs(r.ctc_min)} to ${rs(r.ctc_max)}` : '—' }, { label: 'Candidate expects', value: rs(o.expected_ctc) ?? '—' }, { label: 'Joining', value: o.doj_proposed }, { label: 'Director needed because', value: o.band === 'DIR' ? o.band_reason : 'not needed' }] };
  },
  defaultDefinition: { name: 'Offer: HR manager, the director above the range or for a senior grade', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('HRMGR', 'HR manager', ['HRMGR']), step('DIR', 'Director (above the range or a senior grade)', ['DIR'], { field: 'band', op: 'eq', value: 'DIR' })] },
  hooks: hooks('offer'),
});
evidenceProviders.register(REQ_DOC, ({ db, instance }) => {
  const r = db.prepare('SELECT * FROM hr_requisitions WHERE id = ?').get(Number(instance.docId)); if (!r) return { sections: [] };
  const p = json(r.plan_json, {});
  return { sections: [{ code: 'hr-requisition', title: 'Before approving', kind: 'metrics', items: [{ label: 'Positions asked / planned', value: `${r.positions} / ${p.planned ?? 'no plan'}`, format: 'text', tone: r.band === 'BEYOND_PLAN' ? 'warn' : undefined }, { label: 'People in post in this designation', value: p.filled ?? '—', format: 'text' }, { label: 'Other open positions', value: p.open ?? '—', format: 'text' }, { label: 'Headroom after this', value: p.headroom != null ? p.headroom - r.positions : '—', format: 'text', tone: r.band === 'BEYOND_PLAN' ? 'warn' : undefined }] }] };
});
evidenceProviders.register(OFFER_DOC, ({ db, instance }) => {
  const o = db.prepare('SELECT o.*, c.expected_ctc, c.current_ctc, c.requisition_id FROM hr_offers o JOIN hr_candidates c ON c.id = o.candidate_id WHERE o.id = ?').get(Number(instance.docId)); if (!o) return { sections: [] };
  const r = db.prepare('SELECT ctc_min, ctc_max FROM hr_requisitions WHERE id = ?').get(o.requisition_id);
  const peers = db.prepare("SELECT COUNT(*) AS n FROM hr_employees WHERE company_id = ? AND designation_id = ? AND record_status = 'APPROVED' AND employment_status IN ('ACTIVE', 'NOTICE') AND deleted_at IS NULL").get(o.company_id, o.designation_id).n;
  return { sections: [{ code: 'hr-offer', title: 'Before approving', kind: 'metrics', items: [{ label: 'Offered CTC (a year)', value: rs(o.ctc_annual), format: 'text' }, { label: 'Requisition range', value: r ? `${rs(r.ctc_min)} to ${rs(r.ctc_max)}` : '—', format: 'text', tone: r && o.ctc_annual > r.ctc_max ? 'warn' : undefined }, { label: 'Candidate: current / expected', value: `${rs(o.current_ctc) ?? '—'} / ${rs(o.expected_ctc) ?? '—'}`, format: 'text' }, { label: 'Employees in this designation now', value: peers, format: 'text' }, { label: 'Why the director', value: o.band === 'DIR' ? o.band_reason : 'not needed', format: 'text' }] }] };
});
objectTypes.register({
  type: 'hr_requisition', label: 'Manpower requisition', permission: 'hr.requisition.view', route: (id) => `/hr/requisitions/requisition?id=${id}`,
  access(db, actor, id) { const s = recruitmentOf(db); if (!s) return null; try { const r = s.requisitions.get(actor, Number(id)); return { companyId: actor.companyId, projectId: r.projectId ?? null, siteId: r.siteId ?? null, status: r.status }; } catch { return null; } },
  auditEntities: (id) => [{ entity: 'hr_requisitions', id }],
  summary(db, actor, id) { const s = recruitmentOf(db); if (!s) return null; try { const r = s.requisitions.get(actor, Number(id)); return { label: `${r.docNo} ${r.designation ?? ''}`, status: r.status }; } catch { return null; } },
  search(db, actor, q, limit) { if (!authzOf(db).check(actor, 'hr.requisition.view_all').allowed) return []; return db.prepare("SELECT id FROM hr_requisitions WHERE company_id = ? AND deleted_at IS NULL AND status != 'SUPERSEDED' AND doc_no LIKE ? ORDER BY id DESC LIMIT ?").all(actor.companyId, `${q}%`, limit); },
});
objectTypes.register({
  type: 'hr_candidate', label: 'Candidate', permission: 'hr.candidate.view', route: (id) => `/hr/recruitment/candidate?id=${id}`,
  access(db, actor, id) { const s = recruitmentOf(db); if (!s) return null; try { const c = s.candidates.get(actor, Number(id)); return { companyId: actor.companyId, projectId: null, siteId: null, status: c.stage }; } catch { return null; } },
  auditEntities: (id) => [{ entity: 'hr_candidates', id }],
  summary(db, actor, id) { const s = recruitmentOf(db); if (!s) return null; try { const c = s.candidates.get(actor, Number(id)); return { label: c.name, status: c.stage }; } catch { return null; } },
  search(db, actor, q, limit) { if (!authzOf(db).check(actor, 'hr.candidate.view').allowed) return []; return db.prepare("SELECT id FROM hr_candidates WHERE company_id = ? AND deleted_at IS NULL AND anonymised_at IS NULL AND (full_name LIKE ? OR mobile LIKE ?) ORDER BY full_name LIMIT ?").all(actor.companyId, `%${q}%`, `${q}%`, limit); },
});
fileEntities.register({
  entity: 'hr_candidate', label: 'Candidate (resume, identity and joining documents)',
  resolve(db, actor, id) {
    const c = db.prepare('SELECT company_id FROM hr_candidates WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId);
    if (!c) return null;
    const a = authzOf(db);
    return { companyId: c.company_id, projectId: null, siteId: null, canView: a.check(actor, 'hr.candidate.view').allowed, canEdit: a.check(actor, 'hr.candidate.edit').allowed, locked: false };
  },
});
void nameKey;
