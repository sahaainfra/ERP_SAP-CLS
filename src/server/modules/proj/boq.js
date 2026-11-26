import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { writeExport, FORMATS } from '../../platform/export/index.js';
import { HttpError, badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { evidenceProviders, workflowOf, workflowTypes } from '../../platform/workflow/index.js';
import { issueNumber } from '../core/numbering/service.js';
import { BOQ_FREEZE_DOC, BOQ_MAP_DOC, BOQ_STATUS, BOQ_VTYPES, LINE_KINDS, NORM_TYPES, esc, json, lineAmount, money, nowIso, num, rid, same, units } from './constants.js';

// BOQ management (part 10.04). A project has BOQ versions: Tender (made from the award copy of 10.02, an import or by hand, edited freely), Contract (a copy of the tender version or an import; frozen by approval of QS, the commercial manager and
// the project manager, then immutable: BR-02) and Revised (made only from an approved variation, 21.05, by copying the frozen version). A version is a hierarchy bill, section, item, sub-item; only the lowest lines carry a quantity, a rate and an
// amount (qty x rate, worked out here on the server: BR-01) and the version total is the sum of those. Each item is mapped to WBS nodes and locations with a split of its quantity that sums to the item quantity, carries resource norms (from its rate
// analysis or typed) and may name a work item, a rate analysis and a cost code. After the freeze, mapping and norms change only by a change request approved by QS and the project manager. Rates and amounts are shown to those with proj.boq.rates.
export const boqVersionList = defineList({
  code: 'proj.boq_versions', label: 'BOQ versions', permission: 'proj.version.view',
  from: 'proj_boq_versions x JOIN org_projects p ON p.id = x.org_project_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'x.name', 'p.code', 'p.name', 'x.source_ref'], defaultSort: '-docNo',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'Version' }, name: { sql: 'x.name', type: 'text', label: 'Name' }, project: { sql: 'p.code', type: 'text', label: 'Project' }, projectId: { sql: 'x.org_project_id', type: 'number', label: 'Project id' },
    type: { sql: 'x.vtype', type: 'enum', label: 'Type', options: Object.entries(BOQ_VTYPES) }, versionNo: { sql: 'x.version_no', type: 'number', label: 'No.' }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(BOQ_STATUS) },
    total: { sql: '(x.total_amount / 100.0)', type: 'money', label: 'Total (₹)' }, items: { sql: 'x.items_count', type: 'number', label: 'Items' }, frozenAt: { sql: 'x.frozen_at', type: 'date', label: 'Frozen' },
  },
});
/** FR-06: what the other modules say about each item: (db, { versionId, lineIds }) => Map(lineId => { executed, measured, certified, billed }) in quantities as text; the DPR (14.02), measurement book (22.01), certification and billing register theirs. */
export const quantityProviders = /** @type {Array<(db: any, ctx: { versionId: number, lineIds: number[] }) => Map<number, Record<string, string | null>>>} */ ([]);
/** BR-02: a revised version is made only from an approved variation: (db, { companyId, projectId, variationRef }) => { ref } | null; the variation orders of 21.05 register theirs. */
export const variationProviders = /** @type {Array<(db: any, ctx: { companyId: number, projectId: number, variationRef: string }) => { ref: string } | null>} */ ([]);

const LEAF_KINDS = ['ITEM', 'SUBITEM'];
const PARENT_OK = { BILL: [null], SECTION: [null, 'BILL'], ITEM: [null, 'BILL', 'SECTION'], SUBITEM: ['ITEM'] };
class Rollback extends Error {}
const dec = (v, kind) => { const s = String(v ?? '').trim().replace(/,/g, ''); if (!/^\d+(\.\d+)?$/.test(s)) return null; try { return units(s, kind); } catch { return null; } };

