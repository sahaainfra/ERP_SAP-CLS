import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { fileEntities } from '../../platform/files/entities.js';
import { HttpError, badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { parameterRegistry } from '../../platform/parameters/index.js';
import { evidenceProviders, workflowOf, workflowTypes } from '../../platform/workflow/index.js';
import { SECTORS, esc, json, nowIso, rupees, same, toMinor } from './constants.js';
import { crmOf, rid, wfDoc } from './crm.js';
import { createKit } from './kit.js';
import { tendersOf } from './tender.js';

// Prequalification, EMD and tender fee, submission, opening, competitors, negotiation and award (part 08.03). The credentials library (work orders, completion certificates, financials, machinery, key people) is kept once and linked to the tenders it qualifies. The EMD and
// the tender fee of a tender are asked of finance by a chain (estimation, the accounts manager, the CFO), the instrument (bank guarantee, demand draft, online payment) is recorded by accounts and the refund is followed from the result. The final bid goes through a
// checklist and a chain (estimation, then the director); its price equals the approved estimate unless the director approves the difference (BR-01). The prices read out at the opening are ranked by the server; the competitors' history feeds the analysis. The award
// (letter of acceptance) or the loss is approved (the director accepts an award); an award wins the opportunity and tells project set-up (tdr.tender.awarded).
export const CRED_TYPES = { WORK_ORDER: 'Work order', COMPLETION_CERTIFICATE: 'Completion certificate', FINANCIALS: 'Audited financials', MACHINERY: 'Machinery', KEY_PERSON: 'Key person (CV)', REGISTRATION: 'Registration', OTHER: 'Other' };
export const EMD_MODES = { BG: 'Bank guarantee', DD: 'Demand draft', ONLINE: 'Online payment', EXEMPT: 'Exempt' };
export const REFUND = { NOT_APPLICABLE: 'Not refundable', NOT_DUE: 'Not due yet', DUE: 'Refund due', REQUESTED: 'Refund asked for', REFUNDED: 'Refunded', FORFEITED: 'Forfeited', ADJUSTED: 'Adjusted into security' };
const APPROVAL = { DRAFT: 'Draft', SUBMITTED: 'Waiting for approval', APPROVED: 'Approved', RETURNED: 'Returned for correction', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };
export const EMD_DOC = 'TDR_EMD'; export const SUBMISSION_DOC = 'TDR_SUBMISSION'; export const AWARD_DOC = 'TDR_AWARD';
const CHECKLIST = [['TECH_ENVELOPE', 'Technical envelope complete'], ['FIN_ENVELOPE', 'Financial envelope (price bid) complete'], ['SIGNED_DOCS', 'Documents signed and stamped'], ['DSC', 'Uploaded with the digital signature (DSC)'], ['EMD_PROOF', 'EMD and fee proof attached'], ['PQ_DOCS', 'Prequalification documents attached']];
for (const [key, dataType, def, description, extra] of [
  ['tdr.submission_checklist', 'json', CHECKLIST, 'FR-03: the items of the submission checklist, as [code, label]; every item is done before the final bid is sent for approval.', {}],
  ['tdr.emd.refund_followup_days', 'integer', 30, 'BR-02: the days after the result from which an EMD not yet refunded is followed up (and again every as many days).', { min: 1, max: 365 }],
  ['tdr.emd.expiry_warning_days', 'integer', 15, 'FR-02: the days before the validity of a bank guarantee ends that accounts is warned, while the EMD is not refunded.', { min: 1, max: 90 }],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType, default: def, scopes: ['system', 'company'], description, .../** @type {any} */ (extra) });
const days = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const defined = (b) => Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined));
const nameKey = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b(pvt|private|ltd|limited|llp|co|company|the|and)\b/g, ' ').replace(/\s+/g, ' ').trim();
/** T-01: the refund ageing of an EMD: the days since the result, and the bucket. */
export const ageingOf = (resultOn, today) => { if (!resultOn) return { days: null, bucket: null }; const d = Math.max(0, days(resultOn, today)); return { days: d, bucket: d <= 30 ? '0-30' : d <= 60 ? '31-60' : d <= 90 ? '61-90' : '90+' }; };
/** T-01: the ranks of the opening: the qualified bids with a price, lowest first (L1); equal prices share the rank; the difference to L1 in basis points. */
export function rankBids(bids) {
  const priced = bids.filter((b) => b.qualified && b.quoted != null).sort((a, b) => a.quoted - b.quoted);
  const l1 = priced[0]?.quoted ?? null; let rank = 0; let last = null;
  priced.forEach((b, i) => { if (b.quoted !== last) { rank = i + 1; last = b.quoted; } b.rank = rank; b.diffBp = l1 ? Math.round(((b.quoted - l1) / l1) * 10000) : 0; });
  for (const b of bids) if (!b.qualified || b.quoted == null) { b.rank = null; b.diffBp = null; }
  return { l1, bids };
}

export const emdList = defineList({
  code: 'bd.emd', label: 'EMD and tender fees', permission: 'bd.emd.view',
  from: 'tdr_emd e JOIN tdr_tenders t ON t.id = e.tender_id', where: 'e.deleted_at IS NULL', searchable: ['e.doc_no', 't.doc_no', 't.name_of_work', 'e.instrument_no'], defaultSort: '-docNo',
  columns: {
    docNo: { sql: 'e.doc_no', type: 'text', label: 'EMD / fee' }, tender: { sql: 't.doc_no', type: 'text', label: 'Tender' }, nameOfWork: { sql: 't.name_of_work', type: 'text', label: 'Name of work' }, kind: { sql: 'e.kind', type: 'enum', label: 'Kind', options: [['EMD', 'EMD'], ['FEE', 'Tender fee']] },
    mode: { sql: 'e.mode', type: 'enum', label: 'Mode', options: Object.entries(EMD_MODES) }, amount: { sql: '(e.amount_minor / 100.0)', type: 'money', label: 'Amount (₹)' }, validUntil: { sql: 'e.valid_until', type: 'date', label: 'Valid until' },
    status: { sql: 'e.status', type: 'enum', label: 'Request', options: Object.entries(APPROVAL) }, refund: { sql: 'e.refund_status', type: 'enum', label: 'Refund', options: Object.entries(REFUND) },
    ageDays: { sql: "(CASE WHEN e.refund_status IN ('DUE', 'REQUESTED') AND e.result_on IS NOT NULL THEN CAST(julianday(date('now', '+330 minutes')) - julianday(e.result_on) AS INTEGER) END)", type: 'number', label: 'Days since the result' },
  },
});
export const credentialList = defineList({
  code: 'bd.credentials', label: 'Credentials', permission: 'bd.credential.view',
  from: 'tdr_credentials c', where: 'c.deleted_at IS NULL', searchable: ['c.doc_no', 'c.title', 'c.client_name', 'c.tags_json'], defaultSort: '-docNo',
  columns: {
    docNo: { sql: 'c.doc_no', type: 'text', label: 'Credential' }, type: { sql: 'c.cred_type', type: 'enum', label: 'Type', options: Object.entries(CRED_TYPES) }, title: { sql: 'c.title', type: 'text', label: 'Title' }, client: { sql: 'c.client_name', type: 'text', label: 'Client' },
    sector: { sql: 'c.sector', type: 'enum', label: 'Sector', options: Object.entries(SECTORS) }, value: { sql: '(c.value_minor / 100.0)', type: 'money', label: 'Value (₹)' }, completion: { sql: 'c.completion_date', type: 'date', label: 'Completed' }, validUntil: { sql: 'c.valid_until', type: 'date', label: 'Valid until' },
  },
});
export const awardList = defineList({
  code: 'bd.awards', label: 'Awards and losses', permission: 'bd.award.view',
  from: 'tdr_awards a JOIN tdr_tenders t ON t.id = a.tender_id', where: 'a.deleted_at IS NULL', searchable: ['a.doc_no', 't.doc_no', 't.name_of_work', 'a.loa_no'], defaultSort: '-docNo',
  columns: {
    docNo: { sql: 'a.doc_no', type: 'text', label: 'Record' }, tender: { sql: 't.doc_no', type: 'text', label: 'Tender' }, nameOfWork: { sql: 't.name_of_work', type: 'text', label: 'Name of work' }, outcome: { sql: 'a.outcome', type: 'enum', label: 'Outcome', options: [['WON', 'Won'], ['LOST', 'Lost']] },
    loaNo: { sql: 'a.loa_no', type: 'text', label: 'LoA' }, value: { sql: '(a.awarded_value_minor / 100.0)', type: 'money', label: 'Contract value (₹)' }, loaDate: { sql: 'a.loa_date', type: 'date', label: 'LoA date' }, status: { sql: 'a.status', type: 'enum', label: 'Status', options: Object.entries(APPROVAL) },
  },
});

