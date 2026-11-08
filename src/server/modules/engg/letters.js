import { transaction } from '../../platform/db/index.js';
import { alertDatasets } from '../../platform/alerts/index.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { createParameterStore, parameterRegistry } from '../../platform/parameters/index.js';
import { evidenceProviders, workflowOf, workflowResolvers, workflowTypes } from '../../platform/workflow/index.js';
import { fileEntities } from '../../platform/files/entities.js';
import { enggOf } from './drawings.js';
import { ALERT_DAYS_DEFAULT, ISSUE_MODES, LETTER_CATS, LETTER_DOC, LETTER_STATUS, LETTER_TEMPLATES, LINK_ENTITIES, TB_STATUS, addDays, diffDays, esc, nowIso, rid, same } from './constants.js';

// Correspondence register (part 11.05). Inward letters, notices and instructions are registered with their reference, category, contract clause, response due date and assignee; outward letters are drafted (from a standard text), approved before they are numbered and put on
// letterhead (BR-01), issued by e-mail, courier, portal or hand with the acknowledgement kept as proof, and threaded to the letter they answer. A notice with a time limit in the contract is a time bar: its deadline counts down, the owner is alerted at 7, 3 and 1 days and
// when it lapses (BR-02), and the outward notice that serves it closes it. Letters link to the RFIs, variations, claims and site instructions they are evidence for.
if (!parameterRegistry.get('engg.time_bar_alert_days')) parameterRegistry.define({ key: 'engg.time_bar_alert_days', dataType: 'json', default: JSON.stringify(ALERT_DAYS_DEFAULT), scopes: ['system', 'company'], description: 'BR-02: the days before the deadline of a time-barred notice at which its owner is alerted: [7, 3, 1].' });
const UNANSWERED = "NOT EXISTS (SELECT 1 FROM engg_letters r WHERE r.parent_letter_id = x.id AND r.direction = 'OUT' AND r.status IN ('ISSUED', 'ACKNOWLEDGED') AND r.deleted_at IS NULL)";
const OVERDUE_SQL = `(CASE WHEN x.direction = 'IN' AND x.status = 'REGISTERED' AND x.response_due IS NOT NULL AND x.response_due < date('now', '+330 minutes') AND ${UNANSWERED} THEN 1 ELSE 0 END)`;
export const letterList = defineList({
  code: 'engg.letters', label: 'Correspondence register', permission: 'engg.letter.view',
  from: 'engg_letters x JOIN org_projects p ON p.id = x.org_project_id', where: "x.deleted_at IS NULL AND (x.confidentiality = 'NORMAL' OR :conf = 1)", searchable: ['x.letter_no', 'x.their_ref', 'x.subject', 'x.party', 'x.tags', 'x.clause_ref', 'x.body_text', 'p.code'], defaultSort: '-letterDate',
  columns: {
    letterNo: { sql: 'x.letter_no', type: 'text', label: 'Letter no.' }, direction: { sql: 'x.direction', type: 'enum', label: 'Direction', options: [['IN', 'Inward'], ['OUT', 'Outward']] }, theirRef: { sql: 'x.their_ref', type: 'text', label: 'Their reference' },
    project: { sql: 'p.code', type: 'text', label: 'Project' }, projectId: { sql: 'x.org_project_id', type: 'number', label: 'Project id' }, letterDate: { sql: 'x.letter_date', type: 'date', label: 'Date' }, party: { sql: 'x.party', type: 'text', label: 'Party' }, subject: { sql: 'x.subject', type: 'text', label: 'Subject' },
    category: { sql: 'x.category', type: 'enum', label: 'Category', options: Object.entries(LETTER_CATS) }, clauseRef: { sql: 'x.clause_ref', type: 'text', label: 'Clause' }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(LETTER_STATUS) },
    responseDue: { sql: 'x.response_due', type: 'date', label: 'Response due' }, assignedTo: { sql: 'x.assigned_to', type: 'text', label: 'Assigned to' }, contractual: { sql: 'x.contractual', type: 'number', label: 'Contractual' }, overdue: { sql: OVERDUE_SQL, type: 'number', label: 'Reply overdue' },
  },
});