export function createBoqService({ db }) {
  const authz = authzOf(db);
  const may = (actor, key, pid = null) => (pid == null ? authz.check(actor, key).allowed : authz.check(actor, key, { companyId: actor.companyId, projectId: pid }).allowed);
  const need = (actor, key, what, pid = null) => { if (!may(actor, key, pid)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const fail = (p) => { if (p.length) throw badRequest('Correct the highlighted fields', p); };
  const event = (type, actor, entity, id, companyId, projectId, data) => publishEvent(db, { type, entity, entityId: id, actorId: actor.user, companyId, projectId, data });
  const orgOf = (id) => db.prepare('SELECT * FROM org_projects WHERE id = ?').get(id);
  const scopeSql = (actor) => { const f = authz.scopeFilter(actor, 'proj.version.view', { project: 'x.org_project_id' }); return { sql: `x.company_id = :c AND ${f.sql}`, params: { c: actor.companyId, ...(f.params ?? {}) } }; };
  function project(actor, projectId, key = 'proj.version.view') {
    const o = orgOf(Number(projectId));
    if (!o || o.company_id !== actor.companyId || !db.prepare('SELECT 1 FROM proj_projects WHERE project_id = ? AND deleted_at IS NULL').get(o.id) || !may(actor, 'proj.version.view', o.id)) throw notFound('That project does not exist.');
    if (key !== 'proj.version.view') need(actor, key, 'do that with the BOQ', o.id);
    return o;
  }
  const vrow = (actor, id, key = 'proj.version.view') => {
    const v = db.prepare('SELECT * FROM proj_boq_versions WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
    if (!v || !may(actor, 'proj.version.view', v.org_project_id)) throw notFound('That BOQ version does not exist.');
    if (key !== 'proj.version.view') need(actor, key, 'do that with the BOQ', v.org_project_id);
    return v;
  };
  const fresh = (id) => db.prepare('SELECT * FROM proj_boq_versions WHERE id = ?').get(id);
  const lrow = (actor, id, key = 'proj.version.edit') => {
    const l = db.prepare('SELECT * FROM proj_boq_lines WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
    if (!l) throw notFound('That BOQ line does not exist.'); const v = fresh(l.version_id);
    if (!may(actor, 'proj.version.view', v.org_project_id)) throw notFound('That BOQ line does not exist.');
    if (key !== 'proj.version.view') need(actor, key, 'change the BOQ', v.org_project_id);
    return { l, v };
  };
  const rates = (actor, pid) => may(actor, 'proj.boq.rates', pid);
  const nextNo = (actor) => {
    try { return issueNumber(db, { companyId: actor.companyId, docType: 'PROJ_BOQ_VERSION', actor: actor.user, refType: 'proj_boq_versions' }).number; } catch (x) { if (!['DOCUMENT_TYPE_UNKNOWN', 'NUMBER_SERIES_MISSING'].includes(x?.code)) throw x; }
    let k = db.prepare('SELECT COUNT(*) AS n FROM proj_boq_versions WHERE company_id = ?').get(actor.companyId).n + 1; let no = `BOQ-${String(k).padStart(5, '0')}`;
    while (db.prepare('SELECT 1 FROM proj_boq_versions WHERE company_id = ? AND doc_no = ?').get(actor.companyId, no)) { k += 1; no = `BOQ-${String(k).padStart(5, '0')}`; }
    return no;
  };
  const editable = (v) => ['DRAFT', 'RETURNED'].includes(v.status);
  const lockedMsg = (v) => (v.status === 'APPROVED' ? new HttpError(409, 'BOQ_FROZEN', `${v.doc_no} is frozen: the BOQ is not edited (BR-02). Mapping and norms change by a change request; quantities and rates by a revised version made from an approved variation.`) : v.status === 'SUBMITTED' ? new HttpError(409, 'BOQ_LOCKED', `${v.doc_no} is waiting for approval: withdraw it first.`) : new HttpError(409, 'BOQ_LOCKED', `${v.doc_no} is ${BOQ_STATUS[v.status].toLowerCase()}.`));
  const mustEdit = (v) => { if (!editable(v)) throw lockedMsg(v); };
  const lines = (versionId) => db.prepare('SELECT * FROM proj_boq_lines WHERE version_id = ? AND deleted_at IS NULL ORDER BY sort_order, id').all(versionId);
  const isGroup = (l, all) => all.some((c) => c.parent_id === l.id);
  /** BR-01: the version total is the sum of the amounts of the lowest lines; groups are worked out when read. */
  function retotal(versionId) {
    const all = lines(versionId); const leaf = all.filter((l) => LEAF_KINDS.includes(l.line_kind) && !isGroup(l, all));
    const total = leaf.reduce((s, l) => s + l.amount, 0);
    db.prepare('UPDATE proj_boq_versions SET total_amount = ?, items_count = ?, updated_at = ? WHERE id = ?').run(total, leaf.length, nowIso(), versionId);
    return total;
  }
  const mappedQty = (lineId) => db.prepare('SELECT COALESCE(SUM(qty), 0) AS s, COUNT(*) AS n FROM proj_boq_line_wbs WHERE line_id = ? AND deleted_at IS NULL').get(lineId);

  // ---- views ----------------------------------------------------------------------------------------------------------------------------------------------
  function view(actor, v, { detail = false } = {}) {
    const o = orgOf(v.org_project_id); const r = rates(actor, v.org_project_id); const can = (k) => may(actor, k, v.org_project_id);
    const pend = db.prepare("SELECT id, change_status FROM proj_boq_changes WHERE version_id = ? AND change_status IN ('SUBMITTED', 'DRAFT', 'RETURNED') AND deleted_at IS NULL").get(v.id);
    const out = {
      id: v.id, docNo: v.doc_no, projectId: v.org_project_id, projectCode: o?.code, projectName: o?.name, type: v.vtype, typeLabel: BOQ_VTYPES[v.vtype], versionNo: v.version_no, name: v.name, sourceRef: v.source_ref, parentVersionId: v.parent_version_id, variationRef: v.variation_ref,
      status: v.status, statusLabel: BOQ_STATUS[v.status], total: r ? money(v.total_amount) : null, items: v.items_count, frozenAt: v.frozen_at, frozenBy: v.frozen_by, requestedBy: v.requested_by, createdBy: v.created_by, rowVersion: v.version, workflowInstanceId: v.workflow_instance_id, ratesVisible: r, openChange: pend ? { id: pend.id, status: pend.change_status } : null,
      can: {
        edit: can('proj.version.edit') && editable(v), map: can('proj.boq.map') && editable(v), delete: can('proj.version.delete') && v.status === 'DRAFT' && !v.workflow_instance_id,
        submit: can('proj.version.submit') && ['CONTRACT', 'REVISED'].includes(v.vtype) && editable(v), withdraw: v.status === 'SUBMITTED' && same(v.requested_by, actor.user), cancel: can('proj.version.cancel') && ['DRAFT', 'RETURNED', 'SUBMITTED'].includes(v.status) && v.vtype !== 'TENDER',
        amend: can('proj.version.amend') && v.status === 'APPROVED' && !pend, print: can('proj.version.print'), export: can('proj.version.export'), import: can('proj.boq.import') && editable(v),
      },
    };
    if (detail) { const all = lines(v.id); const leaf = all.filter((l) => LEAF_KINDS.includes(l.line_kind) && !isGroup(l, all)); const un = leaf.filter((l) => l.qty > 0 && mappedQty(l.id).s !== l.qty); out.stats = { lines: all.length, items: leaf.length, unmapped: un.length, withNorms: leaf.filter((l) => db.prepare('SELECT 1 FROM proj_boq_line_norms WHERE line_id = ? AND deleted_at IS NULL').get(l.id)).length }; }
    return out;
  }
  /** The lines of a version as a flat tree in order with depth, group sums, mapping status, norms and the quantity status columns of the other modules (FR-06). */
  function lineViews(actor, v, { unmappedOnly = false } = {}) {
    const all = lines(v.id); const r = rates(actor, v.org_project_id); const byParent = new Map(); for (const l of all) { const k = l.parent_id ?? 0; if (!byParent.has(k)) byParent.set(k, []); byParent.get(k).push(l); }
    const sum = new Map(); const calc = (l) => { const ch = byParent.get(l.id) ?? []; const s = ch.length ? ch.reduce((a, c) => a + calc(c), 0) : (LEAF_KINDS.includes(l.line_kind) ? l.amount : 0); sum.set(l.id, s); return s; };
    for (const l of byParent.get(0) ?? []) calc(l);
    const leafIds = all.filter((l) => !(byParent.get(l.id) ?? []).length && LEAF_KINDS.includes(l.line_kind)).map((l) => l.id);
    const maps = new Map(db.prepare(`SELECT line_id, COALESCE(SUM(qty), 0) AS s, COUNT(*) AS n FROM proj_boq_line_wbs WHERE deleted_at IS NULL AND line_id IN (SELECT id FROM proj_boq_lines WHERE version_id = ?) GROUP BY line_id`).all(v.id).map((m) => [m.line_id, m]));
    const norms = new Map(db.prepare('SELECT line_id, COUNT(*) AS n FROM proj_boq_line_norms WHERE deleted_at IS NULL AND line_id IN (SELECT id FROM proj_boq_lines WHERE version_id = ?) GROUP BY line_id').all(v.id).map((m) => [m.line_id, m.n]));
    const qs = new Map(); for (const f of quantityProviders) for (const [id, st] of f(db, { versionId: v.id, lineIds: leafIds })) qs.set(id, { ...(qs.get(id) ?? {}), ...st });
    const out = []; const walk = (pid, depth) => { for (const l of (byParent.get(pid) ?? [])) { out.push(shape(l, depth)); walk(l.id, depth + 1); } };
    const shape = (l, depth) => {
      const group = (byParent.get(l.id) ?? []).length > 0; const leaf = !group && LEAF_KINDS.includes(l.line_kind); const m = maps.get(l.id);
      const mapped = !leaf || l.qty === 0 ? 'NONE' : !m ? 'UNMAPPED' : m.s === l.qty ? 'MAPPED' : 'PARTIAL';
      const st = qs.get(l.id) ?? {}; const balance = leaf && st.certified != null ? num(l.qty - (dec(st.certified, 'quantity') ?? 0), 'quantity') : null;
      return { id: l.id, parentId: l.parent_id, kind: l.line_kind, kindLabel: LINE_KINDS[l.line_kind], depth, code: l.item_code, description: l.description, uom: l.uom, qty: leaf ? num(l.qty, 'quantity') : null, rate: leaf && r ? num(l.rate, 'rate') : null, amount: r ? money(sum.get(l.id) ?? 0) : null, isExtra: Boolean(l.is_extra), group, leaf, workItemId: l.work_item_id, analysisId: l.analysis_id, costCodeId: l.cost_code_id, mapped, splits: m?.n ?? 0, mappedQty: leaf ? num(m?.s ?? 0, 'quantity') : null, norms: norms.get(l.id) ?? 0, executed: st.executed ?? null, measured: st.measured ?? null, certified: st.certified ?? null, billed: st.billed ?? null, balance, rowVersion: l.version };
    };
    walk(0, 0);
    return unmappedOnly ? out.filter((x) => x.leaf && ['UNMAPPED', 'PARTIAL'].includes(x.mapped)) : out;
  }

  // ---- the lines (FR-02) ---------------------------------------------------------------------------------------------------------------------------------
  function problems(actor, v, b, existing = null) {
    const p = []; const code = (b.itemCode ?? '').trim();
    if (!code) p.push({ field: 'itemCode', message: 'Give the item code' });
    else if (db.prepare('SELECT 1 FROM proj_boq_lines WHERE version_id = ? AND item_code = ? AND deleted_at IS NULL AND id != ?').get(v.id, code, existing?.id ?? 0)) p.push({ field: 'itemCode', message: `${code} is in this BOQ already` });
    if (!String(b.description ?? '').trim()) p.push({ field: 'description', message: 'Give the description' });
    const kind = b.kind ?? existing?.line_kind; const leaf = LEAF_KINDS.includes(kind);
    if (leaf) { if (!String(b.uom ?? '').trim()) p.push({ field: 'uom', message: 'Give the unit' }); if (b.qty != null && dec(b.qty, 'quantity') == null) p.push({ field: 'qty', message: 'The quantity is a number of zero or more' }); if (b.rate != null && dec(b.rate, 'rate') == null) p.push({ field: 'rate', message: 'The rate is a number of zero or more' }); }
    else if ((b.qty != null && Number(b.qty) !== 0) || (b.rate != null && Number(b.rate) !== 0)) p.push({ field: 'qty', message: `A ${LINE_KINDS[kind]?.toLowerCase()} has no quantity or rate; they belong to items` });
    if (b.workItemId && !db.prepare("SELECT 1 FROM mdm_items WHERE id = ? AND company_id = ? AND deleted_at IS NULL").get(b.workItemId, actor.companyId)) p.push({ field: 'workItemId', message: 'Choose a work item of the item master' });
    if (b.analysisId && !db.prepare("SELECT 1 FROM ra_analyses WHERE id = ? AND company_id = ? AND deleted_at IS NULL").get(b.analysisId, actor.companyId)) p.push({ field: 'analysisId', message: 'Choose a rate analysis' });
    if (b.costCodeId && !db.prepare('SELECT 1 FROM fin_cost_codes WHERE id = ? AND deleted_at IS NULL AND (company_id IS NULL OR company_id = ?)').get(b.costCodeId, actor.companyId)) p.push({ field: 'costCodeId', message: 'Choose a cost code' });
    return p;
  }
  function putLine(actor, v, b, ctx = {}) {
    const parent = b.parentId ? db.prepare('SELECT * FROM proj_boq_lines WHERE id = ? AND version_id = ? AND deleted_at IS NULL').get(b.parentId, v.id) : null;
    const p = problems(actor, v, b);
    if (b.parentId && !parent) p.push({ field: 'parentId', message: 'Choose a parent of this BOQ' });
    else if (!(PARENT_OK[b.kind] ?? []).includes(parent?.line_kind ?? null)) p.push({ field: 'parentId', message: `A ${LINE_KINDS[b.kind]?.toLowerCase()} is not placed ${parent ? `under a ${LINE_KINDS[parent.line_kind].toLowerCase()}` : 'at the top'}` });
    fail(p);
    if (parent && LEAF_KINDS.includes(parent.line_kind)) {
      if (db.prepare('SELECT 1 FROM proj_boq_line_wbs WHERE line_id = ? AND deleted_at IS NULL').get(parent.id) || db.prepare('SELECT 1 FROM proj_boq_line_norms WHERE line_id = ? AND deleted_at IS NULL').get(parent.id)) throw unprocessable(`${parent.item_code} is mapped or has norms: clear them before it gets sub-items (they belong to the sub-items).`);
      db.prepare('UPDATE proj_boq_lines SET qty = 0, rate = 0, amount = 0 WHERE id = ?').run(parent.id);
    }
    const leaf = LEAF_KINDS.includes(b.kind); const q = leaf ? (dec(b.qty ?? '0', 'quantity') ?? 0) : 0; const r = leaf ? (dec(b.rate ?? '0', 'rate') ?? 0) : 0;
    const order = b.sortOrder ?? db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM proj_boq_lines WHERE version_id = ?').get(v.id).n;
    const id = Number(db.prepare("INSERT INTO proj_boq_lines (company_id, version_id, parent_id, line_kind, item_code, description, uom, qty, rate, amount, is_extra, work_item_id, analysis_id, cost_code_id, sort_order, source_line_id, source_row, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(actor.companyId, v.id, parent?.id ?? null, b.kind, b.itemCode.trim(), b.description.trim(), leaf ? String(b.uom ?? '').trim().toUpperCase() : null, q, r, lineAmount(q, r), b.isExtra ? 1 : 0, b.workItemId ?? null, b.analysisId ?? null, b.costCodeId ?? null, order, b.sourceLineId ?? null, b.sourceRow ?? null, v.org_project_id, actor.user, ctx.sourceType ?? 'proj_boq_versions', String(ctx.sourceId ?? v.id)).lastInsertRowid);
    return db.prepare('SELECT * FROM proj_boq_lines WHERE id = ?').get(id);
  }
  const lineApi = {
    list(actor, versionId, opts = {}) { const v = vrow(actor, versionId); return { version: view(actor, v, { detail: true }), lines: lineViews(actor, v, opts) }; },
    create(actor, versionId, b) {
      const v = vrow(actor, versionId, 'proj.version.edit'); mustEdit(v);
      return transaction(db, () => { const l = putLine(actor, v, b); retotal(v.id); writeAudit(db, { entity: 'proj_boq_lines', entityId: l.id, action: 'create', newValues: { code: l.item_code, kind: l.line_kind }, actor: actor.user, companyId: v.company_id }); return lineApi.list(actor, v.id); });
    },
    update(actor, id, b) {
      const { l, v } = lrow(actor, id); mustEdit(v);
      if (b.version != null && b.version !== l.version) throw conflict(`${l.item_code} was changed by someone else; reload it.`);
      const all = lines(v.id); const group = isGroup(l, all);
      if (group && (b.qty != null || b.rate != null) && (Number(b.qty ?? 0) !== 0 || Number(b.rate ?? 0) !== 0)) throw unprocessable(`${l.item_code} has lines under it: quantity and rate belong to the lowest lines.`);
      const m = { kind: l.line_kind, itemCode: l.item_code, description: l.description, uom: l.uom, qty: num(l.qty, 'quantity'), rate: num(l.rate, 'rate'), workItemId: l.work_item_id, analysisId: l.analysis_id, costCodeId: l.cost_code_id, isExtra: Boolean(l.is_extra), ...Object.fromEntries(Object.entries(b).filter(([k, x]) => x !== undefined && k !== 'version')) };
      fail(problems(actor, v, m, l));
      const leaf = LEAF_KINDS.includes(l.line_kind) && !group; const q = leaf ? dec(m.qty, 'quantity') : 0; const r = leaf ? dec(m.rate, 'rate') : 0;
      return transaction(db, () => {
        if (leaf && q !== l.qty) { const ms = mappedQty(l.id); if (ms.n > 0) throw unprocessable(`${l.item_code} is mapped for ${num(ms.s, 'quantity')}: change its mapping first (the splits sum to the quantity).`); }
        db.prepare('UPDATE proj_boq_lines SET item_code = ?, description = ?, uom = ?, qty = ?, rate = ?, amount = ?, is_extra = ?, work_item_id = ?, analysis_id = ?, cost_code_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(String(m.itemCode).trim(), String(m.description).trim(), leaf ? String(m.uom).trim().toUpperCase() : null, q, r, lineAmount(q, r), m.isExtra ? 1 : 0, m.workItemId ?? null, m.analysisId ?? null, m.costCodeId ?? null, actor.user, nowIso(), l.id);
        retotal(v.id); writeAudit(db, { entity: 'proj_boq_lines', entityId: l.id, action: 'update', oldValues: { qty: num(l.qty, 'quantity'), rate: num(l.rate, 'rate') }, newValues: b, actor: actor.user, companyId: v.company_id });
        return lineApi.list(actor, v.id);
      });
    },
    remove(actor, id) {
      const { l, v } = lrow(actor, id); mustEdit(v);
      if (isGroup(l, lines(v.id))) throw unprocessable(`${l.item_code} has lines under it: delete them first.`);
      return transaction(db, () => { const now = nowIso(); for (const t of ['proj_boq_line_wbs', 'proj_boq_line_norms']) db.prepare(`UPDATE ${t} SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE line_id = ? AND deleted_at IS NULL`).run(now, actor.user, l.id); db.prepare('UPDATE proj_boq_lines SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(now, actor.user, l.id); retotal(v.id); writeAudit(db, { entity: 'proj_boq_lines', entityId: l.id, action: 'delete', oldValues: { code: l.item_code }, actor: actor.user, companyId: v.company_id }); return lineApi.list(actor, v.id); });
    },
  };

  // ---- mapping (FR-04) and norms (FR-05) -----------------------------------------------------------------------------------------------------------------
  /** BR-01: the splits of an item over WBS nodes and locations sum to its quantity (or there are none). */
  function checkSplits(actor, v, l, splits) {
    const p = []; const o = v.org_project_id; const seen = new Set(); let sum = 0;
    if (!LEAF_KINDS.includes(l.line_kind) || isGroup(l, lines(v.id))) throw unprocessable(`${l.item_code} is not an item with a quantity: map the lowest lines.`);
    splits.forEach((s, i) => {
      const q = dec(s.qty, 'quantity'); if (q == null || q <= 0) p.push({ field: `splits.${i}.qty`, message: 'A split has a quantity above zero' }); else sum += q;
      const w = db.prepare('SELECT * FROM proj_wbs WHERE id = ? AND project_id = ? AND deleted_at IS NULL').get(s.wbsId, o);
      if (!w) p.push({ field: `splits.${i}.wbsId`, message: 'Choose a WBS node of this project' });
      else { if (w.wbs_status !== 'ACTIVE') p.push({ field: `splits.${i}.wbsId`, message: `${w.code} is inactive` }); if (db.prepare('SELECT 1 FROM proj_wbs WHERE parent_id = ? AND deleted_at IS NULL').get(w.id)) p.push({ field: `splits.${i}.wbsId`, message: `${w.code} has nodes under it: map to the lowest node` }); }
      if (s.locationId) { const loc = db.prepare('SELECT * FROM proj_locations WHERE id = ? AND project_id = ? AND deleted_at IS NULL').get(s.locationId, o); if (!loc) p.push({ field: `splits.${i}.locationId`, message: 'Choose a location of this project' }); else if (loc.loc_status !== 'ACTIVE') p.push({ field: `splits.${i}.locationId`, message: `${loc.code} is inactive` }); }
      const k = `${s.wbsId}:${s.locationId ?? 0}`; if (seen.has(k)) p.push({ field: `splits.${i}.wbsId`, message: 'The same WBS node and location are listed twice' }); seen.add(k);
    });
    if (splits.length && sum !== l.qty) p.push({ field: 'splits', message: `The splits sum to ${num(sum, 'quantity')} but the quantity of ${l.item_code} is ${num(l.qty, 'quantity')}: they must be equal` });
    fail(p);
  }
  function writeSplits(actor, l, splits) {
    db.prepare('DELETE FROM proj_boq_line_wbs WHERE line_id = ?').run(l.id);
    for (const s of splits) db.prepare("INSERT INTO proj_boq_line_wbs (company_id, line_id, wbs_id, location_id, qty, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, 'proj_boq_lines', ?)").run(l.company_id, l.id, s.wbsId, s.locationId ?? null, dec(s.qty, 'quantity'), fresh(l.version_id).org_project_id, actor.user, String(l.id));
  }
  const splitsOf = (lineId) => db.prepare('SELECT m.id, m.wbs_id, m.location_id, m.qty, w.code AS wbs_code, w.name AS wbs_name, l.code AS loc_code, l.name AS loc_name FROM proj_boq_line_wbs m JOIN proj_wbs w ON w.id = m.wbs_id LEFT JOIN proj_locations l ON l.id = m.location_id WHERE m.line_id = ? AND m.deleted_at IS NULL ORDER BY m.id').all(lineId).map((s) => ({ id: s.id, wbsId: s.wbs_id, wbsCode: s.wbs_code, wbsName: s.wbs_name, locationId: s.location_id, locationCode: s.loc_code, locationName: s.loc_name, qty: num(s.qty, 'quantity') }));
  function normProblems(actor, norms) {
    const p = [];
    norms.forEach((n, i) => { if (dec(n.qtyPerUnit, 'quantity') == null) p.push({ field: `norms.${i}.qtyPerUnit`, message: 'The norm is a quantity of zero or more' }); if (n.wastagePct != null && (dec(n.wastagePct, 'percent') == null || dec(n.wastagePct, 'percent') > 1000000)) p.push({ field: `norms.${i}.wastagePct`, message: 'Wastage is a percentage from 0 to 100' }); if (n.resourceItemId && !db.prepare('SELECT 1 FROM mdm_items WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(n.resourceItemId, actor.companyId)) p.push({ field: `norms.${i}.resourceItemId`, message: 'Choose a resource of the item master' }); });
    return p;
  }
  function writeNorms(actor, l, norms) {
    db.prepare('DELETE FROM proj_boq_line_norms WHERE line_id = ?').run(l.id);
    norms.forEach((n, i) => db.prepare("INSERT INTO proj_boq_line_norms (company_id, line_id, resource_item_id, norm_type, description, uom, qty_per_unit, wastage_pct, sort_order, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(l.company_id, l.id, n.resourceItemId ?? null, n.type, n.description.trim(), n.uom.trim().toUpperCase(), dec(n.qtyPerUnit, 'quantity'), dec(n.wastagePct ?? '0', 'percent') ?? 0, i + 1, fresh(l.version_id).org_project_id, actor.user, n.sourceType ?? 'proj_boq_lines', String(n.sourceId ?? l.id)));
  }
  const normsOf = (lineId) => db.prepare('SELECT * FROM proj_boq_line_norms WHERE line_id = ? AND deleted_at IS NULL ORDER BY sort_order, id').all(lineId).map((n) => ({ id: n.id, type: n.norm_type, typeLabel: NORM_TYPES[n.norm_type], resourceItemId: n.resource_item_id, description: n.description, uom: n.uom, qtyPerUnit: num(n.qty_per_unit, 'quantity'), wastagePct: num(n.wastage_pct, 'percent'), source: n.source_type }));
  const mapApi = {
    get(actor, id) { const { l, v } = lrow(actor, id, 'proj.version.view'); return { line: { id: l.id, code: l.item_code, description: l.description, uom: l.uom, qty: num(l.qty, 'quantity') }, splits: splitsOf(l.id), mappedQty: num(mappedQty(l.id).s, 'quantity'), can: { map: may(actor, 'proj.boq.map', v.org_project_id) && editable(v), amend: may(actor, 'proj.version.amend', v.org_project_id) && v.status === 'APPROVED' } }; },
    set(actor, id, { splits }) {
      const { l, v } = lrow(actor, id, 'proj.boq.map'); mustEdit(v); checkSplits(actor, v, l, splits);
      return transaction(db, () => { writeSplits(actor, l, splits); writeAudit(db, { entity: 'proj_boq_line_wbs', entityId: l.id, action: 'map', newValues: { splits: splits.length }, actor: actor.user, companyId: v.company_id }); event('boq.mapping.changed', actor, 'boq_line', l.id, v.company_id, v.org_project_id, { projectId: v.org_project_id, versionId: v.id, lineId: l.id, code: l.item_code, splits: splits.length }); return mapApi.get(actor, l.id); });
    },
    /** FR-04: the whole quantity of each chosen item to one WBS node (and location). */
    bulk(actor, versionId, { lineIds, wbsId, locationId }) {
      const v = vrow(actor, versionId, 'proj.boq.map'); mustEdit(v);
      return transaction(db, () => {
        let n = 0;
        for (const lid of lineIds) { const l = db.prepare('SELECT * FROM proj_boq_lines WHERE id = ? AND version_id = ? AND deleted_at IS NULL').get(lid, v.id); if (!l) throw notFound(`Line ${lid} is not in this BOQ.`); if (l.qty === 0) continue; const sp = [{ wbsId, locationId: locationId ?? null, qty: num(l.qty, 'quantity') }]; checkSplits(actor, v, l, sp); writeSplits(actor, l, sp); n += 1; }
        writeAudit(db, { entity: 'proj_boq_line_wbs', entityId: v.id, action: 'bulk_map', newValues: { lines: n, wbsId }, actor: actor.user, companyId: v.company_id });
        event('boq.mapping.changed', actor, 'boq_version', v.id, v.company_id, v.org_project_id, { projectId: v.org_project_id, versionId: v.id, lines: n, bulk: true });
        return { mapped: n, ...lineApi.list(actor, v.id) };
      });
    },
  };
  const normApi = {
    get(actor, id) { const { l, v } = lrow(actor, id, 'proj.version.view'); return { line: { id: l.id, code: l.item_code, description: l.description, uom: l.uom, analysisId: l.analysis_id }, norms: normsOf(l.id), can: { map: may(actor, 'proj.boq.map', v.org_project_id) && editable(v), amend: may(actor, 'proj.version.amend', v.org_project_id) && v.status === 'APPROVED' } }; },
    set(actor, id, { norms }) {
      const { l, v } = lrow(actor, id, 'proj.boq.map'); mustEdit(v); fail(normProblems(actor, norms));
      if (!LEAF_KINDS.includes(l.line_kind) || isGroup(l, lines(v.id))) throw unprocessable(`${l.item_code} is not an item with a quantity: norms belong to the lowest lines.`);
      return transaction(db, () => { writeNorms(actor, l, norms); writeAudit(db, { entity: 'proj_boq_line_norms', entityId: l.id, action: 'norms', newValues: { norms: norms.length }, actor: actor.user, companyId: v.company_id }); return normApi.get(actor, l.id); });
    },
    /** FR-05: the norms of the rate analysis of the item: quantity per unit of the item = quantity per basis / basis quantity. */
    fromAnalysis(actor, id) {
      const { l, v } = lrow(actor, id, 'proj.boq.map'); mustEdit(v);
      if (!l.analysis_id) throw unprocessable(`${l.item_code} has no rate analysis: choose one on the item first.`);
      const a = db.prepare('SELECT * FROM ra_analyses WHERE id = ? AND company_id = ?').get(l.analysis_id, l.company_id); if (!a) throw unprocessable('The rate analysis does not exist.');
      const rows = db.prepare('SELECT * FROM ra_analysis_lines WHERE analysis_id = ? AND deleted_at IS NULL ORDER BY line_no').all(a.id); if (!rows.length) throw unprocessable(`${a.analysis_no} has no resource lines.`);
      const norms = rows.map((r) => ({ type: r.component_type, resourceItemId: r.component_item_id, description: r.description, uom: r.uom, qtyPerUnit: num(Math.round((r.qty_per_basis * 1000) / a.basis_qty), 'quantity'), wastagePct: num(r.wastage_pct, 'percent'), sourceType: 'ra_analyses', sourceId: a.id }));
      return transaction(db, () => { writeNorms(actor, l, norms); writeAudit(db, { entity: 'proj_boq_line_norms', entityId: l.id, action: 'norms_from_analysis', newValues: { analysis: a.analysis_no, norms: norms.length }, actor: actor.user, companyId: v.company_id }); return normApi.get(actor, l.id); });
    },
  };

  // ---- versions (FR-01, FR-07) ---------------------------------------------------------------------------------------------------------------------------
  function copyLines(actor, from, to) {
    const map = new Map();
    for (const l of lines(from.id)) {
      const id = Number(db.prepare("INSERT INTO proj_boq_lines (company_id, version_id, parent_id, line_kind, item_code, description, uom, qty, rate, amount, is_extra, work_item_id, analysis_id, cost_code_id, sort_order, source_line_id, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proj_boq_lines', ?)").run(l.company_id, to.id, l.parent_id ? map.get(l.parent_id) : null, l.line_kind, l.item_code, l.description, l.uom, l.qty, l.rate, l.amount, l.is_extra, l.work_item_id, l.analysis_id, l.cost_code_id, l.sort_order, l.id, to.org_project_id, actor.user, String(l.id)).lastInsertRowid);
      map.set(l.id, id);
      for (const m of db.prepare('SELECT * FROM proj_boq_line_wbs WHERE line_id = ? AND deleted_at IS NULL').all(l.id)) db.prepare("INSERT INTO proj_boq_line_wbs (company_id, line_id, wbs_id, location_id, qty, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, 'proj_boq_line_wbs', ?)").run(m.company_id, id, m.wbs_id, m.location_id, m.qty, to.org_project_id, actor.user, String(m.id));
      for (const n of db.prepare('SELECT * FROM proj_boq_line_norms WHERE line_id = ? AND deleted_at IS NULL').all(l.id)) db.prepare("INSERT INTO proj_boq_line_norms (company_id, line_id, resource_item_id, norm_type, description, uom, qty_per_unit, wastage_pct, sort_order, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proj_boq_line_norms', ?)").run(n.company_id, id, n.resource_item_id, n.norm_type, n.description, n.uom, n.qty_per_unit, n.wastage_pct, n.sort_order, to.org_project_id, actor.user, String(n.id));
    }
    retotal(to.id);
  }
  /** FR-01 and 10.02: the BOQ copied from the award into the project becomes a tender version: a section of the award is a section line, an item an item. */
  function copyFromAward(actor, to) {
    const items = db.prepare('SELECT * FROM proj_boq_items WHERE project_id = ? AND deleted_at IS NULL ORDER BY sort_order, id').all(to.org_project_id);
    if (!items.length) throw unprocessable('The award has left no BOQ in this project (part 10.02): import one.');
    const sections = new Map();
    for (const i of items) {
      let sec = sections.get(i.section_code);
      if (!sec) { sec = putLine(actor, to, { kind: 'SECTION', itemCode: i.section_code, description: i.section_name || `Section ${i.section_code}` }, { sourceType: 'proj_boq_items', sourceId: i.id }); sections.set(i.section_code, sec); }
      const rateU = i.client_rate ?? i.selling_rate * 100;
      putLine(actor, to, { kind: 'ITEM', parentId: sec.id, itemCode: i.item_no, description: i.description, uom: i.uom, qty: num(i.qty, 'quantity'), rate: num(rateU, 'rate') }, { sourceType: 'proj_boq_items', sourceId: i.id });
    }
    retotal(to.id);
  }
  /** The revised version of an approved variation as a copy of the latest frozen version; the caller has checked the right to ask. */
  function revisedFor(actor, o, variationRef, name) {
    const ok = variationProviders.map((f) => f(db, { companyId: actor.companyId, projectId: o.id, variationRef })).find(Boolean);
    if (!ok) throw unprocessable(`Variation ${variationRef} is not an approved variation of this project: a revised BOQ is made only from an approved variation (21.05).`);
    const base = db.prepare("SELECT * FROM proj_boq_versions WHERE org_project_id = ? AND status = 'APPROVED' AND vtype IN ('CONTRACT', 'REVISED') AND deleted_at IS NULL ORDER BY version_no DESC LIMIT 1").get(o.id);
    if (!base) throw unprocessable('The contract BOQ is not frozen yet: there is nothing to revise.');
    if (db.prepare("SELECT 1 FROM proj_boq_versions WHERE org_project_id = ? AND vtype = 'REVISED' AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL").get(o.id)) throw conflict('Another revised BOQ is open: finish or cancel it first.');
    return transaction(db, () => {
      const no = db.prepare('SELECT COALESCE(MAX(version_no), 0) + 1 AS n FROM proj_boq_versions WHERE org_project_id = ?').get(o.id).n;
      const id = Number(db.prepare("INSERT INTO proj_boq_versions (company_id, doc_no, org_project_id, vtype, version_no, name, source_ref, parent_version_id, variation_ref, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, 'REVISED', ?, ?, ?, ?, ?, ?, ?, 'proj_boq', ?)").run(actor.companyId, nextNo(actor), o.id, no, name?.trim() || `Revised BOQ for ${variationRef}`, `Variation ${ok.ref}`, base.id, variationRef, o.id, actor.user, String(o.id)).lastInsertRowid);
      copyLines(actor, base, fresh(id));
      writeAudit(db, { entity: 'proj_boq_versions', entityId: id, action: 'create_revised', newValues: { variation: variationRef, from: base.doc_no }, actor: actor.user, companyId: actor.companyId });
      event('boq.version.created', actor, 'boq_version', id, actor.companyId, o.id, { projectId: o.id, versionId: id, type: 'REVISED', variationRef });
      return id;
    });
  }
  const versions = {
    list(actor, query) {
      need(actor, 'proj.version.view', 'see BOQ versions'); const s = scopeSql(actor);
      return runList(db, boqVersionList, parseListRequest(boqVersionList, query), { select: 'x.*', scopeSql: s.sql, params: s.params, tieBreaker: 'x.id', map: (x) => { const v = view(actor, x); return { id: v.id, docNo: v.docNo, name: v.name, projectId: v.projectId, project: v.projectCode, type: v.type, typeLabel: v.typeLabel, versionNo: v.versionNo, status: v.status, statusLabel: v.statusLabel, total: v.total, items: v.items, frozenAt: v.frozenAt }; } });
    },
    exportSource(actor, req) {
      need(actor, 'proj.version.export', 'export BOQ versions'); const s = scopeSql(actor); const opts = { select: 'x.*', scopeSql: s.sql, params: s.params, tieBreaker: 'x.id' };
      return { title: boqVersionList.label, permission: 'proj.version.export', personal: false, columns: [{ key: 'docNo', label: 'Version', type: 'text' }, { key: 'name', label: 'Name', type: 'text' }, { key: 'project', label: 'Project', type: 'text' }, { key: 'type', label: 'Type', type: 'text' }, { key: 'status', label: 'Status', type: 'text' }, { key: 'items', label: 'Items', type: 'number' }, { key: 'total', label: 'Total (₹)', type: 'money' }], count: () => countList(db, boqVersionList, req, opts),
        rows: () => runList(db, boqVersionList, req, { ...opts, limit: null, map: (x) => { const v = view(actor, x); return { docNo: v.docNo, name: v.name, project: v.projectCode, type: v.typeLabel, status: v.statusLabel, items: v.items, total: v.total ?? '' }; } }).data, describe: (r) => [r.q ? `search "${r.q}"` : ''].filter(Boolean) };
    },
    get(actor, id) { return view(actor, vrow(actor, id), { detail: true }); },
    create(actor, b) {
      const o = project(actor, b.projectId, 'proj.version.create');
      if (b.vtype === 'CONTRACT' && db.prepare("SELECT 1 FROM proj_boq_versions WHERE org_project_id = ? AND vtype = 'CONTRACT' AND deleted_at IS NULL AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED')").get(o.id)) throw conflict('The project has a contract BOQ already (draft, waiting or frozen).');
      let src = null; if (b.from === 'VERSION') { src = db.prepare('SELECT * FROM proj_boq_versions WHERE id = ? AND org_project_id = ? AND deleted_at IS NULL').get(b.sourceVersionId ?? 0, o.id); if (!src) throw badRequest('Correct the highlighted fields', [{ field: 'sourceVersionId', message: 'Choose a version of this project' }]); }
      return transaction(db, () => {
        const no = (db.prepare('SELECT COALESCE(MAX(version_no), 0) + 1 AS n FROM proj_boq_versions WHERE org_project_id = ?').get(o.id).n);
        const id = Number(db.prepare("INSERT INTO proj_boq_versions (company_id, doc_no, org_project_id, vtype, version_no, name, source_ref, parent_version_id, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proj_boq', ?)").run(actor.companyId, nextNo(actor), o.id, b.vtype, no, b.name.trim(), b.sourceRef ?? (src ? src.doc_no : b.from === 'AWARD' ? 'Award of the tender (10.02)' : null), src?.id ?? null, o.id, actor.user, String(o.id)).lastInsertRowid);
        const v = fresh(id);
        if (b.from === 'AWARD') copyFromAward(actor, v); else if (src) copyLines(actor, src, v);
        writeAudit(db, { entity: 'proj_boq_versions', entityId: id, action: 'create', newValues: { type: b.vtype, from: b.from }, actor: actor.user, companyId: actor.companyId });
        event('boq.version.created', actor, 'boq_version', id, actor.companyId, o.id, { projectId: o.id, versionId: id, docNo: v.doc_no, type: b.vtype, items: fresh(id).items_count });
        return versions.get(actor, id);
      });
    },
    /** BR-02: a revised version is made only from an approved variation (21.05), as a copy of the latest frozen version. */
    createRevised(actor, { projectId, variationRef, name }) {
      const o = project(actor, projectId, 'proj.version.create');
      return versions.get(actor, revisedFor(actor, o, variationRef, name));
    },
    /** FR-04 of 21.05: the approved variation makes its revised BOQ itself: the quantities of the varied items change and the extra items are added. What cannot be placed (a mapped quantity) is returned as a note for the QS. The variation order was approved by its own chain, so this path asks no BOQ right. */
    reviseFromVariation(companyId, { projectId, variationRef, user, name, changes }) {
      const o = orgOf(Number(projectId)); if (!o || o.company_id !== companyId) throw notFound('That project does not exist.'); const actor = { user, companyId, roles: ['SYSTEM'] }; const notes = [];
      return transaction(db, () => {
        const id = revisedFor(actor, o, variationRef, name); const v = fresh(id); const lines = db.prepare('SELECT * FROM proj_boq_lines WHERE version_id = ? AND deleted_at IS NULL').all(id);
        for (const c of changes) {
          try {
            if (c.itemCode) { const l = lines.find((y) => y.item_code === c.itemCode); if (!l) { notes.push(`${c.itemCode}: not in the revised BOQ`); continue; } if (mappedQty(l.id).n > 0) { notes.push(`${c.itemCode}: its quantity is mapped to the WBS; change the mapping and the quantity by hand (${num(l.qty + c.qtyChange, 'quantity')} is the new quantity)`); continue; } const q = l.qty + c.qtyChange; if (q < 0) { notes.push(`${c.itemCode}: the quantity would go below zero`); continue; } db.prepare('UPDATE proj_boq_lines SET qty = ?, amount = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(q, lineAmount(q, l.rate), user, nowIso(), l.id); }
            else putLine(actor, v, { kind: 'ITEM', itemCode: c.extraCode, description: c.description, uom: c.uom ?? undefined, qty: num(c.qtyChange, 'quantity'), rate: num(c.rate, 'rate'), isExtra: true, analysisId: c.analysisId ?? undefined, costCodeId: c.costCodeId ?? undefined });
          } catch (e) { notes.push(`${c.itemCode ?? c.extraCode}: ${e.message}`); }
        }
        retotal(id); return { versionId: id, docNo: v.doc_no, notes };
      });
    },
    update(actor, id, b) {
      const v = vrow(actor, id, 'proj.version.edit'); mustEdit(v);
      if (b.version != null && b.version !== v.version) throw conflict(`${v.doc_no} was changed by someone else; reload it.`);
      db.prepare('UPDATE proj_boq_versions SET name = ?, source_ref = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.name?.trim() ?? v.name, b.sourceRef === undefined ? v.source_ref : b.sourceRef, actor.user, nowIso(), v.id);
      writeAudit(db, { entity: 'proj_boq_versions', entityId: v.id, action: 'update', oldValues: { name: v.name }, newValues: b, actor: actor.user, companyId: v.company_id });
      return versions.get(actor, v.id);
    },
    remove(actor, id) {
      const v = vrow(actor, id, 'proj.version.delete'); if (v.status !== 'DRAFT' || v.workflow_instance_id) throw unprocessable('Only a draft that was never sent for approval is deleted; cancel any other.');
      if (db.prepare("SELECT 1 FROM proj_boq_versions WHERE parent_version_id = ? AND deleted_at IS NULL").get(v.id)) throw conflict(`${v.doc_no} is the source of another version: it is kept.`);
      return transaction(db, () => { const now = nowIso(); for (const t of ['proj_boq_line_wbs', 'proj_boq_line_norms']) db.prepare(`UPDATE ${t} SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE deleted_at IS NULL AND line_id IN (SELECT id FROM proj_boq_lines WHERE version_id = ?)`).run(now, actor.user, v.id); db.prepare('UPDATE proj_boq_lines SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE version_id = ? AND deleted_at IS NULL').run(now, actor.user, v.id); db.prepare('UPDATE proj_boq_versions SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(now, actor.user, v.id); writeAudit(db, { entity: 'proj_boq_versions', entityId: v.id, action: 'delete', actor: actor.user, companyId: v.company_id }); return { id: v.id, deleted: true }; });
    },
    /** FR-07: the freeze: contract and revised versions go to QS, the commercial manager and the project manager; the approval freezes the version. */
    submit(actor, id) {
      const v = vrow(actor, id, 'proj.version.submit');
      if (!['CONTRACT', 'REVISED'].includes(v.vtype)) throw unprocessable('A tender version is not frozen: make a contract version from it.');
      if (!editable(v)) throw lockedMsg(v);
      const all = lines(v.id); const leaf = all.filter((l) => LEAF_KINDS.includes(l.line_kind) && !isGroup(l, all)); if (!leaf.length) throw unprocessable('The BOQ has no item: there is nothing to freeze.');
      const bad = leaf.filter((l) => l.qty > 0 && l.rate === 0); const warn = [];
      if (bad.length) warn.push({ code: 'NO_RATE', text: `${bad.length} item(s) have a quantity and no rate` });
      const un = leaf.filter((l) => l.qty > 0 && mappedQty(l.id).s !== l.qty); if (un.length) warn.push({ code: 'UNMAPPED', text: `${un.length} item(s) are not mapped to the WBS` });
      return transaction(db, () => {
        const ctx = { projectId: v.org_project_id, amount: Number(money(v.total_amount)) };
        if (v.status === 'RETURNED') workflowOf(db).resubmit(actor, v.workflow_instance_id, { comment: 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: BOQ_FREEZE_DOC, docId: String(v.id), comment: `${orgOf(v.org_project_id).code} ${v.doc_no}`, context: ctx }); db.prepare('UPDATE proj_boq_versions SET workflow_instance_id = ? WHERE id = ?').run(inst.id, v.id); }
        db.prepare("UPDATE proj_boq_versions SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), v.id);
        writeAudit(db, { entity: 'proj_boq_versions', entityId: v.id, action: 'submit', newValues: { warnings: warn.length }, actor: actor.user, companyId: v.company_id });
        return { ...versions.get(actor, v.id), warnings: warn };
      });
    },
    withdraw(actor, id, { reason }) { const v = vrow(actor, id); if (v.status !== 'SUBMITTED') throw unprocessable('Only a version waiting for approval is withdrawn.'); if (!same(v.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, v.workflow_instance_id, { comment: reason }); return versions.get(actor, v.id); },
    cancel(actor, id, { reason }) {
      const v = vrow(actor, id, 'proj.version.cancel'); if (!['DRAFT', 'RETURNED', 'SUBMITTED'].includes(v.status) || v.vtype === 'TENDER') throw unprocessable('Only a contract or revised version that is not frozen is cancelled.');
      return transaction(db, () => { if (v.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, v.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare("UPDATE proj_boq_versions SET status = 'CANCELLED', remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), v.id); writeAudit(db, { entity: 'proj_boq_versions', entityId: v.id, action: 'cancel', reason, actor: actor.user, companyId: v.company_id }); return versions.get(actor, v.id); });
    },
    history(actor, id) {
      const v = vrow(actor, id); const cids = db.prepare('SELECT id, workflow_instance_id AS w FROM proj_boq_changes WHERE version_id = ? AND deleted_at IS NULL').all(v.id);
      const ap = (w) => (w ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(w) : []);
      return { approvals: ap(v.workflow_instance_id), changes: cids.flatMap((c) => ap(c.w)), audit: db.prepare('SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = ? AND entity_id = ? ORDER BY id').all('proj_boq_versions', String(v.id)) };
    },
    /** The approval of the freeze: the version is final; budget, schedule, measurements, material planning and billing are told. */
    decide(instance, actor, outcome, comment) {
      const v = fresh(rid(instance.docId)); if (!v || v.status !== 'SUBMITTED') return;
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN';
      const to = outcome === 'APPROVED' ? 'APPROVED' : outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED';
      db.prepare('UPDATE proj_boq_versions SET status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, actor.user, nowIso(), v.id);
      if (withdrawn) db.prepare('UPDATE proj_boq_versions SET workflow_instance_id = NULL WHERE id = ?').run(v.id);
      writeAudit(db, { entity: 'proj_boq_versions', entityId: v.id, action: outcome.toLowerCase(), reason: comment ?? null, actor: actor.user, companyId: v.company_id });
      if (to !== 'APPROVED') return;
      const now = nowIso(); db.prepare('UPDATE proj_boq_versions SET frozen_at = ?, frozen_by = ? WHERE id = ?').run(now, actor.user, v.id);
      const o = orgOf(v.org_project_id); const all = lines(v.id); const leaf = all.filter((l) => LEAF_KINDS.includes(l.line_kind) && !isGroup(l, all));
      event('boq.version.frozen', actor, 'boq_version', v.id, v.company_id, v.org_project_id, { projectId: v.org_project_id, code: o?.code, versionId: v.id, docNo: v.doc_no, type: v.vtype, versionNo: v.version_no, total: money(v.total_amount), items: leaf.length, supersedes: v.parent_version_id, variationRef: v.variation_ref, frozenBy: actor.user });
    },
  };

  // ---- import (FR-03) ------------------------------------------------------------------------------------------------------------------------------------
  /** Checks the rows of a client BOQ and reports each problem with its row (T-01); `rows` carry the row number of the source sheet. */
  function checkRows(rows, existingCodes = new Set()) {
    const errors = []; const out = []; const seen = new Map(); const add = (row, field, message) => errors.push({ row, field, message });
    rows.forEach((r, i) => {
      const row = r.row ?? i + 1; const code = String(r.itemCode ?? '').trim(); const desc = String(r.description ?? '').trim(); const uom = String(r.uom ?? '').trim();
      const q = r.qty === '' || r.qty == null ? null : dec(r.qty, 'quantity'); const rt = r.rate === '' || r.rate == null ? null : dec(r.rate, 'rate');
      if (!code) add(row, 'itemCode', 'The item code is missing'); else if (seen.has(code.toLowerCase())) add(row, 'itemCode', `The item code ${code} is on row ${seen.get(code.toLowerCase())} already`); else if (existingCodes.has(code.toLowerCase())) add(row, 'itemCode', `The item code ${code} is in this BOQ already`); else seen.set(code.toLowerCase(), row);
      if (!desc) add(row, 'description', 'The description is missing'); if (!uom) add(row, 'uom', 'The unit is missing');
      if (r.qty == null || r.qty === '') add(row, 'qty', 'The quantity is missing'); else if (q == null) add(row, 'qty', `The quantity "${r.qty}" is not a number of zero or more`);
      if (r.rate != null && r.rate !== '' && rt == null) add(row, 'rate', `The rate "${r.rate}" is not a number of zero or more`);
      out.push({ row, bill: String(r.bill ?? '').trim(), section: String(r.section ?? '').trim(), itemCode: code, description: desc, uom: uom.toUpperCase(), qty: q ?? 0, rate: rt ?? 0, parentCode: String(r.parentCode ?? '').trim(), isExtra: /^(y|yes|true|1|extra|nsi)/i.test(String(r.extra ?? '')) });
    });
    const codes = new Set(out.map((r) => r.itemCode.toLowerCase()));
    for (const r of out) if (r.parentCode && !codes.has(r.parentCode.toLowerCase())) add(r.row, 'parentCode', `The parent item ${r.parentCode} is not in the file`);
    const total = out.reduce((s, r) => s + lineAmount(r.qty, r.rate), 0);
    return { errors, rows: out, total };
  }
  function writeImported(actor, v, rows) {
    const bills = new Map(); const secs = new Map(); const items = new Map(); let order = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS n FROM proj_boq_lines WHERE version_id = ?').get(v.id).n;
    const grp = (map, key, kind, parentId, name) => { const k = `${parentId ?? 0}|${key}`; if (map.has(k)) return map.get(k); const code = db.prepare('SELECT 1 FROM proj_boq_lines WHERE version_id = ? AND item_code = ? AND deleted_at IS NULL').get(v.id, key) ? `${key}~${kind}` : key; const l = putLine(actor, v, { kind, parentId, itemCode: code, description: name || key, sortOrder: (order += 1) }, { sourceType: 'import' }); map.set(k, l.id); return l.id; };
    for (const r of rows.filter((x) => !x.parentCode)) {
      const bill = r.bill ? grp(bills, r.bill, 'BILL', null, r.bill) : null; const sec = r.section ? grp(secs, r.section, 'SECTION', bill, r.section) : null;
      const l = putLine(actor, v, { kind: 'ITEM', parentId: sec ?? bill, itemCode: r.itemCode, description: r.description, uom: r.uom, qty: num(r.qty, 'quantity'), rate: num(r.rate, 'rate'), isExtra: r.isExtra, sortOrder: (order += 1), sourceRow: r.row }, { sourceType: 'import' }); items.set(r.itemCode.toLowerCase(), l.id);
    }
    for (const r of rows.filter((x) => x.parentCode)) { const pid = items.get(r.parentCode.toLowerCase()); const l = putLine(actor, v, { kind: 'SUBITEM', parentId: pid, itemCode: r.itemCode, description: r.description, uom: r.uom, qty: num(r.qty, 'quantity'), rate: num(r.rate, 'rate'), isExtra: r.isExtra, sortOrder: (order += 1), sourceRow: r.row }, { sourceType: 'import' }); items.set(r.itemCode.toLowerCase(), l.id); }
  }
  const importApi = {
    /** The preview and the commit of an import of the client's BOQ into a new draft version (or an empty draft). Nothing is made when a row is wrong. */
    /** A request body is limited to 50 KB: a large client BOQ is staged in chunks of up to 300 rows, then checked and committed as one. */
    stage(actor, { projectId, stageId, rows }) {
      const o = project(actor, projectId, 'proj.boq.import'); need(actor, 'proj.version.create', 'make BOQ versions', o.id);
      const sid = stageId ?? `stg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      if (stageId && !db.prepare('SELECT 1 FROM proj_boq_import_rows WHERE stage_id = ? AND user_ref = ? AND org_project_id = ?').get(sid, actor.user, o.id) && db.prepare('SELECT 1 FROM proj_boq_import_rows WHERE stage_id = ?').get(sid)) throw forbidden('That staged import is not yours.');
      return transaction(db, () => {
        db.prepare("DELETE FROM proj_boq_import_rows WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')").run();
        const n0 = db.prepare('SELECT COUNT(*) AS n FROM proj_boq_import_rows WHERE stage_id = ?').get(sid).n; if (n0 + rows.length > 20000) throw unprocessable('A staged import holds at most 20,000 rows.');
        const ins = db.prepare("INSERT INTO proj_boq_import_rows (company_id, stage_id, user_ref, org_project_id, row_no, data_json, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, 'proj_boq_import')");
        rows.forEach((r, i) => ins.run(actor.companyId, sid, actor.user, o.id, r.row ?? n0 + i + 1, JSON.stringify(r), actor.user));
        return { stageId: sid, rows: n0 + rows.length };
      });
    },
    run(actor, b) {
      const o = project(actor, b.projectId, 'proj.boq.import'); need(actor, 'proj.version.create', 'make BOQ versions', o.id);
      if (b.stageId) { const st = db.prepare('SELECT data_json FROM proj_boq_import_rows WHERE stage_id = ? AND user_ref = ? AND org_project_id = ? ORDER BY row_no, id').all(b.stageId, actor.user, o.id).map((r) => JSON.parse(r.data_json)); if (!st.length) throw unprocessable('The staged import was not found or is empty: send the rows again.'); b = { ...b, rows: [...st, ...b.rows] }; }
      if (!b.rows.length) throw badRequest('Correct the highlighted fields', [{ field: 'rows', message: 'Give at least one row' }]);
      let into = null; if (b.intoVersionId) { into = vrow(actor, b.intoVersionId, 'proj.boq.import'); mustEdit(into); }
      const existing = new Set(into ? lines(into.id).map((l) => l.item_code.toLowerCase()) : []);
      const c = checkRows(b.rows, existing);
      const summary = { rows: c.rows.length, errors: c.errors, total: money(c.total), bills: new Set(c.rows.map((r) => r.bill).filter(Boolean)).size, sections: new Set(c.rows.map((r) => `${r.bill}|${r.section}`).filter((k) => k !== '|')).size, committed: false };
      if (!rates(actor, o.id)) summary.total = null;
      if (!b.commit || c.errors.length) return { ...summary, preview: c.rows.slice(0, 200).map((r) => ({ row: r.row, bill: r.bill, section: r.section, itemCode: r.itemCode, description: r.description, uom: r.uom, qty: num(r.qty, 'quantity'), rate: rates(actor, o.id) ? num(r.rate, 'rate') : null })) };
      if (!into && b.vtype === 'CONTRACT' && db.prepare("SELECT 1 FROM proj_boq_versions WHERE org_project_id = ? AND vtype = 'CONTRACT' AND deleted_at IS NULL AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED')").get(o.id)) throw conflict('The project has a contract BOQ already (draft, waiting or frozen).');
      return transaction(db, () => {
        if (b.stageId) db.prepare('DELETE FROM proj_boq_import_rows WHERE stage_id = ?').run(b.stageId);
        let v = into;
        if (!v) { const no = db.prepare('SELECT COALESCE(MAX(version_no), 0) + 1 AS n FROM proj_boq_versions WHERE org_project_id = ?').get(o.id).n; const id = Number(db.prepare("INSERT INTO proj_boq_versions (company_id, doc_no, org_project_id, vtype, version_no, name, source_ref, import_map_json, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, 'Imported client BOQ', ?, ?, ?, 'proj_boq', ?)").run(actor.companyId, nextNo(actor), o.id, b.vtype, no, b.name?.trim() || 'Imported client BOQ', b.columns ? JSON.stringify(b.columns) : null, o.id, actor.user, String(o.id)).lastInsertRowid); v = fresh(id); }
        else if (b.columns) db.prepare('UPDATE proj_boq_versions SET import_map_json = ? WHERE id = ?').run(JSON.stringify(b.columns), v.id);
        writeImported(actor, v, c.rows); const total = retotal(v.id);
        writeAudit(db, { entity: 'proj_boq_versions', entityId: v.id, action: 'import', newValues: { rows: c.rows.length, total: money(total) }, actor: actor.user, companyId: v.company_id });
        event('boq.version.created', actor, 'boq_version', v.id, v.company_id, o.id, { projectId: o.id, versionId: v.id, type: v.vtype, items: c.rows.length, imported: true });
        return { ...summary, committed: true, total: rates(actor, o.id) ? money(total) : null, version: versions.get(actor, v.id) };
      });
    },
    /** One row of the Excel import (04.13): a line added to a draft version (give the version number). */
    importRow(actor, { versionNo, row }) {
      const v = db.prepare('SELECT * FROM proj_boq_versions WHERE company_id = ? AND doc_no = ? AND deleted_at IS NULL').get(actor.companyId, versionNo); if (!v) throw unprocessable(`BOQ version ${versionNo} does not exist`);
      const vv = vrow(actor, v.id, 'proj.boq.import'); mustEdit(vv);
      const c = checkRows([row], new Set(lines(v.id).map((l) => l.item_code.toLowerCase()))); if (c.errors.length) throw unprocessable(c.errors.map((e) => e.message).join('; '));
      writeImported(actor, v, c.rows.map((r) => ({ ...r, parentCode: '' }))); retotal(v.id); return { id: v.id, ref: `${v.doc_no} ${c.rows[0].itemCode}` };
    },
  };

  // ---- changes of mapping and norms after the freeze --------------------------------------------------------------------------------------------------------
  function applyOps(actor, v, ops) {
    for (const op of ops) {
      const l = db.prepare('SELECT * FROM proj_boq_lines WHERE id = ? AND version_id = ? AND deleted_at IS NULL').get(op.lineId, v.id); if (!l) throw unprocessable(`Line ${op.lineId} is not in ${v.doc_no}`);
      if (op.splits) { checkSplits(actor, v, l, op.splits); writeSplits(actor, l, op.splits); } else { fail(normProblems(actor, op.norms)); writeNorms(actor, l, op.norms); }
    }
  }
  const crow = (actor, id) => { const c = db.prepare('SELECT * FROM proj_boq_changes WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); const v = c ? fresh(c.version_id) : null; if (!v || !may(actor, 'proj.version.view', v.org_project_id)) throw notFound('That change does not exist.'); return { c, v }; };
  const cview = (c) => ({ id: c.id, versionId: c.version_id, status: c.change_status, statusLabel: BOQ_STATUS[c.change_status], reason: c.reason, requestedBy: c.requested_by, decidedAt: c.decided_at, ops: json(c.ops_json, []).length, diff: json(c.diff_json, []), workflowInstanceId: c.workflow_instance_id });
  const changes = {
    list(actor, versionId) { const v = vrow(actor, versionId); return db.prepare('SELECT * FROM proj_boq_changes WHERE version_id = ? AND deleted_at IS NULL ORDER BY id DESC').all(v.id).map(cview); },
    get(actor, id) { return cview(crow(actor, id).c); },
    /** Mapping and norms of a frozen version change only by a request approved by QS and the project manager. */
    amend(actor, id, { reason, ops }) {
      const v = vrow(actor, id, 'proj.version.amend'); if (v.status !== 'APPROVED') throw unprocessable('Only a frozen version is changed this way; a draft is edited directly.');
      if (db.prepare("SELECT 1 FROM proj_boq_changes WHERE version_id = ? AND change_status IN ('SUBMITTED', 'DRAFT', 'RETURNED') AND deleted_at IS NULL").get(v.id)) throw conflict('Another change of this version is waiting for approval.');
      const before = new Map(); for (const op of ops) before.set(op.lineId, { splits: splitsOf(op.lineId), norms: normsOf(op.lineId) });
      let diff = null;
      try { transaction(db, () => { applyOps(actor, v, ops); diff = ops.map((op) => { const l = db.prepare('SELECT item_code FROM proj_boq_lines WHERE id = ?').get(op.lineId); return { lineId: op.lineId, code: l.item_code, kind: op.splits ? 'MAPPING' : 'NORMS', before: op.splits ? before.get(op.lineId).splits : before.get(op.lineId).norms, after: op.splits ? splitsOf(op.lineId) : normsOf(op.lineId) }; }); throw new Rollback('dry run'); }); } catch (x) { if (!(x instanceof Rollback)) throw x; }
      return transaction(db, () => {
        const cid = Number(db.prepare("INSERT INTO proj_boq_changes (company_id, version_id, change_status, reason, ops_json, diff_json, requested_by, project_id, created_by, source_type, source_id) VALUES (?, ?, 'SUBMITTED', ?, ?, ?, ?, ?, ?, 'proj_boq_versions', ?)").run(v.company_id, v.id, reason, JSON.stringify(ops), JSON.stringify(diff), actor.user, v.org_project_id, actor.user, String(v.id)).lastInsertRowid);
        const inst = workflowOf(db).submit(actor, { docType: BOQ_MAP_DOC, docId: String(cid), comment: `${orgOf(v.org_project_id).code} ${v.doc_no} mapping`, context: { projectId: v.org_project_id } });
        db.prepare('UPDATE proj_boq_changes SET workflow_instance_id = ? WHERE id = ?').run(inst.id, cid);
        writeAudit(db, { entity: 'proj_boq_changes', entityId: cid, action: 'submit', newValues: { ops: ops.length }, reason, actor: actor.user, companyId: v.company_id });
        return { ...cview(db.prepare('SELECT * FROM proj_boq_changes WHERE id = ?').get(cid)) };
      });
    },
    withdraw(actor, id, { reason }) { const { c } = crow(actor, id); if (c.change_status !== 'SUBMITTED') throw unprocessable('Only a change waiting for approval is withdrawn.'); if (!same(c.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, c.workflow_instance_id, { comment: reason }); return changes.get(actor, c.id); },
    cancel(actor, id, { reason }) { const { c, v } = crow(actor, id); need(actor, 'proj.version.amend', 'cancel BOQ changes', v.org_project_id); if (c.change_status !== 'SUBMITTED') throw unprocessable('Only a change waiting for approval is cancelled.'); return transaction(db, () => { workflowOf(db).abandon(actor.companyId, c.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare("UPDATE proj_boq_changes SET change_status = 'CANCELLED', updated_at = ? WHERE id = ?").run(nowIso(), c.id); return changes.get(actor, c.id); }); },
    decide(instance, actor, outcome, comment) {
      const c = db.prepare('SELECT * FROM proj_boq_changes WHERE id = ?').get(rid(instance.docId)); if (!c || c.change_status !== 'SUBMITTED') return; const v = fresh(c.version_id);
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN';
      let to = outcome === 'APPROVED' ? 'APPROVED' : outcome === 'RETURNED' ? 'REJECTED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'CANCELLED' : 'CANCELLED'; let note = comment ?? null;
      if (to === 'APPROVED') {
        try { transaction(db, () => applyOps({ ...actor, companyId: v.company_id }, v, json(c.ops_json, []))); } catch (x) { to = 'REJECTED'; note = `The change no longer fits the BOQ (${x.message}).`; }
      }
      db.prepare('UPDATE proj_boq_changes SET change_status = ?, decided_at = ?, remarks = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(to, nowIso(), note, actor.user, nowIso(), c.id);
      writeAudit(db, { entity: 'proj_boq_changes', entityId: c.id, action: outcome.toLowerCase(), reason: note, actor: actor.user, companyId: c.company_id });
      if (to === 'APPROVED') event('boq.mapping.changed', actor, 'boq_version', v.id, v.company_id, v.org_project_id, { projectId: v.org_project_id, versionId: v.id, changeId: c.id, lines: json(c.ops_json, []).length, afterFreeze: true });
    },
  };

  // ---- reports and documents ---------------------------------------------------------------------------------------------------------------------------------
  const reports = {
    /** The abstract: each bill and section with its amount and its share of the total. */
    abstract(actor, id) {
      const v = vrow(actor, id); const r = rates(actor, v.org_project_id); const ls = lineViews(actor, v); const total = v.total_amount || 1;
      const rows = ls.filter((l) => ['BILL', 'SECTION'].includes(l.kind)).map((l) => ({ id: l.id, code: l.code, description: l.description, kind: l.kind, depth: l.depth, amount: l.amount, share: r ? (Math.round((Number(l.amount) * 100 * 1000000) / total) / 10000).toFixed(2) : null }));
      const top = ls.filter((l) => l.depth === 0 && !l.leaf);
      return { version: { id: v.id, docNo: v.doc_no, name: v.name, total: r ? money(v.total_amount) : null, items: v.items_count }, ratesVisible: r, rows, chart: top.map((l) => ({ code: l.code, name: l.description, amount: l.amount })) };
    },
    unmapped(actor, id) { const v = vrow(actor, id); const ls = lineViews(actor, v, { unmappedOnly: true }); return { version: { id: v.id, docNo: v.doc_no, name: v.name }, count: ls.length, rows: ls.map((l) => ({ id: l.id, code: l.code, description: l.description, uom: l.uom, qty: l.qty, mapped: l.mapped, mappedQty: l.mappedQty, amount: l.amount })) }; },
    /** FR-01: two versions side by side by item code: added, removed, changed quantity, rate or amount. */
    compare(actor, a, b) {
      const va = vrow(actor, a); const vb = vrow(actor, b); if (va.org_project_id !== vb.org_project_id) throw unprocessable('Compare versions of the same project.');
      const r = rates(actor, va.org_project_id); const la = new Map(lines(va.id).filter((l) => LEAF_KINDS.includes(l.line_kind)).map((l) => [l.item_code.toLowerCase(), l])); const lb = new Map(lines(vb.id).filter((l) => LEAF_KINDS.includes(l.line_kind)).map((l) => [l.item_code.toLowerCase(), l]));
      const rows = []; const fmt = (l) => ({ qty: num(l.qty, 'quantity'), rate: r ? num(l.rate, 'rate') : null, amount: r ? money(l.amount) : null });
      for (const [k, y] of lb) { const x = la.get(k); if (!x) rows.push({ code: y.item_code, description: y.description, change: 'ADDED', after: fmt(y), delta: r ? money(y.amount) : null }); else if (x.qty !== y.qty || x.rate !== y.rate || x.description !== y.description || x.uom !== y.uom) rows.push({ code: y.item_code, description: y.description, change: 'CHANGED', before: fmt(x), after: fmt(y), delta: r ? ((y.amount - x.amount) / 100).toFixed(2) : null }); }
      for (const [k, x] of la) if (!lb.has(k)) rows.push({ code: x.item_code, description: x.description, change: 'REMOVED', before: fmt(x), delta: r ? (-x.amount / 100).toFixed(2) : null });
      return { a: { id: va.id, docNo: va.doc_no, type: va.vtype, name: va.name, total: r ? money(va.total_amount) : null }, b: { id: vb.id, docNo: vb.doc_no, type: vb.vtype, name: vb.name, total: r ? money(vb.total_amount) : null }, ratesVisible: r, delta: r ? ((vb.total_amount - va.total_amount) / 100).toFixed(2) : null, counts: { added: rows.filter((x) => x.change === 'ADDED').length, removed: rows.filter((x) => x.change === 'REMOVED').length, changed: rows.filter((x) => x.change === 'CHANGED').length }, rows };
    },
  };
  /** FR-03: the BOQ on paper or as a file in the same columns as the client's sheet when it was imported. */
  function document(actor, id, format = 'html') {
    const v = vrow(actor, id); const x = ['xlsx', 'csv'].includes(format); need(actor, x ? 'proj.version.export' : 'proj.version.print', `${x ? 'export' : 'print'} BOQ versions`, v.org_project_id);
    const r = rates(actor, v.org_project_id); const ls = lineViews(actor, v); const map = json(v.import_map_json, null);
    const head = (k, d) => map?.find((c) => c.key === k)?.header ?? d;
    const cols = [{ key: 'bill', label: head('bill', 'Bill'), type: 'text' }, { key: 'section', label: head('section', 'Section'), type: 'text' }, { key: 'itemCode', label: head('itemCode', 'Item'), type: 'text' }, { key: 'description', label: head('description', 'Description'), type: 'text' }, { key: 'uom', label: head('uom', 'Unit'), type: 'text' }, { key: 'qty', label: head('qty', 'Quantity'), type: 'number' }, ...(r ? [{ key: 'rate', label: head('rate', 'Rate'), type: 'money' }, { key: 'amount', label: 'Amount (₹)', type: 'money' }] : [])];
    const byId = new Map(ls.map((l) => [l.id, l])); const anc = (l, kind) => { let p = l; while (p) { if (p.kind === kind) return p; p = byId.get(p.parentId); } return null; };
    const rows = ls.filter((l) => l.leaf).map((l) => ({ bill: anc(l, 'BILL')?.description ?? '', section: anc(l, 'SECTION')?.description ?? '', itemCode: l.code, description: l.description, uom: l.uom, qty: l.qty, rate: l.rate, amount: l.amount }));
    writeAudit(db, { entity: 'proj_boq_versions', entityId: v.id, action: x ? 'export' : 'print', newValues: { format, rows: rows.length, rates: r }, actor: actor.user, companyId: v.company_id });
    const title = `BOQ ${v.doc_no} · ${orgOf(v.org_project_id).code} · ${BOQ_VTYPES[v.vtype]} v${v.version_no} · ${BOQ_STATUS[v.status]}`;
    const foot = [`${rows.length} items${r ? ` · total ₹ ${money(v.total_amount)}` : ''}`, v.frozen_at ? `Frozen ${v.frozen_at.slice(0, 10)}` : 'Not frozen'];
    if (format === 'html') return { kind: 'html', body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(v.doc_no)}</title><style>body{font:12px sans-serif;margin:24px}td,th{border:1px solid #888;padding:4px 6px;text-align:left;vertical-align:top}table{border-collapse:collapse;width:100%}.r{text-align:right}</style></head><body><h1>${esc(title)}</h1><table><tr>${cols.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr>${rows.map((row) => `<tr>${cols.map((c) => `<td${['qty', 'rate', 'amount'].includes(c.key) ? ' class="r"' : ''}>${esc(row[c.key])}</td>`).join('')}</tr>`).join('')}</table><p>${foot.map(esc).join(' · ')}</p></body></html>` };
    return { kind: 'file', buffer: writeExport(format, { columns: cols, rows, footer: foot, title, sheetName: 'BOQ' }), contentType: FORMATS[format], fileName: `boq-${v.doc_no}${v.status === 'APPROVED' ? '' : '-DRAFT'}.${format}` };
  }
  /** For the parts that follow (12.01 budget, 13.01 schedule, 15.02 material planning, 22.01 measurements, 22.03 billing): the frozen BOQ of a project with its mapping and norms. */
  function frozen(companyId, projectId) {
    const v = db.prepare("SELECT * FROM proj_boq_versions WHERE company_id = ? AND org_project_id = ? AND status = 'APPROVED' AND vtype IN ('CONTRACT', 'REVISED') AND deleted_at IS NULL ORDER BY version_no DESC LIMIT 1").get(companyId, projectId); if (!v) return null;
    return { versionId: v.id, docNo: v.doc_no, type: v.vtype, versionNo: v.version_no, total: money(v.total_amount), frozenAt: v.frozen_at, items: lines(v.id).filter((l) => LEAF_KINDS.includes(l.line_kind)).map((l) => ({ id: l.id, code: l.item_code, description: l.description, uom: l.uom, qty: num(l.qty, 'quantity'), rate: num(l.rate, 'rate'), amount: money(l.amount), workItemId: l.work_item_id, analysisId: l.analysis_id, costCodeId: l.cost_code_id, splits: splitsOf(l.id), norms: normsOf(l.id) })) };
  }
  return { versions, lines: lineApi, mapping: mapApi, norms: normApi, importer: importApi, changes, reports, document, frozen, decide: versions.decide, decideChange: changes.decide, projectsList: (actor) => db.prepare('SELECT p.id, p.code, p.name FROM org_projects p WHERE p.company_id = ? AND EXISTS (SELECT 1 FROM proj_projects x WHERE x.project_id = p.id AND x.deleted_at IS NULL) ORDER BY p.code').all(actor.companyId).filter((p) => may(actor, 'proj.version.view', p.id)).map((p) => ({ projectId: p.id, code: p.code, name: p.name })) };
}

const services = new WeakMap();
export const bindBoq = (db, s) => services.set(db, s);
export const boqOf = (db) => services.get(db) ?? null;

const step = (code, name, role) => ({ code, name, type: 'approval', mode: 'single', approvers: [{ kind: 'role', role }], slaHours: 48, requireAttachment: false, checklist: [], when: null, notify: [], action: null });
const vline = (db, id) => db.prepare('SELECT x.*, p.code, p.name AS pname FROM proj_boq_versions x JOIN org_projects p ON p.id = x.org_project_id WHERE x.id = ?').get(id);
workflowTypes.register({
  docType: BOQ_FREEZE_DOC, label: 'Contract BOQ freeze', processOwner: 'COMMGR', route: (id) => `/proj/version?id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT x.doc_no, x.requested_by, x.name, p.code FROM proj_boq_versions x JOIN org_projects p ON p.id = x.org_project_id WHERE x.id = ? AND x.company_id = ?').get(rid(id), companyId); return r ? { ref: r.doc_no, title: `${r.code} ${r.name}`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = vline(db, rid(id)); if (!r) return null; return { fields: [{ label: 'Project', value: `${r.code} ${r.pname}` }, { label: 'Version', value: `${r.doc_no} · ${BOQ_VTYPES[r.vtype]} v${r.version_no}` }, { label: 'Items', value: String(r.items_count) }, { label: 'Total', value: `₹ ${money(r.total_amount)}` }, ...(r.variation_ref ? [{ label: 'Variation', value: r.variation_ref }] : [])] }; },
  defaultDefinition: { name: 'BOQ freeze: QS, the commercial manager, then the project manager', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('QS', 'Quantity surveyor', 'QS'), step('COMMGR', 'Commercial manager', 'COMMGR'), step('PM', 'Project manager', 'PM')] },
  hooks: { onApproved: (db, { instance, actor }) => boqOf(db)?.decide(instance, actor, 'APPROVED'), onRejected: (db, { instance, actor, comment }) => boqOf(db)?.decide(instance, actor, 'REJECTED', comment), onReturned: (db, { instance, actor, comment }) => boqOf(db)?.decide(instance, actor, 'RETURNED', comment), onCancelled: (db, { instance, actor, comment }) => boqOf(db)?.decide(instance, actor, 'CANCELLED', comment) },
});
workflowTypes.register({
  docType: BOQ_MAP_DOC, label: 'BOQ mapping change after freeze', processOwner: 'PM', route: (id) => `/proj/versions?change=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT c.requested_by, x.doc_no, p.code FROM proj_boq_changes c JOIN proj_boq_versions x ON x.id = c.version_id JOIN org_projects p ON p.id = x.org_project_id WHERE c.id = ? AND c.company_id = ?').get(rid(id), companyId); return r ? { ref: `${r.doc_no} mapping`, title: r.code, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const c = db.prepare('SELECT c.*, x.doc_no, p.code, p.name FROM proj_boq_changes c JOIN proj_boq_versions x ON x.id = c.version_id JOIN org_projects p ON p.id = x.org_project_id WHERE c.id = ?').get(rid(id)); if (!c) return null; const d = json(c.diff_json, []); return { fields: [{ label: 'Project', value: `${c.code} ${c.name}` }, { label: 'Version', value: c.doc_no }, { label: 'Why', value: c.reason }, { label: 'Lines', value: d.map((x) => `${x.code} (${x.kind.toLowerCase()})`).join(', ').slice(0, 400) }] }; },
  defaultDefinition: { name: 'BOQ mapping change after freeze: QS, then the project manager', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('QS', 'Quantity surveyor', 'QS'), step('PM', 'Project manager', 'PM')] },
  hooks: { onApproved: (db, { instance, actor }) => boqOf(db)?.decideChange(instance, actor, 'APPROVED'), onRejected: (db, { instance, actor, comment }) => boqOf(db)?.decideChange(instance, actor, 'REJECTED', comment), onReturned: (db, { instance, actor, comment }) => boqOf(db)?.decideChange(instance, actor, 'RETURNED', comment), onCancelled: (db, { instance, actor, comment }) => boqOf(db)?.decideChange(instance, actor, 'CANCELLED', comment) },
});
evidenceProviders.register(BOQ_FREEZE_DOC, ({ db, instance }) => {
  const v = vline(db, rid(instance.docId)); if (!v) return { sections: [] };
  const leaf = db.prepare("SELECT l.id, l.qty, l.rate FROM proj_boq_lines l WHERE l.version_id = ? AND l.deleted_at IS NULL AND l.line_kind IN ('ITEM', 'SUBITEM') AND NOT EXISTS (SELECT 1 FROM proj_boq_lines c WHERE c.parent_id = l.id AND c.deleted_at IS NULL)").all(v.id);
  const un = leaf.filter((l) => l.qty > 0 && (db.prepare('SELECT COALESCE(SUM(qty), 0) AS s FROM proj_boq_line_wbs WHERE line_id = ? AND deleted_at IS NULL').get(l.id).s !== l.qty)).length;
  const withNorms = leaf.filter((l) => db.prepare('SELECT 1 FROM proj_boq_line_norms WHERE line_id = ? AND deleted_at IS NULL').get(l.id)).length;
  return { sections: [{ code: 'proj-boq-freeze', title: 'Before you freeze the BOQ', kind: 'metrics', items: [{ label: 'Version', value: `${BOQ_VTYPES[v.vtype]} v${v.version_no}`, format: 'text' }, { label: 'Total', value: Number(money(v.total_amount)), format: 'inr' }, { label: 'Items', value: String(leaf.length), format: 'text' }, { label: 'Items not mapped to the WBS', value: String(un), format: 'text' }, { label: 'Items with resource norms', value: `${withNorms} of ${leaf.length}`, format: 'text' }, { label: 'Items with a quantity and no rate', value: String(leaf.filter((l) => l.qty > 0 && l.rate === 0).length), format: 'text' }] }] };
});
