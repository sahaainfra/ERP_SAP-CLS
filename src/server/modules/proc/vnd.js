import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { toPdf } from '../../platform/export/index.js';
import { defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { parameterRegistry } from '../../platform/parameters/index.js';
import { workflowOf } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { json, nowIso, rid, same } from './base.js';

// Vendor prequalification, the approved vendor list (AVL), scorecards and re-evaluation (part 15.08). A vendor is scored on a questionnaire per category (financials, experience, capacity, certifications, references) with a site visit; the approved
// prequalification puts it on the AVL for each category and region. RFQs above a threshold go only to AVL vendors (BR-01). Each period a scorecard is worked out from evidence kept with it (GRN timeliness and acceptance, CS ranks, RFQ responses and
// inputs of quality and safety); a score below the threshold suggests a suspension, which people approve. Scores are percentages x 10000 (100 percent = 1000000).
export const PREQ_DOC = 'PROC_PREQ'; export const SUSP_DOC = 'PROC_AVLSUSP';
export const APPROVAL_STATUS = { DRAFT: 'Draft', SUBMITTED: 'Waiting for approval', RETURNED: 'Returned for correction', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled', SUPERSEDED: 'Superseded' };
export const AVL_STATUS = { APPROVED: 'Approved', CONDITIONAL: 'Conditional', SUSPENDED: 'Suspended' };
export const RESULTS = { PENDING: 'Pending', QUALIFIED: 'Qualified', CONDITIONAL: 'Qualified with conditions', NOT_QUALIFIED: 'Not qualified' };
export const SECTIONS = [{ code: 'FINANCIALS', weight: 25, label: 'Financial strength' }, { code: 'EXPERIENCE', weight: 25, label: 'Experience' }, { code: 'CAPACITY', weight: 20, label: 'Capacity' }, { code: 'CERTIFICATIONS', weight: 15, label: 'Certifications' }, { code: 'REFERENCES', weight: 15, label: 'References' }];
export const METRICS = ['onTime', 'quality', 'price', 'response', 'safety', 'invoice'];
export const INPUT_KINDS = { SAFETY: 'Safety compliance', INVOICE_ACCURACY: 'Invoice accuracy', QUALITY: 'Quality (inspection)' };
const EDITABLE = ['DRAFT', 'RETURNED'];
const PCT = 10_000;
for (const [key, def, description, min, max] of [
  ['proc.vnd.w_delivery', 25, 'FR-03: weight of on-time delivery in the vendor score.', 0, 100], ['proc.vnd.w_quality', 25, 'FR-03: weight of quality acceptance.', 0, 100], ['proc.vnd.w_price', 20, 'FR-03: weight of price competitiveness (CS ranks).', 0, 100],
  ['proc.vnd.w_response', 10, 'FR-03: weight of responsiveness to RFQs.', 0, 100], ['proc.vnd.w_safety', 10, 'FR-03: weight of safety compliance.', 0, 100], ['proc.vnd.w_invoice', 10, 'FR-03: weight of invoice accuracy.', 0, 100],
  ['proc.vnd.rating_a', 85, 'The score (percent) from which a vendor is rated A.', 1, 100], ['proc.vnd.rating_b', 70, 'The score (percent) from which a vendor is rated B.', 1, 100], ['proc.vnd.rating_c', 55, 'The score (percent) from which a vendor is rated C; below it is D.', 1, 100],
  ['proc.vnd.suspend_below', 50, 'FR-05: a score (percent) below this suggests suspending the vendor from the approved vendor list.', 1, 100], ['proc.vnd.qualify_at', 70, 'FR-01: a questionnaire score (percent) from which a vendor is qualified.', 1, 100],
  ['proc.vnd.conditional_at', 50, 'FR-01: a questionnaire score (percent) from which a vendor is qualified with conditions; below it is not qualified.', 1, 100],
  ['proc.vnd.avl_rfq_threshold', 500000, 'BR-01: an RFQ with an estimate (rupees) from this value goes only to vendors on the approved vendor list.', 0, 1_000_000_000], ['proc.vnd.reeval_days', 60, 'FR-05: days before an approved vendor list entry ends that procurement is reminded to re-evaluate.', 1, 365],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType: 'integer', default: def, scopes: ['system', 'company'], description, min, max });

const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** The weighted score of a questionnaire: sections x weights, answers of 0 to 100. */
export function questionnaireScore(answers) {
  const by = new Map((answers ?? []).map((a) => [a.section, Number(a.score)])); let sum = 0; let w = 0;
  for (const s of SECTIONS) { if (by.has(s.code) && Number.isFinite(by.get(s.code))) { sum += s.weight * by.get(s.code); w += s.weight; } } return w ? Math.round((sum / w) * PCT) : 0;
}
export const resultOf = (score, { qualify, conditional }) => (score >= qualify * PCT ? 'QUALIFIED' : score >= conditional * PCT ? 'CONDITIONAL' : 'NOT_QUALIFIED');
/** The total of the metrics that have evidence, weighted; a metric with no evidence leaves its weight out. */
export function compose(metrics, weights) {
  let sum = 0; let w = 0; for (const k of METRICS) { const m = metrics[k]; const wt = Number(weights[k] ?? 0); if (m != null && wt > 0) { sum += m * wt; w += wt; } } return w ? Math.round(sum / w) : null;
}
export const ratingOf = (total, { a, b, c }) => (total == null ? 'NA' : total >= a * PCT ? 'A' : total >= b * PCT ? 'B' : total >= c * PCT ? 'C' : 'D');
/** Every metric worked out again from the evidence kept with a scorecard, with no database: it must equal what was stored (T-01). */
export function metricsFromEvidence(ev) {
  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1_000_000) : null); const out = { onTime: null, quality: null, price: null, response: null, safety: null, invoice: null };
  const rc = ev.delivery?.receipts ?? []; out.onTime = pct(rc.filter((x) => x.onTime).length, rc.length);
  const q = ev.quality?.receipts ?? []; out.quality = q.length ? pct(q.reduce((s, x) => s + x.accepted, 0), q.reduce((s, x) => s + x.qty, 0)) : (ev.quality?.input?.value ?? null);
  const ls = (ev.price?.lines ?? []).filter((x) => x.n >= 2 && x.rank >= 1); out.price = ls.length ? Math.round((ls.reduce((s, x) => s + (x.n - Math.min(x.rank, x.n)) / (x.n - 1), 0) / ls.length) * 1_000_000) : null;
  const r = ev.response; if (r && r.invited > 0) { const rate = r.answered / r.invited; const speed = r.avgHours == null ? 1 : r.avgHours <= 48 ? 1 : r.avgHours >= 168 ? 0 : (168 - r.avgHours) / 120; out.response = Math.round((r.avgHours == null ? rate : 0.7 * rate + 0.3 * speed) * 1_000_000); }
  out.safety = ev.safety?.value ?? null; out.invoice = ev.invoice?.value ?? null; return out;
}
/** 'YYYY-Qn' (calendar quarters) or 'YYYY-MM'. */
export function periodRange(period) {
  let m = /^(\d{4})-Q([1-4])$/.exec(period ?? ''); if (m) { const y = Number(m[1]); const q = Number(m[2]); const s = (q - 1) * 3 + 1; const end = new Date(Date.UTC(y, s + 2, 0)).getUTCDate(); const pad = (n) => String(n).padStart(2, '0'); return { from: `${y}-${pad(s)}-01`, to: `${y}-${pad(s + 2)}-${pad(end)}` }; }
  m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period ?? ''); if (m) { const y = Number(m[1]); const mo = Number(m[2]); return { from: `${m[1]}-${m[2]}-01`, to: `${m[1]}-${m[2]}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}` }; } return null;
}
export const previousQuarter = (today) => { let y = Number(today.slice(0, 4)); let q = Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1 - 1; if (q === 0) { q = 4; y -= 1; } return `${y}-Q${q}`; };

