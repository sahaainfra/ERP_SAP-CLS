import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { createUomService } from '../../platform/calc/uom.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { fileEntities } from '../../platform/files/entities.js';
import { HttpError, badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { similarity } from '../../platform/mdm/index.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { objectTypes } from '../../platform/objects/index.js';
import { evidenceProviders, workflowOf, workflowTypes } from '../../platform/workflow/index.js';
import { dec } from '../../../shared/decimal.js';
import { fromUnits, toUnits } from '../../../shared/money.js';
import { todayIST } from '../../../shared/dates.js';
import { commonOf } from './common.js';

// The item master (part 06.03): the catalogue of what the business estimates, buys, stores, issues, executes, bills or costs. Categories form a tree; each company gets its own copy of the system tree the first
// time it opens the catalogue, and then keeps it (code prefix, item types, attribute template, default HSN/SAC, steward role). A new item, or a new version of one, is a request approved by the steward of its
// category (PROCMGR, STOREMGR, EST or PLANTMGR; never the requester); its code comes from the category's series (BR-03; a migrated material keeps its old code). An item used in transactions keeps its base unit:
// a different base unit is a new version (BR-01). Item conversions (a bag of cement is 50 kg, a 12 mm bar is 10.66 kg) are written into the calculation engine's conversions, so it converts per item (T-01).
// A bill of resources lists the materials, labour and equipment of one unit of a composite or work item, with wastage; a cycle is refused (BR-02). A near-identical specification in the same category is
// reported before the request is sent (FR-07). The selector searches the active items by code, name, specification or category, with favourites and recent items (FR-06).
export const ITEM_DOC = 'MDM_ITEM';
export const TYPES = ['MATERIAL', 'CONSUMABLE', 'SPARE', 'TOOL', 'RETURNABLE', 'LABOUR', 'EQUIPMENT', 'SERVICE', 'SUBCONTRACT', 'WORK_ITEM', 'COMPOSITE'];
export const TYPE_LABELS = { MATERIAL: 'Material', CONSUMABLE: 'Consumable', SPARE: 'Spare', TOOL: 'Tool or small asset', RETURNABLE: 'Returnable asset', LABOUR: 'Labour trade', EQUIPMENT: 'Equipment class', SERVICE: 'Service', SUBCONTRACT: 'Subcontract work item', WORK_ITEM: 'Work item', COMPOSITE: 'Composite or assembly' };
const WITH_RESOURCES = new Set(['WORK_ITEM', 'COMPOSITE']);
const STOCKABLE = new Set(['MATERIAL', 'CONSUMABLE', 'SPARE', 'TOOL', 'RETURNABLE']);
const nowIso = () => new Date().toISOString();
const dayBefore = (d) => new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
const trimNum = (s) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);
const defined = (o) => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined));
const json = (s, d) => { try { return JSON.parse(s ?? ''); } catch { return d; } };

/** The key of an item's conversions in the calculation engine, whose table is shared by the companies: the code and the company (two companies may number an item alike). */
export const engineKey = (companyId, code) => `${code}@${companyId}`;
/** Modules that refer to items register how to find their references (where used, BR-01): find(db, companyId, item) -> [{ source, label, route, transaction }]. */
const refs = new Map();
export const itemReferences = { register(def) { refs.set(def.code, def); }, list: () => [...refs.values()] };

/** The specification reduced to what tells two items apart (FR-07): the category, every attribute value lower-cased with spaces and units normalised, in a fixed order. */
export function specKey(categoryCode, spec) {
  const norm = (v) => String(v ?? '').toLowerCase().replace(/\s+/g, '').replace(/millimetres?|mm\.?$/g, 'mm').replace(/metres?$/g, 'm').replace(/kilograms?|kgs?$/g, 'kg');
  return `${categoryCode}|${Object.keys(spec ?? {}).sort().filter((k) => k !== 'brand' && spec[k] != null && spec[k] !== '').map((k) => `${k}=${norm(spec[k])}`).join(';')}`;
}

/** The Item Master register (List Report, 03.03): search, filters with operators, sort, saved views, column chooser and export. The standard rate is a commercial value: hidden for roles without mdm.item.rate.view. */
const STATUS_OPTIONS = [['SUBMITTED', 'Waiting for approval'], ['ACTIVE', 'Active'], ['INACTIVE', 'Inactive'], ['SUPERSEDED', 'Superseded'], ['REJECTED', 'Rejected']];
export const itemList = defineList({
  code: 'mdm.items', label: 'Items', permission: 'mdm.record.view',
  from: 'mdm_items i JOIN mdm_item_categories c ON c.id = i.category_id', where: 'i.deleted_at IS NULL',
  searchable: ['i.code', 'i.name', 'i.search_text'], defaultSort: 'code',
  columns: {
    code: { sql: 'i.code', type: 'text', label: 'Code' }, versionNo: { sql: 'i.version_no', type: 'number', label: 'Version' }, name: { sql: 'i.name', type: 'text', label: 'Name' },
    type: { sql: 'i.item_type', type: 'enum', label: 'Type', options: TYPES.map((t) => [t, TYPE_LABELS[t]]) }, category: { sql: 'c.name', type: 'text', label: 'Category' }, categoryId: { sql: 'i.category_id', type: 'id', label: 'Category id' },
    baseUom: { sql: 'i.base_uom', type: 'text', label: 'Base unit' }, hsnSac: { sql: 'i.hsn_sac_code', type: 'text', label: 'HSN/SAC' }, gstRate: { sql: 'i.gst_code', type: 'text', label: 'GST' },
    status: { sql: 'i.item_status', type: 'enum', label: 'Status', options: STATUS_OPTIONS }, stockTracked: { sql: "CASE i.stock_tracked WHEN 1 THEN 'YES' ELSE 'NO' END", type: 'enum', label: 'Stock tracked', options: [['YES', 'Yes'], ['NO', 'No']] },
    standardRate: { sql: 'i.standard_amount', type: 'money', label: 'Standard rate (₹)', toDb: (v) => toUnits(v, 'money'), sensitive: true },
    updatedAt: { sql: 'COALESCE(i.updated_at, i.created_at)', type: 'datetime', label: 'Changed' },
  },
});

