import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { toPdf } from '../../platform/export/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { createParameterStore, parameterRegistry } from '../../platform/parameters/index.js';
import { toCsv } from '../../platform/security/csv.js';
import { todayIST } from '../../../shared/dates.js';
import { nowIso, rid } from '../proc/base.js';
import { STATUS, createFlow } from '../qa/flow.js';

// Part 23.09: fixed assets and depreciation.
//  FR-01 the register: class (dated master: accounts, Schedule II life and method, Income-tax block and rate), cost, capitalisation date, project, site, custodian,
//  the machine of the equipment register (17.01) or the small asset (16.09), useful life, residual value, book method and tax block.
//  FR-02 capitalisation from an AP bill booked to a fixed-asset account, from capital work in progress gathered from bills (settled: Dr the asset, Cr CWIP), from the
//  equipment register or a small asset (their events make a draft), or an opening balance; approved by the accounts manager and the CFO.
//  FR-03 one book depreciation run a month (BR-01): SLM (cost less residual over the life, by days in a part month) or WDV (the rate that brings the cost to the
//  residual over the life, on the written-down value at the start of the year, by days), posted Dr depreciation by project, Cr accumulated depreciation by class;
//  the tax depreciation by block (Income-tax Act: full or half rate by the 180-day rule) is a separate book, for the computation.
//  FR-04 transfers between projects, sites and custodians. FR-05 disposal (sale, scrap, write-off): depreciation to the day before the disposal (BR-01), the gain or
//  loss, approved by the accounts manager, the CFO and above ₹10 lakh a director, posted; a sale becomes a receivable to invoice (23.05). FR-06 physical
//  verification by QR tag.

