import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { calcOf } from '../../platform/calc/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { HttpError, badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { objectTypes } from '../../platform/objects/index.js';
import { evidenceProviders, workflowOf, workflowTypes } from '../../platform/workflow/index.js';
import { dec } from '../../../shared/decimal.js';
import { fromUnits, toUnits } from '../../../shared/money.js';
import { todayIST } from '../../../shared/dates.js';

// The rate analysis engine and the schedule of rates library (part 06.06). The resource rate library holds the rate of a material, labour trade, equipment or transport item by region, project and date
// with where it came from (FR-01); schedules of rates (CPWD DSR, state PWD, client SORs) are books in editions with their items (FR-02). A rate analysis prices a work item: its components (from the item's
// bill of resources, a template or typed in) with quantity per basis, wastage and a rate from the library, then water and electricity, overhead, profit, contingency, insurance, escalation and GST (FR-03,
// FR-04). Every amount comes from the calculation engine (formulas ra.line_amount and ra.unit_rate, BR-01) and is recomputed on the server at every save and submit. An analysis is released by approval
// (MDM_RATE_ANALYSIS: the director for the standard library, the project manager for a project, the commercial manager for a variation); a released version is never changed: a change is a new version
// (amendment) that supersedes it when approved (BR-02, FR-05). The impact report recomputes every analysis that uses an item at a new rate (FR-05, T-02); an analysis is compared with its SOR item (FR-06).
export const COMPONENT_TYPES = ['MATERIAL', 'LABOUR', 'EQUIPMENT', 'TRANSPORT', 'SUBCONTRACT', 'OTHER'];
export const PRICE_BASES = { QUOTATION: 'Quotation', MARKET_SURVEY: 'Market survey', DSR: 'DSR / SOR', LAST_PO: 'Last purchase order', OTHER: 'Other' };
export const AUTHORITIES = { CPWD: 'CPWD (DSR)', STATE_PWD: 'State PWD', CLIENT: 'Client', OTHER: 'Other' };
export const SCOPES = { STANDARD: 'Standard library', PROJECT: 'Project-specific', VARIATION: 'Variation' };
export const STATUS_LABELS = { DRAFT: 'Draft', SUBMITTED: 'In approval', RETURNED: 'Returned for correction', APPROVED: 'Released', REJECTED: 'Rejected', CANCELLED: 'Cancelled', SUPERSEDED: 'Superseded' };
export const ANALYSIS_DOC = 'MDM_RATE_ANALYSIS';
const PRICED = new Set(['WORK_ITEM', 'COMPOSITE', 'SUBCONTRACT']);
const TYPE_OF_ITEM = { MATERIAL: 'MATERIAL', CONSUMABLE: 'MATERIAL', SPARE: 'MATERIAL', TOOL: 'EQUIPMENT', RETURNABLE: 'EQUIPMENT', LABOUR: 'LABOUR', EQUIPMENT: 'EQUIPMENT', SERVICE: 'TRANSPORT', SUBCONTRACT: 'SUBCONTRACT', WORK_ITEM: 'SUBCONTRACT', COMPOSITE: 'MATERIAL' };
const ADDONS = [['water', 'water_pct', 'Water and electricity'], ['overhead', 'overhead_pct', 'Contractor\'s overhead'], ['profit', 'profit_pct', 'Profit'], ['contingency', 'contingency_pct', 'Contingency'], ['insurance', 'insurance_pct', 'Insurance'], ['escalation', 'escalation_pct', 'Escalation']];
const nowIso = () => new Date().toISOString();
const dayBefore = (d) => new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
const json = (s, d) => { try { return JSON.parse(s ?? ''); } catch { return d; } };
const trim = (s) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);
const num = (units, kind) => (units == null ? null : trim(fromUnits(units, kind).toFixed()));
const units = (v, kind) => toUnits(String(v ?? '0'), kind);

/**
 * Templates of standard analyses (FR-04) to start from: per basis quantity, components described by kind and name. A component is matched to an item of the company by its name (the first active item of
 * the right kind whose name contains the key word) and priced from the library; one that does not match stays a typed line for the estimator to complete. Quantities follow the usual CPWD analyses.
 */
export const TEMPLATES = [
  { code: 'CONCRETE_M25', name: 'Reinforced cement concrete M25 (1:1:2 nominal), per cum', basisQty: '1', basisUom: 'CUM', addons: { water: '1', overhead: '7.5', profit: '7.5' }, lines: [
    ['MATERIAL', 'cement', 'Cement', 'MT', '0.4', '2'], ['MATERIAL', 'sand', 'Coarse sand', 'CUM', '0.42', '5'], ['MATERIAL', 'aggregate', 'Coarse aggregate 20 mm', 'CUM', '0.84', '5'],
    ['LABOUR', 'mason', 'Mason', 'DAY', '0.17', '0'], ['LABOUR', 'beldar', 'Beldar / mazdoor', 'DAY', '2.5', '0'], ['EQUIPMENT', 'mixer', 'Concrete mixer with operator', 'DAY', '0.07', '0'], ['EQUIPMENT', 'vibrator', 'Needle vibrator', 'DAY', '0.07', '0']] },
  { code: 'CONCRETE_M20', name: 'Cement concrete M20 (1:1.5:3 nominal), per cum', basisQty: '1', basisUom: 'CUM', addons: { water: '1', overhead: '7.5', profit: '7.5' }, lines: [
    ['MATERIAL', 'cement', 'Cement', 'MT', '0.32', '2'], ['MATERIAL', 'sand', 'Coarse sand', 'CUM', '0.47', '5'], ['MATERIAL', 'aggregate', 'Coarse aggregate 20 mm', 'CUM', '0.94', '5'],
    ['LABOUR', 'mason', 'Mason', 'DAY', '0.17', '0'], ['LABOUR', 'beldar', 'Beldar / mazdoor', 'DAY', '2.5', '0'], ['EQUIPMENT', 'mixer', 'Concrete mixer with operator', 'DAY', '0.07', '0']] },
  { code: 'BRICKWORK', name: 'Brickwork in cement mortar 1:6, per cum', basisQty: '1', basisUom: 'CUM', addons: { water: '1', overhead: '7.5', profit: '7.5' }, lines: [
    ['MATERIAL', 'brick', 'Bricks', 'NOS', '500', '2'], ['MATERIAL', 'cement', 'Cement', 'MT', '0.06', '2'], ['MATERIAL', 'sand', 'Fine sand', 'CUM', '0.3', '5'],
    ['LABOUR', 'mason', 'Mason', 'DAY', '0.7', '0'], ['LABOUR', 'beldar', 'Beldar / mazdoor', 'DAY', '1.4', '0']] },
  { code: 'PLASTER_12', name: '12 mm cement plaster 1:6, per sqm', basisQty: '10', basisUom: 'SQM', addons: { water: '1', overhead: '7.5', profit: '7.5' }, lines: [
    ['MATERIAL', 'cement', 'Cement', 'MT', '0.0255', '2'], ['MATERIAL', 'sand', 'Fine sand', 'CUM', '0.15', '5'], ['LABOUR', 'mason', 'Mason', 'DAY', '1', '0'], ['LABOUR', 'beldar', 'Beldar / mazdoor', 'DAY', '1', '0']] },
  { code: 'REINFORCEMENT', name: 'Reinforcement steel cut, bent and placed, per MT', basisQty: '1', basisUom: 'MT', addons: { water: '0', overhead: '7.5', profit: '7.5' }, lines: [
    ['MATERIAL', 'steel', 'Reinforcement steel', 'MT', '1', '5'], ['MATERIAL', 'binding', 'Binding wire', 'KG', '10', '0'], ['LABOUR', 'fitter', 'Bar bender / fitter', 'DAY', '6', '0'], ['LABOUR', 'beldar', 'Beldar / mazdoor', 'DAY', '6', '0']] },
  { code: 'EARTHWORK', name: 'Earthwork in excavation by mechanical means, per cum', basisQty: '100', basisUom: 'CUM', addons: { water: '0', overhead: '7.5', profit: '7.5' }, lines: [
    ['EQUIPMENT', 'excavator', 'Hydraulic excavator with operator', 'HR', '3.5', '0'], ['EQUIPMENT', 'tipper', 'Tipper for disposal', 'HR', '4', '0'], ['LABOUR', 'beldar', 'Beldar / mazdoor', 'DAY', '2', '0']] },
];

