import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { conflict, forbidden, notFound } from '../../platform/http/errors.js';
import { defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { parameterRegistry } from '../../platform/parameters/index.js';
import { todayIST } from '../../../shared/dates.js';
import { nowIso, rid } from './base.js';
import { rateBenchmarks } from './pr.js';

// Material rate intelligence (part 15.09). Every rate the company is quoted, awards, orders or contracts, and every market survey, is kept as an observation that is never changed: item, specification, region, date and the rate on a landed basis
// normalised to the base unit of measure (paise). From the observations the benchmark of an item (the median of the recent ones, outliers left out), its monthly trend and volatility, and the exposure of a project (remaining quantities at the current benchmark
// against the budget rate) are worked out. The benchmark feeds the comparative statement (15.04) and the purchase order variance control (15.05).
export const SOURCES = { QUOTATION: 'Vendor quotation', CS: 'Awarded in a comparative statement', PO: 'Purchase order', RATE_CONTRACT: 'Rate contract', SURVEY: 'Market survey' };
export const INDEX_SOURCES = { MANUAL: 'Entered', IMPORT: 'Uploaded file', EXTERNAL: 'External source' };
for (const [key, def, description, min, max] of [
  ['proc.rti.window_days', 180, 'FR-04: observations from this many days before the date asked for make up a benchmark.', 30, 1095], ['proc.rti.outlier_pct', 40, 'FR-02: a rate this many percent away from the median of earlier observations is marked as an outlier and left out of benchmarks.', 5, 500],
  ['proc.rti.min_obs', 5, 'FR-02, FR-04: observations needed before outliers are detected and before the comparative statement and purchase orders use the benchmark.', 1, 100],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType: 'integer', default: def, scopes: ['system', 'company'], description, min, max });

const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const median = (v) => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
/** Minimum, average, maximum, median and volatility (standard deviation over the mean, in percent with one decimal) of integer rates. */
export function statsOf(values) {
  if (!values.length) return { count: 0, min: null, avg: null, max: null, median: null, volatilityPct: null };
  const avg = values.reduce((a, b) => a + b, 0) / values.length; const sd = values.length > 1 ? Math.sqrt(values.reduce((s, x) => s + (x - avg) ** 2, 0) / (values.length - 1)) : 0;
  return { count: values.length, min: Math.min(...values), avg: Math.round(avg), max: Math.max(...values), median: median(values), volatilityPct: avg > 0 ? Math.round((sd / avg) * 1000) / 10 : null };
}
/** FR-02: the rate per base unit: a rate per unit of measure divided by what one unit is worth in base units. */
export const toBase = (rate, factor) => { const f = Number(factor); return Number.isFinite(f) && f > 0 ? Math.round(rate / f) : rate; };
/** An observation is an outlier when it is more than `pct` percent away from the median of the earlier ones, once there are `min` of them. */
export function outlierOf(history, value, { pct, min }) {
  if (history.length < min) return null; const m = median(history); if (!m) return null; const dev = Math.abs(value - m) / m * 100; return dev > pct ? `${Math.round(dev)}% away from the median of ${history.length} earlier observations` : null;
}

export const obsList = defineList({
  code: 'proc.rate_observations', label: 'Rate observations', permission: 'proc.rate_intel.view', from: 'rti_observations x JOIN mdm_items i ON i.id = x.item_id LEFT JOIN mdm_partners v ON v.id = x.vendor_id', where: 'x.deleted_at IS NULL', searchable: ['i.code', 'i.name', 'x.region_code', 'v.legal_name', 'v.trade_name'], defaultSort: '-date',
  columns: {
    item: { sql: 'i.name', type: 'text', label: 'Item' }, itemCode: { sql: 'i.code', type: 'text', label: 'Code' }, region: { sql: 'x.region_code', type: 'text', label: 'Region' }, date: { sql: 'x.obs_date', type: 'date', label: 'Date' },
    source: { sql: 'x.source_type', type: 'enum', label: 'Source', options: Object.entries(SOURCES) }, vendor: { sql: 'COALESCE(v.trade_name, v.legal_name)', type: 'text', label: 'Vendor' }, rate: { sql: 'x.base_landed_rate', type: 'number', label: 'Landed rate per base unit' },
    outlier: { sql: "CASE WHEN x.is_outlier = 1 THEN 'YES' ELSE 'NO' END", type: 'enum', label: 'Outlier', options: [['YES', 'Yes'], ['NO', 'No']] },
  },
});

export function createRtiService({ db, base }) {
  const { authz, param, may, need, fail, audit } = base;
  const pn = (companyId, key) => Number(param(companyId, key) ?? 0);
  const sysActor = (companyId) => ({ user: 'system', companyId, roles: ['SYSTEM'] });
  const item = (companyId, id) => db.prepare('SELECT id, code, name, base_uom, category_id FROM mdm_items WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), companyId);
  const factor = (itemId, uom, baseUom) => { if (!uom || uom.toLowerCase() === String(baseUom).toLowerCase()) return 1; const f = db.prepare('SELECT factor_to_base FROM mdm_item_uoms WHERE item_id = ? AND uom = ? COLLATE NOCASE AND deleted_at IS NULL').get(itemId, uom); return f ? Number(f.factor_to_base) : 1; };
  const scope = (actor, key) => { if (!authz.check(actor, key).allowed) throw forbidden(`You may not do that (permission ${key}).`); return { sql: 'x.company_id = :c', params: { c: actor.companyId } }; };
  /** The observations that count: not an outlier and not replaced by a correction. */
  const LIVE = "x.is_outlier = 0 AND x.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM rti_observations c WHERE c.supersedes_id = x.id)";

  // ---- the append-only history (FR-01, FR-02, BR-01) --------------------------------------------------------------------------------------------------------------------------------------------------------------
  function insert(companyId, user, o) {
    const it = item(companyId, o.itemId); if (!it) return null; if (db.prepare('SELECT 1 FROM rti_observations WHERE company_id = ? AND source_type = ? AND source_id = ?').get(companyId, o.sourceType, o.sourceId)) return null;
    const f = factor(it.id, o.uom, it.base_uom); const baseRate = toBase(o.landedRate, f); const region = (o.region || 'ALL').toUpperCase();
    const window = addDays(o.date, -pn(companyId, 'proc.rti.window_days')); const hist = db.prepare(`SELECT x.base_landed_rate AS r FROM rti_observations x WHERE x.company_id = ? AND x.item_id = ? AND x.region_code IN (?, 'ALL') AND x.obs_date BETWEEN ? AND ? AND ${LIVE}`).all(companyId, it.id, region, window, o.date).map((x) => x.r);
    const why = o.supersedesId ? null : outlierOf(hist, baseRate, { pct: pn(companyId, 'proc.rti.outlier_pct'), min: pn(companyId, 'proc.rti.min_obs') });
    const id = Number(db.prepare('INSERT INTO rti_observations (company_id, item_id, spec_key, region_code, org_project_id, vendor_id, obs_date, rate, uom, landed_rate, base_uom, base_landed_rate, basis, is_outlier, outlier_reason, supersedes_id, correction_reason, created_by, source_type, source_id, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(companyId, it.id, (o.spec ?? '').trim().toLowerCase().slice(0, 80), region, o.projectId ?? null, o.vendorId ?? null, o.date, o.rate, o.uom ?? it.base_uom, o.landedRate, it.base_uom, baseRate, o.basis ?? 'LANDED', why ? 1 : 0, why, o.supersedesId ?? null, o.reason ?? null, user, o.sourceType, o.sourceId, o.note ?? null).lastInsertRowid);
    return { id, outlier: Boolean(why), reason: why };
  }
  /** FR-01: the observations of the approved quotations, awards, orders and contracts that are not in the history yet. Safe to run again. */
  function harvest(companyId) {
    const out = { QUOTATION: 0, CS: 0, PO: 0, RATE_CONTRACT: 0 }; const put = (o) => { if (insert(companyId, 'system', o)) out[o.sourceType] += 1; };
    return transaction(db, () => {
      for (const x of db.prepare("SELECT ql.id, ql.rate, ql.landed_rate, q.vendor_id, q.quote_date, rl.item_id, rl.uom, r.org_project_id FROM proc_quotation_lines ql JOIN proc_quotations q ON q.id = ql.quotation_id JOIN proc_rfq_lines rl ON rl.id = ql.rfq_line_id JOIN proc_rfqs r ON r.id = q.rfq_id WHERE q.company_id = ? AND q.status = 'RECEIVED' AND q.deleted_at IS NULL AND ql.deleted_at IS NULL AND ql.landed_rate > 0 AND rl.item_id IS NOT NULL").all(companyId))
        put({ sourceType: 'QUOTATION', sourceId: String(x.id), itemId: x.item_id, vendorId: x.vendor_id, projectId: x.org_project_id, date: x.quote_date, rate: x.rate, landedRate: x.landed_rate, uom: x.uom, basis: 'LANDED' });
      for (const x of db.prepare("SELECT cl.id, cl.landed_rate, cl.vendor_id, substr(s.approved_at, 1, 10) AS d, rl.item_id, rl.uom, s.org_project_id FROM proc_cs_lines cl JOIN proc_comparative_statements s ON s.id = cl.cs_id JOIN proc_rfq_lines rl ON rl.id = cl.rfq_line_id WHERE s.company_id = ? AND s.status IN ('APPROVED', 'SUPERSEDED') AND s.approved_at IS NOT NULL AND cl.deleted_at IS NULL AND cl.selected_qty > 0 AND cl.landed_rate > 0 AND rl.item_id IS NOT NULL").all(companyId))
        put({ sourceType: 'CS', sourceId: String(x.id), itemId: x.item_id, vendorId: x.vendor_id, projectId: x.org_project_id, date: x.d, rate: x.landed_rate, landedRate: x.landed_rate, uom: x.uom, basis: 'LANDED' });
      for (const x of db.prepare("SELECT l.id, l.rate, l.qty, l.basic_amount, l.freight_amount, l.uom, l.item_id, o.vendor_id, o.org_project_id, o.delivery_state, COALESCE(substr(o.approved_at, 1, 10), o.doc_date) AS d FROM proc_po_lines l JOIN proc_purchase_orders o ON o.id = l.po_id WHERE o.company_id = ? AND o.status IN ('APPROVED', 'CLOSED') AND o.deleted_at IS NULL AND l.deleted_at IS NULL AND l.item_id IS NOT NULL AND l.qty > 0").all(companyId)) {
        const landed = Math.round(((x.basic_amount + x.freight_amount) * 1000) / x.qty); if (landed > 0) put({ sourceType: 'PO', sourceId: String(x.id), itemId: x.item_id, vendorId: x.vendor_id, projectId: x.org_project_id, region: x.delivery_state, date: x.d, rate: x.rate, landedRate: landed, uom: x.uom, basis: 'LANDED' });
      }
      for (const x of db.prepare("SELECT l.id, l.rate, l.uom, l.item_id, c.vendor_id, COALESCE(substr(c.approved_at, 1, 10), c.valid_from) AS d FROM proc_rc_lines l JOIN proc_rate_contracts c ON c.id = l.rc_id WHERE c.company_id = ? AND c.status = 'APPROVED' AND c.deleted_at IS NULL AND l.deleted_at IS NULL AND l.item_id IS NOT NULL AND l.rate > 0").all(companyId))
        put({ sourceType: 'RATE_CONTRACT', sourceId: String(x.id), itemId: x.item_id, vendorId: x.vendor_id, date: x.d, rate: x.rate, landedRate: x.rate, uom: x.uom, basis: 'BASIC' });
      return out;
    });
  }

  // ---- manual entries: market surveys, corrections, indices -----------------------------------------------------------------------------------------------------------------------------------------------------
  const view = (r) => ({ id: r.id, itemId: r.item_id, item: r.iname, itemCode: r.icode, region: r.region_code, spec: r.spec_key, date: r.obs_date, source: r.source_type, sourceLabel: SOURCES[r.source_type], sourceId: r.source_id, vendorId: r.vendor_id, vendor: r.vname ?? null, projectId: r.org_project_id, rate: r.rate, uom: r.uom, landedRate: r.landed_rate, baseUom: r.base_uom, baseLandedRate: r.base_landed_rate, basis: r.basis, outlier: Boolean(r.is_outlier), outlierReason: r.outlier_reason, supersedesId: r.supersedes_id, correctionReason: r.correction_reason, createdBy: r.created_by });
  const SEL = 'SELECT x.*, i.name AS iname, i.code AS icode, COALESCE(v.trade_name, v.legal_name) AS vname FROM rti_observations x JOIN mdm_items i ON i.id = x.item_id LEFT JOIN mdm_partners v ON v.id = x.vendor_id';
  const observations = {
    list(actor, query) { const sc = scope(actor, 'proc.rate_intel.view'); return runList(db, obsList, parseListRequest(obsList, query), { select: 'x.*', scopeSql: sc.sql, params: sc.params, tieBreaker: 'x.id', map: (x) => { const it = db.prepare('SELECT code, name FROM mdm_items WHERE id = ?').get(x.item_id); return { id: x.id, item: it?.name, itemCode: it?.code, region: x.region_code, date: x.obs_date, source: x.source_type, vendor: x.vendor_id ? (db.prepare('SELECT COALESCE(trade_name, legal_name) AS n FROM mdm_partners WHERE id = ?').get(x.vendor_id)?.n ?? '') : '', rate: x.base_landed_rate, outlier: x.is_outlier ? 'YES' : 'NO' }; } }); },
    exportSource(actor, req) { need(actor, 'proc.rate_intel.export', 'export rate observations'); return observations.list(actor, { ...req, page: 1, pageSize: 100 }); },
    get(actor, id) { need(actor, 'proc.rate_intel.view', 'see rate observations'); const r = db.prepare(`${SEL} WHERE x.id = ? AND x.company_id = ?`).get(rid(id), actor.companyId); if (!r) throw notFound('That observation does not exist.'); const fix = db.prepare('SELECT id FROM rti_observations WHERE supersedes_id = ?').get(r.id); return { ...view(r), replacedBy: fix?.id ?? null }; },
    /** FR-01: a market survey entry. */
    survey(actor, b) {
      need(actor, 'proc.rate_intel.survey', 'enter a market survey'); const it = item(actor.companyId, b.itemId); if (!it) fail([{ field: 'itemId', message: 'Not an item of this company' }]); if (b.date > todayIST()) fail([{ field: 'date', message: 'The survey date is not in the future' }]);
      if (b.vendorId && !db.prepare('SELECT 1 FROM mdm_partners WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(b.vendorId, actor.companyId)) fail([{ field: 'vendorId', message: 'Not a business partner of this company' }]);
      const uoms = [it.base_uom, ...db.prepare('SELECT uom FROM mdm_item_uoms WHERE item_id = ? AND deleted_at IS NULL').all(it.id).map((x) => x.uom)]; if (!uoms.some((u) => u.toLowerCase() === b.uom.toLowerCase())) fail([{ field: 'uom', message: `Use ${uoms.join(', ')}` }]);
      const paise = Math.round(b.rate * 100);
      return transaction(db, () => { const r = insert(actor.companyId, actor.user, { sourceType: 'SURVEY', sourceId: `SRV-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, itemId: it.id, vendorId: b.vendorId ?? null, region: b.region, spec: b.spec, date: b.date, rate: paise, landedRate: paise, uom: b.uom, basis: 'MARKET', note: b.note });
        audit(actor, 'rti_observations', r.id, 'create', actor.companyId, { newValues: { item: it.code, region: b.region ?? 'ALL', rate: b.rate, outlier: r.outlier } }); publishEvent(db, { type: 'proc.rate.surveyed', entity: 'rti_observation', entityId: r.id, actorId: actor.user, companyId: actor.companyId, projectId: null, data: { observationId: r.id, itemId: it.id, region: (b.region ?? 'ALL').toUpperCase(), source: 'SURVEY', rate: paise, uom: b.uom, outlier: r.outlier } }); return observations.get(actor, r.id); });
    },
    /** BR-01: a wrong observation is never edited: a new one replaces it in the statistics and says why. */
    correct(actor, id, b) {
      need(actor, 'proc.rate_intel.survey', 'correct an observation'); const o = db.prepare('SELECT * FROM rti_observations WHERE id = ? AND company_id = ?').get(rid(id), actor.companyId); if (!o) throw notFound('That observation does not exist.'); if (db.prepare('SELECT 1 FROM rti_observations WHERE supersedes_id = ?').get(o.id)) throw conflict('This observation was corrected already: correct the newer one.');
      const paise = Math.round(b.rate * 100); const f = factor(o.item_id, o.uom, o.base_uom);
      return transaction(db, () => { const n = Number(db.prepare('SELECT COUNT(*) AS n FROM rti_observations WHERE supersedes_id IS NOT NULL AND company_id = ?').get(actor.companyId).n) + 1;
        const r = insert(actor.companyId, actor.user, { sourceType: 'SURVEY', sourceId: `COR-${o.id}-${n}`, itemId: o.item_id, vendorId: o.vendor_id, projectId: o.org_project_id, region: o.region_code, spec: o.spec_key, date: o.obs_date, rate: paise, landedRate: paise, uom: o.uom, basis: o.basis, supersedesId: o.id, reason: b.reason }); void f;
        audit(actor, 'rti_observations', r.id, 'correct', actor.companyId, { reason: b.reason, oldValues: { rate: o.rate }, newValues: { rate: b.rate, replaces: o.id } }); return observations.get(actor, r.id); });
    },
  };
  const indices = {
    list(actor, { group = null } = {}) { need(actor, 'proc.rate_intel.view', 'see price indices'); return db.prepare(`SELECT * FROM rti_indices WHERE company_id = ? AND deleted_at IS NULL ${group ? 'AND index_group = ? COLLATE NOCASE' : ''} ORDER BY index_group, region_code, period DESC LIMIT 600`).all(...(group ? [actor.companyId, group] : [actor.companyId])).map((x) => ({ id: x.id, group: x.index_group, region: x.region_code, period: x.period, value: x.index_value / 10000, source: x.index_source, sourceLabel: INDEX_SOURCES[x.index_source], by: x.created_by })); },
    /** An index value for a group, region and month; entering it again replaces the value and the audit keeps the old one. */
    set(actor, b, source = 'MANUAL') {
      need(actor, 'proc.rate_intel.index', 'upload price indices'); const region = (b.region ?? 'ALL').toUpperCase(); const group = b.group.trim().toUpperCase(); if (b.period > todayIST().slice(0, 7)) fail([{ field: 'period', message: 'The month is not in the future' }]); const v = Math.round(b.value * 10000);
      const ex = db.prepare('SELECT * FROM rti_indices WHERE company_id = ? AND index_group = ? AND region_code = ? AND period = ?').get(actor.companyId, group, region, b.period);
      if (ex) { db.prepare('UPDATE rti_indices SET index_value = ?, index_source = ?, deleted_at = NULL, is_active = 1, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(v, source, actor.user, nowIso(), ex.id); audit(actor, 'rti_indices', ex.id, 'update', actor.companyId, { oldValues: { value: ex.index_value / 10000 }, newValues: { value: b.value } }); return ex.id; }
      const id = Number(db.prepare('INSERT INTO rti_indices (company_id, index_group, region_code, period, index_value, index_source, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(actor.companyId, group, region, b.period, v, source, actor.user, 'api').lastInsertRowid); audit(actor, 'rti_indices', id, 'create', actor.companyId, { newValues: { group, region, period: b.period, value: b.value } }); return id;
    },
    /** FR-01: an uploaded file of index values, all or nothing. */
    importRows(actor, rows) { need(actor, 'proc.rate_intel.index', 'upload price indices'); return transaction(db, () => { const ids = rows.map((r) => indices.set(actor, r, 'IMPORT')); return { saved: ids.length, indices: indices.list(actor) }; }); },
  };

  // ---- the benchmark (FR-04) ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  /** The benchmark of an item for a region and date: the median landed rate per base unit of the observations of the window, outliers and replaced ones left out. Falls back to every region when the region has too few. */
  function benchmark(companyId, { itemId, region = null, date = null }) {
    const it = item(companyId, itemId); if (!it) return null; const on = date ?? todayIST(); const from = addDays(on, -pn(companyId, 'proc.rti.window_days')); const min = pn(companyId, 'proc.rti.min_obs'); const reg = region ? String(region).toUpperCase() : null;
    const fetchRows = (r) => db.prepare(`SELECT x.base_landed_rate AS r FROM rti_observations x WHERE x.company_id = ? AND x.item_id = ? ${r ? "AND x.region_code IN (?, 'ALL')" : ''} AND x.obs_date BETWEEN ? AND ? AND ${LIVE}`).all(...[companyId, it.id, ...(r ? [r] : []), from, on]).map((x) => x.r);
    let rows = reg ? fetchRows(reg) : []; let used = reg; if (!reg || rows.length < min) { const all = fetchRows(null); if (all.length > rows.length) { rows = all; used = null; } }
    const s = statsOf(rows); return { itemId: it.id, itemCode: it.code, item: it.name, uom: it.base_uom, region: used ?? 'ALL', date: on, from, ...s, rate: s.median, enough: s.count >= min, basis: 'LANDED' };
  }
  // the comparative statement (15.04) and the purchase order (15.05) ask for it through this hook; with too few observations they keep what they had
  rateBenchmarks.register((q) => { const b = benchmark(q.companyId, q); return b?.enough ? { rate: b.rate, count: b.count, uom: b.uom } : null; }, db);

  /** FR-03: the months of an item for a region: how many observations, minimum, average, maximum, median and volatility; with the external index of its category. */
  function series(actor, { itemId, region = null, months = 12 }) {
    need(actor, 'proc.rate_intel.view', 'see rate trends'); const it = item(actor.companyId, itemId); if (!it) throw notFound('That item does not exist.'); const reg = region ? region.toUpperCase() : null; const to = todayIST(); const from = `${addDays(to, -months * 31).slice(0, 7)}-01`;
    const rows = db.prepare(`SELECT substr(x.obs_date, 1, 7) AS m, x.base_landed_rate AS r FROM rti_observations x WHERE x.company_id = ? AND x.item_id = ? ${reg ? "AND x.region_code IN (?, 'ALL')" : ''} AND x.obs_date >= ? AND ${LIVE} ORDER BY x.obs_date`).all(...[actor.companyId, it.id, ...(reg ? [reg] : []), from]);
    const by = new Map(); for (const x of rows) by.set(x.m, [...(by.get(x.m) ?? []), x.r]); const points = [...by.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([m, v]) => ({ month: m, ...statsOf(v) }));
    const cat = db.prepare('SELECT code FROM mdm_item_categories WHERE id = ?').get(it.category_id); const idx = cat ? db.prepare("SELECT period, index_value FROM rti_indices WHERE company_id = ? AND index_group = ? COLLATE NOCASE AND region_code IN (?, 'ALL') AND period >= ? AND deleted_at IS NULL ORDER BY period").all(actor.companyId, cat.code, reg ?? 'ALL', from.slice(0, 7)).map((x) => ({ period: x.period, value: x.index_value / 10000 })) : [];
    const outliers = db.prepare(`SELECT COUNT(*) AS n FROM rti_observations x WHERE x.company_id = ? AND x.item_id = ? AND x.is_outlier = 1 AND x.obs_date >= ?`).get(actor.companyId, it.id, from).n;
    return { item: { id: it.id, code: it.code, name: it.name, uom: it.base_uom }, region: reg ?? 'ALL', points, indices: idx, indexGroup: cat?.code ?? null, benchmark: benchmark(actor.companyId, { itemId: it.id, region: reg }), outliers, overall: statsOf(rows.map((x) => x.r)) };
  }
  /** The dashboard: the items with the most observations, each with its benchmark, the change against the month before and its volatility; the latest external indices. */
  function dashboard(actor, { region = null } = {}) {
    need(actor, 'proc.rate_intel.view', 'see rate intelligence'); const reg = region ? region.toUpperCase() : null; const to = todayIST(); const cur = to.slice(0, 7); const prevDate = new Date(Date.parse(`${cur}-01T00:00:00Z`) - 86_400_000).toISOString().slice(0, 7);
    const top = db.prepare(`SELECT x.item_id, COUNT(*) AS n FROM rti_observations x WHERE x.company_id = ? ${reg ? "AND x.region_code IN (?, 'ALL')" : ''} AND ${LIVE} GROUP BY x.item_id ORDER BY n DESC, x.item_id LIMIT 40`).all(...[actor.companyId, ...(reg ? [reg] : [])]);
    const items = top.map((t) => { const b = benchmark(actor.companyId, { itemId: t.item_id, region: reg }); const monthAvg = (m) => { const v = db.prepare(`SELECT x.base_landed_rate AS r FROM rti_observations x WHERE x.company_id = ? AND x.item_id = ? ${reg ? "AND x.region_code IN (?, 'ALL')" : ''} AND substr(x.obs_date, 1, 7) = ? AND ${LIVE}`).all(...[actor.companyId, t.item_id, ...(reg ? [reg] : []), m]).map((x) => x.r); return v.length ? statsOf(v).avg : null; };
      const a = monthAvg(cur); const p = monthAvg(prevDate); return { itemId: b.itemId, code: b.itemCode, name: b.item, uom: b.uom, count: b.count, benchmark: b.rate, min: b.min, max: b.max, volatilityPct: b.volatilityPct, enough: b.enough, changePct: a != null && p ? Math.round(((a - p) / p) * 1000) / 10 : null }; });
    const latest = db.prepare("SELECT index_group, region_code, period, index_value FROM rti_indices x WHERE x.company_id = ? AND x.deleted_at IS NULL AND x.period = (SELECT MAX(period) FROM rti_indices y WHERE y.company_id = x.company_id AND y.index_group = x.index_group AND y.region_code = x.region_code AND y.deleted_at IS NULL) ORDER BY index_group, region_code").all(actor.companyId).map((x) => ({ group: x.index_group, region: x.region_code, period: x.period, value: x.index_value / 10000 }));
    const regions = db.prepare("SELECT DISTINCT region_code FROM rti_observations WHERE company_id = ? ORDER BY region_code").all(actor.companyId).map((x) => x.region_code);
    return { items, indices: latest, regions, totals: { observations: db.prepare('SELECT COUNT(*) AS n FROM rti_observations WHERE company_id = ?').get(actor.companyId).n, outliers: db.prepare('SELECT COUNT(*) AS n FROM rti_observations WHERE company_id = ? AND is_outlier = 1').get(actor.companyId).n }, canSurvey: may(actor, 'proc.rate_intel.survey'), canIndex: may(actor, 'proc.rate_intel.index') };
  }

  // ---- FR-05: the exposure of a project ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  /** The quantity still to buy of each item (the net requirement of the latest completed MRP run) at the current benchmark against the rate budgeted (the estimate on the latest approved requisition line, else the item's standard rate). */
  function exposure(actor, projectId) {
    const p = db.prepare('SELECT id, code, name, company_id FROM org_projects WHERE id = ? AND deleted_at IS NULL').get(rid(projectId)); if (!p || p.company_id !== actor.companyId || !may(actor, 'proc.rate_intel.view', p.id)) throw notFound('That project does not exist.');
    const run = db.prepare("SELECT id, doc_no, run_at FROM proc_mrp_runs WHERE company_id = ? AND org_project_id = ? AND status = 'COMPLETED' AND deleted_at IS NULL ORDER BY id DESC LIMIT 1").get(actor.companyId, p.id);
    const rows = run ? db.prepare('SELECT item_id, SUM(net_req) AS qty FROM proc_mrp_lines WHERE run_id = ? AND deleted_at IS NULL GROUP BY item_id HAVING SUM(net_req) > 0').all(run.id) : [];
    const lines = rows.map((x) => {
      const it = item(actor.companyId, x.item_id); const b = benchmark(actor.companyId, { itemId: x.item_id }); const est = db.prepare("SELECT l.est_rate FROM proc_pr_lines l JOIN proc_requisitions r ON r.id = l.pr_id WHERE r.company_id = ? AND r.org_project_id = ? AND l.item_id = ? AND r.status = 'APPROVED' AND l.est_rate > 0 AND l.deleted_at IS NULL ORDER BY r.id DESC LIMIT 1").get(actor.companyId, p.id, x.item_id);
      const std = db.prepare('SELECT standard_amount FROM mdm_items WHERE id = ?').get(x.item_id)?.standard_amount; const budgetRate = est?.est_rate ?? (std > 0 ? std : null); const current = b?.rate ?? null;
      const exposureAmt = budgetRate != null && current != null ? Math.round((x.qty * (current - budgetRate)) / 1000) : null;
      return { itemId: x.item_id, code: it?.code, name: it?.name, uom: it?.base_uom, remainingQty: x.qty / 1000, budgetRate, budgetRateFrom: est ? 'REQUISITION' : std > 0 ? 'ITEM_STANDARD' : null, currentRate: current, observations: b?.count ?? 0, enough: Boolean(b?.enough), deltaPct: budgetRate && current != null ? Math.round(((current - budgetRate) / budgetRate) * 1000) / 10 : null, exposure: exposureAmt };
    }).sort((a, b) => Math.abs(b.exposure ?? 0) - Math.abs(a.exposure ?? 0));
    const priced = lines.filter((l) => l.exposure != null); return { project: { id: p.id, code: p.code, name: p.name }, run: run ? { id: run.id, docNo: run.doc_no, at: run.run_at } : null, lines, totals: { exposure: priced.reduce((s, l) => s + l.exposure, 0), over: priced.filter((l) => l.exposure > 0).reduce((s, l) => s + l.exposure, 0), under: priced.filter((l) => l.exposure < 0).reduce((s, l) => s + l.exposure, 0), unpriced: lines.length - priced.length } };
  }
  function projects(actor) { return db.prepare("SELECT id, code, name FROM org_projects WHERE company_id = ? AND deleted_at IS NULL AND status = 'ACTIVE' ORDER BY code").all(actor.companyId).filter((p) => may(actor, 'proc.rate_intel.view', p.id)); }
  function items(actor, q = '') { need(actor, 'proc.rate_intel.view', 'see rate intelligence'); return db.prepare("SELECT id, code, name, base_uom FROM mdm_items WHERE company_id = ? AND deleted_at IS NULL AND (code LIKE ? OR name LIKE ?) ORDER BY name LIMIT 60").all(actor.companyId, `%${q}%`, `%${q}%`); }
  function sweep() { let n = 0; for (const c of db.prepare('SELECT id FROM org_companies').all()) { const r = harvest(c.id); n += r.QUOTATION + r.CS + r.PO + r.RATE_CONTRACT; } return n; }
  void sysActor;
  const benchmarkFor = (actor, q) => { need(actor, 'proc.rate_intel.view', 'see benchmarks'); const b = benchmark(actor.companyId, q); if (!b) throw notFound('That item does not exist.'); return b; };
  return { observations, indices, benchmark, benchmarkFor, series, dashboard, exposure, projects, items, harvest, sweep };
}