export const ASSET_DOC = 'FIN_FA_ASSET';
export const DISPOSAL_DOC = 'FIN_FA_DISPOSAL';
export const SOURCES = { AP_BILL: 'AP bill (capex)', CWIP: 'Capital work in progress', EQUIPMENT: 'Equipment register (17.01)', SMALL_ASSET: 'Small asset (16.09)', OPENING: 'Opening balance' };
export const METHODS = { SALE: 'Sale', SCRAP: 'Scrap', WRITE_OFF: 'Write-off' };
const rs = (p) => (p == null ? null : p / 100);
const paise = (v) => Math.round(Number(v) * 100);
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const monthEnd = (p) => { const [y, m] = p.split('-').map(Number); return `${p}-${String(lastDay(y, m)).padStart(2, '0')}`; };
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const addMonths = (p, n) => { const [y, m] = p.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + n, 1)); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`; };
const days = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1; // both days counted
const fyStart = (d) => { const y = Number(d.slice(0, 4)); const m = Number(d.slice(5, 7)); return `${m >= 4 ? y : y - 1}-04-01`; };
const fyOf = (d) => { const s = Number(fyStart(d).slice(0, 4)); return `${s}-${String((s + 1) % 100).padStart(2, '0')}`; };
const fyRange = (fy) => { const s = Number(fy.slice(0, 4)); return { from: `${s}-04-01`, to: `${s + 1}-03-31` }; };
const daysInFy = (d) => days(fyStart(d), `${Number(fyStart(d).slice(0, 4)) + 1}-03-31`);

/** The WDV rate (a fraction) that brings the cost down to the residual value over the life: 1 − (residual ÷ cost)^(12 ÷ months) (Schedule II, Companies Act 2013). */
export const wdvRate = (cost, residual, months) => (cost > 0 && residual > 0 ? 1 - (residual / cost) ** (12 / months) : 1);
/**
 * The book depreciation of an asset for the days [from, to] (both counted), in paise. SLM: (cost − residual) ÷ life months for a whole month, by days in a part
 * month. WDV: the written-down value at the start of the financial year (or the cost in the year of capitalisation) × the rate × days ÷ days of the year. Never below
 * the residual value. `a`: { cost, residual, lifeMonths, method, accumulated, fyBase }.
 */
export function depFor(a, from, to) {
  if (to < from) return 0;
  const left = a.cost - a.residual - a.accumulated; if (left <= 0) return 0;
  let d;
  if (a.method === 'SLM') {
    const monthly = (a.cost - a.residual) / a.lifeMonths; const y = Number(from.slice(0, 4)); const m = Number(from.slice(5, 7)); const dim = lastDay(y, m);
    const n = days(from, to); d = n === dim && from.slice(8) === '01' ? monthly : (monthly * n) / dim;
  } else {
    d = (a.fyBase * wdvRate(a.cost, a.residual, a.lifeMonths) * days(from, to)) / daysInFy(from);
  }
  return Math.max(0, Math.min(left, Math.round(d)));
}

parameterRegistry.get('fin.fa.disposal_dir_above') || parameterRegistry.define({ key: 'fin.fa.disposal_dir_above', dataType: 'integer', default: 1000000, scopes: ['system', 'company'], description: 'Part 23.09 §9: a disposal whose written-down value or proceeds are above this many rupees is approved by a director after the CFO.' });
parameterRegistry.get('fin.fa.capitalise_above') || parameterRegistry.define({ key: 'fin.fa.capitalise_above', dataType: 'integer', default: 5000, scopes: ['system', 'company'], description: 'Part 23.09 FR-02: a small asset (16.09) or a machine (17.01) registered for capitalisation at or above this many rupees gets a draft fixed asset.' });
parameterRegistry.get('fin.fa.default_equipment_class') || parameterRegistry.define({ key: 'fin.fa.default_equipment_class', dataType: 'string', default: 'PM_CONSTRUCTION', scopes: ['system', 'company'], description: 'Part 23.09 FR-02: the asset class a draft made from the equipment register starts with (the accounts manager may change it before sending it).' });
parameterRegistry.get('fin.fa.default_small_asset_class') || parameterRegistry.define({ key: 'fin.fa.default_small_asset_class', dataType: 'string', default: 'OFFICE_EQUIP', scopes: ['system', 'company'], description: 'Part 23.09 FR-02: the asset class a draft made from a small asset starts with.' });

export const faList = defineList({
  code: 'fin.fa_assets', label: 'Fixed assets', permission: 'fin.asset.view',
  from: 'fa_assets x LEFT JOIN org_projects p ON p.id = x.org_project_id', where: 'x.deleted_at IS NULL',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'Asset' }, description: { sql: 'x.description', type: 'text', label: 'Description' }, classCode: { sql: 'x.class_code', type: 'text', label: 'Class' },
    project: { sql: "COALESCE(p.code, '')", type: 'text', label: 'Project' }, custodian: { sql: "COALESCE(x.custodian, '')", type: 'text', label: 'Custodian' }, capDate: { sql: 'x.cap_date', type: 'date', label: 'Put to use' },
    cost: { sql: '(x.cost_paise / 100.0)', type: 'money', label: 'Cost', total: true }, accumulated: { sql: '(x.accumulated_dep_paise / 100.0)', type: 'money', label: 'Depreciation to date', total: true }, wdv: { sql: '(x.wdv_paise / 100.0)', type: 'money', label: 'Net book value', total: true },
    method: { sql: 'x.book_method', type: 'enum', label: 'Method', options: [['SLM', 'Straight line'], ['WDV', 'Written-down value']] }, source: { sql: 'x.cap_source', type: 'enum', label: 'From', options: Object.entries(SOURCES) },
    state: { sql: 'x.asset_state', type: 'enum', label: 'In use', options: [['PENDING', 'Not yet capitalised'], ['IN_USE', 'In use'], ['DISPOSED', 'Disposed']] }, status: { sql: 'x.status', type: 'enum', label: 'Approval', options: Object.entries(STATUS) },
  },
});

/** @param {{ db: any, base: any, gl: any, flags: any, tax?: () => any }} o */
export function createAssetService({ db, base, gl, flags, tax = () => null }) {
  const { may, audit, notify, authz } = base;
  const need = (actor, key, what, pid = null) => { if (!may(actor, key, pid)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const param = (companyId, key) => createParameterStore(db).get(key, { companyId, date: todayIST() });
  const on = (companyId) => flags.isOn({ companyId, user: 'system', roles: [] }, 'ff.fin.p2309');
  const evt = (type, actor, companyId, entity, entityId, data) => publishEvent(db, { type, entity, entityId, actorId: actor?.user ?? 'system', companyId, data });
  const docNo = (companyId, table, prefix) => { const n = (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE company_id = ?`).get(companyId).n ?? 0) + 1; let no = `${prefix}/${String(n).padStart(6, '0')}`; for (let k = n + 1; db.prepare(`SELECT 1 FROM ${table} WHERE company_id = ? AND doc_no = ?`).get(companyId, no); k += 1) no = `${prefix}/${String(k).padStart(6, '0')}`; return no; };
  const acct = (companyId, code) => db.prepare('SELECT id FROM fin_accounts WHERE company_id = ? AND code = ? AND deleted_at IS NULL').get(companyId, code)?.id ?? null;
  const projectFor = (accountId, projectId) => (!projectId || db.prepare("SELECT 1 FROM fin_dimension_rules WHERE account_id = ? AND dimension = 'PROJECT' AND requirement = 'NOT_ALLOWED' AND deleted_at IS NULL").get(accountId) ? {} : { projectId });
  const rolesOf = (companyId, user) => { try { return JSON.parse(db.prepare('SELECT roles_json FROM iam_users WHERE company_id = ? AND username = ?').get(companyId, user)?.roles_json ?? '[]').flat(); } catch { return []; } };

  // ---- the classes (dated master data) ----
  const classOf = (companyId, code, date = todayIST()) => db.prepare('SELECT * FROM fa_classes WHERE code = ? AND (company_id = ? OR company_id IS NULL) AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?) AND deleted_at IS NULL ORDER BY company_id IS NULL, effective_from DESC LIMIT 1').get(code, companyId, date, date) ?? null;
  const classes = (actor) => { need(actor, 'fin.asset.view', 'see asset classes'); return db.prepare("SELECT * FROM fa_classes c WHERE (company_id = ? OR company_id IS NULL) AND deleted_at IS NULL AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?) AND NOT (c.company_id IS NULL AND EXISTS (SELECT 1 FROM fa_classes x WHERE x.company_id = ? AND x.code = c.code AND x.deleted_at IS NULL)) ORDER BY code").all(actor.companyId, todayIST(), todayIST(), actor.companyId).map((c) => ({ code: c.code, name: c.name, method: c.book_method, lifeMonths: c.useful_life_months, residualPct: c.residual_bp / 100, taxBlock: c.tax_block, taxRate: c.tax_rate_bp / 100, assetAccount: c.asset_account_code, accumAccount: c.accum_account_code, legalRef: c.legal_ref })); };

  // ---- the register ----
  const calcOf = (r) => ({ cost: r.cost_paise, residual: r.residual_paise, lifeMonths: r.useful_life_months, method: r.book_method, accumulated: r.accumulated_dep_paise, fyBase: r.fy_base_paise ?? r.cost_paise - r.opening_accum_paise });
  /** The WDV base of the year an asset's next day falls in: the written-down value at the start of that year (the cost in the year it was capitalised). */
  function baseFor(r, day) { const fy = fyOf(day); if (r.fy_base_year === fy && r.fy_base_paise != null) return r.fy_base_paise; return r.cost_paise - r.accumulated_dep_paise; }
  function rollFy(r, day) { const fy = fyOf(day); if (r.fy_base_year !== fy) { const b = r.cost_paise - r.accumulated_dep_paise; db.prepare('UPDATE fa_assets SET fy_base_paise = ?, fy_base_year = ? WHERE id = ?').run(b, fy, r.id); r.fy_base_paise = b; r.fy_base_year = fy; } }
  /** Book depreciation of one asset for [from, to] (split at 1 April so each year has its own WDV base). */
  function depOf(r, from, to) {
    const start = [from, r.cap_date, r.dep_until ? addDays(r.dep_until, 1) : from].sort().at(-1); const end = r.disposed_on ? [to, addDays(r.disposed_on, -1)].sort()[0] : to; if (end < start) return 0;
    let total = 0; let acc = r.accumulated_dep_paise; let s = start;
    while (s <= end) { const fyEnd = `${Number(fyStart(s).slice(0, 4)) + 1}-03-31`; const e = end < fyEnd ? end : fyEnd; const base0 = fyOf(s) === r.fy_base_year && r.fy_base_paise != null ? r.fy_base_paise : r.cost_paise - acc; const d = depFor({ ...calcOf(r), accumulated: acc, fyBase: base0 }, s, e); total += d; acc += d; s = addDays(e, 1); }
    return total;
  }
  const projOf = (id) => (id ? db.prepare('SELECT code, name FROM org_projects WHERE id = ?').get(id) : null);
  function assetView(actor, r, detail = false) {
    const c = r.class_code ? classOf(r.company_id, r.class_code, r.cap_date) : null; const p = projOf(r.org_project_id);
    const o = { id: r.id, docNo: r.doc_no, assetNo: r.asset_no, classCode: r.class_code, className: c?.name ?? r.class_code, description: r.description, cost: rs(r.cost_paise), capDate: r.cap_date, projectId: r.org_project_id, project: p ? `${p.code} ${p.name}` : null, siteId: r.org_site_id, custodian: r.custodian, equipmentId: r.equipment_id, smallAssetId: r.small_asset_id, source: r.cap_source, sourceLabel: SOURCES[r.cap_source], sourceBillId: r.source_bill_id, cwipId: r.cwip_id,
      lifeMonths: r.useful_life_months, residual: rs(r.residual_paise), method: r.book_method, wdvRatePct: r.book_method === 'WDV' ? Math.round(wdvRate(r.cost_paise, r.residual_paise, r.useful_life_months) * 1_000_000) / 10_000 : null, taxBlock: r.tax_block, taxRate: r.tax_rate_bp / 100, openingAccum: rs(r.opening_accum_paise), accumulated: rs(r.accumulated_dep_paise), wdv: rs(r.wdv_paise), depUntil: r.dep_until, state: r.asset_state, disposedOn: r.disposed_on, lastVerifiedOn: r.last_verified_on, hsn: r.hsn_code, qr: `FA:${r.doc_no}`,
      status: r.status, statusLabel: STATUS[r.status], journalId: r.journal_id, version: r.version, can: { ...aFlow.can(actor, r), transfer: r.asset_state === 'IN_USE' && may(actor, 'fin.asset.transfer', r.org_project_id), dispose: r.asset_state === 'IN_USE' && may(actor, 'fin.disposal.create', r.org_project_id) && !db.prepare("SELECT 1 FROM fa_disposals WHERE asset_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL").get(r.id) } };
    if (detail) {
      Object.assign(o.can, aFlow.approveInfo(actor, r)); o.history = aFlow.history(actor, r.id);
      o.depreciation = db.prepare('SELECT * FROM fa_depreciation WHERE asset_id = ? AND deleted_at IS NULL ORDER BY from_date').all(r.id).map((d) => ({ period: d.period, from: d.from_date, to: d.to_date, dep: rs(d.book_dep_paise), wdvAfter: rs(d.wdv_after_paise), kind: d.dep_kind, journalId: d.posted_journal_id, posted: true }));
      // the schedule ahead: the months to come until the residual value or 24 months
      if (r.asset_state === 'IN_USE') { const x = { ...r }; let p = (x.dep_until ? addDays(x.dep_until, 1) : x.cap_date).slice(0, 7); for (let k = 0; k < 24 && x.cost_paise - x.residual_paise - x.accumulated_dep_paise > 0; k += 1, p = addMonths(p, 1)) { const from = `${p}-01`; const to = monthEnd(p); if (fyOf(from) !== x.fy_base_year) { x.fy_base_paise = x.cost_paise - x.accumulated_dep_paise; x.fy_base_year = fyOf(from); } const d = depOf(x, from, to); x.accumulated_dep_paise += d; x.dep_until = to; o.depreciation.push({ period: p, from: [from, r.cap_date].sort().at(-1), to, dep: rs(d), wdvAfter: rs(x.cost_paise - x.accumulated_dep_paise), kind: 'MONTHLY', posted: false }); } }
      o.transfers = db.prepare('SELECT * FROM fa_transfers WHERE asset_id = ? AND deleted_at IS NULL ORDER BY id DESC').all(r.id).map((t) => ({ docNo: t.doc_no, date: t.transfer_date, from: projOf(t.from_project_id)?.code ?? null, to: projOf(t.to_project_id)?.code ?? null, fromCustodian: t.from_custodian, toCustodian: t.to_custodian, reason: t.reason }));
      o.disposals = db.prepare('SELECT * FROM fa_disposals WHERE asset_id = ? AND deleted_at IS NULL ORDER BY id DESC').all(r.id).map((d) => dispView(actor, d));
    }
    return o;
  }
  const scope = (actor, key) => { need(actor, key, 'see fixed assets'); const f = authz.scopeFilter(actor, key, { project: 'x.org_project_id', site: 'x.org_site_id' }); return `x.company_id = :c AND ${f.sql}`; };

  // ---- FR-02: capitalisation (approved by the accounts manager and the CFO) ----
  const aFlow = createFlow({ db, base, docType: ASSET_DOC, table: 'fa_assets', perm: 'fin.asset', label: 'fixed asset', route: '/finance/assets?id=', where: (r) => ({ pid: r.org_project_id ?? null, sid: r.org_site_id ?? null }),
    ctx: (r) => ({ total: rs(r.cost_paise), makerRole: rolesOf(r.company_id, r.requested_by).includes('ACCMGR') ? 'ACCMGR' : 'OTHER' }), title: (r) => `${r.description} ₹${rs(r.cost_paise)} (${SOURCES[r.cap_source]})`, notifyCode: 'fin.fa.decided', prefix: 'FA',
    beforeSubmit: (_a, r) => { const p = checkAsset(r.company_id, r, r.id); if (p.length) throw badRequest('Correct the highlighted fields', p); },
    onApproved: (actor, r) => {
      const x = db.prepare('SELECT * FROM fa_assets WHERE id = ?').get(r.id); const c = classOf(x.company_id, x.class_code, x.cap_date); let jid = null;
      if (x.cap_source === 'CWIP') { const j = gl.postEngine(x.company_id, { voucherType: 'JV', date: x.cap_date, narration: `Capitalised from CWIP: ${x.doc_no} ${x.description}`.slice(0, 500), sourceType: 'fa_assets', sourceId: x.id, lines: [{ accountId: acct(x.company_id, c.asset_account_code), debit: rs(x.cost_paise), ...projectFor(acct(x.company_id, c.asset_account_code), x.org_project_id) }, { accountId: acct(x.company_id, '115001'), credit: rs(x.cost_paise), ...projectFor(acct(x.company_id, '115001'), x.org_project_id) }], user: actor.user }); jid = j.journal.id;
        const cw = db.prepare('SELECT * FROM fa_cwip WHERE id = ?').get(x.cwip_id); db.prepare("UPDATE fa_cwip SET settled_paise = settled_paise + ?, cwip_status = CASE WHEN settled_paise + ? >= cost_paise THEN 'SETTLED' ELSE 'OPEN' END, updated_at = ?, version = version + 1 WHERE id = ?").run(x.cost_paise, x.cost_paise, nowIso(), cw.id); }
      db.prepare("UPDATE fa_assets SET asset_no = doc_no, asset_state = 'IN_USE', accumulated_dep_paise = opening_accum_paise, wdv_paise = cost_paise - opening_accum_paise, fy_base_paise = cost_paise - opening_accum_paise, fy_base_year = ?, journal_id = ? WHERE id = ?").run(fyOf(x.cap_date), jid, x.id);
      evt('fin.asset.capitalised', actor, x.company_id, 'fa_assets', x.id, { assetId: x.id, docNo: x.doc_no, classCode: x.class_code, cost: rs(x.cost_paise), capDate: x.cap_date, projectId: x.org_project_id, equipmentId: x.equipment_id, smallAssetId: x.small_asset_id, source: x.cap_source, journalId: jid });
    },
  });
  /** The checks of an asset before it is sent: its source, its class, its cost within what the source holds. */
  function checkAsset(companyId, r, selfId = null) {
    const p = []; const c = classOf(companyId, r.class_code, r.cap_date); if (!c) p.push({ field: 'classCode', message: 'Choose an asset class in force on the date.' });
    if (r.book_method === 'WDV' && !(r.residual_paise > 0)) p.push({ field: 'residual', message: 'The WDV method needs a residual value above nothing.' });
    if (r.residual_paise >= r.cost_paise) p.push({ field: 'residual', message: 'The residual value is less than the cost.' });
    if (r.cap_date > todayIST()) p.push({ field: 'capDate', message: 'An asset is capitalised when put to use, not in the future.' });
    const others = (col, v) => db.prepare(`SELECT COALESCE(SUM(cost_paise), 0) AS s FROM fa_assets WHERE ${col} = ? AND id <> ? AND status NOT IN ('CANCELLED', 'REJECTED') AND deleted_at IS NULL`).get(v, selfId ?? 0).s;
    if (r.cap_source === 'AP_BILL') { const b = db.prepare('SELECT b.*, a.account_type FROM ap_bills b LEFT JOIN fin_accounts a ON a.id = b.expense_account_id WHERE b.id = ? AND b.company_id = ?').get(r.source_bill_id, companyId); if (!b || b.status !== 'APPROVED') p.push({ field: 'billId', message: 'Choose an approved AP bill.' }); else if (b.account_type !== 'FIXED_ASSET') p.push({ field: 'billId', message: 'The bill is not booked to a fixed-asset account: book it to CWIP and settle it, or correct the bill.' }); else if (others('source_bill_id', b.id) + r.cost_paise > b.gross_paise) p.push({ field: 'cost', message: `The bill holds ₹${rs(b.gross_paise - others('source_bill_id', b.id))} not yet capitalised.` }); }
    if (r.cap_source === 'CWIP') { const w = db.prepare('SELECT * FROM fa_cwip WHERE id = ? AND company_id = ?').get(r.cwip_id, companyId); if (!w) p.push({ field: 'cwipId', message: 'Choose a CWIP.' }); else if (others('cwip_id', w.id) + r.cost_paise > w.cost_paise - 0) p.push({ field: 'cost', message: `The CWIP holds ₹${rs(w.cost_paise - others('cwip_id', w.id))} not yet settled.` }); }
    if (r.cap_source === 'OPENING' && r.opening_accum_paise >= r.cost_paise) p.push({ field: 'openingAccum', message: 'The depreciation to date is less than the cost.' });
    return p;
  }
  function valuesOf(actor, b, cur = null) {
    const c = actor.companyId; const v = { cap_source: b.source ?? cur?.cap_source, class_code: b.classCode ?? cur?.class_code, description: b.description ?? cur?.description, cap_date: b.capDate ?? cur?.cap_date, org_project_id: b.projectId !== undefined ? b.projectId : cur?.org_project_id ?? null, org_site_id: b.siteId !== undefined ? b.siteId : cur?.org_site_id ?? null, custodian: b.custodian !== undefined ? b.custodian : cur?.custodian ?? null, source_bill_id: b.billId ?? cur?.source_bill_id ?? null, cwip_id: b.cwipId ?? cur?.cwip_id ?? null, equipment_id: b.equipmentId ?? cur?.equipment_id ?? null, small_asset_id: b.smallAssetId ?? cur?.small_asset_id ?? null, hsn_code: b.hsn ?? cur?.hsn_code ?? null, opening_accum_paise: b.openingAccum != null ? paise(b.openingAccum) : cur?.opening_accum_paise ?? 0 };
    // what the source says, when not given
    let cost = b.cost != null ? paise(b.cost) : cur?.cost_paise ?? null;
    if (v.cap_source === 'AP_BILL' && v.source_bill_id) { const bl = db.prepare('SELECT gross_paise, bill_date, org_project_id, description, payee_name, bill_no FROM ap_bills WHERE id = ? AND company_id = ?').get(v.source_bill_id, c); if (bl) { cost ??= bl.gross_paise; v.cap_date ??= bl.bill_date; v.org_project_id ??= bl.org_project_id; v.description ??= bl.description ?? `${bl.payee_name} bill ${bl.bill_no}`; } }
    if (v.cap_source === 'CWIP' && v.cwip_id) { const w = db.prepare('SELECT * FROM fa_cwip WHERE id = ? AND company_id = ?').get(v.cwip_id, c); if (w) { cost ??= w.cost_paise - w.settled_paise; v.org_project_id ??= w.org_project_id; v.description ??= w.title; } }
    if (v.cap_source === 'EQUIPMENT' && v.equipment_id) { const e = db.prepare('SELECT * FROM plt_equipment WHERE id = ? AND company_id = ?').get(v.equipment_id, c); if (!e) throw notFound('That machine is not in the equipment register.'); if (e.ownership !== 'OWNED') throw unprocessable('Only owned equipment is capitalised.'); cost ??= e.purchase_value; v.cap_date ??= e.purchase_date; v.org_project_id ??= e.org_project_id; v.org_site_id ??= e.org_site_id; v.description ??= `${e.asset_code} ${e.make ?? ''} ${e.model ?? ''}`.trim(); }
    if (v.cap_source === 'SMALL_ASSET' && v.small_asset_id) { const s = db.prepare('SELECT * FROM ast_small_assets WHERE id = ? AND company_id = ?').get(v.small_asset_id, c); if (!s) throw notFound('That small asset does not exist.'); cost ??= s.asset_value; v.cap_date ??= s.purchase_date; v.org_project_id ??= s.org_project_id; v.custodian ??= s.custodian_name; v.description ??= `${s.tag_code} ${s.make ?? ''} ${s.model ?? ''}`.trim(); }
    const k = classOf(c, v.class_code, v.cap_date ?? todayIST()); if (!k) throw badRequest('Correct the highlighted fields', [{ field: 'classCode', message: 'Choose an asset class.' }]);
    if (!(cost > 0)) throw badRequest('Correct the highlighted fields', [{ field: 'cost', message: 'Give the cost.' }]); if (!v.cap_date) throw badRequest('Correct the highlighted fields', [{ field: 'capDate', message: 'Give the date the asset was put to use.' }]); if (!v.description) throw badRequest('Correct the highlighted fields', [{ field: 'description', message: 'Describe the asset.' }]);
    const sameClass = cur && cur.class_code === v.class_code; const life = b.usefulLifeMonths ?? (sameClass ? cur.useful_life_months : null) ?? k.useful_life_months; const method = b.method ?? (sameClass ? cur.book_method : null) ?? k.book_method;
    const residual = b.residual != null ? paise(b.residual) : sameClass && b.cost == null ? cur.residual_paise : Math.round((cost * k.residual_bp) / 10000);
    return { ...v, cost_paise: cost, useful_life_months: life, book_method: method, residual_paise: residual, tax_block: k.tax_block, tax_rate_bp: k.tax_rate_bp, wdv_rate_bp: method === 'WDV' ? Math.round(wdvRate(cost, residual, life) * 10000) : 0 };
  }
  const assets = {
    flow: aFlow, classes, classOf,
    list(actor, query) { return runList(db, faList, parseListRequest(faList, query), { select: 'x.*', scopeSql: scope(actor, 'fin.asset.view'), params: { c: actor.companyId }, tieBreaker: 'x.id', map: (r) => assetView(actor, r) }); },
    get(actor, id) { return assetView(actor, aFlow.row(actor, id), true); },
    create(actor, b) {
      need(actor, 'fin.asset.create', 'register fixed assets', b.projectId ?? null); const v = valuesOf(actor, b); const p = checkAsset(actor.companyId, v); if (p.length) throw badRequest('Correct the highlighted fields', p);
      return transaction(db, () => { const cols = Object.keys(v); const id = Number(db.prepare(`INSERT INTO fa_assets (company_id, doc_no, ${cols.join(', ')}, requested_by, created_by, source_type, source_id) VALUES (?, ?, ${cols.map(() => '?').join(', ')}, ?, ?, ?, ?)`).run(actor.companyId, aFlow.next(actor), ...cols.map((k) => v[k]), actor.user, actor.user, v.cap_source === 'AP_BILL' ? 'ap_bills' : v.cap_source === 'CWIP' ? 'fa_cwip' : v.cap_source === 'EQUIPMENT' ? 'plt_equipment' : v.cap_source === 'SMALL_ASSET' ? 'ast_small_assets' : null, String(v.source_bill_id ?? v.cwip_id ?? v.equipment_id ?? v.small_asset_id ?? '') || null).lastInsertRowid);
        audit(actor, 'fa_assets', id, 'create', actor.companyId, { newValues: { source: v.cap_source, cost: rs(v.cost_paise), classCode: v.class_code } }); return assets.get(actor, id); });
    },
    update(actor, id, b) {
      const r = aFlow.row(actor, id, 'fin.asset.edit'); if (!['DRAFT', 'RETURNED'].includes(r.status)) throw conflict('Only a draft or a returned asset is changed.'); if (b.version !== r.version) throw conflict('Someone changed this asset meanwhile: reload it.');
      const v = valuesOf(actor, b, r); const p = checkAsset(r.company_id, v, r.id); if (p.length) throw badRequest('Correct the highlighted fields', p);
      const cols = Object.keys(v); db.prepare(`UPDATE fa_assets SET ${cols.map((k) => `${k} = ?`).join(', ')}, requested_by = CASE WHEN requested_by = 'system' THEN ? ELSE requested_by END, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(...cols.map((k) => v[k]), actor.user, actor.user, nowIso(), r.id);
      audit(actor, 'fa_assets', r.id, 'update', r.company_id, { oldValues: { cost: rs(r.cost_paise), classCode: r.class_code }, newValues: { cost: rs(v.cost_paise), classCode: v.class_code } }); return assets.get(actor, r.id);
    },
    remove: (actor, id) => aFlow.remove(actor, id),
    submit(actor, id) { aFlow.submit(actor, id); return assets.get(actor, id); },
    withdraw(actor, id, b) { aFlow.withdraw(actor, id, b); return assets.get(actor, id); },
    cancel(actor, id, b) { aFlow.cancel(actor, id, b); return assets.get(actor, id); },
    history: (actor, id) => aFlow.history(actor, id),
    amend(actor, id) { aFlow.row(actor, id, 'fin.asset.amend'); throw unprocessable('A capitalised asset is not amended: its cost changes through a disposal of part or a new asset for the addition (component accounting), so the posted depreciation stays as it was.'); },
    /** FR-04: moved to another project, site or custodian (depreciation from the next run goes to the new project). */
    transfer(actor, id, b) {
      const r = aFlow.row(actor, id, 'fin.asset.transfer'); if (r.asset_state !== 'IN_USE') throw conflict('Only an asset in use is transferred.'); if (b.version !== r.version) throw conflict('Someone changed this asset meanwhile: reload it.');
      if (b.toProjectId) { const p = db.prepare('SELECT id FROM org_projects WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(b.toProjectId, r.company_id); if (!p) throw badRequest('Correct the highlighted fields', [{ field: 'toProjectId', message: 'Choose a project of the company.' }]); if (!may(actor, 'fin.asset.transfer', b.toProjectId)) throw forbidden('You may not move assets to that project.'); }
      return transaction(db, () => { const tid = Number(db.prepare('INSERT INTO fa_transfers (company_id, doc_no, asset_id, transfer_date, from_project_id, to_project_id, from_site_id, to_site_id, from_custodian, to_custodian, reason, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(r.company_id, docNo(r.company_id, 'fa_transfers', 'FAT'), r.id, b.date, r.org_project_id, b.toProjectId ?? r.org_project_id, r.org_site_id, b.toSiteId ?? null, r.custodian, b.toCustodian ?? r.custodian, b.reason, actor.user).lastInsertRowid);
        db.prepare('UPDATE fa_assets SET org_project_id = ?, org_site_id = ?, custodian = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.toProjectId ?? r.org_project_id, b.toSiteId ?? null, b.toCustodian ?? r.custodian, actor.user, nowIso(), r.id); audit(actor, 'fa_assets', r.id, 'transfer', r.company_id, { oldValues: { projectId: r.org_project_id, custodian: r.custodian }, newValues: { projectId: b.toProjectId ?? r.org_project_id, custodian: b.toCustodian ?? r.custodian }, reason: b.reason });
        evt('fin.asset.transferred', actor, r.company_id, 'fa_assets', r.id, { assetId: r.id, transferId: tid, fromProjectId: r.org_project_id, toProjectId: b.toProjectId ?? r.org_project_id, toCustodian: b.toCustodian ?? r.custodian, equipmentId: r.equipment_id, date: b.date }); return assets.get(actor, r.id); });
    },
    exportCsv(actor, query = {}) { need(actor, 'fin.asset.export', 'export fixed assets'); const l = assets.list(actor, { ...query, page: 1, pageSize: 100 }); audit(actor, 'fa_assets', 0, 'export', actor.companyId, { reason: `${l.data.length} row(s)` }); return { contentType: 'text/csv; charset=utf-8', fileName: `fixed-assets-${todayIST()}.csv`, buffer: Buffer.from(`${String.fromCharCode(0xfeff)}${toCsv(['Asset', 'Description', 'Class', 'Project', 'Custodian', 'Put to use', 'Cost', 'Depreciation to date', 'Net book value', 'Method', 'From', 'State', 'Approval'], l.data.map((x) => [x.docNo, x.description, x.classCode, x.project ?? '', x.custodian ?? '', x.capDate, x.cost, x.accumulated, x.wdv, x.method, x.sourceLabel, x.state, x.statusLabel]))}`, 'utf8') }; },
    print(actor, id) { const r = aFlow.row(actor, id, 'fin.asset.print'); const v = assets.get(actor, r.id); audit(actor, 'fa_assets', r.id, 'print', r.company_id); return { contentType: 'application/pdf', fileName: `${v.docNo.replaceAll('/', '-')}.pdf`, buffer: toPdf({ title: `Fixed asset ${v.docNo}`, columns: [{ key: 'p', label: 'Period' }, { key: 'f', label: 'From' }, { key: 't', label: 'To' }, { key: 'd', label: 'Depreciation' }, { key: 'w', label: 'Net book value after' }, { key: 's', label: 'Posted' }], rows: v.depreciation.map((d) => ({ p: d.period, f: d.from, t: d.to, d: d.dep, w: d.wdvAfter, s: d.posted ? 'yes' : 'projected' })), footer: [`${v.description} · ${v.className} · cost ${v.cost} · put to use ${v.capDate} · ${v.method}${v.wdvRatePct ? ` ${v.wdvRatePct}%` : ''} over ${v.lifeMonths} months, residual ${v.residual} · ${v.qr}`] }) }; },
    /** What may be capitalised: approved AP bills on fixed-asset accounts not yet fully capitalised, open CWIP, owned machines and small assets without an asset. */
    sources(actor) {
      need(actor, 'fin.asset.create', 'register fixed assets'); const c = actor.companyId;
      const bills = db.prepare("SELECT b.id, b.doc_no, b.bill_no, b.bill_date, b.payee_name, b.gross_paise, b.org_project_id, a.code AS account, (SELECT COALESCE(SUM(f.cost_paise), 0) FROM fa_assets f WHERE f.source_bill_id = b.id AND f.status NOT IN ('CANCELLED', 'REJECTED') AND f.deleted_at IS NULL) AS used, (SELECT 1 FROM fa_cwip_lines l WHERE l.bill_id = b.id AND l.deleted_at IS NULL) AS in_cwip FROM ap_bills b JOIN fin_accounts a ON a.id = b.expense_account_id WHERE b.company_id = ? AND b.status = 'APPROVED' AND a.account_type = 'FIXED_ASSET' AND b.deleted_at IS NULL ORDER BY b.bill_date DESC LIMIT 200").all(c);
      return { bills: bills.filter((b) => b.account !== '115001' && b.gross_paise > b.used).map((b) => ({ id: b.id, docNo: b.doc_no, billNo: b.bill_no, date: b.bill_date, payee: b.payee_name, left: rs(b.gross_paise - b.used), account: b.account })),
        cwipBills: bills.filter((b) => b.account === '115001' && !b.in_cwip).map((b) => ({ id: b.id, docNo: b.doc_no, billNo: b.bill_no, date: b.bill_date, payee: b.payee_name, amount: rs(b.gross_paise), projectId: b.org_project_id })),
        cwip: db.prepare("SELECT * FROM fa_cwip WHERE company_id = ? AND cwip_status = 'OPEN' AND deleted_at IS NULL ORDER BY id DESC").all(c).map((w) => ({ id: w.id, docNo: w.doc_no, title: w.title, cost: rs(w.cost_paise), settled: rs(w.settled_paise), left: rs(w.cost_paise - w.settled_paise), projectId: w.org_project_id })),
        equipment: db.prepare("SELECT e.id, e.doc_no, e.asset_code, e.make, e.model, e.purchase_value, e.purchase_date FROM plt_equipment e WHERE e.company_id = ? AND e.ownership = 'OWNED' AND e.status = 'APPROVED' AND e.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM fa_assets f WHERE f.equipment_id = e.id AND f.status NOT IN ('CANCELLED', 'REJECTED') AND f.deleted_at IS NULL) ORDER BY e.id DESC LIMIT 200").all(c).map((e) => ({ id: e.id, docNo: e.doc_no, label: `${e.asset_code} ${e.make ?? ''} ${e.model ?? ''}`.trim(), value: rs(e.purchase_value), date: e.purchase_date })),
        smallAssets: db.prepare("SELECT s.id, s.doc_no, s.tag_code, s.make, s.model, s.asset_value, s.purchase_date FROM ast_small_assets s WHERE s.company_id = ? AND s.status = 'APPROVED' AND s.asset_value >= ? AND s.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM fa_assets f WHERE f.small_asset_id = s.id AND f.status NOT IN ('CANCELLED', 'REJECTED') AND f.deleted_at IS NULL) ORDER BY s.id DESC LIMIT 200").all(c, Number(param(c, 'fin.fa.capitalise_above') ?? 5000) * 100).map((s) => ({ id: s.id, docNo: s.doc_no, label: `${s.tag_code} ${s.make ?? ''} ${s.model ?? ''}`.trim(), value: rs(s.asset_value), date: s.purchase_date })),
        classes: classes(actor) };
    },
  };

  // ---- CWIP ----
  const cwip = {
    create(actor, { title, projectId, billIds }) {
      need(actor, 'fin.asset.create', 'gather capital work in progress'); const c = actor.companyId; if (!billIds?.length) throw badRequest('Correct the highlighted fields', [{ field: 'billIds', message: 'Choose the bills booked to CWIP.' }]);
      const bills = billIds.map((id) => db.prepare("SELECT b.*, a.code AS account FROM ap_bills b JOIN fin_accounts a ON a.id = b.expense_account_id WHERE b.id = ? AND b.company_id = ? AND b.status = 'APPROVED' AND b.deleted_at IS NULL").get(id, c));
      if (bills.some((b) => !b || b.account !== '115001')) throw badRequest('Correct the highlighted fields', [{ field: 'billIds', message: 'Only approved bills booked to capital work in progress (115001).' }]);
      return transaction(db, () => { const cost = bills.reduce((a, b) => a + b.gross_paise, 0); const id = Number(db.prepare('INSERT INTO fa_cwip (company_id, doc_no, title, org_project_id, cost_paise, created_by) VALUES (?, ?, ?, ?, ?, ?)').run(c, docNo(c, 'fa_cwip', 'CWIP'), title, projectId ?? null, cost, actor.user).lastInsertRowid);
        for (const b of bills) { try { db.prepare('INSERT INTO fa_cwip_lines (company_id, cwip_id, bill_id, amount_paise, created_by) VALUES (?, ?, ?, ?, ?)').run(c, id, b.id, b.gross_paise, actor.user); } catch { throw conflict(`Bill ${b.doc_no} is already in a CWIP.`); } }
        audit(actor, 'fa_cwip', id, 'create', c, { newValues: { title, cost: rs(cost), bills: bills.length } }); return { id, docNo: db.prepare('SELECT doc_no FROM fa_cwip WHERE id = ?').get(id).doc_no, cost: rs(cost) }; });
    },
  };

  // ---- FR-03: the depreciation run (BR-01: once a period) ----
  function runLines(companyId, period) {
    const from = `${period}-01`; const to = monthEnd(period);
    const rows = db.prepare("SELECT * FROM fa_assets WHERE company_id = ? AND status = 'APPROVED' AND asset_state = 'IN_USE' AND cap_date <= ? AND deleted_at IS NULL ORDER BY id").all(companyId, to);
    return rows.map((r) => { const x = { ...r }; if (fyOf(from) !== x.fy_base_year) { x.fy_base_paise = x.cost_paise - x.accumulated_dep_paise; x.fy_base_year = fyOf(from); } return { r: x, dep: depOf(x, from, to), from: [from, r.cap_date].sort().at(-1), to }; }).filter((l) => l.dep > 0);
  }
  const periodId = (companyId, date) => db.prepare('SELECT id FROM core_periods WHERE company_id = ? AND start_date <= ? AND end_date >= ? AND deleted_at IS NULL ORDER BY id LIMIT 1').get(companyId, date, date)?.id ?? null;
  const depreciation = {
    preview(actor, { period }) {
      need(actor, 'fin.depreciation.view', 'see depreciation'); const c = actor.companyId; const ls = runLines(c, period); const done = db.prepare('SELECT * FROM fa_dep_runs WHERE company_id = ? AND period = ? AND deleted_at IS NULL').get(c, period); const last = db.prepare('SELECT MAX(period) AS p FROM fa_dep_runs WHERE company_id = ? AND deleted_at IS NULL').get(c).p;
      const byClass = new Map(); for (const l of ls) byClass.set(l.r.class_code, (byClass.get(l.r.class_code) ?? 0) + l.dep);
      return { period, lastRun: last, done: done ? { docNo: done.doc_no, total: rs(done.total_paise), assets: done.assets_count, journalId: done.journal_id, by: done.run_by, at: done.created_at } : null, canRun: !done && (!last || period > last) && period <= todayIST().slice(0, 7) && may(actor, 'fin.depreciation.run'),
        lines: done ? db.prepare('SELECT d.*, a.doc_no, a.description, a.class_code FROM fa_depreciation d JOIN fa_assets a ON a.id = d.asset_id WHERE d.run_id = ? ORDER BY a.id').all(done.id).map((d) => ({ assetId: d.asset_id, docNo: d.doc_no, description: d.description, classCode: d.class_code, from: d.from_date, to: d.to_date, dep: rs(d.book_dep_paise), wdvAfter: rs(d.wdv_after_paise) })) : ls.map((l) => ({ assetId: l.r.id, docNo: l.r.doc_no, description: l.r.description, classCode: l.r.class_code, projectId: l.r.org_project_id, from: l.from, to: l.to, dep: rs(l.dep), wdvAfter: rs(l.r.cost_paise - l.r.accumulated_dep_paise - l.dep) })),
        byClass: [...byClass.entries()].map(([k, v]) => ({ classCode: k, dep: rs(v) })), total: rs(done ? done.total_paise : ls.reduce((a, l) => a + l.dep, 0)) };
    },
    run(actor, { period }) {
      need(actor, 'fin.depreciation.run', 'run depreciation'); const c = actor.companyId; const to = monthEnd(period);
      if (period > todayIST().slice(0, 7)) throw unprocessable('A month is depreciated once it has begun.');
      if (db.prepare('SELECT 1 FROM fa_dep_runs WHERE company_id = ? AND period = ? AND deleted_at IS NULL').get(c, period)) throw conflict(`The depreciation of ${period} is already run (BR-01: once a period).`);
      const later = db.prepare('SELECT MAX(period) AS p FROM fa_dep_runs WHERE company_id = ? AND deleted_at IS NULL').get(c).p; if (later && later > period) throw conflict(`The depreciation of ${later} is already run: an earlier month is not run after it.`);
      return transaction(db, () => {
        const ls = runLines(c, period); const total = ls.reduce((a, l) => a + l.dep, 0); const pid = periodId(c, to);
        const runId = Number(db.prepare('INSERT INTO fa_dep_runs (company_id, doc_no, period, period_id, assets_count, total_paise, run_by, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(c, docNo(c, 'fa_dep_runs', 'DEP'), period, pid, ls.length, total, actor.user, actor.user).lastInsertRowid);
        let jid = null;
        if (total > 0) {
          const dr = new Map(); const cr = new Map(); for (const l of ls) { const k = classOf(c, l.r.class_code, l.r.cap_date); const pk = l.r.org_project_id ?? 0; dr.set(pk, (dr.get(pk) ?? 0) + l.dep); cr.set(k.accum_account_code, (cr.get(k.accum_account_code) ?? 0) + l.dep); }
          const dep = acct(c, '550001'); const lines = [...[...dr.entries()].map(([p, v]) => ({ accountId: dep, debit: rs(v), ...projectFor(dep, p || null) })), ...[...cr.entries()].map(([code, v]) => ({ accountId: acct(c, code), credit: rs(v) }))];
          const j = gl.postEngine(c, { voucherType: 'JV', date: to, narration: `Depreciation for ${period} (${ls.length} asset(s))`, sourceType: 'fa_dep_runs', sourceId: runId, lines, user: actor.user }); jid = j.journal.id;
          db.prepare('UPDATE fa_dep_runs SET journal_id = ? WHERE id = ?').run(jid, runId);
        }
        const ins = db.prepare("INSERT INTO fa_depreciation (company_id, asset_id, run_id, period, period_id, from_date, to_date, book_dep_paise, wdv_after_paise, dep_kind, posted_journal_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'MONTHLY', ?, ?)");
        for (const l of ls) { rollFy(l.r, l.from); ins.run(c, l.r.id, runId, period, pid, l.from, l.to, l.dep, l.r.cost_paise - l.r.accumulated_dep_paise - l.dep, jid, actor.user); db.prepare('UPDATE fa_assets SET accumulated_dep_paise = accumulated_dep_paise + ?, wdv_paise = wdv_paise - ?, dep_until = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(l.dep, l.dep, to, nowIso(), l.r.id); }
        // assets with nothing to charge this month still move on
        db.prepare("UPDATE fa_assets SET dep_until = ? WHERE company_id = ? AND status = 'APPROVED' AND asset_state = 'IN_USE' AND cap_date <= ? AND (dep_until IS NULL OR dep_until < ?)").run(to, c, to, to);
        audit(actor, 'fa_dep_runs', runId, 'run', c, { reason: `${period}: ${ls.length} asset(s), ₹${rs(total)}` });
        evt('fin.depreciation.posted', actor, c, 'fa_dep_runs', runId, { runId, period, total: rs(total), journalId: jid, assets: ls.map((l) => ({ assetId: l.r.id, equipmentId: l.r.equipment_id, smallAssetId: l.r.small_asset_id, projectId: l.r.org_project_id, siteId: l.r.org_site_id, classCode: l.r.class_code, amount: rs(l.dep) })) });
        return depreciation.preview(actor, { period });
      });
    },
  };

  // ---- FR-05: disposal (approval by amount; depreciation to the day before; gain or loss) ----
  const dirAbove = (c) => Number(param(c, 'fin.fa.disposal_dir_above') ?? 1000000) * 100;
  function disposalValues(companyId, a, b) {
    const depTo = depOf({ ...a, disposed_on: b.date }, a.dep_until ? addDays(a.dep_until, 1) : a.cap_date, addDays(b.date, -1)); const wdv = a.cost_paise - a.accumulated_dep_paise - depTo;
    const proceeds = b.method === 'WRITE_OFF' ? 0 : paise(b.proceeds ?? 0); let gst = 0;
    if (b.method !== 'WRITE_OFF' && proceeds > 0 && b.hsn && tax() && tax().ownGstins(companyId)[0]) { const own = tax().ownGstins(companyId)[0]; const buyer = b.buyerPartnerId ? db.prepare("SELECT gstin FROM mdm_partner_gstins WHERE partner_id = ? AND gstin_status = 'ACTIVE' AND deleted_at IS NULL ORDER BY id LIMIT 1").get(b.buyerPartnerId)?.gstin : null; const t = tax().resolveFor(companyId, { docDate: b.date, supplierGstin: own.gstin, recipientGstin: buyer ?? null, supplyKind: buyer ? 'B2B' : 'B2C', lines: [{ hsn: b.hsn, taxable: rs(proceeds) }] }); gst = paise(t.totals.tax); }
    return { depTo, wdv, proceeds, gst, gain: proceeds - wdv };
  }
  const dFlow = createFlow({ db, base, docType: DISPOSAL_DOC, table: 'fa_disposals', perm: 'fin.disposal', label: 'disposal', route: '/finance/assets?disposal=', where: (r) => { const a = db.prepare('SELECT org_project_id, org_site_id FROM fa_assets WHERE id = ?').get(r.asset_id); return { pid: a?.org_project_id ?? null, sid: a?.org_site_id ?? null }; },
    ctx: (r) => ({ total: rs(Math.max(r.wdv_paise, r.proceeds_paise)), aboveDir: Math.max(r.wdv_paise, r.proceeds_paise) > dirAbove(r.company_id) ? 'yes' : 'no', makerRole: rolesOf(r.company_id, r.requested_by).includes('ACCMGR') ? 'ACCMGR' : 'OTHER' }), title: (r) => `${METHODS[r.method]} of asset ${r.asset_id}: WDV ₹${rs(r.wdv_paise)}, proceeds ₹${rs(r.proceeds_paise)}`, notifyCode: 'fin.fa.decided', prefix: 'FAD',
    beforeSubmit: (_a, r) => { const a = db.prepare('SELECT * FROM fa_assets WHERE id = ?').get(r.asset_id); if (a.asset_state !== 'IN_USE') throw conflict('The asset is not in use.'); if (r.disposal_date < (a.dep_until ?? a.cap_date) && a.dep_until) throw unprocessable(`The depreciation is already run to ${a.dep_until}: a disposal is dated after it.`); const v = disposalValues(r.company_id, a, { date: r.disposal_date, method: r.method, proceeds: rs(r.proceeds_paise), hsn: a.hsn_code, buyerPartnerId: r.buyer_partner_id }); db.prepare('UPDATE fa_disposals SET dep_to_date_paise = ?, wdv_paise = ?, gain_loss_paise = ?, gst_paise = ? WHERE id = ?').run(v.depTo, v.wdv, v.gain, v.gst, r.id); },
    onApproved: (actor, r) => {
      const d = db.prepare('SELECT * FROM fa_disposals WHERE id = ?').get(r.id); const a = db.prepare('SELECT * FROM fa_assets WHERE id = ?').get(d.asset_id); const c = d.company_id; const k = classOf(c, a.class_code, a.cap_date);
      const v = disposalValues(c, a, { date: d.disposal_date, method: d.method, proceeds: rs(d.proceeds_paise), hsn: a.hsn_code, buyerPartnerId: d.buyer_partner_id });
      const assetAcct = acct(c, k.asset_account_code); const accum = acct(c, k.accum_account_code); const dep = acct(c, '550001');
      const lines = [v.depTo > 0 ? { accountId: dep, debit: rs(v.depTo), ...projectFor(dep, a.org_project_id) } : null, a.accumulated_dep_paise > 0 ? { accountId: accum, debit: rs(a.accumulated_dep_paise) } : null, v.proceeds > 0 ? { accountId: acct(c, '160010'), debit: rs(v.proceeds) } : null,
        v.gain < 0 ? { accountId: acct(c, '560013'), debit: rs(-v.gain), ...projectFor(acct(c, '560013'), a.org_project_id) } : null, v.gain > 0 ? { accountId: acct(c, '420002'), credit: rs(v.gain) } : null, { accountId: assetAcct, credit: rs(a.cost_paise), ...projectFor(assetAcct, a.org_project_id) }].filter(Boolean);
      const j = gl.postEngine(c, { voucherType: 'JV', date: d.disposal_date, narration: `${METHODS[d.method]} of ${a.doc_no} ${a.description}: ${d.reason}`.slice(0, 500), sourceType: 'fa_disposals', sourceId: d.id, lines, user: actor.user });
      if (v.depTo > 0) db.prepare("INSERT INTO fa_depreciation (company_id, asset_id, period, period_id, from_date, to_date, book_dep_paise, wdv_after_paise, dep_kind, posted_journal_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'TO_DISPOSAL', ?, ?)").run(c, a.id, d.disposal_date.slice(0, 7), periodId(c, d.disposal_date), a.dep_until ? addDays(a.dep_until, 1) : a.cap_date, addDays(d.disposal_date, -1), v.depTo, v.wdv, j.journal.id, actor.user);
      db.prepare("UPDATE fa_disposals SET dep_to_date_paise = ?, wdv_paise = ?, gain_loss_paise = ?, gst_paise = ?, journal_id = ? WHERE id = ?").run(v.depTo, v.wdv, v.gain, v.gst, j.journal.id, d.id);
      db.prepare("UPDATE fa_assets SET asset_state = 'DISPOSED', disposed_on = ?, accumulated_dep_paise = accumulated_dep_paise + ?, wdv_paise = 0, dep_until = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(d.disposal_date, v.depTo, addDays(d.disposal_date, -1), nowIso(), a.id);
      evt('fin.asset.disposed', actor, c, 'fa_disposals', d.id, { disposalId: d.id, docNo: d.doc_no, assetId: a.id, assetNo: a.doc_no, description: a.description, equipmentId: a.equipment_id, smallAssetId: a.small_asset_id, projectId: a.org_project_id, method: d.method, date: d.disposal_date, buyerPartnerId: d.buyer_partner_id, proceeds: rs(v.proceeds), gst: rs(v.gst), wdv: rs(v.wdv), gainLoss: rs(v.gain), journalId: j.journal.id, requestedBy: d.requested_by, clearingAccountCode: '160010' });
    },
  });
  const dispView = (actor, d) => ({ id: d.id, docNo: d.doc_no, assetId: d.asset_id, date: d.disposal_date, method: d.method, methodLabel: METHODS[d.method], buyerPartnerId: d.buyer_partner_id, proceeds: rs(d.proceeds_paise), gst: rs(d.gst_paise), depToDate: rs(d.dep_to_date_paise), wdv: rs(d.wdv_paise), gainLoss: rs(d.gain_loss_paise), reason: d.reason, journalId: d.journal_id, arInvoiceRef: d.ar_invoice_ref, status: d.status, statusLabel: STATUS[d.status], version: d.version, can: { ...dFlow.can(actor, d), ...dFlow.approveInfo(actor, d) } });
  const disposals = {
    flow: dFlow,
    list(actor) { need(actor, 'fin.disposal.view', 'see disposals'); return db.prepare('SELECT * FROM fa_disposals WHERE company_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 200').all(actor.companyId).map((d) => dispView(actor, d)); },
    get(actor, id) { const d = dFlow.row(actor, id); return { ...dispView(actor, d), asset: assetView(actor, db.prepare('SELECT * FROM fa_assets WHERE id = ?').get(d.asset_id)), history: dFlow.history(actor, d.id) }; },
    create(actor, b) {
      const a = aFlow.row(actor, b.assetId); need(actor, 'fin.disposal.create', 'propose disposals', a.org_project_id); if (a.asset_state !== 'IN_USE') throw conflict('Only an asset in use is disposed of.');
      if (b.method === 'SALE' && !(Number(b.proceeds) > 0)) throw badRequest('Correct the highlighted fields', [{ field: 'proceeds', message: 'A sale has proceeds.' }]); if (b.method === 'SALE' && !b.buyerPartnerId) throw badRequest('Correct the highlighted fields', [{ field: 'buyerPartnerId', message: 'Name the buyer (business partner) for the sale invoice.' }]);
      if (b.date > todayIST()) throw badRequest('Correct the highlighted fields', [{ field: 'date', message: 'The date of the disposal is today or before.' }]); if (a.dep_until && b.date <= a.dep_until) throw unprocessable(`The depreciation is already run to ${a.dep_until}: date the disposal after it.`);
      if (b.hsn) db.prepare('UPDATE fa_assets SET hsn_code = ? WHERE id = ?').run(b.hsn, a.id);
      const v = disposalValues(a.company_id, a, { ...b, hsn: b.hsn ?? a.hsn_code });
      return transaction(db, () => { try { const id = Number(db.prepare('INSERT INTO fa_disposals (company_id, doc_no, asset_id, disposal_date, method, buyer_partner_id, proceeds_paise, gst_paise, dep_to_date_paise, wdv_paise, gain_loss_paise, reason, requested_by, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(a.company_id, dFlow.next(actor), a.id, b.date, b.method, b.buyerPartnerId ?? null, v.proceeds, v.gst, v.depTo, v.wdv, v.gain, b.reason, actor.user, actor.user, 'fa_assets', String(a.id)).lastInsertRowid); audit(actor, 'fa_disposals', id, 'create', a.company_id, { newValues: { asset: a.doc_no, method: b.method, proceeds: rs(v.proceeds), gainLoss: rs(v.gain) } }); return disposals.get(actor, id); } catch (x) { if (/UNIQUE/.test(String(x.message))) throw conflict('This asset already has a disposal open.'); throw x; } });
    },
    remove: (actor, id) => dFlow.remove(actor, id),
    submit(actor, id) { dFlow.submit(actor, id); return disposals.get(actor, id); },
    withdraw(actor, id, b) { dFlow.withdraw(actor, id, b); return disposals.get(actor, id); },
    cancel(actor, id, b) { dFlow.cancel(actor, id, b); return disposals.get(actor, id); },
    history: (actor, id) => dFlow.history(actor, id),
    /** The receivable made for the sale (23.05), told back. */
    linkReceivable(companyId, { disposalId, arRef }) { db.prepare('UPDATE fa_disposals SET ar_invoice_ref = ?, updated_at = ? WHERE id = ? AND company_id = ?').run(arRef, nowIso(), disposalId, companyId); },
  };

  // ---- FR-06: physical verification ----
  const verifications = {
    create(actor, { projectId, siteId, date }) {
      need(actor, 'fin.asset.verify', 'verify assets', projectId ?? null); const c = actor.companyId;
      const rows = db.prepare(`SELECT id FROM fa_assets WHERE company_id = ? AND asset_state = 'IN_USE' AND deleted_at IS NULL${projectId ? ' AND org_project_id = ?' : ''}${siteId ? ' AND org_site_id = ?' : ''} ORDER BY id`).all(c, ...[projectId, siteId].filter(Boolean));
      return transaction(db, () => { const id = Number(db.prepare('INSERT INTO fa_verifications (company_id, doc_no, org_project_id, org_site_id, verify_date, expected_count, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)').run(c, docNo(c, 'fa_verifications', 'FAV'), projectId ?? null, siteId ?? null, date, rows.length, actor.user).lastInsertRowid); const ins = db.prepare('INSERT INTO fa_verification_lines (company_id, verification_id, asset_id, created_by) VALUES (?, ?, ?, ?)'); for (const r of rows) ins.run(c, id, r.id, actor.user); audit(actor, 'fa_verifications', id, 'create', c); return verifications.get(actor, id); });
    },
    get(actor, id) { need(actor, 'fin.asset.view', 'see verifications'); const v = db.prepare('SELECT * FROM fa_verifications WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!v || !may(actor, 'fin.asset.view', v.org_project_id)) throw notFound('That verification does not exist.');
      const lines = db.prepare('SELECT l.*, a.doc_no, a.description, a.custodian FROM fa_verification_lines l JOIN fa_assets a ON a.id = l.asset_id WHERE l.verification_id = ? ORDER BY l.line_status, a.doc_no').all(v.id).map((l) => ({ assetId: l.asset_id, docNo: l.doc_no, description: l.description, custodian: l.custodian, status: l.line_status, condition: l.asset_condition, scannedBy: l.scanned_by, scannedAt: l.scanned_at, note: l.note }));
      return { id: v.id, docNo: v.doc_no, projectId: v.org_project_id, siteId: v.org_site_id, date: v.verify_date, status: v.verify_status, expected: v.expected_count, found: v.found_count, lines, can: { scan: v.verify_status === 'OPEN' && may(actor, 'fin.asset.verify', v.org_project_id) } }; },
    list(actor) { need(actor, 'fin.asset.view', 'see verifications'); return db.prepare('SELECT id, doc_no, verify_date, verify_status, expected_count, found_count FROM fa_verifications WHERE company_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 50').all(actor.companyId).map((v) => ({ id: v.id, docNo: v.doc_no, date: v.verify_date, status: v.verify_status, expected: v.expected_count, found: v.found_count })); },
    /** A QR tag read (FA:<asset> or the asset number): found here, or found where it was not expected. */
    scan(actor, id, { code, condition, note }) {
      const v = db.prepare('SELECT * FROM fa_verifications WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!v) throw notFound('That verification does not exist.'); need(actor, 'fin.asset.verify', 'verify assets', v.org_project_id); if (v.verify_status !== 'OPEN') throw conflict('The verification is closed.');
      const no = String(code).trim().replace(/^FA:/i, ''); const a = db.prepare('SELECT * FROM fa_assets WHERE company_id = ? AND upper(doc_no) = upper(?) AND deleted_at IS NULL').get(actor.companyId, no); if (!a) throw notFound(`No asset carries the tag ${code}.`);
      return transaction(db, () => { const l = db.prepare('SELECT * FROM fa_verification_lines WHERE verification_id = ? AND asset_id = ?').get(v.id, a.id);
        if (l) db.prepare("UPDATE fa_verification_lines SET line_status = 'FOUND', asset_condition = ?, scanned_by = ?, scanned_at = ?, note = ?, updated_at = ? WHERE id = ?").run(condition ?? 'GOOD', actor.user, nowIso(), note ?? null, nowIso(), l.id);
        else db.prepare("INSERT INTO fa_verification_lines (company_id, verification_id, asset_id, line_status, asset_condition, scanned_by, scanned_at, note, created_by) VALUES (?, ?, ?, 'FOUND_ELSEWHERE', ?, ?, ?, ?, ?)").run(v.company_id, v.id, a.id, condition ?? 'GOOD', actor.user, nowIso(), note ?? null, actor.user);
        db.prepare("UPDATE fa_verifications SET found_count = (SELECT COUNT(*) FROM fa_verification_lines WHERE verification_id = ? AND line_status IN ('FOUND', 'FOUND_ELSEWHERE')), updated_at = ? WHERE id = ?").run(v.id, nowIso(), v.id); db.prepare('UPDATE fa_assets SET last_verified_on = ? WHERE id = ?').run(v.verify_date, a.id);
        return verifications.get(actor, v.id); });
    },
    close(actor, id) {
      const v = db.prepare('SELECT * FROM fa_verifications WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!v) throw notFound('That verification does not exist.'); need(actor, 'fin.asset.verify', 'verify assets', v.org_project_id); if (v.verify_status !== 'OPEN') throw conflict('Already closed.');
      return transaction(db, () => { const missing = db.prepare("UPDATE fa_verification_lines SET line_status = 'MISSING', updated_at = ? WHERE verification_id = ? AND line_status = 'EXPECTED'").run(nowIso(), v.id).changes; db.prepare("UPDATE fa_verifications SET verify_status = 'CLOSED', closed_by = ?, closed_at = ?, updated_at = ? WHERE id = ?").run(actor.user, nowIso(), nowIso(), v.id); audit(actor, 'fa_verifications', v.id, 'close', v.company_id, { reason: `${missing} missing` });
        if (missing) notify(v.company_id, 'fin.fa.alert', ['permission:fin.disposal.create'], v.doc_no, 'assets not found', `${missing} asset(s) were not found in verification ${v.doc_no}: find them, or propose their write-off.`, `/finance/assets?tab=verify&verification=${v.id}`, v.id, { projectId: v.org_project_id ?? undefined });
        evt('fin.asset.verified', actor, v.company_id, 'fa_verifications', v.id, { verificationId: v.id, projectId: v.org_project_id, expected: v.expected_count, missing }); return verifications.get(actor, v.id); });
    },
  };

  // ---- the reports: the fixed asset schedule (Schedule III) and the tax depreciation by block ----
  function schedule(actor, { fy }) {
    need(actor, 'fin.depreciation.view', 'see the fixed asset schedule'); const c = actor.companyId; const { from, to } = fyRange(fy); const out = new Map();
    const row = (k) => { if (!out.has(k)) { const cl = classOf(c, k); out.set(k, { classCode: k, className: cl?.name ?? k, grossOpen: 0, additions: 0, deletions: 0, grossClose: 0, depOpen: 0, depYear: 0, depDeletions: 0, depClose: 0, netOpen: 0, netClose: 0 }); } return out.get(k); };
    for (const a of db.prepare("SELECT * FROM fa_assets WHERE company_id = ? AND status = 'APPROVED' AND cap_date <= ? AND deleted_at IS NULL").all(c, to)) {
      const r = row(a.class_code); const before = a.cap_date < from; const gone = a.disposed_on && a.disposed_on >= from && a.disposed_on <= to; const goneBefore = a.disposed_on && a.disposed_on < from; if (goneBefore) continue;
      const depBefore = a.opening_accum_paise + db.prepare('SELECT COALESCE(SUM(book_dep_paise), 0) AS s FROM fa_depreciation WHERE asset_id = ? AND to_date < ? AND deleted_at IS NULL').get(a.id, from).s;
      const depIn = db.prepare('SELECT COALESCE(SUM(book_dep_paise), 0) AS s FROM fa_depreciation WHERE asset_id = ? AND from_date >= ? AND to_date <= ? AND deleted_at IS NULL').get(a.id, from, to).s;
      if (before) { r.grossOpen += a.cost_paise; r.depOpen += depBefore; } else { r.additions += a.cost_paise; r.depOpen += 0; if (a.opening_accum_paise) r.depYear += a.opening_accum_paise; }
      r.depYear += depIn; if (gone) { r.deletions += a.cost_paise; r.depDeletions += depBefore + depIn + (before ? 0 : 0); }
    }
    const rows = [...out.values()].map((r) => { r.grossClose = r.grossOpen + r.additions - r.deletions; r.depClose = r.depOpen + r.depYear - r.depDeletions; r.netOpen = r.grossOpen - r.depOpen; r.netClose = r.grossClose - r.depClose; return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'number' ? rs(v) : v])); }).sort((a, b) => a.classCode.localeCompare(b.classCode));
    const tot = (k) => rs(rows.reduce((s, r) => s + paise(r[k]), 0));
    return { fy, from, to, rows, totals: Object.fromEntries(['grossOpen', 'additions', 'deletions', 'grossClose', 'depOpen', 'depYear', 'depDeletions', 'depClose', 'netOpen', 'netClose'].map((k) => [k, tot(k)])) };
  }
  /** Income-tax depreciation by block for a financial year: opening WDV (carried from the first year), additions at the full rate when put to use for 180 days or more in the year and at half the rate otherwise, sale proceeds deducted, the block's depreciation and closing WDV; a block whose proceeds exceed it ends with a short-term capital gain. */
  function taxBlocks(actor, { fy }) {
    need(actor, 'fin.depreciation.view', 'see tax depreciation'); const c = actor.companyId;
    const all = db.prepare("SELECT * FROM fa_assets WHERE company_id = ? AND status = 'APPROVED' AND deleted_at IS NULL").all(c); if (!all.length) return { fy, blocks: [], totals: { depreciation: 0 } };
    const first = all.map((a) => fyOf(a.cap_date)).sort()[0]; const blocks = new Map(); let out = null;
    for (let y = Number(first.slice(0, 4)); y <= Number(fy.slice(0, 4)); y += 1) {
      const f = `${y}-${String((y + 1) % 100).padStart(2, '0')}`; const { from, to } = fyRange(f); const rows = [];
      const names = new Set([...blocks.keys(), ...all.filter((a) => a.cap_date >= from && a.cap_date <= to).map((a) => a.tax_block)]);
      for (const b of names) {
        const open = blocks.get(b)?.closing ?? 0; const rate = all.find((a) => a.tax_block === b)?.tax_rate_bp ?? 0; const adds = all.filter((a) => a.tax_block === b && a.cap_date >= from && a.cap_date <= to);
        const addFull = adds.filter((a) => days(a.cap_date, to) >= 180).reduce((s, a) => s + a.cost_paise, 0); const addHalf = adds.filter((a) => days(a.cap_date, to) < 180).reduce((s, a) => s + a.cost_paise, 0);
        const sold = db.prepare("SELECT COALESCE(SUM(d.proceeds_paise), 0) AS s FROM fa_disposals d JOIN fa_assets a ON a.id = d.asset_id WHERE d.company_id = ? AND a.tax_block = ? AND d.status = 'APPROVED' AND d.disposal_date BETWEEN ? AND ?").get(c, b, from, to).s;
        let base0 = open + addFull + addHalf - sold; let stcg = 0; if (base0 < 0) { stcg = -base0; base0 = 0; }
        const halfPart = Math.min(addHalf, base0); const fullPart = base0 - halfPart; const dep = Math.round((fullPart * rate) / 10000 + (halfPart * rate) / 20000);
        blocks.set(b, { closing: base0 - dep }); rows.push({ block: b, ratePct: rate / 100, opening: rs(open), additionsFull: rs(addFull), additionsHalf: rs(addHalf), deletions: rs(sold), stcg: rs(stcg), depreciation: rs(dep), closing: rs(base0 - dep) });
      }
      if (f === fy) out = rows;
    }
    out = out ?? []; return { fy, blocks: out, totals: { depreciation: rs(out.reduce((s, r) => s + paise(r.depreciation), 0)), closing: rs(out.reduce((s, r) => s + paise(r.closing), 0)) }, note: 'Income-tax Act, 2025 from tax year 2026-27 (the Act of 1961 before): the block rates are master data of the asset classes.' };
  }

  // ---- consumers: the equipment register (17.01) and small assets (16.09) make a draft to capitalise ----
  const consumers = {
    draftFrom(companyId, { source, equipmentId = null, smallAssetId = null, value, date, projectId = null, description }) {
      if (!on(companyId) || !(value >= Number(param(companyId, 'fin.fa.capitalise_above') ?? 5000) * 100)) return null;
      if (equipmentId && db.prepare("SELECT 1 FROM fa_assets WHERE equipment_id = ? AND status NOT IN ('CANCELLED', 'REJECTED') AND deleted_at IS NULL").get(equipmentId)) return null;
      if (smallAssetId && db.prepare("SELECT 1 FROM fa_assets WHERE small_asset_id = ? AND status NOT IN ('CANCELLED', 'REJECTED') AND deleted_at IS NULL").get(smallAssetId)) return null;
      const cls = classOf(companyId, String(param(companyId, source === 'EQUIPMENT' ? 'fin.fa.default_equipment_class' : 'fin.fa.default_small_asset_class') ?? 'PM_CONSTRUCTION'), date ?? todayIST()); if (!cls) return null;
      return transaction(db, () => { const residual = Math.round((value * cls.residual_bp) / 10000); const id = Number(db.prepare("INSERT INTO fa_assets (company_id, doc_no, class_code, description, cost_paise, cap_date, org_project_id, equipment_id, small_asset_id, cap_source, useful_life_months, residual_paise, book_method, wdv_rate_bp, tax_block, tax_rate_bp, requested_by, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'system', 'system', ?, ?)")
        .run(companyId, docNo(companyId, 'fa_assets', 'FA'), cls.code, description.slice(0, 300), value, date ?? todayIST(), projectId, equipmentId, smallAssetId, source, cls.useful_life_months, residual, cls.book_method, cls.book_method === 'WDV' ? Math.round(wdvRate(value, residual, cls.useful_life_months) * 10000) : 0, cls.tax_block, cls.tax_rate_bp, source === 'EQUIPMENT' ? 'plt_equipment' : 'ast_small_assets', String(equipmentId ?? smallAssetId)).lastInsertRowid);
        audit({ user: 'system' }, 'fa_assets', id, 'create', companyId, { newValues: { source, value: rs(value) } }); notify(companyId, 'fin.fa.alert', ['permission:fin.asset.create'], description, 'to capitalise', `${description} (₹${rs(value)}) was registered; check its class and send it for capitalisation.`, `/finance/assets?id=${id}`, id, { projectId: projectId ?? undefined }); return id; });
    },
    onEquipment(e) { const c = Number(e.companyId); const d = e.data ?? {}; if (!c || !d.equipmentId || !d.capitalise) return null; const eq = db.prepare('SELECT purchase_date FROM plt_equipment WHERE id = ?').get(Number(d.equipmentId)); return consumers.draftFrom(c, { source: 'EQUIPMENT', equipmentId: Number(d.equipmentId), value: Number(d.purchaseValue ?? 0), date: eq?.purchase_date ?? null, projectId: d.projectId ?? null, description: `${d.assetCode ?? d.docNo} (equipment register)` }); },
    onSmallAsset(e) { const c = Number(e.companyId); const d = e.data ?? {}; if (!c || !d.assetId || !d.capitalise) return null; const s = db.prepare('SELECT asset_value, purchase_date, org_project_id FROM ast_small_assets WHERE id = ?').get(Number(d.assetId)); return consumers.draftFrom(c, { source: 'SMALL_ASSET', smallAssetId: Number(d.assetId), value: s?.asset_value ?? paise(d.value ?? 0), date: s?.purchase_date ?? null, projectId: s?.org_project_id ?? null, description: `${d.tag ?? 'Small asset'} (small asset register)` }); },
  };
  const jobs = {
    /** On the 5th of a month: tell the accounts manager when last month's depreciation is not run. */
    remind() { let n = 0; const t = todayIST(); if (Number(t.slice(8, 10)) < 5) return { reminded: 0 }; const last = addMonths(t.slice(0, 7), -1); for (const co of db.prepare('SELECT id FROM org_companies').all()) { if (!on(co.id)) continue; if (!db.prepare("SELECT 1 FROM fa_assets WHERE company_id = ? AND asset_state = 'IN_USE'").get(co.id)) continue; if (db.prepare('SELECT 1 FROM fa_dep_runs WHERE company_id = ? AND period = ?').get(co.id, last)) continue; n += 1; notify(co.id, 'fin.fa.alert', ['permission:fin.depreciation.run'], last, 'depreciation not run', `The depreciation of ${last} is not run yet.`, '/finance/asset-accounting?step=depreciation', 0); } return { reminded: n }; },
  };
  return { assets, cwip, depreciation, disposals, verifications, schedule, taxBlocks, consumers, jobs };
}
