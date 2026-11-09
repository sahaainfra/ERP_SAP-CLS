import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { HttpError, badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { objectTypes } from '../../platform/objects/index.js';
import { createParameterStore } from '../../platform/parameters/index.js';
import { evidenceProviders, workflowOf, workflowResolvers, workflowTypes } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { DEP_STATUS } from './deployments.js';

// Transfers and secondments (part 07.03, FR-02). A transfer moves an employee from the place they are posted to another site or project: the relieving date is their last day at the old place, the joining date
// the first day at the new one, with a handover checklist the relieving manager ticks and flags for travel and accommodation. It is approved by the current project manager, the receiving project manager (when it
// crosses projects) and the HR manager. On approval the transfer ends the old primary deployment on the relieving date and gives the new deployment from the joining date: the chain of the transfer is the
// approval of that deployment, so access and messaging groups follow through the same events. An approved transfer that has not taken effect is undone by cancelling it; one that has is reversed by a new transfer.
export const TRF_DOC = 'HR_TRANSFER';
export const KIND_LABELS = { TRANSFER: 'Transfer', SECONDMENT: 'Secondment' };
const nowIso = () => new Date().toISOString();
const json = (s, d) => { try { return JSON.parse(s ?? ''); } catch { return d; } };
const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();

export const transferList = defineList({
  code: 'hr.transfers', label: 'Transfers', permission: 'hr.transfer.view',
  from: 'hr_transfers t JOIN hr_employees e ON e.id = t.employee_id LEFT JOIN org_projects fp ON fp.id = t.from_project_id LEFT JOIN org_sites fs ON fs.id = t.from_site_id LEFT JOIN org_projects tp ON tp.id = t.to_project_id LEFT JOIN org_sites ts ON ts.id = t.to_site_id',
  where: "t.deleted_at IS NULL AND t.status != 'SUPERSEDED'", searchable: ['t.doc_no', 'e.full_name', 'e.emp_code', 'tp.name', 'ts.name'], defaultSort: '-docNo',
  columns: {
    docNo: { sql: 't.doc_no', type: 'text', label: 'Transfer' }, revision: { sql: 't.revision_no', type: 'number', label: 'Revision' }, employee: { sql: 'e.full_name', type: 'text', label: 'Employee' }, code: { sql: 'e.emp_code', type: 'text', label: 'Code' },
    kind: { sql: 't.kind', type: 'enum', label: 'Kind', options: Object.entries(KIND_LABELS) }, fromProject: { sql: 'fp.name', type: 'text', label: 'From project' }, fromSite: { sql: 'fs.name', type: 'text', label: 'From site' },
    toProject: { sql: 'tp.name', type: 'text', label: 'To project' }, toSite: { sql: 'ts.name', type: 'text', label: 'To site' }, relieveDate: { sql: 't.relieve_date', type: 'date', label: 'Relieving' }, joinDate: { sql: 't.join_date', type: 'date', label: 'Joining' },
    travel: { sql: 't.travel_required', type: 'enum', label: 'Travel', options: [['1', 'Needed'], ['0', 'Not needed']] }, accommodation: { sql: 't.accommodation_required', type: 'enum', label: 'Accommodation', options: [['1', 'Needed'], ['0', 'Not needed']] },
    status: { sql: 't.status', type: 'enum', label: 'Status', options: Object.entries(DEP_STATUS) }, updatedAt: { sql: 'COALESCE(t.updated_at, t.created_at)', type: 'datetime', label: 'Changed' },
  },
});

export function createTransferService({ db, dep }) {
  const authz = authzOf(db);
  const { may, need, orgName, nextDoc, tell, event, announce, personOf, primaryClash, usernameOf, myEmployee, root } = dep;
  const needIn = (actor, key, what, t) => { if (!mayIn(actor, key, t)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const maker = (actor, r) => same(r.created_by, actor.user);
  const scopeFrom = (t) => ({ projectId: t.from_project_id ?? undefined, siteId: t.from_site_id ?? undefined });
  const scopeTo = (t) => ({ projectId: t.to_project_id, siteId: t.to_site_id ?? undefined });
  const mayIn = (actor, key, t) => may(actor, key, scopeTo(t)) || (t.from_project_id != null && may(actor, key, scopeFrom(t)));
  const row = (actor, id) => {
    const t = db.prepare('SELECT * FROM hr_transfers WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId);
    if (!t || !(mayIn(actor, 'hr.transfer.view', t) || maker(actor, t) || (t.status === 'APPROVED' && myEmployee(actor) === t.employee_id))) throw notFound('That transfer does not exist.');
    return t;
  };
  const empName = (id) => db.prepare('SELECT full_name AS n, emp_code AS c FROM hr_employees WHERE id = ?').get(id);

  /** Where the employee is posted on the day: their primary deployment in force, else the place on the employee master. */
  function currentPlace(companyId, employeeId, date) {
    const d = db.prepare("SELECT dep_project_id AS project_id, dep_site_id AS site_id, id, doc_no, site_role FROM hr_deployments WHERE company_id = ? AND person_type = 'EMPLOYEE' AND person_id = ? AND is_primary = 1 AND status = 'APPROVED' AND deleted_at IS NULL AND from_date <= ? AND (to_date IS NULL OR to_date >= ?) ORDER BY from_date DESC LIMIT 1").get(companyId, employeeId, date, date);
    if (d) return { projectId: d.project_id, siteId: d.site_id, deploymentId: d.id, docNo: d.doc_no, siteRole: d.site_role };
    const e = db.prepare('SELECT project_id, site_id FROM hr_employees WHERE id = ?').get(employeeId);
    return { projectId: e?.project_id ?? null, siteId: e?.site_id ?? null, deploymentId: null, docNo: null, siteRole: null };
  }
  const checklist = (companyId) => { const l = createParameterStore(db).get('hr.transfer.handover_checklist', { companyId, date: todayIST() }); return (Array.isArray(l) ? l : []).map((i) => ({ code: String(i.code), title: String(i.title), done: false, doneBy: null, doneAt: null, note: null })); };

  function view(actor, t) {
    const e = empName(t.employee_id);
    const items = json(t.handover_json, []);
    const done = items.filter((i) => i.done).length;
    const mine = (key) => mayIn(actor, key, t);
    return {
      id: t.id, docNo: t.doc_no, revision: t.revision_no, supersedesId: t.supersedes_id, docDate: t.doc_date, status: t.status, statusLabel: DEP_STATUS[t.status], rowVersion: t.version, kind: t.kind, kindLabel: KIND_LABELS[t.kind],
      employeeId: t.employee_id, employee: e?.n ?? null, employeeCode: e?.c ?? null, fromProjectId: t.from_project_id, fromProject: orgName('org_projects', t.from_project_id), fromSiteId: t.from_site_id, fromSite: orgName('org_sites', t.from_site_id),
      toProjectId: t.to_project_id, toProject: orgName('org_projects', t.to_project_id), toSiteId: t.to_site_id, toSite: orgName('org_sites', t.to_site_id), toCrewId: t.to_crew_id, toCrew: orgName('hr_crews', t.to_crew_id), siteRole: t.site_role,
      relieveDate: t.relieve_date, joinDate: t.join_date, returnDate: t.return_date, reason: t.reason, travelRequired: t.travel_required === 1, accommodationRequired: t.accommodation_required === 1, scope: t.scope,
      handover: items, handoverDone: done, handoverTotal: items.length, workflowInstanceId: t.workflow_instance_id, requestedBy: t.requested_by, createdBy: t.created_by, closedReason: t.closed_reason, appliedAt: t.applied_at,
      deployments: t.status === 'APPROVED' ? db.prepare('SELECT id, doc_no AS docNo, status FROM hr_deployments WHERE transfer_id = ? AND deleted_at IS NULL ORDER BY id').all(t.id) : [],
      effective: t.status === 'APPROVED' && t.join_date <= todayIST(),
      can: {
        edit: ['DRAFT', 'RETURNED'].includes(t.status) && maker(actor, t) && mine('hr.transfer.edit'), submit: ['DRAFT', 'RETURNED'].includes(t.status) && maker(actor, t) && mine('hr.transfer.submit'), delete: t.status === 'DRAFT' && maker(actor, t) && mine('hr.transfer.delete'),
        withdraw: t.status === 'SUBMITTED' && maker(actor, t), cancel: ['SUBMITTED', 'RETURNED', 'APPROVED'].includes(t.status) && mine('hr.transfer.cancel'), amend: t.status === 'APPROVED' && t.join_date > todayIST() && mine('hr.transfer.amend'),
        handover: !['DRAFT', 'REJECTED', 'CANCELLED', 'SUPERSEDED'].includes(t.status) && (mine('hr.transfer.edit') || maker(actor, t)), print: mine('hr.transfer.print'),
      },
    };
  }
  const BODY = ['employee_id', 'kind', 'to_project_id', 'to_site_id', 'to_crew_id', 'site_role', 'relieve_date', 'join_date', 'return_date', 'reason', 'travel_required', 'accommodation_required'];
  const bodyCols = (b) => [b.employeeId, b.kind, b.toProjectId, b.toSiteId ?? null, b.toCrewId ?? null, b.siteRole ?? null, b.relieveDate, b.joinDate, b.returnDate ?? null, b.reason, b.travelRequired ? 1 : 0, b.accommodationRequired ? 1 : 0];
  const rowToB = (t) => ({ employeeId: t.employee_id, kind: t.kind, toProjectId: t.to_project_id, toSiteId: t.to_site_id, toCrewId: t.to_crew_id, siteRole: t.site_role, relieveDate: t.relieve_date, joinDate: t.join_date, returnDate: t.return_date, reason: t.reason, travelRequired: t.travel_required === 1, accommodationRequired: t.accommodation_required === 1 });
  function check(actor, b, problems) {
    const p = personOf(actor.companyId, 'EMPLOYEE', b.employeeId);
    if (p.error) problems.push({ field: 'employeeId', message: p.error });
    const project = db.prepare('SELECT id, status FROM org_projects WHERE id = ? AND company_id = ? AND is_active = 1').get(b.toProjectId, actor.companyId);
    if (!project) problems.push({ field: 'toProjectId', message: 'That project does not exist' });
    else if (['COMPLETED', 'CLOSED'].includes(project.status)) problems.push({ field: 'toProjectId', message: 'That project is closed; nobody is posted to it' });
    const site = b.toSiteId ? db.prepare('SELECT id, org_project_id AS pid FROM org_sites WHERE id = ? AND company_id = ? AND is_active = 1').get(b.toSiteId, actor.companyId) : null;
    if (b.toSiteId && !site) problems.push({ field: 'toSiteId', message: 'That site does not exist' });
    else if (site && site.pid !== b.toProjectId) problems.push({ field: 'toSiteId', message: 'That site belongs to another project' });
    if (b.toCrewId) {
      const crew = db.prepare('SELECT crew_site_id AS sid, active FROM hr_crews WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(b.toCrewId, actor.companyId);
      if (!crew || !b.toSiteId || crew.sid !== b.toSiteId) problems.push({ field: 'toCrewId', message: 'The crew is not at the receiving site' });
      else if (!crew.active) problems.push({ field: 'toCrewId', message: 'That crew is closed' });
    }
    if (b.relieveDate < todayIST()) problems.push({ field: 'relieveDate', message: 'The relieving date is today or later' });
    if (b.joinDate <= b.relieveDate) problems.push({ field: 'joinDate', message: 'The joining date is after the last day at the old place' });
    if (b.kind === 'SECONDMENT' && !b.returnDate) problems.push({ field: 'returnDate', message: 'A secondment says when the person returns' });
    if (b.returnDate && b.returnDate <= b.joinDate) problems.push({ field: 'returnDate', message: 'The return date is after the joining date' });
    if (b.kind === 'TRANSFER' && b.returnDate) problems.push({ field: 'returnDate', message: 'Only a secondment has a return date' });
    if (!problems.length) {
      const here = currentPlace(actor.companyId, b.employeeId, b.relieveDate);
      if (here.projectId === b.toProjectId && (here.siteId ?? null) === (b.toSiteId ?? null)) problems.push({ field: 'toSiteId', message: `${p.name} is already posted there` });
    }
    return p;
  }
  function history(actor, id) {
    const t = row(actor, id);
    const ids = db.prepare('SELECT id, workflow_instance_id FROM hr_transfers WHERE company_id = ? AND doc_no = ?').all(t.company_id, t.doc_no);
    const approvals = ids.flatMap((v) => (v.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(v.workflow_instance_id).map((h) => ({ transferId: v.id, ...h })) : []));
    const audit = db.prepare(`SELECT action, actor, reason, created_at AS at, entity_id FROM core_audit_log WHERE entity = 'hr_transfers' AND entity_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`).all(...ids.map((v) => String(v.id)));
    return { approvals, audit: audit.map((x) => ({ transferId: Number(x.entity_id), action: x.action, by: x.actor, reason: x.reason, at: x.at })) };
  }

  const transfers = {
    create(actor, b) {
      const here = currentPlace(actor.companyId, b.employeeId, b.relieveDate);
      const t0 = { from_project_id: here.projectId, from_site_id: here.siteId, to_project_id: b.toProjectId, to_site_id: b.toSiteId ?? null };
      if (!mayIn(actor, 'hr.transfer.create', t0)) throw forbidden('You may not raise transfers (permission hr.transfer.create) for these places.');
      const problems = []; check(actor, b, problems);
      if (problems.length) throw badRequest('Some fields are not valid.', problems);
      return transaction(db, () => {
        const no = nextDoc(actor, 'HR_TRANSFER', 'hr_transfers', 'TRF');
        const scope = here.projectId != null && here.projectId === b.toProjectId ? 'SAME_PROJECT' : 'CROSS_PROJECT';
        const id = Number(db.prepare(`INSERT INTO hr_transfers (company_id, doc_no, doc_date, from_project_id, from_site_id, scope, ${BODY.join(', ')}, handover_json, status, requested_by, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ${BODY.map(() => '?').join(', ')}, ?, 'DRAFT', ?, ?, ?, ?, 'hr_transfer')`)
          .run(actor.companyId, no, todayIST(), here.projectId, here.siteId, scope, ...bodyCols(b), JSON.stringify(checklist(actor.companyId)), actor.user, b.toProjectId, b.toSiteId ?? null, actor.user).lastInsertRowid);
        db.prepare('UPDATE hr_transfers SET root_id = id WHERE id = ?').run(id);
        writeAudit(db, { entity: 'hr_transfers', entityId: id, action: 'create', newValues: { docNo: no, employeeId: b.employeeId, toProjectId: b.toProjectId, toSiteId: b.toSiteId ?? null, relieveDate: b.relieveDate, joinDate: b.joinDate }, actor: actor.user, companyId: actor.companyId });
        return b.submit ? transfers.submit(actor, id, { comment: b.comment }) : view(actor, row(actor, id));
      });
    },
    get(actor, id) { return { ...view(actor, row(actor, id)), history: history(actor, id) }; },
    update(actor, id, b) {
      const t = row(actor, id);
      needIn(actor, 'hr.transfer.edit', 'change transfers', t);
      if (!['DRAFT', 'RETURNED'].includes(t.status)) throw conflict(`A transfer that is ${DEP_STATUS[t.status].toLowerCase()} is changed by an amendment.`);
      if (!maker(actor, t)) throw forbidden(`Only ${t.created_by}, who raised this transfer, changes it.`);
      if (t.version !== b.version) throw conflict('This transfer was changed by someone else. Reload it and try again.');
      const problems = []; check(actor, b, problems);
      if (problems.length) throw badRequest('Some fields are not valid.', problems);
      const here = currentPlace(actor.companyId, b.employeeId, b.relieveDate);
      const scope = here.projectId != null && here.projectId === b.toProjectId ? 'SAME_PROJECT' : 'CROSS_PROJECT';
      db.prepare(`UPDATE hr_transfers SET ${BODY.map((c) => `${c} = ?`).join(', ')}, from_project_id = ?, from_site_id = ?, scope = ?, project_id = ?, site_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`)
        .run(...bodyCols(b), here.projectId, here.siteId, scope, b.toProjectId, b.toSiteId ?? null, actor.user, nowIso(), id);
      writeAudit(db, { entity: 'hr_transfers', entityId: id, action: 'update', newValues: { toProjectId: b.toProjectId, relieveDate: b.relieveDate, joinDate: b.joinDate }, actor: actor.user, companyId: actor.companyId });
      return view(actor, row(actor, id));
    },
    remove(actor, id) {
      const t = row(actor, id);
      needIn(actor, 'hr.transfer.delete', 'delete transfers', t);
      if (t.status !== 'DRAFT') throw new HttpError(409, 'LOCKED', 'Only a draft is deleted; cancel or amend the others.');
      if (!maker(actor, t)) throw forbidden(`Only ${t.created_by} deletes this draft.`);
      db.prepare('UPDATE hr_transfers SET deleted_at = ?, deleted_by = ?, is_active = 0, version = version + 1 WHERE id = ?').run(nowIso(), actor.user, id);
      writeAudit(db, { entity: 'hr_transfers', entityId: id, action: 'delete', actor: actor.user, companyId: actor.companyId });
      return { id, deleted: true };
    },
    submit(actor, id, { comment } = /** @type {any} */ ({})) {
      const t = row(actor, id);
      needIn(actor, 'hr.transfer.submit', 'submit transfers', t);
      if (!['DRAFT', 'RETURNED'].includes(t.status)) throw conflict(`This transfer is ${DEP_STATUS[t.status].toLowerCase()}.`);
      if (!maker(actor, t)) throw forbidden(`Only ${t.created_by}, who raised this transfer, submits it.`);
      return transaction(db, () => {
        const problems = []; check(actor, rowToB(t), problems);
        if (problems.length) throw unprocessable(problems[0].message);
        // the place the person is posted may have changed since the draft
        const here = currentPlace(actor.companyId, t.employee_id, t.relieve_date);
        const scope = here.projectId != null && here.projectId === t.to_project_id ? 'SAME_PROJECT' : 'CROSS_PROJECT';
        db.prepare('UPDATE hr_transfers SET from_project_id = ?, from_site_id = ?, scope = ? WHERE id = ?').run(here.projectId, here.siteId, scope, id);
        const clash = primaryClash(actor.companyId, { personType: 'EMPLOYEE', personId: t.employee_id, from: t.join_date, to: t.return_date, statuses: ['APPROVED', 'SUBMITTED'] });
        if (clash && clash.from_date > t.relieve_date && !(t.supersedes_id && clash.transfer_id === t.supersedes_id)) throw unprocessable(`The employee has a primary deployment ${clash.doc_no} starting ${clash.from_date}, after the relieving date: end or cancel it first.`);
        const ctx = { scope, projectId: here.projectId ?? t.to_project_id, toProjectId: t.to_project_id, kind: t.kind };
        if (t.status === 'RETURNED') workflowOf(db).resubmit(actor, t.workflow_instance_id, { comment: comment ?? 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: TRF_DOC, docId: id, comment: comment ?? 'Transfer', context: ctx, amendsDocId: t.supersedes_id ?? null }); db.prepare('UPDATE hr_transfers SET workflow_instance_id = ? WHERE id = ?').run(inst.id, id); }
        db.prepare("UPDATE hr_transfers SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), id);
        writeAudit(db, { entity: 'hr_transfers', entityId: id, action: 'submit', newValues: { scope }, reason: comment ?? null, actor: actor.user, companyId: actor.companyId });
        return view(actor, row(actor, id));
      });
    },
    withdraw(actor, id, { reason }) {
      const t = row(actor, id);
      if (t.status !== 'SUBMITTED') throw unprocessable('Only a transfer in approval is withdrawn.');
      if (!maker(actor, t)) throw forbidden('Only the person who raised it withdraws it.');
      workflowOf(db).withdraw(actor, t.workflow_instance_id, { comment: reason });
      return view(actor, row(actor, id));
    },
    cancel(actor, id, { reason }) {
      const t = row(actor, id);
      needIn(actor, 'hr.transfer.cancel', 'cancel transfers', t);
      if (t.status === 'APPROVED') {
        if (t.join_date <= todayIST()) throw unprocessable('The person has already joined the new place: raise a new transfer to move them back.');
        return transaction(db, () => {
          reverse(actor, t);
          db.prepare("UPDATE hr_transfers SET status = 'CLOSED', closed_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), id);
          writeAudit(db, { entity: 'hr_transfers', entityId: id, action: 'close', reason, actor: actor.user, companyId: actor.companyId });
          return view(actor, row(actor, id));
        });
      }
      if (!['SUBMITTED', 'RETURNED'].includes(t.status)) throw unprocessable('Only a transfer in approval, returned or approved is cancelled; delete a draft.');
      if (maker(actor, t)) transaction(db, () => { workflowOf(db).abandon(actor.companyId, t.workflow_instance_id, actor.user, 'CANCELLED', reason); decisions.transfer({ docId: t.id, status: 'CANCELLED' }, actor, 'CANCELLED', reason); });
      else workflowOf(db).cancel(actor, t.workflow_instance_id, { reason });
      return view(actor, row(actor, id));
    },
    /** An approved transfer that has not taken effect is changed by a new revision approved again; when it is approved the earlier one is undone and the new one applied. */
    amend(actor, id, { reason }) {
      const t = row(actor, id);
      needIn(actor, 'hr.transfer.amend', 'amend transfers', t);
      if (t.status !== 'APPROVED') throw unprocessable('Only an approved transfer is amended.');
      if (t.join_date <= todayIST()) throw unprocessable('The person has already joined the new place: raise a new transfer instead.');
      if (db.prepare("SELECT 1 FROM hr_transfers WHERE company_id = ? AND doc_no = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL").get(t.company_id, t.doc_no)) throw new HttpError(409, 'PENDING_CHANGE', `An amendment of ${t.doc_no} is already open.`);
      return transaction(db, () => {
        const rev = db.prepare('SELECT MAX(revision_no) AS v FROM hr_transfers WHERE company_id = ? AND doc_no = ?').get(t.company_id, t.doc_no).v + 1;
        const nid = Number(db.prepare(`INSERT INTO hr_transfers (company_id, doc_no, revision_no, root_id, supersedes_id, doc_date, from_project_id, from_site_id, scope, ${BODY.join(', ')}, handover_json, status, requested_by, project_id, site_id, created_by, source_type, source_id, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${BODY.map(() => '?').join(', ')}, ?, 'DRAFT', ?, ?, ?, ?, 'hr_transfer', ?, ?)`)
          .run(t.company_id, t.doc_no, rev, root(t), t.id, todayIST(), t.from_project_id, t.from_site_id, t.scope, ...bodyCols(rowToB(t)), t.handover_json, actor.user, t.to_project_id, t.to_site_id, actor.user, String(t.id), reason).lastInsertRowid);
        writeAudit(db, { entity: 'hr_transfers', entityId: nid, action: 'amend', newValues: { from: t.id, revision: rev }, reason, actor: actor.user, companyId: actor.companyId });
        return view(actor, row(actor, nid));
      });
    },
    /** The relieving manager (or whoever keeps transfers) ticks the handover items; the tick is dated and signed. */
    handover(actor, id, { items }) {
      const t = row(actor, id);
      if (!view(actor, t).can.handover) throw forbidden('Only the people who keep this transfer tick its handover.');
      const cur = json(t.handover_json, []);
      for (const i of items) {
        const c = cur.find((x) => x.code === i.code);
        if (!c) throw badRequest('Some fields are not valid.', [{ field: 'items', message: `${i.code} is not on the checklist` }]);
        if (i.done && !c.done) { c.done = true; c.doneBy = actor.user; c.doneAt = nowIso(); } else if (!i.done && c.done) { c.done = false; c.doneBy = null; c.doneAt = null; }
        c.note = i.note ?? c.note;
      }
      db.prepare('UPDATE hr_transfers SET handover_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(cur), actor.user, nowIso(), id);
      writeAudit(db, { entity: 'hr_transfers', entityId: id, action: 'handover', newValues: { done: cur.filter((c) => c.done).length, total: cur.length }, actor: actor.user, companyId: actor.companyId });
      return view(actor, row(actor, id));
    },
    compare(actor, id) {
      const t = row(actor, id);
      if (!t.supersedes_id) throw unprocessable('This is the first revision.');
      const a = view(actor, row(actor, t.supersedes_id)); const b = view(actor, t);
      return { from: { id: a.id, revision: a.revision }, to: { id: b.id, revision: b.revision }, rows: [['toProject', 'To project'], ['toSite', 'To site'], ['toCrew', 'Crew'], ['siteRole', 'Role on site'], ['relieveDate', 'Relieving'], ['joinDate', 'Joining'], ['returnDate', 'Return'], ['travelRequired', 'Travel'], ['accommodationRequired', 'Accommodation']].map(([k, label]) => ({ field: k, label, before: a[k], after: b[k], changed: String(a[k]) !== String(b[k]) })) };
    },
    print(actor, id) {
      const t = row(actor, id);
      needIn(actor, 'hr.transfer.print', 'print transfers', t);
      const v = view(actor, t);
      writeAudit(db, { entity: 'hr_transfers', entityId: id, action: 'print', actor: actor.user, companyId: actor.companyId });
      const e = (s) => String(s ?? '—').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
      const rows = [['Employee', `${v.employee} (${v.employeeCode})`], ['Kind', v.kindLabel], ['From', [v.fromProject, v.fromSite].filter(Boolean).join(' / ') || '—'], ['To', [v.toProject, v.toSite].filter(Boolean).join(' / ')], ['Crew', v.toCrew], ['Last day at the old place', v.relieveDate], ['First day at the new place', v.joinDate], ['Return', v.returnDate], ['Reason', v.reason], ['Travel', v.travelRequired ? 'Needed' : 'Not needed'], ['Accommodation', v.accommodationRequired ? 'Needed' : 'Not needed'], ['Status', v.statusLabel]];
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${e(v.docNo)}</title><style>body{font:12px system-ui,sans-serif;margin:24px}table{border-collapse:collapse;width:100%;margin-bottom:12px}td,th{border:1px solid #999;padding:4px;text-align:left}th{width:30%}</style></head><body><h2>${e(v.kindLabel)} ${e(v.docNo)} (revision ${v.revision})</h2><table>${rows.map(([k, x]) => `<tr><th>${e(k)}</th><td>${e(x)}</td></tr>`).join('')}</table><h3>Handover</h3><table>${v.handover.map((i) => `<tr><td>${i.done ? '[x]' : '[ ]'} ${e(i.title)}</td><td>${e(i.doneBy)} ${e(i.doneAt?.slice(0, 10))}</td></tr>`).join('')}</table></body></html>`;
    },
  };

  // ---- the effect of an approved transfer: the old primary deployment ends, the new one starts ----
  function apply(actor, t) {
    const prior = [];
    const open = db.prepare("SELECT * FROM hr_deployments WHERE company_id = ? AND person_type = 'EMPLOYEE' AND person_id = ? AND is_primary = 1 AND status = 'APPROVED' AND deleted_at IS NULL AND from_date <= ? AND (to_date IS NULL OR to_date >= ?)").all(t.company_id, t.employee_id, t.relieve_date, t.relieve_date);
    for (const d of open) {
      prior.push({ id: d.id, toDate: d.to_date });
      db.prepare('UPDATE hr_deployments SET to_date = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(t.relieve_date, actor.user, nowIso(), d.id);
      writeAudit(db, { entity: 'hr_deployments', entityId: d.id, action: 'end_by_transfer', newValues: { toDate: t.relieve_date, transfer: t.doc_no }, actor: actor.user, companyId: t.company_id });
      announce(actor, { ...d, to_date: t.relieve_date }, t.relieve_date < todayIST() ? 'ENDED' : 'CHANGED');
    }
    const clash = primaryClash(t.company_id, { personType: 'EMPLOYEE', personId: t.employee_id, from: t.join_date, to: t.return_date, statuses: ['APPROVED'] });
    if (clash) throw unprocessable(`The employee still has the primary deployment ${clash.doc_no} from ${clash.from_date}${clash.to_date ? ` to ${clash.to_date}` : ''}: end it before this transfer is approved.`);
    const keep = open[0];
    const no = nextDoc({ companyId: t.company_id, user: actor.user }, 'HR_DEPLOYMENT', 'hr_deployments', 'DEP');
    const id = Number(db.prepare("INSERT INTO hr_deployments (company_id, doc_no, doc_date, person_type, person_id, dep_project_id, dep_site_id, crew_id, site_role, access_role, from_date, to_date, is_primary, default_wbs_id, default_cost_code_id, band, plan_json, status, requested_by, transfer_id, project_id, site_id, created_by, source_type, source_id) VALUES (?, ?, ?, 'EMPLOYEE', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'WITHIN_PLAN', ?, 'APPROVED', ?, ?, ?, ?, ?, 'hr_transfer', ?)")
      .run(t.company_id, no, todayIST(), t.employee_id, t.to_project_id, t.to_site_id, t.to_crew_id, t.site_role ?? keep?.site_role ?? null, keep?.access_role ?? null, t.join_date, t.return_date, keep?.default_wbs_id ?? null, keep?.default_cost_code_id ?? null, JSON.stringify({ source: 'transfer', docNo: t.doc_no }), t.requested_by ?? t.created_by, t.id, t.to_project_id, t.to_site_id, actor.user, String(t.id)).lastInsertRowid);
    db.prepare('UPDATE hr_deployments SET root_id = id WHERE id = ?').run(id);
    const nd = db.prepare('SELECT * FROM hr_deployments WHERE id = ?').get(id);
    const started = nd.from_date <= todayIST();
    announce(actor, nd, started ? 'STARTED' : 'APPROVED');
    if (started) db.prepare('UPDATE hr_deployments SET activated_at = ? WHERE id = ?').run(nowIso(), id);
    writeAudit(db, { entity: 'hr_deployments', entityId: id, action: 'create_by_transfer', newValues: { docNo: no, transfer: t.doc_no }, actor: actor.user, companyId: t.company_id });
    db.prepare('UPDATE hr_transfers SET applied_at = ?, applied_json = ? WHERE id = ?').run(nowIso(), JSON.stringify({ ended: prior, created: id }), t.id);
    return id;
  }
  /** Undoes an approved transfer that has not taken effect: the deployment it gave is closed before it started and the ones it ended run on as before. */
  function reverse(actor, t) {
    const a = json(t.applied_json, null);
    if (!a) return;
    const nd = db.prepare('SELECT * FROM hr_deployments WHERE id = ?').get(a.created);
    if (nd && nd.status === 'APPROVED') {
      db.prepare("UPDATE hr_deployments SET status = 'CLOSED', closed_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(`Transfer ${t.doc_no} was undone`, actor.user, nowIso(), nd.id);
      announce(actor, nd, 'CLOSED');
    }
    for (const p of a.ended ?? []) {
      db.prepare('UPDATE hr_deployments SET to_date = ?, ended_event_at = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(p.toDate, actor.user, nowIso(), p.id);
      const od = db.prepare('SELECT * FROM hr_deployments WHERE id = ?').get(p.id);
      announce(actor, od, 'CHANGED');
    }
    db.prepare('UPDATE hr_transfers SET applied_json = NULL, applied_at = NULL WHERE id = ?').run(t.id);
  }
  const decisions = {
    transfer(instance, actor, outcome, comment) {
      const t = db.prepare('SELECT * FROM hr_transfers WHERE id = ?').get(Number(instance.docId));
      if (!t || !['SUBMITTED', 'RETURNED'].includes(t.status)) return;
      const now = nowIso();
      if (outcome === 'APPROVED') {
        if (t.supersedes_id) {
          const old = db.prepare('SELECT * FROM hr_transfers WHERE id = ?').get(t.supersedes_id);
          if (old && old.join_date <= todayIST()) throw unprocessable('The person has already joined the new place under the earlier revision: raise a new transfer instead.');
          if (old) { reverse(actor, old); db.prepare("UPDATE hr_transfers SET status = 'SUPERSEDED', version = version + 1 WHERE id = ?").run(old.id); }
        }
        db.prepare("UPDATE hr_transfers SET status = 'APPROVED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, t.id);
        const depId = apply(actor, db.prepare('SELECT * FROM hr_transfers WHERE id = ?').get(t.id));
        event('hr.transfer.approved', actor, 'hr_transfer', t.id, t.company_id, { docNo: t.doc_no, employeeId: t.employee_id, kind: t.kind, fromProjectId: t.from_project_id, fromSiteId: t.from_site_id, toProjectId: t.to_project_id, toSiteId: t.to_site_id, relieveDate: t.relieve_date, joinDate: t.join_date, deploymentId: depId }, t.to_project_id, t.to_site_id);
      } else {
        const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN';
        db.prepare('UPDATE hr_transfers SET status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED', actor.user, now, t.id);
        if (withdrawn) db.prepare('UPDATE hr_transfers SET workflow_instance_id = NULL WHERE id = ?').run(t.id);
      }
      writeAudit(db, { entity: 'hr_transfers', entityId: t.id, action: outcome.toLowerCase(), reason: comment ?? null, actor: actor.user, companyId: t.company_id });
      tell(t.company_id, t.requested_by ?? t.created_by, 'Transfer', t.doc_no, empName(t.employee_id)?.n ?? '', outcome === 'RETURNED' ? 'returned for correction' : outcome === 'APPROVED' ? 'approved' : outcome === 'REJECTED' ? 'rejected' : 'cancelled', comment, `/hr/transfers/transfer?id=${t.id}`);
      if (outcome === 'APPROVED') {
        const emp = db.prepare('SELECT user_id FROM hr_employees WHERE id = ?').get(t.employee_id);
        tell(t.company_id, usernameOf(emp?.user_id), 'Transfer', t.doc_no, `You join ${[orgName('org_sites', t.to_site_id), orgName('org_projects', t.to_project_id)].filter(Boolean).join(', ')} on ${t.join_date}`, 'approved', null, `/hr/transfers/transfer?id=${t.id}`);
      }
    },
  };

  // ---- the register (list, export) ----
  const regScope = (actor) => {
    const a = authz.scopeFilter(actor, 'hr.transfer.view', { project: 't.from_project_id', site: 't.from_site_id' }).sql;
    const b = authz.scopeFilter(actor, 'hr.transfer.view', { project: 't.to_project_id', site: 't.to_site_id' }).sql;
    const own = actor.userId ? ` OR (t.status = 'APPROVED' AND e.user_id = ${Number(actor.userId)})` : '';
    return `t.company_id = :c AND (${a} OR ${b} OR lower(t.created_by) = lower(:u)${own})`;
  };
  const select = 't.*, e.full_name AS employee_name, e.emp_code AS employee_code, fp.name AS from_project_name, fs.name AS from_site_name, tp.name AS to_project_name, ts.name AS to_site_name';
  const present = (t) => ({ id: t.id, docNo: t.doc_no, revision: t.revision_no, employee: t.employee_name, code: t.employee_code, kind: t.kind, kindLabel: KIND_LABELS[t.kind], fromProject: t.from_project_name, fromSite: t.from_site_name, toProject: t.to_project_name, toSite: t.to_site_name, relieveDate: t.relieve_date, joinDate: t.join_date, travel: t.travel_required === 1, accommodation: t.accommodation_required === 1, status: t.status, statusLabel: DEP_STATUS[t.status] });
  const register = {
    list(actor, query) { need(actor, 'hr.transfer.view', 'see transfers'); return runList(db, transferList, parseListRequest(transferList, query), { select, scopeSql: regScope(actor), params: { c: actor.companyId, u: actor.user }, tieBreaker: 't.id', map: present }); },
    exportSource(actor, req) {
      need(actor, 'hr.transfer.export', 'export transfers');
      const opts = { select, scopeSql: regScope(actor), params: { c: actor.companyId, u: actor.user }, tieBreaker: 't.id' };
      return { title: transferList.label, permission: 'hr.transfer.export', personal: false, columns: Object.entries(transferList.columns).map(([key, c]) => ({ key, label: c.label, type: c.type === 'enum' ? 'text' : c.type })), count: () => countList(db, transferList, req, opts), rows: () => runList(db, transferList, req, { ...opts, limit: null, map: present }).data, describe: (x) => [x.q ? `search "${x.q}"` : '', ...x.filters.map((f) => `${transferList.columns[f.key].label} ${f.op} ${f.raw}`)].filter(Boolean).join('; ') };
    },
  };

  return { transfers, register, decisions, currentPlace, view };
}

const services = new WeakMap();
export const bindTransfers = (db, s) => services.set(db, s);
export const transfersOf = (db) => services.get(db) ?? null;

/** The project manager of a project today: the people the organisation records as its project manager. */
const projectManagers = (db, companyId, projectId) => (projectId ? db.prepare("SELECT DISTINCT u.username FROM org_assignments a JOIN iam_users u ON u.id = a.user_id WHERE a.company_id = ? AND a.entity_type = 'PROJECT' AND a.entity_id = ? AND a.role = 'PROJECT_MANAGER' AND a.applied = 1 AND u.is_active = 1 AND u.status = 'ACTIVE' AND a.effective_from <= ? AND (a.effective_to IS NULL OR a.effective_to >= ?)").all(companyId, projectId, todayIST(), todayIST()).map((r) => r.username) : []);
const pmResolver = (column) => ({ db, companyId, instance }) => {
  const t = db.prepare(`SELECT ${column} AS project_id FROM hr_transfers WHERE id = ?`).get(Number(instance.docId));
  const people = projectManagers(db, companyId, t?.project_id).filter((u) => !same(u, instance.submittedBy));
  return people.length ? people.map((user) => ({ user })) : [{ role: 'PM' }];
};
if (!workflowResolvers.get('hr.transfer.from_pm')) workflowResolvers.register('hr.transfer.from_pm', pmResolver('from_project_id'));
if (!workflowResolvers.get('hr.transfer.to_pm')) workflowResolvers.register('hr.transfer.to_pm', pmResolver('to_project_id'));

const step = (code, name, approvers, when = null) => ({ code, name, type: 'approval', mode: 'single', approvers, slaHours: 48, requireAttachment: false, checklist: [], when, notify: [], action: null });
const hooks = {
  onApproved: (db, { instance, actor }) => transfersOf(db)?.decisions.transfer(instance, actor, 'APPROVED'),
  onRejected: (db, { instance, actor, comment }) => transfersOf(db)?.decisions.transfer(instance, actor, 'REJECTED', comment),
  onReturned: (db, { instance, actor, comment }) => transfersOf(db)?.decisions.transfer(instance, actor, 'RETURNED', comment),
  onCancelled: (db, { instance, actor, comment }) => transfersOf(db)?.decisions.transfer(instance, actor, 'CANCELLED', comment),
};
workflowTypes.register({
  docType: TRF_DOC, label: 'Transfer', processOwner: 'HRMGR', route: (id) => `/hr/transfers/transfer?id=${id}`,
  describe(db, companyId, id) {
    const t = db.prepare('SELECT t.doc_no, t.revision_no, t.requested_by, t.created_by, t.from_project_id, t.from_site_id, t.to_project_id, e.full_name FROM hr_transfers t JOIN hr_employees e ON e.id = t.employee_id WHERE t.id = ? AND t.company_id = ?').get(Number(id), companyId);
    return t ? { ref: `${t.doc_no}/r${t.revision_no}`, title: `${t.full_name} moves`, originator: t.requested_by ?? t.created_by, projectId: t.from_project_id ?? t.to_project_id, siteId: t.from_site_id ?? undefined } : null;
  },
  summarise(db, _actor, id) {
    const t = db.prepare('SELECT t.*, e.full_name, e.emp_code FROM hr_transfers t JOIN hr_employees e ON e.id = t.employee_id WHERE t.id = ?').get(Number(id)); if (!t) return null;
    const n = (tb, i) => (i ? db.prepare(`SELECT name FROM ${tb} WHERE id = ?`).get(i)?.name ?? '—' : '—');
    return { fields: [{ label: 'Transfer', value: `${t.doc_no} revision ${t.revision_no} (${KIND_LABELS[t.kind]})` }, { label: 'Employee', value: `${t.full_name} (${t.emp_code})` }, { label: 'From', value: `${n('org_projects', t.from_project_id)} / ${n('org_sites', t.from_site_id)}` }, { label: 'To', value: `${n('org_projects', t.to_project_id)} / ${n('org_sites', t.to_site_id)}` }, { label: 'Relieving / joining', value: `${t.relieve_date} / ${t.join_date}` }, { label: 'Reason', value: t.reason }] };
  },
  defaultDefinition: { name: 'Transfer: current project manager, receiving project manager, HR manager', settings: { resubmit: 'first', distinctApprovers: true }, steps: [
    step('FROM_PM', 'Current project manager', [{ kind: 'resolver', resolver: 'hr.transfer.from_pm' }]),
    step('TO_PM', 'Receiving project manager (another project)', [{ kind: 'resolver', resolver: 'hr.transfer.to_pm' }], { field: 'scope', op: 'eq', value: 'CROSS_PROJECT' }),
    step('HRMGR', 'HR manager', [{ kind: 'role', role: 'HRMGR' }]),
  ] },
  hooks,
});
evidenceProviders.register(TRF_DOC, ({ db, instance }) => {
  const t = db.prepare('SELECT * FROM hr_transfers WHERE id = ?').get(Number(instance.docId)); if (!t) return { sections: [] };
  const items = json(t.handover_json, []);
  const current = db.prepare("SELECT d.doc_no, d.from_date, d.to_date FROM hr_deployments d WHERE d.company_id = ? AND d.person_type = 'EMPLOYEE' AND d.person_id = ? AND d.status = 'APPROVED' AND d.deleted_at IS NULL AND d.from_date <= ? AND (d.to_date IS NULL OR d.to_date >= ?)").all(t.company_id, t.employee_id, t.relieve_date, t.relieve_date);
  return { sections: [{ code: 'hr-transfer', title: 'Before approving', kind: 'metrics', items: [
    { label: 'Current postings', value: current.length ? current.map((c) => c.doc_no).join(', ') : 'None on record', format: 'text' },
    { label: 'Handover done', value: `${items.filter((i) => i.done).length} of ${items.length}`, format: 'text', tone: items.some((i) => !i.done) ? 'warn' : undefined },
    { label: 'Travel / accommodation', value: `${t.travel_required ? 'Travel needed' : 'No travel'} / ${t.accommodation_required ? 'accommodation needed' : 'no accommodation'}`, format: 'text' },
    { label: 'Crosses projects', value: t.scope === 'CROSS_PROJECT' ? 'Yes: the receiving project manager approves too' : 'No', format: 'text' },
  ] }] };
});
objectTypes.register({
  type: 'hr_transfer', label: 'Transfer', permission: 'hr.transfer.view', route: (id) => `/hr/transfers/transfer?id=${id}`,
  access(db, actor, id) { const s = transfersOf(db); if (!s) return null; try { const t = s.transfers.get(actor, Number(id)); return { companyId: actor.companyId, projectId: t.toProjectId ?? null, siteId: t.toSiteId ?? null, status: t.status }; } catch { return null; } },
  auditEntities: (id) => [{ entity: 'hr_transfers', id }],
  summary(db, actor, id) { const s = transfersOf(db); if (!s) return null; try { const t = s.transfers.get(actor, Number(id)); return { label: `${t.docNo} ${t.employee}`, status: t.status }; } catch { return null; } },
  search(db, actor, q, limit) { if (!authzOf(db).check(actor, 'hr.transfer.view').allowed) return []; return db.prepare("SELECT t.id FROM hr_transfers t JOIN hr_employees e ON e.id = t.employee_id WHERE t.company_id = ? AND t.deleted_at IS NULL AND t.status != 'SUPERSEDED' AND (t.doc_no LIKE ? OR e.full_name LIKE ?) ORDER BY t.id DESC LIMIT ?").all(actor.companyId, `%${q}%`, `%${q}%`, limit).map((r) => r.id); },
});
