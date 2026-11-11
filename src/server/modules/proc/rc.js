import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { toPdf } from '../../platform/export/index.js';
import { defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { parameterRegistry } from '../../platform/parameters/index.js';
import { workflowOf } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { d3, json, nowIso, q3, rid, rs, same } from './base.js';

// Rate contracts (part 15.06): annual rates with a ceiling in quantity (per line) and value (whole contract), a validity, the projects it applies to and, optionally, a price-variation formula linked to an index. Call-off purchase orders (15.05) are
// made from the contract with no enquiry, only within its validity and ceilings (BR-01), and need less approval. Consumption is worked out from the orders that count (sent for approval, approved, closed), alerted at 80 % and 100 %, and expiry is alerted.
// A price-variation revision is worked out from the index of a period and applied to the rates only when approved.
export const RC_DOC = 'PROC_RC'; export const PV_DOC = 'PROC_RC_PV';
export const RC_STATUS = { DRAFT: 'Draft', SUBMITTED: 'Waiting for approval', RETURNED: 'Returned for correction', APPROVED: 'In force', REJECTED: 'Rejected', CLOSED: 'Closed', CANCELLED: 'Cancelled', SUPERSEDED: 'Superseded' };
export const PV_STATUS = { DRAFT: 'Draft', SUBMITTED: 'Waiting for approval', RETURNED: 'Returned', APPROVED: 'Applied', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };
const EDITABLE = ['DRAFT', 'RETURNED'];
const COUNTS = "('SUBMITTED', 'APPROVED', 'CLOSED')";
for (const [key, dataType, def, description, extra] of [
  ['proc.rc.band_dir_minor', 'integer', 1_000_000_000, 'Section 9: a rate contract with a ceiling above this value, in paise (₹ 1 crore), is also approved by the direction.', { min: 0, max: 100_000_000_000 }],
  ['proc.rc.calloff_pm_minor', 'integer', 250_000_000, 'FR-02: a call-off order above this value, in paise (₹ 25 lakh), also needs the project manager; below it the procurement manager alone approves.', { min: 0, max: 100_000_000_000 }],
  ['proc.rc.expiry_days', 'integer', 30, 'FR-03: a contract that ends within this many days is told to the procurement manager, once.', { min: 1, max: 365 }],
  ['proc.rc.pv_min_change_bp', 'integer', 50, 'FR-04: a rate is revised only if the index moves it by at least this many basis points (50 = 0.5 %).', { min: 0, max: 10000 }],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType, default: def, scopes: ['system', 'company'], description, .../** @type {any} */ (extra) });

/** FR-04: the revised rate. The linked share of the rate (x10000, 80 % = 800000) moves with the index; the rest is fixed: rate x ((1 - L) + L x current / base). */
export function pvRate({ baseRate, baseIndex, currentIndex, linkedPct }) {
  const l = linkedPct / 1_000_000; return Math.round(baseRate * ((1 - l) + (l * currentIndex) / baseIndex));
}

export const rcList = defineList({
  code: 'proc.rate_contracts', label: 'Rate contracts', permission: 'proc.rate_contract.view', from: 'proc_rate_contracts x JOIN mdm_partners v ON v.id = x.vendor_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'x.title', 'v.legal_name', 'v.trade_name'], defaultSort: '-date',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'Contract' }, date: { sql: 'x.doc_date', type: 'date', label: 'Date' }, title: { sql: 'x.title', type: 'text', label: 'Title' }, vendor: { sql: 'COALESCE(v.trade_name, v.legal_name)', type: 'text', label: 'Vendor' },
    validTo: { sql: 'x.valid_to', type: 'date', label: 'Valid to' }, ceiling: { sql: 'x.ceiling_value', type: 'text', label: 'Ceiling', sortable: false }, used: { sql: 'x.consumed_value', type: 'text', label: 'Used', sortable: false },
    status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(RC_STATUS) },
  },
});