/** Who uses the analyses (estimation, BOQ pricing, budgets, variations) asks: the released unit rate of a work item for a region or project on a date. Registered by the modules that store it. */
export function createRateService({ db }) {
  const authz = authzOf(db);
  const notif = notificationsOf(db);
  const calc = () => calcOf(db);
  const may = (actor, key) => authz.check(actor, key).allowed;
  const need = (actor, key, what) => { if (!may(actor, key)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const fail = (problems) => { if (problems.length) throw badRequest('Correct the highlighted fields', problems); };
  const itemOf = (companyId, id) => db.prepare('SELECT * FROM mdm_items WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, companyId);
  const unitsOf = (it) => [it.base_uom, ...db.prepare('SELECT uom FROM mdm_item_uoms WHERE item_id = ? AND deleted_at IS NULL').all(it.id).map((u) => u.uom)];
  const stateOk = (code) => !code || db.prepare("SELECT 1 FROM mdm_states WHERE code = ? AND row_status = 'ACTIVE' AND deleted_at IS NULL").get(code);
  const projectOk = (companyId, id) => !id || db.prepare('SELECT 1 FROM org_projects WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, companyId);
  /** A project-level record is seen by those whose grant covers its project; the standard library by everyone who holds the permission. */
  const seesProject = (actor, key, projectId) => projectId == null || authz.check(actor, key, { companyId: actor.companyId, projectId }).allowed;
  const scopeSql = (actor, key, col) => { const f = authz.scopeFilter(actor, key, { project: col }); return `(${col} IS NULL OR ${f.sql})`; };

  // ---- the resource rate library (FR-01) ----
  const rateView = (r) => ({ id: r.id, itemId: r.item_id, itemCode: r.code, itemName: r.name, itemType: r.item_type, region: r.region_code, projectId: r.project_id, project: r.project_name ?? null, rate: num(r.rate, 'rate'), uom: r.uom, basis: r.source_kind, basisLabel: PRICE_BASES[r.source_kind], basisRef: r.basis_ref, effectiveFrom: r.effective_from, effectiveTo: r.effective_to, status: r.entry_status, rowVersion: r.version, by: r.created_by, at: r.created_at });
  const RATE_SELECT = 'SELECT r.*, i.code, i.name, i.item_type, p.name AS project_name FROM ra_resource_rates r JOIN mdm_items i ON i.id = r.item_id LEFT JOIN org_projects p ON p.id = r.project_id';
  /**
   * The library rate of an item on a date: a rate for the project first, then one for the region, then one for everywhere; the latest that is in force. Null when the library has none.
   * @param {number} companyId @param {number} itemId @param {{ region?: string | null, projectId?: number | null, date?: string }} [where]
   */
  function rateFor(companyId, itemId, { region = null, projectId = null, date = todayIST() } = {}) {
    const r = db.prepare(`${RATE_SELECT} WHERE r.company_id = ? AND r.item_id = ? AND r.deleted_at IS NULL AND r.effective_from <= ? AND (r.effective_to IS NULL OR r.effective_to >= ?)
      AND ((r.project_id IS NOT NULL AND r.project_id = ?) OR (r.project_id IS NULL AND r.region_code IS NOT NULL AND r.region_code = ?) OR (r.project_id IS NULL AND r.region_code IS NULL))
      ORDER BY CASE WHEN r.project_id IS NOT NULL THEN 0 WHEN r.region_code IS NOT NULL THEN 1 ELSE 2 END, r.effective_from DESC, r.id DESC LIMIT 1`).get(companyId, itemId, date, date, projectId ?? -1, region ?? '');
    return r ? rateView(r) : null;
  }
  const library = {
    list(actor, { q, itemId, region, projectId, asOf, status, basis, limit = 50, offset = 0 } = /** @type {any} */ ({})) {
      need(actor, 'mdm.analyse.view', 'see the rate library');
      const where = ['r.company_id = ?', 'r.deleted_at IS NULL', scopeSql(actor, 'mdm.analyse.view', 'r.project_id')]; const args = [actor.companyId];
      if (q) { where.push('(i.code LIKE ? OR i.name LIKE ?)'); args.push(`${q}%`, `%${q}%`); }
      if (itemId) { where.push('r.item_id = ?'); args.push(itemId); }
      if (region) { where.push('r.region_code = ?'); args.push(region); }
      if (projectId) { where.push('r.project_id = ?'); args.push(projectId); }
      if (basis) { where.push('r.source_kind = ?'); args.push(basis); }
      if (asOf) { where.push('r.effective_from <= ? AND (r.effective_to IS NULL OR r.effective_to >= ?)'); args.push(asOf, asOf); }
      if (status) { where.push('r.entry_status = ?'); args.push(status); }
      const sql = `FROM ra_resource_rates r JOIN mdm_items i ON i.id = r.item_id LEFT JOIN org_projects p ON p.id = r.project_id WHERE ${where.join(' AND ')}`;
      const total = db.prepare(`SELECT COUNT(*) AS n ${sql}`).get(...args).n;
      const rows = db.prepare(`SELECT r.*, i.code, i.name, i.item_type, p.name AS project_name ${sql} ORDER BY i.code, r.region_code, r.effective_from DESC LIMIT ? OFFSET ?`).all(...args, limit, offset).map(rateView);
      return { rows, total, canEdit: may(actor, 'mdm.rate.edit'), bases: Object.entries(PRICE_BASES).map(([code, label]) => ({ code, label })) };
    },
    check(actor, b) {
      const p = [];
      const it = itemOf(actor.companyId, b.itemId);
      if (!it) p.push({ field: 'itemId', message: 'Choose an item of your company' });
      else {
        if (PRICED.has(it.item_type) && it.item_type !== 'SUBCONTRACT') p.push({ field: 'itemId', message: `${it.code} is a work item: its rate comes from a rate analysis, not the resource library` });
        if (!['ACTIVE', 'SUBMITTED'].includes(it.item_status)) p.push({ field: 'itemId', message: `${it.code} is ${it.item_status.toLowerCase()}` });
        if (!unitsOf(it).includes(b.uom)) p.push({ field: 'uom', message: `${it.code} is counted in ${unitsOf(it).join(', ')}` });
      }
      if (!stateOk(b.region)) p.push({ field: 'region', message: 'Choose a state of the states master' });
      if (!projectOk(actor.companyId, b.projectId)) p.push({ field: 'projectId', message: 'Choose a project of your company' });
      if (b.projectId && !seesProject(actor, 'mdm.rate.edit', b.projectId)) p.push({ field: 'projectId', message: 'The project is outside your assignments' });
      if (b.effectiveTo && b.effectiveTo < b.effectiveFrom) p.push({ field: 'effectiveTo', message: 'Ends before it starts' });
      return p;
    },
    /** A new rate from a date: the rate in force for the same item, region and project ends the day before (it is never changed, so analyses keep what they used). */
    create(actor, b) {
      need(actor, 'mdm.rate.edit', 'keep the rate library');
      fail(library.check(actor, b));
      const same = 'company_id = ? AND item_id = ? AND COALESCE(region_code, \'\') = ? AND COALESCE(project_id, 0) = ? AND deleted_at IS NULL';
      const sargs = [actor.companyId, b.itemId, b.region ?? '', b.projectId ?? 0];
      if (db.prepare(`SELECT 1 FROM ra_resource_rates WHERE ${same} AND effective_from = ? AND entry_status = 'ACTIVE'`).get(...sargs, b.effectiveFrom)) throw new HttpError(409, 'DUPLICATE', 'The library already has a rate of this item for this region and project from that date; retire it or use another date.');
      return transaction(db, () => {
        db.prepare(`UPDATE ra_resource_rates SET effective_to = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE ${same} AND entry_status = 'ACTIVE' AND effective_from < ? AND (effective_to IS NULL OR effective_to >= ?)`).run(dayBefore(b.effectiveFrom), actor.user, nowIso(), ...sargs, b.effectiveFrom, b.effectiveFrom);
        const id = Number(db.prepare("INSERT INTO ra_resource_rates (company_id, item_id, region_code, project_id, rate, uom, source_kind, basis_ref, effective_from, effective_to, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .run(actor.companyId, b.itemId, b.region ?? null, b.projectId ?? null, units(b.rate, 'rate'), b.uom, b.basis, b.basisRef ?? null, b.effectiveFrom, b.effectiveTo ?? null, actor.user, b.sourceType ?? 'ra_resource_rate', b.sourceId ?? null).lastInsertRowid);
        writeAudit(db, { entity: 'ra_resource_rates', entityId: id, action: 'create', newValues: { itemId: b.itemId, region: b.region ?? null, projectId: b.projectId ?? null, rate: b.rate, uom: b.uom, basis: b.basis, effectiveFrom: b.effectiveFrom }, actor: actor.user, companyId: actor.companyId });
        publishEvent(db, { type: 'mdm.resource_rate.changed', entity: 'ra_resource_rate', entityId: id, actorId: actor.user, companyId: actor.companyId, projectId: b.projectId ?? null, data: { itemId: b.itemId, region: b.region ?? null, rate: String(b.rate), effectiveFrom: b.effectiveFrom } });
        return rateView(db.prepare(`${RATE_SELECT} WHERE r.id = ?`).get(id));
      });
    },
    /** A rate no analysis has used may be corrected; one that was used is retired and a new one entered (what analyses used stays visible). */
    update(actor, id, b) {
      need(actor, 'mdm.rate.edit', 'keep the rate library');
      const r = db.prepare('SELECT * FROM ra_resource_rates WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId);
      if (!r || !seesProject(actor, 'mdm.analyse.view', r.project_id)) throw notFound('That rate does not exist.');
      if (r.version !== b.version) throw conflict('The rate was changed by someone else; reload it.');
      if (db.prepare('SELECT 1 FROM ra_analysis_lines WHERE resource_rate_id = ? AND deleted_at IS NULL').get(id)) throw unprocessable('An analysis used this rate: enter a new rate from a date instead of correcting it.');
      const next = { itemId: r.item_id, region: r.region_code, projectId: r.project_id, rate: num(r.rate, 'rate'), uom: r.uom, basis: r.source_kind, basisRef: r.basis_ref, effectiveFrom: r.effective_from, effectiveTo: r.effective_to, ...b };
      fail(library.check(actor, next));
      db.prepare('UPDATE ra_resource_rates SET rate = ?, uom = ?, source_kind = ?, basis_ref = ?, effective_to = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(units(next.rate, 'rate'), next.uom, next.basis, next.basisRef ?? null, next.effectiveTo ?? null, actor.user, nowIso(), id);
      writeAudit(db, { entity: 'ra_resource_rates', entityId: id, action: 'update', oldValues: rateView({ ...r, code: null, name: null }), newValues: b, reason: b.reason ?? null, actor: actor.user, companyId: actor.companyId });
      return rateView(db.prepare(`${RATE_SELECT} WHERE r.id = ?`).get(id));
    },
    retire(actor, id, { reason }) {
      need(actor, 'mdm.rate.edit', 'keep the rate library');
      const r = db.prepare('SELECT * FROM ra_resource_rates WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId);
      if (!r || !seesProject(actor, 'mdm.analyse.view', r.project_id)) throw notFound('That rate does not exist.');
      if (r.entry_status === 'RETIRED') throw unprocessable('The rate is already retired.');
      db.prepare("UPDATE ra_resource_rates SET entry_status = 'RETIRED', effective_to = COALESCE(effective_to, ?), updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(todayIST(), actor.user, nowIso(), id);
      writeAudit(db, { entity: 'ra_resource_rates', entityId: id, action: 'retire', reason, actor: actor.user, companyId: actor.companyId });
      return rateView(db.prepare(`${RATE_SELECT} WHERE r.id = ?`).get(id));
    },
    lookup: (actor, itemId, where) => { need(actor, 'mdm.analyse.view', 'see the rate library'); return rateFor(actor.companyId, itemId, where); },
  };

  // ---- schedules of rates (FR-02) ----
  const bookView = (b) => ({ id: b.id, code: b.code, edition: b.edition, name: b.name, authority: b.authority, authorityLabel: AUTHORITIES[b.authority], year: b.book_year, region: b.region_code, status: b.book_status, supersedesId: b.supersedes_id, items: db.prepare('SELECT COUNT(*) AS n FROM ra_sor_items WHERE book_id = ? AND deleted_at IS NULL').get(b.id).n, rowVersion: b.version, createdBy: b.created_by, createdAt: b.created_at });
  const sorItemView = (s) => ({ id: s.id, bookId: s.book_id, itemCode: s.item_code, parentCode: s.parent_code, description: s.description, uom: s.uom, rate: num(s.rate, 'rate'), book: s.book_code ? `${s.book_code} ${s.book_year}${s.edition > 1 ? ` (ed. ${s.edition})` : ''}` : undefined });
  const bookRow = (actor, id) => { const b = db.prepare('SELECT * FROM ra_sor_books WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId); if (!b) throw notFound('That schedule of rates does not exist.'); return b; };
  const sor = {
    books(actor) { need(actor, 'mdm.analyse.view', 'see the schedules of rates'); return { rows: db.prepare('SELECT * FROM ra_sor_books WHERE company_id = ? AND deleted_at IS NULL ORDER BY code, edition DESC').all(actor.companyId).map(bookView), canEdit: may(actor, 'mdm.rate.edit'), authorities: Object.entries(AUTHORITIES).map(([code, label]) => ({ code, label })) }; },
    book(actor, id, { q, limit = 100, offset = 0 } = /** @type {any} */ ({})) {
      need(actor, 'mdm.analyse.view', 'see the schedules of rates');
      const b = bookRow(actor, id);
      const where = ['book_id = ?', 'deleted_at IS NULL']; const args = [id];
      if (q) { where.push('(item_code LIKE ? OR description LIKE ?)'); args.push(`${q}%`, `%${q}%`); }
      const total = db.prepare(`SELECT COUNT(*) AS n FROM ra_sor_items WHERE ${where.join(' AND ')}`).get(...args).n;
      return { ...bookView(b), rows: db.prepare(`SELECT * FROM ra_sor_items WHERE ${where.join(' AND ')} ORDER BY sort_order, item_code LIMIT ? OFFSET ?`).all(...args, limit, offset).map(sorItemView), total, canEdit: may(actor, 'mdm.rate.edit') && b.book_status === 'DRAFT' };
    },
    createBook(actor, b) {
      need(actor, 'mdm.rate.edit', 'keep the schedules of rates');
      fail([...(stateOk(b.region) ? [] : [{ field: 'region', message: 'Choose a state of the states master' }])]);
      if (db.prepare('SELECT 1 FROM ra_sor_books WHERE company_id = ? AND code = ? AND deleted_at IS NULL').get(actor.companyId, b.code)) throw new HttpError(409, 'DUPLICATE', `A schedule ${b.code} exists; start a new edition of it instead.`);
      const id = Number(db.prepare("INSERT INTO ra_sor_books (company_id, code, edition, name, authority, book_year, region_code, created_by, source_type) VALUES (?, ?, 1, ?, ?, ?, ?, ?, 'ra_sor_book')").run(actor.companyId, b.code, b.name, b.authority, b.year, b.region ?? null, actor.user).lastInsertRowid);
      writeAudit(db, { entity: 'ra_sor_books', entityId: id, action: 'create', newValues: b, actor: actor.user, companyId: actor.companyId });
      return bookView(bookRow(actor, id));
    },
    /** Items are added to or replaced in a draft edition (typed, pasted or imported from Excel); an active edition is fixed. */
    putItems(actor, id, { items, replace = false }) {
      need(actor, 'mdm.rate.edit', 'keep the schedules of rates');
      const b = bookRow(actor, id);
      if (b.book_status !== 'DRAFT') throw unprocessable('Only a draft edition takes items; start a new edition to change an active schedule.');
      const seen = new Set(); const p = [];
      items.forEach((it, i) => { if (seen.has(it.itemCode)) p.push({ field: `items.${i}.itemCode`, message: `${it.itemCode} appears twice` }); seen.add(it.itemCode); });
      fail(p);
      return transaction(db, () => {
        const now = nowIso();
        if (replace) db.prepare('UPDATE ra_sor_items SET deleted_at = ?, deleted_by = ? WHERE book_id = ? AND deleted_at IS NULL').run(now, actor.user, id);
        let added = 0; let changed = 0;
        for (const [i, it] of items.entries()) {
          const ex = db.prepare('SELECT id FROM ra_sor_items WHERE book_id = ? AND item_code = ? AND deleted_at IS NULL').get(id, it.itemCode);
          if (ex) { db.prepare('UPDATE ra_sor_items SET description = ?, uom = ?, rate = ?, parent_code = ?, sort_order = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(it.description, it.uom ?? null, it.rate != null ? units(it.rate, 'rate') : null, it.parentCode ?? null, i, actor.user, now, ex.id); changed += 1; }
          else { db.prepare("INSERT INTO ra_sor_items (company_id, book_id, item_code, parent_code, description, uom, rate, sort_order, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ra_sor_item')").run(actor.companyId, id, it.itemCode, it.parentCode ?? null, it.description, it.uom ?? null, it.rate != null ? units(it.rate, 'rate') : null, i, actor.user); added += 1; }
        }
        writeAudit(db, { entity: 'ra_sor_books', entityId: id, action: 'items', newValues: { added, changed, replace }, actor: actor.user, companyId: actor.companyId });
        return { ...bookView(bookRow(actor, id)), added, changed };
      });
    },
    /** A draft edition comes into use; the edition it replaces is superseded (analyses linked to its items keep the link). */
    activate(actor, id, { reason }) {
      need(actor, 'mdm.rate.edit', 'keep the schedules of rates');
      const b = bookRow(actor, id);
      if (b.book_status !== 'DRAFT') throw unprocessable('Only a draft edition is put in use.');
      if (!db.prepare('SELECT 1 FROM ra_sor_items WHERE book_id = ? AND deleted_at IS NULL').get(id)) throw unprocessable('The edition has no items yet.');
      return transaction(db, () => {
        const now = nowIso();
        db.prepare("UPDATE ra_sor_books SET book_status = 'SUPERSEDED', updated_by = ?, updated_at = ?, version = version + 1 WHERE company_id = ? AND code = ? AND book_status = 'ACTIVE' AND id != ?").run(actor.user, now, actor.companyId, b.code, id);
        db.prepare("UPDATE ra_sor_books SET book_status = 'ACTIVE', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, id);
        writeAudit(db, { entity: 'ra_sor_books', entityId: id, action: 'activate', reason, actor: actor.user, companyId: actor.companyId });
        publishEvent(db, { type: 'mdm.sor.activated', entity: 'ra_sor_book', entityId: id, actorId: actor.user, companyId: actor.companyId, data: { code: b.code, edition: b.edition, year: b.book_year } });
        return bookView(bookRow(actor, id));
      });
    },
    /** A new edition (a new year of the DSR, a revised client SOR): a draft copy of the latest edition with its items, to change and then put in use (versioned, FR-02). */
    newEdition(actor, id, { year, name }) {
      need(actor, 'mdm.rate.edit', 'keep the schedules of rates');
      const b = bookRow(actor, id);
      if (db.prepare("SELECT 1 FROM ra_sor_books WHERE company_id = ? AND code = ? AND book_status = 'DRAFT' AND deleted_at IS NULL").get(actor.companyId, b.code)) throw new HttpError(409, 'DUPLICATE', `A draft edition of ${b.code} is already open.`);
      const edition = db.prepare('SELECT MAX(edition) AS e FROM ra_sor_books WHERE company_id = ? AND code = ?').get(actor.companyId, b.code).e + 1;
      return transaction(db, () => {
        const nid = Number(db.prepare("INSERT INTO ra_sor_books (company_id, code, edition, name, authority, book_year, region_code, supersedes_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ra_sor_book', ?)").run(actor.companyId, b.code, edition, name ?? b.name, b.authority, year ?? b.book_year, b.region_code, b.id, actor.user, String(b.id)).lastInsertRowid);
        db.prepare("INSERT INTO ra_sor_items (company_id, book_id, item_code, parent_code, description, uom, rate, sort_order, created_by, source_type, source_id) SELECT company_id, ?, item_code, parent_code, description, uom, rate, sort_order, ?, 'ra_sor_item', CAST(id AS TEXT) FROM ra_sor_items WHERE book_id = ? AND deleted_at IS NULL").run(nid, actor.user, b.id);
        writeAudit(db, { entity: 'ra_sor_books', entityId: nid, action: 'new_edition', newValues: { from: b.id, edition }, actor: actor.user, companyId: actor.companyId });
        return bookView(bookRow(actor, nid));
      });
    },
    search(actor, { q, limit = 20 }) {
      need(actor, 'mdm.analyse.view', 'see the schedules of rates');
      return { rows: db.prepare("SELECT s.*, b.code AS book_code, b.book_year, b.edition FROM ra_sor_items s JOIN ra_sor_books b ON b.id = s.book_id WHERE s.company_id = ? AND s.deleted_at IS NULL AND b.book_status = 'ACTIVE' AND (s.item_code LIKE ? OR s.description LIKE ?) ORDER BY b.code, s.sort_order LIMIT ?").all(actor.companyId, `${q ?? ''}%`, `%${q ?? ''}%`, limit).map(sorItemView) };
    },
  };

  // ---- the calculation (BR-01) ----
  const pct = (h, k) => num(h[k], 'percent');
  /**
   * Prices an analysis through the calculation engine: each component with ra.line_amount, then the add-ons with ra.unit_rate. Returns the amounts in minor units, the breakdown and the formula versions.
   * With `record` the traces are stored for "Show calculation".
   */
  function compute(companyId, head, lines, record = null) {
    const opt = (field) => (record ? { entity: 'ra_analysis', entityId: record.id, field, companyId, user: record.user, date: head.effective_from } : { date: head.effective_from, companyId });
    let direct = dec(0);
    let lineVersion = null;
    const priced = lines.map((l, i) => {
      const r = calc().evaluate('ra.line_amount', { quantity: num(l.qty_per_basis, 'quantity'), wastage_percent: num(l.wastage_pct, 'percent'), rate: num(l.rate, 'rate') }, opt(`line.${i + 1}`));
      lineVersion = r.formula.version;
      direct = direct.add(dec(r.result.amount));
      return { ...l, amount: units(r.result.amount, 'money') };
    });
    const u = calc().evaluate('ra.unit_rate', {
      direct_cost: direct.toFixed(2), basis_qty: num(head.basis_qty, 'quantity'), water_percent: pct(head, 'water_pct'), overhead_percent: pct(head, 'overhead_pct'), profit_percent: pct(head, 'profit_pct'),
      contingency_percent: pct(head, 'contingency_pct'), insurance_percent: pct(head, 'insurance_pct'), escalation_percent: pct(head, 'escalation_pct'), gst_percent: head.gst_treatment === 'ADDED' ? pct(head, 'gst_pct') : '0',
    }, opt('unit_rate'));
    const byType = {}; for (const l of priced) byType[l.component_type] = dec(byType[l.component_type] ?? 0).add(fromUnits(l.amount, 'money')).toFixed(2);
    return { lines: priced, direct: units(direct.toFixed(2), 'money'), unit: units(u.result.unit_rate, 'money'), gross: units(u.result.unit_rate_gross, 'money'), breakdown: { byType, ...u.result, direct_cost: direct.toFixed(2) }, formulas: { 'ra.line_amount': lineVersion ?? calc().resolve('ra.line_amount', { date: head.effective_from }).formula_version, 'ra.unit_rate': u.formula.version } };
  }

  // ---- analyses (FR-03 to FR-06) ----
  const aRow = (actor, id) => {
    const a = db.prepare('SELECT * FROM ra_analyses WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId);
    if (!a || !seesProject(actor, 'mdm.analyse.view', a.project_id)) throw notFound('That rate analysis does not exist.');
    return a;
  };
  const linesOf = (id) => db.prepare('SELECT l.*, i.code AS item_code FROM ra_analysis_lines l LEFT JOIN mdm_items i ON i.id = l.component_item_id WHERE l.analysis_id = ? AND l.deleted_at IS NULL ORDER BY l.line_no').all(id);
  const lineView = (l) => ({ id: l.id, lineNo: l.line_no, type: l.component_type, itemId: l.component_item_id, itemCode: l.item_code ?? null, description: l.description, uom: l.uom, qty: num(l.qty_per_basis, 'quantity'), wastagePct: num(l.wastage_pct, 'percent'), rate: num(l.rate, 'rate'), amount: num(l.amount, 'money'), priceOrigin: l.line_origin, resourceRateId: l.resource_rate_id });
  function sorCompare(a) {
    if (!a.sor_item_id) return null;
    const s = db.prepare('SELECT s.*, b.code AS book_code, b.book_year, b.edition FROM ra_sor_items s JOIN ra_sor_books b ON b.id = s.book_id WHERE s.id = ?').get(a.sor_item_id);
    if (!s) return null;
    const analysed = fromUnits(a.unit_rate, 'money');
    const sorRate = s.rate != null ? fromUnits(s.rate, 'rate') : null;
    const diff = sorRate && !sorRate.isZero() ? analysed.sub(sorRate).mul(100).div(sorRate, 4).round(2) : null;
    return { item: sorItemView(s), analysedRate: analysed.toFixed(2), sorRate: sorRate ? sorRate.round(2).toFixed(2) : null, difference: sorRate ? analysed.sub(sorRate).round(2).toFixed(2) : null, percent: diff ? diff.toFixed(2) : null, uomMatches: !s.uom || s.uom === a.basis_uom, position: diff == null ? null : diff.isNegative() ? 'below' : diff.isZero() ? 'equal' : 'above' };
  }
  const workItem = (id) => db.prepare('SELECT id, code, name, base_uom, item_type FROM mdm_items WHERE id = ?').get(id);
  function analysisView(actor, a, { full = false } = {}) {
    const wi = workItem(a.work_item_id);
    const base = {
      id: a.id, analysisNo: a.analysis_no, versionNo: a.version_no, ref: `${a.analysis_no}/v${a.version_no}`, title: a.title, scope: a.scope, scopeLabel: SCOPES[a.scope], projectId: a.project_id,
      project: a.project_id ? db.prepare('SELECT code, name FROM org_projects WHERE id = ?').get(a.project_id) ?? null : null, region: a.region_code, workItem: wi ? { id: wi.id, code: wi.code, name: wi.name, uom: wi.base_uom } : null,
      basisQty: num(a.basis_qty, 'quantity'), basisUom: a.basis_uom, directCost: num(a.direct_cost, 'money'), unitRate: num(a.unit_rate, 'money'), unitRateGross: num(a.unit_rate_gross, 'money'), gstTreatment: a.gst_treatment,
      status: a.analysis_status, statusLabel: STATUS_LABELS[a.analysis_status], effectiveFrom: a.effective_from, effectiveTo: a.effective_to, releasedBy: a.released_by, releasedAt: a.released_at, requestedBy: a.requested_by, rowVersion: a.version, instanceId: a.workflow_instance_id, templateCode: a.template_code,
    };
    if (!full) return base;
    const editable = ['DRAFT', 'RETURNED'].includes(a.analysis_status);
    const mine = a.requested_by === actor.user;
    const open = db.prepare("SELECT id, version_no FROM ra_analyses WHERE company_id = ? AND analysis_no = ? AND analysis_status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND id != ? AND deleted_at IS NULL").get(a.company_id, a.analysis_no, a.id);
    return {
      ...base,
      addons: Object.fromEntries([...ADDONS.map(([k, col]) => [k, num(a[col], 'percent')]), ['gst', num(a.gst_pct, 'percent')]]),
      lines: linesOf(a.id).map(lineView), breakdown: json(a.breakdown_json, {}), formulas: json(a.formulas_json, {}), calculatedAt: a.calculated_at,
      sor: sorCompare(a), versions: db.prepare('SELECT id, version_no, analysis_status, unit_rate, effective_from, effective_to, released_at FROM ra_analyses WHERE company_id = ? AND analysis_no = ? AND deleted_at IS NULL ORDER BY version_no DESC').all(a.company_id, a.analysis_no).map((v) => ({ id: v.id, versionNo: v.version_no, status: v.analysis_status, unitRate: num(v.unit_rate, 'money'), effectiveFrom: v.effective_from, effectiveTo: v.effective_to, releasedAt: v.released_at })),
      openAmendmentId: open?.id ?? null,
      can: {
        edit: editable && mine && may(actor, 'mdm.analyse.edit'), delete: a.analysis_status === 'DRAFT' && mine && may(actor, 'mdm.analyse.delete'), submit: editable && mine && may(actor, 'mdm.analyse.submit'),
        withdraw: a.analysis_status === 'SUBMITTED' && mine, cancel: ['SUBMITTED', 'RETURNED'].includes(a.analysis_status) && may(actor, 'mdm.analyse.cancel'),
        amend: a.analysis_status === 'APPROVED' && !open && may(actor, 'mdm.analyse.amend'), recalculate: editable && mine && may(actor, 'mdm.analyse.edit'), print: may(actor, 'mdm.analyse.print'), export: may(actor, 'mdm.analyse.export'),
      },
    };
  }
  /** Checks a header and its components and resolves each component's rate (the library's unless typed). */
  function prepare(actor, b, existing = null) {
    const p = [];
    const wi = itemOf(actor.companyId, b.workItemId);
    if (!wi) p.push({ field: 'workItemId', message: 'Choose a work item of your company' });
    else if (!PRICED.has(wi.item_type)) p.push({ field: 'workItemId', message: `${wi.code} is a ${wi.item_type.toLowerCase().replace('_', ' ')}: only work items, composites and subcontract items are analysed` });
    else if (wi.item_status !== 'ACTIVE') p.push({ field: 'workItemId', message: `${wi.code} is ${wi.item_status.toLowerCase()}` });
    if (b.scope === 'STANDARD' && b.projectId) p.push({ field: 'projectId', message: 'A standard analysis is for the whole company; choose Project-specific for a project' });
    if (b.scope !== 'STANDARD' && !b.projectId) p.push({ field: 'projectId', message: 'A project-specific analysis or a variation names its project' });
    if (!projectOk(actor.companyId, b.projectId)) p.push({ field: 'projectId', message: 'Choose a project of your company' });
    else if (b.projectId && !seesProject(actor, 'mdm.analyse.create', b.projectId)) p.push({ field: 'projectId', message: 'The project is outside your assignments' });
    if (!stateOk(b.region)) p.push({ field: 'region', message: 'Choose a state of the states master' });
    if (b.sorItemId && !db.prepare('SELECT 1 FROM ra_sor_items WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(b.sorItemId, actor.companyId)) p.push({ field: 'sorItemId', message: 'Choose an item of a schedule of rates' });
    if (existing && b.workItemId !== existing.work_item_id && existing.version_no > 1) p.push({ field: 'workItemId', message: 'An amendment prices the same work item' });
    const date = b.effectiveFrom ?? todayIST();
    const lines = (b.lines ?? []).map((l, i) => {
      let it = null;
      if (l.itemId) {
        it = itemOf(actor.companyId, l.itemId);
        if (!it) p.push({ field: `lines.${i}.itemId`, message: 'is not an item of your company' });
        else if (it.id === b.workItemId) p.push({ field: `lines.${i}.itemId`, message: 'A work item is not a component of itself' });
        else if (!unitsOf(it).includes(l.uom)) p.push({ field: `lines.${i}.uom`, message: `${it.code} is counted in ${unitsOf(it).join(', ')}` });
      }
      let rate = l.rate; let origin = 'MANUAL'; let rid = null;
      if (it && (l.rate === undefined || l.rate === null || l.rate === '')) {
        const lib = rateFor(actor.companyId, it.id, { region: b.region ?? null, projectId: b.projectId ?? null, date });
        if (!lib) p.push({ field: `lines.${i}.rate`, message: `The library has no rate of ${it.code} for this region on ${date}; type one or add it to the library` });
        else if (lib.uom !== l.uom) p.push({ field: `lines.${i}.rate`, message: `The library rate of ${it.code} is per ${lib.uom}; count the component in ${lib.uom}` });
        else { rate = lib.rate; origin = 'LIBRARY'; rid = lib.id; }
      } else if (rate === undefined || rate === null || rate === '') p.push({ field: `lines.${i}.rate`, message: 'Give the rate of a component that is not an item' });
      return { line_no: i + 1, component_type: l.type ?? (it ? TYPE_OF_ITEM[it.item_type] ?? 'OTHER' : 'OTHER'), component_item_id: it?.id ?? null, description: l.description || (it ? it.name : ''), uom: l.uom, qty_per_basis: units(l.qty, 'quantity'), wastage_pct: units(l.wastagePct ?? '0', 'percent'), rate: units(rate ?? '0', 'rate'), line_origin: origin, resource_rate_id: rid };
    });
    lines.forEach((l, i) => { if (!l.description) p.push({ field: `lines.${i}.description`, message: 'Describe the component' }); });
    fail(p);
    const head = { work_item_id: b.workItemId, title: b.title || wi.name, scope: b.scope, project_id: b.projectId ?? null, region_code: b.region ?? null, basis_qty: units(b.basisQty, 'quantity'), basis_uom: b.basisUom || wi.base_uom, gst_treatment: b.gstTreatment ?? 'EXCLUDED', gst_pct: units(b.addons?.gst ?? '0', 'percent'), sor_item_id: b.sorItemId ?? null, effective_from: date, template_code: b.templateCode ?? existing?.template_code ?? null };
    for (const [k, col] of ADDONS) head[col] = units(b.addons?.[k] ?? '0', 'percent');
    const out = compute(actor.companyId, head, lines);
    // a client that sends its own total must agree with the server (the server's figure is the one stored)
    if (b.unitRate != null && units(b.unitRate, 'money') !== out.unit) throw unprocessable(`The unit rate sent (${b.unitRate}) differs from the calculated ${num(out.unit, 'money')}; reload the analysis.`, [{ field: 'unitRate', message: `calculated ${num(out.unit, 'money')}` }]);
    return { head, out };
  }
  function writeLines(actor, id, lines) {
    const now = nowIso();
    db.prepare('UPDATE ra_analysis_lines SET deleted_at = ?, deleted_by = ? WHERE analysis_id = ? AND deleted_at IS NULL').run(now, actor.user, id);
    for (const l of lines) db.prepare("INSERT INTO ra_analysis_lines (company_id, analysis_id, line_no, component_type, component_item_id, description, uom, qty_per_basis, wastage_pct, rate, amount, line_origin, resource_rate_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ra_analysis')")
      .run(actor.companyId, id, l.line_no, l.component_type, l.component_item_id, l.description, l.uom, l.qty_per_basis, l.wastage_pct, l.rate, l.amount, l.line_origin, l.resource_rate_id, actor.user);
  }
  function saveTotals(actor, id, head, out) {
    // traces for "Show calculation" (core_calc_traces), against the saved record
    compute(actor.companyId, head, out.lines, { id, user: actor.user });
    db.prepare('UPDATE ra_analyses SET direct_cost = ?, unit_rate = ?, unit_rate_gross = ?, breakdown_json = ?, formulas_json = ?, calculated_at = ? WHERE id = ?').run(out.direct, out.unit, out.gross, JSON.stringify(out.breakdown), JSON.stringify(out.formulas), nowIso(), id);
  }
  const HEAD_COLS = ['work_item_id', 'title', 'scope', 'project_id', 'region_code', 'basis_qty', 'basis_uom', 'water_pct', 'overhead_pct', 'profit_pct', 'contingency_pct', 'insurance_pct', 'escalation_pct', 'gst_pct', 'gst_treatment', 'sor_item_id', 'effective_from', 'template_code'];
  function nextNo(companyId) {
    const n = db.prepare('SELECT COUNT(DISTINCT analysis_no) AS n FROM ra_analyses WHERE company_id = ?').get(companyId).n + 1;
    let k = n; let no = `RA-${String(k).padStart(5, '0')}`;
    while (db.prepare('SELECT 1 FROM ra_analyses WHERE company_id = ? AND analysis_no = ?').get(companyId, no)) { k += 1; no = `RA-${String(k).padStart(5, '0')}`; }
    return no;
  }
  const tell = (a, decision, comment) => notif.notify({ companyId: a.company_id, templateCode: 'mdm.analysis.decided', recipients: [`user:${a.requested_by}`], data: { ref: `${a.analysis_no}/v${a.version_no}`, title: a.title, decision, comment: comment ? `: ${comment}` : '' }, link: `/admin/rate-analyses/analysis?id=${a.id}`, sourceType: 'ra_analysis', sourceId: String(a.id), eventKey: `mdm.analysis.decided:${a.id}:${decision}:${Date.now()}` });
  const locked = (a) => { if (!['DRAFT', 'RETURNED'].includes(a.analysis_status)) throw new HttpError(409, 'LOCKED', a.analysis_status === 'APPROVED' || a.analysis_status === 'SUPERSEDED' ? `Version ${a.version_no} of ${a.analysis_no} is released and cannot be changed (BR-02); amend it to make a new version.` : `The analysis is ${STATUS_LABELS[a.analysis_status].toLowerCase()} and cannot be changed now.`); };

  const analyses = {
    list(actor, { q, status, scope, workItemId, projectId, current, limit = 50, offset = 0 } = /** @type {any} */ ({})) {
      need(actor, 'mdm.analyse.view', 'see rate analyses');
      const where = ['a.company_id = ?', 'a.deleted_at IS NULL', scopeSql(actor, 'mdm.analyse.view', 'a.project_id')]; const args = [actor.companyId];
      if (q) { where.push('(a.analysis_no LIKE ? OR a.title LIKE ? OR i.code LIKE ? OR i.name LIKE ?)'); args.push(`${q}%`, `%${q}%`, `${q}%`, `%${q}%`); }
      if (status) { where.push('a.analysis_status = ?'); args.push(status); }
      if (scope) { where.push('a.scope = ?'); args.push(scope); }
      if (workItemId) { where.push('a.work_item_id = ?'); args.push(workItemId); }
      if (projectId) { where.push('a.project_id = ?'); args.push(projectId); }
      if (current) where.push("a.version_no = (SELECT MAX(x.version_no) FROM ra_analyses x WHERE x.company_id = a.company_id AND x.analysis_no = a.analysis_no AND x.deleted_at IS NULL AND x.analysis_status NOT IN ('REJECTED', 'CANCELLED'))");
      const sql = `FROM ra_analyses a JOIN mdm_items i ON i.id = a.work_item_id WHERE ${where.join(' AND ')}`;
      const total = db.prepare(`SELECT COUNT(*) AS n ${sql}`).get(...args).n;
      const rows = db.prepare(`SELECT a.* ${sql} ORDER BY a.analysis_no DESC, a.version_no DESC LIMIT ? OFFSET ?`).all(...args, limit, offset).map((a) => analysisView(actor, a));
      return { rows, total, canCreate: may(actor, 'mdm.analyse.create'), canExport: may(actor, 'mdm.analyse.export'), templates: TEMPLATES.map((t) => ({ code: t.code, name: t.name })) };
    },
    get: (actor, id) => { need(actor, 'mdm.analyse.view', 'see rate analyses'); return analysisView(actor, aRow(actor, id), { full: true }); },
    /** The components of a new analysis from the work item's bill of resources (06.03) or a template, priced from the library: a starting point, not saved. */
    start(actor, { workItemId, templateCode, region, projectId, effectiveFrom }) {
      need(actor, 'mdm.analyse.create', 'create rate analyses');
      const date = effectiveFrom ?? todayIST();
      const priced = (it, extra) => { const lib = it ? rateFor(actor.companyId, it.id, { region, projectId, date }) : null; return { itemId: it?.id ?? null, itemCode: it?.code ?? null, rate: lib && lib.uom === extra.uom ? lib.rate : null, priceOrigin: lib && lib.uom === extra.uom ? 'LIBRARY' : 'MANUAL', ...extra }; };
      if (templateCode) {
        const t = TEMPLATES.find((x) => x.code === templateCode);
        if (!t) throw notFound('That template does not exist.');
        const find = (type, key) => db.prepare(`SELECT * FROM mdm_items WHERE company_id = ? AND item_status = 'ACTIVE' AND deleted_at IS NULL AND lower(name) LIKE ? AND item_type IN (${Object.entries(TYPE_OF_ITEM).filter(([, v]) => v === type).map(() => '?').join(',')}) ORDER BY code LIMIT 1`).get(actor.companyId, `%${key}%`, ...Object.entries(TYPE_OF_ITEM).filter(([, v]) => v === type).map(([k]) => k));
        return { templateCode: t.code, title: t.name, basisQty: t.basisQty, basisUom: t.basisUom, addons: { water: '0', overhead: '0', profit: '0', contingency: '0', insurance: '0', escalation: '0', gst: '0', ...t.addons }, lines: t.lines.map(([type, key, description, uom, qty, wastagePct]) => { const it = find(type, key); const usable = it && unitsOf(it).includes(uom) ? it : null; return priced(usable, { type, description: usable?.name ?? description, uom, qty, wastagePct }); }) };
      }
      const wi = itemOf(actor.companyId, workItemId);
      if (!wi) throw notFound('That work item does not exist.');
      const bor = db.prepare('SELECT r.*, i.code, i.name, i.item_type FROM mdm_item_resources r JOIN mdm_items i ON i.id = r.component_item_id WHERE r.parent_item_id = ? AND r.deleted_at IS NULL ORDER BY r.sort_order, r.id').all(wi.id);
      return { title: wi.name, basisQty: '1', basisUom: wi.base_uom, addons: { water: '1', overhead: '7.5', profit: '7.5', contingency: '0', insurance: '0', escalation: '0', gst: '0' }, lines: bor.map((r) => priced({ id: r.component_item_id, code: r.code }, { type: TYPE_OF_ITEM[r.item_type] ?? 'OTHER', description: r.name, uom: r.uom, qty: num(r.qty_per_unit, 'quantity'), wastagePct: num(r.wastage_pct, 'percent') })) };
    },
    create(actor, b) {
      need(actor, 'mdm.analyse.create', 'create rate analyses');
      const { head, out } = prepare(actor, b);
      return transaction(db, () => {
        const no = nextNo(actor.companyId);
        const id = Number(db.prepare(`INSERT INTO ra_analyses (company_id, analysis_no, version_no, ${HEAD_COLS.join(', ')}, requested_by, created_by, source_type) VALUES (?, ?, 1, ${HEAD_COLS.map(() => '?').join(', ')}, ?, ?, 'ra_analysis')`)
          .run(actor.companyId, no, ...HEAD_COLS.map((c) => head[c]), actor.user, actor.user).lastInsertRowid);
        writeLines(actor, id, out.lines);
        saveTotals(actor, id, head, out);
        writeAudit(db, { entity: 'ra_analyses', entityId: id, action: 'create', newValues: { analysisNo: no, workItemId: b.workItemId, scope: b.scope, unitRate: num(out.unit, 'money') }, actor: actor.user, companyId: actor.companyId });
        publishEvent(db, { type: 'mdm.analysis.created', entity: 'ra_analysis', entityId: id, actorId: actor.user, companyId: actor.companyId, projectId: head.project_id, data: { analysisNo: no, version: 1 } });
        const a = aRow(actor, id);
        return b.submit ? analyses.submit(actor, id, { comment: b.comment }) : analysisView(actor, a, { full: true });
      });
    },
    update(actor, id, b) {
      need(actor, 'mdm.analyse.edit', 'change rate analyses');
      const a = aRow(actor, id);
      locked(a);
      if (a.requested_by !== actor.user) throw forbidden(`Only ${a.requested_by}, who prepared this analysis, changes it.`);
      if (a.version !== b.version) throw conflict('The analysis was changed by someone else; reload it.');
      const { head, out } = prepare(actor, { ...b, workItemId: b.workItemId ?? a.work_item_id }, a);
      return transaction(db, () => {
        db.prepare(`UPDATE ra_analyses SET ${HEAD_COLS.map((c) => `${c} = ?`).join(', ')}, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(...HEAD_COLS.map((c) => head[c]), actor.user, nowIso(), id);
        writeLines(actor, id, out.lines);
        saveTotals(actor, id, head, out);
        writeAudit(db, { entity: 'ra_analyses', entityId: id, action: 'update', oldValues: { unitRate: num(a.unit_rate, 'money') }, newValues: { unitRate: num(out.unit, 'money') }, actor: actor.user, companyId: actor.companyId });
        return analysisView(actor, aRow(actor, id), { full: true });
      });
    },
    remove(actor, id, { reason }) {
      need(actor, 'mdm.analyse.delete', 'delete rate analyses');
      const a = aRow(actor, id);
      if (a.analysis_status !== 'DRAFT') throw new HttpError(409, 'LOCKED', 'Only a draft is deleted; cancel or amend the others.');
      if (a.requested_by !== actor.user) throw forbidden(`Only ${a.requested_by}, who prepared this analysis, deletes it.`);
      const now = nowIso();
      transaction(db, () => {
        db.prepare('UPDATE ra_analyses SET deleted_at = ?, deleted_by = ?, version = version + 1 WHERE id = ?').run(now, actor.user, id);
        db.prepare('UPDATE ra_analysis_lines SET deleted_at = ?, deleted_by = ? WHERE analysis_id = ? AND deleted_at IS NULL').run(now, actor.user, id);
        writeAudit(db, { entity: 'ra_analyses', entityId: id, action: 'delete', reason, actor: actor.user, companyId: actor.companyId });
      });
      return { id, deleted: true };
    },
    /** Rates refreshed from the library (lines priced from it) as of the analysis date, everything recomputed. A released version is not recalculated (BR-02). */
    recalculate(actor, id) {
      need(actor, 'mdm.analyse.edit', 'recalculate rate analyses');
      const a = aRow(actor, id);
      locked(a);
      if (a.requested_by !== actor.user) throw forbidden(`Only ${a.requested_by}, who prepared this analysis, recalculates it.`);
      const lines = linesOf(id).map((l) => ({ itemId: l.component_item_id, type: l.component_type, description: l.description, uom: l.uom, qty: num(l.qty_per_basis, 'quantity'), wastagePct: num(l.wastage_pct, 'percent'), ...(l.line_origin === 'LIBRARY' ? {} : { rate: num(l.rate, 'rate') }) }));
      return analyses.update(actor, id, { ...bodyOf(a), lines, version: a.version });
    },
    submit(actor, id, { comment } = /** @type {any} */ ({})) {
      need(actor, 'mdm.analyse.submit', 'submit rate analyses');
      const a = aRow(actor, id);
      locked(a);
      if (a.requested_by !== actor.user) throw forbidden(`Only ${a.requested_by}, who prepared this analysis, submits it.`);
      const lines = linesOf(id);
      if (!lines.length) throw unprocessable('An analysis needs at least one component.');
      // recomputed on the server at submit (the library may have moved for library-priced lines only when the estimator recalculates; the stored rates are what is approved)
      const head = Object.fromEntries(HEAD_COLS.map((c) => [c, a[c]]));
      const out = compute(a.company_id, head, lines);
      if (out.unit === 0) throw unprocessable('The unit rate is zero; give the components their rates.');
      return transaction(db, () => {
        saveTotals(actor, id, head, out);
        const ctx = { scope: a.scope, projectId: a.project_id };
        if (a.analysis_status === 'RETURNED') workflowOf(db).resubmit(actor, a.workflow_instance_id, { comment: comment ?? 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: ANALYSIS_DOC, docId: id, comment: comment ?? 'Rate analysis for release', context: ctx, amendsDocId: a.supersedes_id ?? null }); db.prepare('UPDATE ra_analyses SET workflow_instance_id = ? WHERE id = ?').run(inst?.id ?? null, id); }
        db.prepare("UPDATE ra_analyses SET analysis_status = 'SUBMITTED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), id);
        writeAudit(db, { entity: 'ra_analyses', entityId: id, action: 'submit', newValues: { unitRate: num(out.unit, 'money') }, reason: comment ?? null, actor: actor.user, companyId: actor.companyId });
        return analysisView(actor, aRow(actor, id), { full: true });
      });
    },
    withdraw(actor, id, { reason }) {
      const a = aRow(actor, id);
      if (a.analysis_status !== 'SUBMITTED') throw unprocessable('Only an analysis in approval is withdrawn.');
      if (a.requested_by !== actor.user) throw forbidden('Only the person who submitted it withdraws it.');
      workflowOf(db).withdraw(actor, a.workflow_instance_id, { comment: reason });
      return analysisView(actor, aRow(actor, id), { full: true });
    },
    cancel(actor, id, { reason }) {
      need(actor, 'mdm.analyse.cancel', 'cancel rate analyses');
      const a = aRow(actor, id);
      if (!['SUBMITTED', 'RETURNED'].includes(a.analysis_status)) throw unprocessable('Only an analysis in approval or returned is cancelled; delete a draft, amend a released one.');
      if (a.requested_by === actor.user) transaction(db, () => { workflowOf(db).abandon(actor.companyId, a.workflow_instance_id, actor.user, 'CANCELLED', reason); decisions.analysis({ docId: a.id, status: 'CANCELLED' }, actor, 'CANCELLED', reason); });
      else workflowOf(db).cancel(actor, a.workflow_instance_id, { reason });
      return analysisView(actor, aRow(actor, id), { full: true });
    },
    /** A released version is never changed (BR-02): an amendment is a new draft version with the same number and components, which supersedes it when approved. */
    amend(actor, id, { reason, effectiveFrom }) {
      need(actor, 'mdm.analyse.amend', 'amend rate analyses');
      const a = aRow(actor, id);
      if (a.analysis_status !== 'APPROVED') throw unprocessable('Only the released version is amended.');
      if (db.prepare("SELECT 1 FROM ra_analyses WHERE company_id = ? AND analysis_no = ? AND analysis_status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL").get(a.company_id, a.analysis_no)) throw new HttpError(409, 'PENDING_CHANGE', `An amendment of ${a.analysis_no} is already open.`);
      if (a.project_id && !seesProject(actor, 'mdm.analyse.amend', a.project_id)) throw forbidden('The project is outside your assignments.');
      // by default the new version starts today, or the day after the released one started when that is later
      const next = new Date(Date.parse(`${a.effective_from}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
      const from = effectiveFrom ?? (todayIST() > next ? todayIST() : next);
      if (from <= a.effective_from) throw badRequest('Correct the highlighted fields', [{ field: 'effectiveFrom', message: `The new version starts after ${a.effective_from}, when this one started` }]);
      return transaction(db, () => {
        const vno = db.prepare('SELECT MAX(version_no) AS v FROM ra_analyses WHERE company_id = ? AND analysis_no = ?').get(a.company_id, a.analysis_no).v + 1;
        const nid = Number(db.prepare(`INSERT INTO ra_analyses (company_id, analysis_no, version_no, ${HEAD_COLS.join(', ')}, supersedes_id, requested_by, created_by, source_type, source_id, remarks) VALUES (?, ?, ?, ${HEAD_COLS.map(() => '?').join(', ')}, ?, ?, ?, 'ra_analysis', ?, ?)`)
          .run(a.company_id, a.analysis_no, vno, ...HEAD_COLS.map((c) => (c === 'effective_from' ? from : a[c])), a.id, actor.user, actor.user, String(a.id), reason).lastInsertRowid);
        db.prepare("INSERT INTO ra_analysis_lines (company_id, analysis_id, line_no, component_type, component_item_id, description, uom, qty_per_basis, wastage_pct, rate, amount, line_origin, resource_rate_id, created_by, source_type) SELECT company_id, ?, line_no, component_type, component_item_id, description, uom, qty_per_basis, wastage_pct, rate, amount, line_origin, resource_rate_id, ?, 'ra_analysis' FROM ra_analysis_lines WHERE analysis_id = ? AND deleted_at IS NULL").run(nid, actor.user, a.id);
        const head = Object.fromEntries(HEAD_COLS.map((c) => [c, c === 'effective_from' ? from : a[c]]));
        saveTotals(actor, nid, head, compute(a.company_id, head, linesOf(nid)));
        writeAudit(db, { entity: 'ra_analyses', entityId: nid, action: 'amend', newValues: { from: a.id, versionNo: vno }, reason, actor: actor.user, companyId: actor.companyId });
        return analysisView(actor, aRow(actor, nid), { full: true });
      });
    },
    /** Two versions side by side (FR-05): header and add-ons, and each component with its quantity, rate and amount in both. */
    compare(actor, id, withId) {
      need(actor, 'mdm.analyse.view', 'see rate analyses');
      const a = aRow(actor, id); const b = aRow(actor, withId);
      if (a.analysis_no !== b.analysis_no) throw unprocessable('Compare two versions of the same analysis.');
      const key = (l) => (l.component_item_id ? `i${l.component_item_id}` : `d${l.description.toLowerCase()}`);
      const la = new Map(linesOf(a.id).map((l) => [key(l), lineView(l)])); const lb = new Map(linesOf(b.id).map((l) => [key(l), lineView(l)]));
      const keys = [...new Set([...la.keys(), ...lb.keys()])];
      const lines = keys.map((k) => { const x = la.get(k) ?? null; const y = lb.get(k) ?? null; return { description: (y ?? x).description, uom: (y ?? x).uom, from: x, to: y, change: !x ? 'added' : !y ? 'removed' : x.qty !== y.qty || x.rate !== y.rate || x.wastagePct !== y.wastagePct ? 'changed' : 'same', amountDelta: dec(y?.amount ?? 0).sub(dec(x?.amount ?? 0)).toFixed(2) }; });
      const va = analysisView(actor, a, { full: true }); const vb = analysisView(actor, b, { full: true });
      const header = [['unitRate', 'Unit rate'], ['directCost', 'Direct cost'], ['basisQty', 'Basis quantity'], ['effectiveFrom', 'From']].map(([k, l]) => ({ field: l, from: va[k], to: vb[k], changed: va[k] !== vb[k] }))
        .concat(Object.keys(va.addons).map((k) => ({ field: `${k} %`, from: va.addons[k], to: vb.addons[k], changed: va.addons[k] !== vb.addons[k] })));
      return { from: { id: a.id, ref: va.ref, status: a.analysis_status }, to: { id: b.id, ref: vb.ref, status: b.analysis_status }, header, lines, unitRateDelta: dec(vb.unitRate).sub(dec(va.unitRate)).toFixed(2) };
    },
    /**
     * What a resource rate change does (FR-05, T-02): every current analysis (the released version, or the open draft/amendment) that uses the item, recomputed through the engine with the new rate on the
     * lines of that item; old and new unit rate, difference and percentage. Without a new rate the library's rate in force is used. Nothing is saved.
     */
    impact(actor, { itemId, newRate, region, projectId }) {
      need(actor, 'mdm.analyse.view', 'see rate analyses');
      const it = itemOf(actor.companyId, itemId);
      if (!it) throw notFound('That item does not exist.');
      const rows = db.prepare(`SELECT DISTINCT a.* FROM ra_analyses a JOIN ra_analysis_lines l ON l.analysis_id = a.id AND l.deleted_at IS NULL WHERE a.company_id = ? AND a.deleted_at IS NULL AND l.component_item_id = ?
        AND a.analysis_status IN ('APPROVED', 'DRAFT', 'SUBMITTED', 'RETURNED') AND ${scopeSql(actor, 'mdm.analyse.view', 'a.project_id')} ${region ? 'AND a.region_code = ?' : ''} ${projectId ? 'AND a.project_id = ?' : ''} ORDER BY a.analysis_no, a.version_no`).all(actor.companyId, itemId, ...(region ? [region] : []), ...(projectId ? [projectId] : []));
      const out = [];
      for (const a of rows) {
        const lines = linesOf(a.id);
        const head = Object.fromEntries(HEAD_COLS.map((c) => [c, a[c]]));
        const rateNow = newRate != null ? String(newRate) : rateFor(a.company_id, itemId, { region: a.region_code, projectId: a.project_id, date: todayIST() })?.rate ?? null;
        if (rateNow == null) continue;
        const used = lines.filter((l) => l.component_item_id === itemId);
        const moved = lines.map((l) => (l.component_item_id === itemId ? { ...l, rate: units(rateNow, 'rate') } : l));
        const after = compute(a.company_id, head, moved);
        const before = fromUnits(a.unit_rate, 'money'); const nu = fromUnits(after.unit, 'money');
        out.push({ id: a.id, ref: `${a.analysis_no}/v${a.version_no}`, title: a.title, status: a.analysis_status, scope: a.scope, region: a.region_code, projectId: a.project_id, oldItemRate: num(used[0].rate, 'rate'), newItemRate: trim(dec(rateNow).toFixed(4)), quantity: used.reduce((s, l) => s.add(fromUnits(l.qty_per_basis, 'quantity')), dec(0)).toFixed(3), oldUnitRate: before.toFixed(2), newUnitRate: nu.toFixed(2), delta: nu.sub(before).toFixed(2), percent: before.isZero() ? null : nu.sub(before).mul(100).div(before, 4).round(2).toFixed(2) });
      }
      const totalDelta = out.reduce((s, r) => s.add(dec(r.delta)), dec(0));
      return { item: { id: it.id, code: it.code, name: it.name, uom: it.base_uom }, newRate: newRate != null ? String(newRate) : null, rows: out, count: out.length, totalDelta: totalDelta.toFixed(2), largest: out.reduce((m, r) => (m && !dec(m.percent ?? 0).abs().lt(dec(r.percent ?? 0).abs()) ? m : r), null) };
    },
    history(actor, id) {
      need(actor, 'mdm.analyse.view', 'see rate analyses');
      const a = aRow(actor, id);
      const ids = db.prepare('SELECT id, workflow_instance_id FROM ra_analyses WHERE company_id = ? AND analysis_no = ? ORDER BY version_no').all(a.company_id, a.analysis_no);
      const wf = ids.flatMap((v) => (v.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(v.workflow_instance_id).map((h) => ({ analysisId: v.id, ...h })) : []));
      const audit = db.prepare(`SELECT action, actor, reason, created_at AS at, entity_id FROM core_audit_log WHERE entity = 'ra_analyses' AND entity_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`).all(...ids.map((v) => String(v.id)));
      return { versions: analysisView(actor, a, { full: true }).versions, approvals: wf, audit: audit.map((x) => ({ analysisId: Number(x.entity_id), action: x.action, by: x.actor, reason: x.reason, at: x.at })) };
    },
    /** A printable page (HTML) of one version; printing is in the audit trail. */
    print(actor, id) {
      need(actor, 'mdm.analyse.print', 'print rate analyses');
      const v = analysisView(actor, aRow(actor, id), { full: true });
      writeAudit(db, { entity: 'ra_analyses', entityId: id, action: 'print', actor: actor.user, companyId: actor.companyId });
      const e = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
      const rows = v.lines.map((l) => `<tr><td>${l.lineNo}</td><td>${e(l.type)}</td><td>${e(l.itemCode ?? '')} ${e(l.description)}</td><td>${e(l.uom)}</td><td class="n">${e(l.qty)}</td><td class="n">${e(l.wastagePct)}</td><td class="n">${e(l.rate)}</td><td class="n">${e(l.amount)}</td></tr>`).join('');
      const add = ADDONS.map(([k, , label]) => `<tr><td colspan="7">${label} @ ${e(v.addons[k])}%</td><td class="n">${e(v.breakdown[k] ?? '0.00')}</td></tr>`).join('');
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${e(v.ref)} ${e(v.title)}</title><style>body{font:12px system-ui,sans-serif;margin:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:4px}.n{text-align:right}</style></head><body>
<h1>Rate analysis ${e(v.ref)}</h1><p>${e(v.title)} · ${e(v.workItem?.code)} · per ${e(v.basisQty)} ${e(v.basisUom)} · ${e(v.scopeLabel)}${v.region ? ` · ${e(v.region)}` : ''} · from ${e(v.effectiveFrom)} · ${e(v.statusLabel)}</p>
<table><thead><tr><th>#</th><th>Kind</th><th>Component</th><th>Unit</th><th>Qty</th><th>Wastage %</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${rows}<tr><th colspan="7">Direct cost</th><th class="n">${e(v.directCost)}</th></tr>${add}<tr><th colspan="7">Total for ${e(v.basisQty)} ${e(v.basisUom)}</th><th class="n">${e(v.breakdown.total)}</th></tr><tr><th colspan="7">Unit rate per ${e(v.basisUom)}</th><th class="n">${e(v.unitRate)}</th></tr>${v.gstTreatment === 'ADDED' ? `<tr><td colspan="7">GST @ ${e(v.addons.gst)}%</td><td class="n">${e(v.breakdown.gst)}</td></tr><tr><th colspan="7">Unit rate with GST</th><th class="n">${e(v.unitRateGross)}</th></tr>` : ''}</tbody></table>
${v.sor ? `<p>Schedule: ${e(v.sor.item.book)} item ${e(v.sor.item.itemCode)} at ${e(v.sor.sorRate)}; analysed rate ${e(v.sor.percent)}% ${e(v.sor.position)}.</p>` : ''}<p>Calculated with ra.line_amount v${e(v.formulas['ra.line_amount'])} and ra.unit_rate v${e(v.formulas['ra.unit_rate'])}${v.releasedBy ? `; released by ${e(v.releasedBy)} on ${e(v.releasedAt)}` : ''}.</p></body></html>`;
    },
    exportRows(actor, f) {
      need(actor, 'mdm.analyse.export', 'export rate analyses');
      const rows = analyses.list(actor, { ...f, limit: 50_000, offset: 0 }).rows;
      writeAudit(db, { entity: 'ra_analyses', entityId: 0, action: 'export', newValues: { rows: rows.length, filters: f }, actor: actor.user, companyId: actor.companyId });
      return rows.map((r) => ({ ref: r.ref, title: r.title, workItem: r.workItem ? `${r.workItem.code} ${r.workItem.name}` : '', scope: r.scopeLabel, project: r.project ? r.project.code : '', region: r.region ?? '', basis: `${r.basisQty} ${r.basisUom}`, directCost: r.directCost, unitRate: r.unitRate, unitRateGross: r.unitRateGross, status: r.statusLabel, from: r.effectiveFrom, to: r.effectiveTo ?? '' }));
    },
    /** The released unit rate of a work item on a date, for estimation, BOQ pricing, budgets and variations: the project's own first, then the region's, then the standard library's. */
    releasedRate(companyId, workItemId, { region = null, projectId = null, date = todayIST() } = {}) {
      const a = db.prepare(`SELECT * FROM ra_analyses WHERE company_id = ? AND work_item_id = ? AND deleted_at IS NULL AND analysis_status IN ('APPROVED', 'SUPERSEDED') AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)
        AND ((project_id IS NOT NULL AND project_id = ?) OR (project_id IS NULL AND region_code IS NOT NULL AND region_code = ?) OR (project_id IS NULL AND region_code IS NULL))
        ORDER BY CASE WHEN project_id IS NOT NULL THEN 0 WHEN region_code IS NOT NULL THEN 1 ELSE 2 END, effective_from DESC LIMIT 1`).get(companyId, workItemId, date, date, projectId ?? -1, region ?? '');
      return a ? { analysisId: a.id, ref: `${a.analysis_no}/v${a.version_no}`, unitRate: num(a.unit_rate, 'money'), unitRateGross: num(a.unit_rate_gross, 'money'), uom: a.basis_uom, basisQty: num(a.basis_qty, 'quantity'), effectiveFrom: a.effective_from } : null;
    },
  };
  const bodyOf = (a) => ({ workItemId: a.work_item_id, title: a.title, scope: a.scope, projectId: a.project_id, region: a.region_code, basisQty: num(a.basis_qty, 'quantity'), basisUom: a.basis_uom, gstTreatment: a.gst_treatment, sorItemId: a.sor_item_id, effectiveFrom: a.effective_from, addons: { ...Object.fromEntries(ADDONS.map(([k, col]) => [k, num(a[col], 'percent')])), gst: num(a.gst_pct, 'percent') } });

  const decisions = {
    analysis(instance, actor, outcome, comment) {
      const a = db.prepare('SELECT * FROM ra_analyses WHERE id = ?').get(Number(instance.docId));
      if (!a || !['SUBMITTED', 'RETURNED'].includes(a.analysis_status)) return;
      const now = nowIso();
      if (outcome === 'APPROVED') {
        // the version it amends ends the day before; the released version is locked from now on (BR-02)
        if (a.supersedes_id) db.prepare("UPDATE ra_analyses SET analysis_status = 'SUPERSEDED', effective_to = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ? AND analysis_status = 'APPROVED'").run(dayBefore(a.effective_from), actor.user, now, a.supersedes_id);
        db.prepare("UPDATE ra_analyses SET analysis_status = 'APPROVED', released_by = ?, released_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, actor.user, now, a.id);
        publishEvent(db, { type: 'mdm.analysis.released', entity: 'ra_analysis', entityId: a.id, actorId: actor.user, companyId: a.company_id, projectId: a.project_id, data: { analysisNo: a.analysis_no, version: a.version_no, workItemId: a.work_item_id, unitRate: num(a.unit_rate, 'money'), effectiveFrom: a.effective_from, supersedes: a.supersedes_id } });
      } else {
        const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN';
        const status = outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED';
        db.prepare('UPDATE ra_analyses SET analysis_status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(status, actor.user, now, a.id);
        if (withdrawn) db.prepare('UPDATE ra_analyses SET workflow_instance_id = NULL WHERE id = ?').run(a.id);
      }
      writeAudit(db, { entity: 'ra_analyses', entityId: a.id, action: outcome.toLowerCase(), reason: comment ?? null, actor: actor.user, companyId: a.company_id });
      tell(a, { APPROVED: 'released', REJECTED: 'rejected', RETURNED: 'returned for correction', CANCELLED: instance.status === 'WITHDRAWN' ? 'withdrawn' : 'cancelled' }[outcome], comment);
    },
  };

  return { library, sor, analyses, decisions, rateFor, compute, TEMPLATES };
}

const services = new WeakMap();
export const bindRates = (db, s) => services.set(db, s);
export const ratesOf = (db) => services.get(db) ?? null;

const step = (code, name, role, when = null) => ({ code, name, type: 'approval', mode: 'single', approvers: [{ kind: 'role', role }], slaHours: 48, requireAttachment: false, checklist: [], when, notify: [], action: null });
workflowTypes.register({
  docType: ANALYSIS_DOC, label: 'Rate analysis release', processOwner: 'EST', route: (id) => `/admin/rate-analyses/analysis?id=${id}`,
  describe(db, companyId, id) { const a = db.prepare('SELECT * FROM ra_analyses WHERE id = ? AND company_id = ?').get(Number(id), companyId); return a ? { ref: `${a.analysis_no}/v${a.version_no}`, title: a.title, originator: a.requested_by, projectId: a.project_id ?? null } : null; },
  summarise(db, _actor, id) {
    const a = db.prepare('SELECT a.*, i.code, i.name FROM ra_analyses a JOIN mdm_items i ON i.id = a.work_item_id WHERE a.id = ?').get(Number(id));
    if (!a) return null;
    const prev = a.supersedes_id ? db.prepare('SELECT unit_rate, version_no FROM ra_analyses WHERE id = ?').get(a.supersedes_id) : null;
    return { fields: [{ label: 'Analysis', value: `${a.analysis_no}/v${a.version_no} ${a.title}` }, { label: 'Work item', value: `${a.code} ${a.name}` }, { label: 'Scope', value: SCOPES[a.scope] }, { label: 'Unit rate', value: `${num(a.unit_rate, 'money')} per ${a.basis_uom}` }, ...(prev ? [{ label: `Version ${prev.version_no} rate`, value: num(prev.unit_rate, 'money') }] : []), { label: 'From', value: a.effective_from }] };
  },
  defaultDefinition: { name: 'Rate analysis: director (standard), project manager (project), commercial manager (variation)', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('DIR', 'Director (standard library)', 'DIR', { field: 'scope', op: 'eq', value: 'STANDARD' }), step('PM', 'Project manager (project-specific)', 'PM', { field: 'scope', op: 'eq', value: 'PROJECT' }), step('COMMGR', 'Commercial manager (variation)', 'COMMGR', { field: 'scope', op: 'eq', value: 'VARIATION' })] },
  hooks: {
    onApproved: (db, { instance, actor }) => ratesOf(db)?.decisions.analysis(instance, actor, 'APPROVED'),
    onRejected: (db, { instance, actor, comment }) => ratesOf(db)?.decisions.analysis(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => ratesOf(db)?.decisions.analysis(instance, actor, 'RETURNED', comment),
    onCancelled: (db, { instance, actor, comment }) => ratesOf(db)?.decisions.analysis(instance, actor, 'CANCELLED', comment),
  },
});
evidenceProviders.register(ANALYSIS_DOC, ({ db, instance }) => {
  const a = db.prepare('SELECT * FROM ra_analyses WHERE id = ?').get(Number(instance.docId));
  if (!a) return { sections: [] };
  const lines = db.prepare("SELECT line_origin, COUNT(*) AS n FROM ra_analysis_lines WHERE analysis_id = ? AND deleted_at IS NULL GROUP BY line_origin").all(a.id);
  const manual = lines.find((l) => l.line_origin === 'MANUAL')?.n ?? 0;
  const s = a.sor_item_id ? db.prepare('SELECT rate FROM ra_sor_items WHERE id = ?').get(a.sor_item_id) : null;
  const pctVs = s?.rate ? fromUnits(a.unit_rate, 'money').sub(fromUnits(s.rate, 'rate')).mul(100).div(fromUnits(s.rate, 'rate'), 4).round(2).toFixed(2) : null;
  return { sections: [{ code: 'ra-analysis', title: 'Before releasing', kind: 'metrics', items: [{ label: 'Components priced by hand (not from the library)', value: manual, format: 'text', tone: manual ? 'warn' : undefined }, { label: 'Against the schedule of rates', value: pctVs == null ? 'not linked' : `${pctVs}%`, format: 'text', tone: pctVs != null && Math.abs(Number(pctVs)) > 15 ? 'warn' : undefined }, { label: 'Calculated', value: a.calculated_at ?? '—', format: 'text' }] }] };
});
objectTypes.register({
  type: 'ra_analysis', label: 'Rate analysis', permission: 'mdm.analyse.view', route: (id) => `/admin/rate-analyses/analysis?id=${id}`,
  access(db, actor, id) { const r = db.prepare('SELECT company_id, project_id, analysis_status FROM ra_analyses WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!r) return null; const a = authzOf(db); const ok = r.project_id ? a.check(actor, 'mdm.analyse.view', { companyId: r.company_id, projectId: r.project_id }).allowed : a.check(actor, 'mdm.analyse.view').allowed; return ok ? { companyId: r.company_id, projectId: r.project_id, siteId: null, status: r.analysis_status } : null; },
  auditEntities: (id) => [{ entity: 'ra_analyses', id }],
  summary(db, actor, id) { const r = db.prepare('SELECT analysis_no, version_no, title, analysis_status FROM ra_analyses WHERE id = ? AND company_id = ?').get(Number(id), actor.companyId); return r ? { label: `${r.analysis_no}/v${r.version_no} ${r.title}`, status: r.analysis_status } : null; },
  search(db, actor, q, limit) { if (!authzOf(db).check(actor, 'mdm.analyse.view').allowed) return []; return db.prepare('SELECT id FROM ra_analyses WHERE company_id = ? AND deleted_at IS NULL AND project_id IS NULL AND (analysis_no LIKE ? OR title LIKE ?) ORDER BY analysis_no DESC LIMIT ?').all(actor.companyId, `${q}%`, `%${q}%`, limit); },
});
