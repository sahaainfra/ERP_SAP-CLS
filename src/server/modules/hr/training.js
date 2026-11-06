import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { HttpError, badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { evidenceProviders, workflowOf, workflowTypes } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { addDays } from './att-calc.js';

// Training, certifications, skills and the competency matrix (part 07.10). A course says what is taught, to whom it is mandatory and how long it stays valid; a session is a run of a course (trainer, venue, site, capacity, cost). An external session with a cost
// is approved (the manager, then the HR manager); an internal one is open for nomination once it is submitted. People are nominated (a manager nominates the people who report to them), sign in with the QR code of the session on the day, are marked
// attended or absent, get a post-test score and give feedback. A passed course that carries a certificate type gives the person that certificate. Certifications and licences are kept per employee or worker with number, issuer, validity and document,
// verified by HR, and watched every day; `check` is what other parts ask before they let somebody operate a crane or work at height (BR-01), and the deployment service asks it for every person it is given.
export const SESSION_DOC = 'HR_TRN_SESSION';
export const SESSION_STATUS = { DRAFT: 'Draft', SUBMITTED: 'Waiting for approval', APPROVED: 'Open', RETURNED: 'Returned for correction', REJECTED: 'Rejected', CANCELLED: 'Cancelled', COMPLETED: 'Completed' };
export const CATEGORIES = { SAFETY: 'Safety', TECHNICAL: 'Technical', STATUTORY: 'Statutory', SOFT: 'Soft skills', OTHER: 'Other' };
export const LEVELS = { 0: 'No skill', 1: 'Learner', 2: 'Works with help', 3: 'Works alone', 4: 'Can train others' };
export const CERT_STATE = { VALID: 'Valid', EXPIRING: 'Expiring', EXPIRED: 'Expired', UNVERIFIED: 'Not verified', REVOKED: 'Revoked' };
/** Guards that the deployment service asks for each person it is given: what a person needs to hold before being posted (BR-01). */
export const assignmentGuards = [];
const nowIso = () => new Date().toISOString();
const istNow = () => new Date(Date.now() + 19_800_000).toISOString().slice(0, 16);
const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
const json = (s, d) => { try { return JSON.parse(s ?? ''); } catch { return d; } };
const addMonths = (d, m) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCMonth(t.getUTCMonth() + m); return t.toISOString().slice(0, 10); };
const money = (minor) => (minor == null ? null : Math.round(minor) / 100);
/** The state of a certificate on a day: revoked, not verified, expired, expiring within its alert days, or valid. */
export function certState(c, alertDays, on) {
  if (c.cert_status === 'REVOKED') return 'REVOKED';
  if (c.valid_from > on) return 'UNVERIFIED';
  if (c.valid_until && c.valid_until < on) return 'EXPIRED';
  if (!c.verified) return 'UNVERIFIED';
  if (c.valid_until && c.valid_until <= addDays(on, alertDays ?? 30)) return 'EXPIRING';
  return 'VALID';
}

export const sessionList = defineList({
  code: 'hr.training_sessions', label: 'Training sessions', permission: 'hr.session.view',
  from: 'trn_sessions s JOIN trn_courses c ON c.id = s.course_id LEFT JOIN org_sites st ON st.id = s.site_id LEFT JOIN org_projects p ON p.id = s.project_id',
  where: 's.deleted_at IS NULL', searchable: ['s.doc_no', 'c.title', 'c.code', 's.trainer', 's.venue'], defaultSort: '-startAt',
  columns: {
    docNo: { sql: 's.doc_no', type: 'text', label: 'Session' }, course: { sql: 'c.title', type: 'text', label: 'Course' }, courseId: { sql: 's.course_id', type: 'number', label: 'Course id' },
    category: { sql: 'c.category', type: 'enum', label: 'Category', options: Object.entries(CATEGORIES) }, mode: { sql: 'c.mode', type: 'enum', label: 'Mode', options: [['INTERNAL', 'Internal'], ['EXTERNAL', 'External']] },
    startAt: { sql: 's.start_at', type: 'text', label: 'Starts' }, endAt: { sql: 's.end_at', type: 'text', label: 'Ends' }, trainer: { sql: 's.trainer', type: 'text', label: 'Trainer' }, venue: { sql: 's.venue', type: 'text', label: 'Venue' },
    site: { sql: 'st.name', type: 'text', label: 'Site' }, project: { sql: 'p.name', type: 'text', label: 'Project' }, capacity: { sql: 's.capacity', type: 'number', label: 'Seats' },
    cost: { sql: 's.cost_minor', type: 'number', label: 'Cost (paise)' }, status: { sql: 's.status', type: 'enum', label: 'Status', options: Object.entries(SESSION_STATUS) },
  },
});
export const certList = defineList({
  code: 'hr.certifications', label: 'Certifications and licences', permission: 'hr.cert.view',
  from: "trn_certifications x LEFT JOIN trn_cert_types t ON t.company_id = x.company_id AND t.code = x.cert_type LEFT JOIN hr_employees e ON x.person_type = 'EMPLOYEE' AND e.id = x.person_id LEFT JOIN lab_workers w ON x.person_type = 'WORKER' AND w.id = x.person_id",
  where: 'x.deleted_at IS NULL', searchable: ['x.number', 'x.issuer', 'x.cert_type', 'e.full_name', 'e.emp_code', 'w.name', 'w.worker_code'], defaultSort: 'validUntil',
  columns: {
    person: { sql: 'COALESCE(e.full_name, w.name)', type: 'text', label: 'Person' }, code: { sql: 'COALESCE(e.emp_code, w.worker_code)', type: 'text', label: 'Code' },
    personType: { sql: 'x.person_type', type: 'enum', label: 'Kind', options: [['EMPLOYEE', 'Employee'], ['WORKER', 'Worker']] }, certType: { sql: 'x.cert_type', type: 'text', label: 'Certificate' },
    number: { sql: 'x.number', type: 'text', label: 'Number' }, issuer: { sql: 'x.issuer', type: 'text', label: 'Issued by' }, validFrom: { sql: 'x.valid_from', type: 'date', label: 'Valid from' }, validUntil: { sql: 'x.valid_until', type: 'date', label: 'Valid until' },
    verified: { sql: 'x.verified', type: 'enum', label: 'Verified', options: [['1', 'Verified'], ['0', 'Not verified']] },
    state: { sql: "CASE WHEN x.cert_status = 'REVOKED' THEN 'REVOKED' WHEN x.valid_until IS NOT NULL AND x.valid_until < date('now', '+5 hours', '+30 minutes') THEN 'EXPIRED' WHEN x.verified = 0 THEN 'UNVERIFIED' WHEN x.valid_until IS NOT NULL AND x.valid_until <= date('now', '+5 hours', '+30 minutes', '+' || COALESCE(t.alert_days, 30) || ' days') THEN 'EXPIRING' ELSE 'VALID' END", type: 'enum', label: 'State', options: Object.entries(CERT_STATE) },
  },
});

