import { createHash } from 'node:crypto';
import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { writeExport, FORMATS } from '../../platform/export/index.js';
import { HttpError, badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { tasksOf } from '../../platform/tasks/index.js';
import { evidenceProviders, workflowOf, workflowTypes } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { issueNumber } from '../core/numbering/service.js';
import { projectsOf } from './project.js';
import { parseWizard } from './validators.js';
import { BASELINE_DOC, BASELINE_STATUS, CONTRACT_TYPES, DIRECTOR_ABOVE_RUPEES, STATES, esc, json, money, nowIso, num, rid, same } from './constants.js';

// Project creation from an awarded tender and the commercial baseline handover (part 10.02). An awarded tender (08.03, the approved award of the tender) with its approved estimate (09.03) becomes a project in one transaction: the wizard of
// 10.01 makes the project (client, place, contract value, period from the tender and the award), the BOQ of the estimate with its rates is copied into the project, and a baseline pack is drafted. The pack is the frozen commercial baseline:
// the tender, the award, the approved estimate with its costs and margin, the priced BOQ with the resource norms and the productivity behind each rate, the quoted resource rates, the priced risks, the escalation basis, the
// inclusions and exclusions and the key contract clauses. It is frozen with a hash when it is sent for sign-off (estimation, commercial manager, project director, and the director above the limit) and immutable once approved: a
// correction is a superseding pack with a reason and the same approval (BR-01). The handover meeting records who met, what was asked and the actions (tasks of the task service). Costs and margins are shown only to those who hold
// proj.baseline_pack.cost.
export const baselineList = defineList({
  code: 'proj.baseline_packs', label: 'Commercial baseline packs', permission: 'proj.baseline_pack.view',
  from: 'proj_baseline_packs x JOIN org_projects p ON p.id = x.project_id LEFT JOIN tdr_tenders t ON t.id = x.tender_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'p.code', 'p.name', 't.doc_no', 't.name_of_work'], defaultSort: '-docNo',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'Pack' }, packNo: { sql: 'x.pack_no', type: 'number', label: 'Pack no.' }, project: { sql: 'p.code', type: 'text', label: 'Project' }, name: { sql: 'p.name', type: 'text', label: 'Name' }, tender: { sql: 't.doc_no', type: 'text', label: 'Tender' },
    contractValue: { sql: '(x.contract_value / 100.0)', type: 'money', label: 'Contract value (₹)' }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(BASELINE_STATUS) }, signedOffAt: { sql: 'x.signed_off_at', type: 'date', label: 'Signed off' }, docDate: { sql: 'x.doc_date', type: 'date', label: 'Date' },
    projectId: { sql: 'x.project_id', type: 'number', label: 'Project id' },
  },
});

const TYPE_OF_BID = { ITEM_RATE: 'ITEM_RATE', PERCENTAGE: 'ITEM_RATE', LUMP_SUM: 'LUMP_SUM', EPC: 'EPC', HAM: 'HAM' };
const NORM_TYPES = { MATERIAL: 'Material', LABOUR: 'Labour', EQUIPMENT: 'Equipment', TRANSPORT: 'Transport', SUBCONTRACT: 'Subcontract', OTHER: 'Other' };
const addMonths = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCMonth(x.getUTCMonth() + n); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };
const hashOf = (snap) => createHash('sha256').update(JSON.stringify(snap)).digest('hex');
/** The parts of a snapshot that show costs, margins and the rates behind them. */
const COST_KEYS = ['costRate', 'markupPct', 'costAmount', 'norms'];

/** What a later part adds to the "current" side of the baseline report: (db, { projectId, pack }) => { code, label, rows: [{ key, current }] } | null; the budget (12.01) and the forecast (23.11) register theirs. */
export const currentProviders = /** @type {Array<(db: any, ctx: { projectId: number, pack: any }) => { code: string, label: string, rows: Array<{ key: string, current: string | null }> } | null>} */ ([]);

