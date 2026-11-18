import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { integrationsOf } from '../../platform/integrations/index.js';
import { defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { toCsv } from '../../platform/security/csv.js';
import { currentCorrelationId } from '../../platform/observability/context.js';
import { todayIST } from '../../../shared/dates.js';
import { gstinProblem, isStateCode } from '../../../shared/gst.js';
import { nowIso, rid } from '../proc/base.js';
import { STATUS, createFlow } from '../qa/flow.js';
import { endOfIstDay, fyOf, readSignedQr, validityDays } from './gsp.js';
import QRCode from 'qrcode';

// Part 23.07: the GST compliance service, used by every module.
//  - The tax resolver (FR-01, BR-01): supplier and recipient (GSTIN or state), place of supply, HSN/SAC, the kind of supply (B2B, B2C, SEZ, export, import), reverse
//    charge → the tax lines, with the rates of the dated GST masters of 06.02 on the date the time-of-supply rule gives (s.14 CGST Act when a rate changed between the
//    supply, the invoice and the payment: the rate of two of the three). Never a rate in the code; the same inputs always give the same lines.
//  - GSTIN check (FR-02): shape, state, check character, then the portal's status through the GSP; the last answer is kept.
//  - e-Invoice (FR-03): the IRP's schema 1.1 built from a tax invoice (22.04) or a credit note (23.05), its GST checked against the resolver, sent through the
//    company's GSP connector (01.08); the IRN, acknowledgement and signed QR are kept and handed to the document; retried with back-off; cancelled within 24 hours;
//    the 30-day reporting window of a taxpayer with AATO of ₹10 crore or more enforced, with alerts on day 20 and 25 (the IRN-due worklist).
//  - e-Way bill (FR-04): from a tax invoice, a stock transfer (16.05) or a concrete delivery (20.02): Part A and B, vehicle update, extension (within 8 hours of the
//    expiry, never beyond 360 days of its generation), cancellation within 24 hours, the validity tracked and alerted.
//  - The compliance log of each document and the sandbox (FR-05). The settings are dated versions, made by the accounts manager and approved by the CFO.

export const SETTINGS_DOC = 'FIN_GST_SETTINGS';
export const EINV_STATUS = { PENDING: 'Waiting to be sent', GENERATED: 'IRN generated', FAILED: 'Failed — to retry', CANCELLED: 'Cancelled', BLOCKED: 'Blocked' };
export const EWB_STATUS = { PENDING: 'Waiting to be sent', PART_A: 'Part A only (no vehicle)', ACTIVE: 'Valid', FAILED: 'Failed — to retry', CANCELLED: 'Cancelled', EXPIRED: 'Expired' };
export const CANCEL_REASONS = { 1: 'Duplicate', 2: 'Data entry mistake', 3: 'Order cancelled', 4: 'Others' };
export const SUPPLY_KINDS = ['B2B', 'B2C', 'SEZ', 'EXPORT', 'IMPORT', 'DEEMED_EXPORT'];
const rs = (p) => (p == null ? null : p / 100);
const paise = (v) => Math.round(Number(v) * 100);
const json = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const ddmmyyyy = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const amt = (p) => Number((p / 100).toFixed(2));
/** @param {any[]} arr @param {(x: any) => number} f */
const sumOf = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
const pctNum = (u) => Number((u / 10000).toFixed(4));

/** Tax on an amount in paise at a rate stored ×10 000 (18 % = 180 000), rounded half up to the paisa, exactly (no floating point). */
export function taxOf(paiseAmount, pct10000) {
  const n = BigInt(Math.round(paiseAmount)) * BigInt(Math.round(pct10000)); const d = 1_000_000n; const neg = n < 0n; const a = neg ? -n : n;
  const q = (a + d / 2n) / d; return Number(neg ? -q : q);
}

/**
 * The time-of-supply rule of s.14 of the CGST Act, for a rate that changed between the events: the rate of the date on which two of the three events (supply,
 * invoice, payment) fall. With no payment yet, the invoice date decides when the two differ (s.12/13). `rateAt(date)` gives a comparable key of the rate on a date.
 * Returns the date whose rate applies and the reason.
 */
export function timeOfSupply({ supplyDate, invoiceDate, paymentDate }, rateAt) {
  const inv = invoiceDate; const sup = supplyDate ?? inv;
  const ev = [['supply', sup], ['invoice', inv]].concat(paymentDate ? [['payment', paymentDate]] : []);
  const keys = ev.map(([, d]) => rateAt(d));
  if (keys.every((k) => k === keys[0])) return { date: inv, rule: 'same rate on every event' };
  if (!paymentDate) return { date: inv, rule: 'rate changed between supply and invoice; no payment yet: the invoice date (s.12/13)' };
  const counts = new Map(); keys.forEach((k) => counts.set(k, (counts.get(k) ?? 0) + 1));
  const winner = [...counts.entries()].find(([, n]) => n >= 2)?.[0];
  const at = ev.filter((_, i) => keys[i] === winner).map(([, d]) => d).sort();
  return { date: at[0], rule: `rate changed: s.14 — two of supply, invoice and payment (${ev.filter((_, i) => keys[i] === winner).map(([w]) => w).join(' and ')}) carry this rate` };
}

export const gstList = defineList({
  code: 'fin.einvoices', label: 'e-Invoices', permission: 'fin.einvoice.view',
  from: 'gst_einvoices x', where: 'x.deleted_at IS NULL',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'e-Invoice' }, documentNo: { sql: 'x.document_no', type: 'text', label: 'Document' }, kind: { sql: 'x.irp_doc_type', type: 'enum', label: 'Type', options: [['INV', 'Tax invoice'], ['CRN', 'Credit note'], ['DBN', 'Debit note']] },
    documentDate: { sql: 'x.document_date', type: 'date', label: 'Date' }, buyerGstin: { sql: "COALESCE(x.buyer_gstin, '')", type: 'text', label: 'Recipient GSTIN' }, total: { sql: '(x.total_paise / 100.0)', type: 'money', label: 'Invoice value', total: true },
    irn: { sql: "COALESCE(x.irn, '')", type: 'text', label: 'IRN' }, ackNo: { sql: "COALESCE(x.ack_no, '')", type: 'text', label: 'Ack no' }, attempts: { sql: 'x.attempts', type: 'number', label: 'Attempts' }, error: { sql: "COALESCE(x.error, '')", type: 'text', label: 'Error' },
    dueBy: { sql: "COALESCE(x.due_by, '')", type: 'date', label: 'Report by' }, mode: { sql: 'x.gsp_mode', type: 'enum', label: 'Mode', options: [['SANDBOX', 'Sandbox'], ['PRODUCTION', 'Production']] },
    status: { sql: 'x.einv_status', type: 'enum', label: 'Status', options: Object.entries(EINV_STATUS) },
  },
});
export const ewbList = defineList({
  code: 'fin.ewaybills', label: 'e-Way bills', permission: 'fin.ewaybill.view',
  from: 'gst_ewaybills x', where: 'x.deleted_at IS NULL',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'Record' }, ewbNo: { sql: "COALESCE(x.ewb_no, '')", type: 'text', label: 'E-way bill' }, documentNo: { sql: 'x.document_no', type: 'text', label: 'Document' },
    source: { sql: 'x.document_type', type: 'enum', label: 'From', options: [['bill_tax_invoices', 'Tax invoice'], ['inv_transfers', 'Stock transfer'], ['bp_delivery_tickets', 'Concrete delivery']] },
    vehicleNo: { sql: "COALESCE(x.vehicle_no, '')", type: 'text', label: 'Vehicle' }, route: { sql: "(x.from_state || ' → ' || x.to_state)", type: 'text', label: 'States' }, distance: { sql: 'x.distance_km', type: 'number', label: 'km' },
    value: { sql: '(x.value_paise / 100.0)', type: 'money', label: 'Value', total: true }, validUntil: { sql: "COALESCE(x.valid_until, '')", type: 'text', label: 'Valid until' },
    hoursLeft: { sql: "(CASE WHEN x.ewb_status = 'ACTIVE' AND x.valid_until IS NOT NULL THEN CAST((julianday(x.valid_until) - julianday('now')) * 24 AS INTEGER) ELSE NULL END)", type: 'number', label: 'Hours left' },
    status: { sql: 'x.ewb_status', type: 'enum', label: 'Status', options: Object.entries(EWB_STATUS) },
  },
});

