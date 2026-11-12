import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { notFound, unprocessable } from '../../platform/http/errors.js';
import { todayIST } from '../../../shared/dates.js';
import { json, nowIso, rid } from '../proc/base.js';

// The stock engine (part 16.01): the one place a quantity moves. Every receipt, issue, return, transfer, adjustment and scrap is a ledger entry (append-only, BR-02) that updates the balance of its item, store, bin, batch and owner and the valuation of the item
// in the store (moving weighted average, or FIFO layers). A balance never goes below zero unless the store allows it (BR-01); the balances always equal the sum of the ledger (BR-03). Quantities are thousandths of the base unit, rates and values paise.
export const TXN_TYPES = { OPENING: 'Opening stock', RECEIPT: 'Receipt', ISSUE: 'Issue', RETURN: 'Return', TRANSFER_OUT: 'Transfer out', TRANSFER_IN: 'Transfer in', ADJUSTMENT: 'Adjustment', SCRAP: 'Scrap', REVERSAL: 'Reversal', REVALUATION: 'Revaluation' };
const IN_TYPES = new Set(['OPENING', 'RECEIPT', 'RETURN', 'TRANSFER_IN']); const OUT_TYPES = new Set(['ISSUE', 'TRANSFER_OUT', 'SCRAP']);
export const STORE_TYPES = { CENTRAL_WAREHOUSE: 'Central warehouse', SITE_STORE: 'Site store', YARD: 'Yard', BATCHING_PLANT: 'Batching plant store', TRANSIT: 'Transit' };
/** The value of a quantity taken out at the weighted average: proportional to what the store holds, the whole value for the last of it. */
export function wavgOut(held, qty) {
  if (held.qty <= 0) return Math.round((held.avgRate * qty) / 1000); if (qty >= held.qty) return held.value; return Math.round((held.value * qty) / held.qty);
}
/** FIFO: takes `qty` from the oldest layers; returns the value and what is left of each layer touched. */
export function fifoOut(layers, qty) {
  let need = qty; let value = 0; const used = [];
  for (const l of layers) { if (need <= 0) break; const take = Math.min(l.qty, need); value += Math.round((take * l.rate) / 1000); used.push({ id: l.id, take, left: l.qty - take }); need -= take; }
  return { value, used, short: need };
}