export function createTrainingService({ db, dep }) {
  const authz = authzOf(db);
  const { may, need, nextDoc, event, usernameOf, myEmployee, personOf } = dep;
  const notif = notificationsOf(db);
  const today = () => todayIST();
  const maker = (actor, r) => same(r.created_by, actor.user);
  const hrUsers = (companyId) => db.prepare("SELECT username FROM iam_users WHERE company_id = ? AND is_active = 1 AND roles_json LIKE '%\"HRMGR\"%'").all(companyId).map((u) => u.username);
  const tell = (companyId, to, what, ref, title, outcome, comment, link) => to && notif.notify({ companyId, templateCode: 'trn.decided', recipients: [`user:${to}`], data: { what, ref, title, decision: outcome === 'RETURNED' ? 'returned for correction' : outcome === 'APPROVED' ? 'approved' : outcome === 'REJECTED' ? 'rejected' : 'cancelled', comment: comment ? `: ${comment}` : '' }, link, sourceType: 'trn_session', sourceId: ref, eventKey: `trn.decided:${ref}:${outcome}` });
  const nameOf = (type, id) => (type === 'EMPLOYEE' ? db.prepare('SELECT full_name AS name, emp_code AS code FROM hr_employees WHERE id = ?').get(id) : db.prepare('SELECT name, worker_code AS code FROM lab_workers WHERE id = ?').get(id)) ?? { name: `#${id}`, code: '' };
  const reportees = (employeeId) => new Set(db.prepare(`WITH RECURSIVE r(id, depth) AS (SELECT id, 1 FROM hr_employees WHERE manager_id = ? AND deleted_at IS NULL UNION SELECT e.id, r.depth + 1 FROM hr_employees e JOIN r ON e.manager_id = r.id WHERE e.deleted_at IS NULL AND r.depth < 12) SELECT id FROM r`).all(employeeId).map((x) => x.id));
  /** Whose certificates and skills a person sees: everyone for those who see all; otherwise themselves and the people who report to them. Workers only to those who see all. */
  function canSee(actor, type, id) {
    if (may(actor, 'hr.cert.view_all')) return true;
    if (type !== 'EMPLOYEE') return false;
    const me = myEmployee(actor); if (!me) return false;
    return me === id || reportees(me).has(id);
  }
  const certTypeRow = (companyId, code) => db.prepare('SELECT * FROM trn_cert_types WHERE company_id = ? AND code = ? COLLATE NOCASE AND deleted_at IS NULL').get(companyId, code);

  // ------------------------------------------------------------------ set-up: courses, certificate types, skills
  const setup = {
    courses: {
      list(actor) {
        need(actor, 'hr.session.view', 'see courses');
        return db.prepare('SELECT * FROM trn_courses WHERE company_id = ? AND deleted_at IS NULL ORDER BY title').all(actor.companyId).map((c) => ({ id: c.id, code: c.code, title: c.title, titleHi: c.title_hi, category: c.category, mode: c.mode, mandatoryFor: json(c.mandatory_for_json, {}), validityMonths: c.validity_months, passScore: c.pass_score, certTypeCode: c.cert_type_code, active: Boolean(c.is_active), rowVersion: c.version }));
      },
      save(actor, b) {
        need(actor, 'hr.training.configure', 'keep the courses');
        const dup = db.prepare('SELECT id FROM trn_courses WHERE company_id = ? AND code = ? COLLATE NOCASE AND deleted_at IS NULL').get(actor.companyId, b.code);
        if (b.certTypeCode && !certTypeRow(actor.companyId, b.certTypeCode)) throw badRequest('Some fields are not valid.', [{ field: 'certTypeCode', message: 'That certificate type does not exist' }]);
        const cols = [b.title, b.titleHi ?? null, b.category, b.mode, JSON.stringify(b.mandatoryFor ?? {}), b.validityMonths ?? null, b.passScore ?? null, b.certTypeCode ?? null];
        if (b.id) {
          const r = db.prepare('SELECT * FROM trn_courses WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(b.id, actor.companyId); if (!r) throw notFound('That course does not exist.');
          if (b.version !== r.version) throw conflict('This course was changed by someone else. Reload it and try again.');
          db.prepare('UPDATE trn_courses SET title = ?, title_hi = ?, category = ?, mode = ?, mandatory_for_json = ?, validity_months = ?, pass_score = ?, cert_type_code = ?, is_active = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(...cols, b.active === false ? 0 : 1, actor.user, nowIso(), r.id);
          writeAudit(db, { entity: 'trn_courses', entityId: r.id, action: 'update', newValues: { code: r.code }, actor: actor.user, companyId: actor.companyId });
          return setup.courses.list(actor).find((c) => c.id === r.id);
        }
        if (dup) throw conflict(`A course with the code ${b.code} exists already.`);
        const id = Number(db.prepare('INSERT INTO trn_courses (company_id, code, title, title_hi, category, mode, mandatory_for_json, validity_months, pass_score, cert_type_code, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(actor.companyId, b.code, ...cols, actor.user, 'trn_course').lastInsertRowid);
        writeAudit(db, { entity: 'trn_courses', entityId: id, action: 'create', newValues: { code: b.code }, actor: actor.user, companyId: actor.companyId });
        return setup.courses.list(actor).find((c) => c.id === id);
      },
    },
    certTypes: {
      list(actor) {
        need(actor, 'hr.cert.view', 'see certificate types');
        return db.prepare('SELECT * FROM trn_cert_types WHERE company_id = ? AND deleted_at IS NULL ORDER BY name').all(actor.companyId).map((t) => ({ id: t.id, code: t.code, name: t.name, nameHi: t.name_hi, validityMonths: t.validity_months, alertDays: t.alert_days, requiredFor: json(t.required_for_json, {}), mandatory: Boolean(t.mandatory), rowVersion: t.version }));
      },
      save(actor, b) {
        need(actor, 'hr.training.configure', 'keep the certificate types');
        const cols = [b.name, b.nameHi ?? null, b.validityMonths ?? null, b.alertDays ?? 30, JSON.stringify(b.requiredFor ?? {}), b.mandatory === false ? 0 : 1];
        if (b.id) {
          const r = db.prepare('SELECT * FROM trn_cert_types WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(b.id, actor.companyId); if (!r) throw notFound('That certificate type does not exist.');
          if (b.version !== r.version) throw conflict('This certificate type was changed by someone else. Reload it and try again.');
          db.prepare('UPDATE trn_cert_types SET name = ?, name_hi = ?, validity_months = ?, alert_days = ?, required_for_json = ?, mandatory = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(...cols, actor.user, nowIso(), r.id);
          writeAudit(db, { entity: 'trn_cert_types', entityId: r.id, action: 'update', newValues: { code: r.code }, actor: actor.user, companyId: actor.companyId });
          return setup.certTypes.list(actor).find((t) => t.id === r.id);
        }
        if (certTypeRow(actor.companyId, b.code)) throw conflict(`A certificate type with the code ${b.code} exists already.`);
        const id = Number(db.prepare('INSERT INTO trn_cert_types (company_id, code, name, name_hi, validity_months, alert_days, required_for_json, mandatory, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(actor.companyId, b.code, ...cols, actor.user, 'trn_cert_type').lastInsertRowid);
        writeAudit(db, { entity: 'trn_cert_types', entityId: id, action: 'create', newValues: { code: b.code }, actor: actor.user, companyId: actor.companyId });
        return setup.certTypes.list(actor).find((t) => t.id === id);
      },
    },
    skills: {
      list(actor) {
        need(actor, 'hr.skill.view', 'see the skills');
        return db.prepare('SELECT * FROM trn_skill_defs WHERE company_id = ? AND deleted_at IS NULL ORDER BY trade, name').all(actor.companyId).map((s) => ({ id: s.id, code: s.code, name: s.name, nameHi: s.name_hi, trade: s.trade, rowVersion: s.version }));
      },
      save(actor, b) {
        need(actor, 'hr.training.configure', 'keep the skills');
        if (b.id) {
          const r = db.prepare('SELECT * FROM trn_skill_defs WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(b.id, actor.companyId); if (!r) throw notFound('That skill does not exist.');
          if (b.version !== r.version) throw conflict('This skill was changed by someone else. Reload it and try again.');
          db.prepare('UPDATE trn_skill_defs SET name = ?, name_hi = ?, trade = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.name, b.nameHi ?? null, b.trade ?? null, actor.user, nowIso(), r.id);
          return setup.skills.list(actor).find((s) => s.id === r.id);
        }
        if (db.prepare('SELECT 1 FROM trn_skill_defs WHERE company_id = ? AND code = ? COLLATE NOCASE AND deleted_at IS NULL').get(actor.companyId, b.code)) throw conflict(`A skill with the code ${b.code} exists already.`);
        const id = Number(db.prepare('INSERT INTO trn_skill_defs (company_id, code, name, name_hi, trade, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?)').run(actor.companyId, b.code, b.name, b.nameHi ?? null, b.trade ?? null, actor.user, 'trn_skill').lastInsertRowid);
        writeAudit(db, { entity: 'trn_skill_defs', entityId: id, action: 'create', newValues: { code: b.code }, actor: actor.user, companyId: actor.companyId });
        return setup.skills.list(actor).find((s) => s.id === id);
      },
    },
  };

  // ------------------------------------------------------------------ sessions (FR-01)
  const sessionScope = (actor) => {
    const sc = authz.scopeFilter(actor, 'hr.session.view', { project: 's.project_id', site: 's.site_id' }).sql;
    return `s.company_id = :c AND ((s.project_id IS NULL AND s.site_id IS NULL) OR lower(s.created_by) = lower(:u) OR ${sc})`;
  };
  const sessionRow = (actor, id) => {
    const s = db.prepare('SELECT * FROM trn_sessions WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId);
    if (!s) throw notFound('That training session does not exist.');
    const me = myEmployee(actor);
    const attendee = me && db.prepare("SELECT 1 FROM trn_attendance WHERE session_id = ? AND person_type = 'EMPLOYEE' AND person_id = ? AND deleted_at IS NULL").get(id, me);
    const allowed = attendee || maker(actor, s) || (may(actor, 'hr.session.view') && ((!s.project_id && !s.site_id) || may(actor, 'hr.session.view', { projectId: s.project_id ?? undefined, siteId: s.site_id ?? undefined })));
    if (!allowed) throw notFound('That training session does not exist.');
    return s;
  };
  const seats = (id) => db.prepare("SELECT COUNT(*) AS n FROM trn_attendance WHERE session_id = ? AND deleted_at IS NULL").get(id).n;
  function sessionView(actor, s, { detail = false } = {}) {
    const c = db.prepare('SELECT * FROM trn_courses WHERE id = ?').get(s.course_id);
    const scope = { projectId: s.project_id ?? undefined, siteId: s.site_id ?? undefined };
    const editable = ['DRAFT', 'RETURNED'].includes(s.status) && maker(actor, s);
    const open = s.status === 'APPROVED';
    const out = {
      id: s.id, docNo: s.doc_no, status: s.status, statusLabel: SESSION_STATUS[s.status], rowVersion: s.version, courseId: s.course_id, course: c.title, courseCode: c.code, category: c.category, mode: c.mode, startAt: s.start_at, endAt: s.end_at, trainer: s.trainer, venue: s.venue,
      siteId: s.site_id, site: s.site_id ? db.prepare('SELECT name FROM org_sites WHERE id = ?').get(s.site_id)?.name : null, projectId: s.project_id, project: s.project_id ? db.prepare('SELECT name FROM org_projects WHERE id = ?').get(s.project_id)?.name : null,
      departmentId: s.department_id, capacity: s.capacity, seatsTaken: seats(s.id), cost: money(s.cost_minor), band: s.band, workflowInstanceId: s.workflow_instance_id, requestedBy: s.requested_by, cancelReason: s.cancel_reason, createdBy: s.created_by, passScore: c.pass_score,
      can: {
        edit: editable && may(actor, 'hr.session.edit', scope), submit: editable && may(actor, 'hr.session.submit', scope), delete: s.status === 'DRAFT' && maker(actor, s) && may(actor, 'hr.session.delete', scope), withdraw: s.status === 'SUBMITTED' && maker(actor, s),
        cancel: ['SUBMITTED', 'RETURNED', 'APPROVED'].includes(s.status) && may(actor, 'hr.session.cancel', scope), nominate: open && (may(actor, 'hr.training.nominate') || may(actor, 'hr.training.attendance')), mark: open && may(actor, 'hr.training.attendance'),
        complete: open && may(actor, 'hr.training.attendance'), reschedule: editable && may(actor, 'hr.session.edit', scope), qr: open && may(actor, 'hr.training.attendance'), print: may(actor, 'hr.session.print', scope),
      },
    };
    if (detail) out.attendance = attendanceOf(actor, s);
    return out;
  }
  function attendanceOf(actor, s) {
    const all = may(actor, 'hr.training.attendance') || may(actor, 'hr.cert.view_all');
    const me = myEmployee(actor);
    const line = me ? reportees(me) : new Set();
    return db.prepare('SELECT * FROM trn_attendance WHERE session_id = ? AND deleted_at IS NULL ORDER BY id').all(s.id)
      .filter((a) => all || maker(actor, s) || (a.person_type === 'EMPLOYEE' && (a.person_id === me || line.has(a.person_id))))
      .map((a) => ({ id: a.id, personType: a.person_type, personId: a.person_id, ...nameOf(a.person_type, a.person_id), attendance: a.attendance, signedInAt: a.signed_in_at, method: a.sign_in_method, score: a.score, passed: a.passed == null ? null : Boolean(a.passed), feedbackRating: a.feedback_rating, feedback: all ? a.feedback : null, nominatedBy: a.nominated_by }));
  }
  const sessionProblems = (actor, b, prev = null) => {
    const p = [];
    const c = db.prepare('SELECT * FROM trn_courses WHERE id = ? AND company_id = ? AND deleted_at IS NULL AND is_active = 1').get(b.courseId, actor.companyId);
    if (!c) p.push({ field: 'courseId', message: 'Choose a course from the list' });
    if (!(b.startAt < b.endAt)) p.push({ field: 'endAt', message: 'The session must end after it starts' });
    if (b.siteId) { const st = db.prepare('SELECT org_project_id AS pid FROM org_sites WHERE id = ? AND company_id = ? AND is_active = 1').get(b.siteId, actor.companyId); if (!st) p.push({ field: 'siteId', message: 'That site does not exist' }); else if (b.projectId && st.pid !== b.projectId) p.push({ field: 'siteId', message: 'That site belongs to another project' }); }
    if (b.projectId && !db.prepare('SELECT 1 FROM org_projects WHERE id = ? AND company_id = ? AND is_active = 1').get(b.projectId, actor.companyId)) p.push({ field: 'projectId', message: 'That project does not exist' });
    if (c?.mode === 'INTERNAL' && b.cost > 0) p.push({ field: 'cost', message: 'An internal session has no external fee; enter the cost of an external course only' });
    if (prev && b.capacity < seats(prev.id)) p.push({ field: 'capacity', message: `${seats(prev.id)} people are nominated already: the seats cannot be fewer` });
    return { problems: p, course: c };
  };
  const bandOf = (course, cost) => (course.mode === 'EXTERNAL' && cost > 0 ? 'EXTERNAL' : 'INTERNAL');
  const sessions = {
    list(actor, query) { need(actor, 'hr.session.view', 'see training sessions'); return runList(db, sessionList, parseListRequest(sessionList, query), { select: 's.*, c.title AS course_title', scopeSql: sessionScope(actor), params: { c: actor.companyId, u: actor.user }, tieBreaker: 's.id', map: (s) => sessionView(actor, s) }); },
    exportSource(actor, req) {
      need(actor, 'hr.session.export', 'export training sessions');
      const opts = { select: 's.*', scopeSql: sessionScope(actor), params: { c: actor.companyId, u: actor.user }, tieBreaker: 's.id' };
      return { title: sessionList.label, permission: 'hr.session.export', personal: false, columns: Object.entries(sessionList.columns).filter(([k]) => k !== 'courseId').map(([key, c]) => ({ key, label: c.label, type: c.type === 'enum' ? 'text' : c.type })), count: () => countList(db, sessionList, req, opts), rows: () => runList(db, sessionList, req, { ...opts, limit: null, map: (s) => { const v = sessionView(actor, s); return { docNo: v.docNo, course: v.course, category: v.category, mode: v.mode, startAt: v.startAt, endAt: v.endAt, trainer: v.trainer, venue: v.venue, site: v.site, project: v.project, capacity: v.capacity, cost: v.cost, status: v.statusLabel }; } }).data, describe: (x) => [x.q ? `search "${x.q}"` : '', ...x.filters.map((f) => `${sessionList.columns[f.key]?.label ?? f.key} ${f.op} ${f.raw}`)].filter(Boolean) };
    },
    /** The calendar (board): the sessions that fall in a range, grouped by the day they start. */
    calendar(actor, { from, to }) {
      need(actor, 'hr.session.view', 'see the training calendar');
      const rows = db.prepare(`SELECT s.* FROM trn_sessions s WHERE ${sessionScope(actor)} AND s.deleted_at IS NULL AND s.status NOT IN ('CANCELLED', 'REJECTED') AND substr(s.start_at, 1, 10) >= :from AND substr(s.start_at, 1, 10) <= :to ORDER BY s.start_at`).all({ c: actor.companyId, u: actor.user, from, to });
      return rows.map((s) => sessionView(actor, s));
    },
    get(actor, id) { return sessionView(actor, sessionRow(actor, id), { detail: true }); },
    create(actor, b) {
      need(actor, 'hr.session.create', 'plan training sessions', { projectId: b.projectId ?? undefined, siteId: b.siteId ?? undefined });
      const { problems, course } = sessionProblems(actor, b); if (problems.length) throw badRequest('Some fields are not valid.', problems);
      return transaction(db, () => {
        const no = nextDoc(actor, SESSION_DOC, 'trn_sessions', 'TRN');
        const id = Number(db.prepare("INSERT INTO trn_sessions (company_id, doc_no, doc_date, course_id, start_at, end_at, trainer, venue, department_id, capacity, cost_minor, status, band, project_id, site_id, qr_token, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, 'trn_session')")
          .run(actor.companyId, no, today(), b.courseId, b.startAt, b.endAt, b.trainer ?? null, b.venue ?? null, b.departmentId ?? null, b.capacity, Math.round((b.cost ?? 0) * 100), bandOf(course, b.cost ?? 0), b.projectId ?? null, b.siteId ?? null, randomBytes(12).toString('hex'), actor.user).lastInsertRowid);
        writeAudit(db, { entity: 'trn_sessions', entityId: id, action: 'create', newValues: { docNo: no, courseId: b.courseId }, actor: actor.user, companyId: actor.companyId });
        return b.submit ? sessions.submit(actor, id, {}) : sessions.get(actor, id);
      });
    },
    update(actor, id, b) {
      const s = sessionRow(actor, id);
      if (!['DRAFT', 'RETURNED'].includes(s.status)) throw conflict(`A session that is ${SESSION_STATUS[s.status].toLowerCase()} is not changed: cancel it and plan another.`);
      if (!maker(actor, s)) throw forbidden(`Only ${s.created_by}, who planned it, changes it.`);
      need(actor, 'hr.session.edit', 'change training sessions', { projectId: s.project_id ?? undefined, siteId: s.site_id ?? undefined });
      if (s.version !== b.version) throw conflict('This session was changed by someone else. Reload it and try again.');
      const { problems, course } = sessionProblems(actor, b, s); if (problems.length) throw badRequest('Some fields are not valid.', problems);
      db.prepare('UPDATE trn_sessions SET course_id = ?, start_at = ?, end_at = ?, trainer = ?, venue = ?, department_id = ?, capacity = ?, cost_minor = ?, band = ?, project_id = ?, site_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?')
        .run(b.courseId, b.startAt, b.endAt, b.trainer ?? null, b.venue ?? null, b.departmentId ?? null, b.capacity, Math.round((b.cost ?? 0) * 100), bandOf(course, b.cost ?? 0), b.projectId ?? null, b.siteId ?? null, actor.user, nowIso(), id);
      writeAudit(db, { entity: 'trn_sessions', entityId: id, action: 'update', newValues: { courseId: b.courseId }, actor: actor.user, companyId: actor.companyId });
      return sessions.get(actor, id);
    },
    /** The board moves a session that is still being planned to another day or time; the server checks the same things as a save. */
    reschedule(actor, id, b) {
      const s = sessionRow(actor, id);
      if (!['DRAFT', 'RETURNED'].includes(s.status)) throw conflict('Only a session that is still a draft or returned is moved on the calendar. An open session is locked: cancel it and plan another.');
      if (!maker(actor, s)) throw forbidden(`Only ${s.created_by}, who planned it, moves it.`);
      need(actor, 'hr.session.edit', 'move training sessions', { projectId: s.project_id ?? undefined, siteId: s.site_id ?? undefined });
      if (!(b.startAt < b.endAt)) throw badRequest('Some fields are not valid.', [{ field: 'endAt', message: 'The session must end after it starts' }]);
      db.prepare('UPDATE trn_sessions SET start_at = ?, end_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.startAt, b.endAt, actor.user, nowIso(), id);
      writeAudit(db, { entity: 'trn_sessions', entityId: id, action: 'reschedule', oldValues: { startAt: s.start_at, endAt: s.end_at }, newValues: b, actor: actor.user, companyId: actor.companyId });
      return sessions.get(actor, id);
    },
    remove(actor, id) {
      const s = sessionRow(actor, id);
      if (s.status !== 'DRAFT') throw new HttpError(409, 'LOCKED', 'Only a draft is deleted; cancel the others.');
      if (!maker(actor, s)) throw forbidden(`Only ${s.created_by} deletes this draft.`);
      need(actor, 'hr.session.delete', 'delete training sessions', { projectId: s.project_id ?? undefined, siteId: s.site_id ?? undefined });
      db.prepare('UPDATE trn_sessions SET deleted_at = ?, deleted_by = ?, is_active = 0, qr_token = NULL, version = version + 1 WHERE id = ?').run(nowIso(), actor.user, id);
      writeAudit(db, { entity: 'trn_sessions', entityId: id, action: 'delete', actor: actor.user, companyId: actor.companyId });
      return { id, deleted: true };
    },
    /** An external session with a cost goes to the manager and the HR manager; any other session is open for nomination once it is submitted (the rule of the approval matrix for the internal band is "no approval"). */
    submit(actor, id, { comment } = /** @type {any} */ ({})) {
      const s = sessionRow(actor, id);
      need(actor, 'hr.session.submit', 'submit training sessions', { projectId: s.project_id ?? undefined, siteId: s.site_id ?? undefined });
      if (!['DRAFT', 'RETURNED'].includes(s.status)) throw conflict(`This session is ${SESSION_STATUS[s.status].toLowerCase()}.`);
      if (!maker(actor, s)) throw forbidden(`Only ${s.created_by}, who planned it, submits it.`);
      const c = db.prepare('SELECT * FROM trn_courses WHERE id = ?').get(s.course_id);
      return transaction(db, () => {
        const band = bandOf(c, s.cost_minor);
        db.prepare('UPDATE trn_sessions SET band = ?, requested_by = ? WHERE id = ?').run(band, actor.user, id);
        if (band === 'INTERNAL') {
          db.prepare("UPDATE trn_sessions SET status = 'APPROVED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), id);
          writeAudit(db, { entity: 'trn_sessions', entityId: id, action: 'open', reason: 'Internal session without a fee: open for nomination (no approval chain in the matrix)', actor: actor.user, companyId: actor.companyId });
          event('trn.session.approved', actor, 'trn_session', id, s.company_id, { docNo: s.doc_no, courseId: s.course_id, startAt: s.start_at }, s.project_id, s.site_id);
        } else {
          const ctx = { band, cost: s.cost_minor / 100, courseId: s.course_id };
          if (s.status === 'RETURNED') workflowOf(db).resubmit(actor, s.workflow_instance_id, { comment: comment ?? 'Corrected', context: ctx });
          else { const inst = workflowOf(db).submit(actor, { docType: SESSION_DOC, docId: id, comment: comment ?? 'Training session', context: ctx }); db.prepare('UPDATE trn_sessions SET workflow_instance_id = ? WHERE id = ?').run(inst.id, id); }
          db.prepare("UPDATE trn_sessions SET status = 'SUBMITTED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), id);
          writeAudit(db, { entity: 'trn_sessions', entityId: id, action: 'submit', reason: comment ?? null, actor: actor.user, companyId: actor.companyId });
        }
        return sessions.get(actor, id);
      });
    },
    withdraw(actor, id, { reason }) {
      const s = sessionRow(actor, id);
      if (s.status !== 'SUBMITTED') throw unprocessable('Only a session in approval is withdrawn.');
      if (!maker(actor, s)) throw forbidden('Only the person who planned it withdraws it.');
      workflowOf(db).withdraw(actor, s.workflow_instance_id, { comment: reason });
      return sessions.get(actor, id);
    },
    cancel(actor, id, { reason }) {
      const s = sessionRow(actor, id);
      need(actor, 'hr.session.cancel', 'cancel training sessions', { projectId: s.project_id ?? undefined, siteId: s.site_id ?? undefined });
      if (!['SUBMITTED', 'RETURNED', 'APPROVED'].includes(s.status)) throw unprocessable('Only a session in approval, returned or open is cancelled; delete a draft.');
      return transaction(db, () => {
        if (s.status === 'SUBMITTED') { if (maker(actor, s)) { workflowOf(db).abandon(actor.companyId, s.workflow_instance_id, actor.user, 'CANCELLED', reason); decide({ docId: s.id, status: 'CANCELLED' }, actor, 'CANCELLED', reason); } else workflowOf(db).cancel(actor, s.workflow_instance_id, { reason }); return sessions.get(actor, id); }
        db.prepare("UPDATE trn_sessions SET status = 'CANCELLED', cancel_reason = ?, qr_token = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), id);
        writeAudit(db, { entity: 'trn_sessions', entityId: id, action: 'cancel', reason, actor: actor.user, companyId: actor.companyId });
        event('trn.session.cancelled', actor, 'trn_session', id, s.company_id, { docNo: s.doc_no, reason }, s.project_id, s.site_id);
        return sessions.get(actor, id);
      });
    },
    history(actor, id) {
      const s = sessionRow(actor, id);
      return { approvals: s.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(s.workflow_instance_id) : [], audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'trn_sessions' AND entity_id = ? ORDER BY id").all(String(id)).map((x) => ({ action: x.action, by: x.actor, reason: x.reason, at: x.at })) };
    },
    /** The attendance sheet to print and sign on the day: the session and the people nominated, with a column to sign. */
    print(actor, id) {
      const s = sessionRow(actor, id); need(actor, 'hr.session.print', 'print training sessions');
      const v = sessionView(actor, s, { detail: true });
      const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
      writeAudit(db, { entity: 'trn_sessions', entityId: id, action: 'print', actor: actor.user, companyId: actor.companyId });
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(v.docNo)} attendance sheet</title><style>body{font:14px sans-serif;margin:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #888;padding:6px;text-align:left}</style></head><body><h1>${esc(v.course)}</h1><p>${esc(v.docNo)} · ${esc(v.startAt.replace('T', ' '))} to ${esc(v.endAt.replace('T', ' '))} · ${esc(v.venue ?? '')} · Trainer: ${esc(v.trainer ?? '')}</p><table><thead><tr><th>#</th><th>Code</th><th>Name</th><th>Signature</th></tr></thead><tbody>${v.attendance.map((a, i) => `<tr><td>${i + 1}</td><td>${esc(a.code)}</td><td>${esc(a.name)}</td><td style="width:35%"></td></tr>`).join('')}</tbody></table></body></html>`;
    },
    /** The QR code of the session: it opens the sign-in page with the token. Only the trainer's side may ask for it, and only while the session is open. */
    async qr(actor, id, origin) {
      const s = sessionRow(actor, id); need(actor, 'hr.training.attendance', 'show the sign-in code');
      if (s.status !== 'APPROVED' || !s.qr_token) throw unprocessable('The sign-in code is available while the session is open.');
      const url = `${origin ?? ''}/training/mine?t=${s.qr_token}`;
      return { url, svg: await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }), token: s.qr_token };
    },
  };

  // ------------------------------------------------------------------ nominations, QR sign-in, attendance, results, feedback (FR-01, FR-05)
  const attRow = (id) => db.prepare('SELECT * FROM trn_attendance WHERE id = ? AND deleted_at IS NULL').get(id);
  const attendance = {
    nominate(actor, sessionId, people) {
      const s = sessionRow(actor, sessionId);
      if (s.status !== 'APPROVED') throw unprocessable('People are nominated to a session that is open.');
      if (!may(actor, 'hr.training.nominate') && !may(actor, 'hr.training.attendance')) throw forbidden('You may not nominate people (permission hr.training.nominate).');
      const out = [];
      return transaction(db, () => {
        for (const p of people) {
          const person = personOf(actor.companyId, p.personType, p.personId);
          if (person.error) throw badRequest('Some fields are not valid.', [{ field: 'personId', message: person.error }]);
          if (!canSee(actor, p.personType, p.personId) && !may(actor, 'hr.training.attendance')) throw forbidden(`${person.name} does not report to you: you nominate the people of your own team.`);
          if (db.prepare('SELECT 1 FROM trn_attendance WHERE session_id = ? AND person_type = ? AND person_id = ? AND deleted_at IS NULL').get(sessionId, p.personType, p.personId)) continue;
          if (seats(sessionId) >= s.capacity) throw unprocessable(`All ${s.capacity} seats are taken.`);
          const id = Number(db.prepare("INSERT INTO trn_attendance (company_id, session_id, person_type, person_id, nominated_by, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'trn_session')").run(actor.companyId, sessionId, p.personType, p.personId, actor.user, s.project_id, s.site_id, actor.user).lastInsertRowid);
          writeAudit(db, { entity: 'trn_attendance', entityId: id, action: 'nominate', newValues: { sessionId, personType: p.personType, personId: p.personId }, actor: actor.user, companyId: actor.companyId });
          event('trn.attendance.nominated', actor, 'trn_attendance', id, s.company_id, { sessionId, personType: p.personType, personId: p.personId }, s.project_id, s.site_id);
          const c = db.prepare('SELECT title FROM trn_courses WHERE id = ?').get(s.course_id);
          if (person.userId) { const to = usernameOf(person.userId); if (to) notif.notify({ companyId: actor.companyId, templateCode: 'trn.nominated', recipients: [`user:${to}`], data: { title: c.title, when: s.start_at.replace('T', ' '), venue: s.venue ?? 'the venue' }, link: '/training/mine', sourceType: 'trn_session', sourceId: s.doc_no, eventKey: `trn.nominated:${s.doc_no}:${person.id}` }); }
          out.push(id);
        }
        return sessions.get(actor, sessionId);
      });
    },
    unnominate(actor, sessionId, attendanceId) {
      const s = sessionRow(actor, sessionId); const a = attRow(attendanceId);
      if (!a || a.session_id !== sessionId) throw notFound('That nomination does not exist.');
      if (a.attendance !== 'NOMINATED') throw unprocessable('Somebody who attended or was marked absent is not removed.');
      if (!(maker(actor, a) || may(actor, 'hr.training.attendance'))) throw forbidden('Only the person who nominated, or the trainer side, removes a nomination.');
      db.prepare('UPDATE trn_attendance SET deleted_at = ?, deleted_by = ?, is_active = 0, version = version + 1 WHERE id = ?').run(nowIso(), actor.user, a.id);
      writeAudit(db, { entity: 'trn_attendance', entityId: a.id, action: 'remove', actor: actor.user, companyId: actor.companyId });
      return sessions.get(actor, s.id);
    },
    /** FR-01: the person scans the QR code of the session and signs in for themselves; the window opens an hour before the start and closes two hours after the end. Somebody not nominated is added when a seat is free. */
    signIn(actor, { token }) {
      need(actor, 'hr.training.own', 'sign in to a training');
      const me = myEmployee(actor); if (!me) throw new HttpError(422, 'NO_EMPLOYEE', 'Your user account is not linked to an employee record. Ask HR to link it.');
      const s = token ? db.prepare("SELECT * FROM trn_sessions WHERE qr_token = ? AND company_id = ? AND deleted_at IS NULL").get(String(token), actor.companyId) : null;
      if (!s) throw notFound('That code does not belong to an open training session.');
      if (s.status !== 'APPROVED') throw unprocessable(`This session is ${SESSION_STATUS[s.status].toLowerCase()}.`);
      const now = istNow();
      const opens = new Date(Date.parse(`${s.start_at}:00Z`) - 3_600_000).toISOString().slice(0, 16); const closes = new Date(Date.parse(`${s.end_at}:00Z`) + 7_200_000).toISOString().slice(0, 16);
      if (now < opens) throw unprocessable(`Sign-in opens an hour before the start (${s.start_at.replace('T', ' ')}).`);
      if (now > closes) throw unprocessable('Sign-in closed two hours after the end of the session.');
      return transaction(db, () => {
        let a = db.prepare("SELECT * FROM trn_attendance WHERE session_id = ? AND person_type = 'EMPLOYEE' AND person_id = ? AND deleted_at IS NULL").get(s.id, me);
        if (!a) {
          if (seats(s.id) >= s.capacity) throw unprocessable(`All ${s.capacity} seats are taken.`);
          const id = Number(db.prepare("INSERT INTO trn_attendance (company_id, session_id, person_type, person_id, nominated_by, project_id, site_id, created_by, source_type) VALUES (?, ?, 'EMPLOYEE', ?, ?, ?, ?, ?, 'trn_session')").run(actor.companyId, s.id, me, `${actor.user} (walk-in)`, s.project_id, s.site_id, actor.user).lastInsertRowid);
          a = attRow(id);
        }
        if (a.attendance !== 'ATTENDED') {
          db.prepare("UPDATE trn_attendance SET attendance = 'ATTENDED', signed_in_at = ?, sign_in_method = 'QR', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(nowIso(), actor.user, nowIso(), a.id);
          writeAudit(db, { entity: 'trn_attendance', entityId: a.id, action: 'sign_in', newValues: { sessionId: s.id, method: 'QR' }, actor: actor.user, companyId: actor.companyId });
          event('trn.attendance.recorded', actor, 'trn_attendance', a.id, s.company_id, { sessionId: s.id, personType: 'EMPLOYEE', personId: me, attendance: 'ATTENDED', method: 'QR' }, s.project_id, s.site_id);
        }
        const c = db.prepare('SELECT title FROM trn_courses WHERE id = ?').get(s.course_id);
        return { sessionId: s.id, docNo: s.doc_no, course: c.title, startAt: s.start_at, signedIn: true };
      });
    },
    /** The trainer marks attendance and the post-test score of each person (FR-01, FR-05). A score at or above the pass mark of the course is a pass; with no pass mark, attending is a pass. */
    mark(actor, sessionId, rows) {
      const s = sessionRow(actor, sessionId); need(actor, 'hr.training.attendance', 'mark attendance');
      if (s.status !== 'APPROVED') throw unprocessable(s.status === 'COMPLETED' ? 'The session is completed: its attendance is closed.' : 'Attendance is marked while the session is open.');
      const c = db.prepare('SELECT pass_score FROM trn_courses WHERE id = ?').get(s.course_id);
      return transaction(db, () => {
        for (const r of rows) {
          let a = r.attendanceId ? attRow(r.attendanceId) : db.prepare('SELECT * FROM trn_attendance WHERE session_id = ? AND person_type = ? AND person_id = ? AND deleted_at IS NULL').get(sessionId, r.personType, r.personId);
          if (!a || a.session_id !== sessionId) throw notFound('That person is not nominated to this session.');
          const att = r.attendance ?? a.attendance;
          if (att !== 'ATTENDED' && r.score != null) throw badRequest('Some fields are not valid.', [{ field: 'score', message: 'A score is given only to somebody who attended' }]);
          const score = r.score ?? a.score;
          const passed = att !== 'ATTENDED' ? null : score != null && c.pass_score != null ? (score >= c.pass_score ? 1 : 0) : c.pass_score != null ? null : 1;
          db.prepare("UPDATE trn_attendance SET attendance = ?, score = ?, passed = ?, signed_in_at = CASE WHEN ? = 'ATTENDED' AND signed_in_at IS NULL THEN ? ELSE signed_in_at END, sign_in_method = CASE WHEN ? = 'ATTENDED' AND sign_in_method IS NULL THEN 'TRAINER' ELSE sign_in_method END, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?")
            .run(att, att === 'ATTENDED' ? score ?? null : null, passed, att, nowIso(), att, actor.user, nowIso(), a.id);
          writeAudit(db, { entity: 'trn_attendance', entityId: a.id, action: 'mark', newValues: { attendance: att, score: score ?? null }, actor: actor.user, companyId: actor.companyId });
          event('trn.attendance.recorded', actor, 'trn_attendance', a.id, s.company_id, { sessionId, personType: a.person_type, personId: a.person_id, attendance: att, score: score ?? null }, s.project_id, s.site_id);
        }
        return sessions.get(actor, sessionId);
      });
    },
    /** FR-05: the person who attended rates the training and says what they think of it once it is over (or while it runs). */
    feedback(actor, sessionId, b) {
      need(actor, 'hr.training.own', 'give feedback');
      const me = myEmployee(actor); const s = sessionRow(actor, sessionId);
      const a = me && db.prepare("SELECT * FROM trn_attendance WHERE session_id = ? AND person_type = 'EMPLOYEE' AND person_id = ? AND deleted_at IS NULL").get(sessionId, me);
      if (!a || a.attendance !== 'ATTENDED') throw unprocessable('Feedback is given by somebody who attended the session.');
      if (!['APPROVED', 'COMPLETED'].includes(s.status)) throw unprocessable('Feedback is given while the session is open or after it.');
      db.prepare('UPDATE trn_attendance SET feedback_rating = ?, feedback = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.rating, b.comment ?? null, actor.user, nowIso(), a.id);
      writeAudit(db, { entity: 'trn_attendance', entityId: a.id, action: 'feedback', newValues: { rating: b.rating }, actor: actor.user, companyId: actor.companyId });
      return { sessionId, rating: b.rating };
    },
    /** The trainer closes the session: those not marked are absent, and everybody who passed a course that carries a certificate type is given that certificate (verified: the training is the proof). */
    complete(actor, sessionId) {
      const s = sessionRow(actor, sessionId); need(actor, 'hr.training.attendance', 'complete a session');
      if (s.status !== 'APPROVED') throw unprocessable('Only an open session is completed.');
      if (istNow() < s.start_at) throw unprocessable('The session has not started yet.');
      const c = db.prepare('SELECT * FROM trn_courses WHERE id = ?').get(s.course_id);
      return transaction(db, () => {
        db.prepare("UPDATE trn_attendance SET attendance = 'ABSENT', updated_by = ?, updated_at = ?, version = version + 1 WHERE session_id = ? AND attendance = 'NOMINATED' AND deleted_at IS NULL").run(actor.user, nowIso(), sessionId);
        db.prepare("UPDATE trn_sessions SET status = 'COMPLETED', completed_at = ?, qr_token = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(nowIso(), actor.user, nowIso(), sessionId);
        const day = s.end_at.slice(0, 10); let certs = 0;
        const t = c.cert_type_code ? certTypeRow(s.company_id, c.cert_type_code) : null;
        if (t) {
          for (const a of db.prepare("SELECT * FROM trn_attendance WHERE session_id = ? AND attendance = 'ATTENDED' AND passed = 1 AND deleted_at IS NULL").all(sessionId)) {
            const months = c.validity_months ?? t.validity_months;
            db.prepare("INSERT INTO trn_certifications (company_id, person_type, person_id, cert_type, number, issuer, valid_from, valid_until, verified, verified_by, verified_at, session_id, project_id, site_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 'trn_session', ?)")
              .run(s.company_id, a.person_type, a.person_id, t.code, s.doc_no, s.trainer ?? 'Company training', day, months ? addMonths(day, months) : null, actor.user, nowIso(), s.id, s.project_id, s.site_id, actor.user, String(s.id));
            certs += 1;
          }
        }
        writeAudit(db, { entity: 'trn_sessions', entityId: sessionId, action: 'complete', newValues: { certificates: certs }, actor: actor.user, companyId: actor.companyId });
        event('trn.session.completed', actor, 'trn_session', sessionId, s.company_id, { docNo: s.doc_no, courseId: s.course_id, certificates: certs }, s.project_id, s.site_id);
        return { ...sessions.get(actor, sessionId), certificatesIssued: certs };
      });
    },
  };

  // ------------------------------------------------------------------ certifications and licences (FR-03, BR-01)
  const certScope = (actor) => {
    if (may(actor, 'hr.cert.view_all')) return 'x.company_id = :c';
    const me = myEmployee(actor); const ids = me ? [me, ...reportees(me)] : [];
    return `x.company_id = :c AND x.person_type = 'EMPLOYEE' AND x.person_id IN (${ids.length ? ids.join(',') : '0'})`;
  };
  const certView = (actor, x, types = new Map()) => {
    const t = types.get(x.cert_type) ?? certTypeRow(x.company_id, x.cert_type); const who = nameOf(x.person_type, x.person_id);
    const state = certState(x, t?.alert_days, today());
    const mine = x.person_type === 'EMPLOYEE' && myEmployee(actor) === x.person_id;
    return { id: x.id, personType: x.person_type, personId: x.person_id, person: who.name, code: who.code, certType: x.cert_type, certName: t?.name ?? x.cert_type, number: x.number, issuer: x.issuer, validFrom: x.valid_from, validUntil: x.valid_until, fileId: x.file_id, verified: Boolean(x.verified), verifiedBy: x.verified_by, verifiedAt: x.verified_at, status: x.cert_status, state, stateLabel: CERT_STATE[state], daysLeft: x.valid_until ? Math.round((Date.parse(x.valid_until) - Date.parse(today())) / 86_400_000) : null, sessionId: x.session_id, rowVersion: x.version, createdBy: x.created_by,
      can: { edit: x.cert_status === 'ACTIVE' && (!x.verified ? (maker(actor, x) || may(actor, 'hr.cert.edit')) : may(actor, 'hr.cert.edit')), verify: x.cert_status === 'ACTIVE' && !x.verified && may(actor, 'hr.cert.verify') && !maker(actor, x), revoke: x.cert_status === 'ACTIVE' && may(actor, 'hr.cert.verify'), delete: !x.verified && x.cert_status === 'ACTIVE' && (maker(actor, x) || may(actor, 'hr.cert.edit')), mine } };
  };
  const certRow = (actor, id) => {
    const x = db.prepare('SELECT * FROM trn_certifications WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId);
    if (!x || !(maker(actor, x) || canSee(actor, x.person_type, x.person_id))) throw notFound('That certificate does not exist.');
    return x;
  };
  const certProblems = (actor, b) => {
    const p = [];
    if (!certTypeRow(actor.companyId, b.certType)) p.push({ field: 'certType', message: 'Choose a certificate type from the list' });
    if (b.validUntil && b.validUntil < b.validFrom) p.push({ field: 'validUntil', message: 'The certificate cannot end before it starts' });
    if (b.fileId && !db.prepare('SELECT 1 FROM core_files WHERE id = ? AND company_id = ?').get(b.fileId, actor.companyId)) p.push({ field: 'fileId', message: 'That document does not exist' });
    return p;
  };
  const certs = {
    types: setup.certTypes,
    list(actor, query) {
      need(actor, 'hr.cert.view', 'see certifications');
      const types = new Map(db.prepare('SELECT * FROM trn_cert_types WHERE company_id = ?').all(actor.companyId).map((t) => [t.code.toLowerCase(), t]));
      return runList(db, certList, parseListRequest(certList, query), { select: 'x.*', scopeSql: certScope(actor), params: { c: actor.companyId }, tieBreaker: 'x.id', map: (x) => certView(actor, x, { get: (k) => types.get(String(k).toLowerCase()) }) });
    },
    exportSource(actor, req) {
      need(actor, 'hr.cert.export', 'export certifications');
      const opts = { select: 'x.*', scopeSql: certScope(actor), params: { c: actor.companyId }, tieBreaker: 'x.id' };
      return { title: certList.label, permission: 'hr.cert.export', personal: true, columns: Object.entries(certList.columns).map(([key, c]) => ({ key, label: c.label, type: c.type === 'enum' ? 'text' : c.type })), count: () => countList(db, certList, req, opts), rows: () => runList(db, certList, req, { ...opts, limit: null, map: (x) => { const v = certView(actor, x); return { person: v.person, code: v.code, personType: v.personType, certType: v.certName, number: v.number, issuer: v.issuer, validFrom: v.validFrom, validUntil: v.validUntil, verified: v.verified ? 'Verified' : 'Not verified', state: v.stateLabel }; } }).data, describe: (x) => [x.q ? `search "${x.q}"` : '', ...x.filters.map((f) => `${certList.columns[f.key]?.label ?? f.key} ${f.op} ${f.raw}`)].filter(Boolean) };
    },
    get(actor, id) { return certView(actor, certRow(actor, id)); },
    /** HR (and the safety team) record the certificates of anybody; a person may record their own, which then waits for HR to verify it (a certificate that is not verified does not count for a check). */
    create(actor, b) {
      const own = b.personType === 'EMPLOYEE' && myEmployee(actor) === b.personId;
      if (!(may(actor, 'hr.cert.create') || (own && may(actor, 'hr.training.own')))) throw forbidden('You may record your own certificates; HR records those of others (permission hr.cert.create).');
      const person = db.prepare(b.personType === 'EMPLOYEE' ? 'SELECT id FROM hr_employees WHERE id = ? AND company_id = ? AND deleted_at IS NULL' : 'SELECT id FROM lab_workers WHERE id = ? AND company_id = ? AND deleted_at IS NULL AND root_id = id').get(b.personId, actor.companyId);
      if (!person) throw badRequest('Some fields are not valid.', [{ field: 'personId', message: 'That person does not exist' }]);
      const problems = certProblems(actor, b); if (problems.length) throw badRequest('Some fields are not valid.', problems);
      const t = certTypeRow(actor.companyId, b.certType);
      if (b.number && db.prepare("SELECT 1 FROM trn_certifications WHERE company_id = ? AND person_type = ? AND person_id = ? AND cert_type = ? COLLATE NOCASE AND number = ? COLLATE NOCASE AND cert_status = 'ACTIVE' AND deleted_at IS NULL").get(actor.companyId, b.personType, b.personId, t.code, b.number)) throw conflict(`That certificate (${b.number}) is recorded already for this person.`);
      const id = Number(db.prepare("INSERT INTO trn_certifications (company_id, person_type, person_id, cert_type, number, issuer, valid_from, valid_until, file_id, verified, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'trn_cert')")
        .run(actor.companyId, b.personType, b.personId, t.code, b.number ?? null, b.issuer ?? null, b.validFrom, b.validUntil ?? (t.validity_months ? addMonths(b.validFrom, t.validity_months) : null), b.fileId ?? null, actor.user).lastInsertRowid);
      writeAudit(db, { entity: 'trn_certifications', entityId: id, action: 'create', newValues: { certType: t.code, personType: b.personType, personId: b.personId }, actor: actor.user, companyId: actor.companyId });
      event('trn.cert.added', actor, 'trn_certification', id, actor.companyId, { personType: b.personType, personId: b.personId, certType: t.code, validUntil: b.validUntil ?? null }, null, null);
      return certView(actor, certRow(actor, id));
    },
    update(actor, id, b) {
      const x = certRow(actor, id);
      if (!certView(actor, x).can.edit) throw forbidden('You may not change this certificate.');
      if (x.version !== b.version) throw conflict('This certificate was changed by someone else. Reload it and try again.');
      const problems = certProblems(actor, { ...b, certType: x.cert_type }); if (problems.length) throw badRequest('Some fields are not valid.', problems);
      // a change of a verified certificate needs the verification again: what HR checked is not what is there now
      db.prepare('UPDATE trn_certifications SET number = ?, issuer = ?, valid_from = ?, valid_until = ?, file_id = ?, verified = 0, verified_by = NULL, verified_at = NULL, alerted_state = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?')
        .run(b.number ?? null, b.issuer ?? null, b.validFrom, b.validUntil ?? null, b.fileId ?? null, actor.user, nowIso(), id);
      writeAudit(db, { entity: 'trn_certifications', entityId: id, action: 'update', oldValues: { validUntil: x.valid_until, number: x.number }, newValues: { validUntil: b.validUntil ?? null, number: b.number ?? null }, actor: actor.user, companyId: actor.companyId });
      return certView(actor, certRow(actor, id));
    },
    remove(actor, id) {
      const x = certRow(actor, id);
      if (!certView(actor, x).can.delete) throw forbidden('Only a certificate that is not verified is deleted, by the person who recorded it or by HR.');
      db.prepare('UPDATE trn_certifications SET deleted_at = ?, deleted_by = ?, is_active = 0, version = version + 1 WHERE id = ?').run(nowIso(), actor.user, id);
      writeAudit(db, { entity: 'trn_certifications', entityId: id, action: 'delete', actor: actor.user, companyId: actor.companyId });
      return { id, deleted: true };
    },
    verify(actor, id, { note } = /** @type {any} */ ({})) {
      need(actor, 'hr.cert.verify', 'verify certificates');
      const x = certRow(actor, id);
      if (x.cert_status !== 'ACTIVE') throw unprocessable('A revoked certificate is not verified.');
      if (x.verified) throw conflict('This certificate is verified already.');
      if (maker(actor, x)) throw forbidden('You recorded this certificate: somebody else verifies it.');
      db.prepare('UPDATE trn_certifications SET verified = 1, verified_by = ?, verified_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(actor.user, nowIso(), actor.user, nowIso(), id);
      writeAudit(db, { entity: 'trn_certifications', entityId: id, action: 'verify', reason: note ?? null, actor: actor.user, companyId: actor.companyId });
      event('trn.cert.verified', actor, 'trn_certification', id, actor.companyId, { personType: x.person_type, personId: x.person_id, certType: x.cert_type, validUntil: x.valid_until }, null, null);
      return certView(actor, certRow(actor, id));
    },
    revoke(actor, id, { reason }) {
      need(actor, 'hr.cert.verify', 'revoke certificates');
      const x = certRow(actor, id);
      if (x.cert_status !== 'ACTIVE') throw conflict('This certificate is revoked already.');
      db.prepare("UPDATE trn_certifications SET cert_status = 'REVOKED', revoked_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), id);
      writeAudit(db, { entity: 'trn_certifications', entityId: id, action: 'revoke', reason, actor: actor.user, companyId: actor.companyId });
      event('trn.cert.revoked', actor, 'trn_certification', id, actor.companyId, { personType: x.person_type, personId: x.person_id, certType: x.cert_type, reason }, null, null);
      return certView(actor, certRow(actor, id));
    },
    /**
     * BR-01, the check other parts call (permits to work, operator assignment, resource planning): does this person hold a valid, verified certificate of each type on the day? A person holds a type when at least one of their certificates of it is valid.
     * The answer says for each type which certificate decides and why not when it fails.
     */
    check(companyId, { personType, personId, certTypes, on = today() }) {
      const results = certTypes.map((code) => {
        const t = db.prepare('SELECT * FROM trn_cert_types WHERE company_id = ? AND code = ? COLLATE NOCASE AND deleted_at IS NULL').get(companyId, code);
        if (!t) return { certType: code, ok: false, state: 'MISSING', reason: `${code} is not a known certificate type` };
        const rows = db.prepare("SELECT * FROM trn_certifications WHERE company_id = ? AND person_type = ? AND person_id = ? AND cert_type = ? COLLATE NOCASE AND deleted_at IS NULL ORDER BY COALESCE(valid_until, '9999-12-31') DESC, id DESC").all(companyId, personType, personId, t.code);
        if (!rows.length) return { certType: t.code, name: t.name, ok: false, state: 'MISSING', reason: `no ${t.name} on record` };
        const scored = rows.map((r) => ({ r, state: certState(r, t.alert_days, on) }));
        const good = scored.find((s) => s.state === 'VALID' || s.state === 'EXPIRING');
        if (good) return { certType: t.code, name: t.name, ok: true, state: good.state, number: good.r.number, validUntil: good.r.valid_until, certificateId: good.r.id };
        const best = scored[0];
        return { certType: t.code, name: t.name, ok: false, state: best.state, number: best.r.number, validUntil: best.r.valid_until, certificateId: best.r.id, reason: best.state === 'EXPIRED' ? `${t.name} ${best.r.number ? `(${best.r.number}) ` : ''}expired on ${best.r.valid_until}` : best.state === 'UNVERIFIED' ? `${t.name} ${best.r.number ? `(${best.r.number}) ` : ''}is not verified by HR yet` : `${t.name} was revoked` };
      });
      return { personType, personId, on, ok: results.every((r) => r.ok), results, problems: results.filter((r) => !r.ok).map((r) => r.reason) };
    },
    /** The check is for those who see the person, and for the parts that ask it for permits and assignments (hr.cert.check). */
    mayCheck: (actor) => may(actor, 'hr.cert.check'),
    /** The certificate types a person needs for their post (by designation for an employee, by trade for a worker). */
    requiredFor(companyId, personType, personId) {
      const key = personType === 'EMPLOYEE' ? db.prepare('SELECT g.code AS k FROM hr_employees e LEFT JOIN org_designations g ON g.id = e.designation_id WHERE e.id = ?').get(personId)?.k : db.prepare('SELECT trade_code AS k FROM lab_workers WHERE id = ?').get(personId)?.k;
      if (!key) return [];
      return db.prepare('SELECT * FROM trn_cert_types WHERE company_id = ? AND mandatory = 1 AND deleted_at IS NULL').all(companyId).filter((t) => { const r = json(t.required_for_json, {}); return (personType === 'EMPLOYEE' ? r.designationCodes : r.tradeCodes)?.some((c) => same(c, key)); }).map((t) => t.code);
    },
  };
  assignmentGuards.length = 0;
  assignmentGuards.push((companyId, b) => {
    const need_ = certs.requiredFor(companyId, b.personType, b.personId); if (!need_.length) return [];
    const r = certs.check(companyId, { personType: b.personType, personId: b.personId, certTypes: need_, on: b.fromDate ?? today() });
    return r.ok ? [] : r.problems.map((m) => ({ field: 'personId', message: `The posting needs ${need_.join(', ')}: ${m}` }));
  });

  // ------------------------------------------------------------------ skills (FR-04)
  const skills = {
    defs: setup.skills,
    assess(actor, b) {
      need(actor, 'hr.skill.assess', 'assess skills');
      if (!db.prepare('SELECT 1 FROM trn_skill_defs WHERE company_id = ? AND code = ? COLLATE NOCASE AND deleted_at IS NULL').get(actor.companyId, b.skillCode)) throw badRequest('Some fields are not valid.', [{ field: 'skillCode', message: 'Choose a skill from the list' }]);
      if (!canSee(actor, b.personType, b.personId)) throw forbidden('You assess the people who report to you; HR assesses anybody.');
      const person = personOf(actor.companyId, b.personType, b.personId); if (person.error) throw badRequest('Some fields are not valid.', [{ field: 'personId', message: person.error }]);
      const me = myEmployee(actor);
      if (b.personType === 'EMPLOYEE' && me === b.personId) throw forbidden('Nobody assesses their own skill.');
      const id = Number(db.prepare('INSERT INTO trn_skills (company_id, person_type, person_id, skill_code, level, assessed_on, assessor_id, assessor, notes, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(actor.companyId, b.personType, b.personId, b.skillCode, b.level, b.assessedOn ?? today(), me, actor.user, b.notes ?? null, actor.user, 'trn_skill').lastInsertRowid);
      writeAudit(db, { entity: 'trn_skills', entityId: id, action: 'assess', newValues: { personType: b.personType, personId: b.personId, skill: b.skillCode, level: b.level }, actor: actor.user, companyId: actor.companyId });
      event('trn.skill.assessed', actor, 'trn_skill', id, actor.companyId, { personType: b.personType, personId: b.personId, skillCode: b.skillCode, level: b.level }, null, null);
      return { id, personType: b.personType, personId: b.personId, skillCode: b.skillCode, level: b.level, levelLabel: LEVELS[b.level] };
    },
    history(actor, { personType, personId, skillCode }) {
      need(actor, 'hr.skill.view', 'see skill assessments');
      if (!canSee(actor, personType, personId)) throw notFound('That person does not exist.');
      return db.prepare('SELECT * FROM trn_skills WHERE company_id = ? AND person_type = ? AND person_id = ? AND skill_code = ? COLLATE NOCASE AND deleted_at IS NULL ORDER BY assessed_on DESC, id DESC LIMIT 50').all(actor.companyId, personType, personId, skillCode).map((s) => ({ id: s.id, level: s.level, levelLabel: LEVELS[s.level], assessedOn: s.assessed_on, assessor: s.assessor, notes: s.notes }));
    },
    /** The matrix: people in the rows, skills in the columns, the latest assessed level in each cell, for a site or a trade. */
    matrix(actor, { siteId = null, trade = null, kind = 'EMPLOYEE' } = /** @type {any} */ ({})) {
      need(actor, 'hr.skill.view', 'see the skill matrix');
      const defs = db.prepare('SELECT * FROM trn_skill_defs WHERE company_id = ? AND deleted_at IS NULL AND (? IS NULL OR trade = ?) ORDER BY trade, name').all(actor.companyId, trade, trade);
      const all = may(actor, 'hr.cert.view_all');
      const me = myEmployee(actor); const line = me ? reportees(me) : new Set();
      const people = kind === 'WORKER'
        ? (all ? db.prepare("SELECT id, name, worker_code AS code, trade_code AS trade FROM lab_workers WHERE company_id = ? AND root_id = id AND status = 'APPROVED' AND worker_status = 'ACTIVE' AND deleted_at IS NULL ORDER BY name LIMIT 500").all(actor.companyId) : [])
        : db.prepare("SELECT e.id, e.full_name AS name, e.emp_code AS code, g.name AS trade FROM hr_employees e LEFT JOIN org_designations g ON g.id = e.designation_id WHERE e.company_id = ? AND e.deleted_at IS NULL AND e.record_status = 'APPROVED' AND e.employment_status IN ('ACTIVE', 'NOTICE') ORDER BY e.full_name LIMIT 2000").all(actor.companyId).filter((p) => all || p.id === me || line.has(p.id));
      const deployedAt = siteId ? new Set(db.prepare("SELECT person_id FROM hr_deployments WHERE company_id = ? AND person_type = ? AND dep_site_id = ? AND deleted_at IS NULL AND status = 'APPROVED' AND from_date <= ? AND (to_date IS NULL OR to_date >= ?)").all(actor.companyId, kind, siteId, today(), today()).map((d) => d.person_id)) : null;
      const rows = people.filter((p) => !deployedAt || deployedAt.has(p.id)).slice(0, 300);
      const latest = db.prepare("SELECT s.skill_code, s.level, s.assessed_on FROM trn_skills s WHERE s.company_id = ? AND s.person_type = ? AND s.person_id = ? AND s.deleted_at IS NULL AND s.id = (SELECT s2.id FROM trn_skills s2 WHERE s2.company_id = s.company_id AND s2.person_type = s.person_type AND s2.person_id = s.person_id AND s2.skill_code = s.skill_code AND s2.deleted_at IS NULL ORDER BY s2.assessed_on DESC, s2.id DESC LIMIT 1)");
      const out = rows.map((p) => { const cells = {}; for (const l of latest.all(actor.companyId, kind, p.id)) cells[l.skill_code.toUpperCase()] = { level: l.level, assessedOn: l.assessed_on }; return { ...p, cells }; });
      const totals = defs.map((d) => { const ls = out.map((p) => p.cells[d.code.toUpperCase()]?.level).filter((x) => x != null); return { code: d.code, assessed: ls.length, skilled: ls.filter((x) => x >= 3).length, trainers: ls.filter((x) => x === 4).length }; });
      return { skills: defs.map((d) => ({ code: d.code, name: d.name, nameHi: d.name_hi, trade: d.trade })), people: out, totals, levels: LEVELS };
    },
  };

  // ------------------------------------------------------------------ mandatory training compliance (FR-02) and the cost of training (FR-06)
  /** Who must take a course: all employees, or those of the designations and departments it names, or the workers of the trades it names. */
  function mustTake(course, p) {
    const m = json(course.mandatory_for_json, {});
    if (p.type === 'WORKER') return Boolean(m.workers) || (m.tradeCodes ?? []).some((t) => same(t, p.trade));
    if (m.all) return true;
    return (m.designationCodes ?? []).some((t) => same(t, p.designation)) || (m.departmentCodes ?? []).some((t) => same(t, p.department));
  }
  const compliance = {
    report(actor, { siteId = null, courseId = null, status = null, kind = null, limit = 200, offset = 0 } = /** @type {any} */ ({})) {
      need(actor, 'hr.training.report', 'see the mandatory training compliance');
      const t = today();
      const courses = db.prepare("SELECT * FROM trn_courses WHERE company_id = ? AND deleted_at IS NULL AND is_active = 1 AND mandatory_for_json != '{}' AND (? IS NULL OR id = ?) ORDER BY title").all(actor.companyId, courseId, courseId).filter((c) => Object.keys(json(c.mandatory_for_json, {})).length);
      const all = may(actor, 'hr.cert.view_all'); const me = myEmployee(actor); const line = me ? reportees(me) : new Set();
      const people = [];
      if (kind !== 'WORKER') people.push(...db.prepare("SELECT e.id, e.full_name AS name, e.emp_code AS code, g.code AS designation, d.code AS department, e.site_id FROM hr_employees e LEFT JOIN org_designations g ON g.id = e.designation_id LEFT JOIN org_departments d ON d.id = e.department_id WHERE e.company_id = ? AND e.deleted_at IS NULL AND e.record_status = 'APPROVED' AND e.employment_status IN ('ACTIVE', 'NOTICE') AND (? IS NULL OR e.site_id = ?)").all(actor.companyId, siteId, siteId).filter((p) => all || p.id === me || line.has(p.id)).map((p) => ({ ...p, type: 'EMPLOYEE' })));
      if (kind !== 'EMPLOYEE' && all) people.push(...db.prepare("SELECT w.id, w.name, w.worker_code AS code, w.trade_code AS trade FROM lab_workers w WHERE w.company_id = ? AND w.root_id = w.id AND w.status = 'APPROVED' AND w.worker_status = 'ACTIVE' AND w.deleted_at IS NULL").all(actor.companyId).map((p) => ({ ...p, type: 'WORKER', site_id: null })));
      const doneStmt = db.prepare("SELECT MAX(substr(s.end_at, 1, 10)) AS d FROM trn_attendance a JOIN trn_sessions s ON s.id = a.session_id WHERE a.company_id = ? AND a.person_type = ? AND a.person_id = ? AND s.course_id = ? AND s.status = 'COMPLETED' AND a.attendance = 'ATTENDED' AND COALESCE(a.passed, 1) = 1 AND a.deleted_at IS NULL");
      const nextStmt = db.prepare("SELECT MIN(s.start_at) AS n FROM trn_attendance a JOIN trn_sessions s ON s.id = a.session_id WHERE a.company_id = ? AND a.person_type = ? AND a.person_id = ? AND s.course_id = ? AND s.status = 'APPROVED' AND substr(s.start_at, 1, 10) >= ? AND a.deleted_at IS NULL");
      const rows = [];
      for (const c of courses) {
        for (const p of people) {
          if (!mustTake(c, p)) continue;
          let doneOn = doneStmt.get(actor.companyId, p.type, p.id, c.id)?.d ?? null; let via = doneOn ? 'training' : null;
          if (c.cert_type_code) { const k = certs.check(actor.companyId, { personType: p.type, personId: p.id, certTypes: [c.cert_type_code], on: t }); if (k.ok) { doneOn = doneOn ?? t; via = 'certificate'; } }
          const due = doneOn && c.validity_months ? addMonths(doneOn, c.validity_months) : null;
          const st = !doneOn ? 'NOT_DONE' : due && due < t ? 'OVERDUE' : due && due <= addDays(t, 30) ? 'DUE_SOON' : 'COMPLIANT';
          const next = ['NOT_DONE', 'OVERDUE', 'DUE_SOON'].includes(st) ? nextStmt.get(actor.companyId, p.type, p.id, c.id, t)?.n ?? null : null;
          rows.push({ personType: p.type, personId: p.id, person: p.name, code: p.code, siteId: p.site_id, courseId: c.id, course: c.title, courseCode: c.code, doneOn, dueOn: due, via, status: st, nextSession: next });
        }
      }
      const filtered = status ? rows.filter((r) => r.status === status) : rows;
      const summary = { required: rows.length, compliant: rows.filter((r) => r.status === 'COMPLIANT').length, dueSoon: rows.filter((r) => r.status === 'DUE_SOON').length, overdue: rows.filter((r) => r.status === 'OVERDUE').length, notDone: rows.filter((r) => r.status === 'NOT_DONE').length };
      const byCourse = courses.map((c) => { const rs = rows.filter((r) => r.courseId === c.id); return { courseId: c.id, course: c.title, required: rs.length, compliant: rs.filter((r) => r.status === 'COMPLIANT').length, pct: rs.length ? Math.round((rs.filter((r) => r.status === 'COMPLIANT').length / rs.length) * 100) : null }; });
      filtered.sort((a, b) => ['NOT_DONE', 'OVERDUE', 'DUE_SOON', 'COMPLIANT'].indexOf(a.status) - ['NOT_DONE', 'OVERDUE', 'DUE_SOON', 'COMPLIANT'].indexOf(b.status) || a.person.localeCompare(b.person));
      return { summary, byCourse, rows: filtered.slice(offset, offset + limit), total: filtered.length };
    },
    /** FR-06: what the approved and completed sessions cost, by project and by department, and per person who attended. */
    costs(actor, { from = null, to = null } = /** @type {any} */ ({})) {
      need(actor, 'hr.training.report', 'see the cost of training');
      const rows = db.prepare(`SELECT s.id, s.project_id, s.department_id, s.cost_minor, (SELECT COUNT(*) FROM trn_attendance a WHERE a.session_id = s.id AND a.attendance = 'ATTENDED' AND a.deleted_at IS NULL) AS attended FROM trn_sessions s WHERE s.company_id = ? AND s.deleted_at IS NULL AND s.status IN ('APPROVED', 'COMPLETED') AND (? IS NULL OR substr(s.start_at, 1, 10) >= ?) AND (? IS NULL OR substr(s.start_at, 1, 10) <= ?)`).all(actor.companyId, from, from, to, to);
      const group = (key, nameSql) => { const m = new Map(); for (const r of rows) { const k = r[key] ?? 0; const g = m.get(k) ?? { id: k || null, name: k ? db.prepare(nameSql).get(k)?.name ?? `#${k}` : 'Not assigned', sessions: 0, cost: 0, attended: 0 }; g.sessions += 1; g.cost += r.cost_minor; g.attended += r.attended; m.set(k, g); } return [...m.values()].map((g) => ({ ...g, cost: money(g.cost), perHead: g.attended ? money(Math.round(g.cost / g.attended)) : null })).sort((a, b) => b.cost - a.cost); };
      const total = rows.reduce((s, r) => s + r.cost_minor, 0);
      return { total: money(total), sessions: rows.length, attended: rows.reduce((s, r) => s + r.attended, 0), byProject: group('project_id', 'SELECT name FROM org_projects WHERE id = ?'), byDepartment: group('department_id', 'SELECT name FROM org_departments WHERE id = ?') };
    },
  };

  // ------------------------------------------------------------------ my training (EMP: view own)
  const mine = {
    get(actor) {
      need(actor, 'hr.training.own', 'see your training');
      const me = myEmployee(actor); if (!me) throw new HttpError(422, 'NO_EMPLOYEE', 'Your user account is not linked to an employee record. Ask HR to link it.');
      const att = db.prepare("SELECT a.*, s.doc_no, s.start_at, s.end_at, s.venue, s.status AS session_status, c.title FROM trn_attendance a JOIN trn_sessions s ON s.id = a.session_id JOIN trn_courses c ON c.id = s.course_id WHERE a.company_id = ? AND a.person_type = 'EMPLOYEE' AND a.person_id = ? AND a.deleted_at IS NULL ORDER BY s.start_at DESC LIMIT 100").all(actor.companyId, me)
        .map((a) => ({ id: a.id, sessionId: a.session_id, docNo: a.doc_no, course: a.title, startAt: a.start_at, endAt: a.end_at, venue: a.venue, sessionStatus: a.session_status, attendance: a.attendance, score: a.score, passed: a.passed == null ? null : Boolean(a.passed), rated: a.feedback_rating != null, canSignIn: a.session_status === 'APPROVED' && a.attendance !== 'ATTENDED', canRate: a.attendance === 'ATTENDED' && a.feedback_rating == null }));
      const types = new Map(db.prepare('SELECT * FROM trn_cert_types WHERE company_id = ?').all(actor.companyId).map((x) => [x.code.toLowerCase(), x]));
      const myCerts = db.prepare("SELECT * FROM trn_certifications WHERE company_id = ? AND person_type = 'EMPLOYEE' AND person_id = ? AND deleted_at IS NULL ORDER BY COALESCE(valid_until, '9999-12-31')").all(actor.companyId, me).map((x) => certView(actor, x, { get: (k) => types.get(String(k).toLowerCase()) }));
      return { upcoming: att.filter((a) => a.sessionStatus === 'APPROVED'), history: att.filter((a) => a.sessionStatus !== 'APPROVED'), certificates: myCerts, required: certs.requiredFor(actor.companyId, 'EMPLOYEE', me) };
    },
  };

  // ------------------------------------------------------------------ the daily watch on certificates
  function cycle(companyId) {
    const t = today(); const out = { alerted: 0 };
    const rows = db.prepare("SELECT x.*, COALESCE(ct.alert_days, 30) AS alert_days, ct.name AS type_name FROM trn_certifications x LEFT JOIN trn_cert_types ct ON ct.company_id = x.company_id AND ct.code = x.cert_type WHERE x.company_id = ? AND x.deleted_at IS NULL AND x.cert_status = 'ACTIVE' AND x.valid_until IS NOT NULL").all(companyId);
    for (const x of rows) {
      // the date decides here, verified or not: a licence that is about to end is told even if nobody has verified it
      const state = x.valid_until < t ? 'EXPIRED' : x.valid_until <= addDays(t, x.alert_days) ? 'EXPIRING' : 'VALID'; if (state === 'VALID') continue;
      const key = `${state}:${x.valid_until}`; if (x.alerted_state === key) continue;
      const who = nameOf(x.person_type, x.person_id); const word = state === 'EXPIRED' ? 'has expired' : 'expires soon';
      const to = new Set(hrUsers(companyId));
      if (x.person_type === 'EMPLOYEE') { const u = db.prepare('SELECT user_id FROM hr_employees WHERE id = ?').get(x.person_id)?.user_id; const n = usernameOf(u); if (n) to.add(n); }
      for (const u of to) notif.notify({ companyId, templateCode: 'trn.cert_expiring', recipients: [`user:${u}`], data: { who: `${who.name} (${who.code})`, cert: x.type_name ?? x.cert_type, state: word, until: x.valid_until }, link: '/training/certifications', sourceType: 'trn_certification', sourceId: String(x.id), eventKey: `trn.cert:${x.id}:${key}` });
      db.prepare('UPDATE trn_certifications SET alerted_state = ? WHERE id = ?').run(key, x.id);
      event(state === 'EXPIRED' ? 'trn.cert.expired' : 'trn.cert.expiring', { user: 'system' }, 'trn_certification', x.id, companyId, { personType: x.person_type, personId: x.person_id, certType: x.cert_type, validUntil: x.valid_until }, null, null);
      out.alerted += 1;
    }
    return out;
  }
  const widget = (actor) => {
    if (!may(actor, 'hr.cert.view')) return { value: 0 };
    const types = new Map(db.prepare('SELECT * FROM trn_cert_types WHERE company_id = ?').all(actor.companyId).map((x) => [x.code.toLowerCase(), x]));
    const rows = db.prepare(`SELECT x.* FROM trn_certifications x WHERE ${certScope(actor)} AND x.deleted_at IS NULL AND x.cert_status = 'ACTIVE' AND x.valid_until IS NOT NULL`).all({ c: actor.companyId });
    return { value: rows.filter((x) => ['EXPIRING', 'EXPIRED'].includes(certState(x, types.get(x.cert_type.toLowerCase())?.alert_days, today()))).length };
  };

  // ------------------------------------------------------------------ the decision of the approval workflow
  function decide(instance, actor, outcome, comment) {
    const s = db.prepare('SELECT * FROM trn_sessions WHERE id = ?').get(Number(instance.docId));
    if (!s || !['SUBMITTED', 'RETURNED'].includes(s.status)) return;
    const now = nowIso();
    if (outcome === 'APPROVED') {
      db.prepare("UPDATE trn_sessions SET status = 'APPROVED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, s.id);
      event('trn.session.approved', actor, 'trn_session', s.id, s.company_id, { docNo: s.doc_no, courseId: s.course_id, startAt: s.start_at, cost: s.cost_minor / 100 }, s.project_id, s.site_id);
    } else {
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN';
      db.prepare('UPDATE trn_sessions SET status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED', actor.user, now, s.id);
      if (withdrawn) db.prepare('UPDATE trn_sessions SET workflow_instance_id = NULL WHERE id = ?').run(s.id);
    }
    writeAudit(db, { entity: 'trn_sessions', entityId: s.id, action: outcome.toLowerCase(), reason: comment ?? null, actor: actor.user, companyId: s.company_id });
    tell(s.company_id, s.requested_by ?? s.created_by, 'Training session', s.doc_no, db.prepare('SELECT title FROM trn_courses WHERE id = ?').get(s.course_id)?.title ?? '', outcome, comment, '/training');
  }
  return { setup, sessions, attendance, certs, skills, compliance, mine, cycle, widget, decisions: { session: decide }, canSee };
}

const services = new WeakMap();
export const bindTraining = (db, s) => services.set(db, s);
export const trainingOf = (db) => services.get(db) ?? null;

workflowTypes.register({
  docType: SESSION_DOC, label: 'External training with a fee', processOwner: 'HRMGR', route: () => '/training',
  describe(db, companyId, id) { const r = db.prepare('SELECT s.doc_no, s.requested_by, c.title FROM trn_sessions s JOIN trn_courses c ON c.id = s.course_id WHERE s.id = ? AND s.company_id = ?').get(Number(id), companyId); return r ? { ref: r.doc_no, title: r.title, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = db.prepare('SELECT s.*, c.title, c.mode FROM trn_sessions s JOIN trn_courses c ON c.id = s.course_id WHERE s.id = ?').get(Number(id)); if (!r) return null; return { fields: [{ label: 'Session', value: r.doc_no }, { label: 'Course', value: r.title }, { label: 'Starts', value: r.start_at.replace('T', ' ') }, { label: 'Trainer', value: r.trainer ?? '—' }, { label: 'Venue', value: r.venue ?? '—' }, { label: 'Seats', value: String(r.capacity) }, { label: 'Fee', value: `Rs ${(r.cost_minor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` }] }; },
  defaultDefinition: { name: 'External training with a fee: manager, then HR manager', settings: { resubmit: 'first', distinctApprovers: true, matrix: true }, steps: [{ code: 'MGR', name: 'Manager', type: 'approval', mode: 'single', approvers: [{ kind: 'role', role: 'PM' }], slaHours: 48, requireAttachment: false, checklist: [], when: null, notify: [], action: null }, { code: 'HRMGR', name: 'HR manager', type: 'approval', mode: 'single', approvers: [{ kind: 'role', role: 'HRMGR' }], slaHours: 48, requireAttachment: false, checklist: [], when: null, notify: [], action: null }] },
  hooks: {
    onApproved: (db, { instance, actor }) => trainingOf(db)?.decisions.session(instance, actor, 'APPROVED'),
    onRejected: (db, { instance, actor, comment }) => trainingOf(db)?.decisions.session(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => trainingOf(db)?.decisions.session(instance, actor, 'RETURNED', comment),
    onCancelled: (db, { instance, actor, comment }) => trainingOf(db)?.decisions.session(instance, actor, 'CANCELLED', comment),
  },
});
evidenceProviders.register(SESSION_DOC, ({ db, instance }) => {
  const s = db.prepare('SELECT s.*, c.title FROM trn_sessions s JOIN trn_courses c ON c.id = s.course_id WHERE s.id = ?').get(Number(instance.docId)); if (!s) return { sections: [] };
  const spent = db.prepare("SELECT COALESCE(SUM(cost_minor), 0) AS n FROM trn_sessions WHERE company_id = ? AND deleted_at IS NULL AND status IN ('APPROVED', 'COMPLETED') AND (project_id IS ? OR project_id = ?) AND id != ?").get(s.company_id, s.project_id, s.project_id, s.id).n;
  return { sections: [{ code: 'trn-session', title: 'Before approving', kind: 'metrics', items: [{ label: 'Fee', value: `Rs ${(s.cost_minor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, format: 'text' }, { label: 'Seats', value: String(s.capacity), format: 'text' }, { label: 'Already approved for this project', value: `Rs ${(spent / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, format: 'text' }] }] };
});
void forbidden;
