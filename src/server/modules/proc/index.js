import { createHash } from 'node:crypto';
import { Router } from 'express';
import { authzOf } from '../../platform/authz/index.js';
import { eventTypes } from '../../platform/events/index.js';
import { fileEntities } from '../../platform/files/entities.js';
import { notFound } from '../../platform/http/errors.js';
import { idempotency } from '../../platform/http/idempotency.js';
import { integrityRegistry } from '../../platform/integrity/index.js';
import { listExports } from '../../platform/list/index.js';
import { objectTypes } from '../../platform/objects/index.js';
import { evidenceProviders, workflowTypes } from '../../platform/workflow/index.js';
import { runtimeOf } from '../../platform/runtime/index.js';
import { createFlagService } from '../core/api.js';
import { createBase } from './base.js';
import { createStockService } from './stock.js';
import { MR_DOC, MR_STATUS, createMrService } from './mr.js';
import { PR_DOC, PR_STATUS, createPrService } from './pr.js';
import { RUN_STATUS, createMrpService } from './mrp.js';
import { PARAM_DOC, PARAM_STATUS, createItemParamService } from './item-params.js';
import { RFQ_DOC, RFQ_STATUS, QUOTE_STATUS, createRfqService } from './rfq.js';
import { procRoutes, vendorQuoteRoutes } from './routes.js';

const services = new WeakMap();
export const procOf = (db) => services.get(db) ?? null;

/** @type {any} */
const schema = { type: 'object', properties: {}, required: [] };
for (const [type, description] of [
  ['proc.mr.approved', 'A material request (site indent) was approved by the construction manager (part 15.01): data { mrId, docNo, projectId, siteId, requiredBy, priority, waId, activityId, supersedes, lines: [{ lineId, lineNo, itemId, qty, uom, wbsId, costCodeId }] }.'],
  ['proc.mr.cancelled', 'A material request was cancelled (part 15.01): data { mrId, docNo, projectId, siteId, reason }.'],
  ['proc.mr.issue_requested', 'The procurement officer asked for a line of an approved material request to be issued from the stock of the site (part 15.01): data { mrId, lineId, lineNo, itemId, qty, uom, fromStore, toSiteId }. For the stock module (16.04).'],
  ['proc.mr.transfer_requested', 'A line of an approved material request is to be transferred from another store (part 15.01): data { mrId, lineId, lineNo, itemId, qty, uom, fromStore, fromStoreKind, toSiteId }. For the stock module (16.05).'],
  ['proc.pr.approved', 'A purchase requisition was approved (by value: the project manager, the project director, the procurement manager) or an emergency one was regularised (part 15.01): data { prId, docNo, projectId, siteId, requiredBy, priority, emergency, amount, supersedes, source, commitment, lines: [{ lineId, lineNo, itemId, serviceDesc, qty, uom, estRate, requiredBy, deliverySiteId, wbsId, costCodeId, preferredVendorId, spec, mrLines: [{ mrId, mrLineId, qty }] }] }. For the enquiry (15.03); its soft commitment is in the ledger of 12.03.'],
  ['proc.pr.cancelled', 'A purchase requisition was cancelled and its commitment released (part 15.01): data { prId, docNo, projectId, reason }.'],
  ['proc.pr.closed', 'A purchase requisition was short-closed: what is not ordered is given up (part 15.01): data { prId, docNo, projectId, reason }.'],
  ['proc.pr.emergency_raised', 'An emergency purchase was sent; the project manager regularises it by approving it (control CP-PROC-06, part 15.01): data { prId, docNo, projectId, regulariseBy, reason, amount }.'],
  ['proc.pr.regularisation_overdue', 'An emergency purchase was not regularised within the hours set (part 15.01): data { prId, docNo, projectId, regulariseBy, reason }.'],
  ['proc.mrp.run_completed', 'An MRP run of a project was made (part 15.02): data { runId, docNo, projectId, items, shortages, proposals, late }. The proposals wait for the planner; the lines are at GET /proc/runs/:id.'],
  ['proc.mrp.shortages_found', 'An MRP run found weeks in which the stock, orders and requisitions do not cover the requirement (part 15.02): data { runId, docNo, projectId, shortages: [{ itemId, weekStart, shortQty, requiredBy, orderBy, late }] }. For the look-ahead constraints of the schedule (13.04).'],
  ['proc.mrp.proposals_accepted', 'A planner accepted MRP proposals and a draft purchase requisition was made (part 15.02): data { runId, docNo, projectId, prId, prNo, proposals: [id] }. The requisition is not approved: it follows the approval by value of 15.01.'],
  ['proc.rfq.issued', 'An RFQ was issued to vendors (part 15.03): data { rfqId, docNo, projectId, title, dueDate, vendors: [vendorId], lines: [{ lineId, lineNo, prLineId, itemId, qty, uom }] }.'],
  ['proc.rfq.amended', 'The due date or terms of an issued RFQ were changed (part 15.03): data { rfqId, docNo, projectId, dueDate, reason }.'],
  ['proc.rfq.closed', 'An RFQ was closed to further quotations (part 15.03): data { rfqId, docNo, projectId, quotations, reason, shortOfMinimum }. The quotations are at GET /proc/rfqs/:id/comparison, for the comparative statement (15.04).'],
  ['proc.rfq.cancelled', 'An RFQ was cancelled (part 15.03): data { rfqId, docNo, projectId, reason, wasIssued }.'],
  ['proc.quotation.received', 'A vendor quotation was recorded as received, keyed in by procurement or entered by the vendor (part 15.03): data { rfqId, quotationId, quotationNo, rfqNo, projectId, vendorId, versionNo, validUntil, totalLanded, via }. For the comparative statement (15.04).'],
  ['proc.quotation.withdrawn', 'A received quotation was withdrawn (part 15.03): data { rfqId, quotationId, vendorId, reason }.'],
  ['proc.rate.observed', 'A rate quoted by a vendor for an item, with its landed rate (part 15.03): data { quotationId, vendorId, itemId, uom, rate, discountPct, landedRate, gstRate, gstInclusive, observedOn, validUntil, source }. Rates in paise. For the rate intelligence (15.09).'],
  ['proc.stock.levels_loaded', 'Free stock levels of items in stores were loaded for the stock check (part 15.01): data { levels, changed }. Until the stock module (16.01) keeps them.'],
]) eventTypes.define({ type, version: 1, schema, owner: 'proc', description });

