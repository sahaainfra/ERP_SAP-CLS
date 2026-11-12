import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { todayIST } from '../../../shared/dates.js';
import { d3, nowIso, q3 } from './base.js';

// The stock seen by a request (part 15.01, FR-01, FR-02, BR-02): the free stock of an item in the store of the site, in nearby stores and in the central warehouse. The stock module (16.01) will own the balances; until it exists they
// are kept in `proc_stock_levels` and filled through `ingest`, so that the availability panel and the stock check read one place. Stock in the store of the same site and in nearby stores (another site of the project, or a store marked
// nearby) counts against a requisition; the central warehouse counts when the company's setting says so, and is always shown.
export const STORE_KINDS = { SITE: 'Site store', NEARBY: 'Nearby store', CENTRAL: 'Central warehouse' };
export const RELATIONS = { SAME_SITE: 'This site', NEARBY: 'Nearby', CENTRAL: 'Central warehouse', OTHER: 'Other project' };

export function createStockService({ db, base }) {
  const { param, need, fail } = base;
  const relationOf = (l, projectId, siteId) => {
    if (l.store_kind === 'CENTRAL') return 'CENTRAL'; if (l.store_kind === 'NEARBY') return 'NEARBY';
    if (l.store_site_id && siteId && l.store_site_id === siteId) return 'SAME_SITE';
    const s = l.store_site_id ? db.prepare('SELECT org_project_id FROM org_sites WHERE id = ?').get(l.store_site_id) : null; return s && s.org_project_id === projectId ? 'NEARBY' : 'OTHER';
  };
  /** The stock of the items for a project and site: every store with its relation, and what counts against a requisition (BR-02). */
  function availability(companyId, projectId, siteId, itemIds) {
    const central = Boolean(param(companyId, 'proc.stock.check_central')); const out = new Map();
    for (const itemId of [...new Set(itemIds)]) {
      const rows = db.prepare('SELECT * FROM proc_stock_levels WHERE company_id = ? AND item_id = ? AND deleted_at IS NULL ORDER BY store_kind, store_code').all(companyId, itemId);
      const stores = rows.map((l) => { const relation = relationOf(l, projectId, siteId); return { storeCode: l.store_code, storeName: l.store_name, kind: l.store_kind, kindLabel: STORE_KINDS[l.store_kind], relation, relationLabel: RELATIONS[relation], freeQty: d3(l.free_qty), asOf: l.as_of, counts: relation === 'SAME_SITE' || relation === 'NEARBY' || (relation === 'CENTRAL' && central) }; }).filter((s) => s.relation !== 'OTHER');
      const controlQty = stores.filter((s) => s.counts).reduce((n, s) => n + Math.round(s.freeQty * 1000), 0);
      out.set(itemId, { itemId, stores, controlQty: d3(controlQty), controlMilli: controlQty, total: d3(stores.reduce((n, s) => n + Math.round(s.freeQty * 1000), 0)) });
    }
    return out;
  }
  /** What a service call or the ingest route may give: levels of items in stores, the latest figure replacing the one before. */
  function apply(actor, { levels }) {
    const day = todayIST(); const problems = []; const rows = [];
    levels.forEach((l, i) => { const it = db.prepare('SELECT id FROM mdm_items WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(l.itemId, actor.companyId); if (!it) problems.push({ field: `levels.${i}.itemId`, message: 'Not an item of this company' }); if (l.siteId && !db.prepare('SELECT 1 FROM org_sites WHERE id = ? AND company_id = ?').get(l.siteId, actor.companyId)) problems.push({ field: `levels.${i}.siteId`, message: 'Not a site of this company' }); rows.push(l); });
    fail(problems);
    return transaction(db, () => {
      let changed = 0;
      for (const l of rows) {
        const ex = db.prepare('SELECT * FROM proc_stock_levels WHERE company_id = ? AND item_id = ? AND store_code = ?').get(actor.companyId, l.itemId, l.storeCode); const free = q3(l.freeQty);
        if (ex) { if (ex.free_qty !== free || ex.store_kind !== l.kind || ex.store_site_id !== (l.siteId ?? null) || ex.deleted_at) { db.prepare('UPDATE proc_stock_levels SET free_qty = ?, store_name = ?, store_kind = ?, store_site_id = ?, as_of = ?, deleted_at = NULL, is_active = 1, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(free, l.storeName, l.kind, l.siteId ?? null, day, actor.user, nowIso(), ex.id); changed += 1; } }
        else { db.prepare("INSERT INTO proc_stock_levels (company_id, item_id, store_code, store_name, store_kind, store_site_id, free_qty, as_of, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ingest')").run(actor.companyId, l.itemId, l.storeCode, l.storeName, l.kind, l.siteId ?? null, free, day, actor.user); changed += 1; }
      }
      if (changed) publishEvent(db, { type: 'proc.stock.levels_loaded', entity: 'proc_stock_levels', entityId: 0, actorId: actor.user, companyId: actor.companyId, data: { levels: rows.length, changed } });
      return { levels: rows.length, changed };
    });
  }
  /** The levels from outside, for a person who holds the right to load them. */
  const ingest = (actor, b) => { need(actor, 'proc.stock.ingest', 'load the stock levels'); return apply(actor, b); };
  /** The levels the stock module (16.01) reports after a movement: no person, the module's own event (the right is checked where the movement was made). */
  const apply_ = (companyId, levels) => apply({ user: 'system', companyId, roles: ['SYSTEM'] }, { levels });
  return { availability, ingest, apply: apply_ };
}