export function createItemService({ db }) {
  const authz = authzOf(db);
  const notif = notificationsOf(db);
  const may = (actor, key) => authz.check(actor, key).allowed;
  const need = (actor, key, what) => { if (!may(actor, key)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const roles = (actor) => (Array.isArray(actor.roles) ? actor.roles : String(actor.roles ?? '').split(',')).map((r) => String(r).trim().toUpperCase());
  const isSteward = (actor, cat) => may(actor, 'mdm.item.edit') && roles(actor).includes(cat.steward_role);
  const seesRates = (actor) => may(actor, 'mdm.item.rate.view');
  const money = (u) => (u == null ? null : trimNum(fromUnits(u, 'money').toFixed()));
  const qty = (u) => (u == null ? null : trimNum(fromUnits(u, 'quantity').toFixed()));
  const pctOf = (u) => (u == null ? null : trimNum(fromUnits(u, 'percent').toFixed()));

  // ---- categories (FR-02) ----
  /** A company's category tree: copied from the system tree the first time, then the company's own. */
  function ensureTree(companyId) {
    if (db.prepare('SELECT 1 FROM mdm_item_categories WHERE company_id = ? LIMIT 1').get(companyId)) return;
    transaction(db, () => {
      const map = new Map();
      for (const c of db.prepare("SELECT * FROM mdm_item_categories WHERE company_id IS NULL AND deleted_at IS NULL ORDER BY parent_id IS NOT NULL, id").all()) {
        const id = Number(db.prepare("INSERT INTO mdm_item_categories (company_id, parent_id, code, name, name_hi, code_prefix, item_types_json, attribute_template_json, default_hsn_code, gl_mapping_code, steward_role, category_status, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'system', 'mdm_item_category_template', ?)")
          .run(companyId, c.parent_id ? map.get(c.parent_id) ?? null : null, c.code, c.name, c.name_hi, c.code_prefix, c.item_types_json, c.attribute_template_json, c.default_hsn_code, c.gl_mapping_code, c.steward_role, c.category_status, String(c.id)).lastInsertRowid);
        map.set(c.id, id);
      }
    });
  }
  const catRow = (companyId, id) => { const c = db.prepare('SELECT * FROM mdm_item_categories WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, companyId); if (!c) throw notFound('That category does not exist.'); return c; };
  const catView = (c, counts) => ({ id: c.id, parentId: c.parent_id, code: c.code, name: c.name, nameHi: c.name_hi, codePrefix: c.code_prefix, itemTypes: json(c.item_types_json, []), attributes: json(c.attribute_template_json, []), defaultHsn: c.default_hsn_code, glCode: c.gl_mapping_code, stewardRole: c.steward_role, status: c.category_status, items: counts?.get(c.id) ?? 0, rowVersion: c.version });
  const descendants = (companyId, id) => { const all = db.prepare('SELECT id, parent_id FROM mdm_item_categories WHERE company_id = ? AND deleted_at IS NULL').all(companyId); const out = [id]; for (let i = 0; i < out.length; i += 1) for (const c of all) if (c.parent_id === out[i]) out.push(c.id); return out; };
  const categories = {
    tree(actor) {
      need(actor, 'mdm.record.view', 'see the item catalogue');
      ensureTree(actor.companyId);
      const counts = new Map(db.prepare("SELECT category_id AS c, COUNT(*) AS n FROM mdm_items WHERE company_id = ? AND item_status IN ('ACTIVE', 'SUBMITTED') AND deleted_at IS NULL GROUP BY category_id").all(actor.companyId).map((r) => [r.c, r.n]));
      const rows = db.prepare('SELECT * FROM mdm_item_categories WHERE company_id = ? AND deleted_at IS NULL ORDER BY name').all(actor.companyId).map((c) => catView(c, counts));
      return { rows, canEdit: may(actor, 'mdm.item.category.edit'), types: TYPES.map((t) => ({ code: t, label: TYPE_LABELS[t] })) };
    },
    save(actor, id, b) {
      need(actor, 'mdm.item.category.edit', 'change item categories');
      ensureTree(actor.companyId);
      const problems = [];
      if (b.parentId) { catRow(actor.companyId, b.parentId); if (id && descendants(actor.companyId, id).includes(b.parentId)) problems.push({ field: 'parentId', message: 'A category cannot sit under itself or one of its own sub-categories' }); }
      for (const t of b.itemTypes) if (!TYPES.includes(t)) problems.push({ field: 'itemTypes', message: `${t} is not an item type` });
      const keys = new Set();
      for (const a of b.attributes) { if (keys.has(a.key)) problems.push({ field: 'attributes', message: `${a.key} is in the template twice` }); keys.add(a.key); if (a.type === 'enum' && !(a.options?.length)) problems.push({ field: 'attributes', message: `${a.label} needs its choices` }); }
      if (b.defaultHsn && commonOf(db) && !commonOf(db).list(actor, 'hsn-sac', { key: b.defaultHsn, limit: 1, offset: 0 }).rows.length) problems.push({ field: 'defaultHsn', message: `${b.defaultHsn} is not an HSN/SAC code in force` });
      if (problems.length) throw badRequest('Some fields are not valid.', problems);
      return transaction(db, () => {
        const vals = [b.parentId ?? null, b.code, b.name, b.nameHi ?? null, b.codePrefix, JSON.stringify(b.itemTypes), JSON.stringify(b.attributes), b.defaultHsn ?? null, b.glCode ?? null, b.stewardRole, b.status ?? 'ACTIVE'];
        let cid = id;
        if (id) {
          const c = catRow(actor.companyId, id);
          if (c.version !== b.version) throw conflict('This category was changed by someone else. Reload it and try again.');
          if (c.code_prefix !== b.codePrefix && db.prepare('SELECT 1 FROM mdm_items WHERE category_id = ? LIMIT 1').get(id)) throw unprocessable('The code prefix of a category with items is not changed: their codes would no longer follow it.');
          db.prepare('UPDATE mdm_item_categories SET parent_id = ?, code = ?, name = ?, name_hi = ?, code_prefix = ?, item_types_json = ?, attribute_template_json = ?, default_hsn_code = ?, gl_mapping_code = ?, steward_role = ?, category_status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(...vals, actor.user, nowIso(), id);
          writeAudit(db, { entity: 'mdm_item_categories', entityId: id, action: 'update', oldValues: catView(c), newValues: b, actor: actor.user, companyId: actor.companyId, reason: b.reason });
        } else {
          if (db.prepare('SELECT 1 FROM mdm_item_categories WHERE company_id = ? AND code = ? AND deleted_at IS NULL').get(actor.companyId, b.code)) throw conflict(`Category ${b.code} already exists.`);
          cid = Number(db.prepare("INSERT INTO mdm_item_categories (company_id, parent_id, code, name, name_hi, code_prefix, item_types_json, attribute_template_json, default_hsn_code, gl_mapping_code, steward_role, category_status, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'mdm_item_category')").run(actor.companyId, ...vals, actor.user).lastInsertRowid);
          writeAudit(db, { entity: 'mdm_item_categories', entityId: cid, action: 'create', newValues: b, actor: actor.user, companyId: actor.companyId, reason: b.reason });
        }
        publishEvent(db, { type: 'mdm.item_category.changed', entity: 'mdm_item_category', entityId: cid, actorId: actor.user, companyId: actor.companyId, data: { code: b.code } });
        return catView(catRow(actor.companyId, cid));
      });
    },
    history(actor, id) {
      need(actor, 'mdm.record.view', 'see the item catalogue');
      catRow(actor.companyId, id);
      return { rows: db.prepare("SELECT action, actor, reason, created_at FROM core_audit_log WHERE entity = 'mdm_item_categories' AND entity_id = ? ORDER BY id DESC LIMIT 50").all(String(id)).map((r) => ({ action: r.action, by: r.actor, reason: r.reason, at: r.created_at })) };
    },
  };

  // ---- checking an item ----
  /** The specification checked against the category's attribute template. */
  function checkSpec(cat, spec) {
    const problems = []; const out = {};
    const tmpl = json(cat.attribute_template_json, []);
    for (const k of Object.keys(spec ?? {})) if (!tmpl.some((a) => a.key === k)) problems.push({ field: `spec.${k}`, message: `${k} is not an attribute of ${cat.name}` });
    for (const a of tmpl) {
      let v = spec?.[a.key];
      if (v === '' || v === undefined) v = null;
      if (v == null) { if (a.required) problems.push({ field: `spec.${a.key}`, message: `${a.label} is required for ${cat.name}` }); continue; }
      if (a.type === 'number') { if (!/^\d+(\.\d+)?$/.test(String(v).trim())) { problems.push({ field: `spec.${a.key}`, message: `${a.label} must be a number${a.unit ? ` in ${a.unit}` : ''}` }); continue; } v = String(v).trim(); }
      else if (a.type === 'enum') { const hit = a.options.find((o) => o.toLowerCase() === String(v).trim().toLowerCase()); if (!hit) { problems.push({ field: `spec.${a.key}`, message: `${a.label}: choose one of ${a.options.join(', ')}` }); continue; } v = hit; }
      else v = String(v).trim().slice(0, 120);
      out[a.key] = v;
    }
    return { spec: out, problems };
  }
  const uomOf = (actor, code) => (commonOf(db) ? commonOf(db).list(actor, 'uom', { key: code, limit: 1, offset: 0 }).rows[0] ?? null : null);
  /** Near-identical items (FR-07): the same normalised specification in the same category, or a name 90% alike. */
  function duplicates(companyId, cat, key, name, exceptCode = null) {
    const out = [];
    for (const r of db.prepare("SELECT id, code, name, spec_key FROM mdm_items WHERE company_id = ? AND category_id = ? AND item_status IN ('ACTIVE', 'SUBMITTED') AND deleted_at IS NULL").all(companyId, cat.id)) {
      if (exceptCode && r.code === exceptCode) continue;
      if (key && key.includes('=') && r.spec_key === key) out.push({ id: r.id, code: r.code, name: r.name, rule: 'same specification', score: 100 });
      else { const s = similarity(name, r.name); if (s >= 90) out.push({ id: r.id, code: r.code, name: r.name, rule: 'similar name', score: s }); }
    }
    return out.sort((a, b) => b.score - a.score);
  }
  /** What a request would store, checked: category and type, specification, unit, tax codes, flags, rates. */
  function prepare(actor, b, { existing = null } = {}) {
    ensureTree(actor.companyId);
    const cat = catRow(actor.companyId, b.categoryId);
    const problems = [];
    if (cat.category_status !== 'ACTIVE') problems.push({ field: 'categoryId', message: `${cat.name} is not in use` });
    const types = json(cat.item_types_json, []);
    if (types.length && !types.includes(b.itemType)) problems.push({ field: 'itemType', message: `${cat.name} holds ${types.map((t) => TYPE_LABELS[t].toLowerCase()).join(', ')}, not ${TYPE_LABELS[b.itemType].toLowerCase()}` });
    const s = checkSpec(cat, b.spec);
    problems.push(...s.problems);
    const uom = uomOf(actor, b.baseUom);
    if (!uom) problems.push({ field: 'baseUom', message: `${b.baseUom} is not a unit of measure (06.02)` });
    const hsn = b.hsnSac ?? cat.default_hsn_code ?? null;
    let gst = b.gstRate ?? null;
    if (hsn && commonOf(db)) { try { const r = commonOf(db).tax.gst(actor, { hsn, date: b.effectiveFrom ?? todayIST() }); gst = gst ?? r.rate.code; } catch { problems.push({ field: 'hsnSac', message: `${hsn} is not an HSN/SAC code in force` }); } }
    if (gst && commonOf(db) && !commonOf(db).list(actor, 'gst-rates', { key: gst, limit: 1, offset: 0 }).rows.length) problems.push({ field: 'gstRate', message: `${gst} is not a GST rate in force` });
    const stock = STOCKABLE.has(b.itemType) ? Boolean(b.stockTracked) : false;
    if (!STOCKABLE.has(b.itemType) && (b.stockTracked || b.batchTracked || b.serialTracked)) problems.push({ field: 'stockTracked', message: `A ${TYPE_LABELS[b.itemType].toLowerCase()} is not kept in stock` });
    if ((b.batchTracked || b.serialTracked) && !stock) problems.push({ field: 'batchTracked', message: 'Batch or serial tracking needs a stock-tracked item' });
    if (b.shelfLifeDays && !b.batchTracked) problems.push({ field: 'shelfLifeDays', message: 'A shelf life needs batch tracking (the expiry is per batch)' });
    for (const brand of b.preferredBrands ?? []) if (String(brand).length > 60) problems.push({ field: 'preferredBrands', message: 'A brand has at most 60 characters' });
    if (problems.length) throw badRequest('Some fields are not valid.', problems);
    const key = specKey(cat.code, s.spec);
    const data = {
      name: b.name.trim(), name_hi: b.nameHi ?? null, item_type: b.itemType, category_id: cat.id, description: b.description ?? null, spec_json: JSON.stringify(s.spec), spec_key: key,
      search_text: [b.name, b.nameHi, b.description, ...Object.values(s.spec), cat.name].filter(Boolean).join(' ').toLowerCase(), base_uom: uom.code, hsn_sac_code: hsn, gst_code: gst,
      stock_tracked: stock ? 1 : 0, batch_tracked: b.batchTracked ? 1 : 0, serial_tracked: b.serialTracked ? 1 : 0, shelf_life_days: b.shelfLifeDays ?? null,
      reorder_level: toUnits(b.reorderLevel ?? '0', 'quantity'), reorder_quantity: toUnits(b.reorderQuantity ?? '0', 'quantity'), standard_amount: toUnits(b.standardRate ?? '0', 'money'), preferred_brands_json: JSON.stringify(b.preferredBrands ?? []),
    };
    return { cat, data, dups: duplicates(actor.companyId, cat, key, b.name, existing?.code ?? null) };
  }

  // ---- views ----
  const itemRow = (companyId, id) => { const r = db.prepare('SELECT * FROM mdm_items WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, companyId); if (!r) throw notFound('That item does not exist.'); return r; };
  const view = (actor, r, cat = null) => {
    const c = cat ?? db.prepare('SELECT * FROM mdm_item_categories WHERE id = ?').get(r.category_id);
    const rates = seesRates(actor);
    return { id: r.id, code: r.code, versionNo: r.version_no, name: r.name, nameHi: r.name_hi, type: r.item_type, typeLabel: TYPE_LABELS[r.item_type], categoryId: r.category_id, category: c ? { id: c.id, code: c.code, name: c.name, stewardRole: c.steward_role } : null,
      description: r.description, spec: json(r.spec_json, {}), baseUom: r.base_uom, hsnSac: r.hsn_sac_code, gstRate: r.gst_code, stockTracked: Boolean(r.stock_tracked), batchTracked: Boolean(r.batch_tracked), serialTracked: Boolean(r.serial_tracked),
      shelfLifeDays: r.shelf_life_days, reorderLevel: qty(r.reorder_level), reorderQuantity: qty(r.reorder_quantity), standardRate: rates ? money(r.standard_amount) : null, lastPurchaseRate: rates ? money(r.last_purchase_amount) : null, lastPurchaseAt: r.last_purchase_at,
      ratesMasked: !rates, preferredBrands: json(r.preferred_brands_json, []), imageFileId: r.image_file_id, status: r.item_status, effectiveFrom: r.effective_from, effectiveTo: r.effective_to, supersedesId: r.supersedes_id, legacyCode: r.legacy_code, requestedBy: r.requested_by, instanceId: r.workflow_instance_id, rowVersion: r.version };
  };
  const uomsOf = (id) => db.prepare('SELECT * FROM mdm_item_uoms WHERE item_id = ? AND deleted_at IS NULL ORDER BY uom').all(id).map((u) => ({ id: u.id, uom: u.uom, factorToBase: u.factor_to_base, purpose: u.purpose }));
  const resourcesOf = (actor, id) => db.prepare('SELECT r.*, c.code, c.name, c.item_type, c.base_uom, c.standard_amount, c.item_status FROM mdm_item_resources r JOIN mdm_items c ON c.id = r.component_item_id WHERE r.parent_item_id = ? AND r.deleted_at IS NULL ORDER BY r.sort_order, r.id').all(id)
    .map((r) => ({ id: r.id, componentId: r.component_item_id, code: r.code, name: r.name, type: r.item_type, typeLabel: TYPE_LABELS[r.item_type], quantity: qty(r.qty_per_unit), uom: r.uom, wastagePct: pctOf(r.wastage_pct), componentStatus: r.item_status, rate: seesRates(actor) ? money(r.standard_amount) : null, baseUom: r.base_uom }));
  /** One unit of a composite: quantity x (1 + wastage) x the component's standard rate, converted to its base unit (FR-04; the full rate analysis is 06.06). */
  function resourceCost(actor, lines) {
    if (!seesRates(actor)) return null;
    let total = dec('0');
    for (const l of lines) {
      let q = dec(l.quantity).mul(dec('1').add(dec(l.wastagePct).div(100, 8)));
      if (l.uom !== l.baseUom) { try { q = dec(createUomService({ db }).convert(q.toFixed(), l.uom, l.baseUom, { itemCode: engineKey(actor.companyId, l.code), scale: 6 }).result); } catch { return null; } }
      total = total.add(q.mul(dec(l.rate ?? '0')));
    }
    return trimNum(total.round(2).toFixed());
  }

  // ---- where used (BR-01) ----
  function whereUsed(actor, id) {
    need(actor, 'mdm.record.view', 'see the item catalogue');
    const r = itemRow(actor.companyId, id);
    const rows = [];
    for (const p of db.prepare('SELECT DISTINCT p.id, p.code, p.name, p.item_status FROM mdm_item_resources x JOIN mdm_items p ON p.id = x.parent_item_id WHERE x.component_item_id = ? AND x.deleted_at IS NULL').all(id))
      rows.push({ source: 'Bill of resources', label: `${p.code} ${p.name}`, route: `/admin/items/item?id=${p.id}`, transaction: false, status: p.item_status });
    for (const a of db.prepare('SELECT i.id, i.code, i.name FROM mdm_item_alternates x JOIN mdm_items i ON i.id = x.item_id WHERE x.alternate_item_id = ? AND x.deleted_at IS NULL').all(id)) rows.push({ source: 'Alternate of', label: `${a.code} ${a.name}`, route: `/admin/items/item?id=${a.id}`, transaction: false });
    for (const m of db.prepare('SELECT legacy_source, legacy_key FROM mdm_item_legacy_map WHERE item_id = ? AND deleted_at IS NULL').all(id)) rows.push({ source: 'Migrated from', label: `${m.legacy_source}: ${m.legacy_key}`, route: null, transaction: false });
    for (const p of itemReferences.list()) for (const x of p.find(db, actor.companyId, r)) rows.push({ ...x, source: x.source ?? p.label });
    return { rows, transactions: rows.filter((x) => x.transaction).length };
  }

  // ---- requests and approval (FR-01, BR-03) ----
  const takeCode = (companyId, cat) => {
    db.prepare('INSERT OR IGNORE INTO mdm_item_code_counters (company_id, category_id, next_seq, created_by, source_type) VALUES (?, ?, 1, ?, ?)').run(companyId, cat.id, 'system', 'mdm_item');
    for (;;) {
      const seq = db.prepare('UPDATE mdm_item_code_counters SET next_seq = next_seq + 1, updated_at = ? WHERE company_id = ? AND category_id = ? RETURNING next_seq - 1 AS seq').get(nowIso(), companyId, cat.id).seq;
      const code = `${cat.code_prefix}-${String(seq).padStart(5, '0')}`;
      if (!db.prepare('SELECT 1 FROM mdm_items WHERE company_id = ? AND code = ?').get(companyId, code)) return code;
    }
  };
  const insertItem = (actor, data, extra) => {
    const all = { company_id: actor.companyId, ...data, ...extra, created_by: actor.user, requested_by: actor.user };
    const cols = Object.keys(all);
    return Number(db.prepare(`INSERT INTO mdm_items (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((c) => all[c])).lastInsertRowid);
  };
  const submit = (actor, id, cat, r, comment) => {
    const inst = workflowOf(db).submit(actor, { docType: ITEM_DOC, docId: id, comment, context: { stewardRole: cat.steward_role, itemType: r.item_type, newVersion: (r.version_no ?? 1) > 1 } });
    db.prepare('UPDATE mdm_items SET workflow_instance_id = ? WHERE id = ?').run(inst.id, id);
    return inst;
  };
  const items = {
    /** Shown while the request is written: what blocks and the near-identical items (T-02). */
    check(actor, b) {
      need(actor, 'mdm.record.view', 'see the item catalogue');
      try { const p = prepare(actor, b); return { errors: [], duplicates: p.dups, specKey: p.data.spec_key }; } catch (e) { if (e instanceof HttpError && e.status === 400) return { errors: e.details, duplicates: [] }; throw e; }
    },
    /** A new item: a request to the steward of the category. A migrated material keeps its code (BR-03, mdm.item.migrate). */
    create(actor, b) {
      need(actor, 'mdm.record.view', 'request an item');
      if (b.legacy && !may(actor, 'mdm.item.migrate')) throw forbidden('Only a person who migrates the old materials gives an item its own code (permission mdm.item.migrate).');
      const p = prepare(actor, b);
      if (p.dups.length && !b.acknowledgeDuplicates) throw new HttpError(409, 'DUPLICATE_WARNING', `This looks like ${p.dups.map((d) => `${d.code} ${d.name} (${d.rule})`).join('; ')}. Use that item, or confirm this is a different one.`, p.dups.map((d) => ({ field: 'spec', message: `like ${d.code} ${d.name}`, itemId: d.id })));
      return transaction(db, () => {
        let code;
        if (b.legacy) { code = b.legacy.code.trim().toUpperCase(); if (db.prepare('SELECT 1 FROM mdm_items WHERE company_id = ? AND code = ?').get(actor.companyId, code)) throw conflict(`An item with code ${code} already exists.`); }
        else code = takeCode(actor.companyId, p.cat);
        const id = insertItem(actor, p.data, { code, version_no: 1, item_status: 'SUBMITTED', effective_from: b.effectiveFrom ?? todayIST(), legacy_code: b.legacy?.key ?? null, source_type: b.legacy ? `legacy:${b.legacy.source}` : 'mdm_item', source_id: b.legacy?.key ?? null });
        const legacyUoms = b.legacy?.source === 'conversion' && !(b.uoms ?? []).length
          ? db.prepare('SELECT from_uom AS uom, factor AS factorToBase FROM core_uom_conversions WHERE item_code = ? AND to_uom = ? AND deleted_at IS NULL').all(b.legacy.key, p.data.base_uom).map((x) => ({ uom: x.uom, factorToBase: x.factorToBase }))
          : [];
        for (const u of [...(b.uoms ?? []), ...legacyUoms]) addUom(actor, id, p.data.base_uom, u);
        const inst = submit(actor, id, p.cat, { item_type: b.itemType, version_no: 1 }, b.justification ?? 'New item');
        writeAudit(db, { entity: 'mdm_items', entityId: id, action: 'create', newValues: { code, name: b.name, type: b.itemType, category: p.cat.code }, actor: actor.user, companyId: actor.companyId, reason: b.justification ?? null });
        publishEvent(db, { type: 'mdm.item.requested', entity: 'mdm_item', entityId: id, actorId: actor.user, companyId: actor.companyId, data: { code, type: b.itemType } });
        return { item: view(actor, itemRow(actor.companyId, id)), workflow: inst, duplicates: p.dups.length };
      });
    },
    /** A request returned for correction: the requester corrects it and sends it again. */
    resubmit(actor, id, b) {
      const r = itemRow(actor.companyId, id);
      if (r.requested_by?.toLowerCase() !== actor.user.toLowerCase()) throw forbidden('Only the person who asked can send it again.');
      const inst = r.workflow_instance_id ? db.prepare('SELECT status FROM wf_instances WHERE id = ?').get(r.workflow_instance_id) : null;
      if (r.item_status !== 'SUBMITTED' || inst?.status !== 'RETURNED') throw conflict('Only a request that was returned can be sent again.');
      const p = prepare(actor, { ...b, categoryId: r.category_id }, { existing: r });
      return transaction(db, () => {
        const sets = Object.keys(p.data);
        db.prepare(`UPDATE mdm_items SET ${sets.map((c) => `${c} = ?`).join(', ')}, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(...sets.map((c) => p.data[c]), actor.user, nowIso(), id);
        workflowOf(db).resubmit(actor, r.workflow_instance_id, { comment: b.justification ?? 'Corrected', context: { stewardRole: p.cat.steward_role, itemType: p.data.item_type, newVersion: r.version_no > 1 } });
        writeAudit(db, { entity: 'mdm_items', entityId: id, action: 'resubmit', actor: actor.user, companyId: actor.companyId, reason: b.justification ?? null });
        return view(actor, itemRow(actor.companyId, id));
      });
    },
    /**
     * A change of an active item by the steward of its category, audited. The base unit of an item used in a transaction is not changed (BR-01): a new version is asked for instead;
     * the code, category and type are not changed here either.
     */
    update(actor, id, b) {
      const r = itemRow(actor.companyId, id);
      const cat = catRow(actor.companyId, r.category_id);
      if (!isSteward(actor, cat)) throw forbidden(`Only a steward of ${cat.name} (${cat.steward_role}) changes its items.`);
      if (r.version !== b.version) throw conflict('This item was changed by someone else. Reload it and try again.');
      if (r.item_status !== 'ACTIVE') throw conflict(`This item is ${r.item_status.toLowerCase()} and is not changed.`);
      if (b.baseUom && b.baseUom !== r.base_uom) {
        const used = whereUsed(actor, id);
        if (used.transactions) throw unprocessable(`${r.code} is used in ${used.transactions} transaction(s), so its base unit stays ${r.base_uom}. Create a new version of the item with the new unit (BR-01).`, [{ field: 'baseUom', message: 'create a new version instead' }]);
      }
      const p = prepare(actor, { ...view({ ...actor, roles: ['SYSADM'] }, r), standardRate: money(r.standard_amount), ...defined(b), categoryId: r.category_id, itemType: r.item_type, baseUom: b.baseUom ?? r.base_uom }, { existing: r });
      const changed = Object.keys(p.data).filter((c) => String(p.data[c] ?? '') !== String(r[c] ?? '') && c !== 'search_text');
      if (!changed.length) throw badRequest('Nothing was changed.', [{ field: 'data', message: 'change at least one field' }]);
      return transaction(db, () => {
        const sets = Object.keys(p.data);
        db.prepare(`UPDATE mdm_items SET ${sets.map((c) => `${c} = ?`).join(', ')}, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(...sets.map((c) => p.data[c]), actor.user, nowIso(), id);
        writeAudit(db, { entity: 'mdm_items', entityId: id, action: 'update', oldValues: Object.fromEntries(changed.map((c) => [c, r[c]])), newValues: Object.fromEntries(changed.map((c) => [c, p.data[c]])), actor: actor.user, companyId: actor.companyId, reason: b.reason ?? null });
        publishEvent(db, { type: 'mdm.item.changed', entity: 'mdm_item', entityId: id, actorId: actor.user, companyId: actor.companyId, data: { code: r.code, fields: changed } });
        if (changed.includes('base_uom')) syncConversions(actor.companyId, id);
        return { item: view(actor, itemRow(actor.companyId, id)), duplicates: p.dups };
      });
    },
    /** A new version from a date (FR-05, BR-01): the same code, the next version number, approved like a new item; on approval the old version is superseded the day before. */
    newVersion(actor, id, b) {
      const r = itemRow(actor.companyId, id);
      const cat = catRow(actor.companyId, r.category_id);
      if (!isSteward(actor, cat)) throw forbidden(`Only a steward of ${cat.name} (${cat.steward_role}) makes a new version of its items.`);
      if (r.item_status !== 'ACTIVE') throw conflict('Only the version in force gets a new version.');
      if (db.prepare("SELECT 1 FROM mdm_items WHERE company_id = ? AND code = ? AND item_status = 'SUBMITTED'").get(actor.companyId, r.code)) throw conflict(`A new version of ${r.code} is already waiting for approval.`);
      const from = b.effectiveFrom ?? todayIST();
      if (from < todayIST() || from <= r.effective_from) throw badRequest('A new version applies from today or a later date, after the current one.', [{ field: 'effectiveFrom', message: 'choose a later date' }]);
      const p = prepare(actor, { ...view({ ...actor, roles: ['SYSADM'] }, r), standardRate: money(r.standard_amount), ...defined(b), categoryId: r.category_id, itemType: r.item_type }, { existing: r });
      return transaction(db, () => {
        const nid = insertItem(actor, p.data, { code: r.code, version_no: r.version_no + 1, item_status: 'SUBMITTED', effective_from: from, supersedes_id: r.id, legacy_code: r.legacy_code, source_type: 'mdm_item_version', source_id: String(r.id) });
        for (const u of uomsOf(r.id)) if (u.uom !== p.data.base_uom) db.prepare("INSERT INTO mdm_item_uoms (company_id, item_id, uom, factor_to_base, purpose, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'mdm_item_version')").run(actor.companyId, nid, u.uom, u.factorToBase, u.purpose, actor.user);
        for (const x of db.prepare('SELECT * FROM mdm_item_resources WHERE parent_item_id = ? AND deleted_at IS NULL').all(r.id)) db.prepare("INSERT INTO mdm_item_resources (company_id, parent_item_id, component_item_id, qty_per_unit, uom, wastage_pct, sort_order, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'mdm_item_version')").run(actor.companyId, nid, x.component_item_id, x.qty_per_unit, x.uom, x.wastage_pct, x.sort_order, actor.user);
        const inst = submit(actor, nid, cat, { item_type: r.item_type, version_no: r.version_no + 1 }, b.justification);
        writeAudit(db, { entity: 'mdm_items', entityId: nid, action: 'new_version', newValues: { code: r.code, version: r.version_no + 1, from }, actor: actor.user, companyId: actor.companyId, reason: b.justification });
        return { item: view(actor, itemRow(actor.companyId, nid)), workflow: inst };
      });
    },
    /** Out of use (or back in use), by a steward; it stays in every old record. */
    setStatus(actor, id, { status, reason, version }) {
      const r = itemRow(actor.companyId, id);
      const cat = catRow(actor.companyId, r.category_id);
      if (!isSteward(actor, cat)) throw forbidden(`Only a steward of ${cat.name} (${cat.steward_role}) changes its items.`);
      if (r.version !== version) throw conflict('This item was changed by someone else. Reload it and try again.');
      if (!(status === 'INACTIVE' ? r.item_status === 'ACTIVE' : r.item_status === 'INACTIVE')) throw conflict(`An item that is ${r.item_status.toLowerCase()} cannot become ${status.toLowerCase()}.`);
      if (status === 'INACTIVE') { const parents = db.prepare("SELECT p.code FROM mdm_item_resources x JOIN mdm_items p ON p.id = x.parent_item_id WHERE x.component_item_id = ? AND x.deleted_at IS NULL AND p.item_status = 'ACTIVE'").all(id); if (parents.length) throw unprocessable(`${r.code} is a resource of ${parents.map((x) => x.code).join(', ')}; replace it there first.`); }
      db.prepare('UPDATE mdm_items SET item_status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(status, actor.user, nowIso(), id);
      writeAudit(db, { entity: 'mdm_items', entityId: id, action: status.toLowerCase(), actor: actor.user, companyId: actor.companyId, reason });
      publishEvent(db, { type: 'mdm.item.changed', entity: 'mdm_item', entityId: id, actorId: actor.user, companyId: actor.companyId, data: { code: r.code, status } });
      return view(actor, itemRow(actor.companyId, id));
    },
    get(actor, id) {
      need(actor, 'mdm.record.view', 'see the item catalogue');
      const r = itemRow(actor.companyId, id);
      const cat = catRow(actor.companyId, r.category_id);
      const res = resourcesOf(actor, id);
      const versions = db.prepare('SELECT id, version_no, item_status, effective_from, effective_to, base_uom FROM mdm_items WHERE company_id = ? AND code = ? ORDER BY version_no DESC').all(actor.companyId, r.code).map((v) => ({ id: v.id, versionNo: v.version_no, status: v.item_status, effectiveFrom: v.effective_from, effectiveTo: v.effective_to, baseUom: v.base_uom }));
      const makes = db.prepare('SELECT * FROM mdm_item_makes WHERE item_id = ? AND deleted_at IS NULL ORDER BY approved DESC, make').all(id).map((m) => ({ id: m.id, make: m.make, model: m.model, approved: Boolean(m.approved), approvedBy: m.approved_by, approvedAt: m.approved_at, addedBy: m.created_by }));
      const alternates = db.prepare('SELECT i.id, i.code, i.name, i.item_status FROM mdm_item_alternates x JOIN mdm_items i ON i.id = x.alternate_item_id WHERE x.item_id = ? AND x.deleted_at IS NULL').all(id).map((a) => ({ id: a.id, code: a.code, name: a.name, status: a.item_status }));
      const used = whereUsed(actor, id);
      const prices = seesRates(actor) ? db.prepare("SELECT created_at, actor, old_values, new_values FROM core_audit_log WHERE entity = 'mdm_items' AND entity_id = ? AND (new_values LIKE '%standard_amount%' OR action = 'create') ORDER BY id DESC LIMIT 30").all(String(id))
        .map((a) => ({ at: a.created_at, by: a.actor, rate: json(a.new_values, {}).standard_amount != null ? money(json(a.new_values, {}).standard_amount) : null, before: json(a.old_values, {})?.standard_amount != null ? money(json(a.old_values, {}).standard_amount) : null })).filter((x) => x.rate != null) : [];
      const fav = Boolean(db.prepare("SELECT 1 FROM mdm_item_user_marks WHERE company_id = ? AND lower(user_ref) = lower(?) AND item_id = ? AND mark = 'FAVOURITE'").get(actor.companyId, actor.user, id));
      return { ...view(actor, r, cat), attributes: json(cat.attribute_template_json, []), uoms: uomsOf(id), resources: res, resourceCost: WITH_RESOURCES.has(r.item_type) ? resourceCost(actor, res) : null, versions, makes, alternates, whereUsed: used.rows,
        usedInTransactions: used.transactions, priceHistory: prices, favourite: fav, canEdit: isSteward(actor, cat) && r.item_status === 'ACTIVE', hasResources: WITH_RESOURCES.has(r.item_type) };
    },
    list(actor, f) {
      need(actor, 'mdm.record.view', 'see the item catalogue');
      ensureTree(actor.companyId);
      const where = ['i.company_id = ?', 'i.deleted_at IS NULL']; const args = [actor.companyId];
      if (f.status) { where.push('i.item_status = ?'); args.push(f.status); } else where.push("i.item_status IN ('ACTIVE', 'SUBMITTED', 'INACTIVE')");
      if (f.type) { where.push('i.item_type = ?'); args.push(f.type); }
      if (f.category) { const ids = descendants(actor.companyId, f.category); where.push(`i.category_id IN (${ids.map(() => '?').join(',')})`); args.push(...ids); }
      if (f.q) { where.push('(i.code LIKE ? OR i.search_text LIKE ?)'); args.push(`${f.q.toUpperCase()}%`, `%${f.q.toLowerCase()}%`); }
      const order = { code: 'i.code', name: 'i.name', changed: 'COALESCE(i.updated_at, i.created_at) DESC', rate: 'i.standard_amount DESC' }[f.sort] ?? 'i.code';
      const total = db.prepare(`SELECT COUNT(*) AS n FROM mdm_items i WHERE ${where.join(' AND ')}`).get(...args).n;
      const rows = db.prepare(`SELECT i.*, c.code AS c_code, c.name AS c_name, c.steward_role FROM mdm_items i JOIN mdm_item_categories c ON c.id = i.category_id WHERE ${where.join(' AND ')} ORDER BY ${order}, i.version_no DESC LIMIT ? OFFSET ?`).all(...args, f.limit, f.offset)
        .map((r) => view(actor, r, { id: r.category_id, code: r.c_code, name: r.c_name, steward_role: r.steward_role }));
      return { rows, total, canMigrate: may(actor, 'mdm.item.migrate') };
    },
    /** The selector (FR-06, T-03): active items in force, by code (prefix), name, specification or category text; favourites first when asked. */
    search(actor, f) {
      need(actor, 'mdm.record.view', 'see the item catalogue');
      const where = ["i.company_id = ?", "i.item_status = 'ACTIVE'", 'i.deleted_at IS NULL']; const args = [actor.companyId];
      if (f.type) { const ts = f.type.split(','); where.push(`i.item_type IN (${ts.map(() => '?').join(',')})`); args.push(...ts); }
      if (f.category) { ensureTree(actor.companyId); const ids = descendants(actor.companyId, f.category); where.push(`i.category_id IN (${ids.map(() => '?').join(',')})`); args.push(...ids); }
      if (f.q) { for (const word of f.q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 4)) { where.push('(i.code LIKE ? OR i.search_text LIKE ?)'); args.push(`${word.toUpperCase()}%`, `%${word}%`); } }
      if (f.only === 'favourites' || f.only === 'recent') { where.push(`EXISTS (SELECT 1 FROM mdm_item_user_marks m WHERE m.item_id = i.id AND m.company_id = i.company_id AND lower(m.user_ref) = lower(?) AND m.mark = ?)`); args.push(actor.user, f.only === 'favourites' ? 'FAVOURITE' : 'RECENT'); }
      const order = f.only === 'recent' ? "(SELECT MAX(m.used_at) FROM mdm_item_user_marks m WHERE m.item_id = i.id AND m.mark = 'RECENT' AND lower(m.user_ref) = lower(?)) DESC" : 'i.code';
      const rows = db.prepare(`SELECT i.id, i.code, i.name, i.name_hi, i.item_type, i.base_uom, i.spec_json, i.standard_amount, i.last_purchase_amount, i.category_id, i.hsn_sac_code, i.gst_code, c.name AS c_name FROM mdm_items i JOIN mdm_item_categories c ON c.id = i.category_id WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?`)
        .all(...args, ...(f.only === 'recent' ? [actor.user] : []), f.limit);
      const rates = seesRates(actor);
      const favs = new Set(db.prepare("SELECT item_id FROM mdm_item_user_marks WHERE company_id = ? AND lower(user_ref) = lower(?) AND mark = 'FAVOURITE'").all(actor.companyId, actor.user).map((x) => x.item_id));
      return { rows: rows.map((r) => ({ id: r.id, code: r.code, name: r.name, nameHi: r.name_hi, type: r.item_type, typeLabel: TYPE_LABELS[r.item_type], uom: r.base_uom, uoms: [r.base_uom, ...uomsOf(r.id).map((u) => u.uom)], category: r.c_name, spec: json(r.spec_json, {}), hsnSac: r.hsn_sac_code, gstRate: r.gst_code, standardRate: rates ? money(r.standard_amount) : null, lastRate: rates ? money(r.last_purchase_amount) : null, stock: null, favourite: favs.has(r.id) })), ratesMasked: !rates, stockShown: false };
    },
    /** The selector notes what a person picked (recent) and their favourites. */
    mark(actor, id, { mark, on }) {
      need(actor, 'mdm.record.view', 'see the item catalogue');
      itemRow(actor.companyId, id);
      if (on === false) db.prepare('DELETE FROM mdm_item_user_marks WHERE company_id = ? AND lower(user_ref) = lower(?) AND item_id = ? AND mark = ?').run(actor.companyId, actor.user, id, mark);
      else db.prepare("INSERT INTO mdm_item_user_marks (company_id, user_ref, item_id, mark, used_at, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'mdm_item_selector') ON CONFLICT (company_id, user_ref, item_id, mark) DO UPDATE SET used_at = excluded.used_at").run(actor.companyId, actor.user, id, mark, nowIso(), actor.user);
      if (mark === 'RECENT') db.prepare("DELETE FROM mdm_item_user_marks WHERE company_id = ? AND lower(user_ref) = lower(?) AND mark = 'RECENT' AND id NOT IN (SELECT id FROM mdm_item_user_marks WHERE company_id = ? AND lower(user_ref) = lower(?) AND mark = 'RECENT' ORDER BY used_at DESC LIMIT 20)").run(actor.companyId, actor.user, actor.companyId, actor.user);
      return { id, mark, on: on !== false };
    },
    whereUsed,
  };

  // ---- conversions (FR-03, T-01) ----
  function addUom(actor, id, baseUom, u) {
    const unit = uomOf(actor, u.uom);
    if (!unit) throw badRequest('Some fields are not valid.', [{ field: 'uoms', message: `${u.uom} is not a unit of measure (06.02)` }]);
    if (unit.code === baseUom) throw badRequest('Some fields are not valid.', [{ field: 'uoms', message: `${u.uom} is the base unit of the item` }]);
    if (!/^\d+(\.\d{1,9})?$/.test(String(u.factorToBase)) || dec(String(u.factorToBase)).isZero()) throw badRequest('Some fields are not valid.', [{ field: 'uoms', message: `1 ${u.uom} = how many ${baseUom}? A number more than 0` }]);
    db.prepare("INSERT INTO mdm_item_uoms (company_id, item_id, uom, factor_to_base, purpose, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'mdm_item')").run(actor.companyId, id, unit.code, String(u.factorToBase), u.purpose ?? 'ANY', actor.user);
  }
  /** The calculation engine converts with its own rows: an item's conversions are written there under the item code ("1 BAG = 50 KG" for that item). */
  function syncConversions(companyId, id) {
    const r = db.prepare('SELECT code, base_uom, item_status FROM mdm_items WHERE id = ?').get(id);
    if (r.item_status !== 'ACTIVE') return;
    const key = engineKey(companyId, r.code);
    db.prepare("UPDATE core_uom_conversions SET deleted_at = ?, deleted_by = 'mdm_items', is_active = 0 WHERE item_code = ? AND deleted_at IS NULL").run(nowIso(), key);
    for (const u of uomsOf(id)) db.prepare("INSERT INTO core_uom_conversions (company_id, item_code, from_uom, to_uom, factor, created_by, source_type) VALUES (?, ?, ?, ?, ?, 'system', 'mdm_item_uoms')").run(companyId, key, u.uom, r.base_uom, u.factorToBase);
  }
  const uoms = {
    save(actor, id, { uoms: list, version }) {
      const r = itemRow(actor.companyId, id);
      const cat = catRow(actor.companyId, r.category_id);
      if (!isSteward(actor, cat)) throw forbidden(`Only a steward of ${cat.name} (${cat.steward_role}) changes its items.`);
      if (r.version !== version) throw conflict('This item was changed by someone else. Reload it and try again.');
      if (!['ACTIVE', 'SUBMITTED'].includes(r.item_status)) throw conflict(`This item is ${r.item_status.toLowerCase()}.`);
      const seen = new Set(); for (const u of list) { if (seen.has(u.uom)) throw badRequest(`${u.uom} is listed twice.`, [{ field: 'uoms', message: `${u.uom} twice` }]); seen.add(u.uom); }
      return transaction(db, () => {
        const before = uomsOf(id);
        db.prepare('UPDATE mdm_item_uoms SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE item_id = ? AND deleted_at IS NULL').run(nowIso(), actor.user, id);
        for (const u of list) addUom(actor, id, r.base_uom, u);
        db.prepare('UPDATE mdm_items SET updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(actor.user, nowIso(), id);
        writeAudit(db, { entity: 'mdm_items', entityId: id, action: 'uoms', oldValues: { uoms: before }, newValues: { uoms: list }, actor: actor.user, companyId: actor.companyId });
        syncConversions(actor.companyId, id);
        return { uoms: uomsOf(id), rowVersion: itemRow(actor.companyId, id).version };
      });
    },
    /** A quantity of an item in another unit, through the calculation engine (T-01: bags of cement to tonnes). */
    convert(actor, id, { quantity, from, to }) {
      need(actor, 'mdm.record.view', 'see the item catalogue');
      const r = itemRow(actor.companyId, id);
      const engine = createUomService({ db });
      let out;
      try { out = engine.convert(quantity, from, to, { itemCode: engineKey(actor.companyId, r.code), scale: 3 }); } catch (e) { if (!r.legacy_code) throw e; out = engine.convert(quantity, from, to, { itemCode: r.code, scale: 3 }); }
      return { item: r.code, quantity, from, to, result: out.result, path: out.path };
    },
  };

  // ---- bills of resources (FR-04, BR-02) ----
  /** Would the parent appear among the components' own resources (a cycle)? */
  function cycle(parentId, componentIds) {
    const seen = new Set(); const stack = [...componentIds];
    while (stack.length) {
      const id = stack.pop();
      if (id === parentId) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const x of db.prepare('SELECT component_item_id AS c FROM mdm_item_resources WHERE parent_item_id = ? AND deleted_at IS NULL').all(id)) stack.push(x.c);
    }
    return false;
  }
  const resources = {
    save(actor, id, { lines, version, reason }) {
      const r = itemRow(actor.companyId, id);
      const cat = catRow(actor.companyId, r.category_id);
      if (!isSteward(actor, cat)) throw forbidden(`Only a steward of ${cat.name} (${cat.steward_role}) keeps its bills of resources.`);
      if (!WITH_RESOURCES.has(r.item_type)) throw unprocessable(`A ${TYPE_LABELS[r.item_type].toLowerCase()} has no bill of resources; only work items and composites have one.`);
      if (r.version !== version) throw conflict('This item was changed by someone else. Reload it and try again.');
      if (!['ACTIVE', 'SUBMITTED'].includes(r.item_status)) throw conflict(`This item is ${r.item_status.toLowerCase()}.`);
      const problems = [];
      const comps = lines.map((l, i) => {
        const c = db.prepare('SELECT * FROM mdm_items WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(l.componentId, actor.companyId);
        if (!c) { problems.push({ field: `lines.${i}.componentId`, message: 'is not an item of your company' }); return null; }
        if (c.item_status !== 'ACTIVE') problems.push({ field: `lines.${i}.componentId`, message: `${c.code} is ${c.item_status.toLowerCase()}` });
        const units = [c.base_uom, ...uomsOf(c.id).map((u) => u.uom)];
        if (!units.includes(l.uom)) problems.push({ field: `lines.${i}.uom`, message: `${c.code} is counted in ${units.join(', ')}` });
        return c;
      });
      if (comps.some((c) => c && c.id === id)) problems.push({ field: 'lines', message: 'An item is not a resource of itself' });
      if (!problems.length && cycle(id, comps.map((c) => c.id))) problems.push({ field: 'lines', message: `A component already uses ${r.code} in its own bill of resources: that would be a cycle (BR-02)` });
      if (problems.length) throw badRequest('Some lines are not valid.', problems);
      return transaction(db, () => {
        const before = resourcesOf(actor, id).map(({ code, quantity, uom, wastagePct }) => ({ code, quantity, uom, wastagePct }));
        db.prepare('UPDATE mdm_item_resources SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE parent_item_id = ? AND deleted_at IS NULL').run(nowIso(), actor.user, id);
        lines.forEach((l, i) => db.prepare("INSERT INTO mdm_item_resources (company_id, parent_item_id, component_item_id, qty_per_unit, uom, wastage_pct, sort_order, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'mdm_item_resources')")
          .run(actor.companyId, id, l.componentId, toUnits(l.quantity, 'quantity'), l.uom, toUnits(l.wastagePct ?? '0', 'percent'), (i + 1) * 10, actor.user));
        db.prepare('UPDATE mdm_items SET updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(actor.user, nowIso(), id);
        writeAudit(db, { entity: 'mdm_items', entityId: id, action: 'resources', oldValues: { lines: before }, newValues: { lines: lines.map((l, i) => ({ code: comps[i].code, quantity: l.quantity, uom: l.uom, wastagePct: l.wastagePct ?? '0' })) }, actor: actor.user, companyId: actor.companyId, reason: reason ?? null });
        publishEvent(db, { type: 'mdm.item.changed', entity: 'mdm_item', entityId: id, actorId: actor.user, companyId: actor.companyId, data: { code: r.code, fields: ['resources'] } });
        const res = resourcesOf(actor, id);
        return { resources: res, resourceCost: resourceCost(actor, res), rowVersion: itemRow(actor.companyId, id).version };
      });
    },
  };

  // ---- makes and alternates (FR-05) ----
  const makes = {
    add(actor, id, { make, model }) {
      const r = itemRow(actor.companyId, id);
      if (!isSteward(actor, catRow(actor.companyId, r.category_id)) && !may(actor, 'mdm.item.edit')) throw forbidden('Only a steward of items adds makes.');
      if (db.prepare('SELECT 1 FROM mdm_item_makes WHERE item_id = ? AND lower(make) = lower(?) AND lower(COALESCE(model, \'\')) = lower(?) AND deleted_at IS NULL').get(id, make, model ?? '')) throw conflict(`${make}${model ? ` ${model}` : ''} is already listed.`);
      const mid = Number(db.prepare("INSERT INTO mdm_item_makes (company_id, item_id, make, model, approved, created_by, source_type) VALUES (?, ?, ?, ?, 0, ?, 'mdm_item_makes')").run(actor.companyId, id, make, model ?? null, actor.user).lastInsertRowid);
      writeAudit(db, { entity: 'mdm_item_makes', entityId: mid, action: 'create', newValues: { item: r.code, make, model }, actor: actor.user, companyId: actor.companyId });
      return { id: mid };
    },
    /** A make on the approved list: a steward other than the person who proposed it. */
    decide(actor, id, makeId, { approved, reason }) {
      const r = itemRow(actor.companyId, id);
      if (!isSteward(actor, catRow(actor.companyId, r.category_id))) throw forbidden('Only a steward of the category approves makes.');
      const m = db.prepare('SELECT * FROM mdm_item_makes WHERE id = ? AND item_id = ? AND deleted_at IS NULL').get(makeId, id);
      if (!m) throw notFound('That make is not listed.');
      if (approved && m.created_by?.toLowerCase() === actor.user.toLowerCase()) throw forbidden('The person who proposed a make does not approve it.');
      if (approved) db.prepare('UPDATE mdm_item_makes SET approved = 1, approved_by = ?, approved_at = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(actor.user, nowIso(), nowIso(), makeId);
      else db.prepare('UPDATE mdm_item_makes SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, makeId);
      writeAudit(db, { entity: 'mdm_item_makes', entityId: makeId, action: approved ? 'approve' : 'remove', actor: actor.user, companyId: actor.companyId, reason: reason ?? null });
      return { id: makeId, approved };
    },
    alternate(actor, id, { alternateId, on }) {
      const r = itemRow(actor.companyId, id);
      if (!isSteward(actor, catRow(actor.companyId, r.category_id))) throw forbidden('Only a steward of the category names alternates.');
      const a = itemRow(actor.companyId, alternateId);
      if (a.id === r.id) throw badRequest('An item is not an alternate of itself.');
      if (on === false) db.prepare('UPDATE mdm_item_alternates SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE item_id = ? AND alternate_item_id = ? AND deleted_at IS NULL').run(nowIso(), actor.user, id, alternateId);
      else if (!db.prepare('SELECT 1 FROM mdm_item_alternates WHERE item_id = ? AND alternate_item_id = ? AND deleted_at IS NULL').get(id, alternateId)) db.prepare("INSERT INTO mdm_item_alternates (company_id, item_id, alternate_item_id, created_by, source_type) VALUES (?, ?, ?, ?, 'mdm_item_alternates')").run(actor.companyId, id, alternateId, actor.user);
      writeAudit(db, { entity: 'mdm_items', entityId: id, action: on === false ? 'alternate_removed' : 'alternate_added', newValues: { alternate: a.code }, actor: actor.user, companyId: actor.companyId });
      return { id, alternateId, on: on !== false };
    },
  };

  // ---- approval ----
  const tell = (r, decision, comment) => notif.notify({ companyId: r.company_id, templateCode: 'mdm.item.decided', recipients: [`user:${r.requested_by}`], data: { decision, code: r.code, name: r.name, comment: comment ? `: ${comment}` : '' }, link: `/admin/items/item?id=${r.id}`, sourceType: 'mdm_item', sourceId: String(r.id), eventKey: `mdm.item.decided:${r.id}:${decision}` });
  const decisions = {
    approved(instance, actor) {
      const r = db.prepare('SELECT * FROM mdm_items WHERE id = ?').get(Number(instance.docId));
      if (!r || r.item_status !== 'SUBMITTED') return;
      const now = nowIso();
      if (r.supersedes_id) db.prepare("UPDATE mdm_items SET item_status = 'SUPERSEDED', effective_to = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ? AND item_status IN ('ACTIVE', 'INACTIVE')").run(dayBefore(r.effective_from > todayIST() ? r.effective_from : todayIST()), actor.user, now, r.supersedes_id);
      db.prepare("UPDATE mdm_items SET item_status = 'ACTIVE', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, r.id);
      if (r.source_type?.startsWith('legacy:')) db.prepare('INSERT OR IGNORE INTO mdm_item_legacy_map (company_id, legacy_source, legacy_key, item_id, mapped_by, mapped_at, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(r.company_id, r.source_type.slice(7), r.source_id, r.id, r.requested_by, now, actor.user, 'mdm_item_migration');
      if (r.supersedes_id) db.prepare('UPDATE mdm_item_legacy_map SET item_id = ? WHERE item_id = ?').run(r.id, r.supersedes_id);
      syncConversions(r.company_id, r.id);
      writeAudit(db, { entity: 'mdm_items', entityId: r.id, action: 'approve', newValues: { code: r.code, version: r.version_no }, actor: actor.user, companyId: r.company_id });
      publishEvent(db, { type: 'mdm.item.approved', entity: 'mdm_item', entityId: r.id, actorId: actor.user, companyId: r.company_id, data: { code: r.code, version: r.version_no, type: r.item_type } });
      tell(r, 'approved');
    },
    ended(instance, actor, status, comment) {
      const r = db.prepare('SELECT * FROM mdm_items WHERE id = ?').get(Number(instance.docId));
      if (!r || r.item_status !== 'SUBMITTED') return;
      if (status !== 'RETURNED') db.prepare("UPDATE mdm_items SET item_status = 'REJECTED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), r.id);
      writeAudit(db, { entity: 'mdm_items', entityId: r.id, action: status.toLowerCase(), actor: actor.user, companyId: r.company_id, reason: comment ?? null });
      tell(r, status === 'RETURNED' ? 'returned for correction' : status.toLowerCase(), comment);
    },
  };

  // ---- migration of the free-text materials (FR-08) ----
  const migration = {
    /** The materials the system held before this part: item codes of the calculation engine's conversions and the lines of sample requests (description and unit), with what they map to. */
    candidates(actor) {
      need(actor, 'mdm.item.migrate', 'migrate the old materials');
      const mapped = new Map(db.prepare('SELECT m.legacy_source, m.legacy_key, i.id, i.code, i.name, i.item_status FROM mdm_item_legacy_map m JOIN mdm_items i ON i.id = m.item_id WHERE m.company_id = ? AND m.deleted_at IS NULL').all(actor.companyId).map((m) => [`${m.legacy_source}|${m.legacy_key}`, { id: m.id, code: m.code, name: m.name }]));
      const pending = new Map(db.prepare("SELECT id, code, source_type, source_id FROM mdm_items WHERE company_id = ? AND source_type LIKE 'legacy:%' AND item_status = 'SUBMITTED'").all(actor.companyId).map((p) => [`${p.source_type.slice(7)}|${p.source_id}`, { id: p.id, code: p.code }]));
      const rows = [];
      for (const c of db.prepare("SELECT item_code, GROUP_CONCAT(from_uom || '>' || to_uom || '=' || factor, '; ') AS conv FROM core_uom_conversions WHERE item_code IS NOT NULL AND item_code NOT LIKE '%@%' AND deleted_at IS NULL AND (source_type IS NULL OR source_type != 'mdm_item_uoms') AND (company_id IS NULL OR company_id = ?) GROUP BY item_code ORDER BY item_code").all(actor.companyId)) {
        const k = `conversion|${c.item_code}`;
        rows.push({ source: 'conversion', key: c.item_code, label: `Item code ${c.item_code}`, detail: c.conv, uses: 1, mappedTo: mapped.get(k) ?? null, pending: pending.get(k) ?? null, suggest: suggest(actor, c.item_code) });
      }
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ui_sample_request_lines'").get()) for (const l of db.prepare('SELECT description, uom, COUNT(*) AS n FROM ui_sample_request_lines WHERE company_id = ? AND deleted_at IS NULL GROUP BY lower(trim(description)), uom ORDER BY n DESC LIMIT 500').all(actor.companyId)) {
        const key = `${l.description.trim()}|${l.uom}`;
        const k = `sample-request-line|${key}`;
        rows.push({ source: 'sample-request-line', key, label: l.description.trim(), detail: `unit ${l.uom}`, uses: l.n, mappedTo: mapped.get(k) ?? null, pending: pending.get(k) ?? null, suggest: suggest(actor, l.description) });
      }
      return { rows, open: rows.filter((r) => !r.mappedTo && !r.pending).length };
    },
    /** Map an old material to an item that exists; the old records keep their text, the map links them (no reference is rewritten). */
    map(actor, { source, key, itemId }) {
      need(actor, 'mdm.item.migrate', 'migrate the old materials');
      const it = itemRow(actor.companyId, itemId);
      if (it.item_status !== 'ACTIVE') throw conflict(`${it.code} is ${it.item_status.toLowerCase()}; map to an item in force.`);
      if (db.prepare('SELECT 1 FROM mdm_item_legacy_map WHERE company_id = ? AND legacy_source = ? AND legacy_key = ? AND deleted_at IS NULL').get(actor.companyId, source, key)) throw conflict('This material is already mapped.');
      if (source === 'conversion' && it.code !== key) throw unprocessable(`The calculation engine finds conversions by item code: ${key} can only become an item with code ${key} (create it with "New item from this").`);
      db.prepare("INSERT INTO mdm_item_legacy_map (company_id, legacy_source, legacy_key, item_id, mapped_by, mapped_at, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, 'mdm_item_migration')").run(actor.companyId, source, key, itemId, actor.user, nowIso(), actor.user);
      writeAudit(db, { entity: 'mdm_item_legacy_map', entityId: itemId, action: 'map', newValues: { source, key, item: it.code }, actor: actor.user, companyId: actor.companyId });
      return { source, key, item: { id: it.id, code: it.code, name: it.name } };
    },
  };
  function suggest(actor, text) {
    const best = db.prepare("SELECT id, code, name FROM mdm_items WHERE company_id = ? AND item_status = 'ACTIVE' AND deleted_at IS NULL LIMIT 5000").all(actor.companyId).map((r) => ({ ...r, s: r.code === String(text).toUpperCase() ? 100 : similarity(text, r.name) })).filter((r) => r.s >= 70).sort((a, b) => b.s - a.s)[0];
    return best ? { id: best.id, code: best.code, name: best.name, score: best.s } : null;
  }

  // ---- the register (List Report) ----
  const presentRow = (actor) => (r) => ({ id: r.id, code: r.code, versionNo: r.version_no, name: r.name, type: r.item_type, typeLabel: TYPE_LABELS[r.item_type], category: r.c_name, categoryId: r.category_id, baseUom: r.base_uom, hsnSac: r.hsn_sac_code, gstRate: r.gst_code, status: r.item_status, stockTracked: r.stock_tracked ? 'YES' : 'NO', standardRate: seesRates(actor) ? money(r.standard_amount) : undefined, updatedAt: r.updated_at ?? r.created_at });
  const scope = (actor) => ({ scopeSql: "i.company_id = :c AND i.item_status IN ('SUBMITTED', 'ACTIVE', 'INACTIVE', 'SUPERSEDED', 'REJECTED')", params: { c: actor.companyId } });
  const listReq = (actor, query) => {
    const req = parseListRequest(itemList, query);
    if (!seesRates(actor) && (req.sort.some((x) => x.key === 'standardRate') || req.filters.some((x) => x.key === 'standardRate'))) throw badRequest('Some list parameters are invalid.', [{ field: 'standardRate', message: 'The rate is hidden for your role, so it cannot be sorted or filtered.' }]);
    return req;
  };
  const register = {
    list(actor, query) { need(actor, 'mdm.record.view', 'see the item catalogue'); ensureTree(actor.companyId); return runList(db, itemList, listReq(actor, query), { select: 'i.*, c.name AS c_name', ...scope(actor), tieBreaker: 'i.id', map: presentRow(actor) }); },
    exportSource(actor, req) {
      need(actor, 'mdm.record.view', 'see the item catalogue');
      const cols = Object.entries(itemList.columns).filter(([k]) => k !== 'categoryId' && (k !== 'standardRate' || seesRates(actor))).map(([key, c]) => ({ key, label: c.label, type: c.type === 'enum' ? 'text' : c.type }));
      return { title: itemList.label, permission: 'mdm.record.view', personal: false, columns: cols, count: () => countList(db, itemList, req, scope(actor)),
        rows: () => runList(db, itemList, req, { select: 'i.*, c.name AS c_name', ...scope(actor), tieBreaker: 'i.id', limit: null, map: (r) => { const x = presentRow(actor)(r); return { ...x, type: x.typeLabel }; } }).data,
        describe: (r) => [r.q ? `search "${r.q}"` : '', ...r.filters.map((x) => `${itemList.columns[x.key].label} ${x.op} ${x.raw}`)].filter(Boolean).join('; ') };
    },
  };

  return { categories, items, uoms, resources, makes, decisions, migration, register, ensureTree, specKey, seesRates };
}

const services = new WeakMap();
export const bindItems = (db, s) => services.set(db, s);
export const itemsOf = (db) => services.get(db) ?? null;

const step = (code, name, role) => ({ code, name, type: 'approval', mode: 'single', approvers: [{ kind: 'role', role }], slaHours: 48, requireAttachment: false, checklist: [], when: { field: 'stewardRole', op: 'eq', value: role }, notify: [], action: null });
workflowTypes.register({
  docType: ITEM_DOC, label: 'New item or item version', processOwner: 'PROCMGR', route: (id) => `/admin/items/item?id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT code, version_no, name, requested_by FROM mdm_items WHERE id = ? AND company_id = ?').get(Number(id), companyId); return r ? { ref: `${r.code}${r.version_no > 1 ? ` v${r.version_no}` : ''}`, title: r.name, originator: r.requested_by } : null; },
  summarise(db, _actor, id) {
    const r = db.prepare('SELECT i.*, c.name AS c_name FROM mdm_items i JOIN mdm_item_categories c ON c.id = i.category_id WHERE i.id = ?').get(Number(id));
    if (!r) return null;
    return { fields: [{ label: 'Item', value: `${r.code} ${r.name}` }, { label: 'Type', value: TYPE_LABELS[r.item_type] }, { label: 'Category', value: r.c_name }, { label: 'Base unit', value: r.base_uom }, { label: 'HSN/SAC', value: r.hsn_sac_code ?? '' }, { label: 'Version', value: r.version_no }, { label: 'Applies from', value: r.effective_from }],
      lines: { columns: [{ key: 'k', label: 'Specification' }, { key: 'v', label: 'Value' }], rows: Object.entries(json(r.spec_json, {})).map(([k, v]) => ({ k, v: String(v) })) } };
  },
  defaultDefinition: { name: 'Item approval by the category steward', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('PROCMGR', 'Procurement manager (materials, services)', 'PROCMGR'), step('STOREMGR', 'Stores manager (consumables, spares, tools)', 'STOREMGR'), step('EST', 'Estimator (labour, work items)', 'EST'), step('PLANTMGR', 'Plant manager (equipment classes)', 'PLANTMGR')] },
  hooks: {
    onApproved: (db, { instance, actor }) => itemsOf(db)?.decisions.approved(instance, actor),
    onRejected: (db, { instance, actor, comment }) => itemsOf(db)?.decisions.ended(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => itemsOf(db)?.decisions.ended(instance, actor, 'RETURNED', comment),
    onCancelled: (db, { instance, actor, comment }) => itemsOf(db)?.decisions.ended(instance, actor, 'CANCELLED', comment),
  },
});
evidenceProviders.register(ITEM_DOC, ({ db, instance }) => {
  const r = db.prepare('SELECT * FROM mdm_items WHERE id = ?').get(Number(instance.docId));
  if (!r) return { sections: [] };
  const same = db.prepare("SELECT code, name FROM mdm_items WHERE company_id = ? AND category_id = ? AND spec_key = ? AND id != ? AND item_status IN ('ACTIVE', 'SUBMITTED') AND spec_key LIKE '%=%'").all(r.company_id, r.category_id, r.spec_key, r.id);
  return { sections: [{ code: 'mdm-item', title: 'What the steward checks', kind: 'metrics', items: [{ label: 'Items with the same specification', value: same.length ? same.map((x) => `${x.code} ${x.name}`).join('; ') : 'None', format: 'text', tone: same.length ? 'warn' : undefined }, { label: 'Migrated from', value: r.legacy_code ?? '—', format: 'text' }, { label: 'Replaces version', value: r.supersedes_id ? 'Yes, the version in force is superseded on approval' : 'No, a new item', format: 'text' }] }] };
});
objectTypes.register({
  type: 'mdm_item', label: 'Item', permission: 'mdm.record.view', route: (id) => `/admin/items/item?id=${id}`,
  access(db, actor, id) { if (!authzOf(db).check(actor, 'mdm.record.view').allowed) return null; const r = db.prepare('SELECT company_id, item_status FROM mdm_items WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); return r ? { companyId: r.company_id, projectId: null, siteId: null, status: r.item_status } : null; },
  auditEntities: (id) => [{ entity: 'mdm_items', id }],
  summary(db, actor, id) { const r = db.prepare('SELECT code, name, item_status FROM mdm_items WHERE id = ? AND company_id = ?').get(Number(id), actor.companyId); return r ? { label: `${r.code} ${r.name}`, status: r.item_status } : null; },
  search(db, actor, q, limit) { if (!authzOf(db).check(actor, 'mdm.record.view').allowed) return []; return db.prepare("SELECT id FROM mdm_items WHERE company_id = ? AND item_status = 'ACTIVE' AND deleted_at IS NULL AND (code LIKE ? OR search_text LIKE ?) ORDER BY code LIMIT ?").all(actor.companyId, `${q.toUpperCase()}%`, `%${q.toLowerCase()}%`, limit); },
});
fileEntities.register({
  entity: 'mdm_item', label: 'Item (data sheets, images)',
  resolve(db, actor, id) {
    const r = db.prepare('SELECT i.company_id, i.item_status, c.steward_role FROM mdm_items i JOIN mdm_item_categories c ON c.id = i.category_id WHERE i.id = ? AND i.company_id = ?').get(Number(id), actor.companyId);
    if (!r) return null;
    const a = authzOf(db);
    const roles = (Array.isArray(actor.roles) ? actor.roles : String(actor.roles ?? '').split(',')).map((x) => String(x).trim().toUpperCase());
    return { companyId: r.company_id, projectId: null, siteId: null, canView: a.check(actor, 'mdm.record.view').allowed, canEdit: a.check(actor, 'mdm.item.edit').allowed && roles.includes(r.steward_role), locked: false };
  },
});
// where used (BR-01): the lines of sample requests that name the item by its code (written by the selector), and the old lines mapped to it
itemReferences.register({
  code: 'sample-requests', label: 'Sample requests',
  find(db, companyId, item) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ui_sample_request_lines'").get()) return [];
    const keys = db.prepare("SELECT legacy_key FROM mdm_item_legacy_map WHERE company_id = ? AND item_id = ? AND legacy_source = 'sample-request-line' AND deleted_at IS NULL").all(companyId, item.id).map((m) => m.legacy_key);
    const rows = db.prepare(`SELECT r.id, r.doc_no, r.title, l.line_no, l.description, l.uom FROM ui_sample_request_lines l JOIN ui_sample_requests r ON r.id = l.request_id WHERE l.company_id = ? AND l.deleted_at IS NULL AND (l.description LIKE ? ${keys.length ? `OR (trim(l.description) || '|' || l.uom) IN (${keys.map(() => '?').join(',')})` : ''}) LIMIT 200`).all(companyId, `${item.code} %`, ...keys);
    return rows.map((x) => ({ label: `${x.doc_no ?? `Request ${x.id}`} line ${x.line_no}: ${x.description}`, route: `/admin/sample-requests?open=${x.id}`, transaction: true }));
  },
});
