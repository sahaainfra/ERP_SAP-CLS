import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { badRequest, forbidden, notFound } from '../../platform/http/errors.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { createParameterStore, parameterRegistry } from '../../platform/parameters/index.js';
import { todayIST } from '../../../shared/dates.js';
import { issueNumber } from '../core/numbering/service.js';

// Shared helpers of the procurement module (part 15.01): rights, audit, notifications, numbers, and the checks that the material request and the requisition make alike (a valid item, a unit of measure that fits it, a project, a site).
export const nowIso = () => new Date().toISOString();
export const rid = (v) => parseInt(String(v), 10);
export const lower = (s) => String(s ?? '').toLowerCase();
export const same = (a, b) => Boolean(a && b && lower(a) === lower(b));
export const q3 = (n) => Math.round(Number(n) * 1000);
export const d3 = (n) => (n == null ? null : n / 1000);
export const rs = (n) => (n == null ? null : Math.round(n) / 100);
export const json = (s, d) => { try { return JSON.parse(s ?? ''); } catch { return d; } };
export const PRIORITIES = { LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' };

for (const [key, dataType, def, description, extra] of [
  ['proc.stock.check_central', 'boolean', false, 'BR-02: whether free stock in the central warehouse also counts against a purchase requisition (it is always shown). Stock in the store of the same site and in nearby stores always counts.', {}],
  ['proc.pr.duplicate_days', 'integer', 30, 'FR-04: a requisition for an item and delivery site that another open requisition (not yet ordered) already covers within this many days is shown as a possible duplicate.', { min: 1, max: 365 }],
  ['proc.pr.regularise_hours', 'integer', 24, 'FR-06: the hours within which an emergency purchase is regularised by the approval of the project manager (control CP-PROC-06).', { min: 1, max: 168 }],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType, default: def, scopes: ['system', 'company'], description, .../** @type {any} */ (extra) });

export function createBase({ db }) {
  const authz = authzOf(db);
  const param = (companyId, key) => createParameterStore(db).get(key, { companyId, date: todayIST() });
  const may = (actor, key, pid = null, sid = null) => authz.check(actor, key, { companyId: actor.companyId, projectId: pid, siteId: sid }).allowed;
  const need = (actor, key, what, pid = null, sid = null) => { if (!may(actor, key, pid, sid)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const fail = (p) => { if (p.length) throw badRequest('Correct the highlighted fields', p); };
  const audit = (actor, entity, id, action, companyId, extra = {}) => writeAudit(db, { entity, entityId: id, action, actor: actor?.user ?? 'system', companyId, ...extra });
  const notify = (companyId, code, recipients, ref, subject, detail, link, sourceId, scope = {}) => { if (!recipients.length) return; try { notificationsOf(db).notify({ companyId, templateCode: code, recipients, data: { ref, subject, detail, link }, link, sourceType: `${code}.${sourceId}`, sourceId, ...scope }); } catch { /* saved anyway */ } };
  const number = (companyId, user, docType, table, prefix) => {
    try { return issueNumber(db, { companyId, docType, actor: user, refType: table }).number; } catch (x) { if (!['DOCUMENT_TYPE_UNKNOWN', 'NUMBER_SERIES_MISSING'].includes(x?.code)) throw x; }
    const n = (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE company_id = ?`).get(companyId).n ?? 0) + 1; let no = `${prefix}/${String(n).padStart(6, '0')}`;
    for (let k = n + 1; db.prepare(`SELECT 1 FROM ${table} WHERE company_id = ? AND doc_no = ?`).get(companyId, no); k += 1) no = `${prefix}/${String(k).padStart(6, '0')}`; return no;
  };
  /** The project, when the actor may see it (`key` is checked for the action itself). */
  const project = (actor, projectId, viewKey, key = viewKey) => {
    const p = db.prepare('SELECT id, code, name, company_id FROM org_projects WHERE id = ? AND deleted_at IS NULL').get(rid(projectId));
    if (!p || p.company_id !== actor.companyId || !may(actor, viewKey, p.id)) throw notFound('That project does not exist.'); if (key !== viewKey) need(actor, key, 'do that for this project', p.id); return p;
  };
  const siteOf = (companyId, projectId, siteId) => db.prepare('SELECT id, code, name, org_project_id FROM org_sites WHERE id = ? AND company_id = ? AND org_project_id = ? AND deleted_at IS NULL').get(rid(siteId), companyId, projectId) ?? null;
  const wbsOf = (projectId, wbsId) => db.prepare('SELECT id, code, name FROM proj_wbs WHERE id = ? AND project_id = ? AND deleted_at IS NULL').get(rid(wbsId), projectId) ?? null;
  const codeOf = (companyId, id) => db.prepare('SELECT id, code, name, cost_head_id FROM fin_cost_codes WHERE id = ? AND (company_id = ? OR company_id IS NULL) AND deleted_at IS NULL').get(rid(id), companyId) ?? null;
  const itemOf = (companyId, id) => db.prepare("SELECT id, code, name, item_type, base_uom, stock_tracked, last_purchase_amount, standard_amount, item_status FROM mdm_items WHERE id = ? AND company_id = ? AND deleted_at IS NULL").get(rid(id), companyId) ?? null;
  /** BR-01: the unit of measure is the base unit of the item or one of its own conversions. */
  const uomOk = (item, uom) => Boolean(item && (lower(item.base_uom) === lower(uom) || db.prepare('SELECT 1 FROM mdm_item_uoms WHERE item_id = ? AND uom = ? COLLATE NOCASE AND deleted_at IS NULL').get(item.id, uom)));
  const uomsOf = (itemId) => { const it = db.prepare('SELECT base_uom FROM mdm_items WHERE id = ?').get(itemId); return it ? [it.base_uom, ...db.prepare('SELECT uom FROM mdm_item_uoms WHERE item_id = ? AND deleted_at IS NULL').all(itemId).map((x) => x.uom)] : []; };
  const budgetOf = (projectId) => db.prepare("SELECT * FROM bud_budgets WHERE org_project_id = ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY version_no DESC, id DESC LIMIT 1").get(projectId) ?? null;
  return { authz, param, may, need, fail, audit, notify, number, project, siteOf, wbsOf, codeOf, itemOf, uomOk, uomsOf, budgetOf };
}