export const preqList = defineList({
  code: 'proc.prequalifications', label: 'Vendor prequalifications', permission: 'proc.prequalification.view', from: 'vnd_prequalifications x JOIN mdm_partners v ON v.id = x.partner_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'v.legal_name', 'v.trade_name', 'v.code'], defaultSort: '-date',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'Prequalification' }, vendor: { sql: 'COALESCE(v.trade_name, v.legal_name)', type: 'text', label: 'Vendor' }, date: { sql: 'x.doc_date', type: 'date', label: 'Date' }, score: { sql: 'x.score', type: 'number', label: 'Score' },
    result: { sql: 'x.result', type: 'enum', label: 'Result', options: Object.entries(RESULTS) }, validUntil: { sql: 'x.valid_until', type: 'date', label: 'Valid until' }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(APPROVAL_STATUS) },
  },
});
export const avlList = defineList({
  code: 'proc.avl', label: 'Approved vendor list', permission: 'proc.avl.view', from: 'vnd_avl x JOIN mdm_partners v ON v.id = x.partner_id JOIN mdm_item_categories c ON c.id = x.category_id', where: 'x.deleted_at IS NULL', searchable: ['v.legal_name', 'v.trade_name', 'v.code', 'c.name', 'c.code', 'x.region_code'], defaultSort: 'category',
  columns: {
    vendor: { sql: 'COALESCE(v.trade_name, v.legal_name)', type: 'text', label: 'Vendor' }, category: { sql: 'c.name', type: 'text', label: 'Category' }, region: { sql: 'x.region_code', type: 'text', label: 'Region' },
    avlStatus: { sql: 'x.avl_status', type: 'enum', label: 'Status', options: Object.entries(AVL_STATUS) }, validUntil: { sql: 'x.valid_until', type: 'date', label: 'Valid until' },
  },
});
export const scoreList = defineList({
  code: 'proc.vendor_scorecards', label: 'Vendor scorecards', permission: 'proc.vendor_score.view', from: 'vnd_scorecards x JOIN mdm_partners v ON v.id = x.partner_id', where: 'x.deleted_at IS NULL', searchable: ['v.legal_name', 'v.trade_name', 'v.code', 'x.period'], defaultSort: '-period',
  columns: {
    vendor: { sql: 'COALESCE(v.trade_name, v.legal_name)', type: 'text', label: 'Vendor' }, period: { sql: 'x.period', type: 'text', label: 'Period' }, total: { sql: 'x.total_score', type: 'number', label: 'Score' },
    rating: { sql: 'x.rating', type: 'enum', label: 'Rating', options: [['A', 'A'], ['B', 'B'], ['C', 'C'], ['D', 'D'], ['NA', 'Not rated']] },
  },
});
export const suspList = defineList({
  code: 'proc.avl_suspensions', label: 'AVL suspensions', permission: 'proc.avl.view', from: 'vnd_suspensions x JOIN mdm_partners v ON v.id = x.partner_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'v.legal_name', 'v.trade_name'], defaultSort: '-date',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'Suspension' }, vendor: { sql: 'COALESCE(v.trade_name, v.legal_name)', type: 'text', label: 'Vendor' }, date: { sql: 'x.doc_date', type: 'date', label: 'Date' },
    auto: { sql: "CASE WHEN x.auto_suggested = 1 THEN 'YES' ELSE 'NO' END", type: 'enum', label: 'Suggested by the system', options: [['YES', 'Yes'], ['NO', 'No']] }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(APPROVAL_STATUS) },
  },
});