export function createBaselineService({ db }) {
  const authz = authzOf(db);
  const P = () => projectsOf(db);
  const may = (actor, key, projectId = null) => (projectId == null ? authz.check(actor, key).allowed : authz.check(actor, key, { companyId: actor.companyId, projectId }).allowed);
  const need = (actor, key, what, projectId = null) => { if (!may(actor, key, projectId)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const fail = (p) => { if (p.length) throw badRequest('Correct the highlighted fields', p); };
  const event = (type, actor, id, companyId, projectId, data) => publishEvent(db, { type, entity: 'baseline_pack', entityId: id, actorId: actor.user, companyId, projectId, data });
  const scopeSql = (actor) => { const f = authz.scopeFilter(actor, 'proj.baseline_pack.view', { project: 'x.project_id' }); return { sql: `x.company_id = :c AND ${f.sql}`, params: { c: actor.companyId, ...(f.params ?? {}) } }; };
  const orgOf = (id) => db.prepare('SELECT * FROM org_projects WHERE id = ?').get(id);
  const fresh = (id) => db.prepare('SELECT * FROM proj_baseline_packs WHERE id = ?').get(id);
  const nextNo = (actor) => {
    try { return issueNumber(db, { companyId: actor.companyId, docType: BASELINE_DOC, actor: actor.user, refType: 'proj_baseline_packs' }).number; } catch (x) { if (!['DOCUMENT_TYPE_UNKNOWN', 'NUMBER_SERIES_MISSING'].includes(x?.code)) throw x; }
    let k = db.prepare('SELECT COUNT(*) AS n FROM proj_baseline_packs WHERE company_id = ?').get(actor.companyId).n + 1; let no = `BLP-${String(k).padStart(5, '0')}`;
    while (db.prepare('SELECT 1 FROM proj_baseline_packs WHERE company_id = ? AND doc_no = ?').get(actor.companyId, no)) { k += 1; no = `BLP-${String(k).padStart(5, '0')}`; }
    return no;
  };
  const row = (actor, id, key = 'proj.baseline_pack.view') => {
    const x = db.prepare('SELECT * FROM proj_baseline_packs WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
    if (!x || !may(actor, key === 'proj.baseline_pack.view' ? key : 'proj.baseline_pack.view', x.project_id)) throw notFound('That baseline pack does not exist.');
    if (key !== 'proj.baseline_pack.view') need(actor, key, 'do that with the baseline pack', x.project_id);
    return x;
  };

  // ---- the sources of an award (08.03) and its approved estimate (09.03) -------------------------------------------------------------------------
  function sources(companyId, tenderId) {
    const t = db.prepare('SELECT * FROM tdr_tenders WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(tenderId), companyId);
    if (!t) return { t: null, issues: [{ code: 'TENDER', text: 'That tender does not exist.' }] };
    const issues = [];
    if (t.stage !== 'AWARDED') issues.push({ code: 'STAGE', text: `Tender ${t.doc_no} is at stage ${t.stage}: only an awarded tender becomes a project.` });
    const a = db.prepare("SELECT * FROM tdr_awards WHERE tender_id = ? AND outcome = 'WON' AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY id DESC LIMIT 1").get(t.id);
    if (!a) issues.push({ code: 'AWARD', text: 'The award of this tender is not approved yet (08.03).' });
    const e = db.prepare("SELECT * FROM est_estimates WHERE tender_id = ? AND company_id = ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY version_no DESC, id DESC LIMIT 1").get(t.id, companyId);
    if (!e) issues.push({ code: 'ESTIMATE', text: 'The tender has no approved estimate (09.03): the BOQ and the rates cannot be copied.' });
    const existing = db.prepare('SELECT x.id, p.code FROM proj_projects x JOIN org_projects p ON p.id = x.project_id WHERE x.tender_id = ? AND x.deleted_at IS NULL').get(t.id);
    if (existing) issues.push({ code: 'EXISTS', text: `Project ${existing.code} has been set up for this tender already.` });
    return { t, a, e, existing, issues };
  }
  const itemsOf = (estimateId) => db.prepare('SELECT * FROM est_estimate_items WHERE estimate_id = ? AND deleted_at IS NULL ORDER BY sort_order, id').all(estimateId);
  const normsOf = (i) => {
    if (i.build_mode === 'ANALYSIS' && i.analysis_id) {
      const an = db.prepare('SELECT analysis_no, version_no, basis_qty, basis_uom FROM ra_analyses WHERE id = ?').get(i.analysis_id);
      return { basis: an ? `${num(an.basis_qty, 'quantity')} ${an.basis_uom}` : null, ref: an ? `${an.analysis_no}/v${an.version_no}` : null, lines: db.prepare('SELECT l.*, r.source_kind, r.basis_ref FROM ra_analysis_lines l LEFT JOIN ra_resource_rates r ON r.id = l.resource_rate_id WHERE l.analysis_id = ? AND l.deleted_at IS NULL ORDER BY l.line_no').all(i.analysis_id).map((l) => ({ type: l.component_type, description: l.description, uom: l.uom, qtyPer: num(l.qty_per_basis, 'quantity'), wastagePct: num(l.wastage_pct, 'percent'), rate: num(l.rate, 'rate'), amount: money(l.amount), sourceKind: l.source_kind ?? null, sourceRef: l.basis_ref ?? null })) };
    }
    if (i.build_mode === 'MANUAL') return { basis: `1 ${i.uom}`, ref: null, lines: db.prepare('SELECT c.*, r.source_kind, r.basis_ref FROM est_item_components c LEFT JOIN ra_resource_rates r ON r.id = c.resource_rate_id WHERE c.estimate_item_id = ? AND c.deleted_at IS NULL ORDER BY c.line_no').all(i.id).map((l) => ({ type: l.component_type, description: l.description, uom: l.uom, qtyPer: num(l.qty_per_unit, 'quantity'), wastagePct: '0', rate: num(l.rate, 'rate'), amount: money(l.amount), sourceKind: l.source_kind ?? null, sourceRef: l.basis_ref ?? null })) };
    return { basis: null, ref: null, lines: [] };
  }
  /** FR-02: the snapshot of the commercial baseline. Money as text in rupees, quantities and rates as text, so that the pack reads the same for ever. */
  function buildSnapshot(companyId, projectId, s, clauses) {
    const t = s.t; const e = s.e; const a = s.a; const x = db.prepare('SELECT * FROM proj_projects WHERE project_id = ? AND deleted_at IS NULL').get(projectId);
    const bs = db.prepare('SELECT * FROM est_bid_summary WHERE estimate_id = ? AND deleted_at IS NULL').get(e.id);
    const client = db.prepare('SELECT legal_name FROM mdm_partners WHERE id = ?').get(t.client_partner_id);
    const items = itemsOf(e.id);
    const boq = items.map((i) => { const n = normsOf(i); return { itemId: i.id, sectionCode: i.section_code, sectionName: i.section_name, itemNo: i.item_no, description: i.description, uom: i.uom, qty: num(i.qty, 'quantity'), clientRate: num(i.client_rate, 'rate'), buildMode: i.build_mode, costRate: num(i.cost_rate, 'rate'), markupPct: num(i.markup_pct, 'percent'), sellingRate: money(i.selling_rate), costAmount: money(i.cost_amount), amount: money(i.amount), norms: { basis: n.basis, ref: n.ref, lines: n.lines } }; });
    const quoted = new Map();
    for (const b of boq) for (const l of b.norms.lines) { const k = `${l.type}|${l.description}|${l.uom}|${l.rate}`; if (!quoted.has(k)) quoted.set(k, { type: l.type, typeLabel: NORM_TYPES[l.type], description: l.description, uom: l.uom, rate: l.rate, sourceKind: l.sourceKind, sourceRef: l.sourceRef, quoted: l.sourceKind === 'QUOTATION' || l.type === 'SUBCONTRACT', usedIn: [] }); quoted.get(k).usedIn.push(b.itemNo); }
    const grouped = { ASSUMPTION: [], INCLUSION: [], EXCLUSION: [], QUALIFICATION: [] };
    for (const r of db.prepare('SELECT kind, text FROM est_assumptions WHERE estimate_id = ? AND deleted_at IS NULL ORDER BY kind, sort_order, id').all(e.id)) grouped[r.kind]?.push(r.text);
    const g = (k) => ({ pct: num(e[k], 'percent') });
    return {
      builtAt: nowIso(),
      source: {
        tender: { id: t.id, docNo: t.doc_no, nameOfWork: t.name_of_work, client: client?.legal_name ?? null, location: t.location, bidType: t.bid_type, periodMonths: t.period_months, estimatedCost: money(t.est_cost_minor), referenceNo: t.reference_no },
        award: { id: a.id, docNo: a.doc_no, loaNo: a.loa_no, loaDate: a.loa_date, awardedValue: money(a.awarded_value_minor) },
        estimate: { id: e.id, docNo: e.doc_no, versionNo: e.version_no, title: e.title, basisDate: e.basis_date, region: e.region_code, approvedAt: e.approved_at },
      },
      contract: x ? { type: x.contract_type, typeLabel: CONTRACT_TYPES[x.contract_type], no: x.contract_no, value: money(x.contract_value), startDate: x.start_date, scheduledCompletion: x.scheduled_completion, dlpMonths: x.dlp_months, retentionPct: num(x.retention_pct, 'percent'), mobAdvancePct: num(x.mob_advance_pct, 'percent'), ldSummary: x.ld_summary } : null,
      commercials: { directCost: money(e.direct_cost), indirectCost: money(e.indirect_cost), overhead: money(e.overhead_amount), risk: money(e.risk_amount), contingency: money(e.contingency_amount), escalation: money(e.escalation_amount), totalCost: money(e.total_cost), totalSelling: money(e.total_selling), margin: money(e.margin_amount), marginPct: num(e.margin_pct, 'percent'), gst: money(e.gst_amount), bidValue: money(e.bid_value), hoOverheadPct: g('ho_overhead_pct').pct, contingencyPct: g('contingency_pct').pct, escalationPct: g('escalation_pct').pct, gstPct: g('gst_pct').pct, discountPct: bs ? num(bs.discount_pct, 'percent') : '0', discount: bs ? money(bs.discount_amount) : '0.00', netPrice: bs ? money(bs.net_price) : money(e.total_selling), bidPrice: bs ? money(bs.bid_price) : money(e.bid_value) },
      escalation: { pct: num(e.escalation_pct, 'percent'), amount: money(e.escalation_amount), basisDate: e.basis_date, region: e.region_code, note: `Rates of ${e.basis_date}${e.region_code ? ` (${e.region_code})` : ''}; escalation allowed in the cost: ${num(e.escalation_pct, 'percent')} %.` },
      boq, boqTotal: money(items.reduce((s2, i) => s2 + i.amount, 0)), boqCost: money(items.reduce((s2, i) => s2 + i.cost_amount, 0)),
      indirects: db.prepare('SELECT * FROM est_indirects WHERE estimate_id = ? AND deleted_at IS NULL ORDER BY sort_order, id').all(e.id).map((i) => ({ category: i.category, description: i.description, basis: i.basis, amount: money(i.amount) })),
      risks: db.prepare('SELECT * FROM est_risks WHERE estimate_id = ? AND deleted_at IS NULL ORDER BY sort_order, id').all(e.id).map((r) => ({ description: r.description, impact: money(r.impact), probabilityPct: num(r.probability_pct, 'percent'), exposure: money(r.exposure) })),
      assumptions: grouped, quotedRates: [...quoted.values()],
      productivity: boq.filter((b) => b.norms.lines.some((l) => ['LABOUR', 'EQUIPMENT'].includes(l.type))).map((b) => ({ itemNo: b.itemNo, description: b.description, basis: b.norms.basis, outputs: b.norms.lines.filter((l) => ['LABOUR', 'EQUIPMENT'].includes(l.type)).map((l) => ({ type: l.type, description: l.description, uom: l.uom, qtyPer: l.qtyPer })) })),
      clauses: clauses ?? [],
    };
  }
  /** Costs, margins and the rates behind them are shown to those who hold proj.baseline_pack.cost (mask in the API, the print and the exports). */
  function mask(snap, costs) {
    if (costs) return snap;
    const c = snap.commercials ?? {};
    return {
      ...snap, masked: true,
      commercials: { totalSelling: c.totalSelling, gst: c.gst, bidValue: c.bidValue, gstPct: c.gstPct, discountPct: c.discountPct, discount: c.discount, netPrice: c.netPrice, bidPrice: c.bidPrice },
      escalation: { pct: null, amount: null, basisDate: snap.escalation?.basisDate, region: snap.escalation?.region, note: 'Escalation allowance is shown to those who see costs.' },
      boq: (snap.boq ?? []).map((b) => Object.fromEntries(Object.entries(b).filter(([k]) => !COST_KEYS.includes(k)))), boqCost: null, indirects: null, risks: null, quotedRates: null, productivity: null,
    };
  }

  // ---- the project from an award (FR-01) ----------------------------------------------------------------------------------------------------------
  function copyBoq(actor, projectId, e) {
    const ins = db.prepare('INSERT INTO proj_boq_items (company_id, project_id, estimate_item_id, section_code, section_name, item_no, sort_order, description, uom, qty, client_rate, cost_rate, markup_pct, selling_rate, cost_amount, amount, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'est_estimate_items\', ?)');
    let n = 0; for (const i of itemsOf(e.id)) { ins.run(actor.companyId, projectId, i.id, i.section_code, i.section_name, i.item_no, i.sort_order, i.description, i.uom, i.qty, i.client_rate, i.cost_rate, i.markup_pct, i.selling_rate, i.cost_amount, i.amount, actor.user, String(i.id)); n += 1; }
    return n;
  }
  function insertPack(actor, { projectId, s, packNo = 1, supersedesId = null, clauses = [], reason = null, snapshot = null }) {
    const snap = snapshot ?? buildSnapshot(actor.companyId, projectId, s, clauses);
    const x = db.prepare('SELECT contract_value FROM proj_projects WHERE project_id = ? AND deleted_at IS NULL').get(projectId);
    const id = Number(db.prepare("INSERT INTO proj_baseline_packs (company_id, doc_no, doc_date, pack_no, supersedes_id, project_id, tender_id, award_id, estimate_id, contract_value, snapshot_json, clauses_json, status, amend_reason, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, 'tdr_tender', ?)")
      .run(actor.companyId, nextNo(actor), todayIST(), packNo, supersedesId, projectId, s?.t?.id ?? snap.source?.tender?.id ?? null, s?.a?.id ?? snap.source?.award?.id ?? null, s?.e?.id ?? snap.source?.estimate?.id ?? null, x?.contract_value ?? 0, JSON.stringify(snap), JSON.stringify(clauses), reason, actor.user, String(s?.t?.id ?? projectId)).lastInsertRowid);
    writeAudit(db, { entity: 'proj_baseline_packs', entityId: id, action: 'create', newValues: { project: orgOf(projectId)?.code, packNo, supersedes: supersedesId }, reason, actor: actor.user, companyId: actor.companyId });
    return id;
  }
  const costsOf = (actor) => may(actor, 'proj.baseline_pack.cost');
  const fromAward = {
    /** Awarded tenders that have no project yet. */
    candidates(actor) {
      need(actor, 'proj.project.create', 'set projects up');
      return db.prepare("SELECT t.id, t.doc_no, t.name_of_work, t.location, t.client_partner_id, c.legal_name AS client, a.awarded_value_minor, a.loa_no, a.loa_date, (SELECT COUNT(*) FROM est_estimates e WHERE e.tender_id = t.id AND e.status = 'APPROVED' AND e.deleted_at IS NULL) AS estimates FROM tdr_tenders t JOIN tdr_awards a ON a.tender_id = t.id AND a.outcome = 'WON' AND a.status = 'APPROVED' AND a.deleted_at IS NULL LEFT JOIN mdm_partners c ON c.id = t.client_partner_id WHERE t.company_id = ? AND t.stage = 'AWARDED' AND t.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM proj_projects x WHERE x.tender_id = t.id AND x.deleted_at IS NULL) ORDER BY a.loa_date DESC, t.id DESC LIMIT 200").all(actor.companyId)
        .map((r) => ({ tenderId: r.id, tenderNo: r.doc_no, nameOfWork: r.name_of_work, location: r.location, client: r.client, contractValue: money(r.awarded_value_minor), loaNo: r.loa_no, loaDate: r.loa_date, ready: r.estimates > 0 }));
    },
    /** Page 1: what will be copied. */
    preview(actor, tenderId) {
      need(actor, 'proj.project.create', 'set projects up'); const s = sources(actor.companyId, tenderId);
      if (!s.t) throw notFound('That tender does not exist.');
      const c = costsOf(actor); const out = { tender: { id: s.t.id, docNo: s.t.doc_no, nameOfWork: s.t.name_of_work, location: s.t.location, bidType: s.t.bid_type, periodMonths: s.t.period_months, stage: s.t.stage, clientPartnerId: s.t.client_partner_id, client: db.prepare('SELECT legal_name FROM mdm_partners WHERE id = ?').get(s.t.client_partner_id)?.legal_name ?? null }, issues: s.issues, ready: s.issues.length === 0 };
      out.award = s.a ? { id: s.a.id, docNo: s.a.doc_no, loaNo: s.a.loa_no, loaDate: s.a.loa_date, awardedValue: money(s.a.awarded_value_minor) } : null;
      if (s.e) {
        const n = (sql) => db.prepare(sql).get(s.e.id).n; const items = itemsOf(s.e.id);
        out.estimate = { id: s.e.id, ref: `${s.e.doc_no}/v${s.e.version_no}`, title: s.e.title, basisDate: s.e.basis_date, approvedAt: s.e.approved_at, bidValue: money(s.e.bid_value), totalSelling: money(s.e.total_selling), ...(c ? { totalCost: money(s.e.total_cost), margin: money(s.e.margin_amount), marginPct: num(s.e.margin_pct, 'percent') } : {}) };
        out.willCopy = [{ code: 'BOQ', label: 'BOQ items with their quantities and rates', count: items.length }, { code: 'SECTIONS', label: 'BOQ sections', count: new Set(items.map((i) => i.section_code)).size }, { code: 'INDIRECTS', label: 'Indirect cost lines', count: n('SELECT COUNT(*) AS n FROM est_indirects WHERE estimate_id = ? AND deleted_at IS NULL') }, { code: 'RISKS', label: 'Priced risks', count: n('SELECT COUNT(*) AS n FROM est_risks WHERE estimate_id = ? AND deleted_at IS NULL') }, { code: 'ASSUMPTIONS', label: 'Assumptions, inclusions, exclusions and qualifications', count: n('SELECT COUNT(*) AS n FROM est_assumptions WHERE estimate_id = ? AND deleted_at IS NULL') }];
        out.boqTotal = money(items.reduce((a2, i) => a2 + i.amount, 0));
        if (s.a?.awarded_value_minor != null && s.a.awarded_value_minor !== s.e.bid_value) out.differences = [{ code: 'VALUE', text: `The awarded value ₹ ${money(s.a.awarded_value_minor)} differs from the bid value of the estimate ₹ ${money(s.e.bid_value)} (negotiation or a changed scope): the contract value is the awarded value.` }];
      }
      const start = null; out.suggested = { code: s.t.doc_no.replace(/[^A-Za-z0-9._-]/g, '').toUpperCase().slice(0, 30), name: s.t.name_of_work.slice(0, 160), location: s.t.location, contractType: TYPE_OF_BID[s.t.bid_type] ?? 'ITEM_RATE', contractNo: s.a?.loa_no ?? null, contractValue: s.a?.awarded_value_minor == null ? (s.e ? money(s.e.bid_value) : null) : money(s.a.awarded_value_minor), periodMonths: s.t.period_months, startDate: start };
      out.copies = ['client', 'location', 'contract value', 'period', 'BOQ with rates', 'estimate items', 'indirects', 'assumptions'];
      return out;
    },
    /** FR-01, T-01: the project, its BOQ and its draft baseline pack in one transaction; nothing is typed again. */
    create(actor, b) {
      need(actor, 'proj.project.create', 'set projects up'); need(actor, 'proj.baseline_pack.create', 'draft baseline packs');
      const s = sources(actor.companyId, b.tenderId);
      if (!s.t) throw notFound('That tender does not exist.');
      if (s.issues.length) throw unprocessable(`Tender ${s.t.doc_no} cannot become a project yet.`, s.issues.map((i) => ({ field: 'tenderId', message: i.text })));
      const periodEnd = b.contract.startDate && !b.contract.scheduledCompletion ? addMonths(b.contract.startDate, s.t.period_months) : b.contract.scheduledCompletion;
      const value = s.a.awarded_value_minor == null ? s.e.bid_value : s.a.awarded_value_minor;
      const wizard = parseWizard({
        tenderId: s.t.id, basics: { code: b.basics.code ?? s.t.doc_no.replace(/[^A-Za-z0-9._-]/g, '').toUpperCase().slice(0, 30), name: b.basics.name ?? s.t.name_of_work.slice(0, 160), type: b.basics.type, sector: b.basics.sector, location: b.basics.location ?? s.t.location ?? undefined, branchId: b.basics.branchId },
        contract: { clientPartnerId: s.t.client_partner_id, consultantPartnerId: b.contract.consultantPartnerId, funderPartnerId: b.contract.funderPartnerId, contractType: TYPE_OF_BID[s.t.bid_type] ?? 'ITEM_RATE', contractNo: s.a.loa_no ?? undefined, contractValue: money(value), startDate: b.contract.startDate ?? undefined, scheduledCompletion: periodEnd ?? undefined, dlpMonths: b.contract.dlpMonths, retentionPct: b.contract.retentionPct, mobAdvancePct: b.contract.mobAdvancePct, ldSummary: b.contract.ldSummary ?? undefined },
        sites: b.sites, team: b.team, setup: b.setup, milestones: b.milestones, submit: false, ticked: [],
      });
      return transaction(db, () => {
        const proj = P().projects.create(actor, wizard);
        const copied = copyBoq(actor, proj.projectId, s.e);
        const packId = insertPack(actor, { projectId: proj.projectId, s, clauses: b.clauses });
        writeAudit(db, { entity: 'proj_projects', entityId: proj.id, action: 'from_award', newValues: { tender: s.t.doc_no, estimate: `${s.e.doc_no}/v${s.e.version_no}`, boqItems: copied, pack: packId }, actor: actor.user, companyId: actor.companyId });
        event('proj.project.created_from_award', actor, packId, actor.companyId, proj.projectId, { projectId: proj.projectId, code: proj.code, tenderId: s.t.id, awardId: s.a.id, estimateId: s.e.id, boqItems: copied, packId });
        return { project: proj, boqItems: copied, pack: packs.get(actor, packId) };
      });
    },
  };

  // ---- the baseline pack ------------------------------------------------------------------------------------------------------------------------------
  const meetingsOf = (packId) => db.prepare('SELECT * FROM proj_handover_meetings WHERE pack_id = ? AND deleted_at IS NULL ORDER BY meeting_date, id').all(packId).map(meetingView);
  const meetingView = (m) => ({ id: m.id, packId: m.pack_id, meetingDate: m.meeting_date, venue: m.venue, attendees: json(m.attendees_json, []), questions: json(m.questions_json, []), minutes: m.minutes, actions: json(m.actions_json, []).map((a) => ({ ...a, taskStatus: a.taskId ? (db.prepare('SELECT status FROM tsk_tasks WHERE id = ?').get(a.taskId)?.status ?? null) : null })), rowVersion: m.version, createdBy: m.created_by });
  function view(actor, x, { detail = false } = {}) {
    const o = orgOf(x.project_id); const c = may(actor, 'proj.baseline_pack.cost', x.project_id); const snap = json(x.snapshot_json, {}); const mine = same(x.created_by, actor.user);
    const pj = P()?.ofOrg(x.company_id, x.project_id);
    const out = {
      id: x.id, docNo: x.doc_no, docDate: x.doc_date, packNo: x.pack_no, supersedesId: x.supersedes_id, projectId: x.project_id, projectCode: o?.code, projectName: o?.name, projectState: pj ? STATES[pj.state] : null,
      tenderId: x.tender_id, tender: x.tender_id ? db.prepare('SELECT id, doc_no AS docNo, name_of_work AS nameOfWork FROM tdr_tenders WHERE id = ?').get(x.tender_id) : null,
      award: x.award_id ? db.prepare('SELECT id, doc_no AS docNo, loa_no AS loaNo FROM tdr_awards WHERE id = ?').get(x.award_id) : null,
      estimate: x.estimate_id ? (() => { const e = db.prepare('SELECT id, doc_no, version_no, title, status FROM est_estimates WHERE id = ?').get(x.estimate_id); return e ? { id: e.id, ref: `${e.doc_no}/v${e.version_no}`, title: e.title, status: e.status } : null; })() : null,
      contractValue: money(x.contract_value), status: x.status, statusLabel: BASELINE_STATUS[x.status], signedOffAt: x.signed_off_at, signedOffBy: x.signed_off_by, frozen: Boolean(x.snapshot_hash), snapshotHash: x.snapshot_hash, amendReason: x.amend_reason,
      workflowInstanceId: x.workflow_instance_id, requestedBy: x.requested_by, createdBy: x.created_by, rowVersion: x.version, costsVisible: c, directorRequired: Number(money(x.contract_value)) >= DIRECTOR_ABOVE_RUPEES, chain: Number(money(x.contract_value)) >= DIRECTOR_ABOVE_RUPEES ? ['EST', 'COMMGR', 'PD', 'DIR'] : ['EST', 'COMMGR', 'PD'],
      can: {
        edit: may(actor, 'proj.baseline_pack.edit', x.project_id) && ['DRAFT', 'RETURNED'].includes(x.status),
        submit: may(actor, 'proj.baseline_pack.submit', x.project_id) && ['DRAFT', 'RETURNED'].includes(x.status),
        withdraw: x.status === 'SUBMITTED' && same(x.requested_by, actor.user),
        cancel: may(actor, 'proj.baseline_pack.cancel', x.project_id) && ['DRAFT', 'RETURNED', 'SUBMITTED'].includes(x.status),
        remove: may(actor, 'proj.baseline_pack.delete', x.project_id) && x.status === 'DRAFT' && !x.workflow_instance_id,
        amend: may(actor, 'proj.baseline_pack.amend', x.project_id) && x.status === 'APPROVED' && !db.prepare("SELECT 1 FROM proj_baseline_packs WHERE project_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL").get(x.project_id),
        print: may(actor, 'proj.baseline_pack.print', x.project_id), export: may(actor, 'proj.baseline_pack.export', x.project_id),
        meetings: may(actor, 'proj.handover.manage', x.project_id) && !['CANCELLED', 'REJECTED', 'SUPERSEDED'].includes(x.status), mine,
      },
    };
    if (detail) { out.snapshot = mask(snap, c); out.clauses = json(x.clauses_json, []); out.meetings = meetingsOf(x.id); out.sections = Object.keys(snap).filter((k) => !['builtAt', 'masked'].includes(k)); }
    return out;
  }
  const lockedFor = (x, what) => { if (x.status === 'APPROVED') throw new HttpError(409, 'LOCKED', `${x.doc_no} is signed off and cannot be changed: ${what} by a superseding pack (Correct this baseline).`); if (x.status === 'SUBMITTED') throw new HttpError(409, 'LOCKED', `${x.doc_no} is waiting for sign-off: withdraw it first.`); if (['SUPERSEDED', 'CANCELLED', 'REJECTED'].includes(x.status)) throw new HttpError(409, 'LOCKED', `${x.doc_no} is ${BASELINE_STATUS[x.status].toLowerCase()}.`); };
  /** Rebuilds the snapshot of a draft from its sources (the approved estimate of the tender, the award and the project master). */
  function rebuild(actor, x) {
    const t = x.tender_id ? sources(x.company_id, x.tender_id) : null;
    if (!t?.t) throw unprocessable('This pack has no tender to rebuild from.');
    const live = t.issues.filter((i) => i.code !== 'EXISTS'); if (live.length) throw unprocessable('The sources of this pack are not ready.', live.map((i) => ({ field: 'tenderId', message: i.text })));
    const snap = buildSnapshot(x.company_id, x.project_id, t, json(x.clauses_json, []));
    const pj = db.prepare('SELECT contract_value FROM proj_projects WHERE project_id = ? AND deleted_at IS NULL').get(x.project_id);
    db.prepare('UPDATE proj_baseline_packs SET snapshot_json = ?, snapshot_hash = NULL, estimate_id = ?, award_id = ?, contract_value = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(snap), t.e.id, t.a.id, pj?.contract_value ?? x.contract_value, actor.user, nowIso(), x.id);
    return snap;
  }
  const packs = {
    list(actor, query) {
      need(actor, 'proj.baseline_pack.view', 'see baseline packs'); const s = scopeSql(actor);
      return runList(db, baselineList, parseListRequest(baselineList, query), { select: 'x.*', scopeSql: s.sql, params: s.params, tieBreaker: 'x.id', map: (x) => { const v = view(actor, x); return { id: v.id, docNo: v.docNo, packNo: v.packNo, projectId: v.projectId, project: v.projectCode, name: v.projectName, tender: v.tender?.docNo ?? null, contractValue: v.contractValue, status: v.status, statusLabel: v.statusLabel, signedOffAt: v.signedOffAt, docDate: v.docDate }; } });
    },
    exportSource(actor, req) {
      need(actor, 'proj.baseline_pack.export', 'export baseline packs'); const s = scopeSql(actor); const opts = { select: 'x.*', scopeSql: s.sql, params: s.params, tieBreaker: 'x.id' };
      return { title: baselineList.label, permission: 'proj.baseline_pack.export', personal: false, columns: [{ key: 'docNo', label: 'Pack', type: 'text' }, { key: 'packNo', label: 'Pack no.', type: 'number' }, { key: 'project', label: 'Project', type: 'text' }, { key: 'name', label: 'Name', type: 'text' }, { key: 'tender', label: 'Tender', type: 'text' }, { key: 'contractValue', label: 'Contract value (₹)', type: 'money' }, { key: 'status', label: 'Status', type: 'text' }, { key: 'signedOffAt', label: 'Signed off', type: 'text' }], count: () => countList(db, baselineList, req, opts),
        rows: () => runList(db, baselineList, req, { ...opts, limit: null, map: (x) => { const v = view(actor, x); return { docNo: v.docNo, packNo: v.packNo, project: v.projectCode, name: v.projectName, tender: v.tender?.docNo ?? '', contractValue: v.contractValue, status: v.statusLabel, signedOffAt: v.signedOffAt ?? '' }; } }).data, describe: (r) => [r.q ? `search "${r.q}"` : ''].filter(Boolean) };
    },
    get(actor, id) { return view(actor, row(actor, id), { detail: true }); },
    /** A pack for a project that came from a tender but has none yet (or whose earlier pack was rejected or cancelled). */
    create(actor, b) {
      const x = db.prepare('SELECT * FROM proj_projects WHERE project_id = ? AND company_id = ? AND deleted_at IS NULL').get(b.projectId, actor.companyId);
      if (!x || !may(actor, 'proj.project.view', x.project_id)) throw notFound('That project does not exist.');
      need(actor, 'proj.baseline_pack.create', 'draft baseline packs', x.project_id);
      if (!x.tender_id) throw unprocessable('This project was not set up from a tender: there is no estimate to take the baseline from.');
      if (db.prepare("SELECT 1 FROM proj_baseline_packs WHERE project_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED') AND deleted_at IS NULL").get(x.project_id)) throw conflict('The project has a baseline pack already; correct a signed-off pack by a superseding pack.');
      const s = sources(actor.companyId, x.tender_id); const live = s.issues.filter((i) => i.code !== 'EXISTS'); if (live.length) throw unprocessable('The sources of the baseline are not ready.', live.map((i) => ({ field: 'projectId', message: i.text })));
      return transaction(db, () => { const prev = db.prepare('SELECT MAX(pack_no) AS n FROM proj_baseline_packs WHERE project_id = ?').get(x.project_id).n ?? 0; return packs.get(actor, insertPack(actor, { projectId: x.project_id, s, packNo: prev + 1, clauses: b.clauses })); });
    },
    update(actor, id, b) {
      const x = row(actor, id, 'proj.baseline_pack.edit'); lockedFor(x, 'a signed-off baseline is corrected');
      if (b.version != null && b.version !== x.version) throw conflict(`The pack was changed by someone else (version ${x.version}, you had ${b.version}); reload it.`);
      return transaction(db, () => {
        const snap = json(x.snapshot_json, {}); snap.clauses = b.clauses;
        db.prepare('UPDATE proj_baseline_packs SET clauses_json = ?, snapshot_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(b.clauses), JSON.stringify(snap), actor.user, nowIso(), x.id);
        writeAudit(db, { entity: 'proj_baseline_packs', entityId: x.id, action: 'update', oldValues: { clauses: json(x.clauses_json, []).length }, newValues: { clauses: b.clauses.length }, actor: actor.user, companyId: x.company_id });
        return packs.get(actor, x.id);
      });
    },
    refresh(actor, id) {
      const x = row(actor, id, 'proj.baseline_pack.edit'); lockedFor(x, 'a signed-off baseline is corrected');
      return transaction(db, () => { rebuild(actor, x); writeAudit(db, { entity: 'proj_baseline_packs', entityId: x.id, action: 'refresh', actor: actor.user, companyId: x.company_id }); return packs.get(actor, x.id); });
    },
    remove(actor, id) {
      const x = row(actor, id, 'proj.baseline_pack.delete');
      if (x.status !== 'DRAFT' || x.workflow_instance_id) throw unprocessable('Only a draft that was never sent for sign-off is deleted; cancel any other.');
      return transaction(db, () => { const now = nowIso(); db.prepare('UPDATE proj_baseline_packs SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(now, actor.user, x.id); db.prepare('UPDATE proj_handover_meetings SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE pack_id = ? AND deleted_at IS NULL').run(now, actor.user, x.id); writeAudit(db, { entity: 'proj_baseline_packs', entityId: x.id, action: 'delete', actor: actor.user, companyId: x.company_id }); return { id: x.id, deleted: true }; });
    },
    /** FR-04: the pack is frozen (rebuilt from its sources, hashed) and sent for sign-off: estimation, commercial manager, project director (the director above ₹ 50 crore). */
    submit(actor, id) {
      const x = row(actor, id, 'proj.baseline_pack.submit');
      if (!['DRAFT', 'RETURNED'].includes(x.status)) throw unprocessable('Only a draft or returned pack is sent for sign-off.');
      return transaction(db, () => {
        const snap = rebuild(actor, x); const h = hashOf(snap); const xx = fresh(x.id);
        db.prepare('UPDATE proj_baseline_packs SET snapshot_hash = ? WHERE id = ?').run(h, x.id);
        const ctx = { projectId: x.project_id, amount: Number(money(xx.contract_value)) };
        if (x.status === 'RETURNED') workflowOf(db).resubmit(actor, x.workflow_instance_id, { comment: 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: BASELINE_DOC, docId: String(x.id), comment: `${orgOf(x.project_id).code} ${x.doc_no}`, context: ctx }); db.prepare('UPDATE proj_baseline_packs SET workflow_instance_id = ? WHERE id = ?').run(inst.id, x.id); }
        db.prepare("UPDATE proj_baseline_packs SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), x.id);
        writeAudit(db, { entity: 'proj_baseline_packs', entityId: x.id, action: 'submit', newValues: { hash: h }, actor: actor.user, companyId: x.company_id });
        return packs.get(actor, x.id);
      });
    },
    withdraw(actor, id, { reason }) { const x = row(actor, id); if (x.status !== 'SUBMITTED') throw unprocessable('Only a pack waiting for sign-off is withdrawn.'); if (!same(x.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, x.workflow_instance_id, { comment: reason }); return packs.get(actor, x.id); },
    cancel(actor, id, { reason }) {
      const x = row(actor, id, 'proj.baseline_pack.cancel');
      if (!['DRAFT', 'RETURNED', 'SUBMITTED'].includes(x.status)) throw unprocessable('Only a pack that is not signed off is cancelled.');
      return transaction(db, () => { if (x.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, x.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare("UPDATE proj_baseline_packs SET status = 'CANCELLED', remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), x.id); writeAudit(db, { entity: 'proj_baseline_packs', entityId: x.id, action: 'cancel', reason, actor: actor.user, companyId: x.company_id }); return packs.get(actor, x.id); });
    },
    /** BR-01: a signed-off pack is corrected only by a superseding pack with a reason; it carries the old pack until the new one is signed off. */
    amend(actor, id, { reason }) {
      const x = row(actor, id, 'proj.baseline_pack.amend');
      if (x.status !== 'APPROVED') throw unprocessable('Only a signed-off pack is superseded.');
      if (db.prepare("SELECT 1 FROM proj_baseline_packs WHERE project_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL").get(x.project_id)) throw conflict('A correction of this baseline is in progress already.');
      return transaction(db, () => { const nid = insertPack(actor, { projectId: x.project_id, s: null, packNo: x.pack_no + 1, supersedesId: x.id, clauses: json(x.clauses_json, []), reason, snapshot: json(x.snapshot_json, {}) }); db.prepare('UPDATE proj_baseline_packs SET estimate_id = ?, award_id = ?, tender_id = ? WHERE id = ?').run(x.estimate_id, x.award_id, x.tender_id, nid); return packs.get(actor, nid); });
    },
    history(actor, id) {
      const x = row(actor, id);
      return { approvals: x.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(x.workflow_instance_id) : [], audit: db.prepare('SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = ? AND entity_id = ? ORDER BY id').all('proj_baseline_packs', String(x.id)),
        versions: db.prepare('SELECT id, doc_no, pack_no, status, signed_off_at, amend_reason FROM proj_baseline_packs WHERE project_id = ? AND deleted_at IS NULL ORDER BY pack_no').all(x.project_id).map((v) => ({ id: v.id, docNo: v.doc_no, packNo: v.pack_no, status: v.status, statusLabel: BASELINE_STATUS[v.status], signedOffAt: v.signed_off_at, reason: v.amend_reason })) };
    },
    /** The frozen pack against its hash: a pack that was changed behind the application shows here. */
    verify(actor, id) {
      const x = row(actor, id); if (!x.snapshot_hash) return { frozen: false, intact: null, message: 'The pack is frozen when it is sent for sign-off.' };
      const now = hashOf(json(x.snapshot_json, {})); return { frozen: true, intact: now === x.snapshot_hash, hash: x.snapshot_hash, computed: now };
    },
    /** The superseding pack against the pack it replaces: the totals and the BOQ lines that changed. */
    compare(actor, id) {
      const x = row(actor, id); if (!x.supersedes_id) throw unprocessable('This pack does not supersede another.');
      const old = db.prepare('SELECT * FROM proj_baseline_packs WHERE id = ?').get(x.supersedes_id); const c = may(actor, 'proj.baseline_pack.cost', x.project_id);
      const a = mask(json(old.snapshot_json, {}), c); const b = mask(json(x.snapshot_json, {}), c);
      const keys = c ? ['totalCost', 'totalSelling', 'margin', 'marginPct', 'bidPrice'] : ['totalSelling', 'bidPrice'];
      const totals = keys.map((k) => ({ key: k, before: a.commercials?.[k] ?? null, after: b.commercials?.[k] ?? null, changed: (a.commercials?.[k] ?? null) !== (b.commercials?.[k] ?? null) }));
      const ma = new Map((a.boq ?? []).map((l) => [`${l.sectionCode}/${l.itemNo}`, l])); const mb = new Map((b.boq ?? []).map((l) => [`${l.sectionCode}/${l.itemNo}`, l])); const lines = [];
      for (const [k, l] of mb) { const o = ma.get(k); if (!o) lines.push({ key: k, change: 'ADDED', after: l.amount }); else if (o.qty !== l.qty || o.sellingRate !== l.sellingRate || o.amount !== l.amount || (c && o.costRate !== l.costRate)) lines.push({ key: k, change: 'CHANGED', before: { qty: o.qty, rate: o.sellingRate, amount: o.amount }, after: { qty: l.qty, rate: l.sellingRate, amount: l.amount } }); }
      for (const [k, l] of ma) if (!mb.has(k)) lines.push({ key: k, change: 'REMOVED', before: l.amount });
      return { previous: { id: old.id, docNo: old.doc_no, packNo: old.pack_no }, current: { id: x.id, docNo: x.doc_no, packNo: x.pack_no }, reason: x.amend_reason, totals, lines };
    },
    /** The pack on paper (HTML or PDF) or as a workbook; costs only for those who see them. */
    document(actor, id, format = 'html') {
      const x = row(actor, id); need(actor, ['xlsx', 'csv'].includes(format) ? 'proj.baseline_pack.export' : 'proj.baseline_pack.print', `${['xlsx', 'csv'].includes(format) ? 'export' : 'print'} baseline packs`, x.project_id);
      const v = view(actor, x, { detail: true }); const s = v.snapshot; const c = v.costsVisible;
      writeAudit(db, { entity: 'proj_baseline_packs', entityId: x.id, action: ['xlsx', 'csv'].includes(format) ? 'export' : 'print', newValues: { format, costs: c }, actor: actor.user, companyId: x.company_id });
      const cols = [{ key: 'itemNo', label: 'Item', type: 'text' }, { key: 'description', label: 'Description', type: 'text' }, { key: 'uom', label: 'Unit', type: 'text' }, { key: 'qty', label: 'Quantity', type: 'number' }, { key: 'rate', label: 'Rate (₹)', type: 'money' }, { key: 'amount', label: 'Amount (₹)', type: 'money' }, ...(c ? [{ key: 'costAmount', label: 'Cost (₹)', type: 'money' }] : [])];
      const rows = []; let sec = null;
      for (const l of s.boq ?? []) { if (l.sectionCode !== sec) { sec = l.sectionCode; rows.push({ itemNo: l.sectionCode, description: (l.sectionName ?? `Section ${l.sectionCode}`).toUpperCase(), uom: '', qty: '', rate: '', amount: '', costAmount: '' }); } rows.push({ itemNo: l.itemNo, description: l.description, uom: l.uom, qty: l.qty, rate: l.sellingRate, amount: l.amount, ...(c ? { costAmount: l.costAmount } : {}) }); }
      const title = `Commercial baseline ${v.docNo} · ${v.projectCode} ${v.projectName} · pack ${v.packNo} · ${v.statusLabel}${v.signedOffAt ? ` (signed off ${v.signedOffAt.slice(0, 10)})` : ''}`;
      const foot = [`Contract value: ₹ ${v.contractValue}`, `Tender ${s.source?.tender?.docNo ?? '–'} · award ${s.source?.award?.docNo ?? '–'} · estimate ${v.estimate?.ref ?? '–'}`, ...(c ? [`Cost ₹ ${s.commercials?.totalCost} · margin ₹ ${s.commercials?.margin} (${s.commercials?.marginPct} %)`] : []), ...(v.snapshotHash ? [`Frozen: ${v.snapshotHash.slice(0, 16)}…`] : ['Draft: not frozen'])];
      if (format === 'html') {
        const list = (a) => (a?.length ? `<ul>${a.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '<p>–</p>');
        const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(v.docNo)}</title><style>body{font:12px sans-serif;margin:24px}td,th{border:1px solid #888;padding:4px 6px;text-align:left;vertical-align:top}table{border-collapse:collapse;width:100%;margin-bottom:12px}.r{text-align:right}</style></head><body><h1>${esc(title)}</h1><p>${foot.map(esc).join('<br>')}</p>
<h2>Priced BOQ</h2><table><tr>${cols.map((k) => `<th>${esc(k.label)}</th>`).join('')}</tr>${rows.map((r) => (r.uom === '' ? `<tr><th colspan="${cols.length}">${esc(r.itemNo)} ${esc(r.description)}</th></tr>` : `<tr>${cols.map((k) => `<td${['qty', 'rate', 'amount', 'costAmount'].includes(k.key) ? ' class="r"' : ''}>${esc(r[k.key])}</td>`).join('')}</tr>`)).join('')}</table>
<h2>Assumptions</h2>${list(s.assumptions?.ASSUMPTION)}<h2>Inclusions</h2>${list(s.assumptions?.INCLUSION)}<h2>Exclusions</h2>${list(s.assumptions?.EXCLUSION)}<h2>Qualifications</h2>${list(s.assumptions?.QUALIFICATION)}
<h2>Escalation basis</h2><p>${esc(s.escalation?.note)}</p>${c ? `<h2>Priced risks</h2><table><tr><th>Risk</th><th>Impact</th><th>Probability %</th><th>Exposure</th></tr>${(s.risks ?? []).map((r) => `<tr><td>${esc(r.description)}</td><td class="r">${esc(r.impact)}</td><td class="r">${esc(r.probabilityPct)}</td><td class="r">${esc(r.exposure)}</td></tr>`).join('')}</table>` : ''}
<h2>Key contract clauses</h2>${(s.clauses ?? []).length ? `<table><tr><th>Clause</th><th>Summary</th></tr>${s.clauses.map((k) => `<tr><td>${esc(k.title)}${k.ref ? ` (${esc(k.ref)})` : ''}</td><td>${esc(k.summary)}</td></tr>`).join('')}</table>` : '<p>–</p>'}</body></html>`;
        return { kind: 'html', body };
      }
      const buffer = writeExport(format, { columns: cols, rows, footer: foot, title, sheetName: 'Baseline BOQ' });
      return { kind: 'file', buffer, contentType: FORMATS[format], fileName: `baseline-${v.docNo}${v.status === 'APPROVED' ? '' : '-DRAFT'}.${format}` };
    },
    /** The sign-off: the pack is final, the pack it supersedes is retired and the budget (12.01) and the contract (21.01) are told. */
    decide(instance, actor, outcome, comment) {
      const x = fresh(rid(instance.docId)); if (!x || x.status !== 'SUBMITTED') return;
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN';
      const to = outcome === 'APPROVED' ? 'APPROVED' : outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED';
      db.prepare('UPDATE proj_baseline_packs SET status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, actor.user, nowIso(), x.id);
      if (withdrawn) db.prepare('UPDATE proj_baseline_packs SET workflow_instance_id = NULL, snapshot_hash = NULL WHERE id = ?').run(x.id);
      writeAudit(db, { entity: 'proj_baseline_packs', entityId: x.id, action: outcome.toLowerCase(), reason: comment ?? null, actor: actor.user, companyId: x.company_id });
      if (to !== 'APPROVED') return;
      const now = nowIso(); db.prepare('UPDATE proj_baseline_packs SET signed_off_at = ?, signed_off_by = ? WHERE id = ?').run(now, actor.user, x.id);
      if (x.supersedes_id) { db.prepare("UPDATE proj_baseline_packs SET status = 'SUPERSEDED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, x.supersedes_id); writeAudit(db, { entity: 'proj_baseline_packs', entityId: x.supersedes_id, action: 'superseded', reason: x.amend_reason, actor: actor.user, companyId: x.company_id }); }
      const s = json(x.snapshot_json, {}); const o = orgOf(x.project_id);
      event('proj.baseline.signed_off', actor, x.id, x.company_id, x.project_id, { packId: x.id, docNo: x.doc_no, packNo: x.pack_no, supersedes: x.supersedes_id, projectId: x.project_id, code: o?.code, tenderId: x.tender_id, awardId: x.award_id, estimateId: x.estimate_id, contractValue: money(x.contract_value), totalCost: s.commercials?.totalCost, totalSelling: s.commercials?.totalSelling, margin: s.commercials?.margin, boqItems: (s.boq ?? []).length, snapshotHash: x.snapshot_hash, signedOffBy: actor.user });
    },
  };

  // ---- the handover meeting (FR-03) --------------------------------------------------------------------------------------------------------------
  const mrow = (actor, id) => { const m = db.prepare('SELECT * FROM proj_handover_meetings WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); const x = m ? fresh(m.pack_id) : null; if (!x || !may(actor, 'proj.baseline_pack.view', x.project_id)) throw notFound('That handover meeting does not exist.'); return { m, x }; };
  function userProblems(actor, b) {
    const p = []; const known = (u) => db.prepare('SELECT 1 FROM iam_users WHERE company_id = ? AND lower(username) = lower(?) AND is_active = 1').get(actor.companyId, u);
    (b.attendees ?? []).forEach((a, i) => { if (a.user && !known(a.user)) p.push({ field: `attendees.${i}.user`, message: `${a.user} is not a user of your company` }); });
    (b.actions ?? []).forEach((a, i) => { if (!known(a.owner)) p.push({ field: `actions.${i}.owner`, message: `${a.owner} is not a user of your company` }); if (a.dueDate < '2000-01-01') p.push({ field: `actions.${i}.dueDate`, message: 'Give a due date' }); });
    return p;
  }
  /** Each action of the meeting becomes a task of the task service, owned by the person named; an action that has its task keeps it. */
  function syncActions(actor, x, o, actions, previous = []) {
    return actions.map(({ taskStatus: _status, ...a }) => {
      const old = previous.find((p) => p.taskId && p.title === a.title && same(p.owner, a.owner)); if (old) return { ...a, taskId: old.taskId };
      const task = tasksOf(db).create({ companyId: actor.companyId, title: `${o.code} handover: ${a.title}`.slice(0, 160), description: `Action of the handover meeting of the commercial baseline ${x.doc_no} of project ${o.code}.`, entity: 'proj_baseline_pack', entityId: x.id, entityLabel: x.doc_no, projectId: x.project_id, priority: a.priority, dueDate: a.dueDate, assignees: [a.owner], origin: 'auto', assigner: actor.user, actor: actor.user, source: { type: 'proj_baseline_pack', id: `${x.id}:${a.title}:${a.owner}:${a.dueDate}` } });
      return { ...a, taskId: task?.id ?? null };
    });
  }
  const meetings = {
    list(actor, packId) { const x = row(actor, packId); return meetingsOf(x.id); },
    create(actor, packId, b) {
      const x = row(actor, packId); need(actor, 'proj.handover.manage', 'keep handover meetings', x.project_id);
      if (['CANCELLED', 'REJECTED', 'SUPERSEDED'].includes(x.status)) throw new HttpError(409, 'LOCKED', `${x.doc_no} is ${BASELINE_STATUS[x.status].toLowerCase()}: its handover is not changed.`);
      if (b.meetingDate > todayIST()) fail([{ field: 'meetingDate', message: 'A meeting that was held is recorded on or after its day' }]); fail(userProblems(actor, b));
      return transaction(db, () => {
        const o = orgOf(x.project_id); const actions = syncActions(actor, x, o, b.actions);
        const id = Number(db.prepare("INSERT INTO proj_handover_meetings (company_id, pack_id, meeting_date, venue, attendees_json, questions_json, minutes, actions_json, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proj_baseline_pack', ?)").run(x.company_id, x.id, b.meetingDate, b.venue, JSON.stringify(b.attendees), JSON.stringify(b.questions), b.minutes, JSON.stringify(actions), x.project_id, actor.user, String(x.id)).lastInsertRowid);
        writeAudit(db, { entity: 'proj_handover_meetings', entityId: id, action: 'create', newValues: { pack: x.doc_no, attendees: b.attendees.length, actions: actions.length }, actor: actor.user, companyId: x.company_id });
        event('proj.handover.held', actor, id, x.company_id, x.project_id, { packId: x.id, meetingId: id, projectId: x.project_id, meetingDate: b.meetingDate, attendees: b.attendees.length, actions: actions.length });
        return meetingsOf(x.id);
      });
    },
    update(actor, id, b) {
      const { m, x } = mrow(actor, id); need(actor, 'proj.handover.manage', 'keep handover meetings', x.project_id);
      if (['CANCELLED', 'REJECTED', 'SUPERSEDED'].includes(x.status)) throw new HttpError(409, 'LOCKED', `${x.doc_no} is ${BASELINE_STATUS[x.status].toLowerCase()}: its handover is not changed.`);
      if (b.version != null && b.version !== m.version) throw conflict('The meeting was changed by someone else; reload it.');
      if (b.meetingDate && b.meetingDate > todayIST()) fail([{ field: 'meetingDate', message: 'A meeting that was held is recorded on or after its day' }]); fail(userProblems(actor, b));
      return transaction(db, () => {
        const o = orgOf(x.project_id); const actions = b.actions ? syncActions(actor, x, o, b.actions, json(m.actions_json, [])) : json(m.actions_json, []);
        db.prepare('UPDATE proj_handover_meetings SET meeting_date = ?, venue = ?, attendees_json = ?, questions_json = ?, minutes = ?, actions_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.meetingDate ?? m.meeting_date, b.venue === undefined ? m.venue : b.venue, JSON.stringify(b.attendees ?? json(m.attendees_json, [])), JSON.stringify(b.questions ?? json(m.questions_json, [])), b.minutes === undefined ? m.minutes : b.minutes, JSON.stringify(actions), actor.user, nowIso(), m.id);
        writeAudit(db, { entity: 'proj_handover_meetings', entityId: m.id, action: 'update', actor: actor.user, companyId: m.company_id });
        return meetingsOf(x.id);
      });
    },
    remove(actor, id) {
      const { m, x } = mrow(actor, id); need(actor, 'proj.handover.manage', 'keep handover meetings', x.project_id);
      if (['CANCELLED', 'REJECTED', 'SUPERSEDED'].includes(x.status)) throw new HttpError(409, 'LOCKED', `${x.doc_no} is ${BASELINE_STATUS[x.status].toLowerCase()}: its handover is not changed.`);
      return transaction(db, () => { for (const a of json(m.actions_json, [])) if (a.taskId) { try { tasksOf(db).act(actor, a.taskId, 'cancel', { reason: 'The handover meeting was removed' }); } catch { /* a task closed elsewhere stays as it is */ } } db.prepare('UPDATE proj_handover_meetings SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, m.id); writeAudit(db, { entity: 'proj_handover_meetings', entityId: m.id, action: 'delete', actor: actor.user, companyId: m.company_id }); return meetingsOf(x.id); });
    },
  };

  // ---- the BOQ of the project and the baseline against the current figures (FR-05) ------------------------------------------------------------------
  const boq = {
    /** The BOQ copied into the project (10.04 takes it over). Costs only for those who see them. */
    list(actor, projectId) {
      const x = db.prepare('SELECT * FROM proj_projects WHERE project_id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(projectId), actor.companyId);
      if (!x || !may(actor, 'proj.project.view', x.project_id)) throw notFound('That project does not exist.');
      const c = may(actor, 'proj.baseline_pack.cost', x.project_id);
      const items = db.prepare('SELECT * FROM proj_boq_items WHERE project_id = ? AND deleted_at IS NULL ORDER BY sort_order, id').all(x.project_id);
      return { projectId: x.project_id, costsVisible: c, total: money(items.reduce((s, i) => s + i.amount, 0)), items: items.map((i) => ({ id: i.id, estimateItemId: i.estimate_item_id, sectionCode: i.section_code, sectionName: i.section_name, itemNo: i.item_no, description: i.description, uom: i.uom, qty: num(i.qty, 'quantity'), clientRate: num(i.client_rate, 'rate'), sellingRate: money(i.selling_rate), amount: money(i.amount), ...(c ? { costRate: num(i.cost_rate, 'rate'), markupPct: num(i.markup_pct, 'percent'), costAmount: money(i.cost_amount) } : {}) })) };
    },
  };
  const report = {
    /** The baseline against the current figures: the baseline side is the signed-off pack; the current side comes from the budget and the forecast when those parts are live. */
    get(actor, projectId) {
      need(actor, 'proj.baseline_pack.view', 'see the baseline', Number(projectId));
      const pack = db.prepare("SELECT * FROM proj_baseline_packs WHERE project_id = ? AND company_id = ? AND status = 'APPROVED' AND deleted_at IS NULL").get(Number(projectId), actor.companyId);
      const o = orgOf(Number(projectId)); if (!o || o.company_id !== actor.companyId) throw notFound('That project does not exist.');
      if (!pack) return { projectId: o.id, project: `${o.code} ${o.name}`, pack: null, available: false, reason: 'The commercial baseline of this project is not signed off yet.', rows: [], sections: [] };
      const c = may(actor, 'proj.baseline_pack.cost', pack.project_id); const s = mask(json(pack.snapshot_json, {}), c); const cm = s.commercials ?? {};
      const rows = [{ key: 'contractValue', label: 'Contract value', baseline: money(pack.contract_value) }, { key: 'totalSelling', label: 'Selling value of the BOQ', baseline: cm.totalSelling }, ...(c ? [{ key: 'directCost', label: 'Direct cost', baseline: cm.directCost }, { key: 'indirectCost', label: 'Indirect cost', baseline: cm.indirectCost }, { key: 'risk', label: 'Risk allowance', baseline: cm.risk }, { key: 'contingency', label: 'Contingency', baseline: cm.contingency }, { key: 'escalation', label: 'Escalation', baseline: cm.escalation }, { key: 'totalCost', label: 'Total cost', baseline: cm.totalCost }, { key: 'margin', label: 'Margin', baseline: cm.margin }] : [])];
      const sections = new Map(); for (const l of s.boq ?? []) { const k = l.sectionCode; const cur = sections.get(k) ?? { code: k, name: l.sectionName, amount: 0, cost: 0 }; cur.amount += Number(l.amount); cur.cost += Number(l.costAmount ?? 0); sections.set(k, cur); }
      const provided = currentProviders.map((f) => f(db, { projectId: pack.project_id, pack })).filter(Boolean);
      const cur = new Map(provided.flatMap((p) => p.rows.map((r) => [r.key, r.current])));
      const out = rows.map((r) => ({ ...r, current: cur.get(r.key) ?? null, variance: cur.get(r.key) != null ? (Number(cur.get(r.key)) - Number(r.baseline)).toFixed(2) : null }));
      return { projectId: o.id, project: `${o.code} ${o.name}`, pack: { id: pack.id, docNo: pack.doc_no, packNo: pack.pack_no, signedOffAt: pack.signed_off_at }, costsVisible: c, available: provided.length > 0, reason: provided.length ? null : 'The current side fills when the project budget (12.01) and the forecast (23.11) exist; until then the baseline is shown alone.', sources: provided.map((p) => ({ code: p.code, label: p.label })), rows: out, sections: [...sections.values()].map((x) => ({ code: x.code, name: x.name, amount: x.amount.toFixed(2), ...(c ? { cost: x.cost.toFixed(2) } : {}) })) };
    },
  };
  /** For the parts that follow (12.01 budget, 21.01 contract, 23.11 EAC, 23.12 P&L): the signed-off pack of a project, with its frozen snapshot. */
  const signedOff = (companyId, projectId) => { const x = db.prepare("SELECT * FROM proj_baseline_packs WHERE company_id = ? AND project_id = ? AND status = 'APPROVED' AND deleted_at IS NULL").get(companyId, projectId); return x ? { id: x.id, docNo: x.doc_no, packNo: x.pack_no, signedOffAt: x.signed_off_at, hash: x.snapshot_hash, contractValue: money(x.contract_value), snapshot: json(x.snapshot_json, {}) } : null; };
  /** The pack of a project for its object page. */
  const ofProject = (actor, projectId) => { const x = db.prepare("SELECT * FROM proj_baseline_packs WHERE company_id = ? AND project_id = ? AND deleted_at IS NULL AND status != 'SUPERSEDED' AND status != 'CANCELLED' ORDER BY pack_no DESC, id DESC LIMIT 1").get(actor.companyId, Number(projectId)); return x && may(actor, 'proj.baseline_pack.view', x.project_id) ? { id: x.id, docNo: x.doc_no, status: x.status, statusLabel: BASELINE_STATUS[x.status] } : null; };
  return { fromAward, packs, meetings, boq, report, signedOff, ofProject, decide: packs.decide };
}

const services = new WeakMap();
export const bindBaseline = (db, s) => services.set(db, s);
export const baselineOf = (db) => services.get(db) ?? null;

const step = (code, name, role, when = null) => ({ code, name, type: 'approval', mode: 'single', approvers: [{ kind: 'role', role }], slaHours: 48, requireAttachment: false, checklist: [], when, notify: [], action: null });
const packLine = (db, id) => db.prepare('SELECT x.*, p.code, p.name FROM proj_baseline_packs x JOIN org_projects p ON p.id = x.project_id WHERE x.id = ?').get(id);
workflowTypes.register({
  docType: BASELINE_DOC, label: 'Commercial baseline sign-off', processOwner: 'COMMGR', route: (id) => `/proj/baseline-pack?id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT x.doc_no, x.requested_by, p.code, p.name FROM proj_baseline_packs x JOIN org_projects p ON p.id = x.project_id WHERE x.id = ? AND x.company_id = ?').get(rid(id), companyId); return r ? { ref: r.doc_no, title: `${r.code} ${r.name}`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = packLine(db, rid(id)); if (!r) return null; return { fields: [{ label: 'Project', value: `${r.code} ${r.name}` }, { label: 'Pack', value: `${r.doc_no} (pack ${r.pack_no})` }, { label: 'Contract value', value: `₹ ${money(r.contract_value)}` }, ...(r.amend_reason ? [{ label: 'Why corrected', value: r.amend_reason }] : [])] }; },
  defaultDefinition: { name: 'Baseline sign-off: estimation, the commercial manager, the project director, and the director above ₹ 50 crore', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('EST', 'Estimation head', 'EST'), step('COMMGR', 'Commercial manager', 'COMMGR'), step('PD', 'Project director', 'PD'), step('DIR', 'Director (above ₹ 50 crore)', 'DIR', { field: 'amount', op: 'gte', value: DIRECTOR_ABOVE_RUPEES })] },
  hooks: {
    onApproved: (db, { instance, actor }) => baselineOf(db)?.decide(instance, actor, 'APPROVED'),
    onRejected: (db, { instance, actor, comment }) => baselineOf(db)?.decide(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => baselineOf(db)?.decide(instance, actor, 'RETURNED', comment),
    onCancelled: (db, { instance, actor, comment }) => baselineOf(db)?.decide(instance, actor, 'CANCELLED', comment),
  },
});
evidenceProviders.register(BASELINE_DOC, ({ db, instance }) => {
  const x = db.prepare('SELECT * FROM proj_baseline_packs WHERE id = ?').get(rid(instance.docId)); if (!x) return { sections: [] };
  const s = json(x.snapshot_json, {}); const c = s.commercials ?? {}; const meetingsN = db.prepare('SELECT COUNT(*) AS n FROM proj_handover_meetings WHERE pack_id = ? AND deleted_at IS NULL').get(x.id).n;
  const intact = x.snapshot_hash ? hashOf(s) === x.snapshot_hash : null;
  return { sections: [{ code: 'proj-baseline', title: 'Before you sign off the baseline', kind: 'metrics', items: [{ label: 'Contract value', value: Number(money(x.contract_value)), format: 'inr' }, { label: 'Selling value of the BOQ', value: Number(c.totalSelling ?? 0), format: 'inr' }, { label: 'Total cost', value: Number(c.totalCost ?? 0), format: 'inr' }, { label: 'Margin', value: `${c.marginPct ?? '0'} %`, format: 'text' }, { label: 'BOQ items', value: String((s.boq ?? []).length), format: 'text' }, { label: 'Handover meetings recorded', value: String(meetingsN), format: 'text' }, { label: 'Pack frozen and intact', value: intact == null ? 'Not frozen' : intact ? 'Yes' : 'NO: changed after freezing', format: 'text' }] }] };
});