integrityRegistry.register({
  statuses: { proc_material_requests: Object.keys(MR_STATUS), proc_requisitions: Object.keys(PR_STATUS), proc_mrp_runs: Object.keys(RUN_STATUS), proc_item_params: Object.keys(PARAM_STATUS), proc_rfqs: Object.keys(RFQ_STATUS), proc_quotations: Object.keys(QUOTE_STATUS) },
  uniqueKeys: [{ table: 'proc_material_requests', columns: ['company_id', 'doc_no'] }, { table: 'proc_requisitions', columns: ['company_id', 'doc_no'] }, { table: 'proc_mrp_runs', columns: ['company_id', 'doc_no'] }, { table: 'proc_rfqs', columns: ['company_id', 'doc_no'] }, { table: 'proc_quotations', columns: ['company_id', 'doc_no'] }],
});

/** Module "proc": procurement (M15). Part 15.01 holds the material requests (site indents) and the purchase requisitions. The tables are `proc_*`. */
export const proc = {
  code: 'proc',
  name: 'Procurement',
  routePrefix: '/api/v1/proc',
  ownerPart: '15.01',
  status: 'Material requests (site indents) against work authorisations with the stock of the site, nearby stores and the central warehouse; fulfilment by issue, transfer or purchase; purchase requisitions from consolidated requests or direct, with stock, budget and duplicate checks, approval by value and an emergency path.',
  tables: ['proc_material_requests', 'proc_mr_lines', 'proc_requisitions', 'proc_pr_lines', 'proc_pr_sources', 'proc_stock_levels', 'proc_mrp_runs', 'proc_mrp_lines', 'proc_mrp_proposals', 'proc_item_params', 'proc_open_supply', 'proc_rfqs', 'proc_rfq_lines', 'proc_rfq_vendors', 'proc_quotations', 'proc_quotation_lines', 'proc_rfq_clarifications'],
  resources: ['material-requests', 'requisitions', 'stock', 'runs', 'proposals', 'item-params', 'supply', 'mrp', 'rfqs', 'quotations'],

  mount(api, { db, config: appConfig, publicApi }) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'proc_requisitions'").get()) return;
    const flags = createFlagService({ db, environment: appConfig.environment });
    const base = createBase({ db }); const stockSvc = createStockService({ db, base }); const mrSvc = createMrService({ db, base, stock: stockSvc }); const prSvc = createPrService({ db, base, stock: stockSvc, mr: mrSvc });
    const mrpSvc = createMrpService({ db, base, stock: stockSvc, pr: prSvc }); const paramSvc = createItemParamService({ db, base });
    const rfqSvc = createRfqService({ db, base, baseUrl: () => appConfig.publicUrl ?? appConfig.appUrl ?? '' });
    const svc = { base, stockSvc, mrSvc, prSvc, mrpSvc, paramSvc, rfqSvc, rfqDecide: rfqSvc.decide, mrDecide: mrSvc.decide, prDecide: prSvc.decide, paramDecide: paramSvc.decide }; services.set(db, svc);
    listExports.register('proc.mrp_runs', { source: (actor, req) => mrpSvc.mrp.exportSource(actor, req), hidden: () => [] });
    listExports.register('proc.material_requests', { source: (actor, req) => mrSvc.mrs.exportSource(actor, req), hidden: () => [] });
    listExports.register('proc.requisitions', { source: (actor, req) => prSvc.prs.exportSource(actor, req), hidden: () => [] });
    listExports.register('proc.rfqs', { source: (actor, req) => rfqSvc.rfqs.exportSource(actor, req), hidden: () => [] });
    listExports.register('proc.quotations', { source: (actor, req) => rfqSvc.quotes.exportSource(actor, req), hidden: () => [] });
    const runtime = runtimeOf(db);
    // FR-07: every morning at 08:00 India time vendors who have not answered are reminded and the issuer is told what is due
    runtime?.jobs?.register('proc.rfq_reminders', (ctx) => { let n = 0; for (const c of db.prepare('SELECT id FROM org_companies').all()) { if (!flags.isOn({ companyId: c.id }, 'ff.proc.p1503')) continue; n += rfqSvc.rfqs.sweep(); break; } ctx.log(`Told the issuers of ${n} RFQ(s) that are due with vendors who have not answered`); return { rfqs: n }; }, { maxAttempts: 2, description: 'Reminds the vendors who have not answered an RFQ that closes soon and tells the buyer what is due.' });
    runtime?.scheduler?.define({ code: 'proc.rfq_reminders_daily', cron: '30 2 * * *', jobType: 'proc.rfq_reminders', description: 'Every day 08:00 India time: reminders to vendors of RFQs that close soon' });
    // the orders of 15.04 tell the balance to order
    runtime?.bus?.subscribe(['proc.po.approved', 'proc.po.cancelled'], (e) => { if (flags.isOn({ companyId: Number(e.companyId ?? e.company_id) }, 'ff.proc.p1501')) prSvc.onPoEvent(e); }, { consumer: 'proc.pr_balance' });
    // FR-06: an emergency purchase not regularised in time is told, once
    runtime?.jobs?.register('proc.emergency_regularisation', (ctx) => { const n = prSvc.sweepEmergencies(); ctx.log(`Told about ${n} emergency purchase(s) not regularised in time`); return { overdue: n }; }, { maxAttempts: 2, description: 'Tells the project manager, the project director and the procurement manager of emergency purchases (CP-PROC-06) that were not regularised within the hours the company allows.' });
    runtime?.scheduler?.define({ code: 'proc.emergency_regularisation_hourly', cron: '10 * * * *', jobType: 'proc.emergency_regularisation', description: 'Hourly: emergency purchases past their regularisation time are told to the project manager and the procurement manager' });
    // FR-01: every Monday at 01:00 India time a run for each active project that has an approved schedule
    runtime?.jobs?.register('proc.mrp_weekly', (ctx) => { const out = { runs: 0, skipped: 0 }; for (const c of db.prepare('SELECT id FROM org_companies').all()) { if (!flags.isOn({ companyId: c.id }, 'ff.proc.p1502')) continue; const r = mrpSvc.mrp.weekly(c.id); out.runs += r.runs; out.skipped += r.skipped; } ctx.log(`Made ${out.runs} MRP run(s), skipped ${out.skipped} project(s) with no approved schedule`); return out; }, { maxAttempts: 2, description: 'Makes the weekly MRP run of every active project that has an approved schedule and tells the planners how many proposals wait for them.' });
    runtime?.scheduler?.define({ code: 'proc.mrp_weekly_monday', cron: '30 19 * * 0', jobType: 'proc.mrp_weekly', description: 'Every Monday 01:00 India time: the weekly MRP run of each project with an approved schedule' });
    const router = Router();
    router.use((req, _res, next) => (flags.isOn(req.actor, 'ff.proc.p1501') ? next() : next(notFound('Material requests and purchase requisitions are not enabled for your company yet (feature flag ff.proc.p1501 is OFF).'))));
    router.use(/^\/(runs|proposals|item-params|supply|mrp)(\/|$)/, (req, _res, next) => (flags.isOn(req.actor, 'ff.proc.p1502') ? next() : next(notFound('Material demand planning (MRP) is not enabled for your company yet (feature flag ff.proc.p1502 is OFF).'))));
    router.use(/^\/(rfqs|quotations)(\/|$)/, (req, _res, next) => (flags.isOn(req.actor, 'ff.proc.p1503') ? next() : next(notFound('RFQs and vendor quotations are not enabled for your company yet (feature flag ff.proc.p1503 is OFF).'))));
    router.use(procRoutes(svc, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }) }));
    api.use('/proc', router);
    // the vendor's page: no sign-in, the link is the proof; switched off with the flag of the company that issued it
    publicApi.use('/proc', (req, res, next) => { const t = String(req.path).match(/^\/vendor-quote\/([A-Za-z0-9_-]+)/)?.[1]; if (!t) return next(); const v = db.prepare('SELECT company_id FROM proc_rfq_vendors WHERE token_hash = ?').get(createHash('sha256').update(t).digest('hex')); return v && flags.isOn({ companyId: v.company_id }, 'ff.proc.p1503') ? next() : next(notFound('This link is not valid.')); }, vendorQuoteRoutes({ portal: rfqSvc.portal }));
  },
};

