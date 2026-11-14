import { createHash, randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { fileEntities } from '../../platform/files/entities.js';
import { createVault } from '../../platform/integrations/vault.js';
import { HttpError, badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { parameterRegistry, createParameterStore } from '../../platform/parameters/index.js';
import { evidenceProviders, workflowOf, workflowTypes } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { addDays } from './att-calc.js';

// Contract labour (part 07.08). The labour contractors are the business partners of the partner master with the role labour contractor (06.04); this part adds their licence and the most workers they may have, the register of their
// workers (name, photo, a masked ID, trade and skill, induction and medical clearance, a card with a QR code), the wage rates (the minimum wage of the state and the rate contracted with a contractor, effective-dated) and the guards
// on deployment: nobody under 18 is registered (BR-01), a worker who is not cleared is not deployed (BR-02, a block or a warning), a contractor does not exceed the licensed number (BR-03) and a contracted rate is not below the
// minimum wage (BR-04). A worker, once approved, is the same person for ever: an amendment is a revision that is applied to the worker when it is approved, so deployments and punches keep the same id.
export const WORKER_DOC = 'HR_WORKER';
export const WAGE_DOC = 'HR_LAB_WAGE';
export const STATUS_LABELS = { DRAFT: 'Draft', SUBMITTED: 'In approval', APPROVED: 'Approved', RETURNED: 'Returned', REJECTED: 'Rejected', CANCELLED: 'Cancelled', SUPERSEDED: 'Superseded' };
export const SKILLS = { UNSKILLED: 'Unskilled', SEMI_SKILLED: 'Semi-skilled', SKILLED: 'Skilled', HIGHLY_SKILLED: 'Highly skilled' };
export const DEFAULT_TRADES = ['MASON', 'CARPENTER', 'BAR_BENDER', 'HELPER', 'ELECTRICIAN', 'PLUMBER', 'WELDER', 'PAINTER', 'FITTER', 'SCAFFOLDER', 'DRIVER', 'OPERATOR', 'SHUTTERING', 'OTHER'];
export const MIN_AGE = 18;
const HOURS_PER_DAY = 8;
const nowIso = () => new Date().toISOString();
const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
const json = (s, d) => { try { return JSON.parse(s ?? ''); } catch { return d; } };

for (const [key, dataType, def, description, extra] of [
  ['lab.worker.trades', 'json', DEFAULT_TRADES, 'FR-02: the trades a worker is registered in (codes).', {}],
  ['lab.deploy.clearance_mode', 'string', 'BLOCK', 'BR-02: a worker whose induction or medical clearance is not cleared is not deployed (BLOCK) or is deployed with a warning in the audit trail (WARN).', {}],
  ['lab.licence.alert_days', 'integer', 30, 'FR-08: days ahead of the end of a contractor licence that HR is told.', { min: 1, max: 180 }],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType, default: def, scopes: ['system', 'company'], description, .../** @type {any} */ (extra) });

/** Years completed on a date (BR-01). */
export function ageOn(dob, date) {
  let a = Number(date.slice(0, 4)) - Number(dob.slice(0, 4));
  if (date.slice(5) < dob.slice(5)) a -= 1;
  return a;
}
/** A rate on the basis of another: a day is eight hours; a piece rate is not comparable with a wage. */
export function convertRate(minor, from, to) {
  if (from === to) return minor;
  if (from === 'DAILY' && to === 'HOURLY') return Math.round(minor / HOURS_PER_DAY);
  if (from === 'HOURLY' && to === 'DAILY') return minor * HOURS_PER_DAY;
  return null;
}
export const money = (minor) => (minor == null ? null : Math.round(minor) / 100);
const mask = (last4, groups) => (last4 ? `${groups}${last4}` : null);

export const workerList = defineList({
  code: 'hr.workers', label: 'Workers register', permission: 'hr.worker.view',
  from: 'lab_workers w JOIN mdm_partners c ON c.id = w.contractor_id',
  where: 'w.deleted_at IS NULL AND w.root_id = w.id', searchable: ['w.worker_code', 'w.name', 'w.mobile', 'c.legal_name', 'w.trade_code'], defaultSort: '-workerCode',
  columns: {
    workerCode: { sql: 'w.worker_code', type: 'text', label: 'Worker' }, name: { sql: 'w.name', type: 'text', label: 'Name' }, trade: { sql: 'w.trade_code', type: 'text', label: 'Trade' },
    skill: { sql: 'w.skill_category', type: 'enum', label: 'Skill', options: Object.entries(SKILLS) }, contractor: { sql: 'c.legal_name', type: 'text', label: 'Contractor' }, contractorId: { sql: 'w.contractor_id', type: 'number', label: 'Contractor id' },
    homeState: { sql: 'w.home_state', type: 'text', label: 'Home state' }, mobile: { sql: 'w.mobile', type: 'text', label: 'Mobile' },
    induction: { sql: 'w.induction_status', type: 'enum', label: 'Induction', options: [['PENDING', 'Pending'], ['CLEARED', 'Cleared'], ['EXPIRED', 'Expired']] },
    medical: { sql: 'w.medical_status', type: 'enum', label: 'Medical', options: [['PENDING', 'Pending'], ['FIT', 'Fit'], ['UNFIT', 'Unfit'], ['EXPIRED', 'Expired']] },
    workerStatus: { sql: 'w.worker_status', type: 'enum', label: 'Working status', options: [['ACTIVE', 'Active'], ['BLACKLISTED', 'Blacklisted'], ['LEFT', 'Left']] },
    status: { sql: 'w.status', type: 'enum', label: 'Registration', options: Object.entries(STATUS_LABELS) }, updatedAt: { sql: 'COALESCE(w.updated_at, w.created_at)', type: 'datetime', label: 'Changed' },
  },
});
export const wageList = defineList({
  code: 'hr.wage_rates', label: 'Wage rates and minimum wages', permission: 'hr.worker.view',
  from: 'lab_wage_rates r LEFT JOIN mdm_partners c ON c.id = r.contractor_id', where: "r.deleted_at IS NULL AND r.status != 'SUPERSEDED'", searchable: ['r.doc_no', 'c.legal_name', 'r.trade_code', 'r.state_code'], defaultSort: '-effectiveFrom',
  columns: {
    docNo: { sql: 'r.doc_no', type: 'text', label: 'Rate' }, kind: { sql: 'r.kind', type: 'enum', label: 'Kind', options: [['MINIMUM', 'Minimum wage'], ['CONTRACT', 'Contract rate']] }, contractor: { sql: 'c.legal_name', type: 'text', label: 'Contractor' },
    trade: { sql: 'r.trade_code', type: 'text', label: 'Trade' }, skill: { sql: 'r.skill_category', type: 'enum', label: 'Skill', options: Object.entries(SKILLS) }, state: { sql: 'r.state_code', type: 'text', label: 'State' },
    payBasis: { sql: 'r.pay_basis', type: 'enum', label: 'Basis', options: [['DAILY', 'Daily'], ['HOURLY', 'Hourly'], ['PIECE', 'Piece']] }, rate: { sql: 'r.rate_minor', type: 'number', label: 'Rate (paise)' },
    effectiveFrom: { sql: 'r.effective_from', type: 'date', label: 'Effective from' }, ref: { sql: 'r.min_wage_ref', type: 'text', label: 'Notification' }, status: { sql: 'r.status', type: 'enum', label: 'Status', options: Object.entries(STATUS_LABELS) },
  },
});

/** The guards a deployment of a worker passes (BR-02, BR-03): the labour register adds them to the deployment service, which asks them for every worker it is given. */
export const deploymentGuards = [];

export function createLabourService({ db, dep, vaultKey }) {
  const authz = authzOf(db);
  const { may, need, nextDoc, event, root, usernameOf } = dep;
  const notif = notificationsOf(db);
  const vault = createVault({ secret: vaultKey ?? undefined });
    const today = () => todayIST();
  const maker = (actor, r) => same(r.created_by, actor.user);
  const param = (companyId, key) => createParameterStore(db).get(key, { companyId, date: today() });
  const trades = (companyId) => { const l = param(companyId, 'lab.worker.trades'); return Array.isArray(l) && l.length ? l.map(String) : DEFAULT_TRADES; };
  const partner = (companyId, id) => db.prepare("SELECT p.id, p.legal_name, p.partner_status FROM mdm_partners p WHERE p.id = ? AND p.company_id = ? AND p.deleted_at IS NULL AND EXISTS (SELECT 1 FROM mdm_partner_roles r WHERE r.partner_id = p.id AND r.partner_role = 'LABOUR_CONTRACTOR' AND r.deleted_at IS NULL)").get(id, companyId);
  const hash = (companyId, kind, v) => createHash('sha256').update(`${companyId}:${kind}:${v}`).digest('hex');
  const hrUsers = (companyId) => db.prepare("SELECT username FROM iam_users WHERE company_id = ? AND is_active = 1 AND roles_json LIKE '%\"HRMGR\"%'").all(companyId).map((u) => u.username);
  const tell = (companyId, to, what, ref, title, outcome, comment, link) => to && notif.notify({ companyId, templateCode: 'lab.decided', recipients: [`user:${to}`], data: { what, ref, title, decision: outcome === 'RETURNED' ? 'returned for correction' : outcome === 'APPROVED' ? 'approved' : outcome === 'REJECTED' ? 'rejected' : 'cancelled', comment: comment ? `: ${comment}` : '' }, link, sourceType: 'lab', sourceId: ref, eventKey: `lab.decided:${ref}:${outcome}:${Date.now()}` });

  // ------------------------------------------------------------------ workers
  const rowOf = (actor, id) => {
    const w = db.prepare('SELECT * FROM lab_workers WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId);
    if (!w || !visible(actor, w)) throw notFound('That worker does not exist.');
    return w;
  };
  /** A worker is seen by those who see all workers, by the person who registered it, and by those who see a site where the worker is deployed. */
  function visible(actor, w) {
    if (!authz.check(actor, 'hr.worker.view').allowed) return false;
    if (authz.check(actor, 'hr.worker.view_all').allowed || maker(actor, w)) return true;
    const r = w.root_id ?? w.id;
    const sc = authz.scopeFilter(actor, 'hr.worker.view', { project: 'd.dep_project_id', site: 'd.dep_site_id' }).sql;
    return Boolean(db.prepare(`SELECT 1 FROM hr_deployments d WHERE d.company_id = :c AND d.person_type = 'WORKER' AND d.person_id = :r AND d.deleted_at IS NULL AND d.status IN ('APPROVED', 'SUBMITTED') AND ${sc} LIMIT 1`).get({ c: actor.companyId, r }));
  }
  const pendingRevision = (w) => db.prepare("SELECT id, status FROM lab_workers WHERE supersedes_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL ORDER BY id DESC LIMIT 1").get(w.root_id ?? w.id);
  const ready = (w) => {
    const t = today();
    return { induction: w.induction_status === 'CLEARED', medical: w.medical_status === 'FIT' && (!w.medical_valid_until || w.medical_valid_until >= t) };
  };
  function view(actor, w) {
    const c = db.prepare('SELECT legal_name FROM mdm_partners WHERE id = ?').get(w.contractor_id);
    const rev = w.id === (w.root_id ?? w.id) ? pendingRevision(w) : null; const isRev = w.supersedes_id != null;
    const sens = may(actor, 'hr.worker.view_sensitive'); const rd = ready(w);
    const can = (a) => may(actor, `hr.worker.${a}`);
    const editable = ['DRAFT', 'RETURNED'].includes(w.status) && maker(actor, w);
    return {
      id: w.id, rootId: w.root_id ?? w.id, isRevision: isRev, docNo: w.doc_no, revision: w.revision_no, workerCode: w.worker_code, status: w.status, statusLabel: STATUS_LABELS[w.status], rowVersion: w.version,
      name: w.name, photoFileId: w.photo_file_id, aadhaarMasked: mask(w.aadhaar_last4, 'XXXX-XXXX-'), mobile: sens ? w.mobile : mask(w.mobile?.slice(-4), 'XXXXXX'), dob: sens ? w.dob : null, age: ageOn(w.dob, today()), gender: w.gender, homeState: w.home_state,
      tradeCode: w.trade_code, skillCategory: w.skill_category, skillLabel: SKILLS[w.skill_category], contractorId: w.contractor_id, contractor: c?.legal_name ?? null,
      bankMasked: mask(w.bank_last4, 'XXXXXX'), ifsc: sens ? w.ifsc : null, uan: sens ? w.uan : null, esicIp: sens ? w.esic_ip : null, bocwNo: w.bocw_no, emergencyName: sens ? w.emergency_name : null, emergencyMobile: sens ? w.emergency_mobile : null,
      inductionStatus: w.induction_status, inductionDate: w.induction_date, medicalStatus: w.medical_status, medicalValidUntil: w.medical_valid_until, cleared: rd.induction && rd.medical, ppe: json(w.ppe_json, []),
      workerStatus: w.worker_status, blacklistReason: w.blacklist_reason, blacklistedBy: w.blacklisted_by, blacklistedAt: w.blacklisted_at, cardIssuedAt: w.card_issued_at, cardVersion: w.card_version,
      workflowInstanceId: w.workflow_instance_id, requestedBy: w.requested_by, createdBy: w.created_by, pendingRevision: rev ? { id: rev.id, status: rev.status } : null,
      can: { edit: editable && can('edit'), submit: editable && can('submit'), delete: w.status === 'DRAFT' && maker(actor, w) && can('delete'), withdraw: w.status === 'SUBMITTED' && maker(actor, w), cancel: ['SUBMITTED', 'RETURNED'].includes(w.status) && can('cancel'),
        amend: w.status === 'APPROVED' && !isRev && !rev && can('amend'), print: can('print'), clear: w.status === 'APPROVED' && !isRev && can('clear'), blacklist: w.status === 'APPROVED' && !isRev && can('blacklist'), sensitive: sens },
    };
  }
  const BODY = ['name', 'photo_file_id', 'aadhaar_last4', 'aadhaar_hash', 'mobile', 'dob', 'gender', 'home_state', 'trade_code', 'skill_category', 'contractor_id', 'bank_enc', 'bank_last4', 'ifsc', 'uan', 'esic_ip', 'bocw_no', 'emergency_name', 'emergency_mobile'];
  const bodyCols = (companyId, b, prev = null) => [
    b.name, b.photoFileId ?? null, b.aadhaar ? b.aadhaar.slice(-4) : prev?.aadhaar_last4 ?? null, b.aadhaar ? hash(companyId, 'aadhaar', b.aadhaar) : prev?.aadhaar_hash ?? null, b.mobile ?? null, b.dob, b.gender, b.homeState ?? null, b.tradeCode, b.skillCategory, b.contractorId,
    b.bankAccount ? vault.encrypt(b.bankAccount, `lab_worker_bank/${companyId}/${b.name}`) : prev?.bank_enc ?? null, b.bankAccount ? b.bankAccount.slice(-4) : prev?.bank_last4 ?? null, b.ifsc ?? prev?.ifsc ?? null, b.uan ?? null, b.esicIp ?? null, b.bocwNo ?? null, b.emergencyName ?? null, b.emergencyMobile ?? null,
  ];
  /** The rules of a registration. BR-01 is a hard block: nobody under 18 is registered, whatever the screen sent. */
  function validate(actor, b, { exceptRoot = 0, prev = null } = {}) {
    const c = actor.companyId; const problems = [];
    if (b.dob > today()) problems.push({ field: 'dob', message: 'The date of birth is in the future' });
    else if (ageOn(b.dob, today()) < MIN_AGE) problems.push({ field: 'dob', message: `The worker is ${ageOn(b.dob, today())}: nobody under ${MIN_AGE} is registered (child labour is prohibited)` });
    else if (ageOn(b.dob, today()) > 80) problems.push({ field: 'dob', message: 'Check the date of birth' });
    if (!trades(c).includes(b.tradeCode)) problems.push({ field: 'tradeCode', message: `${b.tradeCode} is not a trade of this company` });
    const p = partner(c, b.contractorId);
    if (!p) problems.push({ field: 'contractorId', message: 'That is not a labour contractor of the partner master' });
    else if (p.partner_status !== 'ACTIVE') problems.push({ field: 'contractorId', message: `The contractor is ${p.partner_status.toLowerCase().replace('_', ' ')}: workers are registered under active contractors only` });
    if (b.aadhaar) {
      const twin = db.prepare("SELECT worker_code FROM lab_workers WHERE company_id = ? AND aadhaar_hash = ? AND root_id = id AND status NOT IN ('CANCELLED', 'REJECTED', 'SUPERSEDED') AND deleted_at IS NULL AND id != ?").get(c, hash(c, 'aadhaar', b.aadhaar), exceptRoot);
      if (twin) problems.push({ field: 'aadhaar', message: `This ID is registered already as ${twin.worker_code}` });
    } else if (!prev?.aadhaar_hash) problems.push({ field: 'aadhaar', message: 'Give the ID number (Aadhaar); only its last four digits are kept' });
    return problems;
  }
  const workers = {
    create(actor, b) {
      need(actor, 'hr.worker.create', 'register workers');
      const problems = validate(actor, b); if (problems.length) throw badRequest('Some fields are not valid.', problems);
      return transaction(db, () => {
        const no = nextDoc(actor, WORKER_DOC, 'lab_workers', 'LW');
        const id = Number(db.prepare(`INSERT INTO lab_workers (company_id, doc_no, doc_date, worker_code, ${BODY.join(', ')}, qr_token, status, requested_by, created_by, source_type) VALUES (?, ?, ?, ?, ${BODY.map(() => '?').join(', ')}, ?, 'DRAFT', ?, ?, 'lab_worker')`)
          .run(actor.companyId, no, today(), no, ...bodyCols(actor.companyId, b), randomBytes(16).toString('hex'), actor.user, actor.user).lastInsertRowid);
        db.prepare('UPDATE lab_workers SET root_id = id WHERE id = ?').run(id);
        writeAudit(db, { entity: 'lab_workers', entityId: id, action: 'create', newValues: { workerCode: no, contractorId: b.contractorId, tradeCode: b.tradeCode }, actor: actor.user, companyId: actor.companyId });
        return b.submit ? workers.submit(actor, id, { comment: b.comment }) : view(actor, rowOf(actor, id));
      });
    },
    get(actor, id) {
      const w = rowOf(actor, id);
      const deployments = db.prepare("SELECT d.id, d.doc_no AS docNo, d.status, d.from_date AS fromDate, d.to_date AS toDate, d.dep_site_id AS siteId, d.crew_id AS crewId, s.name AS site FROM hr_deployments d LEFT JOIN org_sites s ON s.id = d.dep_site_id WHERE d.company_id = ? AND d.person_type = 'WORKER' AND d.person_id = ? AND d.deleted_at IS NULL AND d.status != 'SUPERSEDED' ORDER BY d.from_date DESC LIMIT 20").all(w.company_id, w.root_id ?? w.id);
      const punches = db.prepare("SELECT work_date AS workDate, punch_type AS type, effective_time AS at, result FROM att_punches WHERE company_id = ? AND person_type = 'WORKER' AND person_id = ? AND deleted_at IS NULL ORDER BY effective_time DESC LIMIT 20").all(w.company_id, w.root_id ?? w.id);
      const wage = applicable(w.company_id, { contractorId: w.contractor_id, tradeCode: w.trade_code, skillCategory: w.skill_category, stateCode: w.home_state, payBasis: 'DAILY', date: today() });
      return { ...view(actor, w), deployments, punches, wage, history: history(actor, id) };
    },
    update(actor, id, b) {
      const w = rowOf(actor, id); need(actor, 'hr.worker.edit', 'change workers');
      if (!['DRAFT', 'RETURNED'].includes(w.status)) throw conflict(`A worker that is ${STATUS_LABELS[w.status].toLowerCase()} is changed by an amendment.`);
      if (!maker(actor, w)) throw forbidden(`Only ${w.created_by}, who registered this worker, changes it.`);
      if (w.version !== b.version) throw conflict('This worker was changed by someone else. Reload it and try again.');
      const problems = validate(actor, b, { exceptRoot: w.root_id ?? w.id, prev: w }); if (problems.length) throw badRequest('Some fields are not valid.', problems);
      db.prepare(`UPDATE lab_workers SET ${BODY.map((c) => `${c} = ?`).join(', ')}, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(...bodyCols(actor.companyId, b, w), actor.user, nowIso(), id);
      writeAudit(db, { entity: 'lab_workers', entityId: id, action: 'update', newValues: { tradeCode: b.tradeCode, contractorId: b.contractorId }, actor: actor.user, companyId: actor.companyId });
      return view(actor, rowOf(actor, id));
    },
    remove(actor, id) {
      const w = rowOf(actor, id); need(actor, 'hr.worker.delete', 'delete workers');
      if (w.status !== 'DRAFT') throw new HttpError(409, 'LOCKED', 'Only a draft is deleted; cancel or amend the others.');
      if (!maker(actor, w)) throw forbidden(`Only ${w.created_by} deletes this draft.`);
      db.prepare('UPDATE lab_workers SET deleted_at = ?, deleted_by = ?, is_active = 0, aadhaar_hash = NULL, qr_token = NULL, version = version + 1 WHERE id = ?').run(nowIso(), actor.user, id);
      writeAudit(db, { entity: 'lab_workers', entityId: id, action: 'delete', actor: actor.user, companyId: actor.companyId });
      return { id, deleted: true };
    },
    submit(actor, id, { comment } = /** @type {any} */ ({})) {
      const w = rowOf(actor, id); need(actor, 'hr.worker.submit', 'submit workers');
      if (!['DRAFT', 'RETURNED'].includes(w.status)) throw conflict(`This worker is ${STATUS_LABELS[w.status].toLowerCase()}.`);
      if (!maker(actor, w)) throw forbidden(`Only ${w.created_by}, who registered this worker, submits it.`);
      return transaction(db, () => {
        const problems = validate(actor, { name: w.name, dob: w.dob, tradeCode: w.trade_code, contractorId: w.contractor_id, aadhaar: null }, { exceptRoot: w.root_id ?? w.id, prev: w });
        if (problems.length) throw unprocessable(problems[0].message);
        const ctx = { band: 'STANDARD', contractorId: w.contractor_id, revision: w.revision_no };
        if (w.status === 'RETURNED') workflowOf(db).resubmit(actor, w.workflow_instance_id, { comment: comment ?? 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: WORKER_DOC, docId: id, comment: comment ?? 'Worker registration', context: ctx, amendsDocId: w.supersedes_id ?? null }); db.prepare('UPDATE lab_workers SET workflow_instance_id = ? WHERE id = ?').run(inst.id, id); }
        db.prepare("UPDATE lab_workers SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), id);
        writeAudit(db, { entity: 'lab_workers', entityId: id, action: 'submit', reason: comment ?? null, actor: actor.user, companyId: actor.companyId });
        return view(actor, rowOf(actor, id));
      });
    },
    withdraw(actor, id, { reason }) {
      const w = rowOf(actor, id);
      if (w.status !== 'SUBMITTED') throw unprocessable('Only a registration in approval is withdrawn.');
      if (!maker(actor, w)) throw forbidden('Only the person who registered it withdraws it.');
      workflowOf(db).withdraw(actor, w.workflow_instance_id, { comment: reason });
      return view(actor, rowOf(actor, id));
    },
    cancel(actor, id, { reason }) {
      const w = rowOf(actor, id); need(actor, 'hr.worker.cancel', 'cancel registrations');
      if (!['SUBMITTED', 'RETURNED'].includes(w.status)) throw unprocessable('Only a registration in approval or returned is cancelled; delete a draft, and blacklist or end an approved worker.');
      if (maker(actor, w)) transaction(db, () => { workflowOf(db).abandon(actor.companyId, w.workflow_instance_id, actor.user, 'CANCELLED', reason); decideWorker({ docId: w.id, status: 'CANCELLED' }, actor, 'CANCELLED', reason); });
      else workflowOf(db).cancel(actor, w.workflow_instance_id, { reason });
      return view(actor, rowOf(actor, id));
    },
    /** An approved worker is changed by a revision, approved again; then its values are applied to the worker (the same id and code, the same card). */
    amend(actor, id, { reason }) {
      const w = rowOf(actor, id); need(actor, 'hr.worker.amend', 'amend workers');
      if (w.status !== 'APPROVED' || w.supersedes_id) throw unprocessable('Only an approved worker is amended.');
      if (pendingRevision(w)) throw new HttpError(409, 'PENDING_CHANGE', `An amendment of ${w.worker_code} is already open.`);
      return transaction(db, () => {
        const rev = db.prepare('SELECT MAX(revision_no) AS v FROM lab_workers WHERE company_id = ? AND doc_no = ?').get(w.company_id, w.doc_no).v + 1;
        const nid = Number(db.prepare(`INSERT INTO lab_workers (company_id, doc_no, revision_no, root_id, supersedes_id, doc_date, worker_code, ${BODY.join(', ')}, status, requested_by, created_by, source_type, source_id, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ${BODY.map(() => '?').join(', ')}, 'DRAFT', ?, ?, 'lab_worker', ?, ?)`)
          .run(w.company_id, w.doc_no, rev, w.id, w.id, today(), w.worker_code, ...BODY.map((c) => w[c]), actor.user, actor.user, String(w.id), reason).lastInsertRowid);
        writeAudit(db, { entity: 'lab_workers', entityId: nid, action: 'amend', newValues: { from: w.id, revision: rev }, reason, actor: actor.user, companyId: actor.companyId });
        return view(actor, rowOf(actor, nid));
      });
    },
    history(actor, id) { return history(actor, id); },
    /** Induction and medical clearance (FR-03): recorded by the safety and HR people; the HSE module (19.01) will give it. */
    clearance(actor, id, b) {
      const w = rowOf(actor, id); need(actor, 'hr.worker.clear', 'record clearance');
      if (w.status !== 'APPROVED' || w.supersedes_id) throw unprocessable('Clearance is recorded for an approved worker.');
      if (b.medicalStatus === 'FIT' && !b.medicalValidUntil) throw badRequest('Some fields are not valid.', [{ field: 'medicalValidUntil', message: 'Say until when the medical clearance holds' }]);
      if (b.inductionStatus === 'CLEARED' && !b.inductionDate) throw badRequest('Some fields are not valid.', [{ field: 'inductionDate', message: 'Say when the induction was done' }]);
      db.prepare('UPDATE lab_workers SET induction_status = ?, induction_date = ?, medical_status = ?, medical_valid_until = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.inductionStatus, b.inductionDate ?? null, b.medicalStatus, b.medicalValidUntil ?? null, actor.user, nowIso(), id);
      writeAudit(db, { entity: 'lab_workers', entityId: id, action: 'clearance', oldValues: { induction: w.induction_status, medical: w.medical_status }, newValues: b, actor: actor.user, companyId: actor.companyId });
      event('lab.worker.clearance_changed', actor, 'lab_worker', id, w.company_id, { workerCode: w.worker_code, induction: b.inductionStatus, medical: b.medicalStatus, medicalValidUntil: b.medicalValidUntil ?? null }, null, null);
      return view(actor, rowOf(actor, id));
    },
    ppe(actor, id, b) {
      const w = rowOf(actor, id); need(actor, 'hr.worker.clear', 'record the PPE issued');
      if (w.status !== 'APPROVED' || w.supersedes_id) throw unprocessable('PPE is issued to an approved worker.');
      const list = [...json(w.ppe_json, []), { item: b.item, issuedOn: b.issuedOn, note: b.note ?? null, by: actor.user }];
      db.prepare('UPDATE lab_workers SET ppe_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(list), actor.user, nowIso(), id);
      writeAudit(db, { entity: 'lab_workers', entityId: id, action: 'ppe', newValues: b, actor: actor.user, companyId: actor.companyId });
      return view(actor, rowOf(actor, id));
    },
    /** The photo (FR-02): a file uploaded for the worker (entity lab_worker) is made the photo; the person who is registering, or HR for an approved worker, does it. */
    photo(actor, id, { fileId }) {
      const w = rowOf(actor, id);
      const mayEdit = (['DRAFT', 'RETURNED'].includes(w.status) && maker(actor, w) && may(actor, 'hr.worker.edit')) || may(actor, 'hr.worker.clear');
      if (!mayEdit) throw forbidden('You may not change the photo of this worker.');
      const f = db.prepare("SELECT id, scan_status FROM core_files WHERE id = ? AND company_id = ? AND linked_entity = 'lab_worker' AND linked_id = ? AND deleted_at IS NULL").get(fileId, actor.companyId, w.id);
      if (!f) throw badRequest('Some fields are not valid.', [{ field: 'fileId', message: 'That file was not uploaded for this worker' }]);
      if (f.scan_status !== 'CLEAN') throw unprocessable('The file has not passed the virus scan yet.');
      db.prepare('UPDATE lab_workers SET photo_file_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(fileId, actor.user, nowIso(), id);
      writeAudit(db, { entity: 'lab_workers', entityId: id, action: 'photo', newValues: { fileId }, actor: actor.user, companyId: actor.companyId });
      return view(actor, rowOf(actor, id));
    },
    /** FR-07: a worker with a safety violation is blacklisted with the reason; they are not deployed or punched in until HR lifts it. */
    blacklist(actor, id, { reason }) {
      const w = rowOf(actor, id); need(actor, 'hr.worker.blacklist', 'blacklist workers');
      if (w.status !== 'APPROVED' || w.supersedes_id) throw unprocessable('Only an approved worker is blacklisted.');
      if (w.worker_status === 'BLACKLISTED') throw conflict('This worker is blacklisted already.');
      return transaction(db, () => {
        db.prepare("UPDATE lab_workers SET worker_status = 'BLACKLISTED', blacklist_reason = ?, blacklisted_by = ?, blacklisted_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), actor.user, nowIso(), id);
        writeAudit(db, { entity: 'lab_workers', entityId: id, action: 'blacklist', reason, actor: actor.user, companyId: actor.companyId });
        event('lab.worker.blacklisted', actor, 'lab_worker', id, w.company_id, { workerCode: w.worker_code, contractorId: w.contractor_id, reason }, null, null);
        return view(actor, rowOf(actor, id));
      });
    },
    unblacklist(actor, id, { reason }) {
      const w = rowOf(actor, id); need(actor, 'hr.worker.blacklist', 'lift a blacklisting');
      if (w.worker_status !== 'BLACKLISTED') throw conflict('This worker is not blacklisted.');
      db.prepare("UPDATE lab_workers SET worker_status = 'ACTIVE', blacklist_reason = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), id);
      writeAudit(db, { entity: 'lab_workers', entityId: id, action: 'unblacklist', reason, oldValues: { reason: w.blacklist_reason }, actor: actor.user, companyId: actor.companyId });
      event('lab.worker.reinstated', actor, 'lab_worker', id, w.company_id, { workerCode: w.worker_code, reason }, null, null);
      return view(actor, rowOf(actor, id));
    },
    print(actor, id) {
      const w = rowOf(actor, id); need(actor, 'hr.worker.print', 'print workers');
      const v = view(actor, w);
      writeAudit(db, { entity: 'lab_workers', entityId: id, action: 'print', actor: actor.user, companyId: actor.companyId });
      const e = (s) => String(s ?? '—').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
      const rows = [['Code', v.workerCode], ['Name', v.name], ['Contractor', v.contractor], ['Trade', v.tradeCode], ['Skill', v.skillLabel], ['ID', v.aadhaarMasked], ['Mobile', v.mobile], ['Induction', v.inductionStatus], ['Medical', `${v.medicalStatus}${v.medicalValidUntil ? ` until ${v.medicalValidUntil}` : ''}`], ['Working status', v.workerStatus], ['Registration', v.statusLabel]];
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${e(v.workerCode)}</title><style>body{font:12px system-ui,sans-serif;margin:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:4px;text-align:left}th{width:30%}</style></head><body><h2>Worker ${e(v.workerCode)}</h2><table>${rows.map(([a, x]) => `<tr><th>${e(a)}</th><td>${e(x)}</td></tr>`).join('')}</table></body></html>`;
    },
    /** FR-05: the cards of the workers asked for, each with a QR code that holds the card's own token (not the ID number); a reissue makes the old card useless. */
    async cards(actor, { ids, reissue }) {
      need(actor, 'hr.worker.print', 'print labour cards');
      const out = [];
      for (const id of ids) {
        const w = rowOf(actor, id);
        if (w.status !== 'APPROVED' || w.supersedes_id) throw unprocessable(`${w.worker_code} is not approved yet: a card is issued to an approved worker.`);
        if (w.worker_status !== 'ACTIVE') throw unprocessable(`${w.worker_code} is ${w.worker_status.toLowerCase()}: no card is issued.`);
        const token = reissue ? randomBytes(16).toString('hex') : w.qr_token;
        if (reissue || !w.card_issued_at) db.prepare('UPDATE lab_workers SET qr_token = ?, card_issued_at = ?, card_version = card_version + 1, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(token, nowIso(), actor.user, nowIso(), w.id);
        const svg = await QRCode.toString(`LAB:${token}`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
        const c = db.prepare('SELECT legal_name FROM mdm_partners WHERE id = ?').get(w.contractor_id);
        writeAudit(db, { entity: 'lab_workers', entityId: w.id, action: reissue ? 'card_reissue' : 'card_print', actor: actor.user, companyId: actor.companyId });
        out.push({ workerId: w.id, workerCode: w.worker_code, name: w.name, trade: w.trade_code, skill: SKILLS[w.skill_category], contractor: c?.legal_name, photoFileId: w.photo_file_id, cleared: ready(w).induction && ready(w).medical, qrSvg: svg, cardVersion: db.prepare('SELECT card_version FROM lab_workers WHERE id = ?').get(w.id).card_version });
      }
      return { cards: out };
    },
  };
  function history(actor, id) {
    const w = rowOf(actor, id);
    const ids = db.prepare('SELECT id, workflow_instance_id FROM lab_workers WHERE company_id = ? AND doc_no = ?').all(w.company_id, w.doc_no);
    const approvals = ids.flatMap((v) => (v.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(v.workflow_instance_id).map((h) => ({ requestId: v.id, ...h })) : []));
    const audit = db.prepare(`SELECT action, actor, reason, created_at AS at, entity_id FROM core_audit_log WHERE entity = 'lab_workers' AND entity_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`).all(...ids.map((v) => String(v.id)));
    return { approvals, audit: audit.map((x) => ({ requestId: Number(x.entity_id), action: x.action, by: x.actor, reason: x.reason, at: x.at })) };
  }
  function decideWorker(instance, actor, outcome, comment) {
    const w = db.prepare('SELECT * FROM lab_workers WHERE id = ?').get(Number(instance.docId));
    if (!w || !['SUBMITTED', 'RETURNED'].includes(w.status)) return;
    const now = nowIso();
    if (outcome === 'APPROVED') {
      if (w.supersedes_id) {
        db.prepare(`UPDATE lab_workers SET ${BODY.map((c) => `${c} = ?`).join(', ')}, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(...BODY.map((c) => w[c]), actor.user, now, w.supersedes_id);
        db.prepare("UPDATE lab_workers SET status = 'SUPERSEDED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, w.id);
        event('lab.worker.updated', actor, 'lab_worker', w.supersedes_id, w.company_id, { workerCode: w.worker_code, contractorId: w.contractor_id, tradeCode: w.trade_code }, null, null);
      } else {
        db.prepare("UPDATE lab_workers SET status = 'APPROVED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, w.id);
        event('lab.worker.registered', actor, 'lab_worker', w.id, w.company_id, { workerCode: w.worker_code, name: w.name, contractorId: w.contractor_id, tradeCode: w.trade_code, skillCategory: w.skill_category }, null, null);
      }
    } else {
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN';
      db.prepare('UPDATE lab_workers SET status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED', actor.user, now, w.id);
      if (withdrawn) db.prepare('UPDATE lab_workers SET workflow_instance_id = NULL WHERE id = ?').run(w.id);
      if (outcome !== 'RETURNED' && !withdrawn && !w.supersedes_id) db.prepare('UPDATE lab_workers SET aadhaar_hash = NULL WHERE id = ?').run(w.id);
    }
    writeAudit(db, { entity: 'lab_workers', entityId: w.id, action: outcome.toLowerCase(), reason: comment ?? null, actor: actor.user, companyId: w.company_id });
    tell(w.company_id, w.requested_by ?? w.created_by, 'Worker', w.worker_code, w.name, outcome, comment, `/labour/workers/worker?id=${w.supersedes_id ?? w.id}`);
  }

  // ------------------------------------------------------------------ the register of workers: list and export (masks are those of the view)
  const wSelect = 'w.*, c.legal_name AS contractor_name';
  const wScope = (actor) => {
    const sc = authz.scopeFilter(actor, 'hr.worker.view', { project: 'd.dep_project_id', site: 'd.dep_site_id' }).sql;
    const all = authz.check(actor, 'hr.worker.view_all').allowed ? '1 = 1' : '1 = 0';
    return `w.company_id = :c AND (${all} OR lower(w.created_by) = lower(:u) OR EXISTS (SELECT 1 FROM hr_deployments d WHERE d.company_id = w.company_id AND d.person_type = 'WORKER' AND d.person_id = w.id AND d.deleted_at IS NULL AND d.status IN ('APPROVED', 'SUBMITTED') AND ${sc}))`;
  };
  const wPresent = (actor) => { const sens = may(actor, 'hr.worker.view_sensitive'); return (w) => ({ id: w.id, workerCode: w.worker_code, name: w.name, trade: w.trade_code, skill: SKILLS[w.skill_category], contractor: w.contractor_name, contractorId: w.contractor_id, homeState: w.home_state, mobile: sens ? w.mobile : mask(w.mobile?.slice(-4), 'XXXXXX'), induction: w.induction_status, medical: w.medical_status, workerStatus: w.worker_status, status: w.status, statusLabel: STATUS_LABELS[w.status] }); };
  const register = {
    list(actor, query) { need(actor, 'hr.worker.view', 'see workers'); return runList(db, workerList, parseListRequest(workerList, query), { select: wSelect, scopeSql: wScope(actor), params: { c: actor.companyId, u: actor.user }, tieBreaker: 'w.id', map: wPresent(actor) }); },
    exportSource(actor, req) {
      need(actor, 'hr.worker.export', 'export workers');
      const opts = { select: wSelect, scopeSql: wScope(actor), params: { c: actor.companyId, u: actor.user }, tieBreaker: 'w.id' };
      return { title: workerList.label, permission: 'hr.worker.export', personal: true, columns: Object.entries(workerList.columns).filter(([k]) => !['contractorId', 'updatedAt'].includes(k)).map(([key, c]) => ({ key, label: c.label, type: c.type === 'enum' ? 'text' : c.type })), count: () => countList(db, workerList, req, opts), rows: () => runList(db, workerList, req, { ...opts, limit: null, map: (r) => { const p = wPresent(actor)(r); return { workerCode: p.workerCode, name: p.name, trade: p.trade, skill: r.skill_category, contractor: p.contractor, homeState: p.homeState, mobile: p.mobile, induction: p.induction, medical: p.medical, workerStatus: p.workerStatus, status: p.status }; } }).data, describe: (x) => [x.q ? `search "${x.q}"` : '', ...x.filters.map((f) => `${workerList.columns[f.key]?.label ?? f.key} ${f.op} ${f.raw}`)].filter(Boolean) };
    },
  };
  /** The workers a person may pick (the crew screen): approved, working, of the contractor when named. */
  const lookup = (actor, { q, contractorId, limit, offset, ids }) => {
    const where = ['w.company_id = :c', 'w.deleted_at IS NULL', 'w.root_id = w.id', "w.status = 'APPROVED'", "w.worker_status = 'ACTIVE'", wScope(actor).replace('w.company_id = :c AND ', '')]; const p = { c: actor.companyId, u: actor.user, q: `%${q ?? ''}%` };
    if (contractorId) { where.push('w.contractor_id = :k'); p.k = contractorId; }
    if (ids) where.push(`w.id IN (${ids.map((n) => Number(n)).join(',')})`);
    where.push('(w.worker_code LIKE :q OR w.name LIKE :q)');
    const total = db.prepare(`SELECT COUNT(*) AS n FROM lab_workers w WHERE ${where.join(' AND ')}`).get(p).n;
    const rows = db.prepare(`SELECT w.id, w.worker_code, w.name, w.trade_code FROM lab_workers w WHERE ${where.join(' AND ')} ORDER BY w.worker_code LIMIT :l OFFSET :o`).all({ ...p, l: ids ? 200 : limit, o: ids ? 0 : offset });
    return { total, rows: rows.map((r) => ({ id: r.id, code: r.worker_code, name: r.name, extra: { trade: r.trade_code } })) };
  };

  // ------------------------------------------------------------------ contractors, licence and strength (FR-01, FR-06, FR-08)
  const compView = (c) => c && ({ id: c.id, contractorId: c.contractor_id, clraLicenceNo: c.clra_licence_no, licenceValidUntil: c.licence_valid_until, maxWorkers: c.max_workers, pfCode: c.pf_code, esiCode: c.esi_code, woReference: c.wo_reference, woValidUntil: c.wo_valid_until, rowVersion: c.version });
  const licenceState = (c, date) => { const days = Number(param(c?.company_id ?? 1, 'lab.licence.alert_days')) || 30; if (!c?.licence_valid_until) return 'NO_LICENCE'; if (c.licence_valid_until < date) return 'EXPIRED'; return c.licence_valid_until <= addDays(date, days) ? 'EXPIRING' : 'VALID'; };
  const deployedOn = (companyId, contractorId, date, exceptPerson = 0) => db.prepare("SELECT COUNT(DISTINCT w.id) AS n FROM lab_workers w JOIN hr_deployments d ON d.person_type = 'WORKER' AND d.person_id = w.id AND d.company_id = w.company_id WHERE w.company_id = ? AND w.contractor_id = ? AND w.root_id = w.id AND w.id != ? AND d.deleted_at IS NULL AND d.status IN ('APPROVED', 'SUBMITTED') AND d.from_date <= ? AND (d.to_date IS NULL OR d.to_date >= ?)").get(companyId, contractorId, exceptPerson, date, date).n;
  const contractors = {
    /** Every labour contractor with the licence, the most workers allowed, the workers deployed and punched in on the day, and a state (OK, EXPIRING, EXPIRED, NO_LICENCE, OVER). */
    list(actor, { date = today(), siteId } = /** @type {any} */ ({})) {
      need(actor, 'hr.worker.view', 'see labour contractors');
      const rows = db.prepare("SELECT p.id, p.code, p.legal_name, p.partner_status FROM mdm_partners p WHERE p.company_id = ? AND p.deleted_at IS NULL AND EXISTS (SELECT 1 FROM mdm_partner_roles r WHERE r.partner_id = p.id AND r.partner_role = 'LABOUR_CONTRACTOR' AND r.deleted_at IS NULL) ORDER BY p.legal_name").all(actor.companyId);
      return rows.map((p) => {
        const c = db.prepare('SELECT * FROM lab_contractor_compliance WHERE company_id = ? AND contractor_id = ? AND deleted_at IS NULL').get(actor.companyId, p.id);
        const site = siteId ? ' AND d.dep_site_id = ?' : '';
        const deployed = db.prepare(`SELECT COUNT(DISTINCT w.id) AS n FROM lab_workers w JOIN hr_deployments d ON d.person_type = 'WORKER' AND d.person_id = w.id AND d.company_id = w.company_id WHERE w.company_id = ? AND w.contractor_id = ? AND w.root_id = w.id AND d.deleted_at IS NULL AND d.status = 'APPROVED' AND d.from_date <= ? AND (d.to_date IS NULL OR d.to_date >= ?)${site}`).get(...[actor.companyId, p.id, date, date, ...(siteId ? [siteId] : [])]).n;
        const present = db.prepare(`SELECT COUNT(DISTINCT t.person_id) AS n FROM att_punches t JOIN lab_workers w ON w.id = t.person_id AND t.person_type = 'WORKER' WHERE t.company_id = ? AND w.contractor_id = ? AND t.work_date = ? AND t.punch_type = 'IN' AND t.result IN ('ACCEPTED', 'FLAGGED') AND t.deleted_at IS NULL${siteId ? ' AND t.punch_site_id = ?' : ''}`).get(...[actor.companyId, p.id, date, ...(siteId ? [siteId] : [])]).n;
        const registered = db.prepare("SELECT COUNT(*) AS n FROM lab_workers WHERE company_id = ? AND contractor_id = ? AND root_id = id AND status = 'APPROVED' AND worker_status = 'ACTIVE' AND deleted_at IS NULL").get(actor.companyId, p.id).n;
        let state = c ? licenceState({ ...c, company_id: actor.companyId }, date) : 'NO_LICENCE';
        if (c?.max_workers != null && deployed > c.max_workers) state = 'OVER';
        return { id: p.id, code: p.code, name: p.legal_name, partnerStatus: p.partner_status, compliance: compView(c), registered, deployed, present, maxWorkers: c?.max_workers ?? null, licenceValidUntil: c?.licence_valid_until ?? null, state, date };
      });
    },
    get(actor, id) {
      need(actor, 'hr.worker.view', 'see labour contractors');
      const p = partner(actor.companyId, id); if (!p) throw notFound('That is not a labour contractor of the partner master.');
      const row = contractors.list(actor).find((x) => x.id === id);
      const docs = db.prepare("SELECT doc_type AS type, document_ref AS number, valid_until AS validTo FROM mdm_partner_documents WHERE partner_id = ? AND deleted_at IS NULL ORDER BY valid_until").all(id);
      return { ...row, documents: docs, can: { edit: may(actor, 'hr.worker.compliance') } };
    },
    setCompliance(actor, id, b) {
      need(actor, 'hr.worker.compliance', 'change the compliance of contractors');
      const p = partner(actor.companyId, id); if (!p) throw notFound('That is not a labour contractor of the partner master.');
      const ex = db.prepare('SELECT * FROM lab_contractor_compliance WHERE company_id = ? AND contractor_id = ? AND deleted_at IS NULL').get(actor.companyId, id);
      if (ex && ex.version !== b.version) throw conflict('This was changed by someone else. Reload it and try again.');
      if (!ex && b.version) throw conflict('This was changed by someone else. Reload it and try again.');
      return transaction(db, () => {
        const vals = [b.clraLicenceNo ?? null, b.licenceValidUntil ?? null, b.maxWorkers ?? null, b.pfCode ?? null, b.esiCode ?? null, b.woReference ?? null, b.woValidUntil ?? null];
        if (ex) db.prepare('UPDATE lab_contractor_compliance SET clra_licence_no = ?, licence_valid_until = ?, max_workers = ?, pf_code = ?, esi_code = ?, wo_reference = ?, wo_valid_until = ?, alerted_for = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(...vals, actor.user, nowIso(), ex.id);
        else db.prepare("INSERT INTO lab_contractor_compliance (company_id, contractor_id, clra_licence_no, licence_valid_until, max_workers, pf_code, esi_code, wo_reference, wo_valid_until, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'lab_compliance')").run(actor.companyId, id, ...vals, actor.user);
        writeAudit(db, { entity: 'lab_contractor_compliance', entityId: id, action: ex ? 'update' : 'create', oldValues: ex ? compView(ex) : undefined, newValues: b, actor: actor.user, companyId: actor.companyId });
        event('lab.contractor.compliance_changed', actor, 'lab_contractor', id, actor.companyId, { contractorId: id, licenceValidUntil: b.licenceValidUntil ?? null, maxWorkers: b.maxWorkers ?? null }, null, null);
        return contractors.get(actor, id);
      });
    },
    /** FR-06 and FR-08: the strength of every contractor on a day (and, for a site, there). */
    strength(actor, q) { return contractors.list(actor, q).filter((x) => x.registered || x.deployed || x.present); },
  };
  /** The daily check: licences that have ended or end soon are told to HR once for each state; medical clearances that ran out are marked expired. */
  function cycle(companyId) {
    const t = today(); const days = Number(param(companyId, 'lab.licence.alert_days')) || 30; const out = { licencesAlerted: 0, medicalExpired: 0 };
    for (const c of db.prepare("SELECT c.*, p.legal_name FROM lab_contractor_compliance c JOIN mdm_partners p ON p.id = c.contractor_id WHERE c.company_id = ? AND c.deleted_at IS NULL AND c.licence_valid_until IS NOT NULL AND c.licence_valid_until <= ?").all(companyId, addDays(t, days))) {
      const state = c.licence_valid_until < t ? 'has expired' : 'expires'; const key = `${state}:${c.licence_valid_until}`;
      if (c.alerted_for === key) continue;
      for (const u of hrUsers(companyId)) notif.notify({ companyId, templateCode: 'lab.licence.expiring', recipients: [`user:${u}`], data: { contractor: c.legal_name, state, date: c.licence_valid_until }, link: '/labour/contractors', sourceType: 'lab_contractor', sourceId: String(c.contractor_id), eventKey: `lab.licence:${c.contractor_id}:${key}:${u}` });
      db.prepare('UPDATE lab_contractor_compliance SET alerted_for = ? WHERE id = ?').run(key, c.id);
      event('lab.contractor.licence_expiring', { user: 'system' }, 'lab_contractor', c.contractor_id, companyId, { contractorId: c.contractor_id, name: c.legal_name, licenceValidUntil: c.licence_valid_until, expired: c.licence_valid_until < t }, null, null);
      out.licencesAlerted += 1;
    }
    out.medicalExpired = db.prepare("UPDATE lab_workers SET medical_status = 'EXPIRED', updated_at = ?, version = version + 1 WHERE company_id = ? AND medical_status = 'FIT' AND medical_valid_until < ? AND deleted_at IS NULL").run(nowIso(), companyId, t).changes;
    return out;
  }
  const widget = (actor) => { if (!may(actor, 'hr.worker.view')) return { value: 0 }; return { value: contractors.list(actor).filter((c) => ['EXPIRING', 'EXPIRED', 'OVER'].includes(c.state)).length }; };

  // ------------------------------------------------------------------ wage rates (FR-04, BR-04)
  const wageRow = (actor, id) => { need(actor, 'hr.worker.view', 'see wage rates'); const r = db.prepare('SELECT * FROM lab_wage_rates WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId); if (!r) throw notFound('That wage rate does not exist.'); return r; };
  /** The minimum wage in force for a state and a skill on a day, on the basis asked for (a trade-specific notification first). */
  function minimumWage(companyId, { stateCode, skillCategory, tradeCode, payBasis, date }) {
    const rows = db.prepare("SELECT * FROM lab_wage_rates WHERE company_id = ? AND kind = 'MINIMUM' AND status = 'APPROVED' AND deleted_at IS NULL AND state_code = ? AND skill_category = ? AND effective_from <= ? ORDER BY effective_from DESC, id DESC").all(companyId, stateCode, skillCategory, date);
    const pick = (list) => list.find((r) => convertRate(r.rate_minor, r.pay_basis, payBasis) != null);
    const hit = pick(rows.filter((r) => tradeCode && r.trade_code === tradeCode)) ?? pick(rows.filter((r) => !r.trade_code));
    return hit ? { id: hit.id, docNo: hit.doc_no, rateMinor: convertRate(hit.rate_minor, hit.pay_basis, payBasis), ref: hit.min_wage_ref, effectiveFrom: hit.effective_from } : null;
  }
  /** The rate to pay a worker today: the contracted rate when there is one, else the minimum wage; never below the minimum (BR-04). */
  function applicable(companyId, { contractorId, tradeCode, skillCategory, stateCode, payBasis = 'DAILY', date = today() }) {
    const min = stateCode ? minimumWage(companyId, { stateCode, skillCategory, tradeCode, payBasis, date }) : null;
    const cands = db.prepare("SELECT * FROM lab_wage_rates WHERE company_id = ? AND kind = 'CONTRACT' AND status = 'APPROVED' AND deleted_at IS NULL AND contractor_id = ? AND skill_category = ? AND (trade_code = ? OR trade_code IS NULL) AND effective_from <= ? ORDER BY (trade_code IS NULL), effective_from DESC, id DESC").all(companyId, contractorId, skillCategory, tradeCode, date);
    const hit = cands.find((r) => (stateCode ? r.state_code === stateCode : true) && convertRate(r.rate_minor, r.pay_basis, payBasis) != null);
    const contract = hit ? { id: hit.id, docNo: hit.doc_no, rateMinor: convertRate(hit.rate_minor, hit.pay_basis, payBasis), effectiveFrom: hit.effective_from } : null;
    const rate = contract && (!min || contract.rateMinor >= min.rateMinor) ? contract : min;
    return { payBasis, date, rate: rate ? { ...rate, rate: money(rate.rateMinor), source: rate === contract ? 'CONTRACT' : 'MINIMUM' } : null, minimum: min ? { ...min, rate: money(min.rateMinor) } : null, contract: contract ? { ...contract, rate: money(contract.rateMinor) } : null };
  }
  const wageView = (actor, r) => {
    const c = r.contractor_id ? db.prepare('SELECT legal_name FROM mdm_partners WHERE id = ?').get(r.contractor_id) : null;
    const editable = ['DRAFT', 'RETURNED'].includes(r.status) && maker(actor, r); const can = (a) => may(actor, `hr.worker.${a}`);
    const min = r.kind === 'CONTRACT' ? minimumWage(r.company_id, { stateCode: r.state_code, skillCategory: r.skill_category, tradeCode: r.trade_code, payBasis: r.pay_basis, date: r.effective_from }) : null;
    return {
      id: r.id, docNo: r.doc_no, status: r.status, statusLabel: STATUS_LABELS[r.status], rowVersion: r.version, kind: r.kind, contractorId: r.contractor_id, contractor: c?.legal_name ?? null, tradeCode: r.trade_code, skillCategory: r.skill_category, skillLabel: SKILLS[r.skill_category],
      stateCode: r.state_code, payBasis: r.pay_basis, rate: money(r.rate_minor), rateMinor: r.rate_minor, minWageRef: r.min_wage_ref, effectiveFrom: r.effective_from, reason: r.reason, band: r.band, workflowInstanceId: r.workflow_instance_id, requestedBy: r.requested_by, createdBy: r.created_by,
      minimumOnFile: min ? { rate: money(min.rateMinor), ref: min.ref, docNo: min.docNo } : null,
      can: { edit: editable && can('configure'), submit: editable && can('configure'), delete: r.status === 'DRAFT' && maker(actor, r) && can('configure'), withdraw: r.status === 'SUBMITTED' && maker(actor, r), cancel: ['SUBMITTED', 'RETURNED'].includes(r.status) && can('configure') },
    };
  };
  /** BR-04: a contracted rate is not below the minimum wage of the state and skill on the day it starts; with no minimum on file it goes on, marked, for the approver to see. */
  function wageProblems(actor, b, ignoreId = 0) {
    const c = actor.companyId; const problems = [];
    if (b.kind === 'CONTRACT') {
      if (!b.contractorId || !partner(c, b.contractorId)) problems.push({ field: 'contractorId', message: 'Name the labour contractor of the partner master' });
      if (b.payBasis !== 'PIECE') {
        const min = minimumWage(c, { stateCode: b.stateCode, skillCategory: b.skillCategory, tradeCode: b.tradeCode, payBasis: b.payBasis, date: b.effectiveFrom });
        if (min && Math.round(b.rate * 100) < min.rateMinor) problems.push({ field: 'rate', message: `The rate is below the minimum wage of ${b.stateCode} for ${SKILLS[b.skillCategory].toLowerCase()} work (${money(min.rateMinor)} ${b.payBasis.toLowerCase()}, ${min.ref ?? min.docNo}, from ${min.effectiveFrom})` });
      }
    } else {
      if (b.contractorId) problems.push({ field: 'contractorId', message: 'A minimum wage notification is not for one contractor' });
      if (b.payBasis === 'PIECE') problems.push({ field: 'payBasis', message: 'A minimum wage is daily or hourly' });
      if (!b.minWageRef) problems.push({ field: 'minWageRef', message: 'Give the notification (its number and date)' });
    }
    if (b.tradeCode && !trades(c).includes(b.tradeCode)) problems.push({ field: 'tradeCode', message: `${b.tradeCode} is not a trade of this company` });
    const twin = db.prepare("SELECT doc_no FROM lab_wage_rates WHERE company_id = ? AND kind = ? AND COALESCE(contractor_id, 0) = ? AND COALESCE(trade_code, '') = ? AND skill_category = ? AND state_code = ? AND pay_basis = ? AND effective_from = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED') AND deleted_at IS NULL AND id != ?").get(c, b.kind, b.contractorId ?? 0, b.tradeCode ?? '', b.skillCategory, b.stateCode, b.payBasis, b.effectiveFrom, ignoreId);
    if (twin) problems.push({ field: 'effectiveFrom', message: `${twin.doc_no} gives this rate from this date already` });
    return problems;
  }
  const wageCols = (b) => [b.kind, b.kind === 'CONTRACT' ? b.contractorId : null, b.tradeCode ?? null, b.skillCategory, b.stateCode, b.payBasis, Math.round(b.rate * 100), b.minWageRef ?? null, b.effectiveFrom, b.reason ?? null];
  const WCOLS = ['kind', 'contractor_id', 'trade_code', 'skill_category', 'state_code', 'pay_basis', 'rate_minor', 'min_wage_ref', 'effective_from', 'reason'];
  const wageBody = (r) => ({ kind: r.kind, contractorId: r.contractor_id, tradeCode: r.trade_code, skillCategory: r.skill_category, stateCode: r.state_code, payBasis: r.pay_basis, rate: r.rate_minor / 100, minWageRef: r.min_wage_ref, effectiveFrom: r.effective_from, reason: r.reason });
  const wages = {
    list(actor, query) { need(actor, 'hr.worker.view', 'see wage rates'); return runList(db, wageList, parseListRequest(wageList, query), { select: 'r.*, c.legal_name AS contractor_name', scopeSql: 'r.company_id = :c', params: { c: actor.companyId }, tieBreaker: 'r.id', map: (r) => ({ id: r.id, docNo: r.doc_no, kind: r.kind, contractor: r.contractor_name, trade: r.trade_code, skill: SKILLS[r.skill_category], state: r.state_code, payBasis: r.pay_basis, rate: money(r.rate_minor), effectiveFrom: r.effective_from, ref: r.min_wage_ref, status: r.status, statusLabel: STATUS_LABELS[r.status] }) }); },
    exportSource(actor, req) {
      need(actor, 'hr.worker.export', 'export wage rates');
      const opts = { select: 'r.*, c.legal_name AS contractor_name', scopeSql: 'r.company_id = :c', params: { c: actor.companyId }, tieBreaker: 'r.id' };
      return { title: wageList.label, permission: 'hr.worker.export', personal: false, columns: Object.entries(wageList.columns).map(([key, c]) => ({ key, label: key === 'rate' ? 'Rate' : c.label, type: c.type === 'enum' ? 'text' : c.type })), count: () => countList(db, wageList, req, opts), rows: () => runList(db, wageList, req, { ...opts, limit: null, map: (r) => ({ docNo: r.doc_no, kind: r.kind, contractor: r.contractor_name, trade: r.trade_code, skill: r.skill_category, state: r.state_code, payBasis: r.pay_basis, rate: money(r.rate_minor), effectiveFrom: r.effective_from, ref: r.min_wage_ref, status: r.status }) }).data, describe: (x) => x.filters.map((f) => `${wageList.columns[f.key]?.label ?? f.key} ${f.op} ${f.raw}`) };
    },
    get(actor, id) { return wageView(actor, wageRow(actor, id)); },
    create(actor, b) {
      need(actor, 'hr.worker.configure', 'change wage rates');
      const problems = wageProblems(actor, b); if (problems.length) throw badRequest('Some fields are not valid.', problems);
      return transaction(db, () => {
        const no = nextDoc(actor, WAGE_DOC, 'lab_wage_rates', 'LWR');
        const id = Number(db.prepare(`INSERT INTO lab_wage_rates (company_id, doc_no, doc_date, ${WCOLS.join(', ')}, status, band, requested_by, created_by, source_type) VALUES (?, ?, ?, ${WCOLS.map(() => '?').join(', ')}, 'DRAFT', ?, ?, ?, 'lab_wage_rate')`).run(actor.companyId, no, today(), ...wageCols(b), b.kind, actor.user, actor.user).lastInsertRowid);
        db.prepare('UPDATE lab_wage_rates SET root_id = id WHERE id = ?').run(id);
        writeAudit(db, { entity: 'lab_wage_rates', entityId: id, action: 'create', newValues: { docNo: no, kind: b.kind, rate: b.rate, effectiveFrom: b.effectiveFrom }, actor: actor.user, companyId: actor.companyId });
        return b.submit ? wages.submit(actor, id, { comment: b.comment }) : wageView(actor, wageRow(actor, id));
      });
    },
    update(actor, id, b) {
      const r = wageRow(actor, id); need(actor, 'hr.worker.configure', 'change wage rates');
      if (!['DRAFT', 'RETURNED'].includes(r.status)) throw conflict('An approved rate is changed by a new rate from a later date.');
      if (!maker(actor, r)) throw forbidden(`Only ${r.created_by} changes this draft.`);
      if (r.version !== b.version) throw conflict('This rate was changed by someone else. Reload it and try again.');
      const problems = wageProblems(actor, b, id); if (problems.length) throw badRequest('Some fields are not valid.', problems);
      db.prepare(`UPDATE lab_wage_rates SET ${WCOLS.map((c) => `${c} = ?`).join(', ')}, band = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(...wageCols(b), b.kind, actor.user, nowIso(), id);
      writeAudit(db, { entity: 'lab_wage_rates', entityId: id, action: 'update', newValues: { rate: b.rate, effectiveFrom: b.effectiveFrom }, actor: actor.user, companyId: actor.companyId });
      return wageView(actor, wageRow(actor, id));
    },
    remove(actor, id) {
      const r = wageRow(actor, id); need(actor, 'hr.worker.configure', 'change wage rates');
      if (r.status !== 'DRAFT') throw new HttpError(409, 'LOCKED', 'Only a draft is deleted; cancel the others.');
      if (!maker(actor, r)) throw forbidden(`Only ${r.created_by} deletes this draft.`);
      db.prepare('UPDATE lab_wage_rates SET deleted_at = ?, deleted_by = ?, is_active = 0, version = version + 1 WHERE id = ?').run(nowIso(), actor.user, id);
      return { id, deleted: true };
    },
    submit(actor, id, { comment } = /** @type {any} */ ({})) {
      const r = wageRow(actor, id); need(actor, 'hr.worker.configure', 'submit wage rates');
      if (!['DRAFT', 'RETURNED'].includes(r.status)) throw conflict(`This rate is ${STATUS_LABELS[r.status].toLowerCase()}.`);
      if (!maker(actor, r)) throw forbidden(`Only ${r.created_by} submits this rate.`);
      return transaction(db, () => {
        const problems = wageProblems(actor, wageBody(r), id); if (problems.length) throw unprocessable(problems[0].message);
        const noMin = r.kind === 'CONTRACT' && r.pay_basis !== 'PIECE' && !minimumWage(r.company_id, { stateCode: r.state_code, skillCategory: r.skill_category, tradeCode: r.trade_code, payBasis: r.pay_basis, date: r.effective_from });
        const band = r.kind === 'MINIMUM' ? 'MINIMUM' : 'CONTRACT'; const ctx = { band, noMinimumOnFile: Boolean(noMin) };
        if (r.status === 'RETURNED') workflowOf(db).resubmit(actor, r.workflow_instance_id, { comment: comment ?? 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: WAGE_DOC, docId: id, comment: comment ?? 'Wage rate', context: ctx }); db.prepare('UPDATE lab_wage_rates SET workflow_instance_id = ? WHERE id = ?').run(inst.id, id); }
        db.prepare("UPDATE lab_wage_rates SET status = 'SUBMITTED', band = ?, requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(band, actor.user, actor.user, nowIso(), id);
        writeAudit(db, { entity: 'lab_wage_rates', entityId: id, action: 'submit', newValues: { band, noMinimumOnFile: Boolean(noMin) }, reason: comment ?? null, actor: actor.user, companyId: actor.companyId });
        return wageView(actor, wageRow(actor, id));
      });
    },
    withdraw(actor, id, { reason }) {
      const r = wageRow(actor, id);
      if (r.status !== 'SUBMITTED') throw unprocessable('Only a rate in approval is withdrawn.');
      if (!maker(actor, r)) throw forbidden('Only the person who raised it withdraws it.');
      workflowOf(db).withdraw(actor, r.workflow_instance_id, { comment: reason });
      return wageView(actor, wageRow(actor, id));
    },
    cancel(actor, id, { reason }) {
      const r = wageRow(actor, id); need(actor, 'hr.worker.configure', 'cancel wage rates');
      if (!['SUBMITTED', 'RETURNED'].includes(r.status)) throw unprocessable('Only a rate in approval or returned is cancelled.');
      if (maker(actor, r)) transaction(db, () => { workflowOf(db).abandon(actor.companyId, r.workflow_instance_id, actor.user, 'CANCELLED', reason); decideWage({ docId: r.id, status: 'CANCELLED' }, actor, 'CANCELLED', reason); });
      else workflowOf(db).cancel(actor, r.workflow_instance_id, { reason });
      return wageView(actor, wageRow(actor, id));
    },
    history(actor, id) {
      const r = wageRow(actor, id);
      return { approvals: r.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(r.workflow_instance_id) : [], audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'lab_wage_rates' AND entity_id = ? ORDER BY id").all(String(id)).map((x) => ({ action: x.action, by: x.actor, reason: x.reason, at: x.at })) };
    },
    applicable(actor, q) { need(actor, 'hr.worker.view', 'see wage rates'); return applicable(actor.companyId, q); },
  };
  function decideWage(instance, actor, outcome, comment) {
    const r = db.prepare('SELECT * FROM lab_wage_rates WHERE id = ?').get(Number(instance.docId));
    if (!r || !['SUBMITTED', 'RETURNED'].includes(r.status)) return;
    const now = nowIso();
    if (outcome === 'APPROVED') {
      // the minimum may have risen since the draft: BR-04 is checked again at the moment the rate takes effect in the books
      const problems = wageProblems({ companyId: r.company_id }, wageBody(r), r.id).filter((p) => p.field === 'rate');
      if (problems.length) throw unprocessable(problems[0].message);
      db.prepare("UPDATE lab_wage_rates SET status = 'APPROVED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, r.id);
      event('lab.wage_rate.approved', actor, 'lab_wage_rate', r.id, r.company_id, { docNo: r.doc_no, kind: r.kind, contractorId: r.contractor_id, tradeCode: r.trade_code, skillCategory: r.skill_category, stateCode: r.state_code, payBasis: r.pay_basis, rate: r.rate_minor / 100, effectiveFrom: r.effective_from }, null, null);
    } else {
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN';
      db.prepare('UPDATE lab_wage_rates SET status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED', actor.user, now, r.id);
      if (withdrawn) db.prepare('UPDATE lab_wage_rates SET workflow_instance_id = NULL WHERE id = ?').run(r.id);
    }
    writeAudit(db, { entity: 'lab_wage_rates', entityId: r.id, action: outcome.toLowerCase(), reason: comment ?? null, actor: actor.user, companyId: r.company_id });
    tell(r.company_id, r.requested_by, 'Wage rate', r.doc_no, `${r.kind === 'MINIMUM' ? 'Minimum wage' : 'Contract rate'} ${r.state_code} from ${r.effective_from}`, outcome, comment, '/labour/wages');
  }

  // ------------------------------------------------------------------ the guards of a deployment (BR-02, BR-03) and of a punch
  deploymentGuards.length = 0;
  deploymentGuards.push((companyId, b) => {
    const w = db.prepare('SELECT * FROM lab_workers WHERE id = ? AND company_id = ?').get(b.personId, companyId); if (!w) return [];
    const out = []; const date = b.fromDate ?? today();
    const c = db.prepare('SELECT * FROM lab_contractor_compliance WHERE company_id = ? AND contractor_id = ? AND deleted_at IS NULL').get(companyId, w.contractor_id);
    const name = db.prepare('SELECT legal_name FROM mdm_partners WHERE id = ?').get(w.contractor_id)?.legal_name ?? 'The contractor';
    if (!c?.licence_valid_until || c.licence_valid_until < date) out.push({ field: 'personId', message: `${name} has no CLRA licence in force on ${date}: their workers are not deployed` });
    if (c?.max_workers != null && deployedOn(companyId, w.contractor_id, date, w.id) + 1 > c.max_workers) out.push({ field: 'personId', message: `${name} may have ${c.max_workers} workers and has that many deployed: the licensed number would be exceeded` });
    const rd = ready(w);
    if (!rd.induction || !rd.medical) {
      const why = [!rd.induction ? 'induction' : null, !rd.medical ? 'medical fitness' : null].filter(Boolean).join(' and ');
      if (String(param(companyId, 'lab.deploy.clearance_mode')).toUpperCase() === 'WARN') writeAudit(db, { entity: 'lab_workers', entityId: w.id, action: 'deploy_warning', reason: `Deployed without ${why}`, actor: 'system', companyId });
      else out.push({ field: 'personId', message: `${w.worker_code} has no ${why} clearance yet: record it before the deployment` });
    }
    return out;
  });
  /** What a punch of a worker needs: an approved worker who is working and not blacklisted. */
  const punchCheck = (companyId, workerId) => {
    const w = db.prepare('SELECT id, worker_code, status, worker_status FROM lab_workers WHERE id = ? AND company_id = ? AND deleted_at IS NULL AND root_id = id').get(workerId, companyId);
    if (!w || w.status !== 'APPROVED') return { ok: false, message: 'The person is not an approved worker' };
    if (w.worker_status === 'BLACKLISTED') return { ok: false, message: 'The worker is blacklisted' };
    if (w.worker_status !== 'ACTIVE') return { ok: false, message: 'The worker has left' };
    return { ok: true, id: w.id, code: w.worker_code };
  };
  const byToken = (companyId, badge) => {
    const b = String(badge).trim(); const token = b.startsWith('LAB:') ? b.slice(4) : null;
    return db.prepare(`SELECT id FROM lab_workers WHERE company_id = ? AND root_id = id AND deleted_at IS NULL AND ${token ? 'qr_token = ?' : 'worker_code = ? COLLATE NOCASE'}`).get(companyId, token ?? b)?.id ?? null;
  };
  /** The adapter of HSE (part 19.01): the induction or medical status that the HSE module has recorded is written on the worker, with the audit trail and the clearance event, so that the deployment guard (BR-02) reads one truth. Only the fields given change. */
  const applyHse = (actor, workerId, b) => {
    const w = db.prepare('SELECT * FROM lab_workers WHERE id = ? AND company_id = ? AND deleted_at IS NULL AND root_id = id').get(workerId, actor.companyId); if (!w) return null;
    const next = { induction: b.inductionStatus ?? w.induction_status, inductionDate: 'inductionDate' in b ? b.inductionDate : w.induction_date, medical: b.medicalStatus ?? w.medical_status, medicalUntil: 'medicalValidUntil' in b ? b.medicalValidUntil : w.medical_valid_until };
    if (next.induction === w.induction_status && next.inductionDate === w.induction_date && next.medical === w.medical_status && next.medicalUntil === w.medical_valid_until) return w;
    db.prepare('UPDATE lab_workers SET induction_status = ?, induction_date = ?, medical_status = ?, medical_valid_until = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(next.induction, next.inductionDate ?? null, next.medical, next.medicalUntil ?? null, actor.user, nowIso(), w.id);
    writeAudit(db, { entity: 'lab_workers', entityId: w.id, action: 'clearance', reason: b.reason ?? 'HSE', oldValues: { induction: w.induction_status, medical: w.medical_status }, newValues: { induction: next.induction, medical: next.medical }, actor: actor.user, companyId: actor.companyId });
    event('lab.worker.clearance_changed', actor, 'lab_worker', w.id, w.company_id, { workerCode: w.worker_code, induction: next.induction, medical: next.medical, medicalValidUntil: next.medicalUntil ?? null }, null, null);
    return db.prepare('SELECT * FROM lab_workers WHERE id = ?').get(w.id);
  };
  const approvals = { /* the worklist is the common approval inbox (04.03) */ };
  void approvals; void usernameOf; void root;
  return { workers, register, lookup, contractors, wages, cycle, widget, applicable: (c, q) => applicable(c, q), minimumWage, punchCheck, byToken, applyHse, decisions: { worker: decideWorker, wage: decideWage }, trades };
}

fileEntities.register({
  entity: 'lab_worker', label: 'Contract worker (photo and identity documents)',
  resolve(db, actor, id) {
    const r = db.prepare('SELECT company_id, created_by, status FROM lab_workers WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId);
    if (!r) return null;
    const a = authzOf(db);
    return { companyId: r.company_id, projectId: null, siteId: null, canView: a.check(actor, 'hr.worker.view').allowed, canEdit: a.check(actor, 'hr.worker.edit').allowed || a.check(actor, 'hr.worker.clear').allowed, locked: false };
  },
});
const services = new WeakMap();
export const bindLabour = (db, s) => services.set(db, s);
export const labourOf = (db) => services.get(db) ?? null;

const step = (code, name, roles, when = null) => ({ code, name, type: 'approval', mode: 'single', approvers: roles.map((role) => ({ kind: 'role', role })), slaHours: 48, requireAttachment: false, checklist: [], when, notify: [], action: null });
const hooks = (fn) => ({
  onApproved: (db, { instance, actor }) => labourOf(db)?.decisions[fn](instance, actor, 'APPROVED'),
  onRejected: (db, { instance, actor, comment }) => labourOf(db)?.decisions[fn](instance, actor, 'REJECTED', comment),
  onReturned: (db, { instance, actor, comment }) => labourOf(db)?.decisions[fn](instance, actor, 'RETURNED', comment),
  onCancelled: (db, { instance, actor, comment }) => labourOf(db)?.decisions[fn](instance, actor, 'CANCELLED', comment),
});
workflowTypes.register({
  docType: WORKER_DOC, label: 'Contract worker registration', processOwner: 'HRMGR', route: (id) => `/labour/workers/worker?id=${id}`,
  describe(db, companyId, id) { const w = db.prepare('SELECT worker_code, name, requested_by, created_by, supersedes_id FROM lab_workers WHERE id = ? AND company_id = ?').get(Number(id), companyId); return w ? { ref: w.worker_code, title: `${w.name}${w.supersedes_id ? ' (change)' : ''}`, originator: w.requested_by ?? w.created_by } : null; },
  summarise(db, _actor, id) { const w = db.prepare('SELECT w.*, c.legal_name FROM lab_workers w JOIN mdm_partners c ON c.id = w.contractor_id WHERE w.id = ?').get(Number(id)); if (!w) return null; return { fields: [{ label: 'Worker', value: `${w.worker_code}${w.supersedes_id ? ` (revision ${w.revision_no})` : ''}` }, { label: 'Name', value: w.name }, { label: 'Contractor', value: w.legal_name }, { label: 'Trade', value: `${w.trade_code}, ${SKILLS[w.skill_category]}` }, { label: 'Date of birth', value: w.dob }, { label: 'ID', value: w.aadhaar_last4 ? `XXXX-XXXX-${w.aadhaar_last4}` : '—' }] }; },
  defaultDefinition: { name: 'Worker registration: supervisor or coordinator, HR manager (KYC check)', settings: { resubmit: 'first', distinctApprovers: true, matrix: true }, steps: [step('WSUP', 'Supervisor or subcontractor coordinator', ['WSUP', 'SUBCO', 'PM']), step('HRMGR', 'HR manager (KYC)', ['HRMGR'])] },
  hooks: hooks('worker'),
});
workflowTypes.register({
  docType: WAGE_DOC, label: 'Wage rate or minimum wage', processOwner: 'HRMGR', route: () => '/labour/wages',
  describe(db, companyId, id) { const r = db.prepare('SELECT doc_no, kind, state_code, effective_from, requested_by FROM lab_wage_rates WHERE id = ? AND company_id = ?').get(Number(id), companyId); return r ? { ref: r.doc_no, title: `${r.kind === 'MINIMUM' ? 'Minimum wage' : 'Contract rate'} ${r.state_code} from ${r.effective_from}`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = db.prepare('SELECT r.*, c.legal_name FROM lab_wage_rates r LEFT JOIN mdm_partners c ON c.id = r.contractor_id WHERE r.id = ?').get(Number(id)); if (!r) return null; return { fields: [{ label: 'Rate', value: r.doc_no }, { label: 'Kind', value: r.kind === 'MINIMUM' ? 'Minimum wage notification' : 'Contract rate' }, { label: 'Contractor', value: r.legal_name ?? '—' }, { label: 'State, skill', value: `${r.state_code}, ${SKILLS[r.skill_category]}${r.trade_code ? `, ${r.trade_code}` : ''}` }, { label: 'Rate', value: `${money(r.rate_minor)} ${r.pay_basis.toLowerCase()}` }, { label: 'From', value: r.effective_from }, { label: 'Notification', value: r.min_wage_ref ?? '—' }] }; },
  defaultDefinition: { name: 'Wage rate: HR manager, commercial manager for contract rates', settings: { resubmit: 'first', distinctApprovers: true, matrix: true }, steps: [step('HRMGR', 'HR manager', ['HRMGR']), step('COMMGR', 'Commercial manager (contract rates)', ['COMMGR'], { field: 'band', op: 'eq', value: 'CONTRACT' })] },
  hooks: hooks('wage'),
});
evidenceProviders.register(WORKER_DOC, ({ db, instance }) => {
  const w = db.prepare('SELECT * FROM lab_workers WHERE id = ?').get(Number(instance.docId)); if (!w) return { sections: [] };
  const c = db.prepare('SELECT * FROM lab_contractor_compliance WHERE company_id = ? AND contractor_id = ? AND deleted_at IS NULL').get(w.company_id, w.contractor_id);
  const n = db.prepare("SELECT COUNT(*) AS n FROM lab_workers WHERE company_id = ? AND contractor_id = ? AND root_id = id AND status = 'APPROVED' AND worker_status = 'ACTIVE' AND deleted_at IS NULL").get(w.company_id, w.contractor_id).n;
  const age = ageOn(w.dob, todayIST());
  return { sections: [{ code: 'lab-worker', title: 'KYC check', kind: 'metrics', items: [{ label: 'Age', value: `${age} years`, format: 'text', tone: age < MIN_AGE ? 'bad' : undefined }, { label: 'ID (last four digits)', value: w.aadhaar_last4 ?? 'none', format: 'text' }, { label: 'Contractor licence', value: c?.licence_valid_until ? `until ${c.licence_valid_until}` : 'none on file', format: 'text', tone: !c?.licence_valid_until || c.licence_valid_until < todayIST() ? 'warn' : undefined }, { label: 'Workers of this contractor', value: `${n}${c?.max_workers != null ? ` of ${c.max_workers} allowed` : ''}`, format: 'text' }] }] };
});
void forbidden; void unprocessable; void notFound;