export function createAwardService({ db }) {
  const kit = createKit(db);
  const { may, need, param, today, nextDoc, event, tell } = kit;
  const T = () => tendersOf(db);
  const params = (actor) => ({ c: actor.companyId, u: actor.user, roles: JSON.stringify(actor.roles ?? []) });
  const wfSeen = (actor, docType, id) => Boolean(db.prepare("SELECT 1 FROM wf_tasks w JOIN wf_instances i ON i.id = w.instance_id WHERE i.company_id = ? AND i.doc_type = ? AND (i.doc_id = ? OR i.doc_id LIKE ?) AND w.status IN ('OPEN', 'ADMIN_QUEUE', 'DONE') AND (lower(w.assignee_user_id) = lower(?) OR w.assignee_role IN (SELECT value FROM json_each(?)))").get(actor.companyId, docType, String(id), `${id}-A%`, actor.user, JSON.stringify(actor.roles ?? [])));
  const tenderOf = (id) => db.prepare('SELECT * FROM tdr_tenders WHERE id = ?').get(id);
  /** A child record is seen by whoever sees its tender, by its approvers, and (for an EMD) by accounts and the CFO. */
  const seesChild = (actor, row, docType, viewAll) => row.company_id === actor.companyId && ((viewAll && may(actor, viewAll)) || same(row.created_by, actor.user) || T().seenTender(actor, tenderOf(row.tender_id)) || (docType && wfSeen(actor, docType, row.id)));
  const childScope = (actor, a, docType, viewAll) => (viewAll && may(actor, viewAll)) || may(actor, 'bd.tender.view_all') ? `${a}.company_id = :c AND (1 = 1 OR :u IS NULL OR :roles IS NULL)` : `${a}.company_id = :c AND (lower(${a}.created_by) = lower(:u) OR lower(t.owner) = lower(:u) OR lower(t.created_by) = lower(:u) OR EXISTS (SELECT 1 FROM wf_tasks w JOIN wf_instances i ON i.id = w.instance_id WHERE i.doc_type = '${docType}' AND (i.doc_id = CAST(${a}.id AS TEXT) OR i.doc_id LIKE CAST(${a}.id AS TEXT) || '-A%') AND w.status IN ('OPEN', 'ADMIN_QUEUE', 'DONE') AND (lower(w.assignee_user_id) = lower(:u) OR w.assignee_role IN (SELECT value FROM json_each(:roles)))))`;
  const tenderFor = (actor, id) => T().tenderRow(actor, id);
  const holders = (companyId, roles) => kit.holders(companyId, roles);

  // generic approval-controlled helpers -------------------------------------------------------------------------------------------
  function submitFlow(actor, table, row, docType, ctx, label) {
    if (row.status === 'RETURNED') workflowOf(db).resubmit(actor, row.workflow_instance_id, { comment: 'Corrected', context: ctx });
    else { const inst = workflowOf(db).submit(actor, { docType, docId: wfDoc(row.id, row.amendment_no), amendsDocId: row.amendment_no ? wfDoc(row.id, row.amendment_no - 1) : null, comment: label, context: ctx }); db.prepare(`UPDATE ${table} SET workflow_instance_id = ? WHERE id = ?`).run(inst.id, row.id); }
    db.prepare(`UPDATE ${table} SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(actor.user, actor.user, nowIso(), row.id);
    writeAudit(db, { entity: table, entityId: row.id, action: 'submit', actor: actor.user, companyId: actor.companyId });
  }
  function settle(instance, actor, outcome, comment, table) {
    const r = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(rid(instance.docId));
    if (!r || !['SUBMITTED', 'RETURNED'].includes(r.status)) return null;
    const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN';
    db.prepare(`UPDATE ${table} SET status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(outcome === 'APPROVED' ? 'APPROVED' : outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED', actor.user, nowIso(), r.id);
    if (withdrawn) db.prepare(`UPDATE ${table} SET workflow_instance_id = NULL WHERE id = ?`).run(r.id);
    writeAudit(db, { entity: table, entityId: r.id, action: outcome.toLowerCase(), reason: comment ?? null, actor: actor.user, companyId: r.company_id });
    return r;
  }
  const decisionWord = (outcome) => (outcome === 'APPROVED' ? 'approved' : outcome === 'RETURNED' ? 'returned for correction' : outcome === 'REJECTED' ? 'refused' : 'cancelled');
  const history = (table, r) => ({ approvals: r.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(r.workflow_instance_id) : [], audit: db.prepare('SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = ? AND entity_id = ? ORDER BY id').all(table, String(r.id)) });
  const lostReasons = (companyId) => (param(companyId, 'bd.lost_reasons') ?? []).map(([code, label]) => ({ code, label }));

  // ------------------------------------------------------------------ the credentials library (FR-01)
  const credView = (c) => ({ id: c.id, docNo: c.doc_no, type: c.cred_type, typeLabel: CRED_TYPES[c.cred_type], title: c.title, clientName: c.client_name, clientPartnerId: c.client_partner_id, sector: c.sector, value: rupees(c.value_minor), completionDate: c.completion_date, validUntil: c.valid_until, expired: Boolean(c.valid_until && c.valid_until < today()), tags: json(c.tags_json, []), notes: c.notes, rowVersion: c.version, usedIn: db.prepare('SELECT COUNT(*) AS n FROM tdr_tender_credentials WHERE credential_id = ? AND deleted_at IS NULL').get(c.id).n });
  const credRow = (actor, id) => { const c = db.prepare('SELECT * FROM tdr_credentials WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!c) throw notFound('That credential does not exist.'); return c; };
  const credentials = {
    list(actor, query) { need(actor, 'bd.credential.view', 'see the credentials library'); return runList(db, credentialList, parseListRequest(credentialList, query), { select: 'c.*', scopeSql: 'c.company_id = :c', params: { c: actor.companyId }, tieBreaker: 'c.id', map: credView }); },
    exportSource(actor, req) {
      need(actor, 'bd.credential.view', 'export the credentials library'); const opts = { select: 'c.*', scopeSql: 'c.company_id = :c', params: { c: actor.companyId }, tieBreaker: 'c.id' };
      return { title: credentialList.label, permission: 'bd.credential.view', personal: false, columns: Object.entries(credentialList.columns).map(([key, c]) => ({ key, label: c.label, type: c.type === 'enum' ? 'text' : c.type })), count: () => countList(db, credentialList, req, opts), rows: () => runList(db, credentialList, req, { ...opts, limit: null, map: (c) => { const v = credView(c); return { docNo: v.docNo, type: v.typeLabel, title: v.title, client: v.clientName, sector: v.sector ? SECTORS[v.sector] : '', value: v.value, completion: v.completionDate, validUntil: v.validUntil }; } }).data, describe: (x) => [x.q ? `search "${x.q}"` : ''].filter(Boolean) };
    },
    get(actor, id) { need(actor, 'bd.credential.view', 'see the credentials library'); const c = credRow(actor, id); return { ...credView(c), tenders: db.prepare('SELECT t.id, t.doc_no AS docNo, t.name_of_work AS nameOfWork, tc.purpose FROM tdr_tender_credentials tc JOIN tdr_tenders t ON t.id = tc.tender_id WHERE tc.credential_id = ? AND tc.deleted_at IS NULL ORDER BY t.id DESC').all(c.id) }; },
    create(actor, b) {
      need(actor, 'bd.credential.manage', 'keep the credentials library');
      if (b.clientPartnerId && !db.prepare('SELECT 1 FROM mdm_partners WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(b.clientPartnerId, actor.companyId)) throw badRequest('Some fields are not valid.', [{ field: 'clientPartnerId', message: 'That partner does not exist' }]);
      const no = nextDoc(actor, 'TDR_CREDENTIAL', 'tdr_credentials', 'CRD');
      const id = Number(db.prepare('INSERT INTO tdr_credentials (company_id, doc_no, cred_type, title, client_name, client_partner_id, sector, value_minor, completion_date, valid_until, tags_json, notes, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'tdr_credential\')')
        .run(actor.companyId, no, b.type, b.title.trim(), b.clientName ?? null, b.clientPartnerId ?? null, b.sector ?? null, b.value == null ? null : toMinor(b.value), b.completionDate ?? null, b.validUntil ?? null, JSON.stringify(b.tags ?? []), b.notes ?? null, actor.user).lastInsertRowid);
      writeAudit(db, { entity: 'tdr_credentials', entityId: id, action: 'create', newValues: { docNo: no, type: b.type, title: b.title }, actor: actor.user, companyId: actor.companyId });
      return credentials.get(actor, id);
    },
    update(actor, id, b) {
      need(actor, 'bd.credential.manage', 'keep the credentials library'); const c = credRow(actor, id);
      if (c.version !== b.version) throw conflict('This credential was changed by someone else. Reload it and try again.');
      const m = { type: c.cred_type, title: c.title, clientName: c.client_name, clientPartnerId: c.client_partner_id, sector: c.sector, value: rupees(c.value_minor), completionDate: c.completion_date, validUntil: c.valid_until, tags: json(c.tags_json, []), notes: c.notes, ...defined(b) };
      db.prepare('UPDATE tdr_credentials SET cred_type = ?, title = ?, client_name = ?, client_partner_id = ?, sector = ?, value_minor = ?, completion_date = ?, valid_until = ?, tags_json = ?, notes = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?')
        .run(m.type, m.title.trim(), m.clientName ?? null, m.clientPartnerId ?? null, m.sector ?? null, m.value == null ? null : toMinor(m.value), m.completionDate ?? null, m.validUntil ?? null, JSON.stringify(m.tags ?? []), m.notes ?? null, actor.user, nowIso(), c.id);
      writeAudit(db, { entity: 'tdr_credentials', entityId: c.id, action: 'update', actor: actor.user, companyId: actor.companyId });
      return credentials.get(actor, c.id);
    },
    remove(actor, id) {
      need(actor, 'bd.credential.manage', 'keep the credentials library'); const c = credRow(actor, id);
      db.prepare('UPDATE tdr_credentials SET deleted_at = ?, deleted_by = ?, is_active = 0, version = version + 1 WHERE id = ?').run(nowIso(), actor.user, c.id);
      writeAudit(db, { entity: 'tdr_credentials', entityId: c.id, action: 'delete', actor: actor.user, companyId: actor.companyId });
      return { id: c.id, deleted: true };
    },
    /** The prequalification package of a tender: the credentials it uses. */
    forTender(actor, tenderId) { tenderFor(actor, tenderId); return db.prepare('SELECT tc.id AS linkId, tc.purpose, c.* FROM tdr_tender_credentials tc JOIN tdr_credentials c ON c.id = tc.credential_id WHERE tc.tender_id = ? AND tc.deleted_at IS NULL AND c.deleted_at IS NULL ORDER BY c.cred_type, c.title').all(Number(tenderId)).map((c) => ({ ...credView(c), linkId: c.linkId, purpose: c.purpose })); },
    link(actor, tenderId, { credentialId, purpose }) {
      need(actor, 'bd.tender.manage', 'build the prequalification package'); const t = tenderFor(actor, tenderId); const c = credRow(actor, credentialId);
      if (t.status !== 'APPROVED' || !['OPEN', 'BID', 'READY'].includes(t.stage)) throw unprocessable('The package is built for a registered tender in preparation.');
      if (c.valid_until && c.valid_until < today()) throw unprocessable(`${c.title} expired on ${c.valid_until}; renew it in the library first.`);
      if (db.prepare('SELECT 1 FROM tdr_tender_credentials WHERE tender_id = ? AND credential_id = ? AND deleted_at IS NULL').get(t.id, c.id)) throw conflict('This credential is in the package already.');
      db.prepare('DELETE FROM tdr_tender_credentials WHERE tender_id = ? AND credential_id = ? AND deleted_at IS NOT NULL').run(t.id, c.id);
      db.prepare('INSERT INTO tdr_tender_credentials (company_id, tender_id, credential_id, purpose, created_by, source_type) VALUES (?, ?, ?, ?, ?, \'tdr_tender\')').run(actor.companyId, t.id, c.id, purpose ?? null, actor.user);
      writeAudit(db, { entity: 'tdr_tenders', entityId: t.id, action: 'credential', newValues: { credential: c.doc_no }, actor: actor.user, companyId: actor.companyId });
      return credentials.forTender(actor, t.id);
    },
    unlink(actor, linkId) {
      need(actor, 'bd.tender.manage', 'build the prequalification package');
      const l = db.prepare('SELECT * FROM tdr_tender_credentials WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(linkId), actor.companyId); if (!l) throw notFound('That link does not exist.');
      tenderFor(actor, l.tender_id);
      db.prepare('UPDATE tdr_tender_credentials SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, l.id);
      return credentials.forTender(actor, l.tender_id);
    },
  };

  // ------------------------------------------------------------------ EMD and tender fee (FR-02, BR-02)
  const emdRow = (actor, id) => { const e = db.prepare('SELECT * FROM tdr_emd WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!e || !seesChild(actor, e, EMD_DOC, 'bd.emd.view_all')) throw notFound('That EMD or fee does not exist or is not yours to see.'); return e; };
  const emdView = (actor, e) => {
    const t = tenderOf(e.tender_id); const mine = same(e.created_by, actor.user); const instrument = may(actor, 'bd.emd.instrument'); const age = ['DUE', 'REQUESTED'].includes(e.refund_status) ? ageingOf(e.result_on, today()) : { days: null, bucket: null };
    const warn = Number(param(e.company_id, 'tdr.emd.expiry_warning_days') ?? 15);
    return {
      id: e.id, docNo: e.doc_no, docDate: e.doc_date, tenderId: e.tender_id, tenderNo: t?.doc_no, nameOfWork: t?.name_of_work, tenderStage: t?.stage, kind: e.kind, mode: e.mode, modeLabel: EMD_MODES[e.mode], amount: rupees(e.amount_minor), payee: e.payee, exemptionReason: e.exemption_reason, neededBy: e.needed_by,
      instrumentNo: e.instrument_no ? (instrument || mine ? e.instrument_no : `••••${e.instrument_no.slice(-4)}`) : null, bank: e.bank, issueDate: e.issue_date, validUntil: e.valid_until, issued: Boolean(e.issue_date), status: e.status, statusLabel: APPROVAL[e.status], rowVersion: e.version, amendmentNo: e.amendment_no,
      refundStatus: e.refund_status, refundLabel: REFUND[e.refund_status], resultOn: e.result_on, ageDays: age.days, ageBucket: age.bucket, refundRequestedOn: e.refund_requested_on, refundedOn: e.refunded_on, refundRef: e.refund_ref, refundNote: e.refund_note,
      expiring: Boolean(e.valid_until && !['REFUNDED', 'FORFEITED', 'ADJUSTED', 'NOT_APPLICABLE'].includes(e.refund_status) && days(today(), e.valid_until) <= warn), workflowInstanceId: e.workflow_instance_id, requestedBy: e.requested_by, createdBy: e.created_by,
      can: { edit: ['DRAFT', 'RETURNED'].includes(e.status) && mine && may(actor, 'bd.emd.edit'), submit: ['DRAFT', 'RETURNED'].includes(e.status) && mine && may(actor, 'bd.emd.submit'), delete: e.status === 'DRAFT' && mine && may(actor, 'bd.emd.delete'), withdraw: e.status === 'SUBMITTED' && same(e.requested_by, actor.user), cancel: ['DRAFT', 'SUBMITTED', 'RETURNED'].includes(e.status) && mine && may(actor, 'bd.emd.cancel'), amend: e.status === 'APPROVED' && !e.issue_date && mine && may(actor, 'bd.emd.amend'),
        issue: e.status === 'APPROVED' && !e.issue_date && e.mode !== 'EXEMPT' && instrument, refund: e.kind === 'EMD' && ['DUE', 'REQUESTED'].includes(e.refund_status) && may(actor, 'bd.emd.refund'), print: may(actor, 'bd.emd.print') },
    };
  };
  const expectedOf = (t, kind) => (kind === 'EMD' ? t.emd_minor : t.tender_fee_minor);
  function emdProblems(actor, t, m) {
    const out = []; const expected = expectedOf(t, m.kind);
    if (m.mode === 'EXEMPT') { if (!String(m.exemptionReason ?? '').trim()) out.push({ field: 'exemptionReason', message: 'Say why the tender is exempt (for example: MSME registration under clause 4.2)' }); if (toMinor(m.amount ?? 0) !== 0) out.push({ field: 'amount', message: 'An exemption has no amount' }); }
    else if (toMinor(m.amount ?? rupees(expected)) !== expected) out.push({ field: 'amount', message: `The tender asks for ₹ ${rupees(expected).toLocaleString('en-IN')} as ${m.kind === 'EMD' ? 'EMD' : 'tender fee'}` });
    if (m.kind === 'FEE' && m.mode === 'BG') out.push({ field: 'mode', message: 'A tender fee is paid, not guaranteed: choose a demand draft or an online payment' });
    if (m.neededBy && t.submission_at && m.neededBy > t.submission_at.slice(0, 10)) out.push({ field: 'neededBy', message: `It is needed on or before the submission, ${t.submission_at.slice(0, 10)}` });
    return out;
  }
  const emd = {
    list(actor, query) { need(actor, 'bd.emd.view', 'see EMD and fees'); return runList(db, emdList, parseListRequest(emdList, query), { select: 'e.*', scopeSql: childScope(actor, 'e', EMD_DOC, 'bd.emd.view_all'), params: params(actor), tieBreaker: 'e.id', map: (e) => emdView(actor, e) }); },
    exportSource(actor, req) {
      need(actor, 'bd.emd.export', 'export EMD and fees'); const opts = { select: 'e.*', scopeSql: childScope(actor, 'e', EMD_DOC, 'bd.emd.view_all'), params: params(actor), tieBreaker: 'e.id' };
      return { title: emdList.label, permission: 'bd.emd.export', personal: false, columns: Object.entries(emdList.columns).map(([key, c]) => ({ key, label: c.label, type: c.type === 'enum' ? 'text' : c.type })), count: () => countList(db, emdList, req, opts),
        rows: () => runList(db, emdList, req, { ...opts, limit: null, map: (e) => { const v = emdView(actor, e); return { docNo: v.docNo, tender: v.tenderNo, nameOfWork: v.nameOfWork, kind: v.kind, mode: v.modeLabel, amount: v.amount, validUntil: v.validUntil, status: v.statusLabel, refund: v.refundLabel, ageDays: v.ageDays }; } }).data,
        describe: (x) => [x.q ? `search "${x.q}"` : '', ...x.filters.map((f) => `${emdList.columns[f.key]?.label ?? f.key} ${f.op} ${f.raw}`)].filter(Boolean) };
    },
    get(actor, id) { need(actor, 'bd.emd.view', 'see EMD and fees'); const e = emdRow(actor, id); return { ...emdView(actor, e), history: history('tdr_emd', e) }; },
    forTender(actor, tenderId) { tenderFor(actor, tenderId); return db.prepare('SELECT * FROM tdr_emd WHERE tender_id = ? AND company_id = ? AND deleted_at IS NULL ORDER BY id').all(Number(tenderId), actor.companyId).map((e) => emdView(actor, e)); },
    create(actor, b) {
      need(actor, 'bd.emd.create', 'ask for EMD or fees'); const t = tenderFor(actor, b.tenderId);
      if (t.status !== 'APPROVED' || !['OPEN', 'BID', 'READY'].includes(t.stage)) throw unprocessable('EMD and fees are asked for a registered tender in preparation.');
      if (db.prepare("SELECT 1 FROM tdr_emd WHERE tender_id = ? AND kind = ? AND deleted_at IS NULL AND status NOT IN ('CANCELLED', 'REJECTED')").get(t.id, b.kind)) throw conflict(`The ${b.kind === 'EMD' ? 'EMD' : 'tender fee'} of this tender is asked for already.`);
      const m = { ...b, amount: b.amount ?? (b.mode === 'EXEMPT' ? 0 : rupees(expectedOf(t, b.kind))) }; const problems = emdProblems(actor, t, m); if (problems.length) throw badRequest('Some fields are not valid.', problems);
      return transaction(db, () => {
        const no = nextDoc(actor, EMD_DOC, 'tdr_emd', b.kind === 'EMD' ? 'EMD' : 'FEE');
        const id = Number(db.prepare("INSERT INTO tdr_emd (company_id, doc_no, doc_date, tender_id, kind, mode, amount_minor, payee, exemption_reason, needed_by, status, refund_status, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, 'tdr_tender', ?)")
          .run(actor.companyId, no, today(), t.id, b.kind, b.mode, toMinor(m.amount), b.payee ?? null, b.exemptionReason ?? null, b.neededBy ?? null, b.kind === 'FEE' || b.mode === 'EXEMPT' ? 'NOT_APPLICABLE' : 'NOT_DUE', actor.user, String(t.id)).lastInsertRowid);
        writeAudit(db, { entity: 'tdr_emd', entityId: id, action: 'create', newValues: { docNo: no, tender: t.doc_no, kind: b.kind, amount: m.amount }, actor: actor.user, companyId: actor.companyId });
        return b.submit ? emd.submit(actor, id) : emd.get(actor, id);
      });
    },
    update(actor, id, b) {
      const e = emdRow(actor, id); need(actor, 'bd.emd.edit', 'change EMD requests');
      if (!['DRAFT', 'RETURNED'].includes(e.status)) throw conflict('An approved request is amended, not changed.');
      if (!same(e.created_by, actor.user)) throw forbidden(`Only ${e.created_by} changes this request.`);
      if (e.version !== b.version) throw conflict('This request was changed by someone else. Reload it and try again.');
      return saveEmd(actor, e, b, 'update');
    },
    remove(actor, id) {
      const e = emdRow(actor, id); need(actor, 'bd.emd.delete', 'delete EMD requests');
      if (e.status !== 'DRAFT') throw new HttpError(409, 'LOCKED', 'Only a draft is deleted; cancel the others.');
      if (!same(e.created_by, actor.user)) throw forbidden(`Only ${e.created_by} deletes this draft.`);
      db.prepare('UPDATE tdr_emd SET deleted_at = ?, deleted_by = ?, is_active = 0, version = version + 1 WHERE id = ?').run(nowIso(), actor.user, e.id);
      writeAudit(db, { entity: 'tdr_emd', entityId: e.id, action: 'delete', actor: actor.user, companyId: actor.companyId });
      return { id: e.id, deleted: true };
    },
    submit(actor, id) {
      const e = emdRow(actor, id); need(actor, 'bd.emd.submit', 'send EMD requests');
      if (!['DRAFT', 'RETURNED'].includes(e.status)) throw conflict(`This request is ${APPROVAL[e.status].toLowerCase()}.`);
      if (!same(e.created_by, actor.user)) throw forbidden(`Only ${e.created_by} sends this request.`);
      const t = tenderOf(e.tender_id); const problems = emdProblems(actor, t, { kind: e.kind, mode: e.mode, amount: rupees(e.amount_minor), exemptionReason: e.exemption_reason, neededBy: e.needed_by }); if (problems.length) throw badRequest('The request cannot be sent yet.', problems);
      return transaction(db, () => { submitFlow(actor, 'tdr_emd', e, EMD_DOC, { valueMinor: e.amount_minor, kind: e.kind, mode: e.mode }, `${e.kind === 'EMD' ? 'EMD' : 'Tender fee'} by ${EMD_MODES[e.mode].toLowerCase()}`); return emd.get(actor, e.id); });
    },
    withdraw(actor, id, { reason }) { const e = emdRow(actor, id); if (e.status !== 'SUBMITTED') throw unprocessable('Only a request in approval is withdrawn.'); if (!same(e.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, e.workflow_instance_id, { comment: reason }); return emd.get(actor, id); },
    cancel(actor, id, { reason }) {
      const e = emdRow(actor, id); need(actor, 'bd.emd.cancel', 'cancel EMD requests');
      if (!emdView(actor, e).can.cancel) throw unprocessable('Only a request not yet approved is cancelled by its maker; an issued instrument is refunded or forfeited.');
      return transaction(db, () => { if (e.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, e.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare("UPDATE tdr_emd SET status = 'CANCELLED', remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), e.id); writeAudit(db, { entity: 'tdr_emd', entityId: e.id, action: 'cancel', reason, actor: actor.user, companyId: actor.companyId }); return emd.get(actor, e.id); });
    },
    amend(actor, id, b) {
      const e = emdRow(actor, id); need(actor, 'bd.emd.amend', 'amend EMD requests');
      if (!emdView(actor, e).can.amend) throw unprocessable('Only an approved request whose instrument is not yet issued is amended.');
      if (e.version !== b.version) throw conflict('This request was changed by someone else. Reload it and try again.');
      return transaction(db, () => {
        db.prepare("UPDATE tdr_emd SET status = 'DRAFT', amendment_no = amendment_no + 1, workflow_instance_id = NULL, requested_by = NULL, remarks = ? WHERE id = ?").run(`Amended: ${b.reason}`, e.id);
        writeAudit(db, { entity: 'tdr_emd', entityId: e.id, action: 'amend', reason: b.reason, oldValues: { mode: e.mode, amount: rupees(e.amount_minor) }, actor: actor.user, companyId: actor.companyId });
        const { reason, ...fields } = b; void reason;
        return saveEmd(actor, db.prepare('SELECT * FROM tdr_emd WHERE id = ?').get(e.id), { ...fields, version: undefined }, 'amend');
      });
    },
    /** Accounts records the instrument it obtained (the bank guarantee, the demand draft or the payment). */
    issue(actor, id, b) {
      const e = emdRow(actor, id); need(actor, 'bd.emd.instrument', 'record EMD instruments');
      if (!emdView(actor, e).can.issue) throw unprocessable(e.issue_date ? 'The instrument is recorded already.' : 'The request must be approved first.');
      const t = tenderOf(e.tender_id); const problems = [];
      if (!b.instrumentNo) problems.push({ field: 'instrumentNo', message: e.mode === 'ONLINE' ? 'Give the payment reference (UTR)' : 'Give the number of the instrument' });
      if (['BG', 'DD'].includes(e.mode) && !b.bank) problems.push({ field: 'bank', message: 'Name the bank' });
      if (b.issueDate > today()) problems.push({ field: 'issueDate', message: 'The instrument is recorded after it is issued' });
      if (e.mode === 'BG' && (!b.validUntil || (t.opening_at && b.validUntil < t.opening_at.slice(0, 10)))) problems.push({ field: 'validUntil', message: `A bank guarantee is valid at least until the opening, ${t.opening_at?.slice(0, 10) ?? 'and beyond'}` });
      if (problems.length) throw badRequest('Some fields are not valid.', problems);
      db.prepare('UPDATE tdr_emd SET instrument_no = ?, bank = ?, issue_date = ?, valid_until = ?, issued_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.instrumentNo.trim(), b.bank ?? null, b.issueDate, b.validUntil ?? null, actor.user, actor.user, nowIso(), e.id);
      writeAudit(db, { entity: 'tdr_emd', entityId: e.id, action: 'issue', newValues: { mode: e.mode, bank: b.bank ?? null, validUntil: b.validUntil ?? null }, actor: actor.user, companyId: actor.companyId });
      event('bd.emd.issued', actor, 'tdr_emd', e.id, e.company_id, { emdId: e.id, docNo: e.doc_no, tenderId: e.tender_id, kind: e.kind, mode: e.mode, amount: rupees(e.amount_minor), validUntil: b.validUntil ?? null });
      return emd.get(actor, e.id);
    },
    /** BR-02: the refund after the result: asked for, received, forfeited or adjusted into the security of the contract. */
    refund(actor, id, b) {
      const e = emdRow(actor, id); need(actor, 'bd.emd.refund', 'follow EMD refunds');
      if (!emdView(actor, e).can.refund) throw unprocessable(e.refund_status === 'NOT_DUE' ? 'The refund is due once the result of the tender is recorded.' : 'This EMD is not waiting for a refund.');
      const problems = [];
      if (b.action === 'REFUNDED' && !b.reference) problems.push({ field: 'reference', message: 'Give the reference of the refund (the returned guarantee or the credit)' });
      if (['FORFEITED', 'ADJUSTED'].includes(b.action) && String(b.note ?? '').trim().length < 5) problems.push({ field: 'note', message: 'Say why (at least 5 characters)' });
      if (b.action === 'REQUESTED' && e.refund_status === 'REQUESTED') problems.push({ field: 'action', message: 'The refund was asked for already' });
      if (b.date && b.date < (e.result_on ?? b.date)) problems.push({ field: 'date', message: 'Not before the result' });
      if (problems.length) throw badRequest('Some fields are not valid.', problems);
      const on = b.date ?? today();
      if (b.action === 'REQUESTED') db.prepare("UPDATE tdr_emd SET refund_status = 'REQUESTED', refund_requested_on = ?, refund_note = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(on, b.note ?? null, actor.user, nowIso(), e.id);
      else db.prepare('UPDATE tdr_emd SET refund_status = ?, refunded_on = ?, refund_ref = ?, refund_note = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.action, on, b.reference ?? null, b.note ?? null, actor.user, nowIso(), e.id);
      writeAudit(db, { entity: 'tdr_emd', entityId: e.id, action: `refund_${b.action.toLowerCase()}`, reason: b.note ?? null, actor: actor.user, companyId: actor.companyId });
      event('bd.emd.refund_changed', actor, 'tdr_emd', e.id, e.company_id, { emdId: e.id, docNo: e.doc_no, tenderId: e.tender_id, status: b.action, on, amount: rupees(e.amount_minor) });
      return emd.get(actor, e.id);
    },
    print(actor, id) {
      need(actor, 'bd.emd.print', 'print EMD requests'); const v = emd.get(actor, id); writeAudit(db, { entity: 'tdr_emd', entityId: v.id, action: 'print', actor: actor.user, companyId: actor.companyId });
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(v.docNo)}</title><style>body{font:14px sans-serif;margin:24px}td,th{border:1px solid #888;padding:6px;text-align:left}table{border-collapse:collapse;width:100%}</style></head><body><h1>${v.kind === 'EMD' ? 'EMD' : 'Tender fee'} ${esc(v.docNo)}</h1><p>${esc(v.tenderNo)} · ${esc(v.nameOfWork)} · ${esc(v.statusLabel)}</p><table><tr><th>Mode</th><td>${esc(v.modeLabel)}</td><th>Amount</th><td>₹ ${esc(Number(v.amount).toLocaleString('en-IN'))}</td></tr><tr><th>Payee</th><td>${esc(v.payee ?? '')}</td><th>Needed by</th><td>${esc(v.neededBy ?? '')}</td></tr><tr><th>Instrument</th><td>${esc(v.instrumentNo ?? '')} ${esc(v.bank ?? '')}</td><th>Valid until</th><td>${esc(v.validUntil ?? '')}</td></tr><tr><th>Refund</th><td colspan="3">${esc(v.refundLabel)} ${esc(v.refundedOn ?? '')} ${esc(v.refundRef ?? '')}</td></tr></table></body></html>`;
    },
  };
  function saveEmd(actor, e, b, action) {
    const t = tenderOf(e.tender_id); const m = { kind: e.kind, mode: e.mode, amount: rupees(e.amount_minor), payee: e.payee, exemptionReason: e.exemption_reason, neededBy: e.needed_by, ...defined(b) }; delete m.version;
    if (b.mode && b.amount === undefined) m.amount = m.mode === 'EXEMPT' ? 0 : rupees(expectedOf(t, m.kind));
    const problems = emdProblems(actor, t, m); if (problems.length) throw badRequest('Some fields are not valid.', problems);
    db.prepare('UPDATE tdr_emd SET mode = ?, amount_minor = ?, payee = ?, exemption_reason = ?, needed_by = ?, refund_status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(m.mode, toMinor(m.amount), m.payee ?? null, m.exemptionReason ?? null, m.neededBy ?? null, m.kind === 'FEE' || m.mode === 'EXEMPT' ? 'NOT_APPLICABLE' : 'NOT_DUE', actor.user, nowIso(), e.id);
    writeAudit(db, { entity: 'tdr_emd', entityId: e.id, action, oldValues: { mode: e.mode }, newValues: { mode: m.mode }, actor: actor.user, companyId: actor.companyId });
    return emd.get(actor, e.id);
  }

  // ------------------------------------------------------------------ the submission (FR-03, BR-01)
  const subRow = (actor, id) => { const s = db.prepare('SELECT * FROM tdr_submissions WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!s || !seesChild(actor, s, SUBMISSION_DOC, null)) throw notFound('That submission does not exist or is not yours to see.'); return s; };
  /** What the security of the bid needs: the EMD and the fee the tender asks for, approved and with their instrument (or an approved exemption). */
  const securityOf = (t) => {
    const out = [];
    for (const [kind, need2] of [['EMD', t.emd_minor > 0], ['FEE', t.tender_fee_minor > 0]]) {
      if (!need2) continue;
      const e = db.prepare("SELECT * FROM tdr_emd WHERE tender_id = ? AND kind = ? AND deleted_at IS NULL AND status = 'APPROVED' ORDER BY id DESC LIMIT 1").get(t.id, kind);
      out.push({ kind, ok: Boolean(e && (e.mode === 'EXEMPT' || e.issue_date)), text: !e ? `The ${kind === 'EMD' ? 'EMD' : 'tender fee'} is not approved` : e.mode === 'EXEMPT' ? `${kind === 'EMD' ? 'EMD' : 'Tender fee'} exempt` : e.issue_date ? `${kind === 'EMD' ? 'EMD' : 'Tender fee'} ${EMD_MODES[e.mode].toLowerCase()} ${e.instrument_no ? `••••${e.instrument_no.slice(-4)}` : ''}` : `The instrument of the ${kind === 'EMD' ? 'EMD' : 'tender fee'} is not recorded yet` });
    }
    return out;
  };
  const subView = (actor, s) => {
    const t = tenderOf(s.tender_id); const items = json(s.checklist_json, []); const mine = same(s.created_by, actor.user); const sec = securityOf(t);
    const adjustment = s.bid_amount_minor != null && s.estimate_minor != null ? s.bid_amount_minor - s.estimate_minor : null;
    return {
      id: s.id, docNo: s.doc_no, tenderId: s.tender_id, tenderNo: t.doc_no, nameOfWork: t.name_of_work, tenderStage: t.stage, submissionAt: t.submission_at, status: s.status, statusLabel: APPROVAL[s.status], rowVersion: s.version, amendmentNo: s.amendment_no, items, done: items.filter((i) => i.done).length, complete: items.length > 0 && items.every((i) => i.done),
      estimate: rupees(s.estimate_minor), estimateSource: s.estimate_source, estimateRef: s.estimate_ref, bidAmount: rupees(s.bid_amount_minor), adjustment: rupees(adjustment), adjustmentPct: adjustment != null && s.estimate_minor ? Math.round((adjustment / s.estimate_minor) * 10000) / 100 : null, adjustmentReason: s.adjustment_reason, security: sec,
      submittedAt: s.submitted_at, submittedBy: s.submitted_by, portalRef: s.portal_ref, workflowInstanceId: s.workflow_instance_id, requestedBy: s.requested_by, createdBy: s.created_by, credentials: credentials.forTender(actor, t.id).length,
      can: { edit: ['DRAFT', 'RETURNED'].includes(s.status) && mine && may(actor, 'bd.submission.manage'), submit: ['DRAFT', 'RETURNED'].includes(s.status) && mine && may(actor, 'bd.submission.manage'), withdraw: s.status === 'SUBMITTED' && same(s.requested_by, actor.user), record: s.status === 'APPROVED' && !s.submitted_at && t.stage === 'READY' && may(actor, 'bd.submission.manage'), amend: s.status === 'APPROVED' && !s.submitted_at && mine && may(actor, 'bd.submission.manage') },
    };
  };
  function subProblems(actor, s, t, { forSubmit = false } = {}) {
    const out = [];
    if (s.bid_amount_minor != null && s.estimate_minor != null && s.bid_amount_minor !== s.estimate_minor && String(s.adjustment_reason ?? '').trim().length < 10) out.push({ field: 'adjustmentReason', message: 'The bid differs from the approved estimate: say why (at least 10 characters); the director approves the difference (BR-01)' });
    if (forSubmit) {
      if (t.stage !== 'READY') out.push({ field: 'tender', message: 'The tender must be ready for submission (decision, eligibility, addenda)' });
      if (s.estimate_minor == null) out.push({ field: 'estimate', message: 'Give the price of the approved estimate' });
      if (s.bid_amount_minor == null) out.push({ field: 'bidAmount', message: 'Give the final bid amount' });
      const items = json(s.checklist_json, []); const open = items.filter((i) => !i.done);
      if (open.length) out.push({ field: 'items', message: `The checklist is not complete: ${open.map((i) => i.label).join(', ')}` });
      for (const x of securityOf(t)) if (!x.ok) out.push({ field: 'security', message: x.text });
    }
    return out;
  }
  const submissions = {
    forTender(actor, tenderId) { const t = tenderFor(actor, tenderId); const s = db.prepare("SELECT * FROM tdr_submissions WHERE tender_id = ? AND deleted_at IS NULL AND status NOT IN ('CANCELLED', 'REJECTED') ORDER BY id DESC LIMIT 1").get(t.id); return s ? submissions.get(actor, s.id) : null; },
    get(actor, id) { need(actor, 'bd.submission.view', 'see submissions'); const s = subRow(actor, id); return { ...subView(actor, s), history: history('tdr_submissions', s), package: credentials.forTender(actor, s.tender_id) }; },
    create(actor, b) {
      need(actor, 'bd.submission.manage', 'prepare submissions'); const t = tenderFor(actor, b.tenderId);
      if (t.status !== 'APPROVED' || !['BID', 'READY'].includes(t.stage)) throw unprocessable('A submission is prepared for a tender with an approved decision to bid.');
      if (db.prepare("SELECT 1 FROM tdr_submissions WHERE tender_id = ? AND deleted_at IS NULL AND status NOT IN ('CANCELLED', 'REJECTED')").get(t.id)) throw conflict('The submission of this tender is prepared already.');
      const list = param(actor.companyId, 'tdr.submission_checklist'); const items = (Array.isArray(list) ? list : CHECKLIST).map(([code, label]) => ({ code, label, done: false, note: null, by: null, at: null }));
      const no = nextDoc(actor, SUBMISSION_DOC, 'tdr_submissions', 'SUB');
      const id = Number(db.prepare("INSERT INTO tdr_submissions (company_id, doc_no, doc_date, tender_id, checklist_json, estimate_minor, estimate_source, estimate_ref, bid_amount_minor, status, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, 'MANUAL', ?, ?, 'DRAFT', ?, 'tdr_tender', ?)")
        .run(actor.companyId, no, today(), t.id, JSON.stringify(items), b.estimate == null ? null : toMinor(b.estimate), b.estimateRef ?? null, b.bidAmount == null ? null : toMinor(b.bidAmount), actor.user, String(t.id)).lastInsertRowid);
      writeAudit(db, { entity: 'tdr_submissions', entityId: id, action: 'create', newValues: { docNo: no, tender: t.doc_no }, actor: actor.user, companyId: actor.companyId });
      return submissions.get(actor, id);
    },
    update(actor, id, b) {
      const s = subRow(actor, id); need(actor, 'bd.submission.manage', 'prepare submissions');
      if (!['DRAFT', 'RETURNED'].includes(s.status)) throw conflict('An approved submission is amended, not changed.');
      if (!same(s.created_by, actor.user)) throw forbidden(`Only ${s.created_by} changes this submission.`);
      if (s.version !== b.version) throw conflict('This submission was changed by someone else. Reload it and try again.');
      const items = json(s.checklist_json, []);
      for (const x of b.items ?? []) { const i = items.find((y) => y.code === x.code); if (!i) throw badRequest('Some fields are not valid.', [{ field: 'items', message: `${x.code} is not an item of the checklist` }]); if (x.done !== i.done) { i.done = x.done; i.by = x.done ? actor.user : null; i.at = x.done ? nowIso() : null; } if (x.note !== undefined) i.note = x.note; }
      const m = { ...s, checklist_json: JSON.stringify(items), estimate_minor: b.estimate === undefined ? s.estimate_minor : b.estimate === null ? null : toMinor(b.estimate), estimate_ref: b.estimateRef === undefined ? s.estimate_ref : b.estimateRef, bid_amount_minor: b.bidAmount === undefined ? s.bid_amount_minor : b.bidAmount === null ? null : toMinor(b.bidAmount), adjustment_reason: b.adjustmentReason === undefined ? s.adjustment_reason : b.adjustmentReason };
      const problems = subProblems(actor, m, tenderOf(s.tender_id)); if (problems.length) throw badRequest('Some fields are not valid.', problems);
      const adj = m.bid_amount_minor != null && m.estimate_minor != null ? m.bid_amount_minor - m.estimate_minor : 0;
      db.prepare('UPDATE tdr_submissions SET checklist_json = ?, estimate_minor = ?, estimate_ref = ?, bid_amount_minor = ?, adjustment_minor = ?, adjustment_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(m.checklist_json, m.estimate_minor, m.estimate_ref ?? null, m.bid_amount_minor, adj, m.adjustment_reason ?? null, actor.user, nowIso(), s.id);
      writeAudit(db, { entity: 'tdr_submissions', entityId: s.id, action: 'update', oldValues: { bidAmount: rupees(s.bid_amount_minor) }, newValues: { bidAmount: rupees(m.bid_amount_minor), done: items.filter((i) => i.done).length }, actor: actor.user, companyId: actor.companyId });
      return submissions.get(actor, s.id);
    },
    /** The final bid: a colleague of the estimation team, then the director (who approves any difference from the estimate, BR-01). */
    submit(actor, id) {
      const s = subRow(actor, id); need(actor, 'bd.submission.manage', 'send submissions');
      if (!['DRAFT', 'RETURNED'].includes(s.status)) throw conflict(`This submission is ${APPROVAL[s.status].toLowerCase()}.`);
      if (!same(s.created_by, actor.user)) throw forbidden(`Only ${s.created_by} sends this submission.`);
      const problems = subProblems(actor, s, tenderOf(s.tender_id), { forSubmit: true }); if (problems.length) throw badRequest('The bid cannot be sent for approval yet.', problems);
      return transaction(db, () => { submitFlow(actor, 'tdr_submissions', s, SUBMISSION_DOC, { valueMinor: s.bid_amount_minor, adjustmentMinor: s.bid_amount_minor - s.estimate_minor }, 'Final bid'); return submissions.get(actor, s.id); });
    },
    withdraw(actor, id, { reason }) { const s = subRow(actor, id); if (s.status !== 'SUBMITTED') throw unprocessable('Only a submission in approval is withdrawn.'); if (!same(s.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, s.workflow_instance_id, { comment: reason }); return submissions.get(actor, id); },
    amend(actor, id, { reason, version }) {
      const s = subRow(actor, id); if (!subView(actor, s).can.amend) throw unprocessable('Only an approved bid not yet submitted on the portal is amended.');
      if (s.version !== version) throw conflict('This submission was changed by someone else. Reload it and try again.');
      db.prepare("UPDATE tdr_submissions SET status = 'DRAFT', amendment_no = amendment_no + 1, workflow_instance_id = NULL, requested_by = NULL, remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(`Amended: ${reason}`, actor.user, nowIso(), s.id);
      writeAudit(db, { entity: 'tdr_submissions', entityId: s.id, action: 'amend', reason, actor: actor.user, companyId: actor.companyId });
      return submissions.get(actor, s.id);
    },
    /** The bid was uploaded on the portal: the register is told (the tender is submitted). */
    record(actor, id, b) {
      const s = subRow(actor, id); need(actor, 'bd.submission.manage', 'record submissions');
      if (!subView(actor, s).can.record) throw unprocessable(s.status !== 'APPROVED' ? 'The final bid must be approved first.' : 'This bid is recorded already, or the tender is not ready.');
      const t = tenderOf(s.tender_id);
      if (t.submission_at && b.submittedAt > t.submission_at) throw badRequest('Some fields are not valid.', [{ field: 'submittedAt', message: `The deadline was ${t.submission_at.replace('T', ' ')}` }]);
      return transaction(db, () => {
        db.prepare('UPDATE tdr_submissions SET submitted_at = ?, submitted_by = ?, portal_ref = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.submittedAt, actor.user, b.portalRef.trim(), actor.user, nowIso(), s.id);
        T().tenders.markSubmitted(actor, t.id, { submittedOn: b.submittedAt.slice(0, 10) });
        writeAudit(db, { entity: 'tdr_submissions', entityId: s.id, action: 'record', newValues: { submittedAt: b.submittedAt, portalRef: b.portalRef }, actor: actor.user, companyId: actor.companyId });
        return submissions.get(actor, s.id);
      });
    },
  };

  // ------------------------------------------------------------------ opening results and competitors (FR-04, FR-05)
  const competitorOf = (companyId, name, partnerId, user) => {
    const key = nameKey(name) || name.toLowerCase();
    const c = db.prepare('SELECT * FROM tdr_competitors WHERE company_id = ? AND name_key = ?').get(companyId, key); if (c) return c.id;
    return Number(db.prepare("INSERT INTO tdr_competitors (company_id, name, name_key, partner_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, 'tdr_bid_result')").run(companyId, name.trim(), key, partnerId ?? null, user).lastInsertRowid);
  };
  const resultsOf = (tenderId) => db.prepare('SELECT * FROM tdr_bid_results WHERE tender_id = ? AND deleted_at IS NULL ORDER BY bid_rank IS NULL, bid_rank, quoted_minor, id').all(tenderId).map((r) => ({ id: r.id, bidder: r.bidder_name, competitorId: r.competitor_id, partnerId: r.bidder_partner_id, isUs: Boolean(r.is_us), qualified: Boolean(r.qualified), quoted: rupees(r.quoted_minor), rank: r.bid_rank, label: r.bid_rank ? `L${r.bid_rank}` : null, diffPct: r.diff_l1_bp == null ? null : r.diff_l1_bp / 100, openedOn: r.opened_on, note: r.note }));
  const results = {
    get(actor, tenderId) {
      need(actor, 'bd.award.view', 'see opening results'); const t = tenderFor(actor, tenderId); const rows = resultsOf(t.id); const us = rows.find((r) => r.isUs);
      return { tenderId: t.id, tenderNo: t.doc_no, stage: t.stage, rows, ourRank: us?.rank ?? null, l1: rows.find((r) => r.rank === 1)?.quoted ?? null, ourDiffPct: us?.diffPct ?? null, canEdit: may(actor, 'bd.result.manage') && ['SUBMITTED'].includes(t.stage) };
    },
    /** T-01: the whole opening is entered at once; the server ranks it. */
    save(actor, tenderId, b) {
      need(actor, 'bd.result.manage', 'enter opening results'); const t = tenderFor(actor, tenderId);
      if (t.stage !== 'SUBMITTED') throw unprocessable('The opening results are entered for a submitted tender before its award or loss is recorded.');
      const problems = [];
      if (b.bidders.filter((x) => x.isUs).length !== 1) problems.push({ field: 'bidders', message: 'Mark exactly one line as our bid' });
      const keys = b.bidders.map((x) => nameKey(x.name) || x.name.toLowerCase()); if (new Set(keys).size !== keys.length) problems.push({ field: 'bidders', message: 'A bidder is listed twice' });
      b.bidders.forEach((x, i) => { if (x.qualified && x.quoted == null) problems.push({ field: `bidders.${i}.quoted`, message: `Give the price of ${x.name}` }); });
      if (b.openedOn > today()) problems.push({ field: 'openedOn', message: 'The opening is recorded after it happens' });
      if (problems.length) throw badRequest('Some fields are not valid.', problems);
      const ranked = rankBids(b.bidders.map((x) => ({ ...x, quoted: x.quoted == null ? null : toMinor(x.quoted) }))).bids;
      return transaction(db, () => {
        db.prepare('DELETE FROM tdr_bid_results WHERE tender_id = ?').run(t.id);
        for (const x of ranked) {
          const comp = x.isUs ? null : competitorOf(actor.companyId, x.name, x.partnerId, actor.user);
          db.prepare("INSERT INTO tdr_bid_results (company_id, tender_id, competitor_id, bidder_partner_id, bidder_name, is_us, qualified, quoted_minor, bid_rank, diff_l1_bp, opened_on, note, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'tdr_tender')")
            .run(actor.companyId, t.id, comp, x.partnerId ?? null, x.name.trim(), x.isUs ? 1 : 0, x.qualified ? 1 : 0, x.quoted, x.rank, x.diffBp, b.openedOn, x.note ?? null, actor.user);
        }
        const us = ranked.find((x) => x.isUs);
        writeAudit(db, { entity: 'tdr_tenders', entityId: t.id, action: 'opening', newValues: { bidders: ranked.length, ourRank: us.rank }, actor: actor.user, companyId: actor.companyId });
        event('bd.tender.opened', actor, 'tdr_tender', t.id, t.company_id, { tenderId: t.id, docNo: t.doc_no, openedOn: b.openedOn, bidders: ranked.length, ourRank: us.rank, ourQuoted: rupees(us.quoted), l1: rupees(ranked.find((x) => x.rank === 1)?.quoted ?? null) });
        return results.get(actor, t.id);
      });
    },
  };
  /** FR-05: what the history of the openings says, by competitor, sector, region or month. */
  function analysis(actor, f = {}) {
    need(actor, 'bd.competitor.view', 'see the competitor analysis');
    const where = ['r.company_id = :c', 'r.deleted_at IS NULL']; const p = { c: actor.companyId };
    if (f.sector) { where.push('o.sector = :sector'); p.sector = f.sector; } if (f.region) { where.push('t.region = :region'); p.region = f.region; }
    if (f.from) { where.push('r.opened_on >= :from'); p.from = f.from; } if (f.to) { where.push('r.opened_on <= :to'); p.to = f.to; }
    const base = `FROM tdr_bid_results r JOIN tdr_tenders t ON t.id = r.tender_id LEFT JOIN bd_opportunities o ON o.id = t.opportunity_id WHERE ${where.join(' AND ')}`;
    const us = `(SELECT u.quoted_minor FROM tdr_bid_results u WHERE u.tender_id = r.tender_id AND u.is_us = 1 AND u.deleted_at IS NULL)`;
    const baseC = `FROM tdr_bid_results r JOIN tdr_competitors c ON c.id = r.competitor_id JOIN tdr_tenders t ON t.id = r.tender_id LEFT JOIN bd_opportunities o ON o.id = t.opportunity_id WHERE ${where.join(' AND ')}`;
    const competitors = db.prepare(`SELECT r.competitor_id AS id, c.name, COUNT(*) AS bids, SUM(r.bid_rank = 1) AS l1, AVG(r.diff_l1_bp) AS avgDiff, AVG(CASE WHEN ${us} > 0 AND r.quoted_minor IS NOT NULL THEN (r.quoted_minor - ${us}) * 10000.0 / ${us} END) AS vsUs, GROUP_CONCAT(DISTINCT COALESCE(o.sector, 'OTHER')) AS sectors ${baseC} AND r.is_us = 0 GROUP BY r.competitor_id ORDER BY bids DESC, l1 DESC`).all(p)
      .map((x) => ({ id: x.id, name: x.name, bids: x.bids, l1: x.l1 ?? 0, winRate: x.bids ? Math.round(((x.l1 ?? 0) / x.bids) * 100) : 0, avgDiffPct: x.avgDiff == null ? null : Math.round(x.avgDiff) / 100, vsUsPct: x.vsUs == null ? null : Math.round(x.vsUs) / 100, sectors: String(x.sectors ?? '').split(',').filter(Boolean) }));
    const group = (expr) => db.prepare(`SELECT ${expr} AS k, COUNT(DISTINCT r.tender_id) AS tenders, SUM(r.is_us = 1 AND r.bid_rank = 1) AS ourL1, AVG(CASE WHEN r.is_us = 1 THEN r.diff_l1_bp END) AS ourDiff, COUNT(CASE WHEN r.is_us = 0 THEN 1 END) * 1.0 / COUNT(DISTINCT r.tender_id) AS rivals ${base} GROUP BY k ORDER BY k`).all(p)
      .map((x) => ({ key: x.k, tenders: x.tenders, ourL1: x.ourL1 ?? 0, ourWinRate: x.tenders ? Math.round(((x.ourL1 ?? 0) / x.tenders) * 100) : 0, ourAvgDiffPct: x.ourDiff == null ? null : Math.round(x.ourDiff) / 100, avgRivals: Math.round((x.rivals ?? 0) * 10) / 10 }));
    return { filters: { sector: f.sector ?? null, region: f.region ?? null, from: f.from ?? null, to: f.to ?? null }, competitors, bySector: group("COALESCE(o.sector, 'OTHER')").map((x) => ({ ...x, label: SECTORS[x.key] ?? x.key })), byRegion: group("COALESCE(t.region, 'UNSET')"), byMonth: group('substr(r.opened_on, 1, 7)') };
  }
  function competitor(actor, id) {
    need(actor, 'bd.competitor.view', 'see competitors');
    const c = db.prepare('SELECT * FROM tdr_competitors WHERE id = ? AND company_id = ?').get(Number(id), actor.companyId); if (!c) throw notFound('That competitor does not exist.');
    const bids = db.prepare("SELECT r.*, t.doc_no, t.name_of_work, t.region, (SELECT u.quoted_minor FROM tdr_bid_results u WHERE u.tender_id = r.tender_id AND u.is_us = 1 AND u.deleted_at IS NULL) AS us FROM tdr_bid_results r JOIN tdr_tenders t ON t.id = r.tender_id WHERE r.competitor_id = ? AND r.deleted_at IS NULL ORDER BY r.opened_on DESC").all(c.id)
      .map((r) => ({ tenderId: r.tender_id, tenderNo: r.doc_no, nameOfWork: r.name_of_work, region: r.region, openedOn: r.opened_on, quoted: rupees(r.quoted_minor), rank: r.bid_rank, diffPct: r.diff_l1_bp == null ? null : r.diff_l1_bp / 100, ourQuoted: rupees(r.us), vsUsPct: r.us && r.quoted_minor != null ? Math.round(((r.quoted_minor - r.us) / r.us) * 10000) / 100 : null }));
    return { id: c.id, name: c.name, partnerId: c.partner_id, bids, wins: bids.filter((b) => b.rank === 1).length };
  }

  // ------------------------------------------------------------------ negotiation (FR-06)
  const negotiations = {
    list(actor, tenderId) { tenderFor(actor, tenderId); return db.prepare('SELECT * FROM tdr_negotiations WHERE tender_id = ? AND deleted_at IS NULL ORDER BY round_no').all(Number(tenderId)).map((n) => ({ id: n.id, round: n.round_no, heldOn: n.held_on, ourOffer: rupees(n.our_offer_minor), clientCounter: rupees(n.client_counter_minor), notes: n.notes, by: n.created_by })); },
    add(actor, tenderId, b) {
      need(actor, 'bd.award.create', 'record negotiations'); const t = tenderFor(actor, tenderId);
      if (t.stage !== 'SUBMITTED') throw unprocessable('Negotiations are recorded for a submitted tender before its award or loss.');
      const round = (db.prepare('SELECT COALESCE(MAX(round_no), 0) AS n FROM tdr_negotiations WHERE tender_id = ?').get(t.id).n) + 1;
      db.prepare("INSERT INTO tdr_negotiations (company_id, tender_id, round_no, held_on, our_offer_minor, client_counter_minor, notes, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'tdr_tender')").run(actor.companyId, t.id, round, b.heldOn, b.ourOffer == null ? null : toMinor(b.ourOffer), b.clientCounter == null ? null : toMinor(b.clientCounter), b.notes.trim(), actor.user);
      writeAudit(db, { entity: 'tdr_tenders', entityId: t.id, action: 'negotiation', newValues: { round, ourOffer: b.ourOffer ?? null }, actor: actor.user, companyId: actor.companyId });
      return negotiations.list(actor, t.id);
    },
  };

  // ------------------------------------------------------------------ award or loss (FR-06, FR-07)
  const awardRow = (actor, id) => { const a = db.prepare('SELECT * FROM tdr_awards WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!a || !seesChild(actor, a, AWARD_DOC, null)) throw notFound('That award or loss does not exist or is not yours to see.'); return a; };
  const awardView = (actor, a) => {
    const t = tenderOf(a.tender_id); const mine = same(a.created_by, actor.user);
    return { id: a.id, docNo: a.doc_no, docDate: a.doc_date, tenderId: a.tender_id, tenderNo: t.doc_no, nameOfWork: t.name_of_work, tenderStage: t.stage, outcome: a.outcome, loaNo: a.loa_no, loaDate: a.loa_date, awardedValue: rupees(a.awarded_value_minor), awardedTo: a.awarded_to, lossReasonCode: a.loss_reason_code, lossReason: a.loss_reason, status: a.status, statusLabel: APPROVAL[a.status], rowVersion: a.version, amendmentNo: a.amendment_no, decidedAt: a.decided_at, workflowInstanceId: a.workflow_instance_id, requestedBy: a.requested_by, createdBy: a.created_by, lostReasons: lostReasons(a.company_id),
      can: { edit: ['DRAFT', 'RETURNED'].includes(a.status) && mine && may(actor, 'bd.award.edit'), submit: ['DRAFT', 'RETURNED'].includes(a.status) && mine && may(actor, 'bd.award.submit'), delete: a.status === 'DRAFT' && mine && may(actor, 'bd.award.delete'), withdraw: a.status === 'SUBMITTED' && same(a.requested_by, actor.user), cancel: ['DRAFT', 'SUBMITTED', 'RETURNED'].includes(a.status) && mine && may(actor, 'bd.award.cancel'), print: may(actor, 'bd.award.print') } };
  };
  function awardProblems(actor, t, m) {
    const out = [];
    if (m.outcome === 'WON') {
      if (!m.loaNo) out.push({ field: 'loaNo', message: 'Give the number of the letter of acceptance' });
      if (!m.loaDate) out.push({ field: 'loaDate', message: 'Give the date of the letter of acceptance' }); else if (m.loaDate > today()) out.push({ field: 'loaDate', message: 'The letter is recorded after it is received' });
      if (!m.awardedValue) out.push({ field: 'awardedValue', message: 'Give the contract value of the award' });
    } else {
      const codes = lostReasons(actor.companyId).map((x) => x.code);
      if (!codes.includes(m.lossReasonCode)) out.push({ field: 'lossReasonCode', message: `The reason is one of ${codes.join(', ')}` });
    }
    return out;
  }
  const awards = {
    list(actor, query) { need(actor, 'bd.award.view', 'see awards'); return runList(db, awardList, parseListRequest(awardList, query), { select: 'a.*', scopeSql: childScope(actor, 'a', AWARD_DOC, null), params: params(actor), tieBreaker: 'a.id', map: (a) => awardView(actor, a) }); },
    exportSource(actor, req) {
      need(actor, 'bd.award.export', 'export awards'); const opts = { select: 'a.*', scopeSql: childScope(actor, 'a', AWARD_DOC, null), params: params(actor), tieBreaker: 'a.id' };
      return { title: awardList.label, permission: 'bd.award.export', personal: false, columns: Object.entries(awardList.columns).map(([key, c]) => ({ key, label: c.label, type: c.type === 'enum' ? 'text' : c.type })), count: () => countList(db, awardList, req, opts),
        rows: () => runList(db, awardList, req, { ...opts, limit: null, map: (a) => { const v = awardView(actor, a); return { docNo: v.docNo, tender: v.tenderNo, nameOfWork: v.nameOfWork, outcome: v.outcome, loaNo: v.loaNo, value: v.awardedValue, loaDate: v.loaDate, status: v.statusLabel }; } }).data, describe: (x) => [x.q ? `search "${x.q}"` : ''].filter(Boolean) };
    },
    get(actor, id) { need(actor, 'bd.award.view', 'see awards'); const a = awardRow(actor, id); return { ...awardView(actor, a), history: history('tdr_awards', a), negotiations: negotiations.list(actor, a.tender_id), results: resultsOf(a.tender_id) }; },
    forTender(actor, tenderId) { const t = tenderFor(actor, tenderId); const a = db.prepare("SELECT * FROM tdr_awards WHERE tender_id = ? AND deleted_at IS NULL AND status NOT IN ('CANCELLED', 'REJECTED') ORDER BY id DESC LIMIT 1").get(t.id); return a ? awards.get(actor, a.id) : null; },
    create(actor, b) {
      need(actor, 'bd.award.create', 'record awards and losses'); const t = tenderFor(actor, b.tenderId);
      if (t.stage !== 'SUBMITTED') throw unprocessable('The award or the loss is recorded for a submitted tender.');
      if (db.prepare("SELECT 1 FROM tdr_awards WHERE tender_id = ? AND deleted_at IS NULL AND status NOT IN ('CANCELLED', 'REJECTED')").get(t.id)) throw conflict('The result of this tender is recorded already.');
      const l1 = db.prepare('SELECT bidder_name, is_us FROM tdr_bid_results WHERE tender_id = ? AND bid_rank = 1 AND deleted_at IS NULL ORDER BY id LIMIT 1').get(t.id);
      const m = { ...b, awardedTo: b.awardedTo ?? (b.outcome === 'LOST' && l1 && !l1.is_us ? l1.bidder_name : null) };
      const problems = awardProblems(actor, t, m); if (problems.length) throw badRequest('Some fields are not valid.', problems);
      return transaction(db, () => {
        const no = nextDoc(actor, AWARD_DOC, 'tdr_awards', 'AWD');
        const id = Number(db.prepare("INSERT INTO tdr_awards (company_id, doc_no, doc_date, tender_id, outcome, loa_no, loa_date, awarded_value_minor, awarded_to, loss_reason_code, loss_reason, status, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, 'tdr_tender', ?)")
          .run(actor.companyId, no, today(), t.id, m.outcome, m.loaNo ?? null, m.loaDate ?? null, m.awardedValue == null ? null : toMinor(m.awardedValue), m.awardedTo ?? null, m.lossReasonCode ?? null, m.lossReason ?? null, actor.user, String(t.id)).lastInsertRowid);
        writeAudit(db, { entity: 'tdr_awards', entityId: id, action: 'create', newValues: { docNo: no, tender: t.doc_no, outcome: m.outcome }, actor: actor.user, companyId: actor.companyId });
        return b.submit ? awards.submit(actor, id) : awards.get(actor, id);
      });
    },
    update(actor, id, b) {
      const a = awardRow(actor, id); need(actor, 'bd.award.edit', 'change awards');
      if (!['DRAFT', 'RETURNED'].includes(a.status)) throw conflict('An approved result is not changed.');
      if (!same(a.created_by, actor.user)) throw forbidden(`Only ${a.created_by} changes this record.`);
      if (a.version !== b.version) throw conflict('This record was changed by someone else. Reload it and try again.');
      const m = { outcome: a.outcome, loaNo: a.loa_no, loaDate: a.loa_date, awardedValue: rupees(a.awarded_value_minor), awardedTo: a.awarded_to, lossReasonCode: a.loss_reason_code, lossReason: a.loss_reason, ...defined(b) };
      const problems = awardProblems(actor, tenderOf(a.tender_id), m); if (problems.length) throw badRequest('Some fields are not valid.', problems);
      db.prepare('UPDATE tdr_awards SET outcome = ?, loa_no = ?, loa_date = ?, awarded_value_minor = ?, awarded_to = ?, loss_reason_code = ?, loss_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(m.outcome, m.loaNo ?? null, m.loaDate ?? null, m.awardedValue == null ? null : toMinor(m.awardedValue), m.awardedTo ?? null, m.lossReasonCode ?? null, m.lossReason ?? null, actor.user, nowIso(), a.id);
      writeAudit(db, { entity: 'tdr_awards', entityId: a.id, action: 'update', oldValues: { outcome: a.outcome }, newValues: { outcome: m.outcome }, actor: actor.user, companyId: actor.companyId });
      return awards.get(actor, a.id);
    },
    remove(actor, id) {
      const a = awardRow(actor, id); need(actor, 'bd.award.delete', 'delete awards');
      if (a.status !== 'DRAFT' || !same(a.created_by, actor.user)) throw new HttpError(409, 'LOCKED', 'Only a draft is deleted by its maker.');
      db.prepare('UPDATE tdr_awards SET deleted_at = ?, deleted_by = ?, is_active = 0, version = version + 1 WHERE id = ?').run(nowIso(), actor.user, a.id);
      writeAudit(db, { entity: 'tdr_awards', entityId: a.id, action: 'delete', actor: actor.user, companyId: actor.companyId });
      return { id: a.id, deleted: true };
    },
    submit(actor, id) {
      const a = awardRow(actor, id); need(actor, 'bd.award.submit', 'send awards');
      if (!['DRAFT', 'RETURNED'].includes(a.status)) throw conflict(`This record is ${APPROVAL[a.status].toLowerCase()}.`);
      if (!same(a.created_by, actor.user)) throw forbidden(`Only ${a.created_by} sends this record.`);
      return transaction(db, () => { submitFlow(actor, 'tdr_awards', a, AWARD_DOC, { outcome: a.outcome, valueMinor: a.awarded_value_minor ?? 0 }, a.outcome === 'WON' ? 'Award of the tender' : 'Loss of the tender'); return awards.get(actor, a.id); });
    },
    withdraw(actor, id, { reason }) { const a = awardRow(actor, id); if (a.status !== 'SUBMITTED') throw unprocessable('Only a record in approval is withdrawn.'); if (!same(a.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, a.workflow_instance_id, { comment: reason }); return awards.get(actor, id); },
    cancel(actor, id, { reason }) {
      const a = awardRow(actor, id); need(actor, 'bd.award.cancel', 'cancel awards');
      if (!awardView(actor, a).can.cancel) throw unprocessable('An approved result is not cancelled.');
      return transaction(db, () => { if (a.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, a.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare("UPDATE tdr_awards SET status = 'CANCELLED', remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), a.id); writeAudit(db, { entity: 'tdr_awards', entityId: a.id, action: 'cancel', reason, actor: actor.user, companyId: actor.companyId }); return awards.get(actor, a.id); });
    },
    print(actor, id) {
      need(actor, 'bd.award.print', 'print awards'); const v = awards.get(actor, id); writeAudit(db, { entity: 'tdr_awards', entityId: v.id, action: 'print', actor: actor.user, companyId: actor.companyId });
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(v.docNo)}</title><style>body{font:14px sans-serif;margin:24px}td,th{border:1px solid #888;padding:6px;text-align:left}table{border-collapse:collapse;width:100%}</style></head><body><h1>${v.outcome === 'WON' ? 'Award' : 'Loss'} ${esc(v.docNo)}</h1><p>${esc(v.tenderNo)} · ${esc(v.nameOfWork)} · ${esc(v.statusLabel)}</p><table>${v.outcome === 'WON' ? `<tr><th>LoA</th><td>${esc(v.loaNo)} of ${esc(v.loaDate)}</td><th>Contract value</th><td>₹ ${esc(Number(v.awardedValue).toLocaleString('en-IN'))}</td></tr>` : `<tr><th>Reason</th><td>${esc(v.lossReasonCode)} ${esc(v.lossReason ?? '')}</td><th>Won by</th><td>${esc(v.awardedTo ?? '')}</td></tr>`}</table><h2>Opening</h2><table><tr><th>Rank</th><th>Bidder</th><th>Price</th><th>vs L1</th></tr>${v.results.map((r) => `<tr><td>${esc(r.label ?? '–')}</td><td>${esc(r.bidder)}${r.isUs ? ' (us)' : ''}</td><td>${r.quoted == null ? '' : `₹ ${esc(Number(r.quoted).toLocaleString('en-IN'))}`}</td><td>${r.diffPct == null ? '' : `${r.diffPct}%`}</td></tr>`).join('')}</table></body></html>`;
    },
  };

  // ------------------------------------------------------------------ what the workflow decided
  function decideEmd(instance, actor, outcome, comment) {
    const e = settle(instance, actor, outcome, comment, 'tdr_emd'); if (!e) return;
    if (outcome === 'APPROVED') event('bd.emd.requested', actor, 'tdr_emd', e.id, e.company_id, { emdId: e.id, docNo: e.doc_no, tenderId: e.tender_id, kind: e.kind, mode: e.mode, amount: rupees(e.amount_minor), payee: e.payee, neededBy: e.needed_by, bankGuarantee: e.mode === 'BG' });
    if (outcome === 'APPROVED' && e.mode !== 'EXEMPT') for (const u of holders(e.company_id, ['ACCMGR'])) tell(e.company_id, u, 'bd.decided', { what: e.kind === 'EMD' ? 'EMD request' : 'Tender fee request', ref: e.doc_no, title: tenderOf(e.tender_id)?.name_of_work ?? '', decision: 'approved: record the instrument', comment: '' }, `/bd/emd/record?id=${e.id}`, `emd:${e.id}:issue:${u}`);
    tell(e.company_id, e.requested_by ?? e.created_by, 'bd.decided', { what: e.kind === 'EMD' ? 'EMD request' : 'Tender fee request', ref: e.doc_no, title: tenderOf(e.tender_id)?.name_of_work ?? '', decision: decisionWord(outcome), comment: comment ? `: ${comment}` : '' }, `/bd/emd/record?id=${e.id}`, `emd:${e.id}:${outcome}`);
  }
  function decideSubmission(instance, actor, outcome, comment) {
    const s = settle(instance, actor, outcome, comment, 'tdr_submissions'); if (!s) return;
    if (outcome === 'APPROVED') event('bd.submission.approved', actor, 'tdr_submission', s.id, s.company_id, { submissionId: s.id, docNo: s.doc_no, tenderId: s.tender_id, bidAmount: rupees(s.bid_amount_minor), estimate: rupees(s.estimate_minor), adjustment: rupees(s.bid_amount_minor - s.estimate_minor), estimateSource: s.estimate_source });
    tell(s.company_id, s.requested_by ?? s.created_by, 'bd.decided', { what: 'Final bid', ref: s.doc_no, title: tenderOf(s.tender_id)?.name_of_work ?? '', decision: decisionWord(outcome), comment: comment ? `: ${comment}` : '' }, `/bd/submission?tenderId=${s.tender_id}`, `sub:${s.id}:${outcome}`);
  }
  function decideAward(instance, actor, outcome, comment) {
    const a = settle(instance, actor, outcome, comment, 'tdr_awards'); if (!a) return;
    const t = tenderOf(a.tender_id);
    if (outcome === 'APPROVED') {
      db.prepare('UPDATE tdr_awards SET decided_at = ? WHERE id = ?').run(nowIso(), a.id);
      const sys = kit.systemActor(a.company_id); const on = a.loa_date ?? today();
      T().tenders.markOutcome(sys, t.id, a.outcome);
      db.prepare("UPDATE tdr_emd SET refund_status = 'DUE', result_on = ?, updated_at = ?, version = version + 1 WHERE tender_id = ? AND kind = 'EMD' AND status = 'APPROVED' AND issue_date IS NOT NULL AND refund_status = 'NOT_DUE'").run(on, nowIso(), t.id);
      if (t.opportunity_id) {
        const o = db.prepare('SELECT * FROM bd_opportunities WHERE id = ?').get(t.opportunity_id);
        if (o && !['WON', 'LOST'].includes(o.stage)) {
          if (a.outcome === 'WON' && o.status === 'APPROVED') crmOf(db).opportunities.awardFromTender(sys, o.id, { tenderRef: t.doc_no, awardValue: rupees(a.awarded_value_minor), awardedOn: on });
          if (a.outcome === 'LOST') crmOf(db).opportunities.loseFromTender(sys, o.id, { reasonCode: a.loss_reason_code, reason: a.loss_reason, lostTo: a.awarded_to });
        }
      }
      if (a.outcome === 'WON') event('tdr.tender.awarded', actor, 'tdr_tender', t.id, t.company_id, { tenderId: t.id, docNo: t.doc_no, awardId: a.id, opportunityId: t.opportunity_id, clientPartnerId: t.client_partner_id, nameOfWork: t.name_of_work, location: t.location, region: t.region, loaNo: a.loa_no, loaDate: a.loa_date, awardedValue: rupees(a.awarded_value_minor), periodMonths: t.period_months, bidType: t.bid_type, owner: t.owner });
      else event('tdr.tender.lost', actor, 'tdr_tender', t.id, t.company_id, { tenderId: t.id, docNo: t.doc_no, awardId: a.id, opportunityId: t.opportunity_id, reasonCode: a.loss_reason_code, awardedTo: a.awarded_to });
    }
    tell(a.company_id, a.requested_by ?? a.created_by, 'bd.decided', { what: a.outcome === 'WON' ? 'Award of' : 'Loss of', ref: a.doc_no, title: t.name_of_work, decision: decisionWord(outcome), comment: comment ? `: ${comment}` : '' }, `/bd/award?tenderId=${t.id}`, `awd:${a.id}:${outcome}`);
  }

  /** BR-02: an EMD whose refund is due is followed up when it is N days old, and again every N days; a guarantee that ends soon is told to accounts. */
  function cycle(companyId, { today: now = today() } = {}) {
    const n = Number(param(companyId, 'tdr.emd.refund_followup_days') ?? 30); const warn = Number(param(companyId, 'tdr.emd.expiry_warning_days') ?? 15); const out = { followUps: 0, expiring: 0 };
    const acc = holders(companyId, ['ACCMGR']);
    for (const e of db.prepare("SELECT e.*, t.doc_no AS tno, t.name_of_work, t.owner FROM tdr_emd e JOIN tdr_tenders t ON t.id = e.tender_id WHERE e.company_id = ? AND e.deleted_at IS NULL AND e.kind = 'EMD' AND e.refund_status IN ('DUE', 'REQUESTED') AND e.result_on IS NOT NULL").all(companyId)) {
      const age = ageingOf(e.result_on, now).days; if (age < n) continue; const k = Math.floor(age / n);
      for (const u of new Set([e.owner, ...acc])) { tell(companyId, u, 'bd.tender.reminder', { ref: e.tno, title: e.name_of_work, what: `the EMD ${e.doc_no} of ₹ ${rupees(e.amount_minor).toLocaleString('en-IN')} is not refunded`, when: `${age} days after the result` }, `/bd/emd/record?id=${e.id}`, `emdfu:${e.id}:${k}:${u}`); out.followUps += 1; }
    }
    for (const e of db.prepare("SELECT e.*, t.doc_no AS tno, t.name_of_work FROM tdr_emd e JOIN tdr_tenders t ON t.id = e.tender_id WHERE e.company_id = ? AND e.deleted_at IS NULL AND e.mode = 'BG' AND e.valid_until IS NOT NULL AND e.refund_status IN ('NOT_DUE', 'DUE', 'REQUESTED')").all(companyId)) {
      const left = days(now, e.valid_until); if (left < 0 || left > warn) continue;
      for (const u of acc) { tell(companyId, u, 'bd.tender.reminder', { ref: e.tno, title: e.name_of_work, what: `the bank guarantee of ${e.doc_no} ends`, when: `on ${e.valid_until}` }, `/bd/emd/record?id=${e.id}`, `emdbg:${e.id}:${e.valid_until}:${u}`); out.expiring += 1; }
    }
    return out;
  }
  /** The refund ageing of the EMD register: what is due, by bucket. */
  function ageingReport(actor) {
    need(actor, 'bd.emd.view', 'see EMD refunds');
    const rows = db.prepare(`SELECT e.* FROM tdr_emd e JOIN tdr_tenders t ON t.id = e.tender_id WHERE ${childScope(actor, 'e', EMD_DOC, 'bd.emd.view_all')} AND e.deleted_at IS NULL AND e.kind = 'EMD' AND e.refund_status IN ('DUE', 'REQUESTED')`).all(params(actor));
    const buckets = { '0-30': { count: 0, amount: 0 }, '31-60': { count: 0, amount: 0 }, '61-90': { count: 0, amount: 0 }, '90+': { count: 0, amount: 0 } };
    for (const e of rows) { const a = ageingOf(e.result_on, today()); buckets[a.bucket].count += 1; buckets[a.bucket].amount += e.amount_minor; }
    const held = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(e.amount_minor), 0) AS v FROM tdr_emd e JOIN tdr_tenders t ON t.id = e.tender_id WHERE ${childScope(actor, 'e', EMD_DOC, 'bd.emd.view_all')} AND e.deleted_at IS NULL AND e.kind = 'EMD' AND e.issue_date IS NOT NULL AND e.refund_status IN ('NOT_DUE', 'DUE', 'REQUESTED')`).get(params(actor));
    return { buckets: Object.entries(buckets).map(([bucket, x]) => ({ bucket, count: x.count, amount: rupees(x.amount) })), due: { count: rows.length, amount: rupees(rows.reduce((s, e) => s + e.amount_minor, 0)) }, held: { count: held.n, amount: rupees(held.v) } };
  }
  const access = (actor, entity, id) => {
    if (entity === 'tdr_credential') { const c = db.prepare('SELECT company_id FROM tdr_credentials WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); return c ? { companyId: c.company_id, projectId: null, siteId: null, canView: may(actor, 'bd.credential.view'), canEdit: may(actor, 'bd.credential.manage'), locked: false } : null; }
    const table = { tdr_emd: 'tdr_emd', tdr_award: 'tdr_awards', tdr_submission: 'tdr_submissions' }[entity]; const r = table && db.prepare(`SELECT * FROM ${table} WHERE id = ? AND company_id = ? AND deleted_at IS NULL`).get(Number(id), actor.companyId);
    if (!r || !seesChild(actor, r, null, entity === 'tdr_emd' ? 'bd.emd.view_all' : null)) return null;
    return { companyId: r.company_id, projectId: null, siteId: null, canView: true, canEdit: entity === 'tdr_emd' ? may(actor, 'bd.emd.instrument') || same(r.created_by, actor.user) : may(actor, entity === 'tdr_award' ? 'bd.award.edit' : 'bd.submission.manage'), locked: false };
  };
  return { credentials, emd, submissions, results, analysis, competitor, negotiations, awards, cycle, ageingReport, decisionsOf: { emd: decideEmd, submission: decideSubmission, award: decideAward }, access };
}

const services = new WeakMap();
export const bindAwards = (db, s) => services.set(db, s);
export const awardsOf = (db) => services.get(db) ?? null;

const step = (code, name, approvers, when = null) => ({ code, name, type: 'approval', mode: 'single', approvers, slaHours: 48, requireAttachment: false, checklist: [], when, notify: [], action: null });
const hooksOf = (k) => ({
  onApproved: (db, { instance, actor }) => awardsOf(db)?.decisionsOf[k](instance, actor, 'APPROVED'),
  onRejected: (db, { instance, actor, comment }) => awardsOf(db)?.decisionsOf[k](instance, actor, 'REJECTED', comment),
  onReturned: (db, { instance, actor, comment }) => awardsOf(db)?.decisionsOf[k](instance, actor, 'RETURNED', comment),
  onCancelled: (db, { instance, actor, comment }) => awardsOf(db)?.decisionsOf[k](instance, actor, 'CANCELLED', comment),
});
const describeChild = (table, label) => (db, companyId, id) => { const r = db.prepare(`SELECT x.doc_no, x.requested_by, t.name_of_work FROM ${table} x JOIN tdr_tenders t ON t.id = x.tender_id WHERE x.id = ? AND x.company_id = ?`).get(rid(id), companyId); return r ? { ref: r.doc_no, title: `${label}: ${r.name_of_work}`, originator: r.requested_by } : null; };
workflowTypes.register({
  docType: EMD_DOC, label: 'EMD or tender fee request', processOwner: 'ACCMGR', route: (id) => `/bd/emd/record?id=${id}`, describe: describeChild('tdr_emd', 'EMD or fee'),
  summarise(db, _actor, id) { const e = db.prepare('SELECT e.*, t.doc_no AS tno, t.name_of_work, t.submission_at FROM tdr_emd e JOIN tdr_tenders t ON t.id = e.tender_id WHERE e.id = ?').get(rid(id)); if (!e) return null; return { fields: [{ label: 'Request', value: e.doc_no }, { label: 'Tender', value: `${e.tno}: ${e.name_of_work}` }, { label: 'Kind', value: e.kind === 'EMD' ? 'EMD' : 'Tender fee' }, { label: 'Mode', value: EMD_MODES[e.mode] }, { label: 'Amount', value: `₹ ${rupees(e.amount_minor).toLocaleString('en-IN')}` }, { label: 'Payee', value: e.payee ?? '–' }, { label: 'Needed by', value: e.needed_by ?? e.submission_at ?? '–' }, ...(e.exemption_reason ? [{ label: 'Exemption', value: e.exemption_reason }] : [])] }; },
  defaultDefinition: { name: 'EMD or tender fee: estimation, then the accounts manager and the CFO', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('EST', 'Estimation review', [{ kind: 'resolver', resolver: 'tdr.reviewer' }]), step('ACCMGR', 'Accounts manager', [{ kind: 'role', role: 'ACCMGR' }]), step('CFO', 'CFO', [{ kind: 'role', role: 'CFO' }])] },
  hooks: hooksOf('emd'),
});
workflowTypes.register({
  docType: SUBMISSION_DOC, label: 'Final bid submission', processOwner: 'EST', route: (id) => `/bd/submission?id=${id}`, describe: describeChild('tdr_submissions', 'Final bid'),
  summarise(db, _actor, id) { const s = db.prepare('SELECT s.*, t.doc_no AS tno, t.name_of_work, t.est_cost_minor FROM tdr_submissions s JOIN tdr_tenders t ON t.id = s.tender_id WHERE s.id = ?').get(rid(id)); if (!s) return null; const adj = s.bid_amount_minor - s.estimate_minor; return { fields: [{ label: 'Submission', value: s.doc_no }, { label: 'Tender', value: `${s.tno}: ${s.name_of_work}` }, { label: 'Estimated cost of the authority', value: `₹ ${rupees(s.est_cost_minor).toLocaleString('en-IN')}` }, { label: 'Approved estimate', value: `₹ ${rupees(s.estimate_minor).toLocaleString('en-IN')}${s.estimate_source === 'MANUAL' ? ' (typed: 09.03 not available)' : ''}` }, { label: 'Final bid', value: `₹ ${rupees(s.bid_amount_minor).toLocaleString('en-IN')}` }, { label: 'Difference', value: adj ? `₹ ${rupees(adj).toLocaleString('en-IN')}: ${s.adjustment_reason}` : 'None' }] }; },
  defaultDefinition: { name: 'Final bid: estimation, then the director', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('EST', 'Estimation review', [{ kind: 'resolver', resolver: 'tdr.reviewer' }]), step('DIR', 'Director', [{ kind: 'role', role: 'DIR' }])] },
  hooks: hooksOf('submission'),
});
workflowTypes.register({
  docType: AWARD_DOC, label: 'Award or loss of a tender', processOwner: 'DIR', route: (id) => `/bd/award?id=${id}`, describe: describeChild('tdr_awards', 'Award or loss'),
  summarise(db, _actor, id) { const a = db.prepare('SELECT a.*, t.doc_no AS tno, t.name_of_work FROM tdr_awards a JOIN tdr_tenders t ON t.id = a.tender_id WHERE a.id = ?').get(rid(id)); if (!a) return null; return { fields: [{ label: 'Record', value: a.doc_no }, { label: 'Tender', value: `${a.tno}: ${a.name_of_work}` }, { label: 'Outcome', value: a.outcome === 'WON' ? 'Won' : 'Lost' }, ...(a.outcome === 'WON' ? [{ label: 'Letter of acceptance', value: `${a.loa_no} of ${a.loa_date}` }, { label: 'Contract value', value: `₹ ${rupees(a.awarded_value_minor).toLocaleString('en-IN')}` }] : [{ label: 'Reason', value: `${a.loss_reason_code}${a.loss_reason ? `: ${a.loss_reason}` : ''}` }, { label: 'Won by', value: a.awarded_to ?? '–' }])] }; },
  defaultDefinition: { name: 'Award or loss: estimation, then the director accepts an award', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('EST', 'Estimation review', [{ kind: 'resolver', resolver: 'tdr.reviewer' }]), step('DIR', 'Director', [{ kind: 'role', role: 'DIR' }], { field: 'outcome', op: 'eq', value: 'WON' })] },
  hooks: hooksOf('award'),
});
evidenceProviders.register(SUBMISSION_DOC, ({ db, instance }) => {
  const s = db.prepare('SELECT s.*, t.est_cost_minor, t.bid_capacity_minor FROM tdr_submissions s JOIN tdr_tenders t ON t.id = s.tender_id WHERE s.id = ?').get(rid(instance.docId)); if (!s) return { sections: [] };
  const pct = s.estimate_minor ? Math.round(((s.bid_amount_minor - s.estimate_minor) / s.estimate_minor) * 10000) / 100 : null; const items = json(s.checklist_json, []);
  return { sections: [{ code: 'tdr-submission', title: 'Before approving the bid', kind: 'metrics', items: [{ label: 'Bid against the estimate', value: pct == null ? 'no estimate' : `${pct > 0 ? '+' : ''}${pct}%`, format: 'text' }, { label: 'Bid against the authority\'s cost', value: s.est_cost_minor ? `${Math.round(((s.bid_amount_minor - s.est_cost_minor) / s.est_cost_minor) * 10000) / 100}%` : '–', format: 'text' }, { label: 'Checklist', value: `${items.filter((i) => i.done).length} of ${items.length} done`, format: 'text' }, { label: 'Estimate', value: s.estimate_source === 'MANUAL' ? 'typed in (estimation 09.03 not available)' : 'from the approved estimate', format: 'text' }] }] };
});
for (const [entity, label] of [['tdr_credential', 'Credentials (work orders, certificates, financials, CVs)'], ['tdr_emd', 'EMD and fee instruments'], ['tdr_award', 'Letters of acceptance'], ['tdr_submission', 'Submission proofs (portal receipts)']]) {
  fileEntities.register({ entity, label, resolve(db, actor, id) { return awardsOf(db)?.access(actor, entity, id) ?? null; } });
}
