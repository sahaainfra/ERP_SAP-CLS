import { createHash } from 'node:crypto';
import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { commOf } from '../../platform/comm/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { fileEntities } from '../../platform/files/entities.js';
import { HttpError, badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { createVault } from '../../platform/integrations/vault.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { FORMATS, mask, nameKey, similarity } from '../../platform/mdm/index.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { objectTypes } from '../../platform/objects/index.js';
import { createParameterStore, parameterRegistry } from '../../platform/parameters/index.js';
import { tasksOf } from '../../platform/tasks/index.js';
import { evidenceProviders, workflowOf, workflowTypes } from '../../platform/workflow/index.js';
import { fromUnits, toUnits } from '../../../shared/money.js';
import { todayIST } from '../../../shared/dates.js';
import { commonOf } from './common.js';

// The business partner master (part 06.04): one record per vendor, subcontractor, labour contractor, service provider, client, consultant or transporter (a partner may hold several roles), with its statutory
// identity (PAN, GSTIN per state, MSME, CIN), addresses, contacts, bank accounts, compliance documents with expiry and TDS settings. A registration is saved as a Prospect and sent for approval: the steward
// of its roles (procurement manager for vendors, service providers and transporters; commercial manager for subcontractors, labour contractors, clients and consultants) and then the accounts manager, who
// verifies the statutory and bank details (MDM_PARTNER). A bank account number is stored encrypted (the vault of 04.07), with a hash for duplicates and its last four digits for display (BR-01); a change of
// bank is confirmed by the partner (a code to its registered contact, or a call-back noted), approved by the accounts manager and the CFO, and holds payments until approved and the cooling-off period has
// passed (BR-03, MDM_PARTNER_BANK). Blacklisting and lifting it are approved by the director (MDM_PARTNER_STATUS); a blacklisted or held partner cannot be chosen for a new RFQ, PO or work order (BR-02),
// and neither can one whose compliance documents of a blocking type have expired, when the company sets them (T-03).
export const ROLES = ['VENDOR', 'SUBCONTRACTOR', 'LABOUR_CONTRACTOR', 'SERVICE_PROVIDER', 'CLIENT', 'CONSULTANT', 'TRANSPORTER'];
export const ROLE_LABELS = { VENDOR: 'Vendor or supplier', SUBCONTRACTOR: 'Subcontractor', LABOUR_CONTRACTOR: 'Labour contractor', SERVICE_PROVIDER: 'Service provider', CLIENT: 'Client', CONSULTANT: 'Consultant', TRANSPORTER: 'Transporter' };
const PROC_ROLES = new Set(['VENDOR', 'SERVICE_PROVIDER', 'TRANSPORTER']);
export const CONSTITUTIONS = ['PROPRIETORSHIP', 'PARTNERSHIP', 'LLP', 'PRIVATE_LIMITED', 'PUBLIC_LIMITED', 'TRUST', 'SOCIETY', 'GOVERNMENT', 'HUF', 'INDIVIDUAL', 'OTHER'];
/** The fourth character of a PAN says who holds it: P person, C company, F firm or LLP, H HUF, T trust, G government, A/B association. */
const PAN_HOLDER = { PROPRIETORSHIP: ['P'], INDIVIDUAL: ['P'], PRIVATE_LIMITED: ['C'], PUBLIC_LIMITED: ['C'], PARTNERSHIP: ['F'], LLP: ['F'], HUF: ['H'], TRUST: ['T'], GOVERNMENT: ['G'], SOCIETY: ['A', 'B', 'T'] };
export const DOC_TYPES = { GST_CERTIFICATE: 'GST certificate', PAN_CARD: 'PAN card', MSME_CERTIFICATE: 'MSME (Udyam) certificate', CLRA_LICENCE: 'Labour licence (CLRA)', PF_REGISTRATION: 'PF registration', ESI_REGISTRATION: 'ESI registration', INSURANCE: 'Insurance', ISO_CERTIFICATE: 'ISO certificate', CANCELLED_CHEQUE: 'Cancelled cheque', INCORPORATION: 'Certificate of incorporation', OTHER: 'Other' };
export const STATUS_LABELS = { PROSPECT: 'Prospect', PENDING: 'Pending approval', ACTIVE: 'Active', ON_HOLD: 'On hold', BLACKLISTED: 'Blacklisted', INACTIVE: 'Inactive', REJECTED: 'Rejected' };
export const PARTNER_DOC = 'MDM_PARTNER';
export const BANK_DOC = 'MDM_PARTNER_BANK';
export const STATUS_DOC = 'MDM_PARTNER_STATUS';
const UDYAM = /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/;
const CIN = /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;
const nowIso = () => new Date().toISOString();
const addDays = (iso, n) => new Date(Date.parse(iso) + n * 86_400_000).toISOString();
const dayPlus = (n) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
const json = (s, d) => { try { return JSON.parse(s ?? ''); } catch { return d; } };
const trimNum = (s) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);

for (const [key, dataType, def, description, extra] of [
  ['mdm.partner.bank_cooling_off_days', 'integer', 3, 'BR-03: the days payments stay on hold after a bank change of a partner is approved.', { min: 0, max: 30 }],
  ['mdm.partner.expiry_warning_days', 'integer', 30, 'How many days before a compliance document of a partner expires its steward is told.', { min: 1, max: 180 }],
  ['mdm.partner.blocking_documents', 'json', [], 'T-03: the compliance document types that, once expired, stop a partner from being chosen for a new PO, work order or RFQ, for example ["CLRA_LICENCE","INSURANCE"]. Empty: expiry only warns.', {}],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType, default: def, scopes: ['system', 'company'], description, .../** @type {any} */ (extra) });

/** Other modules tell the Partner 360 what they hold for a partner (FR-08): summary(db, companyId, partner) -> [{ label, value, route }]. And where a partner is used: flagged(db, companyId, partnerId) -> [{ label, route }]. */
const activity = new Map();
export const partnerActivity = { register(def) { activity.set(def.code, def); }, list: () => [...activity.values()] };

/** The Business Partners list (List Report, 03.03): roles and categories as text, the next document expiry for the compliance filter, PAN hidden from people who may not see it. */
export const partnerList = defineList({
  code: 'mdm.partners', label: 'Business partners', permission: 'mdm.record.view',
  from: 'mdm_partners p', where: 'p.deleted_at IS NULL', searchable: ['p.code', 'p.legal_name', 'p.trade_name', 'p.pan'], defaultSort: 'code',
  columns: {
    code: { sql: 'p.code', type: 'text', label: 'Code' }, legalName: { sql: 'p.legal_name', type: 'text', label: 'Legal name' }, tradeName: { sql: 'p.trade_name', type: 'text', label: 'Trade name' },
    roles: { sql: "(SELECT GROUP_CONCAT(r.partner_role, ', ') FROM mdm_partner_roles r WHERE r.partner_id = p.id AND r.deleted_at IS NULL)", type: 'text', label: 'Roles', sortable: false },
    categories: { sql: "(SELECT GROUP_CONCAT(j.value, ', ') FROM mdm_partner_roles r, json_each(r.categories_json) j WHERE r.partner_id = p.id AND r.deleted_at IS NULL)", type: 'text', label: 'Categories', sortable: false },
    status: { sql: 'p.partner_status', type: 'enum', label: 'Status', options: Object.entries(STATUS_LABELS) },
    pan: { sql: 'p.pan', type: 'text', label: 'PAN', sensitive: true },
    msme: { sql: 'p.msme_category', type: 'enum', label: 'MSME', options: [['MICRO', 'Micro'], ['SMALL', 'Small'], ['MEDIUM', 'Medium']] },
    nextExpiry: { sql: "(SELECT MIN(d.valid_until) FROM mdm_partner_documents d WHERE d.partner_id = p.id AND d.deleted_at IS NULL AND d.valid_until IS NOT NULL)", type: 'date', label: 'Next document expiry' },
    paymentHold: { sql: "CASE WHEN p.payment_hold_until IS NOT NULL AND p.payment_hold_until > strftime('%Y-%m-%dT%H:%M:%fZ','now') OR EXISTS (SELECT 1 FROM mdm_partner_banks b WHERE b.partner_id = p.id AND b.bank_status IN ('PENDING_CONFIRMATION', 'PENDING_APPROVAL') AND b.deleted_at IS NULL AND p.partner_status != 'PROSPECT') THEN 'HELD' ELSE 'FREE' END", type: 'enum', label: 'Payments', options: [['HELD', 'On hold'], ['FREE', 'Free']] },
    steward: { sql: 'p.steward_role', type: 'enum', label: 'Steward', options: [['PROCMGR', 'Procurement'], ['COMMGR', 'Commercial']] },
    updatedAt: { sql: 'COALESCE(p.updated_at, p.created_at)', type: 'datetime', label: 'Changed' },
  },
});