export function createStockEngine({ db, base }) {
  const { fail } = base;
  const storeOf = (companyId, id) => { const s = db.prepare('SELECT * FROM inv_stores WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), companyId); if (!s) throw notFound('That store does not exist.'); return s; };
  const itemOf = (companyId, id) => db.prepare('SELECT id, code, name, base_uom, stock_tracked, batch_tracked, serial_tracked, category_id FROM mdm_items WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), companyId);
  const defaultBin = (store) => db.prepare('SELECT id FROM inv_bins WHERE store_id = ? AND is_default = 1 AND deleted_at IS NULL').get(store.id)?.id ?? Number(db.prepare("INSERT INTO inv_bins (company_id, store_id, code, is_default, created_by, source_type) VALUES (?, ?, 'MAIN', 1, 'system', 'inv_store')").run(store.company_id, store.id).lastInsertRowid);
  /** The unit of a quantity turned into the base unit of the item: a factor from the item's own conversions. */
  function toBase(item, uom, qty, rate = null) {
    if (!uom || uom.toLowerCase() === item.base_uom.toLowerCase()) return { qty, rate };
    const f = db.prepare('SELECT factor_to_base FROM mdm_item_uoms WHERE item_id = ? AND uom = ? COLLATE NOCASE AND deleted_at IS NULL').get(item.id, uom); if (!f) fail([{ field: 'uom', message: `${uom} is not a unit of ${item.code}` }]);
    const k = Number(f.factor_to_base); return { qty: Math.round(qty * k), rate: rate == null ? null : Math.round(rate / k) };
  }
  const valRow = (companyId, storeId, itemId) => db.prepare('SELECT * FROM inv_valuation WHERE company_id = ? AND store_id = ? AND item_id = ?').get(companyId, storeId, itemId) ?? db.prepare('SELECT * FROM inv_valuation WHERE id = ?').get(Number(db.prepare('INSERT INTO inv_valuation (company_id, store_id, item_id, created_by, source_type) VALUES (?, ?, ?, ?, ?)').run(companyId, storeId, itemId, 'system', 'inv_ledger').lastInsertRowid));
  const balKey = (companyId, storeId, binId, itemId, batch, serial, owner) => db.prepare('SELECT * FROM inv_balances WHERE company_id = ? AND store_id = ? AND bin_id = ? AND item_id = ? AND batch_no = ? AND serial_no = ? AND COALESCE(project_id, 0) = ?').get(companyId, storeId, binId, itemId, batch, serial, owner ?? 0);
  const balRow = (companyId, store, binId, itemId, batch, serial, owner) => balKey(companyId, store.id, binId, itemId, batch, serial, owner) ?? db.prepare('SELECT * FROM inv_balances WHERE id = ?').get(Number(db.prepare("INSERT INTO inv_balances (company_id, store_id, bin_id, item_id, batch_no, serial_no, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'system', 'inv_ledger')").run(companyId, store.id, binId, itemId, batch, serial, owner ?? null, store.org_site_id ?? null).lastInsertRowid));
  const freeOf = (b) => b.qty_on_hand - b.qty_reserved - b.qty_inspection;
  /** What a posting may take from a row: everything not reserved or held for inspection, plus what the reservation being used has reserved there. */
  function takeable(b, resv) { const mine = resv ? (json(resv.alloc_json, []).find((a) => a.balanceId === b.id)?.qty ?? 0) : 0; return freeOf(b) + mine; }
  /** The stock of the store free to move, per row, oldest receipt first. */
  const rowsFor = (companyId, storeId, itemId, owner, batch = null, serial = null, binId = null) => db.prepare(`SELECT * FROM inv_balances WHERE company_id = ? AND store_id = ? AND item_id = ? AND COALESCE(project_id, 0) = ? AND deleted_at IS NULL ${batch != null ? 'AND batch_no = ?' : ''} ${serial != null ? 'AND serial_no = ?' : ''} ${binId ? 'AND bin_id = ?' : ''} AND qty_on_hand > 0 ORDER BY COALESCE(last_receipt_on, '') , id`).all(...[companyId, storeId, itemId, owner ?? 0, ...(batch != null ? [batch] : []), ...(serial != null ? [serial] : []), ...(binId ? [binId] : [])]);
  const freeQty = (companyId, storeId, itemId) => db.prepare('SELECT COALESCE(SUM(qty_on_hand - qty_reserved - qty_inspection), 0) AS q FROM inv_balances WHERE company_id = ? AND store_id = ? AND item_id = ? AND deleted_at IS NULL').get(companyId, storeId, itemId).q;
  const ownerOf = (store, t) => (t.pool ? null : (t.ownerProjectId !== undefined ? t.ownerProjectId : (store.org_project_id ?? null)));

  /**
   * One ledger entry. `t`: { store, itemId, binId?, batchNo?, serialNo?, type, direction? ('IN'|'OUT' for ADJUSTMENT and REVERSAL), qty, rate? (paise per base unit, for an entry in), value? (paise: explicit, for an entry in or a revaluation), date?, ownerProjectId?, pool?, sourceType, sourceId, reason?, reversesId?, counterId?, resv?, wbsId? }.
   Must run inside a transaction. Returns the entry.
   */
  function postOne(actor, t) {
    const store = t.store; const companyId = store.company_id; const item = itemOf(companyId, t.itemId); const problems = [];
    if (!item) fail([{ field: 'itemId', message: 'Not an item of this company' }]); if (!item.stock_tracked) fail([{ field: 'itemId', message: `${item.code} is not kept in stock` }]);
    if (store.store_status !== 'ACTIVE') throw unprocessable(`The store ${store.code} is not active: stock moves only in an approved store.`);
    const batch = (t.batchNo ?? '').trim(); const serial = (t.serialNo ?? '').trim(); const dir = t.type === 'REVALUATION' ? 'NONE' : (t.direction ?? (IN_TYPES.has(t.type) ? 'IN' : OUT_TYPES.has(t.type) ? 'OUT' : null));
    if (!dir) throw unprocessable('Give the direction of the entry.'); if (t.type !== 'REVALUATION' && !(t.qty > 0)) problems.push({ field: 'qty', message: 'Give a quantity above zero' });
    if (item.batch_tracked && !batch && t.type !== 'REVALUATION') problems.push({ field: 'batchNo', message: `${item.code} is kept by batch: give the batch number` });
    if (item.serial_tracked && t.type !== 'REVALUATION') { if (!serial) problems.push({ field: 'serialNo', message: `${item.code} is kept by serial number` }); else if (t.qty !== 1000) problems.push({ field: 'qty', message: 'A serial number is one piece' }); }
    if (!item.serial_tracked && serial) problems.push({ field: 'serialNo', message: `${item.code} has no serial numbers` }); fail(problems);
    const owner = ownerOf(store, t); const binId = t.binId ?? defaultBin(store); if (!db.prepare('SELECT 1 FROM inv_bins WHERE id = ? AND store_id = ? AND deleted_at IS NULL').get(binId, store.id)) fail([{ field: 'binId', message: 'Not a bin of this store' }]);
    const date = t.date ?? todayIST(); if (date > todayIST()) fail([{ field: 'date', message: 'The date is not in the future' }]);
    const val = valRow(companyId, store.id, item.id); const held = { qty: val.qty, value: val.value, avgRate: val.avg_rate }; const bal = balRow(companyId, store, binId, item.id, batch, serial, owner);
    let qtyIn = 0; let qtyOut = 0; let value; let used = null;
    if (dir === 'IN') {
      qtyIn = t.qty; if (t.value == null && !(t.rate >= 0)) fail([{ field: 'rate', message: 'Give the rate' }]); value = t.value ?? Math.round((t.qty * t.rate) / 1000);
    } else if (dir === 'OUT') {
      qtyOut = t.qty;
      if (!store.allow_negative && t.qty > takeable(bal, t.resv)) throw unprocessable(`Not enough stock: ${item.code} in ${store.code}${binId ? '' : ''} has ${Math.max(0, takeable(bal, t.resv)) / 1000} free of ${t.qty / 1000} asked for.`);
      if (!store.allow_negative && t.qty > held.qty) throw unprocessable(`Not enough stock of ${item.code} in ${store.code}.`);
      if (store.valuation_method === 'FIFO') { const layers = db.prepare(`SELECT id, qty_remaining AS qty, layer_rate AS rate FROM inv_fifo_layers WHERE company_id = ? AND store_id = ? AND item_id = ? AND qty_remaining > 0 ${t.layerLedgerId ? 'AND ledger_id = ?' : ''} ORDER BY id`).all(...[companyId, store.id, item.id, ...(t.layerLedgerId ? [t.layerLedgerId] : [])]); const f = fifoOut(layers, t.qty); value = f.value + Math.round((f.short * held.avgRate) / 1000); used = f.used; }
      else value = wavgOut(held, t.qty);
      value = t.value ?? value;
    } else { value = t.value ?? 0; }
    const newQty = held.qty + qtyIn - qtyOut; const newValue = held.value + (dir === 'IN' ? value : dir === 'OUT' ? -value : value);
    const entryRate = dir === 'IN' ? Math.round((value * 1000) / t.qty) : dir === 'OUT' ? Math.round((value * 1000) / t.qty) : 0;
    const nextId = (db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM inv_stock_ledger').get().n);
    const id = Number(db.prepare('INSERT INTO inv_stock_ledger (company_id, doc_no, store_id, bin_id, item_id, batch_no, serial_no, txn_type, txn_date, qty_in, qty_out, rate, value, balance_qty, balance_value, wbs_id, reverses_id, reason, counter_id, posted_by, project_id, site_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(companyId, `SLE/${String(nextId).padStart(8, '0')}`, store.id, binId, item.id, batch, serial, t.type, date, qtyIn, qtyOut, entryRate, dir === 'OUT' ? -value : value, newQty, newValue, t.wbsId ?? null, t.reversesId ?? null, t.reason ?? null, t.counterId ?? null, actor.user, owner, store.org_site_id ?? null, actor.user, t.sourceType ?? 'manual', String(t.sourceId ?? nextId)).lastInsertRowid);
    const avg = newQty > 0 ? Math.round((newValue * 1000) / newQty) : (newQty === 0 ? 0 : val.avg_rate);
    db.prepare('UPDATE inv_valuation SET qty = ?, value = ?, avg_rate = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(newQty, newValue, avg, actor.user, nowIso(), val.id);
    if (dir === 'IN' && store.valuation_method === 'FIFO') db.prepare('INSERT INTO inv_fifo_layers (company_id, store_id, item_id, ledger_id, layer_date, qty_remaining, layer_rate, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(companyId, store.id, item.id, id, date, t.qty, entryRate, actor.user, 'inv_ledger');
    if (used) for (const u of used) db.prepare('UPDATE inv_fifo_layers SET qty_remaining = ?, updated_at = ? WHERE id = ?').run(u.left, nowIso(), u.id);
    if (dir !== 'NONE') db.prepare('UPDATE inv_balances SET qty_on_hand = qty_on_hand + ?, last_receipt_on = CASE WHEN ? = 1 THEN ? ELSE last_receipt_on END, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(qtyIn - qtyOut, dir === 'IN' && t.type !== 'REVERSAL' ? 1 : 0, date, actor.user, nowIso(), bal.id);
    db.prepare("UPDATE inv_balances SET avg_rate = ?, value = CAST(ROUND(qty_on_hand * ? / 1000.0) AS INTEGER) WHERE company_id = ? AND store_id = ? AND item_id = ?").run(avg, avg, companyId, store.id, item.id);
    if (t.resv && dir === 'OUT') consumeReservation(t.resv, t.qty);
    const after = db.prepare('SELECT qty_on_hand FROM inv_balances WHERE id = ?').get(bal.id).qty_on_hand;
    publishEvent(db, { type: 'inv.stock.moved', entity: 'inv_stock_ledger', entityId: id, actorId: actor.user, companyId, projectId: owner ?? undefined, data: { ledgerId: id, storeId: store.id, storeCode: store.code, storeName: store.name, storeType: store.store_type, siteId: store.org_site_id ?? null, itemId: item.id, txnType: t.type, qty: (qtyIn - qtyOut) / 1000, value: dir === 'OUT' ? -value : value, rate: entryRate, batchNo: batch, serialNo: serial, ownerProjectId: owner, sourceType: t.sourceType ?? 'manual', sourceId: String(t.sourceId ?? nextId), freeQty: freeQty(companyId, store.id, item.id) / 1000, onHand: after / 1000, date } });
    return db.prepare('SELECT * FROM inv_stock_ledger WHERE id = ?').get(id);
  }
  /** An issue-like entry that takes from several rows when no bin or batch is named: the oldest receipts first. */
  function postOut(actor, t) {
    const store = t.store; const owner = ownerOf(store, t); const named = Boolean(t.binId) || t.batchNo != null || t.serialNo != null;
    if (named || t.type === 'REVERSAL') return [postOne(actor, t)];
    const rows = rowsFor(store.company_id, store.id, t.itemId, owner).filter((r) => takeable(r, t.resv) > 0); let need = t.qty; const out = [];
    if (!rows.length && store.allow_negative) return [postOne(actor, t)];
    for (const r of rows) { if (need <= 0) break; const take = Math.min(need, takeable(r, t.resv)); out.push(postOne(actor, { ...t, qty: take, binId: r.bin_id, batchNo: r.batch_no, serialNo: r.serial_no, resv: t.resv ? db.prepare('SELECT * FROM inv_reservations WHERE id = ?').get(t.resv.id) : undefined })); need -= take; }
    if (need > 0) { if (store.allow_negative) out.push(postOne(actor, { ...t, qty: need, binId: t.binId })); else throw unprocessable(`Not enough stock of the item in ${store.code}: ${(t.qty - need) / 1000} free of ${t.qty / 1000} asked for.`); }
    return out;
  }

  // ---- reservations (FR-06) ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  function allocate(companyId, store, itemId, owner, qty) {
    const rows = rowsFor(companyId, store.id, itemId, owner).filter((r) => freeOf(r) > 0); const alloc = []; let need = qty;
    for (const r of rows) { if (need <= 0) break; const take = Math.min(need, freeOf(r)); alloc.push({ balanceId: r.id, qty: take }); need -= take; }
    if (need > 0) throw unprocessable(`Only ${(qty - need) / 1000} is free to reserve.`); return alloc;
  }
  function consumeReservation(resv, qty) {
    const fresh = db.prepare('SELECT * FROM inv_reservations WHERE id = ?').get(resv.id); let left = Math.min(qty, fresh.qty - fresh.qty_consumed); const alloc = json(fresh.alloc_json, []);
    for (const a of alloc) { if (left <= 0) break; const take = Math.min(left, a.qty); a.qty -= take; left -= take; db.prepare('UPDATE inv_balances SET qty_reserved = MAX(0, qty_reserved - ?) WHERE id = ?').run(take, a.balanceId); }
    const consumed = fresh.qty_consumed + Math.min(qty, fresh.qty - fresh.qty_consumed);
    db.prepare("UPDATE inv_reservations SET alloc_json = ?, qty_consumed = ?, reservation_status = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(JSON.stringify(alloc.filter((a) => a.qty > 0)), consumed, consumed >= fresh.qty ? 'CONSUMED' : 'ACTIVE', nowIso(), fresh.id);
  }
  function releaseReservation(resv) { const alloc = json(resv.alloc_json, []); for (const a of alloc) db.prepare('UPDATE inv_balances SET qty_reserved = MAX(0, qty_reserved - ?) WHERE id = ?').run(a.qty, a.balanceId); }
  const reserveRows = (alloc) => { for (const a of alloc) db.prepare('UPDATE inv_balances SET qty_reserved = qty_reserved + ? WHERE id = ?').run(a.qty, a.balanceId); };

  // ---- the integrity check (BR-03) ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  /** The balances against the ledger: quantity per row, and quantity and value per item in a store against the last running balance. Empty means they agree. */
  function integrity(companyId) {
    const problems = [];
    for (const r of db.prepare(`SELECT b.id, b.store_id, b.bin_id, b.item_id, b.batch_no, b.serial_no, b.project_id, b.qty_on_hand, COALESCE((SELECT SUM(l.qty_in - l.qty_out) FROM inv_stock_ledger l WHERE l.company_id = b.company_id AND l.store_id = b.store_id AND l.bin_id = b.bin_id AND l.item_id = b.item_id AND l.batch_no = b.batch_no AND l.serial_no = b.serial_no AND COALESCE(l.project_id, 0) = COALESCE(b.project_id, 0)), 0) AS ledger_qty FROM inv_balances b WHERE b.company_id = ?`).all(companyId))
      if (r.qty_on_hand !== r.ledger_qty) problems.push({ kind: 'BALANCE_QTY', balanceId: r.id, storeId: r.store_id, itemId: r.item_id, balance: r.qty_on_hand, ledger: r.ledger_qty });
    for (const v of db.prepare('SELECT * FROM inv_valuation WHERE company_id = ?').all(companyId)) {
      const last = db.prepare('SELECT balance_qty, balance_value FROM inv_stock_ledger WHERE company_id = ? AND store_id = ? AND item_id = ? ORDER BY id DESC LIMIT 1').get(companyId, v.store_id, v.item_id);
      const sum = db.prepare('SELECT COALESCE(SUM(qty_in - qty_out), 0) AS q, COALESCE(SUM(value), 0) AS v FROM inv_stock_ledger WHERE company_id = ? AND store_id = ? AND item_id = ?').get(companyId, v.store_id, v.item_id);
      if (v.qty !== sum.q || (last && last.balance_qty !== v.qty)) problems.push({ kind: 'VALUATION_QTY', storeId: v.store_id, itemId: v.item_id, balance: v.qty, ledger: sum.q });
      if (v.value !== sum.v || (last && last.balance_value !== v.value)) problems.push({ kind: 'VALUATION_VALUE', storeId: v.store_id, itemId: v.item_id, balance: v.value, ledger: sum.v });
      const rows = db.prepare('SELECT COALESCE(SUM(qty_on_hand), 0) AS q FROM inv_balances WHERE company_id = ? AND store_id = ? AND item_id = ?').get(companyId, v.store_id, v.item_id).q; if (rows !== v.qty) problems.push({ kind: 'ROWS_VS_VALUATION', storeId: v.store_id, itemId: v.item_id, balance: rows, ledger: v.qty });
    }
    for (const b of db.prepare('SELECT id, store_id, item_id FROM inv_balances WHERE company_id = ? AND (qty_reserved + qty_inspection > qty_on_hand AND qty_on_hand >= 0)').all(companyId)) problems.push({ kind: 'COMMITTED_OVER_ON_HAND', balanceId: b.id, storeId: b.store_id, itemId: b.item_id });
    return problems;
  }
  return { storeOf, itemOf, defaultBin, toBase, postOne, postOut, allocate, reserveRows, consumeReservation, releaseReservation, integrity, freeQty, rowsFor, balKey, balRow, valRow, freeOf, ownerOf, transaction: (fn) => transaction(db, fn) };
}