export function createVndService({ db, base }) {
  const { authz, param, may, need, fail, audit, notify, number } = base;
  const pn = (companyId, key) => Number(param(companyId, key) ?? 0);
  const evt = (type, actor, companyId, entity, entityId, data) => publishEvent(db, { type, entity, entityId, actorId: actor?.user ?? 'system', companyId, projectId: null, data });
  const vname = (id) => { const v = db.prepare('SELECT code, trade_name, legal_name FROM mdm_partners WHERE id = ?').get(id); return v ? { code: v.code, name: v.trade_name ?? v.legal_name } : { code: '', name: '' }; };
  const catName = (id) => db.prepare('SELECT code, name FROM mdm_item_categories WHERE id = ?').get(id) ?? { code: '', name: '' };
  const scope = (actor, key) => { if (!authz.check(actor, key).allowed) throw forbidden(`You may not do that (permission ${key}).`); return { sql: 'x.company_id = :c', params: { c: actor.companyId } }; };
  const rowOf = (table, perm, what) => (actor, id, key = perm) => { const r = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND company_id = ? AND deleted_at IS NULL`).get(rid(id), actor.companyId); if (!r || !may(actor, perm)) throw notFound(`That ${what} does not exist.`); if (key !== perm) need(actor, key, `do that with a ${what}`); return r; };
  const preqRow = rowOf('vnd_prequalifications', 'proc.prequalification.view', 'prequalification'); const suspRow = rowOf('vnd_suspensions', 'proc.avl.view', 'suspension'); const actRow = rowOf('vnd_actions', 'proc.vendor_action.view', 'vendor action');
  const weights = (companyId) => ({ onTime: pn(companyId, 'proc.vnd.w_delivery'), quality: pn(companyId, 'proc.vnd.w_quality'), price: pn(companyId, 'proc.vnd.w_price'), response: pn(companyId, 'proc.vnd.w_response'), safety: pn(companyId, 'proc.vnd.w_safety'), invoice: pn(companyId, 'proc.vnd.w_invoice') });
  const bands = (companyId) => ({ a: pn(companyId, 'proc.vnd.rating_a'), b: pn(companyId, 'proc.vnd.rating_b'), c: pn(companyId, 'proc.vnd.rating_c') });
  const vendorOf = (companyId, partnerId) => { const p = db.prepare('SELECT id, partner_status FROM mdm_partners WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(partnerId), companyId); if (!p) throw notFound('That vendor does not exist.'); if (!db.prepare("SELECT 1 FROM mdm_partner_roles WHERE partner_id = ? AND partner_role IN ('VENDOR', 'SERVICE_PROVIDER', 'SUBCONTRACTOR') AND deleted_at IS NULL").get(p.id)) throw unprocessable('That partner is not a vendor.'); return p; };
  const validEntry = (e, today) => ['APPROVED', 'CONDITIONAL'].includes(e.avl_status) && e.valid_from <= today && (!e.valid_until || e.valid_until >= today);

  // ---- BR-01: the gate on the RFQ ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  base.gates.push((companyId, vendorId, rfq) => {
    if (!rfq) return null; const cats = db.prepare('SELECT DISTINCT i.category_id AS c FROM proc_rfq_lines l JOIN mdm_items i ON i.id = l.item_id WHERE l.rfq_id = ? AND l.deleted_at IS NULL AND i.category_id IS NOT NULL').all(rfq.id).map((x) => x.c); if (!cats.length) return null;
    const today = todayIST(); const entries = db.prepare(`SELECT * FROM vnd_avl WHERE company_id = ? AND partner_id = ? AND deleted_at IS NULL AND category_id IN (${cats.map(() => '?').join(',')})`).all(companyId, rid(vendorId), ...cats);
    if (entries.length && entries.every((e) => e.avl_status === 'SUSPENDED')) return 'Suspended on the approved vendor list: it is not sent an enquiry';
    if ((rfq.est_total ?? 0) >= pn(companyId, 'proc.vnd.avl_rfq_threshold') * 100 && !entries.some((e) => validEntry(e, today))) return 'Not on the approved vendor list for this category, and the RFQ is above the value that needs it';
    return null;
  });

  // ---- prequalification (FR-01) ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const normAnswers = (answers) => SECTIONS.map((s) => { const a = (answers ?? []).find((x) => x.section === s.code); return { section: s.code, score: a && a.score != null ? Number(a.score) : null, note: a?.note ?? null }; });
  const preqView = (actor, r, { detail = false } = {}) => {
    const can = (k) => may(actor, k); const own = same(r.requested_by, actor.user); const cats = json(r.category_ids_json, []).map((id) => ({ id, ...catName(id) }));
    const o = { id: r.id, docNo: r.doc_no, date: r.doc_date, partnerId: r.partner_id, vendor: vname(r.partner_id).name, vendorCode: vname(r.partner_id).code, categories: cats, regions: json(r.regions_json, []), strategic: Boolean(r.strategic), score: r.score, result: r.result, resultLabel: RESULTS[r.result], visitDate: r.visit_date, visitNotes: r.visit_notes, visitReportFileId: r.visit_report_file_id,
      validUntil: r.valid_until, conditions: r.conditions, status: r.status, statusLabel: APPROVAL_STATUS[r.status], revisionNo: r.revision_no, parentId: r.parent_id, requestedBy: r.requested_by, approvedBy: r.approved_by, approvedAt: r.approved_at, workflowInstanceId: r.workflow_instance_id, cancelReason: r.cancel_reason, rowVersion: r.version,
      can: { edit: can('proc.prequalification.edit') && EDITABLE.includes(r.status), submit: can('proc.prequalification.submit') && EDITABLE.includes(r.status), withdraw: r.status === 'SUBMITTED' && own, delete: can('proc.prequalification.delete') && r.status === 'DRAFT' && !r.workflow_instance_id, approve: can('proc.prequalification.approve') && r.status === 'SUBMITTED' && !own,
        cancel: can('proc.prequalification.cancel') && ['DRAFT', 'RETURNED', 'SUBMITTED'].includes(r.status), amend: can('proc.prequalification.amend') && r.status === 'APPROVED', print: can('proc.prequalification.print') } };
    o.answers = normAnswers(json(r.questionnaire_json, [])).map((a) => ({ ...a, label: SECTIONS.find((s) => s.code === a.section).label, weight: SECTIONS.find((s) => s.code === a.section).weight }));
    if (detail) { o.avl = db.prepare('SELECT * FROM vnd_avl WHERE prequal_id = ? AND deleted_at IS NULL ORDER BY id').all(r.id).map((e) => avlView(e)); if (o.can.approve && r.workflow_instance_id) o.taskId = workflowOf(db).listTasks(actor, { mine: 'assigned', limit: 200 }).rows.find((t) => t.instance?.id === r.workflow_instance_id)?.id ?? null; }
    return o;
  };
  const avlView = (e) => ({ id: e.id, partnerId: e.partner_id, vendor: vname(e.partner_id).name, categoryId: e.category_id, category: catName(e.category_id).name, region: e.region_code, status: e.avl_status, statusLabel: AVL_STATUS[e.avl_status], validFrom: e.valid_from, validUntil: e.valid_until, expired: Boolean(e.valid_until && e.valid_until < todayIST()), conditions: e.conditions, suspendedReason: e.suspended_reason, prequalId: e.prequal_id });
  const checkPreq = (companyId, b, existing = null) => {
    const problems = []; const cats = b.categoryIds ?? json(existing?.category_ids_json, []);
    for (const [i, id] of cats.entries()) if (!db.prepare('SELECT 1 FROM mdm_item_categories WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, companyId)) problems.push({ field: `categoryIds.${i}`, message: 'Not a category of this company' });
    if (b.answers) { const seen = new Set(); b.answers.forEach((a, i) => { if (!SECTIONS.some((s) => s.code === a.section)) problems.push({ field: `answers.${i}.section`, message: 'Not a section of the questionnaire' }); if (seen.has(a.section)) problems.push({ field: `answers.${i}.section`, message: 'Scored twice' }); seen.add(a.section); }); }
    if (b.visitDate && b.visitDate > todayIST()) problems.push({ field: 'visitDate', message: 'The visit date is not in the future' }); fail(problems);
  };
  const preqs = {
    list(actor, query) { const sc = scope(actor, 'proc.prequalification.view'); return runList(db, preqList, parseListRequest(preqList, query), { select: 'x.*', scopeSql: sc.sql, params: sc.params, tieBreaker: 'x.id', map: (x) => ({ id: x.id, docNo: x.doc_no, vendor: vname(x.partner_id).name, date: x.doc_date, score: x.score / PCT, result: x.result, resultLabel: RESULTS[x.result], validUntil: x.valid_until ?? '', status: x.status, statusLabel: APPROVAL_STATUS[x.status] }) }); },
    exportSource(actor, req) { return preqs.list(actor, { ...req, page: 1, pageSize: 100 }); },
    get: (actor, id) => preqView(actor, preqRow(actor, id), { detail: true }),
    options(actor) { need(actor, 'proc.prequalification.create', 'make a prequalification'); return { sections: SECTIONS, categories: db.prepare('SELECT id, code, name FROM mdm_item_categories WHERE company_id = ? AND deleted_at IS NULL ORDER BY name').all(actor.companyId), vendors: db.prepare("SELECT p.id, p.code, COALESCE(p.trade_name, p.legal_name) AS name, p.partner_status FROM mdm_partners p WHERE p.company_id = ? AND p.deleted_at IS NULL AND p.partner_status IN ('PROSPECT', 'PENDING', 'ACTIVE', 'ON_HOLD') AND EXISTS (SELECT 1 FROM mdm_partner_roles r WHERE r.partner_id = p.id AND r.partner_role IN ('VENDOR', 'SERVICE_PROVIDER', 'SUBCONTRACTOR') AND r.deleted_at IS NULL) ORDER BY name LIMIT 500").all(actor.companyId), thresholds: { qualify: pn(actor.companyId, 'proc.vnd.qualify_at'), conditional: pn(actor.companyId, 'proc.vnd.conditional_at') } }; },
    create(actor, b) {
      need(actor, 'proc.prequalification.create', 'make a prequalification'); const p = vendorOf(actor.companyId, b.partnerId); if (['BLACKLISTED', 'REJECTED', 'INACTIVE'].includes(p.partner_status)) throw unprocessable('A blacklisted, rejected or inactive vendor is not prequalified.'); checkPreq(actor.companyId, b);
      if (db.prepare("SELECT 1 FROM vnd_prequalifications WHERE partner_id = ? AND deleted_at IS NULL AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED')").get(p.id)) throw conflict('This vendor has a prequalification open: finish or cancel it first.');
      const score = questionnaireScore(b.answers); const result = resultOf(score, { qualify: pn(actor.companyId, 'proc.vnd.qualify_at'), conditional: pn(actor.companyId, 'proc.vnd.conditional_at') });
      return transaction(db, () => { const no = number(actor.companyId, actor.user, 'PROC_PREQUAL', 'vnd_prequalifications', 'VPQ'); const id = Number(db.prepare("INSERT INTO vnd_prequalifications (company_id, doc_no, doc_date, partner_id, category_ids_json, regions_json, strategic, questionnaire_json, score, visit_date, visit_notes, result, valid_until, conditions, status, requested_by, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, 'mdm_partner', ?)").run(actor.companyId, no, todayIST(), p.id, JSON.stringify(b.categoryIds), JSON.stringify(b.regions ?? []), b.strategic ? 1 : 0, JSON.stringify(normAnswers(b.answers)), score, b.visitDate ?? null, b.visitNotes ?? null, result, b.validUntil ?? null, b.conditions ?? null, actor.user, actor.user, String(p.id)).lastInsertRowid);
        audit(actor, 'vnd_prequalifications', id, 'create', actor.companyId, { newValues: { docNo: no, vendor: p.id, score } }); return preqs.get(actor, id); });
    },
    update(actor, id, b) {
      const r = preqRow(actor, id, 'proc.prequalification.edit'); if (!EDITABLE.includes(r.status)) throw conflict(`${APPROVAL_STATUS[r.status]}: the prequalification is not changed now. Amend an approved one.`); if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this prequalification; reload it.'); checkPreq(r.company_id, b, r);
      const answers = b.answers ? normAnswers(b.answers) : normAnswers(json(r.questionnaire_json, [])); const score = questionnaireScore(answers); const result = resultOf(score, { qualify: pn(r.company_id, 'proc.vnd.qualify_at'), conditional: pn(r.company_id, 'proc.vnd.conditional_at') }); const pick = (k, col) => (k in b ? b[k] : r[col]);
      db.prepare('UPDATE vnd_prequalifications SET category_ids_json = ?, regions_json = ?, strategic = ?, questionnaire_json = ?, score = ?, result = ?, visit_date = ?, visit_notes = ?, valid_until = ?, conditions = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.categoryIds ? JSON.stringify(b.categoryIds) : r.category_ids_json, b.regions ? JSON.stringify(b.regions) : r.regions_json, 'strategic' in b ? (b.strategic ? 1 : 0) : r.strategic, JSON.stringify(answers), score, result, pick('visitDate', 'visit_date'), pick('visitNotes', 'visit_notes'), pick('validUntil', 'valid_until'), pick('conditions', 'conditions'), actor.user, nowIso(), r.id);
      audit(actor, 'vnd_prequalifications', r.id, 'update', r.company_id); return preqs.get(actor, r.id);
    },
    attachReport(actor, id, fileId) { const r = preqRow(actor, id, 'proc.prequalification.edit'); db.prepare('UPDATE vnd_prequalifications SET visit_report_file_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(fileId, actor.user, nowIso(), r.id); return preqs.get(actor, r.id); },
    importAnswers(actor, id, { rows }) { const r = preqRow(actor, id, 'proc.prequalification.edit'); if (!EDITABLE.includes(r.status)) throw conflict('Scores are loaded into a draft or a returned prequalification.'); return preqs.update(actor, id, { answers: rows }); },
    remove(actor, id) { const r = preqRow(actor, id, 'proc.prequalification.delete'); if (r.status !== 'DRAFT' || r.workflow_instance_id) throw unprocessable('Only a draft that was never sent is deleted. Cancel it instead.'); db.prepare('UPDATE vnd_prequalifications SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, r.id); audit(actor, 'vnd_prequalifications', r.id, 'delete', r.company_id); return { id: r.id, deleted: true }; },
    submit(actor, id) {
      const r = preqRow(actor, id, 'proc.prequalification.submit'); if (!EDITABLE.includes(r.status)) throw unprocessable('Only a draft or a returned prequalification is sent for approval.'); const answers = normAnswers(json(r.questionnaire_json, [])); const problems = [];
      answers.forEach((a, i) => { if (a.score == null) problems.push({ field: `answers.${i}.score`, message: `Score ${SECTIONS[i].label.toLowerCase()}` }); }); if (!json(r.category_ids_json, []).length) problems.push({ field: 'categoryIds', message: 'Choose at least one category' }); if (!r.valid_until) problems.push({ field: 'validUntil', message: 'Say until when the approval is valid' }); else if (r.valid_until <= todayIST()) problems.push({ field: 'validUntil', message: 'The validity is in the past' });
      if (r.strategic && !(r.visit_date && r.visit_notes)) problems.push({ field: 'visitNotes', message: 'A strategic category needs the site or factory visit report' }); fail(problems);
      if (r.result === 'NOT_QUALIFIED') throw unprocessable('The score is below the level for approval: correct the scores after the visit, or cancel this prequalification.');
      return transaction(db, () => { const ctx = { needDir: r.strategic ? 'yes' : 'no' }; if (r.status === 'RETURNED' && r.workflow_instance_id) workflowOf(db).resubmit(actor, r.workflow_instance_id, { comment: 'Corrected', context: ctx }); else { const inst = workflowOf(db).submit(actor, { docType: PREQ_DOC, docId: String(r.id), comment: `${r.doc_no} for ${vname(r.partner_id).name}: ${(r.score / PCT).toFixed(1)}%`.slice(0, 300), context: ctx }); db.prepare('UPDATE vnd_prequalifications SET workflow_instance_id = ? WHERE id = ?').run(inst.id, r.id); }
        db.prepare("UPDATE vnd_prequalifications SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), r.id); audit(actor, 'vnd_prequalifications', r.id, 'submit', r.company_id); return preqs.get(actor, r.id); });
    },
    withdraw(actor, id, { reason }) { const r = preqRow(actor, id); if (r.status !== 'SUBMITTED') throw unprocessable('Only a prequalification waiting for approval is withdrawn.'); if (!same(r.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, r.workflow_instance_id, { comment: reason }); return preqs.get(actor, r.id); },
    cancel(actor, id, { reason }) { const r = preqRow(actor, id, 'proc.prequalification.cancel'); if (!['DRAFT', 'RETURNED', 'SUBMITTED'].includes(r.status)) throw unprocessable('Only a prequalification not yet approved is cancelled.'); return transaction(db, () => { if (r.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, r.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare("UPDATE vnd_prequalifications SET status = 'CANCELLED', cancel_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), r.id); audit(actor, 'vnd_prequalifications', r.id, 'cancel', r.company_id, { reason }); return preqs.get(actor, r.id); }); },
    /** An approved prequalification is renewed or changed by a copy that replaces it when approved (re-evaluation, FR-05). */
    amend(actor, id, { reason }) {
      const r = preqRow(actor, id, 'proc.prequalification.amend'); if (r.status !== 'APPROVED') throw unprocessable('Only an approved prequalification is amended.'); if (db.prepare("SELECT 1 FROM vnd_prequalifications WHERE parent_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL").get(r.id)) throw conflict('An amendment of this prequalification is already open.');
      return transaction(db, () => { const no = `${r.doc_no.split('/R')[0]}/R${r.revision_no + 1}`; const nid = Number(db.prepare("INSERT INTO vnd_prequalifications (company_id, doc_no, doc_date, partner_id, category_ids_json, regions_json, strategic, questionnaire_json, score, visit_date, visit_notes, visit_report_file_id, result, valid_until, conditions, status, revision_no, parent_id, requested_by, created_by, source_type, source_id, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, 'amendment', ?, ?)").run(r.company_id, no, todayIST(), r.partner_id, r.category_ids_json, r.regions_json, r.strategic, r.questionnaire_json, r.score, r.visit_date, r.visit_notes, r.visit_report_file_id, r.result, r.valid_until, r.conditions, r.revision_no + 1, r.id, actor.user, actor.user, String(r.id), reason).lastInsertRowid);
        audit(actor, 'vnd_prequalifications', nid, 'amend', r.company_id, { reason, newValues: { of: r.doc_no } }); return preqs.get(actor, nid); });
    },
    history(actor, id) { const r = preqRow(actor, id); return { approvals: r.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(r.workflow_instance_id) : [], audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'vnd_prequalifications' AND entity_id = ? ORDER BY id").all(String(r.id)) }; },
    print(actor, id) {
      const r = preqRow(actor, id, 'proc.prequalification.print'); const v = preqView(actor, r, { detail: true }); audit(actor, 'vnd_prequalifications', r.id, 'print', r.company_id); const columns = [['section', 'Section'], ['weight', 'Weight'], ['score', 'Score'], ['note', 'Note']].map(([key, label]) => ({ key, label, type: 'text' })); const rows = v.answers.map((a) => ({ section: a.label, weight: `${a.weight}%`, score: a.score == null ? '' : String(a.score), note: a.note ?? '' }));
      return { buffer: toPdf({ columns, rows, footer: [`${v.docNo}: ${v.vendor} (${v.vendorCode})`, `Categories: ${v.categories.map((c) => c.name).join(', ')}`, `Score ${(v.score / PCT).toFixed(1)}%: ${v.resultLabel}; valid until ${v.validUntil ?? 'not set'}`, v.visitDate ? `Visit on ${v.visitDate}: ${v.visitNotes ?? ''}` : 'No visit recorded', v.approvedBy ? `Approved by ${v.approvedBy}` : 'Not approved'], title: `Prequalification ${v.docNo}` }), contentType: 'application/pdf', fileName: `${v.docNo.replaceAll('/', '-')}.pdf`, rows: rows.length };
    },
    /** The approval puts the vendor on the AVL for every category and region (an earlier entry, suspended or not, is replaced), conditional when the result says so. */
    decide(instance, actor, outcome, comment) {
      const r = db.prepare('SELECT * FROM vnd_prequalifications WHERE id = ?').get(rid(instance.docId)); if (!r || r.status !== 'SUBMITTED') return; const now = nowIso(); const today = todayIST();
      if (outcome === 'APPROVED') {
        db.prepare("UPDATE vnd_prequalifications SET status = 'APPROVED', approved_by = ?, approved_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, actor.user, now, r.id); if (r.parent_id) db.prepare("UPDATE vnd_prequalifications SET status = 'SUPERSEDED', updated_at = ?, version = version + 1 WHERE id = ? AND status = 'APPROVED'").run(now, r.parent_id);
        const st = r.result === 'CONDITIONAL' ? 'CONDITIONAL' : 'APPROVED'; const regions = json(r.regions_json, []).length ? json(r.regions_json, []) : ['ALL']; const cats = json(r.category_ids_json, []); const made = [];
        for (const c of cats) for (const reg of regions) { const ex = db.prepare('SELECT id FROM vnd_avl WHERE company_id = ? AND partner_id = ? AND category_id = ? AND region_code = ?').get(r.company_id, r.partner_id, c, reg);
          if (ex) db.prepare('UPDATE vnd_avl SET avl_status = ?, valid_from = ?, valid_until = ?, prequal_id = ?, conditions = ?, suspended_reason = NULL, suspended_on = NULL, reminded_for = NULL, deleted_at = NULL, is_active = 1, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(st, today, r.valid_until, r.id, r.conditions, actor.user, now, ex.id);
          else db.prepare("INSERT INTO vnd_avl (company_id, partner_id, category_id, region_code, avl_status, valid_from, valid_until, prequal_id, conditions, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'vnd_prequalification', ?)").run(r.company_id, r.partner_id, c, reg, st, today, r.valid_until, r.id, r.conditions, actor.user, String(r.id)); made.push({ categoryId: c, region: reg }); }
        audit(actor, 'vnd_prequalifications', r.id, 'approve', r.company_id, { newValues: { avl: made.length } }); evt('proc.vendor.avl_updated', actor, r.company_id, 'vnd_prequalification', r.id, { prequalId: r.id, docNo: r.doc_no, partnerId: r.partner_id, status: st, validUntil: r.valid_until, entries: made });
        notify(r.company_id, 'proc.vnd.decided', [`user:${r.requested_by}`, 'role:PROCMGR|PROCIC'], r.doc_no, 'approved', `${vname(r.partner_id).name} is on the approved vendor list (${made.length} entr${made.length === 1 ? 'y' : 'ies'}), valid until ${r.valid_until}.`, `/proc/prequalifications?id=${r.id}`, r.id); return;
      }
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN'; const to = outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED'; db.prepare('UPDATE vnd_prequalifications SET status = ?, workflow_instance_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, withdrawn ? null : r.workflow_instance_id, actor.user, now, r.id); audit(actor, 'vnd_prequalifications', r.id, outcome.toLowerCase(), r.company_id, { reason: comment });
      if (outcome === 'REJECTED') notify(r.company_id, 'proc.vnd.decided', [`user:${r.requested_by}`], r.doc_no, 'not approved', `The prequalification of ${vname(r.partner_id).name} was not approved${comment ? `: ${comment}` : ''}.`, `/proc/prequalifications?id=${r.id}`, r.id);
    },
  };

  // ---- the approved vendor list (FR-02) ----------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const avl = {
    list(actor, query) { const sc = scope(actor, 'proc.avl.view'); return runList(db, avlList, parseListRequest(avlList, query), { select: 'x.*', scopeSql: sc.sql, params: sc.params, tieBreaker: 'x.id', map: (x) => { const v = avlView(x); return { id: x.id, partnerId: x.partner_id, vendor: v.vendor, category: v.category, region: v.region, avlStatus: v.status, statusLabel: v.statusLabel, validUntil: v.validUntil ?? '', expired: v.expired, status: v.expired && v.status !== 'SUSPENDED' ? 'EXPIRED' : v.status }; } }); },
    exportSource(actor, req) { return avl.list(actor, { ...req, page: 1, pageSize: 100 }); },
    /** FR-02: is the vendor allowed for the category (and region) today, and why not. */
    check(actor, partnerId, categoryId, region = null) { need(actor, 'proc.avl.view', 'see the approved vendor list'); const today = todayIST(); const es = db.prepare('SELECT * FROM vnd_avl WHERE company_id = ? AND partner_id = ? AND category_id = ? AND deleted_at IS NULL').all(actor.companyId, rid(partnerId), rid(categoryId)).filter((e) => !region || e.region_code === 'ALL' || e.region_code === region); const ok = es.find((e) => validEntry(e, today)); return { allowed: Boolean(ok), status: ok?.avl_status ?? es[0]?.avl_status ?? null, reason: ok ? null : !es.length ? 'Not on the approved vendor list' : es.every((e) => e.avl_status === 'SUSPENDED') ? 'Suspended' : 'The approval has expired' }; },
  };

  // ---- suspension (FR-05): suggested by the system or proposed by people, approved by procurement and the direction ------------------------------------------------------------------------------------------------
  const suspView = (actor, r, { detail = false } = {}) => {
    const can = (k) => may(actor, k); const own = same(r.requested_by, actor.user); const ids = json(r.avl_ids_json, []);
    const o = { id: r.id, docNo: r.doc_no, date: r.doc_date, partnerId: r.partner_id, vendor: vname(r.partner_id).name, reason: r.reason, autoSuggested: Boolean(r.auto_suggested), scorecardId: r.scorecard_id, avlIds: ids, status: r.status, statusLabel: APPROVAL_STATUS[r.status], requestedBy: r.requested_by, approvedBy: r.approved_by, workflowInstanceId: r.workflow_instance_id, cancelReason: r.cancel_reason, rowVersion: r.version,
      can: { submit: can('proc.avl.suspend') && EDITABLE.includes(r.status), withdraw: r.status === 'SUBMITTED' && own, approve: can('proc.avl.approve') && r.status === 'SUBMITTED' && !own, cancel: can('proc.avl.suspend') && ['DRAFT', 'RETURNED', 'SUBMITTED'].includes(r.status) } };
    if (detail) { o.entries = ids.length ? db.prepare(`SELECT * FROM vnd_avl WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids).map(avlView) : []; if (o.can.approve && r.workflow_instance_id) o.taskId = workflowOf(db).listTasks(actor, { mine: 'assigned', limit: 200 }).rows.find((t) => t.instance?.id === r.workflow_instance_id)?.id ?? null; }
    return o;
  };
  const suspensions = {
    list(actor, query) { const sc = scope(actor, 'proc.avl.view'); return runList(db, suspList, parseListRequest(suspList, query), { select: 'x.*', scopeSql: sc.sql, params: sc.params, tieBreaker: 'x.id', map: (x) => ({ id: x.id, docNo: x.doc_no, vendor: vname(x.partner_id).name, date: x.doc_date, auto: x.auto_suggested ? 'YES' : 'NO', status: x.status, statusLabel: APPROVAL_STATUS[x.status] }) }); },
    get: (actor, id) => suspView(actor, suspRow(actor, id), { detail: true }),
    create(actor, b, { auto = false, scorecardId = null } = {}) {
      if (!auto) need(actor, 'proc.avl.suspend', 'propose a suspension'); const p = vendorOf(actor.companyId, b.partnerId); const today = todayIST();
      const entries = db.prepare("SELECT * FROM vnd_avl WHERE company_id = ? AND partner_id = ? AND deleted_at IS NULL AND avl_status <> 'SUSPENDED'").all(actor.companyId, p.id).filter((e) => !b.avlIds?.length || b.avlIds.includes(e.id)); if (!entries.length) throw unprocessable('This vendor has no active entry on the approved vendor list to suspend.');
      if (db.prepare("SELECT 1 FROM vnd_suspensions WHERE partner_id = ? AND deleted_at IS NULL AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED')").get(p.id)) throw conflict('A suspension of this vendor is open already.');
      return transaction(db, () => { const no = number(actor.companyId, actor.user, 'PROC_AVLSUSP', 'vnd_suspensions', 'VSP'); const id = Number(db.prepare("INSERT INTO vnd_suspensions (company_id, doc_no, doc_date, partner_id, avl_ids_json, reason, auto_suggested, scorecard_id, status, requested_by, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?)").run(actor.companyId, no, today, p.id, JSON.stringify(entries.map((e) => e.id)), b.reason, auto ? 1 : 0, scorecardId, actor.user, actor.user, auto ? 'vnd_scorecard' : 'api', scorecardId ? String(scorecardId) : null).lastInsertRowid);
        audit(actor, 'vnd_suspensions', id, auto ? 'suggest' : 'create', actor.companyId, { newValues: { docNo: no, vendor: p.id } }); if (auto) notify(actor.companyId, 'proc.vnd.suspend', ['role:PROCMGR|PROCIC'], no, vname(p.id).name, b.reason, `/proc/avl?suspension=${id}`, id);
        return suspView(actor, db.prepare('SELECT * FROM vnd_suspensions WHERE id = ?').get(id), { detail: true }); });
    },
    submit(actor, id) {
      const r = suspRow(actor, id, 'proc.avl.suspend'); if (!EDITABLE.includes(r.status)) throw unprocessable('Only a draft or a returned suspension is sent for approval.');
      return transaction(db, () => { db.prepare('UPDATE vnd_suspensions SET requested_by = ? WHERE id = ?').run(actor.user, r.id); if (r.status === 'RETURNED' && r.workflow_instance_id) workflowOf(db).resubmit(actor, r.workflow_instance_id, { comment: 'Corrected', context: {} }); else { const inst = workflowOf(db).submit(actor, { docType: SUSP_DOC, docId: String(r.id), comment: `${r.doc_no}: ${vname(r.partner_id).name}`.slice(0, 300), context: {} }); db.prepare('UPDATE vnd_suspensions SET workflow_instance_id = ? WHERE id = ?').run(inst.id, r.id); }
        db.prepare("UPDATE vnd_suspensions SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), r.id); audit(actor, 'vnd_suspensions', r.id, 'submit', r.company_id); return suspensions.get(actor, r.id); });
    },
    withdraw(actor, id, { reason }) { const r = suspRow(actor, id); if (r.status !== 'SUBMITTED') throw unprocessable('Only a suspension waiting for approval is withdrawn.'); if (!same(r.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, r.workflow_instance_id, { comment: reason }); return suspensions.get(actor, r.id); },
    cancel(actor, id, { reason }) { const r = suspRow(actor, id, 'proc.avl.suspend'); if (!['DRAFT', 'RETURNED', 'SUBMITTED'].includes(r.status)) throw unprocessable('Only a suspension not yet approved is cancelled.'); return transaction(db, () => { if (r.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, r.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare("UPDATE vnd_suspensions SET status = 'CANCELLED', cancel_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), r.id); audit(actor, 'vnd_suspensions', r.id, 'cancel', r.company_id, { reason }); return suspensions.get(actor, r.id); }); },
    history(actor, id) { const r = suspRow(actor, id); return { approvals: r.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(r.workflow_instance_id) : [], audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'vnd_suspensions' AND entity_id = ? ORDER BY id").all(String(r.id)) }; },
    decide(instance, actor, outcome, comment) {
      const r = db.prepare('SELECT * FROM vnd_suspensions WHERE id = ?').get(rid(instance.docId)); if (!r || r.status !== 'SUBMITTED') return; const now = nowIso();
      if (outcome === 'APPROVED') {
        db.prepare("UPDATE vnd_suspensions SET status = 'APPROVED', approved_by = ?, approved_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, actor.user, now, r.id); const ids = json(r.avl_ids_json, []);
        for (const id of ids) db.prepare("UPDATE vnd_avl SET avl_status = 'SUSPENDED', suspended_reason = ?, suspended_on = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(r.reason, todayIST(), actor.user, now, id);
        audit(actor, 'vnd_suspensions', r.id, 'approve', r.company_id, { newValues: { entries: ids.length } }); evt('proc.vendor.suspended', actor, r.company_id, 'vnd_suspension', r.id, { suspensionId: r.id, docNo: r.doc_no, partnerId: r.partner_id, avlIds: ids, reason: r.reason });
        notify(r.company_id, 'proc.vnd.decided', [`user:${r.requested_by}`, 'role:PROCMGR|PROCIC'], r.doc_no, 'approved', `${vname(r.partner_id).name} is suspended on the approved vendor list: it is not sent enquiries.`, `/proc/avl?suspension=${r.id}`, r.id); return;
      }
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN'; const to = outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED'; db.prepare('UPDATE vnd_suspensions SET status = ?, workflow_instance_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, withdrawn ? null : r.workflow_instance_id, actor.user, now, r.id); audit(actor, 'vnd_suspensions', r.id, outcome.toLowerCase(), r.company_id, { reason: comment });
    },
  };

  // ---- scorecards (FR-03) --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  function gather(companyId, partnerId, period) {
    const range = periodRange(period); const { from, to } = range; const ev = {};
    const receipts = db.prepare('SELECT t.id, t.grn_ref, t.qty, t.accepted_qty, t.on_time FROM proc_po_receipts t JOIN proc_purchase_orders o ON o.id = t.po_id WHERE o.company_id = ? AND o.vendor_id = ? AND t.deleted_at IS NULL AND t.received_on BETWEEN ? AND ? ORDER BY t.id').all(companyId, partnerId, from, to);
    ev.delivery = { receipts: receipts.map((x) => ({ id: x.id, grn: x.grn_ref, onTime: Boolean(x.on_time) })) }; ev.quality = { receipts: receipts.map((x) => ({ id: x.id, qty: x.qty, accepted: x.accepted_qty })), input: null };
    const input = (kind) => { const x = db.prepare('SELECT id, value_pct, note, created_by FROM vnd_score_inputs WHERE company_id = ? AND partner_id = ? AND period = ? AND kind = ? AND deleted_at IS NULL ORDER BY id DESC').get(companyId, partnerId, period, kind); return x ? { id: x.id, value: x.value_pct, note: x.note, by: x.created_by } : null; };
    if (!receipts.length) ev.quality.input = input('QUALITY'); ev.safety = input('SAFETY'); ev.invoice = input('INVOICE_ACCURACY');
    const lines = db.prepare("SELECT cl.id, cl.rank_no, cl.rfq_line_id, cl.cs_id, (SELECT COUNT(DISTINCT c2.vendor_id) FROM proc_cs_lines c2 WHERE c2.cs_id = cl.cs_id AND c2.rfq_line_id = cl.rfq_line_id AND c2.deleted_at IS NULL) AS n FROM proc_cs_lines cl JOIN proc_comparative_statements s ON s.id = cl.cs_id WHERE s.company_id = ? AND cl.vendor_id = ? AND cl.deleted_at IS NULL AND s.status IN ('APPROVED', 'SUPERSEDED') AND substr(s.approved_at, 1, 10) BETWEEN ? AND ? ORDER BY cl.id").all(companyId, partnerId, from, to);
    ev.price = { lines: lines.map((x) => ({ id: x.id, csId: x.cs_id, rank: x.rank_no, n: x.n })) };
    const rv = db.prepare("SELECT rv.id, rv.response_status, rv.sent_at, rv.responded_at FROM proc_rfq_vendors rv JOIN proc_rfqs r ON r.id = rv.rfq_id WHERE r.company_id = ? AND rv.vendor_id = ? AND rv.deleted_at IS NULL AND rv.sent_at IS NOT NULL AND substr(rv.sent_at, 1, 10) BETWEEN ? AND ? ORDER BY rv.id").all(companyId, partnerId, from, to);
    const answered = rv.filter((x) => ['RESPONDED', 'DECLINED'].includes(x.response_status)); const hrs = answered.filter((x) => x.responded_at).map((x) => (Date.parse(x.responded_at) - Date.parse(x.sent_at)) / 3_600_000).filter((h) => h >= 0);
    ev.response = { invited: rv.length, answered: answered.length, avgHours: hrs.length ? Math.round((hrs.reduce((a, b) => a + b, 0) / hrs.length) * 10) / 10 : null, ids: rv.map((x) => x.id) };
    return ev;
  }
  const scoreView = (actor, r, { detail = false } = {}) => {
    const w = json(r.weights_json, {}); const o = { id: r.id, partnerId: r.partner_id, vendor: vname(r.partner_id).name, vendorCode: vname(r.partner_id).code, period: r.period, periodFrom: r.period_from, periodTo: r.period_to, metrics: { onTime: r.on_time_pct, quality: r.quality_pct, price: r.price_score, response: r.responsiveness, safety: r.safety_score, invoice: r.invoice_accuracy }, weights: w, total: r.total_score, rating: r.rating, computedAt: r.computed_at, computedBy: r.computed_by };
    if (detail) o.evidence = json(r.evidence_json, {}); return o;
  };
  const scores = {
    supplierList(scope) {
      if (scope.projectId !== null || scope.siteId !== null) throw notFound('The supplier scorecard is unavailable for this grant.');
      audit({ user: `portal-supplier:${scope.accountId}` }, 'vnd_scorecards', 0, 'supplier_list', scope.companyId);
      return db.prepare(`SELECT period, total_score, rating, on_time_pct, quality_pct, responsiveness, safety_score, invoice_accuracy
        FROM vnd_scorecards WHERE company_id = ? AND partner_id = ? AND deleted_at IS NULL AND is_active = 1
        ORDER BY period_to DESC, id DESC LIMIT 50`).all(scope.companyId, scope.partnerId).map((r) => {
        const pct = (value) => value == null ? null : value / PCT;
        return { period: r.period, total: pct(r.total_score), rating: r.rating, onTime: pct(r.on_time_pct),
          quality: pct(r.quality_pct), responsiveness: pct(r.responsiveness), safety: pct(r.safety_score), invoiceAccuracy: pct(r.invoice_accuracy) };
      });
    },
    list(actor, query) { const sc = scope(actor, 'proc.vendor_score.view'); return runList(db, scoreList, parseListRequest(scoreList, query), { select: 'x.*', scopeSql: sc.sql, params: sc.params, tieBreaker: 'x.id', map: (x) => ({ id: x.id, partnerId: x.partner_id, vendor: vname(x.partner_id).name, period: x.period, total: x.total_score == null ? null : x.total_score / PCT, rating: x.rating }) }); },
    exportSource(actor, req) { return scores.list(actor, { ...req, page: 1, pageSize: 100 }); },
    get(actor, id) { need(actor, 'proc.vendor_score.view', 'see scorecards'); const r = db.prepare('SELECT * FROM vnd_scorecards WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!r) throw notFound('That scorecard does not exist.'); return scoreView(actor, r, { detail: true }); },
    /** FR-03: works the scorecard of a vendor for a period from the evidence and stores both. A score below the threshold suggests a suspension (FR-05). */
    compute(actor, partnerId, period, { auto = false } = {}) {
      if (!auto) need(actor, 'proc.vendor_score.compute', 'compute a scorecard'); const p = vendorOf(actor.companyId, partnerId); if (!periodRange(period)) throw unprocessable('Use a period such as 2026-Q3 or 2026-09.'); const { to } = periodRange(period); if (to >= todayIST() && !auto) { /* an open period is allowed: it is a running score */ }
      const ev = gather(actor.companyId, p.id, period); const m = metricsFromEvidence(ev); const w = weights(actor.companyId); const total = compose(m, w); const rating = ratingOf(total, bands(actor.companyId)); const r0 = periodRange(period); const now = nowIso();
      return transaction(db, () => {
        const ex = db.prepare('SELECT id FROM vnd_scorecards WHERE company_id = ? AND partner_id = ? AND period = ?').get(actor.companyId, p.id, period);
        if (ex) db.prepare('UPDATE vnd_scorecards SET on_time_pct = ?, quality_pct = ?, price_score = ?, responsiveness = ?, safety_score = ?, invoice_accuracy = ?, weights_json = ?, evidence_json = ?, total_score = ?, rating = ?, computed_at = ?, computed_by = ?, deleted_at = NULL, is_active = 1, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(m.onTime, m.quality, m.price, m.response, m.safety, m.invoice, JSON.stringify(w), JSON.stringify(ev), total, rating, now, actor.user, actor.user, now, ex.id);
        else db.prepare("INSERT INTO vnd_scorecards (company_id, partner_id, period, period_from, period_to, on_time_pct, quality_pct, price_score, responsiveness, safety_score, invoice_accuracy, weights_json, evidence_json, total_score, rating, computed_at, computed_by, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'calculation')").run(actor.companyId, p.id, period, r0.from, r0.to, m.onTime, m.quality, m.price, m.response, m.safety, m.invoice, JSON.stringify(w), JSON.stringify(ev), total, rating, now, actor.user, actor.user);
        const row = db.prepare('SELECT * FROM vnd_scorecards WHERE company_id = ? AND partner_id = ? AND period = ?').get(actor.companyId, p.id, period); audit(actor, 'vnd_scorecards', row.id, 'compute', actor.companyId, { newValues: { period, total, rating } });
        evt('proc.vendor.scorecard_computed', actor, actor.companyId, 'vnd_scorecard', row.id, { scorecardId: row.id, partnerId: p.id, period, total, rating });
        let suggestion = null; const below = pn(actor.companyId, 'proc.vnd.suspend_below') * PCT;
        if (total != null && total < below && db.prepare("SELECT 1 FROM vnd_avl WHERE company_id = ? AND partner_id = ? AND deleted_at IS NULL AND avl_status <> 'SUSPENDED'").get(actor.companyId, p.id) && !db.prepare("SELECT 1 FROM vnd_suspensions WHERE partner_id = ? AND deleted_at IS NULL AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED')").get(p.id)) {
          try { suggestion = suspensions.create({ user: 'system', companyId: actor.companyId, roles: ['SYSTEM'] }, { partnerId: p.id, reason: `The scorecard of ${period} is ${(total / PCT).toFixed(1)}%, below the ${pn(actor.companyId, 'proc.vnd.suspend_below')}% that suggests suspension.` }, { auto: true, scorecardId: row.id })?.id ?? null; } catch { suggestion = null; }
        }
        return { ...scoreView(actor, row, { detail: true }), suggestionId: suggestion };
      });
    },
    computeAll(companyId, period, user = 'system') {
      const ids = new Set([...db.prepare('SELECT DISTINCT partner_id FROM vnd_avl WHERE company_id = ? AND deleted_at IS NULL').all(companyId).map((x) => x.partner_id), ...db.prepare('SELECT DISTINCT vendor_id FROM proc_purchase_orders WHERE company_id = ? AND deleted_at IS NULL').all(companyId).map((x) => x.vendor_id)]); let n = 0;
      for (const id of ids) { try { vendorOf(companyId, id); scores.compute({ user, companyId, roles: ['SYSTEM'] }, id, period, { auto: true }); n += 1; } catch { /* a partner that is not a vendor */ } } return n;
    },
    /** A quality (inspection), safety or invoice-accuracy value for a period, entered by quality or safety people: kept, never overwritten (the latest counts). */
    input(actor, b) {
      need(actor, 'proc.vendor_score.input', 'enter a score input'); const p = vendorOf(actor.companyId, b.partnerId); if (!periodRange(b.period)) fail([{ field: 'period', message: 'Use a period such as 2026-Q3 or 2026-09' }]);
      const id = Number(db.prepare("INSERT INTO vnd_score_inputs (company_id, partner_id, period, kind, value_pct, note, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, 'api')").run(actor.companyId, p.id, b.period, b.kind, Math.round(b.value * PCT), b.note ?? null, actor.user).lastInsertRowid); audit(actor, 'vnd_score_inputs', id, 'create', actor.companyId, { newValues: { kind: b.kind, value: b.value, period: b.period } });
      return scores.partner(actor, p.id);
    },
    /** Everything about one vendor: its AVL entries, the scorecards over time (the trend), inputs and actions. */
    partner(actor, partnerId) {
      need(actor, 'proc.vendor_score.view', 'see scorecards'); const p = vendorOf(actor.companyId, partnerId);
      return { partner: { id: p.id, ...vname(p.id), status: p.partner_status }, avl: db.prepare('SELECT * FROM vnd_avl WHERE company_id = ? AND partner_id = ? AND deleted_at IS NULL ORDER BY id').all(actor.companyId, p.id).map(avlView),
        scorecards: db.prepare('SELECT * FROM vnd_scorecards WHERE company_id = ? AND partner_id = ? AND deleted_at IS NULL ORDER BY period_to DESC LIMIT 12').all(actor.companyId, p.id).map((r) => scoreView(actor, r, { detail: true })),
        inputs: db.prepare('SELECT * FROM vnd_score_inputs WHERE company_id = ? AND partner_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 30').all(actor.companyId, p.id).map((x) => ({ id: x.id, period: x.period, kind: x.kind, kindLabel: INPUT_KINDS[x.kind], value: x.value_pct, note: x.note, by: x.created_by, at: x.created_at })),
        actions: db.prepare('SELECT * FROM vnd_actions WHERE company_id = ? AND partner_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 30').all(actor.companyId, p.id).map((a) => actView(actor, a)),
        suspensions: db.prepare('SELECT * FROM vnd_suspensions WHERE company_id = ? AND partner_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 10').all(actor.companyId, p.id).map((s) => suspView(actor, s)),
        can: { compute: may(actor, 'proc.vendor_score.compute'), input: may(actor, 'proc.vendor_score.input'), act: may(actor, 'proc.vendor_action.create'), suspend: may(actor, 'proc.avl.suspend') } };
    },
    /** The vendors of a category ranked by their score of a period (the latest when none is named); vendors on the list without a score come last. */
    ranking(actor, { categoryId, period = null }) {
      need(actor, 'proc.vendor_score.view', 'see the vendor ranking'); const categories = db.prepare('SELECT id, code, name FROM mdm_item_categories WHERE company_id = ? AND deleted_at IS NULL ORDER BY name').all(actor.companyId); if (!categoryId) return { categories, category: null, period: null, periods: db.prepare('SELECT DISTINCT period FROM vnd_scorecards WHERE company_id = ? AND deleted_at IS NULL ORDER BY period DESC LIMIT 12').all(actor.companyId).map((x) => x.period), rows: [] }; const cat = db.prepare('SELECT id, code, name FROM mdm_item_categories WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(categoryId), actor.companyId); if (!cat) throw notFound('That category does not exist.');
      const periods = db.prepare('SELECT DISTINCT period FROM vnd_scorecards WHERE company_id = ? AND deleted_at IS NULL ORDER BY period DESC LIMIT 12').all(actor.companyId).map((x) => x.period); const use = period ?? periods[0] ?? null; const today = todayIST();
      const rows = db.prepare('SELECT * FROM vnd_avl WHERE company_id = ? AND category_id = ? AND deleted_at IS NULL').all(actor.companyId, cat.id); const byVendor = new Map();
      for (const e of rows) { const cur = byVendor.get(e.partner_id) ?? { partnerId: e.partner_id, regions: [], status: e.avl_status, valid: false }; cur.regions.push(e.region_code); cur.valid ||= validEntry(e, today); if (e.avl_status === 'SUSPENDED' && !cur.valid) cur.status = 'SUSPENDED'; else if (cur.status === 'SUSPENDED' && e.avl_status !== 'SUSPENDED') cur.status = e.avl_status; byVendor.set(e.partner_id, cur); }
      const list = [...byVendor.values()].map((v) => { const s = use ? db.prepare('SELECT * FROM vnd_scorecards WHERE company_id = ? AND partner_id = ? AND period = ? AND deleted_at IS NULL').get(actor.companyId, v.partnerId, use) : null; return { partnerId: v.partnerId, vendor: vname(v.partnerId).name, regions: v.regions, avlStatus: v.status, valid: v.valid, scorecardId: s?.id ?? null, total: s?.total_score ?? null, rating: s?.rating ?? 'NA', onTime: s?.on_time_pct ?? null, quality: s?.quality_pct ?? null, price: s?.price_score ?? null, rank: /** @type {number | null} */ (null) }; })
        .sort((a, b) => (b.total ?? -1) - (a.total ?? -1) || a.vendor.localeCompare(b.vendor)); let rank = 0; let prev = null; let seen = 0; for (const x of list) { seen += 1; if (x.total != null) { if (x.total !== prev) { rank = seen; prev = x.total; } x.rank = rank; } else x.rank = null; }
      return { categories, category: cat, period: use, periods, rows: list };
    },
  };

  // ---- performance reviews, corrective actions and development notes (FR-04) -------------------------------------------------------------------------------------------------------------------------------
  const actView = (actor, a) => ({ id: a.id, docNo: a.doc_no, partnerId: a.partner_id, vendor: vname(a.partner_id).name, scorecardId: a.scorecard_id, kind: a.kind, title: a.title, detail: a.detail, owner: a.owner_user, dueDate: a.due_date, status: a.action_status, response: a.response, closedBy: a.closed_by, closedAt: a.closed_at, overdue: a.action_status === 'OPEN' && Boolean(a.due_date) && a.due_date < todayIST(), rowVersion: a.version,
    can: { respond: may(actor, 'proc.vendor_action.edit') && a.action_status === 'OPEN', close: may(actor, 'proc.vendor_action.close') && ['OPEN', 'RESPONDED'].includes(a.action_status) } });
  const acts = {
    create(actor, b) {
      need(actor, 'proc.vendor_action.create', 'record a vendor action'); const p = vendorOf(actor.companyId, b.partnerId); if (b.scorecardId && !db.prepare('SELECT 1 FROM vnd_scorecards WHERE id = ? AND company_id = ? AND partner_id = ?').get(b.scorecardId, actor.companyId, p.id)) fail([{ field: 'scorecardId', message: 'Not a scorecard of this vendor' }]);
      if (b.kind === 'CAR' && !b.dueDate) fail([{ field: 'dueDate', message: 'A corrective action request needs a due date' }]); if (b.dueDate && b.dueDate < todayIST()) fail([{ field: 'dueDate', message: 'The due date has passed' }]);
      const no = number(actor.companyId, actor.user, 'PROC_VENDOR_ACTION', 'vnd_actions', 'VCA'); const id = Number(db.prepare("INSERT INTO vnd_actions (company_id, doc_no, partner_id, scorecard_id, kind, title, detail, owner_user, due_date, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(actor.companyId, no, p.id, b.scorecardId ?? null, b.kind, b.title, b.detail ?? null, b.owner ?? null, b.dueDate ?? null, actor.user, b.scorecardId ? 'vnd_scorecard' : 'api', b.scorecardId ? String(b.scorecardId) : null).lastInsertRowid);
      audit(actor, 'vnd_actions', id, 'create', actor.companyId, { newValues: { docNo: no, kind: b.kind } }); if (b.kind === 'CAR' && b.owner) notify(actor.companyId, 'proc.vnd.action', [`user:${b.owner}`], no, vname(p.id).name, `${b.title}: due ${b.dueDate}.`, `/proc/vendor-scorecards?partner=${p.id}`, id); return actView(actor, db.prepare('SELECT * FROM vnd_actions WHERE id = ?').get(id));
    },
    respond(actor, id, { response }) { const a = actRow(actor, id, 'proc.vendor_action.edit'); if (a.action_status !== 'OPEN') throw unprocessable('Only an open action is answered.'); db.prepare("UPDATE vnd_actions SET action_status = 'RESPONDED', response = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(response, actor.user, nowIso(), a.id); audit(actor, 'vnd_actions', a.id, 'respond', a.company_id); return actView(actor, db.prepare('SELECT * FROM vnd_actions WHERE id = ?').get(a.id)); },
    close(actor, id, { note }) { const a = actRow(actor, id, 'proc.vendor_action.close'); if (!['OPEN', 'RESPONDED'].includes(a.action_status)) throw unprocessable('Only an open action is closed.'); if (a.kind === 'CAR' && a.action_status !== 'RESPONDED') throw unprocessable('A corrective action request is closed after the vendor has answered it.'); db.prepare("UPDATE vnd_actions SET action_status = 'CLOSED', closed_by = ?, closed_at = ?, remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), note ?? null, actor.user, nowIso(), a.id); audit(actor, 'vnd_actions', a.id, 'close', a.company_id, { reason: note }); return actView(actor, db.prepare('SELECT * FROM vnd_actions WHERE id = ?').get(a.id)); },
  };

  // ---- FR-05: the daily check ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  /** Reminds procurement of AVL entries that end soon (once for each end date); works out last quarter's scorecards when they are missing. */
  function sweep() {
    let n = 0; const today = todayIST();
    for (const c of db.prepare('SELECT id FROM org_companies').all()) {
      const days = pn(c.id, 'proc.vnd.reeval_days');
      for (const e of db.prepare("SELECT * FROM vnd_avl WHERE company_id = ? AND deleted_at IS NULL AND avl_status <> 'SUSPENDED' AND valid_until IS NOT NULL AND valid_until <= ? AND valid_until >= ? AND (reminded_for IS NULL OR reminded_for <> valid_until)").all(c.id, addDays(today, days), today)) {
        db.prepare('UPDATE vnd_avl SET reminded_for = valid_until WHERE id = ?').run(e.id); notify(c.id, 'proc.vnd.reeval', ['role:PROCMGR|PROCIC'], vname(e.partner_id).name, `${vname(e.partner_id).name}: ${catName(e.category_id).name}`, `The approval ends on ${e.valid_until}: re-evaluate the vendor (amend its prequalification) before then.`, `/proc/avl?partner=${e.partner_id}`, e.id); n += 1;
      }
      const prev = previousQuarter(today); if (!db.prepare('SELECT 1 FROM vnd_scorecards WHERE company_id = ? AND period = ? AND deleted_at IS NULL').get(c.id, prev)) n += scores.computeAll(c.id, prev);
    }
    return n;
  }
  return { preqs, avl, suspensions, scores, acts, sweep, decide: preqs.decide, suspDecide: suspensions.decide };
}
