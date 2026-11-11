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
import { procRoutes } from './routes.js';

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
  ['proc.stock.levels_loaded', 'Free stock levels of items in stores were loaded for the stock check (part 15.01): data { levels, changed }. Until the stock module (16.01) keeps them.'],
]) eventTypes.define({ type, version: 1, schema, owner: 'proc', description });

integrityRegistry.register({
  statuses: { proc_material_requests: Object.keys(MR_STATUS), proc_requisitions: Object.keys(PR_STATUS) },
  uniqueKeys: [{ table: 'proc_material_requests', columns: ['company_id', 'doc_no'] }, { table: 'proc_requisitions', columns: ['company_id', 'doc_no'] }],
});

/** Module "proc": procurement (M15). Part 15.01 holds the material requests (site indents) and the purchase requisitions. The tables are `proc_*`. */
export const proc = {
  code: 'proc',
  name: 'Procurement',
  routePrefix: '/api/v1/proc',
  ownerPart: '15.01',
  status: 'Material requests (site indents) against work authorisations with the stock of the site, nearby stores and the central warehouse; fulfilment by issue, transfer or purchase; purchase requisitions from consolidated requests or direct, with stock, budget and duplicate checks, approval by value and an emergency path.',
  tables: ['proc_material_requests', 'proc_mr_lines', 'proc_requisitions', 'proc_pr_lines', 'proc_pr_sources', 'proc_stock_levels'],
  resources: ['material-requests', 'requisitions', 'stock'],

  mount(api, { db, config: appConfig }) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'proc_requisitions'").get()) return;
    const flags = createFlagService({ db, environment: appConfig.environment });
    const base = createBase({ db }); const stockSvc = createStockService({ db, base }); const mrSvc = createMrService({ db, base, stock: stockSvc }); const prSvc = createPrService({ db, base, stock: stockSvc, mr: mrSvc });
    const svc = { base, stockSvc, mrSvc, prSvc, mrDecide: mrSvc.decide, prDecide: prSvc.decide }; services.set(db, svc);
    listExports.register('proc.material_requests', { source: (actor, req) => mrSvc.mrs.exportSource(actor, req), hidden: () => [] });
    listExports.register('proc.requisitions', { source: (actor, req) => prSvc.prs.exportSource(actor, req), hidden: () => [] });
    const runtime = runtimeOf(db);
    // the orders of 15.04 tell the balance to order
    runtime?.bus?.subscribe(['proc.po.approved', 'proc.po.cancelled'], (e) => { if (flags.isOn({ companyId: Number(e.companyId ?? e.company_id) }, 'ff.proc.p1501')) prSvc.onPoEvent(e); }, { consumer: 'proc.pr_balance' });
    // FR-06: an emergency purchase not regularised in time is told, once
    runtime?.jobs?.register('proc.emergency_regularisation', (ctx) => { const n = prSvc.sweepEmergencies(); ctx.log(`Told about ${n} emergency purchase(s) not regularised in time`); return { overdue: n }; }, { maxAttempts: 2, description: 'Tells the project manager, the project director and the procurement manager of emergency purchases (CP-PROC-06) that were not regularised within the hours the company allows.' });
    runtime?.scheduler?.define({ code: 'proc.emergency_regularisation_hourly', cron: '10 * * * *', jobType: 'proc.emergency_regularisation', description: 'Hourly: emergency purchases past their regularisation time are told to the project manager and the procurement manager' });
    const router = Router();
    router.use((req, _res, next) => (flags.isOn(req.actor, 'ff.proc.p1501') ? next() : next(notFound('Material requests and purchase requisitions are not enabled for your company yet (feature flag ff.proc.p1501 is OFF).'))));
    router.use(procRoutes(svc, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }) }));
    api.use('/proc', router);
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
