import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { writeExport, FORMATS } from '../../platform/export/index.js';
import { HttpError, badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { evidenceProviders, workflowOf, workflowTypes } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { accessOf } from '../iam/access/service.js';
import { CHANNELS, FREQUENCIES, LEVELS, SKINDS, TEAM_DOC, TEAM_STATUS, json, nowIso, rid, same } from './constants.js';

// The project team, the stakeholder register and the communication matrix (part 10.05). Adding a team member is a request approved by the project manager and the project director (BR-01); when it is approved the role engine (02.04) is asked for the
// scoped assignment of the role to the person for this project and these dates, with its own approval; once that is granted the person holds the role on the project and the messaging group of the project follows (05.04, on the assignment event).
// Ending a membership ends the assignment. Stakeholders are the people and organisations around the project with their influence and interest; their e-mail and phone are shown to those who hold proj.stakeholder.contact. The communication matrix
// says what is reported to whom, how often and by which channel.
export function createTeamService({ db }) {
  const authz = authzOf(db);
  const may = (actor, key, pid = null) => (pid == null ? authz.check(actor, key).allowed : authz.check(actor, key, { companyId: actor.companyId, projectId: pid }).allowed);
  const need = (actor, key, what, pid = null) => { if (!may(actor, key, pid)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const fail = (p) => { if (p.length) throw badRequest('Correct the highlighted fields', p); };
  const event = (type, actor, entity, id, companyId, projectId, data) => publishEvent(db, { type, entity, entityId: id, actorId: actor.user, companyId, projectId, data });
  const orgOf = (id) => db.prepare('SELECT * FROM org_projects WHERE id = ?').get(id);
  const elevated = (actor, user = actor.user) => ({ user, userId: null, companyId: actor.companyId, roles: ['SYSADM'] });
  function project(actor, projectId, key = 'proj.team.view') {
    const o = orgOf(Number(projectId));
    if (!o || o.company_id !== actor.companyId || !db.prepare('SELECT 1 FROM proj_projects WHERE project_id = ? AND deleted_at IS NULL').get(o.id) || !may(actor, 'proj.team.view', o.id)) throw notFound('That project does not exist.');
    if (key !== 'proj.team.view') need(actor, key, 'do that with the project team', o.id);
    return o;
  }
  const userOf = (companyId, username) => db.prepare("SELECT u.id, u.username, u.display_name FROM iam_users u WHERE u.company_id = ? AND lower(u.username) = lower(?) AND u.is_active = 1").get(companyId, username);
  const roleOf = (companyId, code) => db.prepare("SELECT id, code, name, status FROM iam_roles WHERE company_id = ? AND code = ? COLLATE NOCASE").get(companyId, code) ?? db.prepare("SELECT id, code, name, status FROM iam_roles WHERE company_id IS NULL AND code = ? COLLATE NOCASE").get(code);

  // ---- the team (FR-01, BR-01) ---------------------------------------------------------------------------------------------------------------------------
  const assignmentOf = (t) => { const r = roleOf(t.company_id, t.project_role); return r ? db.prepare("SELECT id FROM iam_assignments WHERE user_id = ? AND role_id = ? AND scope_type = 'PROJECT' AND scope_ids_json = ? AND status = 'ACTIVE' AND is_active = 1").get(t.user_id, r.id, JSON.stringify([t.org_project_id])) : null; };
  function teamView(actor, t) {
    const o = orgOf(t.org_project_id); const u = db.prepare('SELECT display_name FROM iam_users WHERE id = ?').get(t.user_id); const a = t.team_status === 'APPROVED' ? assignmentOf(t) : null;
    const access = t.team_status !== 'APPROVED' ? null : a ? 'GRANTED' : t.access_note && !t.assignment_request_id ? 'FAILED' : t.assignment_request_id ? 'PENDING' : 'NOT_REQUESTED';
    return { id: t.id, projectId: t.org_project_id, projectCode: o?.code, username: t.username, displayName: u?.display_name ?? t.username, projectRole: t.project_role, fromDate: t.from_date, toDate: t.to_date, status: t.team_status, statusLabel: TEAM_STATUS[t.team_status], access, assignmentId: a?.id ?? t.assignment_id, accessNote: t.access_note, reason: t.reason, requestedBy: t.requested_by, workflowInstanceId: t.workflow_instance_id, rowVersion: t.version,
      can: { end: may(actor, 'proj.team.manage', t.org_project_id) && t.team_status === 'APPROVED', withdraw: t.team_status === 'REQUESTED' && same(t.requested_by, actor.user), cancel: may(actor, 'proj.team.manage', t.org_project_id) && t.team_status === 'REQUESTED' } };
  }
  const trow = (actor, id) => { const t = db.prepare('SELECT * FROM proj_team WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!t || !may(actor, 'proj.team.view', t.org_project_id)) throw notFound('That team member does not exist.'); return t; };
  const team = {
    list(actor, projectId) { const o = project(actor, projectId); return { project: { id: o.id, code: o.code, name: o.name }, members: db.prepare('SELECT * FROM proj_team WHERE org_project_id = ? AND deleted_at IS NULL ORDER BY team_status = \'ENDED\', from_date DESC, id DESC').all(o.id).map((t) => teamView(actor, t)), can: { manage: may(actor, 'proj.team.manage', o.id) }, roles: db.prepare("SELECT code, name FROM iam_roles WHERE (company_id = ? OR company_id IS NULL) AND status = 'ACTIVE' ORDER BY code").all(o.company_id) }; },
    get(actor, id) { return teamView(actor, trow(actor, id)); },
    /** BR-01: a request to add a person with a project role; the project manager, then the project director, approve it. */
    add(actor, b) {
      const o = project(actor, b.projectId, 'proj.team.manage'); const p = []; const u = userOf(actor.companyId, b.username); const r = roleOf(actor.companyId, b.projectRole);
      if (!u) p.push({ field: 'username', message: `${b.username} is not an active user of your company` });
      if (!r || r.status !== 'ACTIVE') p.push({ field: 'projectRole', message: 'Choose an active role' });
      if (b.toDate && b.toDate < b.fromDate) p.push({ field: 'toDate', message: 'The end is before the start' });
      if (u && r && db.prepare("SELECT 1 FROM proj_team WHERE org_project_id = ? AND user_id = ? AND project_role = ? COLLATE NOCASE AND deleted_at IS NULL AND team_status IN ('REQUESTED', 'APPROVED')").get(o.id, u.id, r.code)) p.push({ field: 'username', message: `${u.display_name} is in the team as ${r.code} already (or a request is open)` });
      fail(p);
      return transaction(db, () => {
        const id = Number(db.prepare("INSERT INTO proj_team (company_id, org_project_id, user_id, username, project_role, from_date, to_date, reason, requested_by, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proj_project', ?)").run(actor.companyId, o.id, u.id, u.username, r.code, b.fromDate, b.toDate ?? null, b.reason, actor.user, o.id, actor.user, String(o.id)).lastInsertRowid);
        const inst = workflowOf(db).submit(actor, { docType: TEAM_DOC, docId: String(id), comment: `${o.code}: ${u.username} as ${r.code}`, context: { projectId: o.id } });
        db.prepare('UPDATE proj_team SET workflow_instance_id = ? WHERE id = ?').run(inst.id, id);
        writeAudit(db, { entity: 'proj_team', entityId: id, action: 'request', newValues: { user: u.username, role: r.code }, reason: b.reason, actor: actor.user, companyId: actor.companyId });
        return team.get(actor, id);
      });
    },
    withdraw(actor, id, { reason }) { const t = trow(actor, id); if (t.team_status !== 'REQUESTED') throw unprocessable('Only a request waiting for approval is withdrawn.'); if (!same(t.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, t.workflow_instance_id, { comment: reason }); return team.get(actor, t.id); },
    cancel(actor, id, { reason }) { const t = trow(actor, id); need(actor, 'proj.team.manage', 'cancel team requests', t.org_project_id); if (t.team_status !== 'REQUESTED') throw unprocessable('Only a request waiting for approval is cancelled.'); return transaction(db, () => { workflowOf(db).abandon(actor.companyId, t.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare("UPDATE proj_team SET team_status = 'CANCELLED', updated_at = ? WHERE id = ?").run(nowIso(), t.id); return team.get(actor, t.id); }); },
    /** The approval: the membership is approved and the role engine is asked for the scoped assignment (02.04), which has its own approval. */
    decide(instance, actor, outcome, comment) {
      const t = db.prepare('SELECT * FROM proj_team WHERE id = ?').get(rid(instance.docId)); if (!t || t.team_status !== 'REQUESTED') return;
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN';
      const to = outcome === 'APPROVED' ? 'APPROVED' : outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : 'CANCELLED';
      db.prepare('UPDATE proj_team SET team_status = ?, decided_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, nowIso(), actor.user, nowIso(), t.id);
      writeAudit(db, { entity: 'proj_team', entityId: t.id, action: withdrawn ? 'withdraw' : outcome.toLowerCase(), reason: comment ?? null, actor: actor.user, companyId: t.company_id });
      if (to !== 'APPROVED') return;
      const o = orgOf(t.org_project_id); const r = roleOf(t.company_id, t.project_role); const access = accessOf(db); let note = null; let reqId = null;
      if (!access) note = 'The role engine is not available: ask the administrator to grant the role.';
      else {
        try {
          const res = access.requestAssignment(elevated({ companyId: t.company_id }, t.requested_by), { userId: t.user_id, roleId: r.id, scopeType: 'PROJECT', scopeIds: [t.org_project_id], effectiveFrom: t.from_date, effectiveTo: t.to_date, reason: `Project team of ${o.code}: ${t.reason ?? 'approved by the project manager and the project director'}` });
          reqId = res?.id ?? res?.requestId ?? res?.request?.id ?? null; if (reqId == null) note = 'The request to the role engine was made.';
        } catch (x) { note = x?.status === 409 ? `${x.message}` : `The role engine refused the request: ${x?.message ?? x}`; }
      }
      db.prepare('UPDATE proj_team SET assignment_request_id = ?, access_note = ? WHERE id = ?').run(reqId, note, t.id);
      event('proj.team.added', actor, 'team', t.id, t.company_id, t.org_project_id, { projectId: t.org_project_id, code: o.code, username: t.username, projectRole: t.project_role, fromDate: t.from_date, toDate: t.to_date, accessRequested: reqId != null });
    },
    /** Ending a membership ends the assignment of the role for this project (taking access away needs no approval). */
    end(actor, id, { reason, toDate }) {
      const t = trow(actor, id); need(actor, 'proj.team.manage', 'end memberships', t.org_project_id); if (t.team_status !== 'APPROVED') throw unprocessable('Only a member of the team is ended.');
      return transaction(db, () => {
        const a = assignmentOf(t); let ended = false; const access = accessOf(db);
        if (a && access) { access.endAssignment(elevated(actor), a.id, { reason }); ended = true; }
        db.prepare("UPDATE proj_team SET team_status = 'ENDED', to_date = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(toDate ?? todayIST(), actor.user, nowIso(), t.id);
        writeAudit(db, { entity: 'proj_team', entityId: t.id, action: 'end', reason, newValues: { assignmentEnded: ended }, actor: actor.user, companyId: t.company_id });
        event('proj.team.ended', actor, 'team', t.id, t.company_id, t.org_project_id, { projectId: t.org_project_id, username: t.username, projectRole: t.project_role, assignmentEnded: ended });
        return team.get(actor, t.id);
      });
    },
    history(actor, id) { const t = trow(actor, id); return { approvals: t.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(t.workflow_instance_id) : [], audit: db.prepare('SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = ? AND entity_id = ? ORDER BY id').all('proj_team', String(t.id)) }; },
  };

  // ---- stakeholders (FR-02) ---------------------------------------------------------------------------------------------------------------------------------
  const srow = (actor, id) => { const s = db.prepare('SELECT * FROM proj_stakeholders WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!s || !may(actor, 'proj.stakeholder.view', s.org_project_id)) throw notFound('That stakeholder does not exist.'); return s; };
  const sview = (actor, s) => { const c = may(actor, 'proj.stakeholder.contact', s.org_project_id); return { id: s.id, projectId: s.org_project_id, kind: s.skind, kindLabel: SKINDS[s.skind], organisation: s.organisation, name: s.name, roleTitle: s.role_title, influence: s.influence, influenceLabel: LEVELS[s.influence], interest: s.interest, interestLabel: LEVELS[s.interest], email: c ? s.email : null, phone: c ? s.phone : null, contactVisible: c, partnerId: s.partner_id, status: s.sstatus, notes: s.notes, rowVersion: s.version, quadrant: s.influence === 'HIGH' && s.interest === 'HIGH' ? 'MANAGE_CLOSELY' : s.influence === 'HIGH' ? 'KEEP_SATISFIED' : s.interest === 'HIGH' ? 'KEEP_INFORMED' : 'MONITOR' }; };
  function sCheck(actor, b, existing = null) {
    const p = []; if (b.partnerId && !db.prepare('SELECT 1 FROM mdm_partners WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(b.partnerId, actor.companyId)) p.push({ field: 'partnerId', message: 'Choose a partner of the partner master' });
    if (existing === null && b.email && db.prepare("SELECT 1 FROM proj_stakeholders WHERE org_project_id = ? AND lower(email) = lower(?) AND deleted_at IS NULL").get(b.projectId, b.email)) p.push({ field: 'email', message: 'A stakeholder with that e-mail is in the register already' });
    return p;
  }
  const stakeholders = {
    list(actor, projectId) { const o = project(actor, projectId, 'proj.stakeholder.view'); return { project: { id: o.id, code: o.code, name: o.name }, rows: db.prepare('SELECT * FROM proj_stakeholders WHERE org_project_id = ? AND deleted_at IS NULL ORDER BY sstatus, skind, organisation, name').all(o.id).map((s) => sview(actor, s)), can: { manage: may(actor, 'proj.stakeholder.manage', o.id), contact: may(actor, 'proj.stakeholder.contact', o.id), export: may(actor, 'proj.stakeholder.export', o.id) } }; },
    create(actor, b) {
      const o = project(actor, b.projectId, 'proj.stakeholder.manage'); fail(sCheck(actor, b));
      return transaction(db, () => { const id = Number(db.prepare("INSERT INTO proj_stakeholders (company_id, org_project_id, skind, organisation, name, role_title, influence, interest, email, phone, partner_id, notes, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proj_project', ?)").run(actor.companyId, o.id, b.skind, b.organisation.trim(), b.name.trim(), b.roleTitle, b.influence, b.interest, b.email, b.phone, b.partnerId, b.notes, o.id, actor.user, String(o.id)).lastInsertRowid); writeAudit(db, { entity: 'proj_stakeholders', entityId: id, action: 'create', newValues: { organisation: b.organisation, name: b.name }, actor: actor.user, companyId: actor.companyId }); return sview(actor, srow(actor, id)); });
    },
    update(actor, id, b) {
      const s = srow(actor, id); need(actor, 'proj.stakeholder.manage', 'change stakeholders', s.org_project_id);
      if (b.version != null && b.version !== s.version) throw conflict(`${s.name} was changed by someone else; reload it.`);
      const m = { skind: s.skind, organisation: s.organisation, name: s.name, role_title: s.role_title, influence: s.influence, interest: s.interest, email: s.email, phone: s.phone, notes: s.notes, sstatus: s.sstatus };
      const map = { skind: 'skind', organisation: 'organisation', name: 'name', roleTitle: 'role_title', influence: 'influence', interest: 'interest', email: 'email', phone: 'phone', notes: 'notes', status: 'sstatus' };
      for (const [k, col] of Object.entries(map)) if (b[k] !== undefined) m[col] = typeof b[k] === 'string' && ['organisation', 'name'].includes(k) ? b[k].trim() : b[k];
      return transaction(db, () => { db.prepare('UPDATE proj_stakeholders SET skind = ?, organisation = ?, name = ?, role_title = ?, influence = ?, interest = ?, email = ?, phone = ?, notes = ?, sstatus = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(m.skind, m.organisation, m.name, m.role_title, m.influence, m.interest, m.email, m.phone, m.notes, m.sstatus, actor.user, nowIso(), s.id); writeAudit(db, { entity: 'proj_stakeholders', entityId: s.id, action: 'update', actor: actor.user, companyId: s.company_id }); return sview(actor, srow(actor, s.id)); });
    },
    remove(actor, id) {
      const s = srow(actor, id); need(actor, 'proj.stakeholder.manage', 'delete stakeholders', s.org_project_id);
      if (db.prepare('SELECT 1 FROM proj_comm_matrix WHERE stakeholder_id = ? AND deleted_at IS NULL').get(s.id)) throw new HttpError(409, 'IN_USE', `${s.name} is in the communication matrix: deactivate the stakeholder instead.`);
      return transaction(db, () => { db.prepare('UPDATE proj_stakeholders SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, s.id); writeAudit(db, { entity: 'proj_stakeholders', entityId: s.id, action: 'delete', actor: actor.user, companyId: s.company_id }); return { id: s.id, deleted: true }; });
    },
    exportFile(actor, projectId, format) {
      const o = project(actor, projectId, 'proj.stakeholder.export'); const rows = stakeholders.list(actor, o.id).rows; const c = may(actor, 'proj.stakeholder.contact', o.id);
      writeAudit(db, { entity: 'proj_stakeholders', entityId: o.id, action: 'export', newValues: { format, rows: rows.length, contact: c }, actor: actor.user, companyId: o.company_id });
      const cols = [{ key: 'kind', label: 'Type', type: 'text' }, { key: 'organisation', label: 'Organisation', type: 'text' }, { key: 'name', label: 'Name', type: 'text' }, { key: 'roleTitle', label: 'Role', type: 'text' }, { key: 'influence', label: 'Influence', type: 'text' }, { key: 'interest', label: 'Interest', type: 'text' }, ...(c ? [{ key: 'email', label: 'E-mail', type: 'text' }, { key: 'phone', label: 'Phone', type: 'text' }] : [])];
      return { buffer: writeExport(format, { columns: cols, rows: rows.map((r) => ({ kind: r.kindLabel, organisation: r.organisation, name: r.name, roleTitle: r.roleTitle ?? '', influence: r.influenceLabel, interest: r.interestLabel, email: r.email ?? '', phone: r.phone ?? '' })), footer: [`${rows.length} stakeholders`], title: `Stakeholder register ${o.code}`, sheetName: 'Stakeholders' }), contentType: FORMATS[format], fileName: `stakeholders-${o.code}.${format}` };
    },
  };

  // ---- the communication matrix (FR-03) ----------------------------------------------------------------------------------------------------------------------
  const crow = (actor, id) => { const c = db.prepare('SELECT * FROM proj_comm_matrix WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!c || !may(actor, 'proj.stakeholder.view', c.org_project_id)) throw notFound('That line of the communication matrix does not exist.'); return c; };
  const cview = (c) => { const s = c.stakeholder_id ? db.prepare('SELECT name, organisation FROM proj_stakeholders WHERE id = ?').get(c.stakeholder_id) : null; return { id: c.id, projectId: c.org_project_id, info: c.info, stakeholderId: c.stakeholder_id, audience: s ? `${s.name} (${s.organisation})` : c.audience, frequency: c.frequency, frequencyLabel: FREQUENCIES[c.frequency], channel: c.channel, channelLabel: CHANNELS[c.channel], ownerUser: c.owner_user, notes: c.notes, rowVersion: c.version }; };
  function cCheck(actor, o, b) { const p = []; if (b.stakeholderId && !db.prepare('SELECT 1 FROM proj_stakeholders WHERE id = ? AND org_project_id = ? AND deleted_at IS NULL').get(b.stakeholderId, o)) p.push({ field: 'stakeholderId', message: 'Choose a stakeholder of this project' }); if (!b.stakeholderId && !b.audience) p.push({ field: 'audience', message: 'Name the stakeholder or the audience' }); if (b.ownerUser && !userOf(actor.companyId, b.ownerUser)) p.push({ field: 'ownerUser', message: `${b.ownerUser} is not a user of your company` }); return p; }
  const matrix = {
    /** The matrix as a report: each line and, for each frequency, how many things are reported. */
    list(actor, projectId) { const o = project(actor, projectId, 'proj.stakeholder.view'); const rows = db.prepare('SELECT * FROM proj_comm_matrix WHERE org_project_id = ? AND deleted_at IS NULL ORDER BY frequency, id').all(o.id).map(cview); const byFrequency = Object.keys(FREQUENCIES).map((f) => ({ frequency: f, label: FREQUENCIES[f], count: rows.filter((r) => r.frequency === f).length })); return { project: { id: o.id, code: o.code }, rows, byFrequency, can: { manage: may(actor, 'proj.stakeholder.manage', o.id), export: may(actor, 'proj.stakeholder.export', o.id) } }; },
    create(actor, b) { const o = project(actor, b.projectId, 'proj.stakeholder.manage'); fail(cCheck(actor, o.id, b)); return transaction(db, () => { const id = Number(db.prepare("INSERT INTO proj_comm_matrix (company_id, org_project_id, info, stakeholder_id, audience, frequency, channel, owner_user, notes, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proj_project', ?)").run(actor.companyId, o.id, b.info.trim(), b.stakeholderId, b.audience, b.frequency, b.channel, b.ownerUser, b.notes, o.id, actor.user, String(o.id)).lastInsertRowid); writeAudit(db, { entity: 'proj_comm_matrix', entityId: id, action: 'create', newValues: { info: b.info }, actor: actor.user, companyId: actor.companyId }); return cview(crow(actor, id)); }); },
    update(actor, id, b) {
      const c = crow(actor, id); need(actor, 'proj.stakeholder.manage', 'change the communication matrix', c.org_project_id);
      if (b.version != null && b.version !== c.version) throw conflict('The line was changed by someone else; reload it.');
      const m = { info: b.info ?? c.info, stakeholderId: b.stakeholderId === undefined ? c.stakeholder_id : b.stakeholderId, audience: b.audience === undefined ? c.audience : b.audience, frequency: b.frequency ?? c.frequency, channel: b.channel ?? c.channel, ownerUser: b.ownerUser === undefined ? c.owner_user : b.ownerUser, notes: b.notes === undefined ? c.notes : b.notes }; fail(cCheck(actor, c.org_project_id, m));
      return transaction(db, () => { db.prepare('UPDATE proj_comm_matrix SET info = ?, stakeholder_id = ?, audience = ?, frequency = ?, channel = ?, owner_user = ?, notes = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(m.info.trim(), m.stakeholderId, m.audience, m.frequency, m.channel, m.ownerUser, m.notes, actor.user, nowIso(), c.id); writeAudit(db, { entity: 'proj_comm_matrix', entityId: c.id, action: 'update', actor: actor.user, companyId: c.company_id }); return cview(crow(actor, c.id)); });
    },
    remove(actor, id) { const c = crow(actor, id); need(actor, 'proj.stakeholder.manage', 'change the communication matrix', c.org_project_id); return transaction(db, () => { db.prepare('UPDATE proj_comm_matrix SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, c.id); writeAudit(db, { entity: 'proj_comm_matrix', entityId: c.id, action: 'delete', actor: actor.user, companyId: c.company_id }); return { id: c.id, deleted: true }; }); },
    exportFile(actor, projectId, format) {
      const o = project(actor, projectId, 'proj.stakeholder.export'); const rows = matrix.list(actor, o.id).rows; writeAudit(db, { entity: 'proj_comm_matrix', entityId: o.id, action: 'export', newValues: { format, rows: rows.length }, actor: actor.user, companyId: o.company_id });
      return { buffer: writeExport(format, { columns: [{ key: 'info', label: 'What is reported', type: 'text' }, { key: 'audience', label: 'To whom', type: 'text' }, { key: 'frequency', label: 'How often', type: 'text' }, { key: 'channel', label: 'Channel', type: 'text' }, { key: 'owner', label: 'Owner', type: 'text' }], rows: rows.map((r) => ({ info: r.info, audience: r.audience ?? '', frequency: r.frequencyLabel, channel: r.channelLabel, owner: r.ownerUser ?? '' })), footer: [`${rows.length} lines`], title: `Communication matrix ${o.code}`, sheetName: 'Communication matrix' }), contentType: FORMATS[format], fileName: `communication-matrix-${o.code}.${format}` };
    },
  };
  /** For the parts that follow: the active members of a project's team. */
  const members = (companyId, projectId) => db.prepare("SELECT username, project_role, from_date, to_date FROM proj_team WHERE company_id = ? AND org_project_id = ? AND team_status = 'APPROVED' AND deleted_at IS NULL").all(companyId, projectId).map((t) => ({ username: t.username, projectRole: t.project_role, fromDate: t.from_date, toDate: t.to_date }));
  function portalStakeholder(companyId, stakeholderId, kind) {
    return db.prepare(`
      SELECT s.name AS contactName, s.organisation AS partnerName, p.code AS partnerCode,
             s.partner_id AS partnerId, s.org_project_id AS projectId, s.site_id AS siteId
      FROM proj_stakeholders s JOIN org_projects j ON j.id = s.org_project_id AND j.company_id = s.company_id
      LEFT JOIN mdm_partners p ON p.id = s.partner_id AND p.company_id = s.company_id
      WHERE s.company_id = ? AND s.id = ? AND s.skind = ? AND s.sstatus = 'ACTIVE'
        AND s.is_active = 1 AND s.deleted_at IS NULL AND j.is_active = 1 AND j.deleted_at IS NULL
        AND (s.partner_id IS NULL OR (p.is_active = 1 AND p.deleted_at IS NULL AND p.partner_status = 'ACTIVE'))
    `).get(companyId, stakeholderId, kind) ?? null;
  }

  return { team, stakeholders, matrix, members, decide: team.decide, userOf, portalStakeholder };
}

const services = new WeakMap();
export const bindTeam = (db, s) => services.set(db, s);
export const teamOf = (db) => services.get(db) ?? null;

const step = (code, name, role) => ({ code, name, type: 'approval', mode: 'single', approvers: [{ kind: 'role', role }], slaHours: 48, requireAttachment: false, checklist: [], when: null, notify: [], action: null });
const tline = (db, id) => db.prepare('SELECT t.*, p.code, p.name AS pname, u.display_name FROM proj_team t JOIN org_projects p ON p.id = t.org_project_id JOIN iam_users u ON u.id = t.user_id WHERE t.id = ?').get(id);
workflowTypes.register({
  docType: TEAM_DOC, label: 'Project team member addition', processOwner: 'PM', route: (id) => `/proj/team?id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT t.requested_by, t.username, t.project_role, p.code FROM proj_team t JOIN org_projects p ON p.id = t.org_project_id WHERE t.id = ? AND t.company_id = ?').get(rid(id), companyId); return r ? { ref: `${r.code} ${r.username}`, title: `${r.username} as ${r.project_role}`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = tline(db, rid(id)); if (!r) return null; return { fields: [{ label: 'Project', value: `${r.code} ${r.pname}` }, { label: 'Person', value: `${r.display_name} (${r.username})` }, { label: 'Role', value: r.project_role }, { label: 'Period', value: `${r.from_date} to ${r.to_date ?? 'open'}` }, { label: 'Why', value: r.reason ?? '' }] }; },
  defaultDefinition: { name: 'Team member addition: the project manager, then the project director', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('PM', 'Project manager', 'PM'), step('PD', 'Project director', 'PD')] },
  hooks: { onApproved: (db, { instance, actor }) => teamOf(db)?.decide(instance, actor, 'APPROVED'), onRejected: (db, { instance, actor, comment }) => teamOf(db)?.decide(instance, actor, 'REJECTED', comment), onReturned: (db, { instance, actor, comment }) => teamOf(db)?.decide(instance, actor, 'RETURNED', comment), onCancelled: (db, { instance, actor, comment }) => teamOf(db)?.decide(instance, actor, 'CANCELLED', comment) },
});
evidenceProviders.register(TEAM_DOC, ({ db, instance }) => {
  const t = tline(db, rid(instance.docId)); if (!t) return { sections: [] };
  const roles = json(db.prepare('SELECT roles_json FROM iam_users WHERE id = ?').get(t.user_id)?.roles_json, []); const others = db.prepare("SELECT COUNT(*) AS n FROM proj_team WHERE user_id = ? AND team_status = 'APPROVED' AND deleted_at IS NULL AND (to_date IS NULL OR to_date >= date('now'))").get(t.user_id).n;
  return { sections: [{ code: 'proj-team', title: 'Before approving the team member', kind: 'metrics', items: [{ label: 'Person', value: `${t.display_name} (${t.username})`, format: 'text' }, { label: 'Role asked for', value: t.project_role, format: 'text' }, { label: 'Roles held now', value: roles.join(', ') || '—', format: 'text' }, { label: 'Other projects of this person', value: String(others), format: 'text' }, { label: 'The role engine', value: 'asks for its own approval after this one (02.04)', format: 'text' }] }] };
});