const approver = (code, name, role, slaHours, when = null) => ({ code, name, type: 'approval', mode: 'single', approvers: [{ kind: 'role', role }], slaHours, requireAttachment: false, checklist: [], when, notify: [], action: null });
const json = (s, d) => { try { return JSON.parse(s ?? ''); } catch { return d; } };

// ---- the approval of a material request: the construction manager (the site engineer, storekeeper or planner raised it) ------------------------------------------------------------------------------
const mline = (db, id) => db.prepare('SELECT x.*, p.code, s.code AS scode FROM proc_material_requests x JOIN org_projects p ON p.id = x.org_project_id JOIN org_sites s ON s.id = x.mr_site_id WHERE x.id = ?').get(id);
workflowTypes.register({
  docType: MR_DOC, label: 'Material request', processOwner: 'CM', route: (id) => `/proc/material-requests?id=${id}`,
  describe(db, companyId, id) { const r = mline(db, Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.code}/${r.scode}: ${r.doc_no}, required by ${r.required_by}`, originator: r.requested_by, projectId: r.org_project_id, siteId: r.mr_site_id } : null; },
  summarise(db, _actor, id) {
    const r = mline(db, Number(id)); if (!r) return null; const ls = db.prepare('SELECT l.qty, l.uom, i.code, i.name FROM proc_mr_lines l JOIN mdm_items i ON i.id = l.item_id WHERE l.mr_id = ? AND l.deleted_at IS NULL ORDER BY l.line_no').all(r.id);
    return { fields: [{ label: 'Site', value: `${r.code} / ${r.scode}` }, { label: 'Required by', value: r.required_by }, { label: 'Priority', value: r.priority.toLowerCase() }, { label: 'Requested by', value: r.requested_by }, { label: 'Lines', value: ls.map((l) => `${l.code} ${l.name}: ${l.qty / 1000} ${l.uom}`).join('; ') }, { label: 'Purpose', value: r.purpose ?? '' }] };
  },
  defaultDefinition: { name: 'Material request: the construction manager', settings: { resubmit: 'first', distinctApprovers: true }, steps: [approver('CM', 'Construction manager', 'CM', 8)] },
  hooks: {
    onApproved: (db, { instance, actor }) => procOf(db)?.mrDecide(instance, actor, 'APPROVED'),
    onRejected: (db, { instance, actor, comment }) => procOf(db)?.mrDecide(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => procOf(db)?.mrDecide(instance, actor, 'RETURNED', comment),
    onCancelled: (db, { instance, actor, comment }) => procOf(db)?.mrDecide(instance, actor, 'CANCELLED', comment),
  },
});
evidenceProviders.register(MR_DOC, ({ db, instance }) => {
  const r = mline(db, Number(instance.docId)); if (!r) return { sections: [] }; const wa = r.wa_id ? db.prepare('SELECT wa_no FROM site_work_authorisations WHERE id = ?').get(r.wa_id) : null; const ls = db.prepare('SELECT l.id, l.item_id, l.qty, l.uom, i.code, i.name FROM proc_mr_lines l JOIN mdm_items i ON i.id = l.item_id WHERE l.mr_id = ? AND l.deleted_at IS NULL ORDER BY l.line_no').all(r.id);
  const free = (itemId) => db.prepare("SELECT COALESCE(SUM(free_qty), 0) AS n FROM proc_stock_levels WHERE item_id = ? AND (store_site_id = ? OR store_kind = 'NEARBY') AND deleted_at IS NULL").get(itemId, r.mr_site_id).n;
  return { sections: [{ code: 'proc-mr-checks', title: 'Before you approve the request', kind: 'metrics', items: [{ label: 'Work authorisation', value: wa?.wa_no ?? 'none named', format: 'text', tone: wa ? undefined : 'warn' }, { label: 'Required by', value: r.required_by, format: 'text' }, ...ls.map((l) => ({ label: `${l.code} ${l.name}`, value: `${l.qty / 1000} ${l.uom} asked; ${free(l.item_id) / 1000} free at the site and nearby stores`, format: 'text', tone: free(l.item_id) >= l.qty ? 'warn' : undefined }))] }] };
});
objectTypes.register({
  type: 'proc_material_request', label: 'Material request', permission: 'proc.material_request.view', route: (id) => `/proc/material-requests?id=${id}`, attachmentEntity: 'proc_material_request', approvalTarget: 'proc_material_request',
  access(db, actor, id) { const s = procOf(db); if (!s) return null; try { const r = s.mrSvc.mrs.get(actor, Number(id)); return { companyId: actor.companyId, projectId: r.projectId, siteId: r.siteId, status: r.status }; } catch { return null; } },
  auditEntities: (id) => [{ entity: 'proc_material_requests', id }],
  summary(db, actor, id) { const s = procOf(db); if (!s) return null; try { const r = s.mrSvc.mrs.get(actor, Number(id)); return { label: `${r.docNo} ${r.siteCode}`, status: r.status }; } catch { return null; } },
  related(db, actor, id) { const s = procOf(db); if (!s) return []; try { const r = s.mrSvc.mrs.get(actor, Number(id)); return [...(r.waNo ? [{ kind: 'work authorisation', label: r.waNo, route: `/site/work-authorisations?id=${r.waId}` }] : []), ...r.lines.flatMap((l) => l.requisitions.map((x) => ({ kind: 'purchase requisition', label: `${x.docNo} (line ${l.lineNo})`, route: `/proc/requisitions?id=${x.id}` })))]; } catch { return []; } },
  search(db, actor, q, limit) { if (!authzOf(db).check(actor, 'proc.material_request.view').allowed) return []; return db.prepare('SELECT id, org_project_id, mr_site_id FROM proc_material_requests WHERE company_id = ? AND deleted_at IS NULL AND (doc_no LIKE ? OR purpose LIKE ?) ORDER BY id DESC LIMIT ?').all(actor.companyId, `%${q}%`, `%${q}%`, limit).filter((x) => authzOf(db).check(actor, 'proc.material_request.view', { companyId: actor.companyId, projectId: x.org_project_id, siteId: x.mr_site_id }).allowed).map((x) => x.id); },
  projectRecords(db, companyId, projectId, limit) { return db.prepare('SELECT id FROM proc_material_requests WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT ?').all(companyId, projectId, limit).map((x) => x.id); },
});
fileEntities.register({
  entity: 'proc_material_request', label: 'Material request (specifications, drawings, photographs)',
  resolve(db, actor, id) {
    const r = db.prepare('SELECT company_id, org_project_id, mr_site_id, status FROM proc_material_requests WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!r) return null;
    const a = authzOf(db); const at = (k) => a.check(actor, k, { companyId: r.company_id, projectId: r.org_project_id, siteId: r.mr_site_id }).allowed; if (!at('proc.material_request.view')) return null;
    return { companyId: r.company_id, projectId: r.org_project_id, siteId: r.mr_site_id, canView: true, canEdit: at('proc.material_request.edit') && ['DRAFT', 'RETURNED'].includes(r.status), locked: !['DRAFT', 'RETURNED'].includes(r.status) };
  },
});

// ---- the approval of a purchase requisition by value (section 9): the project manager always, the project director above the first band, the procurement manager above the second; an emergency one the project manager alone --------------------
const pline = (db, id) => db.prepare('SELECT x.*, p.code, s.code AS scode FROM proc_requisitions x JOIN org_projects p ON p.id = x.org_project_id LEFT JOIN org_sites s ON s.id = x.pr_site_id WHERE x.id = ?').get(id);
workflowTypes.register({
  docType: PR_DOC, label: 'Purchase requisition', processOwner: 'PM', route: (id) => `/proc/requisitions?id=${id}`,
  describe(db, companyId, id) { const r = pline(db, Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.code}${r.scode ? `/${r.scode}` : ''}: ${r.doc_no} ${r.total_amount / 100}${r.is_emergency ? ' (emergency)' : ''}`, originator: r.requested_by, projectId: r.org_project_id, siteId: r.pr_site_id ?? undefined, amount: r.total_amount / 100 } : null; },
  summarise(db, _actor, id) {
    const r = pline(db, Number(id)); if (!r) return null; const ls = db.prepare('SELECT l.qty, l.uom, l.est_amount, l.service_desc, i.code, i.name FROM proc_pr_lines l LEFT JOIN mdm_items i ON i.id = l.item_id WHERE l.pr_id = ? AND l.deleted_at IS NULL ORDER BY l.line_no').all(r.id);
    return { fields: [{ label: 'Project', value: r.code }, { label: 'Source', value: r.pr_source === 'MR' ? 'Material requests' : r.pr_source === 'MRP' ? 'MRP proposal' : `Direct: ${r.direct_reason ?? ''}` }, { label: 'Estimated value', value: String(r.total_amount / 100) }, { label: 'Required by', value: r.required_by }, { label: 'Budget check', value: r.budget_check_status.toLowerCase().replace('_', ' ') }, ...(r.is_emergency ? [{ label: 'Emergency', value: r.emergency_reason ?? '' }] : []), { label: 'Lines', value: ls.map((l) => `${l.code ? `${l.code} ${l.name}` : l.service_desc}: ${l.qty / 1000} ${l.uom} (${l.est_amount / 100})`).join('; ') }] };
  },
  defaultDefinition: { name: 'Purchase requisition: the project manager; the project director above ₹ 5 lakh; the procurement manager above ₹ 25 lakh; an emergency one the project manager alone', settings: { resubmit: 'first', distinctApprovers: true }, steps: [approver('PM', 'Project manager', 'PM', 24), approver('PD', 'Project director (above ₹ 5 lakh)', 'PD', 24, { field: 'bandPd', op: 'eq', value: 'yes' }), approver('PROCMGR', 'Procurement manager (above ₹ 25 lakh)', 'PROCMGR', 24, { field: 'bandProc', op: 'eq', value: 'yes' })] },
  hooks: {
    onApproved: (db, { instance, actor }) => procOf(db)?.prDecide(instance, actor, 'APPROVED'),
    onRejected: (db, { instance, actor, comment }) => procOf(db)?.prDecide(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => procOf(db)?.prDecide(instance, actor, 'RETURNED', comment),
    onCancelled: (db, { instance, actor, comment }) => procOf(db)?.prDecide(instance, actor, 'CANCELLED', comment),
  },
});
evidenceProviders.register(PR_DOC, ({ db, instance }) => {
  const r = pline(db, Number(instance.docId)); if (!r) return { sections: [] }; const c = json(r.checks_json, null); const tone = { BLOCK: 'bad', WARNING: 'warn', COVERED: 'bad', PARTIAL: 'warn' };
  return { sections: [{ code: 'proc-pr-checks', title: 'Checks before you approve the requisition', kind: 'metrics', items: [
    { label: 'Estimated value', value: String(r.total_amount / 100), format: 'text' }, { label: 'Budget', value: c ? `${c.summary.budget.toLowerCase()}${c.summary.exception?.required ? ' (an approved exception is needed)' : ''}` : 'not checked', format: 'text', tone: tone[c?.summary.budget] },
    { label: 'Stock at the site and nearby', value: c ? c.summary.stock.toLowerCase() : 'not checked', format: 'text', tone: tone[c?.summary.stock] }, { label: 'Possible duplicates', value: c ? String(c.summary.duplicates) : '0', format: 'text', tone: (c?.summary.duplicates ?? 0) > 0 ? 'warn' : undefined },
    { label: 'Lines beyond the budget quantity', value: c ? String(c.summary.beyondQty) : '0', format: 'text', tone: (c?.summary.beyondQty ?? 0) > 0 ? 'bad' : undefined }, ...(r.is_emergency ? [{ label: 'Emergency, to be regularised by', value: `${String(r.regularise_by).slice(0, 16).replace('T', ' ')}: ${r.emergency_reason}`, format: 'text', tone: 'warn' }] : [])] }] };
});
objectTypes.register({
  type: 'proc_requisition', label: 'Purchase requisition', permission: 'proc.requisition.view', route: (id) => `/proc/requisitions?id=${id}`, attachmentEntity: 'proc_requisition', approvalTarget: 'proc_requisition',
  access(db, actor, id) { const s = procOf(db); if (!s) return null; try { const r = s.prSvc.prs.get(actor, Number(id)); return { companyId: actor.companyId, projectId: r.projectId, siteId: r.siteId ?? undefined, status: r.status }; } catch { return null; } },
  auditEntities: (id) => [{ entity: 'proc_requisitions', id }],
  summary(db, actor, id) { const s = procOf(db); if (!s) return null; try { const r = s.prSvc.prs.get(actor, Number(id)); return { label: `${r.docNo} ${r.projectCode}`, status: r.status }; } catch { return null; } },
  related(db, actor, id) { const s = procOf(db); if (!s) return []; try { const r = s.prSvc.prs.get(actor, Number(id)); const seen = new Map(); for (const l of r.lines) for (const x of l.sources) seen.set(x.mrId, x.mrNo); return [...seen.entries()].map(([mrId, mrNo]) => ({ kind: 'material request', label: mrNo, route: `/proc/material-requests?id=${mrId}` })); } catch { return []; } },
  search(db, actor, q, limit) { if (!authzOf(db).check(actor, 'proc.requisition.view').allowed) return []; return db.prepare('SELECT id, org_project_id, pr_site_id FROM proc_requisitions WHERE company_id = ? AND deleted_at IS NULL AND (doc_no LIKE ? OR purpose LIKE ?) ORDER BY id DESC LIMIT ?').all(actor.companyId, `%${q}%`, `%${q}%`, limit).filter((x) => authzOf(db).check(actor, 'proc.requisition.view', { companyId: actor.companyId, projectId: x.org_project_id, siteId: x.pr_site_id }).allowed).map((x) => x.id); },
  projectRecords(db, companyId, projectId, limit) { return db.prepare('SELECT id FROM proc_requisitions WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT ?').all(companyId, projectId, limit).map((x) => x.id); },
});
fileEntities.register({
  entity: 'proc_requisition', label: 'Purchase requisition (specifications, quotations, justification)',
  resolve(db, actor, id) {
    const r = db.prepare('SELECT company_id, org_project_id, pr_site_id, status FROM proc_requisitions WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!r) return null;
    const a = authzOf(db); const at = (k) => a.check(actor, k, { companyId: r.company_id, projectId: r.org_project_id, siteId: r.pr_site_id }).allowed; if (!at('proc.requisition.view')) return null;
    return { companyId: r.company_id, projectId: r.org_project_id, siteId: r.pr_site_id ?? undefined, canView: true, canEdit: at('proc.requisition.edit') && ['DRAFT', 'RETURNED'].includes(r.status), locked: !['DRAFT', 'RETURNED'].includes(r.status) };
  },
});

// ---- the approval of an item's planning parameters (part 15.02, section 9): maker-checker; the planner or the procurement officer proposes, the procurement manager approves; the one who proposed never decides it --------------------------
const iline = (db, id) => db.prepare('SELECT x.*, i.code, i.name FROM proc_item_params x JOIN mdm_items i ON i.id = x.item_id WHERE x.id = ?').get(id);
workflowTypes.register({
  docType: PARAM_DOC, label: 'Item planning parameters', processOwner: 'PROCMGR', route: (id) => `/proc/item-params?id=${id}`,
  describe(db, companyId, id) { const r = iline(db, Number(id)); return r && r.company_id === companyId ? { ref: r.code, title: `${r.code}: lead time ${r.lead_time_days} days from ${r.effective_from}`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = iline(db, Number(id)); if (!r) return null; const cur = db.prepare("SELECT lead_time_days, moq, safety_stock FROM proc_item_params WHERE company_id = ? AND item_id = ? AND COALESCE(vendor_id, 0) = ? AND status = 'APPROVED' AND effective_from <= ? AND deleted_at IS NULL ORDER BY effective_from DESC LIMIT 1").get(r.company_id, r.item_id, r.vendor_id ?? 0, r.effective_from); return { fields: [{ label: 'Item', value: `${r.code} ${r.name}` }, { label: 'Lead time', value: `${r.lead_time_days} days${cur ? ` (now ${cur.lead_time_days})` : ''}` }, { label: 'Minimum order / pack', value: `${r.moq / 1000} / ${r.pack_size / 1000}` }, { label: 'Safety stock', value: `${r.safety_stock / 1000}${cur ? ` (now ${cur.safety_stock / 1000})` : ''}` }, { label: 'Long lead', value: r.long_lead ? 'yes' : 'no' }, { label: 'Effective from', value: r.effective_from }, { label: 'Supplier capacity', value: r.capacity_note ?? '' }] }; },
  defaultDefinition: { name: 'Item planning parameters: the procurement manager', settings: { resubmit: 'first', distinctApprovers: true }, steps: [approver('PROCMGR', 'Procurement manager', 'PROCMGR', 24)] },
  hooks: {
    onApproved: (db, { instance, actor }) => procOf(db)?.paramDecide(instance, actor, 'APPROVED'),
    onRejected: (db, { instance, actor, comment }) => procOf(db)?.paramDecide(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => procOf(db)?.paramDecide(instance, actor, 'RETURNED', comment),
    onCancelled: (db, { instance, actor, comment }) => procOf(db)?.paramDecide(instance, actor, 'CANCELLED', comment),
  },
});
objectTypes.register({
  type: 'proc_item_param', label: 'Item planning parameters', permission: 'proc.item_param.view', route: (id) => `/proc/item-params?id=${id}`, attachmentEntity: 'proc_item_param', approvalTarget: 'proc_item_param',
  access(db, actor, id) { const s = procOf(db); if (!s) return null; try { const r = s.paramSvc.params.get(actor, Number(id)); return { companyId: actor.companyId, status: r.status }; } catch { return null; } },
  auditEntities: (id) => [{ entity: 'proc_item_params', id }],
  summary(db, actor, id) { const s = procOf(db); if (!s) return null; try { const r = s.paramSvc.params.get(actor, Number(id)); return { label: `${r.itemCode} planning parameters`, status: r.status }; } catch { return null; } },
  related: () => [], search() { return []; }, projectRecords() { return []; },
});
objectTypes.register({
  type: 'proc_mrp_run', label: 'MRP run', permission: 'proc.run.view', route: (id) => `/proc/mrp?id=${id}`, attachmentEntity: 'proc_mrp_run', approvalTarget: 'proc_mrp_run',
  access(db, actor, id) { const s = procOf(db); if (!s) return null; try { const r = s.mrpSvc.mrp.get(actor, Number(id)); return { companyId: actor.companyId, projectId: r.projectId, status: r.status }; } catch { return null; } },
  auditEntities: (id) => [{ entity: 'proc_mrp_runs', id }],
  summary(db, actor, id) { const s = procOf(db); if (!s) return null; try { const r = s.mrpSvc.mrp.get(actor, Number(id)); return { label: `${r.docNo} ${r.projectCode}`, status: r.status }; } catch { return null; } },
  related(db, actor, id) { const s = procOf(db); if (!s) return []; try { const rows = db.prepare('SELECT DISTINCT pr_id FROM proc_mrp_proposals WHERE run_id = ? AND pr_id IS NOT NULL').all(Number(id)); return rows.map((x) => { const pr = s.prSvc.prs.get(actor, x.pr_id); return { kind: 'purchase requisition', label: pr.docNo, route: `/proc/requisitions?id=${pr.id}` }; }); } catch { return []; } },
  search(db, actor, q, limit) { if (!authzOf(db).check(actor, 'proc.run.view').allowed) return []; return db.prepare('SELECT id, org_project_id FROM proc_mrp_runs WHERE company_id = ? AND deleted_at IS NULL AND doc_no LIKE ? ORDER BY id DESC LIMIT ?').all(actor.companyId, `%${q}%`, limit).filter((x) => authzOf(db).check(actor, 'proc.run.view', { companyId: actor.companyId, projectId: x.org_project_id }).allowed).map((x) => x.id); },
  projectRecords(db, companyId, projectId, limit) { return db.prepare('SELECT id FROM proc_mrp_runs WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT ?').all(companyId, projectId, limit).map((x) => x.id); },
});

// ---- the approval of a single-source RFQ justification (part 15.03, BR-01): fewer vendors than the minimum on a value above the threshold; the procurement manager, then the project director ----------------------------------
const fline = (db, id) => db.prepare('SELECT x.*, p.code FROM proc_rfqs x JOIN org_projects p ON p.id = x.org_project_id WHERE x.id = ?').get(id);
workflowTypes.register({
  docType: RFQ_DOC, label: 'Single-source RFQ justification', processOwner: 'PROCMGR', route: (id) => `/proc/rfqs?id=${id}`,
  describe(db, companyId, id) { const r = fline(db, Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.code}: ${r.doc_no} ${r.title}`, originator: r.requested_by, projectId: r.org_project_id, amount: r.est_total / 100 } : null; },
  summarise(db, _actor, id) {
    const r = fline(db, Number(id)); if (!r) return null; const vs = db.prepare('SELECT vendor_id FROM proc_rfq_vendors WHERE rfq_id = ? AND deleted_at IS NULL').all(r.id).map((v) => db.prepare('SELECT COALESCE(trade_name, legal_name) AS n FROM mdm_partners WHERE id = ?').get(v.vendor_id)?.n);
    return { fields: [{ label: 'Project', value: r.code }, { label: 'RFQ', value: `${r.doc_no}: ${r.title}` }, { label: 'Estimated value', value: String(r.est_total / 100) }, { label: 'Vendors invited', value: vs.join(', ') || 'none' }, { label: 'Due', value: r.due_date }, { label: 'Why fewer vendors', value: r.justification ?? '' }] };
  },
  defaultDefinition: { name: 'Single-source RFQ justification: the procurement manager, then the project director', settings: { resubmit: 'first', distinctApprovers: true }, steps: [approver('PROCMGR', 'Procurement manager', 'PROCMGR', 24), approver('PD', 'Project director', 'PD', 24)] },
  hooks: {
    onApproved: (db, { instance, actor }) => procOf(db)?.rfqDecide(instance, actor, 'APPROVED'),
    onRejected: (db, { instance, actor, comment }) => procOf(db)?.rfqDecide(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => procOf(db)?.rfqDecide(instance, actor, 'RETURNED', comment),
    onCancelled: (db, { instance, actor, comment }) => procOf(db)?.rfqDecide(instance, actor, 'CANCELLED', comment),
  },
});
objectTypes.register({
  type: 'proc_rfq', label: 'Request for quotation', permission: 'proc.rfq.view', route: (id) => `/proc/rfqs?id=${id}`, attachmentEntity: 'proc_rfq', approvalTarget: 'proc_rfq',
  access(db, actor, id) { const s = procOf(db); if (!s) return null; try { const r = s.rfqSvc.rfqs.get(actor, Number(id)); return { companyId: actor.companyId, projectId: r.projectId, status: r.status }; } catch { return null; } },
  auditEntities: (id) => [{ entity: 'proc_rfqs', id }],
  summary(db, actor, id) { const s = procOf(db); if (!s) return null; try { const r = s.rfqSvc.rfqs.get(actor, Number(id)); return { label: `${r.docNo} ${r.title}`, status: r.status }; } catch { return null; } },
  related(db, actor, id) { const s = procOf(db); if (!s) return []; try { const r = s.rfqSvc.rfqs.get(actor, Number(id)); const prs = new Map(r.lines.map((l) => [l.prId, l.prNo])); return [...[...prs.entries()].map(([prId, prNo]) => ({ kind: 'purchase requisition', label: prNo, route: `/proc/requisitions?id=${prId}` })), ...r.quotations.map((q) => ({ kind: 'quotation', label: `${q.docNo} (${q.vendor})`, route: `/proc/quotation-entry?id=${q.id}` }))]; } catch { return []; } },
  search(db, actor, q, limit) { if (!authzOf(db).check(actor, 'proc.rfq.view').allowed) return []; return db.prepare('SELECT id, org_project_id FROM proc_rfqs WHERE company_id = ? AND deleted_at IS NULL AND (doc_no LIKE ? OR title LIKE ?) ORDER BY id DESC LIMIT ?').all(actor.companyId, `%${q}%`, `%${q}%`, limit).filter((x) => authzOf(db).check(actor, 'proc.rfq.view', { companyId: actor.companyId, projectId: x.org_project_id }).allowed).map((x) => x.id); },
  projectRecords(db, companyId, projectId, limit) { return db.prepare('SELECT id FROM proc_rfqs WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT ?').all(companyId, projectId, limit).map((x) => x.id); },
});
objectTypes.register({
  type: 'proc_quotation', label: 'Vendor quotation', permission: 'proc.quotation.view', route: (id) => `/proc/quotation-entry?id=${id}`, attachmentEntity: 'proc_quotation', approvalTarget: 'proc_quotation',
  access(db, actor, id) { const s = procOf(db); if (!s) return null; try { const r = s.rfqSvc.quotes.get(actor, Number(id)); return { companyId: actor.companyId, projectId: r.projectId, status: r.status }; } catch { return null; } },
  auditEntities: (id) => [{ entity: 'proc_quotations', id }],
  summary(db, actor, id) { const s = procOf(db); if (!s) return null; try { const r = s.rfqSvc.quotes.get(actor, Number(id)); return { label: `${r.docNo} ${r.vendor}`, status: r.status }; } catch { return null; } },
  related(db, actor, id) { const s = procOf(db); if (!s) return []; try { const r = s.rfqSvc.quotes.get(actor, Number(id)); return [{ kind: 'request for quotation', label: r.rfqNo, route: `/proc/rfqs?id=${r.rfqId}` }]; } catch { return []; } },
  search(db, actor, q, limit) { if (!authzOf(db).check(actor, 'proc.quotation.view').allowed) return []; return db.prepare('SELECT id, org_project_id FROM proc_quotations WHERE company_id = ? AND deleted_at IS NULL AND (doc_no LIKE ? OR quote_ref LIKE ?) ORDER BY id DESC LIMIT ?').all(actor.companyId, `%${q}%`, `%${q}%`, limit).filter((x) => authzOf(db).check(actor, 'proc.quotation.view', { companyId: actor.companyId, projectId: x.org_project_id }).allowed).map((x) => x.id); },
  projectRecords(db, companyId, projectId, limit) { return db.prepare('SELECT id FROM proc_quotations WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT ?').all(companyId, projectId, limit).map((x) => x.id); },
});
for (const [entity, table, view, edit, label] of [['proc_rfq', 'proc_rfqs', 'proc.rfq.view', 'proc.rfq.edit', 'RFQ (specifications, drawings, terms)'], ['proc_quotation', 'proc_quotations', 'proc.quotation.view', 'proc.quotation.edit', 'Vendor quotation (the quotation, catalogues, test certificates)']]) {
  fileEntities.register({
    entity, label,
    resolve(db, actor, id) {
      const r = db.prepare(`SELECT company_id, org_project_id, status FROM ${table} WHERE id = ? AND company_id = ? AND deleted_at IS NULL`).get(Number(id), actor.companyId); if (!r) return null;
      const a = authzOf(db); const at = (k) => a.check(actor, k, { companyId: r.company_id, projectId: r.org_project_id }).allowed; if (!at(view)) return null; const open = ['DRAFT', 'RETURNED'].includes(r.status);
      return { companyId: r.company_id, projectId: r.org_project_id, canView: true, canEdit: at(edit) && (open || (entity === 'proc_rfq' && r.status === 'ISSUED')), locked: !open && r.status !== 'ISSUED' };
    },
  });
}