export function createRcService({ db, base }) {
  const { authz, param, may, need, fail, audit, notify, number, itemOf } = base;
  const evt = (type, actor, r, data) => publishEvent(db, { type, entity: 'proc_rate_contract', entityId: r.id, actorId: actor?.user ?? 'system', companyId: r.company_id, data: { rcId: r.id, docNo: r.doc_no, vendorId: r.vendor_id, ...data } });
  const vname = (id) => { const v = db.prepare('SELECT code, trade_name, legal_name FROM mdm_partners WHERE id = ?').get(id); return v ? { code: v.code, name: v.trade_name ?? v.legal_name } : { code: '', name: '' }; };
  const linesOf = (id) => db.prepare('SELECT * FROM proc_rc_lines WHERE rc_id = ? AND deleted_at IS NULL ORDER BY line_no').all(id);
  const scope = (actor) => ({ sql: 'x.company_id = :c', params: { c: actor.companyId } });
  const row = (actor, id, key = 'proc.rate_contract.view') => {
    const r = db.prepare('SELECT * FROM proc_rate_contracts WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!r || !may(actor, 'proc.rate_contract.view')) throw notFound('That rate contract does not exist.'); if (key !== 'proc.rate_contract.view') need(actor, key, 'do that with a rate contract'); return r;
  };
  const ancestors = (r) => { const ids = [r.id]; let p = r.parent_id; while (p) { ids.push(p); p = db.prepare('SELECT parent_id FROM proc_rate_contracts WHERE id = ?').get(p)?.parent_id; } return ids; };
  const sizeOf = (r, ls) => r.ceiling_value || ls.reduce((n, l) => n + Math.round((l.ceiling_qty * l.rate) / 1000), 0);

  /** What the orders that count have taken from the contract (and from the contracts it replaced): by line number and in value. */
  function consumption(r, excludePoId = 0) {
    const ids = ancestors(r); const marks = ids.map(() => '?').join(',');
    const byLine = db.prepare(`SELECT rl.line_no, SUM(l.qty - l.short_closed_qty) AS q FROM proc_po_lines l JOIN proc_purchase_orders p ON p.id = l.po_id JOIN proc_po_line_rc plr ON plr.po_line_id = l.id JOIN proc_rc_lines rl ON rl.id = plr.rc_line_id WHERE p.id IN (SELECT po_id FROM proc_po_rc WHERE rc_id IN (${marks})) AND p.status IN ${COUNTS} AND p.deleted_at IS NULL AND l.deleted_at IS NULL AND p.id <> ? GROUP BY rl.line_no`).all(...ids, excludePoId);
    const value = db.prepare(`SELECT COALESCE(SUM(ROUND(l.basic_amount * (l.qty - l.short_closed_qty) * 1.0 / l.qty)), 0) AS v FROM proc_po_lines l JOIN proc_purchase_orders p ON p.id = l.po_id WHERE p.id IN (SELECT po_id FROM proc_po_rc WHERE rc_id IN (${marks})) AND p.status IN ${COUNTS} AND p.deleted_at IS NULL AND l.deleted_at IS NULL AND p.id <> ?`).get(...ids, excludePoId).v;
    return { byLine: new Map(byLine.map((x) => [x.line_no, x.q])), value };
  }
  function recalc(rcId) {
    const r = db.prepare('SELECT * FROM proc_rate_contracts WHERE id = ?').get(rcId); if (!r) return null; const c = consumption(r);
    for (const l of linesOf(r.id)) db.prepare('UPDATE proc_rc_lines SET consumed_qty = ? WHERE id = ?').run(c.byLine.get(l.line_no) ?? 0, l.id);
    db.prepare('UPDATE proc_rate_contracts SET consumed_value = ? WHERE id = ?').run(c.value, r.id); return c;
  }
  /** BR-01: a call-off beyond the validity or a ceiling is blocked. `items` are { rcLineId, qty (thousandths), basic (paise) }. */
  function check(actor, rcId, projectId, items, { excludePoId = 0, date = todayIST() } = {}) {
    const r = db.prepare('SELECT * FROM proc_rate_contracts WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rcId, actor.companyId); if (!r) fail([{ field: 'rcId', message: 'No such rate contract' }]);
    if (r.status !== 'APPROVED') fail([{ field: 'rcId', message: `${r.doc_no} is not in force (${RC_STATUS[r.status].toLowerCase()})` }]);
    if (date < r.valid_from || date > r.valid_to) fail([{ field: 'rcId', message: `${r.doc_no} is valid from ${r.valid_from} to ${r.valid_to}: a call-off is not made outside it` }]);
    const projects = json(r.projects_json, []); if (projects.length && !projects.includes(projectId)) fail([{ field: 'rcId', message: `${r.doc_no} does not apply to this project` }]);
    const c = consumption(r, excludePoId); const ls = linesOf(r.id); const problems = []; const add = new Map(); let basic = 0;
    items.forEach((x, i) => { const l = ls.find((y) => y.id === x.rcLineId); if (!l) { problems.push({ field: `lines.${i}.rcLineId`, message: 'Not a line of this rate contract' }); return; } add.set(l.line_no, (add.get(l.line_no) ?? 0) + x.qty); basic += x.basic ?? 0; });
    for (const l of ls) if (add.has(l.line_no) && l.ceiling_qty > 0 && (c.byLine.get(l.line_no) ?? 0) + add.get(l.line_no) > l.ceiling_qty) problems.push({ field: 'lines', message: `The ceiling quantity of line ${l.line_no} (${d3(l.ceiling_qty)} ${l.uom}) would be exceeded: ${d3(Math.max(0, l.ceiling_qty - (c.byLine.get(l.line_no) ?? 0)))} is left` });
    if (r.ceiling_value > 0 && c.value + basic > r.ceiling_value) problems.push({ field: 'lines', message: `The ceiling value of ${r.doc_no} (${rs(r.ceiling_value)}) would be exceeded: ${rs(Math.max(0, r.ceiling_value - c.value))} is left` });
    fail(problems); return { rc: r, lines: ls };
  }

  const pctOf = (r, ls) => (r.ceiling_value > 0 ? Math.round((r.consumed_value / r.ceiling_value) * 1000) / 10 : (() => { const w = ls.filter((l) => l.ceiling_qty > 0).map((l) => l.consumed_qty / l.ceiling_qty); return w.length ? Math.round(Math.max(...w) * 1000) / 10 : 0; })());
  const view = (actor, r, { detail = false } = {}) => {
    const can = (k) => may(actor, k); const own = same(r.requested_by, actor.user); const rates = can('proc.rate_contract.rates'); const m = (n) => (rates ? rs(n) : null); const ls = linesOf(r.id); const pv = json(r.pv_json, null);
    const pct = pctOf(r, ls);
    const open = db.prepare("SELECT id, status FROM proc_rc_revisions WHERE rc_id = ? AND status IN ('SUBMITTED', 'RETURNED', 'DRAFT') AND deleted_at IS NULL ORDER BY id DESC LIMIT 1").get(r.id);
    const o = { id: r.id, docNo: r.doc_no, date: r.doc_date, title: r.title, vendorId: r.vendor_id, vendorCode: vname(r.vendor_id).code, vendor: vname(r.vendor_id).name, validFrom: r.valid_from, validTo: r.valid_to, ceilingValue: m(r.ceiling_value), consumedValue: m(r.consumed_value), usedPct: pct, projectIds: json(r.projects_json, []), regions: json(r.regions_json, []), terms: r.terms, paymentTerms: r.payment_terms,
      pv: pv ? { ...pv, baseIndex: pv.baseIndex / 10000, linkedPct: pv.linkedPct / 10000 } : null, canSeeRates: rates, status: r.status, statusLabel: RC_STATUS[r.status], revisionNo: r.revision_no, parentId: r.parent_id, requestedBy: r.requested_by, approvedBy: r.approved_by, approvedAt: r.approved_at, cancelReason: r.cancel_reason, closeReason: r.close_reason,
      expired: r.status === 'APPROVED' && r.valid_to < todayIST(), daysLeft: Math.round((Date.parse(`${r.valid_to}T00:00:00Z`) - Date.parse(`${todayIST()}T00:00:00Z`)) / 86_400_000), workflowInstanceId: r.workflow_instance_id, openRevision: open ?? null, rowVersion: r.version,
      can: { edit: can('proc.rate_contract.edit') && EDITABLE.includes(r.status), submit: can('proc.rate_contract.submit') && EDITABLE.includes(r.status), withdraw: r.status === 'SUBMITTED' && own, delete: can('proc.rate_contract.delete') && r.status === 'DRAFT' && !r.workflow_instance_id, approve: can('proc.rate_contract.approve') && r.status === 'SUBMITTED' && !own,
        cancel: can('proc.rate_contract.cancel') && ['DRAFT', 'RETURNED', 'SUBMITTED', 'APPROVED'].includes(r.status), close: can('proc.rate_contract.cancel') && r.status === 'APPROVED', amend: can('proc.rate_contract.amend') && r.status === 'APPROVED', print: can('proc.rate_contract.print'), pv: can('proc.rate_contract.pv') && r.status === 'APPROVED' && Boolean(pv?.enabled) && !open, calloff: can('proc.purchase_order.create') && r.status === 'APPROVED' && r.valid_to >= todayIST() } };
    o.lines = ls.map((l) => ({ id: l.id, lineNo: l.line_no, itemId: l.item_id, itemCode: l.item_id ? itemOf(r.company_id, l.item_id)?.code : null, description: l.description, uom: l.uom, rate: m(l.rate), baseRate: m(l.base_rate), taxCode: l.tax_code, ceilingQty: d3(l.ceiling_qty), consumedQty: d3(l.consumed_qty), remainingQty: l.ceiling_qty > 0 ? d3(Math.max(0, l.ceiling_qty - l.consumed_qty)) : null, usedPct: l.ceiling_qty > 0 ? Math.round((l.consumed_qty / l.ceiling_qty) * 1000) / 10 : null, pvLinked: Boolean(l.pv_linked) }));
    if (detail) {
      o.callOffs = db.prepare("SELECT p.id, p.doc_no, p.doc_date, p.status, p.total_basic, p.org_project_id FROM proc_purchase_orders p WHERE p.id IN (SELECT po_id FROM proc_po_rc WHERE rc_id IN (" + ancestors(r).map(() => '?').join(',') + ")) AND p.deleted_at IS NULL ORDER BY p.id").all(...ancestors(r)).map((p) => ({ id: p.id, docNo: p.doc_no, date: p.doc_date, status: p.status, basic: m(p.total_basic), projectCode: db.prepare('SELECT code FROM org_projects WHERE id = ?').get(p.org_project_id)?.code }));
      o.revisions = db.prepare('SELECT * FROM proc_rc_revisions WHERE rc_id = ? AND deleted_at IS NULL ORDER BY revision_no').all(r.id).map((v) => revView(actor, v, rates));
      o.warnings = []; if (o.expired) o.warnings.push({ code: 'EXPIRED', message: 'The validity has ended: no call-off is made.' }); else if (r.status === 'APPROVED' && o.daysLeft <= Number(param(r.company_id, 'proc.rc.expiry_days') ?? 30)) o.warnings.push({ code: 'EXPIRY', message: `The contract ends in ${o.daysLeft} day(s).` }); if (pct >= 100) o.warnings.push({ code: 'CEILING', message: 'The ceiling is used: no further call-off.' }); else if (pct >= 80) o.warnings.push({ code: 'NEAR', message: `${pct}% of the ceiling is used.` });
    }
    return o;
  };
  const revView = (actor, v, rates) => ({ id: v.id, revisionNo: v.revision_no, indexCode: v.index_code, period: v.period, indexValue: v.index_value / 10000, baseIndex: v.base_index / 10000, effectiveFrom: v.effective_from, status: v.status, statusLabel: PV_STATUS[v.status], requestedBy: v.requested_by, approvedBy: v.approved_by, workflowInstanceId: v.workflow_instance_id,
    changes: rates ? json(v.changes_json, []).map((c) => ({ ...c, oldRate: rs(c.oldRate), newRate: rs(c.newRate) })) : [] });

  function normalise(actor, b) {
    const problems = []; const v = db.prepare("SELECT partner_status FROM mdm_partners WHERE id = ? AND company_id = ? AND deleted_at IS NULL").get(b.vendorId, actor.companyId); if (!v) problems.push({ field: 'vendorId', message: 'Not a business partner of this company' }); else if (v.partner_status !== 'ACTIVE') problems.push({ field: 'vendorId', message: 'The vendor is not active' });
    if (b.validTo < b.validFrom) problems.push({ field: 'validTo', message: 'The validity ends before it begins' });
    for (const p of b.projectIds ?? []) if (!db.prepare('SELECT 1 FROM org_projects WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(p, actor.companyId)) problems.push({ field: 'projectIds', message: 'Not a project of this company' });
    const lines = (b.lines ?? []).map((l, i) => { const it = l.itemId ? itemOf(actor.companyId, l.itemId) : null; if (l.itemId && !it) problems.push({ field: `lines.${i}.itemId`, message: 'Not an item of this company' }); if (it && l.uom && !base.uomOk(it, l.uom)) problems.push({ field: `lines.${i}.uom`, message: `${l.uom} is not a unit of ${it.code}` }); const desc = l.description ?? it?.name; if (!desc) problems.push({ field: `lines.${i}.description`, message: 'Describe the item or service' });
      return { itemId: it?.id ?? null, description: desc, uom: l.uom ?? it?.base_uom, rate: Math.round(l.rate * 100), taxCode: l.taxCode ?? it?.gst_code ?? null, ceilingQty: q3(l.ceilingQty ?? 0), pvLinked: l.pvLinked ? 1 : 0 }; });
    const pv = b.pv?.enabled ? { enabled: true, indexCode: b.pv.indexCode.toUpperCase(), source: b.pv.source ?? 'MANUAL', frequency: b.pv.frequency ?? 'MONTHLY', basePeriod: b.pv.basePeriod, baseIndex: Math.round(b.pv.baseIndex * 10000), linkedPct: Math.round(b.pv.linkedPct * 10000) } : null;
    if (pv && !lines.some((l) => l.pvLinked)) problems.push({ field: 'lines', message: 'Mark the lines whose rate varies with the index' }); fail(problems); return { lines, pv };
  }
  const saveLines = (r, lines, actor, carry = null) => {
    db.prepare('UPDATE proc_rc_lines SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE rc_id = ? AND deleted_at IS NULL').run(nowIso(), actor.user, r.id);
    lines.forEach((l, i) => db.prepare("INSERT INTO proc_rc_lines (company_id, rc_id, line_no, item_id, description, uom, rate, base_rate, tax_code, ceiling_qty, consumed_qty, pv_linked, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'api')").run(r.company_id, r.id, i + 1, l.itemId, l.description, l.uom, l.rate, l.baseRate ?? l.rate, l.taxCode, l.ceilingQty, carry?.[i] ?? 0, l.pvLinked, actor.user));
  };

  const rcs = {
    list(actor, query) {
      if (!authz.check(actor, 'proc.rate_contract.view').allowed) throw forbidden('You may not see rate contracts (permission proc.rate_contract.view).'); const sc = scope(actor);
      return runList(db, rcList, parseListRequest(rcList, query), { select: 'x.*', scopeSql: sc.sql, params: sc.params, tieBreaker: 'x.id', map: (x) => { const rt = may(actor, 'proc.rate_contract.rates'); return { id: x.id, docNo: x.doc_no, date: x.doc_date, title: x.title, vendor: vname(x.vendor_id).name, validTo: x.valid_to, ceiling: rt && x.ceiling_value ? String(rs(x.ceiling_value)) : '', used: rt ? String(rs(x.consumed_value)) : '', status: x.status, statusLabel: RC_STATUS[x.status], expired: x.status === 'APPROVED' && x.valid_to < todayIST() }; } });
    },
    exportSource(actor, req) { return rcs.list(actor, { ...req, page: 1, pageSize: 100 }); },
    get: (actor, id) => { const v = view(actor, row(actor, id), { detail: true }); const tasks = () => workflowOf(db).listTasks(actor, { mine: 'assigned', limit: 200 }).rows; if (v.can.approve && v.workflowInstanceId) v.taskId = tasks().find((t) => t.instance?.id === v.workflowInstanceId)?.id ?? null; const rv = db.prepare("SELECT workflow_instance_id FROM proc_rc_revisions WHERE rc_id = ? AND status = 'SUBMITTED' AND deleted_at IS NULL").get(v.id); if (!v.taskId && rv?.workflow_instance_id) { v.taskId = tasks().find((t) => t.instance?.id === rv.workflow_instance_id)?.id ?? null; v.taskKind = v.taskId ? 'PV' : null; } return v; },
    create(actor, b) {
      need(actor, 'proc.rate_contract.create', 'make a rate contract'); const { lines, pv } = normalise(actor, b);
      return transaction(db, () => { const no = number(actor.companyId, actor.user, 'PROC_RC', 'proc_rate_contracts', 'RC');
        const id = Number(db.prepare("INSERT INTO proc_rate_contracts (company_id, doc_no, doc_date, title, vendor_id, valid_from, valid_to, ceiling_value, projects_json, regions_json, pv_json, terms, payment_terms, status, requested_by, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, 'api')").run(actor.companyId, no, todayIST(), b.title, b.vendorId, b.validFrom, b.validTo, Math.round((b.ceilingValue ?? 0) * 100), JSON.stringify(b.projectIds ?? []), JSON.stringify(b.regions ?? []), pv ? JSON.stringify(pv) : null, b.terms ?? null, b.paymentTerms ?? null, actor.user, actor.user).lastInsertRowid);
        saveLines({ id, company_id: actor.companyId }, lines, actor); audit(actor, 'proc_rate_contracts', id, 'create', actor.companyId, { newValues: { docNo: no, lines: lines.length } }); return rcs.get(actor, id); });
    },
    update(actor, id, b) {
      const r = row(actor, id, 'proc.rate_contract.edit'); if (!EDITABLE.includes(r.status)) throw conflict(`${RC_STATUS[r.status]}: the contract is not changed now. Amend an approved one.`); if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this contract; reload it.');
      const m = { vendorId: r.vendor_id, validFrom: b.validFrom ?? r.valid_from, validTo: b.validTo ?? r.valid_to, projectIds: b.projectIds ?? json(r.projects_json, []), pv: 'pv' in b ? b.pv : (() => { const p = json(r.pv_json, null); return p ? { ...p, baseIndex: p.baseIndex / 10000, linkedPct: p.linkedPct / 10000 } : null; })(), lines: b.lines ?? linesOf(r.id).map((l) => ({ itemId: l.item_id, description: l.description, uom: l.uom, rate: rs(l.rate), taxCode: l.tax_code, ceilingQty: d3(l.ceiling_qty), pvLinked: Boolean(l.pv_linked) })) };
      const { lines, pv } = normalise(actor, m);
      return transaction(db, () => { db.prepare('UPDATE proc_rate_contracts SET title = ?, valid_from = ?, valid_to = ?, ceiling_value = ?, projects_json = ?, regions_json = ?, pv_json = ?, terms = ?, payment_terms = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.title ?? r.title, m.validFrom, m.validTo, 'ceilingValue' in b ? Math.round((b.ceilingValue ?? 0) * 100) : r.ceiling_value, JSON.stringify(m.projectIds), JSON.stringify('regions' in b ? b.regions : json(r.regions_json, [])), pv ? JSON.stringify(pv) : null, 'terms' in b ? b.terms : r.terms, 'paymentTerms' in b ? b.paymentTerms : r.payment_terms, actor.user, nowIso(), r.id);
        if (b.lines) saveLines(r, lines, actor); audit(actor, 'proc_rate_contracts', r.id, 'update', r.company_id); return rcs.get(actor, r.id); });
    },
    remove(actor, id) { const r = row(actor, id, 'proc.rate_contract.delete'); if (r.status !== 'DRAFT' || r.workflow_instance_id) throw unprocessable('Only a draft that was never sent is deleted. Cancel it instead.'); const now = nowIso(); db.prepare('UPDATE proc_rc_lines SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE rc_id = ? AND deleted_at IS NULL').run(now, actor.user, r.id); db.prepare('UPDATE proc_rate_contracts SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(now, actor.user, r.id); audit(actor, 'proc_rate_contracts', r.id, 'delete', r.company_id); return { id: r.id, deleted: true }; },
    importLines(actor, id, { rows }) {
      const r = row(actor, id, 'proc.rate_contract.edit'); if (!EDITABLE.includes(r.status)) throw conflict('Lines are added to a draft or a returned contract.'); const problems = []; const cur = linesOf(r.id).map((l) => ({ itemId: l.item_id, description: l.description, uom: l.uom, rate: rs(l.rate), taxCode: l.tax_code, ceilingQty: d3(l.ceiling_qty), pvLinked: Boolean(l.pv_linked) }));
      const add = rows.map((x, i) => { const it = db.prepare("SELECT id FROM mdm_items WHERE company_id = ? AND code = ? COLLATE NOCASE AND item_status = 'ACTIVE' AND deleted_at IS NULL ORDER BY version_no DESC LIMIT 1").get(actor.companyId, x.itemCode); if (!it) problems.push({ field: `rows.${i}.itemCode`, message: `No active item with the code ${x.itemCode}` }); return { itemId: it?.id ?? null, uom: x.uom ?? undefined, rate: x.rate, ceilingQty: x.ceilingQty ?? 0, pvLinked: Boolean(x.pvLinked) }; }); fail(problems);
      return rcs.update(actor, id, { lines: [...cur, ...add] });
    },
    submit(actor, id) {
      const r = row(actor, id, 'proc.rate_contract.submit'); if (!EDITABLE.includes(r.status)) throw unprocessable('Only a draft or a returned contract is sent for approval.'); const ls = linesOf(r.id); if (!ls.length) throw unprocessable('The contract has no lines.'); if (r.valid_to < todayIST()) throw unprocessable('The validity has ended: change it first.');
      return transaction(db, () => { const ctx = { amount: Number(rs(sizeOf(r, ls))), needDir: sizeOf(r, ls) > Number(param(r.company_id, 'proc.rc.band_dir_minor') ?? 1_000_000_000) ? 'yes' : 'no' };
        if (r.status === 'RETURNED' && r.workflow_instance_id) workflowOf(db).resubmit(actor, r.workflow_instance_id, { comment: 'Corrected', context: ctx }); else { const inst = workflowOf(db).submit(actor, { docType: RC_DOC, docId: String(r.id), comment: `${r.doc_no}: ${vname(r.vendor_id).name} ${rs(sizeOf(r, ls))}`.slice(0, 300), context: ctx }); db.prepare('UPDATE proc_rate_contracts SET workflow_instance_id = ? WHERE id = ?').run(inst.id, r.id); }
        db.prepare("UPDATE proc_rate_contracts SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), r.id); audit(actor, 'proc_rate_contracts', r.id, 'submit', r.company_id); return rcs.get(actor, r.id); });
    },
    withdraw(actor, id, { reason }) { const r = row(actor, id); if (r.status !== 'SUBMITTED') throw unprocessable('Only a contract waiting for approval is withdrawn.'); if (!same(r.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, r.workflow_instance_id, { comment: reason }); return rcs.get(actor, r.id); },
    cancel(actor, id, { reason }) {
      const r = row(actor, id, 'proc.rate_contract.cancel'); if (!['DRAFT', 'RETURNED', 'SUBMITTED', 'APPROVED'].includes(r.status)) throw unprocessable('Only a contract that is not closed is cancelled.');
      return transaction(db, () => { if (r.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, r.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare("UPDATE proc_rate_contracts SET status = 'CANCELLED', cancel_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), r.id); audit(actor, 'proc_rate_contracts', r.id, 'cancel', r.company_id, { reason }); evt('proc.rc.cancelled', actor, r, { reason, wasInForce: r.status === 'APPROVED' }); return rcs.get(actor, r.id); });
    },
    close(actor, id, { reason }) { const r = row(actor, id, 'proc.rate_contract.cancel'); if (r.status !== 'APPROVED') throw unprocessable('Only a contract in force is closed.'); db.prepare("UPDATE proc_rate_contracts SET status = 'CLOSED', close_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), r.id); audit(actor, 'proc_rate_contracts', r.id, 'close', r.company_id, { reason }); evt('proc.rc.closed', actor, r, { reason }); return rcs.get(actor, r.id); },
    /** An amendment is a new draft copy of the contract in force (consumption carried), that replaces it when approved. */
    amend(actor, id, { reason }) {
      const r = row(actor, id, 'proc.rate_contract.amend'); if (r.status !== 'APPROVED') throw unprocessable('Only a contract in force is amended.'); if (db.prepare("SELECT 1 FROM proc_rate_contracts WHERE parent_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL").get(r.id)) throw conflict('An amendment of this contract is already open.');
      return transaction(db, () => { const no = `${r.doc_no.split('/R')[0]}/R${r.revision_no + 1}`; const nid = Number(db.prepare("INSERT INTO proc_rate_contracts (company_id, doc_no, doc_date, title, vendor_id, valid_from, valid_to, ceiling_value, projects_json, regions_json, pv_json, terms, payment_terms, status, revision_no, parent_id, requested_by, created_by, source_type, source_id, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, 'amendment', ?, ?)").run(r.company_id, no, todayIST(), r.title, r.vendor_id, r.valid_from, r.valid_to, r.ceiling_value, r.projects_json, r.regions_json, r.pv_json, r.terms, r.payment_terms, r.revision_no + 1, r.id, actor.user, actor.user, String(r.id), reason).lastInsertRowid);
        const ls = linesOf(r.id); saveLines({ id: nid, company_id: r.company_id }, ls.map((l) => ({ itemId: l.item_id, description: l.description, uom: l.uom, rate: l.rate, baseRate: l.base_rate, taxCode: l.tax_code, ceilingQty: l.ceiling_qty, pvLinked: l.pv_linked })), actor, ls.map((l) => l.consumed_qty)); audit(actor, 'proc_rate_contracts', nid, 'amend', r.company_id, { reason, newValues: { of: r.doc_no } }); return rcs.get(actor, nid); });
    },
    history(actor, id) { const r = row(actor, id); const rv = db.prepare('SELECT workflow_instance_id FROM proc_rc_revisions WHERE rc_id = ? AND workflow_instance_id IS NOT NULL').all(r.id).map((x) => x.workflow_instance_id); const insts = [r.workflow_instance_id, ...rv].filter(Boolean); return { approvals: insts.length ? db.prepare(`SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id IN (${insts.map(() => '?').join(',')}) ORDER BY id`).all(...insts) : [], audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity IN ('proc_rate_contracts', 'proc_rc_revisions') AND (entity_id = ? OR entity_id IN (SELECT CAST(id AS TEXT) FROM proc_rc_revisions WHERE rc_id = ?)) ORDER BY id").all(String(r.id), r.id) }; },
    print(actor, id) {
      const r = row(actor, id, 'proc.rate_contract.print'); const v = view(actor, r, { detail: true }); audit(actor, 'proc_rate_contracts', r.id, 'print', r.company_id); const cols = [['lineNo', '#'], ['item', 'Item or service'], ['uom', 'Unit']]; if (v.canSeeRates) cols.push(['rate', 'Rate']); cols.push(['ceiling', 'Ceiling quantity'], ['used', 'Used']);
      const rows = v.lines.map((l) => ({ lineNo: String(l.lineNo), item: `${l.itemCode ? `${l.itemCode} ` : ''}${l.description}`, uom: l.uom, rate: String(l.rate ?? ''), ceiling: l.ceilingQty ? String(l.ceilingQty) : 'none', used: String(l.consumedQty) }));
      const footer = [`${v.docNo}: ${v.title}. ${v.vendor}. Valid ${v.validFrom} to ${v.validTo}`, v.canSeeRates && v.ceilingValue ? `Ceiling value ${v.ceilingValue}; used ${v.consumedValue} (${v.usedPct}%)` : '', v.pv ? `Price variation: ${v.pv.indexCode} (${v.pv.source}), ${v.pv.frequency.toLowerCase()}, base ${v.pv.baseIndex} of ${v.pv.basePeriod}, ${v.pv.linkedPct}% of the rate linked` : '', v.paymentTerms ?? '', v.terms ?? ''].filter(Boolean);
      return { buffer: toPdf({ columns: cols.map(([key, label]) => ({ key, label, type: 'text' })), rows, footer, title: `Rate contract ${v.docNo}` }), contentType: 'application/pdf', fileName: `${v.docNo.replaceAll('/', '-')}.pdf`, rows: rows.length };
    },
    decide(instance, actor, outcome, comment) {
      const r = db.prepare('SELECT * FROM proc_rate_contracts WHERE id = ?').get(rid(instance.docId)); if (!r || r.status !== 'SUBMITTED') return; const now = nowIso();
      if (outcome === 'APPROVED') {
        db.prepare("UPDATE proc_rate_contracts SET status = 'APPROVED', approved_by = ?, approved_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, actor.user, now, r.id);
        if (r.parent_id) db.prepare("UPDATE proc_rate_contracts SET status = 'SUPERSEDED', updated_at = ?, version = version + 1 WHERE id = ? AND status = 'APPROVED'").run(now, r.parent_id); recalc(r.id); audit(actor, 'proc_rate_contracts', r.id, 'approve', r.company_id);
        evt('proc.rc.approved', actor, r, { validFrom: r.valid_from, validTo: r.valid_to, ceilingValue: rs(r.ceiling_value), supersedes: r.parent_id, lines: linesOf(r.id).map((l) => ({ lineId: l.id, itemId: l.item_id, rate: rs(l.rate), uom: l.uom, ceilingQty: d3(l.ceiling_qty) })) });
        notify(r.company_id, 'proc.rc.decided', [`user:${r.requested_by}`, 'role:PROCIC'], r.doc_no, 'approved', `${r.doc_no} is in force from today: call-offs can be made.`, `/proc/rate-contracts?id=${r.id}`, r.id); return;
      }
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN'; const to = outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED';
      db.prepare('UPDATE proc_rate_contracts SET status = ?, workflow_instance_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, withdrawn ? null : r.workflow_instance_id, actor.user, now, r.id); audit(actor, 'proc_rate_contracts', r.id, outcome.toLowerCase(), r.company_id, { reason: comment });
      if (outcome === 'REJECTED') notify(r.company_id, 'proc.rc.decided', [`user:${r.requested_by}`], r.doc_no, 'not approved', `${r.doc_no} was not approved${comment ? `: ${comment}` : ''}.`, `/proc/rate-contracts?id=${r.id}`, r.id);
    },
  };

  // ---- the index and the price-variation revision (FR-04) ------------------------------------------------------------------------------------------------------------------------------------------------
  const indices = {
    list(actor, code) { need(actor, 'proc.rate_contract.view', 'see indices'); return db.prepare(`SELECT * FROM proc_price_indices WHERE company_id = ? AND deleted_at IS NULL ${code ? 'AND index_code = ? COLLATE NOCASE' : ''} ORDER BY index_code, period DESC LIMIT 200`).all(...[actor.companyId, ...(code ? [code] : [])]).map((x) => ({ id: x.id, indexCode: x.index_code, period: x.period, value: x.index_value / 10000, source: x.index_source, enteredBy: x.created_by })); },
    set(actor, b) {
      need(actor, 'proc.rate_contract.index', 'enter an index value'); const code = b.indexCode.toUpperCase(); const val = Math.round(b.value * 10000); const ex = db.prepare('SELECT * FROM proc_price_indices WHERE company_id = ? AND index_code = ? AND period = ? AND deleted_at IS NULL').get(actor.companyId, code, b.period);
      if (ex) { if (db.prepare("SELECT 1 FROM proc_rc_revisions WHERE index_code = ? AND period = ? AND status IN ('SUBMITTED', 'APPROVED') AND company_id = ? AND deleted_at IS NULL").get(code, b.period, actor.companyId)) throw conflict('A price-variation revision was made from this value: it is not changed.'); db.prepare('UPDATE proc_price_indices SET index_value = ?, index_source = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(val, b.source, actor.user, nowIso(), ex.id); audit(actor, 'proc_price_indices', ex.id, 'update', actor.companyId, { oldValues: { value: ex.index_value / 10000 }, newValues: { value: b.value } }); }
      else { const id = Number(db.prepare("INSERT INTO proc_price_indices (company_id, index_code, period, index_value, index_source, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'api')").run(actor.companyId, code, b.period, val, b.source, actor.user).lastInsertRowid); audit(actor, 'proc_price_indices', id, 'create', actor.companyId, { newValues: { code, period: b.period, value: b.value } }); }
      return indices.list(actor, code);
    },
  };
  const pv = {
    /** The revised rates for the period are worked out from the index and sent for approval at once; they take effect only when approved. */
    request(actor, id, b) {
      const r = row(actor, id, 'proc.rate_contract.pv'); const f = json(r.pv_json, null); if (r.status !== 'APPROVED') throw unprocessable('Only a contract in force is revised.'); if (!f?.enabled) throw unprocessable('This contract has no price-variation formula.');
      if (db.prepare("SELECT 1 FROM proc_rc_revisions WHERE rc_id = ? AND status IN ('SUBMITTED', 'DRAFT', 'RETURNED') AND deleted_at IS NULL").get(r.id)) throw conflict('A revision of this contract is waiting for approval.'); if (db.prepare("SELECT 1 FROM proc_rc_revisions WHERE rc_id = ? AND period = ? AND status = 'APPROVED' AND deleted_at IS NULL").get(r.id, b.period)) throw conflict(`The revision for ${b.period} is applied already.`);
      const ix = db.prepare('SELECT index_value FROM proc_price_indices WHERE company_id = ? AND index_code = ? COLLATE NOCASE AND period = ? AND deleted_at IS NULL').get(r.company_id, f.indexCode, b.period); if (!ix) throw unprocessable(`Enter the ${f.indexCode} index for ${b.period} first.`);
      const min = Number(param(r.company_id, 'proc.rc.pv_min_change_bp') ?? 50); const changes = [];
      for (const l of linesOf(r.id)) { if (!l.pv_linked) continue; const nr = pvRate({ baseRate: l.base_rate, baseIndex: f.baseIndex, currentIndex: ix.index_value, linkedPct: f.linkedPct }); if (Math.abs(nr - l.rate) * 10000 < min * l.rate) continue; changes.push({ rcLineId: l.id, lineNo: l.line_no, description: l.description, oldRate: l.rate, newRate: nr, changePct: Math.round(((nr - l.rate) / l.rate) * 10000) / 100 }); }
      if (!changes.length) throw unprocessable('The index does not move any rate by the minimum change.');
      return transaction(db, () => { const n = db.prepare('SELECT COALESCE(MAX(revision_no), 0) + 1 AS n FROM proc_rc_revisions WHERE rc_id = ?').get(r.id).n; const vid = Number(db.prepare("INSERT INTO proc_rc_revisions (company_id, rc_id, revision_no, index_code, period, index_value, base_index, effective_from, changes_json, status, requested_by, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, 'api')").run(r.company_id, r.id, n, f.indexCode, b.period, ix.index_value, f.baseIndex, b.effectiveFrom ?? todayIST(), JSON.stringify(changes), actor.user, actor.user).lastInsertRowid);
        const inst = workflowOf(db).submit(actor, { docType: PV_DOC, docId: String(vid), comment: `${r.doc_no} ${f.indexCode} ${b.period}: ${changes.length} rate(s)`.slice(0, 300), context: { amount: Number(rs(sizeOf(r, linesOf(r.id)))) } }); db.prepare("UPDATE proc_rc_revisions SET status = 'SUBMITTED', workflow_instance_id = ? WHERE id = ?").run(inst.id, vid); audit(actor, 'proc_rc_revisions', vid, 'submit', r.company_id, { newValues: { period: b.period, changes: changes.length } }); return rcs.get(actor, r.id); });
    },
    decide(instance, actor, outcome, comment) {
      const v = db.prepare('SELECT * FROM proc_rc_revisions WHERE id = ?').get(rid(instance.docId)); if (!v || v.status !== 'SUBMITTED') return; const r = db.prepare('SELECT * FROM proc_rate_contracts WHERE id = ?').get(v.rc_id); const now = nowIso();
      if (outcome === 'APPROVED') {
        const ch = json(v.changes_json, []); for (const c of ch) db.prepare('UPDATE proc_rc_lines SET rate = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(c.newRate, actor.user, now, c.rcLineId);
        db.prepare("UPDATE proc_rc_revisions SET status = 'APPROVED', approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?").run(actor.user, now, now, v.id); audit(actor, 'proc_rc_revisions', v.id, 'approve', r.company_id, { newValues: { period: v.period, changes: ch.length } });
        evt('proc.rc.pv_applied', actor, r, { revisionId: v.id, revisionNo: v.revision_no, indexCode: v.index_code, period: v.period, indexValue: v.index_value / 10000, effectiveFrom: v.effective_from, lines: ch.map((c) => ({ rcLineId: c.rcLineId, oldRate: rs(c.oldRate), newRate: rs(c.newRate) })) });
        notify(r.company_id, 'proc.rc.decided', [`user:${v.requested_by}`, 'role:PROCIC'], r.doc_no, `price variation ${v.period} applied`, `The rates of ${r.doc_no} are revised for ${v.index_code} ${v.period}.`, `/proc/rate-contracts?id=${r.id}`, `${v.id}.pv`); return;
      }
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN'; const to = outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED'; db.prepare('UPDATE proc_rc_revisions SET status = ?, workflow_instance_id = ?, updated_at = ? WHERE id = ?').run(to, withdrawn ? null : v.workflow_instance_id, now, v.id); audit(actor, 'proc_rc_revisions', v.id, outcome.toLowerCase(), r.company_id, { reason: comment });
    },
  };

  /** FR-03: told once each at 80 % and at 100 % of the ceiling, and once when the contract ends within the days set; a new index value without a revision is told to procurement. */
  function sweep() {
    let n = 0; const today = todayIST();
    for (const r of db.prepare("SELECT * FROM proc_rate_contracts WHERE status = 'APPROVED' AND deleted_at IS NULL").all()) {
      recalc(r.id); const pct = pctOf(db.prepare('SELECT * FROM proc_rate_contracts WHERE id = ?').get(r.id), linesOf(r.id)); const to = ['role:PROCMGR', 'role:PROCIC'];
      if (pct >= 100 && !r.alerted_100) { db.prepare('UPDATE proc_rate_contracts SET alerted_100 = 1, alerted_80 = 1 WHERE id = ?').run(r.id); evt('proc.rc.ceiling_reached', null, r, { usedPct: pct }); notify(r.company_id, 'proc.rc.consumption', to, r.doc_no, '100%', `The ceiling of ${r.doc_no} is used: no further call-off.`, `/proc/rate-contracts?id=${r.id}`, `${r.id}.100`); n += 1; }
      else if (pct >= 80 && !r.alerted_80) { db.prepare('UPDATE proc_rate_contracts SET alerted_80 = 1 WHERE id = ?').run(r.id); notify(r.company_id, 'proc.rc.consumption', to, r.doc_no, `${pct}%`, `${pct}% of the ceiling of ${r.doc_no} is used.`, `/proc/rate-contracts?id=${r.id}`, `${r.id}.80`); n += 1; }
      const left = Math.round((Date.parse(`${r.valid_to}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000); if (left <= Number(param(r.company_id, 'proc.rc.expiry_days') ?? 30) && !r.alerted_expiry) { db.prepare('UPDATE proc_rate_contracts SET alerted_expiry = 1 WHERE id = ?').run(r.id); evt('proc.rc.expiring', null, r, { validTo: r.valid_to, daysLeft: left }); notify(r.company_id, 'proc.rc.expiry', to, r.doc_no, left < 0 ? `ended ${r.valid_to}` : `${left} day(s) left`, `${r.doc_no} ${left < 0 ? 'has ended' : `ends in ${left} day(s)`}: renew or amend it.`, `/proc/rate-contracts?id=${r.id}`, `${r.id}.x`); n += 1; }
      const f = json(r.pv_json, null); if (f?.enabled) { const latest = db.prepare('SELECT period FROM proc_price_indices WHERE company_id = ? AND index_code = ? COLLATE NOCASE AND deleted_at IS NULL ORDER BY period DESC LIMIT 1').get(r.company_id, f.indexCode);
        if (latest && latest.period > f.basePeriod && !db.prepare("SELECT 1 FROM proc_rc_revisions WHERE rc_id = ? AND period >= ? AND status IN ('SUBMITTED', 'APPROVED') AND deleted_at IS NULL").get(r.id, latest.period) && !db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'proc_rate_contracts' AND entity_id = ? AND action = ? ").get(String(r.id), `pv_due.${latest.period}`)) { audit({ user: 'system' }, 'proc_rate_contracts', r.id, `pv_due.${latest.period}`, r.company_id); notify(r.company_id, 'proc.rc.pv_due', ['role:PROCMGR'], r.doc_no, latest.period, `The ${f.indexCode} index for ${latest.period} is entered: a price-variation revision of ${r.doc_no} can be made.`, `/proc/rate-contracts?id=${r.id}`, `${r.id}.${latest.period}`); n += 1; } }
    }
    return n;
  }
  return { rcs, indices, pv, check, recalc, sweep, decide: rcs.decide, pvDecide: pv.decide, consumption, ancestors };
}