export function createLetterService({ db, base }) {
  const { may, need, fail, project, orgOf, scopeSql, audit, event, today } = base;
  const store = createParameterStore(db);
  const conf = (actor) => (may(actor, 'engg.letter.view_confidential') ? 1 : 0);
  const row = (actor, id, key = 'engg.letter.view') => {
    const r = db.prepare('SELECT * FROM engg_letters WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
    if (!r || !may(actor, 'engg.letter.view', r.org_project_id) || (r.confidentiality === 'CONFIDENTIAL' && !may(actor, 'engg.letter.view_confidential', r.org_project_id))) throw notFound('That letter does not exist.');
    if (key !== 'engg.letter.view') need(actor, key, 'do that with a letter', r.org_project_id);
    return r;
  };
  const fresh = (id) => db.prepare('SELECT * FROM engg_letters WHERE id = ?').get(id);
  const answered = (r) => Boolean(db.prepare("SELECT 1 FROM engg_letters x WHERE x.parent_letter_id = ? AND x.direction = 'OUT' AND x.status IN ('ISSUED', 'ACKNOWLEDGED') AND x.deleted_at IS NULL").get(r.id));
  const filesOf = (id) => db.prepare("SELECT id, original_name, size_bytes FROM core_files WHERE linked_entity = 'engg_letter' AND linked_id = ? AND deleted_at IS NULL AND is_active = 1 ORDER BY id").all(id).map((f) => ({ id: f.id, name: f.original_name, size: f.size_bytes }));
  const linksOf = (id) => db.prepare('SELECT * FROM engg_letter_links WHERE letter_id = ? AND deleted_at IS NULL ORDER BY id').all(id).map((l) => ({ id: l.id, entity: l.entity, entityLabel: LINK_ENTITIES[l.entity], entityId: l.entity_id, ref: l.entity_ref }));
  const barOf = (r) => (r.time_bar_id ? db.prepare('SELECT * FROM engg_time_bars WHERE id = ?').get(r.time_bar_id) : null);

  function view(actor, r, { detail = false } = {}) {
    const o = orgOf(r.org_project_id); const can = (k) => may(actor, k, r.org_project_id); const day = today(); const out = r.direction === 'OUT'; const inward = r.direction === 'IN';
    const isAnswered = inward ? answered(r) : null; const overdue = inward && r.status === 'REGISTERED' && Boolean(r.response_due) && r.response_due < day && !isAnswered;
    const v = {
      id: r.id, projectId: r.org_project_id, projectCode: o?.code, projectName: o?.name, direction: r.direction, letterNo: r.letter_no, theirRef: r.their_ref, letterDate: r.letter_date, receivedOn: r.received_on, issuedOn: r.issued_on, party: r.party, partyContact: r.party_contact, subject: r.subject,
      category: r.category, categoryLabel: LETTER_CATS[r.category], clauseRef: r.clause_ref, contractual: Boolean(r.contractual), confidentiality: r.confidentiality, responseDue: r.response_due, assignedTo: r.assigned_to, tags: r.tags, tagList: (r.tags ?? '').split(',').map((x) => x.trim()).filter(Boolean),
      templateCode: r.template_code, documentId: r.document_id, parentLetterId: r.parent_letter_id, timeBarId: r.time_bar_id, issueMode: r.issue_mode, issueModeLabel: r.issue_mode ? ISSUE_MODES[r.issue_mode] : null, deliveryRef: r.delivery_ref, ackOn: r.ack_on, ackBy: r.ack_by, ackNote: r.ack_note,
      status: r.status, statusLabel: LETTER_STATUS[r.status], responseStatus: inward ? (isAnswered ? 'ANSWERED' : r.response_due ? (overdue ? 'OVERDUE' : 'AWAITING') : 'NOT_REQUIRED') : null, overdue, daysToReply: inward && r.response_due && !isAnswered ? diffDays(r.response_due, day) : null,
      requestedBy: r.requested_by, workflowInstanceId: r.workflow_instance_id, createdBy: r.created_by, rowVersion: r.version, onLetterhead: out && ['APPROVED', 'ISSUED', 'ACKNOWLEDGED'].includes(r.status),
      can: {
        edit: can('engg.letter.edit') && (inward ? r.status === 'REGISTERED' : ['DRAFT', 'RETURNED'].includes(r.status)), submit: out && can('engg.letter.submit') && ['DRAFT', 'RETURNED'].includes(r.status), withdraw: r.status === 'SUBMITTED' && same(r.requested_by, actor.user),
        cancel: can('engg.letter.cancel') && ['DRAFT', 'RETURNED', 'SUBMITTED', 'APPROVED'].includes(r.status), delete: can('engg.letter.delete') && (out ? r.status === 'DRAFT' && !r.workflow_instance_id : r.status === 'REGISTERED') && !db.prepare('SELECT 1 FROM engg_letters WHERE parent_letter_id = ? AND deleted_at IS NULL').get(r.id),
        issue: out && can('engg.letter.issue') && r.status === 'APPROVED', acknowledge: out && can('engg.letter.issue') && r.status === 'ISSUED', close: inward && can('engg.letter.edit') && r.status === 'REGISTERED', amend: can('engg.letter.amend') && ['ISSUED', 'ACKNOWLEDGED', 'CANCELLED', 'REJECTED', 'CLOSED'].includes(r.status),
        reply: can('engg.letter.create') && ['REGISTERED', 'CLOSED', 'ISSUED', 'ACKNOWLEDGED'].includes(r.status), print: can('engg.letter.print'), export: can('engg.letter.export') },
    };
    if (detail) {
      v.bodyText = r.body_text; v.links = linksOf(r.id); v.files = filesOf(r.id); const b = barOf(r); v.timeBar = b ? { id: b.id, barNo: b.bar_no, deadline: b.deadline, status: b.bar_status, statusLabel: TB_STATUS[b.bar_status] } : null;
      v.replies = db.prepare('SELECT id, letter_no, direction, subject, status FROM engg_letters WHERE parent_letter_id = ? AND deleted_at IS NULL ORDER BY id').all(r.id).map((x) => ({ id: x.id, letterNo: x.letter_no, direction: x.direction, subject: x.subject, status: x.status }));
      v.parent = r.parent_letter_id ? (() => { const p = fresh(r.parent_letter_id); return p ? { id: p.id, letterNo: p.letter_no, subject: p.subject, direction: p.direction } : null; })() : null;
    }
    return v;
  }
  function problems(actor, o, b, cur = null) {
    const p = []; const direction = cur?.direction ?? b.direction;
    if (b.assignedTo && !db.prepare('SELECT 1 FROM iam_users WHERE company_id = ? AND lower(username) = lower(?) AND is_active = 1').get(actor.companyId, b.assignedTo)) p.push({ field: 'assignedTo', message: 'The assignee is an active user of your company' });
    if (b.documentId && !db.prepare('SELECT 1 FROM doc_documents WHERE id = ? AND company_id = ?').get(b.documentId, actor.companyId)) p.push({ field: 'documentId', message: 'Choose a document of your company' });
    if (b.parentLetterId) { const par = db.prepare('SELECT * FROM engg_letters WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(b.parentLetterId, actor.companyId); if (!par || par.org_project_id !== o.id) p.push({ field: 'parentLetterId', message: 'Choose a letter of this project' }); else if (cur && par.id === cur.id) p.push({ field: 'parentLetterId', message: 'A letter cannot answer itself' }); }
    if (b.timeBarId) { if (direction !== 'OUT') p.push({ field: 'timeBarId', message: 'Only an outward letter serves a time bar' }); else if (!db.prepare("SELECT 1 FROM engg_time_bars WHERE id = ? AND org_project_id = ? AND bar_status = 'OPEN' AND deleted_at IS NULL").get(b.timeBarId, o.id)) p.push({ field: 'timeBarId', message: 'Choose an open time bar of this project' }); }
    if (direction === 'IN' && b.receivedOn && b.receivedOn > today()) p.push({ field: 'receivedOn', message: 'The date received is not in the future' });
    if (b.responseDue && b.letterDate && b.responseDue < b.letterDate) p.push({ field: 'responseDue', message: 'The reply is due on or after the date of the letter' });
    for (const [i, l] of (b.links ?? []).entries()) {
      const t = { RFI: ['engg_rfis', 'org_project_id'], DRAWING: ['engg_drawings', 'org_project_id'], SUBMITTAL: ['engg_submittals', 'org_project_id'], TRANSMITTAL: ['engg_transmittals', 'org_project_id'] }[l.entity];
      if (t && (!l.entityId || !db.prepare(`SELECT 1 FROM ${t[0]} WHERE id = ? AND ${t[1]} = ? AND company_id = ?`).get(l.entityId, o.id, actor.companyId))) p.push({ field: `links.${i}.entityId`, message: `Choose a ${LINK_ENTITIES[l.entity].toLowerCase()} of this project` });
    }
    return p;
  }
  const writeLinks = (actor, r, links) => {
    db.prepare('UPDATE engg_letter_links SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE letter_id = ? AND deleted_at IS NULL').run(nowIso(), actor.user, r.id); const seen = new Set();
    for (const l of links) { const k = `${l.entity}:${l.ref}`; if (seen.has(k)) continue; seen.add(k); db.prepare("INSERT INTO engg_letter_links (company_id, letter_id, org_project_id, entity, entity_id, entity_ref, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'engg_letters', ?)").run(r.company_id, r.id, r.org_project_id, l.entity, l.entityId ?? null, l.ref, r.org_project_id, actor.user, String(r.id)); }
  };
  /** Numbering per project series: PROJECT/IN/0001 and PROJECT/OUT/0001, taken when an inward letter is registered or an outward letter is approved (BR-01). */
  const number = (r) => {
    const o = orgOf(r.org_project_id); const seq = (db.prepare('SELECT MAX(series_seq) AS n FROM engg_letters WHERE org_project_id = ? AND direction = ?').get(r.org_project_id, r.direction).n ?? 0) + 1;
    db.prepare('UPDATE engg_letters SET letter_no = ?, series_seq = ? WHERE id = ?').run(`${o.code}/${r.direction}/${String(seq).padStart(4, '0')}`, seq, r.id); return fresh(r.id);
  };
  const COLS = { theirRef: 'their_ref', letterDate: 'letter_date', receivedOn: 'received_on', party: 'party', partyContact: 'party_contact', subject: 'subject', category: 'category', clauseRef: 'clause_ref', contractual: 'contractual', confidentiality: 'confidentiality', responseDue: 'response_due', assignedTo: 'assigned_to', tags: 'tags', bodyText: 'body_text', templateCode: 'template_code', documentId: 'document_id', parentLetterId: 'parent_letter_id', timeBarId: 'time_bar_id' };
  const dbv = (v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v);

  const letters = {
    list(actor, query) {
      need(actor, 'engg.letter.view', 'see correspondence'); const s = scopeSql(actor, 'engg.letter.view');
      return runList(db, letterList, parseListRequest(letterList, query), { select: 'x.*', scopeSql: s.sql, params: { ...s.params, conf: conf(actor) }, tieBreaker: 'x.id', map: (x) => { const v = view(actor, x); return { id: v.id, letterNo: v.letterNo, direction: v.direction, theirRef: v.theirRef, projectId: v.projectId, project: v.projectCode, letterDate: v.letterDate, party: v.party, subject: v.subject, category: v.categoryLabel, clauseRef: v.clauseRef, status: v.status, statusLabel: v.statusLabel, responseDue: v.responseDue, assignedTo: v.assignedTo, contractual: v.contractual ? 1 : 0, overdue: v.overdue ? 1 : 0, responseStatus: v.responseStatus }; } });
    },
    exportSource(actor, req) {
      need(actor, 'engg.letter.export', 'export the correspondence register'); const s = scopeSql(actor, 'engg.letter.view'); const opts = { select: 'x.*', scopeSql: s.sql, params: { ...s.params, conf: conf(actor) }, tieBreaker: 'x.id' };
      return { title: letterList.label, permission: 'engg.letter.export', personal: false, columns: [{ key: 'letterNo', label: 'Letter no.', type: 'text' }, { key: 'direction', label: 'Direction', type: 'text' }, { key: 'theirRef', label: 'Their reference', type: 'text' }, { key: 'project', label: 'Project', type: 'text' }, { key: 'letterDate', label: 'Date', type: 'text' }, { key: 'party', label: 'Party', type: 'text' }, { key: 'subject', label: 'Subject', type: 'text' }, { key: 'category', label: 'Category', type: 'text' }, { key: 'clauseRef', label: 'Clause', type: 'text' }, { key: 'status', label: 'Status', type: 'text' }, { key: 'responseDue', label: 'Response due', type: 'text' }],
        rows: () => runList(db, letterList, req, { ...opts, limit: null, map: (x) => { const v = view(actor, x); return { letterNo: v.letterNo ?? '', direction: v.direction === 'IN' ? 'Inward' : 'Outward', theirRef: v.theirRef ?? '', project: v.projectCode, letterDate: v.letterDate, party: v.party, subject: v.subject, category: v.categoryLabel, clauseRef: v.clauseRef ?? '', status: v.statusLabel, responseDue: v.responseDue ?? '' }; } }).data,
        describe: (r) => [r.q ? `Search: ${r.q}` : 'All correspondence you may see'], count: () => countList(db, letterList, req, opts) };
    },
    get(actor, id) { return view(actor, row(actor, id), { detail: true }); },
    create(actor, b) {
      const o = project(actor, b.projectId, 'engg.letter.create', 'engg.letter.view'); fail(problems(actor, o, b));
      if (b.confidentiality === 'CONFIDENTIAL') need(actor, 'engg.letter.view_confidential', 'register a confidential letter', o.id);
      return transaction(db, () => {
        const inward = b.direction === 'IN';
        const id = Number(db.prepare("INSERT INTO engg_letters (company_id, org_project_id, direction, their_ref, letter_date, received_on, party, party_contact, subject, category, clause_ref, contractual, confidentiality, response_due, assigned_to, tags, body_text, template_code, document_id, parent_letter_id, time_bar_id, status, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'engg_letters', ?)")
          .run(o.company_id, o.id, b.direction, b.theirRef, b.letterDate, inward ? (b.receivedOn ?? today()) : null, b.party, b.partyContact, b.subject, b.category, b.clauseRef, b.contractual ? 1 : 0, b.confidentiality, b.responseDue, b.assignedTo, b.tags, b.bodyText, b.templateCode, b.documentId, b.parentLetterId, b.timeBarId, inward ? 'REGISTERED' : 'DRAFT', o.id, actor.user, o.code).lastInsertRowid);
        let r = fresh(id); writeLinks(actor, r, b.links ?? []); if (inward) r = number(r);
        audit(actor, 'engg_letters', id, 'create', o.company_id, { newValues: { direction: b.direction, subject: b.subject } });
        if (inward) event('engg.letter.registered', actor, 'engg_letter', id, o.company_id, o.id, { projectId: o.id, letterId: id, letterNo: r.letter_no, category: b.category, clauseRef: b.clauseRef, party: b.party, theirRef: b.theirRef, responseDue: b.responseDue, links: (b.links ?? []).map((l) => ({ entity: l.entity, ref: l.ref })) });
        return letters.get(actor, id);
      });
    },
    update(actor, id, b) {
      const r = row(actor, id, 'engg.letter.edit'); const ok = r.direction === 'IN' ? r.status === 'REGISTERED' : ['DRAFT', 'RETURNED'].includes(r.status); if (!ok) throw conflict(`${r.letter_no ?? 'That letter'} is ${LETTER_STATUS[r.status].toLowerCase()}: it is not edited now.`);
      if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this letter; reload it.');
      if (b.confidentiality === 'CONFIDENTIAL') need(actor, 'engg.letter.view_confidential', 'mark a letter confidential', r.org_project_id);
      const o = orgOf(r.org_project_id); fail(problems(actor, o, { ...b, letterDate: b.letterDate ?? r.letter_date }, r)); const sets = Object.entries(COLS).filter(([k]) => k in b);
      return transaction(db, () => {
        if (sets.length) db.prepare(`UPDATE engg_letters SET ${sets.map(([, c]) => `${c} = ?`).join(', ')}, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(...sets.map(([k]) => dbv(b[k])), actor.user, nowIso(), r.id);
        if (b.links) writeLinks(actor, r, b.links); audit(actor, 'engg_letters', r.id, 'update', r.company_id); return letters.get(actor, r.id);
      });
    },
    remove(actor, id) { const r = row(actor, id, 'engg.letter.delete'); if (!letters.get(actor, r.id).can.delete) throw unprocessable('Only a draft that was never sent, or an inward letter nothing refers to, is deleted. Cancel it instead.'); db.prepare('UPDATE engg_letters SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, r.id); audit(actor, 'engg_letters', r.id, 'delete', r.company_id); return { id: r.id, deleted: true }; },
    submit(actor, id) {
      const r = row(actor, id, 'engg.letter.submit'); if (r.direction !== 'OUT' || !['DRAFT', 'RETURNED'].includes(r.status)) throw unprocessable('Only a draft or a returned outward letter is sent for approval.');
      if (String(r.body_text ?? '').trim().length < 20) throw unprocessable('Write the letter (at least 20 characters) before it is sent for approval.');
      return transaction(db, () => {
        const ctx = { projectId: r.org_project_id };
        if (r.status === 'RETURNED') workflowOf(db).resubmit(actor, r.workflow_instance_id, { comment: 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: LETTER_DOC, docId: String(r.id), comment: `${r.subject}${r.contractual ? ' (contractual notice)' : ''}`.slice(0, 300), context: ctx }); db.prepare('UPDATE engg_letters SET workflow_instance_id = ? WHERE id = ?').run(inst.id, r.id); }
        db.prepare("UPDATE engg_letters SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), r.id); audit(actor, 'engg_letters', r.id, 'submit', r.company_id); return letters.get(actor, r.id);
      });
    },
    withdraw(actor, id, { reason }) { const r = row(actor, id); if (r.status !== 'SUBMITTED') throw unprocessable('Only a letter waiting for approval is withdrawn.'); if (!same(r.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, r.workflow_instance_id, { comment: reason }); return letters.get(actor, r.id); },
    cancel(actor, id, { reason }) {
      const r = row(actor, id, 'engg.letter.cancel'); if (!['DRAFT', 'RETURNED', 'SUBMITTED', 'APPROVED'].includes(r.status)) throw unprocessable('A letter that was issued is not cancelled: amend it with a corrigendum.');
      return transaction(db, () => { if (r.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, r.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare("UPDATE engg_letters SET status = 'CANCELLED', remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), r.id); audit(actor, 'engg_letters', r.id, 'cancel', r.company_id, { reason }); return letters.get(actor, r.id); });
    },
    /** The approved letter goes out: the mode is recorded; a letter that serves a time bar closes it. */
    issue(actor, id, b) {
      const r = row(actor, id, 'engg.letter.issue'); if (r.direction !== 'OUT' || r.status !== 'APPROVED') throw unprocessable('Only an approved outward letter is issued.');
      const day = b.issuedOn ?? today(); if (day > today()) fail([{ field: 'issuedOn', message: 'The date of issue is not in the future' }]);
      return transaction(db, () => {
        db.prepare("UPDATE engg_letters SET status = 'ISSUED', issued_on = ?, issue_mode = ?, delivery_ref = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(day, b.issueMode, b.deliveryRef, actor.user, nowIso(), r.id);
        let barState = null; const bar = barOf(r);
        if (bar && bar.bar_status === 'OPEN') { const inTime = day <= bar.deadline; barState = inTime ? 'SERVED' : 'LAPSED'; db.prepare('UPDATE engg_time_bars SET bar_status = ?, served_letter_id = ?, served_on = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(barState, r.id, day, actor.user, nowIso(), bar.id); event(inTime ? 'engg.timebar.served' : 'engg.timebar.lapsed', actor, 'engg_time_bar', bar.id, r.company_id, r.org_project_id, { projectId: r.org_project_id, timeBarId: bar.id, barNo: bar.bar_no, deadline: bar.deadline, letterId: r.id, letterNo: r.letter_no, servedOn: day, claimRef: bar.claim_ref }); }
        audit(actor, 'engg_letters', r.id, 'issue', r.company_id, { newValues: { issueMode: b.issueMode, deliveryRef: b.deliveryRef } });
        event('engg.letter.issued', actor, 'engg_letter', r.id, r.company_id, r.org_project_id, { projectId: r.org_project_id, letterId: r.id, letterNo: r.letter_no, category: r.category, clauseRef: r.clause_ref, contractual: Boolean(r.contractual), party: r.party, issueMode: b.issueMode, parentLetterId: r.parent_letter_id, timeBarId: r.time_bar_id, timeBarState: barState, links: linksOf(r.id).map((l) => ({ entity: l.entity, ref: l.ref })) });
        return letters.get(actor, r.id);
      });
    },
    /** The acknowledgement of the other party is the proof of delivery. */
    acknowledge(actor, id, b) {
      const r = row(actor, id, 'engg.letter.issue'); if (r.direction !== 'OUT' || r.status !== 'ISSUED') throw unprocessable('Only an issued outward letter is acknowledged.');
      const day = b.ackOn ?? today(); if (day > today()) fail([{ field: 'ackOn', message: 'The date of acknowledgement is not in the future' }]);
      db.prepare("UPDATE engg_letters SET status = 'ACKNOWLEDGED', ack_on = ?, ack_by = ?, ack_note = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(day, b.ackBy, b.ackNote, actor.user, nowIso(), r.id); audit(actor, 'engg_letters', r.id, 'acknowledge', r.company_id);
      event('engg.letter.acknowledged', actor, 'engg_letter', r.id, r.company_id, r.org_project_id, { projectId: r.org_project_id, letterId: r.id, letterNo: r.letter_no, ackBy: b.ackBy, ackOn: day }); return letters.get(actor, r.id);
    },
    close(actor, id) { const r = row(actor, id, 'engg.letter.edit'); if (r.direction !== 'IN' || r.status !== 'REGISTERED') throw unprocessable('Only a registered inward letter is closed.'); db.prepare("UPDATE engg_letters SET status = 'CLOSED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), r.id); audit(actor, 'engg_letters', r.id, 'close', r.company_id); return letters.get(actor, r.id); },
    /** An issued letter is corrected by a corrigendum (a new draft that answers it); a closed inward letter is reopened; a cancelled or rejected letter is drafted again. */
    amend(actor, id, { reason }) {
      const r = row(actor, id, 'engg.letter.amend');
      if (r.direction === 'IN') { if (r.status !== 'CLOSED') throw unprocessable('Only a closed inward letter is reopened.'); db.prepare("UPDATE engg_letters SET status = 'REGISTERED', remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), r.id); audit(actor, 'engg_letters', r.id, 'reopen', r.company_id, { reason }); return letters.get(actor, r.id); }
      if (!['ISSUED', 'ACKNOWLEDGED', 'CANCELLED', 'REJECTED'].includes(r.status)) throw unprocessable('Only an issued, cancelled or rejected outward letter is amended.');
      const issued = ['ISSUED', 'ACKNOWLEDGED'].includes(r.status);
      return transaction(db, () => { const n = letters.create(actor, { projectId: r.org_project_id, direction: 'OUT', theirRef: r.letter_no, letterDate: today(), party: r.party, partyContact: r.party_contact, subject: issued ? `Corrigendum: ${r.subject}` : r.subject, category: r.category, clauseRef: r.clause_ref, contractual: Boolean(r.contractual), confidentiality: r.confidentiality, responseDue: null, assignedTo: r.assigned_to, tags: r.tags, bodyText: issued ? `Correction to our letter ${r.letter_no}: ${reason}\n\n` : r.body_text, templateCode: issued ? 'CORRIGENDUM' : r.template_code, documentId: null, parentLetterId: issued ? r.id : r.parent_letter_id, timeBarId: null, links: linksOf(r.id).map((l) => ({ entity: l.entity, entityId: l.entityId, ref: l.ref })) }); audit(actor, 'engg_letters', r.id, 'amend', r.company_id, { reason, newValues: { newLetter: n.id } }); return n; });
    },
    /** FR-03: the thread of a letter: the first letter and every reply under it, in order. */
    thread(actor, id) {
      let r = row(actor, id); const seen = new Set([r.id]); while (r.parent_letter_id && !seen.has(r.parent_letter_id)) { const p = fresh(r.parent_letter_id); if (!p || p.deleted_at) break; seen.add(p.id); r = p; }
      const out = []; const walk = (x, depth) => { out.push({ ...view(actor, x), depth }); for (const c of db.prepare('SELECT * FROM engg_letters WHERE parent_letter_id = ? AND deleted_at IS NULL ORDER BY letter_date, id').all(x.id)) { if (c.confidentiality === 'CONFIDENTIAL' && !may(actor, 'engg.letter.view_confidential', c.org_project_id)) continue; walk(c, depth + 1); } };
      walk(r, 0); return { rootId: r.id, current: rid(id), letters: out.map(({ id: i, letterNo, direction, subject, party, letterDate, status, statusLabel, depth, responseStatus, overdue }) => ({ id: i, letterNo, direction, subject, party, letterDate, status, statusLabel, depth, responseStatus, overdue })) };
    },
    history(actor, id) { const r = row(actor, id); return { approvals: r.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(r.workflow_instance_id) : [], audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'engg_letters' AND entity_id = ? ORDER BY id").all(String(r.id)) }; },
    /** BR-01: only an approved outward letter is printed on the letterhead and with its number; any other is a plain draft. */
    print(actor, id) {
      const r = row(actor, id, 'engg.letter.print'); const v = view(actor, r, { detail: true }); const company = db.prepare('SELECT legal_name FROM org_companies WHERE id = ?').get(r.company_id)?.legal_name ?? '';
      const head = v.onLetterhead ? `<header><h1>${esc(company)}</h1><p>Ref: ${esc(v.letterNo)} · Date: ${esc(v.issuedOn ?? v.letterDate)}</p></header>` : `<p><strong>${v.direction === 'OUT' ? 'DRAFT, NOT ON LETTERHEAD, NOT FOR ISSUE' : 'REGISTER SLIP'}</strong> ${esc(v.letterNo ?? '')}</p>`;
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(v.letterNo ?? 'Letter')}</title></head><body>${head}<p>To: ${esc(v.party)}${v.partyContact ? `, ${esc(v.partyContact)}` : ''}</p><p>Your ref: ${esc(v.theirRef ?? '—')} · Project ${esc(v.projectCode)}${v.clauseRef ? ` · Clause ${esc(v.clauseRef)}` : ''}</p><h2>${esc(v.subject)}</h2><div style="white-space:pre-wrap">${esc(v.bodyText ?? '')}</div></body></html>`;
    },
    import(actor, b) {
      project(actor, b.projectId, 'engg.letter.create', 'engg.letter.view'); const made = []; const errors = [];
      b.rows.forEach((x, i) => { try { const v = letters.create(actor, { projectId: b.projectId, ...x, direction: 'IN' }); made.push({ row: i + 1, id: v.id, letterNo: v.letterNo }); } catch (e) { errors.push({ row: i + 1, subject: x.subject, message: e.details?.[0]?.message ?? e.message }); } });
      return { created: made.length, errors, rows: made };
    },
    templates() { return LETTER_TEMPLATES.map(({ code, label, category }) => ({ code, label, category })); },
    render(actor, b) {
      const o = project(actor, b.projectId, 'engg.letter.create', 'engg.letter.view'); const t = LETTER_TEMPLATES.find((x) => x.code === b.templateCode); if (!t) throw notFound('That standard text does not exist.');
      const par = b.parentLetterId ? row(actor, b.parentLetterId) : null; if (par && par.org_project_id !== o.id) throw unprocessable('The letter answered belongs to another project.');
      const fill = (s) => s.replaceAll('{project}', `${o.code} ${o.name}`).replaceAll('{their_ref}', par?.their_ref ?? par?.letter_no ?? '[reference]').replaceAll('{their_date}', par?.letter_date ?? '[date]').replaceAll('{clause}', b.clauseRef ?? par?.clause_ref ?? '[clause]').replaceAll('{date}', today());
      return { templateCode: t.code, category: t.category, subject: fill(t.subject), body: fill(t.body), party: par?.party ?? null, parentLetterId: par?.id ?? null, clauseRef: b.clauseRef ?? par?.clause_ref ?? null };
    },
    decide(instance, actor, outcome, comment) {
      const r = fresh(rid(instance.docId)); if (!r || r.status !== 'SUBMITTED') return;
      if (outcome === 'APPROVED') { const n = number(r); db.prepare("UPDATE engg_letters SET status = 'APPROVED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), r.id); audit(actor, 'engg_letters', r.id, 'approve', r.company_id, { newValues: { letterNo: n.letter_no } }); return; }
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN'; const to = outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED';
      db.prepare('UPDATE engg_letters SET status = ?, workflow_instance_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, withdrawn ? null : r.workflow_instance_id, actor.user, nowIso(), r.id); audit(actor, 'engg_letters', r.id, outcome.toLowerCase(), r.company_id, { reason: comment ?? null });
    },
  };

  // ---- time bars (FR-04, BR-02) -----------------------------------------------------------------------------------------------------------------------------
  const tbRow = (actor, id, key = 'engg.letter.view') => { const b = db.prepare('SELECT * FROM engg_time_bars WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!b || !may(actor, 'engg.letter.view', b.org_project_id)) throw notFound('That time bar does not exist.'); if (key !== 'engg.letter.view') need(actor, key, 'do that with a time bar', b.org_project_id); return b; };
  const tbView = (actor, b) => { const day = today(); const o = orgOf(b.org_project_id); const left = diffDays(b.deadline, day); return { id: b.id, barNo: b.bar_no, projectId: b.org_project_id, projectCode: o?.code, description: b.description, clauseRef: b.clause_ref, triggerLetterId: b.trigger_letter_id, eventDate: b.event_date, limitDays: b.limit_days, deadline: b.deadline, daysLeft: b.bar_status === 'OPEN' ? left : null, claimRef: b.claim_ref, ownerUser: b.owner_user, status: b.bar_status, statusLabel: TB_STATUS[b.bar_status], servedLetterId: b.served_letter_id, servedOn: b.served_on, waiveReason: b.waive_reason, lastAlertDays: b.last_alert_days, urgency: b.bar_status !== 'OPEN' ? 'NONE' : left < 0 ? 'LAPSED' : left <= 1 ? 'CRITICAL' : left <= 7 ? 'WARNING' : 'OK', rowVersion: b.version, can: { serve: may(actor, 'engg.letter.issue', b.org_project_id) && b.bar_status === 'OPEN', waive: may(actor, 'engg.letter.approve', b.org_project_id) && b.bar_status === 'OPEN' } }; };
  const timeBars = {
    list(actor, q = {}) {
      need(actor, 'engg.letter.view', 'see time bars'); const s = scopeSql(actor, 'engg.letter.view'); const params = { ...s.params }; const w = ['x.deleted_at IS NULL']; if (q.projectId) { w.push('x.org_project_id = :pid'); params.pid = Number(q.projectId); } if (q.status) { w.push('x.bar_status = :st'); params.st = q.status; }
      const rows = db.prepare(`SELECT x.* FROM engg_time_bars x WHERE ${w.join(' AND ')} AND ${s.sql} ORDER BY (x.bar_status = 'OPEN') DESC, x.deadline LIMIT 500`).all(params).map((b) => tbView(actor, b));
      return { asOf: today(), rows, counts: { open: rows.filter((r) => r.status === 'OPEN').length, critical: rows.filter((r) => r.urgency === 'CRITICAL').length, warning: rows.filter((r) => r.urgency === 'WARNING').length, lapsed: rows.filter((r) => r.status === 'LAPSED').length, served: rows.filter((r) => r.status === 'SERVED').length } };
    },
    get(actor, id) { return tbView(actor, tbRow(actor, id)); },
    create(actor, b) {
      const o = project(actor, b.projectId, 'engg.letter.create', 'engg.letter.view'); const p = [];
      if (b.ownerUser && !db.prepare('SELECT 1 FROM iam_users WHERE company_id = ? AND lower(username) = lower(?) AND is_active = 1').get(actor.companyId, b.ownerUser)) p.push({ field: 'ownerUser', message: 'The owner is an active user of your company' });
      if (b.triggerLetterId && !db.prepare('SELECT 1 FROM engg_letters WHERE id = ? AND org_project_id = ? AND deleted_at IS NULL').get(b.triggerLetterId, o.id)) p.push({ field: 'triggerLetterId', message: 'Choose a letter of this project' });
      if (b.eventDate > today()) p.push({ field: 'eventDate', message: 'The date of the event is not in the future' }); fail(p);
      return transaction(db, () => {
        let k = db.prepare('SELECT COUNT(*) AS n FROM engg_time_bars WHERE company_id = ?').get(o.company_id).n + 1; let no = `TB-${String(k).padStart(5, '0')}`; while (db.prepare('SELECT 1 FROM engg_time_bars WHERE company_id = ? AND bar_no = ?').get(o.company_id, no)) { k += 1; no = `TB-${String(k).padStart(5, '0')}`; }
        const deadline = addDays(b.eventDate, b.limitDays);
        const id = Number(db.prepare("INSERT INTO engg_time_bars (company_id, org_project_id, bar_no, description, clause_ref, trigger_letter_id, event_date, limit_days, deadline, claim_ref, owner_user, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'engg_time_bars', ?)").run(o.company_id, o.id, no, b.description, b.clauseRef, b.triggerLetterId, b.eventDate, b.limitDays, deadline, b.claimRef, b.ownerUser ?? actor.user, o.id, actor.user, o.code).lastInsertRowid);
        audit(actor, 'engg_time_bars', id, 'create', o.company_id, { newValues: { barNo: no, deadline } }); event('engg.timebar.opened', actor, 'engg_time_bar', id, o.company_id, o.id, { projectId: o.id, timeBarId: id, barNo: no, clauseRef: b.clauseRef, deadline, limitDays: b.limitDays, claimRef: b.claimRef }); return timeBars.get(actor, id);
      });
    },
    /** A letter that was issued in time serves the bar by hand (the usual way is to name the bar on the outward letter). */
    serve(actor, id, { letterId }) {
      const b = tbRow(actor, id, 'engg.letter.issue'); if (b.bar_status !== 'OPEN') throw unprocessable('Only an open time bar is served.'); const l = row(actor, letterId); if (l.org_project_id !== b.org_project_id || l.direction !== 'OUT' || !['ISSUED', 'ACKNOWLEDGED'].includes(l.status)) throw unprocessable('Choose an outward letter of this project that was issued.');
      const inTime = l.issued_on <= b.deadline; db.prepare('UPDATE engg_time_bars SET bar_status = ?, served_letter_id = ?, served_on = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(inTime ? 'SERVED' : 'LAPSED', l.id, l.issued_on, actor.user, nowIso(), b.id);
      audit(actor, 'engg_time_bars', b.id, 'serve', b.company_id); event(inTime ? 'engg.timebar.served' : 'engg.timebar.lapsed', actor, 'engg_time_bar', b.id, b.company_id, b.org_project_id, { projectId: b.org_project_id, timeBarId: b.id, barNo: b.bar_no, deadline: b.deadline, letterId: l.id, letterNo: l.letter_no, servedOn: l.issued_on, claimRef: b.claim_ref }); return timeBars.get(actor, b.id);
    },
    waive(actor, id, { reason }) { const b = tbRow(actor, id, 'engg.letter.approve'); if (b.bar_status !== 'OPEN') throw unprocessable('Only an open time bar is waived.'); db.prepare("UPDATE engg_time_bars SET bar_status = 'WAIVED', waive_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), b.id); audit(actor, 'engg_time_bars', b.id, 'waive', b.company_id, { reason }); return timeBars.get(actor, b.id); },
  };

  /** BR-02, FR-03: the countdown. An open time bar alerts its owner and the project manager when it comes within 7, 3 and 1 days and when it lapses; an inward letter whose reply is overdue alerts its assignee once. */
  function runAlerts(actor) {
    need(actor, 'engg.letter.approve', 'run the deadline alerts'); const day = today(); const s = scopeSql(actor, 'engg.letter.view'); const out = { timeBarAlerts: [], lapsed: [], replyOverdue: [] };
    let steps; try { const v = store.get('engg.time_bar_alert_days', { companyId: actor.companyId, date: day }); steps = (typeof v === 'string' ? JSON.parse(v) : v).map(Number).filter((n) => n >= 0).sort((a, b) => a - b); } catch { steps = ALERT_DAYS_DEFAULT; }
    const notify = (r, code, users, ref, subject, detail, link, src, suffix = '') => { const to = [...new Set(users.filter(Boolean))]; if (!to.length) return; try { notificationsOf(db).notify({ companyId: r.company_id, templateCode: code, recipients: to.map((u) => `user:${u}`), data: { ref, subject, detail, link }, link, sourceType: `${src}${suffix}`, sourceId: r.id }); } catch { /* the alert is still recorded */ } };
    const pmOf = (pid) => db.prepare('SELECT pm_user FROM proj_projects WHERE project_id = ?').get(pid)?.pm_user;
    return transaction(db, () => {
      for (const b of db.prepare(`SELECT x.* FROM engg_time_bars x WHERE x.deleted_at IS NULL AND x.bar_status = 'OPEN' AND ${s.sql}`).all(s.params)) {
        const left = diffDays(b.deadline, day); const link = `/engg/time-bars?id=${b.id}`;
        if (left < 0) { db.prepare("UPDATE engg_time_bars SET bar_status = 'LAPSED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), b.id); notify(b, 'engg.timebar.alert', [b.owner_user, pmOf(b.org_project_id)], b.bar_no, b.description, `The time limit ended on ${b.deadline}: the notice was not served in time.`, link, 'engg_time_bar', '_lapsed'); event('engg.timebar.lapsed', actor, 'engg_time_bar', b.id, b.company_id, b.org_project_id, { projectId: b.org_project_id, timeBarId: b.id, barNo: b.bar_no, deadline: b.deadline, claimRef: b.claim_ref, servedOn: null }); out.lapsed.push(b.bar_no); continue; }
        const step = steps.find((n) => left <= n); if (step == null || (b.last_alert_days != null && step >= b.last_alert_days)) continue;
        db.prepare('UPDATE engg_time_bars SET last_alert_days = ?, version = version + 1 WHERE id = ?').run(step, b.id); notify(b, 'engg.timebar.alert', [b.owner_user, pmOf(b.org_project_id)], b.bar_no, b.description, `${left} day(s) left to serve the notice (clause ${b.clause_ref ?? 'n/a'}, deadline ${b.deadline}).`, link, 'engg_time_bar', `_${step}d`);
        event('engg.timebar.alert', actor, 'engg_time_bar', b.id, b.company_id, b.org_project_id, { projectId: b.org_project_id, timeBarId: b.id, barNo: b.bar_no, deadline: b.deadline, daysLeft: left, step, claimRef: b.claim_ref, ownerUser: b.owner_user }); out.timeBarAlerts.push({ barNo: b.bar_no, daysLeft: left });
      }
      for (const r of db.prepare(`SELECT x.* FROM engg_letters x WHERE x.deleted_at IS NULL AND x.direction = 'IN' AND x.status = 'REGISTERED' AND x.response_due < :day AND x.overdue_alerted_on IS NULL AND ${UNANSWERED} AND ${s.sql}`).all({ ...s.params, day })) {
        db.prepare('UPDATE engg_letters SET overdue_alerted_on = ?, version = version + 1 WHERE id = ?').run(day, r.id); notify(r, 'engg.letter.overdue', [r.assigned_to, pmOf(r.org_project_id)], r.letter_no, r.subject, `The reply to ${r.party} was due on ${r.response_due}.`, `/engg/letter?id=${r.id}`, 'engg_letter');
        event('engg.letter.response_overdue', actor, 'engg_letter', r.id, r.company_id, r.org_project_id, { projectId: r.org_project_id, letterId: r.id, letterNo: r.letter_no, responseDue: r.response_due, assignedTo: r.assigned_to }); out.replyOverdue.push(r.letter_no);
      }
      return out;
    });
  }
  return { letters, timeBars, letterAlerts: runAlerts, letterDecide: letters.decide };
}

// ---- alert datasets (04.09), workflow, resolver, evidence, files ----------------------------------------------------------------------------------------------
if (!alertDatasets.get('engg.time_bar')) alertDatasets.register({
  code: 'engg.time_bar', label: 'Notices with a time limit (open)', ownerModule: 'engg', entity: 'time_bar',
  fields: [{ key: 'barNo', label: 'Time bar', type: 'text' }, { key: 'daysLeft', label: 'Days left', type: 'number' }, { key: 'clause', label: 'Clause', type: 'text' }, { key: 'project', label: 'Project', type: 'text' }],
  query(db, { companyId }) { const day = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10); return db.prepare("SELECT b.*, p.code FROM engg_time_bars b JOIN org_projects p ON p.id = b.org_project_id WHERE b.company_id = ? AND b.deleted_at IS NULL AND b.bar_status = 'OPEN'").all(companyId).map((b) => ({ id: String(b.id), label: `${b.bar_no}: ${b.description}`, route: `/engg/time-bars?id=${b.id}`, projectId: b.org_project_id, siteId: null, owners: [b.owner_user].filter(Boolean), fields: { barNo: b.bar_no, daysLeft: diffDays(b.deadline, day), clause: b.clause_ref ?? '', project: b.code } })); },
});
const userRoles = (u) => { try { return JSON.parse(u.roles_json ?? '[]'); } catch { return []; } };
/** An outward letter goes to the project manager; a contractual notice goes to the commercial manager. The author never approves. */
if (!workflowResolvers.get('engg.letterApprover')) workflowResolvers.register('engg.letterApprover', ({ db, companyId, instance }) => {
  const l = db.prepare('SELECT org_project_id, contractual FROM engg_letters WHERE id = ?').get(rid(instance.docId)); const me = String(instance.submittedBy ?? '').toLowerCase();
  const withRole = (role) => db.prepare('SELECT username, roles_json FROM iam_users WHERE company_id = ? AND is_active = 1').all(companyId).filter((u) => userRoles(u).includes(role) && u.username.toLowerCase() !== me).map((u) => ({ user: u.username }));
  if (l?.contractual) { const c = withRole('COMMGR'); return c.length ? c : [{ role: 'COMMGR' }]; }
  const x = l ? db.prepare('SELECT pm_user FROM proj_projects WHERE project_id = ? AND deleted_at IS NULL').get(l.org_project_id) : null;
  if (x?.pm_user && x.pm_user.toLowerCase() !== me) return [{ user: x.pm_user }];
  const pms = withRole('PM'); return pms.length ? pms : [{ role: 'PD' }];
});
const lline = (db, id) => db.prepare('SELECT x.*, p.code, p.name AS pname FROM engg_letters x JOIN org_projects p ON p.id = x.org_project_id WHERE x.id = ?').get(id);
workflowTypes.register({
  docType: LETTER_DOC, label: 'Outward letter', processOwner: 'DOC', route: (id) => `/engg/letter?id=${id}`,
  describe(db, companyId, id) { const r = lline(db, rid(id)); return r && r.company_id === companyId ? { ref: r.letter_no ?? `Draft ${r.id}`, title: `${r.code} ${r.subject}`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = lline(db, rid(id)); if (!r) return null; return { fields: [{ label: 'Project', value: `${r.code} ${r.pname}` }, { label: 'To', value: r.party }, { label: 'Subject', value: r.subject }, { label: 'Category', value: LETTER_CATS[r.category] }, { label: 'Clause', value: r.clause_ref ?? '' }, { label: 'Contractual notice', value: r.contractual ? 'Yes: commercial manager approves' : 'No' }, { label: 'Letter', value: String(r.body_text ?? '').slice(0, 600) }], lines: [] }; },
  defaultDefinition: { name: 'Outward letter: the project manager approves (a contractual notice: the commercial manager)', settings: { resubmit: 'first', distinctApprovers: true }, steps: [{ code: 'APPROVE', name: 'Approval of the letter', type: 'approval', mode: 'single', approvers: [{ kind: 'resolver', resolver: 'engg.letterApprover' }], slaHours: 24, requireAttachment: false, checklist: [], when: null, notify: [], action: null }] },
  hooks: { onApproved: (db, { instance, actor }) => enggOf(db)?.letterDecide(instance, actor, 'APPROVED'), onRejected: (db, { instance, actor, comment }) => enggOf(db)?.letterDecide(instance, actor, 'REJECTED', comment), onReturned: (db, { instance, actor, comment }) => enggOf(db)?.letterDecide(instance, actor, 'RETURNED', comment), onCancelled: (db, { instance, actor, comment }) => enggOf(db)?.letterDecide(instance, actor, 'CANCELLED', comment) },
});
evidenceProviders.register(LETTER_DOC, ({ db, instance }) => {
  const r = lline(db, rid(instance.docId)); if (!r) return { sections: [] }; const par = r.parent_letter_id ? db.prepare('SELECT letter_no, their_ref, subject FROM engg_letters WHERE id = ?').get(r.parent_letter_id) : null; const bar = r.time_bar_id ? db.prepare('SELECT bar_no, deadline FROM engg_time_bars WHERE id = ?').get(r.time_bar_id) : null;
  return { sections: [{ code: 'engg-letter', title: 'The letter', kind: 'metrics', items: [{ label: 'To', value: r.party, format: 'text' }, { label: 'Subject', value: r.subject, format: 'text' }, { label: 'Answers', value: par ? `${par.letter_no ?? par.their_ref ?? ''} ${par.subject}` : 'Nothing: a new letter', format: 'text' }, { label: 'Clause', value: r.clause_ref ?? '—', format: 'text' }, { label: 'Serves time bar', value: bar ? `${bar.bar_no}, deadline ${bar.deadline}` : 'No', format: 'text' }, { label: 'Contractual notice', value: r.contractual ? 'Yes' : 'No', format: 'text' }] }] };
});
fileEntities.register({
  entity: 'engg_letter', label: 'Letter',
  resolve(db, actor, id) {
    const r = db.prepare('SELECT * FROM engg_letters WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); const svc = enggOf(db);
    if (!r || !svc || !svc.may(actor, 'engg.letter.view', r.org_project_id) || (r.confidentiality === 'CONFIDENTIAL' && !svc.may(actor, 'engg.letter.view_confidential', r.org_project_id))) return null;
    const editable = (['DRAFT', 'RETURNED', 'REGISTERED'].includes(r.status) && svc.may(actor, 'engg.letter.edit', r.org_project_id)) || (['ISSUED', 'APPROVED'].includes(r.status) && svc.may(actor, 'engg.letter.issue', r.org_project_id));
    return { companyId: r.company_id, projectId: r.org_project_id, siteId: null, canView: true, canEdit: editable, locked: !editable };
  },
});
void badRequest;
