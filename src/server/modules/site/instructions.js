import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { toPdf } from '../../platform/export/index.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { parameterRegistry, createParameterStore } from '../../platform/parameters/index.js';
import { workflowOf } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { issueNumber } from '../core/numbering/service.js';
import { isoOf, ordOf } from '../plan/cpm.js';

// Site instructions and memos (part 14.04).
// - Received (EI engineer's, CI client's): registered by the construction manager or the project manager; with a cost or time implication they raise a variation draft for 21.05 (an event) and a notice prompt
//   (the date by which the notice letter is due, with the letter linkable); a cost implication cannot be closed until a variation decision is recorded (BR-01).
// - Issued (ISI internal site instruction, MEMO): to subcontractors and crews, each acknowledging and then complying with evidence (FR-04); with a back-charge they go CM, then PM before they are issued.
export const INS_DOC = 'SITE_INSTRUCTION';
export const INS_STATUS = { DRAFT: 'Draft', SUBMITTED: 'Waiting for approval', OPEN: 'Open', RETURNED: 'Returned for correction', REJECTED: 'Rejected', CANCELLED: 'Cancelled', CLOSED: 'Closed', SUPERSEDED: 'Superseded by an amendment' };
export const INS_TYPES = { EI: "Engineer's instruction", CI: "Client's instruction", ISI: 'Internal site instruction', MEMO: 'Site memo' };
export const PARTY_TYPES = { SUBCONTRACTOR: 'Subcontractor', CREW: 'Crew', PERSON: 'Person' };
export const VARIATION = { ACCEPTED: 'Variation accepted', REJECTED: 'Variation rejected', WITHDRAWN: 'Instruction withdrawn by the issuer' };
const RECEIVED = ['EI', 'CI'];
const nowIso = () => new Date().toISOString();
const rid = (v) => parseInt(String(v), 10);
const lower = (s) => String(s ?? '').toLowerCase();
const same = (a, b) => Boolean(a && b && lower(a) === lower(b));
const json = (s, d) => { try { return JSON.parse(s ?? ''); } catch { return d; } };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const paise = (n) => (n == null ? null : Math.round(Number(n) * 100));
const rupees = (n) => (n == null ? null : n / 100);

for (const [key, dataType, def, description, extra] of [
  ['site.instruction.notice_days', 'integer', 7, 'FR-03: the days after the date of a received instruction with a cost or time implication by which the notice to the client or engineer is due.', { min: 1, max: 90 }],
  ['site.instruction.remind_days', 'integer', 3, 'FR-05: the days between the reminders to the construction manager and project manager about an issued instruction that is past its compliance date.', { min: 1, max: 60 }],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType, default: def, scopes: ['system', 'company'], description, .../** @type {any} */ (extra) });

const ACKS = '(SELECT COUNT(*) FROM site_instruction_acks a WHERE a.instruction_id = x.id AND a.deleted_at IS NULL)';
const ACKS_OPEN = '(SELECT COUNT(*) FROM site_instruction_acks a WHERE a.instruction_id = x.id AND a.deleted_at IS NULL AND a.closed_at IS NULL)';
const ACKS_UNACK = '(SELECT COUNT(*) FROM site_instruction_acks a WHERE a.instruction_id = x.id AND a.deleted_at IS NULL AND a.acknowledged_at IS NULL)';
export const instructionList = defineList({
  code: 'site.instructions', label: 'Site instructions', permission: 'site.instruction.view', from: 'site_instructions x JOIN org_projects p ON p.id = x.org_project_id JOIN org_sites s ON s.id = x.ins_site_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'x.subject', 'x.their_ref', 'x.from_party', 'x.to_party', 'p.code', 's.code'], defaultSort: '-date',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'Instruction no.' }, date: { sql: 'x.ins_date', type: 'date', label: 'Date' }, type: { sql: 'x.ins_type', type: 'enum', label: 'Type', options: Object.entries(INS_TYPES) },
    direction: { sql: "CASE WHEN x.ins_type IN ('EI', 'CI') THEN 'RECEIVED' ELSE 'ISSUED' END", type: 'enum', label: 'Direction', options: [['RECEIVED', 'Received'], ['ISSUED', 'Issued']] },
    subject: { sql: 'x.subject', type: 'text', label: 'Subject' }, fromParty: { sql: 'x.from_party', type: 'text', label: 'From' }, toParty: { sql: 'x.to_party', type: 'text', label: 'To' },
    project: { sql: 'p.code', type: 'text', label: 'Project' }, projectId: { sql: 'x.org_project_id', type: 'number', label: 'Project id' }, site: { sql: 's.code', type: 'text', label: 'Site' }, siteId: { sql: 'x.ins_site_id', type: 'number', label: 'Site id' },
    dueDate: { sql: 'x.due_date', type: 'date', label: 'Compliance due' }, cost: { sql: 'x.cost_implication', type: 'enum', label: 'Cost implication', options: [['1', 'Yes'], ['0', 'No']] }, time: { sql: 'x.time_implication', type: 'enum', label: 'Time implication', options: [['1', 'Yes'], ['0', 'No']] },
    backcharge: { sql: 'x.backcharge', type: 'enum', label: 'Back-charge', options: [['1', 'Yes'], ['0', 'No']] },
    overdue: { sql: "CASE WHEN x.status = 'OPEN' AND x.due_date IS NOT NULL AND x.due_date < date('now', '+5 hours', '+30 minutes') THEN '1' ELSE '0' END", type: 'enum', label: 'Overdue', options: [['1', 'Overdue'], ['0', 'Not overdue']] },
    recipients: { sql: ACKS, type: 'number', label: 'Recipients' }, openAcks: { sql: ACKS_OPEN, type: 'number', label: 'Not complied' },
    status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(INS_STATUS) },
  },
});