/** @param {{ db: any, base: any, flags: any, now?: () => number }} o */
export function createGstService({ db, base, flags, now = () => Date.now() }) {
  const { may, audit, notify, authz } = base;
  const need = (actor, key, what, pid = null) => { if (!may(actor, key, pid)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const on = (companyId) => flags.isOn({ companyId, user: 'system', roles: [] }, 'ff.fin.p2307');
  const SYS = (companyId) => ({ user: 'system', companyId, roles: [] });
  const evt = (type, actor, companyId, entity, entityId, data) => publishEvent(db, { type, entity, entityId, actorId: actor?.user ?? 'system', companyId, data });
  const docNo = (companyId, table, prefix) => { const n = (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE company_id = ?`).get(companyId).n ?? 0) + 1; let no = `${prefix}/${String(n).padStart(6, '0')}`; for (let k = n + 1; db.prepare(`SELECT 1 FROM ${table} WHERE company_id = ? AND doc_no = ?`).get(companyId, no); k += 1) no = `${prefix}/${String(k).padStart(6, '0')}`; return no; };
  const companyOf = (companyId) => db.prepare('SELECT * FROM core_company_settings WHERE company_id = ?').get(companyId) ?? null;
  const ownGstins = (companyId) => { const s = companyOf(companyId); const a = s ? json(s.gstins_json || '[]', []).map((g) => ({ gstin: String(g.gstin).toUpperCase(), stateCode: g.stateCode ?? String(g.gstin).slice(0, 2), source: 'company', name: g.tradeName ?? s.legal_name })) : []; const b = db.prepare("SELECT code, name, gstin, COALESCE(state_code, substr(gstin, 1, 2)) AS st FROM org_branches WHERE company_id = ? AND gstin IS NOT NULL AND gstin <> '' AND deleted_at IS NULL").all(companyId).map((r) => ({ gstin: String(r.gstin).toUpperCase(), stateCode: r.st, source: `branch ${r.code}`, name: r.name })); const seen = new Set(); return [...a, ...b].filter((g) => (seen.has(g.gstin) ? false : seen.add(g.gstin))); };
  const log = (companyId, { documentType, documentId, refKind, refId = null, action, mode = 'SANDBOX', outcome, request = null, response = null, error = null, actor = 'system', integrationLogId = null }) => db.prepare('INSERT INTO gst_compliance_log (company_id, document_type, document_id, ref_kind, ref_id, action, gsp_mode, outcome, request_json, response_json, error, correlation_id, actor, integration_log_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(companyId, documentType, Number(documentId), refKind, refId, action, mode, outcome, request == null ? null : JSON.stringify(request).slice(0, 200_000), response == null ? null : JSON.stringify(response).slice(0, 50_000), error ? String(error).slice(0, 2000) : null, currentCorrelationId() ?? null, actor, integrationLogId, actor);

  // ---- the settings: dated versions, maker-checker (FR-05, §9) ----
  const DEFAULTS = { aato_paise: 0, einvoice_enabled: 0, einvoice_threshold_paise: 50_000_000_000, irn_window_aato_paise: 100_000_000_000, irn_window_days: 30, irn_alert_days_json: '[20,25]', irn_cancel_hours: 24, eway_enabled: 0, eway_threshold_paise: 5_000_000, eway_max_doc_age_days: 180, eway_ext_cap_days: 360, eway_km_per_day: 200, eway_odc_km_per_day: 20, eway_ext_window_hours: 8, eway_cancel_hours: 24, eway_alert_hours: 12, gsp_connector_code: null, gsp_mode: 'SANDBOX' };
  /** The settings in force on a date: the latest approved version from that date (none approved: e-invoicing and e-way bills are off). */
  const settingsOn = (companyId, date = todayIST()) => db.prepare("SELECT * FROM gst_settings WHERE company_id = ? AND status = 'APPROVED' AND effective_from <= ? AND deleted_at IS NULL ORDER BY effective_from DESC, id DESC LIMIT 1").get(companyId, date) ?? { id: null, ...DEFAULTS };
  const sView = (actor, r) => ({ id: r.id, docNo: r.doc_no, effectiveFrom: r.effective_from, aato: rs(r.aato_paise), einvoiceEnabled: Boolean(r.einvoice_enabled), einvoiceThreshold: rs(r.einvoice_threshold_paise), irnWindowAato: rs(r.irn_window_aato_paise), irnWindowDays: r.irn_window_days, irnAlertDays: json(r.irn_alert_days_json, [20, 25]), irnCancelHours: r.irn_cancel_hours,
    ewayEnabled: Boolean(r.eway_enabled), ewayThreshold: rs(r.eway_threshold_paise), ewayMaxDocAgeDays: r.eway_max_doc_age_days, ewayExtCapDays: r.eway_ext_cap_days, ewayKmPerDay: r.eway_km_per_day, ewayOdcKmPerDay: r.eway_odc_km_per_day, ewayExtWindowHours: r.eway_ext_window_hours, ewayCancelHours: r.eway_cancel_hours, ewayAlertHours: r.eway_alert_hours,
    gspConnector: r.gsp_connector_code, gspMode: r.gsp_mode, changeNote: r.change_note, status: r.status, statusLabel: STATUS[r.status], requestedBy: r.requested_by, approvedBy: r.approved_by, approvedAt: r.approved_at, version: r.version, can: r.id ? { ...sFlow.can(actor, r), ...sFlow.approveInfo(actor, r) } : {} });
  const COLS = { aato: 'aato_paise', einvoiceEnabled: 'einvoice_enabled', einvoiceThreshold: 'einvoice_threshold_paise', irnWindowAato: 'irn_window_aato_paise', irnWindowDays: 'irn_window_days', irnAlertDays: 'irn_alert_days_json', irnCancelHours: 'irn_cancel_hours', ewayEnabled: 'eway_enabled', ewayThreshold: 'eway_threshold_paise', ewayMaxDocAgeDays: 'eway_max_doc_age_days', ewayExtCapDays: 'eway_ext_cap_days', ewayKmPerDay: 'eway_km_per_day', ewayOdcKmPerDay: 'eway_odc_km_per_day', ewayExtWindowHours: 'eway_ext_window_hours', ewayCancelHours: 'eway_cancel_hours', ewayAlertHours: 'eway_alert_hours', gspConnector: 'gsp_connector_code', gspMode: 'gsp_mode', changeNote: 'change_note', effectiveFrom: 'effective_from' };
  const toCol = (k, v) => (['aato', 'einvoiceThreshold', 'irnWindowAato', 'ewayThreshold'].includes(k) ? paise(v) : ['einvoiceEnabled', 'ewayEnabled'].includes(k) ? (v ? 1 : 0) : k === 'irnAlertDays' ? JSON.stringify([...new Set(v)].sort((a, b) => a - b)) : v);
  function checkSettings(companyId, r) {
    const p = []; const alerts = json(r.irn_alert_days_json, []);
    if (alerts.some((d) => d >= r.irn_window_days)) p.push({ field: 'irnAlertDays', message: `An alert day must come before the end of the ${r.irn_window_days}-day window.` });
    if (r.gsp_connector_code) { const c = db.prepare("SELECT type, provider, status FROM core_connectors WHERE company_id = ? AND code = ? AND is_active = 1 AND deleted_at IS NULL").get(companyId, r.gsp_connector_code); if (!c || c.type !== 'gsp') p.push({ field: 'gspConnector', message: 'Choose a connector of type GST provider (Integrations, 01.08).' }); else if (r.gsp_mode === 'PRODUCTION' && c.provider === 'sandbox') p.push({ field: 'gspMode', message: 'The sandbox connector is for sandbox mode only.' }); else if (r.gsp_mode === 'SANDBOX' && c.provider !== 'sandbox') p.push({ field: 'gspMode', message: 'Sandbox mode uses the sandbox connector; a GSP connector is for production.' }); }
    if ((r.einvoice_enabled || r.eway_enabled) && !r.gsp_connector_code) p.push({ field: 'gspConnector', message: 'e-Invoices and e-way bills go through a GSP connector: choose one.' });
    if (p.length) throw badRequest('Correct the highlighted fields', p);
  }
  const sFlow = createFlow({ db, base, docType: SETTINGS_DOC, table: 'gst_settings', perm: 'fin.gst_setting', label: 'GST settings version', route: '/finance/gst-settings?id=', where: () => ({ pid: null, sid: null }),
    ctx: (r) => ({ effectiveFrom: r.effective_from }), title: (r) => `GST settings from ${r.effective_from}${r.change_note ? `: ${r.change_note}` : ''}`, notifyCode: 'fin.gst.decided', prefix: 'GSTS',
    beforeSubmit: (_a, r) => checkSettings(r.company_id, r),
    onApproved: (actor, r) => { db.prepare("UPDATE gst_settings SET status = 'SUPERSEDED', updated_at = ? WHERE company_id = ? AND status = 'APPROVED' AND effective_from = ? AND id <> ?").run(nowIso(), r.company_id, r.effective_from, r.id); log(r.company_id, { documentType: 'gst_settings', documentId: r.id, refKind: 'SETTINGS', refId: r.id, action: 'approved', mode: 'NONE', outcome: 'OK', request: sView(actor, r), actor: actor.user }); evt('fin.gst_settings.approved', actor, r.company_id, 'gst_settings', r.id, { settingsId: r.id, effectiveFrom: r.effective_from, einvoiceEnabled: Boolean(r.einvoice_enabled), ewayEnabled: Boolean(r.eway_enabled), gspMode: r.gsp_mode }); },
  });
  const settings = {
    flow: sFlow,
    current(actor) { need(actor, 'fin.gst_setting.view', 'see the GST settings'); const c = settingsOn(actor.companyId); const versions = db.prepare('SELECT * FROM gst_settings WHERE company_id = ? AND deleted_at IS NULL ORDER BY effective_from DESC, id DESC LIMIT 100').all(actor.companyId).map((r) => sView(actor, r));
      const connectors = db.prepare("SELECT code, name, provider, status, environment FROM core_connectors WHERE company_id = ? AND type = 'gsp' AND is_active = 1 AND deleted_at IS NULL ORDER BY code").all(actor.companyId);
      return { current: sView(actor, c), versions, connectors, gstins: gstins.list(actor), canCreate: may(actor, 'fin.gst_setting.create') }; },
    get(actor, id) { const r = sFlow.row(actor, id); return { ...sView(actor, r), history: sFlow.history(actor, r.id) }; },
    create(actor, b) {
      need(actor, 'fin.gst_setting.create', 'propose GST settings'); const base0 = { ...settingsOn(actor.companyId) };
      /** @type {any} */
      const row = { ...DEFAULTS, ...Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, base0[k]])) };
      for (const [k, v] of Object.entries(b)) if (COLS[k] && v !== undefined) row[COLS[k]] = toCol(k, v);
      if (!row.effective_from) row.effective_from = todayIST();
      const p = []; if (row.irn_window_days < 1) p.push({ field: 'irnWindowDays', message: 'at least one day' }); if (p.length) throw badRequest('Correct the highlighted fields', p);
      return transaction(db, () => { const no = sFlow.next(actor); const cols = ['company_id', 'doc_no', ...Object.keys(DEFAULTS), 'effective_from', 'change_note', 'requested_by', 'created_by']; const vals = [actor.companyId, no, ...Object.keys(DEFAULTS).map((k) => row[k]), row.effective_from, row.change_note ?? null, actor.user, actor.user];
        const id = Number(db.prepare(`INSERT INTO gst_settings (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...vals).lastInsertRowid); audit(actor, 'gst_settings', id, 'create', actor.companyId, { newValues: b }); return settings.get(actor, id); });
    },
    update(actor, id, b) {
      const r = sFlow.row(actor, id, 'fin.gst_setting.edit'); if (!['DRAFT', 'RETURNED'].includes(r.status)) throw conflict('Only a draft or a returned version is changed; make a new version.'); if (b.version !== r.version) throw conflict('Someone changed this version meanwhile: reload it.');
      const sets = []; const vals = []; const old = {}; for (const [k, v] of Object.entries(b)) if (COLS[k] && v !== undefined) { sets.push(`${COLS[k]} = ?`); vals.push(toCol(k, v)); old[k] = r[COLS[k]]; }
      if (sets.length) db.prepare(`UPDATE gst_settings SET ${sets.join(', ')}, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(...vals, actor.user, nowIso(), r.id); audit(actor, 'gst_settings', r.id, 'update', r.company_id, { oldValues: old, newValues: b }); return settings.get(actor, r.id);
    },
    remove: (actor, id) => sFlow.remove(actor, id),
    submit(actor, id) { const r = sFlow.submit(actor, id); return settings.get(actor, r.id); },
    withdraw(actor, id, b) { sFlow.withdraw(actor, id, b); return settings.get(actor, id); },
    cancel(actor, id, b) { sFlow.cancel(actor, id, b); return settings.get(actor, id); },
    history: (actor, id) => sFlow.history(actor, id),
    /** Settings as a file to keep or to load in another company (connector and history excluded). */
    exportJson(actor) { need(actor, 'fin.gst_setting.export', 'export the GST settings'); const c = sView(actor, settingsOn(actor.companyId)); audit(actor, 'gst_settings', c.id ?? 0, 'export', actor.companyId); const keep = Object.fromEntries(Object.keys(COLS).filter((k) => !['gspConnector', 'changeNote', 'effectiveFrom'].includes(k)).map((k) => [k, c[k]])); return { contentType: 'application/json; charset=utf-8', fileName: `gst-settings-${todayIST()}.json`, buffer: Buffer.from(JSON.stringify({ kind: 'erp.gst_settings', version: 1, settings: keep }, null, 2)) }; },
    importJson(actor, b) { need(actor, 'fin.gst_setting.create', 'propose GST settings'); const s = b.content?.settings; if (b.content?.kind !== 'erp.gst_settings' || !s) throw badRequest('Correct the highlighted fields', [{ field: 'content', message: 'This is not a GST settings file of this ERP.' }]); return settings.create(actor, { ...s, gspConnector: settingsOn(actor.companyId).gsp_connector_code ?? undefined, effectiveFrom: b.effectiveFrom, changeNote: `Imported: ${b.changeNote ?? 'settings file'}`.slice(0, 300) }); },
  };

  // ---- FR-01: the tax resolver ----
  /** The GST rate of a code or an HSN/SAC on a date, from the dated masters of 06.02 (the company's own row over the system row). */
  function rateOn(companyId, { code = null, hsn = null }, date) {
    const pick = (table, col, v) => db.prepare(`SELECT * FROM ${table} WHERE ${col} = ? AND (company_id = ? OR company_id IS NULL) AND row_status = 'ACTIVE' AND deleted_at IS NULL AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?) ORDER BY company_id IS NULL, effective_from DESC LIMIT 1`).get(v, companyId, date, date) ?? null;
    let h = null; let c = code;
    if (hsn) { h = pick('mdm_hsn_sac', 'code', String(hsn)); if (!h) throw unprocessable(`HSN/SAC ${hsn} is not in the HSN/SAC master on ${date} (06.02): add it, then try again.`); c = h.default_gst_code; }
    if (!c) throw unprocessable('Give an HSN/SAC code or a GST rate code for each line.');
    const r = pick('mdm_gst_rates', 'code', c); if (!r) throw unprocessable(`GST rate ${c} is not in force on ${date} (06.02).`);
    return { code: r.code, igst: r.igst_pct, cgst: r.cgst_pct, sgst: r.sgst_pct, cess: r.cess_pct ?? 0, effectiveFrom: r.effective_from, hsn: h ? { code: h.code, type: h.code_type, description: h.description, rcm: Boolean(h.reverse_charge), effectiveFrom: h.effective_from } : null };
  }
  const stateOf = (gstin, state) => (state ? String(state) : gstin ? String(gstin).slice(0, 2) : null);
  /**
   * FR-01: the tax lines of a document. `input`: { docDate, supplyDate?, paymentDate?, supplierGstin?, supplierState?, recipientGstin?, recipientState?, placeOfSupply?, propertyState?,
   * supplyKind: B2B | B2C | SEZ | EXPORT | IMPORT | DEEMED_EXPORT, withPayment? (SEZ or export with IGST paid), reverseCharge?, lines: [{ hsn? | rateCode?, taxable }] }.
   */
  function resolve(companyId, input) {
    const p = []; const kind = input.supplyKind ?? 'B2B';
    for (const [k, v] of [['supplierGstin', input.supplierGstin], ['recipientGstin', input.recipientGstin]]) if (v) { const e = gstinProblem(String(v)); if (e) p.push({ field: k, message: e }); }
    const supplier = stateOf(input.supplierGstin, input.supplierState); const recipient = stateOf(input.recipientGstin, input.recipientState);
    if (!supplier) p.push({ field: 'supplierState', message: 'Give the supplier GSTIN or state.' }); else if (!isStateCode(supplier)) p.push({ field: 'supplierState', message: `${supplier} is not a GST state code.` });
    // place of supply: given; the location of the immovable property for works contract and construction services (s.12(3) IGST Act); else the recipient's state
    const pos = input.placeOfSupply ?? input.propertyState ?? recipient ?? (kind === 'EXPORT' ? '96' : supplier);
    if (!pos || (!isStateCode(pos) && pos !== '96')) p.push({ field: 'placeOfSupply', message: 'Give the place of supply (a GST state code) or the recipient.' });
    if (!Array.isArray(input.lines) || !input.lines.length) p.push({ field: 'lines', message: 'Give at least one line.' });
    if (p.length) throw badRequest('Correct the highlighted fields', p);
    const inter = ['SEZ', 'EXPORT', 'IMPORT'].includes(kind) || supplier !== pos;
    const zeroRated = ['SEZ', 'EXPORT'].includes(kind) && !input.withPayment;
    const lines = input.lines.map((l, i) => {
      const taxable = paise(l.taxable); if (!Number.isFinite(taxable) || taxable < 0) throw badRequest('Correct the highlighted fields', [{ field: `lines.${i}.taxable`, message: 'The taxable value is a positive amount.' }]);
      const keyAt = (d) => { const r = rateOn(companyId, { code: l.rateCode ?? null, hsn: l.hsn ?? null }, d); return `${r.code}:${r.igst}:${r.cess}`; };
      const tos = timeOfSupply({ supplyDate: input.supplyDate ?? null, invoiceDate: input.docDate, paymentDate: input.paymentDate ?? null }, keyAt);
      const r = rateOn(companyId, { code: l.rateCode ?? null, hsn: l.hsn ?? null }, tos.date);
      const rcm = Boolean(input.reverseCharge ?? false) || Boolean(r.hsn?.rcm && (input.recipientGstin || kind === 'B2B'));
      const t = zeroRated ? { igst: 0, cgst: 0, sgst: 0, cess: 0 } : inter ? { igst: taxOf(taxable, r.igst), cgst: 0, sgst: 0, cess: taxOf(taxable, r.cess) } : { igst: 0, cgst: taxOf(taxable, r.cgst), sgst: taxOf(taxable, r.sgst), cess: taxOf(taxable, r.cess) };
      const tax = t.igst + t.cgst + t.sgst + t.cess;
      return { lineNo: i + 1, hsn: r.hsn?.code ?? l.hsn ?? null, hsnDescription: r.hsn?.description ?? null, isService: r.hsn ? r.hsn.type === 'SAC' : null, rateCode: r.code, gstRate: pctNum(r.igst), igstRate: inter ? pctNum(r.igst) : 0, cgstRate: inter ? 0 : pctNum(r.cgst), sgstRate: inter ? 0 : pctNum(r.sgst), cessRate: pctNum(r.cess), taxable: rs(taxable), igst: rs(t.igst), cgst: rs(t.cgst), sgst: rs(t.sgst), cess: rs(t.cess), tax: rs(tax), total: rs(taxable + (rcm ? 0 : tax)), reverseCharge: rcm, zeroRated, rateDate: tos.date, rateRule: tos.rule, rateFrom: r.effectiveFrom };
    });
    const sum = (/** @type {string} */ k, /** @type {(x: any) => boolean} */ f = () => true) => rs(lines.filter(f).reduce((s, x) => s + paise(x[k]), 0));
    return { supplyKind: kind, supplierState: supplier, recipientState: recipient, placeOfSupply: pos, interState: inter, taxHeads: inter ? 'IGST' : 'CGST+SGST', zeroRated, lines,
      totals: { taxable: sum('taxable'), igst: sum('igst', (x) => !x.reverseCharge), cgst: sum('cgst', (x) => !x.reverseCharge), sgst: sum('sgst', (x) => !x.reverseCharge), cess: sum('cess', (x) => !x.reverseCharge), tax: sum('tax', (x) => !x.reverseCharge), reverseChargeTax: sum('tax', (x) => x.reverseCharge), invoiceValue: sum('total') },
      basis: [`Place of supply ${pos}${input.placeOfSupply ? ' (given)' : input.propertyState ? ' (location of the property, s.12(3) IGST Act)' : recipient ? ' (the recipient)' : ''}`, inter ? (kind === 'B2B' || kind === 'B2C' ? `Supplier in ${supplier}, place of supply ${pos}: inter-State, IGST` : `${kind}: IGST`) : `Supplier and place of supply in ${supplier}: CGST and SGST`, zeroRated ? 'Zero-rated without payment of IGST (under LUT/bond)' : null].filter(Boolean) };
  }

  // ---- FR-02: GSTINs ----
  const gstinView = (r) => (r ? { gstin: r.gstin, formatOk: Boolean(r.format_ok), problem: r.problem, status: r.api_status, legalName: r.legal_name, tradeName: r.trade_name, stateCode: r.state_code, checkedAt: r.checked_at, source: r.check_source } : null);
  const gstins = {
    list(actor) { return ownGstins(actor.companyId).map((g) => ({ ...g, check: gstinView(db.prepare('SELECT * FROM gst_gstin_checks WHERE company_id = ? AND gstin = ?').get(actor.companyId, g.gstin)) })); },
    async check(actor, { gstin, online = true }) {
      need(actor, 'fin.gstin.check', 'check GSTINs'); const g = String(gstin).trim().toUpperCase(); const problem = gstinProblem(g); const s = settingsOn(actor.companyId);
      let status = 'UNKNOWN'; let src = 'FORMAT'; let legal = null; let trade = null; let err = null;
      if (!problem && online && s.gsp_connector_code) {
        try { const out = await integrationsOf(db).hub.call(s.gsp_connector_code, 'searchGstin', { gstin: g }, { companyId: actor.companyId, actor }); const d = out.data ?? {}; const st = String(d.Status ?? d.status ?? '').toUpperCase(); status = st.startsWith('ACT') ? 'ACTIVE' : st.startsWith('CNL') || st.startsWith('CAN') ? 'CANCELLED' : st.startsWith('SUS') ? 'SUSPENDED' : st ? 'INACTIVE' : 'UNKNOWN'; legal = d.LegalName ?? d.LglNm ?? null; trade = d.TradeName ?? d.TradeNm ?? null; src = s.gsp_mode === 'PRODUCTION' ? 'GSP' : 'SANDBOX'; log(actor.companyId, { documentType: 'gst_gstin_checks', documentId: 0, refKind: 'GSTIN', action: 'search', mode: s.gsp_mode, outcome: 'OK', request: { gstin: g }, response: d, actor: actor.user, integrationLogId: out.logId }); }
        catch (x) { err = x.message; log(actor.companyId, { documentType: 'gst_gstin_checks', documentId: 0, refKind: 'GSTIN', action: 'search', mode: s.gsp_mode, outcome: 'FAILED', request: { gstin: g }, error: x.message, actor: actor.user }); }
      }
      db.prepare("INSERT INTO gst_gstin_checks (company_id, gstin, format_ok, problem, api_status, legal_name, trade_name, state_code, checked_at, check_source, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (company_id, gstin) DO UPDATE SET format_ok = excluded.format_ok, problem = excluded.problem, api_status = CASE WHEN excluded.check_source = 'FORMAT' THEN gst_gstin_checks.api_status ELSE excluded.api_status END, legal_name = COALESCE(excluded.legal_name, gst_gstin_checks.legal_name), trade_name = COALESCE(excluded.trade_name, gst_gstin_checks.trade_name), state_code = excluded.state_code, checked_at = excluded.checked_at, check_source = CASE WHEN excluded.check_source = 'FORMAT' THEN gst_gstin_checks.check_source ELSE excluded.check_source END, updated_at = excluded.checked_at, version = gst_gstin_checks.version + 1")
        .run(actor.companyId, g, problem ? 0 : 1, problem, status, legal, trade, problem ? null : g.slice(0, 2), nowIso(), src, actor.user);
      return { ...gstinView(db.prepare('SELECT * FROM gst_gstin_checks WHERE company_id = ? AND gstin = ?').get(actor.companyId, g)), valid: !problem, error: err };
    },
  };

  // ---- FR-03: e-invoices ----
  const sellerOf = (companyId, gstin) => { const s = companyOf(companyId); const a = s ? json(s.address_json || '{}', {}) : {}; const br = db.prepare('SELECT name, address FROM org_branches WHERE company_id = ? AND gstin = ? AND deleted_at IS NULL').get(companyId, gstin); return { Gstin: gstin, LglNm: s?.legal_name ?? '', TrdNm: s?.trade_name ?? undefined, Addr1: (br?.address ?? a.line1 ?? '').slice(0, 100), Addr2: a.line2 || undefined, Loc: (a.city ?? '').slice(0, 50), Pin: Number(a.pincode) || a.pincode || '', Stcd: gstin.slice(0, 2) }; };
  const buyerOf = (partnerId, gstin, pos) => { const p = partnerId ? db.prepare('SELECT legal_name, trade_name FROM mdm_partners WHERE id = ?').get(partnerId) : null; const ad = partnerId ? db.prepare('SELECT * FROM mdm_partner_addresses WHERE partner_id = ? AND deleted_at IS NULL ORDER BY (state_code = ?) DESC, is_default DESC, id LIMIT 1').get(partnerId, String(gstin ?? '').slice(0, 2)) : null; return { Gstin: gstin ?? 'URP', LglNm: p?.legal_name ?? '', TrdNm: p?.trade_name ?? undefined, Pos: pos, Addr1: (ad?.address ?? '').slice(0, 100), Loc: (ad?.city ?? '').slice(0, 50), Pin: Number(ad?.pin) || ad?.pin || '', Stcd: String(gstin ?? '').slice(0, 2) || ad?.state_code || pos }; };
  /** The source document as the IRP sees it, with its project and the tax the resolver gives for it. */
  function source(companyId, documentType, documentId) {
    if (documentType === 'bill_tax_invoices') {
      const r = db.prepare('SELECT * FROM bill_tax_invoices WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(documentId), companyId); if (!r) throw notFound('That tax invoice does not exist.');
      if (r.status !== 'APPROVED' || !r.invoice_no) throw unprocessable('Only an issued tax invoice gets an IRN.');
      const k = r.contract_id ? db.prepare('SELECT client_partner_id FROM ctr_contracts WHERE id = ?').get(r.contract_id) : null;
      return { row: r, type: 'INV', no: r.invoice_no, date: r.invoice_date, projectId: r.org_project_id, seller: r.gstin_from, buyer: r.gstin_to, pos: r.place_state, partnerId: k?.client_partner_id ?? null, items: [{ hsn: r.sac_code, desc: r.description, service: true, taxable: r.taxable_paise, cgst: r.cgst_paise, sgst: r.sgst_paise, igst: r.igst_paise, pctBp: r.gst_pct_bp }], total: r.total_paise };
    }
    if (documentType === 'ar_credit_notes') {
      const n = db.prepare('SELECT * FROM ar_credit_notes WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(documentId), companyId); if (!n) throw notFound('That credit note does not exist.');
      if (n.status !== 'APPROVED') throw unprocessable('Only an approved credit note gets an IRN.');
      const inv = db.prepare('SELECT * FROM ar_invoices WHERE id = ?').get(n.invoice_id); const ti = inv?.inv_source === 'TAX_INVOICE' && inv.source_ref ? db.prepare('SELECT * FROM bill_tax_invoices WHERE id = ?').get(Number(inv.source_ref)) : null;
      const seller = ti?.gstin_from ?? ownGstins(companyId)[0]?.gstin; const buyer = ti?.gstin_to ?? db.prepare("SELECT gstin FROM mdm_partner_gstins WHERE partner_id = ? AND gstin_status = 'ACTIVE' AND deleted_at IS NULL ORDER BY id LIMIT 1").get(n.partner_id)?.gstin;
      if (!seller) throw unprocessable('The company has no GSTIN (Company settings): add it, then try again.');
      const tax = n.cgst_paise + n.sgst_paise + n.igst_paise; const pctBp = n.taxable_paise ? Math.round((tax * 10000) / n.taxable_paise) : 0;
      return { row: n, type: 'CRN', no: n.doc_no.replaceAll(' ', ''), date: n.note_date, projectId: n.org_project_id, seller, buyer, pos: ti?.place_state ?? String(buyer ?? '').slice(0, 2), partnerId: n.partner_id, items: [{ hsn: ti?.sac_code ?? '9954', desc: n.description, service: true, taxable: n.taxable_paise, cgst: n.cgst_paise, sgst: n.sgst_paise, igst: n.igst_paise, pctBp }], total: n.total_paise, refInvoice: ti ? { no: ti.invoice_no, date: ti.invoice_date } : null };
    }
    throw badRequest('Correct the highlighted fields', [{ field: 'documentType', message: 'An e-invoice is made for a tax invoice or a credit note.' }]);
  }
  /** The IRP schema 1.1 of a document, and the resolver's check of its GST (the heads must agree; a rate other than the master's is noted). */
  function buildEinvoice(companyId, s) {
    const notes = []; const items = s.items.map((it, i) => {
      const gstRt = Math.round(it.pctBp) / 100; const eng = resolve(companyId, { docDate: s.date, supplierGstin: s.seller, recipientGstin: s.buyer, placeOfSupply: s.pos, supplyKind: 'B2B', lines: [{ hsn: it.hsn, taxable: rs(it.taxable) }] }).lines[0];
      const inter = it.igst > 0 || (it.cgst === 0 && it.sgst === 0 && s.seller.slice(0, 2) !== s.pos);
      if ((eng.igst > 0) !== inter && (it.cgst + it.sgst + it.igst) > 0) throw unprocessable(`The document charges ${inter ? 'IGST' : 'CGST and SGST'} but the place of supply ${s.pos} and the supplier state ${s.seller.slice(0, 2)} call for ${eng.igst > 0 ? 'IGST' : 'CGST and SGST'} (tax engine): correct the document.`);
      if (Math.abs(eng.gstRate - gstRt) > 0.001) notes.push(`Line ${i + 1}: rate ${gstRt}% on the document; the master gives ${eng.gstRate}% for ${it.hsn} on ${eng.rateDate}.`);
      const tax = it.cgst + it.sgst + it.igst;
      return { SlNo: String(i + 1), PrdDesc: (it.desc ?? '').slice(0, 300) || undefined, IsServc: it.service ? 'Y' : 'N', HsnCd: String(it.hsn), Qty: it.service ? undefined : 1, Unit: it.service ? undefined : 'OTH', UnitPrice: amt(it.taxable), TotAmt: amt(it.taxable), AssAmt: amt(it.taxable), GstRt: gstRt, IgstAmt: amt(it.igst), CgstAmt: amt(it.cgst), SgstAmt: amt(it.sgst), CesRt: 0, CesAmt: 0, TotItemVal: amt(it.taxable + tax) };
    });
    const t = s.items.reduce((a, it) => ({ ass: a.ass + it.taxable, cg: a.cg + it.cgst, sg: a.sg + it.sgst, ig: a.ig + it.igst }), { ass: 0, cg: 0, sg: 0, ig: 0 });
    const j = { Version: '1.1', TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', IgstOnIntra: 'N' }, DocDtls: { Typ: s.type, No: s.no, Dt: ddmmyyyy(s.date) }, SellerDtls: sellerOf(companyId, s.seller), BuyerDtls: buyerOf(s.partnerId, s.buyer, s.pos), ItemList: items,
      ValDtls: { AssVal: amt(t.ass), CgstVal: amt(t.cg), SgstVal: amt(t.sg), IgstVal: amt(t.ig), CesVal: 0, StCesVal: 0, Discount: 0, OthChrg: 0, RndOffAmt: amt(s.total - (t.ass + t.cg + t.sg + t.ig)), TotInvVal: amt(s.total) } };
    if (s.refInvoice) j.RefDtls = { PrecDocDtls: [{ InvNo: s.refInvoice.no, InvDt: ddmmyyyy(s.refInvoice.date) }] };
    return { json: j, notes };
  }
  const einvView = (actor, r, detail = false) => {
    const qr = r.signed_qr ? readSignedQr(r.signed_qr) : null; const s = settingsOn(r.company_id); const cancelOpen = r.einv_status === 'GENERATED' && r.ack_date && now() - Date.parse(`${r.ack_date.replace(' ', 'T')}+05:30`) <= s.irn_cancel_hours * 3600_000;
    const o = { id: r.id, docNo: r.doc_no, documentType: r.document_type, documentId: r.document_id, kind: r.irp_doc_type, documentNo: r.document_no, documentDate: r.document_date, fy: r.fy, sellerGstin: r.seller_gstin, buyerGstin: r.buyer_gstin, supplyType: r.supply_type, taxable: rs(r.taxable_paise), tax: rs(r.tax_paise), total: rs(r.total_paise), irn: r.irn, ackNo: r.ack_no, ackDate: r.ack_date, status: r.einv_status, statusLabel: EINV_STATUS[r.einv_status], errorCode: r.error_code, error: r.error, attempts: r.attempts, nextRetryAt: r.next_retry_at, dueBy: r.due_by, mode: r.gsp_mode, cancelReason: r.cancel_reason_code ? CANCEL_REASONS[r.cancel_reason_code] : null, cancelRemark: r.cancel_remark, cancelledAt: r.cancelled_at, projectId: r.org_project_id, version: r.version,
      can: { retry: ['FAILED', 'PENDING'].includes(r.einv_status) && may(actor, 'fin.einvoice.retry', r.org_project_id), cancel: Boolean(cancelOpen) && may(actor, 'fin.einvoice.cancel', r.org_project_id), print: r.einv_status === 'GENERATED' && may(actor, 'fin.einvoice.print', r.org_project_id) } };
    if (detail) { o.qr = qr; o.request = json(r.request_json, null); o.log = complianceLog(r.company_id, r.document_type, r.document_id); }
    return o;
  };
  const complianceLog = (companyId, documentType, documentId) => db.prepare('SELECT id, ref_kind, action, gsp_mode, outcome, error, correlation_id, actor, created_at FROM gst_compliance_log WHERE company_id = ? AND document_type = ? AND document_id = ? ORDER BY id DESC LIMIT 200').all(companyId, documentType, Number(documentId)).map((x) => ({ id: x.id, kind: x.ref_kind, action: x.action, mode: x.gsp_mode, outcome: x.outcome, error: x.error, correlationId: x.correlation_id, by: x.actor, at: x.created_at }));
  const einvRow = (actor, id, key = 'fin.einvoice.view') => { const r = db.prepare('SELECT * FROM gst_einvoices WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!r || !may(actor, 'fin.einvoice.view', r.org_project_id)) throw notFound('That e-invoice does not exist.'); if (key !== 'fin.einvoice.view' && !may(actor, key, r.org_project_id)) throw forbidden(`You may not do this (permission ${key}).`); return r; };
  const windowApplies = (s) => s.aato_paise >= s.irn_window_aato_paise;
  /** Hands the IRN to the document that owns it (22.04, 23.05). */
  /** @param {any} r @param {{ irn: string, ackNo?: string, ackDate?: string, cancelled?: boolean }} o */
  function linkBack(r, { irn, ackNo = null, ackDate = null, cancelled = false }) {
    if (r.document_type === 'bill_tax_invoices') db.prepare(cancelled ? "UPDATE bill_tax_invoices SET irn_state = 'NONE', remarks = ?, updated_at = ?, version = version + 1 WHERE id = ?" : "UPDATE bill_tax_invoices SET irn = ?, ack_no = ?, ack_date = ?, irn_state = 'GENERATED', updated_at = ?, version = version + 1 WHERE id = ?").run(...(cancelled ? [`IRN ${irn} cancelled (${r.doc_no})`, nowIso(), r.document_id] : [irn, ackNo, ackDate, nowIso(), r.document_id]));
    else if (r.document_type === 'ar_credit_notes') db.prepare('UPDATE ar_credit_notes SET irn = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(cancelled ? null : irn, nowIso(), r.document_id);
  }
  const markFailed = (r) => { if (r.document_type === 'bill_tax_invoices') db.prepare("UPDATE bill_tax_invoices SET irn_state = 'FAILED', updated_at = ? WHERE id = ? AND irn_state = 'PENDING'").run(nowIso(), r.document_id); };
  const backoff = (attempts) => new Date(now() + Math.min(6 * 3600_000, 5 * 60_000 * 2 ** Math.max(0, attempts - 1))).toISOString();

  /** Sends one e-invoice to the GSP and records the answer. */
  async function send(r, actor) {
    const s = settingsOn(r.company_id); const user = actor?.user ?? 'system';
    if (!s.gsp_connector_code) { db.prepare("UPDATE gst_einvoices SET einv_status = 'FAILED', error_code = 'NO_GSP', error = ?, updated_at = ? WHERE id = ?").run('No GSP connector is set in the GST settings.', nowIso(), r.id); return; }
    if (windowApplies(s) && daysBetween(r.document_date, todayIST()) > s.irn_window_days) {
      db.prepare("UPDATE gst_einvoices SET einv_status = 'BLOCKED', error_code = 'WINDOW', error = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(`The document is older than ${s.irn_window_days} days: the IRP no longer accepts it (AATO ₹10 crore or more). Issue a fresh document.`, nowIso(), r.id);
      log(r.company_id, { documentType: r.document_type, documentId: r.document_id, refKind: 'EINVOICE', refId: r.id, action: 'generate', mode: s.gsp_mode, outcome: 'REFUSED', error: 'reporting window passed', actor: user }); return;
    }
    const payload = { json: json(r.request_json, null), windowApplies: windowApplies(s), windowDays: s.irn_window_days };
    db.prepare('UPDATE gst_einvoices SET attempts = attempts + 1, updated_at = ? WHERE id = ?').run(nowIso(), r.id);
    try {
      const out = await integrationsOf(db).hub.call(s.gsp_connector_code, 'generateIrn', payload, { companyId: r.company_id, actor: actor ?? { user: 'system' }, idempotencyKey: `irn-${r.id}` }); const d = out.data ?? {};
      transaction(db, () => {
        db.prepare("UPDATE gst_einvoices SET irn = ?, ack_no = ?, ack_date = ?, signed_qr = ?, einv_status = 'GENERATED', error_code = NULL, error = NULL, next_retry_at = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(d.Irn, String(d.AckNo), d.AckDt, d.SignedQRCode ?? null, user, nowIso(), r.id);
        linkBack(r, { irn: d.Irn, ackNo: String(d.AckNo), ackDate: d.AckDt });
        log(r.company_id, { documentType: r.document_type, documentId: r.document_id, refKind: 'EINVOICE', refId: r.id, action: 'generate', mode: s.gsp_mode, outcome: 'OK', request: payload.json, response: { Irn: d.Irn, AckNo: d.AckNo, AckDt: d.AckDt }, actor: user, integrationLogId: out.logId });
        evt('fin.einvoice.generated', actor, r.company_id, 'gst_einvoices', r.id, { einvoiceId: r.id, documentType: r.document_type, documentId: r.document_id, documentNo: r.document_no, irn: d.Irn, ackNo: String(d.AckNo), ackDate: d.AckDt, mode: s.gsp_mode });
      });
    } catch (x) {
      const code = /^(\d{3,4}|[A-Z_]+):/.exec(String(x.message))?.[1] ?? x.code ?? 'ERROR'; const retry = Boolean(x.retryable); const fresh = db.prepare('SELECT attempts FROM gst_einvoices WHERE id = ?').get(r.id);
      db.prepare("UPDATE gst_einvoices SET einv_status = 'FAILED', error_code = ?, error = ?, next_retry_at = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(String(code), String(x.message).slice(0, 1000), retry ? backoff(fresh.attempts) : null, nowIso(), r.id); markFailed(r);
      log(r.company_id, { documentType: r.document_type, documentId: r.document_id, refKind: 'EINVOICE', refId: r.id, action: 'generate', mode: s.gsp_mode, outcome: 'FAILED', request: payload.json, response: x.details ?? null, error: x.message, actor: user, integrationLogId: x.logId ?? null });
      notify(r.company_id, 'fin.gst.alert', ['permission:fin.einvoice.retry'], r.document_no, 'e-invoice failed', `The IRN for ${r.document_no} was not generated: ${x.message}${retry ? ' It is tried again by itself.' : ' Correct the document or the masters and retry.'}`, `/finance/e-invoices?id=${r.id}`, r.id, { projectId: r.org_project_id ?? undefined });
      evt('fin.einvoice.failed', actor, r.company_id, 'gst_einvoices', r.id, { einvoiceId: r.id, documentType: r.document_type, documentId: r.document_id, documentNo: r.document_no, code, retryable: retry });
    }
  }
  const einvoices = {
    list(actor, query) { need(actor, 'fin.einvoice.view', 'see e-invoices'); const f = authz.scopeFilter(actor, 'fin.einvoice.view', { project: 'x.org_project_id', site: 'x.site_id' }); return runList(db, gstList, parseListRequest(gstList, query), { select: 'x.*', scopeSql: `x.company_id = :c AND ${f.sql}`, params: { c: actor.companyId }, tieBreaker: 'x.id', map: (r) => einvView(actor, r) }); },
    get(actor, id) { return einvView(actor, einvRow(actor, id), true); },
    /** Queues the e-invoice of a document (made once; checked against the tax engine) and sends it. */
    prepare(actor, { documentType, documentId }) {
      const c = actor.companyId; const s = settingsOn(c); if (!s.einvoice_enabled) throw unprocessable('e-Invoicing is off in the GST settings of the company.');
      const src = source(c, documentType, documentId); if (actor.user !== 'system') need(actor, 'fin.einvoice.generate', 'generate e-invoices', src.projectId);
      const old = db.prepare('SELECT * FROM gst_einvoices WHERE document_type = ? AND document_id = ?').get(documentType, src.row.id); if (old) return old;
      const fy = fyOf(src.date); const same = db.prepare('SELECT doc_no FROM gst_einvoices WHERE seller_gstin = ? AND fy = ? AND irp_doc_type = ? AND upper(document_no) = upper(?)').get(src.seller, fy, src.type, src.no);
      if (same) throw conflict(`Document number ${src.no} is already reported for ${src.seller} in ${fy} (${same.doc_no}); the IRP reads numbers without regard to capitals.`);
      const b = buildEinvoice(c, src); const tax = sumOf(src.items, (it) => it.cgst + it.sgst + it.igst);
      return transaction(db, () => {
        const id = Number(db.prepare("INSERT INTO gst_einvoices (company_id, doc_no, document_type, document_id, irp_doc_type, document_no, document_date, fy, seller_gstin, buyer_gstin, supply_type, taxable_paise, tax_paise, total_paise, request_json, einv_status, due_by, gsp_mode, org_project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'B2B', ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?)")
          .run(c, docNo(c, 'gst_einvoices', 'EI'), documentType, src.row.id, src.type, src.no, src.date, fy, src.seller, src.buyer ?? null, sumOf(src.items, (it) => it.taxable), tax, src.total, JSON.stringify(b.json), windowApplies(s) ? addDays(src.date, s.irn_window_days) : null, s.gsp_mode, src.projectId ?? null, actor.user, documentType, String(src.row.id)).lastInsertRowid);
        log(c, { documentType, documentId: src.row.id, refKind: 'EINVOICE', refId: id, action: 'prepared', mode: s.gsp_mode, outcome: 'OK', request: b.json, error: b.notes.length ? b.notes.join(' ') : null, actor: actor.user });
        audit(actor, 'gst_einvoices', id, 'create', c, { newValues: { document: src.no, documentType } }); return db.prepare('SELECT * FROM gst_einvoices WHERE id = ?').get(id);
      });
    },
    async generate(actor, b) { const r = einvoices.prepare(actor, b); if (r.einv_status !== 'GENERATED' && r.einv_status !== 'CANCELLED') await send(db.prepare('SELECT * FROM gst_einvoices WHERE id = ?').get(r.id), actor); return einvView(actor, db.prepare('SELECT * FROM gst_einvoices WHERE id = ?').get(r.id), true); },
    async retry(actor, id) { const r = einvRow(actor, id, 'fin.einvoice.retry'); if (!['FAILED', 'PENDING'].includes(r.einv_status)) throw conflict(`This e-invoice is ${EINV_STATUS[r.einv_status].toLowerCase()}; nothing to retry.`);
      // the document may have been corrected since: build the request again
      const src = source(r.company_id, r.document_type, r.document_id); const b = buildEinvoice(r.company_id, src); db.prepare('UPDATE gst_einvoices SET request_json = ?, document_no = ?, buyer_gstin = ?, total_paise = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(b.json), src.no, src.buyer ?? null, src.total, actor.user, nowIso(), r.id); audit(actor, 'gst_einvoices', r.id, 'retry', r.company_id);
      await send(db.prepare('SELECT * FROM gst_einvoices WHERE id = ?').get(r.id), actor); return einvoices.get(actor, r.id); },
    async cancel(actor, id, { reasonCode, remark }) {
      const r = einvRow(actor, id, 'fin.einvoice.cancel'); if (r.einv_status !== 'GENERATED') throw conflict('Only a generated e-invoice is cancelled.'); const s = settingsOn(r.company_id);
      if (now() - Date.parse(`${String(r.ack_date).replace(' ', 'T')}+05:30`) > s.irn_cancel_hours * 3600_000) throw unprocessable(`An IRN is cancelled within ${s.irn_cancel_hours} hours of its generation; after that, issue a credit note.`);
      const payload = { Irn: r.irn, CnlRsn: String(reasonCode), CnlRem: remark, cancelHours: s.irn_cancel_hours };
      let out; try { out = await integrationsOf(db).hub.call(s.gsp_connector_code, 'cancelIrn', payload, { companyId: r.company_id, actor, idempotencyKey: `irn-cancel-${r.id}` }); }
      catch (x) { log(r.company_id, { documentType: r.document_type, documentId: r.document_id, refKind: 'EINVOICE', refId: r.id, action: 'cancel', mode: s.gsp_mode, outcome: 'FAILED', request: payload, error: x.message, actor: actor.user, integrationLogId: x.logId ?? null }); throw unprocessable(`The portal did not cancel the IRN: ${x.message}`); }
      transaction(db, () => { db.prepare("UPDATE gst_einvoices SET einv_status = 'CANCELLED', cancel_reason_code = ?, cancel_remark = ?, cancelled_at = ?, cancelled_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(String(reasonCode), remark, nowIso(), actor.user, actor.user, nowIso(), r.id); linkBack(r, { irn: r.irn, cancelled: true });
        log(r.company_id, { documentType: r.document_type, documentId: r.document_id, refKind: 'EINVOICE', refId: r.id, action: 'cancel', mode: s.gsp_mode, outcome: 'OK', request: payload, response: out.data, actor: actor.user, integrationLogId: out.logId }); audit(actor, 'gst_einvoices', r.id, 'cancel', r.company_id, { reason: `${CANCEL_REASONS[reasonCode]}: ${remark}` });
        evt('fin.einvoice.cancelled', actor, r.company_id, 'gst_einvoices', r.id, { einvoiceId: r.id, documentType: r.document_type, documentId: r.document_id, documentNo: r.document_no, irn: r.irn, reason: CANCEL_REASONS[reasonCode] }); });
      return einvoices.get(actor, r.id);
    },
    /** The IRN-due worklist: issued documents without an IRN, by the days left in the reporting window (alerts at the alert days, blocked after the window). */
    due(actor) { need(actor, 'fin.einvoice.view', 'see the IRN worklist'); return dueOf(actor.companyId, actor); },
  };
  function dueOf(c, actor) {
    { const s = settingsOn(c); const today = todayIST(); const win = s.irn_window_days; const alerts = json(s.irn_alert_days_json, [20, 25]); const may2 = (k, p) => (actor ? may(actor, k, p) : false);
      const f = actor ? authz.scopeFilter(actor, 'fin.einvoice.view', { project: 't.org_project_id', site: 't.org_site_id' }) : { sql: '1 = 1' };
      const inv = db.prepare(`SELECT t.id, t.invoice_no AS no, t.invoice_date AS date, t.total_paise, t.org_project_id, t.gstin_to, e.id AS eid, e.einv_status, e.error FROM bill_tax_invoices t LEFT JOIN gst_einvoices e ON e.document_type = 'bill_tax_invoices' AND e.document_id = t.id WHERE t.company_id = :c AND t.status = 'APPROVED' AND t.irn_state IN ('PENDING', 'FAILED') AND t.deleted_at IS NULL AND ${f.sql} ORDER BY t.invoice_date LIMIT 500`).all({ c }).map((x) => ({ documentType: 'bill_tax_invoices', ...x }));
      const cn = db.prepare("SELECT n.id, n.doc_no AS no, n.note_date AS date, n.total_paise, n.org_project_id, NULL AS gstin_to, e.id AS eid, e.einv_status, e.error FROM ar_credit_notes n LEFT JOIN gst_einvoices e ON e.document_type = 'ar_credit_notes' AND e.document_id = n.id WHERE n.company_id = ? AND n.status = 'APPROVED' AND n.irn_required = 1 AND n.irn IS NULL AND n.deleted_at IS NULL ORDER BY n.note_date LIMIT 500").all(c).map((x) => ({ documentType: 'ar_credit_notes', ...x }));
      const rows = [...inv, ...cn].filter((x) => !x.einv_status || ['PENDING', 'FAILED', 'BLOCKED'].includes(x.einv_status)).map((x) => { const age = daysBetween(x.date, today); const left = win - age; const level = left < 0 ? 'BLOCKED' : age >= Math.max(...alerts) ? 'RED' : age >= Math.min(...alerts) ? 'AMBER' : 'GREEN'; return { documentType: x.documentType, documentId: x.id, documentNo: x.no, date: x.date, value: rs(x.total_paise), recipientGstin: x.gstin_to, projectId: x.org_project_id, age, daysLeft: windowApplies(s) ? left : null, level: windowApplies(s) ? level : 'GREEN', einvoiceId: x.eid, status: x.einv_status ?? 'NONE', error: x.error, can: { generate: !x.eid && may2('fin.einvoice.generate', x.org_project_id) && (!windowApplies(s) || left >= 0), retry: Boolean(x.eid) && ['FAILED', 'PENDING'].includes(x.einv_status) && may2('fin.einvoice.retry', x.org_project_id) } }; }).sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999));
      return { windowApplies: windowApplies(s), windowDays: win, alertDays: alerts, rows, counts: { total: rows.length, amber: rows.filter((r) => r.level === 'AMBER').length, red: rows.filter((r) => r.level === 'RED').length, blocked: rows.filter((r) => r.level === 'BLOCKED').length } };
    }
  }
  Object.assign(einvoices, {
    exportCsv(actor, query = {}) { need(actor, 'fin.einvoice.export', 'export e-invoices'); const l = einvoices.list(actor, { ...query, page: 1, pageSize: 100 }); audit(actor, 'gst_einvoices', 0, 'export', actor.companyId, { reason: `${l.data.length} row(s)` }); return { contentType: 'text/csv; charset=utf-8', fileName: `e-invoices-${todayIST()}.csv`, buffer: Buffer.from(`${String.fromCharCode(0xfeff)}${toCsv(['e-Invoice', 'Type', 'Document', 'Date', 'Supplier GSTIN', 'Recipient GSTIN', 'Invoice value', 'IRN', 'Ack no', 'Ack date', 'Status', 'Error', 'Mode'], l.data.map((x) => [x.docNo, x.kind, x.documentNo, x.documentDate, x.sellerGstin, x.buyerGstin ?? '', x.total, x.irn ?? '', x.ackNo ?? '', x.ackDate ?? '', x.statusLabel, x.error ?? '', x.mode]))}`, 'utf8') }; },
    /** The e-invoice as a printable page (PDF) with the signed QR the IRP returned, to go with the invoice (04.11 prints the invoice itself). */
    async print(actor, id) {
      const r = einvRow(actor, id, 'fin.einvoice.print'); if (r.einv_status !== 'GENERATED') throw unprocessable('Only a generated e-invoice is printed with its QR.'); audit(actor, 'gst_einvoices', r.id, 'print', r.company_id);
      const q = QRCode.create(r.signed_qr, { errorCorrectionLevel: 'L' }).modules; const j = json(r.request_json, {}); const lines = [['e-Invoice', `${r.irp_doc_type} ${r.document_no} of ${r.document_date}${r.gsp_mode === 'SANDBOX' ? '  (SANDBOX - not reported to GSTN)' : ''}`], ['IRN', r.irn], ['Ack no / date', `${r.ack_no} / ${r.ack_date}`], ['Supplier', `${j.SellerDtls?.LglNm ?? ''} (${r.seller_gstin})`], ['Recipient', `${j.BuyerDtls?.LglNm ?? ''} (${r.buyer_gstin ?? 'URP'})`], ['Place of supply', j.BuyerDtls?.Pos ?? ''], ['Assessable value', `Rs ${(r.taxable_paise / 100).toFixed(2)}`], ['GST', `Rs ${(r.tax_paise / 100).toFixed(2)}`], ['Invoice value', `Rs ${(r.total_paise / 100).toFixed(2)}`]];
      return { contentType: 'application/pdf', fileName: `${r.document_no.replaceAll('/', '-')}-e-invoice.pdf`, buffer: qrPdf(lines, q) };
    },
    async qrSvg(actor, id) { const r = einvRow(actor, id); if (!r.signed_qr) throw notFound('This e-invoice has no QR yet.'); return QRCode.toString(r.signed_qr, { type: 'svg', errorCorrectionLevel: 'L', margin: 2 }); },
    log: (actor, id) => { const r = einvRow(actor, id); return complianceLog(r.company_id, r.document_type, r.document_id); },
  });

  // ---- FR-04: e-way bills ----
  const ewbRow = (actor, id, key = 'fin.ewaybill.view') => { const r = db.prepare('SELECT * FROM gst_ewaybills WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!r || !may(actor, 'fin.ewaybill.view', r.org_project_id)) throw notFound('That e-way bill does not exist.'); if (key !== 'fin.ewaybill.view' && !may(actor, key, r.org_project_id)) throw forbidden(`You may not do this (permission ${key}).`); return r; };
  const hist = (r, what) => JSON.stringify([...json(r.history_json, []), { at: nowIso(), ...what }]);
  const ewbView = (actor, r, detail = false) => { const s = settingsOn(r.company_id); const left = r.ewb_status === 'ACTIVE' && r.valid_until ? (Date.parse(r.valid_until) - now()) / 3600_000 : null; const win = s.eway_ext_window_hours;
    const o = { id: r.id, docNo: r.doc_no, documentType: r.document_type, documentId: r.document_id, documentNo: r.document_no, documentDate: r.document_date, docKind: r.ewb_doc_type, subType: r.sub_type, fromGstin: r.from_gstin, toGstin: r.to_gstin, fromState: r.from_state, toState: r.to_state, fromPin: r.from_pin, toPin: r.to_pin, distance: r.distance_km, hsn: r.hsn_code, value: rs(r.value_paise), tax: rs(r.tax_paise), transportMode: r.transport_mode, vehicleType: r.vehicle_type, vehicleNo: r.vehicle_no, transporterId: r.transporter_id, ewbNo: r.ewb_no, ewbDate: r.ewb_date, validUntil: r.valid_until, hoursLeft: left == null ? null : Math.round(left * 10) / 10, extensions: r.extensions_count, status: r.ewb_status, statusLabel: EWB_STATUS[r.ewb_status], errorCode: r.error_code, error: r.error, attempts: r.attempts, mode: r.gsp_mode, projectId: r.org_project_id, version: r.version,
      can: { vehicle: ['PART_A', 'ACTIVE'].includes(r.ewb_status) && may(actor, 'fin.ewaybill.update', r.org_project_id), extend: r.ewb_status === 'ACTIVE' && left != null && Math.abs(left) <= win && may(actor, 'fin.ewaybill.extend', r.org_project_id), cancel: ['PART_A', 'ACTIVE'].includes(r.ewb_status) && r.ewb_date && now() - Date.parse(r.ewb_date) <= s.eway_cancel_hours * 3600_000 && may(actor, 'fin.ewaybill.cancel', r.org_project_id), retry: ['FAILED', 'PENDING'].includes(r.ewb_status) && may(actor, 'fin.ewaybill.retry', r.org_project_id) } };
    if (detail) { o.history = json(r.history_json, []); o.log = complianceLog(r.company_id, r.document_type, r.document_id).filter((x) => x.kind === 'EWAYBILL'); }
    return o; };
  /** What a source document already says for its e-way bill: parties, states, PINs, value, HSN, vehicle (the rest is typed on the form). */
  function ewbSource(companyId, documentType, documentId) {
    const own = ownGstins(companyId); const comp = companyOf(companyId); const caddr = json(comp?.address_json || '{}', {});
    if (documentType === 'bill_tax_invoices') { const r = db.prepare('SELECT * FROM bill_tax_invoices WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(documentId), companyId); if (!r) throw notFound('That tax invoice does not exist.'); if (r.status !== 'APPROVED' || !r.invoice_no) throw unprocessable('Only an issued tax invoice gets an e-way bill.'); const k = r.contract_id ? db.prepare('SELECT client_partner_id FROM ctr_contracts WHERE id = ?').get(r.contract_id) : null; const ad = k ? db.prepare('SELECT pin FROM mdm_partner_addresses WHERE partner_id = ? AND deleted_at IS NULL ORDER BY is_default DESC, id LIMIT 1').get(k.client_partner_id) : null; return { row: r, projectId: r.org_project_id, no: r.invoice_no, date: r.invoice_date, docKind: 'INV', subType: 'SUPPLY', fromGstin: r.gstin_from, toGstin: r.gstin_to, fromState: r.gstin_from.slice(0, 2), toState: r.place_state, fromPin: caddr.pincode ?? null, toPin: ad?.pin ?? null, value: r.taxable_paise, tax: r.cgst_paise + r.sgst_paise + r.igst_paise, hsn: r.sac_code, vehicleNo: null }; }
    if (documentType === 'inv_transfers') { const r = db.prepare('SELECT * FROM inv_transfers WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(documentId), companyId); if (!r) throw notFound('That transfer does not exist.'); if (!['APPROVED', 'IN_TRANSIT'].includes(r.status)) throw unprocessable('An e-way bill is made for an approved transfer, before or at dispatch.'); const hsn = db.prepare("SELECT i.hsn_sac_code AS code FROM inv_transfer_lines l JOIN mdm_items i ON i.id = l.item_id WHERE l.transfer_id = ? AND l.deleted_at IS NULL ORDER BY l.value DESC, l.id LIMIT 1").get(r.id)?.code ?? null; return { row: r, projectId: r.from_project_id, no: r.doc_no, date: r.request_date, docKind: r.inter_state ? 'INV' : 'CHL', subType: 'BRANCH_TRANSFER', fromGstin: own[0]?.gstin ?? null, toGstin: own[0]?.gstin ?? null, fromState: own[0]?.stateCode ?? null, toState: own[0]?.stateCode ?? null, fromPin: caddr.pincode ?? null, toPin: null, value: Number(r.total_value ?? 0), tax: 0, hsn, vehicleNo: r.vehicle_no }; }
    if (documentType === 'bp_delivery_tickets') { const r = db.prepare('SELECT * FROM bp_delivery_tickets WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(documentId), companyId); if (!r) throw notFound('That delivery ticket does not exist.'); return { row: r, projectId: r.org_project_id, no: r.ticket_no ?? r.doc_no, date: String(r.departed_at ?? r.batched_at ?? r.created_at ?? todayIST()).slice(0, 10), docKind: 'CHL', subType: 'OWN_USE', fromGstin: own[0]?.gstin ?? null, toGstin: own[0]?.gstin ?? null, fromState: own[0]?.stateCode ?? null, toState: own[0]?.stateCode ?? null, fromPin: caddr.pincode ?? null, toPin: null, value: 0, tax: 0, hsn: '3824', vehicleNo: r.truck_no }; }
    throw badRequest('Correct the highlighted fields', [{ field: 'documentType', message: 'An e-way bill is made for a tax invoice, a stock transfer or a concrete delivery.' }]);
  }
  async function ewbCall(r, op, payload, actor, action) {
    const s = settingsOn(r.company_id); if (!s.gsp_connector_code) throw unprocessable('No GSP connector is set in the GST settings.');
    try { const out = await integrationsOf(db).hub.call(s.gsp_connector_code, op, payload, { companyId: r.company_id, actor: actor ?? { user: 'system' }, idempotencyKey: `ewb-${action}-${r.id}-${r.version}` }); log(r.company_id, { documentType: r.document_type, documentId: r.document_id, refKind: 'EWAYBILL', refId: r.id, action, mode: s.gsp_mode, outcome: 'OK', request: payload, response: out.data, actor: actor?.user ?? 'system', integrationLogId: out.logId }); return out.data ?? {}; }
    catch (x) { log(r.company_id, { documentType: r.document_type, documentId: r.document_id, refKind: 'EWAYBILL', refId: r.id, action, mode: s.gsp_mode, outcome: 'FAILED', request: payload, response: x.details ?? null, error: x.message, actor: actor?.user ?? 'system', integrationLogId: x.logId ?? null }); throw x; }
  }
  const ewbPayload = (r, s) => ({ supplyType: 'O', subSupplyType: r.sub_type, docType: r.ewb_doc_type, docNo: r.document_no, docDate: r.document_date, fromGstin: r.from_gstin, toGstin: r.to_gstin ?? 'URP', fromStateCode: r.from_state, toStateCode: r.to_state, fromPincode: r.from_pin, toPincode: r.to_pin, transDistance: r.distance_km, hsnCode: r.hsn_code, totalValue: amt(r.value_paise), totInvValue: amt(r.value_paise + r.tax_paise), transMode: r.transport_mode, vehicleType: r.vehicle_type, vehicleNo: r.vehicle_no ?? undefined, transporterId: r.transporter_id ?? undefined, maxDocAgeDays: s.eway_max_doc_age_days, kmPerDay: r.vehicle_type === 'ODC' ? s.eway_odc_km_per_day : s.eway_km_per_day });
  async function sendEwb(r, actor) {
    const s = settingsOn(r.company_id); db.prepare('UPDATE gst_ewaybills SET attempts = attempts + 1, updated_at = ? WHERE id = ?').run(nowIso(), r.id);
    try { const d = await ewbCall(r, 'generateEwb', ewbPayload(r, s), actor, 'generate'); const at = nowIso();
      transaction(db, () => { db.prepare('UPDATE gst_ewaybills SET ewb_no = ?, ewb_date = ?, valid_until = ?, ewb_status = ?, error_code = NULL, error = NULL, history_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(String(d.ewayBillNo), at, d.validUpto ?? null, d.validUpto ? 'ACTIVE' : 'PART_A', hist(r, { what: 'generated', ewbNo: String(d.ewayBillNo), vehicleNo: r.vehicle_no, validUntil: d.validUpto ?? null, by: actor?.user ?? 'system' }), actor?.user ?? 'system', at, r.id);
        evt('fin.ewaybill.generated', actor, r.company_id, 'gst_ewaybills', r.id, { ewaybillId: r.id, ewbNo: String(d.ewayBillNo), documentType: r.document_type, documentId: r.document_id, documentNo: r.document_no, vehicleNo: r.vehicle_no, validUntil: d.validUpto ?? null, projectId: r.org_project_id }); });
    } catch (x) { db.prepare("UPDATE gst_ewaybills SET ewb_status = 'FAILED', error_code = ?, error = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(/^(\d{3,4}|[A-Z_]+):/.exec(String(x.message))?.[1] ?? x.code ?? 'ERROR', String(x.message).slice(0, 1000), nowIso(), r.id); notify(r.company_id, 'fin.gst.alert', ['permission:fin.ewaybill.retry'], r.document_no, 'e-way bill failed', `The e-way bill for ${r.document_no} was not generated: ${x.message}`, `/finance/e-invoices?tab=ewb&ewb=${r.id}`, r.id, { projectId: r.org_project_id ?? undefined }); }
  }
  const ewaybills = {
    list(actor, query) { need(actor, 'fin.ewaybill.view', 'see e-way bills'); const f = authz.scopeFilter(actor, 'fin.ewaybill.view', { project: 'x.org_project_id', site: 'x.site_id' }); return runList(db, ewbList, parseListRequest(ewbList, query), { select: 'x.*', scopeSql: `x.company_id = :c AND ${f.sql}`, params: { c: actor.companyId }, tieBreaker: 'x.id', map: (r) => ewbView(actor, r) }); },
    get(actor, id) { return ewbView(actor, ewbRow(actor, id), true); },
    prepare(actor, { documentType, documentId }) { need(actor, 'fin.ewaybill.generate', 'make e-way bills'); const s = ewbSource(actor.companyId, documentType, documentId); if (!may(actor, 'fin.ewaybill.generate', s.projectId)) throw notFound('That document does not exist.'); const st = settingsOn(actor.companyId); const live = db.prepare("SELECT id, ewb_no, ewb_status FROM gst_ewaybills WHERE document_type = ? AND document_id = ? AND ewb_status IN ('PENDING', 'PART_A', 'ACTIVE', 'FAILED')").get(documentType, s.row.id);
      return { documentType, documentId: s.row.id, documentNo: s.no, documentDate: s.date, docKind: s.docKind, subType: s.subType, fromGstin: s.fromGstin, toGstin: s.toGstin, fromState: s.fromState, toState: s.toState, fromPin: s.fromPin, toPin: s.toPin, value: rs(s.value), tax: rs(s.tax), hsn: s.hsn, vehicleNo: s.vehicleNo, existing: live ? { id: live.id, ewbNo: live.ewb_no, status: live.ewb_status } : null, required: s.fromState !== s.toState || s.value + s.tax >= st.eway_threshold_paise, threshold: rs(st.eway_threshold_paise), enabled: Boolean(st.eway_enabled) }; },
    async generate(actor, b) {
      need(actor, 'fin.ewaybill.generate', 'make e-way bills'); const c = actor.companyId; const st = settingsOn(c); if (!st.eway_enabled) throw unprocessable('E-way bills are off in the GST settings of the company.');
      const s = ewbSource(c, b.documentType, b.documentId); if (!may(actor, 'fin.ewaybill.generate', s.projectId)) throw notFound('That document does not exist.');
      const age = daysBetween(s.date, todayIST()); if (age > st.eway_max_doc_age_days) throw unprocessable(`The document is ${age} days old: an e-way bill is made for a document at most ${st.eway_max_doc_age_days} days old.`);
      const v = { from_gstin: b.fromGstin ?? s.fromGstin, to_gstin: b.toGstin ?? s.toGstin, from_state: b.fromState ?? s.fromState ?? String(b.fromGstin ?? s.fromGstin ?? '').slice(0, 2), to_state: b.toState ?? s.toState, from_pin: b.fromPin ?? s.fromPin, to_pin: b.toPin ?? s.toPin, hsn_code: b.hsn ?? s.hsn, value_paise: b.value != null ? paise(b.value) : s.value, tax_paise: b.tax != null ? paise(b.tax) : s.tax };
      const p = []; if (!v.from_gstin || gstinProblem(v.from_gstin)) p.push({ field: 'fromGstin', message: 'The consignor GSTIN is required and valid.' }); if (v.to_gstin && v.to_gstin !== 'URP' && gstinProblem(v.to_gstin)) p.push({ field: 'toGstin', message: 'The consignee GSTIN is not valid.' }); for (const [k, f] of [['from_state', 'fromState'], ['to_state', 'toState']]) if (!isStateCode(String(v[k] ?? ''))) p.push({ field: f, message: 'A GST state code.' }); for (const [k, f] of [['from_pin', 'fromPin'], ['to_pin', 'toPin']]) if (!/^[1-9]\d{5}$/.test(String(v[k] ?? ''))) p.push({ field: f, message: 'A 6-digit PIN code.' }); if (!/^\d{4,8}$/.test(String(v.hsn_code ?? ''))) p.push({ field: 'hsn', message: 'The HSN code of the main goods (4 to 8 digits).' }); if (!(v.value_paise > 0)) p.push({ field: 'value', message: 'The value of the goods.' }); if (p.length) throw badRequest('Correct the highlighted fields', p);
      if (db.prepare("SELECT 1 FROM gst_ewaybills WHERE document_type = ? AND document_id = ? AND ewb_status IN ('PENDING', 'PART_A', 'ACTIVE', 'FAILED')").get(b.documentType, s.row.id)) throw conflict('This document already has an e-way bill; update its vehicle or cancel it first.');
      const vehicle = b.vehicleNo ? String(b.vehicleNo).toUpperCase().replace(/[\s-]+/g, '') : null;
      const id = transaction(db, () => { const i = Number(db.prepare("INSERT INTO gst_ewaybills (company_id, doc_no, document_type, document_id, document_no, document_date, ewb_doc_type, sub_type, from_gstin, to_gstin, from_state, to_state, from_pin, to_pin, distance_km, hsn_code, value_paise, tax_paise, transport_mode, vehicle_type, vehicle_no, transporter_id, transporter_doc, gsp_mode, org_project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(c, docNo(c, 'gst_ewaybills', 'EWB'), b.documentType, s.row.id, s.no, s.date, s.docKind, b.subType ?? s.subType, v.from_gstin, v.to_gstin ?? null, v.from_state, v.to_state, v.from_pin, v.to_pin, b.distance, v.hsn_code, v.value_paise, v.tax_paise, b.transportMode ?? 'ROAD', b.vehicleType ?? 'REGULAR', vehicle, b.transporterId ?? null, b.transporterDoc ?? null, st.gsp_mode, s.projectId ?? null, actor.user, b.documentType, String(s.row.id)).lastInsertRowid); audit(actor, 'gst_ewaybills', i, 'create', c, { newValues: { document: s.no, vehicleNo: vehicle, distance: b.distance } }); return i; });
      await sendEwb(db.prepare('SELECT * FROM gst_ewaybills WHERE id = ?').get(id), actor); return ewaybills.get(actor, id);
    },
    async retry(actor, id) { const r = ewbRow(actor, id, 'fin.ewaybill.retry'); if (!['FAILED', 'PENDING'].includes(r.ewb_status)) throw conflict('Nothing to retry.'); audit(actor, 'gst_ewaybills', r.id, 'retry', r.company_id); await sendEwb(r, actor); return ewaybills.get(actor, r.id); },
    async vehicle(actor, id, b) {
      const r = ewbRow(actor, id, 'fin.ewaybill.update'); if (!['PART_A', 'ACTIVE'].includes(r.ewb_status)) throw conflict('Only a live e-way bill takes a vehicle.'); if (b.version !== r.version) throw conflict('Someone changed this e-way bill meanwhile: reload it.');
      const veh = String(b.vehicleNo).toUpperCase().replace(/[\s-]+/g, ''); const d = await ewbCall(r, 'updatePartB', { ewbNo: r.ewb_no, vehicleNo: veh, fromPlace: b.fromPlace, reasonCode: b.reasonCode, reasonRem: b.remark }, actor, 'vehicle');
      db.prepare("UPDATE gst_ewaybills SET vehicle_no = ?, valid_until = ?, ewb_status = 'ACTIVE', history_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(veh, d.validUpto ?? r.valid_until, hist(r, { what: 'vehicle', vehicleNo: veh, from: b.fromPlace, reason: b.remark, validUntil: d.validUpto ?? r.valid_until, by: actor.user }), actor.user, nowIso(), r.id); audit(actor, 'gst_ewaybills', r.id, 'vehicle', r.company_id, { oldValues: { vehicleNo: r.vehicle_no }, newValues: { vehicleNo: veh } });
      evt('fin.ewaybill.vehicle_updated', actor, r.company_id, 'gst_ewaybills', r.id, { ewaybillId: r.id, ewbNo: r.ewb_no, vehicleNo: veh, validUntil: d.validUpto ?? r.valid_until, documentType: r.document_type, documentId: r.document_id }); return ewaybills.get(actor, r.id);
    },
    async extend(actor, id, b) {
      const r = ewbRow(actor, id, 'fin.ewaybill.extend'); if (r.ewb_status !== 'ACTIVE') throw conflict('Only a valid e-way bill is extended.'); const s = settingsOn(r.company_id); const end = Date.parse(r.valid_until); const win = s.eway_ext_window_hours * 3600_000;
      if (now() < end - win || now() > end + win) throw unprocessable(`An e-way bill is extended within ${s.eway_ext_window_hours} hours before or after it expires (it expires ${r.valid_until}).`);
      const next = endOfIstDay(new Date(Math.max(now(), end)).toISOString(), validityDays(b.remainingKm, r.vehicle_type === 'ODC' ? s.eway_odc_km_per_day : s.eway_km_per_day)); if (Date.parse(next) > Date.parse(r.ewb_date) + s.eway_ext_cap_days * 86_400_000) throw unprocessable(`An e-way bill is not extended beyond ${s.eway_ext_cap_days} days from its generation.`);
      const d = await ewbCall(r, 'extendEwb', { ewbNo: r.ewb_no, vehicleNo: b.vehicleNo ?? r.vehicle_no, remainingDistance: b.remainingKm, extnRsnCode: b.reasonCode, extnRemarks: b.remark, fromPlace: b.fromPlace, windowHours: s.eway_ext_window_hours, capDays: s.eway_ext_cap_days, kmPerDay: r.vehicle_type === 'ODC' ? s.eway_odc_km_per_day : s.eway_km_per_day }, actor, 'extend');
      db.prepare('UPDATE gst_ewaybills SET valid_until = ?, extensions_count = extensions_count + 1, alerted_at = NULL, history_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(d.validUpto ?? next, hist(r, { what: 'extended', remainingKm: b.remainingKm, reason: b.remark, validUntil: d.validUpto ?? next, by: actor.user }), actor.user, nowIso(), r.id); audit(actor, 'gst_ewaybills', r.id, 'extend', r.company_id, { oldValues: { validUntil: r.valid_until }, newValues: { validUntil: d.validUpto ?? next } });
      evt('fin.ewaybill.extended', actor, r.company_id, 'gst_ewaybills', r.id, { ewaybillId: r.id, ewbNo: r.ewb_no, validUntil: d.validUpto ?? next }); return ewaybills.get(actor, r.id);
    },
    async cancel(actor, id, b) {
      const r = ewbRow(actor, id, 'fin.ewaybill.cancel'); if (!['PART_A', 'ACTIVE'].includes(r.ewb_status)) throw conflict('Only a live e-way bill is cancelled.'); const s = settingsOn(r.company_id); if (now() - Date.parse(r.ewb_date) > s.eway_cancel_hours * 3600_000) throw unprocessable(`An e-way bill is cancelled within ${s.eway_cancel_hours} hours of its generation.`);
      await ewbCall(r, 'cancelEwb', { ewbNo: r.ewb_no, cancelRsnCode: String(b.reasonCode), cancelRmrk: b.remark, cancelHours: s.eway_cancel_hours }, actor, 'cancel');
      db.prepare("UPDATE gst_ewaybills SET ewb_status = 'CANCELLED', cancel_reason_code = ?, cancel_remark = ?, cancelled_at = ?, history_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(String(b.reasonCode), b.remark, nowIso(), hist(r, { what: 'cancelled', reason: `${CANCEL_REASONS[b.reasonCode]}: ${b.remark}`, by: actor.user }), actor.user, nowIso(), r.id); audit(actor, 'gst_ewaybills', r.id, 'cancel', r.company_id, { reason: b.remark });
      evt('fin.ewaybill.cancelled', actor, r.company_id, 'gst_ewaybills', r.id, { ewaybillId: r.id, ewbNo: r.ewb_no, documentType: r.document_type, documentId: r.document_id }); return ewaybills.get(actor, r.id);
    },
    /** The live e-way bill number of a document (the transfer's dispatch and the concrete ticket take it instead of a typed one). */
    activeFor(companyId, documentType, documentId) { return db.prepare("SELECT ewb_no FROM gst_ewaybills WHERE company_id = ? AND document_type = ? AND document_id = ? AND ewb_status IN ('PART_A', 'ACTIVE') ORDER BY id DESC LIMIT 1").get(companyId, documentType, Number(documentId))?.ewb_no ?? null; },
    /** Documents that may need an e-way bill and have none: issued invoices, approved transfers not yet received, concrete leaving the premises. */
    sources(actor) { need(actor, 'fin.ewaybill.generate', 'make e-way bills'); const c = actor.companyId; const none = (t) => `NOT EXISTS (SELECT 1 FROM gst_ewaybills e WHERE e.document_type = '${t}' AND e.document_id = x.id AND e.ewb_status IN ('PENDING', 'PART_A', 'ACTIVE', 'FAILED'))`;
      const rows = [...db.prepare(`SELECT 'bill_tax_invoices' AS t, x.id, x.invoice_no AS no, x.invoice_date AS d, x.total_paise AS v, x.org_project_id AS p FROM bill_tax_invoices x WHERE x.company_id = ? AND x.status = 'APPROVED' AND x.invoice_no IS NOT NULL AND x.deleted_at IS NULL AND ${none('bill_tax_invoices')} ORDER BY x.id DESC LIMIT 50`).all(c), ...db.prepare(`SELECT 'inv_transfers' AS t, x.id, x.doc_no AS no, x.request_date AS d, x.total_value AS v, x.from_project_id AS p FROM inv_transfers x WHERE x.company_id = ? AND x.status IN ('APPROVED', 'IN_TRANSIT') AND x.deleted_at IS NULL AND ${none('inv_transfers')} ORDER BY x.id DESC LIMIT 50`).all(c), ...db.prepare(`SELECT 'bp_delivery_tickets' AS t, x.id, COALESCE(x.ticket_no, x.doc_no) AS no, substr(COALESCE(x.departed_at, x.created_at), 1, 10) AS d, 0 AS v, x.org_project_id AS p FROM bp_delivery_tickets x WHERE x.company_id = ? AND x.outside_premises = 1 AND x.eway_no IS NULL AND x.deleted_at IS NULL AND ${none('bp_delivery_tickets')} ORDER BY x.id DESC LIMIT 50`).all(c)];
      return rows.filter((r) => may(actor, 'fin.ewaybill.generate', r.p)).map((r) => ({ documentType: r.t, documentId: r.id, documentNo: r.no, date: r.d, value: rs(Number(r.v ?? 0)) })); },
    exportCsv(actor, query = {}) { need(actor, 'fin.ewaybill.export', 'export e-way bills'); const l = ewaybills.list(actor, { ...query, page: 1, pageSize: 100 }); audit(actor, 'gst_ewaybills', 0, 'export', actor.companyId, { reason: `${l.data.length} row(s)` }); return { contentType: 'text/csv; charset=utf-8', fileName: `e-way-bills-${todayIST()}.csv`, buffer: Buffer.from(`${String.fromCharCode(0xfeff)}${toCsv(['Record', 'E-way bill', 'Document', 'Date', 'From GSTIN', 'To GSTIN', 'States', 'km', 'Vehicle', 'Value', 'Valid until', 'Extensions', 'Status'], l.data.map((x) => [x.docNo, x.ewbNo ?? '', x.documentNo, x.documentDate, x.fromGstin, x.toGstin ?? '', `${x.fromState}-${x.toState}`, x.distance, x.vehicleNo ?? '', x.value, x.validUntil ?? '', x.extensions, x.statusLabel]))}`, 'utf8') }; },
  };

  // ---- the daily work: retries, IRN alerts (day 20 and 25), e-way bills about to expire, expired ones ----
  const jobs = {
    async retryDue() { const rows = db.prepare("SELECT * FROM gst_einvoices WHERE einv_status IN ('PENDING', 'FAILED') AND (next_retry_at IS NOT NULL AND next_retry_at <= ? OR einv_status = 'PENDING') AND attempts < 8 AND deleted_at IS NULL ORDER BY id LIMIT 200").all(new Date(now()).toISOString()); let ok = 0; for (const r of rows) { if (!on(r.company_id)) continue; await send(r, null); if (db.prepare('SELECT einv_status FROM gst_einvoices WHERE id = ?').get(r.id).einv_status === 'GENERATED') ok += 1; } return { tried: rows.length, generated: ok }; },
    alerts() {
      let irn = 0; let ewb = 0; let expired = 0; const today = todayIST();
      for (const c of db.prepare('SELECT id FROM org_companies').all()) {
        if (!on(c.id)) continue; const s = settingsOn(c.id); const d = dueOf(c.id, null);
        for (const r of d.rows) { if (!d.windowApplies) break; if (s && (d.alertDays.includes(r.age) || r.daysLeft === 1)) { irn += 1; notify(c.id, 'fin.gst.alert', ['permission:fin.einvoice.generate'], r.documentNo, `IRN due in ${r.daysLeft} day(s)`, `${r.documentNo} of ${r.date} has no IRN; the IRP stops taking it after ${addDays(r.date, d.windowDays)}.`, '/finance/e-invoices?tab=due', r.documentId, { projectId: r.projectId ?? undefined }); } }
        for (const r of db.prepare("SELECT * FROM gst_ewaybills WHERE company_id = ? AND ewb_status = 'ACTIVE' AND valid_until IS NOT NULL AND alerted_at IS NULL AND julianday(valid_until) - julianday(?) <= ? / 24.0").all(c.id, new Date(now()).toISOString(), s.eway_alert_hours)) { ewb += 1; db.prepare('UPDATE gst_ewaybills SET alerted_at = ? WHERE id = ?').run(nowIso(), r.id); notify(c.id, 'fin.gst.alert', ['permission:fin.ewaybill.extend'], r.ewb_no, 'e-way bill expiring', `E-way bill ${r.ewb_no} (${r.document_no}, vehicle ${r.vehicle_no ?? '-'}) expires ${r.valid_until}. Extend it within ${s.eway_ext_window_hours} hours of the expiry if the goods are still on the way.`, `/finance/e-invoices?tab=ewb&ewb=${r.id}`, r.id, { projectId: r.org_project_id ?? undefined }); }
        expired += db.prepare("UPDATE gst_ewaybills SET ewb_status = 'EXPIRED', updated_at = ? WHERE company_id = ? AND ewb_status = 'ACTIVE' AND valid_until < ? AND julianday(?) - julianday(valid_until) > ? / 24.0").run(nowIso(), c.id, new Date(now()).toISOString(), new Date(now()).toISOString(), s.eway_ext_window_hours).changes;
      }
      void today; return { irnAlerts: irn, ewbAlerts: ewb, expired };
    },
  };

  // ---- consumers: the documents that need an IRN, by their events (idempotent: one e-invoice per document) ----
  const consumers = {
    onInvoiceIssued(e) { const c = Number(e.companyId); const d = e.data ?? {}; if (!c || !on(c) || !d.irnRequired || !d.invoiceId) return null; return queue(c, 'bill_tax_invoices', d.invoiceId); },
    onCreditNote(e) { const c = Number(e.companyId); const d = e.data ?? {}; if (!c || !on(c) || !d.irnRequired || !d.noteId) return null; return queue(c, 'ar_credit_notes', d.noteId); },
  };
  function queue(companyId, documentType, documentId) {
    try { const r = einvoices.prepare(SYS(companyId), { documentType, documentId }); void send(r, null).catch(() => {}); return r.id; }
    catch (x) { log(companyId, { documentType, documentId, refKind: 'EINVOICE', action: 'prepare', mode: settingsOn(companyId).gsp_mode, outcome: 'REFUSED', error: x.message }); notify(companyId, 'fin.gst.alert', ['permission:fin.einvoice.generate'], String(documentId), 'e-invoice not prepared', `The e-invoice of document ${documentId} (${documentType}) was not prepared: ${x.message}`, '/finance/e-invoices?tab=due', Number(documentId)); return null; }
  }

  return { resolve: (actor, input) => { need(actor, 'fin.gst.resolve', 'use the tax engine'); return resolve(actor.companyId, input); }, resolveFor: resolve, rateOn, settings, settingsOn, gstins, einvoices, ewaybills, jobs, consumers, ownGstins };
}

/** A one-page PDF: the e-invoice's lines of text and its signed QR drawn as squares (no image library needed). */
function qrPdf(lines, modules) {
  const esc = (s) => String(s).replace(/[^\x20-\x7e]/g, '?').replace(/([()\\])/g, '\\$1');
  const n = modules.size; const cell = Math.min(4, 220 / n); const x0 = 595 - 36 - n * cell; const y0 = 842 - 60;
  let qr = '0 0 0 rg\n'; for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) if (modules.get(x, y)) qr += `${(x0 + x * cell).toFixed(2)} ${(y0 - (y + 1) * cell).toFixed(2)} ${cell.toFixed(2)} ${cell.toFixed(2)} re f\n`;
  let txt = 'BT /F1 14 Tf 36 800 Td (e-Invoice) Tj ET\n'; lines.forEach(([k, v], i) => { const y = 770 - i * 18; txt += `BT /F1 9 Tf 36 ${y} Td (${esc(k)}) Tj ET\nBT /F1 9 Tf 140 ${y} Td (${esc(String(v).slice(0, 70))}) Tj ET\n`; if (String(v).length > 70) txt += `BT /F1 9 Tf 140 ${y - 9} Td (${esc(String(v).slice(70, 140))}) Tj ET\n`; });
  const stream = `${txt}${qr}`; const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n'; const offs = []; objs.forEach((o, i) => { offs.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; }); const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`; return Buffer.from(out, 'latin1');
}