export function createPartnerService({ db, vaultKey }) {
  const authz = authzOf(db);
  const notif = notificationsOf(db);
  const vault = createVault({ secret: vaultKey ?? undefined });
  const param = (key, companyId) => createParameterStore(db).get(key, { companyId, date: todayIST() });
  const may = (actor, key) => authz.check(actor, key).allowed;
  const need = (actor, key, what) => { if (!may(actor, key)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const roleCodes = (actor) => (Array.isArray(actor.roles) ? actor.roles : String(actor.roles ?? '').split(',')).map((r) => String(r).trim().toUpperCase());
  const seesIdentity = (actor) => may(actor, 'mdm.partner.sensitive.view');
  const slot = (companyId, partnerId) => `mdm_partner_bank/${companyId}/${partnerId}`;
  const hash = (companyId, acct) => createHash('sha256').update(`${companyId}:${acct}`).digest('hex');
  /** The steward of a partner: procurement for vendors, service providers and transporters; commercial for the others. */
  const stewardOf = (roles) => (roles.some((r) => PROC_ROLES.has(r)) ? 'PROCMGR' : 'COMMGR');
  const rolesOf = (id) => db.prepare('SELECT partner_role FROM mdm_partner_roles WHERE partner_id = ? AND deleted_at IS NULL').all(id).map((r) => r.partner_role);
  /** Who keeps a partner: its steward role, or business development for a partner that is only a client prospect. */
  const keeps = (actor, p, roles = rolesOf(p.id)) => may(actor, 'mdm.partner.edit') && (roleCodes(actor).includes(p.steward_role) || (roleCodes(actor).includes('BD') && roles.every((r) => r === 'CLIENT')));
  const row = (actor, id) => { const p = db.prepare('SELECT * FROM mdm_partners WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId); if (!p) throw notFound('That business partner does not exist.'); return p; };
  const stateRow = (code) => db.prepare("SELECT code, gst_code, name FROM mdm_states WHERE (code = ? OR gst_code = ?) AND row_status = 'ACTIVE' AND deleted_at IS NULL ORDER BY company_id IS NULL LIMIT 1").get(code, code) ?? null;

  // ---- checking what is entered (FR-01, FR-07, T-01) ----
  function checkIdentity(b, problems) {
    if (b.pan && !FORMATS.PAN.test(b.pan)) problems.push({ field: 'pan', message: `PAN is not valid (${FORMATS.PAN.hint})` });
    if (b.pan && FORMATS.PAN.test(b.pan) && PAN_HOLDER[b.constitution] && !PAN_HOLDER[b.constitution].includes(b.pan[3])) problems.push({ field: 'pan', message: `The fourth character of the PAN (${b.pan[3]}) does not fit a ${b.constitution.toLowerCase().replace(/_/g, ' ')} (expected ${PAN_HOLDER[b.constitution].join(' or ')})` });
    if (!b.pan && b.constitution !== 'GOVERNMENT') problems.push({ field: 'pan', message: 'PAN is required (only a government body may be registered without one)' });
    if (b.msmeNo && !UDYAM.test(b.msmeNo)) problems.push({ field: 'msmeNo', message: 'Udyam number looks like UDYAM-MH-26-0012345' });
    if (b.msmeNo && !b.msmeCategory) problems.push({ field: 'msmeCategory', message: 'Give the MSME category of the Udyam registration' });
    if (b.cin && !CIN.test(b.cin)) problems.push({ field: 'cin', message: 'A CIN has 21 characters, for example U45200MH2010PTC123456' });
    if (b.cin && !['PRIVATE_LIMITED', 'PUBLIC_LIMITED'].includes(b.constitution)) problems.push({ field: 'cin', message: 'Only a company has a CIN' });
  }
  function checkGstin(g, pan, problems, i) {
    if (!FORMATS.GSTIN.test(g.gstin)) { problems.push({ field: `gstins.${i}.gstin`, message: `GSTIN is not valid (${FORMATS.GSTIN.hint})` }); return null; }
    const st = stateRow(g.stateCode);
    if (!st) { problems.push({ field: `gstins.${i}.stateCode`, message: `${g.stateCode} is not a state (06.02)` }); return null; }
    if (g.gstin.slice(0, 2) !== st.gst_code) problems.push({ field: `gstins.${i}.gstin`, message: `A GSTIN of ${st.name} starts with ${st.gst_code}` });
    if (pan && g.gstin.slice(2, 12) !== pan) problems.push({ field: `gstins.${i}.gstin`, message: 'The GSTIN does not contain the PAN of the partner (characters 3 to 12)' });
    return st.code;
  }
  function checkBank(actor, bk, problems, field = 'bank') {
    if (!/^\d{9,18}$/.test(bk.accountNo)) problems.push({ field: `${field}.accountNo`, message: 'An account number has 9 to 18 digits' });
    if (!FORMATS.IFSC.test(bk.ifsc)) problems.push({ field: `${field}.ifsc`, message: `IFSC is not valid (${FORMATS.IFSC.hint})` });
    const bank = commonOf(db) && FORMATS.IFSC.test(bk.ifsc) ? commonOf(db).list(actor, 'banks', { key: bk.ifsc, limit: 1, offset: 0 }).rows[0] ?? null : null;
    return { bankName: bank?.bankName ?? null, branch: bank?.branch ?? null };
  }
  /** Who looks like this partner (FR-07): the same PAN, GSTIN or bank account blocks; the same mobile or a similar name warns. */
  function duplicates(companyId, b, exceptId = null) {
    const out = [];
    const ex = exceptId ? 'AND p.id != ?' : '';
    const args = (x) => (exceptId ? [...x, exceptId] : x);
    const live = "p.partner_status NOT IN ('REJECTED') AND p.deleted_at IS NULL";
    if (b.pan) for (const p of db.prepare(`SELECT p.id, p.code, p.legal_name FROM mdm_partners p WHERE p.company_id = ? AND p.pan = ? AND ${live} ${ex}`).all(...args([companyId, b.pan]))) out.push({ id: p.id, code: p.code, name: p.legal_name, rule: 'same PAN', field: 'pan', block: true });
    for (const g of b.gstins ?? []) for (const p of db.prepare(`SELECT p.id, p.code, p.legal_name FROM mdm_partner_gstins x JOIN mdm_partners p ON p.id = x.partner_id WHERE x.company_id = ? AND x.gstin = ? AND x.deleted_at IS NULL AND ${live} ${ex}`).all(...args([companyId, g.gstin]))) out.push({ id: p.id, code: p.code, name: p.legal_name, rule: 'same GSTIN', field: 'gstins', block: true });
    if (b.bank?.accountNo) for (const p of db.prepare(`SELECT p.id, p.code, p.legal_name FROM mdm_partner_banks x JOIN mdm_partners p ON p.id = x.partner_id WHERE x.company_id = ? AND x.account_hash = ? AND x.bank_status IN ('PENDING_CONFIRMATION', 'PENDING_APPROVAL', 'ACTIVE') AND x.deleted_at IS NULL AND ${live} ${ex}`).all(...args([companyId, hash(companyId, b.bank.accountNo)]))) out.push({ id: p.id, code: p.code, name: p.legal_name, rule: 'same bank account', field: 'bank', block: true });
    for (const c of b.contacts ?? []) if (c.mobile) for (const p of db.prepare(`SELECT DISTINCT p.id, p.code, p.legal_name FROM mdm_partner_contacts x JOIN mdm_partners p ON p.id = x.partner_id WHERE x.company_id = ? AND x.mobile = ? AND x.deleted_at IS NULL AND ${live} ${ex}`).all(...args([companyId, c.mobile]))) out.push({ id: p.id, code: p.code, name: p.legal_name, rule: 'same mobile', field: 'contacts', block: false });
    if (b.legalName) for (const p of db.prepare(`SELECT p.id, p.code, p.legal_name FROM mdm_partners p WHERE p.company_id = ? AND ${live} ${ex}`).all(...args([companyId]))) { const s = similarity(b.legalName, p.legal_name); if (s >= 85) out.push({ id: p.id, code: p.code, name: p.legal_name, rule: s === 100 ? 'same name' : `similar name (${s}%)`, field: 'legalName', block: false }); }
    const seen = new Map();
    for (const d of out) { const k = `${d.id}:${d.rule}`; if (!seen.has(k)) seen.set(k, d); }
    return [...seen.values()].sort((a, b2) => Number(b2.block) - Number(a.block));
  }
  /** Everything of a registration checked; returns what would be stored. */
  function prepare(actor, b, exceptId = null) {
    const problems = [];
    if (!b.roles.length) problems.push({ field: 'roles', message: 'Give the partner at least one role' });
    checkIdentity(b, problems);
    const gst = (b.gstins ?? []).map((g, i) => ({ ...g, stateCode: checkGstin(g, b.pan, problems, i) ?? g.stateCode }));
    const seenStates = new Set(); for (const g of gst) { if (seenStates.has(g.stateCode)) problems.push({ field: 'gstins', message: `Two GSTINs for ${g.stateCode}: one registration per state` }); seenStates.add(g.stateCode); }
    for (const [i, a] of (b.addresses ?? []).entries()) { if (!stateRow(a.stateCode)) problems.push({ field: `addresses.${i}.stateCode`, message: `${a.stateCode} is not a state` }); if (a.pin && !FORMATS.PIN.test(a.pin)) problems.push({ field: `addresses.${i}.pin`, message: 'A PIN code has six digits' }); }
    if (!(b.addresses ?? []).some((a) => a.addressType === 'REGISTERED')) problems.push({ field: 'addresses', message: 'Give the registered address' });
    for (const [i, c] of (b.contacts ?? []).entries()) { if (c.mobile && !FORMATS.MOBILE.test(c.mobile)) problems.push({ field: `contacts.${i}.mobile`, message: `Mobile is not valid (${FORMATS.MOBILE.hint})` }); if (c.email && !FORMATS.EMAIL.test(c.email)) problems.push({ field: `contacts.${i}.email`, message: 'E-mail is not valid' }); }
    if (!(b.contacts ?? []).length) problems.push({ field: 'contacts', message: 'Give at least one contact (a bank change is confirmed with them)' });
    const bank = b.bank ? checkBank(actor, b.bank, problems) : null;
    for (const [i, t] of (b.tds ?? []).entries()) checkTds(actor, t, problems, `tds.${i}`);
    if (problems.length) throw badRequest('Some fields are not valid.', problems);
    return { gst, bank, dups: duplicates(actor.companyId, b, exceptId) };
  }
  function checkTds(actor, t, problems, field) {
    const sec = commonOf(db) ? commonOf(db).list(actor, 'tds-sections', { key: t.section, limit: 1, offset: 0 }).rows[0] : null;
    if (!sec) { problems.push({ field: `${field}.section`, message: `${t.section} is not a TDS section in force (06.02)` }); return; }
    if (t.ldcNo) {
      if (t.ldcRate == null || !t.validFrom || !t.validUntil) problems.push({ field, message: 'A lower-deduction certificate needs its rate, limit and validity' });
      else if (Number(t.ldcRate) >= Number(sec.rateCompany) && Number(t.ldcRate) >= Number(sec.rateIndividual)) problems.push({ field: `${field}.ldcRate`, message: `A lower-deduction rate is below the section rate (${sec.rateCompany}%)` });
      if (t.validFrom && t.validUntil && t.validUntil < t.validFrom) problems.push({ field: `${field}.validUntil`, message: 'Valid until is after valid from' });
    }
  }

  // ---- writing children ----
  const insertBank = (actor, pid, bk, extra) => {
    const enc = vault.encrypt(bk.accountNo, slot(actor.companyId, pid));
    return Number(db.prepare("INSERT INTO mdm_partner_banks (company_id, partner_id, account_no_encrypted, account_hash, account_last4, ifsc, bank_name, branch, account_name, bank_status, is_primary, cheque_file_id, change_reason, requested_by, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'mdm_partner')")
      .run(actor.companyId, pid, enc, hash(actor.companyId, bk.accountNo), bk.accountNo.slice(-4), bk.ifsc, extra.bankName ?? null, extra.branch ?? null, bk.accountName, extra.status, extra.primary ? 1 : 0, bk.chequeFileId ?? null, extra.reason ?? null, actor.user, actor.user).lastInsertRowid);
  };
  function writeChildren(actor, pid, b, prep) {
    for (const t of ['mdm_partner_roles', 'mdm_partner_gstins', 'mdm_partner_addresses', 'mdm_partner_contacts', 'mdm_partner_tds']) db.prepare(`UPDATE ${t} SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE partner_id = ? AND deleted_at IS NULL`).run(nowIso(), actor.user, pid);
    for (const r of b.roles) db.prepare("INSERT INTO mdm_partner_roles (company_id, partner_id, partner_role, categories_json, regions_json, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'mdm_partner')").run(actor.companyId, pid, r, JSON.stringify(b.categories ?? []), JSON.stringify(b.regions ?? []), actor.user);
    for (const g of prep.gst) db.prepare("INSERT INTO mdm_partner_gstins (company_id, partner_id, state_code, gstin, verify_source, verified_at, verified_by, created_by, source_type) VALUES (?, ?, ?, ?, 'FORMAT', ?, 'system', ?, 'mdm_partner')").run(actor.companyId, pid, g.stateCode, g.gstin, nowIso(), actor.user);
    for (const a of b.addresses) db.prepare("INSERT INTO mdm_partner_addresses (company_id, partner_id, address_type, address, city, state_code, pin, is_default, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'mdm_partner')").run(actor.companyId, pid, a.addressType, a.address, a.city ?? null, stateRow(a.stateCode).code, a.pin ?? null, a.isDefault || a.addressType === 'REGISTERED' ? 1 : 0, actor.user);
    b.contacts.forEach((c, i) => db.prepare("INSERT INTO mdm_partner_contacts (company_id, partner_id, name, designation, email, mobile, is_primary, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'mdm_partner')").run(actor.companyId, pid, c.name, c.designation ?? null, c.email ?? null, c.mobile ?? null, c.isPrimary || (i === 0 && !b.contacts.some((x) => x.isPrimary)) ? 1 : 0, actor.user));
    for (const t of b.tds ?? []) db.prepare("INSERT INTO mdm_partner_tds (company_id, partner_id, section, ldc_no, ldc_rate, ldc_limit, valid_from, valid_until, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'mdm_partner')").run(actor.companyId, pid, t.section, t.ldcNo ?? null, t.ldcRate != null ? toUnits(t.ldcRate, 'percent') : null, t.ldcLimit != null ? toUnits(t.ldcLimit, 'money') : null, t.validFrom ?? null, t.validUntil ?? null, actor.user);
    if (b.bank) {
      db.prepare("UPDATE mdm_partner_banks SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE partner_id = ? AND bank_status = 'PENDING_APPROVAL' AND workflow_instance_id IS NULL AND deleted_at IS NULL").run(nowIso(), actor.user, pid);
      insertBank(actor, pid, b.bank, { ...prep.bank, status: 'PENDING_APPROVAL', primary: true, reason: 'Registration' });
    }
  }

  // ---- views ----
  const bankView = (bk) => ({ id: bk.id, account: `••••••${bk.account_last4}`, last4: bk.account_last4, ifsc: bk.ifsc, bankName: bk.bank_name, branch: bk.branch, accountName: bk.account_name, status: bk.bank_status, verified: bk.verified_status, verifyMethod: bk.verify_method, verifyNote: bk.verify_note, verifiedAt: bk.verified_at, coolingOffUntil: bk.cooling_off_until, primary: Boolean(bk.is_primary), reason: bk.change_reason, requestedBy: bk.requested_by, createdAt: bk.created_at, instanceId: bk.workflow_instance_id, chequeFileId: bk.cheque_file_id });
  /** BR-03: payments are held while a bank change waits, and until its cooling-off period ends. */
  const holdOf = (p) => {
    const pending = db.prepare("SELECT id FROM mdm_partner_banks WHERE partner_id = ? AND bank_status IN ('PENDING_CONFIRMATION', 'PENDING_APPROVAL') AND deleted_at IS NULL").get(p.id);
    if (pending && p.partner_status !== 'PROSPECT' && p.partner_status !== 'PENDING') return { held: true, reason: 'A bank change waits for confirmation and approval', until: null };
    if (p.payment_hold_until && p.payment_hold_until > nowIso()) return { held: true, reason: p.payment_hold_reason ?? 'Bank change cooling-off', until: p.payment_hold_until };
    if (p.partner_status === 'ON_HOLD' || p.partner_status === 'BLACKLISTED') return { held: true, reason: STATUS_LABELS[p.partner_status], until: p.blacklist_until };
    return { held: false, reason: null, until: null };
  };
  const today = () => todayIST();
  const docView = (d) => ({ id: d.id, type: d.doc_type, typeLabel: DOC_TYPES[d.doc_type], number: d.document_ref, fileId: d.file_id, validFrom: d.valid_from, validUntil: d.valid_until, verifiedBy: d.verified_by, verifiedAt: d.verified_at, addedBy: d.created_by,
    state: !d.valid_until ? 'NO_EXPIRY' : d.valid_until < today() ? 'EXPIRED' : d.valid_until <= dayPlus(30) ? 'DUE' : 'VALID' });
  function view(actor, p, { full = false } = {}) {
    const roles = db.prepare('SELECT * FROM mdm_partner_roles WHERE partner_id = ? AND deleted_at IS NULL').all(p.id);
    const sees = seesIdentity(actor);
    const base = { id: p.id, code: p.code, legalName: p.legal_name, tradeName: p.trade_name, constitution: p.constitution, pan: sees ? p.pan : mask(p.pan), msmeNo: sees ? p.msme_no : mask(p.msme_no), msmeCategory: p.msme_category, cin: p.cin, status: p.partner_status, statusLabel: STATUS_LABELS[p.partner_status],
      statusReason: p.status_reason, blacklistReason: p.blacklist_reason, blacklistUntil: p.blacklist_until, stewardRole: p.steward_role, roles: roles.map((r) => r.partner_role), categories: json(roles[0]?.categories_json, []), regions: json(roles[0]?.regions_json, []),
      payment: holdOf(p), requestedBy: p.requested_by, activatedAt: p.activated_at, instanceId: p.workflow_instance_id, rowVersion: p.version, masked: !sees, canEdit: keeps(actor, p, roles.map((r) => r.partner_role)) };
    if (!full) return base;
    const docs = db.prepare('SELECT * FROM mdm_partner_documents WHERE partner_id = ? AND deleted_at IS NULL ORDER BY valid_until IS NULL, valid_until').all(p.id).map(docView);
    return { ...base,
      gstins: db.prepare('SELECT * FROM mdm_partner_gstins WHERE partner_id = ? AND deleted_at IS NULL ORDER BY state_code').all(p.id).map((g) => ({ id: g.id, stateCode: g.state_code, state: stateRow(g.state_code)?.name ?? g.state_code, gstin: g.gstin, status: g.gstin_status, verifySource: g.verify_source, verifiedAt: g.verified_at, verifiedBy: g.verified_by })),
      addresses: db.prepare('SELECT * FROM mdm_partner_addresses WHERE partner_id = ? AND deleted_at IS NULL ORDER BY is_default DESC, id').all(p.id).map((a) => ({ id: a.id, type: a.address_type, address: a.address, city: a.city, stateCode: a.state_code, state: stateRow(a.state_code)?.name ?? a.state_code, pin: a.pin, isDefault: Boolean(a.is_default) })),
      contacts: db.prepare('SELECT * FROM mdm_partner_contacts WHERE partner_id = ? AND deleted_at IS NULL ORDER BY is_primary DESC, id').all(p.id).map((c) => ({ id: c.id, name: c.name, designation: c.designation, email: c.email, mobile: sees || keeps(actor, p) ? c.mobile : mask(c.mobile), isPrimary: Boolean(c.is_primary), portalUserId: c.portal_user_id })),
      banks: db.prepare("SELECT * FROM mdm_partner_banks WHERE partner_id = ? AND deleted_at IS NULL ORDER BY CASE bank_status WHEN 'ACTIVE' THEN 0 WHEN 'PENDING_APPROVAL' THEN 1 WHEN 'PENDING_CONFIRMATION' THEN 2 ELSE 3 END, id DESC").all(p.id).map(bankView),
      documents: docs, expiredDocuments: docs.filter((d) => d.state === 'EXPIRED').length, dueDocuments: docs.filter((d) => d.state === 'DUE').length,
      tds: db.prepare('SELECT * FROM mdm_partner_tds WHERE partner_id = ? AND deleted_at IS NULL').all(p.id).map((t) => ({ id: t.id, section: t.section, ldcNo: t.ldc_no, ldcRate: t.ldc_rate != null ? trimNum(fromUnits(t.ldc_rate, 'percent').toFixed()) : null, ldcLimit: t.ldc_limit != null ? trimNum(fromUnits(t.ldc_limit, 'money').toFixed()) : null, validFrom: t.valid_from, validUntil: t.valid_until, verifiedBy: t.verified_by, verifiedAt: t.verified_at, valid: !t.ldc_no || (t.valid_from <= today() && t.valid_until >= today()) })),
      statusRequests: db.prepare('SELECT * FROM mdm_partner_status_requests WHERE partner_id = ? ORDER BY id DESC LIMIT 20').all(p.id).map((s) => ({ id: s.id, action: s.action, reason: s.reason, until: s.until_date, status: s.request_status, requestedBy: s.requested_by, decidedBy: s.decided_by, decidedAt: s.decided_at, createdAt: s.created_at, instanceId: s.workflow_instance_id })),
      canVerify: may(actor, 'mdm.partner.verify'), canSeeBank: may(actor, 'mdm.partner.bank.view'), canRequestBank: may(actor, 'mdm.partner.bank.request'), canBlacklist: may(actor, 'mdm.partner.blacklist'), canHold: may(actor, 'mdm.partner.hold') };
  }

  // ---- registration and approval (FR-01, FR-06, AC-01) ----
  const tell = (p, what, decision, comment, to = p.requested_by) => notif.notify({ companyId: p.company_id, templateCode: 'mdm.partner.decided', recipients: [`user:${to}`], data: { decision, code: p.code, name: p.legal_name, what, comment: comment ? `: ${comment}` : '' }, link: `/admin/partners/partner?id=${p.id}`, sourceType: 'mdm_partner', sourceId: String(p.id), eventKey: `mdm.partner.decided:${p.id}:${what}:${decision}:${Date.now()}` });
  const head = (b) => [b.legalName.trim(), b.tradeName ?? null, nameKey(b.legalName), b.constitution, b.pan ?? null, b.msmeNo ?? null, b.msmeCategory ?? null, b.cin ?? null];
  const registration = {
    check(actor, b) {
      need(actor, 'mdm.record.view', 'see partners');
      try { const pr = prepare(actor, b, b.partnerId ?? null); return { errors: [], duplicates: pr.dups }; } catch (e) { if (e instanceof HttpError && e.status === 400) return { errors: e.details, duplicates: duplicates(actor.companyId, b, b.partnerId ?? null) }; throw e; }
    },
    /** A Prospect: saved with everything entered, not yet sent. Business development registers client prospects; the stewards the partners of their roles. */
    create(actor, b) {
      need(actor, 'mdm.partner.edit', 'register partners');
      const steward = stewardOf(b.roles);
      if (!roleCodes(actor).includes(steward) && !(roleCodes(actor).includes('BD') && b.roles.every((r) => r === 'CLIENT'))) throw forbidden(`${b.roles.map((r) => ROLE_LABELS[r].toLowerCase()).join(' and ')} are registered by the ${steward === 'PROCMGR' ? 'procurement' : 'commercial'} manager${steward === 'COMMGR' ? ' (business development registers client prospects)' : ''}.`);
      const pr = prepare(actor, b);
      const block = pr.dups.filter((d) => d.block);
      if (block.length) throw new HttpError(409, 'DUPLICATE', `This partner already exists: ${block.map((d) => `${d.code} ${d.name} (${d.rule})`).join('; ')}.`, block.map((d) => ({ field: d.field, message: `${d.rule} as ${d.code}`, partnerId: d.id })));
      if (pr.dups.length && !b.acknowledgeDuplicates) throw new HttpError(409, 'DUPLICATE_WARNING', `This looks like ${pr.dups.map((d) => `${d.code} ${d.name} (${d.rule})`).join('; ')}. Check it, then confirm it is a different partner.`, pr.dups.map((d) => ({ field: d.field, message: `${d.rule} as ${d.code}`, partnerId: d.id })));
      return transaction(db, () => {
        const n = db.prepare('SELECT COUNT(*) AS n FROM mdm_partners WHERE company_id = ?').get(actor.companyId).n + 1;
        let code = `BP-${String(n).padStart(5, '0')}`;
        for (let k = n + 1; db.prepare('SELECT 1 FROM mdm_partners WHERE company_id = ? AND code = ?').get(actor.companyId, code); k += 1) code = `BP-${String(k).padStart(5, '0')}`;
        const id = Number(db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, name_key, constitution, pan, msme_no, msme_category, cin, partner_status, steward_role, requested_by, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PROSPECT', ?, ?, ?, 'mdm_partner')")
          .run(actor.companyId, code, ...head(b), steward, actor.user, actor.user).lastInsertRowid);
        writeChildren(actor, id, b, pr);
        writeAudit(db, { entity: 'mdm_partners', entityId: id, action: 'create', newValues: { code, legalName: b.legalName, roles: b.roles, status: 'PROSPECT' }, actor: actor.user, companyId: actor.companyId });
        publishEvent(db, { type: 'mdm.partner.registered', entity: 'mdm_partner', entityId: id, actorId: actor.user, companyId: actor.companyId, data: { code, roles: b.roles } });
        const out = view(actor, row(actor, id), { full: true });
        return b.submit ? { ...out, ...registration.submit(actor, id, { comment: b.comment }) } : out;
      });
    },
    /** A Prospect (or a request returned for correction) is changed before it is sent again. */
    update(actor, id, b) {
      const p = row(actor, id);
      if (!keeps(actor, p)) throw forbidden('Only the steward of this partner changes it.');
      if (p.version !== b.version) throw conflict('This partner was changed by someone else. Reload it and try again.');
      const returned = p.partner_status === 'PENDING' && db.prepare("SELECT 1 FROM wf_instances WHERE id = ? AND status = 'RETURNED'").get(p.workflow_instance_id);
      if (!['PROSPECT', 'REJECTED'].includes(p.partner_status) && !returned) throw conflict(`A partner that is ${STATUS_LABELS[p.partner_status].toLowerCase()} is not edited here: use its own actions (contacts, documents, bank change, status).`);
      const pr = prepare(actor, b, id);
      const block = pr.dups.filter((d) => d.block);
      if (block.length) throw new HttpError(409, 'DUPLICATE', `This partner already exists: ${block.map((d) => `${d.code} ${d.name} (${d.rule})`).join('; ')}.`, []);
      return transaction(db, () => {
        db.prepare("UPDATE mdm_partners SET legal_name = ?, trade_name = ?, name_key = ?, constitution = ?, pan = ?, msme_no = ?, msme_category = ?, cin = ?, steward_role = ?, partner_status = CASE partner_status WHEN 'REJECTED' THEN 'PROSPECT' ELSE partner_status END, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?")
          .run(...head(b), stewardOf(b.roles), actor.user, nowIso(), id);
        writeChildren(actor, id, b, pr);
        writeAudit(db, { entity: 'mdm_partners', entityId: id, action: 'update', newValues: { legalName: b.legalName, roles: b.roles }, actor: actor.user, companyId: actor.companyId });
        if (returned) workflowOf(db).resubmit(actor, p.workflow_instance_id, { comment: b.comment ?? 'Corrected', context: { stewardRole: stewardOf(b.roles) } });
        return view(actor, row(actor, id), { full: true });
      });
    },
    /** Send a Prospect for approval: the steward of its roles, then the accounts manager (statutory and bank verification). */
    /** @param {any} actor @param {number} id @param {{ comment?: string }} [opts] */
    submit(actor, id, { comment } = {}) {
      const p = row(actor, id);
      if (!keeps(actor, p)) throw forbidden('Only the steward of this partner sends it for approval.');
      if (p.partner_status !== 'PROSPECT') throw conflict(`This partner is ${STATUS_LABELS[p.partner_status].toLowerCase()}.`);
      const inst = workflowOf(db).submit(actor, { docType: PARTNER_DOC, docId: id, comment: comment ?? 'New partner', context: { stewardRole: p.steward_role, roles: rolesOf(id) } });
      db.prepare("UPDATE mdm_partners SET partner_status = 'PENDING', workflow_instance_id = ?, requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(inst.id, actor.user, actor.user, nowIso(), id);
      writeAudit(db, { entity: 'mdm_partners', entityId: id, action: 'submit', actor: actor.user, companyId: actor.companyId, reason: comment ?? null });
      return { workflow: inst, status: 'PENDING' };
    },
  };

  // ---- changes of an active partner: contacts, addresses, categories, GSTINs, documents, TDS ----
  const details = {
    /** Non-statutory details of an active partner, by its steward, audited. */
    update(actor, id, b) {
      const p = row(actor, id);
      if (!keeps(actor, p)) throw forbidden('Only the steward of this partner changes it.');
      if (p.version !== b.version) throw conflict('This partner was changed by someone else. Reload it and try again.');
      if (!['ACTIVE', 'ON_HOLD', 'INACTIVE'].includes(p.partner_status)) throw conflict('Use the registration to change a partner that is not active yet.');
      const problems = [];
      for (const [i, c] of (b.contacts ?? []).entries()) if (c.mobile && !FORMATS.MOBILE.test(c.mobile)) problems.push({ field: `contacts.${i}.mobile`, message: 'Mobile is not valid' });
      for (const [i, a] of (b.addresses ?? []).entries()) if (!stateRow(a.stateCode)) problems.push({ field: `addresses.${i}.stateCode`, message: `${a.stateCode} is not a state` });
      if (problems.length) throw badRequest('Some fields are not valid.', problems);
      return transaction(db, () => {
        if (b.tradeName !== undefined) db.prepare('UPDATE mdm_partners SET trade_name = ? WHERE id = ?').run(b.tradeName, id);
        if (b.categories || b.regions) db.prepare('UPDATE mdm_partner_roles SET categories_json = COALESCE(?, categories_json), regions_json = COALESCE(?, regions_json), updated_at = ? WHERE partner_id = ? AND deleted_at IS NULL').run(b.categories ? JSON.stringify(b.categories) : null, b.regions ? JSON.stringify(b.regions) : null, nowIso(), id);
        if (b.contacts) { db.prepare('UPDATE mdm_partner_contacts SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE partner_id = ? AND deleted_at IS NULL').run(nowIso(), actor.user, id); b.contacts.forEach((c, i) => db.prepare("INSERT INTO mdm_partner_contacts (company_id, partner_id, name, designation, email, mobile, is_primary, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'mdm_partner')").run(actor.companyId, id, c.name, c.designation ?? null, c.email ?? null, c.mobile ?? null, c.isPrimary || (i === 0 && !b.contacts.some((x) => x.isPrimary)) ? 1 : 0, actor.user)); }
        if (b.addresses) { db.prepare('UPDATE mdm_partner_addresses SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE partner_id = ? AND deleted_at IS NULL').run(nowIso(), actor.user, id); for (const a of b.addresses) db.prepare("INSERT INTO mdm_partner_addresses (company_id, partner_id, address_type, address, city, state_code, pin, is_default, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'mdm_partner')").run(actor.companyId, id, a.addressType, a.address, a.city ?? null, stateRow(a.stateCode).code, a.pin ?? null, a.isDefault ? 1 : 0, actor.user); }
        db.prepare('UPDATE mdm_partners SET updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(actor.user, nowIso(), id);
        writeAudit(db, { entity: 'mdm_partners', entityId: id, action: 'update_details', newValues: b, actor: actor.user, companyId: actor.companyId, reason: b.reason ?? null });
        publishEvent(db, { type: 'mdm.partner.changed', entity: 'mdm_partner', entityId: id, actorId: actor.user, companyId: actor.companyId, data: { code: p.code } });
        return view(actor, row(actor, id), { full: true });
      });
    },
    /** A GSTIN of another state, by the steward; it is format-checked at once and verified by the accounts manager. */
    addGstin(actor, id, g) {
      const p = row(actor, id);
      if (!keeps(actor, p)) throw forbidden('Only the steward of this partner adds a GSTIN.');
      const problems = []; const st = checkGstin(g, p.pan, problems, 0);
      if (problems.length) throw badRequest('Some fields are not valid.', problems);
      if (db.prepare('SELECT 1 FROM mdm_partner_gstins WHERE partner_id = ? AND state_code = ? AND deleted_at IS NULL').get(id, st)) throw conflict(`The partner already has a GSTIN for ${st}.`);
      const dup = duplicates(actor.companyId, { gstins: [g] }, id).filter((d) => d.block);
      if (dup.length) throw conflict(`${g.gstin} belongs to ${dup[0].code} ${dup[0].name}.`);
      const gid = Number(db.prepare("INSERT INTO mdm_partner_gstins (company_id, partner_id, state_code, gstin, verify_source, verified_at, verified_by, created_by, source_type) VALUES (?, ?, ?, ?, 'FORMAT', ?, 'system', ?, 'mdm_partner')").run(actor.companyId, id, st, g.gstin, nowIso(), actor.user).lastInsertRowid);
      writeAudit(db, { entity: 'mdm_partner_gstins', entityId: gid, action: 'create', newValues: g, actor: actor.user, companyId: actor.companyId });
      return view(actor, row(actor, id), { full: true }).gstins;
    },
    /** Verify a GSTIN (FR-01): the format and check character always; through the GST connector when one is set up. Without it the accounts manager confirms having checked the GST portal. */
    verifyGstin(actor, id, { gstinId, checkedOnPortal, status }) {
      need(actor, 'mdm.partner.verify', 'verify GSTINs');
      const p = row(actor, id);
      const g = db.prepare('SELECT * FROM mdm_partner_gstins WHERE id = ? AND partner_id = ? AND deleted_at IS NULL').get(gstinId, id);
      if (!g) throw notFound('That GSTIN is not of this partner.');
      if (!FORMATS.GSTIN.test(g.gstin)) throw unprocessable('The GSTIN fails its check character.');
      if (!checkedOnPortal) throw unprocessable('No GST verification connector is set up: confirm that you checked the GSTIN on the GST portal (D-303).');
      db.prepare("UPDATE mdm_partner_gstins SET verify_source = 'API', gstin_status = ?, verified_at = ?, verified_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(status ?? 'ACTIVE', nowIso(), actor.user, nowIso(), gstinId);
      writeAudit(db, { entity: 'mdm_partner_gstins', entityId: gstinId, action: 'verify', newValues: { status: status ?? 'ACTIVE', source: 'portal check' }, actor: actor.user, companyId: actor.companyId });
      return view(actor, p, { full: true }).gstins;
    },
    addDocument(actor, id, d) {
      const p = row(actor, id);
      if (!keeps(actor, p) && !may(actor, 'mdm.partner.verify')) throw forbidden('Only the steward of this partner or an accounts manager adds a document.');
      if (d.validFrom && d.validUntil && d.validUntil < d.validFrom) throw badRequest('Valid until is after valid from.', [{ field: 'validUntil', message: 'after valid from' }]);
      const did = Number(db.prepare("INSERT INTO mdm_partner_documents (company_id, partner_id, doc_type, document_ref, file_id, valid_from, valid_until, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'mdm_partner')").run(actor.companyId, id, d.docType, d.docNo ?? null, d.fileId ?? null, d.validFrom ?? null, d.validUntil ?? null, actor.user).lastInsertRowid);
      writeAudit(db, { entity: 'mdm_partner_documents', entityId: did, action: 'create', newValues: d, actor: actor.user, companyId: actor.companyId });
      publishEvent(db, { type: 'mdm.partner.changed', entity: 'mdm_partner', entityId: id, actorId: actor.user, companyId: actor.companyId, data: { code: p.code, document: d.docType } });
      return view(actor, row(actor, id), { full: true }).documents;
    },
    /** An accounts manager other than the person who added it verifies a document. */
    verifyDocument(actor, id, docId) {
      need(actor, 'mdm.partner.verify', 'verify documents');
      row(actor, id);
      const d = db.prepare('SELECT * FROM mdm_partner_documents WHERE id = ? AND partner_id = ? AND deleted_at IS NULL').get(docId, id);
      if (!d) throw notFound('That document is not of this partner.');
      if (d.created_by?.toLowerCase() === actor.user.toLowerCase()) throw forbidden('The person who added a document does not verify it.');
      db.prepare('UPDATE mdm_partner_documents SET verified_by = ?, verified_at = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(actor.user, nowIso(), nowIso(), docId);
      writeAudit(db, { entity: 'mdm_partner_documents', entityId: docId, action: 'verify', actor: actor.user, companyId: actor.companyId });
      return view(actor, row(actor, id), { full: true }).documents;
    },
    /** TDS settings and lower-deduction certificates (FR-05), kept by the accounts manager. */
    setTds(actor, id, { tds }) {
      need(actor, 'mdm.partner.verify', 'keep the TDS settings of partners');
      const p = row(actor, id);
      const problems = []; for (const [i, t] of tds.entries()) checkTds(actor, t, problems, `tds.${i}`);
      if (problems.length) throw badRequest('Some fields are not valid.', problems);
      return transaction(db, () => {
        db.prepare('UPDATE mdm_partner_tds SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE partner_id = ? AND deleted_at IS NULL').run(nowIso(), actor.user, id);
        for (const t of tds) db.prepare("INSERT INTO mdm_partner_tds (company_id, partner_id, section, ldc_no, ldc_rate, ldc_limit, valid_from, valid_until, verified_by, verified_at, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'mdm_partner')").run(actor.companyId, id, t.section, t.ldcNo ?? null, t.ldcRate != null ? toUnits(t.ldcRate, 'percent') : null, t.ldcLimit != null ? toUnits(t.ldcLimit, 'money') : null, t.validFrom ?? null, t.validUntil ?? null, actor.user, nowIso(), actor.user);
        writeAudit(db, { entity: 'mdm_partner_tds', entityId: id, action: 'set', newValues: { tds }, actor: actor.user, companyId: actor.companyId });
        return view(actor, p, { full: true }).tds;
      });
    },
  };

  // ---- bank accounts (FR-02, BR-01, BR-03, T-02) ----
  let otpDeliver = null;
  const banks = {
    /** For tests and for a company that sends the code another way: deliver(text) -> { delivered, reason }. */
    setDeliver(fn) { otpDeliver = fn; },
    /** A new bank account for an active partner: payments are held at once; the partner confirms it (a code to the registered contact) or a call-back is noted, then it goes for approval. */
    async request(actor, id, b) {
      need(actor, 'mdm.partner.bank.request', 'ask for a bank change');
      const p = row(actor, id);
      if (!['ACTIVE', 'ON_HOLD'].includes(p.partner_status)) throw conflict('A bank change is for an active partner; a new partner gives its bank in the registration.');
      if (db.prepare("SELECT 1 FROM mdm_partner_banks WHERE partner_id = ? AND bank_status IN ('PENDING_CONFIRMATION', 'PENDING_APPROVAL') AND deleted_at IS NULL").get(id)) throw conflict('A bank change of this partner is already waiting.');
      const problems = []; const meta = checkBank(actor, b, problems, 'bank');
      if (problems.length) throw badRequest('Some fields are not valid.', problems);
      const dup = duplicates(actor.companyId, { bank: b }, id).filter((d) => d.block);
      if (dup.length) throw conflict(`This account belongs to ${dup[0].code} ${dup[0].name}: one account, one partner.`);
      const bid = transaction(db, () => {
        const x = insertBank(actor, id, b, { ...meta, status: 'PENDING_CONFIRMATION', primary: false, reason: b.reason });
        db.prepare('UPDATE mdm_partners SET payment_hold_reason = ?, updated_at = ?, version = version + 1 WHERE id = ?').run('Bank change waiting for confirmation and approval', nowIso(), id);
        writeAudit(db, { entity: 'mdm_partner_banks', entityId: x, action: 'request', newValues: { partner: p.code, ifsc: b.ifsc, last4: b.accountNo.slice(-4) }, actor: actor.user, companyId: actor.companyId, reason: b.reason });
        publishEvent(db, { type: 'mdm.partner.payment_hold', entity: 'mdm_partner', entityId: id, actorId: actor.user, companyId: actor.companyId, data: { code: p.code, held: true, reason: 'bank change' } });
        return x;
      });
      const contact = db.prepare('SELECT * FROM mdm_partner_contacts WHERE partner_id = ? AND deleted_at IS NULL ORDER BY is_primary DESC, id LIMIT 1').get(id);
      /** @type {any} */
      let sent = { sent: false, message: 'The partner has no registered mobile: confirm by a call-back to the registered contact.' };
      if (contact?.mobile) {
        const company = db.prepare('SELECT short_name, legal_name FROM org_companies WHERE id = ?').get(actor.companyId);
        try {
          const r = await commOf(db).otp.send({ companyId: actor.companyId, purpose: 'PAYMENT_CONFIRM', channel: 'SMS', address: contact.mobile, subjectRef: `mdm_partner_bank:${bid}`, actor: actor.user, cooldownSeconds: 0,
            render: (code) => `${code} is your code to confirm the bank account ending ${b.accountNo.slice(-4)} for payments from ${company?.short_name ?? company?.legal_name ?? 'us'}. Share it only with our staff who called you.`, deliver: otpDeliver ?? undefined });
          db.prepare('UPDATE mdm_partner_banks SET otp_id = ? WHERE id = ?').run(r.otpId, bid);
          sent = r.delivered ? { sent: true, to: mask(contact.mobile), expiresAt: r.expiresAt } : { sent: false, message: `The code could not be sent (${r.reason ?? 'no SMS connector'}): confirm by a call-back to the registered contact.` };
        } catch (e) { sent = { sent: false, message: `The code could not be sent (${e.message}): confirm by a call-back.` }; }
      }
      return { bankId: bid, confirmation: sent, payment: holdOf(row(actor, id)) };
    },
    /** The partner's confirmation: the code it received, or the call-back noted (who was called on which registered number). Then the change goes to the accounts manager and the CFO. */
    confirm(actor, id, bankId, { code, callback }) {
      need(actor, 'mdm.partner.bank.request', 'confirm a bank change');
      row(actor, id);
      const bk = db.prepare("SELECT * FROM mdm_partner_banks WHERE id = ? AND partner_id = ? AND bank_status = 'PENDING_CONFIRMATION' AND deleted_at IS NULL").get(bankId, id);
      if (!bk) throw conflict('That bank change does not wait for confirmation.');
      let method; let note;
      if (code) {
        if (!bk.otp_id) throw unprocessable('No code was sent for this change; note the call-back instead.');
        const r = commOf(db).otp.verify({ companyId: actor.companyId, otpId: bk.otp_id, code, actor: actor.user });
        if (!r.ok) throw unprocessable(r.reason === 'EXPIRED' ? 'The code has expired: ask for the bank change again.' : r.reason === 'LOCKED' ? 'Too many wrong codes: ask for the bank change again.' : 'That code is not right.');
        method = 'OTP'; note = 'Code confirmed by the registered contact';
      } else {
        const contact = db.prepare('SELECT mobile FROM mdm_partner_contacts WHERE partner_id = ? AND deleted_at IS NULL AND mobile = ?').get(id, callback.number);
        if (!contact) throw unprocessable('A call-back is made to a number registered for the partner before the change, not to one given with it.');
        method = 'CALLBACK'; note = `Called ${callback.spokeTo} on ${mask(callback.number)}: ${callback.note}`;
      }
      return transaction(db, () => {
        db.prepare("UPDATE mdm_partner_banks SET bank_status = 'PENDING_APPROVAL', verify_method = ?, verify_note = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(method, note, nowIso(), bankId);
        const inst = workflowOf(db).submit(actor, { docType: BANK_DOC, docId: bankId, comment: bk.change_reason ?? 'Bank change', context: { partnerId: id } });
        db.prepare('UPDATE mdm_partner_banks SET workflow_instance_id = ? WHERE id = ?').run(inst.id, bankId);
        writeAudit(db, { entity: 'mdm_partner_banks', entityId: bankId, action: 'confirm', newValues: { method }, actor: actor.user, companyId: actor.companyId, reason: note });
        return { workflow: inst, payment: holdOf(row(actor, id)), bank: bankView(db.prepare('SELECT * FROM mdm_partner_banks WHERE id = ?').get(bankId)) };
      });
    },
    /** The full account number, for the finance roles only; every view is in the audit trail (BR-01). */
    reveal(actor, id, bankId) {
      need(actor, 'mdm.partner.bank.view', 'see bank account numbers');
      row(actor, id);
      const bk = db.prepare('SELECT * FROM mdm_partner_banks WHERE id = ? AND partner_id = ? AND deleted_at IS NULL').get(bankId, id);
      if (!bk) throw notFound('That bank account is not of this partner.');
      writeAudit(db, { entity: 'mdm_partner_banks', entityId: bankId, action: 'view_bank', actor: actor.user, companyId: actor.companyId, reason: 'Full account number shown' });
      return { id: bankId, accountNo: vault.decrypt(bk.account_no_encrypted, slot(actor.companyId, id)), ifsc: bk.ifsc, accountName: bk.account_name };
    },
    /** Penny-drop verification needs a banking connector (none yet, D-303); the accounts manager records the result of a verification done another way. */
    verify(actor, id, bankId, { result, note }) {
      need(actor, 'mdm.partner.verify', 'verify bank accounts');
      row(actor, id);
      const bk = db.prepare('SELECT * FROM mdm_partner_banks WHERE id = ? AND partner_id = ? AND deleted_at IS NULL').get(bankId, id);
      if (!bk) throw notFound('That bank account is not of this partner.');
      if (bk.requested_by?.toLowerCase() === actor.user.toLowerCase()) throw forbidden('The person who entered a bank account does not verify it (SoD-02).');
      db.prepare('UPDATE mdm_partner_banks SET verified_status = ?, verified_at = ?, verify_note = COALESCE(verify_note || \' · \', \'\') || ?, updated_at = ?, version = version + 1 WHERE id = ?').run(result, nowIso(), note, nowIso(), bankId);
      writeAudit(db, { entity: 'mdm_partner_banks', entityId: bankId, action: 'verify', newValues: { result }, actor: actor.user, companyId: actor.companyId, reason: note });
      return bankView(db.prepare('SELECT * FROM mdm_partner_banks WHERE id = ?').get(bankId));
    },
    payment(actor, id) { need(actor, 'mdm.record.view', 'see partners'); return holdOf(row(actor, id)); },
  };

  // ---- status (FR-06, BR-02) ----
  const status = {
    /** On hold and released, inactive and active again: by the steward (or the accounts manager for a hold), with a reason, audited. */
    set(actor, id, { action, reason, version }) {
      const p = row(actor, id);
      if (p.version !== version) throw conflict('This partner was changed by someone else. Reload it and try again.');
      const hold = action === 'HOLD' || action === 'RELEASE';
      if (hold ? !may(actor, 'mdm.partner.hold') : !keeps(actor, p)) throw forbidden(hold ? 'You may not hold partners (permission mdm.partner.hold).' : 'Only the steward of this partner changes its status.');
      const next = { HOLD: ['ACTIVE', 'ON_HOLD'], RELEASE: ['ON_HOLD', 'ACTIVE'], INACTIVATE: ['ACTIVE', 'INACTIVE'], REACTIVATE: ['INACTIVE', 'ACTIVE'] }[action];
      if (p.partner_status !== next[0]) throw conflict(`A partner that is ${STATUS_LABELS[p.partner_status].toLowerCase()} cannot be ${action.toLowerCase().replace('inactivate', 'made inactive').replace('reactivate', 'made active')}.`);
      db.prepare('UPDATE mdm_partners SET partner_status = ?, status_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(next[1], reason, actor.user, nowIso(), id);
      writeAudit(db, { entity: 'mdm_partners', entityId: id, action: action.toLowerCase(), oldValues: { status: p.partner_status }, newValues: { status: next[1] }, actor: actor.user, companyId: actor.companyId, reason });
      publishEvent(db, { type: 'mdm.partner.status_changed', entity: 'mdm_partner', entityId: id, actorId: actor.user, companyId: actor.companyId, data: { code: p.code, from: p.partner_status, to: next[1] } });
      return view(actor, row(actor, id), { full: true });
    },
    /** Blacklisting (with reason and period) and lifting it: a request approved by the director. */
    request(actor, id, { action, reason, until }) {
      need(actor, 'mdm.partner.blacklist', 'ask to blacklist partners');
      const p = row(actor, id);
      if (action === 'BLACKLIST' && !['ACTIVE', 'ON_HOLD', 'INACTIVE'].includes(p.partner_status)) throw conflict('Only a registered partner is blacklisted.');
      if (action === 'LIFT_BLACKLIST' && p.partner_status !== 'BLACKLISTED') throw conflict('This partner is not blacklisted.');
      if (until && until <= today()) throw badRequest('A blacklist period ends after today.', [{ field: 'until', message: 'a later date' }]);
      if (db.prepare("SELECT 1 FROM mdm_partner_status_requests WHERE partner_id = ? AND request_status IN ('PENDING', 'RETURNED')").get(id)) throw conflict('A status request of this partner is already waiting.');
      return transaction(db, () => {
        const rid = Number(db.prepare("INSERT INTO mdm_partner_status_requests (company_id, partner_id, action, reason, until_date, requested_by, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, 'mdm_partner')").run(actor.companyId, id, action, reason, until ?? null, actor.user, actor.user).lastInsertRowid);
        const inst = workflowOf(db).submit(actor, { docType: STATUS_DOC, docId: rid, comment: reason, context: { action } });
        db.prepare('UPDATE mdm_partner_status_requests SET workflow_instance_id = ? WHERE id = ?').run(inst.id, rid);
        writeAudit(db, { entity: 'mdm_partner_status_requests', entityId: rid, action: 'submit', newValues: { partner: p.code, action, until }, actor: actor.user, companyId: actor.companyId, reason });
        return { requestId: rid, workflow: inst };
      });
    },
  };

  /** For RFQs, POs, work orders and payments of later modules (BR-02, T-03): the partner may be chosen, or why not. */
  function selectable(actor, id, { purpose = 'PO', role = null } = {}) {
    const p = row(actor, id);
    const reasons = [];
    if (p.partner_status !== 'ACTIVE') reasons.push(`${p.code} is ${STATUS_LABELS[p.partner_status].toLowerCase()}${p.status_reason ? ` (${p.status_reason})` : p.blacklist_reason ? ` (${p.blacklist_reason})` : ''}`);
    if (role && !rolesOf(id).includes(role)) reasons.push(`${p.code} is not registered as a ${ROLE_LABELS[role].toLowerCase()}`);
    if (['PO', 'WO', 'RFQ'].includes(purpose)) {
      const blocking = param('mdm.partner.blocking_documents', actor.companyId) ?? [];
      const expired = blocking.length ? db.prepare(`SELECT doc_type, valid_until FROM mdm_partner_documents WHERE partner_id = ? AND deleted_at IS NULL AND valid_until < ? AND doc_type IN (${blocking.map(() => '?').join(',')}) AND NOT EXISTS (SELECT 1 FROM mdm_partner_documents n WHERE n.partner_id = mdm_partner_documents.partner_id AND n.doc_type = mdm_partner_documents.doc_type AND n.deleted_at IS NULL AND (n.valid_until IS NULL OR n.valid_until >= ?))`).all(id, today(), ...blocking, today()) : [];
      for (const d of expired) reasons.push(`its ${DOC_TYPES[d.doc_type].toLowerCase()} expired on ${d.valid_until}`);
    }
    if (purpose === 'PAYMENT') { const h = holdOf(p); if (h.held) reasons.push(`payments are on hold: ${h.reason}`); }
    return { id: p.id, code: p.code, name: p.legal_name, selectable: reasons.length === 0, reasons };
  }

  // ---- approval decisions ----
  const decisions = {
    partner(instance, actor, outcome, comment) {
      const p = db.prepare('SELECT * FROM mdm_partners WHERE id = ?').get(Number(instance.docId));
      if (!p || p.partner_status !== 'PENDING') return;
      const now = nowIso();
      if (outcome === 'APPROVED') {
        db.prepare("UPDATE mdm_partners SET partner_status = 'ACTIVE', activated_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(now, actor.user, now, p.id);
        db.prepare("UPDATE mdm_partner_banks SET bank_status = 'ACTIVE', is_primary = 1, verified_status = CASE verified_status WHEN 'UNVERIFIED' THEN 'VERIFIED' ELSE verified_status END, verify_method = COALESCE(verify_method, 'CALLBACK'), verify_note = COALESCE(verify_note, 'Verified at activation by the accounts manager'), verified_at = ?, updated_at = ? WHERE partner_id = ? AND bank_status = 'PENDING_APPROVAL' AND deleted_at IS NULL").run(now, now, p.id);
        publishEvent(db, { type: 'mdm.partner.activated', entity: 'mdm_partner', entityId: p.id, actorId: actor.user, companyId: p.company_id, data: { code: p.code, roles: rolesOf(p.id) } });
      } else if (outcome !== 'RETURNED') db.prepare("UPDATE mdm_partners SET partner_status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(outcome === 'CANCELLED' ? 'PROSPECT' : 'REJECTED', actor.user, now, p.id);
      writeAudit(db, { entity: 'mdm_partners', entityId: p.id, action: outcome.toLowerCase(), actor: actor.user, companyId: p.company_id, reason: comment ?? null });
      tell(p, 'Registration', outcome === 'RETURNED' ? 'returned for correction' : outcome.toLowerCase(), comment);
    },
    bank(instance, actor, outcome, comment) {
      const bk = db.prepare('SELECT * FROM mdm_partner_banks WHERE id = ?').get(Number(instance.docId));
      if (!bk || bk.bank_status !== 'PENDING_APPROVAL') return;
      const p = db.prepare('SELECT * FROM mdm_partners WHERE id = ?').get(bk.partner_id);
      const now = nowIso();
      if (outcome === 'APPROVED') {
        const days = param('mdm.partner.bank_cooling_off_days', p.company_id) ?? 3;
        const until = addDays(now, days);
        db.prepare("UPDATE mdm_partner_banks SET bank_status = 'REPLACED', is_primary = 0, updated_at = ? WHERE partner_id = ? AND bank_status = 'ACTIVE' AND deleted_at IS NULL").run(now, bk.partner_id);
        db.prepare("UPDATE mdm_partner_banks SET bank_status = 'ACTIVE', is_primary = 1, cooling_off_until = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(until, now, bk.id);
        db.prepare('UPDATE mdm_partners SET payment_hold_until = ?, payment_hold_reason = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(until, `Cooling-off after the bank change (${days} days)`, now, p.id);
        publishEvent(db, { type: 'mdm.partner.bank_changed', entity: 'mdm_partner', entityId: p.id, actorId: actor.user, companyId: p.company_id, data: { code: p.code, last4: bk.account_last4, coolingOffUntil: until } });
      } else if (outcome !== 'RETURNED') {
        db.prepare("UPDATE mdm_partner_banks SET bank_status = 'REJECTED', updated_at = ?, version = version + 1 WHERE id = ?").run(now, bk.id);
        db.prepare('UPDATE mdm_partners SET payment_hold_reason = NULL, updated_at = ?, version = version + 1 WHERE id = ? AND (payment_hold_until IS NULL OR payment_hold_until < ?)').run(now, p.id, now);
        publishEvent(db, { type: 'mdm.partner.payment_hold', entity: 'mdm_partner', entityId: p.id, actorId: actor.user, companyId: p.company_id, data: { code: p.code, held: holdOf(db.prepare('SELECT * FROM mdm_partners WHERE id = ?').get(p.id)).held, reason: 'bank change ended' } });
      }
      writeAudit(db, { entity: 'mdm_partner_banks', entityId: bk.id, action: outcome.toLowerCase(), actor: actor.user, companyId: p.company_id, reason: comment ?? null });
      tell(p, 'Bank change', outcome === 'RETURNED' ? 'returned for correction' : outcome.toLowerCase(), comment, bk.requested_by);
    },
    status(instance, actor, outcome, comment) {
      const r = db.prepare('SELECT * FROM mdm_partner_status_requests WHERE id = ?').get(Number(instance.docId));
      if (!r || !['PENDING', 'RETURNED'].includes(r.request_status)) return;
      const p = db.prepare('SELECT * FROM mdm_partners WHERE id = ?').get(r.partner_id);
      const now = nowIso();
      db.prepare('UPDATE mdm_partner_status_requests SET request_status = ?, decided_by = ?, decided_at = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(outcome === 'APPROVED' ? 'APPLIED' : outcome, actor.user, outcome === 'RETURNED' ? null : now, now, r.id);
      if (outcome === 'APPROVED') {
        if (r.action === 'BLACKLIST') db.prepare("UPDATE mdm_partners SET partner_status = 'BLACKLISTED', blacklist_reason = ?, blacklist_until = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(r.reason, r.until_date, actor.user, now, p.id);
        else db.prepare("UPDATE mdm_partners SET partner_status = 'ACTIVE', blacklist_reason = NULL, blacklist_until = NULL, status_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(r.reason, actor.user, now, p.id);
        const flagged = []; for (const a of activity.values()) if (a.flagged) flagged.push(...a.flagged(db, p.company_id, p.id));
        publishEvent(db, { type: 'mdm.partner.status_changed', entity: 'mdm_partner', entityId: p.id, actorId: actor.user, companyId: p.company_id, data: { code: p.code, from: p.partner_status, to: r.action === 'BLACKLIST' ? 'BLACKLISTED' : 'ACTIVE', openDocuments: flagged.length } });
      }
      writeAudit(db, { entity: 'mdm_partner_status_requests', entityId: r.id, action: outcome.toLowerCase(), actor: actor.user, companyId: p.company_id, reason: comment ?? null });
      tell(p, r.action === 'BLACKLIST' ? 'Blacklisting' : 'Removal from the blacklist', outcome === 'RETURNED' ? 'returned for correction' : outcome.toLowerCase(), comment, r.requested_by);
    },
  };

  // ---- the daily compliance check (FR-04, T-03) ----
  function compliance(companyId) {
    const warn = param('mdm.partner.expiry_warning_days', companyId) ?? 30;
    const blocking = param('mdm.partner.blocking_documents', companyId) ?? [];
    const due = dayPlus(warn);
    const out = { due: 0, expired: 0, lifted: 0 };
    for (const d of db.prepare("SELECT d.*, p.code, p.legal_name, p.steward_role FROM mdm_partner_documents d JOIN mdm_partners p ON p.id = d.partner_id WHERE d.company_id = ? AND d.deleted_at IS NULL AND d.valid_until IS NOT NULL AND d.valid_until <= ? AND p.partner_status IN ('ACTIVE', 'ON_HOLD') AND COALESCE(d.alert_stage, '') != CASE WHEN d.valid_until < ? THEN 'EXPIRED' ELSE 'DUE' END").all(companyId, due, today())) {
      const stage = d.valid_until < today() ? 'EXPIRED' : 'DUE';
      if (stage === 'DUE' && d.alert_stage === 'EXPIRED') continue;
      const people = [...new Set([...tasksOf(db).holders(companyId, [d.steward_role]), ...tasksOf(db).holders(companyId, ['ACCMGR'])])];
      if (people.length) notif.notify({ companyId, templateCode: 'mdm.partner.document_expiry', recipients: people.map((u) => `user:${u}`), data: { stage: stage === 'EXPIRED' ? 'expired' : 'expires', code: d.code, name: d.legal_name, doc: DOC_TYPES[d.doc_type], date: d.valid_until, block: stage === 'EXPIRED' && blocking.includes(d.doc_type) ? ' New POs, work orders and RFQs are blocked until a valid one is added.' : '' }, link: `/admin/partners/partner?id=${d.partner_id}&tab=documents`, sourceType: 'mdm_partner', sourceId: String(d.partner_id), eventKey: `mdm.partner.document_expiry:${d.id}:${stage}` });
      db.prepare('UPDATE mdm_partner_documents SET alert_stage = ?, updated_at = ? WHERE id = ?').run(stage, nowIso(), d.id);
      publishEvent(db, { type: 'mdm.partner.document_expiring', entity: 'mdm_partner', entityId: d.partner_id, actorId: 'system', companyId, data: { code: d.code, document: d.doc_type, validUntil: d.valid_until, stage, blocks: stage === 'EXPIRED' && blocking.includes(d.doc_type) } });
      out[stage === 'EXPIRED' ? 'expired' : 'due'] += 1;
    }
    // a blacklisting with an end date lapses on that date
    for (const p of db.prepare("SELECT * FROM mdm_partners WHERE company_id = ? AND partner_status = 'BLACKLISTED' AND blacklist_until IS NOT NULL AND blacklist_until < ?").all(companyId, today())) {
      db.prepare("UPDATE mdm_partners SET partner_status = 'ACTIVE', status_reason = ?, updated_by = 'system', updated_at = ?, version = version + 1 WHERE id = ?").run(`Blacklisting ended on ${p.blacklist_until}`, nowIso(), p.id);
      writeAudit(db, { entity: 'mdm_partners', entityId: p.id, action: 'blacklist_lapsed', actor: 'system', companyId });
      out.lifted += 1;
    }
    return out;
  }

  // ---- lists, 360 and the worklist ----
  const listScope = (actor) => ({ scopeSql: 'p.company_id = :c', params: { c: actor.companyId } });
  const listReq = (actor, query) => { const req = parseListRequest(partnerList, query); if (!seesIdentity(actor) && (req.sort.some((x) => x.key === 'pan') || req.filters.some((x) => x.key === 'pan'))) throw badRequest('Some list parameters are invalid.', [{ field: 'pan', message: 'PAN is hidden for your role, so it cannot be sorted or filtered.' }]); return req; };
  const present = (actor) => (r) => ({ id: r.id, code: r.code, legalName: r.legal_name, tradeName: r.trade_name, roles: r.roles_txt, categories: r.cats_txt, status: r.partner_status, pan: seesIdentity(actor) ? r.pan : undefined, msme: r.msme_category, nextExpiry: r.next_expiry, paymentHold: r.hold, steward: r.steward_role, updatedAt: r.updated_at ?? r.created_at });
  const select = `p.*, ${partnerList.columns.roles.sql} AS roles_txt, ${partnerList.columns.categories.sql} AS cats_txt, ${partnerList.columns.nextExpiry.sql} AS next_expiry, ${partnerList.columns.paymentHold.sql} AS hold`;
  const register = {
    list(actor, query) { need(actor, 'mdm.record.view', 'see partners'); return runList(db, partnerList, listReq(actor, query), { select, ...listScope(actor), tieBreaker: 'p.id', map: present(actor) }); },
    exportSource(actor, req) {
      need(actor, 'mdm.record.view', 'see partners');
      const cols = Object.entries(partnerList.columns).filter(([k]) => k !== 'pan' || seesIdentity(actor)).map(([key, c]) => ({ key, label: c.label, type: c.type === 'enum' ? 'text' : c.type }));
      return { title: partnerList.label, permission: 'mdm.record.view', personal: false, columns: cols, count: () => countList(db, partnerList, req, listScope(actor)),
        rows: () => runList(db, partnerList, req, { select, ...listScope(actor), tieBreaker: 'p.id', limit: null, map: present(actor) }).data,
        describe: (r) => [r.q ? `search "${r.q}"` : '', ...r.filters.map((x) => `${partnerList.columns[x.key].label} ${x.op} ${x.raw}`)].filter(Boolean).join('; ') };
    },
  };
  function get(actor, id) { need(actor, 'mdm.record.view', 'see partners'); return view(actor, row(actor, id), { full: true }); }
  /** Partner 360 (FR-08): what this master holds and what other modules report, as they come online. */
  function summary(actor, id) {
    need(actor, 'mdm.record.view', 'see partners');
    const p = row(actor, id);
    const v = view(actor, p, { full: true });
    const tiles = [
      { label: 'GST registrations', value: v.gstins.length }, { label: 'Bank accounts in use', value: v.banks.filter((b) => b.status === 'ACTIVE').length }, { label: 'Documents expired', value: v.expiredDocuments, tone: v.expiredDocuments ? 'error' : 'success' },
      { label: 'Documents expiring soon', value: v.dueDocuments, tone: v.dueDocuments ? 'warning' : 'neutral' }, { label: 'Payments', value: v.payment.held ? 'On hold' : 'Free', tone: v.payment.held ? 'warning' : 'success' },
    ];
    const modules = []; for (const a of activity.values()) if (a.summary) modules.push(...a.summary(db, actor.companyId, p).map((x) => ({ ...x, source: a.label })));
    const history = db.prepare("SELECT action, actor, reason, created_at FROM core_audit_log WHERE entity IN ('mdm_partners', 'mdm_partner_status_requests', 'mdm_partner_banks') AND (entity_id = ? OR new_values LIKE ?) ORDER BY id DESC LIMIT 30").all(String(id), `%"partner":"${p.code}"%`).map((h) => ({ action: h.action, by: h.actor, reason: h.reason, at: h.created_at }));
    return { tiles, modules, history, selectable: selectable(actor, id, { purpose: 'PO' }), note: modules.length ? null : 'Purchase orders, bills, payments and performance appear here when the procurement, billing and finance modules are in use.' };
  }
  /** Partner Approvals & Bank Change Requests (worklist): what waits, oldest first, with its age against a 48-hour SLA. */
  /** @param {any} actor @param {{ kind?: string }} [f] */
  function queue(actor, { kind } = {}) {
    need(actor, 'mdm.partner.queue', 'see the partner worklist');
    const out = [];
    const age = (iso) => Math.floor((Date.now() - Date.parse(iso)) / 3_600_000);
    if (!kind || kind === 'REGISTRATION') for (const p of db.prepare("SELECT p.*, w.status AS wf FROM mdm_partners p LEFT JOIN wf_instances w ON w.id = p.workflow_instance_id WHERE p.company_id = ? AND p.partner_status = 'PENDING'").all(actor.companyId)) out.push({ kind: 'REGISTRATION', id: p.id, partnerId: p.id, code: p.code, name: p.legal_name, what: `New ${rolesOf(p.id).map((r) => ROLE_LABELS[r].toLowerCase()).join(', ')}`, by: p.requested_by, since: p.updated_at ?? p.created_at, ageHours: age(p.updated_at ?? p.created_at), instanceId: p.workflow_instance_id, returned: p.wf === 'RETURNED' });
    if (!kind || kind === 'BANK') for (const b of db.prepare("SELECT b.*, p.code, p.legal_name FROM mdm_partner_banks b JOIN mdm_partners p ON p.id = b.partner_id WHERE b.company_id = ? AND b.bank_status IN ('PENDING_CONFIRMATION', 'PENDING_APPROVAL') AND b.deleted_at IS NULL AND p.partner_status NOT IN ('PROSPECT', 'PENDING')").all(actor.companyId)) out.push({ kind: 'BANK', id: b.id, partnerId: b.partner_id, code: b.code, name: b.legal_name, what: `Bank change to account ending ${b.account_last4} (${b.ifsc})${b.bank_status === 'PENDING_CONFIRMATION' ? ': waiting for the partner to confirm' : ''}`, by: b.requested_by, since: b.created_at, ageHours: age(b.created_at), instanceId: b.workflow_instance_id, stage: b.bank_status });
    if (!kind || kind === 'STATUS') for (const s of db.prepare("SELECT s.*, p.code, p.legal_name FROM mdm_partner_status_requests s JOIN mdm_partners p ON p.id = s.partner_id WHERE s.company_id = ? AND s.request_status IN ('PENDING', 'RETURNED')").all(actor.companyId)) out.push({ kind: 'STATUS', id: s.id, partnerId: s.partner_id, code: s.code, name: s.legal_name, what: `${s.action === 'BLACKLIST' ? 'Blacklist' : 'Lift the blacklist'}: ${s.reason}`, by: s.requested_by, since: s.created_at, ageHours: age(s.created_at), instanceId: s.workflow_instance_id });
    if (!kind || kind === 'DOCUMENT') for (const d of db.prepare("SELECT d.*, p.code, p.legal_name FROM mdm_partner_documents d JOIN mdm_partners p ON p.id = d.partner_id WHERE d.company_id = ? AND d.deleted_at IS NULL AND d.valid_until IS NOT NULL AND d.valid_until <= ? AND p.partner_status IN ('ACTIVE', 'ON_HOLD') AND NOT EXISTS (SELECT 1 FROM mdm_partner_documents n WHERE n.partner_id = d.partner_id AND n.doc_type = d.doc_type AND n.deleted_at IS NULL AND n.id != d.id AND (n.valid_until IS NULL OR n.valid_until > d.valid_until))").all(actor.companyId, dayPlus(param('mdm.partner.expiry_warning_days', actor.companyId) ?? 30)))
      out.push({ kind: 'DOCUMENT', id: d.id, partnerId: d.partner_id, code: d.code, name: d.legal_name, what: `${DOC_TYPES[d.doc_type]} ${d.valid_until < today() ? 'expired' : 'expires'} on ${d.valid_until}`, by: d.created_by, since: d.valid_until, ageHours: d.valid_until < today() ? age(`${d.valid_until}T00:00:00Z`) : 0, expired: d.valid_until < today() });
    const mine = new Set((workflowOf(db).listTasks?.(actor, { mine: 'assigned', limit: 200 })?.rows ?? []).map((t) => t.instance?.id));
    const rows = out.map((x) => ({ ...x, tone: x.ageHours >= 96 || x.expired ? 'error' : x.ageHours >= 48 ? 'warning' : 'neutral', mine: Boolean(x.instanceId && mine.has(x.instanceId)) })).sort((a, b) => Number(b.mine) - Number(a.mine) || b.ageHours - a.ageHours);
    const counts = {}; for (const r of rows) counts[r.kind] = (counts[r.kind] ?? 0) + 1;
    return { rows, counts };
  }
  /** Partners that can be chosen, for the lookups of other modules' forms (BR-02). */
  function lookup(actor, { q, role, limit, offset }) {
    need(actor, 'mdm.record.view', 'see partners');
    const where = ["p.company_id = ?", "p.partner_status = 'ACTIVE'", 'p.deleted_at IS NULL']; const args = [actor.companyId];
    if (role) { where.push('EXISTS (SELECT 1 FROM mdm_partner_roles r WHERE r.partner_id = p.id AND r.partner_role = ? AND r.deleted_at IS NULL)'); args.push(role); }
    if (q) { where.push('(p.code LIKE ? OR p.legal_name LIKE ? OR p.trade_name LIKE ?)'); args.push(`${q}%`, `%${q}%`, `%${q}%`); }
    const total = db.prepare(`SELECT COUNT(*) AS n FROM mdm_partners p WHERE ${where.join(' AND ')}`).get(...args).n;
    const rows = db.prepare(`SELECT p.id, p.code, p.legal_name, p.trade_name FROM mdm_partners p WHERE ${where.join(' AND ')} ORDER BY p.legal_name LIMIT ? OFFSET ?`).all(...args, limit, offset);
    return { rows: rows.map((r) => ({ id: r.id, code: r.code, name: r.legal_name, extra: { trade: r.trade_name ?? '' } })), total };
  }

  return { registration, details, banks, status, decisions, compliance, register, get, summary, queue, selectable, lookup, seesIdentity };
}

const services = new WeakMap();
export const bindPartners = (db, s) => services.set(db, s);
export const partnersOf = (db) => services.get(db) ?? null;
const step = (code, name, role, when = null) => ({ code, name, type: 'approval', mode: 'single', approvers: [{ kind: 'role', role }], slaHours: 48, requireAttachment: false, checklist: [], when, notify: [], action: null });
const hooks = (fn) => ({
  onApproved: (db, { instance, actor }) => partnersOf(db)?.decisions[fn](instance, actor, 'APPROVED'),
  onRejected: (db, { instance, actor, comment }) => partnersOf(db)?.decisions[fn](instance, actor, 'REJECTED', comment),
  onReturned: (db, { instance, actor, comment }) => partnersOf(db)?.decisions[fn](instance, actor, 'RETURNED', comment),
  onCancelled: (db, { instance, actor, comment }) => partnersOf(db)?.decisions[fn](instance, actor, 'CANCELLED', comment),
});
const partnerRef = (db, companyId, id) => db.prepare('SELECT code, legal_name, requested_by FROM mdm_partners WHERE id = ? AND company_id = ?').get(Number(id), companyId);
workflowTypes.register({
  docType: PARTNER_DOC, label: 'New business partner activation', processOwner: 'PROCMGR', route: (id) => `/admin/partners/partner?id=${id}`,
  describe(db, companyId, id) { const p = partnerRef(db, companyId, id); return p ? { ref: p.code, title: p.legal_name, originator: p.requested_by } : null; },
  summarise(db, _actor, id) { const p = db.prepare('SELECT * FROM mdm_partners WHERE id = ?').get(Number(id)); if (!p) return null; const roles = db.prepare('SELECT partner_role FROM mdm_partner_roles WHERE partner_id = ? AND deleted_at IS NULL').all(p.id).map((r) => ROLE_LABELS[r.partner_role]); return { fields: [{ label: 'Partner', value: `${p.code} ${p.legal_name}` }, { label: 'Roles', value: roles.join(', ') }, { label: 'Constitution', value: p.constitution }, { label: 'PAN', value: mask(p.pan) ?? '—' }, { label: 'MSME', value: p.msme_category ?? '—' }] }; },
  defaultDefinition: { name: 'New partner: steward, then accounts manager', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('PROCMGR', 'Procurement manager (vendors, service providers, transporters)', 'PROCMGR', { field: 'stewardRole', op: 'eq', value: 'PROCMGR' }), step('COMMGR', 'Commercial manager (subcontractors, labour contractors, clients, consultants)', 'COMMGR', { field: 'stewardRole', op: 'eq', value: 'COMMGR' }), step('ACCMGR', 'Accounts manager (statutory and bank verification)', 'ACCMGR')] },
  hooks: hooks('partner'),
});
workflowTypes.register({
  docType: BANK_DOC, label: 'Bank account change of a partner', processOwner: 'ACCMGR', route: () => '/admin/partners/approvals',
  describe(db, companyId, id) { const b = db.prepare('SELECT b.*, p.code, p.legal_name FROM mdm_partner_banks b JOIN mdm_partners p ON p.id = b.partner_id WHERE b.id = ? AND b.company_id = ?').get(Number(id), companyId); return b ? { ref: `${b.code} bank change`, title: `${b.legal_name}: account ending ${b.account_last4}`, originator: b.requested_by } : null; },
  summarise(db, _actor, id) { const b = db.prepare('SELECT b.*, p.code, p.legal_name FROM mdm_partner_banks b JOIN mdm_partners p ON p.id = b.partner_id WHERE b.id = ?').get(Number(id)); if (!b) return null; const old = db.prepare("SELECT account_last4, ifsc FROM mdm_partner_banks WHERE partner_id = ? AND bank_status = 'ACTIVE' AND deleted_at IS NULL").get(b.partner_id); return { fields: [{ label: 'Partner', value: `${b.code} ${b.legal_name}` }, { label: 'Now', value: old ? `ending ${old.account_last4} (${old.ifsc})` : 'no account' }, { label: 'Asked for', value: `ending ${b.account_last4} (${b.ifsc}${b.bank_name ? `, ${b.bank_name}` : ''})` }, { label: 'Account name', value: b.account_name }, { label: 'Confirmed by', value: `${b.verify_method ?? '—'}: ${b.verify_note ?? ''}` }, { label: 'Reason', value: b.change_reason ?? '' }] }; },
  defaultDefinition: { name: 'Partner bank change: accounts manager, then CFO', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('ACCMGR', 'Accounts manager', 'ACCMGR'), step('CFO', 'Chief financial officer', 'CFO')] },
  hooks: hooks('bank'),
});
workflowTypes.register({
  docType: STATUS_DOC, label: 'Blacklisting of a partner or its removal', processOwner: 'PROCMGR', route: () => '/admin/partners/approvals',
  describe(db, companyId, id) { const s = db.prepare('SELECT s.*, p.code, p.legal_name FROM mdm_partner_status_requests s JOIN mdm_partners p ON p.id = s.partner_id WHERE s.id = ? AND s.company_id = ?').get(Number(id), companyId); return s ? { ref: `${s.code} ${s.action === 'BLACKLIST' ? 'blacklist' : 'lift blacklist'}`, title: s.legal_name, originator: s.requested_by } : null; },
  summarise(db, _actor, id) { const s = db.prepare('SELECT s.*, p.code, p.legal_name FROM mdm_partner_status_requests s JOIN mdm_partners p ON p.id = s.partner_id WHERE s.id = ?').get(Number(id)); return s ? { fields: [{ label: 'Partner', value: `${s.code} ${s.legal_name}` }, { label: 'Action', value: s.action === 'BLACKLIST' ? 'Blacklist' : 'Lift the blacklist' }, { label: 'Reason', value: s.reason }, { label: 'Until', value: s.until_date ?? 'no end date' }] } : null; },
  defaultDefinition: { name: 'Partner blacklisting: director', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('DIR', 'Director', 'DIR')] },
  hooks: hooks('status'),
});
evidenceProviders.register(PARTNER_DOC, ({ db, instance }) => {
  const p = db.prepare('SELECT * FROM mdm_partners WHERE id = ?').get(Number(instance.docId));
  if (!p) return { sections: [] };
  const g = db.prepare('SELECT COUNT(*) AS n, SUM(CASE WHEN verify_source = \'API\' THEN 1 ELSE 0 END) AS v FROM mdm_partner_gstins WHERE partner_id = ? AND deleted_at IS NULL').get(p.id);
  const docs = db.prepare('SELECT doc_type FROM mdm_partner_documents WHERE partner_id = ? AND deleted_at IS NULL').all(p.id).map((d) => DOC_TYPES[d.doc_type]);
  const bank = db.prepare("SELECT account_last4, ifsc, bank_name FROM mdm_partner_banks WHERE partner_id = ? AND bank_status = 'PENDING_APPROVAL' AND deleted_at IS NULL").get(p.id);
  const same = db.prepare("SELECT code FROM mdm_partners WHERE company_id = ? AND id != ? AND pan = ? AND partner_status != 'REJECTED'").all(p.company_id, p.id, p.pan ?? '');
  return { sections: [{ code: 'mdm-partner', title: 'What the approvers check', kind: 'metrics', items: [{ label: 'PAN format', value: p.pan && FORMATS.PAN.test(p.pan) ? 'Valid' : 'Missing', format: 'text', tone: p.pan ? undefined : 'warn' }, { label: 'GSTINs (checked on the portal)', value: `${g.n ?? 0} (${g.v ?? 0})`, format: 'text' }, { label: 'Bank account', value: bank ? `ending ${bank.account_last4}, ${bank.ifsc}${bank.bank_name ? `, ${bank.bank_name}` : ''}` : 'none given', format: 'text' }, { label: 'Documents', value: docs.join(', ') || 'none', format: 'text', tone: docs.length ? undefined : 'warn' }, { label: 'Other partners with this PAN', value: same.map((x) => x.code).join(', ') || 'None', format: 'text', tone: same.length ? 'warn' : undefined }] }] };
});
evidenceProviders.register(BANK_DOC, ({ db, instance }) => {
  const b = db.prepare('SELECT * FROM mdm_partner_banks WHERE id = ?').get(Number(instance.docId));
  if (!b) return { sections: [] };
  const others = db.prepare("SELECT p.code FROM mdm_partner_banks x JOIN mdm_partners p ON p.id = x.partner_id WHERE x.company_id = ? AND x.account_hash = ? AND x.partner_id != ? AND x.deleted_at IS NULL").all(b.company_id, b.account_hash, b.partner_id);
  const changes = db.prepare("SELECT COUNT(*) AS n FROM mdm_partner_banks WHERE partner_id = ? AND created_at >= ? AND deleted_at IS NULL").get(b.partner_id, new Date(Date.now() - 180 * 86_400_000).toISOString()).n;
  return { sections: [{ code: 'mdm-bank', title: 'Before approving a bank change', kind: 'metrics', items: [{ label: 'Confirmed by the partner', value: `${b.verify_method ?? 'not yet'}${b.verify_note ? `: ${b.verify_note}` : ''}`, format: 'text', tone: b.verify_method ? undefined : 'warn' }, { label: 'Same account at another partner', value: others.map((o) => o.code).join(', ') || 'None', format: 'text', tone: others.length ? 'warn' : undefined }, { label: 'Bank changes in 6 months', value: changes, format: 'text', tone: changes > 2 ? 'warn' : undefined }, { label: 'Payments', value: 'On hold until approved and the cooling-off period ends', format: 'text' }] }] };
});
objectTypes.register({
  type: 'mdm_partner', label: 'Business partner', permission: 'mdm.record.view', route: (id) => `/admin/partners/partner?id=${id}`,
  access(db, actor, id) { if (!authzOf(db).check(actor, 'mdm.record.view').allowed) return null; const r = db.prepare('SELECT company_id, partner_status FROM mdm_partners WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); return r ? { companyId: r.company_id, projectId: null, siteId: null, status: r.partner_status } : null; },
  auditEntities: (id) => [{ entity: 'mdm_partners', id }],
  summary(db, actor, id) { const r = db.prepare('SELECT code, legal_name, partner_status FROM mdm_partners WHERE id = ? AND company_id = ?').get(Number(id), actor.companyId); return r ? { label: `${r.code} ${r.legal_name}`, status: r.partner_status } : null; },
  search(db, actor, q, limit) { if (!authzOf(db).check(actor, 'mdm.record.view').allowed) return []; return db.prepare("SELECT id FROM mdm_partners WHERE company_id = ? AND deleted_at IS NULL AND partner_status != 'REJECTED' AND (code LIKE ? OR legal_name LIKE ? OR trade_name LIKE ?) ORDER BY legal_name LIMIT ?").all(actor.companyId, `${q}%`, `%${q}%`, `%${q}%`, limit); },
});
fileEntities.register({
  entity: 'mdm_partner', label: 'Business partner (compliance documents, cancelled cheques)',
  resolve(db, actor, id) {
    const r = db.prepare('SELECT company_id, steward_role FROM mdm_partners WHERE id = ? AND company_id = ?').get(Number(id), actor.companyId);
    if (!r) return null;
    const a = authzOf(db);
    const roles = (Array.isArray(actor.roles) ? actor.roles : String(actor.roles ?? '').split(',')).map((x) => String(x).trim().toUpperCase());
    return { companyId: r.company_id, projectId: null, siteId: null, canView: a.check(actor, 'mdm.record.view').allowed, canEdit: (a.check(actor, 'mdm.partner.edit').allowed && roles.includes(r.steward_role)) || a.check(actor, 'mdm.partner.verify').allowed || a.check(actor, 'mdm.partner.bank.request').allowed, locked: false };
  },
});