export function createInstructionService({ db }) {
  const authz = authzOf(db);
  const store = createParameterStore(db);
  const param = (companyId, key) => store.get(key, { companyId, date: todayIST() });
  const may = (actor, key, pid, sid = null) => authz.check(actor, key, { companyId: actor.companyId, projectId: pid, siteId: sid }).allowed;
  const need = (actor, key, what, pid, sid = null) => { if (!may(actor, key, pid, sid)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const fail = (p) => { if (p.length) throw badRequest('Correct the highlighted fields', p); };
  const audit = (actor, entity, id, action, companyId, extra = {}) => writeAudit(db, { entity, entityId: id, action, actor: actor.user, companyId, ...extra });
  const notify = (companyId, code, recipients, ref, subject, detail, link, sourceId, scope = {}) => { if (!recipients.length) return; try { notificationsOf(db).notify({ companyId, templateCode: code, recipients, data: { ref, subject, detail, link }, link, sourceType: `${code}.${sourceId}`, sourceId, ...scope }); } catch { /* saved anyway */ } };
  const number = (companyId, user) => {
    try { return issueNumber(db, { companyId, docType: INS_DOC, actor: user, refType: 'site_instructions' }).number; } catch (x) { if (!['DOCUMENT_TYPE_UNKNOWN', 'NUMBER_SERIES_MISSING'].includes(x?.code)) throw x; }
    const n = (db.prepare('SELECT COUNT(*) AS n FROM site_instructions WHERE company_id = ?').get(companyId).n ?? 0) + 1; let no = `INS/${String(n).padStart(6, '0')}`;
    for (let k = n + 1; db.prepare('SELECT 1 FROM site_instructions WHERE company_id = ? AND doc_no = ?').get(companyId, no); k += 1) no = `INS/${String(k).padStart(6, '0')}`; return no;
  };
  const siteRow = (actor, siteId, key = 'site.instruction.view') => {
    const s = db.prepare('SELECT s.id, s.code, s.name, s.org_project_id, s.company_id, p.code AS pcode, p.name AS pname FROM org_sites s JOIN org_projects p ON p.id = s.org_project_id WHERE s.id = ? AND s.deleted_at IS NULL').get(rid(siteId));
    if (!s || s.company_id !== actor.companyId || !may(actor, 'site.instruction.view', s.org_project_id, s.id)) throw notFound('That site does not exist.');
    if (key !== 'site.instruction.view') need(actor, key, 'do that for this site', s.org_project_id, s.id); return s;
  };
  const canCost = (actor, pid, sid) => may(actor, 'site.instruction.cost', pid, sid);
  const fresh = (id) => db.prepare('SELECT * FROM site_instructions WHERE id = ?').get(id);
  const editable = (r) => ['DRAFT', 'RETURNED'].includes(r.status);
  const mustEdit = (r) => { if (!editable(r)) throw conflict(r.status === 'OPEN' ? `${r.doc_no} is issued: it is locked; a change is an amendment.` : `${r.doc_no} is ${lower(INS_STATUS[r.status])}: it is not changed now.`); };
  const received = (r) => RECEIVED.includes(r.ins_type);
  const needsApproval = (r) => !received(r) && Boolean(r.backcharge);

  // ---- the parties of an issued instruction -----------------------------------------------------------------------------------------------------------------------------------------------
  function partiesOf(companyId, siteId, list) {
    const p = []; const out = []; const seen = new Set();
    for (const [i, x] of (list ?? []).entries()) {
      let name = x.name ?? null;
      if (x.type === 'SUBCONTRACTOR') { const r = db.prepare("SELECT p.id, p.legal_name FROM mdm_partners p JOIN mdm_partner_roles r ON r.partner_id = p.id AND r.deleted_at IS NULL AND r.partner_role IN ('SUBCONTRACTOR', 'LABOUR_CONTRACTOR') WHERE p.id = ? AND p.company_id = ? AND p.deleted_at IS NULL").get(x.id, companyId); if (!r) { p.push({ field: `parties.${i}.id`, message: 'Choose a subcontractor' }); continue; } name = r.legal_name; }
      else if (x.type === 'CREW') { const r = db.prepare('SELECT id, name FROM hr_crews WHERE id = ? AND company_id = ? AND crew_site_id = ? AND deleted_at IS NULL').get(x.id, companyId, siteId); if (!r) { p.push({ field: `parties.${i}.id`, message: 'Choose a crew of this site' }); continue; } name = r.name; }
      const key = `${x.type}|${x.id ?? lower(name)}`; if (seen.has(key)) { p.push({ field: `parties.${i}.id`, message: 'This party is already on the list' }); continue; } seen.add(key);
      out.push({ type: x.type, id: x.id ?? null, name });
    }
    fail(p); return out;
  }
  const backchargePartner = (companyId, id, field) => { if (!id) return null; const r = db.prepare("SELECT p.id FROM mdm_partners p JOIN mdm_partner_roles r ON r.partner_id = p.id AND r.deleted_at IS NULL AND r.partner_role IN ('SUBCONTRACTOR', 'LABOUR_CONTRACTOR') WHERE p.id = ? AND p.company_id = ? AND p.deleted_at IS NULL").get(id, companyId); if (!r) fail([{ field, message: 'Choose a subcontractor' }]); return r; };
  function checkRefs(companyId, s, b) {
    const p = [];
    if (b.locationId && !db.prepare('SELECT 1 FROM proj_locations WHERE id = ? AND company_id = ? AND project_id = ? AND deleted_at IS NULL').get(b.locationId, companyId, s.org_project_id)) p.push({ field: 'locationId', message: 'Choose a location of this project' });
    if (b.activityId && !db.prepare('SELECT 1 FROM plan_activities a JOIN plan_schedules sc ON sc.id = a.schedule_id WHERE a.id = ? AND a.company_id = ? AND sc.org_project_id = ? AND a.deleted_at IS NULL').get(b.activityId, companyId, s.org_project_id)) p.push({ field: 'activityId', message: 'Choose an activity of this project' });
    if (b.letterId && !db.prepare('SELECT 1 FROM engg_letters WHERE id = ? AND company_id = ? AND org_project_id = ? AND deleted_at IS NULL').get(b.letterId, companyId, s.org_project_id)) p.push({ field: 'letterId', message: 'Choose a letter of this project' });
    fail(p);
  }
  /** The rules of a record by its type: what a received instruction, an issued one and a back-charge each need. */
  function typeProblems(type, v) {
    const p = []; const isRec = RECEIVED.includes(type);
    if (isRec && (v.backcharge || v.backchargeAmount != null || v.backchargePartnerId)) p.push({ field: 'backcharge', message: 'A back-charge goes with an instruction issued to a subcontractor' });
    if (isRec && (v.parties ?? []).length) p.push({ field: 'parties', message: 'A received instruction has no recipients to acknowledge it' });
    if (type === 'ISI' && !(v.parties ?? []).length) p.push({ field: 'parties', message: 'Name the subcontractor or crew the instruction is issued to' });
    if (v.backcharge && type !== 'ISI') p.push({ field: 'backcharge', message: 'Only an internal site instruction carries a back-charge' });
    if (v.backcharge && !v.backchargePartnerId) p.push({ field: 'backchargePartnerId', message: 'Choose the subcontractor to be charged' });
    if (!v.backcharge && (v.backchargeAmount != null || v.backchargePartnerId)) p.push({ field: 'backcharge', message: 'Tick the back-charge, or take the amount and the subcontractor away' });
    return p;
  }

  // ---- views --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const acksOf = (id) => db.prepare('SELECT * FROM site_instruction_acks WHERE instruction_id = ? AND deleted_at IS NULL ORDER BY id').all(id);
  const fileCount = (companyId, entity, id) => db.prepare("SELECT COUNT(*) AS n FROM core_files WHERE company_id = ? AND linked_entity = ? AND linked_id = ? AND deleted_at IS NULL AND scan_status <> 'INFECTED'").get(companyId, entity, id).n;
  /** Where an instruction stands: awaiting a variation decision, awaiting acknowledgement, awaiting compliance or complied (FR-05). */
  function complianceOf(r, acks) {
    if (r.status !== 'OPEN') return null;
    if (received(r)) return r.cost_implication && !r.variation_decision ? 'VARIATION_PENDING' : 'COMPLIED';
    if (!acks.length) return 'NO_RECIPIENTS';
    if (acks.some((a) => !a.acknowledged_at)) return 'AWAITING_ACK';
    if (acks.some((a) => !a.closed_at)) return 'AWAITING_COMPLIANCE';
    return 'COMPLIED';
  }
  const overdueOf = (r, state) => r.status === 'OPEN' && Boolean(r.due_date) && r.due_date < todayIST() && state !== 'COMPLIED';
  function ackView(actor, r, a) {
    const can = (k) => may(actor, k, r.org_project_id, r.ins_site_id);
    return { id: a.id, partyType: a.party_type, partyTypeLabel: PARTY_TYPES[a.party_type], partyId: a.party_id, partyName: a.party_name, acknowledgedAt: a.acknowledged_at, acknowledgedBy: a.acknowledged_by, complianceNote: a.compliance_note, closedAt: a.closed_at, closedBy: a.closed_by,
      evidence: fileCount(r.company_id, 'site_instruction_ack', a.id), state: a.closed_at ? 'COMPLIED' : a.acknowledged_at ? 'ACKNOWLEDGED' : 'PENDING', can: { acknowledge: can('site.instruction.acknowledge') && r.status === 'OPEN' && !a.acknowledged_at, comply: can('site.instruction.comply') && r.status === 'OPEN' && Boolean(a.acknowledged_at) && !a.closed_at, attach: can('site.instruction.comply') && r.status === 'OPEN' && !a.closed_at } };
  }
  function view(actor, r, { detail = false } = {}) {
    const s = db.prepare('SELECT s.code, s.name, p.code AS pcode, p.name AS pname FROM org_sites s JOIN org_projects p ON p.id = s.org_project_id WHERE s.id = ?').get(r.ins_site_id); const can = (k) => may(actor, k, r.org_project_id, r.ins_site_id); const own = same(r.requested_by, actor.user);
    const acks = acksOf(r.id); const state = complianceOf(r, acks); const cost = canCost(actor, r.org_project_id, r.ins_site_id);
    const pending = r.status === 'OPEN' && r.cost_implication && !r.variation_decision; const open = db.prepare("SELECT 1 FROM site_instructions WHERE parent_instruction_id = ? AND deleted_at IS NULL AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED')").get(r.id);
    const v = { id: r.id, docNo: r.doc_no, projectId: r.org_project_id, projectCode: s?.pcode, projectName: s?.pname, siteId: r.ins_site_id, siteCode: s?.code, siteName: s?.name, type: r.ins_type, typeLabel: INS_TYPES[r.ins_type], direction: received(r) ? 'RECEIVED' : 'ISSUED',
      date: r.ins_date, theirRef: r.their_ref, fromParty: r.from_party, toParty: r.to_party, subject: r.subject, description: r.description, locationId: r.location_id, activityId: r.activity_id, dueDate: r.due_date, costImplication: Boolean(r.cost_implication), timeImplication: Boolean(r.time_implication),
      backcharge: Boolean(r.backcharge), backchargePartnerId: r.backcharge_partner_id, backchargeAmount: cost ? rupees(r.backcharge_amount) : null, amountMasked: !cost && r.backcharge_amount != null, letterId: r.letter_id, noticeDueDate: r.notice_due_date,
      variationDecision: r.variation_decision, variationLabel: r.variation_decision ? VARIATION[r.variation_decision] : null, variationRef: r.variation_ref, variationNote: r.variation_note, variationBy: r.variation_by, variationAt: r.variation_at,
      status: r.status, statusLabel: INS_STATUS[r.status], revisionNo: r.revision_no, parentInstructionId: r.parent_instruction_id, compliance: state, overdue: overdueOf(r, state), reminderLevel: r.reminder_level, closureNotes: r.closure_notes, closedAt: r.closed_at, closedBy: r.closed_by, reason: r.reason,
      requestedBy: r.requested_by, approvedBy: r.approved_by, approvedAt: r.approved_at, issuedAt: r.issued_at, workflowInstanceId: r.workflow_instance_id, rowVersion: r.version, needsApproval: needsApproval(r),
      can: { edit: can('site.instruction.edit') && editable(r), submit: can('site.instruction.submit') && editable(r), withdraw: r.status === 'SUBMITTED' && own, cancel: can('site.instruction.cancel') && ['DRAFT', 'RETURNED', 'SUBMITTED'].includes(r.status), delete: can('site.instruction.delete') && r.status === 'DRAFT' && !r.workflow_instance_id,
        amend: can('site.instruction.amend') && r.status === 'OPEN' && !open, close: can('site.instruction.close') && r.status === 'OPEN' && !open, approve: can('site.instruction.approve') && r.status === 'SUBMITTED' && !own, variation: can('site.instruction.variation') && r.status === 'OPEN' && Boolean(r.cost_implication) && !r.variation_decision,
        addParties: can('site.instruction.edit') && r.status === 'OPEN' && !received(r), print: can('site.instruction.print'), export: can('site.instruction.export') }, blockers: pending ? ['variation'] : [] };
    if (pending && v.can.close) v.can.close = false;
    if (detail) {
      const loc = r.location_id ? db.prepare('SELECT code, name FROM proj_locations WHERE id = ?').get(r.location_id) : null; const act = r.activity_id ? db.prepare('SELECT code, name FROM plan_activities WHERE id = ?').get(r.activity_id) : null;
      const l = r.letter_id ? db.prepare('SELECT id, letter_no, subject FROM engg_letters WHERE id = ?').get(r.letter_id) : null; const bp = r.backcharge_partner_id ? db.prepare('SELECT legal_name FROM mdm_partners WHERE id = ?').get(r.backcharge_partner_id) : null; const par = r.parent_instruction_id ? fresh(r.parent_instruction_id) : null;
      v.location = loc ? `${loc.code} ${loc.name}` : null; v.activity = act ? `${act.code} ${act.name}` : null; v.letter = l ? { id: l.id, letterNo: l.letter_no, subject: l.subject } : null; v.backchargePartner = bp?.legal_name ?? null;
      v.acks = acks.map((a) => ackView(actor, r, a)); v.previous = par ? { id: par.id, docNo: par.doc_no, revisionNo: par.revision_no } : null; v.attachments = fileCount(r.company_id, 'site_instruction', r.id);
      v.revisions = db.prepare('SELECT id, doc_no, revision_no, status FROM site_instructions WHERE (parent_instruction_id = ? OR id = ?) AND id <> ? AND deleted_at IS NULL ORDER BY revision_no').all(r.id, r.parent_instruction_id ?? 0, r.id).map((x) => ({ id: x.id, docNo: x.doc_no, revisionNo: x.revision_no, status: x.status }));
    }
    return v;
  }
  const scopeOf = (actor) => { const f = authz.scopeFilter(actor, 'site.instruction.view', { project: 'x.org_project_id', site: 'x.ins_site_id' }); return { sql: `x.company_id = :c AND ${f.sql}`, params: { c: actor.companyId, ...(f.params ?? {}) } }; };
  const SELECT = `x.id, x.doc_no, x.ins_date, x.ins_type, x.subject, x.from_party, x.to_party, x.org_project_id, x.ins_site_id, x.due_date, x.cost_implication, x.time_implication, x.backcharge, x.status, p.code AS pcode, s.code AS scode, ${ACKS} AS acks, ${ACKS_OPEN} AS acks_open, ${ACKS_UNACK} AS acks_unack`;
  const listRow = (x) => { const isRec = RECEIVED.includes(x.ins_type); const overdue = x.status === 'OPEN' && x.due_date && x.due_date < todayIST() && (isRec ? false : x.acks_open > 0); return { id: x.id, docNo: x.doc_no, date: x.ins_date, type: x.ins_type, typeLabel: INS_TYPES[x.ins_type], direction: isRec ? 'RECEIVED' : 'ISSUED', subject: x.subject, fromParty: x.from_party, toParty: x.to_party, project: x.pcode, projectId: x.org_project_id, site: x.scode, siteId: x.ins_site_id, dueDate: x.due_date, cost: x.cost_implication ? 'Yes' : 'No', time: x.time_implication ? 'Yes' : 'No', backcharge: x.backcharge ? 'Yes' : 'No', overdue: overdue ? 'Overdue' : 'No', recipients: x.acks, openAcks: x.acks_open, unacknowledged: x.acks_unack, status: x.status, statusLabel: INS_STATUS[x.status] }; };
  function row(actor, id, key = 'site.instruction.view') {
    const r = db.prepare('SELECT * FROM site_instructions WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
    if (!r || !may(actor, 'site.instruction.view', r.org_project_id, r.ins_site_id)) throw notFound('That instruction does not exist.'); if (key !== 'site.instruction.view') need(actor, key, 'do that with an instruction', r.org_project_id, r.ins_site_id); return r;
  }
  const ackRow = (actor, instructionId, ackId, key) => { const r = row(actor, instructionId, key); const a = db.prepare('SELECT * FROM site_instruction_acks WHERE id = ? AND instruction_id = ? AND deleted_at IS NULL').get(rid(ackId), r.id); if (!a) throw notFound('That recipient is not on this instruction.'); return { r, a }; };

  // ---- events ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  function eventData(r) {
    const acks = acksOf(r.id);
    return { instructionId: r.id, docNo: r.doc_no, projectId: r.org_project_id, siteId: r.ins_site_id, type: r.ins_type, direction: received(r) ? 'RECEIVED' : 'ISSUED', date: r.ins_date, theirRef: r.their_ref, fromParty: r.from_party, toParty: r.to_party, subject: r.subject, description: r.description, locationId: r.location_id, activityId: r.activity_id, dueDate: r.due_date,
      costImplication: Boolean(r.cost_implication), timeImplication: Boolean(r.time_implication), noticeDueDate: r.notice_due_date, letterId: r.letter_id, supersedes: r.parent_instruction_id ?? null, parties: acks.map((a) => ({ type: a.party_type, id: a.party_id, name: a.party_name })) };
  }
  /** What opening an instruction does: the acknowledgement rows of an issued one, the variation draft and notice prompt of a received one with an implication, the back-charge of an issued one (FR-03, FR-04). */
  function open(actor, r) {
    const now = nowIso(); const set = ["status = 'OPEN'", 'issued_at = ?', 'updated_by = ?', 'updated_at = ?', 'version = version + 1']; const vals = [now, actor.user, now];
    if (received(r) && (r.cost_implication || r.time_implication)) { set.push('notice_due_date = ?'); vals.push(isoOf(ordOf(r.ins_date) + Number(param(r.company_id, 'site.instruction.notice_days') ?? 7))); }
    db.prepare(`UPDATE site_instructions SET ${set.join(', ')} WHERE id = ?`).run(...vals, r.id);
    if (!received(r)) for (const p of json(r.parties_json, [])) db.prepare("INSERT INTO site_instruction_acks (company_id, instruction_id, party_type, party_id, party_name, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'site_instruction')").run(r.company_id, r.id, p.type, p.id, p.name, r.org_project_id, r.ins_site_id, actor.user);
    if (r.parent_instruction_id) db.prepare("UPDATE site_instructions SET status = 'SUPERSEDED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ? AND status = 'OPEN'").run(actor.user, now, r.parent_instruction_id);
    const n = fresh(r.id); const data = eventData(n); const base = { entity: 'site_instruction', entityId: r.id, actorId: actor.user, companyId: r.company_id, projectId: r.org_project_id, siteId: r.ins_site_id };
    publishEvent(db, { ...base, type: received(r) ? 'site.instruction.registered' : 'site.instruction.issued', data });
    if (received(r) && (r.cost_implication || r.time_implication)) {
      publishEvent(db, { ...base, type: 'site.instruction.variation_requested', data: { ...data, source: { type: 'site_instruction', id: r.id }, note: 'Draft the variation (21.05) and serve the notice (11.05) by the notice due date.' } });
      notify(r.company_id, 'site.instruction.notice', ['role:PM|COMMGR'], r.doc_no, r.subject, `${r.doc_no} (${INS_TYPES[r.ins_type]}) has a ${[r.cost_implication ? 'cost' : null, r.time_implication ? 'time' : null].filter(Boolean).join(' and ')} implication: serve the notice by ${n.notice_due_date} and raise the variation.`, `/site/instructions?id=${r.id}`, r.id, { projectId: r.org_project_id, siteId: r.ins_site_id });
    }
    if (n.backcharge) publishEvent(db, { ...base, type: 'site.instruction.backcharge', data: { ...data, backchargePartnerId: n.backcharge_partner_id, backchargeAmount: rupees(n.backcharge_amount), source: { type: 'site_instruction', id: r.id } } });
  }

  const instructions = {
    ...(() => {
      const sc = (actor) => scopeOf(actor); const opts = (actor) => ({ select: SELECT, scopeSql: sc(actor).sql, params: sc(actor).params, tieBreaker: 'x.id' });
      return {
        list(actor, query) { if (!authz.check(actor, 'site.instruction.view').allowed) throw forbidden('You may not see site instructions (permission site.instruction.view).'); return runList(db, instructionList, parseListRequest(instructionList, query), { ...opts(actor), map: listRow }); },
        exportSource(actor, req) {
          if (!authz.check(actor, 'site.instruction.export').allowed) throw forbidden('You may not export site instructions (permission site.instruction.export).');
          return { title: instructionList.label, permission: 'site.instruction.export', personal: false, columns: ['docNo', 'date', 'type', 'subject', 'fromParty', 'toParty', 'project', 'site', 'dueDate', 'cost', 'time', 'backcharge', 'overdue', 'status'].map((k) => ({ key: k, label: instructionList.columns[k]?.label ?? k, type: 'text' })),
            rows: () => runList(db, instructionList, req, { ...opts(actor), limit: null, map: (x) => { const v = listRow(x); return { ...v, type: v.typeLabel, dueDate: v.dueDate ?? '', status: v.statusLabel }; } }).data, describe: (r) => [r.q ? `Search: ${r.q}` : 'All instructions you may see'], count: () => countList(db, instructionList, req, opts(actor)) };
        },
      };
    })(),
    sites: (actor) => db.prepare("SELECT s.id, s.code, s.name, s.org_project_id, p.code AS pcode FROM org_sites s JOIN org_projects p ON p.id = s.org_project_id WHERE s.company_id = ? AND s.deleted_at IS NULL AND s.status = 'ACTIVE' ORDER BY p.code, s.code").all(actor.companyId).filter((s) => may(actor, 'site.instruction.view', s.org_project_id, s.id)).map((s) => ({ id: s.id, code: s.code, name: s.name, projectId: s.org_project_id, projectCode: s.pcode, canCreate: may(actor, 'site.instruction.create', s.org_project_id, s.id) })),
    /** What the form offers: the subcontractors and labour contractors, the crews of the site, the activities, the locations and the letters of the project. */
    options(actor, siteId) {
      const s = siteRow(actor, siteId);
      return { siteId: s.id, subcontractors: db.prepare("SELECT DISTINCT p.id, p.legal_name AS name FROM mdm_partners p JOIN mdm_partner_roles r ON r.partner_id = p.id AND r.deleted_at IS NULL AND r.partner_role IN ('SUBCONTRACTOR', 'LABOUR_CONTRACTOR') WHERE p.company_id = ? AND p.deleted_at IS NULL ORDER BY p.legal_name LIMIT 500").all(actor.companyId),
        crews: db.prepare('SELECT id, code, name FROM hr_crews WHERE company_id = ? AND crew_site_id = ? AND deleted_at IS NULL ORDER BY code LIMIT 300').all(actor.companyId, s.id),
        activities: db.prepare("SELECT a.id, a.code, a.name FROM plan_activities a JOIN plan_schedules sc ON sc.id = a.schedule_id WHERE a.company_id = ? AND sc.org_project_id = ? AND a.deleted_at IS NULL AND sc.status IN ('APPROVED', 'DRAFT', 'SUBMITTED', 'RETURNED') ORDER BY a.code LIMIT 1000").all(actor.companyId, s.org_project_id),
        locations: db.prepare('SELECT id, code, name FROM proj_locations WHERE company_id = ? AND project_id = ? AND deleted_at IS NULL ORDER BY code LIMIT 1000').all(actor.companyId, s.org_project_id),
        letters: db.prepare('SELECT id, letter_no, subject FROM engg_letters WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL AND letter_no IS NOT NULL ORDER BY id DESC LIMIT 300').all(actor.companyId, s.org_project_id).map((l) => ({ id: l.id, letterNo: l.letter_no, subject: l.subject })),
        types: Object.entries(INS_TYPES).map(([code, label]) => ({ code, label, direction: RECEIVED.includes(code) ? 'RECEIVED' : 'ISSUED' })), canCost: canCost(actor, s.org_project_id, s.id), noticeDays: Number(param(actor.companyId, 'site.instruction.notice_days') ?? 7) };
    },
    get(actor, id) {
      const v = view(actor, row(actor, id), { detail: true });
      if (v.can.approve && v.workflowInstanceId) v.taskId = workflowOf(db).listTasks(actor, { mine: 'assigned', limit: 200 }).rows.find((t) => t.instance?.id === v.workflowInstanceId)?.id ?? null;
      return v;
    },
    create(actor, b) {
      const s = siteRow(actor, b.siteId, 'site.instruction.create'); if (b.date > todayIST()) fail([{ field: 'date', message: 'Use today or an earlier day' }]);
      checkRefs(actor.companyId, s, b); const parties = partiesOf(actor.companyId, s.id, b.parties); fail(typeProblems(b.type, { ...b, parties })); backchargePartner(actor.companyId, b.backchargePartnerId, 'backchargePartnerId');
      return transaction(db, () => {
        const id = Number(db.prepare("INSERT INTO site_instructions (company_id, doc_no, org_project_id, ins_site_id, ins_type, ins_date, their_ref, from_party, to_party, subject, description, location_id, activity_id, due_date, cost_implication, time_implication, backcharge, backcharge_amount, backcharge_partner_id, letter_id, parties_json, status, requested_by, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, 'api')")
          .run(actor.companyId, number(actor.companyId, actor.user), s.org_project_id, s.id, b.type, b.date, b.theirRef ?? null, b.fromParty, b.toParty ?? null, b.subject, b.description ?? null, b.locationId ?? null, b.activityId ?? null, b.dueDate ?? null, b.costImplication ? 1 : 0, b.timeImplication ? 1 : 0, b.backcharge ? 1 : 0, b.backcharge ? paise(b.backchargeAmount) : null, b.backcharge ? b.backchargePartnerId : null, b.letterId ?? null, JSON.stringify(parties), actor.user, s.org_project_id, s.id, actor.user).lastInsertRowid);
        audit(actor, 'site_instructions', id, 'create', actor.companyId, { newValues: { type: b.type, subject: b.subject, cost: Boolean(b.costImplication), time: Boolean(b.timeImplication), backcharge: Boolean(b.backcharge) } }); return instructions.get(actor, id);
      });
    },
    update(actor, id, b) {
      const r = row(actor, id, 'site.instruction.edit'); mustEdit(r); if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this instruction; reload it.');
      const s = siteRow(actor, r.ins_site_id); checkRefs(r.company_id, s, b);
      const m = { backcharge: 'backcharge' in b ? b.backcharge : Boolean(r.backcharge), backchargeAmount: 'backchargeAmount' in b ? b.backchargeAmount : rupees(r.backcharge_amount), backchargePartnerId: 'backchargePartnerId' in b ? b.backchargePartnerId : r.backcharge_partner_id };
      if (!m.backcharge) { m.backchargeAmount = null; m.backchargePartnerId = null; }
      const parties = 'parties' in b ? partiesOf(r.company_id, s.id, b.parties) : json(r.parties_json, []); fail(typeProblems(r.ins_type, { ...m, parties, costImplication: 'costImplication' in b ? b.costImplication : r.cost_implication })); backchargePartner(r.company_id, m.backchargePartnerId, 'backchargePartnerId');
      return transaction(db, () => {
        const set = []; const vals = []; const map = [['date', 'ins_date'], ['theirRef', 'their_ref'], ['fromParty', 'from_party'], ['toParty', 'to_party'], ['subject', 'subject'], ['description', 'description'], ['locationId', 'location_id'], ['activityId', 'activity_id'], ['dueDate', 'due_date'], ['letterId', 'letter_id']];
        for (const [k, c] of map) if (k in b) { set.push(`${c} = ?`); vals.push(b[k]); }
        for (const [k, c] of [['costImplication', 'cost_implication'], ['timeImplication', 'time_implication']]) if (k in b) { set.push(`${c} = ?`); vals.push(b[k] ? 1 : 0); }
        set.push('backcharge = ?', 'backcharge_amount = ?', 'backcharge_partner_id = ?', 'parties_json = ?'); vals.push(m.backcharge ? 1 : 0, m.backcharge ? paise(m.backchargeAmount) : null, m.backcharge ? m.backchargePartnerId : null, JSON.stringify(parties));
        db.prepare(`UPDATE site_instructions SET ${[...set, 'updated_by = ?', 'updated_at = ?', 'version = version + 1'].join(', ')} WHERE id = ?`).run(...vals, actor.user, nowIso(), r.id);
        const changed = { ...b }; delete changed.rowVersion; delete changed.backchargeAmount; audit(actor, 'site_instructions', r.id, 'update', r.company_id, { newValues: changed }); return instructions.get(actor, r.id);
      });
    },
    remove(actor, id) { const r = row(actor, id, 'site.instruction.delete'); if (r.status !== 'DRAFT' || r.workflow_instance_id) throw unprocessable('Only a draft that was never sent is deleted. Cancel it instead.'); transaction(db, () => { db.prepare('UPDATE site_instructions SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, r.id); audit(actor, 'site_instructions', r.id, 'delete', r.company_id); }); return { id: r.id, deleted: true }; },
    /** Register, issue or send: a received instruction is registered, an issued one without a back-charge is issued, one with a back-charge goes CM, then PM. */
    submit(actor, id) {
      const r = row(actor, id, 'site.instruction.submit'); if (!editable(r)) throw unprocessable('Only a draft or a returned instruction is registered, issued or sent for approval.');
      const p = typeProblems(r.ins_type, { backcharge: r.backcharge, backchargeAmount: r.backcharge_amount, backchargePartnerId: r.backcharge_partner_id, parties: json(r.parties_json, []) }); if (r.ins_type === 'ISI' && r.backcharge && r.backcharge_amount == null) p.push({ field: 'backchargeAmount', message: 'Give the amount to be charged' });
      if (!received(r) && !r.due_date && r.ins_type === 'ISI') p.push({ field: 'dueDate', message: 'Give the date by which the work is to be done' }); if (String(r.description ?? '').trim().length < 5) p.push({ field: 'description', message: 'Describe the instruction (at least 5 characters)' }); fail(p);
      return transaction(db, () => {
        if (!needsApproval(r)) { db.prepare("UPDATE site_instructions SET requested_by = ? WHERE id = ?").run(actor.user, r.id); open(actor, r); audit(actor, 'site_instructions', r.id, received(r) ? 'register' : 'issue', r.company_id); return instructions.get(actor, r.id); }
        const ctx = { projectId: r.org_project_id, siteId: r.ins_site_id, type: r.ins_type, amendment: r.parent_instruction_id ? 'yes' : 'no' };
        if (r.status === 'RETURNED') workflowOf(db).resubmit(actor, r.workflow_instance_id, { comment: 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: INS_DOC, docId: String(r.id), comment: `${r.doc_no}: ${r.subject}`.slice(0, 300), context: ctx }); db.prepare('UPDATE site_instructions SET workflow_instance_id = ? WHERE id = ?').run(inst.id, r.id); }
        db.prepare("UPDATE site_instructions SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), r.id); audit(actor, 'site_instructions', r.id, 'submit', r.company_id); return instructions.get(actor, r.id);
      });
    },
    withdraw(actor, id, { reason }) { const r = row(actor, id); if (r.status !== 'SUBMITTED') throw unprocessable('Only an instruction waiting for approval is withdrawn.'); if (!same(r.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, r.workflow_instance_id, { comment: reason }); return instructions.get(actor, r.id); },
    cancel(actor, id, { reason }) {
      const r = row(actor, id, 'site.instruction.cancel'); if (!['DRAFT', 'RETURNED', 'SUBMITTED'].includes(r.status)) throw unprocessable('Only an instruction that is not issued is cancelled; an issued one is changed by an amendment or closed.');
      return transaction(db, () => { if (r.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, r.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare("UPDATE site_instructions SET status = 'CANCELLED', reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), r.id); audit(actor, 'site_instructions', r.id, 'cancel', r.company_id, { reason }); return instructions.get(actor, r.id); });
    },
    /** An open instruction is locked; an amendment is a copy that goes through the same registration or approval and replaces it (its recipients start again). */
    amend(actor, id, { reason }) {
      const r = row(actor, id, 'site.instruction.amend'); if (r.status !== 'OPEN') throw unprocessable('Only an open instruction is amended.'); if (db.prepare("SELECT 1 FROM site_instructions WHERE parent_instruction_id = ? AND deleted_at IS NULL AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED')").get(r.id)) throw conflict('An amendment of this instruction is open.');
      return transaction(db, () => {
        const cols = ['org_project_id', 'ins_site_id', 'ins_type', 'ins_date', 'their_ref', 'from_party', 'to_party', 'subject', 'description', 'location_id', 'activity_id', 'due_date', 'cost_implication', 'time_implication', 'backcharge', 'backcharge_amount', 'backcharge_partner_id', 'letter_id', 'project_id', 'site_id'];
        const parties = acksOf(r.id).map((a) => ({ type: a.party_type, id: a.party_id, name: a.party_name }));
        const nid = Number(db.prepare(`INSERT INTO site_instructions (company_id, doc_no, ${cols.join(', ')}, parties_json, revision_no, parent_instruction_id, status, reason, requested_by, created_by, source_type, source_id) VALUES (?, ?, ${cols.map(() => '?').join(', ')}, ?, ?, ?, 'DRAFT', ?, ?, ?, 'site_instruction', ?)`)
          .run(r.company_id, number(r.company_id, actor.user), ...cols.map((c) => r[c]), JSON.stringify(parties), r.revision_no + 1, r.id, reason, actor.user, actor.user, String(r.id)).lastInsertRowid);
        audit(actor, 'site_instructions', nid, 'amend', r.company_id, { reason, newValues: { from: r.doc_no } }); return instructions.get(actor, nid);
      });
    },
    // ---- acknowledgement and compliance (FR-04) ----------------------------------------------------------------------------------------------------------------------------------------------
    /** Recipients added to an open issued instruction (a second subcontractor, a crew). */
    addParties(actor, id, b) {
      const r = row(actor, id, 'site.instruction.edit'); if (r.status !== 'OPEN' || received(r)) throw unprocessable('Recipients are added to an open instruction that was issued.'); const s = siteRow(actor, r.ins_site_id); const have = new Set(acksOf(r.id).map((a) => `${a.party_type}|${a.party_id ?? lower(a.party_name)}`));
      const add = partiesOf(r.company_id, s.id, b.parties).filter((p) => !have.has(`${p.type}|${p.id ?? lower(p.name)}`)); if (!add.length) throw conflict('Those parties are already recipients.');
      return transaction(db, () => { for (const p of add) db.prepare("INSERT INTO site_instruction_acks (company_id, instruction_id, party_type, party_id, party_name, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'site_instruction')").run(r.company_id, r.id, p.type, p.id, p.name, r.org_project_id, r.ins_site_id, actor.user); audit(actor, 'site_instructions', r.id, 'add_recipients', r.company_id, { newValues: { parties: add.map((x) => x.name) } }); return instructions.get(actor, r.id); });
    },
    /** The subcontractor coordinator (or the site) records that a party received and accepted the instruction; from a phone the same call is made. */
    acknowledge(actor, id, ackId, b) {
      const { r, a } = ackRow(actor, id, ackId, 'site.instruction.acknowledge'); if (r.status !== 'OPEN') throw unprocessable('Only an open instruction is acknowledged.'); if (a.acknowledged_at) throw conflict(`${a.party_name} has already acknowledged it.`);
      return transaction(db, () => { const now = nowIso(); db.prepare('UPDATE site_instruction_acks SET acknowledged_at = ?, acknowledged_by = ?, updated_by = ?, updated_at = ?, version = version + 1, remarks = COALESCE(?, remarks) WHERE id = ?').run(now, actor.user, actor.user, now, b?.note ?? null, a.id); audit(actor, 'site_instruction_acks', a.id, 'acknowledge', r.company_id, { newValues: { party: a.party_name } }); publishEvent(db, { type: 'site.instruction.acknowledged', entity: 'site_instruction', entityId: r.id, actorId: actor.user, companyId: r.company_id, projectId: r.org_project_id, siteId: r.ins_site_id, data: { instructionId: r.id, docNo: r.doc_no, party: { type: a.party_type, id: a.party_id, name: a.party_name } } }); return instructions.get(actor, r.id); });
    },
    /** Compliance closes one party's part: it needs the acknowledgement, a note of what was done and evidence (a file attached to the recipient). */
    comply(actor, id, ackId, b) {
      const { r, a } = ackRow(actor, id, ackId, 'site.instruction.comply'); if (r.status !== 'OPEN') throw unprocessable('Only an open instruction is complied with.'); if (!a.acknowledged_at) throw unprocessable(`${a.party_name} has not acknowledged the instruction yet.`); if (a.closed_at) throw conflict(`${a.party_name} has already complied.`);
      if (!fileCount(r.company_id, 'site_instruction_ack', a.id)) fail([{ field: 'evidence', message: 'Attach the evidence of compliance (a photograph or a signed sheet) first' }]);
      return transaction(db, () => { const now = nowIso(); db.prepare('UPDATE site_instruction_acks SET compliance_note = ?, closed_at = ?, closed_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.note, now, actor.user, actor.user, now, a.id); audit(actor, 'site_instruction_acks', a.id, 'comply', r.company_id, { newValues: { party: a.party_name } }); return instructions.get(actor, r.id); });
    },
    /** BR-01: an instruction with a cost implication is not closed before a variation decision exists; an issued one is not closed before every recipient has complied. */
    close(actor, id, b) {
      const r = row(actor, id, 'site.instruction.close'); if (r.status !== 'OPEN') throw unprocessable('Only an open instruction is closed.');
      if (db.prepare("SELECT 1 FROM site_instructions WHERE parent_instruction_id = ? AND deleted_at IS NULL AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED')").get(r.id)) throw conflict('An amendment of this instruction is open: decide it first.');
      const p = []; if (r.cost_implication && !r.variation_decision) p.push({ field: 'variation', message: 'The instruction has a cost implication: record the decision on the variation (accepted, rejected or withdrawn) before closing it' });
      const acks = acksOf(r.id); if (!received(r) && acks.some((a) => !a.closed_at)) p.push({ field: 'compliance', message: `${acks.filter((a) => !a.closed_at).map((a) => a.party_name).join(', ')} ${acks.filter((a) => !a.closed_at).length === 1 ? 'has' : 'have'} not complied yet` });
      if (p.length) throw unprocessable(p[0].message, p);
      return transaction(db, () => { const now = nowIso(); db.prepare("UPDATE site_instructions SET status = 'CLOSED', closure_notes = ?, closed_at = ?, closed_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(b.closureNotes, now, actor.user, actor.user, now, r.id); audit(actor, 'site_instructions', r.id, 'close', r.company_id, { newValues: { variation: r.variation_decision } }); publishEvent(db, { type: 'site.instruction.closed', entity: 'site_instruction', entityId: r.id, actorId: actor.user, companyId: r.company_id, projectId: r.org_project_id, siteId: r.ins_site_id, data: { ...eventData(fresh(r.id)), variationDecision: r.variation_decision, variationRef: r.variation_ref } }); return instructions.get(actor, r.id); });
    },
    /** The variation (21.05) is decided by the commercial manager; until that part exists the decision is recorded here and 21.05 will call the same service (D-491). */
    variationDecision(actor, id, b) {
      const r = row(actor, id, 'site.instruction.variation'); if (r.status !== 'OPEN') throw unprocessable('A variation decision is recorded on an open instruction.'); if (!r.cost_implication) throw unprocessable('This instruction has no cost implication, so it has no variation.'); if (r.variation_decision) throw conflict('A variation decision is already recorded.');
      return transaction(db, () => { const now = nowIso(); db.prepare('UPDATE site_instructions SET variation_decision = ?, variation_ref = ?, variation_note = ?, variation_by = ?, variation_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.decision, b.ref ?? null, b.note ?? null, actor.user, now, actor.user, now, r.id); audit(actor, 'site_instructions', r.id, 'variation_decision', r.company_id, { newValues: { decision: b.decision, ref: b.ref ?? null } }); publishEvent(db, { type: 'site.instruction.variation_decided', entity: 'site_instruction', entityId: r.id, actorId: actor.user, companyId: r.company_id, projectId: r.org_project_id, siteId: r.ins_site_id, data: { instructionId: r.id, docNo: r.doc_no, decision: b.decision, ref: b.ref ?? null } }); return instructions.get(actor, r.id); });
    },
    history(actor, id) { const r = row(actor, id); return { approvals: r.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(r.workflow_instance_id) : [], audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE (entity = 'site_instructions' AND entity_id = ?) OR (entity = 'site_instruction_acks' AND entity_id IN (SELECT CAST(id AS TEXT) FROM site_instruction_acks WHERE instruction_id = ?)) ORDER BY id").all(String(r.id), r.id) }; },
    print(actor, id) {
      const r = row(actor, id, 'site.instruction.print'); const v = view(actor, r, { detail: true }); const co = db.prepare('SELECT legal_name FROM org_companies WHERE id = ?').get(r.company_id)?.legal_name ?? ''; audit(actor, 'site_instructions', r.id, 'print', r.company_id);
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(v.docNo)}</title></head><body>${['OPEN', 'CLOSED'].includes(v.status) ? '' : `<p><strong>${esc(v.statusLabel.toUpperCase())}: NOT AN ISSUED INSTRUCTION</strong></p>`}<h1>${esc(co)}</h1><h2>${esc(v.typeLabel)} ${esc(v.docNo)}${v.revisionNo > 1 ? ` · amendment ${v.revisionNo - 1}` : ''}</h2>`
        + `<p>${esc(v.projectCode)} ${esc(v.projectName)} · site ${esc(v.siteCode)} · ${esc(v.date)}${v.theirRef ? ` · ref ${esc(v.theirRef)}` : ''}</p><p>From: ${esc(v.fromParty)} · To: ${esc(v.toParty ?? '—')}</p><h3>${esc(v.subject)}</h3><p>${esc(v.description ?? '')}</p>`
        + `<p>Location: ${esc(v.location ?? '—')} · Activity: ${esc(v.activity ?? '—')} · Compliance due: ${esc(v.dueDate ?? '—')}</p><p>Cost implication: ${v.costImplication ? 'yes' : 'no'} · Time implication: ${v.timeImplication ? 'yes' : 'no'}${v.noticeDueDate ? ` · Notice due ${esc(v.noticeDueDate)}` : ''}${v.backcharge ? ` · Back-charge to ${esc(v.backchargePartner ?? '')}${v.backchargeAmount != null ? ` Rs ${v.backchargeAmount}` : ''}` : ''}</p>`
        + `<table border="1" cellpadding="3"><tr><th>Recipient</th><th>Acknowledged</th><th>Complied</th><th>Note</th></tr>${v.acks.map((a) => `<tr><td>${esc(a.partyName)}</td><td>${esc(String(a.acknowledgedAt ?? '').slice(0, 16))}</td><td>${esc(String(a.closedAt ?? '').slice(0, 16))}</td><td>${esc(a.complianceNote ?? '')}</td></tr>`).join('')}</table>`
        + `<p>${v.approvedAt ? `Approved by ${esc(v.approvedBy)} on ${esc(v.approvedAt.slice(0, 10))}` : `Recorded by ${esc(v.requestedBy ?? '')}`}</p></body></html>`;
    },
    pdf(actor, id) {
      const r = row(actor, id, 'site.instruction.print'); const v = view(actor, r, { detail: true }); const co = db.prepare('SELECT legal_name FROM org_companies WHERE id = ?').get(r.company_id)?.legal_name ?? ''; audit(actor, 'site_instructions', r.id, 'pdf', r.company_id);
      const rows = [['Type', v.typeLabel], ['Date', v.date], ['From', v.fromParty], ['To', v.toParty ?? ''], ['Subject', v.subject], ['Description', v.description ?? ''], ['Location', v.location ?? ''], ['Activity', v.activity ?? ''], ['Compliance due', v.dueDate ?? ''], ['Cost / time implication', `${v.costImplication ? 'yes' : 'no'} / ${v.timeImplication ? 'yes' : 'no'}`], ...v.acks.map((a) => [`Recipient: ${a.partyName}`, `${a.state}${a.complianceNote ? `: ${a.complianceNote}` : ''}`])].map(([item, detail]) => ({ item, detail: String(detail) }));
      const footer = [`${co}: ${v.typeLabel.toLowerCase()} ${v.docNo}${v.revisionNo > 1 ? ` (amendment ${v.revisionNo - 1})` : ''}`, `${v.projectCode} ${v.siteCode} · ${v.statusLabel}`, v.approvedAt ? `Approved by ${v.approvedBy} on ${v.approvedAt.slice(0, 10)}` : `Recorded by ${v.requestedBy ?? ''}`];
      return { buffer: toPdf({ columns: [{ key: 'item', label: 'Item', type: 'text' }, { key: 'detail', label: 'Detail', type: 'text' }], rows, footer, title: footer[0] }), contentType: 'application/pdf', fileName: `${String(v.docNo).replace(/\W+/g, '-')}.pdf` };
    },
    /** The compliance tracker (FR-05): what stands where, by site and project, with the instructions behind each figure. */
    tracker(actor, q) {
      if (!authz.check(actor, 'site.instruction.view').allowed) throw forbidden('You may not see site instructions (permission site.instruction.view).');
      const sc = scopeOf(actor); const rows = db.prepare(`SELECT x.* FROM site_instructions x WHERE x.deleted_at IS NULL AND x.status IN ('OPEN', 'SUBMITTED') AND ${sc.sql}${q.siteId ? ' AND x.ins_site_id = :s' : ''}${q.projectId ? ' AND x.org_project_id = :p' : ''} ORDER BY x.due_date IS NULL, x.due_date, x.id LIMIT 2000`).all({ ...sc.params, ...(q.siteId ? { s: q.siteId } : {}), ...(q.projectId ? { p: q.projectId } : {}) });
      const c = { waitingApproval: 0, variationPending: 0, awaitingAck: 0, awaitingCompliance: 0, noticeDue: 0, overdue: 0, open: 0 }; const items = [];
      for (const r of rows) {
        if (r.status === 'SUBMITTED') { c.waitingApproval += 1; continue; }
        const st = complianceOf(r, acksOf(r.id)); c.open += 1; const od = overdueOf(r, st); if (od) c.overdue += 1; if (st === 'VARIATION_PENDING') c.variationPending += 1; if (st === 'AWAITING_ACK') c.awaitingAck += 1; if (st === 'AWAITING_COMPLIANCE') c.awaitingCompliance += 1;
        const nd = Boolean(r.notice_due_date && !r.letter_id && r.notice_due_date <= todayIST()); if (nd) c.noticeDue += 1;
        if (st !== 'COMPLIED' || od || nd) items.push({ id: r.id, docNo: r.doc_no, type: r.ins_type, typeLabel: INS_TYPES[r.ins_type], subject: r.subject, siteId: r.ins_site_id, dueDate: r.due_date, noticeDueDate: r.notice_due_date, state: st, overdue: od, noticeDue: nd });
      }
      return { counts: c, items: items.slice(0, 200) };
    },
    /** Reminders: an open issued instruction past its compliance date goes again to the construction manager and the project manager every `site.instruction.remind_days`. */
    remind(on = todayIST()) {
      let n = 0;
      for (const c of db.prepare("SELECT DISTINCT company_id FROM site_instructions WHERE status = 'OPEN' AND due_date IS NOT NULL AND deleted_at IS NULL").all()) {
        const every = Number(param(c.company_id, 'site.instruction.remind_days') ?? 3); const limit = isoOf(ordOf(on) - every);
        for (const r of db.prepare("SELECT * FROM site_instructions WHERE company_id = ? AND status = 'OPEN' AND due_date < ? AND deleted_at IS NULL AND (reminded_at IS NULL OR substr(reminded_at, 1, 10) <= ?)").all(c.company_id, on, limit)) {
          if (complianceOf(r, acksOf(r.id)) === 'COMPLIED') continue;
          transaction(db, () => { const level = r.reminder_level + 1; db.prepare('UPDATE site_instructions SET reminder_level = ?, reminded_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(level, `${on}T00:00:00.000Z`, 'system', nowIso(), r.id);
            writeAudit(db, { entity: 'site_instructions', entityId: r.id, action: 'remind', actor: 'system', companyId: r.company_id, newValues: { level } });
            notify(r.company_id, 'site.instruction.overdue', ['role:CM|PM'], r.doc_no, r.subject, `${r.doc_no} was to be complied with by ${r.due_date} and is still open (reminder ${level}).`, `/site/instructions?id=${r.id}`, `${r.id}-${level}`, { projectId: r.org_project_id, siteId: r.ins_site_id }); n += 1; });
        }
      }
      return n;
    },
    /** The approval engine's decision of an instruction with a back-charge (its hook runs in the same transaction). */
    decide(instance, actor, outcome, comment) {
      const r = fresh(rid(instance.docId)); if (!r || r.status !== 'SUBMITTED') return; const now = nowIso();
      if (outcome === 'APPROVED') {
        db.prepare('UPDATE site_instructions SET approved_by = ?, approved_at = ? WHERE id = ?').run(actor.user, now, r.id); open(actor, fresh(r.id)); audit(actor, 'site_instructions', r.id, r.parent_instruction_id ? 'approve_amendment' : 'approve', r.company_id);
        notify(r.company_id, 'site.instruction.approved', [`user:${r.requested_by}`], r.doc_no, r.subject, `${r.doc_no} is approved and issued${r.backcharge ? ' with its back-charge' : ''}.`, `/site/instructions?id=${r.id}`, r.id); return;
      }
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN'; const to = outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED';
      db.prepare('UPDATE site_instructions SET status = ?, workflow_instance_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, withdrawn ? null : r.workflow_instance_id, actor.user, now, r.id); audit(actor, 'site_instructions', r.id, outcome.toLowerCase(), r.company_id, { reason: comment });
      if (outcome === 'REJECTED') notify(r.company_id, 'site.instruction.rejected', [`user:${r.requested_by}`], r.doc_no, r.subject, `${r.doc_no} was not approved${comment ? `: ${comment}` : ''}.`, `/site/instructions?id=${r.id}`, r.id);
    },
  };
  return { instructions, instructionDecide: instructions.decide };
}
